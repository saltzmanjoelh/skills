import { expect, test } from 'claude-code/testing'

import { CALL_TIMEOUT_MS, decide, DRY_AGAIN_LOG, freedSlotIn, freeSlots, GONE_MS, needsList, releasedIn, startWaits, UNOWNED_FOR_MS, type DecideInput, type Decision, type SessionsLook } from '../hooks/act'
import type { Listed } from '../hooks/desktop'
import { recordIn } from '../hooks/record'
import type { SubRow } from '../hooks/subs'
import { joinOwners, MAX_PAIRINGS, newPairing, queuedShown, TICKETS_EMPTY, waitingUnclaimed } from '../hooks/tickets'
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
  return decide({ tickets: joined, rows, now, limits: LIMITS, sessions: { kind: 'unread' }, folderExists: true, listed: true, watchingSince: 0, slots: 1, ...over })
}

const begins = (d: Decision) => d.effects.flatMap(e => (e.kind === 'begin' ? [[e.to, e.key, e.by]] : []))

test('a waiting sub session whose file shows it idle with no issue is never nudged and never wakes the parent', () => {
  let t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  // Both sessions run, so builder rewrites both files at each read.
  const rows = (now: number) => [busyRow('ft-a', 'ABC-1'), row('ft-b')].map(r => ({ ...r, mtimeMs: now }))
  for (let now = T0; now <= T0 + 4 * T; now += MINUTE) {
    const d = read(t, rows(now), now, { sessions: list([listed('local_ft-a'), listed('local_ft-b')]) })
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

test('two freed slots and one waiting sub session begin it and report the dry queue for the slot left free', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'), waiting('ft-b', 'ABC-2', 1))
  const gone = { isArchived: true, isRunning: false, surelyUnarchived: false }
  const sessions = list([listed('local_ft-a', gone), listed('local_ft-x', gone), listed('local_ft-b')])
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-x', { issueKey: 'ABC-4', state: 'done' }), row('ft-b')]
  const d = read(t, rows, T0 + MINUTE, { sessions, slots: 2 })
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(d.reasons).toEqual([{ kind: 'queue-dry' }])
})

test('a freed slot that no waiting sub session can take, because the list leaves it out, is kept for it with the kept sentence, once, until a list shows it', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-b')]
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false })], false)
  const d = read(t, rows, T0 + MINUTE, { sessions })
  expect(begins(d)).toEqual([])
  expect(d.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
  expect(d.tickets.keptSlots).toEqual([])
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-b')!.queue).toEqual({ place: 1, claim: null, keptAt: T0 + MINUTE })
  // The same state on the next read sends nothing more.
  const again = read(d.tickets, rows, T0 + MINUTE + 1_000, { sessions })
  expect(again.reasons).toEqual([])
  expect(begins(again)).toEqual([])
  // Once the slot is no longer kept for the parent's begin by hand, a read
  // whose list shows the waiting session claims the slot that stayed free.
  const shown = read(again.tickets, rows, T0 + MINUTE + GONE_MS + 1, { sessions: list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false }), listed('local_ft-b')], false) })
  expect(begins(shown)).toEqual([['local_ft-b', 'ABC-2', null]])
  expect(shown.reasons).toEqual([])
})

test('a freed slot while a sub session waits unclaimed gives no kept sentence when the slot count has dropped so that no slot is free', () => {
  // Two sub sessions went ahead and the slot count has since dropped to one,
  // which ft-c still takes, so the slot that ft-a frees leaves none free.
  const t = ledger(ahead('ft-a', 'ABC-1'), ahead('ft-c', 'ABC-3'), waiting('ft-b', 'ABC-2', 1))
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), busyRow('ft-c', 'ABC-3'), row('ft-b')]
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false }), listed('local_ft-c')], false)
  const d = read(t, rows, T0 + MINUTE, { sessions, slots: 1 })
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-a')!.standing).toBe('freed')
  expect(begins(d)).toEqual([])
  expect(d.reasons).toEqual([])
})

test('two freed slots with one claim give the kept sentence while a second sub session waits unseen, naming only that one', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'), waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2))
  const gone = { isArchived: true, isRunning: false, surelyUnarchived: false }
  const sessions = list([listed('local_ft-a', gone), listed('local_ft-x', gone), listed('local_ft-b')])
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-x', { issueKey: 'ABC-4', state: 'done' }), row('ft-b'), row('ft-c')]
  const d = read(t, rows, T0 + MINUTE, { sessions, slots: 2 })
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(d.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-3'] }])
})

test('one freed slot while two sub sessions wait unseen gives the kept sentence naming only the first in the queue', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'), waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2))
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false }), listed('local_ft-x')])
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), busyRow('ft-x', 'ABC-4'), row('ft-b'), row('ft-c')]
  const d = read(t, rows, T0 + MINUTE, { sessions, slots: 2 })
  expect(begins(d)).toEqual([])
  expect(d.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
})

test('a waiting sub session whose name a wake line may not carry is left out of the kept sentence', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('bad ticket', 'not a key', 1))
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false })], false)
  const d = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('bad ticket')], T0 + MINUTE, { sessions })
  expect(d.reasons).toEqual([{ kind: 'slot-kept', whos: [] }])
  // The sentence cannot name the waiting sub session, but it still stands
  // for it, so its slot is kept for it all the same.
  expect(d.tickets.pairings.find(p => p.ticket === 'bad ticket')!.queue).toEqual({ place: 1, claim: null, keptAt: T0 + MINUTE })
})

test('the kept sentence stamps the pairing it stands for, not every pairing that shares its ticket', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1), waiting('ft-b', 'ABC-3', 2, null, 'local_other'))
  const sessions = list([listed('local_ft-a', { isArchived: true, isRunning: false, surelyUnarchived: false })])
  const d = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'done' })], T0 + MINUTE, { sessions })
  expect(d.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
  const shared = d.tickets.pairings.filter(p => p.ticket === 'ft-b')
  expect(shared.map(p => p.queue)).toEqual([{ place: 1, claim: null, keptAt: T0 + MINUTE }, { place: 2, claim: null }])
})

test('a claim for a pairing that shares its ticket with a reserved one never reaches the reserved one', () => {
  const kept = { ...waiting('ft-b', 'ABC-2', 1), queue: { place: 1, claim: null, keptAt: T0 } }
  const twin = waiting('ft-b', 'ABC-3', 2, null, 'local_other')
  const sessions = list([listed('local_ft-b'), listed('local_other')])
  const d = read(ledger(kept, twin), [], T0 + MINUTE, { sessions, slots: 2 })
  expect(begins(d)).toEqual([['local_other', 'ABC-3', null]])
  const shared = d.tickets.pairings.filter(p => p.ticket === 'ft-b')
  expect(shared[0]!.queue).toEqual({ place: 1, claim: null, keptAt: T0 })
  expect(shared[1]!.queue!.claim).toEqual({ attemptAt: T0 + MINUTE, notified: false })
})

// The desktop app's entry for a session that is archived.
const ARCHIVED = { isArchived: true, isRunning: false, surelyUnarchived: false }
const OPEN_PR = { number: 7, url: 'https://example.com/pull/7', state: 'OPEN', verdicts: null }
const overLog = (who: string, how: string, state: string, pr: string) => `The session of ${who} ${how} while its status file says ${state}, with ${pr}, so its slot is free.`

test('an active sub session whose file never said done frees its slot once the list shows it archived, and the queue begins the waiting one in it', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'waiting-on-builder' }), row('ft-b')]
  const sessions = list([listed('local_ft-a', ARCHIVED), listed('local_ft-b')])
  const d = read(t, rows, T0 + MINUTE, { sessions })
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-a')!.standing).toBe('freed')
  expect(d.logs).toContain(overLog('ABC-1', 'is archived', 'waiting-on-builder', 'no pull request'))
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(d.reasons).toEqual([])
  // A later read, before the claim's begin is due to be tried again, frees
  // nothing more.
  const again = read(d.tickets, rows, T0 + MINUTE + 1_000, { sessions })
  expect(again.logs.filter(l => l.endsWith('so its slot is free.'))).toEqual([])
  expect(again.reasons).toEqual([])
  expect(begins(again)).toEqual([])
  // With a pull request, the log line gives its number.
  const withPr = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'working', stage: 'build', pr: OPEN_PR }), row('ft-b')], T0 + MINUTE, { sessions })
  expect(withPr.logs).toContain(overLog('ABC-1', 'is archived', 'working', 'pull request #7'))
  expect(begins(withPr)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
})

test('an archived done record whose pull request merged keeps the done line, and a file that already left the folder frees its slot once', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const sessions = list([listed('local_ft-a', ARCHIVED), listed('local_ft-b')])
  const merged = row('ft-a', { issueKey: 'ABC-1', state: 'done', pr: { ...OPEN_PR, state: 'MERGED' } })
  const d = read(t, [merged, row('ft-b')], T0 + MINUTE, { sessions })
  expect(d.logs.filter(l => l.endsWith('so its slot is free.'))).toEqual(['ABC-1 is done and its session is archived, so its slot is free.'])
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  const left = read(owned([busyRow('ft-a', 'ABC-1'), row('ft-b')], ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1)), [row('ft-b')], T0 + MINUTE, { sessions })
  expect(left.logs.filter(l => l.includes('slot'))).toEqual(['The slot of ABC-1 is free, because its file left the status folder.'])
  expect(begins(left)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
})

test('an archived idle record with a nudge due is freed and not nudged', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'))
  const idle = row('ft-a', { issueKey: 'ABC-1', state: 'idle', stage: 'build' })
  expect(read(t, [idle], T0 + T).effects).toEqual([{ kind: 'nudge', to: 'local_ft-a', name: 'ABC-1' }])
  const d = read(t, [idle], T0 + T, { sessions: list([listed('local_ft-a', ARCHIVED)]) })
  expect(d.effects).toEqual([])
  expect(d.tickets.pairings[0]!.standing).toBe('freed')
  expect(d.reasons).toEqual([{ kind: 'queue-dry' }])
})

test('an active sub session missing from a whole list whose id the ledger held frees its slot, and one that may have been left out keeps it', () => {
  const working = row('ft-a', { issueKey: 'ABC-1', state: 'working', stage: 'build' })
  const freed = read(ledger(ahead('ft-a', 'ABC-1')), [working], T0 + MINUTE, { sessions: list([listed('local_other')], true) })
  expect(freed.tickets.pairings[0]!.standing).toBe('freed')
  expect(freed.logs).toContain(overLog('ABC-1', 'is no longer listed', 'working', 'no pull request'))
  expect(freed.reasons).toEqual([{ kind: 'queue-dry' }])
  const standing = (d: Decision) => d.tickets.pairings[0]!.standing
  // A list that may have left it out.
  expect(standing(read(ledger(ahead('ft-a', 'ABC-1')), [working], T0 + MINUTE, { sessions: list([listed('local_other')], false) }))).toBe('active')
  // An id the ledger learned while the list call was out.
  expect(standing(read(ledger(ahead('ft-a', 'ABC-1')), [working], T0 + MINUTE, { sessions: list([listed('local_other')], true, ['local_other']) }))).toBe('active')
  // A pairing with no desktop session id at all.
  const unnamed = row('ft-a', { issueKey: 'ABC-1', state: 'working', stage: 'build', desktopSessionId: null })
  expect(standing(read(ledger(newPairing('ft-a', null, T0, 'ABC-1')), [unnamed], T0 + MINUTE, { sessions: list([listed('local_other')], true) }))).toBe('active')
})

// A ledger whose ft-a went ahead and owns its file, with `waiters` in the
// queue, so a read without ft-a's file frees its slot.
const owned = (rows: SubRow[], ...pairings: ForemanPairing[]) => joinOwners(ledger(...pairings), rows).tickets
const keptLog = (who: string) => `Kept the slot of ${who} for the queue, because the desktop app's list of sessions could not be read.`

test('a slot freed on a read whose list could not be read is kept for an unclaimed waiting issue, and wakes nobody', () => {
  const t = owned([busyRow('ft-a', 'ABC-1'), row('ft-b')], ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const d = read(t, [row('ft-b')], T0 + MINUTE, { sessions: { kind: 'failed' } })
  expect(d.reasons).toEqual([])
  expect(begins(d)).toEqual([])
  expect(d.tickets.keptSlots).toEqual(['ABC-1'])
  expect(d.logs).toContain(keptLog('ABC-1'))
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-b')!.queue).toEqual({ place: 1, claim: null })
})

test('the next read that reads the list decides a kept slot as if it had freed then', () => {
  const t = owned([busyRow('ft-a', 'ABC-1'), row('ft-b')], ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1))
  const kept = read(t, [row('ft-b')], T0 + MINUTE, { sessions: { kind: 'failed' } }).tickets
  const shown = read(kept, [row('ft-b')], T0 + 2 * MINUTE, { sessions: list([listed('local_ft-b')]) })
  expect(begins(shown)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(shown.reasons).toEqual([])
  expect(shown.tickets.keptSlots).toEqual([])
  const left = read(kept, [row('ft-b')], T0 + 2 * MINUTE, { sessions: list([listed('local_other')], false) })
  expect(begins(left)).toEqual([])
  expect(left.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
  expect(left.tickets.keptSlots).toEqual([])
})

test('a kept slot reports the dry queue on a read whose list could not be read once nobody waits unclaimed', () => {
  const d = read({ ...ledger(), keptSlots: ['ABC-1'] }, [], T0, { sessions: { kind: 'failed' } })
  expect(d.reasons).toEqual([{ kind: 'queue-dry' }])
  expect(d.tickets.keptSlots).toEqual([])
  // The waiting issue began by itself before any list was read.
  const begun = { ...owned([row('ft-b')], waiting('ft-b', 'ABC-2', 1)), keptSlots: ['ABC-1'] }
  const after = read(begun, [row('ft-b', { issueKey: 'ABC-2', stage: 'spec' })], T0, { sessions: { kind: 'failed' }, slots: 2 })
  expect(after.reasons).toEqual([{ kind: 'queue-dry' }])
  expect(after.tickets.keptSlots).toEqual([])
})

test('slots freed on failed reads pile up in order and are all decided by the next read that reads the list', () => {
  const rows = [busyRow('ft-a', 'ABC-1'), busyRow('ft-x', 'ABC-4'), row('ft-b')]
  const t = owned(rows, ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'), waiting('ft-b', 'ABC-2', 1))
  const together = read(t, [row('ft-b')], T0 + MINUTE, { sessions: { kind: 'failed' }, slots: 2 })
  expect(together.tickets.keptSlots).toEqual(['ABC-1', 'ABC-4'])
  const first = read(t, [busyRow('ft-x', 'ABC-4'), row('ft-b')], T0 + MINUTE, { sessions: { kind: 'failed' }, slots: 2 })
  const second = read(first.tickets, [row('ft-b')], T0 + 2 * MINUTE, { sessions: { kind: 'failed' }, slots: 2 })
  expect(second.reasons).toEqual([])
  expect(second.tickets.keptSlots).toEqual(['ABC-1', 'ABC-4'])
  const d = read(second.tickets, [row('ft-b')], T0 + 3 * MINUTE, { sessions: list([listed('local_ft-b')]), slots: 2 })
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', 'ABC-1']])
  expect(d.reasons).toEqual([{ kind: 'queue-dry' }])
  expect(d.tickets.keptSlots).toEqual([])
})

test('a slot freed on a failed read reports the dry queue at once when only claimed sessions wait, and wakes with the kept sentence when its name could not be stored', () => {
  const claimed = owned([busyRow('ft-a', 'ABC-1'), row('ft-b')], ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1, { attemptAt: T0, notified: false }))
  const d = read(claimed, [row('ft-b')], T0 + MINUTE, { sessions: { kind: 'failed' }, slots: 2 })
  expect(d.reasons).toEqual([{ kind: 'queue-dry' }])
  expect(d.tickets.keptSlots).toEqual([])
  // A damaged stored ticket gives a name that the ledger's reader would drop.
  const damaged = owned([busyRow('bad ticket', 'not a key'), row('ft-b')], ahead('bad ticket', 'not a key'), waiting('ft-b', 'ABC-2', 1))
  const woken = read(damaged, [row('ft-b')], T0 + MINUTE, { sessions: { kind: 'failed' } })
  expect(woken.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
  expect(woken.tickets.keptSlots).toEqual([])
})

test('a Release while an issue waits carries the released name, two Releases before a read carry both names in order, and the list keeps the newest names', () => {
  const rows = [busyRow('ft-a', 'ABC-1'), busyRow('ft-d', 'ABC-4'), row('ft-b')]
  const t = joinOwners(ledger(ahead('ft-a', 'ABC-1'), ahead('ft-d', 'ABC-4'), waiting('ft-b', 'ABC-2', 1)), rows).tickets
  const first = releasedIn(t, rows[0]!, T0 + MINUTE)
  expect([first.released, first.waits]).toEqual([true, true])
  expect(first.tickets.keptSlots).toEqual(['ABC-1'])
  expect(first.tickets.pairings[0]!.standing).toBe('released')
  const second = releasedIn(first.tickets, rows[1]!, T0 + MINUTE)
  expect(second.tickets.keptSlots).toEqual(['ABC-1', 'ABC-4'])
  // A second press on a row already released changes nothing.
  const again = releasedIn(second.tickets, rows[1]!, T0 + MINUTE)
  expect([again.released, again.tickets]).toEqual([false, second.tickets])
  const full = { ...t, keptSlots: Array.from({ length: MAX_PAIRINGS }, (_, i) => `ABC-${100 + i}`) }
  const capped = releasedIn(full, rows[0]!, T0 + MINUTE).tickets.keptSlots
  expect([capped.length, capped[0], capped.at(-1)]).toEqual([MAX_PAIRINGS, 'ABC-101', 'ABC-1'])
})

test('a Release while nobody waits unclaimed carries no name, and a damaged ticket\'s name is not carried', () => {
  const rows = [busyRow('ft-a', 'ABC-1'), row('ft-b')]
  const alone = joinOwners(ledger(ahead('ft-a', 'ABC-1')), rows.slice(0, 1)).tickets
  const none = releasedIn(alone, rows[0]!, T0 + MINUTE)
  expect([none.released, none.waits, none.tickets.keptSlots]).toEqual([true, false, []])
  // A damaged stored ticket gives a name that the ledger's reader would drop.
  const badRows = [busyRow('bad ticket', 'not a key'), row('ft-b')]
  const damaged = joinOwners(ledger(ahead('bad ticket', 'not a key'), waiting('ft-b', 'ABC-2', 1)), badRows).tickets
  const out = releasedIn(damaged, badRows[0]!, T0 + MINUTE)
  expect([out.released, out.waits, out.tickets.keptSlots]).toEqual([true, true, []])
})

test('with the queue empty a freed slot reports the dry queue once, wakes nobody, and a later freed slot reports nothing', () => {
  const rows = [busyRow('ft-a', 'ABC-1'), busyRow('ft-x', 'ABC-4')]
  const t = owned(rows, ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'))
  const archived = list([listed('local_ft-a', ARCHIVED), listed('local_ft-x')])
  const d = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), rows[1]!], T0 + MINUTE, { sessions: archived, slots: 2 })
  expect(d.reasons).toEqual([{ kind: 'queue-dry' }])
  expect(d.effects).toEqual([])
  expect(d.tickets.dryNotified).toBe(true)
  const later = read(d.tickets, [], T0 + 2 * MINUTE, { slots: 2 })
  expect(later.reasons).toEqual([])
  expect(later.effects).toEqual([])
  expect(later.logs).toContain(DRY_AGAIN_LOG)
})

test('the queue shown leaves out a proposal card nobody started once the gone wait is over, as the waiting count does', () => {
  const card = waiting('ft-c', 'ABC-3', 2, null, null)
  const t = ledger(waiting('ft-b', 'ABC-2', 1), card, waiting('ft-d', 'ABC-4', 3, { attemptAt: T0, notified: false }))
  expect(queuedShown(t, T0 + GONE_MS, GONE_MS).map(p => p.ticket)).toEqual(['ft-b', 'ft-c', 'ft-d'])
  expect(queuedShown(t, T0 + GONE_MS + 1, GONE_MS).map(p => p.ticket)).toEqual(['ft-b', 'ft-d'])
  const released = { ...t, pairings: t.pairings.map(p => (p.ticket === 'ft-b' ? { ...p, standing: 'released' as const } : p)) }
  expect(queuedShown(released, T0, GONE_MS).map(p => p.ticket)).toEqual(['ft-c', 'ft-d'])
})

test('a slot freed outside a read, as by Release, reports the dry queue once, and a waiting sub session arms it again', () => {
  const rows = [busyRow('ft-a', 'ABC-1')]
  const t = owned(rows, ahead('ft-a', 'ABC-1'))
  const first = freedSlotIn(releasedIn(t, rows[0]!, T0 + MINUTE).tickets, rows, T0 + MINUTE, 1)
  expect(first.reasons).toEqual([{ kind: 'queue-dry' }])
  expect(first.tickets.dryNotified).toBe(true)
  const again = freedSlotIn(first.tickets, rows, T0 + MINUTE, 1)
  expect([again.reasons, again.logs]).toEqual([[], [DRY_AGAIN_LOG]])
  // A claimed waiting sub session in the queue arms the report again.
  const claimed = { ...first.tickets, pairings: [...first.tickets.pairings, waiting('ft-b', 'ABC-2', 1, { attemptAt: T0, notified: false })] }
  const rearmed = freedSlotIn(claimed, rows, T0 + MINUTE, 2)
  expect(rearmed.reasons).toEqual([{ kind: 'queue-dry' }])
  // A proposal card older than the gone wait does not.
  const card = { ...first.tickets, pairings: [...first.tickets.pairings, waiting('ft-c', 'ABC-3', 1, null, null)] }
  expect(freedSlotIn(card, rows, T0 + GONE_MS + MINUTE, 1).reasons).toEqual([])
  // With no slot free, nothing happens at all.
  const busy = owned(rows, ahead('ft-a', 'ABC-1'))
  expect(freedSlotIn(busy, rows, T0 + MINUTE, 1)).toEqual({ tickets: busy, reasons: [], logs: [] })
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

// The slot that the kept sentence names stays kept for the named waiting sub
// session for GONE_MS, so that the parent can begin it by hand and nothing
// else takes the slot meanwhile.

const lapseLog = (who: string) => `The slot kept for ${who} is no longer kept, because its waiting session showed no progress within five minutes.`

// A waiting pairing that the kept sentence named on a read at `keptAt`.
const kept = (ticket: string, key: string, place: number, keptAt: number): ForemanPairing => ({ ...waiting(ticket, key, place), queue: { place, claim: null, keptAt } })

// With one slot, ft-a is done and archived while ft-b and ft-c wait, and the
// list shows neither of them, so the read at T0 + MINUTE wakes the parent
// with the kept sentence for ft-b.
function keptForB() {
  const t = ledger(ahead('ft-a', 'ABC-1'), waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2))
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-b'), row('ft-c')]
  const d = read(t, rows, T0 + MINUTE, { sessions: list([listed('local_ft-a', ARCHIVED)], false) })
  return { d, rows }
}

test('the read that wakes the parent with the kept sentence stamps the named waiting session, and a read a minute later begins no other waiting session in its slot', () => {
  const { d, rows } = keptForB()
  expect(d.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-b')!.queue).toEqual({ place: 1, claim: null, keptAt: T0 + MINUTE })
  expect(d.tickets.pairings.find(p => p.ticket === 'ft-c')!.queue).toEqual({ place: 2, claim: null })
  const later = read(d.tickets, rows, T0 + 2 * MINUTE, { sessions: list([listed('local_ft-a', ARCHIVED), listed('local_ft-c')], false) })
  expect(begins(later)).toEqual([])
  expect(later.reasons).toEqual([])
  expect(later.tickets.pairings.find(p => p.ticket === 'ft-c')!.queue).toEqual({ place: 2, claim: null })
})

test('a second slot that frees while a slot is kept gives the kept sentence naming the next waiting session, never the one already named', () => {
  const t = ledger(ahead('ft-a', 'ABC-1'), ahead('ft-x', 'ABC-4'), waiting('ft-b', 'ABC-2', 1), waiting('ft-c', 'ABC-3', 2), waiting('ft-d', 'ABC-5', 3))
  const waiters = [row('ft-b'), row('ft-c'), row('ft-d')]
  const first = read(t, [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), busyRow('ft-x', 'ABC-4'), ...waiters], T0 + MINUTE, { sessions: list([listed('local_ft-a', ARCHIVED), listed('local_ft-x')], false), slots: 2 })
  expect(first.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-2'] }])
  const rows = [row('ft-a', { issueKey: 'ABC-1', state: 'done' }), row('ft-x', { issueKey: 'ABC-4', state: 'done' }), ...waiters]
  const second = read(first.tickets, rows, T0 + 2 * MINUTE, { sessions: list([listed('local_ft-a', ARCHIVED), listed('local_ft-x', ARCHIVED)], false), slots: 2 })
  expect(begins(second)).toEqual([])
  expect(second.reasons).toEqual([{ kind: 'slot-kept', whos: ['ABC-3'] }])
  const queues = new Map(second.tickets.pairings.map(p => [p.ticket, p.queue]))
  expect(queues.get('ft-b')).toEqual({ place: 1, claim: null, keptAt: T0 + MINUTE })
  expect(queues.get('ft-c')).toEqual({ place: 2, claim: null, keptAt: T0 + 2 * MINUTE })
  expect(queues.get('ft-d')).toEqual({ place: 3, claim: null })
})

test('a waiting session whose slot is kept gets no claim and no begin message from foreman while the slot is kept, even when the list shows it open', () => {
  const { d, rows } = keptForB()
  let t = d.tickets
  for (const minutes of [2, 3, 5]) {
    const later = read(t, rows, T0 + minutes * MINUTE, { sessions: list([listed('local_ft-a', ARCHIVED), listed('local_ft-b'), listed('local_ft-c')], false) })
    expect([minutes, begins(later), later.reasons]).toEqual([minutes, [], []])
    expect(later.tickets.pairings.find(p => p.ticket === 'ft-b')!.queue).toEqual({ place: 1, claim: null, keptAt: T0 + MINUTE })
    t = later.tickets
  }
})

test('the first read more than five minutes after the stamp logs the end of the kept slot once, clears the stamp and begins the session', () => {
  const t = ledger(kept('ft-b', 'ABC-2', 1, T0))
  const rows = [row('ft-b')]
  const sessions = list([listed('local_ft-b')])
  const last = read(t, rows, T0 + GONE_MS, { sessions })
  expect(begins(last)).toEqual([])
  expect(last.logs).toEqual([])
  const lapsed = read(last.tickets, rows, T0 + GONE_MS + 1, { sessions })
  expect(lapsed.logs.filter(l => l === lapseLog('ABC-2'))).toHaveLength(1)
  expect(begins(lapsed)).toEqual([['local_ft-b', 'ABC-2', null]])
  expect(lapsed.tickets.pairings[0]!.queue).toEqual({ place: 1, claim: { attemptAt: T0 + GONE_MS + 1, notified: false } })
  expect('keptAt' in lapsed.tickets.pairings[0]!.queue!).toBe(false)
  expect(lapsed.reasons).toEqual([])
  const after = read(lapsed.tickets, rows, T0 + GONE_MS + MINUTE, { sessions })
  expect(after.logs).not.toContain(lapseLog('ABC-2'))
})

test('a kept slot whose waiting session the list does not show ends with one log line, and the session waits unclaimed as before', () => {
  const t = ledger(kept('ft-b', 'ABC-2', 1, T0))
  const rows = [row('ft-b')]
  const sessions = list([], false)
  const lapsed = read(t, rows, T0 + GONE_MS + MINUTE, { sessions })
  expect(lapsed.logs).toEqual([lapseLog('ABC-2')])
  expect(lapsed.effects).toEqual([])
  expect(lapsed.reasons).toEqual([])
  expect(lapsed.tickets.pairings[0]!.queue).toEqual({ place: 1, claim: null })
  expect('keptAt' in lapsed.tickets.pairings[0]!.queue!).toBe(false)
  const again = read(lapsed.tickets, rows, T0 + GONE_MS + 2 * MINUTE, { sessions })
  expect(again.logs).toEqual([])
})

test('a stamp later than the clock ends the kept slot on the next read', () => {
  const t = ledger(kept('ft-b', 'ABC-2', 1, T0 + 10 * MINUTE))
  const d = read(t, [row('ft-b')], T0, { sessions: list([listed('local_ft-b')]) })
  expect(d.logs).toContain(lapseLog('ABC-2'))
  expect(begins(d)).toEqual([['local_ft-b', 'ABC-2', null]])
})

test('a kept slot ends early when its waiting session shows progress, which counts as busy, or when the list shows it archived, which drops it with no held key', () => {
  const t = ledger(kept('ft-b', 'ABC-2', 1, T0))
  const progress = [row('ft-b', { issueKey: 'ABC-2' })]
  const begun = read(t, progress, T0 + MINUTE, { sessions: list([listed('local_ft-b')]) })
  expect(begun.tickets.pairings[0]!.queue).toBeNull()
  expect(begun.logs).toEqual(['ABC-2 began before foreman\'s begin message, so foreman counts it as busy.'])
  expect(freeSlots(begun.tickets, progress, T0 + MINUTE, 1)).toBe(0)
  expect(begins(begun)).toEqual([])
  const archived = read(t, [row('ft-b')], T0 + MINUTE, { sessions: list([listed('local_ft-b', ARCHIVED)]) })
  expect(archived.tickets.pairings).toEqual([])
  expect(archived.tickets.held).toEqual([])
  expect(archived.effects).toEqual([])
  expect(archived.logs).toEqual(['Dropped ABC-2 from the queue, because its waiting session is archived.'])
})

test('a waiting session whose slot is kept counts as busy, is not owed another slot, and is counted once by a start, until the five minutes are over', () => {
  const rows = [row('ft-w')]
  const plain = joinOwners(ledger(waiting('ft-w', 'ABC-9', 1)), rows).tickets
  const stamped = joinOwners(ledger(kept('ft-w', 'ABC-9', 1, T0)), rows).tickets
  const now = T0 + MINUTE
  expect(freeSlots(plain, rows, now, 3)).toBe(3)
  expect(freeSlots(stamped, rows, now, 3)).toBe(2)
  expect(waitingUnclaimed(plain, now, GONE_MS).map(p => p.ticket)).toEqual(['ft-w'])
  expect(waitingUnclaimed(stamped, now, GONE_MS)).toEqual([])
  expect(startWaits(stamped, rows, now, 2)).toBe(false)
  expect(startWaits(stamped, rows, now, 1)).toBe(true)
  const over = T0 + GONE_MS + 1
  expect(freeSlots(stamped, rows, over, 3)).toBe(3)
  expect(waitingUnclaimed(stamped, over, GONE_MS).map(p => p.ticket)).toEqual(['ft-w'])
  expect(startWaits(stamped, rows, over, 2)).toBe(false)
})
