// The status record that builder writes for each /implement sub session, one
// JSON file per sub session in the status folder, and how foreman reads one.
//
// Builder's state contract declares the record as BuildStatus, with
// BuildStage and BuildState. Foreman reads a file tolerantly, so the record
// it answers is builder's with the fields it may find missing or malformed
// loosened. SubRecord is derived from BuildStatus, so a field builder adds or
// renames reaches foreman's type check.

import type { BuildStage, BuildState, BuildStatus } from 'builder'

import { isStage, STAGES } from './stages'

export type { BuildStage, BuildState }

// The states a sub session can be in. STATE_LOOK in hooks/subs.ts gives each
// one its words and its color.
export const STATES = ['working', 'waiting-on-builder', 'idle', 'needs-you', 'in-cleanup', 'done'] as const

// This line stops the type check when foreman's list of states and builder's
// differ in either direction, as the one in hooks/stages.ts does for stages.
const STATES_MATCH_BUILDER: [(typeof STATES)[number], BuildState] extends [BuildState, (typeof STATES)[number]] ? true : never = true
void STATES_MATCH_BUILDER

// The sub session's pull request: the repository as owner/name, its number,
// its state in words such as `OPEN`, its checks in words such as `passed`,
// and the newest verdict pair at its head, or null. Foreman does not draw the
// repository. The state and the checks are kept as any text a file holds.
export type RecordPullRequest = Omit<NonNullable<BuildStatus['pr']>, 'state' | 'checks'> & { state: string; checks: string }

// A verdict pair as builder writes it: the head's commit id and the two
// verdicts.
export type RecordVerdicts = NonNullable<RecordPullRequest['verdicts']>

// What a session has met since its cleanup began: how many calls failed, and
// the last error line, which is empty until a call fails.
export type RecordCleanup = NonNullable<BuildStatus['cleanup']>

// A record as foreman reads it. The ticket, the folder and the two times may
// be null where builder always writes them, and `version` is not read.
export type SubRecord = Omit<BuildStatus, 'version' | 'ticket' | 'cwd' | 'stateSince' | 'writtenAt' | 'pr'> & {
  // The ticket the parent gave the sub session, or null when it has none.
  ticket: string | null
  // The folder the sub session works in, or null when the record has none.
  cwd: string | null
  pr: RecordPullRequest | null
  // When the state began and when the record was written, in milliseconds
  // since the epoch, or null when the record does not say.
  stateSince: number | null
  writtenAt: number | null
}

const isState = (raw: unknown): raw is BuildState => typeof raw === 'string' && (STATES as readonly string[]).includes(raw)
const textOr = <T>(raw: unknown, fallback: T): string | T => (typeof raw === 'string' ? raw : fallback)
const filledOr = <T>(raw: unknown, fallback: T): string | T => (typeof raw === 'string' && raw.trim() !== '' ? raw : fallback)
const timeOr = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null)

// The stages done, as a whole number held between 0 and the number of
// stages.
function stagesDone(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.min(Math.max(Math.floor(raw), 0), STAGES.length)
}

// The two verdicts a verdict review can give.
const VERDICT_WORDS = ['APPROVE', 'REQUEST_CHANGES'] as const

// This line stops the type check when foreman's list of verdicts and
// builder's differ in either direction, so that a new verdict word cannot
// make the reader drop every pair without a sound.
const VERDICTS_MATCH_BUILDER: [(typeof VERDICT_WORDS)[number], RecordVerdicts['spec']] extends [RecordVerdicts['spec'], (typeof VERDICT_WORDS)[number]] ? true : never = true
void VERDICTS_MATCH_BUILDER

const isVerdict = (raw: unknown): raw is RecordVerdicts['spec'] => typeof raw === 'string' && (VERDICT_WORDS as readonly string[]).includes(raw)

// A verdict pair, or null unless its sha is 7 to 40 lowercase hexadecimal
// characters and both verdicts are APPROVE or REQUEST_CHANGES. A record from
// a builder that wrote no pair reads as having none. The ledger reads the
// pairs it remembers through it too.
export function verdictsIn(raw: unknown): RecordVerdicts | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (typeof v.sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(v.sha) || !isVerdict(v.spec) || !isVerdict(v.adversarial)) return null
  return { sha: v.sha, spec: v.spec, adversarial: v.adversarial }
}

// Whether a value can be a pull request's number: a positive whole number.
// The ledger's reader checks the numbers it remembers by it too.
export const isPullRequestNumber = (raw: unknown): raw is number => typeof raw === 'number' && Number.isInteger(raw) && raw > 0

// The pull request, or null unless it has a positive whole number.
function pullRequestIn(raw: unknown): RecordPullRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (!isPullRequestNumber(p.number)) return null
  return {
    repo: textOr(p.repo, ''), number: p.number, state: filledOr(p.state, 'unknown'), checks: filledOr(p.checks, 'unknown'), verdicts: verdictsIn(p.verdicts),
  }
}

// One of the three states GitHub gives a pull request.
export type PullRequestState = NonNullable<BuildStatus['pr']>['state']

// The three states, which prStateOf and the ledger's reader both check
// against.
export const PR_STATES = ['OPEN', 'MERGED', 'CLOSED'] as const

// This line stops the type check when foreman's list of pull request states
// and builder's differ in either direction, as STATES_MATCH_BUILDER does for
// the sub session's states.
const PR_STATES_MATCH_BUILDER: [(typeof PR_STATES)[number], PullRequestState] extends [PullRequestState, (typeof PR_STATES)[number]] ? true : never = true
void PR_STATES_MATCH_BUILDER

// Whether a value is one of the three states, in capitals.
export const isPullRequestState = (raw: unknown): raw is PullRequestState => typeof raw === 'string' && (PR_STATES as readonly string[]).includes(raw)

// The pull request's state as one of the three, whatever the case of its
// text, or null when there is no pull request or its state is any other
// text, such as the reader's `unknown`, so that a state foreman cannot read
// changes nothing.
export function prStateOf(pr: RecordPullRequest | null): PullRequestState | null {
  const state = pr?.state.toUpperCase()
  return isPullRequestState(state) ? state : null
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
export function recordIn(text: string): SubRecord | null {
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
