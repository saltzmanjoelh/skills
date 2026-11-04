// The rules for recording how long the session's issue takes: when builder
// started in the session, when each /implement stage was first reached, when
// the pull request opened and merged, how long each review round took, and
// how the elapsed time divides among the status states. Every function is
// pure; hooks/register.tsx runs them inside its state writes, with a stamp of
// the engine's clock, and stores the record they give back. A change that
// changes nothing gives back the very record it was handed, so the caller can
// tell that nothing needs to be written, and a rerun of the same change, or a
// second copy of the hooks applying it, counts nothing twice.

import type { BuildRound, BuildRoundEnd, BuildStageStamp, BuildState, BuildTiming, StageId, TimingLedger } from '../types'
import { STAGES, stageLabel } from './progress'
import { clockTime, timeOfDay } from './text'

// How many review rounds the record keeps. Older ones are only counted.
export const ROUNDS_KEPT = 20

// What a watch saw of a pull request, as afterPr takes it.
export type PullRequestSeen = { repo: string; number: number; state: 'OPEN' | 'MERGED' | 'CLOSED' }

// The status states, in the order the record's totals list them, and the
// ways a round can end. The contract in types/index.d.ts spells both out
// again, so the two lines after them stop the type check when a list and the
// contract differ in either direction.
const STATES = ['working', 'waiting-on-builder', 'idle', 'needs-you', 'in-cleanup', 'done'] as const
const ENDS = ['reviewed', 'superseded', 'carried-over'] as const
const STATES_MATCH_THE_CONTRACT: [(typeof STATES)[number], BuildState] extends [BuildState, (typeof STATES)[number]] ? true : never = true
const ENDS_MATCH_THE_CONTRACT: [(typeof ENDS)[number], BuildRoundEnd] extends [BuildRoundEnd, (typeof ENDS)[number]] ? true : never = true
void STATES_MATCH_THE_CONTRACT
void ENDS_MATCH_THE_CONTRACT
const STAGE_IDS: readonly string[] = STAGES.map(stage => stage.id)

const isTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isTotal = (n: unknown): n is number => isTime(n) && n >= 0
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
const isTimeOrNull = (n: unknown): n is number | null => n === null || isTime(n)
const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw)

// A duration from `from` to `to`, never below zero, so a clock that goes back
// never makes a total fall.
const span = (from: number, to: number) => Math.max(0, to - from)

function stageIn(raw: unknown): BuildStageStamp | null {
  if (!isRecord(raw) || typeof raw.stage !== 'string' || !STAGE_IDS.includes(raw.stage) || !isTime(raw.at)) return null
  return { stage: raw.stage as StageId, at: raw.at }
}

// A round, read only when its end and the manner of its end are both there
// or both missing.
function roundIn(raw: unknown): BuildRound | null {
  if (!isRecord(raw) || typeof raw.head !== 'string' || !isTime(raw.startedAt) || !isTimeOrNull(raw.endedAt)) return null
  const ended = raw.ended
  // An open round has neither an end stamp nor a manner of ending.
  if (ended === null) return raw.endedAt === null ? { head: raw.head, startedAt: raw.startedAt, endedAt: null, ended: null } : null
  // A closed round has both.
  if (!ENDS.includes(ended as BuildRoundEnd) || raw.endedAt === null) return null
  return { head: raw.head, startedAt: raw.startedAt, endedAt: raw.endedAt, ended: ended as BuildRoundEnd }
}

function listIn<T>(raw: unknown, entryIn: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null
  const entries: T[] = []
  for (const entry of raw as unknown[]) {
    const read = entryIn(entry)
    if (read === null) return null
    entries.push(read)
  }
  return entries
}

function statesIn(raw: unknown): Record<BuildState, number> | null {
  if (!isRecord(raw)) return null
  const states = {} as Record<BuildState, number>
  for (const state of STATES) {
    const total = raw[state]
    if (!isTotal(total)) return null
    states[state] = total
  }
  return states
}

function pullRequestIn(raw: unknown): TimingLedger['pr'] | undefined {
  if (raw === null) return null
  if (!isRecord(raw) || typeof raw.repo !== 'string' || !isCount(raw.number)) return undefined
  return { repo: raw.repo, number: raw.number }
}

// The record a stored or held value holds for `sessionId`, or null when the
// value is damaged in any part or was kept for another session, so a damaged
// record starts the timing again rather than failing.
export function timingIn(raw: unknown, sessionId: string): TimingLedger | null {
  if (!isRecord(raw) || raw.sessionId !== sessionId) return null
  const stages = listIn(raw.stages, stageIn)
  const rounds = listIn(raw.rounds, roundIn)
  const states = statesIn(raw.states)
  const pr = pullRequestIn(raw.pr)
  if (stages === null || rounds === null || states === null || pr === undefined) return null
  if (!(raw.title === null || typeof raw.title === 'string')) return null
  if (!(raw.state === null || STATES.includes(raw.state as BuildState))) return null
  if (!isTime(raw.startedAt) || !isTime(raw.stateSince) || !isTime(raw.at) || !isCount(raw.olderRounds)) return null
  if (!isTimeOrNull(raw.prOpenedAt) || !isTimeOrNull(raw.prMergedAt)) return null
  return {
    sessionId,
    startedAt: raw.startedAt,
    title: raw.title,
    stages,
    pr,
    prOpenedAt: raw.prOpenedAt,
    prMergedAt: raw.prMergedAt,
    state: raw.state as BuildState | null,
    stateSince: raw.stateSince,
    states,
    rounds,
    olderRounds: raw.olderRounds,
    at: raw.at,
  }
}

// A record that starts at `now`, with nothing stamped and no state open.
export function emptyTiming(sessionId: string, now: number): TimingLedger {
  return {
    sessionId,
    startedAt: now,
    title: null,
    stages: [],
    pr: null,
    prOpenedAt: null,
    prMergedAt: null,
    state: null,
    stateSince: now,
    states: { working: 0, 'waiting-on-builder': 0, idle: 0, 'needs-you': 0, 'in-cleanup': 0, done: 0 },
    rounds: [],
    olderRounds: 0,
    at: now,
  }
}

// The record after a stage was reached under `title`. A title that differs
// from the stored one starts a new set of stages, as the progress bar does.
// A stage already reached under the title keeps its first stamp.
export function afterStage(t: TimingLedger, title: string, stage: StageId, now: number): TimingLedger {
  if (t.title !== title) return { ...t, title, stages: [{ stage, at: now }], at: now }
  if (t.stages.some(s => s.stage === stage)) return t
  return { ...t, stages: [...t.stages, { stage, at: now }], at: now }
}

// The closed totals with the open state's stretch up to `to` added, and the
// open state then counting from `to`.
function closedAt(t: TimingLedger, to: number): Pick<TimingLedger, 'states' | 'stateSince'> {
  if (t.state === null) return { states: t.states, stateSince: to }
  return { states: { ...t.states, [t.state]: t.states[t.state] + span(t.stateSince, to) }, stateSince: Math.max(t.stateSince, to) }
}

// The record after a watch read the pull request. A different pull request
// replaces the stored one and clears both stamps; when the stored one had
// merged, the frozen clock starts again from `now`, so the stretch since that
// merge is not counted and a merged pull request watched by mistake does not
// stop the clock for good. Then the first reading that sees the pull request
// open stamps its opening, and the first that sees it merged stamps the merge,
// closes the open state's stretch at the merge and stops the totals growing.
export function afterPr(t: TimingLedger, seen: PullRequestSeen, now: number): TimingLedger {
  let next = t
  if (t.pr === null || t.pr.repo !== seen.repo || t.pr.number !== seen.number) {
    next = { ...t, pr: { repo: seen.repo, number: seen.number }, prOpenedAt: null, prMergedAt: null, at: now }
    if (t.prMergedAt !== null) next.stateSince = now
  }
  if (seen.state === 'OPEN' && next.prOpenedAt === null) next = { ...next, prOpenedAt: now, at: now }
  if (seen.state === 'MERGED' && next.prMergedAt === null) next = { ...next, ...closedAt(next, now), prMergedAt: now, at: now }
  return next
}

// The record after the status state was worked out as `state`. Nothing
// changes after the merge, or when the state is the one already open.
// Otherwise the stretch since the open state began is added to its total and
// the new state opens at `now`, in the one record handed back, so no stretch
// is added twice. The first state ever opened begins at the record's start,
// so the stretch before the first status write is counted and the totals add
// up to the elapsed time.
export function afterState(t: TimingLedger, state: BuildState, now: number): TimingLedger {
  if (t.prMergedAt !== null || t.state === state) return t
  if (t.state === null) return { ...t, state, stateSince: t.startedAt, at: now }
  return { ...t, ...closedAt(t, now), state, at: now }
}

// The rounds with one more appended, keeping the newest ROUNDS_KEPT and
// counting the ones dropped.
function withRound(t: TimingLedger, rounds: BuildRound[], round: BuildRound, now: number): TimingLedger {
  const all = [...rounds, round]
  const dropped = Math.max(0, all.length - ROUNDS_KEPT)
  return { ...t, rounds: all.slice(dropped), olderRounds: t.olderRounds + dropped, at: now }
}

// The rounds with any open one closed at `now` as `ended`, never before it
// began.
const closedRounds = (rounds: readonly BuildRound[], ended: BuildRoundEnd, now: number): BuildRound[] =>
  rounds.map(r => (r.ended === null ? { ...r, endedAt: Math.max(r.startedAt, now), ended } : r))

// The record after the package tool packaged `head`. A head that the newest
// round already belongs to starts nothing new. Otherwise a round still open
// was replaced by a push before its review, so it closes now as superseded,
// and a round for the head opens.
export function afterPackage(t: TimingLedger, head: string, now: number): TimingLedger {
  if (t.rounds.at(-1)?.head === head) return t
  return withRound(t, closedRounds(t.rounds, 'superseded', now), { head, startedAt: now, endedAt: null, ended: null }, now)
}

// The record after post_review posted a review at `head`. A round open at the
// head closes now as reviewed. A head with no open round, such as one whose
// review carried the verdicts over from the approved head, gets a round that
// begins and ends now, marked carried over; a round open at another head then
// closes as superseded, because the review shows that a push replaced its
// head.
export function afterReview(t: TimingLedger, head: string, now: number): TimingLedger {
  const openRound = t.rounds.find(r => r.ended === null)
  if (openRound?.head === head) return { ...t, rounds: closedRounds(t.rounds, 'reviewed', now), at: now }
  return withRound(t, closedRounds(t.rounds, 'superseded', now), { head, startedAt: now, endedAt: now, ended: 'carried-over' }, now)
}

// The totals with the open state counted up to `now`, or, once the merge is
// stamped, the totals as the merge closed them.
export function statesAt(t: TimingLedger, now: number): Record<BuildState, number> {
  if (t.prMergedAt !== null || t.state === null) return t.states
  return closedAt(t, now).states
}

// The status file's field, with the totals as of `now`.
export function recordTiming(t: TimingLedger, now: number): BuildTiming {
  return {
    startedAt: t.startedAt,
    stages: t.stages,
    prOpenedAt: t.prOpenedAt,
    prMergedAt: t.prMergedAt,
    states: statesAt(t, now),
    rounds: t.rounds,
    olderRounds: t.olderRounds,
  }
}

const ENDED_WORDS: Record<BuildRoundEnd, string> = { reviewed: 'reviewed', superseded: 'superseded', 'carried-over': 'carried over' }

function roundLine(r: BuildRound, now: number): string {
  const head = r.head.slice(0, 8)
  if (r.ended === null || r.endedAt === null) return `  Round at ${head}: ${clockTime(span(r.startedAt, now))} so far, open`
  return `  Round at ${head}: ${clockTime(span(r.startedAt, r.endedAt))}, ${ENDED_WORDS[r.ended]}`
}

function pullRequestLine(t: TimingLedger, now: number): string | null {
  if (t.prOpenedAt === null && t.prMergedAt === null) return null
  const opened = t.prOpenedAt === null ? 'opening not seen' : `opened at ${timeOfDay(t.prOpenedAt, now)}`
  const merged = t.prMergedAt === null ? 'not merged yet' : `merged at ${timeOfDay(t.prMergedAt, now)}`
  return `  Pull request: ${opened}, ${merged}`
}

// The pane's lines for the session's times: the elapsed time from the start
// to the merge, or to now before it, split into working, waiting on the
// person and other waiting; then the stages with the time each was first
// reached, the pull request's opening and merge, and each round with its
// duration and how it ended, an open round counting up to now. Only a
// ticketed session works out a status state, so a record with no state ever
// opened says the split is not kept rather than showing zeros.
export function timingLines(t: TimingLedger | null, now: number): string[] {
  if (t === null) return ['Time: not counted yet']
  const end = t.prMergedAt ?? now
  const elapsed = `${clockTime(span(t.startedAt, end))} ${t.prMergedAt === null ? 'so far' : 'from start to merge'}`
  let split = 'the split by state is kept only for a foreman ticket'
  if (t.state !== null) {
    const totals = statesAt(t, now)
    const other = STATES.filter(s => s !== 'working' && s !== 'needs-you').reduce((sum, s) => sum + totals[s], 0)
    split = `working ${clockTime(totals.working)}, waiting on you ${clockTime(totals['needs-you'])}, other waiting ${clockTime(other)}`
  }
  const lines = [`Time: ${elapsed} · ${split}`]
  if (t.stages.length > 0) lines.push(`  Stages: ${t.stages.map(s => `${stageLabel(s.stage)} at ${timeOfDay(s.at, now)}`).join(', ')}`)
  const pr = pullRequestLine(t, now)
  if (pr !== null) lines.push(pr)
  if (t.olderRounds > 0) lines.push(`  ${t.olderRounds} older ${t.olderRounds === 1 ? 'round' : 'rounds'} not shown`)
  lines.push(...t.rounds.map(r => roundLine(r, now)))
  return lines
}
