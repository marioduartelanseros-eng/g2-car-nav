import {
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { NavStep, Route } from './navigation'
import { formatDistance, formatDuration } from './navigation'

export type { EvenAppBridge, EvenHubEvent }
export { OsEventTypeList }

// Container IDs
const NAV_ID = 1
const STATUS_ID = 2

// Display dimensions
const W = 576
const H = 288
const NAV_H = 230
const STATUS_Y = 238
const STATUS_H = 50

// ── Public API ────────────────────────────────────────────────────────────────

export async function initDisplay(bridge: EvenAppBridge, message = 'G2 Car Nav\nReady'): Promise<void> {
  const navContainer = makeTextContainer(NAV_ID, 'nav', message, W, NAV_H, 0, 0, true)
  const statusContainer = makeTextContainer(STATUS_ID, 'status', 'Waiting for GPS...', W, STATUS_H, 0, STATUS_Y, false)

  const page = new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [navContainer, statusContainer],
  })

  const result = await bridge.createStartUpPageContainer(page)
  if (result !== 0) {
    console.warn('[G2] createStartUpPageContainer returned', result)
  }
}

export async function updateNavDisplay(
  bridge: EvenAppBridge,
  step: NavStep,
  distanceToStep: number,
  route: Route,
  stepIndex: number,
): Promise<void> {
  const isLast = stepIndex >= route.steps.length - 1
  const navText = buildNavText(step, distanceToStep, isLast)
  const statusText = buildStatusText(route, stepIndex, distanceToStep)

  await Promise.all([
    updateText(bridge, NAV_ID, 'nav', navText),
    updateText(bridge, STATUS_ID, 'status', statusText),
  ])
}

export async function showMessage(bridge: EvenAppBridge, title: string, body = ''): Promise<void> {
  const text = body ? `${title}\n\n${body}` : title
  await Promise.all([
    updateText(bridge, NAV_ID, 'nav', text),
    updateText(bridge, STATUS_ID, 'status', ''),
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
  await updateText(bridge, NAV_ID, 'nav', text)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTextContainer(
  id: number,
  name: string,
  content: string,
  width: number,
  height: number,
  x: number,
  y: number,
  isEventCapture: boolean,
): TextContainerProperty {
  return new TextContainerProperty({
    containerID: id,
    containerName: name,
    content,
    xPosition: x,
    yPosition: y,
    width,
    height,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 8,
    isEventCapture: isEventCapture ? 1 : 0,
  })
}

async function updateText(
  bridge: EvenAppBridge,
  containerID: number,
  containerName: string,
  content: string,
): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID, containerName, content, contentOffset: 0, contentLength: 0 })
  )
}

// ── Text formatters ───────────────────────────────────────────────────────────

function buildNavText(step: NavStep, distanceToStep: number, isLast: boolean): string {
  if (isLast) return `[*]  ARRIVED\n\nat your destination`
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
