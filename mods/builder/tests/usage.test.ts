import { expect, mock, test } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { afterCost, afterStep, emptyUsage, TURNS_KEPT, usageIn } from '../hooks/usage'
import type { ModelTokens, UsageLedger } from '../types'
import { AGENT_TRANSCRIPTS, MAIN_TRANSCRIPT } from './transcript-fixture'

const NOW = 1_000_000

const used = (model: string, input: number, output: number, cacheRead: number, cacheWrite: number): TurnUsage => ({
  model, input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite,
})

const ledger = (over: Partial<UsageLedger> = {}): UsageLedger => ({ ...emptyUsage('session-1', NOW), ...over })

// One response of a transcript: its message id, its model and its usage.
type Response = { id: string; model: string; usage: TurnUsage }

// The responses of a transcript in the order written, one per line that
// holds an assistant message with usage, so a response written as several
// lines appears several times.
function responsesOf(transcript: string): Response[] {
  return transcript.split('\n').flatMap(line => {
    const entry = JSON.parse(line) as { type: string; message?: { id?: string; model?: string; usage?: Omit<TurnUsage, 'model'> } }
    const m = entry.message
    if (entry.type !== 'assistant' || m?.id === undefined || m.model === undefined || m.usage === undefined) return []
    return [{ id: m.id, model: m.model, usage: { ...m.usage, model: m.model } }]
  })
}

// The responses with every repeat of a message id after the first left out.
function distinct(responses: readonly Response[]): Response[] {
  const seen = new Set<string>()
  return responses.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
}

// The tokens of the responses summed by model, sorted by model name.
function sumByModel(responses: readonly Response[]): ModelTokens[] {
  const sums = new Map<string, ModelTokens>()
  for (const { usage } of responses) {
    const sum = sums.get(usage.model) ?? { model: usage.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    sums.set(usage.model, {
      model: usage.model,
      input: sum.input + usage.input_tokens,
      output: sum.output + usage.output_tokens,
      cacheRead: sum.cacheRead + usage.cache_read_input_tokens,
      cacheWrite: sum.cacheWrite + usage.cache_creation_input_tokens,
    })
  }
  return [...sums.values()].sort((a, b) => (a.model < b.model ? -1 : 1))
}

// Answers every model step at the bottom of the chain with the usage the
// test queued for its turn and index, or with none when it queued nothing.
function modelAnswering(on: On) {
  const answers = new Map<string, TurnUsage>()
  on('turn.step', async function* ($, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: answers.get(`${e.turnId}:${e.index}`) ?? null }
  })
  return answers
}

// Runs one model step to its end.
async function step($: Engine, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId, index, model: 'example-model-large', messageCount: 2, ...(agentId === undefined ? {} : { agentId }) })
  for (;;) if ((await stream.next()).done) return
}

// Follows builder's writes of its `usage` state value, so a test can read
// the ledger it last wrote, or null before the first write.
function heldUsage(on: On) {
  const held = { value: undefined as unknown }
  on('state.set', async ($, e, next) => {
    const out = await next(e)
    if (e.plugin === 'builder' && e.key === 'usage') held.value = e.value
    return out
  })
  return { ledger: () => usageIn(held.value, 'session-1') }
}

test('the transcript fixture sums differently with its repeated lines left in, so a sum that forgot to remove them cannot pass', () => {
  const all = [MAIN_TRANSCRIPT, ...AGENT_TRANSCRIPTS].flatMap(responsesOf)
  expect(distinct(all).length).toBe(7)
  expect(all.length).toBeGreaterThan(distinct(all).length)
  expect(sumByModel(all)).not.toEqual(sumByModel(distinct(all)))
})

test('replaying the fixture\'s responses as model steps, some of them twice and one at a lower index, gives the transcript sum with repeats removed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.id', () => ({ value: 'session-1' }))
  const answers = modelAnswering(on)
  const held = heldUsage(on)
  const loops = [
    { turnId: 'turn-main', transcript: MAIN_TRANSCRIPT },
    { turnId: 'turn-agent-a', agentId: 'agent-a', transcript: AGENT_TRANSCRIPTS[0] },
    { turnId: 'turn-agent-b', agentId: 'agent-b', transcript: AGENT_TRANSCRIPTS[1] },
  ]
  for (const loop of loops) distinct(responsesOf(loop.transcript)).forEach((r, index) => answers.set(`${loop.turnId}:${index}`, r.usage))

  for (const loop of loops) {
    const count = distinct(responsesOf(loop.transcript)).length
    for (let index = 0; index < count; index += 1) {
      await step($, loop.turnId, index, loop.agentId)
      await clock.settle()
      // Every step is sent a second time, as a repeated event would be.
      await step($, loop.turnId, index, loop.agentId)
      await clock.settle()
    }
    // A step at a lower index than the one counted comes again.
    await step($, loop.turnId, 0, loop.agentId)
    await clock.settle()
  }

  const expected = sumByModel(distinct([MAIN_TRANSCRIPT, ...AGENT_TRANSCRIPTS].flatMap(responsesOf)))
  expect(held.ledger()?.models).toEqual(expected)
})

test('a step is added once: a repeat and a lower index of the same turn add nothing and give back the same ledger', () => {
  const first = afterStep(ledger(), 'turn-1', 0, used('m', 1, 2, 3, 4), NOW + 1)
  expect(first.models).toEqual([{ model: 'm', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }])
  expect(first.turns).toEqual([{ turnId: 'turn-1', index: 0 }])
  expect(first.at).toBe(NOW + 1)
  expect(afterStep(first, 'turn-1', 0, used('m', 1, 2, 3, 4), NOW + 2)).toBe(first)

  const second = afterStep(first, 'turn-1', 2, used('m', 10, 20, 30, 40), NOW + 3)
  expect(second.models).toEqual([{ model: 'm', input: 11, output: 22, cacheRead: 33, cacheWrite: 44 }])
  expect(afterStep(second, 'turn-1', 1, used('m', 5, 5, 5, 5), NOW + 4)).toBe(second)
})

test('a step with no usage adds nothing and leaves its index free for a later step at the same index', () => {
  const start = ledger()
  expect(afterStep(start, 'turn-1', 0, null, NOW + 1)).toBe(start)
  const counted = afterStep(start, 'turn-1', 0, used('m', 1, 1, 1, 1), NOW + 2)
  expect(counted.models).toEqual([{ model: 'm', input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }])
})

test('two turns are counted on their own, and the models are kept apart and sorted by name', () => {
  let l = afterStep(ledger(), 'turn-1', 0, used('zeta', 1, 0, 0, 0), NOW)
  l = afterStep(l, 'turn-2', 0, used('alpha', 0, 1, 0, 0), NOW)
  l = afterStep(l, 'turn-2', 1, used('zeta', 0, 0, 1, 0), NOW)
  expect(l.models).toEqual([
    { model: 'alpha', input: 0, output: 1, cacheRead: 0, cacheWrite: 0 },
    { model: 'zeta', input: 1, output: 0, cacheRead: 1, cacheWrite: 0 },
  ])
  expect(l.turns).toEqual([{ turnId: 'turn-1', index: 0 }, { turnId: 'turn-2', index: 1 }])
})

test('only the newest 50 turns are remembered, by when each was last counted, so the oldest one counts again', () => {
  let l = ledger()
  for (let i = 0; i <= TURNS_KEPT; i += 1) l = afterStep(l, `turn-${i}`, 0, used('m', 1, 0, 0, 0), NOW)
  expect(TURNS_KEPT).toBe(50)
  expect(l.turns.length).toBe(TURNS_KEPT)
  expect(l.turns[0]).toEqual({ turnId: 'turn-1', index: 0 })
  // Counting turn-1 again moves it to the end, so turn-2 is now the oldest.
  l = afterStep(l, 'turn-1', 1, used('m', 1, 0, 0, 0), NOW)
  expect(l.turns.at(-1)).toEqual({ turnId: 'turn-1', index: 1 })
  expect(l.turns[0]).toEqual({ turnId: 'turn-2', index: 0 })
  const before = l.models[0]?.input ?? 0
  expect(afterStep(l, 'turn-0', 0, used('m', 1, 0, 0, 0), NOW).models[0]?.input).toBe(before + 1)
})

test('a count the response left out, or one that is not a number of zero or more, adds zero', () => {
  const odd = { model: 'm', input_tokens: -5, output_tokens: Number.NaN, cache_read_input_tokens: 7 } as unknown as TurnUsage
  expect(afterStep(ledger(), 'turn-1', 0, odd, NOW).models).toEqual([{ model: 'm', input: 0, output: 0, cacheRead: 7, cacheWrite: 0 }])
})

test('the first dollar reading and a lower one are added in full, a higher one adds only the increase, and the same one twice adds nothing', () => {
  const first = afterCost(ledger(), 1.5)
  expect(first.usd).toBe(1.5)
  expect(first.lastEngineUsd).toBe(1.5)
  const higher = afterCost(first, 2)
  expect(higher.usd).toBe(2)
  expect(afterCost(higher, 2)).toBe(higher)
  // The engine started again from zero, as a resumed session may.
  const lower = afterCost(higher, 0.25)
  expect(lower.usd).toBe(2.25)
  expect(lower.lastEngineUsd).toBe(0.25)
  expect(afterCost(lower, 1).usd).toBe(3)
})

test('a missing dollar reading leaves the total unknown before any reading, and as it was after one', () => {
  const start = ledger()
  for (const missing of [undefined, null, Number.NaN, -1, Infinity, '2']) expect(afterCost(start, missing)).toBe(start)
  expect(start.usd).toBeNull()
  const known = afterCost(start, 0.75)
  expect(afterCost(known, undefined)).toBe(known)
  expect(known.usd).toBe(0.75)
})

test('a stored ledger reads back as it was, and one that is damaged in any part, or another session\'s, reads as none', () => {
  const good = afterCost(afterStep(ledger(), 'turn-1', 0, used('m', 1, 2, 3, 4), NOW), 0.5)
  expect(usageIn(JSON.parse(JSON.stringify(good)), 'session-1')).toEqual(good)
  expect(usageIn(good, 'session-2')).toBeNull()
  const damaged: unknown[] = [
    undefined, null, 'text', 7, [],
    { ...good, models: 'none' },
    { ...good, models: [...good.models, { model: 'n', input: 1, output: -1, cacheRead: 0, cacheWrite: 0 }] },
    { ...good, models: [{ model: 3, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }] },
    { ...good, models: [{ model: 'm', input: 1.5, output: 1, cacheRead: 0, cacheWrite: 0 }] },
    { ...good, usd: 'free' },
    { ...good, usd: -1 },
    { ...good, lastEngineUsd: Number.NaN },
    { ...good, turns: [{ turnId: 'turn-1' }] },
    { ...good, turns: {} },
    { ...good, at: 'now' },
    { ...good, sessionId: undefined },
  ]
  for (const raw of damaged) expect(usageIn(raw, 'session-1')).toBeNull()
})
