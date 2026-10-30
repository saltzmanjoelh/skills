import { expect, test } from 'claude-code/testing'

import { CALL_TIMEOUT_MS, decide, freeSlots, GONE_MS, needsList, startWaits, UNOWNED_FOR_MS, type DecideInput, type Decision, type SessionsLook } from '../hooks/act'
import type { Listed } from '../hooks/desktop'
import { recordIn } from '../hooks/record'
import type { SubRow } from '../hooks/subs'
import { joinOwners, newPairing, TICKETS_EMPTY } from '../hooks/tickets'
import type { ForemanPairing, ForemanTickets } from '../types'

// The queue's rules, decided without the engine: which sub sessions wait,
// which are begun, which are dropped or held, and how many slots are free.

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)
const MINUTE = 60_000
const T = 5 * MINUTE
const LIMITS = { idleMs: T, cleanupMs: 15 * MINUTE }

// The status file of the sub session with `ticket`, whose desktop session is
// local_<ticket>, with `over` changing its fields. By default it is the file
// builder writes for a sub session that waits: idle, with no issue key, no
// stage and no pull request.
function row(ticket: string, over: Record<string, unknown> = {}, mtimeMs = T0): SubRow {
  const record = recordIn(JSON.stringify({
    sessionId: `s-${ticket}`, ticket, desktopSessionId: `local_${ticket}`, cwd: '/w', issueKey: null, issueTitle: null, stage: null,
    stageDone: 0, pr: null, state: 'idle', reason: '', stateSince: T0, writtenAt: T0, ...over,
  }))!
  return { file: `${ticket}.json`, record, mtimeMs, isStale: false }
}

// A sub session that went ahead and is working on its issue.
const busyRow = (ticket: string, key: string) => row(ticket, { issueKey: key, stage: 'build', stageDone: 2, state: 'working' })

// A pairing that went ahead, and one that waits at `place`, with `claim`.
const ahead = (ticket: string, key: string, at = T0): ForemanPairing => newPairing(ticket, `local_${ticket}`, at, key)
const waiting = (ticket: string, key: string, place: number, claim: { attemptAt: number; notified: boolean } | null = null, localId: string | null = `local_${ticket}`): ForemanPairing => newPairing(ticket, localId, T0, key, { place, claim })

const ledger = (...pairings: ForemanPairing[]): ForemanTickets => ({ ...TICKETS_EMPTY, pairings })

// A session as the desktop app lists it, unarchived and running unless `over`
// says otherwise.
const listed = (id: string, over: Partial<Listed> = {}): Listed => ({ sessionId: id, isArchived: false, isRunning: true, title: null, surelyUnarchived: true, ...over })
const list = (sessions: Listed[], complete = false, known?: string[]): SessionsLook => ({ kind: 'read', sessions, complete, ...(known === undefined ? {} : { known }) })

// One read: the rows joined to the ledger, then the decision, with one slot.
function read(tickets: ForemanTickets, rows: SubRow[], now: number, over: Partial<DecideInput> = {}): Decision {
  const joined = joinOwners(tickets, rows).tickets
  return decide({ tickets: joined, rows, now, limits: LIMITS, sessions: { kind: 'unread' }, folderExists: true, listed: true, slots: 1, ...over })
}

const begins = (d: Decision) => d.effects.flatMap(e => (e.kind === 'begin' ? [[e.to, e.key, e.by]] : []))

test('a waiting sub session whose file shows it idle with no issue is never nudged and never wakes the parent', () => {
  let t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const rows = [busyRow('ft-a', 'ABC-1'), row('ft-b')]
  for (let now = T0; now <= T0 + 4 * T; now += MINUTE) {
    const d = read(t, rows, now, { sessions: list([listed('local_ft-a'), listed('local_ft-b')]) })
    expect([now, d.effects, d.reasons]).toEqual([now, [], []])
    t = d.tickets
  }
  expect(t.pairings[1]!.queue).toEqual({ place: 1, claim: null })
})

test('a waiting sub session with no status file gives no unseen wake, and is not forgotten after a day unless it has no desktop session', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2, null, null))
  const rows = [busyRow('ft-a', 'ABC-1')]
  const later = read(t, rows, T0 + 2 * GONE_MS, { sessions: list([listed('local_ft-a'), listed('local_ft-b')]) })
  expect(later.reasons).toEqual([])
  expect(later.nextDueAt).toBeNull()
  const dayOn = read(t, rows, T0 + UNOWNED_FOR_MS + MINUTE, { sessions: list([listed('local_ft-a'), listed('local_ft-b')]) })
  expect(dayOn.tickets.pairings.map(p => p.ticket)).toEqual(['ft-a', 'ft-b'])
  expect(dayOn.logs).toEqual(['Forgot ticket ft-c, because no status file carried it for a day.'])
})

test('the free slots count shown busy rows, starts with no status file yet, and claims whose begin is unsent, but not waiting sub sessions', () => {
  const rows = [busyRow('ft-a', 'ABC-1'), row('ft-w')]
  const base = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-w', 'ABC-9', 1))
  const t = joinOwners(base, rows).tickets
  expect(freeSlots(t, rows, T0, 3)).toBe(2)
  const reserved = { ...t, pairings: [...t.pairings, newPairing('ft-r', null, T0, 'ABC-5')] }
  expect(freeSlots(reserved, rows, T0, 3)).toBe(1)
  expect(freeSlots(reserved, rows, T0 + GONE_MS + 1, 3)).toBe(2)
  const claimed = { ...t, pairings: [...t.pairings, waiting('ft-c', 'ABC-6', 2, { attemptAt: T0, notified: false })] }
  expect(freeSlots(claimed, rows, T0, 3)).toBe(1)
})

test('a start waits when no slot is free, or when every free slot is owed to a sub session already waiting', () => {
  const rows = [busyRow('ft-a', 'ABC-1')]
  const one = joinOwners(ledger(ahead('ft-a', 'ABC-1')), rows).tickets
  expect(startWaits(one, rows, T0, 1)).toBe(true)
  expect(startWaits(one, rows, T0, 2)).toBe(false)
  const queued = { ...one, pairings: [...one.pairings, waiting('ft-w', 'ABC-2', 1)] }
  expect(startWaits(queued, rows, T0, 2)).toBe(true)
  expect(startWaits(queued, rows, T0, 3)).toBe(false)
})

test('a waiting sub session whose file shows an issue key, a stage or a pull request counts as begun and busy', () => {
  for (const over of [{ issueKey: 'ABC-2' }, { stage: 'spec' }, { pr: { number: 7, url: 'https://example.com/pull/7', state: 'OPEN', verdicts: null } }]) {
    const t = ledger(waiting('ft-b', 'ABC-2', 1))
    const d = read(t, [row('ft-b', over)], T0 + MINUTE, { sessions: list([listed('local_ft-b')]) })
    expect(d.tickets.pairings[0]!.queue).toBeNull()
    expect(d.logs.at(-1)).toBe('ABC-2 began before foreman\'s begin message, so foreman counts it as busy.')
    expect(begins(d)).toEqual([])
  }
})

test('a free slot claims the first waiting sub session in the queue\'s order and names the sub session whose slot it takes', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-c', 'ABC-3', 2), waiting('ft-b', 'ABC-2', 1))
  const done = row('ft-a', { issueKey: 'ABC-1', state: 'done' })
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false }), listed('local_ft-b'), listed('local_ft-c')])
  const d = read(t, [done, row('ft-b'), row('ft-c')], T0 + MINUTE, { sessions })
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(d.reasons).toEqual([])
  const b = d.tickets.pairings.find(p => p.ticket === 'ft-b')!
  expect(b.queue).toEqual({ place: 1, claim: { attemptAt: T0 + MINUTE, notified: false } })
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-c')!.queue).toEqual({ place: 2, claim: null })
})

test('two freed slots and one waiting sub session begin it and wake the parent for the slot left free', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'), waiting('ft-b', 'ABC-2', 1))
  const gone = { isArchived: true, isRunning: false, surelyUnarchived: false }
  const sessions = list([listed('local_ft-a', gone), listed('local_ft-x', gone), listed('local_ft-b')])
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-x', { issueKey: 'ABC-4', state: 'done' }), row('ft-b')]
  const d = read(t, rows, T0 + MINUTE, { sessions, slots: 2 })
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(d.reasons).toEqual([{ kind: 'slot-free', free: 1 }])
})

test('a freed slot that no waiting sub session can take, because the list leaves it out, still wakes the parent', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false })], false)
  const d = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-b')], T0 + MINUTE, { sessions })
  expect(begins(d)).toEqual([])
  expect(d.reasons).toEqual([{ kind: 'slot-free', free: 1 }])
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-b')!.queue).toEqual({ place: 1, claim: null })
})

test('with the queue empty a freed slot wakes the parent as before', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'))
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false })])
  const d = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'done' })], T0 + MINUTE, { sessions })
  expect(d.reasons).toEqual([{ kind: 'slot-free', free: 1 }])
})

test('a slot that was free already claims a waiting sub session, with no name for the slot, but only once the list shows it unarchived', () => {
  const t = ledger(waiting('ft-b', 'ABC-2', 1))
  expect(begins(read(t, [row('ft-b')], T0, { sessions: { kind: 'failed' } }))).toEqual([])
  expect(begins(read(t, [row('ft-b')], T0, { sessions: list([listed('local_ft-b', { surelyUnarchived: false })]) }))).toEqual([])
  expect(begins(read(t, [row('ft-b')], T0, { sessions: list([listed('local_ft-b')]) }))).toEqual([['local_ft-b', 'ABC-2', null]])
})

test('an unsent claim is tried again only once its last try is the call timeout old and the list shows its session unarchived', () => {
  const t = ledger(waiting('ft-b', 'ABC-2', 1, { attemptAt: T0, notified: true }))
  const shown = list([listed('local_ft-b')])
  expect(begins(read(t, [row('ft-b')], T0 + CALL_TIMEOUT_MS - 1, { sessions: shown }))).toEqual([])
  expect(begins(read(t, [row('ft-b')], T0 + CALL_TIMEOUT_MS, { sessions: { kind: 'failed' } }))).toEqual([])
  expect(begins(read(t, [row('ft-b')], T0 + CALL_TIMEOUT_MS, { sessions: list([listed('local_ft-b', { surelyUnarchived: false })]) }))).toEqual([])
  const d = read(t, [row('ft-b')], T0 + CALL_TIMEOUT_MS, { sessions: shown })
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', null]])
  expect(d.tickets.pairings[0]!.queue).toEqual({ place: 1, claim: { attemptAt: T0 + CALL_TIMEOUT_MS, notified: true } })
})

test('an archived waiting sub session that was not claimed leaves the queue and its issue is dropped', () => {
  const t = ledger(waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2))
  const sessions = list([listed('local_ft-b', { isArchived: true, surelyUnarchived: false }), listed('local_ft-c')])
  const d = read({ ...t }, [row('ft-b'), row('ft-c')], T0, { sessions, slots: 0 })
  expect(d.tickets.pairings.map(p => p.ticket)).toEqual(['ft-c'])
  expect(d.tickets.held).toEqual([])
  expect(d.logs).toContain('Dropped ABC-2 from the queue, because its waiting session is archived.')
})

test('an unclaimed waiting sub session missing from a whole list leaves the queue and its issue is dropped, while one missing from a list that may have left it out stays', () => {
  const t = ledger(waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2))
  const kept = read(t, [row('ft-b'), row('ft-c')], T0, { sessions: list([listed('local_ft-c')], false), slots: 0 })
  expect(kept.tickets.pairings.map(p => p.ticket)).toEqual(['ft-b', 'ft-c'])
  expect(kept.logs).toEqual([])
  const gone = read(t, [row('ft-b'), row('ft-c')], T0, { sessions: list([listed('local_ft-c')], true), slots: 0 })
  expect(gone.tickets.pairings.map(p => p.ticket)).toEqual(['ft-c'])
  expect(gone.tickets.held).toEqual([])
  expect(gone.effects).toEqual([])
  expect(gone.logs).toContain('Dropped ABC-2 from the queue, because its waiting session is no longer listed.')
})

test('a waiting sub session whose desktop session id the ledger did not hold when the list was asked for stays, even when the list is whole', () => {
  const t = ledger(waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2))
  const d = read(t, [row('ft-b'), row('ft-c')], T0, { sessions: list([], true, ['local_ft-c']), slots: 0 })
  expect(d.tickets.pairings.map(p => p.ticket)).toEqual(['ft-b'])
  expect(d.logs).toEqual(['Dropped ABC-3 from the queue, because its waiting session is no longer listed.'])
})

test('a claimed sub session with no well-formed issue key that the list shows archived leaves the queue, and nothing is held', () => {
  const t = ledger(waiting('ft-b', 'not a key', 1, { attemptAt: T0, notified: false }))
  const sessions = list([listed('local_ft-b', { isArchived: true, surelyUnarchived: false })])
  const d = read(t, [row('ft-b')], T0 + MINUTE, { sessions })
  expect(d.tickets.pairings).toEqual([])
  expect(d.tickets.held).toEqual([])
  expect(d.effects).toEqual([])
  expect(d.logs).toContain('Dropped the sub session with ticket ft-b from the queue, because its waiting session is archived.')
})

test('a claimed sub session missing from a list that may have left it out stays, and one missing from a whole list is held', () => {
  const t = ledger(waiting('ft-b', 'ABC-2', 1, { attemptAt: T0, notified: false }))
  const kept = read(t, [row('ft-b')], T0 + MINUTE, { sessions: list([listed('local_other')], false) })
  expect(kept.tickets.pairings.map(p => p.ticket)).toEqual(['ft-b'])
  expect(kept.tickets.held).toEqual([])
  const gone = read(t, [row('ft-b')], T0 + MINUTE, { sessions: list([listed('local_other')], true) })
  expect(gone.tickets.pairings).toEqual([])
  expect(gone.tickets.held).toEqual(['ABC-2'])
})

test('an archived claimed sub session is held, with a notification only when no failed begin was told already, and the next one begins', () => {
  const archived = listed('local_ft-b', { isArchived: true, surelyUnarchived: false })
  const notices = (d: Decision) => d.effects.flatMap(e => (e.kind === 'notify' ? [e.text] : []))
  for (const notified of [true, false]) {
    const t = ledger(waiting('ft-b', 'ABC-2', 1, { attemptAt: T0, notified }), waiting('ft-c', 'ABC-3', 2))
    const d = read(t, [row('ft-b'), row('ft-c')], T0 + MINUTE, { sessions: list([archived, listed('local_ft-c')]) })
    expect(d.tickets.held).toEqual(['ABC-2'])
    expect(notices(d)).toEqual(notified ? [] : ['ABC-2 waits to start: foreman could not begin its waiting session, and it starts on your next message.'])
    expect(d.logs).toContain('Held ABC-2, because its waiting session is archived or no longer listed and foreman could not begin it.')
    expect(begins(d)).toEqual([['local_ft-c', 'ABC-3', null]])
  }
  const already = { ...ledger(waiting('ft-b', 'ABC-2', 1, { attemptAt: T0, notified: false })), held: ['ABC-2'] }
  expect(notices(read(already, [row('ft-b')], T0 + MINUTE, { sessions: list([archived]) }))).toEqual([])
})

test('the list is read while anyone waits', () => {
  expect(needsList(ledger(waiting('ft-b', 'ABC-2', 1)), [], T0)).toBe(true)
  expect(needsList(ledger(ahead('ft-a', 'ABC-1')), [], T0)).toBe(false)
})

test('a begun sub session that sat idle while it waited is nudged only a threshold after its begin', () => {
  // Its begin set the pairing time to the moment the message went.
  const begun = { ...ahead('ft-b', 'ABC-2', T0 + 20 * MINUTE) }
  const rows = [row('ft-b')]
  expect(read(ledger(begun), rows, T0 + 21 * MINUTE).effects).toEqual([])
  expect(read(ledger(begun), rows, T0 + 20 * MINUTE + T).effects).toEqual([{ kind: 'nudge', to: 'local_ft-b', name: 'the sub session with no issue yet' }])
})
