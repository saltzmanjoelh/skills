import { expect, test } from 'claude-code/testing'

import { recordIn } from '../hooks/record'
import { folded, MAX_SPENT, spendOf, spendWords, spentSum, withReadings } from '../hooks/spend'
import type { SubRow } from '../hooks/subs'
import { newPairing, TICKETS_EMPTY } from '../hooks/tickets'
import type { ForemanPairing, ForemanSpent, ForemanTickets } from '../types'

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)

// The tokens of one model, with `over` changing its counts.
const model = (name: string, over: Record<string, number> = {}) => ({ model: name, input: 1000, output: 200, cacheRead: 50_000, cacheWrite: 3000, ...over })

// A row for the record of session `sessionId` with ticket `ticket` in file
// `file`, carrying `usage` when it is given.
function row(file: string, sessionId: string, ticket: string, usage?: unknown): SubRow {
  const record = recordIn(JSON.stringify({
    sessionId, ticket, cwd: '/w', issueKey: 'ABC-1', issueTitle: 't', stage: null, stageDone: 0, pr: null, state: 'working', reason: '', stateSince: T0, writtenAt: T0,
    ...(usage === undefined ? {} : { usage }),
  }))!
  return { file, record, mtimeMs: T0, isStale: false }
}

// A pairing for `ticket` whose owner is session `owner` in file `file`.
const owned = (ticket: string, owner: string, file: string): ForemanPairing => ({ ...newPairing(ticket, 'local_a', T0), owner, ownerFile: file })

const ledger = (pairings: ForemanPairing[], spent: ForemanSpent[] = []): ForemanTickets => ({ ...TICKETS_EMPTY, pairings, spent })

const entry = (ticket: string, input: number, usd: number | null = null): ForemanSpent => ({ ticket, counts: { input, output: 0, cacheRead: 0, cacheWrite: 0 }, usd })

test('a reading is summed over the models into one entry for the owner\'s ticket', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json')])
  const usage = { models: [model('model-a'), model('model-b', { input: 500 })], usd: 1.25 }
  expect(withReadings(t, [row('a.json', 's-a', 'ft-a', usage)]).spent).toEqual([
    { ticket: 'ft-a', counts: { input: 1500, output: 400, cacheRead: 100_000, cacheWrite: 6000 }, usd: 1.25 },
  ])
})

test('a newer read replaces the ticket\'s entry in place, keeping the larger value in each count and in the dollars', () => {
  const t = ledger([owned('ft-a', 's-a', 'a.json'), owned('ft-b', 's-b', 'b.json')], [entry('ft-a', 1000, 2), entry('ft-b', 10)])
  const newer = withReadings(t, [row('a.json', 's-a', 'ft-a', { models: [model('model-a', { input: 4000, output: 0 })], usd: 1 })])
  expect(newer.spent).toEqual([
    { ticket: 'ft-a', counts: { input: 4000, output: 0, cacheRead: 50_000, cacheWrite: 3000 }, usd: 2 },
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
  expect(after.earlier).toEqual({ counts: { input: 10 + 11 + 12, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0.5 })
  expect(spentSum(after)).toEqual(before)
  // A second fold adds to the earlier total.
  const more = folded({ ...after, spent: [...after.spent, entry('ft-new', 1000, 2)] })
  expect(more.spent).toHaveLength(MAX_SPENT)
  expect(more.earlier).toEqual({ counts: { input: 10 + 11 + 12 + 13, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0.5 })
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
  const t = { ...ledger([], [entry('ft-a', 100, 1.5), entry('ft-b', 200)]), earlier: { counts: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, usd: null } }
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
