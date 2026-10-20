// The status record that builder writes for each /implement sub session, one
// JSON file per sub session in the status folder, and how foreman reads one.
//
// Builder's state contract will declare this record, as BuildStatus, with
// BuildStage and BuildState. Until the change that adds it there has merged,
// foreman declares the same types here under the same names. Once builder's
// contract has them, replace these declarations with an import of those three
// names from 'builder', as hooks/stages.ts imports StageId, and keep
// recordIn.

import { isStage, type StageId } from './stages'

// One of builder's nine stages.
export type BuildStage = StageId

// The states a sub session can be in, in the order the pane explains them.
export const STATES = ['working', 'waiting-on-builder', 'idle', 'needs-you', 'in-cleanup', 'done'] as const
export type BuildState = (typeof STATES)[number]

// The sub session's pull request: the repository as owner/name, its number,
// its state in words such as `open`, and its checks in words such as
// `passed`. Foreman does not draw the repository.
export type RecordPullRequest = { repo: string; number: number; state: string; checks: string }

// What a session has met since its cleanup began: how many calls failed, and
// the last error line, which is empty until a call fails.
export type RecordCleanup = { failedCalls: number; lastError: string }

export type BuildStatus = {
  sessionId: string
  // The ticket the parent gave the sub session, or null when it has none.
  ticket: string | null
  // The desktop app's id for the session, once builder knows it.
  desktopSessionId?: string
  // The folder the sub session works in, or null when the record has none.
  cwd: string | null
  // The issue's key, or null before the session's first progress report,
  // when the title is empty too.
  issueKey: string | null
  issueTitle: string
  // One of builder's nine stages, or null before the first stage report.
  stage: BuildStage | null
  // How many of the nine stages are done.
  stageDone: number
  pr: RecordPullRequest | null
  state: BuildState
  reason: string
  // When the state began and when the record was written, in milliseconds
  // since the epoch, or null when the record does not say.
  stateSince: number | null
  writtenAt: number | null
  // Present in any state once cleanup has started.
  cleanup?: RecordCleanup
}

const isState = (raw: unknown): raw is BuildState => typeof raw === 'string' && (STATES as readonly string[]).includes(raw)
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
  return { repo: textOr(p.repo, ''), number: p.number, state: filledOr(p.state, 'unknown'), checks: filledOr(p.checks, 'unknown') }
}

// The cleanup counts, or undefined when the record has none.
function cleanupIn(raw: unknown): RecordCleanup | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const c = raw as Record<string, unknown>
  const failed = typeof c.failedCalls === 'number' && Number.isFinite(c.failedCalls) ? Math.max(Math.floor(c.failedCalls), 0) : 0
  return { failedCalls: failed, lastError: textOr(c.lastError, '') }
}

// The record a file's text holds, or null when it does not parse. It parses
// only as a JSON object with a non-empty string `sessionId`, an `issueKey`
// that is null or a non-empty string, and one of the six states, because
// foreman cannot key, label or color a row without them. A missing issue key
// counts as not parsing, because builder always writes the field. Every other field falls back to a safe
// default when it is missing or of the wrong type. Strings are kept as
// written; whatever draws them cleans them first.
export function recordIn(text: string): BuildStatus | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.sessionId !== 'string' || r.sessionId === '') return null
  if (r.issueKey !== null && (typeof r.issueKey !== 'string' || r.issueKey.trim() === '')) return null
  if (!isState(r.state)) return null
  const desktopSessionId = filledOr(r.desktopSessionId, undefined)
  const cleanup = cleanupIn(r.cleanup)
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
    ...(cleanup === undefined ? {} : { cleanup }),
  }
}
