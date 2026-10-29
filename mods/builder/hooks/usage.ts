// The rules for counting what the session spends: the tokens of every model
// step, split by model, and one dollar total built from the engine's figure.
// Every function is pure; hooks/register.tsx runs them inside its state
// writes and stores the ledger they give back. A change that adds nothing
// gives back the very ledger it was handed, so the caller can tell that
// nothing needs to be written.

import type { TurnUsage } from 'claude-code'

import type { CountedTurn, ModelTokens, TokenCounts, UsageLedger } from '../types'
import { thousands } from './context'
import { printable } from './text'

// How many turns the ledger remembers the highest counted step of. A
// repeated step arrives within its turn or just after it, so a turn older
// than these 50 can safely be forgotten.
export const TURNS_KEPT = 50

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
const isDollars = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function modelIn(raw: unknown): ModelTokens | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m.model !== 'string' || !isCount(m.input) || !isCount(m.output) || !isCount(m.cacheRead) || !isCount(m.cacheWrite)) return null
  return { model: m.model, input: m.input, output: m.output, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite }
}

function turnIn(raw: unknown): CountedTurn | null {
  if (typeof raw !== 'object' || raw === null) return null
  const t = raw as Record<string, unknown>
  return typeof t.turnId === 'string' && isCount(t.index) ? { turnId: t.turnId, index: t.index } : null
}

// Every entry of a list read through `entryIn`, or null when the value is not
// a list or any one entry does not read.
function listIn<T>(raw: unknown, entryIn: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null
  const entries: T[] = []
  for (const entry of raw as unknown[]) {
    const read = entryIn(entry)
    if (read === null) return null
    entries.push(read)
  }
  return entries
}

// The ledger a stored or held value holds for `sessionId`, or null when the
// value is damaged in any part or was counted for another session, so a
// damaged ledger starts the counting again from zero rather than failing.
export function usageIn(raw: unknown, sessionId: string): UsageLedger | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const l = raw as Record<string, unknown>
  if (l.sessionId !== sessionId) return null
  const models = listIn(l.models, modelIn)
  const turns = listIn(l.turns, turnIn)
  if (models === null || turns === null) return null
  if (!(l.usd === null || isDollars(l.usd)) || !(l.lastEngineUsd === null || isDollars(l.lastEngineUsd)) || !isFiniteNumber(l.at)) return null
  return { sessionId, models, usd: l.usd, lastEngineUsd: l.lastEngineUsd, turns, at: l.at }
}

// A ledger with nothing counted and no dollar reading.
export function emptyUsage(sessionId: string, now: number): UsageLedger {
  return { sessionId, models: [], usd: null, lastEngineUsd: null, turns: [], at: now }
}

// A count from the API as the ledger adds it: a count the response left out,
// or one that is not a number of zero or more, adds zero.
const countOf = (n: unknown) => (isFiniteNumber(n) && n >= 0 ? Math.round(n) : 0)

const byModel = (a: ModelTokens, b: ModelTokens) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)

// The ledger after one model step: the step's usage added to its model's
// counts, and the step's index remembered for its turn. A step adds nothing
// when it carried no usage, which leaves its index free for a later request
// at the same index, or when its index is not higher than the one already
// counted for its turn, as for a repeated event. The turn counted last moves
// to the end of the remembered turns, and only the newest TURNS_KEPT stay.
export function afterStep(ledger: UsageLedger, turnId: string, index: number, usage: TurnUsage | null, now: number): UsageLedger {
  if (usage === null || !isCount(index)) return ledger
  const counted = ledger.turns.find(t => t.turnId === turnId)
  if (counted !== undefined && index <= counted.index) return ledger
  const model = typeof usage.model === 'string' ? usage.model : ''
  const before = ledger.models.find(m => m.model === model) ?? { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const after: ModelTokens = {
    model,
    input: before.input + countOf(usage.input_tokens),
    output: before.output + countOf(usage.output_tokens),
    cacheRead: before.cacheRead + countOf(usage.cache_read_input_tokens),
    cacheWrite: before.cacheWrite + countOf(usage.cache_creation_input_tokens),
  }
  return {
    ...ledger,
    models: [...ledger.models.filter(m => m.model !== model), after].sort(byModel),
    turns: [...ledger.turns.filter(t => t.turnId !== turnId), { turnId, index }].slice(-TURNS_KEPT),
    at: now,
  }
}

// The ledger after one reading of the engine's dollar figure for the
// session. A reading that is not a finite number of zero or more is no
// reading, and leaves the total as it was: unknown before the first reading,
// and known after one. The first reading is added in full. After that only
// an increase is added, and a reading lower than the last one is taken as the
// engine starting again from zero, as a resumed session may, and is added in
// full. The same reading twice adds nothing.
export function afterCost(ledger: UsageLedger, usd: unknown): UsageLedger {
  if (!isDollars(usd) || usd === ledger.lastEngineUsd) return ledger
  const last = ledger.lastEngineUsd
  const added = last === null || usd < last ? usd : usd - last
  return { ...ledger, usd: (ledger.usd ?? 0) + added, lastEngineUsd: usd }
}

// A count as the pane shows it: in thousands below a million, and in millions
// with one decimal from a million up. Foreman's pane writes the same words
// for its sub sessions' spending with its own copy of this, in
// mods/foreman/hooks/spend.ts, so a change here has to be made there too.
const countWords = (n: number) => (n < 1_000_000 ? thousands(n) : `${(n / 1_000_000).toFixed(1)}M`)

const kindsWords = (c: TokenCounts) =>
  `${countWords(c.input)} in, ${countWords(c.output)} out, ${countWords(c.cacheRead)} cache read, ${countWords(c.cacheWrite)} cache write`

const dollarsWords = (usd: number | null) => (usd === null ? 'cost unknown' : `$${usd.toFixed(2)}`)

// The pane's lines for what the session spent: the four kinds summed over
// the models and the dollar total, or the words "cost unknown" while the
// engine has given no reading, never $0; then one line per model with its
// four counts. While no model step has been counted, which is the case for
// the empty ledger the session's start seeds as well as when there is no
// ledger at all, it says "nothing counted yet" in place of the counts, with
// the dollars beside it, as foreman's pane words an empty ledger. The model
// names came from the API, so they are cleaned.
export function usageLines(usage: UsageLedger | null): string[] {
  if (usage === null) return [`Spent: nothing counted yet · ${dollarsWords(null)}`]
  if (usage.models.length === 0) return [`Spent: nothing counted yet · ${dollarsWords(usage.usd)}`]
  const total = usage.models.reduce<TokenCounts>(
    (sum, m) => ({ input: sum.input + m.input, output: sum.output + m.output, cacheRead: sum.cacheRead + m.cacheRead, cacheWrite: sum.cacheWrite + m.cacheWrite }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )
  return [
    `Spent: ${kindsWords(total)} · ${dollarsWords(usage.usd)}`,
    ...usage.models.map(m => `  ${printable(m.model, 60)}: ${kindsWords(m)}`),
  ]
}
