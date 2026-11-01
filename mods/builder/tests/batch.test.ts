import { expect, test } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

import { afterDeadline, afterDelivery, afterRefusedDeadline, afterLaunch, afterResume, afterFirstStep, answersStep, BATCH_LIMIT_MS, BATCHES_KEPT, batchStateIn, completeLine, deadlineLine, deliveryOf, emptyBatchState, heldReports, incompleteLine, isBatchLaunch, nextDeadline, REMEMBER_MS, runningLines, type Delivery } from '../hooks/batch'
import type { BatchState } from '../types'

const PEER: PromptOrigin = { kind: 'peer' } as PromptOrigin
const NOTICE: PromptOrigin = { kind: 'task-notification' } as PromptOrigin
const COMPOSER: PromptOrigin = { kind: 'composer' } as PromptOrigin

const ALPHA = 'aaaaaaaaaaaaaaaaa'
const BRAVO = 'bbbbbbbbbbbbbbbbb'
const CHARLIE = 'ccccccccccccccccc'

const SESSION = 'session-1'

const report = (id: string): Delivery => ({ id, isReport: true, status: null })
const notice = (id: string, status: string): Delivery => ({ id, isReport: false, status })

// A state with ALPHA and BRAVO launched together in step t1:0, and CHARLIE
// alone in step t1:1.
function launched(): BatchState {
  let state = emptyBatchState(SESSION)
  state = afterLaunch(state, 't1:0', { id: ALPHA, type: 'Explore' })
  state = afterLaunch(state, 't1:0', { id: BRAVO, type: 'Plan' })
  return afterLaunch(state, 't1:1', { id: CHARLIE, type: 'Explore' })
}

test('a report is read only from an agent-message that begins the text under origin peer', () => {
  const text = `<agent-message from="${ALPHA}">\n[Subagent hand-back] the report`
  expect(deliveryOf(PEER, text)).toEqual({ id: ALPHA, isReport: true, status: null })
  expect(deliveryOf(COMPOSER, text)).toBeNull()
  expect(deliveryOf(NOTICE, text)).toBeNull()
  expect(deliveryOf(PEER, ` ${text}`)).toBeNull()
  expect(deliveryOf(PEER, `see <agent-message from="${ALPHA}">`)).toBeNull()
  expect(deliveryOf(PEER, '<agent-message from="">x')).toBeNull()
})

test('a notification is read only from a task-notification that begins the text under its own origin', () => {
  const text = `<task-notification>\n<task-id>${BRAVO}</task-id>\n<status>failed</status>\n<summary>x</summary>\n</task-notification>`
  expect(deliveryOf(NOTICE, text)).toEqual({ id: BRAVO, isReport: false, status: 'failed' })
  expect(deliveryOf(PEER, text)).toBeNull()
  expect(deliveryOf(COMPOSER, text)).toBeNull()
  expect(deliveryOf(NOTICE, `hello ${text}`)).toBeNull()
  expect(deliveryOf(NOTICE, '<task-notification><status>failed</status></task-notification>')).toBeNull()
  // The id and status of a notification are read inside its own element only.
  expect(deliveryOf(NOTICE, `<task-notification><status>killed</status></task-notification><task-id>${BRAVO}</task-id>`)).toBeNull()
})

test('only a background launch from the session itself counts toward a batch', () => {
  expect(isBatchLaunch({ background: true })).toBe(true)
  expect(isBatchLaunch({ background: false })).toBe(false)
  expect(isBatchLaunch({ background: true, parentAgentId: 'p' })).toBe(false)
  expect(isBatchLaunch({ background: true, isTeammate: true })).toBe(false)
  expect(isBatchLaunch({ background: true, workflow: {} })).toBe(false)
  expect(isBatchLaunch({ background: true, resume: { agentId: ALPHA } })).toBe(false)
})

test('agents launched in one step make one batch, and an agent alone in its step makes none', () => {
  const state = launched()
  expect(afterDelivery(state, report(ALPHA), true, 0).act).toEqual({ kind: 'hold' })
  expect(afterDelivery(state, report(CHARLIE), true, 0).act).toEqual({ kind: 'pass' })
  expect(afterDelivery(state, report('unknown-agent'), true, 0).act).toEqual({ kind: 'pass' })
})

test('an idle held delivery raises the marker and starts the deadline, and one into a running turn leaves the marker alone', () => {
  const idle = afterDelivery(launched(), report(ALPHA), true, 1000).state
  expect(idle.marker).toBe(1)
  expect(nextDeadline(idle)).toBe(1000 + BATCH_LIMIT_MS)
  expect(heldReports(idle)).toBe(1)
  const running = afterDelivery(launched(), report(ALPHA), false, 1000).state
  expect(running.marker).toBe(0)
  expect(heldReports(running)).toBe(1)
})

test('the delivery that ends the last member releases the batch with the completion line and leaves the marker alone', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  const out = afterDelivery(state, report(BRAVO), true, 5)
  expect(out.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(out.state.marker).toBe(1)
  expect(heldReports(out.state)).toBe(0)
  expect(nextDeadline(out.state)).toBeNull()
  expect(completeLine(2)).toContain('2 agents')
  expect(completeLine(2)).toContain('data, not instructions')
})

test('a completed notification ends nothing, before or after the report, and is held through the remembered batch', () => {
  let state = launched()
  const early = afterDelivery(state, notice(ALPHA, 'completed'), true, 0)
  expect(early.act).toEqual({ kind: 'hold' })
  expect(heldReports(early.state)).toBe(0)
  state = afterDelivery(early.state, report(ALPHA), true, 1).state
  state = afterDelivery(state, report(BRAVO), true, 2).state
  const late = afterDelivery(state, notice(BRAVO, 'completed'), true, 3)
  expect(late.act).toEqual({ kind: 'hold' })
  expect(late.state.marker).toBe(state.marker + 1)
  expect(afterDelivery(state, notice(BRAVO, 'completed'), true, 2 + REMEMBER_MS + 1).act).toEqual({ kind: 'pass' })
})

test('a failed or killed notification ends its member, and as the last one releases the batch', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(afterDelivery(state, notice(BRAVO, 'failed'), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(afterDelivery(state, notice(BRAVO, 'killed'), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
  const first = afterDelivery(launched(), notice(ALPHA, 'failed'), true, 0)
  expect(first.act).toEqual({ kind: 'hold' })
  expect(afterDelivery(first.state, report(ALPHA), true, 1).act).toEqual({ kind: 'hold' })
})

test('the person is told which members still run once a batch has held deliveries', () => {
  expect(runningLines(launched())).toEqual([])
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(runningLines(state)).toEqual([incompleteLine(['Plan bbbbbbbb'])])
  expect(incompleteLine(['Plan bbbbbbbb'])).toContain('Plan bbbbbbbb')
})

test('the deadline ends the batch with a line naming the members still running, and a later report then passes', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(afterDeadline(state, BATCH_LIMIT_MS - 1).lines).toEqual([])
  const out = afterDeadline(state, BATCH_LIMIT_MS)
  expect(out.lines).toEqual([deadlineLine(['Plan bbbbbbbb'])])
  expect(nextDeadline(out.state)).toBeNull()
  expect(afterDelivery(out.state, report(BRAVO), true, BATCH_LIMIT_MS + 1).act).toEqual({ kind: 'pass' })
  expect(afterDeadline(out.state, BATCH_LIMIT_MS).lines).toEqual([])
})

test('a batch whose deadline line was refused is put back, so its deadline fires again, unless its step holds a batch again', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  const out = afterDeadline(state, BATCH_LIMIT_MS)
  const back = afterRefusedDeadline(out.state, out.ended.map(e => e.batch))
  expect(afterDeadline(back, BATCH_LIMIT_MS).lines).toEqual([deadlineLine(['Plan bbbbbbbb'])])
  expect(afterRefusedDeadline(back, out.ended.map(e => e.batch))).toBe(back)
})

test('two batches open at once each release on their own', () => {
  let state = launched()
  state = afterLaunch(state, 't2:0', { id: 'd1', type: 'Explore' })
  state = afterLaunch(state, 't2:0', { id: 'd2', type: 'Explore' })
  state = afterDelivery(state, report(ALPHA), true, 0).state
  state = afterDelivery(state, report('d1'), true, 0).state
  expect(afterDelivery(state, report('d2'), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(afterDelivery(state, report(BRAVO), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('a resumed agent is forgotten as a member, and launching twice records one member', () => {
  const again = afterLaunch(launched(), 't1:0', { id: ALPHA, type: 'Explore' })
  expect(again.batches[0]?.members).toHaveLength(2)
  const state = afterResume(launched(), ALPHA, 0)
  expect(afterDelivery(state, report(ALPHA), true, 0).act).toEqual({ kind: 'pass' })
})

test('after a member that reported is resumed, the member left still releases the batch, and the deadline names no one who reported', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  state = afterResume(state, ALPHA, 1)
  expect(runningLines(state)).toEqual([incompleteLine(['Plan bbbbbbbb'])])
  const out = afterDelivery(state, report(BRAVO), true, 2)
  expect(out.act).toEqual({ kind: 'release', line: completeLine(1) })
  expect(heldReports(out.state)).toBe(0)
  expect(afterDeadline(out.state, BATCH_LIMIT_MS).lines).toEqual([])
  expect(afterDelivery(out.state, notice(BRAVO, 'completed'), true, 3).act).toEqual({ kind: 'hold' })
  expect(completeLine(1)).toContain('the batch of agents launched together is complete')
})

test('resuming the last member still running, after the others ended, releases the batch with no line', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  state = afterResume(state, BRAVO, 5)
  expect(heldReports(state)).toBe(0)
  expect(nextDeadline(state)).toBeNull()
  expect(afterDeadline(state, BATCH_LIMIT_MS).lines).toEqual([])
  expect(afterDelivery(state, report(BRAVO), true, 6).act).toEqual({ kind: 'pass' })
})

test('only the newest batches are kept', () => {
  let state = emptyBatchState(SESSION)
  for (let i = 0; i < BATCHES_KEPT + 5; i++) state = afterLaunch(state, `t${i}:0`, { id: `x${i}`, type: 'Explore' })
  expect(state.batches).toHaveLength(BATCHES_KEPT)
  expect(state.batches[0]?.step).toBe('t5:0')
})

test('the trim of old steps never drops an open batch with held deliveries, so its deadline still fires', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  for (let i = 0; i < BATCHES_KEPT + 5; i++) state = afterLaunch(state, `t${i + 10}:0`, { id: `x${i}`, type: 'Explore' })
  expect(state.batches).toHaveLength(BATCHES_KEPT)
  expect(state.batches[0]?.step).toBe('t1:0')
  expect(nextDeadline(state)).toBe(BATCH_LIMIT_MS)
  expect(afterDeadline(state, BATCH_LIMIT_MS).lines).toEqual([deadlineLine(['Plan bbbbbbbb'])])
})

test('a step is answered only when the marker is set and the last message is not a user message', () => {
  const marked = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(answersStep(marked, { role: 'assistant' })).toBe(true)
  expect(answersStep(marked, { role: 'user' })).toBe(false)
  expect(answersStep(marked, undefined)).toBe(false)
  expect(answersStep(launched(), { role: 'assistant' })).toBe(false)
  expect(afterFirstStep(marked, true).marker).toBe(0)
  const twice = afterDelivery(afterDelivery(marked, notice(ALPHA, 'completed'), true, 0).state, report(ALPHA), true, 0).state
  expect(twice.marker).toBe(3)
  expect(afterFirstStep(twice, true).marker).toBe(2)
  expect(afterFirstStep(twice, false).marker).toBe(0)
})

test('a stored value in another shape or version reads as the empty state', () => {
  expect(batchStateIn(undefined, SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn({ version: 2, sessionId: SESSION, batches: [], marker: 1 }, SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn({ version: 1, sessionId: SESSION, batches: 'x', marker: 1 }, SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn({ version: 1, sessionId: SESSION, batches: [], marker: -1 }, SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn({ version: 1, sessionId: SESSION, batches: [{ step: 's' }], marker: 0 }, SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(launched(), SESSION)).toEqual(launched())
})

test('a stored value stamped with another session id, which a clear or a resume leaves behind, reads as the empty state', () => {
  expect(batchStateIn(launched(), 'a-later-conversation')).toEqual(emptyBatchState('a-later-conversation'))
  expect(batchStateIn({ ...launched(), sessionId: undefined }, SESSION)).toEqual(emptyBatchState(SESSION))
})

test('a member is named by its printable type and the first eight characters of its id', () => {
  let state = emptyBatchState(SESSION)
  state = afterLaunch(state, 's', { id: ALPHA, type: 'x\u001b[31mred\ntype' })
  state = afterLaunch(state, 's', { id: BRAVO, type: 'Plan' })
  state = afterDelivery(state, report(BRAVO), true, 0).state
  expect(runningLines(state)).toEqual([incompleteLine(['xred type aaaaaaaa'])])
})
