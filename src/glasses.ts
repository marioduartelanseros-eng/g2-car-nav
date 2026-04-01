import { TextContainerProperty } from '@evenrealities/even_hub_sdk'
import type { NavStep, Route } from './navigation'
import { formatDistance, formatDuration } from './navigation'

// Container IDs (must be unique per page)
const NAV_CONTAINER_ID = 1
const STATUS_CONTAINER_ID = 2

// Page ID
const PAGE_ID = 1

// Display dimensions
const W = 576
const H = 288
const NAV_HEIGHT = 228
const STATUS_HEIGHT = 52
const STATUS_Y = 236

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates the initial page layout on the glasses.
 * Call once after connecting the bridge.
 */
export async function initDisplay(bridge: EvenBridge, message = 'G2 Car Nav\nReady'): Promise<void> {
  const navContainer = makeNavContainer(message)
  const statusContainer = makeStatusContainer('Waiting for GPS...')
  await bridge.createStartUpPageContainer(PAGE_ID, [navContainer, statusContainer])
}

/**
 * Updates the glasses display for the current navigation step.
 */
export async function updateNavDisplay(
  bridge: EvenBridge,
  step: NavStep,
  distanceToStep: number,
  route: Route,
  stepIndex: number,
): Promise<void> {
  const isLast = stepIndex >= route.steps.length - 1

  const navText = buildNavText(step, distanceToStep, isLast)
  const statusText = buildStatusText(route, stepIndex, distanceToStep)

  await bridge.textContainerUpgrade(NAV_CONTAINER_ID, 'nav', navText, 0, 0)
  await bridge.textContainerUpgrade(STATUS_CONTAINER_ID, 'status', statusText, 0, 0)
}

/**
 * Shows a full-screen message (e.g. "Calculating...", "Arrived!").
 */
export async function showMessage(bridge: EvenBridge, title: string, body = ''): Promise<void> {
  const text = body ? `${title}\n\n${body}` : title
  await bridge.textContainerUpgrade(NAV_CONTAINER_ID, 'nav', text, 0, 0)
  await bridge.textContainerUpgrade(STATUS_CONTAINER_ID, 'status', '', 0, 0)
}

/**
 * Shows a preview of an upcoming step (swipe gesture).
 */
export async function showStepPreview(
  bridge: EvenBridge,
  step: NavStep,
  stepNumber: number,
  total: number,
): Promise<void> {
  const text =
    `[Step ${stepNumber}/${total}]\n` +
    `${step.instruction}\n\n` +
    `(${formatDistance(step.distance)})`
  await bridge.textContainerUpgrade(NAV_CONTAINER_ID, 'nav', text, 0, 0)
}

// ── Layout builders ───────────────────────────────────────────────────────────

function makeNavContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: NAV_HEIGHT,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 8,
    containerID: NAV_CONTAINER_ID,
    containerName: 'nav',
    content,
    isEventCapture: 1,
  })
}

function makeStatusContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: STATUS_Y,
    width: W,
    height: STATUS_HEIGHT,
    borderWidth: 1,
    borderColor: 6,
    paddingLength: 6,
    containerID: STATUS_CONTAINER_ID,
    containerName: 'status',
    content,
    isEventCapture: 0,
  })
}

// ── Text formatters ───────────────────────────────────────────────────────────

function buildNavText(step: NavStep, distanceToStep: number, isLast: boolean): string {
  if (isLast) {
    return `[*]  ARRIVED\n\nat your destination`
  }

  const dist = formatDistance(distanceToStep)

  // instruction already contains arrow + action + street name lines
  return `${step.instruction}\n\nin ${dist}`
}

function buildStatusText(route: Route, stepIndex: number, distToCurrentStep: number): string {
  // Remaining distance = distance from user to end of current step + all remaining steps
  const stepsAhead = route.steps.slice(stepIndex + 1)
  const remainingAfterCurrent = stepsAhead.reduce((sum, s) => sum + s.distance, 0)
  const remaining = distToCurrentStep + remainingAfterCurrent

  // Recalculate ETA: estimate using average driving speed proportional to remaining distance
  // Use the ratio of remaining vs total distance applied to total duration
  const etaSeconds = (remaining / route.totalDistance) * route.totalDuration

  return `${formatDistance(remaining)} left  |  ETA ${formatDuration(etaSeconds)}`
}

// ── Bridge type shim ──────────────────────────────────────────────────────────
// The Even Hub SDK injects this bridge; we declare a minimal interface here
// so TypeScript is happy without needing the full SDK type declarations.

export interface EvenBridge {
  createStartUpPageContainer(pageId: number, containers: TextContainerProperty[]): Promise<number>
  textContainerUpgrade(
    containerId: number,
    containerName: string,
    content: string,
    contentOffset: number,
    contentLength: number,
  ): Promise<number>
  onEvenHubEvent(
    callback: (eventType: number | undefined, eventValue: unknown) => void,
  ): void
}
