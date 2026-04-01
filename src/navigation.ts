// Geocoding via Nominatim (OpenStreetMap) — free, no API key required
// Routing via OSRM public API — free, no API key required, driving mode

export interface NavStep {
  instruction: string
  streetName: string
  distance: number    // metres to the END of this step
  maneuverType: string
  maneuverModifier: string
  location: [number, number]  // [lon, lat] at START of this step
}

export interface Route {
  steps: NavStep[]
  totalDistance: number  // metres
  totalDuration: number  // seconds
  geometry: [number, number][]  // [lon, lat] polyline of the full route
}

// ── Geocoding ────────────────────────────────────────────────────────────────

export async function geocodeAddress(address: string): Promise<[number, number]> {
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'G2CarNav/1.0' },
  })
  const data = await res.json()
  if (!data.length) throw new Error(`Address not found: "${address}"`)
  return [parseFloat(data[0].lon), parseFloat(data[0].lat)]
}

// ── Routing ──────────────────────────────────────────────────────────────────

export async function getDrivingRoute(
  from: [number, number],  // [lon, lat]
  to: [number, number],
): Promise<Route> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?steps=true&overview=simplified&geometries=geojson`

  const res = await fetch(url)
  const data = await res.json()
  if (data.code !== 'Ok') throw new Error(`Routing failed: ${data.message ?? data.code}`)

  const route = data.routes[0]
  const leg = route.legs[0]

  const steps: NavStep[] = leg.steps.map((s: OsrmStep) => ({
    instruction: buildInstruction(s),
    streetName: s.name || '',
    distance: s.distance,
    maneuverType: s.maneuver.type,
    maneuverModifier: s.maneuver.modifier ?? '',
    location: s.maneuver.location as [number, number],
  }))

  return {
    steps,
    totalDistance: route.distance,
    totalDuration: route.duration,
    geometry: (route.geometry as { coordinates: [number, number][] }).coordinates,
  }
}

// ── Distance calculation ─────────────────────────────────────────────────────

/** Haversine distance in metres between two [lon, lat] points */
export function haversineDistance(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.round(metres)} m`
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
  }
  return `${mins} min`
}

// ── Step advancement ──────────────────────────────────────────────────────────

const ADVANCE_THRESHOLD_M = 35  // advance step when within 35 m of next maneuver

/**
 * Returns the index of the step that should be active given current position.
 * Advances past any steps whose maneuver location we've already passed.
 */
export function resolveActiveStep(
  position: [number, number],
  steps: NavStep[],
  currentIndex: number,
): number {
  let idx = currentIndex
  while (idx < steps.length - 1) {
    const nextStepLocation = steps[idx + 1].location
    const dist = haversineDistance(position, nextStepLocation)
    if (dist <= ADVANCE_THRESHOLD_M) {
      idx++
    } else {
      break
    }
  }
  return idx
}

// ── Instruction builder ───────────────────────────────────────────────────────

function buildInstruction(step: OsrmStep): string {
  const { type, modifier = '' } = step.maneuver
  const name = step.name || ''
  const arrow = directionArrow(type, modifier)

  if (type === 'depart') return `${arrow}  DEPART\n${name}`
  if (type === 'arrive') return `${arrow}  ARRIVED\nat destination`

  const action = actionLabel(type, modifier)
  const onto = name ? `onto ${name}` : ''
  return `${arrow}  ${action}\n${onto}`.trimEnd()
}

function actionLabel(type: string, modifier: string): string {
  if (type === 'turn') {
    if (modifier === 'slight right') return 'SLIGHT RIGHT'
    if (modifier === 'right') return 'TURN RIGHT'
    if (modifier === 'sharp right') return 'SHARP RIGHT'
    if (modifier === 'slight left') return 'SLIGHT LEFT'
    if (modifier === 'left') return 'TURN LEFT'
    if (modifier === 'sharp left') return 'SHARP LEFT'
    if (modifier === 'uturn') return 'U-TURN'
    return 'CONTINUE'
  }
  if (type === 'continue') return 'CONTINUE'
  if (type === 'merge') return modifier ? `MERGE ${modifier.toUpperCase()}` : 'MERGE'
  if (type === 'on ramp') return 'TAKE RAMP'
  if (type === 'off ramp') return 'TAKE EXIT'
  if (type === 'fork') return modifier.includes('right') ? 'KEEP RIGHT' : 'KEEP LEFT'
  if (type === 'roundabout' || type === 'rotary') return 'TAKE ROUNDABOUT'
  if (type === 'end of road') return modifier.includes('right') ? 'TURN RIGHT' : 'TURN LEFT'
  return type.toUpperCase()
}

function directionArrow(type: string, modifier: string): string {
  if (type === 'arrive') return '[*]'
  if (type === 'depart') return '[D]'
  if (type === 'roundabout' || type === 'rotary') return '[O]'
  switch (modifier) {
    case 'straight': return '[^]'
    case 'slight right': return '[/]'
    case 'right': return '[>]'
    case 'sharp right': return '[>>]'
    case 'uturn': return '[U]'
    case 'sharp left': return '[<<]'
    case 'left': return '[<]'
    case 'slight left': return '[\\]'
    default: return '[^]'
  }
}

// ── OSRM response type (minimal) ─────────────────────────────────────────────

interface OsrmStep {
  distance: number
  duration: number
  name: string
  maneuver: {
    type: string
    modifier?: string
    location: [number, number]
  }
}
