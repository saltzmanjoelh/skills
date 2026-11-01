import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMessage, TurnStepChunk, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { BATCH_LIMIT_MS, completeLine, deadlineLine, incompleteLine } from '../hooks/batch'
import { heldLine } from '../hooks/pane'
import type { BatchState } from '../types'

// The hooks that make builder wait for a whole batch of background agents
// before the model reads their reports (see
// docs/specs/builder-wakes-once-per-batch.md). The pure decisions are tested
// in batch.test.ts; these tests drive the engine's hooks around them.

function engine(on: On) {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__builder__${e.name}` } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
}

// Stands in for the model beneath the mod: each step it is asked for counts
// one call and answers with its own text and a stop.
function model(on: On) {
  const asked = { calls: 0 }
  on('turn.step', async function* ($, e) {
    asked.calls += 1
    yield { kind: 'text', index: 0, text: 'From the model.' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: 'From the model.', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return asked
}

// Stands in for the conversation the mod reads: `messages` is what the read
// answers, which a test sets, and `fails` makes the read throw.
function conversation(on: On) {
  const held = { messages: [assistant('Launched them.')] as SessionMessage[], fails: false, reads: 0 }
  on('session.messages', () => {
    held.reads += 1
    if (held.fails) throw new Error('the transcript is gone')
    return { value: held.messages }
  })
  return held
}

const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const assistant = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })

// The engine beneath the mod's prompt.submit hook: each prompt that goes on
// is recorded with its context, as the engine would start its turn.
function promptsBelow(on: On) {
  const passed: { text: string; context: readonly string[] }[] = []
  on('prompt.submit', ($, e) => {
    passed.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  return passed
}

// Answers each spawn with the next id, which is long enough to be named by
// its first eight characters.
function spawns(on: On) {
  let n = 0
  on('agent.spawn', () => {
    n += 1
    return { model: 'test', agentId: `agent-${n}-xxxxxxxxxx` }
  })
  on('agent.list', () => ({ value: [] }))
}

// Seeds the mod's state under each key of `seeded`, as an older load of the
// hooks would have left it, until the mod writes that key, and follows the
// mod's writes: `value` is the batch state it last wrote, `holdWrites` every
// value it wrote for the usage-limit hold, and `refuses` makes every write of
// the batches fail.
function stateOf(on: On, seeded: Record<string, unknown>) {
  const left = new Map(Object.entries(seeded))
  const seen = { value: seeded.batches as BatchState | undefined, refuses: false, holdWrites: [] as unknown[], reads: [] as string[] }
  on('state.get', ($, e, next) => {
    if (e.plugin === 'builder') seen.reads.push(e.key)
    if (e.plugin !== 'builder' || !left.has(e.key)) return next(e)
    return { value: { value: left.get(e.key), version: 0 } } as never
  })
  on('state.set', async ($, e, next) => {
    if (e.plugin !== 'builder') return next(e)
    if (e.key === 'batches' && seen.refuses) return { deny: 'the state could not be written' } as never
    left.delete(e.key)
    const out = await next(e)
    if (e.key === 'batches') seen.value = e.value as BatchState
    if (e.key === 'usageHold') seen.holdWrites.push(e.value)
    return out
  })
  return seen
}

async function step($: Engine, over: Partial<TurnStepInput> = {}) {
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'example-model', messageCount: 2, ...over })
  const chunks: TurnStepChunk[] = []
  for (;;) {
    const r = await stream.next()
    if (r.done) return { chunks, result: r.value }
    chunks.push(r.value)
  }
}

const texts = (chunks: TurnStepChunk[]) => chunks.map(c => (c.kind === 'text' ? c.text : c.kind))

const turnEnds = ($: Engine, turnId: string, agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId, reason: 'answer', ...(agentId === undefined ? {} : { agentId }) } as never)

const report = (id: string) => `<agent-message from="${id}">\n[Subagent hand-back] The report of ${id}.`
const notice = (id: string, status: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>`

type Submitted = { text?: string; drop?: string; context?: readonly string[] }
const deliver = ($: Engine, text: string, kind: 'peer' | 'task-notification' | 'composer' | 'sdk' = 'peer', over: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind }, ...(kind === 'peer' ? { isMeta: true } : {}), ...over } as never) as Promise<Submitted>

const ALPHA = 'agent-1-xxxxxxxxxx'
const BRAVO = 'agent-2-xxxxxxxxxx'
const CHARLIE = 'agent-3-xxxxxxxxxx'

const launch = (type: string, over: Record<string, unknown> = {}) => ({ subagentType: type, prompt: 'go', description: type, background: true, fork: false, ...over } as never)

// A session that ran one turn of its own whose first step launched the given
// agents, and that turn has ended, with an answer unless `isAborted` says it
// was aborted, which leaves a usage-limit hold on.
async function launched($: Engine, types: string[] = ['Explore', 'Plan'], over: Record<string, unknown> = {}, isAborted = false) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await step($, { turnId: 't1', index: 0 })
  for (const type of types) await $.agent.spawn(launch(type, over))
  if (isAborted) await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)
  else await turnEnds($, 't1')
}

function world(on: On, seeded: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  spawns(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const state = stateOf(on, seeded)
  const asked = model(on)
  const talk = conversation(on)
  const passed = promptsBelow(on)
  return { clock, state, asked, talk, passed }
}

test('agents launched in one step make one batch: an idle held report passes on unchanged, and its turn is answered without the model', async ($, on) => {
  const w = world(on)
  await launched($)
  expect(await deliver($, report(ALPHA))).toEqual({ text: report(ALPHA) })
  expect(w.state.value?.marker).toBe(1)
  const before = w.asked.calls
  const { chunks, result } = await step($, { turnId: 't2', index: 0 })
  expect(texts(chunks)).toEqual(['Noted.', 'stop'])
  expect(result).toEqual({ turnId: 't2', index: 0, answer: 'Noted.', toolUses: [], stopReason: 'end_turn', usage: null })
  expect(w.asked.calls).toBe(before)
  expect(w.state.value?.marker).toBe(0)
})

test('the report that ends the batch carries the completion line, and its turn goes to the model', async ($, on) => {
  const w = world(on)
  await launched($)
  await deliver($, report(ALPHA))
  await step($, { turnId: 't2', index: 0 })
  expect(await deliver($, report(BRAVO))).toEqual({ text: report(BRAVO), context: [completeLine(2)] })
  expect(w.state.value?.marker).toBe(0)
  const before = w.asked.calls
  await step($, { turnId: 't3', index: 0 })
  expect(w.asked.calls).toBe(before + 1)
})

test('agents launched in different steps, by a subagent or in the foreground make no batch', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await step($, { turnId: 't1', index: 0 })
  await $.agent.spawn(launch('Explore'))
  await step($, { turnId: 't1', index: 1 })
  await $.agent.spawn(launch('Explore'))
  await $.agent.spawn(launch('Explore', { parentAgentId: 'parent-agent' }))
  await $.agent.spawn(launch('Explore', { background: false }))
  await turnEnds($, 't1')
  for (const id of [ALPHA, BRAVO, CHARLIE, 'agent-4-xxxxxxxxxx']) expect(await deliver($, report(id))).toEqual({ text: report(id) })
  expect(w.state.value?.marker ?? 0).toBe(0)
})

test('an agent launched while the session is idle joins no batch of the step before', async ($, on) => {
  const w = world(on)
  await launched($, ['Explore'])
  await $.agent.spawn(launch('Plan'))
  expect(await deliver($, report(ALPHA))).toEqual({ text: report(ALPHA) })
  expect(w.state.value?.marker ?? 0).toBe(0)
})

test('a completed notification before or after the report is held and ends nothing, and a failed one ends its member', async ($, on) => {
  const w = world(on)
  await launched($)
  expect(await deliver($, notice(ALPHA, 'completed'), 'task-notification')).toEqual({ text: notice(ALPHA, 'completed') })
  expect(w.state.value?.marker).toBe(1)
  await deliver($, report(ALPHA))
  await deliver($, notice(ALPHA, 'completed'), 'task-notification')
  expect(w.state.value?.marker).toBe(3)
  expect(await deliver($, notice(BRAVO, 'failed'), 'task-notification')).toEqual({ text: notice(BRAVO, 'failed'), context: [completeLine(2)] })
  // A notification after the release is held too.
  await deliver($, notice(BRAVO, 'completed'), 'task-notification')
  expect(w.state.value?.marker).toBe(4)
})

test('a delivery into a running turn leaves the marker alone', async ($, on) => {
  const w = world(on)
  await launched($)
  expect(await deliver($, report(ALPHA), 'peer', { turnId: 't9' })).toEqual({ text: report(ALPHA) })
  expect(w.state.value?.marker).toBe(0)
  expect(await deliver($, report(BRAVO), 'peer', { turnId: 't9' })).toEqual({ text: report(BRAVO), context: [completeLine(2)] })
})

test('a person\'s prompt while a batch has held deliveries names the members still running, and the deadline does not move', async ($, on) => {
  const w = world(on)
  await launched($)
  await deliver($, report(ALPHA))
  const deadline = w.state.value?.batches[0]?.deadline
  expect(await deliver($, 'how is it going?', 'composer')).toEqual({ text: 'how is it going?', context: [incompleteLine(['Plan agent-2-'])] })
  // A slash command the person runs carries no line, because no model reads it.
  expect((await deliver($, '/builder status', 'composer', { command: { name: 'builder', args: 'status' } })).context).toBeUndefined()
  expect(await deliver($, 'and now?', 'sdk')).toEqual({ text: 'and now?', context: [incompleteLine(['Plan agent-2-'])] })
  expect(w.state.value?.batches[0]?.deadline).toBe(deadline)
})

test('the deadline submits builder\'s line naming the members still running, and a later member then wakes the model alone', async ($, on) => {
  const w = world(on)
  await launched($)
  await deliver($, report(ALPHA))
  await step($, { turnId: 't2', index: 0 })
  await w.clock.advance(BATCH_LIMIT_MS - 1000)
  expect(w.passed.map(p => p.text)).not.toContain(deadlineLine(['Plan agent-2-']))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.passed.map(p => p.text)).toContain(deadlineLine(['Plan agent-2-']))
  expect(await deliver($, report(BRAVO))).toEqual({ text: report(BRAVO) })
  expect(w.state.value?.marker).toBe(0)
})

// A stored batch with ALPHA's report held, BRAVO still running and a
// deadline five minutes in, with a marker set, stamped with `sessionId`.
const heldBatchOf = (sessionId: string): BatchState => ({
  version: 1,
  sessionId,
  marker: 1,
  batches: [{
    step: 't1:0',
    members: [{ id: ALPHA, type: 'Explore', ended: true }, { id: BRAVO, type: 'Plan', ended: false }],
    heldReports: 1,
    deadline: 5 * 60_000,
    releasedAt: null,
  }],
})

test('a deadline stored before a hot reload still fires after the session starts again', async ($, on) => {
  const w = world(on, { batches: heldBatchOf('session-1') })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await w.clock.settle()
  await w.clock.advance(5 * 60_000)
  await w.clock.settle()
  expect(w.passed.map(p => p.text)).toContain(deadlineLine(['Plan agent-2-']))
})

test('batches an earlier conversation left behind before a clear add no line, fire no deadline and answer no step', async ($, on) => {
  const w = world(on, { batches: heldBatchOf('an-earlier-conversation') })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await w.clock.settle()
  expect((await deliver($, 'how is it going?', 'composer')).context).toBeUndefined()
  const before = w.asked.calls
  await step($, { turnId: 't1', index: 0 })
  expect(w.asked.calls).toBe(before + 1)
  await w.clock.advance(5 * 60_000)
  await w.clock.settle()
  expect(w.passed.map(p => p.text)).not.toContain(deadlineLine(['Plan agent-2-']))
  expect(await deliver($, report(BRAVO))).toEqual({ text: report(BRAVO) })
})

test('a first step whose last message is a user message goes to the model and clears the marker', async ($, on) => {
  const w = world(on)
  await launched($)
  await deliver($, report(ALPHA))
  w.talk.messages = [assistant('Launched them.'), user('what now?')]
  const before = w.asked.calls
  await step($, { turnId: 't2', index: 0 })
  expect(w.asked.calls).toBe(before + 1)
  expect(w.state.value?.marker).toBe(0)
})

test('a later step, a subagent\'s step and a step with no marker go to the model and leave the marker as it is', async ($, on) => {
  const w = world(on)
  await launched($)
  const reads = w.talk.reads
  let before = w.asked.calls
  await step($, { turnId: 't2', index: 0 })
  expect(w.asked.calls).toBe(before + 1)
  expect(w.talk.reads).toBe(reads)
  await deliver($, report(ALPHA))
  before = w.asked.calls
  await step($, { turnId: 't3', index: 1 })
  await step($, { turnId: 'a3', index: 0, agentId: ALPHA } as never)
  expect(w.asked.calls).toBe(before + 2)
  expect(w.state.value?.marker).toBe(1)
})

test('a lone agent\'s report after a batch delivery reaches the model', async ($, on) => {
  const w = world(on)
  await launched($)
  await deliver($, report(ALPHA))
  await step($, { turnId: 't2', index: 0 })
  await turnEnds($, 't2')
  await step($, { turnId: 't3', index: 0 })
  await $.agent.spawn(launch('Explore'))
  await turnEnds($, 't3')
  expect(await deliver($, report(CHARLIE))).toEqual({ text: report(CHARLIE) })
  const before = w.asked.calls
  await step($, { turnId: 't4', index: 0 })
  expect(w.asked.calls).toBe(before + 1)
})

test('a person\'s prompt holding an agent-message, and a task id under any other origin, keep today\'s handling', async ($, on) => {
  const w = world(on)
  await launched($)
  expect(await deliver($, report(ALPHA), 'composer')).toEqual({ text: report(ALPHA) })
  expect(await deliver($, notice(ALPHA, 'killed'), 'peer')).toEqual({ text: notice(ALPHA, 'killed') })
  expect(await deliver($, report(ALPHA), 'task-notification')).toEqual({ text: report(ALPHA) })
  expect(w.state.value?.marker ?? 0).toBe(0)
})

test('a write of the batches that fails passes the delivery on unchanged, and a conversation that cannot be read lets the model answer', async ($, on) => {
  const w = world(on)
  await launched($)
  w.state.refuses = true
  expect(await deliver($, report(ALPHA))).toEqual({ text: report(ALPHA) })
  w.state.refuses = false
  await deliver($, report(ALPHA))
  w.talk.fails = true
  const before = w.asked.calls
  await step($, { turnId: 't2', index: 0 })
  expect(w.asked.calls).toBe(before + 1)
  expect(w.state.value?.marker).toBe(0)
})

// A session watching #7, with a usage-limit hold on, that has a batch
// delivery held and then runs the turn `turnId` with the marker as it stands:
// answers how many reads of the pull request gh was asked for in the 45
// seconds after that turn ended, and every write of the hold.
async function turnEndOf($: Engine, on: On, isQuiet: boolean) {
  const w = world(on, {
    run: { repo: 'o/r', number: 7, cwd: '/repo', login: 'owner', since: 0 },
    usageHold: { until: 60 * 60_000 },
  })
  const ran: string[] = []
  on('process.run', ($, e) => {
    ran.push(e.argv.join(' '))
    return { value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  await launched($, ['Explore', 'Plan'], {}, true)
  await w.clock.settle()
  await deliver($, report(ALPHA))
  if (!isQuiet) w.talk.messages = [user('what now?')]
  const reads = () => ran.filter(c => c.startsWith('gh pr view 7')).length
  await step($, { turnId: 't2', index: 0 })
  await w.clock.settle()
  const before = reads()
  await turnEnds($, 't2')
  await w.clock.advance(45_000)
  await w.clock.settle()
  return { looks: reads() - before, holdWrites: w.state.holdWrites }
}

test('a turn answered without the model leaves a usage-limit hold alone and starts no turn-end looks', async ($, on) => {
  const { looks, holdWrites } = await turnEndOf($, on, true)
  expect(looks).toBe(0)
  expect(holdWrites).toEqual([])
})

test('a turn the model answered clears the usage-limit hold and starts the turn-end looks, as before', async ($, on) => {
  const { looks, holdWrites } = await turnEndOf($, on, false)
  expect(looks).toBeGreaterThan(0)
  expect(holdWrites).toContain(null)
})

// A session with a batch delivery held that runs the turn `t2` with the
// marker as it stands: answers how many times the end of that turn read the
// session's usage, which is the read that measures the context before a
// compaction.
async function measuresAtTurnEnd($: Engine, on: On, isQuiet: boolean) {
  const w = world(on)
  const usage = { reads: 0 }
  on('session.usage', () => {
    usage.reads += 1
    return { value: { tokens: 0, window: 1 } } as never
  })
  await launched($)
  await deliver($, report(ALPHA))
  if (!isQuiet) w.talk.messages = [user('what now?')]
  await step($, { turnId: 't2', index: 0 })
  await w.clock.settle()
  const before = usage.reads
  await turnEnds($, 't2')
  await w.clock.settle()
  return usage.reads - before
}

test('a turn answered without the model measures nothing at its end, so it never compacts', async ($, on) => {
  expect(await measuresAtTurnEnd($, on, true)).toBe(0)
})

test('a turn the model answered measures the context at its end, as before', async ($, on) => {
  expect(await measuresAtTurnEnd($, on, false)).toBeGreaterThan(0)
})

test('the pane shows how many reports are held back only while a batch holds some', async ($, on) => {
  const w = world(on)
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: { bodyColumns: 120 } as never })
  await launched($)
  await w.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /^Holding / })).toBeUndefined()
  await deliver($, report(ALPHA))
  await w.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: heldLine(1) })).toBeDefined()
  await deliver($, report(BRAVO))
  await w.clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /^Holding / })).toBeUndefined()
})

test('a member resumed by the session is forgotten, so its later report passes and raises no marker', async ($, on) => {
  const w = world(on)
  await launched($)
  await $.agent.spawn(launch('Explore', { resume: { agentId: ALPHA } }))
  await w.clock.settle()
  expect(await deliver($, report(ALPHA))).toEqual({ text: report(ALPHA) })
  expect(w.state.value?.marker).toBe(0)
  expect(w.state.value?.batches.flatMap(b => b.members.map(m => m.id))).not.toContain(ALPHA)
})

test('the band above the prompt never reads the batches, so a batch write does not draw it again, and the pane does', async ($, on) => {
  const w = world(on)
  await launched($)
  await deliver($, report(ALPHA))
  await w.clock.settle()
  const band = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: { bodyColumns: 120 } as never })
  w.state.reads.length = 0
  await band.redraw()
  expect(w.state.reads).not.toContain('batches')
  await pane.redraw()
  expect(w.state.reads).toContain('batches')
})
