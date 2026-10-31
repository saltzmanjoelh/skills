// The status record that builder writes for each /implement sub session, one
// JSON file per sub session in the status folder, and how foreman reads one.
//
// Builder's state contract declares the record as BuildStatus, with
// BuildStage and BuildState. Foreman reads a file tolerantly, so the record
// it answers is builder's with the fields it may find missing or malformed
// loosened. SubRecord is derived from BuildStatus, so a field builder adds or
// renames reaches foreman's type check.

import type { BuildStage, BuildState, BuildStatus, BuildUsage, LastTurn, TokenCounts } from 'builder'

import type { ForemanCounts } from '../types'
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

// The oldest background task a sub session has in flight, as builder writes
// it: its description, which builder has already cleaned and may have
// withheld, when builder recorded it as started, and when it counts as
// probably hung. The hung time is null when the record's is not a finite
// number, which drops only the mark.
export type RecordOldestBackground = Omit<NonNullable<BuildStatus['oldestBackground']>, 'hungAt'> & { hungAt: number | null }

// A record as foreman reads it. The ticket, the folder and the two times may
// be null where builder always writes them, the oldest background task's hung
// time may be null too, and `version` is not read.
export type SubRecord = Omit<BuildStatus, 'version' | 'ticket' | 'cwd' | 'stateSince' | 'writtenAt' | 'pr' | 'oldestBackground' | 'usage'> & {
  // The ticket the parent gave the sub session, or null when it has none.
  ticket: string | null
  // The folder the sub session works in, or null when the record has none.
  cwd: string | null
  pr: RecordPullRequest | null
  // When the state began and when the record was written, in milliseconds
  // since the epoch, or null when the record does not say.
  stateSince: number | null
  writtenAt: number | null
  // The oldest background task in flight, with a hung time that may be null,
  // or absent when the record names none.
  oldestBackground?: RecordOldestBackground
  // What the sub session spent up to the write, or absent when the record
  // carries no spending that foreman can read.
  usage?: RecordUsage
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

// A wait on background work alone: when it began, and the descriptions of
// at most three of its tasks, which builder has already cleaned.
export type RecordBackgroundOnly = NonNullable<BuildStatus['backgroundOnly']>

// The most task descriptions kept from a background-only wait, as many as
// builder writes.
const TASKS_KEPT = 3

// The background-only wait, or undefined unless it has a finite `since`.
// Only the string tasks are kept, the first three. A `tasks` that is not a
// list reads as no tasks rather than as no wait, because `since` alone is
// what the ceiling counts from, and a wait foreman cannot name is still a
// wait.
export function backgroundOnlyIn(raw: unknown): RecordBackgroundOnly | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const b = raw as Record<string, unknown>
  const since = timeOr(b.since)
  if (since === null) return undefined
  const tasks = Array.isArray(b.tasks) ? b.tasks.filter((x): x is string => typeof x === 'string').slice(0, TASKS_KEPT) : []
  return { since, tasks }
}

// The oldest background task, or undefined when the value is missing, is not
// an object, is a list, or has a start that is not a finite number, because
// foreman cannot say how long a task has run without its start. A hung time
// that is not a finite number reads as null, so the row names the task
// without marking it, and a description that is not a string reads as the
// empty string. Any other field, such as a command, is not read.
export function oldestBackgroundIn(raw: unknown): RecordOldestBackground | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const startedAt = timeOr(o.startedAt)
  if (startedAt === null) return undefined
  return { description: textOr(o.description, ''), startedAt, hungAt: timeOr(o.hungAt) }
}

// The end of the sub session's last turn of its own, or undefined when the
// value is missing, is not an object, is a list, has an end that is not a
// finite number, or a nudge flag that is not a boolean, so a damaged one
// counts as today's record without it.
export function lastTurnIn(raw: unknown): LastTurn | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const l = raw as Record<string, unknown>
  const endedAt = timeOr(l.endedAt)
  if (endedAt === null || typeof l.answeredNudge !== 'boolean') return undefined
  return { endedAt, answeredNudge: l.answeredNudge }
}

// The spending a record carries, as foreman reads it: the tokens of each
// model in the four kinds, and the dollar total, or null when the sub session
// has no dollar reading yet. Foreman declares the shape itself, with its own
// counts, so the ledger's type stands alone.
export type RecordUsage = { models: (ForemanCounts & { model: string })[]; usd: number | null }

// These lines stop the type check when the counts or the spending foreman
// reads differ from builder's in either direction, so a kind of token that
// builder adds or renames cannot be dropped without a sound.
const COUNTS_MATCH_BUILDER: [ForemanCounts, TokenCounts] extends [TokenCounts, ForemanCounts] ? true : never = true
void COUNTS_MATCH_BUILDER
const USAGE_MATCHES_BUILDER: [RecordUsage, BuildUsage] extends [BuildUsage, RecordUsage] ? true : never = true
void USAGE_MATCHES_BUILDER

// Whether a value can be a count of tokens, a whole number of zero or more,
// and whether it can be a dollar figure, a finite number of zero or more. The
// ledger's reader checks the dollars it keeps by the second too.
const isTokenCount = (raw: unknown): raw is number => typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
export const isDollars = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw) && raw >= 0

// The four counts, or null unless every one is a count of tokens. Only the
// four are kept. The ledger's reader reads the counts it keeps through it too.
export function countsIn(raw: unknown): ForemanCounts | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  if (!isTokenCount(c.input) || !isTokenCount(c.output) || !isTokenCount(c.cacheRead) || !isTokenCount(c.cacheWrite)) return null
  return { input: c.input, output: c.output, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite }
}

// The spending, or undefined unless it is an object whose `models` is a list
// of models that each have a string name and four counts, and whose `usd` is a
// dollar figure or null. A record with one bad model reads as carrying no
// spending at all, because a total that left a model out would look smaller
// than it is, and foreman shows unknown rather than a figure that is wrong.
export function usageIn(raw: unknown): RecordUsage | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const { models: list, usd } = raw as Record<string, unknown>
  if (!Array.isArray(list) || (usd !== null && !isDollars(usd))) return undefined
  const models: RecordUsage['models'] = []
  for (const m of list) {
    const counts = countsIn(m)
    if (counts === null) return undefined
    const name = (m as Record<string, unknown>).model
    if (typeof name !== 'string') return undefined
    models.push({ model: name, ...counts })
  }
  return { models, usd }
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
  const backgroundOnly = backgroundOnlyIn(r.backgroundOnly)
  const oldestBackground = oldestBackgroundIn(r.oldestBackground)
  const lastTurn = lastTurnIn(r.lastTurn)
  const usage = usageIn(r.usage)
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
    ...(backgroundOnly === undefined ? {} : { backgroundOnly }),
    ...(oldestBackground === undefined ? {} : { oldestBackground }),
    ...(lastTurn === undefined ? {} : { lastTurn }),
    ...(usage === undefined ? {} : { usage }),
  }
}
