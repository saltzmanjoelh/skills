import { expect, test } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

import { afterDeadline, afterDeadlineSent, afterDelivery, afterLaunch, afterResume, afterTask, afterMemberStop, afterWake, afterFirstStep, answersStep, BATCH_LIMIT_MS, BATCH_RETRY_CEILING_MS, BATCH_RETRY_MS, BATCH_SETTLE_MS, BATCHES_KEPT, batchStateIn, completeLine, deadlineLine, deliveryOf, emptyBatchState, heldReports, incompleteLine, isBatchLaunch, isEngineWake, listedIdsOf, nextBatchRetry, nextDeadline, REMEMBER_MS, runningLines, taskIdOf, type Delivery } from '../hooks/batch'
import type { BatchState } from '../types'
import { finishedText, parkText } from './notification-fixture'

const PEER: PromptOrigin = { kind: 'peer' } as PromptOrigin
const NOTICE: PromptOrigin = { kind: 'task-notification' } as PromptOrigin
const COMPOSER: PromptOrigin = { kind: 'composer' } as PromptOrigin

const ALPHA = 'aaaaaaaaaaaaaaaaa'
const BRAVO = 'bbbbbbbbbbbbbbbbb'
const CHARLIE = 'ccccccccccccccccc'

const SESSION = 'session-1'

const report = (id: string): Delivery => ({ id, isReport: true, status: null, finished: false })
const notice = (id: string, status: string): Delivery => ({ id, isReport: false, status, finished: false })
const finished = (id: string): Delivery => ({ id, isReport: false, status: 'completed', finished: true })
// The deadline lines due at `now`.
const dueLines = (state: BatchState, now: number) => afterDeadline(state, now).due.map(d => d.line)

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
  expect(deliveryOf(PEER, text)).toEqual({ id: ALPHA, isReport: true, status: null, finished: false })
  expect(deliveryOf(COMPOSER, text)).toBeNull()
  expect(deliveryOf(NOTICE, text)).toBeNull()
  expect(deliveryOf(PEER, ` ${text}`)).toBeNull()
  expect(deliveryOf(PEER, `see <agent-message from="${ALPHA}">`)).toBeNull()
  expect(deliveryOf(PEER, '<agent-message from="">x')).toBeNull()
})

test('a notification is read only from a task-notification that begins the text under its own origin', () => {
  const text = `<task-notification>\n<task-id>${BRAVO}</task-id>\n<status>failed</status>\n<summary>x</summary>\n</task-notification>`
  expect(deliveryOf(NOTICE, text)).toEqual({ id: BRAVO, isReport: false, status: 'failed', finished: false })
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

test('an idle held delivery raises the marker, starts the deadline and counts as held back, and one into a running turn starts the deadline but neither raises the marker nor counts', () => {
  const idle = afterDelivery(launched(), report(ALPHA), true, 1000).state
  expect(idle.marker).toBe(1)
  expect(nextDeadline(idle)).toBe(1000 + BATCH_LIMIT_MS)
  expect(heldReports(idle)).toBe(1)
  const running = afterDelivery(launched(), report(ALPHA), false, 1000).state
  expect(running.marker).toBe(0)
  expect(nextDeadline(running)).toBe(1000 + BATCH_LIMIT_MS)
  expect(heldReports(running)).toBe(0)
})

test('the delivery that ends the last member releases the batch with the completion line and clears the marker', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  const out = afterDelivery(state, report(BRAVO), true, 5)
  expect(out.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(out.state.marker).toBe(0)
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
  const stepped = afterFirstStep(state, false)
  const late = afterDelivery(stepped, notice(BRAVO, 'completed'), true, 3)
  expect(late.act).toEqual({ kind: 'hold' })
  expect(late.state.marker).toBe(stepped.marker + 1)
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

test('the deadline claims the batch with a line naming the members still running, and once the line is taken a later report passes', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(dueLines(state, BATCH_LIMIT_MS - 1)).toEqual([])
  const out = afterDeadline(state, BATCH_LIMIT_MS)
  expect(out.due).toEqual([{ step: 't1:0', line: deadlineLine(['Plan bbbbbbbb']) }])
  expect(dueLines(out.state, BATCH_LIMIT_MS + BATCH_RETRY_MS - 1)).toEqual([])
  const sent = afterDeadlineSent(out.state, ['t1:0'], BATCH_LIMIT_MS)
  expect(nextDeadline(sent)).toBeNull()
  expect(afterDelivery(sent, report(BRAVO), true, BATCH_LIMIT_MS + 1).act).toEqual({ kind: 'pass' })
})

test('a claimed batch whose line is not taken is claimed again a minute later, naming only the members still running then', () => {
  let state = afterLaunch(launched(), 't1:0', { id: 'ddddddddd', type: 'Explore' })
  state = afterDelivery(state, report(ALPHA), true, 0).state
  state = afterDeadline(state, BATCH_LIMIT_MS).state
  const passed = afterDelivery(state, report(BRAVO), true, BATCH_LIMIT_MS + 1)
  expect(passed.act).toEqual({ kind: 'end' })
  expect(afterDelivery(state, notice(BRAVO, 'completed'), true, BATCH_LIMIT_MS + 1).act).toEqual({ kind: 'pass' })
  expect(dueLines(passed.state, BATCH_LIMIT_MS + BATCH_RETRY_MS)).toEqual([deadlineLine(['Explore dddddddd'])])
  const last = afterDelivery(passed.state, report('ddddddddd'), true, BATCH_LIMIT_MS + 2)
  expect(last.act).toEqual({ kind: 'release', line: completeLine(3) })
  expect(nextDeadline(last.state)).toBeNull()
  expect(dueLines(last.state, BATCH_LIMIT_MS + BATCH_RETRY_MS)).toEqual([])
  expect(afterDeadlineSent(last.state, ['t1:0'], 0)).toEqual(last.state)
})

test('a fired mark in any other shape reads as empty', () => {
  const state = afterDeadline(afterDelivery(launched(), report(ALPHA), true, 0).state, BATCH_LIMIT_MS).state
  expect(batchStateIn(state, SESSION)).toEqual(state)
  const bad = { ...state, batches: state.batches.map(b => ({ ...b, fired: false })) }
  expect(batchStateIn(bad, SESSION)).toEqual(emptyBatchState(SESSION))
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
  expect(dueLines(out.state, BATCH_LIMIT_MS)).toEqual([])
  expect(afterDelivery(out.state, notice(BRAVO, 'completed'), true, 3).act).toEqual({ kind: 'hold' })
  expect(completeLine(1)).toContain('the batch of agents launched together is complete')
})

test('resuming the last member still running, after the others ended, releases the batch with no line', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  state = afterResume(state, BRAVO, 5)
  expect(heldReports(state)).toBe(0)
  expect(nextDeadline(state)).toBeNull()
  expect(dueLines(state, BATCH_LIMIT_MS)).toEqual([])
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
  expect(dueLines(state, BATCH_LIMIT_MS)).toEqual([deadlineLine(['Plan bbbbbbbb'])])
})

test('a step whose last message is not a user message is answered only when the marker is set', () => {
  const marked = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(answersStep(marked, { role: 'assistant' })).toBe(true)
  expect(answersStep(marked, { role: 'user' })).toBe(false)
  expect(answersStep(marked, undefined)).toBe(false)
  expect(answersStep(launched(), { role: 'assistant' })).toBe(false)
  expect(afterFirstStep(marked, true).marker).toBe(0)
})

// The engine's task notification for an agent, as the conversation holds it.
const noticeText = (id: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Agent "x" finished</summary>\n</task-notification>`

test('a user message that is only a held member\'s frame is answered, and any other user message goes to the model', () => {
  const marked = afterDelivery(launched(), report(ALPHA), true, 0).state
  const asUser = (text: string, toolResults: unknown[] = []) => ({ role: 'user', text, toolResults })
  expect(answersStep(marked, asUser(noticeText(ALPHA)))).toBe(true)
  expect(answersStep(marked, asUser(`${noticeText(ALPHA)}\n${noticeText(BRAVO)}`))).toBe(true)
  expect(answersStep(marked, asUser(`<agent-message from="${BRAVO}">\n[Subagent hand-back] done`))).toBe(true)
  expect(answersStep(marked, asUser(`Another Claude session sent a message:\n<agent-message from="${BRAVO}">\n[Subagent hand-back] done`))).toBe(true)
  // A frame naming an agent in no batch, a person's prompt after a pasted
  // notification, a message with tool results and a plain prompt all reach
  // the model, and so does a held frame with no marker.
  expect(answersStep(marked, asUser(noticeText('ddddddddddddddddd')))).toBe(false)
  expect(answersStep(marked, asUser(`<agent-message from="ddddddddddddddddd">\nhi`))).toBe(false)
  expect(answersStep(marked, asUser(`first line\nsecond line\n<agent-message from="${BRAVO}">\nhi`))).toBe(false)
  expect(answersStep(marked, asUser(`${noticeText(ALPHA)}\nwhat now?`))).toBe(false)
  expect(answersStep(marked, asUser(`${noticeText(ALPHA)}\n${noticeText('ddddddddddddddddd')}`))).toBe(false)
  expect(answersStep(marked, asUser(noticeText(ALPHA), [{ tool_use_id: 't', text: 'ok' }]))).toBe(false)
  expect(answersStep(marked, asUser('what now?'))).toBe(false)
  expect(answersStep(launched(), asUser(noticeText(ALPHA)))).toBe(false)
})

test('the marker counts down across held deliveries', () => {
  const marked = afterDelivery(launched(), report(ALPHA), true, 0).state
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

test('only a prompt that begins with a whole task-notification element is the engine waking a parked agent', () => {
  expect(isEngineWake(noticeText('shell-task-1'))).toBe(true)
  expect(isEngineWake(`${noticeText('shell-task-1')}\nThe command finished.`)).toBe(true)
  expect(isEngineWake(`please look at this: ${noticeText('shell-task-1')}`)).toBe(false)
  expect(isEngineWake(` ${noticeText('shell-task-1')}`)).toBe(false)
  expect(isEngineWake('<task-notification>\n<task-id>shell-task-1</task-id>\n<status>completed</status>')).toBe(false)
  expect(isEngineWake('')).toBe(false)
  expect(isEngineWake('Also check the tests.')).toBe(false)
})

test('an engine wake opens again a member that reported before it parked, so the other member\'s report is held and the woken member\'s final report releases the batch', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  state = afterDelivery(state, notice(ALPHA, 'completed'), true, 1).state
  state = afterWake(state, ALPHA)
  expect(runningLines(state)).toEqual([incompleteLine(['Explore aaaaaaaa', 'Plan bbbbbbbb'])])
  const other = afterDelivery(state, report(BRAVO), true, 2)
  expect(other.act).toEqual({ kind: 'hold' })
  const last = afterDelivery(other.state, report(ALPHA), true, 3)
  expect(last.act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('an engine wake keeps a member of a batch whose deadline claimed it, and marks it running', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  state = afterDeadline(state, BATCH_LIMIT_MS).state
  state = afterWake(state, ALPHA)
  expect(state.batches[0]?.members).toEqual([{ id: ALPHA, type: 'Explore', ended: false, woken: true }, { id: BRAVO, type: 'Plan', ended: false }])
  expect(state.batches[0]?.fired).toBe(true)
  expect(dueLines(state, BATCH_LIMIT_MS + BATCH_RETRY_MS)).toEqual([deadlineLine(['Explore aaaaaaaa', 'Plan bbbbbbbb'])])
})

test('an engine wake after the batch was released forgets the member there, so its final report passes, and drops a batch left empty', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  state = afterDelivery(state, report(BRAVO), true, 1).state
  const woken = afterWake(state, ALPHA)
  expect(afterDelivery(woken, report(ALPHA), true, 2).act).toEqual({ kind: 'pass' })
  expect(afterDelivery(woken, notice(BRAVO, 'completed'), true, 2).act).toEqual({ kind: 'hold' })
  expect(afterWake(woken, BRAVO).batches.some(b => b.step === 't1:0')).toBe(false)
})

test('an engine wake never releases a batch, even when every other member has ended', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  const woken = afterWake(state, BRAVO)
  expect(woken.batches[0]?.releasedAt).toBeNull()
  expect(nextDeadline(woken)).toBe(BATCH_LIMIT_MS)
  expect(heldReports(woken)).toBe(1)
  expect(afterDelivery(woken, report(BRAVO), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('a report from a woken member for which no turn end was seen ends it, so a report it sent before it parked that arrives after its wake releases the batch when it is the last member running', () => {
  let state = afterDelivery(launched(), notice(ALPHA, 'completed'), true, 0).state
  state = afterWake(state, ALPHA)
  state = afterDelivery(state, report(BRAVO), true, 1).state
  expect(runningLines(state)).toEqual([incompleteLine(['Explore aaaaaaaa'])])
  const late = afterDelivery(state, report(ALPHA), true, 2)
  expect(late.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(late.state.batches[0]?.members.map(m => m.ended)).toEqual([true, true])
})

test('a report from a woken member of a batch its deadline claimed ends it, and as the last one releases the batch', () => {
  let state = afterDelivery(launched(), report(BRAVO), true, 0).state
  state = afterDeadline(state, BATCH_LIMIT_MS).state
  state = afterWake(state, ALPHA)
  const last = afterDelivery(state, report(ALPHA), true, 1)
  expect(last.act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('a notification that a woken member finished, failed or was killed ends it, in an open batch and in one its deadline claimed', () => {
  const open = afterWake(afterDelivery(launched(), notice(ALPHA, 'completed'), true, 0).state, ALPHA)
  const fired = afterDeadline(open, BATCH_LIMIT_MS).state
  for (const d of [finished(ALPHA), notice(ALPHA, 'failed'), notice(ALPHA, 'killed')]) {
    expect(afterDelivery(open, d, true, 1).state.batches[0]?.members.map(m => m.ended)).toEqual([true, false])
    const out = afterDelivery(fired, d, true, BATCH_LIMIT_MS + 1)
    expect(out.act).toEqual({ kind: 'end' })
    expect(out.state.batches[0]?.members.map(m => m.ended)).toEqual([true, false])
  }
})

// The times at which the deadline claims a batch whose line is refused every
// time, from its first claim on.
function claimTimes(state: BatchState, claims: number): number[] {
  const times: number[] = []
  for (let i = 0; i < claims; i++) {
    const at = nextDeadline(state) as number
    times.push(at)
    state = afterDeadline(state, at).state
  }
  return times
}

const gapsOf = (times: number[]) => times.slice(1).map((t, i) => (t - (times[i] as number)) / 60_000)

test('a refused deadline line is claimed again after a wait that doubles from one minute up to one hour', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(gapsOf(claimTimes(state, 9))).toEqual([1, 2, 4, 8, 16, 32, 60, 60])
  expect(nextBatchRetry(BATCH_RETRY_MS)).toBe(2 * BATCH_RETRY_MS)
  expect(nextBatchRetry(BATCH_RETRY_CEILING_MS)).toBe(BATCH_RETRY_CEILING_MS)
  expect(BATCH_RETRY_CEILING_MS).toBe(60 * 60_000)
})

// A stored batch that the deadline already claimed, with its retry wait
// set to `retryMs`, or with none when it is undefined, as the previous
// build stored it.
const firedWith = (retryMs: unknown): BatchState => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  return {
    ...state,
    batches: state.batches.map(b => (b.step === 't1:0' ? { ...b, fired: true as const, ...(retryMs === undefined ? {} : { retryMs: retryMs as number }) } : b)),
  }
}

test('a stored claimed batch without a wait is claimed again one minute and then two minutes on', () => {
  const stored = batchStateIn(firedWith(undefined), SESSION)
  expect(stored.batches[0]?.fired).toBe(true)
  expect(gapsOf(claimTimes(stored, 3))).toEqual([1, 2])
})

test('a stored wait that is not a number above zero reads as the empty state', () => {
  expect(batchStateIn(firedWith(120_000), SESSION)).toEqual(firedWith(120_000))
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '120000', null]) {
    expect(batchStateIn(firedWith(bad), SESSION)).toEqual(emptyBatchState(SESSION))
  }
})

test('a stored wait above an hour or below a minute is held to that range', () => {
  expect(gapsOf(claimTimes(firedWith(5 * 60 * 60_000), 3))).toEqual([60, 60])
  expect(gapsOf(claimTimes(firedWith(1000), 3))).toEqual([1, 2])
})

test('a deadline line the engine takes after refusals ends the batch, and the member\'s later report passes', () => {
  let state = afterDelivery(launched(), report(ALPHA), true, 0).state
  const times = claimTimes(state, 3)
  expect(gapsOf(times)).toEqual([1, 2])
  for (const at of times) state = afterDeadline(state, at).state
  const sent = afterDeadlineSent(state, ['t1:0'], times[2] as number)
  expect(nextDeadline(sent)).toBeNull()
  expect(sent.batches.some(b => b.step === 't1:0')).toBe(false)
  expect(afterDelivery(sent, report(BRAVO), true, (times[2] as number) + 1).act).toEqual({ kind: 'pass' })
})

test('a notification is read as finished only when its summary says the agent finished', () => {
  expect(deliveryOf(NOTICE, parkText(ALPHA))).toEqual({ id: ALPHA, isReport: false, status: 'completed', finished: false })
  expect(deliveryOf(NOTICE, finishedText(ALPHA))).toEqual({ id: ALPHA, isReport: false, status: 'completed', finished: true })
})

test('the word finished in the result or the note, outside the summary, is not read as finished', () => {
  expect(deliveryOf(NOTICE, parkText(ALPHA, 'The build finished.'))?.finished).toBe(false)
  expect(deliveryOf(NOTICE, parkText(ALPHA, 'Agent "x" finished'))?.finished).toBe(false)
  expect(deliveryOf(NOTICE, parkText(ALPHA, '<summary>Agent "x" finished</summary>'))?.finished).toBe(false)
  const inNote = parkText(ALPHA).replace('the result below may be interim.', 'Agent "x" finished')
  expect(inNote).toContain('Agent "x" finished</note>')
  expect(deliveryOf(NOTICE, inNote)?.finished).toBe(false)
})

test('a summary with other text around the finished wording is not read as finished', () => {
  expect(deliveryOf(NOTICE, finishedText(ALPHA, 'Agent "x" finished early'))?.finished).toBe(false)
  expect(deliveryOf(NOTICE, finishedText(ALPHA, 'Note: Agent "x" finished'))?.finished).toBe(false)
  expect(deliveryOf(NOTICE, finishedText(ALPHA, ' Agent "x" finished'))?.finished).toBe(false)
  expect(deliveryOf(NOTICE, finishedText(ALPHA, 'Agent x finished'))?.finished).toBe(false)
})

test('a finished notification ends a woken member, and as the last one releases the batch with the completion line', () => {
  const finishedDelivery = deliveryOf(NOTICE, finishedText(BRAVO)) as Delivery
  const state = afterWake(afterDelivery(launched(), report(ALPHA), true, 0).state, BRAVO)
  expect(afterDelivery(state, finishedDelivery, true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
  const first = afterDelivery(afterWake(launched(), BRAVO), finishedDelivery, true, 0)
  expect(first.act).toEqual({ kind: 'hold' })
  expect(runningLines(first.state)).toEqual([incompleteLine(['Explore aaaaaaaa'])])
  expect(afterDelivery(first.state, report(ALPHA), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('a notification that the agent parked to wait on its own work ends nothing', () => {
  const parked = deliveryOf(NOTICE, parkText(BRAVO)) as Delivery
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  const out = afterDelivery(state, parked, true, 1)
  expect(out.act).toEqual({ kind: 'hold' })
  expect(runningLines(out.state)).toEqual([incompleteLine(['Plan bbbbbbbb'])])
})

test('the delivery that releases a batch clears the marker that the held idle deliveries raised', () => {
  let state = afterLaunch(launched(), 't1:0', { id: CHARLIE, type: 'Explore' })
  state = afterDelivery(state, report(ALPHA), true, 0).state
  state = afterDelivery(state, notice(ALPHA, 'completed'), true, 1).state
  state = afterDelivery(state, report(BRAVO), true, 2).state
  expect(state.marker).toBe(3)
  const out = afterDelivery(state, report(CHARLIE), true, 3)
  expect(out.act).toEqual({ kind: 'release', line: completeLine(3) })
  expect(out.state.marker).toBe(0)
})

// The state after BRAVO's report released the batch of ALPHA and BRAVO,
// delivered while the session was idle unless `isIdle` says otherwise.
const releasedBy = (isIdle: boolean) => afterDelivery(afterDelivery(launched(), report(ALPHA), true, 0).state, report(BRAVO), isIdle, 1)

test('a release while the session is idle marks the state as releasing, and one into a running turn does not', () => {
  const idle = releasedBy(true)
  expect(idle.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(idle.state.releasing).toBe(true)
  expect(idle.state.marker).toBe(0)
  const running = releasedBy(false)
  expect(running.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(running.state.releasing).toBeUndefined()
  expect(running.state.marker).toBe(0)
})

test('a held delivery from a released batch before the release turn\'s first step leaves the marker at zero, and one after that step raises it', () => {
  const { state } = releasedBy(true)
  const early = afterDelivery(state, notice(BRAVO, 'completed'), true, 2)
  expect(early.act).toEqual({ kind: 'hold' })
  expect(early.state.marker).toBe(0)
  expect(early.state.releasing).toBe(true)
  const afterFinished = afterDelivery(state, deliveryOf(NOTICE, finishedText(BRAVO)) as Delivery, true, 2)
  expect(afterFinished.act).toEqual({ kind: 'hold' })
  expect(afterFinished.state.marker).toBe(0)
  const late = afterDelivery(afterFirstStep(early.state, false), notice(BRAVO, 'completed'), true, 3)
  expect(late.act).toEqual({ kind: 'hold' })
  expect(late.state.marker).toBe(1)
})

test('the first step of a turn clears the releasing mark whether or not it was answered', () => {
  const { state } = releasedBy(true)
  expect(afterFirstStep(state, false)).not.toHaveProperty('releasing')
  expect(afterFirstStep({ ...state, marker: 2 }, true)).not.toHaveProperty('releasing')
  expect(afterFirstStep({ ...state, marker: 2 }, true).marker).toBe(1)
})

test('a stored releasing mark reads back when it is true, and any other value reads as the empty state', () => {
  const { state } = releasedBy(true)
  expect(batchStateIn(state, SESSION)).toEqual(state)
  for (const bad of [false, 1, 'yes', null]) {
    expect(batchStateIn({ ...state, releasing: bad }, SESSION)).toEqual(emptyBatchState(SESSION))
  }
})

// The ids of two background tasks, and a turn end's list of in-flight work
// in the engine's shape, which covers the whole session and names no owner.
const MONITOR = 'task-monitor-1'
const SLEEP = 'task-sleep-1'
const listing = (...ids: string[]) => ids.map(id => ({ id, type: 'shell', status: 'running', description: id }))
const members = (state: BatchState) => state.batches.find(b => b.step === 't1:0')?.members ?? []
// The launched state after the engine woke ALPHA, or both members of the
// batch, once each, so that a later clean turn end of theirs ends them.
const alphaWoken = () => afterWake(launched(), ALPHA)
const bothWoken = () => afterWake(alphaWoken(), BRAVO)

test('a background task id is read from a Bash result\'s backgroundTaskId or a Monitor result\'s taskId, and from nothing else', () => {
  expect(taskIdOf({ backgroundTaskId: SLEEP, stdout: '' })).toBe(SLEEP)
  expect(taskIdOf({ taskId: MONITOR })).toBe(MONITOR)
  expect(taskIdOf({ stdout: 'x' })).toBeUndefined()
  expect(taskIdOf({ taskId: 7 })).toBeUndefined()
  expect(taskIdOf({ backgroundTaskId: '' })).toBeUndefined()
  expect(taskIdOf('text')).toBeUndefined()
  expect(taskIdOf(null)).toBeUndefined()
  expect(listedIdsOf(listing(MONITOR, SLEEP))).toEqual([MONITOR, SLEEP])
  expect(listedIdsOf([{ status: 'running' }, null, 'x', { id: SLEEP }])).toEqual([SLEEP])
  expect(listedIdsOf([{ id: MONITOR, type: 'subagent', status: 'running' }, { id: '', type: 'shell' }])).toEqual([MONITOR])
  expect(listedIdsOf('not a list')).toEqual([])
})

test('a task is recorded only for a member of a batch not yet released, once each', () => {
  let state = afterTask(launched(), ALPHA, MONITOR)
  state = afterTask(state, ALPHA, MONITOR)
  expect(members(state).find(m => m.id === ALPHA)?.tasks).toEqual([MONITOR])
  expect(afterTask(state, 'unknown-agent', SLEEP)).toBe(state)
  const released = afterDelivery(afterDelivery(state, report(ALPHA), true, 0).state, report(BRAVO), true, 1).state
  expect(afterTask(released, ALPHA, SLEEP)).toBe(released)
})

test('a member that reports while its own Monitor is still listed is not ended, the batch stays open, and its later report after a clean turn end releases the batch once', () => {
  let state = afterTask(launched(), ALPHA, MONITOR)
  state = afterMemberStop(state, ALPHA, [MONITOR], 0)
  const early = afterDelivery(state, report(ALPHA), true, 1)
  expect(early.act).toEqual({ kind: 'hold' })
  expect(members(early.state).map(m => m.ended)).toEqual([false, false])
  state = afterDelivery(early.state, report(BRAVO), true, 2).state
  expect(state.batches[0]?.releasedAt).toBeNull()
  expect(runningLines(state)).toEqual([incompleteLine(['Explore aaaaaaaa'])])
  state = afterWake(state, ALPHA)
  state = afterMemberStop(state, ALPHA, [], 3)
  const last = afterDelivery(state, report(ALPHA), true, 4)
  expect(last.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(afterDelivery(last.state, report(ALPHA), true, 5).act).toEqual({ kind: 'hold' })
})

test('a finished notification does not end a member whose last turn end listed its own work, and a failed one does', () => {
  const state = afterMemberStop(afterTask(launched(), ALPHA, MONITOR), ALPHA, [MONITOR], 0)
  expect(members(afterDelivery(state, finished(ALPHA), true, 1).state).map(m => m.ended)).toEqual([false, false])
  expect(members(afterDelivery(state, notice(ALPHA, 'failed'), true, 1).state).map(m => m.ended)).toEqual([true, false])
})

test('a woken member whose turn ends with plain text and nothing of its own listed ends there, and the next delivery releases the batch with the completion line', () => {
  let state = afterTask(launched(), ALPHA, SLEEP)
  state = afterMemberStop(state, ALPHA, [SLEEP], 0)
  state = afterDelivery(state, report(ALPHA), true, 1).state
  state = afterDelivery(state, report(BRAVO), true, 2).state
  state = afterWake(state, ALPHA)
  state = afterMemberStop(state, ALPHA, [], 10)
  expect(members(state).map(m => m.ended)).toEqual([true, true])
  expect(state.batches[0]?.releasedAt).toBeNull()
  expect(nextDeadline(state)).toBe(10 + BATCH_SETTLE_MS)
  expect(runningLines(state)).toEqual([])
  const out = afterDelivery(state, finished(ALPHA), true, 11)
  expect(out.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(nextDeadline(out.state)).toBeNull()
})

test('a turn end with work listed, or for an agent in no batch, ends nothing and sets no deadline, and an earlier deadline is kept', () => {
  const state = afterTask(launched(), ALPHA, SLEEP)
  const live = afterMemberStop(state, ALPHA, [SLEEP], 0)
  expect(members(live).map(m => m.ended)).toEqual([false, false])
  expect(nextDeadline(live)).toBeNull()
  expect(afterMemberStop(state, CHARLIE, [], 0)).toBe(state)
  expect(afterMemberStop(state, 'unknown-agent', [], 0)).toBe(state)
  const held = afterWake(afterDelivery(afterMemberStop(state, BRAVO, [], 0), report(BRAVO), true, 0).state, ALPHA)
  expect(nextDeadline(afterMemberStop(held, ALPHA, [], 5))).toBe(5 + BATCH_SETTLE_MS)
  expect(nextDeadline(afterMemberStop(held, ALPHA, [], BATCH_LIMIT_MS - 1000))).toBe(BATCH_LIMIT_MS)
})

test('a member with no turn end seen ends at its report, as before', () => {
  const state = afterTask(launched(), ALPHA, MONITOR)
  const out = afterDelivery(state, report(ALPHA), true, 0)
  expect(members(out.state).map(m => m.ended)).toEqual([true, false])
  expect(afterDelivery(out.state, report(BRAVO), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('a listed task that the member did not start does not hold it', () => {
  let state = afterTask(alphaWoken(), ALPHA, MONITOR)
  state = afterTask(state, BRAVO, SLEEP)
  state = afterMemberStop(state, ALPHA, [SLEEP, 'task-of-the-session'], 0)
  expect(members(state).map(m => m.ended)).toEqual([true, false])
  expect(afterDelivery(state, report(BRAVO), true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('the task ids and turn-end readings are dropped when the batch is released, by a delivery, a resume or a taken completion line', () => {
  let state = afterMemberStop(afterTask(bothWoken(), ALPHA, MONITOR), ALPHA, [MONITOR], 0)
  state = afterMemberStop(afterTask(state, BRAVO, SLEEP), BRAVO, [], 0)
  const strip = (s: BatchState) => members(s).map(m => Object.keys(m).sort())
  const byDelivery = afterDelivery(afterMemberStop(state, ALPHA, [], 1), report(ALPHA), true, 2).state
  expect(byDelivery.batches[0]?.releasedAt).toBe(2)
  expect(strip(byDelivery)).toEqual([['ended', 'id', 'type'], ['ended', 'id', 'type']])
  const third = afterMemberStop(afterTask(afterWake(afterLaunch(state, 't1:0', { id: CHARLIE, type: 'Plan' }), CHARLIE), CHARLIE, 'task-3'), CHARLIE, [], 0)
  const byResume = afterResume(afterDelivery(third, report(BRAVO), true, 1).state, ALPHA, 2)
  expect(byResume.batches.find(b => b.step === 't1:0')?.releasedAt).toBe(2)
  expect(strip(byResume)).toEqual([['ended', 'id', 'type'], ['ended', 'id', 'type']])
  const settled = afterMemberStop(state, ALPHA, [], 1)
  const claimed = afterDeadline(settled, 1 + BATCH_SETTLE_MS).state
  const byLine = afterDeadlineSent(claimed, ['t1:0'], 2 + BATCH_SETTLE_MS)
  expect(byLine.batches[0]?.releasedAt).toBe(2 + BATCH_SETTLE_MS)
  expect(strip(byLine)).toEqual([['ended', 'id', 'type'], ['ended', 'id', 'type']])
})

test('the deadline claims a batch whose last member ended at a turn end with the completion line one minute later, releases it once the line is taken, and later deliveries are held', () => {
  let state = afterMemberStop(afterTask(launched(), ALPHA, SLEEP), ALPHA, [SLEEP], 0)
  state = afterDelivery(state, report(ALPHA), true, 1).state
  state = afterDelivery(state, report(BRAVO), true, 2).state
  state = afterMemberStop(afterWake(state, ALPHA), ALPHA, [], 10)
  expect(dueLines(state, 10 + BATCH_SETTLE_MS - 1)).toEqual([])
  const claimed = afterDeadline(state, 10 + BATCH_SETTLE_MS)
  expect(claimed.due).toEqual([{ step: 't1:0', line: completeLine(2) }])
  const sent = afterDeadlineSent(claimed.state, ['t1:0'], 11 + BATCH_SETTLE_MS)
  expect(sent.batches[0]?.releasedAt).toBe(11 + BATCH_SETTLE_MS)
  expect(nextDeadline(sent)).toBeNull()
  expect(afterDelivery(sent, finished(ALPHA), true, 12 + BATCH_SETTLE_MS).act).toEqual({ kind: 'hold' })
})

test('a delivery that arrives while the completion line is claimed and not yet taken is held and carries no second line', () => {
  let state = afterMemberStop(bothWoken(), BRAVO, [], 0)
  state = afterDelivery(state, report(BRAVO), true, 1).state
  state = afterMemberStop(state, ALPHA, [], 10)
  const claimed = afterDeadline(state, 10 + BATCH_SETTLE_MS).state
  const out = afterDelivery(claimed, report(ALPHA), true, 11 + BATCH_SETTLE_MS)
  expect(out.act).toEqual({ kind: 'hold' })
  expect(dueLines(out.state, 11 + BATCH_SETTLE_MS + BATCH_RETRY_MS)).toEqual([completeLine(2)])
})

test('stored members with task ids and a turn-end reading read back, and the same fields in another shape read as the empty state', () => {
  const state = afterMemberStop(afterTask(launched(), ALPHA, MONITOR), ALPHA, [MONITOR], 0)
  expect(batchStateIn(state, SESSION)).toEqual(state)
  expect(batchStateIn(launched(), SESSION)).toEqual(launched())
  const withMember = (m: Record<string, unknown>) => ({ ...state, batches: [{ ...state.batches[0], members: [m] }] })
  expect(batchStateIn(withMember({ id: ALPHA, type: 'Explore', ended: false, tasks: [7] }), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(withMember({ id: ALPHA, type: 'Explore', ended: false, tasks: 'x' }), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(withMember({ id: ALPHA, type: 'Explore', ended: false, live: 'yes' }), SESSION)).toEqual(emptyBatchState(SESSION))
})

test('an engine wake after a turn end that ended the last member, listing work builder did not record, gives the batch back its time limit, and no line goes out at the minute', () => {
  let state = afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state
  state = afterMemberStop(state, ALPHA, ['task-not-recorded'], 2000)
  expect(nextDeadline(state)).toBe(2000 + BATCH_SETTLE_MS)
  state = afterWake(state, ALPHA)
  expect(members(state).map(m => m.ended)).toEqual([false, true])
  expect(nextDeadline(state)).toBe(1000 + BATCH_LIMIT_MS)
  expect(dueLines(state, 2000 + BATCH_SETTLE_MS)).toEqual([])
  expect(afterDelivery(state, report(ALPHA), true, 3000 + BATCH_SETTLE_MS).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('an engine wake after the settle minute claimed the completion line clears that claim, and a wake in a batch that held nothing leaves it with no deadline', () => {
  let state = afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state
  state = afterMemberStop(state, ALPHA, [], 2000)
  state = afterDeadline(state, 2000 + BATCH_SETTLE_MS).state
  state = afterWake(state, ALPHA)
  expect(state.batches[0]?.fired).toBeUndefined()
  expect(state.batches[0]?.retryMs).toBeUndefined()
  expect(nextDeadline(state)).toBe(1000 + BATCH_LIMIT_MS)
  expect(dueLines(state, 2000 + BATCH_SETTLE_MS + BATCH_RETRY_MS)).toEqual([])
  expect(afterDelivery(state, report(ALPHA), true, 3000 + BATCH_SETTLE_MS).act).toEqual({ kind: 'release', line: completeLine(2) })
  let quiet = afterMemberStop(bothWoken(), BRAVO, [], 0)
  quiet = afterMemberStop(quiet, ALPHA, [], 10)
  expect(nextDeadline(quiet)).toBe(10 + BATCH_SETTLE_MS)
  expect(nextDeadline(afterWake(quiet, ALPHA))).toBeNull()
})

test('a repeat turn end of a batch whose members had all ended, after the deadline claimed it, leaves its deadline as it was', () => {
  let state = afterMemberStop(bothWoken(), BRAVO, [], 0)
  state = afterDelivery(state, report(BRAVO), true, 1).state
  state = afterMemberStop(state, ALPHA, [], 10)
  state = afterDeadline(state, 10 + BATCH_SETTLE_MS).state
  state = afterDeadline(state, 10 + BATCH_SETTLE_MS + BATCH_RETRY_MS).state
  const claimed = nextDeadline(state)
  expect(claimed).toBe(10 + BATCH_SETTLE_MS + BATCH_RETRY_MS + 2 * BATCH_RETRY_MS)
  expect(nextDeadline(afterMemberStop(state, ALPHA, [], 11 + BATCH_SETTLE_MS + BATCH_RETRY_MS))).toBe(claimed)
})

test('a stored deadline from before the settle reads back as a time or null, and in any other shape reads as the empty state', () => {
  const state = afterMemberStop(afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state, ALPHA, [], 2000)
  expect(state.batches[0]?.deadlineBeforeSettle).toBe(1000 + BATCH_LIMIT_MS)
  expect(batchStateIn(state, SESSION)).toEqual(state)
  const withField = (v: unknown) => ({ ...state, batches: [{ ...state.batches[0], deadlineBeforeSettle: v }, ...state.batches.slice(1)] })
  expect(batchStateIn(withField(null), SESSION)).toEqual(withField(null))
  expect(batchStateIn(withField('soon'), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(withField(Infinity), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(afterDelivery(state, report(ALPHA), true, 2001).state.batches[0]?.deadlineBeforeSettle).toBeUndefined()
})

test('an engine wake between the claim of the completion line and the engine taking it still settles the batch as released with one line, and forgets the woken member so that its later report passes', () => {
  let state = afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state
  state = afterMemberStop(state, ALPHA, [], 2000)
  const claimed = afterDeadline(state, 2000 + BATCH_SETTLE_MS)
  expect(claimed.due).toEqual([{ step: 't1:0', line: completeLine(2) }])
  state = afterWake(claimed.state, ALPHA)
  state = afterDeadlineSent(state, ['t1:0'], 2001 + BATCH_SETTLE_MS)
  expect(state.batches[0]?.releasedAt).toBe(2001 + BATCH_SETTLE_MS)
  expect(members(state).map(m => m.id)).toEqual([BRAVO])
  expect(nextDeadline(state)).toBeNull()
  expect(dueLines(state, 2000 + BATCH_LIMIT_MS + BATCH_RETRY_CEILING_MS)).toEqual([])
  expect(afterMemberStop(state, ALPHA, [], 2002 + BATCH_SETTLE_MS)).toBe(state)
  expect(afterDelivery(state, report(ALPHA), true, 2003 + BATCH_SETTLE_MS).act).toEqual({ kind: 'pass' })
  expect(afterDelivery(state, finished(BRAVO), true, 2003 + BATCH_SETTLE_MS).act).toEqual({ kind: 'hold' })
  const both = afterWake(afterWake(claimed.state, ALPHA), BRAVO)
  expect(afterDeadlineSent(both, ['t1:0'], 2001 + BATCH_SETTLE_MS).batches.some(b => b.step === 't1:0')).toBe(false)
})

test('an engine wake after a claim of the completion line that the engine refused sends no line at the retry, gives back the time limit, and a deadline line taken later drops the batch', () => {
  let state = afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state
  state = afterMemberStop(state, ALPHA, [], 2000)
  state = afterWake(afterDeadline(state, 2000 + BATCH_SETTLE_MS).state, ALPHA)
  expect(nextDeadline(state)).toBe(1000 + BATCH_LIMIT_MS)
  expect(dueLines(state, 2000 + BATCH_SETTLE_MS + BATCH_RETRY_MS)).toEqual([])
  const claimed = afterDeadline(state, 1000 + BATCH_LIMIT_MS)
  expect(claimed.due).toEqual([{ step: 't1:0', line: deadlineLine(['Explore aaaaaaaa']) }])
  const sent = afterDeadlineSent(claimed.state, ['t1:0'], 1001 + BATCH_LIMIT_MS)
  expect(sent.batches.some(b => b.step === 't1:0')).toBe(false)
  expect(afterDelivery(sent, report(ALPHA), true, 1002 + BATCH_LIMIT_MS).act).toEqual({ kind: 'pass' })
})

test('the mark of a wake after a claim reads back, in any other shape reads as the empty state, and is dropped at the release', () => {
  let state = afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state
  state = afterMemberStop(state, ALPHA, [], 2000)
  state = afterWake(afterDeadline(state, 2000 + BATCH_SETTLE_MS).state, ALPHA)
  expect(state.batches[0]?.wokenAfterClaim).toBe(true)
  expect(batchStateIn(state, SESSION)).toEqual(state)
  const withField = (v: unknown) => ({ ...state, batches: [{ ...state.batches[0], wokenAfterClaim: v }, ...state.batches.slice(1)] })
  expect(batchStateIn(withField(false), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(withField('yes'), SESSION)).toEqual(emptyBatchState(SESSION))
  const out = afterDelivery(state, report(ALPHA), true, 3000 + BATCH_SETTLE_MS)
  expect(out.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(out.state.batches[0]?.wokenAfterClaim).toBeUndefined()
})

test('a member the engine never woke does not end at a clean turn end, and a woken member does', () => {
  const quiet = afterMemberStop(launched(), ALPHA, [], 0)
  expect(members(quiet)).toEqual([{ id: ALPHA, type: 'Explore', ended: false, live: false }, { id: BRAVO, type: 'Plan', ended: false }])
  expect(nextDeadline(quiet)).toBeNull()
  const woken = afterMemberStop(afterWake(launched(), ALPHA), ALPHA, [], 0)
  expect(members(woken).map(m => m.ended)).toEqual([true, false])
})

test('in a batch whose agents never park, a notification after every turn end releases nothing, and the last report carries the completion line', () => {
  let state = afterMemberStop(launched(), ALPHA, [], 0)
  state = afterDelivery(state, report(ALPHA), true, 1).state
  state = afterMemberStop(state, BRAVO, [], 2)
  expect(members(state).map(m => m.ended)).toEqual([true, false])
  const notified = afterDelivery(state, finished(ALPHA), true, 3)
  expect(notified.act).toEqual({ kind: 'hold' })
  expect(afterDelivery(state, finished(BRAVO), true, 3).act).toEqual({ kind: 'hold' })
  expect(afterDelivery(notified.state, report(BRAVO), true, 4).act).toEqual({ kind: 'release', line: completeLine(2) })
})

test('after a deadline line names a woken member, its clean turn end and report release the batch with the completion line, and the engine taking the line later changes nothing', () => {
  let state = afterDelivery(launched(), report(BRAVO), true, 1000).state
  state = afterWake(state, ALPHA)
  const claimed = afterDeadline(state, 1000 + BATCH_LIMIT_MS)
  expect(claimed.due).toEqual([{ step: 't1:0', line: deadlineLine(['Explore aaaaaaaa']) }])
  const stopped = afterMemberStop(claimed.state, ALPHA, [], 1001 + BATCH_LIMIT_MS)
  expect(members(stopped).map(m => m.ended)).toEqual([true, true])
  const last = afterDelivery(stopped, report(ALPHA), true, 1002 + BATCH_LIMIT_MS)
  expect(last.act).toEqual({ kind: 'release', line: completeLine(2) })
  expect(afterDeadlineSent(last.state, ['t1:0'], 1003 + BATCH_LIMIT_MS)).toEqual(last.state)
  const takenFirst = afterDeadlineSent(stopped, ['t1:0'], 1002 + BATCH_LIMIT_MS)
  expect(takenFirst.batches.some(b => b.step === 't1:0')).toBe(false)
  expect(afterDelivery(takenFirst, report(ALPHA), true, 1003 + BATCH_LIMIT_MS).act).toEqual({ kind: 'pass' })
})

test('the marks of a woken member and of a claimed completion line read back, in any other shape read as the empty state, and are dropped at the release', () => {
  let state = afterWake(afterDelivery(launched(), report(BRAVO), true, 1000).state, ALPHA)
  expect(members(state)[0]?.woken).toBe(true)
  expect(batchStateIn(state, SESSION)).toEqual(state)
  const withMember = (v: unknown) => ({ ...state, batches: [{ ...state.batches[0], members: [{ id: ALPHA, type: 'Explore', ended: false, woken: v }] }] })
  expect(batchStateIn(withMember(false), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(withMember('yes'), SESSION)).toEqual(emptyBatchState(SESSION))
  state = afterMemberStop(state, ALPHA, [], 2000)
  const claimed = afterDeadline(state, 2000 + BATCH_SETTLE_MS).state
  expect(claimed.batches[0]?.completionClaimed).toBe(true)
  expect(batchStateIn(claimed, SESSION)).toEqual(claimed)
  const withField = (v: unknown) => ({ ...claimed, batches: [{ ...claimed.batches[0], completionClaimed: v }, ...claimed.batches.slice(1)] })
  expect(batchStateIn(withField(false), SESSION)).toEqual(emptyBatchState(SESSION))
  expect(batchStateIn(withField('yes'), SESSION)).toEqual(emptyBatchState(SESSION))
  const sent = afterDeadlineSent(claimed, ['t1:0'], 2001 + BATCH_SETTLE_MS)
  expect(sent.batches[0]?.releasedAt).toBe(2001 + BATCH_SETTLE_MS)
  expect(sent.batches[0]?.completionClaimed).toBeUndefined()
  expect(members(sent).map(m => m.woken)).toEqual([undefined, undefined])
  expect(afterDeadline(afterDelivery(launched(), report(BRAVO), true, 0).state, BATCH_LIMIT_MS).state.batches[0]?.completionClaimed).toBeUndefined()
})

test('a wake that clears a claim of the completion line drops its mark, and a later claim of the deadline line drops a mark left from an earlier claim', () => {
  let settled = afterDelivery(alphaWoken(), report(BRAVO), true, 1000).state
  settled = afterMemberStop(settled, ALPHA, [], 2000)
  const reopened = afterWake(afterDeadline(settled, 2000 + BATCH_SETTLE_MS).state, ALPHA)
  expect(reopened.batches[0]?.wokenAfterClaim).toBe(true)
  expect(reopened.batches[0]?.completionClaimed).toBeUndefined()
  let state = afterDeadline(afterDelivery(alphaWoken(), report(BRAVO), true, 0).state, BATCH_LIMIT_MS).state
  state = afterMemberStop(state, ALPHA, [], BATCH_LIMIT_MS + 1)
  const completion = afterDeadline(state, BATCH_LIMIT_MS + BATCH_RETRY_MS)
  expect(completion.due).toEqual([{ step: 't1:0', line: completeLine(2) }])
  state = afterWake(completion.state, ALPHA)
  expect(state.batches[0]?.completionClaimed).toBe(true)
  const again = afterDeadline(state, nextDeadline(state) as number)
  expect(again.due).toEqual([{ step: 't1:0', line: deadlineLine(['Explore aaaaaaaa']) }])
  expect(again.state.batches[0]?.completionClaimed).toBeUndefined()
  expect(afterDelivery(again.state, notice(BRAVO, 'completed'), true, (nextDeadline(state) as number) + 1).act).toEqual({ kind: 'pass' })
})
