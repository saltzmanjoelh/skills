import { expect, test } from 'claude-code/testing'

import { decide, GONE_MS, needsList, type DecideInput, type Decision, type SessionsLook } from '../hooks/act'
import { recordIn } from '../hooks/record'
import type { SubRow } from '../hooks/subs'
import { joinOwners, newPairing, TICKETS_EMPTY } from '../hooks/tickets'
import type { ForemanTickets } from '../types'

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)
const MINUTE = 60_000
const T = 5 * MINUTE
const LIMITS = { idleMs: T, cleanupMs: 15 * MINUTE }

function row(over: Record<string, unknown> = {}, file = 'a.json', mtimeMs = T0): SubRow {
  const record = recordIn(JSON.stringify({
    sessionId: 's-a', ticket: 'ft-a', desktopSessionId: 'local_a', cwd: '/w', issueKey: 'ABC-1', issueTitle: 't', stage: 'build',
    stageDone: 4, pr: null, state: 'idle', reason: '', stateSince: T0, writtenAt: T0, ...over,
  }))!
  return { file, record, mtimeMs, isStale: false }
}

const running: SessionsLook = { kind: 'read', sessions: [{ sessionId: 'local_a', isArchived: false, isRunning: true }] }

// A parent with one pairing for ticket ft-a.
const paired = (localId: string | null = 'local_a'): ForemanTickets => ({ ...TICKETS_EMPTY, pairings: [newPairing('ft-a', localId, T0)] })

// One read: the rows joined to the ledger, then the decision.
function read(tickets: ForemanTickets, rows: SubRow[], now: number, over: Partial<DecideInput> = {}): Decision {
  const joined = joinOwners(tickets, rows).tickets
  return decide({ tickets: joined, rows, now, limits: LIMITS, sessions: { kind: 'unread' }, folderExists: true, listed: true, isPaused: false, slots: 2, ...over })
}

// Reads every minute from T0 to `until`, with `rowAt` giving the rows at each
// moment, and answers what each read did.
function readEvery(tickets: ForemanTickets, rowAt: (now: number) => SubRow[], until: number) {
  const seen: { at: number; nudges: number; reasons: string[] }[] = []
  let t = tickets
  for (let now = T0; now <= until; now += MINUTE) {
    const d = read(t, rowAt(now), now)
    t = d.tickets
    const nudges = d.effects.filter(e => e.kind === 'nudge').length
    if (nudges > 0 || d.reasons.length > 0) seen.push({ at: (now - T0) / MINUTE, nudges, reasons: d.reasons.map(r => r.kind) })
  }
  return seen
}

test('an idle sub session that never answers is nudged at one and two thresholds, the parent is woken at three, and no third nudge comes', () => {
  expect(readEvery(paired(), () => [row()], T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['idle'] },
  ])
})

test('a nudge goes to the local_ id start_session named, and the next due time is the next threshold', () => {
  const d = read(paired(), [row()], T0 + T)
  expect(d.effects).toEqual([{ kind: 'nudge', ticket: 'ft-a', to: 'local_a', name: 'ABC-1' }])
  expect(d.nextDueAt).toBe(T0 + 2 * T)
})

test('a sub session that answers each nudge with a short turn and goes idle again still reaches the parent', () => {
  // After each nudge it works for one minute and is idle again, with a new
  // stateSince, at the same stage.
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m === 6 || m === 13) return [row({ state: 'working', stateSince: now })]
    if (m >= 14) return [row({ stateSince: T0 + 14 * MINUTE })]
    if (m >= 7) return [row({ stateSince: T0 + 7 * MINUTE })]
    return [row()]
  }
  expect(readEvery(paired(), rowAt, T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 12, nudges: 1, reasons: [] },
    { at: 19, nudges: 0, reasons: ['idle'] },
  ])
})

test('progress, or a working stretch as long as the threshold, starts the count again', () => {
  const progressed = (now: number) => ((now - T0) / MINUTE < 7 ? [row()] : [row({ stage: 'verify', stateSince: T0 + 7 * MINUTE })])
  expect(readEvery(paired(), progressed, T0 + 13 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 12, nudges: 1, reasons: [] },
  ])
  const worked = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m >= 6 && m < 12) return [row({ state: 'working', stateSince: T0 + 6 * MINUTE })]
    return m >= 12 ? [row({ stateSince: T0 + 12 * MINUTE })] : [row()]
  }
  expect(readEvery(paired(), worked, T0 + 18 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 17, nudges: 1, reasons: [] },
  ])
})

test('a record with no desktop session to nudge wakes the parent at two thresholds', () => {
  expect(readEvery(paired(null), () => [row({ desktopSessionId: undefined })], T0 + 20 * MINUTE)).toEqual([{ at: 10, nudges: 0, reasons: ['idle'] }])
})

test('a record that needs the person is notified once per episode and never wakes the parent', () => {
  const needs = (since: number) => [row({ state: 'needs-you', stateSince: since, reason: 'a question is open' })]
  let d = read(paired(), needs(T0), T0)
  expect(d.effects).toEqual([{ kind: 'notify', text: 'ABC-1 needs you: a question is open' }])
  d = read(d.tickets, needs(T0), T0 + 30 * MINUTE)
  expect(d.effects).toEqual([])
  expect(d.reasons).toEqual([])
  d = read(d.tickets, needs(T0 + 31 * MINUTE), T0 + 31 * MINUTE)
  expect(d.effects).toHaveLength(1)
})

test('cleanup wakes the parent once after its threshold, or at once after three failed calls', () => {
  const cleaning = (failedCalls: number) => [row({ state: 'in-cleanup', cleanup: { failedCalls, lastError: 'gh failed' } })]
  expect(readEvery(paired(), () => cleaning(0), T0 + 40 * MINUTE)).toEqual([{ at: 15, nudges: 0, reasons: ['cleanup'] }])
  expect(readEvery(paired(), () => cleaning(3), T0 + 40 * MINUTE)).toEqual([{ at: 0, nudges: 0, reasons: ['cleanup'] }])
})

test('a done session frees its slot once it is archived, not running or not listed, and not while it runs', () => {
  const done = [row({ state: 'done' })]
  const look = (s: { isArchived: boolean; isRunning: boolean }[]): SessionsLook => ({ kind: 'read', sessions: s.map(x => ({ sessionId: 'local_a', ...x })) })
  expect(read(paired(), done, T0, { sessions: look([{ isArchived: false, isRunning: true }]) }).tickets.pairings[0]!.standing).toBe('active')
  for (const sessions of [look([{ isArchived: true, isRunning: false }]), look([{ isArchived: false, isRunning: false }]), look([])]) {
    const d = read(paired(), done, T0, { sessions })
    expect(d.tickets.pairings[0]!.standing).toBe('freed')
    expect(d.reasons).toEqual([{ kind: 'slot-free', free: 2 }])
  }
  expect(read(paired(), done, T0, { sessions: { kind: 'failed' } }).tickets.pairings[0]!.standing).toBe('active')
})

test('a record whose file leaves frees its slot, but a missing folder frees nothing and forgets nothing', () => {
  const first = read(paired(), [row({ state: 'working' })], T0)
  const left = read(first.tickets, [], T0 + MINUTE)
  expect(left.tickets.pairings).toEqual([])
  expect(left.reasons).toEqual([{ kind: 'slot-free', free: 2 }])
  const missing = read(first.tickets, [], T0 + MINUTE, { folderExists: false })
  expect(missing.tickets.pairings).toHaveLength(1)
  expect(missing.reasons).toEqual([])
  expect(missing.logs).toEqual(['The status folder is missing, so foreman frees no slot until it is back.'])
  expect(read(missing.tickets, [], T0 + 2 * MINUTE, { folderExists: false }).logs).toEqual([])
  const unlisted = read(first.tickets, [], T0 + MINUTE, { listed: false })
  expect(unlisted.tickets.pairings).toHaveLength(1)
  expect(unlisted.reasons).toEqual([])
})

test('a slot that frees while paused wakes nothing and is remembered, and one that frees while every slot is still busy wakes nothing', () => {
  const first = read(paired(), [row({ state: 'working' })], T0)
  const paused = read(first.tickets, [], T0 + MINUTE, { isPaused: true })
  expect(paused.reasons).toEqual([])
  expect(paused.tickets.freedWhilePaused).toBe(true)
  const t: ForemanTickets = { ...TICKETS_EMPTY, pairings: [newPairing('ft-a', 'local_a', T0), newPairing('ft-b', null, T0)] }
  const rows = [row({ state: 'working' }), row({ sessionId: 's-b', ticket: 'ft-b', desktopSessionId: 'local_b', state: 'working' }, 'b.json')]
  const both = read(t, rows, T0, { slots: 1 })
  expect(read(both.tickets, [rows[1]!], T0 + MINUTE, { slots: 1 }).reasons).toEqual([])
})

test('a released or freed pairing gets no action', () => {
  const t = joinOwners(paired(), [row()]).tickets
  t.pairings[0]!.standing = 'released'
  expect(readEvery(t, () => [row()], T0 + 30 * MINUTE)).toEqual([])
})

test('a sub session whose file stopped and whose session is not running wakes the parent once, unless its pull request merged', () => {
  const stopped = [row({ state: 'working' }, 'a.json', T0)]
  const notRunning: SessionsLook = { kind: 'read', sessions: [{ sessionId: 'local_a', isArchived: false, isRunning: false }] }
  const later = T0 + GONE_MS + MINUTE
  let d = read(paired(), stopped, later, { sessions: notRunning })
  expect(d.reasons).toEqual([{ kind: 'gone', who: 'ABC-1', minutes: 6 }])
  d = read(d.tickets, stopped, later + MINUTE, { sessions: notRunning })
  expect(d.reasons).toEqual([])
  expect(read(paired(), stopped, later, { sessions: running }).reasons).toEqual([])
  expect(read(paired(), [row({ state: 'working', pr: { repo: 'o/r', number: 7, state: 'MERGED', checks: 'passed' } })], later, { sessions: notRunning }).reasons).toEqual([])
  expect(read(paired(), stopped, later, { sessions: { kind: 'failed' } }).reasons).toEqual([])
})

test('the session list is needed only for a done record or a file older than the gone threshold', () => {
  const t = joinOwners(paired(), [row()]).tickets
  expect(needsList(t, [row()], T0 + MINUTE)).toBe(false)
  expect(needsList(t, [row({ state: 'done' })], T0)).toBe(true)
  expect(needsList(t, [row()], T0 + GONE_MS + 1)).toBe(true)
})

test('a pairing that no status file carried for a day is forgotten, and a younger one is kept', () => {
  const young = read(paired(), [], T0 + 23 * 60 * MINUTE)
  expect(young.tickets.pairings).toHaveLength(1)
  const old = read(paired(), [], T0 + 25 * 60 * MINUTE)
  expect(old.tickets.pairings).toEqual([])
  expect(old.logs).toEqual(['Forgot ticket ft-a, because no status file carried it for a day.'])
  expect(old.reasons).toEqual([])
})
