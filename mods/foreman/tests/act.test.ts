import { expect, test } from 'claude-code/testing'

import { decide, GONE_MS, needsList, type DecideInput, type Decision, type SessionsLook } from '../hooks/act'
import { recordIn } from '../hooks/record'
import { spentSum } from '../hooks/spend'
import type { SubRow } from '../hooks/subs'
import { joinOwners, newPairing, TICKETS_EMPTY } from '../hooks/tickets'
import { DATA_NOTE, wakeLine } from '../hooks/wake'
import type { ForemanStanding, ForemanTickets } from '../types'

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

const running: SessionsLook = { kind: 'read', sessions: [{ sessionId: 'local_a', isArchived: false, isRunning: true, title: null, surelyUnarchived: true }] }

// A parent with one pairing for ticket ft-a.
const paired = (localId: string | null = 'local_a'): ForemanTickets => ({ ...TICKETS_EMPTY, pairings: [newPairing('ft-a', localId, T0)] })

// One read: the rows joined to the ledger, then the decision.
function read(tickets: ForemanTickets, rows: SubRow[], now: number, over: Partial<DecideInput> = {}): Decision {
  const joined = joinOwners(tickets, rows).tickets
  return decide({ tickets: joined, rows, now, limits: LIMITS, sessions: { kind: 'unread' }, folderExists: true, listed: true, slots: 2, ...over })
}

// Reads every minute from T0 to `until`, with `rowAt` giving the rows at each
// moment, and answers what each read did.
function readEvery(tickets: ForemanTickets, rowAt: (now: number) => SubRow[], until: number, over: Partial<DecideInput> = {}) {
  const seen: { at: number; nudges: number; reasons: string[] }[] = []
  let t = tickets
  for (let now = T0; now <= until; now += MINUTE) {
    const d = read(t, rowAt(now), now, over)
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
  expect(d.effects).toEqual([{ kind: 'nudge', to: 'local_a', name: 'ABC-1' }])
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

test('progress inside an unchanged idle episode still counts from the episode, as before background waits', () => {
  const progressed = (now: number) => ((now - T0) / MINUTE < 3 ? [row()] : [row({ stageDone: 5 })])
  expect(readEvery(paired(), progressed, T0 + 11 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
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
  const look = (s: { isArchived: boolean; isRunning: boolean }[]): SessionsLook => ({ kind: 'read', sessions: s.map(x => ({ sessionId: 'local_a', title: null, surelyUnarchived: !x.isArchived, ...x })) })
  expect(read(paired(), done, T0, { sessions: look([{ isArchived: false, isRunning: true }]) }).tickets.pairings[0]!.standing).toBe('active')
  for (const sessions of [look([{ isArchived: true, isRunning: false }]), look([{ isArchived: false, isRunning: false }]), look([])]) {
    const d = read(paired(), done, T0, { sessions })
    expect(d.tickets.pairings[0]!.standing).toBe('freed')
    expect(d.reasons).toEqual([{ kind: 'slot-free', free: 2 }])
  }
  expect(read(paired(), done, T0, { sessions: { kind: 'failed' } }).tickets.pairings[0]!.standing).toBe('active')
})

test('a record whose file leaves while its pull request was last told open wakes with the merged sentence before the slot-free one', () => {
  const open = read(paired(), [row({ state: 'working', pr: pr(7) })], T0)
  const left = read(open.tickets, [], T0 + MINUTE)
  expect(wakeLine(left.reasons)).toBe('foreman: ABC-1\'s pull request #7 merged. two slots free; pick the next issues and start them.')
  const merged = read(open.tickets, [row({ state: 'working', pr: pr(7, 'MERGED') })], T0 + MINUTE)
  expect(read(merged.tickets, [], T0 + 2 * MINUTE).reasons).toEqual([{ kind: 'slot-free', free: 2 }])
  const closed = read(open.tickets, [row({ state: 'working', pr: pr(7, 'CLOSED') })], T0 + MINUTE)
  expect(read(closed.tickets, [], T0 + 2 * MINUTE).reasons).toEqual([{ kind: 'slot-free', free: 2 }])
  const none = read(paired(), [row({ state: 'working' })], T0)
  expect(read(none.tickets, [], T0 + MINUTE).reasons).toEqual([{ kind: 'slot-free', free: 2 }])
  const released = { ...open.tickets, pairings: open.tickets.pairings.map(p => ({ ...p, standing: 'released' as const })) }
  expect(read(released, [], T0 + MINUTE).reasons).toEqual([])
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

test('a slot that frees while every slot is still busy wakes nothing', () => {
  const t: ForemanTickets = { ...TICKETS_EMPTY, pairings: [newPairing('ft-a', 'local_a', T0), newPairing('ft-b', null, T0)] }
  const rows = [row({ state: 'working' }), row({ sessionId: 's-b', ticket: 'ft-b', desktopSessionId: 'local_b', state: 'working' }, 'b.json')]
  const both = read(t, rows, T0, { slots: 1 })
  expect(read(both.tickets, [rows[1]!], T0 + MINUTE, { slots: 1 }).reasons).toEqual([])
})

test('a released or freed pairing gets no action', () => {
  // Each run builds its own pairing, joined to the same idle row that draws a
  // nudge for an active pairing, so that only the standing differs.
  const run = (standing: ForemanStanding) => {
    const t = joinOwners(paired(), [row()]).tickets
    t.pairings[0]!.standing = standing
    return { standing, seen: readEvery(t, () => [row()], T0 + 30 * MINUTE) }
  }
  // The same setup with the pairing active is nudged, so an empty result
  // below cannot come from a setup that would never act at all.
  const active = run('active')
  expect({ standing: active.standing, nudged: active.seen.some(s => s.nudges > 0) }).toEqual({ standing: 'active', nudged: true })
  expect((['released', 'freed'] as const).map(run)).toEqual([
    { standing: 'released', seen: [] },
    { standing: 'freed', seen: [] },
  ])
})

test('a sub session whose file stopped and whose session is not running wakes the parent once, unless its pull request merged', () => {
  const stopped = [row({ state: 'working' }, 'a.json', T0)]
  const notRunning: SessionsLook = { kind: 'read', sessions: [{ sessionId: 'local_a', isArchived: false, isRunning: false, title: null, surelyUnarchived: true }] }
  const later = T0 + GONE_MS + MINUTE
  let d = read(paired(), stopped, later, { sessions: notRunning })
  expect(d.reasons).toEqual([{ kind: 'gone', who: 'ABC-1', minutes: 6 }])
  d = read(d.tickets, stopped, later + MINUTE, { sessions: notRunning })
  expect(d.reasons).toEqual([])
  expect(read(paired(), stopped, later, { sessions: running }).reasons).toEqual([])
  // A merged pull request gets no gone wake. A new pairing that first reads
  // it is told of the opening and the merge instead.
  expect(read(paired(), [row({ state: 'working', pr: { repo: 'o/r', number: 7, state: 'MERGED', checks: 'passed' } })], later, { sessions: notRunning }).reasons.map(r => r.kind))
    .toEqual(['opened', 'merged'])
  expect(read(paired(), stopped, later, { sessions: { kind: 'failed' } }).reasons).toEqual([])
})

test('the session list is needed only for a done record or a file older than the gone threshold', () => {
  const t = joinOwners(paired(), [row()]).tickets
  expect(needsList(t, [row()], T0 + MINUTE)).toBe(false)
  expect(needsList(t, [row({ state: 'done' })], T0)).toBe(true)
  expect(needsList(t, [row()], T0 + GONE_MS + 1)).toBe(true)
  const woke = { ...t, pairings: t.pairings.map(p => ({ ...p, acts: { ...p.acts, goneWokeFor: T0 } })) }
  expect(needsList(woke, [row()], T0 + GONE_MS + 1)).toBe(false)
})

test('a pairing that no status file carried for a day is forgotten, and a younger one is kept', () => {
  const young = read(paired(), [], T0 + 23 * 60 * MINUTE)
  expect(young.tickets.pairings).toHaveLength(1)
  const old = read(paired(), [], T0 + 25 * 60 * MINUTE)
  expect(old.tickets.pairings).toEqual([])
  expect(old.logs).toEqual(['Forgot ticket ft-a, because no status file carried it for a day.'])
  expect(old.reasons).toEqual([])
  const missing = read(paired(), [], T0 + 25 * 60 * MINUTE, { folderExists: false })
  expect(missing.tickets.pairings).toHaveLength(1)
  expect(missing.logs).not.toContain('Forgot ticket ft-a, because no status file carried it for a day.')
  expect(read(paired(), [], T0 + 25 * 60 * MINUTE, { listed: false }).tickets.pairings).toHaveLength(1)
})

test('a record with no stateSince counts its episode from the read that first saw the state, and again from a change of state', () => {
  expect(readEvery(paired(), () => [row({ stateSince: null })], T0 + 6 * MINUTE)).toEqual([{ at: 5, nudges: 1, reasons: [] }])
  const changed = (now: number) => [row({ stateSince: null, state: (now - T0) / MINUTE < 3 ? 'working' : 'idle' })]
  expect(readEvery(paired(), changed, T0 + 9 * MINUTE)).toEqual([{ at: 8, nudges: 1, reasons: [] }])
})

test('a held key needs the list, and only a list that was read releases it, with a log line', () => {
  const holding: ForemanTickets = { ...TICKETS_EMPTY, held: ['ABC-7'] }
  expect(needsList(holding, [], T0)).toBe(true)
  expect(needsList(TICKETS_EMPTY, [], T0)).toBe(false)
  const shown: SessionsLook = { kind: 'read', sessions: [{ sessionId: 'local_n', isArchived: false, isRunning: false, title: 'ABC-7: short', surelyUnarchived: true }] }
  const d = read(holding, [], T0, { sessions: shown })
  expect(d.tickets.held).toEqual([])
  expect(d.logs).toEqual(['Stopped holding ABC-7, because the desktop app\'s list shows a session for it.'])
  for (const sessions of [{ kind: 'unread' }, { kind: 'failed' }] as SessionsLook[]) expect(read(holding, [], T0, { sessions }).tickets.held).toEqual(['ABC-7'])
})

// A pull request in a record, and a verdict pair whose sha is the character
// `c` forty times.
const pr = (number: number, state = 'OPEN', verdicts: unknown = null) => ({ repo: 'o/r', number, state, checks: 'passed', verdicts })
const pair = (c: string, spec = 'APPROVE', adversarial = 'APPROVE') => ({ sha: c.repeat(40), spec, adversarial })

// Reads each record in turn, a minute apart, as a working record unless the
// case says otherwise, and answers the wake line of each read, or null, with
// the ledger after the last read.
function linesOf(records: Record<string, unknown>[], tickets = paired()) {
  let t = tickets
  const lines = records.map((over, i) => {
    const d = read(t, [row({ state: 'working', ...over })], T0 + i * MINUTE)
    t = d.tickets
    return wakeLine(d.reasons)
  })
  return { lines, tickets: t }
}

const OPENED = 'ABC-1 opened pull request #7.'
const verdictWords = (c: string, spec: string, adversarial: string) => `ABC-1's pull request #7 has verdicts at ${c.repeat(7)}: spec ${spec}, adversarial ${adversarial}.`
const line = (...sentences: string[]) => `foreman: ${sentences.join(' ')}`

test('a new pairing whose record gains a pull request wakes once with the opened sentence, and not on the next read', () => {
  expect(linesOf([{}, { pr: pr(7) }, { pr: pr(7) }]).lines).toEqual([null, line(OPENED), null])
})

test('a new verdict pair wakes once, with each verdict in words', () => {
  const pairs = [{ pr: pr(7) }, { pr: pr(7, 'OPEN', pair('a', 'REQUEST_CHANGES', 'APPROVE')) }, { pr: pr(7, 'OPEN', pair('a', 'REQUEST_CHANGES', 'APPROVE')) }]
  expect(linesOf(pairs).lines).toEqual([line(OPENED), line(verdictWords('a', 'requests changes', 'approves')), null])
})

test('an approval carried over to a new head after an announced approval wakes nothing and is not recorded, nor is a fresh round that approves again', () => {
  const { lines, tickets } = linesOf([{ pr: pr(7, 'OPEN', pair('a')) }, { pr: pr(7, 'OPEN', pair('b')) }, { pr: pr(7, 'OPEN', pair('c')) }])
  expect(lines).toEqual([line(OPENED, verdictWords('a', 'approves', 'approves')), null, null])
  expect(tickets.pairings[0]!.acts.announced?.verdicts).toEqual(pair('a'))
})

test('two rounds that request changes in a row both wake, and so do an approval after them and a request for changes after that', () => {
  const rounds = [
    { pr: pr(7, 'OPEN', pair('a', 'REQUEST_CHANGES', 'REQUEST_CHANGES')) },
    { pr: pr(7, 'OPEN', pair('b', 'REQUEST_CHANGES', 'APPROVE')) },
    { pr: pr(7, 'OPEN', pair('c')) },
    { pr: pr(7, 'OPEN', pair('d', 'APPROVE', 'REQUEST_CHANGES')) },
  ]
  expect(linesOf(rounds).lines).toEqual([
    line(OPENED, verdictWords('a', 'requests changes', 'requests changes')),
    line(verdictWords('b', 'requests changes', 'approves')),
    line(verdictWords('c', 'approves', 'approves')),
    line(verdictWords('d', 'approves', 'requests changes')),
  ])
})

test('a head with no verdicts yet, as after a push, changes nothing, and the same pair coming back wakes nothing', () => {
  const reads = [{ pr: pr(7, 'OPEN', pair('a', 'REQUEST_CHANGES', 'APPROVE')) }, { pr: pr(7) }, { pr: pr(7, 'OPEN', pair('a', 'REQUEST_CHANGES', 'APPROVE')) }, { pr: pr(7, 'OPEN', pair('b')) }]
  expect(linesOf(reads).lines).toEqual([line(OPENED, verdictWords('a', 'requests changes', 'approves')), null, null, line(verdictWords('b', 'approves', 'approves'))])
})

test('a merge wakes once, and a close without merging wakes once', () => {
  expect(linesOf([{ pr: pr(7) }, { pr: pr(7, 'MERGED') }, { pr: pr(7, 'MERGED') }]).lines).toEqual([line(OPENED), line('ABC-1\'s pull request #7 merged.'), null])
  expect(linesOf([{ pr: pr(7) }, { pr: pr(7, 'CLOSED') }, { pr: pr(7, 'CLOSED') }]).lines)
    .toEqual([line(OPENED), line('ABC-1\'s pull request #7 was closed without merging.'), null])
})

test('a pull request reopened after a close wakes nothing, and a second close wakes again', () => {
  const closed = line('ABC-1\'s pull request #7 was closed without merging.')
  const { lines, tickets } = linesOf([{ pr: pr(7) }, { pr: pr(7, 'CLOSED') }, { pr: pr(7, 'OPEN') }, { pr: pr(7, 'OPEN') }, { pr: pr(7, 'CLOSED') }])
  expect(lines).toEqual([line(OPENED), closed, null, null, closed])
  expect(tickets.pairings[0]!.acts.announced?.state).toBe('CLOSED')
})

test('a first read that already shows a merged pull request with verdicts gives the opened, verdict and merged sentences in one line', () => {
  expect(linesOf([{ pr: pr(7, 'MERGED', pair('a')) }]).lines).toEqual([line(OPENED, verdictWords('a', 'approves', 'approves'), 'ABC-1\'s pull request #7 merged.')])
})

test('a second pull request gets its own opened sentence, and its verdicts and close are judged afresh', () => {
  const reads = [{ pr: pr(7, 'OPEN', pair('a')) }, { pr: pr(7, 'CLOSED', pair('a')) }, { pr: pr(8, 'OPEN', pair('b')) }, { pr: pr(8, 'CLOSED', pair('b')) }]
  expect(linesOf(reads).lines).toEqual([
    line(OPENED, verdictWords('a', 'approves', 'approves')),
    line('ABC-1\'s pull request #7 was closed without merging.'),
    line('ABC-1 opened pull request #8.', 'ABC-1\'s pull request #8 has verdicts at bbbbbbb: spec approves, adversarial approves.'),
    line('ABC-1\'s pull request #8 was closed without merging.'),
  ])
})

test('a state foreman cannot read, or no pull request at all, between two reads changes nothing', () => {
  const merged = line(OPENED, 'ABC-1\'s pull request #7 merged.')
  expect(linesOf([{ pr: pr(7, 'MERGED') }, { pr: { number: 7 } }, { pr: pr(7, 'MERGED') }]).lines).toEqual([merged, null, null])
  expect(linesOf([{ pr: pr(7, 'MERGED') }, { pr: pr(7, 'DRAFT') }, { pr: pr(7, 'merged') }]).lines).toEqual([merged, null, null])
  expect(linesOf([{ pr: pr(7) }, { pr: null }, { pr: pr(7) }]).lines).toEqual([line(OPENED), null, null])
})

test('a pairing stored without a milestone memory takes its first read as announced and wakes only for what changes after', () => {
  const stored = (t: ForemanTickets): ForemanTickets => ({ ...t, pairings: t.pairings.map(p => ({ ...p, acts: { ...p.acts, announced: null } })) })
  const open = { pr: pr(7, 'OPEN', pair('a', 'REQUEST_CHANGES', 'APPROVE')) }
  const old = linesOf([open, open, { pr: pr(7, 'MERGED', pair('a', 'REQUEST_CHANGES', 'APPROVE')) }], stored(paired()))
  expect(old.lines).toEqual([null, null, line('ABC-1\'s pull request #7 merged.')])
  expect(linesOf([open], stored(paired())).tickets.pairings[0]!.acts.announced).toEqual({ number: 7, state: 'OPEN', verdicts: pair('a', 'REQUEST_CHANGES', 'APPROVE') })
  expect(linesOf([open]).lines).toEqual([line(OPENED, verdictWords('a', 'requests changes', 'approves'))])
  const before = linesOf([{}, { pr: pr(7) }], stored(paired()))
  expect(before.lines).toEqual([null, line(OPENED)])
})

test('the milestone sentences come after the state and gone sentences of the same pairing, and before the slot-free sentence', () => {
  const cleaning = row({ state: 'in-cleanup', cleanup: { failedCalls: 3, lastError: '' }, pr: pr(7, 'MERGED') })
  expect(read(paired(), [cleaning], T0).reasons.map(r => r.kind)).toEqual(['cleanup', 'opened', 'merged'])
  const notRunning: SessionsLook = { kind: 'read', sessions: [{ sessionId: 'local_a', isArchived: false, isRunning: false, title: null, surelyUnarchived: true }] }
  const stopped = row({ state: 'working', pr: pr(7) }, 'a.json', T0)
  expect(read(paired(), [stopped], T0 + GONE_MS + MINUTE, { sessions: notRunning }).reasons.map(r => r.kind)).toEqual(['gone', 'opened'])
  const done = row({ state: 'done', pr: pr(7, 'MERGED') })
  expect(read(paired(), [done], T0, { sessions: { kind: 'read', sessions: [] } }).reasons.map(r => r.kind)).toEqual(['opened', 'merged', 'slot-free'])
})

test('a released or freed pairing, or a record that does not own the ticket, wakes nothing for its pull request', () => {
  for (const standing of ['released', 'freed'] as const) {
    const t = joinOwners(paired(), [row({ state: 'working' })]).tickets
    t.pairings[0]!.standing = standing
    expect(linesOf([{ pr: pr(7, 'MERGED', pair('a')) }], t).lines).toEqual([null])
  }
  expect(linesOf([{ ticket: 'ft-other', pr: pr(7, 'MERGED', pair('a')) }]).lines).toEqual([null])
  expect(linesOf([{ pr: pr(7, 'MERGED', pair('a')) }]).lines).not.toEqual([null])
})

test('an idle record whose pull request is closed gets no nudge and no idle wake past three thresholds, and the same record with it open still does', () => {
  expect(readEvery(paired(), () => [row({ pr: pr(7, 'CLOSED') })], T0 + 30 * MINUTE)).toEqual([{ at: 0, nudges: 0, reasons: ['opened', 'closed'] }])
  expect(readEvery(paired(), () => [row({ pr: pr(7, 'OPEN') })], T0 + 30 * MINUTE)).toEqual([
    { at: 0, nudges: 0, reasons: ['opened'] },
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['idle'] },
  ])
})

test('a close ends the idle stretch being counted, and a reopened pull request is counted again', () => {
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m < 7) return [row({ pr: pr(7, 'OPEN') })]
    if (m < 20) return [row({ pr: pr(7, 'CLOSED') })]
    return [row({ pr: pr(7, 'OPEN'), stateSince: T0 + 20 * MINUTE })]
  }
  const t = paired()
  const seen = readEvery(t, rowAt, T0 + 40 * MINUTE)
  expect(seen).toEqual([
    { at: 0, nudges: 0, reasons: ['opened'] },
    { at: 5, nudges: 1, reasons: [] },
    { at: 7, nudges: 0, reasons: ['closed'] },
    { at: 25, nudges: 1, reasons: [] },
    { at: 30, nudges: 1, reasons: [] },
    { at: 35, nudges: 0, reasons: ['idle'] },
  ])
  const nudged = read(t, [row({ pr: pr(7, 'OPEN') })], T0 + T)
  expect(nudged.tickets.pairings[0]!.acts.stretch?.nudges).toBe(1)
  expect(read(nudged.tickets, [row({ pr: pr(7, 'CLOSED') })], T0 + T + MINUTE).tickets.pairings[0]!.acts.stretch).toBeNull()
})

test('a started sub session that writes no status file wakes the parent once at five minutes, not at four, and not again', () => {
  expect(readEvery(paired(), () => [], T0 + 30 * MINUTE)).toEqual([{ at: 5, nudges: 0, reasons: ['unseen'] }])
  const early = read(paired(), [], T0 + 4 * MINUTE)
  expect(early.reasons).toEqual([])
  expect(early.nextDueAt).toBe(T0 + GONE_MS)
  const woke = read(paired(), [], T0 + GONE_MS)
  expect(wakeLine(woke.reasons)).toBe('foreman: the sub session with ticket ft-a has written no status file 5 minutes after it started, so foreman cannot watch it.')
  expect(woke.tickets.pairings[0]!.acts.unseenWoke).toBe(true)
  expect(woke.nextDueAt).toBeNull()
  const keyed: ForemanTickets = { ...TICKETS_EMPTY, pairings: [newPairing('ft-a', 'local_a', T0, 'ABC-1')] }
  expect(wakeLine(read(keyed, [], T0 + 7 * MINUTE).reasons)).toBe('foreman: ABC-1 has written no status file 7 minutes after it started, so foreman cannot watch it.')
})

test('a status file that carries the ticket under another desktop session, or none, wakes once with the second sentence', () => {
  for (const desktopSessionId of ['local_other', undefined]) {
    const stray = () => [row({ desktopSessionId, state: 'working' })]
    expect(readEvery(paired(), stray, T0 + 30 * MINUTE)).toEqual([{ at: 5, nudges: 0, reasons: ['unseen'] }])
    expect(wakeLine(read(paired(), stray(), T0 + GONE_MS).reasons))
      .toBe('foreman: the sub session with ticket ft-a\'s status file names another desktop session or none, so foreman cannot watch it.')
  }
})

test('a pairing with no desktop session id, or a released one, whether or not the folder exists, or one read while the folder could not be listed, never wakes for a missing file', () => {
  expect(readEvery(paired(null), () => [], T0 + 30 * MINUTE)).toEqual([])
  expect(readEvery(paired(null), () => [], T0 + 30 * MINUTE, { folderExists: false })).toEqual([])
  expect(readEvery(paired(), () => [], T0 + 30 * MINUTE, { listed: false })).toEqual([])
  const released: ForemanTickets = { ...TICKETS_EMPTY, pairings: [{ ...newPairing('ft-a', 'local_a', T0), standing: 'released' }] }
  expect(readEvery(released, () => [], T0 + 30 * MINUTE)).toEqual([])
  expect(readEvery(released, () => [], T0 + 30 * MINUTE, { folderExists: false })).toEqual([])
})

test('a started sub session read while the status folder is missing wakes the parent once at five minutes, as for an empty folder', () => {
  expect(readEvery(paired(), () => [], T0 + 30 * MINUTE, { folderExists: false })).toEqual([{ at: 5, nudges: 0, reasons: ['unseen'] }])
  const early = read(paired(), [], T0 + 4 * MINUTE, { folderExists: false })
  expect(early.reasons).toEqual([])
  expect(early.nextDueAt).toBe(T0 + GONE_MS)
  const woke = read(paired(), [], T0 + GONE_MS, { folderExists: false })
  expect(wakeLine(woke.reasons)).toBe('foreman: the sub session with ticket ft-a has written no status file 5 minutes after it started, so foreman cannot watch it.')
  expect(woke.tickets.pairings[0]!.acts.unseenWoke).toBe(true)
})

test('a status folder that is missing, then empty, then holds the sub session\'s file wakes the parent once', () => {
  let d = read(paired(), [], T0 + GONE_MS, { folderExists: false })
  expect(d.reasons.map(r => r.kind)).toEqual(['unseen'])
  d = read(d.tickets, [], T0 + 6 * MINUTE, { folderExists: false })
  expect(d.reasons).toEqual([])
  d = read(d.tickets, [], T0 + 8 * MINUTE)
  expect(d.reasons).toEqual([])
  d = read(d.tickets, [row({ state: 'working' })], T0 + 12 * MINUTE)
  expect(d.reasons).toEqual([])
  expect(d.tickets.pairings[0]!.owner).toBe('s-a')
})

// A working record whose only running work is background tasks, waiting since
// `since`.
const waiting = (since: number, tasks: unknown = ['run the tests'], over: Record<string, unknown> = {}) => [row({ state: 'working', backgroundOnly: { since, tasks }, ...over })]

test('a working record that waits only on background work is nudged at one and two thresholds and wakes the parent at three, with its task quoted', () => {
  expect(readEvery(paired(), () => waiting(T0), T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['background'] },
  ])
  const first = read(paired(), waiting(T0), T0 + T)
  expect(first.effects).toEqual([{ kind: 'nudge', to: 'local_a', name: 'ABC-1', about: 'background' }])
  expect(first.nextDueAt).toBe(T0 + 2 * T)
  const second = read(first.tickets, waiting(T0), T0 + 2 * T)
  const woke = read(second.tickets, waiting(T0), T0 + 3 * T)
  expect(wakeLine(woke.reasons)).toBe(`foreman: ABC-1 has waited only on background work for 15 minutes, through two nudges; its first task, quoted: "run the tests". ${DATA_NOTE}`)
})

test('a background wait with no task wakes with the background sentence and no quote', () => {
  let t = paired()
  let last: Decision | null = null
  for (const at of [T, 2 * T, 3 * T]) {
    last = read(t, waiting(T0, []), T0 + at)
    t = last.tickets
  }
  expect(last!.reasons).toEqual([{ kind: 'background', who: 'ABC-1', nudged: true, minutes: 15, task: null }])
  expect(wakeLine(last!.reasons)).toBe('foreman: ABC-1 has waited only on background work for 15 minutes, through two nudges.')
})

test('a sub session that answers each nudge with a short turn and keeps waiting on the same background work still reaches the parent', () => {
  // The incident: between the nudges the record is working without the field,
  // with the episode's old stateSince, as the answer to a nudge is.
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    return m === 6 || m === 11 ? [row({ state: 'working' })] : waiting(T0)
  }
  expect(readEvery(paired(), rowAt, T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['background'] },
  ])
})

test('an idle stretch that already woke the parent does not silence a later background wait', () => {
  const rowAt = (now: number) => ((now - T0) / MINUTE < 20 ? [row()] : waiting(T0 + 20 * MINUTE, ['run the tests'], { stateSince: T0 + 20 * MINUTE }))
  expect(readEvery(paired(), rowAt, T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['idle'] },
    { at: 25, nudges: 1, reasons: [] },
    { at: 30, nudges: 1, reasons: [] },
    { at: 35, nudges: 0, reasons: ['background'] },
  ])
})

test('progress during a background wait ends the stretch, and the count starts again from that read', () => {
  const progressed = (now: number) => ((now - T0) / MINUTE < 7 ? waiting(T0) : waiting(T0, ['run the tests'], { stage: 'verify' }))
  expect(readEvery(paired(), progressed, T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 12, nudges: 1, reasons: [] },
    { at: 17, nudges: 1, reasons: [] },
    { at: 22, nudges: 0, reasons: ['background'] },
  ])
})

test('progress inside a background wait counts from that read and leaves lastNudgeAt for real nudges', () => {
  const nudged = read(paired(), waiting(T0), T0 + 5 * MINUTE).tickets
  expect(nudged.pairings[0]!.acts.stretch).toMatchObject({ nudges: 1, lastNudgeAt: T0 + 5 * MINUTE, countFrom: null })
  const progressed = read(nudged, waiting(T0, ['run the tests'], { stage: 'verify' }), T0 + 7 * MINUTE).tickets
  expect(progressed.pairings[0]!.acts.stretch).toMatchObject({ nudges: 0, lastNudgeAt: null, countFrom: T0 + 7 * MINUTE })
})

test('progress in a turn of its own during a background wait counts the next nudges and the wake from the read that saw it', () => {
  // Nudged at 5 minutes, the sub session answers with a turn of its own that
  // reaches the next stage at 9 minutes, and from 10 minutes it waits on the
  // same background work again.
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m < 9) return waiting(T0)
    if (m === 9) return [row({ state: 'working', stage: 'verify' })]
    return waiting(T0, ['run the tests'], { stage: 'verify' })
  }
  expect(readEvery(paired(), rowAt, T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 14, nudges: 1, reasons: [] },
    { at: 19, nudges: 1, reasons: [] },
    { at: 24, nudges: 0, reasons: ['background'] },
  ])
})

test('progress in a turn of its own keeps the stretch for the same wait, with no nudges, counted from that read', () => {
  const nudged = read(paired(), waiting(T0), T0 + 5 * MINUTE).tickets
  const turned = read(nudged, [row({ state: 'working', stage: 'verify' })], T0 + 9 * MINUTE)
  expect(turned.effects).toEqual([])
  expect(turned.tickets.pairings[0]!.acts.stretch).toMatchObject({ nudges: 0, lastNudgeAt: null, countFrom: T0 + 9 * MINUTE, woke: false, wait: T0 })
  // A later turn with more progress counts from its own read, and a turn
  // without progress leaves the stretch as it is.
  const further = read(turned.tickets, [row({ state: 'working', stage: 'verify', stageDone: 5 })], T0 + 11 * MINUTE).tickets
  expect(further.pairings[0]!.acts.stretch).toMatchObject({ nudges: 0, countFrom: T0 + 11 * MINUTE, wait: T0 })
  const still = read(further, [row({ state: 'working', stage: 'verify', stageDone: 5 })], T0 + 12 * MINUTE).tickets
  expect(still.pairings[0]!.acts.stretch).toEqual(further.pairings[0]!.acts.stretch)
})

test('progress in a turn of its own after the stretch woke the parent starts the count again for the same wait', () => {
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m < 17) return waiting(T0)
    if (m === 17) return [row({ state: 'working', stage: 'verify' })]
    return waiting(T0, ['run the tests'], { stage: 'verify' })
  }
  expect(readEvery(paired(), rowAt, T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['background'] },
    { at: 22, nudges: 1, reasons: [] },
    { at: 27, nudges: 1, reasons: [] },
    { at: 32, nudges: 0, reasons: ['background'] },
  ])
})

test('a background wait with a new since after a turn of its own with progress starts a fresh stretch', () => {
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m < 9) return waiting(T0)
    if (m < 12) return [row({ state: 'working', stage: 'verify' })]
    return waiting(T0 + 12 * MINUTE, ['run the linter'], { stage: 'verify' })
  }
  expect(readEvery(paired(), rowAt, T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 17, nudges: 1, reasons: [] },
    { at: 22, nudges: 1, reasons: [] },
    { at: 27, nudges: 0, reasons: ['background'] },
  ])
  const nudged = read(paired(), waiting(T0), T0 + 5 * MINUTE).tickets
  const turned = read(nudged, [row({ state: 'working', stage: 'verify' })], T0 + 9 * MINUTE).tickets
  const renewed = read(turned, waiting(T0 + 12 * MINUTE, ['run the linter'], { stage: 'verify' }), T0 + 12 * MINUTE).tickets
  expect(renewed.pairings[0]!.acts.stretch).toMatchObject({ wait: T0 + 12 * MINUTE, countFrom: null, nudges: 0 })
})

// The end of a turn of the sub session's own, as builder writes it, `m`
// minutes after T0.
const ended = (m: number, answeredNudge: boolean) => ({ lastTurn: { endedAt: T0 + m * MINUTE, answeredNudge } })

// A background wait from T0 whose first turn ended as the wait began. Foreman
// nudges it at 5 minutes and a short answer ends at 6. A long turn then runs
// from 9 to 20 minutes, started by a nudge or not, and with progress at 9 or
// none, and from 20 minutes the sub session waits on the same background
// work again.
function longTurn(answeredNudge: boolean, progress: boolean) {
  return (now: number) => {
    const m = (now - T0) / MINUTE
    const stage = progress && m >= 9 ? { stage: 'verify' } : {}
    if (m < 6) return waiting(T0, ['run the tests'], ended(0, false))
    if (m < 9) return waiting(T0, ['run the tests'], ended(6, true))
    if (m < 20) return [row({ state: 'working', ...ended(6, true), ...stage })]
    return waiting(T0, ['run the tests'], { ...ended(20, answeredNudge), ...stage })
  }
}

test('a long turn of its own with progress restarts the background count from the end of the turn', () => {
  // The follow-up's timeline: before this change the nudges came at 5, 20 and
  // 25 and the wake at 30.
  expect(readEvery(paired(), longTurn(false, true), T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 25, nudges: 1, reasons: [] },
    { at: 30, nudges: 1, reasons: [] },
    { at: 35, nudges: 0, reasons: ['background'] },
  ])
})

test('a long turn of its own that foreman sees no progress in still restarts the count from its end', () => {
  expect(readEvery(paired(), longTurn(false, false), T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 25, nudges: 1, reasons: [] },
    { at: 30, nudges: 1, reasons: [] },
    { at: 35, nudges: 0, reasons: ['background'] },
  ])
})

test('a long answer to a nudge restarts the count from its end only when foreman saw progress during it', () => {
  expect(readEvery(paired(), longTurn(true, true), T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 25, nudges: 1, reasons: [] },
    { at: 30, nudges: 1, reasons: [] },
    { at: 35, nudges: 0, reasons: ['background'] },
  ])
  // Without progress, the answer is counted through: the second nudge is
  // overdue when it ends, and the wake comes one threshold later.
  expect(readEvery(paired(), longTurn(true, false), T0 + 40 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 20, nudges: 1, reasons: [] },
    { at: 25, nudges: 0, reasons: ['background'] },
  ])
})

test('a sub session that only answers nudges with short turns still reaches the parent when builder writes its turns', () => {
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    return waiting(T0, ['run the tests'], m < 6 ? ended(0, false) : m < 11 ? ended(6, true) : ended(11, true))
  }
  expect(readEvery(paired(), rowAt, T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['background'] },
  ])
})

test('a turn end restarts a background stretch once, never moves it back, and is ignored when it lies in the future', () => {
  const nudged = read(paired(), waiting(T0, ['run the tests'], ended(0, false)), T0 + 5 * MINUTE).tickets
  expect(nudged.pairings[0]!.acts.stretch).toMatchObject({ nudges: 1, countFrom: null })
  const restarted = read(nudged, waiting(T0, ['run the tests'], ended(7, false)), T0 + 8 * MINUTE).tickets
  expect(restarted.pairings[0]!.acts.stretch).toMatchObject({ nudges: 0, lastNudgeAt: null, countFrom: T0 + 7 * MINUTE, woke: false, wait: T0, turnProgress: false })
  // The same end read again, and an earlier one, change nothing.
  const again = read(restarted, waiting(T0, ['run the tests'], ended(7, false)), T0 + 9 * MINUTE).tickets
  expect(again.pairings[0]!.acts.stretch).toEqual(restarted.pairings[0]!.acts.stretch)
  const earlier = read(restarted, waiting(T0, ['run the tests'], ended(6, false)), T0 + 9 * MINUTE).tickets
  expect(earlier.pairings[0]!.acts.stretch).toEqual(restarted.pairings[0]!.acts.stretch)
  // An end after the read, as a damaged file could hold, restarts nothing, so
  // it cannot put the nudges off.
  expect(readEvery(paired(), () => waiting(T0, ['run the tests'], ended(60, false)), T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['background'] },
  ])
})

test('progress in a turn of its own marks the stretch, and a damaged turn end reads as none', () => {
  const nudged = read(paired(), waiting(T0), T0 + 5 * MINUTE).tickets
  const turned = read(nudged, [row({ state: 'working', stage: 'verify' })], T0 + 9 * MINUTE).tickets
  expect(turned.pairings[0]!.acts.stretch).toMatchObject({ countFrom: T0 + 9 * MINUTE, turnProgress: true })
  expect(row({ lastTurn: { endedAt: 'then', answeredNudge: false } }).record.lastTurn).toBeUndefined()
  expect(row({ lastTurn: { endedAt: T0, answeredNudge: 'no' } }).record.lastTurn).toBeUndefined()
  expect(row(ended(3, true)).record.lastTurn).toEqual({ endedAt: T0 + 3 * MINUTE, answeredNudge: true })
})

test('a turn end on an idle record changes nothing', () => {
  expect(readEvery(paired(), () => [row(ended(7, false))], T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 10, nudges: 1, reasons: [] },
    { at: 15, nudges: 0, reasons: ['idle'] },
  ])
})

test('progress in a working turn still ends an idle stretch, and the next idle episode counts from its own start', () => {
  const rowAt = (now: number) => {
    const m = (now - T0) / MINUTE
    if (m < 6) return [row()]
    if (m < 8) return [row({ state: 'working', stage: 'verify', stateSince: T0 + 6 * MINUTE })]
    return [row({ stage: 'verify', stateSince: T0 + 8 * MINUTE })]
  }
  expect(readEvery(paired(), rowAt, T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 13, nudges: 1, reasons: [] },
    { at: 18, nudges: 1, reasons: [] },
    { at: 23, nudges: 0, reasons: ['idle'] },
  ])
  const nudged = read(paired(), [row()], T0 + 5 * MINUTE).tickets
  expect(read(nudged, [row({ state: 'working', stage: 'verify', stateSince: T0 + 6 * MINUTE })], T0 + 6 * MINUTE).tickets.pairings[0]!.acts.stretch).toBeNull()
})

test('a background wait with a new since starts a fresh stretch', () => {
  const renewed = (now: number) => ((now - T0) / MINUTE < 7 ? waiting(T0) : waiting(T0 + 7 * MINUTE))
  expect(readEvery(paired(), renewed, T0 + 30 * MINUTE)).toEqual([
    { at: 5, nudges: 1, reasons: [] },
    { at: 12, nudges: 1, reasons: [] },
    { at: 17, nudges: 1, reasons: [] },
    { at: 22, nudges: 0, reasons: ['background'] },
  ])
})

test('a background wait with no desktop session to nudge wakes the parent at two thresholds', () => {
  const rows = () => waiting(T0, ['run the tests'], { desktopSessionId: undefined })
  expect(readEvery(paired(null), rows, T0 + 30 * MINUTE)).toEqual([{ at: 10, nudges: 0, reasons: ['background'] }])
  expect(wakeLine(read(paired(null), rows(), T0 + 2 * T).reasons)).toBe(
    'foreman: ABC-1 has waited only on background work for 10 minutes and cannot be nudged, because foreman knows no desktop session for it;'
    + ` its first task, quoted: "run the tests". ${DATA_NOTE}`,
  )
})

test('a working record without the field, or with a malformed one, is never nudged', () => {
  expect(readEvery(paired(), () => [row({ state: 'working' })], T0 + 30 * MINUTE)).toEqual([])
  for (const backgroundOnly of ['yes', { since: 'then', tasks: ['x'] }, { tasks: ['x'] }, null]) {
    expect(readEvery(paired(), () => [row({ state: 'working', backgroundOnly })], T0 + 30 * MINUTE)).toEqual([])
  }
})

test('a read takes the owner\'s spending into the ledger, and when the owner\'s file disappears the pairing is forgotten while its entry stays and the sum is unchanged', () => {
  const usage = { models: [{ model: 'model-a', input: 4000, output: 300, cacheRead: 90_000, cacheWrite: 2000 }], usd: 0.75 }
  const first = read(paired(), [row({ usage })], T0)
  const entry = { ticket: 'ft-a', counts: { input: 4000, output: 300, cacheRead: 90_000, cacheWrite: 2000 }, usd: 0.75 }
  expect(first.tickets.spent).toEqual([entry])
  const sum = spentSum(first.tickets)
  const gone = read(first.tickets, [], T0 + MINUTE)
  expect(gone.tickets.pairings).toEqual([])
  expect(gone.tickets.spent).toEqual([entry])
  expect(spentSum(gone.tickets)).toEqual(sum)
})

test('past 200 entries a read folds, in the same ledger, the entry of a pairing that this read forgot', () => {
  const one = (ticket: string, input: number) => ({ ticket, counts: { input, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: null })
  // ft-a's entry is the oldest, and its file leaves the folder at this read.
  const spent = [one('ft-a', 500), ...Array.from({ length: 199 }, (_, i) => one(`ft-old-${i}`, 1))]
  const a = { ...newPairing('ft-a', 'local_a', T0), owner: 's-a', ownerFile: 'a.json' }
  const t: ForemanTickets = { ...TICKETS_EMPTY, pairings: [a, newPairing('ft-b', 'local_b', T0)], spent }
  const usage = { models: [{ model: 'model-a', input: 4000, output: 0, cacheRead: 0, cacheWrite: 0 }], usd: 1 }
  const d = read(t, [row({ sessionId: 's-b', ticket: 'ft-b', desktopSessionId: 'local_b', usage }, 'b.json')], T0)
  expect(d.tickets.pairings.map(p => p.ticket)).toEqual(['ft-b'])
  expect(d.tickets.spent).toHaveLength(200)
  expect(d.tickets.spent.map(e => e.ticket)).not.toContain('ft-a')
  expect(d.tickets.spent.at(-1)!.ticket).toBe('ft-b')
  expect(d.tickets.earlier).toEqual({ counts: { input: 500, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: null })
  expect(spentSum(d.tickets)).toEqual({ counts: { input: 500 + 199 + 4000, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 1 })
})
