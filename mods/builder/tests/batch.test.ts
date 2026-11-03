import { expect, test } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

import { afterDeadline, afterDeadlineSent, afterDelivery, afterLaunch, afterResume, afterWake, afterFirstStep, answersStep, BATCH_LIMIT_MS, BATCH_RETRY_CEILING_MS, BATCH_RETRY_MS, BATCHES_KEPT, batchStateIn, completeLine, deadlineLine, deliveryOf, emptyBatchState, heldReports, incompleteLine, isBatchLaunch, isEngineWake, nextBatchRetry, nextDeadline, REMEMBER_MS, runningLines, type Delivery } from '../hooks/batch'
import type { BatchState } from '../types'

const PEER: PromptOrigin = { kind: 'peer' } as PromptOrigin
const NOTICE: PromptOrigin = { kind: 'task-notification' } as PromptOrigin
const COMPOSER: PromptOrigin = { kind: 'composer' } as PromptOrigin

const ALPHA = 'aaaaaaaaaaaaaaaaa'
const BRAVO = 'bbbbbbbbbbbbbbbbb'
const CHARLIE = 'ccccccccccccccccc'

const SESSION = 'session-1'

const report = (id: string): Delivery => ({ id, isReport: true, status: null, finished: false })
const notice = (id: string, status: string): Delivery => ({ id, isReport: false, status, finished: false })
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

test('the deadline claims the batch with a line naming the members still running, and once the line is taken a later report passes', () => {
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(dueLines(state, BATCH_LIMIT_MS - 1)).toEqual([])
  const out = afterDeadline(state, BATCH_LIMIT_MS)
  expect(out.due).toEqual([{ step: 't1:0', line: deadlineLine(['Plan bbbbbbbb']) }])
  expect(dueLines(out.state, BATCH_LIMIT_MS + BATCH_RETRY_MS - 1)).toEqual([])
  const sent = afterDeadlineSent(out.state, ['t1:0'])
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
  expect(afterDeadlineSent(last.state, ['t1:0'])).toEqual(last.state)
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
  expect(state.batches[0]?.members).toEqual([{ id: ALPHA, type: 'Explore', ended: false }, { id: BRAVO, type: 'Plan', ended: false }])
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
  const sent = afterDeadlineSent(state, ['t1:0'])
  expect(nextDeadline(sent)).toBeNull()
  expect(sent.batches.some(b => b.step === 't1:0')).toBe(false)
  expect(afterDelivery(sent, report(BRAVO), true, (times[2] as number) + 1).act).toEqual({ kind: 'pass' })
})

// The two kinds of completed notification the engine sends about an agent,
// in its own shape: one when the agent parks to wait on its own background
// work, and one when it finished. `result` stands for the agent's own text.
const parkText = (id: string, result = 'This agent has not reported yet: it is waiting on its own background work.') => `<task-notification>
<task-id>${id}</task-id>
<tool-use-id>toolu_example</tool-use-id>
<output-file>/tmp/example/tasks/${id}.output</output-file>
<status>completed</status>
<summary>Agent "Example agent" is waiting on its own background work</summary>
<note>This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports; the result below may be interim.</note>
<result>${result}
</result>
<usage><subagent_tokens>1</subagent_tokens><tool_uses>1</tool_uses><duration_ms>1</duration_ms></usage>
</task-notification>`
const finishedText = (id: string, summary = 'Agent "Example agent" finished') => `<task-notification>
<task-id>${id}</task-id>
<output-file>/tmp/example/tasks/${id}.output</output-file>
<status>completed</status>
<summary>${summary}</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own.</note>
<result>done</result>
<usage><subagent_tokens>1</subagent_tokens><tool_uses>1</tool_uses><duration_ms>1</duration_ms></usage>
</task-notification>`

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

test('a finished notification ends its member, and as the last one releases the batch with the completion line', () => {
  const finished = deliveryOf(NOTICE, finishedText(BRAVO)) as Delivery
  const state = afterDelivery(launched(), report(ALPHA), true, 0).state
  expect(afterDelivery(state, finished, true, 1).act).toEqual({ kind: 'release', line: completeLine(2) })
  const first = afterDelivery(launched(), finished, true, 0)
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
