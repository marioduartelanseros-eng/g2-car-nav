import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import {
  geocodeAddress,
  getDrivingRoute,
  haversineDistance,
  formatDistance,
  formatDuration,
  resolveActiveStep,
} from './navigation'
import type { Route } from './navigation'
import {
  initDisplay,
  updateNavDisplay,
  showMessage,
  showStepPreview,
} from './glasses'
import type { EvenBridge } from './glasses'

// ── SDK input event constants ─────────────────────────────────────────────────
const CLICK = 0
const SCROLL_UP = 1
const SCROLL_DOWN = 2
const DOUBLE_CLICK = 3

// ── App state ─────────────────────────────────────────────────────────────────
let bridge: EvenBridge | null = null
let watchId: number | null = null
let currentRoute: Route | null = null
let activeStepIndex = 0
let previewOffset = 0          // 0 = show active step, +N = preview N steps ahead
let lastPosition: [number, number] | null = null
let isNavigating = false

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  // Connect to glasses
  bridge = (await waitForEvenAppBridge()) as unknown as EvenBridge
  await initDisplay(bridge)

  // Register input handler
  bridge.onEvenHubEvent((eventType) => {
    handleGlassesInput(eventType)
  })

  // Wire up phone UI
  setupPhoneUI()

  setStatus('Connected to G2. Enter a destination.')
}

// ── Phone UI ──────────────────────────────────────────────────────────────────

function setupPhoneUI() {
  const form = document.getElementById('nav-form') as HTMLFormElement
  const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement
  const recalcBtn = document.getElementById('recalc-btn') as HTMLButtonElement

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = (document.getElementById('destination') as HTMLInputElement).value.trim()
    if (!input) return
    await startNavigation(input)
  })

  stopBtn.addEventListener('click', stopNavigation)
  recalcBtn.addEventListener('click', async () => {
    if (!currentRoute || !lastPosition) return
    const dest = currentRoute.steps[currentRoute.steps.length - 1]
    await recalculate(dest.location)
  })
}

// ── Navigation lifecycle ──────────────────────────────────────────────────────

async function startNavigation(destination: string) {
  if (!bridge) return

  setStatus(`Locating "${destination}"...`)
  setNavigating(false)
  await showMessage(bridge, 'Calculating...', destination)

  let destCoords: [number, number]
  try {
    destCoords = await geocodeAddress(destination)
  } catch {
    setStatus(`Could not find: "${destination}"`)
    await showMessage(bridge, 'Not found', destination)
    return
  }

  setStatus('Getting your location...')
  let position: [number, number]
  try {
    position = await getCurrentPosition()
  } catch {
    setStatus('GPS unavailable. Enable location access.')
    await showMessage(bridge, 'GPS error', 'Enable location\naccess on phone')
    return
  }

  setStatus('Calculating route...')
  try {
    currentRoute = await getDrivingRoute(position, destCoords)
  } catch {
    setStatus('Could not calculate a route.')
    await showMessage(bridge, 'Route error', 'No route found')
    return
  }

  activeStepIndex = 0
  previewOffset = 0
  isNavigating = true
  setNavigating(true)

  const step = currentRoute.steps[0]
  const dist = haversineDistance(position, step.location)
  await updateNavDisplay(bridge, step, dist, currentRoute, 0)

  const totalDist = formatDistance(currentRoute.totalDistance)
  const totalEta = formatDuration(currentRoute.totalDuration)
  setStatus(`Navigating — ${totalDist}, ${totalEta}`)

  startTracking()
}

function stopNavigation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  currentRoute = null
  isNavigating = false
  previewOffset = 0
  setNavigating(false)
  setStatus('Navigation stopped.')
  if (bridge) showMessage(bridge, 'G2 Car Nav', 'Navigation stopped')
}

async function recalculate(destination: [number, number]) {
  if (!bridge || !lastPosition) return
  setStatus('Recalculating...')
  await showMessage(bridge, 'Recalculating...')
  try {
    currentRoute = await getDrivingRoute(lastPosition, destination)
    activeStepIndex = 0
    previewOffset = 0
    const step = currentRoute.steps[0]
    const dist = haversineDistance(lastPosition, step.location)
    await updateNavDisplay(bridge, step, dist, currentRoute, 0)
    setStatus('Route updated.')
  } catch {
    setStatus('Recalculation failed.')
    await showMessage(bridge, 'Recalc failed', 'Check connection')
  }
}

// ── GPS tracking ──────────────────────────────────────────────────────────────

function startTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    onPositionError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
  )
}

async function onPosition(pos: GeolocationPosition) {
  if (!bridge || !currentRoute || !isNavigating) return

  const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude]
  lastPosition = coords

  // Advance step index if close enough to next maneuver
  const newIndex = resolveActiveStep(coords, currentRoute.steps, activeStepIndex)
  const stepChanged = newIndex !== activeStepIndex
  activeStepIndex = newIndex
  if (stepChanged) previewOffset = 0  // snap back to active step on advance

  const step = currentRoute.steps[activeStepIndex]
  const isLast = activeStepIndex >= currentRoute.steps.length - 1

  // Distance to the next maneuver location (end of current step)
  const nextManeuverLocation = isLast
    ? step.location  // already arrived
    : currentRoute.steps[activeStepIndex + 1]?.location ?? step.location
  const distToNext = haversineDistance(coords, nextManeuverLocation)

  // Check arrival
  if (isLast && distToNext < 20) {
    await showMessage(bridge, '[*]  ARRIVED', 'You have reached\nyour destination')
    setStatus('Arrived!')
    stopNavigation()
    return
  }

  // Only re-render if not in preview mode
  if (previewOffset === 0) {
    await updateNavDisplay(bridge, step, distToNext, currentRoute, activeStepIndex)
  }

  updateSpeedDisplay(pos.coords.speed)
}

function onPositionError(err: GeolocationPositionError) {
  setStatus(`GPS error: ${err.message}`)
}

// ── Glasses input ─────────────────────────────────────────────────────────────

function handleGlassesInput(eventType: number | undefined) {
  if (!bridge || !currentRoute || !isNavigating) return

  const total = currentRoute.steps.length

  if (eventType === SCROLL_UP || eventType === undefined) {
    // Swipe up: preview next step
    const maxPreview = total - 1 - activeStepIndex
    if (previewOffset < maxPreview) {
      previewOffset++
      const previewIndex = activeStepIndex + previewOffset
      const step = currentRoute.steps[previewIndex]
      showStepPreview(bridge, step, previewIndex + 1, total)
    }
    return
  }

  if (eventType === SCROLL_DOWN) {
    // Swipe down: go back toward active step
    if (previewOffset > 0) {
      previewOffset--
    }
    if (previewOffset === 0 && lastPosition) {
      // Back to live view
      const step = currentRoute.steps[activeStepIndex]
      const nextLoc =
        currentRoute.steps[activeStepIndex + 1]?.location ?? step.location
      const dist = lastPosition ? haversineDistance(lastPosition, nextLoc) : step.distance
      updateNavDisplay(bridge, step, dist, currentRoute, activeStepIndex)
    } else if (previewOffset > 0) {
      const previewIndex = activeStepIndex + previewOffset
      const step = currentRoute.steps[previewIndex]
      showStepPreview(bridge, step, previewIndex + 1, total)
    }
    return
  }

  if (eventType === CLICK) {
    // Single press: snap back to current step
    previewOffset = 0
    if (lastPosition) {
      const step = currentRoute.steps[activeStepIndex]
      const nextLoc =
        currentRoute.steps[activeStepIndex + 1]?.location ?? step.location
      const dist = haversineDistance(lastPosition, nextLoc)
      updateNavDisplay(bridge, step, dist, currentRoute, activeStepIndex)
    }
    return
  }

  if (eventType === DOUBLE_CLICK) {
    // Double press: recalculate from current position to original destination
    const dest = currentRoute.steps[currentRoute.steps.length - 1]
    recalculate(dest.location)
    return
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCurrentPosition(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
      reject,
      { enableHighAccuracy: true, timeout: 15000 },
    )
  })
}

function setStatus(msg: string) {
  const el = document.getElementById('status')
  if (el) el.textContent = msg
}

function setNavigating(active: boolean) {
  document.getElementById('nav-form')!.style.display = active ? 'none' : 'flex'
  document.getElementById('active-nav')!.style.display = active ? 'flex' : 'none'
}

function updateSpeedDisplay(speedMs: number | null) {
  const el = document.getElementById('speed')
  if (!el) return
  if (speedMs == null || speedMs < 0) {
    el.textContent = '-- km/h'
  } else {
    el.textContent = `${Math.round(speedMs * 3.6)} km/h`
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch((err) => {
  console.error('Boot failed:', err)
  setStatus(`Error: ${err.message}`)
})
