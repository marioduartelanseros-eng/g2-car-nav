// Renders a schematic route map to 4-bit greyscale bytes for the G2 image container.
//
// Pixel encoding (4-bit greyscale, big-endian nibble packing):
//   Each byte holds two pixels: high nibble = left pixel, low nibble = right pixel.
//   Value 0 = black (transparent on glasses), 15 = brightest green.
//   Array length = ceil(width * height / 2) bytes.
//
// Canvas is rendered at full colour on the phone, then downsampled to 4-bit
// greyscale. A debug canvas element (id="map-debug") is updated if present.

export const MAP_W = 288  // SDK max: 288 px
export const MAP_H = 144  // SDK max: 144 px

// ── Public API ────────────────────────────────────────────────────────────────

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

  // Update debug canvas if present (phone preview)
  const debug = document.getElementById('map-debug') as HTMLCanvasElement | null
  if (debug) {
    debug.width = MAP_W
    debug.height = MAP_H
    const dctx = debug.getContext('2d')!
    dctx.drawImage(canvas, 0, 0)
  }

  return canvasToG2Nibbles(ctx, MAP_W, MAP_H)
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function drawMap(
  ctx: CanvasRenderingContext2D,
  geometry: [number, number][],
  position: [number, number],
  nextTurn: [number, number] | null,
) {
  const allPoints: [number, number][] = [
    ...geometry,
    position,
    ...(nextTurn ? [nextTurn] : []),
  ]
  const bounds = computeBounds(allPoints, 0.15)
  const project = (pt: [number, number]) => geoToPixel(pt, bounds, MAP_W, MAP_H)

  // Black background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, MAP_W, MAP_H)

  // Grid (faint — gives map texture feel)
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 1
  for (let x = 0; x < MAP_W; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_H); ctx.stroke()
  }
  for (let y = 0; y < MAP_H; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_W, y); ctx.stroke()
  }

  if (geometry.length >= 2) {
    const closestIdx = closestPointIndex(geometry, position)

    // Passed portion — dim
    if (closestIdx > 0) {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      const p0 = project(geometry[0])
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i <= closestIdx; i++) {
        const p = project(geometry[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    // Upcoming portion — bright
    ctx.beginPath()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const start = project(geometry[closestIdx])
    ctx.moveTo(start.x, start.y)
    for (let i = closestIdx + 1; i < geometry.length; i++) {
      const p = project(geometry[i])
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  // Next turn — hollow diamond
  if (nextTurn) {
    const nt = project(nextTurn)
    const s = 6
    ctx.beginPath()
    ctx.moveTo(nt.x, nt.y - s)
    ctx.lineTo(nt.x + s, nt.y)
    ctx.lineTo(nt.x, nt.y + s)
    ctx.lineTo(nt.x - s, nt.y)
    ctx.closePath()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // Current position — filled circle + crosshair
  const pos = project(position)
  const r = 6
  ctx.beginPath()
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()

  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pos.x - r - 5, pos.y); ctx.lineTo(pos.x - r, pos.y)
  ctx.moveTo(pos.x + r,     pos.y); ctx.lineTo(pos.x + r + 5, pos.y)
  ctx.moveTo(pos.x, pos.y - r - 5); ctx.lineTo(pos.x, pos.y - r)
  ctx.moveTo(pos.x, pos.y + r);     ctx.lineTo(pos.x, pos.y + r + 5)
  ctx.stroke()
}

// ── Geo helpers ───────────────────────────────────────────────────────────────

interface Bounds { minLon: number; maxLon: number; minLat: number; maxLat: number }

function computeBounds(points: [number, number][], pad: number): Bounds {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
  }
  const dLon = (maxLon - minLon) * pad || 0.001
  const dLat = (maxLat - minLat) * pad || 0.001
  return { minLon: minLon - dLon, maxLon: maxLon + dLon, minLat: minLat - dLat, maxLat: maxLat + dLat }
}

function geoToPixel([lon, lat]: [number, number], b: Bounds, w: number, h: number) {
  const x = (lon - b.minLon) / (b.maxLon - b.minLon) * w
  const mercY    = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
  const mercMin  = Math.log(Math.tan(Math.PI / 4 + b.minLat * Math.PI / 360))
  const mercMax  = Math.log(Math.tan(Math.PI / 4 + b.maxLat * Math.PI / 360))
  const y = h - (mercY - mercMin) / (mercMax - mercMin) * h
  return { x: Math.round(x), y: Math.round(y) }
}

function closestPointIndex(geo: [number, number][], pos: [number, number]): number {
  let best = 0, bestDist = Infinity
  for (let i = 0; i < geo.length; i++) {
    const d = (geo[i][0] - pos[0]) ** 2 + (geo[i][1] - pos[1]) ** 2
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

// ── 4-bit greyscale encoding ──────────────────────────────────────────────────

/**
 * Converts canvas pixels → packed 4-bit greyscale byte array for the G2.
 * Two pixels per byte: high nibble = pixel[i], low nibble = pixel[i+1].
 * Values: 0 = black, 15 = white (brightest green on device).
 */
function canvasToG2Nibbles(ctx: CanvasRenderingContext2D, w: number, h: number): number[] {
  const { data } = ctx.getImageData(0, 0, w, h)
  const total = w * h
  const out: number[] = []
  for (let i = 0; i < total; i += 2) {
    const hi = rgbaToNibble(data, i)
    const lo = i + 1 < total ? rgbaToNibble(data, i + 1) : 0
    out.push((hi << 4) | lo)
  }
  return out
}

function rgbaToNibble(data: Uint8ClampedArray, idx: number): number {
  const b = idx * 4
  const a = data[b + 3]
  if (a < 32) return 0
  const lum = 0.299 * data[b] + 0.587 * data[b + 1] + 0.114 * data[b + 2]
  return Math.min(15, Math.round((lum / 255) * 15))
}
