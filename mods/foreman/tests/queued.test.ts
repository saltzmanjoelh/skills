import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { listFailedNotice, NO_ANSWER } from '../hooks/act'
import { AUTOMATED_REFUSAL } from '../hooks/held'
import { ticketTimes } from '../hooks/spend'
import { BEGIN_TEXT, REASONS } from '../hooks/desktop'
import { newPairing, ticketsIn, ticketsKey, WAIT_LINE, WAITING_SENTENCE } from '../hooks/tickets'
import type { ForemanTickets } from '../types'
import { foreman, MINUTE, mountBoth, record, SAVED_PATH, SECOND, start, T0, world } from './world'

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

// The ticket a start's brief carried, on the line before the parent line that ends it.
const ticketOf = (w: World, n: number) => {
  const prompt = String(w.engine.started[n]!.prompt)
  return prompt.slice(prompt.indexOf('foreman-ticket: ') + 'foreman-ticket: '.length).split('\n')[0]!
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
  expect(prompts[0]).toMatch(/^\/implement ABC-1\n\nforeman-ticket: ft-[0-9a-f-]{36}\nforeman-parent: session-1$/)
  expect(prompts[1]).toMatch(/\n\n\/implement ABC-2\n\nforeman-ticket: ft-[0-9a-f-]{36}\nforeman-parent: session-1$/)
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

test('a waiting sub session is not shown, not nudged and raises no wake, and a merge begins it with the fixed message and one notification', async ($, on) => {
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
  // so one notification reports the opening and the merge, and then the
  // begin, and nothing wakes the parent.
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual([
    'ABC-1 opened pull request #7. ABC-1\'s pull request #7 merged. foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed.',
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

test('a ticket that waited gets the time from its reservation to its begin message, one begun without waiting gets zero, and one still waiting has none', async ($, on) => {
  const { w, live } = await queueOfTwo($, on)
  const [first, second, third] = [ticketOf(w, 0), ticketOf(w, 1), ticketOf(w, 2)]
  // ABC-1 began without waiting, so its queue time is zero, not unknown.
  expect(ticketTimes(ledger(w), first).queued).toBe(0)
  expect(ledger(w).spent.map(e => e.ticket)).toEqual([first])
  const reservedAt = ledger(w).pairings.find(p => p.ticket === second)!.pairedAt
  const merged = busyFile('ABC-1', first, 'local_new1', { state: 'done', pr: { number: 7, url: 'https://example.com/pull/7', state: 'MERGED', verdicts: null } })
  await minutesPass(w, 20, live)
  expect(begins(w)).toEqual([])
  w.desktop.sessions[0] = listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { ...live, 'a.json': merged })
  expect(begins(w)).toEqual(['local_new2'])
  const begunAt = ledger(w).pairings.find(p => p.ticket === second)!.pairedAt
  expect(begunAt - reservedAt).toBeGreaterThan(20 * MINUTE)
  expect(ticketTimes(ledger(w), second).queued).toBe(begunAt - reservedAt)
  // ABC-3 still waits, so its queue time is unknown and it has no entry.
  expect(ticketTimes(ledger(w), third).queued).toBeNull()
  expect(ledger(w).spent.map(e => e.ticket)).toEqual([first, second])
})

for (const [name, damaged] of [['zero', 0], ['later than the clock', T0 + 365 * 24 * 60 * MINUTE]] as const) {
  test(`a waiting ticket whose reservation time is ${name} gets an unknown queue time at its begin message, never a wrong one`, async ($, on) => {
    // Every write of the ledger gives ABC-2's pairing the damaged reservation
    // time, so the begin message finds it there.
    on('state.set', ($, e, next) => {
      if (e.plugin !== 'foreman' || e.key !== 'tickets') return next(e)
      const t = e.value as ForemanTickets
      return next({ ...e, value: { ...t, pairings: t.pairings.map(p => (p.issueKey === 'ABC-2' ? { ...p, pairedAt: damaged } : p)) } } as never)
    })
    const { w, live } = await queueOfTwo($, on)
    const [first, second] = [ticketOf(w, 0), ticketOf(w, 1)]
    const merged = busyFile('ABC-1', first, 'local_new1', { state: 'done', pr: { number: 7, url: 'https://example.com/pull/7', state: 'MERGED', verdicts: null } })
    w.desktop.sessions[0] = listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })
    await minutesPass(w, 2, { ...live, 'a.json': merged })
    expect(begins(w)).toEqual(['local_new2'])
    expect(ticketTimes(ledger(w), second).queued).toBeNull()
    // The stored ledger holds no queue time for it either.
    const stored = w.stored.get(ticketsKey('session-1')) as ForemanTickets
    expect(stored.spent.find(e => e.ticket === second)?.queuedMs ?? null).toBeNull()
  })
}

test('a start that is refused, held, answers an error or throws leaves no ledger entry', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [AUTOMATED_REFUSAL]
  await startSession($, keyed('ABC-1'))
  w.engine.startFails = true
  await startSession($, keyed('ABC-2'))
  w.engine.startFails = false
  w.engine.startThrows = true
  await startSession($, keyed('ABC-3')).catch(() => undefined)
  await w.clock.settle()
  expect(ledger(w).held).toEqual(['ABC-1'])
  expect(ledger(w).pairings).toEqual([])
  expect(ledger(w).spent).toEqual([])
})

test('a start that does not wait and whose reservation the ledger lost is paired again with a queue time of zero', async ($, on) => {
  let losing = false
  on('state.set', ($, e, next) => {
    if (!losing || e.plugin !== 'foreman' || e.key !== 'tickets') return next(e)
    const t = e.value as ForemanTickets
    return next({ ...e, value: { ...t, pairings: t.pairings.filter(p => p.issueKey !== 'ABC-1') } } as never)
  })
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1)]
  losing = true
  w.engine.onStart = async () => {
    losing = false
    await w.clock.settle()
    expect(ledger(w).pairings).toEqual([])
  }
  await startSession($, keyed('ABC-1'))
  await w.clock.settle()
  expect(ledger(w).pairings.map(p => [p.issueKey, p.queue])).toEqual([['ABC-1', null]])
  expect(ticketTimes(ledger(w), ticketOf(w, 0)).queued).toBe(0)
})

test('a slot freed while the desktop app\'s list fails is kept for the queue, and the first read that lists begins the waiting session in it', async ($, on) => {
  const { w, ui, live } = await queueOfTwo($, on)
  await minutesPass(w, 2, live)
  const { 'a.json': _, ...rest } = live
  w.desktop.list = 'error'
  w.folder.files.delete('a.json')
  await minutesPass(w, 2, rest)
  expect(w.engine.prompts).toEqual([])
  expect(begins(w)).toEqual([])
  expect(ledger(w).keptSlots).toEqual(['ABC-1'])
  expect(await ui.paneText()).toContain('Kept the slot of ABC-1 for the queue, because the desktop app\'s list of sessions could not be read.')
  w.desktop.list = 'ok'
  await minutesPass(w, 1, rest)
  expect(begins(w)).toEqual(['local_new2'])
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual([listFailedNotice(REASONS.listRefused), 'foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed.'])
  expect(ledger(w).keptSlots).toEqual([])
})

// A session the app lists without saying whether it is archived: foreman can
// neither begin it nor drop it from the queue.
const doubtful = (id: string, key: string) => ({ sessionId: id, cwd: '/w', title: `${key}: short`, isRunning: true })

test('a Release while an issue waits, followed by a read whose list does not show the waiting session surely open, wakes the parent with the kept sentence', async ($, on) => {
  const { w, ui, live } = await queueOfTwo($, on)
  w.desktop.sessions = [listed('local_new1', 'ABC-1'), doubtful('local_new2', 'ABC-2'), doubtful('local_new3', 'ABC-3')]
  await minutesPass(w, 1, live)
  expect(w.engine.prompts).toEqual([])
  await ui.pane.press({ key: 'release-a.json' })
  await w.clock.settle()
  expect(begins(w)).toEqual([])
  const kept = 'foreman: a slot is free, but foreman keeps it for ABC-2, whose waiting session it could not find in the desktop app\'s list; send that session foreman\'s begin message by hand or release the issue, and do not start a new issue.'
  expect(w.engine.prompts).toEqual([kept])
  expect(ledger(w).keptSlots).toEqual([])
  // The read that woke the parent holds the slot for its begin by hand, so
  // the next reads wake nobody again.
  await minutesPass(w, 3, live)
  expect(w.engine.prompts).toEqual([kept])
})

test('a Release while an issue waits and the list fails keeps the released slot for the queue, and the first read that lists begins the waiting session in it', async ($, on) => {
  const { w, ui, live } = await queueOfTwo($, on)
  await minutesPass(w, 1, live)
  w.desktop.list = 'error'
  await ui.pane.press({ key: 'release-a.json' })
  // The name is stored in the same write as the release itself.
  expect(ledger(w).keptSlots).toEqual(['ABC-1'])
  expect(ledger(w).pairings.find(p => p.issueKey === 'ABC-1')!.standing).toBe('released')
  await w.clock.settle()
  await minutesPass(w, 2, live)
  expect(w.engine.prompts).toEqual([])
  expect(begins(w)).toEqual([])
  expect(ledger(w).keptSlots).toEqual(['ABC-1'])
  expect(await ui.paneText()).toContain('Released ABC-1; its session and its status file are left as they are.')
  w.desktop.list = 'ok'
  await minutesPass(w, 1, live)
  expect(begins(w)).toEqual(['local_new2'])
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual([listFailedNotice(REASONS.listRefused), 'foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed.'])
  expect(ledger(w).keptSlots).toEqual([])
})

test('a restart keeps a kept slot, and the first read that lists begins the waiting session in it', async ($, on) => {
  const stored = { pairings: [newPairing('ft-b', 'local_b', T0 - 10 * MINUTE, 'ABC-2', { place: 1, claim: null })], keptSlots: ['ABC-1'] }
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 1 }, [ticketsKey('session-1')]: stored } })
  w.desktop.sessions = [listed('local_b', 'ABC-2')]
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(begins(w)).toEqual(['local_b'])
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual(['foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed.'])
  expect(ledger(w).keptSlots).toEqual([])
})

// The sentence foreman shows itself when a slot frees and nobody waits.
const DRY = 'foreman\'s queue ran dry: a slot is free and no sub session waits, so your next message lines up more.'
const dryNotices = (w: World) => w.engine.notices.filter(n => n.includes(DRY)).length

test('with the queue empty, a freed slot wakes nobody and reports the dry queue once, in the log, the band and one notification', async ($, on) => {
  const { w, ui } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1)]
  await startSession($, keyed('ABC-1'))
  const done = busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' })
  w.desktop.sessions = [listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })]
  await minutesPass(w, 3, { 'a.json': done })
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.appended).toEqual([])
  expect(w.engine.notices).toEqual([DRY])
  expect(await ui.paneText()).toContain(DRY)
  expect(await ui.bandText()).toContain(DRY)
  expect(ledger(w).dryNotified).toBe(true)
  await minutesPass(w, 3, { 'a.json': done })
  expect(w.engine.notices).toEqual([DRY])
})

test('a slot that frees later while the queue stays empty raises no second notification', async ($, on) => {
  const { w, ui } = await parent($, on, 2)
  w.engine.startAnswers = [answer(1), answer(2)]
  await startSession($, keyed('ABC-1'))
  await startSession($, keyed('ABC-2'))
  const live = { 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1'), 'b.json': busyFile('ABC-2', ticketOf(w, 1), 'local_new2') }
  w.desktop.sessions = [listed('local_new1', 'ABC-1'), listed('local_new2', 'ABC-2')]
  await minutesPass(w, 1, live)
  w.desktop.sessions[0] = listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { ...live, 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' }) })
  expect(dryNotices(w)).toBe(1)
  w.desktop.sessions[1] = listed('local_new2', 'ABC-2', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { 'b.json': busyFile('ABC-2', ticketOf(w, 1), 'local_new2', { state: 'done' }) })
  expect(ledger(w).pairings.every(p => p.standing === 'freed')).toBe(true)
  expect(dryNotices(w)).toBe(1)
  expect(w.engine.prompts).toEqual([])
  expect(await ui.paneText()).toContain('A slot is free and foreman\'s queue is still empty, which foreman already reported.')
})

test('a start that waits arms the dry report again, even when its session is archived before any read sees it', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), answer(2), answer(3)]
  await startSession($, keyed('ABC-1'))
  w.desktop.sessions = [listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })]
  await minutesPass(w, 2, { 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' }) })
  expect(dryNotices(w)).toBe(1)
  // ABC-2 goes ahead in the free slot, and ABC-3 waits behind it, but the
  // person archives ABC-3's session before any read lists it.
  await startSession($, keyed('ABC-2'))
  await startSession($, keyed('ABC-3'))
  expect(ledger(w).dryNotified).toBe(false)
  const b = busyFile('ABC-2', ticketOf(w, 1), 'local_new2')
  w.desktop.sessions = [listed('local_new2', 'ABC-2'), listed('local_new3', 'ABC-3', { isArchived: true, isRunning: false })]
  await minutesPass(w, 2, { 'b.json': b })
  expect(ledger(w).pairings.some(p => p.queue !== null)).toBe(false)
  w.desktop.sessions[0] = listed('local_new2', 'ABC-2', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { 'b.json': busyFile('ABC-2', ticketOf(w, 1), 'local_new2', { state: 'done' }) })
  expect(dryNotices(w)).toBe(2)
  expect(w.engine.prompts).toEqual([])
})

test('a waiting start answered with a proposal card holds back no slot once its call is long over, and begins once its session starts', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), 'Proposed the session as a card for the person to start.']
  await startSession($, keyed('ABC-1'))
  await startSession($, keyed('ABC-2'))
  const card = ticketOf(w, 1)
  expect(ledger(w).pairings.find(p => p.ticket === card)).toMatchObject({ localId: null, queue: { place: 1, claim: null } })
  const live = { 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1') }
  w.desktop.sessions = [listed('local_new1', 'ABC-1')]
  await minutesPass(w, 6, live)
  const done = busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' })
  w.desktop.sessions = [listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })]
  await minutesPass(w, 2, { 'a.json': done })
  expect(w.engine.prompts).toEqual([])
  expect(dryNotices(w)).toBe(1)
  // The person starts the card later: its session writes its file with the
  // ticket, foreman learns its id from it, and begins it in the free slot.
  w.desktop.sessions.push(listed('local_card', 'ABC-2'))
  await minutesPass(w, 2, { 'a.json': done, 'b.json': waitingFile(card, 'local_card') })
  expect(begins(w)).toEqual(['local_card'])
})

test('a proposal card nobody started does not arm the dry report again once its call is long over', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), 'Proposed the session as a card for the person to start.', answer(3)]
  await startSession($, keyed('ABC-1'))
  await startSession($, keyed('ABC-2'))
  w.desktop.sessions = [listed('local_new1', 'ABC-1')]
  await minutesPass(w, 6, { 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1') })
  w.desktop.sessions = [listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })]
  await minutesPass(w, 2, { 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' }) })
  expect(dryNotices(w)).toBe(1)
  // ABC-3 goes ahead in the free slot, since the card is owed none, and then
  // frees it again while the card still waits.
  await startSession($, keyed('ABC-3'))
  expect(String(w.engine.started[2]!.prompt)).not.toContain('Wait for foreman')
  w.desktop.sessions.push(listed('local_new3', 'ABC-3'))
  await minutesPass(w, 1, { 'c.json': busyFile('ABC-3', ticketOf(w, 2), 'local_new3') })
  w.desktop.sessions[1] = listed('local_new3', 'ABC-3', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { 'c.json': busyFile('ABC-3', ticketOf(w, 2), 'local_new3', { state: 'done' }) })
  expect(ledger(w).pairings.find(p => p.ticket === ticketOf(w, 2))?.standing).toBe('freed')
  expect(dryNotices(w)).toBe(1)
})

test('a slot that frees soon after a waiting start was answered with a proposal card wakes the parent with the kept sentence', async ($, on) => {
  const { w } = await parent($, on, 1)
  w.engine.startAnswers = [answer(1), 'Proposed the session as a card for the person to start.']
  await startSession($, keyed('ABC-1'))
  await startSession($, keyed('ABC-2'))
  const done = busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' })
  w.desktop.sessions = [listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })]
  await minutesPass(w, 2, { 'a.json': done })
  expect(w.engine.prompts).toEqual(['foreman: a slot is free, but foreman keeps it for ABC-2, whose waiting session it could not find in the desktop app\'s list; send that session foreman\'s begin message by hand or release the issue, and do not start a new issue.'])
  // The waiting pairing holds the time of the read that woke the parent, so
  // its slot stays kept for the parent's begin by hand.
  const keptAt = ledger(w).pairings.find(p => p.ticket === ticketOf(w, 1))!.queue?.keptAt
  expect(typeof keptAt).toBe('number')
  expect(keptAt!).toBeGreaterThan(w.clock.now() - 2 * MINUTE)
  expect(keptAt!).toBeLessThanOrEqual(w.clock.now())
})

test('a restart keeps a fresh stamp for a kept slot, and begins no waiting session in that slot even when the list shows them open', async ($, on) => {
  const stored = {
    pairings: [
      newPairing('ft-b', 'local_b', T0 - 10 * MINUTE, 'ABC-2', { place: 1, claim: null, keptAt: T0 - MINUTE }),
      newPairing('ft-c', 'local_c', T0 - 10 * MINUTE, 'ABC-3', { place: 2, claim: null }),
    ],
  }
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 1 }, [ticketsKey('session-1')]: stored } })
  w.desktop.sessions = [listed('local_b', 'ABC-2'), listed('local_c', 'ABC-3')]
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(begins(w)).toEqual([])
  expect(w.engine.prompts).toEqual([])
  expect(ledger(w).pairings.map(p => [p.ticket, p.queue])).toEqual([
    ['ft-b', { place: 1, claim: null, keptAt: T0 - MINUTE }],
    ['ft-c', { place: 2, claim: null }],
  ])
  // Once the kept slot is more than five minutes old, the next read begins
  // the session it was kept for, which shows the restart did read the list.
  await minutesPass(w, 7, { 'b.json': waitingFile('ft-b', 'local_b') })
  expect(begins(w)).toEqual(['local_b'])
})

test('an active sub session archived before its file said done frees its slot, and the next issue in the queue begins in it', async ($, on) => {
  const { w, live } = await queueOfTwo($, on)
  const stuck = busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'waiting-on-builder' })
  w.desktop.sessions[0] = listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { ...live, 'a.json': stuck })
  // The queue needs the list, but no key is held, so only the family's list
  // is read and the whole list is never asked for.
  expect(w.desktop.calls.some(c => c.tool === 'list_sessions')).toBe(true)
  expect(w.desktop.calls.filter(c => c.tool === 'list_sessions' && c.args.linked !== true)).toEqual([])
  expect(begins(w)).toEqual(['local_new2'])
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual(['foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed.'])
  expect(ledger(w).pairings.find(p => p.localId === 'local_new1')!.standing).toBe('freed')
})

test('a list answer that Claude Code replaced with its notice is read from the saved copy, so a waiting issue begins in the slot a finished sub session freed', async ($, on) => {
  const { w, live } = await queueOfTwo($, on)
  w.desktop.list = 'saved'
  const reads = w.folder.projectReads.length
  w.desktop.sessions[0] = listed('local_new1', 'ABC-1', { isArchived: true, isRunning: false })
  await minutesPass(w, 2, { ...live, 'a.json': busyFile('ABC-1', ticketOf(w, 0), 'local_new1', { state: 'done' }) })
  expect(w.folder.projectReads.slice(reads)).toContain(SAVED_PATH)
  expect(w.desktop.calls.filter(c => c.tool === 'list_sessions').every(c => c.args.linked === true)).toBe(true)
  expect(begins(w)).toEqual(['local_new2'])
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual(['foreman began ABC-2, the next issue in the queue, in the slot ABC-1 freed.'])
  expect(ledger(w).pairings.find(p => p.localId === 'local_new1')!.standing).toBe('freed')
})

test('each way a list read fails raises one notification with its fixed reason, and again only after a read that got the list', async ($, on) => {
  const ways = [['error', REASONS.listRefused], ['garbage', REASONS.listUnreadable], ['not-connected', REASONS.notConnected], ['hang', NO_ANSWER]] as const
  const { w, live } = await queueOfTwo($, on)
  const seen: string[] = []
  // Each way fails for three reads in a row, then one read gets the list.
  for (const [how, why] of ways) {
    w.desktop.list = how
    await minutesPass(w, 3, live)
    seen.push(listFailedNotice(why))
    expect([how, w.engine.notices]).toEqual([how, seen])
    w.desktop.list = 'ok'
    await minutesPass(w, 1, live)
    expect([how, w.engine.notices]).toEqual([how, seen])
  }
  expect(w.engine.notices.join(' ')).not.toContain('SECRET')
})

test('raising the slot count begins the waiting sub sessions in the new slots', async ($, on) => {
  const { w, live } = await queueOfTwo($, on)
  expect(begins(w)).toEqual([])
  await foreman($, '3')
  await w.clock.settle()
  expect(begins(w)).toEqual(['local_new2', 'local_new3'])
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual([
    'foreman began ABC-2, the next issue in the queue, in a free slot. foreman began ABC-3, the next issue in the queue, in a free slot.',
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
  expect(begins(w)).toEqual(['local_new3'])
  expect(w.engine.notices).toEqual([failed, listFailedNotice(REASONS.listRefused), 'foreman began ABC-3, the next issue in the queue, in a free slot.'])
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
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.notices).toEqual(['foreman began ABC-2, the next issue in the queue, in a free slot.'])
  await w.clock.advance(30 * SECOND)
  await w.clock.settle()
  expect(begins(w)).toEqual(['local_b'])
})
