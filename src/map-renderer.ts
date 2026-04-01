// Renders a schematic route map onto an offscreen canvas,
// then converts it to the 4-bit greyscale number[] format the G2 expects.
//
// Canvas layout:
//   - Black background
//   - Dim grey grid lines (street feel)
//   - White route polyline (full route, slightly dimmed ahead of current pos)
//   - Bright white current-position dot with crosshair
//   - Green-tinted (bright) next-maneuver marker triangle
//
// Pixel encoding: 4-bit greyscale, two pixels per byte, high nibble first.
// A value of 0 = transparent/black, 15 = white (brightest green on glasses).

export const MAP_W = 288  // max image container width allowed by SDK
export const MAP_H = 112  // fits within the 144 px max height

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Renders the route map and returns the 4-bit greyscale pixel array.
 *
 * @param geometry   Full route polyline as [lon, lat] pairs
 * @param position   Current GPS position [lon, lat]
 * @param nextTurn   Location of the next maneuver [lon, lat]
 */
export function renderMapImage(
  geometry: [number, number][],
  position: [number, number],
  nextTurn: [number, number] | null,
): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = MAP_W
  canvas.height = MAP_H
  const ctx = canvas.getContext('2d')!

  drawMap(ctx, geometry, position, nextTurn)

  return canvasToG2Nibbles(ctx, MAP_W, MAP_H)
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function drawMap(
  ctx: CanvasRenderingContext2D,
  geometry: [number, number][],
  position: [number, number],
  nextTurn: [number, number] | null,
) {
  // Compute bounds with some padding so the route isn't edge-to-edge
  const bounds = computeBounds([...geometry, position, ...(nextTurn ? [nextTurn] : [])], 0.15)

  const project = (lonLat: [number, number]) => geoToPixel(lonLat, bounds, MAP_W, MAP_H)

  // Background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, MAP_W, MAP_H)

  // Subtle grid (gives street-map texture feel on the G2's green display)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  const gridSpacing = 28
  for (let x = 0; x < MAP_W; x += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke()
  }
  for (let y = 0; y < MAP_H; y += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke()
  }

  // Route polyline — dim for the already-passed section, bright ahead
  const closestIdx = closestPointIndex(geometry, position)
  if (geometry.length >= 2) {
    // Passed portion
    if (closestIdx > 0) {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      const p0 = project(geometry[0])
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i <= closestIdx; i++) {
        const p = project(geometry[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    // Upcoming portion
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    const start = project(geometry[closestIdx])
    ctx.moveTo(start.x, start.y)
    for (let i = closestIdx + 1; i < geometry.length; i++) {
      const p = project(geometry[i])
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  // Next turn marker — hollow diamond
  if (nextTurn) {
    const nt = project(nextTurn)
    const s = 5
    ctx.beginPath()
    ctx.moveTo(nt.x, nt.y - s)
    ctx.lineTo(nt.x + s, nt.y)
    ctx.lineTo(nt.x, nt.y + s)
    ctx.lineTo(nt.x - s, nt.y)
    ctx.closePath()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Current position — filled circle + crosshair
  const pos = project(position)
  const r = 5
  ctx.beginPath()
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()

  // Crosshair lines
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pos.x - r - 4, pos.y); ctx.lineTo(pos.x - r, pos.y)
  ctx.moveTo(pos.x + r, pos.y);     ctx.lineTo(pos.x + r + 4, pos.y)
  ctx.moveTo(pos.x, pos.y - r - 4); ctx.lineTo(pos.x, pos.y - r)
  ctx.moveTo(pos.x, pos.y + r);     ctx.lineTo(pos.x, pos.y + r + 4)
  ctx.stroke()
}

// ── Geo projection ────────────────────────────────────────────────────────────

interface Bounds {
  minLon: number; maxLon: number
  minLat: number; maxLat: number
}

function computeBounds(points: [number, number][], paddingFraction: number): Bounds {
  let minLon = Infinity, maxLon = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  const padLon = (maxLon - minLon) * paddingFraction || 0.001
  const padLat = (maxLat - minLat) * paddingFraction || 0.001
  return {
    minLon: minLon - padLon, maxLon: maxLon + padLon,
    minLat: minLat - padLat, maxLat: maxLat + padLat,
  }
}

function geoToPixel(
  [lon, lat]: [number, number],
  bounds: Bounds,
  width: number,
  height: number,
): { x: number; y: number } {
  const x = (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon) * width
  // Mercator Y (flip so north is up)
  const mercY = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  const mercMin = Math.log(Math.tan(Math.PI / 4 + (bounds.minLat * Math.PI) / 360))
  const mercMax = Math.log(Math.tan(Math.PI / 4 + (bounds.maxLat * Math.PI) / 360))
  const y = height - (mercY - mercMin) / (mercMax - mercMin) * height
  return { x: Math.round(x), y: Math.round(y) }
}

/** Returns the index of the geometry point closest to `position`. */
function closestPointIndex(geometry: [number, number][], position: [number, number]): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < geometry.length; i++) {
    const dx = geometry[i][0] - position[0]
    const dy = geometry[i][1] - position[1]
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

// ── 4-bit greyscale encoding ──────────────────────────────────────────────────

/**
 * Converts the canvas pixels to a 4-bit greyscale number[] for the G2.
 * Two pixels are packed per byte: high nibble = left pixel, low nibble = right pixel.
 * Pixel brightness 0 = black, 15 = white (brightest green on device).
 */
function canvasToG2Nibbles(ctx: CanvasRenderingContext2D, w: number, h: number): number[] {
  const imageData = ctx.getImageData(0, 0, w, h)
  const rgba = imageData.data
  const out: number[] = []
  const total = w * h

  for (let i = 0; i < total; i += 2) {
    const hi = rgbaToNibble(rgba, i)
    const lo = i + 1 < total ? rgbaToNibble(rgba, i + 1) : 0
    out.push((hi << 4) | lo)
  }
  return out
}

function rgbaToNibble(rgba: Uint8ClampedArray, pixelIndex: number): number {
  const base = pixelIndex * 4
  const r = rgba[base], g = rgba[base + 1], b = rgba[base + 2], a = rgba[base + 3]
  if (a < 32) return 0
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return Math.round((lum / 255) * 15)
}
