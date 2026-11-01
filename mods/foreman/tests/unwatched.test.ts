import { expect, test } from 'claude-code/testing'
import type { On, SessionMessage, TurnStepChunk } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { ticketsIn, ticketsKey, TICKETS_EMPTY } from '../hooks/tickets'
import type { ForemanCheck } from '../types'
import { MESSAGE, MINUTE, mountBoth, note, start, T0, world } from './world'

// The checks foreman makes by itself of a sub session it holds no record of:
// a turn-end note about one records it in the ledger, and the parent's model
// is asked for nothing but "Noted.".

type World = ReturnType<typeof world>

const ledger = (w: World) => ticketsIn(w.stored.get(ticketsKey('session-1')))

// The line a prompt made only of a note about `id` is rewritten to.
const ALONE = (id: string) => `Kept ${id}'s turn-end note from the parent's model.`

// A record as foreman writes it for a note read at `notedAt`, due five
// minutes later unless `over` says otherwise.
const check = (id: string, notedAt: number, over: Partial<ForemanCheck> = {}): ForemanCheck => ({ id, notedAt, dueAt: notedAt + 5 * MINUTE, nudged: false, answered: false, ...over })

const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never) as Promise<{ text?: string; context?: readonly string[] }>

// A parent session started and mounted, with its role on or off, and with
// `unwatched` and `checks` in its stored ledger.
async function parentWith($: Engine, on: On, { isOn = true, unwatched = [] as string[], checks = [] as ForemanCheck[] } = {}) {
  const w = world(on, { store: { 'parent:session-1': { isOn, slots: null }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, unwatched, checks } } })
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  return { w, ui }
}

// Stands in for the model and the conversation: each step the model is asked
// for counts one call, and the conversation the mod reads is `messages`.
function modelAndTalk(on: On) {
  const held = { calls: 0, messages: [] as SessionMessage[] }
  on('turn.step', async function* ($, e) {
    held.calls += 1
    yield { kind: 'text', index: 0, text: 'From the model.' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: 'From the model.', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.messages', () => ({ value: held.messages }))
  return held
}

// The text the first step of a turn answers.
async function answerOf($: Engine): Promise<string> {
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'example-model', messageCount: 1 })
  const chunks: TurnStepChunk[] = []
  for (;;) {
    const r = await stream.next()
    if (r.done) break
    chunks.push(r.value)
  }
  return chunks.flatMap(c => (c.kind === 'text' ? [c.text] : [])).join('')
}

for (const isOn of [true, false]) {
  const role = isOn ? 'on' : 'off'
  test(`with the role ${role}, a note about a sub session foreman holds no record of wakes no model, is answered "Noted.", and records a check due five minutes later`, async ($, on) => {
    const talk = modelAndTalk(on)
    const { w } = await parentWith($, on, { isOn, unwatched: ['local_u'] })
    expect(await submit($, note('local_u'))).toEqual({ text: ALONE('local_u') })
    talk.messages = [{ role: 'user', text: ALONE('local_u'), toolUses: [] }]
    expect(await answerOf($)).toBe('Noted.')
    expect(talk.calls).toBe(0)
    expect(ledger(w).checks).toEqual([check('local_u', T0)])
    expect(w.engine.prompts).toEqual([ALONE('local_u')])
    expect(w.engine.appended).toEqual([])
  })
}

test('the due time follows the idleMinutes option', { options: { idleMinutes: 2 } }, async ($, on) => {
  const { w } = await parentWith($, on)
  await w.clock.advance(MINUTE)
  await submit($, note('local_u'))
  expect(ledger(w).checks).toEqual([check('local_u', T0 + MINUTE, { dueAt: T0 + 3 * MINUTE })])
})

test('a note mixed with a message records its check too, and a newer note moves the times', async ($, on) => {
  const { w } = await parentWith($, on)
  await submit($, `${note('local_y')}\n${MESSAGE}\n${note('local_z')}`)
  expect(ledger(w).checks).toEqual([check('local_y', T0), check('local_z', T0)])
  await w.clock.advance(MINUTE)
  await submit($, note('local_y'))
  expect(ledger(w).checks).toEqual([check('local_z', T0), check('local_y', T0 + MINUTE)])
})

test('while the role is off, a note about a sub session outside the unwatched list records nothing', async ($, on) => {
  const { w } = await parentWith($, on, { isOn: false, unwatched: ['local_u'] })
  await submit($, note('local_z'))
  await submit($, `${note('local_z')}\n${MESSAGE}`)
  expect(ledger(w).checks).toEqual([])
})
