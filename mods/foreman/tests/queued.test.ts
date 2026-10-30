import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BEGIN_TEXT, REASONS } from '../hooks/desktop'
import { newPairing, ticketsIn, ticketsKey, WAIT_LINE, WAITING_SENTENCE } from '../hooks/tickets'
import type { ForemanTickets } from '../types'
import { foreman, MINUTE, mountBoth, record, SECOND, start, T0, world } from './world'

// The queue as the person meets it: starts beyond the free slots wait, and
// foreman begins them itself, through the fake desktop app in tests/world.ts.

const START = 'mcp__ccd_session__start_session'

type World = ReturnType<typeof world>

const ledger = (w: World) => ticketsIn(w.stored.get(ticketsKey('session-1')))
const startSession = ($: Engine, args: Record<string, unknown>) => $.tool.call({ tool: START, ...args } as never) as Promise<{ deny?: string; text?: string; context?: readonly string[] }>

// A keyed start whose brief begins with /implement, and the app's answer to
// the nth start.
const keyed = (key: string) => ({ prompt: `/implement ${key}`, context: 'fresh', title: `${key}: short` })
const answer = (n: number) => `Started session (session_id: local_new${n}, name: example).`

// The ticket a start's brief carried, which is how its brief ends.
const ticketOf = (w: World, n: number) => {
  const prompt = String(w.engine.started[n]!.prompt)
  return prompt.slice(prompt.indexOf('foreman-ticket: ') + 'foreman-ticket: '.length)
}

// The status file builder writes for a sub session that has begun its issue,
// and the one it writes for a sub session that waits: idle, with no issue.
const busyFile = (key: string, ticket: string, id: string, over: Record<string, unknown> = {}) => record(key, 'working', { ticket, desktopSessionId: id, stage: 'build', ...over })
const waitingFile = (ticket: string, id: string) => record(null, 'idle', { sessionId: `s-${id}`, ticket, desktopSessionId: id, issueTitle: null })

// A session as the desktop app lists it.
const listed = (id: string, key: string, over: { isArchived?: boolean; isRunning?: boolean } = {}) => ({ sessionId: id, cwd: '/w', title: `${key}: short`, isArchived: false, isRunning: true, ...over })

// A parent with `slots` slots, already on when the session starts.
async function parent($: Engine, on: Parameters<typeof world>[0], slots: number, store: Record<string, unknown> = {}) {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots }, ...store } })
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  return { w, ui }
}

// Moves the clock on a minute at a time for `minutes` minutes, rewriting the
// files `live` names first each minute, as builder does while its session
// lives.
async function minutesPass(w: World, minutes: number, live: Record<string, string> = {}) {
  for (let i = 0; i < minutes; i++) {
    const now = T0 + (Math.round((w.clock.now() - T0) / MINUTE) + 1) * MINUTE
    for (const [name, text] of Object.entries(live)) w.folder.put(name, text, now, false)
    await w.clock.advance(MINUTE)
    await w.clock.settle()
  }
}

// The parent with one slot, ABC-1 started and working in local_new1, and
// ABC-2 and ABC-3 waiting in local_new2 and local_new3, each listed by the
// app and each with its status file. Answers the files to keep rewriting.
async function queueOfTwo($: Engine, on: Parameters<typeof world>[0]) {
  const { w, ui } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), answer(2), answer(3)]
  for (const key of ['ABC-1', 'ABC-2', 'ABC-3']) await startSession($, keyed(key))
  const live = {
    'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1'),
    'b.json': waitingFile(ticketOf(w, 1), 'local_new2'),
    'c.json': waitingFile(ticketOf(w, 2), 'local_new3'),
  }
  w.desktop.sessions = [listed('local_new1', 'ABC-1'), listed('local_new2', 'ABC-2'), listed('local_new3', 'ABC-3')]
  await minutesPass(w, 1, live)
  return { w, ui, live }
}

const begins = (w: World) => w.desktop.sent.filter(([, text]) => text === BEGIN_TEXT).map(([to]) => to)
const sendsTo = (w: World, id: string) => w.desktop.calls.filter(c => c.tool === 'send_message' && c.args.session_id === id).length

test('with one slot, three keyed starts in turn give one plain brief and two that begin with the wait line, at places 1 and 2', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), answer(2), answer(3)]
  const outs = []
  for (const key of ['ABC-1', 'ABC-2', 'ABC-3']) outs.push(await startSession($, keyed(key)))
  const prompts = w.engine.started.map(s => String(s.prompt))
  expect(prompts[0]).toMatch(/^\/implement ABC-1\n\nforeman-ticket: ft-[0-9a-f-]{36}$/)
  expect(prompts[1]).toMatch(/\n\n\/implement ABC-2\n\nforeman-ticket: ft-[0-9a-f-]{36}$/)
  expect(prompts[1]!.startsWith(`${WAIT_LINE('ABC-2')}\n\n/implement ABC-2\n\n`)).toBe(true)
  expect(prompts[2]!.startsWith(`${WAIT_LINE('ABC-3')}\n\n/implement ABC-3\n\n`)).toBe(true)
  expect(outs.map(o => o.context)).toEqual([undefined, [WAITING_SENTENCE('ABC-2')], [WAITING_SENTENCE('ABC-3')]])
  await w.clock.settle()
  expect(ledger(w).pairings.map(p => [p.issueKey, p.localId, p.queue])).toEqual([
    ['ABC-1', 'local_new1', null],
    ['ABC-2', 'local_new2', { place: 1, claim: null }],
    ['ABC-3', 'local_new3', { place: 2, claim: null }],
  ])
})

test('two keyed starts at once with one slot free let exactly one go ahead', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), answer(2)]
  await Promise.all([startSession($, keyed('ABC-1')), startSession($, keyed('ABC-2'))])
  const prompts = w.engine.started.map(s => String(s.prompt))
  expect(prompts.filter(p => p.startsWith('Wait for foreman'))).toHaveLength(1)
  expect(ledger(w).pairings.filter(p => p.queue === null)).toHaveLength(1)
})

test('a start whose call throws or answers an error leaves no pairing behind, waiting or not', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startFails = true
  await startSession($, keyed('ABC-1'))
  w.engine.startFails = false
  w.engine.startThrows = true
  await startSession($, keyed('ABC-2')).catch(() => undefined)
  await w.clock.settle()
  expect(ledger(w).pairings).toEqual([])
})

test('a start whose answer comes after the ledger lost its reservation is paired again with its session id, at the back of the queue', async ($, on) => {
  // While `losing` is set, every write of the ledger loses ABC-3's
  // reservation, standing in for any way the ledger can lose it while the
  // call is out.
  let losing = false
  on('state.set', ($, e, next) => {
    if (!losing || e.plugin !== 'foreman' || e.key !== 'tickets') return next(e)
    const t = e.value as ForemanTickets
    return next({ ...e, value: { ...t, pairings: t.pairings.filter(p => p.issueKey !== 'ABC-3') } } as never)
  })
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), answer(2), answer(3)]
  await startSession($, keyed('ABC-1'))
  await startSession($, keyed('ABC-2'))
  losing = true
  w.engine.onStart = async () => {
    losing = false
    await w.clock.settle()
    expect(ledger(w).pairings.map(p => p.issueKey)).toEqual(['ABC-1', 'ABC-2'])
  }
  const out = await startSession($, keyed('ABC-3'))
  expect(out.context).toEqual([WAITING_SENTENCE('ABC-3')])
  await w.clock.settle()
  expect(ledger(w).pairings.map(p => [p.ticket, p.issueKey, p.localId, p.queue])).toEqual([
    [ticketOf(w, 0), 'ABC-1', 'local_new1', null],
    [ticketOf(w, 1), 'ABC-2', 'local_new2', { place: 1, claim: null }],
    [ticketOf(w, 2), 'ABC-3', 'local_new3', { place: 2, claim: null }],
  ])
})

test('a waiting sub session is not shown, not nudged and raises no wake, and a merge begins it with the fixed message and one line', async ($, on) => {
  const { w, ui, live } = await queueOfTwo($, on)
  await minutesPass(w, 16, live)
  expect(w.desktop.sent).toEqual([])
  expect(w.engine.prompts).toEqual([])
  const band = await ui.bandText()
  expect(band).toStartWith('foreman: 1 of 1 slots busy · ABC-1')
  expect(band).not.toContain('no issue')
  const merged = busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done', pr: { number: 7, url: 'https://example.com/pull/7', state: 'MERGED', verdicts: null } })
  w.desktop.sessions[0] = listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { ...live, 'a.json': merged })
  expect(begins(w)).toEqual(['local_new2'])
  // ABC-1's file shows its pull request for the first time already merged,
  // so the wake reports the opening and the merge, as it does today, and then
  // the begin.
  expect(w.engine.prompts).toEqual([
    'foreman: ABC-1 opened pull request #7. ABC-1\'s pull request #7 merged. foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed; tell the person so in one line.',
  ])
  const p = ledger(w).pairings.find(q => q.localId === 'local_new2')!
  expect(p.queue).toBeNull()
  expect(ledger(w).pairings.find(q => q.localId === 'local_new3')!.queue).toEqual({ place: 2, claim: null })
  expect(await ui.paneText()).toContain('Began ABC-2 with foreman\'s begin message.')
  // It is busy now and watched like any other: idle a threshold after its
  // begin, it is nudged.
  await minutesPass(w, 6, { 'b.json': live['b.json'], 'c.json': live['c.json'] })
  expect(w.desktop.sent.filter(([to]) => to === 'local_new2').map(([, text]) => text)).toEqual([BEGIN_TEXT, 'what\'s next?'])
  expect(begins(w)).toEqual(['local_new2'])
})

test('with the queue empty, a freed slot wakes the parent to pick the next issue as before', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1)]
  await startSession($, keyed('ABC-1'))
  const done = busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' })
  w.desktop.sessions = [listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })]
  await minutesPass(w, 3, { 'a.json': done })
  expect(w.engine.prompts).toEqual(['foreman: one slot free; pick the next issue and start it.'])
})

test('raising the slot count begins the waiting sub sessions in the new slots', async ($, on) => {
  const { w, live } = await queueOfTwo($, on)
  expect(begins(w)).toEqual([])
  await foreman($, '3')
  await w.clock.settle()
  expect(begins(w)).toEqual(['local_new2', 'local_new3'])
  expect(w.engine.prompts).toEqual([
    'foreman: foreman began ABC-2, the next issue in the queue, in a free slot; tell the person so in one line.'
    + ' foreman began ABC-3, the next issue in the queue, in a free slot; tell the person so in one line.',
  ])
  await minutesPass(w, 2, live)
  expect(begins(w)).toEqual(['local_new2', 'local_new3'])
})

test('a begin that fails raises one notification and is tried again, not while the list fails, and an archived target is held and the next one begins', async ($, on) => {
  const { w, ui, live } = await queueOfTwo($, on)
  w.desktop.sendTo.set('local_new2', 'error')
  await minutesPass(w, 1, live)
  await ui.pane.press({ key: 'release-a.json' })
  await w.clock.settle()
  expect(sendsTo(w, 'local_new2')).toBe(1)
  const failed = 'foreman could not send ABC-2\'s waiting session its begin message, and tries again while that session stays open.'
  expect(w.engine.notices).toEqual([failed])
  expect(await ui.paneText()).toContain(`Could not begin ABC-2: ${REASONS.sendRefused}.`)
  expect(ledger(w).pairings.find(q => q.localId === 'local_new2')!.queue?.claim?.notified).toBe(true)
  await minutesPass(w, 2, live)
  expect(sendsTo(w, 'local_new2')).toBeGreaterThan(1)
  expect(w.engine.notices).toEqual([failed])
  w.desktop.list = 'error'
  const tries = sendsTo(w, 'local_new2')
  await minutesPass(w, 4, live)
  expect(sendsTo(w, 'local_new2')).toBe(tries)
  expect(await ui.paneText()).toContain(`Could not read the desktop app's list of sessions, so no queued issue was begun or dropped: ${REASONS.listRefused}.`)
  w.desktop.list = 'ok'
  w.desktop.sessions[1] = listed('local_new2', 'ABC-2', { isArchived: true, isRunning: false })
  await minutesPass(w, 3, live)
  expect(ledger(w).held).toEqual(['ABC-2'])
  expect(ledger(w).pairings.some(q => q.localId === 'local_new2')).toBe(false)
  expect(w.engine.notices).toEqual([failed])
  expect(begins(w)).toEqual(['local_new3'])
  expect(w.engine.prompts.at(-1)).toBe('foreman: foreman began ABC-3, the next issue in the queue, in a free slot; tell the person so in one line.')
})

test('a restart keeps the queue, and a claim whose begin never went is sent on the first read', async ($, on) => {
  const stored = {
    pairings: [
      newPairing('ft-b', 'local_b', T0 - 10 * MINUTE, 'ABC-2', { place: 1, claim: { attemptAt: T0 - MINUTE, notified: false } }),
      newPairing('ft-c', 'local_c', T0 - 10 * MINUTE, 'ABC-3', { place: 2, claim: null }),
    ],
  }
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 1 }, [ticketsKey('session-1')]: stored } })
  w.desktop.sessions = [listed('local_b', 'ABC-2'), listed('local_c', 'ABC-3')]
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(begins(w)).toEqual(['local_b'])
  expect(ledger(w).pairings.map(p => [p.ticket, p.queue])).toEqual([['ft-b', null], ['ft-c', { place: 2, claim: null }]])
  expect(w.engine.prompts).toEqual(['foreman: foreman began ABC-2, the next issue in the queue, in a free slot; tell the person so in one line.'])
  await w.clock.advance(30 * SECOND)
  await w.clock.settle()
  expect(begins(w)).toEqual(['local_b'])
})
