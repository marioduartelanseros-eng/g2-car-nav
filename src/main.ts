import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
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
  sendMapImage,
} from './glasses'
import { renderMapImage } from './map-renderer'

// ── App state ─────────────────────────────────────────────────────────────────
let bridge: EvenAppBridge | null = null
let watchId: number | null = null
let currentRoute: Route | null = null
let activeStepIndex = 0
let previewOffset = 0
let lastPosition: [number, number] | null = null
let isNavigating = false
let mapSendInFlight = false   // prevent concurrent image sends

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  setStatus('Connecting to G2...')

  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      ),
    ])
  } catch {
    setStatus('Open this page in the Even Realities app to connect your G2.')
    return
  }

  await initDisplay(bridge)

  bridge.onEvenHubEvent((event: EvenHubEvent) => handleGlassesInput(event))

  setupPhoneUI()
  setStatus('Connected — enter a destination.')
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
    await recalculate(currentRoute.steps[currentRoute.steps.length - 1].location)
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
    setStatus('GPS unavailable — enable location in settings.')
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
  const nextLoc = currentRoute.steps[1]?.location ?? step.location
  const dist = haversineDistance(position, nextLoc)
  const mapPixels = renderMapImage(currentRoute.geometry, position, nextLoc)
  await updateNavDisplay(bridge, step, dist, currentRoute, 0, mapPixels)

  setStatus(`Navigating — ${formatDistance(currentRoute.totalDistance)}, ${formatDuration(currentRoute.totalDuration)}`)
  startTracking()
}

function stopNavigation() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null }
  currentRoute = null
  isNavigating = false
  previewOffset = 0
  mapSendInFlight = false
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
    const nextLoc = currentRoute.steps[1]?.location ?? step.location
    const dist = haversineDistance(lastPosition, nextLoc)
    const mapPixels = renderMapImage(currentRoute.geometry, lastPosition, nextLoc)
    await updateNavDisplay(bridge, step, dist, currentRoute, 0, mapPixels)
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
    (err) => setStatus(`GPS error: ${err.message}`),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
  )
}

async function onPosition(pos: GeolocationPosition) {
  if (!bridge || !currentRoute || !isNavigating) return

  const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude]
  lastPosition = coords

  const newIndex = resolveActiveStep(coords, currentRoute.steps, activeStepIndex)
  if (newIndex !== activeStepIndex) { activeStepIndex = newIndex; previewOffset = 0 }

  const step = currentRoute.steps[activeStepIndex]
  const isLast = activeStepIndex >= currentRoute.steps.length - 1
  const nextLoc = isLast
    ? step.location
    : currentRoute.steps[activeStepIndex + 1]?.location ?? step.location
  const distToNext = haversineDistance(coords, nextLoc)

  if (isLast && distToNext < 20) {
    await showMessage(bridge, '[*]  ARRIVED', 'You have reached\nyour destination')
    setStatus('Arrived!')
    stopNavigation()
    return
  }

  if (previewOffset === 0) {
    // Render map (skip if a send is already in flight to avoid concurrent sends)
    let mapPixels: number[] | null = null
    if (!mapSendInFlight) {
      mapPixels = renderMapImage(currentRoute.geometry, coords, isLast ? null : nextLoc)
      mapSendInFlight = true
    }

    await updateNavDisplay(bridge, step, distToNext, currentRoute, activeStepIndex, mapPixels)
    mapSendInFlight = false
  }

  updateSpeedDisplay(pos.coords.speed)
}

// ── Glasses input ─────────────────────────────────────────────────────────────

function handleGlassesInput(event: EvenHubEvent) {
  if (!bridge || !currentRoute || !isNavigating) return

  const rawType = event.textEvent?.eventType ?? event.sysEvent?.eventType
  const total = currentRoute.steps.length

  if (rawType === OsEventTypeList.SCROLL_TOP_EVENT) {
    const maxPreview = total - 1 - activeStepIndex
    if (previewOffset < maxPreview) {
      previewOffset++
      const step = currentRoute.steps[activeStepIndex + previewOffset]
      showStepPreview(bridge, step, activeStepIndex + previewOffset + 1, total)
    }
    return
  }

  if (rawType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    if (previewOffset > 0) previewOffset--
    if (previewOffset === 0 && lastPosition) {
      const step = currentRoute.steps[activeStepIndex]
      const nextLoc = currentRoute.steps[activeStepIndex + 1]?.location ?? step.location
      const dist = haversineDistance(lastPosition, nextLoc)
      const mapPixels = renderMapImage(currentRoute.geometry, lastPosition, nextLoc)
      updateNavDisplay(bridge, step, dist, currentRoute, activeStepIndex, mapPixels)
    } else if (previewOffset > 0) {
      const step = currentRoute.steps[activeStepIndex + previewOffset]
      showStepPreview(bridge, step, activeStepIndex + previewOffset + 1, total)
    }
    return
  }

  if (rawType === OsEventTypeList.CLICK_EVENT) {
    previewOffset = 0
    if (lastPosition) {
      const step = currentRoute.steps[activeStepIndex]
      const nextLoc = currentRoute.steps[activeStepIndex + 1]?.location ?? step.location
      const dist = haversineDistance(lastPosition, nextLoc)
      const mapPixels = renderMapImage(currentRoute.geometry, lastPosition, nextLoc)
      updateNavDisplay(bridge, step, dist, currentRoute, activeStepIndex, mapPixels)
    }
    return
  }

  if (rawType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    recalculate(currentRoute.steps[currentRoute.steps.length - 1].location)
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
  const preview = document.getElementById('map-preview')
  if (preview) preview.classList.toggle('visible', active)
}

function updateSpeedDisplay(speedMs: number | null) {
  const el = document.getElementById('speed')
  if (!el) return
  el.textContent = speedMs != null && speedMs >= 0
    ? `${Math.round(speedMs * 3.6)} km/h`
    : '-- km/h'
}

boot().catch((err) => {
  console.error('Boot failed:', err)
  setStatus(`Error: ${err?.message ?? err}`)
})
