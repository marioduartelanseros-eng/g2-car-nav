import {
  TextContainerProperty,
  ImageContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  ImageRawDataUpdate,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { NavStep, Route } from './navigation'
import { formatDistance, formatDuration } from './navigation'
import { MAP_W, MAP_H } from './map-renderer'

export type { EvenAppBridge, EvenHubEvent }
export { OsEventTypeList }

// ── Display layout ────────────────────────────────────────────────────────────
//
//  ┌─────────────────────────────────────┬──────────────────────┐
//  │  Nav text (instruction + distance)  │                      │
//  │  270 × 230 px                       │   Map  288 × 112 px  │
//  │                                     │   x=288, y=58        │
//  ├─────────────────────────────────────┴──────────────────────┤
//  │  Status bar  (distance + ETA)   576 × 50                   │
//  └────────────────────────────────────────────────────────────┘
//   Total: 576 × 288

const TEXT_W = 270
const TEXT_H = 230
const STATUS_W = 576
const STATUS_H = 50
const STATUS_Y = 238
const MAP_X = 288
const MAP_Y = Math.round((TEXT_H - MAP_H) / 2)  // vertically centered in text area

// Container IDs
const ID_NAV    = 1
const ID_STATUS = 2
const ID_MAP    = 3

// ── Public API ────────────────────────────────────────────────────────────────

export async function initDisplay(bridge: EvenAppBridge, message = 'G2 Car Nav\nReady'): Promise<void> {
  const navContainer = makeText(ID_NAV, 'nav', message, TEXT_W, TEXT_H, 0, 0, true)
  const statusContainer = makeText(ID_STATUS, 'status', 'Waiting for GPS...', STATUS_W, STATUS_H, 0, STATUS_Y, false)
  const mapContainer = makeImageContainer(ID_MAP, 'map', MAP_X, MAP_Y)

  const page = new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [navContainer, statusContainer],
    imageObject: [mapContainer],
  })

  const result = await bridge.createStartUpPageContainer(page)
  if (result !== 0) console.warn('[G2] createStartUpPageContainer returned', result)
}

export async function updateNavDisplay(
  bridge: EvenAppBridge,
  step: NavStep,
  distanceToStep: number,
  route: Route,
  stepIndex: number,
  mapPixels: number[] | null,
): Promise<void> {
  const isLast = stepIndex >= route.steps.length - 1
  const navText = buildNavText(step, distanceToStep, isLast)
  const statusText = buildStatusText(route, stepIndex, distanceToStep)

  const updates: Promise<unknown>[] = [
    updateText(bridge, ID_NAV, 'nav', navText),
    updateText(bridge, ID_STATUS, 'status', statusText),
  ]

  if (mapPixels) {
    updates.push(sendMapImage(bridge, mapPixels))
  }

  await Promise.all(updates)
}

export async function showMessage(bridge: EvenAppBridge, title: string, body = ''): Promise<void> {
  const text = body ? `${title}\n\n${body}` : title
  await Promise.all([
    updateText(bridge, ID_NAV, 'nav', text),
    updateText(bridge, ID_STATUS, 'status', ''),
  ])
}

export async function showStepPreview(
  bridge: EvenAppBridge,
  step: NavStep,
  stepNumber: number,
  total: number,
): Promise<void> {
  const text =
    `[Step ${stepNumber}/${total}]\n` +
    `${step.instruction}\n\n` +
    `(${formatDistance(step.distance)})`
  await updateText(bridge, ID_NAV, 'nav', text)
}

export async function sendMapImage(bridge: EvenAppBridge, pixels: number[]): Promise<void> {
  await bridge.updateImageRawData(
    new ImageRawDataUpdate({ containerID: ID_MAP, containerName: 'map', imageData: pixels })
  )
}

// ── Container factories ───────────────────────────────────────────────────────

function makeText(
  id: number, name: string, content: string,
  width: number, height: number, x: number, y: number,
  isEventCapture: boolean,
): TextContainerProperty {
  return new TextContainerProperty({
    containerID: id, containerName: name, content,
    xPosition: x, yPosition: y, width, height,
    borderWidth: 0, borderColor: 8, paddingLength: 6,
    isEventCapture: isEventCapture ? 1 : 0,
  })
}

function makeImageContainer(id: number, name: string, x: number, y: number): ImageContainerProperty {
  return new ImageContainerProperty({
    containerID: id, containerName: name,
    xPosition: x, yPosition: y,
    width: MAP_W, height: MAP_H,
  })
}

// ── Text helpers ──────────────────────────────────────────────────────────────

async function updateText(
  bridge: EvenAppBridge, containerID: number, containerName: string, content: string,
): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID, containerName, content, contentOffset: 0, contentLength: 0 })
  )
}

function buildNavText(step: NavStep, distanceToStep: number, isLast: boolean): string {
  if (isLast) return `[*]  ARRIVED\n\nat your\ndestination`
  return `${step.instruction}\n\nin ${formatDistance(distanceToStep)}`
}

function buildStatusText(route: Route, stepIndex: number, distToCurrentStep: number): string {
  const remainingAfterCurrent = route.steps
    .slice(stepIndex + 1)
    .reduce((sum, s) => sum + s.distance, 0)
  const remaining = distToCurrentStep + remainingAfterCurrent
  const etaSeconds = (remaining / route.totalDistance) * route.totalDuration
  return `${formatDistance(remaining)} left  |  ETA ${formatDuration(etaSeconds)}`
}
