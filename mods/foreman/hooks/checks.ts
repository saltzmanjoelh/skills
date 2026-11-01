// The checks foreman makes by itself of sub sessions it holds no record of:
// the records as the ledger keeps them, what a turn-end note does to them,
// how the header of a session's events reads, what a check that fell due
// does, and which records its outcomes end. Every function is pure.
// register.tsx carries out what they decide.

import type { ForemanCheck, ForemanOutbox, ForemanPairing } from '../types'
import { REASONS, WHOLE_LOCAL_ID } from './desktop'
import { objectOf } from './text'
import { wakeLine } from './wake'

// The most checks kept, the newest ones, the same bound as the list of
// unwatched sub sessions.
export const MAX_CHECKS = 50

const isTime = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw)

// One stored check, or null unless its id is a whole desktop session id and
// both its times are finite numbers. A mark reads as true only when it is
// exactly true, and a record that was not nudged cannot have been answered.
function checkIn(raw: unknown): ForemanCheck | null {
  const c = objectOf(raw)
  if (c === null || typeof c.id !== 'string' || !WHOLE_LOCAL_ID.test(c.id) || !isTime(c.notedAt) || !isTime(c.dueAt)) return null
  const nudged = c.nudged === true
  return { id: c.id, notedAt: c.notedAt, dueAt: c.dueAt, nudged, answered: nudged && c.answered === true }
}

// The stored checks read tolerantly: a value that is not a list reads as
// none, an entry that is not sound is dropped, an id kept more than once
// keeps its last record in that record's place, and only the newest
// MAX_CHECKS are kept. Due times are taken as stored, because reading a
// ledger knows no clock. clampedDue pulls in one that lies too far ahead.
export function checksIn(raw: unknown): ForemanCheck[] {
  if (!Array.isArray(raw)) return []
  const last = new Map<string, ForemanCheck>()
  for (const entry of raw) {
    const check = checkIn(entry)
    if (check === null) continue
    last.delete(check.id)
    last.set(check.id, check)
  }
  return [...last.values()].slice(-MAX_CHECKS)
}

// The checks with every due time later than `now` plus the idle period pulled
// in to that, as after the clock went back or the idle minutes were made
// shorter. The same list comes back when no due time changes. The callers
// write the result back to the ledger, a read in the update that records its
// decision and a check pass in the update that claims the due checks: a due
// time pulled in once then stays where it was put, so it falls due one idle
// period later rather than being pushed on at every read.
export function clampedDue(checks: ForemanCheck[], now: number, idleMs: number): ForemanCheck[] {
  const latest = now + idleMs
  return checks.some(c => c.dueAt > latest) ? checks.map(c => (c.dueAt > latest ? { ...c, dueAt: latest } : c)) : checks
}

// The checks after a turn-end note about desktop session `id` that foreman
// read at `now`. A record that was not nudged, or a new one, takes the note's
// time and a due time an idle period after it. The first note after the nudge
// counts as the answer to the nudge, so it moves the times and keeps the
// nudge. A second note after the nudge counts as new work and clears the
// nudge. The record noted goes to the end, and only the newest MAX_CHECKS
// are kept. An id that is not a whole desktop session id leaves the checks as
// they were.
export function withNote(checks: ForemanCheck[], id: string, now: number, idleMs: number): ForemanCheck[] {
  if (!WHOLE_LOCAL_ID.test(id)) return checks
  const old = checks.find(c => c.id === id)
  const answers = old !== undefined && old.nudged && !old.answered
  const noted: ForemanCheck = { id, notedAt: now, dueAt: now + idleMs, nudged: answers, answered: answers }
  return [...checks.filter(c => c.id !== id), noted].slice(-MAX_CHECKS)
}

// The checks without those whose desktop session a pairing holds, since the
// pairing's own watch takes over. The same list comes back when none is
// dropped.
export function withoutPaired(checks: ForemanCheck[], pairings: readonly ForemanPairing[]): ForemanCheck[] {
  const paired = new Set(pairings.flatMap(p => (p.localId === null ? [] : [p.localId])))
  return checks.some(c => paired.has(c.id)) ? checks.filter(c => !paired.has(c.id)) : checks
}

// The first line of a list_events answer: `Session "<title>" (<state>)`,
// with `, archived` after the state for an archived session, and then
// ` — showing` and the count. The title is the sub session's own text and may
// hold quotes and parentheses, so the title runs to the last parenthesis
// that is followed by ` — showing`, and the state is read from inside it.
const HEADER = /^Session "(.*)" \(([^()]*)\) — showing\b/
const STATE = /^([A-Za-z][A-Za-z_ -]*?)(, archived)?$/

// The state a session's events header gives and whether it says the session
// is archived, read from the first line of `text` only, or null when that
// line is not such a header. The title is never returned.
export function headerOf(text: string): { state: string; archived: boolean } | null {
  if (typeof text !== 'string') return null
  const header = HEADER.exec(text.split(/\r?\n/, 1)[0]!)
  const state = header === null ? null : STATE.exec(header[2]!)
  if (state === null) return null
  return { state: state[1]!, archived: state[2] !== undefined }
}

// What a check that fell due does: drop the record of an archived session;
// drop the record of a session whose events could not be read, with the
// reason; check again later when the session is inside a turn; nudge an idle
// session that was not nudged yet; or wake the parent about an idle session
// that still waits after the nudge.
export type CheckOutcome =
  | { kind: 'drop-archived' }
  | { kind: 'drop-failed'; reason: string }
  | { kind: 'later' }
  | { kind: 'nudge' }
  | { kind: 'wake' }

// The outcome of the check of `record`, given the header read from the
// desktop app or why it could not be read. Only the exact state `idle` counts
// as idle. Every other state the header gives counts as inside a turn, since
// the word for that state has not been seen.
export function checkOutcome(record: ForemanCheck, look: { header: string } | { reason: string }): CheckOutcome {
  if ('reason' in look) return { kind: 'drop-failed', reason: look.reason }
  const header = headerOf(look.header)
  if (header === null) return { kind: 'drop-failed', reason: REASONS.eventsUnreadable }
  if (header.archived) return { kind: 'drop-archived' }
  if (header.state !== 'idle') return { kind: 'later' }
  return record.nudged ? { kind: 'wake' } : { kind: 'nudge' }
}

// The earliest due time of the checks, or null when there are none.
export const soonestDue = (checks: readonly ForemanCheck[]): number | null => (checks.length === 0 ? null : Math.min(...checks.map(c => c.dueAt)))

// Whether `check` is still the record a pass claimed as `claim`: a note that
// came in since then changed its times, and a pass that dropped it left none.
export const isClaimed = (check: ForemanCheck, claim: ForemanCheck) => check.id === claim.id && check.notedAt === claim.notedAt && check.dueAt === claim.dueAt

// The sentence that says foreman stopped checking the sub session `id`, and
// why.
const stoppedLine = (id: string, why: string) => `Stopped checking the sub session ${id}, because ${why}.`

// A claimed record and the outcome of its check.
export type CheckDone = { claim: ForemanCheck; outcome: CheckOutcome }

// The checks after the outcomes `done` of one pass, and the work they leave
// for the outbox. Only an outcome whose record still holds its claimed times
// counts, so the outcome of a check that a newer note overtook is thrown away.
// Every outcome but `later` ends its record, and checkOne has already turned a
// nudge into `later` or a failure. An archived sub session gets a log line.
// Each failure gets a log line, and all the failures share one quiet
// notification, whose text the log already holds. The sub sessions that still
// wait after the nudge share one line that wakes the parent. The same checks
// and empty work come back when no record ends.
export function endsOf(done: readonly CheckDone[], checks: ForemanCheck[]): { checks: ForemanCheck[]; work: Omit<ForemanOutbox, 'reports'> } {
  const ends = done.filter(d => d.outcome.kind !== 'later' && checks.some(c => isClaimed(c, d.claim)))
  if (ends.length === 0) return { checks, work: { logs: [], effects: [], lines: [] } }
  const failed = ends.flatMap(d => (d.outcome.kind === 'drop-failed' ? [stoppedLine(d.claim.id, d.outcome.reason)] : []))
  const archived = ends.flatMap(d => (d.outcome.kind === 'drop-archived' ? [stoppedLine(d.claim.id, 'its session is archived')] : []))
  const line = wakeLine(ends.flatMap(d => (d.outcome.kind === 'wake' ? [{ kind: 'still-waits' as const, id: d.claim.id }] : [])))
  return {
    checks: checks.filter(c => !ends.some(d => isClaimed(c, d.claim))),
    work: {
      logs: [...archived, ...failed],
      effects: failed.length === 0 ? [] : [{ kind: 'notify', text: failed.join(' '), quiet: true }],
      lines: line === null ? [] : [line],
    },
  }
}
