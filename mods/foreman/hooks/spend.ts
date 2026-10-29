// What the sub sessions of a parent spent, as foreman keeps it in its ledger:
// the last spending read from each owner's status file, which outlives the
// pairing, the total of the entries folded out once the list grew past its
// bound, their sum, and the words the pane shows. Every function is pure, and
// one that changes nothing gives back the very ledger it was handed, so the
// caller can tell that nothing needs to be written.

import type { ForemanCounts, ForemanSpend, ForemanSpent, ForemanTickets } from '../types'
import type { RecordUsage } from './record'
import type { SubRow } from './subs'
import { ownsTicket } from './tickets'

// The most entries the spent list keeps before the oldest ones whose pairing
// is gone are folded into the earlier total.
export const MAX_SPENT = 200

const COUNTS_NONE: ForemanCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const plus = (a: ForemanCounts, b: ForemanCounts): ForemanCounts => ({
  input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite,
})

const larger = (a: ForemanCounts, b: ForemanCounts): ForemanCounts => ({
  input: Math.max(a.input, b.input), output: Math.max(a.output, b.output), cacheRead: Math.max(a.cacheRead, b.cacheRead), cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
})

// The sum of two dollar figures, either of which may be unknown: the known
// one when only one is known, and unknown only when neither is.
const plusUsd = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b)

// The larger of two dollar figures, a known one always winning over an
// unknown one, so a known figure never turns unknown.
const largerUsd = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b))

// A record's spending summed over its models, or null when the record carries
// none.
export function spendOf(usage: RecordUsage | undefined): ForemanSpend | null {
  if (usage === undefined) return null
  return { counts: usage.models.reduce(plus, COUNTS_NONE), usd: usage.usd }
}

const sameSpend = (a: ForemanSpend, b: ForemanSpend) =>
  a.usd === b.usd && a.counts.input === b.counts.input && a.counts.output === b.counts.output
  && a.counts.cacheRead === b.counts.cacheRead && a.counts.cacheWrite === b.counts.cacheWrite

// The ledger with this read's spending taken in. A reading is taken only from
// the owner's row of a pairing: the row in the pairing's owner file, whose
// session id and ticket match the pairing's owner, so a fork's file is never
// read. Each reading replaces its ticket's entry in place, keeping the larger
// of the stored and the new value in each count and in the dollars, so an
// entry never falls; a ticket with no entry yet gets one at the end, so the
// list stays in the order the tickets were first read. A row that carries no
// spending changes nothing.
// Each ticket is looked up once in a map from ticket to its entry's place,
// and the list is copied only at the first change or addition, so a read of
// many pairings costs one pass rather than one search and one copy each.
export function withReadings(t: ForemanTickets, rows: readonly SubRow[]): ForemanTickets {
  const byFile = new Map(rows.map(r => [r.file, r]))
  const place = new Map<string, number>()
  t.spent.forEach((e, i) => {
    if (!place.has(e.ticket)) place.set(e.ticket, i)
  })
  let spent: ForemanSpent[] | null = null
  for (const p of t.pairings) {
    const row = p.ownerFile === null ? undefined : byFile.get(p.ownerFile)
    if (row === undefined || !ownsTicket(p, row)) continue
    const reading = spendOf(row.record.usage)
    if (reading === null) continue
    const at = place.get(p.ticket)
    if (at === undefined) {
      spent ??= [...t.spent]
      place.set(p.ticket, spent.length)
      spent.push({ ticket: p.ticket, ...reading })
      continue
    }
    const stored = (spent ?? t.spent)[at]!
    const next: ForemanSpent = { ticket: p.ticket, counts: larger(stored.counts, reading.counts), usd: largerUsd(stored.usd, reading.usd) }
    if (sameSpend(next, stored)) continue
    spent ??= [...t.spent]
    spent[at] = next
  }
  return spent === null ? t : { ...t, spent }
}

// The ledger with the spent list brought back to MAX_SPENT entries where it
// can be: while it holds more, the oldest entry whose ticket has no pairing is
// removed and added into the earlier total, in the same ledger. An entry whose
// pairing still exists is never folded, so the list may stay longer until
// those pairings are forgotten. The sum is the same before and after.
export function folded(t: ForemanTickets): ForemanTickets {
  if (t.spent.length <= MAX_SPENT) return t
  const paired = new Set(t.pairings.map(p => p.ticket))
  const fold = new Set(t.spent.filter(e => !paired.has(e.ticket)).slice(0, t.spent.length - MAX_SPENT))
  if (fold.size === 0) return t
  let earlier = t.earlier
  for (const e of fold) earlier = { counts: plus(earlier?.counts ?? COUNTS_NONE, e.counts), usd: plusUsd(earlier?.usd ?? null, e.usd) }
  return { ...t, spent: t.spent.filter(e => !fold.has(e)), earlier }
}

// What every sub session this parent started spent: the entries plus the
// earlier total. Its dollars are the sum of the known figures, and unknown
// only when none is known. Null when nothing has been read at all.
export function spentSum(t: ForemanTickets): ForemanSpend | null {
  const all: ForemanSpend[] = t.earlier === null ? t.spent : [t.earlier, ...t.spent]
  if (all.length === 0) return null
  return all.reduce<ForemanSpend>((sum, s) => ({ counts: plus(sum.counts, s.counts), usd: plusUsd(sum.usd, s.usd) }), { counts: COUNTS_NONE, usd: null })
}

// A count as builder's pane shows it: in thousands below a million, and in
// millions with one decimal from a million up. This is a copy of the
// countWords in builder's hooks/usage.ts, written out again by hand because
// foreman does not import builder's code, so it must stay the same as
// builder's, and a change to either has to be made to both.
const countWords = (n: number) => (n < 1_000_000 ? `${Math.round(n / 1000)}K` : `${(n / 1_000_000).toFixed(1)}M`)

// The words for some spending, in the same form as builder's pane words its
// own: the four kinds and the dollar total, or "cost unknown" while no dollar
// figure is known. Spending whose tokens sum to zero reads "nothing counted
// yet" in place of the counts, with the dollars beside it, as builder's pane
// reads a ledger whose counts sum to zero. Spending that is missing
// altogether is "unknown". Neither reads as
// zero tokens, and only a known dollar figure of zero reads as $0.00.
export function spendWords(spend: ForemanSpend | null): string {
  if (spend === null) return 'unknown'
  const { counts: c, usd } = spend
  const tokens = c.input + c.output + c.cacheRead + c.cacheWrite === 0
    ? 'nothing counted yet'
    : `${countWords(c.input)} in, ${countWords(c.output)} out, ${countWords(c.cacheRead)} cache read, ${countWords(c.cacheWrite)} cache write`
  return `${tokens} · ${usd === null ? 'cost unknown' : `$${usd.toFixed(2)}`}`
}
