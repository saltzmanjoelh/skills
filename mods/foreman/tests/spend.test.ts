import { expect, test } from 'claude-code/testing'

import { recordIn } from '../hooks/record'
import { folded, MAX_SPENT, spendOf, spendWords, spentSum, ticketTimes, timeSum, timesOf, TIMES_UNKNOWN, withQueued, withReadings } from '../hooks/spend'
import type { SubRow } from '../hooks/subs'
import { newPairing, TICKETS_EMPTY } from '../hooks/tickets'
import type { ForemanPairing, ForemanSpent, ForemanTickets, ForemanTiming } from '../types'

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)
const MINUTE = 60_000

// The tokens of one model, with `over` changing its counts.
const model = (name: string, over: Record<string, number> = {}) => ({ model: name, input: 1000, output: 200, cacheRead: 50_000, cacheWrite: 3000, ...over })

// A row for the record of session `sessionId` with ticket `ticket` in file
// `file`, carrying `usage` and `timing` when each is given.
function row(file: string, sessionId: string, ticket: string, usage?: unknown, timing?: unknown): SubRow {
  const record = recordIn(JSON.stringify({
    sessionId, ticket, cwd: '/w', issueKey: 'ABC-1', issueTitle: 't', stage: null, stageDone: 0, pr: null, state: 'working', reason: '', stateSince: T0, writtenAt: T0,
    ...(usage === undefined ? {} : { usage }),
    ...(timing === undefined ? {} : { timing }),
  }))!
  return { file, record, mtimeMs: T0, isStale: false }
}

// A pairing for `ticket` whose owner is session `owner` in file `file`.
const owned = (ticket: string, owner: string, file: string): ForemanPairing => ({ ...newPairing(ticket, 'local_a', T0), owner, ownerFile: file })

const ledger = (pairings: ForemanPairing[], spent: ForemanSpent[] = []): ForemanTickets => ({ ...TICKETS_EMPTY, pairings, spent })

const entry = (ticket: string, input: number, usd: number | null = null, over: Partial<ForemanSpent> = {}): ForemanSpent => ({
  ticket, counts: { input, output: 0, cacheRead: 0, cacheWrite: 0 }, usd, timing: null, queuedMs: null, ...over,
})

const COUNTS_NONE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

// The times a sub session's file carries, as builder writes them, with
// `states` changing the per-state totals and `over` the other fields.
const timing = (states: Partial<ForemanTiming['states']> = {}, over: Partial<ForemanTiming> = {}): ForemanTiming => ({
  startedAt: T0,
  stages: [{ stage: 'spec', at: T0 + MINUTE }],
  prOpenedAt: null,
  prMergedAt: null,
  states: { 'working': 10 * MINUTE, 'waiting-on-builder': MINUTE, 'idle': 2 * MINUTE, 'needs-you': 5 * MINUTE, 'in-cleanup': 0, 'done': 0, ...states },
  rounds: [],
  olderRounds: 0,
  ...over,
})

test('a reading is summed over the models into one entry for the owner\'s ticket', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json')])
  const usage = { models: [model('model-a'), model('model-b', { input: 500 })], usd: 1.25 }
  expect(withReadings(t, [row('a.json', 's-a', 'ft-a', usage)]).spent).toEqual([
    { ticket: 'ft-a', counts: { input: 1500, output: 400, cacheRead: 100_000, cacheWrite: 6000 }, usd: 1.25, timing: null, queuedMs: null },
  ])
})

test('a newer read replaces the ticket\'s entry in place, keeping the larger value in each count and in the dollars', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json'), owned('ft-b', 's-b', 'b.json')], [entry('ft-a', 1000, 2), entry('ft-b', 10)])
  const newer = withReadings(t, [row('a.json', 's-a', 'ft-a', { models: [model('model-a', { input: 4000, output: 0 })], usd: 1 })])
  expect(newer.spent).toEqual([
    { ticket: 'ft-a', counts: { input: 4000, output: 0, cacheRead: 50_000, cacheWrite: 3000 }, usd: 2, timing: null, queuedMs: null },
    entry('ft-b', 10),
  ])
  // A known dollar figure is never replaced by an unknown one.
  const unknown = withReadings(newer, [row('a.json', 's-a', 'ft-a', { models: [model('model-a', { input: 5000, output: 0 })], usd: null })])
  expect(unknown.spent[0]!.usd).toBe(2)
  expect(unknown.spent[0]!.counts.input).toBe(5000)
})

test('several readings in one read change their entries in place and add new ones at the end, and leave the ledger read from as it was', () => {
  const t = ledger(
    [owned('ft-a', 's-a', 'a.json'), owned('ft-b', 's-b', 'b.json'), owned('ft-c', 's-c', 'c.json'), owned('ft-d', 's-d', 'd.json')],
    [entry('ft-a', 10), entry('ft-b', 20), entry('ft-c', 30)],
  )
  const before = structuredClone(t.spent)
  const reading = (input: number) => ({ models: [model('m', { input, output: 0, cacheRead: 0, cacheWrite: 0 })], usd: null })
  const after = withReadings(t, [
    row('a.json', 's-a', 'ft-a', reading(15)),
    row('b.json', 's-b', 'ft-b', reading(20)),
    row('c.json', 's-c', 'ft-c', reading(35)),
    row('d.json', 's-d', 'ft-d', reading(40)),
  ])
  expect(after.spent).toEqual([entry('ft-a', 15), entry('ft-b', 20), entry('ft-c', 35), entry('ft-d', 40)])
  expect(after.spent[1]).toBe(t.spent[1])
  expect(t.spent).toEqual(before)
})

test('a fork\'s file, a file other than the owner\'s and a file with no spending leave the entries as they were', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json')], [entry('ft-a', 1000)])
  const usage = { models: [model('model-a', { input: 9000 })], usd: 9 }
  // A fork writes the same ticket under another session id.
  expect(withReadings(t, [row('fork.json', 's-fork', 'ft-a', usage)])).toBe(t)
  // The owner's session id and ticket in a file that is not the owner's.
  expect(withReadings(t, [row('other.json', 's-a', 'ft-a', usage)])).toBe(t)
  // The owner's file, with no spending in it.
  expect(withReadings(t, [row('a.json', 's-a', 'ft-a')])).toBe(t)
  // A pairing with no owner yet takes no reading.
  const unowned = ledger([newPairing('ft-a', 'local_a', T0)])
  expect(withReadings(unowned, [row('a.json', 's-a', 'ft-a', usage)])).toBe(unowned)
})

test('a reading equal to the entry gives back the same ledger, so nothing is written', () => {
  const t = withReadings(ledger([owned('ft-a', 's-a', 'a.json')]), [row('a.json', 's-a', 'ft-a', { models: [model('model-a')], usd: 1 })])
  expect(withReadings(t, [row('a.json', 's-a', 'ft-a', { models: [model('model-a')], usd: 1 })])).toBe(t)
})

test('past 200 entries the oldest entries without a pairing fold into the earlier total, and the sum is unchanged', () => {
  const spent = Array.from({ length: MAX_SPENT + 3 }, (_, i) => entry(`ft-${i}`, 10 + i, i === 1 ? 0.5 : null))
  const t = ledger([], spent)
  const before = spentSum(t)
  const after = folded(t)
  expect(after.spent).toEqual(spent.slice(3))
  expect(after.earlier).toEqual({ counts: { input: 10 + 11 + 12, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0.5, times: TIMES_UNKNOWN })
  expect(spentSum(after)).toEqual(before)
  // A second fold adds to the earlier total.
  const more = folded({ ...after, spent: [...after.spent, entry('ft-new', 1000, 2)] })
  expect(more.spent).toHaveLength(MAX_SPENT)
  expect(more.earlier).toEqual({ counts: { input: 10 + 11 + 12 + 13, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0.5, times: TIMES_UNKNOWN })
  expect(spentSum(more)!.usd).toBe(2.5)
  // At the bound nothing folds.
  expect(folded(more)).toBe(more)
})

test('an entry whose pairing still exists is never folded, even when the list stays past its bound', () => {
  const spent = Array.from({ length: MAX_SPENT + 2 }, (_, i) => entry(`ft-${i}`, 1))
  const t = ledger([owned('ft-0', 's-0', '0.json'), owned('ft-2', 's-2', '2.json')], spent)
  const after = folded(t)
  expect(after.spent.map(e => e.ticket).slice(0, 3)).toEqual(['ft-0', 'ft-2', 'ft-4'])
  expect(after.spent).toHaveLength(MAX_SPENT)
  const all = ledger([...spent.map(e => owned(e.ticket, 's', 'x.json'))], spent)
  expect(folded(all)).toBe(all)
})

test('the sum adds the entries and the earlier total, and its dollars are the known figures, or unknown when none is', () => {
  expect(spentSum(TICKETS_EMPTY)).toBeNull()
  const t = { ...ledger([], [entry('ft-a', 100, 1.5), entry('ft-b', 200)]), earlier: { counts: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, usd: null, times: TIMES_UNKNOWN } }
  expect(spentSum(t)).toEqual({ counts: { input: 301, output: 2, cacheRead: 3, cacheWrite: 4 }, usd: 1.5 })
  expect(spentSum(ledger([], [entry('ft-a', 100), entry('ft-b', 200)]))!.usd).toBeNull()
})

test('the words for a missing value say unknown, and never $0 or zero tokens', () => {
  expect(spendWords(null)).toBe('unknown')
  const none = spendOf({ models: [], usd: null })
  expect(spendWords(none)).toBe('nothing counted yet · cost unknown')
  const counted = spendOf({ models: [model('model-a', { input: 1_500_000 })], usd: null })
  expect(spendWords(counted)).toBe('1.5M in, 0K out, 50K cache read, 3K cache write · cost unknown')
  expect(spendWords(spendOf({ models: [model('model-a')], usd: 3.456 }))).toBe('1K in, 0K out, 50K cache read, 3K cache write · $3.46')
  for (const words of [spendWords(null), spendWords(none), spendWords(counted)]) expect(words).not.toContain('$0')
  expect(spendOf(undefined)).toBeNull()
})

test('the four times are the working total, the needs-you total, the sum of the other four states, and the queue time', () => {
  expect(timesOf(timing(), 3 * MINUTE)).toEqual({ working: 10 * MINUTE, needsYou: 5 * MINUTE, otherWaiting: 3 * MINUTE, queued: 3 * MINUTE })
  expect(timesOf(timing({ 'in-cleanup': MINUTE, 'done': 4 * MINUTE }), null)).toEqual({ working: 10 * MINUTE, needsYou: 5 * MINUTE, otherWaiting: 8 * MINUTE, queued: null })
  expect(timesOf(null, 0)).toEqual({ working: null, needsYou: null, otherWaiting: null, queued: 0 })
  expect(timesOf(null, null)).toEqual(TIMES_UNKNOWN)
})

test('a file\'s times enter the owner\'s entry, and an entry can hold times with no spending', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json')])
  const after = withReadings(t, [row('a.json', 's-a', 'ft-a', undefined, timing())])
  expect(after.spent).toEqual([{ ticket: 'ft-a', counts: COUNTS_NONE, usd: null, timing: timing(), queuedMs: null }])
  // Its spending reads as nothing counted yet at an unknown cost, never $0.
  expect(spendWords(spentSum(after))).toBe('nothing counted yet · cost unknown')
  expect(ticketTimes(after, 'ft-a')).toEqual({ working: 10 * MINUTE, needsYou: 5 * MINUTE, otherWaiting: 3 * MINUTE, queued: null })
  // Spending read later joins the same entry and keeps its times.
  const usage = { models: [model('model-a')], usd: 1 }
  const both = withReadings(after, [row('a.json', 's-a', 'ft-a', usage)])
  expect(both.spent).toEqual([{ ticket: 'ft-a', counts: { input: 1000, output: 200, cacheRead: 50_000, cacheWrite: 3000 }, usd: 1, timing: timing(), queuedMs: null }])
})

test('a fork\'s file and a file other than the owner\'s leave the times as they were', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json')], [entry('ft-a', 1000, null, { timing: timing() })])
  const bigger = timing({ working: 99 * MINUTE }, { prOpenedAt: T0 + 9 * MINUTE })
  expect(withReadings(t, [row('fork.json', 's-fork', 'ft-a', undefined, bigger)])).toBe(t)
  expect(withReadings(t, [row('other.json', 's-a', 'ft-a', undefined, bigger)])).toBe(t)
  expect(withReadings(ledger([owned('ft-a', 's-a', 'a.json')]), [row('fork.json', 's-fork', 'ft-a', undefined, bigger)]).spent).toEqual([])
})

test('the per-state totals never fall, the stamps and the rounds take the newest reading, and a reading without times keeps the stored ones', () => {
  const round = { head: 'a'.repeat(40), startedAt: T0 + 20 * MINUTE, endedAt: null, ended: null }
  const t = ledger([owned('ft-a', 's-a', 'a.json')], [entry('ft-a', 1000, null, { timing: timing(), queuedMs: 4 * MINUTE })])
  const reading = timing({ 'working': 8 * MINUTE, 'needs-you': 7 * MINUTE }, { prOpenedAt: T0 + 15 * MINUTE, rounds: [round], olderRounds: 2 })
  const after = withReadings(t, [row('a.json', 's-a', 'ft-a', undefined, reading)])
  expect(after.spent[0]!.timing).toEqual(timing({ 'working': 10 * MINUTE, 'needs-you': 7 * MINUTE }, { prOpenedAt: T0 + 15 * MINUTE, rounds: [round], olderRounds: 2 }))
  expect(after.spent[0]!.queuedMs).toBe(4 * MINUTE)
  expect(after.spent[0]!.counts.input).toBe(1000)
  // A reading without times, with spending or with nothing, keeps them.
  const spendOnly = withReadings(after, [row('a.json', 's-a', 'ft-a', { models: [model('m', { input: 2000 })], usd: null })])
  expect(spendOnly.spent[0]!.timing).toEqual(after.spent[0]!.timing)
  expect(spendOnly.spent[0]!.counts.input).toBe(2000)
  expect(withReadings(after, [row('a.json', 's-a', 'ft-a')])).toBe(after)
  // The same reading again gives back the same ledger.
  expect(withReadings(after, [row('a.json', 's-a', 'ft-a', undefined, reading)])).toBe(after)
})

test('a queue time creates an entry with no spending, keeps the larger value, and a reading keeps it', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json')])
  const queued = withQueued(t, 'ft-a', 6 * MINUTE)
  expect(queued.spent).toEqual([{ ticket: 'ft-a', counts: COUNTS_NONE, usd: null, timing: null, queuedMs: 6 * MINUTE }])
  expect(spendWords(spentSum(queued))).toBe('nothing counted yet · cost unknown')
  expect(withQueued(queued, 'ft-a', 6 * MINUTE)).toBe(queued)
  expect(withQueued(queued, 'ft-a', 2 * MINUTE)).toBe(queued)
  expect(withQueued(queued, 'ft-a', 9 * MINUTE).spent[0]!.queuedMs).toBe(9 * MINUTE)
  // A zero is a known queue time, kept apart from an unknown one.
  const begun = withQueued(ledger([]), 'ft-b', 0)
  expect(begun.spent[0]!.queuedMs).toBe(0)
  expect(ticketTimes(begun, 'ft-b').queued).toBe(0)
  expect(ticketTimes(begun, 'ft-other')).toEqual(TIMES_UNKNOWN)
  expect(ticketTimes(begun, null)).toEqual(TIMES_UNKNOWN)
  // A reading of the owner's file keeps the queue time.
  const read = withReadings(queued, [row('a.json', 's-a', 'ft-a', { models: [model('m')], usd: 1 }, timing())])
  expect(read.spent).toEqual([{ ticket: 'ft-a', counts: { input: 1000, output: 200, cacheRead: 50_000, cacheWrite: 3000 }, usd: 1, timing: timing(), queuedMs: 6 * MINUTE }])
})

test('the time sums add the entries and the earlier sums, a known value wins over an unknown one, and only unknown on both sides stays unknown', () => {
  expect(timeSum(TICKETS_EMPTY)).toEqual(TIMES_UNKNOWN)
  const t = ledger([], [entry('ft-a', 1, null, { timing: timing(), queuedMs: 0 }), entry('ft-b', 1), entry('ft-c', 1, null, { queuedMs: 2 * MINUTE })])
  expect(timeSum(t)).toEqual({ working: 10 * MINUTE, needsYou: 5 * MINUTE, otherWaiting: 3 * MINUTE, queued: 2 * MINUTE })
  const withEarlier: ForemanTickets = { ...t, earlier: { counts: COUNTS_NONE, usd: null, times: { working: MINUTE, needsYou: null, otherWaiting: null, queued: MINUTE } } }
  expect(timeSum(withEarlier)).toEqual({ working: 11 * MINUTE, needsYou: 5 * MINUTE, otherWaiting: 3 * MINUTE, queued: 3 * MINUTE })
  expect(timeSum(ledger([], [entry('ft-b', 1)]))).toEqual(TIMES_UNKNOWN)
})

test('past 200 entries the fold keeps the four time sums unchanged', () => {
  const spent = Array.from({ length: MAX_SPENT + 3 }, (_, i) => entry(`ft-${i}`, 1, null, i === 1 ? {} : { timing: timing({ working: i * MINUTE }), queuedMs: i === 2 ? null : i * 1000 }))
  const t = ledger([], spent)
  const before = timeSum(t)
  const after = folded(t)
  expect(after.spent).toHaveLength(MAX_SPENT)
  expect(after.earlier!.times).toEqual({ working: 2 * MINUTE, needsYou: 10 * MINUTE, otherWaiting: 6 * MINUTE, queued: 0 })
  expect(timeSum(after)).toEqual(before)
  // A second fold adds to the earlier sums and keeps the total.
  const more = folded({ ...after, spent: [...after.spent, entry('ft-new', 1, null, { queuedMs: MINUTE })] })
  expect(more.spent).toHaveLength(MAX_SPENT)
  expect(more.earlier!.times).toEqual({ working: 5 * MINUTE, needsYou: 15 * MINUTE, otherWaiting: 9 * MINUTE, queued: 3000 })
  expect(timeSum(more)).toEqual({ ...before, queued: before.queued! + MINUTE })
  // Entries without times fold into unknown sums, never zero.
  const bare = folded(ledger([], Array.from({ length: MAX_SPENT + 1 }, (_, i) => entry(`ft-${i}`, 1))))
  expect(bare.earlier!.times).toEqual(TIMES_UNKNOWN)
})

