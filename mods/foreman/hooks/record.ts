// The status record that builder writes for each /implement sub session, one
// JSON file per sub session in the status folder, and how foreman reads one.
//
// Builder's state contract will declare this record. Until the change that
// adds it there has merged, foreman declares the same type here. Once
// builder's contract has it, replace these declarations with an import from
// 'builder', as hooks/stages.ts imports StageId, and keep recordIn.

import { isStage, type StageId } from './stages'

// The states a sub session can be in, in the order the pane explains them.
export const STATES = ['working', 'waiting-on-builder', 'idle', 'needs-you', 'in-cleanup', 'done'] as const
export type SubState = (typeof STATES)[number]

// The sub session's pull request: its number, its state in words such as
// `open`, and its checks in words such as `passed`.
export type RecordPullRequest = { number: number; state: string; checks: string }

// What a session in cleanup has met since cleanup began: how many calls
// failed, and the last error line.
export type RecordCleanup = { failedCalls: number; lastError: string }

export type StatusRecord = {
  sessionId: string
  // The ticket the parent gave the sub session, or null when it has none.
  ticket: string | null
  // The desktop app's id for the session, once builder knows it.
  desktopSessionId?: string
  // The folder the sub session works in, or null when the record has none.
  cwd: string | null
  issueKey: string
  issueTitle: string
  // One of builder's nine stages, or null before the first stage report.
  stage: StageId | null
  // How many of the nine stages are done.
  stageDone: number
  pr: RecordPullRequest | null
  state: SubState
  reason: string
  // When the state began and when the record was written, in milliseconds
  // since the epoch, or null when the record does not say.
  stateSince: number | null
  writtenAt: number | null
  // Present in the in-cleanup state only.
  cleanup?: RecordCleanup
}

const isState = (raw: unknown): raw is SubState => typeof raw === 'string' && (STATES as readonly string[]).includes(raw)
const textOr = <T>(raw: unknown, fallback: T): string | T => (typeof raw === 'string' ? raw : fallback)
const filledOr = <T>(raw: unknown, fallback: T): string | T => (typeof raw === 'string' && raw.trim() !== '' ? raw : fallback)
const timeOr = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null)

// The stages done, as a whole number held between 0 and 9.
function stagesDone(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.min(Math.max(Math.floor(raw), 0), 9)
}

// The pull request, or null unless it has a positive whole number.
function pullRequestIn(raw: unknown): RecordPullRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (typeof p.number !== 'number' || !Number.isInteger(p.number) || p.number <= 0) return null
  return { number: p.number, state: filledOr(p.state, 'unknown'), checks: filledOr(p.checks, 'unknown') }
}

function cleanupIn(raw: unknown): RecordCleanup {
  const c = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const failed = typeof c.failedCalls === 'number' && Number.isFinite(c.failedCalls) ? Math.max(Math.floor(c.failedCalls), 0) : 0
  return { failedCalls: failed, lastError: textOr(c.lastError, '') }
}

// The record a file's text holds, or null when it does not parse. It parses
// only as a JSON object with a non-empty string `sessionId`, a non-empty
// string `issueKey` and one of the six states, because foreman cannot key,
// label or color a row without them. Every other field falls back to a safe
// default when it is missing or of the wrong type. Strings are kept as
// written; whatever draws them cleans them first.
export function recordIn(text: string): StatusRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.sessionId !== 'string' || r.sessionId === '') return null
  if (typeof r.issueKey !== 'string' || r.issueKey.trim() === '') return null
  if (!isState(r.state)) return null
  const desktopSessionId = filledOr(r.desktopSessionId, undefined)
  return {
    sessionId: r.sessionId,
    ticket: textOr(r.ticket, null),
    ...(desktopSessionId === undefined ? {} : { desktopSessionId }),
    cwd: filledOr(r.cwd, null),
    issueKey: r.issueKey,
    issueTitle: textOr(r.issueTitle, ''),
    stage: isStage(r.stage) ? r.stage : null,
    stageDone: stagesDone(r.stageDone),
    pr: pullRequestIn(r.pr),
    state: r.state,
    reason: textOr(r.reason, ''),
    stateSince: timeOr(r.stateSince),
    writtenAt: timeOr(r.writtenAt),
    ...(r.state === 'in-cleanup' ? { cleanup: cleanupIn(r.cleanup) } : {}),
  }
}
