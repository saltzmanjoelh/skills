// The rules for counting the messages builder sends a foreman parent to tell
// it that the status file changed: how one send ended, the record of the
// sends since the hooks loaded, how a stored copy of that record is read, and
// the words of the pane's line for it. Every function is pure;
// hooks/register.tsx keeps the record in a module variable, never in $.state,
// the status file or the memo, so a count can never cause a status write or
// another send, and copies it to the store under `sends:<session id>`.

import { printable, timeOfDay } from './text'

export const SENDS_PREFIX = 'sends:'
export const sendsKey = (sessionId: string) => `${SENDS_PREFIX}${sessionId}`
// A stored copy whose newest time is older than two weeks is dropped when
// the hooks load, as the spending ledgers are.
export const SENDS_KEPT_MS = 14 * 24 * 60 * 60_000
// The longest reason the record keeps, so a long error stays one short line.
export const REASON_MAX = 120

// The newest send: when it began, and how it ended, with the reason when it
// failed.
export type SendLast = { at: number; outcome: 'delivered' } | { at: number; outcome: 'failed'; reason: string }

// The sends to the parent since the hooks loaded, for the session `sessionId`
// whose parent is `parentSessionId`. `since` is the hooks' load stamp.
export type SendsRecord = {
  version: 1
  sessionId: string
  parentSessionId: string
  since: number
  delivered: number
  failed: number
  last: SendLast | null
}

// How one send ended, as afterSend counts it.
export type SendOutcome = { outcome: 'delivered' } | { outcome: 'failed'; reason: string }

// How one send settled: with the engine's answer, with a thrown error, or
// with no answer before its time limit.
export type SendSettled = { kind: 'answered'; answer: unknown } | { kind: 'threw'; error: unknown } | { kind: 'timed-out' }

const NO_REASON = 'the engine gave no reason'
const NO_MESSAGE = 'the send threw with no message'

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
const isTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// A record with nothing sent yet.
export function emptySends(at: { sessionId: string; parentSessionId: string; since: number }): SendsRecord {
  return { version: 1, sessionId: at.sessionId, parentSessionId: at.parentSessionId, since: at.since, delivered: 0, failed: 0, last: null }
}

// How a send ended. Only an answer that says it was delivered counts as
// delivered. Any other answer counts as failed with the engine's reason, or
// with a sentence saying it gave none. A thrown error counts as failed with
// its message, and a send that ran past `limitMs` counts as failed with a
// sentence that names the limit.
export function sendOutcomeOf(settled: SendSettled, limitMs: number): SendOutcome {
  if (settled.kind === 'timed-out') {
    const seconds = Math.round(limitMs / 1000)
    return { outcome: 'failed', reason: `no answer came within ${seconds} ${seconds === 1 ? 'second' : 'seconds'}` }
  }
  if (settled.kind === 'threw') {
    const message = settled.error instanceof Error ? settled.error.message : String(settled.error)
    return { outcome: 'failed', reason: message.trim() === '' ? NO_MESSAGE : message }
  }
  const answer = typeof settled.answer === 'object' && settled.answer !== null ? settled.answer as Record<string, unknown> : {}
  if (answer.isDelivered === true) return { outcome: 'delivered' }
  return { outcome: 'failed', reason: typeof answer.reason === 'string' && answer.reason.trim() !== '' ? answer.reason : NO_REASON }
}

// The record after one send that began at `at` and ended as `outcome` says:
// its count raised by one, and the send made the newest. A reason is kept as
// plain text on one short line.
export function afterSend(record: SendsRecord, outcome: SendOutcome, at: number): SendsRecord {
  if (outcome.outcome === 'delivered') return { ...record, delivered: record.delivered + 1, last: { at, outcome: 'delivered' } }
  return { ...record, failed: record.failed + 1, last: { at, outcome: 'failed', reason: printable(outcome.reason, REASON_MAX) } }
}

function lastIn(raw: unknown): SendLast | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const l = raw as Record<string, unknown>
  if (!isTime(l.at)) return undefined
  if (l.outcome === 'delivered') return { at: l.at, outcome: 'delivered' }
  if (l.outcome === 'failed' && typeof l.reason === 'string') return { at: l.at, outcome: 'failed', reason: l.reason }
  return undefined
}

// The record a stored value holds for `sessionId`, or null when the value is
// damaged in any part or belongs to another session.
export function sendsIn(raw: unknown, sessionId: string): SendsRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1 || r.sessionId !== sessionId || typeof r.parentSessionId !== 'string') return null
  if (!isTime(r.since) || !isCount(r.delivered) || !isCount(r.failed)) return null
  const last = lastIn(r.last)
  if (last === undefined) return null
  return { version: 1, sessionId, parentSessionId: r.parentSessionId, since: r.since, delivered: r.delivered, failed: r.failed, last }
}

// The newest time of a record, which its age is measured from: the newest
// send's, or the load time before any send.
export const sendsNewest = (record: SendsRecord) => Math.max(record.since, record.last?.at ?? record.since)

// The pane's line for the record: both counts, then the newest send's time
// once there is one. While the newest send failed, the line ends with its
// reason and is drawn as a warning. The reason is cleaned again here, so
// whatever reached the record is drawn as plain text on one line.
export function sendsLine(record: SendsRecord, now: number): { text: string; isWarning: boolean } {
  const counts = `Messages to foreman: ${record.delivered} delivered, ${record.failed} failed`
  const last = record.last
  if (last === null) return { text: counts, isWarning: false }
  const at = `${counts}, last at ${timeOfDay(last.at, now)} UTC`
  if (last.outcome === 'delivered') return { text: at, isWarning: false }
  return { text: `${at}, which failed: ${printable(last.reason, REASON_MAX)}`, isWarning: true }
}
