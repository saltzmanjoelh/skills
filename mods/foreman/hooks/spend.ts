// What the sub sessions of a parent spent and how long they took, as foreman
// keeps it in its ledger: the last spending and times read from each owner's
// status file and the time each ticket waited in foreman's queue, which
// outlive the pairing, the total of the entries folded out once the list grew
// past its bound, their sums, and the words the pane shows. Every function is pure, and
// one that changes nothing gives back the very ledger it was handed, so the
// caller can tell that nothing needs to be written.

import type { ForemanCounts, ForemanSpend, ForemanSpent, ForemanTickets, ForemanTimes } from '../types'
import type { RecordTiming, RecordUsage } from './record'
import { STATES } from './record'
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

// The sum of two figures, such as dollars or times, either of which may be
// unknown: the known one when only one is known, and unknown only when
// neither is.
export const plusKnown = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : a + b)

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

// The per-state totals of two readings, keeping the larger of each, in the
// order of STATES.
function largerStates(a: RecordTiming['states'], b: RecordTiming['states']): RecordTiming['states'] {
  const states = {} as RecordTiming['states']
  for (const state of STATES) states[state] = Math.max(a[state], b[state])
  return states
}

// The stored times with a new reading taken in: the per-state totals keep the
// larger value, so they never fall, and the stamps, the stages and the rounds
// take the newest reading. A missing reading keeps the stored times.
function withTiming(stored: RecordTiming | null, reading: RecordTiming | undefined): RecordTiming | null {
  if (reading === undefined) return stored
  return stored === null ? reading : { ...reading, states: largerStates(stored.states, reading.states) }
}

// Whether two readings of times are equal. Both are built by timingIn or by
// withTiming, whose fields always come in the same order, so equal times
// have the same text.
const sameTiming = (a: RecordTiming | null, b: RecordTiming | null) => a === b || JSON.stringify(a) === JSON.stringify(b)

// An entry for `ticket` with no spending read yet: zero counts and an unknown
// dollar figure, so every reader of the counts reads it as nothing counted.
const bareEntry = (ticket: string): ForemanSpent => ({ ticket, counts: COUNTS_NONE, usd: null, timing: null, queuedMs: null })

// The ledger with this read's spending and times taken in. A reading is taken
// only from the owner's row of a pairing: the row in the pairing's owner
// file, whose session id and ticket match the pairing's owner, so a fork's
// file is never read. Each reading replaces its ticket's entry in place,
// keeping the larger of the stored and the new value in each count, in the
// dollars and in each per-state total, so an entry never falls, while the
// stamps and rounds take the newest reading; a ticket with no entry yet gets
// one at the end, so the list stays in the order the tickets were first read.
// A row that carries times and no spending makes an entry with zero counts
// and an unknown dollar figure. A row that carries neither changes nothing,
// and either one missing keeps what the entry held of it.
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
    const timing = row.record.timing
    if (reading === null && timing === undefined) continue
    const at = place.get(p.ticket)
    const stored = at === undefined ? bareEntry(p.ticket) : (spent ?? t.spent)[at]!
    const next: ForemanSpent = {
      ticket: p.ticket,
      counts: reading === null ? stored.counts : larger(stored.counts, reading.counts),
      usd: reading === null ? stored.usd : largerUsd(stored.usd, reading.usd),
      timing: withTiming(stored.timing, timing),
      queuedMs: stored.queuedMs,
    }
    if (at !== undefined && sameSpend(next, stored) && sameTiming(next.timing, stored.timing)) continue
    spent ??= [...t.spent]
    if (at === undefined) {
      place.set(p.ticket, spent.length)
      spent.push(next)
    } else spent[at] = next
  }
  return spent === null ? t : { ...t, spent }
}

// The ledger with `ms`, the time the sub session of `ticket` waited in
// foreman's queue before its begin message, or 0 for one begun without
// waiting, taken into the ticket's entry, which is made when there is none.
// The larger of the stored and the new value is kept, so a queue time never
// falls and a known one never turns unknown. A value that changes nothing
// gives back the same ledger.
export function withQueued(t: ForemanTickets, ticket: string, ms: number): ForemanTickets {
  const at = t.spent.findIndex(e => e.ticket === ticket)
  if (at === -1) return { ...t, spent: [...t.spent, { ...bareEntry(ticket), queuedMs: ms }] }
  const stored = t.spent[at]!
  const queuedMs = stored.queuedMs === null ? ms : Math.max(stored.queuedMs, ms)
  if (queuedMs === stored.queuedMs) return t
  const spent = [...t.spent]
  spent[at] = { ...stored, queuedMs }
  return { ...t, spent }
}

// The ledger with the spent list brought back to MAX_SPENT entries where it
// can be: while it holds more, the oldest entry whose ticket has no pairing is
// removed and added into the earlier total, in the same ledger. Its spending
// joins the earlier spending, and its four times join the earlier time sums;
// its stages and rounds are not kept. An entry whose pairing still exists is
// never folded, so the list may stay longer until those pairings are
// forgotten. The sums are the same before and after.
export function folded(t: ForemanTickets): ForemanTickets {
  if (t.spent.length <= MAX_SPENT) return t
  const paired = new Set(t.pairings.map(p => p.ticket))
  const fold = new Set(t.spent.filter(e => !paired.has(e.ticket)).slice(0, t.spent.length - MAX_SPENT))
  if (fold.size === 0) return t
  let earlier = t.earlier
  for (const e of fold) {
    earlier = {
      counts: plus(earlier?.counts ?? COUNTS_NONE, e.counts),
      usd: plusKnown(earlier?.usd ?? null, e.usd),
      times: plusTimes(earlier?.times ?? TIMES_UNKNOWN, entryTimes(e)),
    }
  }
  return { ...t, spent: t.spent.filter(e => !fold.has(e)), earlier }
}

// What every sub session this parent started spent: the entries plus the
// earlier total. Its dollars are the sum of the known figures, and unknown
// only when none is known. Null when nothing has been read at all.
export function spentSum(t: ForemanTickets): ForemanSpend | null {
  const all: ForemanSpend[] = t.earlier === null ? t.spent : [t.earlier, ...t.spent]
  if (all.length === 0) return null
  return all.reduce<ForemanSpend>((sum, s) => ({ counts: plus(sum.counts, s.counts), usd: plusKnown(sum.usd, s.usd) }), { counts: COUNTS_NONE, usd: null })
}

// How many issues merged, and what each cost on average: the entries of the
// spent list whose last timing reading has a merge time, and the summed
// dollars of those of them that have a dollar figure divided by how many have
// one, or null when none has. An entry whose cost is unknown is never counted
// as zero. The entries folded into the earlier total count in neither,
// because the earlier total keeps no merge times.
export type Merged = { count: number; average: number | null }

export function mergedOf(t: ForemanTickets): Merged {
  const merged = t.spent.filter(e => typeof e.timing?.prMergedAt === 'number')
  const known = merged.flatMap(e => (e.usd === null ? [] : [e.usd]))
  return { count: merged.length, average: known.length === 0 ? null : known.reduce((sum, usd) => sum + usd, 0) / known.length }
}

// Four times that are all unknown.
export const TIMES_UNKNOWN: ForemanTimes = { working: null, needsYou: null, otherWaiting: null, queued: null }

// The four times of a reading and a queue time: working is the `working`
// total, waiting on the person the `needs-you` total, and other waiting the
// sum of every other state, worked out from STATES so that a state builder
// adds later is counted there too, as builder's own pane counts it. Each is
// unknown without a reading, and the queue time is unknown when it is null.
export function timesOf(timing: RecordTiming | null, queuedMs: number | null): ForemanTimes {
  if (timing === null) return { ...TIMES_UNKNOWN, queued: queuedMs }
  const s = timing.states
  const otherWaiting = STATES.filter(state => state !== 'working' && state !== 'needs-you').reduce((sum, state) => sum + s[state], 0)
  return { working: s.working, needsYou: s['needs-you'], otherWaiting, queued: queuedMs }
}

const entryTimes = (e: ForemanSpent) => timesOf(e.timing, e.queuedMs)

const plusTimes = (a: ForemanTimes, b: ForemanTimes): ForemanTimes => ({
  working: plusKnown(a.working, b.working), needsYou: plusKnown(a.needsYou, b.needsYou),
  otherWaiting: plusKnown(a.otherWaiting, b.otherWaiting), queued: plusKnown(a.queued, b.queued),
})

// The four times of the entry for `ticket`, or all unknown when the ticket
// is null or has no entry.
export function ticketTimes(t: ForemanTickets, ticket: string | null): ForemanTimes {
  const e = ticket === null ? undefined : t.spent.find(x => x.ticket === ticket)
  return e === undefined ? TIMES_UNKNOWN : entryTimes(e)
}

// Each of the four times summed over every sub session this parent started:
// the entries plus the earlier sums. A sum is the sum of the known values,
// and unknown only when none is known. Sub sessions run side by side, so a
// sum can be longer than the run.
export function timeSum(t: ForemanTickets): ForemanTimes {
  return t.spent.reduce((sum, e) => plusTimes(sum, entryTimes(e)), t.earlier?.times ?? TIMES_UNKNOWN)
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
  return `${tokens} · ${usdWords(usd)}`
}

// The words for a figure in dollars, or `cost unknown`, never $0.00 for a
// figure foreman does not know.
export const usdWords = (usd: number | null) => (usd === null ? 'cost unknown' : `$${usd.toFixed(2)}`)

