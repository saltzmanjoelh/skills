// The record of builder's "status file changed" messages that foreman's
// session.receive hook consumed since the hooks loaded, which the pane shows
// on one line and hooks/register.tsx copies to the store under
// `markers:<parent session id>`, so a session that cannot see the pane can
// still read it. Nothing here reads or writes state.
//
// The record lives in a module variable, never in $.state, the status folder
// or the ledger, so counting can never cause a read, a write or a wake of its
// own. It starts at zero each time the hooks load, so its count always means
// "since foreman loaded".

import { timeOfDay } from './text'

// One load's count: when the hooks loaded, how many messages they consumed,
// and when the first and the newest came, which are null before the first.
export type MarkersRecord = {
  version: 1
  sessionId: string
  since: number
  consumed: number
  first: number | null
  last: number | null
}

export const MARKERS_PREFIX = 'markers:'
export const markersKey = (sessionId: string) => `${MARKERS_PREFIX}${sessionId}`

// A stored copy whose newest time is older than two weeks is deleted when the
// hooks load, as builder deletes its old copies of what a session spent.
export const MARKERS_KEPT_MS = 14 * 24 * 60 * 60_000

// The one line the log gets, for the first message consumed since the hooks
// loaded. Later messages only change the count.
export const FIRST_MARKER_LOG = 'A builder status message arrived and was consumed, the first since foreman loaded; the line above the log counts the rest.'

// The record of a load that has consumed nothing yet.
export const emptyMarkers = (sessionId: string, since: number): MarkersRecord => ({ version: 1, sessionId, since, consumed: 0, first: null, last: null })

// The record after one more message was consumed at `at`.
export const afterConsumed = (record: MarkersRecord, at: number): MarkersRecord => ({ ...record, consumed: record.consumed + 1, first: record.first ?? at, last: at })

// The newest time the record holds: the newest message, or the load time
// before the first.
export const markersNewest = (record: MarkersRecord): number => record.last ?? record.since

const isTime = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw)

// A stored copy read back for `sessionId`, or null when it belongs to another
// session, has another version, or has a field that is not what foreman
// writes, including a count that disagrees with its times.
export function markersIn(raw: unknown, sessionId: string): MarkersRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1 || r.sessionId !== sessionId || !isTime(r.since)) return null
  const { consumed, first, last } = r
  if (typeof consumed !== 'number' || !Number.isInteger(consumed) || consumed < 0) return null
  if (consumed === 0 ? first !== null || last !== null : !isTime(first) || !isTime(last)) return null
  return { version: 1, sessionId, since: r.since, consumed, first: first as number | null, last: last as number | null }
}

// The pane's line for the record, with each time as the log writes it and
// UTC after it.
export function markersLine(record: MarkersRecord, now: number): string {
  const head = `Status messages consumed since ${timeOfDay(record.since, now)} UTC: `
  if (record.consumed === 0 || record.last === null) return `${head}none yet`
  return `${head}${record.consumed}, last at ${timeOfDay(record.last, now)} UTC`
}
