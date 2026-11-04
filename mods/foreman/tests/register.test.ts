import { expect, test } from 'claude-code/testing'
import type { On, SessionReceiveOrigin } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { REASONS } from '../hooks/desktop'
import { FIRST_MARKER_LOG, markersKey } from '../hooks/markers'
import { STATUS_CHANGED_TEXT } from '../hooks/notes'
import { START_FOREMAN_FALLBACK, START_FOREMAN_OFF, startForemanText } from '../hooks/commands'
import { heldLine, topUpLine } from '../hooks/held'
import { newPairing, ticketsIn, ticketsKey, TICKETS_EMPTY } from '../hooks/tickets'
import { CHANGED, CHANGED_AS_RECEIVED, CHANGED_ELEMENT, foreman, HOME, MINUTE, SECOND, SECRET, SURFACES, T0, leftInState, mountBoth, record, SENT, start, statusFolder, world } from './world'

// Two sub sessions: one working at the plan stage with three stages done and
// a pull request, and one that needs the person.
function twoSubs(folder: ReturnType<typeof statusFolder>) {
  folder.put('a.json', record('ABC-1', 'working', {
    stage: 'plan', stageDone: 3, desktopSessionId: 'local_a', pr: { repo: 'acme/example-app', number: 4, state: 'open', checks: 'passed' },
  }))
  folder.put('b.json', record('ABC-2', 'needs-you', { stage: 'spec', stageDone: 2, reason: 'the counsel could not decide' }))
}

for (const surface of SURFACES) {
  test(`on the ${surface}, the band and the pane are drawn from the status files`, async ($, on) => {
    const w = world(on)
    twoSubs(w.folder)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    await w.clock.settle()

    const band = await ui.bandText()
    expect(band).toStartWith('foreman: 2 of 2 slots busy · ')
    for (const part of ['ABC-1 plan tournament', 'ABC-2 needs you', 'next read in 30s']) expect(band).toContain(part)

    const pane = await ui.paneText()
    expect((await ui.pane.find({ key: 'open-a.json' }))?.text).toBe('→ ABC-1 · #4 open · checks passed')
    expect((await ui.pane.find({ key: 'open-b.json' }))?.text).toBe('→ ABC-2 · no pull request yet')
    expect(pane).toContain('needs you · the counsel could not decide')
    for (const key of ['nudge-a.json', 'release-a.json', 'nudge-b.json', 'release-b.json']) expect(await ui.pane.find({ key })).toBeDefined()
    const drawings = await ui.pane.findAll({ type: 'Svg' })
    if (surface === 'desktop') {
      expect(drawings).toHaveLength(2)
      expect(String(drawings[0]!.props.source)).toContain('3 of 9')
    } else {
      expect(drawings).toHaveLength(0)
      expect(pane).toContain('3 of 9')
    }
  })

  test(`on the ${surface}, an empty folder says there are no sub sessions, after the mark that the queue is empty while slots are free`, async ($, on) => {
    const w = world(on)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    expect(await ui.bandText()).toBe('foreman: 0 of 2 slots busy · queue empty · no sub sessions · next read in 2m')
  })
}

test('a band too narrow for every chip shows the ones that fit and says how many more there are', async ($, on) => {
  const w = world(on)
  for (const n of [1, 2, 3, 4, 5]) w.folder.put(`${n}.json`, record(`ABC-${n}`, 'idle'))
  const ui = await mountBoth($, on, 'terminal', 80)
  await start($)
  await foreman($)
  const band = await ui.bandText()
  expect(band).toContain('ABC-1 idle')
  expect(band).toMatch(/\+\d more/)
  expect(band).not.toContain('ABC-5')
  expect(band.length).toBeLessThanOrEqual(80)
})

test('pressing the issue in the pane, and a chip in the band, opens that session beside the parent', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)

  await ui.pane.press({ key: 'open-a.json' })
  await ui.band.press({ key: 'chip-a.json' })
  expect(w.desktop.calls).toEqual([
    { server: 'ccd_window', tool: 'open_session_in', args: { session_id: 'local_a', target: 'split' } },
    { server: 'ccd_window', tool: 'open_session_in', args: { session_id: 'local_a', target: 'split' } },
  ])
  expect(await ui.newestLog()).toBe('Opened ABC-1 beside this session. (2 times)')
  expect(w.toasts).toEqual([])
})

test('without a desktop session id, the session whose folder matches is found and opened, a trailing slash included', async ($, on) => {
  const w = world(on)
  w.folder.put('c.json', record('ABC-3', 'idle', { cwd: '/work/c/' }))
  w.desktop.sessions = [{ sessionId: 'local_x', cwd: '/work/x' }, { sessionId: 'local_c', cwd: '/work/c' }]
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await ui.pane.press({ key: 'open-c.json' })
  expect(w.desktop.calls.map(c => c.tool)).toEqual(['list_sessions', 'open_session_in'])
  expect(w.desktop.calls[1]!.args).toEqual({ session_id: 'local_c', target: 'split' })
})

test('each way an open can fail shows a toast that is the newest log line, with its own reason and never the tool\'s error text', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'idle', { desktopSessionId: 'local_a' }))
  w.folder.put('n.json', record('ABC-2', 'idle', { cwd: null }))
  w.folder.put('c.json', record('ABC-3', 'idle'))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)

  const cases: [string, string, () => void][] = [
    ['open-n.json', `Could not open ABC-2: ${REASONS.noAddress}.`, () => {}],
    ['open-c.json', `Could not open ABC-3: ${REASONS.noSessionInFolder}.`, () => {}],
    ['open-c.json', `Could not open ABC-3: ${REASONS.notConnected}.`, () => { w.desktop.list = 'not-connected' }],
    ['open-c.json', `Could not open ABC-3: ${REASONS.listUnreadable}.`, () => { w.desktop.list = 'garbage' }],
    ['open-c.json', `Could not open ABC-3: ${REASONS.listRefused}.`, () => { w.desktop.list = 'error' }],
    ['open-a.json', `Could not open ABC-1: ${REASONS.notConnected}.`, () => { w.desktop.open = 'not-connected' }],
    ['open-a.json', `Could not open ABC-1: ${REASONS.openRefused}.`, () => { w.desktop.open = 'error' }],
    ['open-a.json', `Could not open ABC-1: ${REASONS.openRefused}.`, () => { w.desktop.open = 'error-empty' }],
  ]
  // The same line twice in a row is counted on the first, in the log only.
  let last = ''
  for (const [key, line, arrange] of cases) {
    arrange()
    const before = w.toasts.length
    await ui.pane.press({ key })
    expect(w.toasts.length).toBe(before + 1)
    expect(w.toasts.at(-1)).toBe(line)
    expect(await ui.newestLog()).toBe(line === last ? `${line} (2 times)` : line)
    last = line
  }
  expect(w.toasts.join('\n')).not.toContain(SECRET)
  expect(await ui.paneText()).not.toContain(SECRET)
})

test('a session that never ran /start-foreman draws no band of its own and reads no file', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.advance(10 * MINUTE)
  expect(await ui.bandText()).toBe('')
  expect(await ui.band.find({ text: 'host line' })).toBeDefined()
  expect(w.folder.lists).toBe(0)
  expect(w.folder.reads).toBe(0)
})

test('/start-foreman turns the role on, opens the pane and keeps the role in the store under the session id', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  const answer = await foreman($)
  expect(answer.text).toBe('This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: null })
  expect(w.panes).toEqual(['foreman'])
  expect(w.folder.lists).toBe(1)
})

test('a session whose stored role is on draws the band and reads the folder at its start, and reads again 30 seconds on', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 3 } } })
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(await ui.bandText()).toContain('foreman: 2 of 3 slots busy')
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
})

test('after a reload that lost the timer, the end of a turn arms it again and reads at once when the read is overdue', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null }, nextReadAt: T0 - SECOND, readAt: T0 - 31 * SECOND })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await w.clock.settle()
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
})

test('after a reload that lost the timer, a submitted prompt arms it again and reads at once when the read is overdue', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null }, nextReadAt: T0 - SECOND, readAt: T0 - 31 * SECOND })
  const passed = await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'person' } } as never)
  expect((passed as { text: string }).text).toBe('next')
  await w.clock.settle()
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
})

test('after a reload whose read is not yet due, the end of a turn arms the timer for the saved time', async ($, on) => {
  const w = world(on)
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null }, nextReadAt: T0 + 20 * SECOND, readAt: T0 - 100 * SECOND })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await w.clock.advance(19 * SECOND)
  expect(w.folder.lists).toBe(0)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(1)
})

test('after a reload that lost the timer, a refused /start-foreman arms it again', async ($, on) => {
  const w = world(on)
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null }, nextReadAt: T0 + 20 * SECOND, readAt: T0 - 100 * SECOND })
  await foreman($, '0')
  await w.clock.advance(19 * SECOND)
  expect(w.folder.lists).toBe(0)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(1)
})

test('/start-foreman <n> sets the count, and a count outside 1 to 20 is refused and changes nothing', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect((await foreman($, '1')).text).toBe('This parent now runs 1 sub session at once.')
  expect((await foreman($, '3')).text).toBe('This parent now runs 3 sub sessions at once.')
  expect(await ui.bandText()).toContain('0 of 3 slots busy')
  for (const bad of ['0', '2.5', '21', '0 start two issues']) {
    expect((await foreman($, bad)).text).toContain('from 1 to 20')
    expect(await ui.bandText()).toContain('0 of 3 slots busy')
  }
  await w.clock.settle()
  expect(w.engine.prompts).toEqual([])
})

test('/start-foreman <n> with words after it makes the session the parent first, then sends the words to the model as the person\'s prompt', async ($, on) => {
  const w = world(on)
  let wasParentWhenSent: unknown = 'not sent'
  w.engine.onSubmit = () => {
    wasParentWhenSent = w.stored.get('parent:session-1')
  }
  const ui = await mountBoth($, on)
  await start($)
  const answer = await foreman($, '2 clean up the worktrees, then start the next 2 issues')
  expect(w.engine.prompts).toEqual([])
  await w.clock.settle()
  expect(w.engine.origins).toEqual([{ kind: 'plugin', name: 'foreman', asUser: true }])
  expect(answer.text).toBe('This session is now the parent and runs 2 sub sessions at once, and foreman shows its sub sessions above the prompt and in its pane. It passes the rest of your line to this session as your prompt.')
  expect(await ui.bandText()).toContain('0 of 2 slots busy')
  expect(w.engine.prompts).toEqual(['clean up the worktrees, then start the next 2 issues'])
  expect(wasParentWhenSent).toEqual({ isOn: true, slots: 2 })
})

test('/start-foreman with words and no count makes the session the parent and sends every word to the model', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  const answer = await foreman($, 'start the next issue')
  await w.clock.settle()
  expect(answer.text).toBe('This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane. It passes the rest of your line to this session as your prompt.')
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: null })
  expect(w.engine.prompts).toEqual(['start the next issue'])
})

test('words after /start-foreman that the engine refuses leave a line in the log', async ($, on) => {
  const w = world(on)
  w.engine.submit = 'dropped'
  const ui = await mountBoth($, on)
  await start($)
  await foreman($, 'start the next issue')
  await w.clock.settle()
  expect(await ui.newestLog()).toBe('Could not pass on the words after /start-foreman (a Stop stands).')
})

test('/start-foreman with nothing after it, or only a count, sends no prompt', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await foreman($)
  await foreman($, '4')
  await w.clock.settle()
  expect(w.engine.prompts).toEqual([])
})

test('/start-foreman <n> in a session that is not the parent makes it the parent with that count, reads the folder and opens the pane', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  const answer = await foreman($, '5')
  expect(answer.text).toBe('This session is now the parent and runs 5 sub sessions at once, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(await ui.bandText()).toContain('0 of 5 slots busy')
  expect(w.folder.lists).toBe(1)
  expect(w.panes).toEqual(['foreman'])
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: 5 })
})

test('a refused /start-foreman leaves a session that is not the parent as it was', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  expect((await foreman($, '0 pause')).text).toContain('from 1 to 20')
  await w.clock.settle()
  expect(w.engine.prompts).toEqual([])
  expect(await ui.bandText()).toBe('')
  expect(w.folder.lists).toBe(0)
  expect(w.panes).toEqual([])
})

test('a slot count stored while the role was off survives a resume, and /start-foreman then keeps it in the band and the store', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: false, slots: 3, isPaused: true } } })
  const ui = await mountBoth($, on)
  await start($)
  expect(w.folder.lists).toBe(0)
  await foreman($)
  const band = await ui.bandText()
  expect(band).toContain('0 of 3 slots busy')
  expect(band).not.toContain('paused')
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: 3 })
})

test('the slots option sets the count when no command has', { options: { slots: 4 } }, async ($, on) => {
  world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(await ui.bandText()).toContain('0 of 4 slots busy')
})

test('a file caught half written keeps its last good read, an unknown state is never listed, and a file that leaves the folder leaves the list', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  w.folder.put('x.json', record('ABC-7', 'gone'))
  w.folder.put('y.json', record('ABC-8', 'idle', { state: undefined }))
  w.folder.put('notes.txt', record('ABC-9', 'idle'))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(await ui.bandText()).not.toContain('ABC-7')
  expect(await ui.bandText()).not.toContain('ABC-8')
  expect(await ui.bandText()).not.toContain('ABC-9')

  w.folder.put('a.json', '{"sessionId": "s-ABC-1", "issueKey": "AB', T0 + 10 * SECOND)
  w.folder.files.delete('b.json')
  await w.clock.advance(30 * SECOND)
  const band = await ui.bandText()
  expect(band).toContain('ABC-1 plan tournament')
  expect(band).not.toContain('ABC-2')
  expect(band).toContain('1 of 2 slots busy')
})

test('a listing that fails on a folder that exists keeps the rows and logs the reason', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  w.folder.listFails = 'EACCES: permission denied'
  await w.clock.advance(30 * SECOND)
  expect(await ui.bandText()).toContain('2 of 2 slots busy')
  expect(await ui.newestLog()).toContain('Could not read the status folder')
  expect(await ui.newestLog()).toContain('EACCES: permission denied')
})

test('a missing folder shows no sub sessions', async ($, on) => {
  const w = world(on)
  w.folder.exists = false
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(await ui.bandText()).toContain('no sub sessions')
  expect(await ui.paneText()).not.toContain('Could not read')
})

test('CLAUDE_CONFIG_DIR moves the status folder', async ($, on) => {
  const w = world(on, { env: { HOME, CLAUDE_CONFIG_DIR: '/config' }, at: '/config/foreman/builds' })
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(await ui.bandText()).toContain('2 of 2 slots busy')
})

test('a file more than three minutes old is dimmed with its age and still busy, and one just under is not stale', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { stage: 'build', reason: 'building' }), T0 - 3 * MINUTE - SECOND)
  w.folder.put('b.json', record('ABC-2', 'working', { stage: 'build' }), T0 - 2 * MINUTE - 59 * SECOND)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  const band = await ui.bandText()
  expect(band).toContain('2 of 2 slots busy')
  expect(band).toContain('ABC-1 working · no update for 3m')
  expect(band).toContain('ABC-2 build')
  expect((await ui.band.find({ key: 'chip-a.json' }))?.props.dimColor).toBe(true)
  expect((await ui.band.find({ key: 'chip-b.json' }))?.props.dimColor).not.toBe(true)
  expect(await ui.paneText()).toContain('working · building · no update for 3m')
})

// The oldest background task as builder writes it, started `ago` before T0,
// with builder's 15 minutes to its hung time.
const oldestBackground = (description: string, ago: number) => ({ description, startedAt: T0 - ago, hungAt: T0 - ago + 15 * MINUTE })

test('a row waiting on background work names its oldest task with a rising time, and its state line turns to the warning colour at the hung time', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { reason: '1 background task running.', oldestBackground: oldestBackground('full UI test run', 14 * MINUTE) }))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  // The surface keeps no key on a Text, so the state line is found by its
  // words, drawn again as of now.
  const stateLine = async () => {
    await ui.pane.redraw()
    return await ui.pane.find({ type: 'Text', text: /^working · / })
  }

  const fresh = await stateLine()
  expect(fresh?.text).toBe('working · 1 background task running. · waiting on: full UI test run (14m 0s)')
  expect(fresh?.props.color).toBeUndefined()
  expect(fresh?.props.dimColor).not.toBe(true)

  // One millisecond before the hung time, the time has risen and there is no mark.
  await w.clock.advance(MINUTE - 1)
  const before = await stateLine()
  expect(before?.text).toBe('working · 1 background task running. · waiting on: full UI test run (14m 59s)')
  expect(before?.props.color).toBeUndefined()

  await w.clock.advance(1)
  const hung = await stateLine()
  expect(hung?.text).toBe('working · 1 background task running. · waiting on: full UI test run (15m 0s), it may be hung')
  expect(hung?.props.color).toBe('warning')
  // The band's chip does not change: it keeps its words and takes no colour.
  expect(await ui.bandText()).toContain('ABC-1 working')
  const chip = await ui.band.find({ type: 'Text', text: /^ABC-1 working$/ })
  expect(chip).toBeDefined()
  expect(chip?.props.color).toBeUndefined()
  expect(chip?.props.dimColor).not.toBe(true)
})

test('a probably hung row that is stale stays dimmed, one that needs you stays red, and a record without the task draws as before', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { reason: 'building', oldestBackground: oldestBackground('full UI test run', 20 * MINUTE) }), T0 - 4 * MINUTE)
  w.folder.put('b.json', record('ABC-2', 'needs-you', { reason: 'the counsel could not decide', oldestBackground: oldestBackground('', 20 * MINUTE) }))
  w.folder.put('c.json', record('ABC-3', 'working', { reason: 'building' }))
  w.folder.put('d.json', record('ABC-4', 'idle', { reason: 'nothing to hand over' }))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await ui.pane.redraw()
  // The surface keeps no key on a Text, so each state line is found by its
  // words.
  const line = (words: RegExp) => ui.pane.find({ type: 'Text', text: words })

  const stale = await line(/^working · building · waiting on/)
  expect(stale?.text).toBe('working · building · waiting on: full UI test run (20m 0s), it may be hung · no update for 4m')
  expect(stale?.props.dimColor).toBe(true)
  expect(stale?.props.color).toBeUndefined()

  const needsYou = await line(/^needs you · /)
  expect(needsYou?.text).toBe('needs you · the counsel could not decide · waiting on: a background task (20m 0s), it may be hung')
  expect(needsYou?.props.color).toBe('error')

  const working = await line(/^working · building$/)
  expect(working?.text).toBe('working · building')
  expect(working?.props.color).toBeUndefined()
  expect(working?.props.dimColor).not.toBe(true)

  const idle = await line(/^idle · /)
  expect(idle?.text).toBe('idle · nothing to hand over')
  expect(idle?.props.color).toBe('warning')
})

test('the next read comes 30 seconds after a read with a fresh working file, and not at 29', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  await foreman($)
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(29 * SECOND)
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(2)
})

test('the next read comes 2 minutes after a read whose only working file is stale', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'), T0 - 4 * MINUTE)
  w.folder.put('b.json', record('ABC-2', 'idle'))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(await ui.bandText()).toContain('next read in 2m')
  await w.clock.advance(2 * MINUTE - SECOND)
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(2)
})

test('a sub session with no issue yet is drawn with those words, after the keyed ones, and opens like any other', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record(null, 'working', { issueTitle: '', desktopSessionId: 'local_n', stage: 'grounding' }))
  w.folder.put('b.json', record('ABC-2', 'idle'))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  const band = await ui.bandText()
  expect(band.indexOf('ABC-2 idle')).toBeLessThan(band.indexOf('no issue yet grounding'))
  expect((await ui.pane.find({ key: 'open-a.json' }))?.text).toBe('→ no issue yet · no pull request yet')
  await ui.band.press({ key: 'chip-a.json' })
  expect(w.desktop.calls.at(-1)?.args).toEqual({ session_id: 'local_n', target: 'split' })
})

for (const surface of SURFACES) {
  test(`on the ${surface}, text in a record with escape sequences is drawn without them`, async ($, on) => {
    const w = world(on)
    w.folder.put('a.json', record('ABC-\u001b[31m9', 'needs-you', {
      issueTitle: 'Fix \u001b]0;evil\u0007the <b>&"title"', reason: 'stuck\u001b[2J here', stage: 'build', stageDone: 4,
    }))
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    const all = `${await ui.bandText()}\n${await ui.paneText()}`
    expect(all).not.toContain('\u001b')
    expect(all).not.toContain('evil')
    expect(all).toContain('ABC-9 needs you')
    expect(all).toContain('needs you · stuck here')
    const drawings = await ui.pane.findAll({ type: 'Svg' })
    if (surface === 'desktop') {
      const source = String(drawings[0]!.props.source)
      expect(source).toContain('Fix the &lt;b&gt;&amp;&quot;title&quot;')
      expect(source).not.toContain('<b>')
      expect(source).not.toContain('\u001b')
    } else {
      expect(all).toContain('Fix the <b>&"title"')
    }
  })
}

// What a sub session spent, as builder writes it in its status file.
const USAGE = { models: [{ model: 'model-a', input: 4000, output: 1000, cacheRead: 90_000, cacheWrite: 2000 }], usd: 1.75 }
const USAGE_WORDS = '4K in, 1K out, 90K cache read, 2K cache write · $1.75'

// The text of every line of the pane that begins with `head`, in the order
// the pane draws them.
async function linesOf(ui: Awaited<ReturnType<typeof mountBoth>>, head: string): Promise<string[]> {
  await ui.pane.redraw()
  return (await ui.pane.findAll({ type: 'Text', text: new RegExp(`^${head}`) })).map(t => t.text)
}

// Answers foreman's reads of builder's `usage` state value with `value`, as
// builder running in the same session would hold it.
function builderUsage(on: On, value: unknown) {
  on('state.get', ($, e, next) => {
    if (e.plugin !== 'builder' || e.key !== 'usage') return next(e)
    return { value: { value, version: 0 } } as never
  })
}

test('each row shows its sub session\'s spending, and a row whose file carries none shows it as unknown, never as $0', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { usage: USAGE }))
  w.folder.put('b.json', record('ABC-2', 'working'))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  expect(await linesOf(ui, 'Spent: ')).toEqual([`Spent: ${USAGE_WORDS}`, 'Spent: unknown'])
  expect(await ui.paneText()).not.toContain('$0')
})

test('the pane sums every sub session this parent started, and keeps a sub session whose file is gone in the sum', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { usage: USAGE }))
  w.folder.put('b.json', record('ABC-2', 'working', { usage: { ...USAGE, usd: 0.25 } }))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  const sum = 'Sub sessions spent: 8K in, 2K out, 180K cache read, 4K cache write · $2.00'
  expect(await linesOf(ui, 'Sub sessions spent: ')).toEqual([sum])
  w.folder.files.delete('b.json')
  await w.clock.advance(30 * SECOND)
  expect(await ui.pane.find({ key: 'open-b.json' })).toBeUndefined()
  expect(await linesOf(ui, 'Spent: ')).toEqual([`Spent: ${USAGE_WORDS}`])
  expect(await linesOf(ui, 'Sub sessions spent: ')).toEqual([sum])
  expect((ticketsIn(w.stored.get(ticketsKey('session-1')))).spent.map(e => e.ticket)).toEqual(['ft-ABC-1', 'ft-ABC-2'])
})

test('with no reading yet, the sum and this session\'s spending say unknown', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  expect(await linesOf(ui, 'Sub sessions spent: ')).toEqual(['Sub sessions spent: unknown'])
  expect(await linesOf(ui, 'This session spent: ')).toEqual(['This session spent: unknown'])
})

// How long a sub session's issue has taken, as builder writes it in its
// status file, and the words for it.
const TIMING = {
  startedAt: T0, stages: [{ stage: 'spec', at: T0 }], prOpenedAt: null, prMergedAt: null,
  states: { 'working': 10 * MINUTE, 'waiting-on-builder': MINUTE, 'idle': 2 * MINUTE, 'needs-you': 65 * MINUTE, 'in-cleanup': 0, 'done': 0 },
  rounds: [], olderRounds: 0,
}

test('each row shows its sub session\'s times under its spending, unknown when its file carries none, and the pane sums them over sub sessions', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { usage: USAGE, timing: TIMING }))
  w.folder.put('b.json', record('ABC-2', 'working', { timing: { ...TIMING, states: { ...TIMING.states, 'working': 5 * MINUTE, 'needs-you': 0 } } }))
  w.folder.put('c.json', record('ABC-3', 'working'))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  // These sub sessions were paired without foreman's queue, so their queue
  // time is unknown.
  expect(await linesOf(ui, 'Time: ')).toEqual([
    'Time: working 10m · waiting on you 1h 5m · other waiting 3m · queued unknown',
    'Time: working 5m · waiting on you 0m · other waiting 3m · queued unknown',
    'Time: unknown',
  ])
  const lines = await linesOf(ui, 'Sub sessions')
  expect(lines).toEqual([
    'Sub sessions spent: 4K in, 1K out, 90K cache read, 2K cache write · $1.75',
    'Sub sessions\' time, summed: working 15m · waiting on you 1h 5m · other waiting 6m · queued unknown',
  ])
  expect(await linesOf(ui, 'Summed over')).toEqual(['Summed over sub sessions that run side by side, so a sum can be longer than the run.'])
  // A sub session whose file is gone stays in the sums.
  w.folder.files.delete('b.json')
  await w.clock.advance(30 * SECOND)
  expect(await linesOf(ui, 'Time: ')).toHaveLength(2)
  expect(await linesOf(ui, 'Sub sessions\' time')).toEqual([lines[1]])
})

test('with no times read yet, the sums say unknown, never zero', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  expect(await linesOf(ui, 'Sub sessions\' time')).toEqual(['Sub sessions\' time, summed: unknown'])
})

// Builder's usage value for this session, which foreman shows as this
// session's own spending, and values it reads as unknown.
const OWN_LEDGER = { ...USAGE, sessionId: 'session-1', lastEngineUsd: 1.75, turns: [], at: T0 }
const OWN_CASES: [string, unknown, string][] = [
  ['builder\'s usage value for this session', OWN_LEDGER, USAGE_WORDS],
  ['a usage value stamped with another session id', { ...OWN_LEDGER, sessionId: 'session-0' }, 'unknown'],
  ['a damaged usage value', { ...OWN_LEDGER, models: 'lots' }, 'unknown'],
  ['no usage value', null, 'unknown'],
]

for (const [what, value, words] of OWN_CASES) {
  test(`this session's own spending, from ${what}, reads "${words}"`, async ($, on) => {
    const w = world(on)
    builderUsage(on, value)
    const ui = await mountBoth($, on)
    await start($)
    await foreman($)
    await w.clock.settle()
    expect(await linesOf(ui, 'This session spent: ')).toEqual([`This session spent: ${words}`])
  })
}

test('the band\'s draw never reads builder\'s usage value, which only the pane shows, and the pane\'s draw does', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working', { usage: USAGE }))
  let usageReads = 0
  on('state.get', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'usage') usageReads++
    return next(e)
  })
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const band = await $.ui.mount({ plugin: 'foreman', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 200 } as never })
  await start($)
  await foreman($)
  await w.clock.settle()
  usageReads = 0
  await band.redraw()
  expect((await band.find({ key: 'foreman-band' }))?.text ?? '').toContain('ABC-1')
  expect(usageReads).toBe(0)

  const pane = await $.ui.mount({ plugin: 'foreman', surface: 'terminal', component: 'Pane', requestId: 'foreman', props: { bodyColumns: 200 } as never })
  await pane.redraw()
  expect(usageReads).toBeGreaterThan(0)
})

test('after a reload, a ledger left in $.state that holds only readings outweighs an older stored one', async ($, on) => {
  const counts = { input: 4000, output: 1000, cacheRead: 90_000, cacheWrite: 2000 }
  const w = world(on, { store: { [ticketsKey('session-1')]: { ...TICKETS_EMPTY, offRefusedFor: 'session-1' } } })
  leftInState(on, { tickets: { ...TICKETS_EMPTY, spent: [{ ticket: 'ft-a', counts, usd: 1.75 }] }, parent: { isOn: true, slots: null }, nextReadAt: T0 + 20 * SECOND })
  const ui = await mountBoth($, on)
  await start($)
  expect(await linesOf(ui, 'Sub sessions spent: ')).toEqual([`Sub sessions spent: ${USAGE_WORDS}`])
  expect(w.store.writes.get(ticketsKey('session-1'))).toBeUndefined()
})

// A delivery that reaches the parent, from a peer whose plugin claim is
// builder's unless another origin is given.
const BUILDER: SessionReceiveOrigin = { kind: 'peer', plugin: 'builder' }
const receive = ($: Engine, text: string, origin: SessionReceiveOrigin = BUILDER) => $.session.receive({ origin, text })

test('builder\'s message that a status file changed, in either shape the app delivers it, is consumed and reads the folder at once', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  await foreman($)
  expect(w.folder.lists).toBe(1)
  for (const [n, text] of [CHANGED, CHANGED_ELEMENT, `\n ${CHANGED}\n\n`].entries()) {
    const out = await receive($, text)
    expect(out.consumed).toBeDefined()
    expect(out.text).toBeUndefined()
    await w.clock.settle()
    expect(w.folder.lists).toBe(n + 2)
  }
  // The read re-arms the timer, so the next read comes 30 seconds after it.
  await w.clock.advance(29 * SECOND)
  expect(w.folder.lists).toBe(4)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(5)
})

test('builder\'s message that a status file changed, in the shape a receive hook really gets it, is consumed and reads the folder at once', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  await foreman($)
  expect(w.folder.lists).toBe(1)
  const out = await receive($, CHANGED_AS_RECEIVED)
  expect(out.consumed).toBeDefined()
  expect(out.text).toBeUndefined()
  await w.clock.settle()
  expect(w.folder.lists).toBe(2)
})

test('a peer\'s message that a status file changed is consumed whatever plugin it claims, or with no claim at all', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await foreman($)
  for (const [n, origin] of ([{ kind: 'peer', plugin: 'another' }, { kind: 'peer' }] as SessionReceiveOrigin[]).entries()) {
    expect((await receive($, CHANGED, origin)).consumed).toBeDefined()
    await w.clock.settle()
    expect(w.folder.lists).toBe(n + 2)
  }
})

test('while foreman is off, builder\'s message that a status file changed is consumed and reads nothing', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  const out = await receive($, CHANGED)
  expect(out.consumed).toBeDefined()
  await w.clock.settle()
  await w.clock.advance(5 * MINUTE)
  expect(w.folder.lists).toBe(0)
})

test('a message that a status file changed during a folder read that has not finished reuses that read', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  await foreman($)
  const release = w.folder.hold()
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
  expect((await receive($, CHANGED)).consumed).toBeDefined()
  await w.clock.settle()
  expect(w.folder.lists).toBe(2)
  release()
  await w.clock.settle()
  expect(w.folder.lists).toBe(2)
})

test('a peer\'s question, the marker among other words, two elements and the marker from any origin but a peer pass on unchanged and read nothing', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  await foreman($)
  const element = (body: string) => `<cross-session-message from="local_a" name="example">\n${body}\n</cross-session-message>`
  const passed: [string, SessionReceiveOrigin][] = [
    [SENT, BUILDER],
    [element(`${STATUS_CHANGED_TEXT} Should I merge?`), BUILDER],
    [`${CHANGED_ELEMENT}\n${CHANGED_ELEMENT}`, BUILDER],
    [CHANGED, { kind: 'coordinator', plugin: 'builder' }],
    [CHANGED, { kind: 'peer-send-message' }],
    [CHANGED, { kind: 'bridge' }],
    [CHANGED, { kind: 'unclassified' }],
  ]
  for (const [text, origin] of passed) expect(await receive($, text, origin)).toEqual({ text })
  await w.clock.settle()
  expect(w.folder.lists).toBe(1)
})

test('with no message at all, the timer reads the folder 30 seconds on while a sub session works, and 2 minutes on once none does', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
  w.folder.put('a.json', record('ABC-1', 'idle'))
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(3)
  await w.clock.advance(2 * MINUTE - SECOND)
  expect(w.folder.lists).toBe(3)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(4)
})

// The pane's line that counts the status messages consumed since the hooks
// loaded, and the copy of the count in the store.
const MARKERS_HEAD = 'Status messages consumed since '
const markersCopy = (w: ReturnType<typeof world>) => w.stored.get(markersKey('session-1'))
const DAY = 24 * 60 * MINUTE

test('before any message the pane\'s count says none yet, and each consumed message raises the count and shows the newest time after the load time', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:00:00 UTC: none yet'])
  await w.clock.advance(5 * MINUTE)
  expect((await receive($, CHANGED)).consumed).toBeDefined()
  await w.clock.settle()
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:00:00 UTC: 1, last at 12:05:00 UTC'])
  await w.clock.advance(2 * MINUTE)
  expect((await receive($, CHANGED_AS_RECEIVED)).consumed).toBeDefined()
  await w.clock.settle()
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:00:00 UTC: 2, last at 12:07:00 UTC'])
})

test('only the first message consumed since the hooks loaded adds a line to the log, and a reload lets a new first line be logged', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  const firstLines = async () => (await linesOf(ui, '\\d\\d:\\d\\d:\\d\\d ')).filter(line => line.includes(FIRST_MARKER_LOG))
  for (const _ of [1, 2, 3]) {
    await w.clock.advance(MINUTE)
    await receive($, CHANGED)
    await w.clock.settle()
  }
  expect(await firstLines()).toEqual([`12:01:00 ${FIRST_MARKER_LOG}`])
  await w.clock.advance(MINUTE)
  await start($)
  await w.clock.settle()
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:04:00 UTC: none yet'])
  await w.clock.advance(MINUTE)
  await receive($, CHANGED)
  await w.clock.settle()
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:04:00 UTC: 1, last at 12:05:00 UTC'])
  // The log counts a line the same as the newest one on that line, so the
  // second load's first line shows as the first one logged twice.
  expect(await firstLines()).toEqual([`12:05:00 ${FIRST_MARKER_LOG} (2 times)`])
})

test('the count is copied under the parent\'s session id when the role is turned on and after each message, and a session that is not a parent writes no copy when it starts', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(w.store.writes.get(markersKey('session-1'))).toBeUndefined()
  await w.clock.advance(MINUTE)
  await foreman($)
  await w.clock.settle()
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 0, first: null, last: null })
  await w.clock.advance(MINUTE)
  await receive($, CHANGED)
  await w.clock.settle()
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 1, first: T0 + 2 * MINUTE, last: T0 + 2 * MINUTE })
})

test('turning the role on opens the pane without waiting for the copy of the count, which lands once the store answers', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  let release = () => {}
  w.store.held.set(markersKey('session-1'), new Promise<void>(resolve => { release = resolve }))
  const answer = await foreman($)
  expect(answer.text).toBe('This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(w.panes).toEqual(['foreman'])
  expect(w.store.writes.get(markersKey('session-1'))).toBeUndefined()
  release()
  await w.clock.settle()
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 0, first: null, last: null })
})

test('a parent that starts again writes a fresh copy of its count at once', async ($, on) => {
  const old = { version: 1, sessionId: 'session-1', since: T0 - DAY, consumed: 4, first: T0 - DAY, last: T0 - MINUTE }
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: null }, [markersKey('session-1')]: old } })
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 0, first: null, last: null })
})

test('a stored copy that a newer load wrote is not overwritten', async ($, on) => {
  const newer = { version: 1, sessionId: 'session-1', since: T0 + MINUTE, consumed: 0, first: null, last: null }
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: null }, [markersKey('session-1')]: newer } })
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(w.store.writes.get(markersKey('session-1'))).toBeUndefined()
  expect(markersCopy(w)).toEqual(newer)
})

test('a change of the session id within one load starts a fresh count under the new id, and the first message is still logged only once', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  const firstLines = async () => (await linesOf(ui, '\\d\\d:\\d\\d:\\d\\d ')).filter(line => line.includes(FIRST_MARKER_LOG))
  await w.clock.advance(MINUTE)
  await receive($, CHANGED)
  await w.clock.settle()
  w.engine.sessionId = 'session-2'
  await w.clock.advance(MINUTE)
  await receive($, CHANGED)
  await w.clock.settle()
  expect(await firstLines()).toEqual([`12:01:00 ${FIRST_MARKER_LOG}`])
  expect(w.stored.get(markersKey('session-2'))).toEqual({ version: 1, sessionId: 'session-2', since: T0 + 2 * MINUTE, consumed: 1, first: T0 + 2 * MINUTE, last: T0 + 2 * MINUTE })
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 1, first: T0 + MINUTE, last: T0 + MINUTE })
})

test('a copy that the hooks from before a reload wrote over this load\'s copy is written again by this load\'s next copy, though the count is unchanged', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: null } } })
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  const ours = markersCopy(w)
  expect(ours).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 0, first: null, last: null })
  w.stored.set(markersKey('session-1'), { version: 1, sessionId: 'session-1', since: T0 - DAY, consumed: 2, first: T0 - DAY, last: T0 - MINUTE })
  await foreman($)
  await w.clock.settle()
  expect(markersCopy(w)).toEqual(ours)
})

test('when the hooks load, a copy whose newest time is 15 days old and a damaged one are deleted, and one 13 days old is kept', async ($, on) => {
  const copy = (id: string, since: number, last: number | null) => ({ version: 1, sessionId: id, since, consumed: last === null ? 0 : 1, first: last, last })
  const w = world(on, { store: {
    [markersKey('old')]: copy('old', T0 - 20 * DAY, T0 - 15 * DAY),
    [markersKey('quiet')]: copy('quiet', T0 - 15 * DAY, null),
    [markersKey('recent')]: copy('recent', T0 - 20 * DAY, T0 - 13 * DAY),
    [markersKey('damaged')]: { version: 1, sessionId: 'damaged', since: 'yesterday' },
    [markersKey('other')]: copy('someone-else', T0, null),
    'usage:old': { at: T0 - 20 * DAY },
  } })
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect([...w.store.deleted].sort()).toEqual([markersKey('damaged'), markersKey('old'), markersKey('other'), markersKey('quiet')])
  expect(w.stored.has(markersKey('recent'))).toBe(true)
  expect(w.stored.has('usage:old')).toBe(true)
})

test('with the copy refused and the log write denied, a message is still consumed, the folder is still read once and the pane still counts', async ($, on) => {
  const w = world(on)
  w.folder.put('a.json', record('ABC-1', 'working'))
  let deniesLog = false
  on('state.set', ($, e, next) => (deniesLog && e.plugin === 'foreman' && e.key === 'log' ? { deny: 'refused' } as never : next(e)))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  expect(w.folder.lists).toBe(1)
  w.store.refused.add(markersKey('session-1'))
  deniesLog = true
  const writes = w.store.writes.get(markersKey('session-1')) ?? 0
  const out = await receive($, CHANGED)
  expect(out.consumed).toBeDefined()
  expect(out.text).toBeUndefined()
  await w.clock.settle()
  expect(w.folder.lists).toBe(2)
  expect(w.store.writes.get(markersKey('session-1'))).toBe(writes + 1)
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:00:00 UTC: 1, last at 12:00:00 UTC'])
})

test('deliveries that pass on change no count', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  const element = (body: string) => `<cross-session-message from="local_a" name="example">\n${body}\n</cross-session-message>`
  for (const [text, origin] of [
    [SENT, BUILDER],
    [element(`${STATUS_CHANGED_TEXT} Should I merge?`), BUILDER],
    [CHANGED, { kind: 'coordinator', plugin: 'builder' }],
    [CHANGED, { kind: 'bridge' }],
  ] as [string, SessionReceiveOrigin][]) expect(await receive($, text, origin)).toEqual({ text })
  await w.clock.settle()
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual(['Status messages consumed since 12:00:00 UTC: none yet'])
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 0, first: null, last: null })
  expect((await linesOf(ui, '\\d\\d:\\d\\d:\\d\\d ')).filter(line => line.includes(FIRST_MARKER_LOG))).toEqual([])
})

test('a message consumed while foreman is off is counted and copied, and the pane draws no count', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.advance(MINUTE)
  expect((await receive($, CHANGED)).consumed).toBeDefined()
  await w.clock.settle()
  expect(markersCopy(w)).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 1, first: T0 + MINUTE, last: T0 + MINUTE })
  expect(await linesOf(ui, MARKERS_HEAD)).toEqual([])
  expect(await ui.paneText()).toContain('This session is not a parent.')
})

// The top-up line and the start-foreman skill's text.

type Submitted = { text?: string; context?: readonly string[] }
const typed = ($: Engine, text: string, over: Record<string, unknown> = {}) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...over } as never) as Promise<Submitted>

// A parent whose role is on with `slots` slots and `pairings` in its ledger,
// and `held` keys held, started and mounted.
// The desktop app lists the session of each pairing that has one, so no read
// takes a waiting sub session for one the person deleted.
async function parentFor($: Engine, on: On, slots: number, pairings: ReturnType<typeof newPairing>[] = [], held: string[] = []) {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, pairings, held } } })
  w.desktop.sessions = pairings.flatMap(p => (p.localId === null ? [] : [{ sessionId: p.localId, cwd: '/w', title: `${p.issueKey}: short`, isRunning: false }]))
  await mountBoth($, on)
  await start($)
  await w.clock.settle()
  return w
}

// A start that went ahead and has no status file yet, and a sub session that
// waits at `place`.
const wentAhead = (key: string) => newPairing(`ft-${key}`, null, T0, key)
const waitsAt = (key: string, place: number) => newPairing(`ft-${key}`, `local_${key}`, T0, key, { place, claim: null })

test('a prompt the person typed while foreman is on carries the top-up line with the gap to one waiting sub session per slot, after any context it came with', async ($, on) => {
  const w = await parentFor($, on, 2, [wentAhead('ABC-1')])
  for (const kind of ['sdk', 'composer', 'bridge']) {
    const out = await typed($, 'go on', { origin: { kind } })
    expect([kind, out.text, out.context]).toEqual([kind, 'go on', [topUpLine(3)]])
  }
  expect((await typed($, 'go on', { context: ['from another hook'] })).context).toEqual(['from another hook', topUpLine(3)])
  expect(w.engine.contexts.at(-1)).toEqual(['from another hook', topUpLine(3)])
})

test('the top-up line asks for at most five starts', async ($, on) => {
  await parentFor($, on, 4)
  expect((await typed($, 'go on')).context).toEqual([topUpLine(5)])
})

test('the top-up line comes after the held line', async ($, on) => {
  await parentFor($, on, 1, [], ['ABC-7'])
  expect((await typed($, 'go on')).context).toEqual([heldLine(['ABC-7']), topUpLine(2)])
})

test('with one busy and one waiting sub session per slot, a typed prompt gets no top-up line', async ($, on) => {
  const w = await parentFor($, on, 1, [wentAhead('ABC-1'), waitsAt('ABC-2', 1)])
  expect(await typed($, 'go on')).toEqual({ text: 'go on' })
  expect(w.engine.contexts.at(-1)).toBeUndefined()
})

test('a plugin\'s prompt, a prompt typed while a turn runs and the prompt of a typed /start-foreman get no top-up line', async ($, on) => {
  const w = await parentFor($, on, 2)
  await typed($, 'foreman: a line', { origin: { kind: 'plugin', name: 'foreman' } })
  await typed($, 'go on', { turnId: 't1' })
  await typed($, '/start-foreman', { command: { name: 'start-foreman', args: '' } })
  await typed($, '/start-foreman 3')
  await typed($, '  /start-foreman')
  expect(w.engine.contexts).toEqual([undefined, undefined, undefined, undefined, undefined])
})

test('with the role off, a typed prompt gets no top-up line', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  expect(await typed($, 'go on')).toEqual({ text: 'go on' })
  expect(w.engine.contexts).toEqual([undefined])
})

// The body of skills/start-foreman/SKILL.md under its heading, which the engine
// expands for the model. The testing kit refuses a file outside the mod's
// folder, so it is copied here; a change to the skill's text belongs here too.
const SKILL_BODY = `# Start foreman

The foreman mod answers \`/start-foreman\` itself, so while the mod is loaded
the model never reads this text. Reading it means the foreman mod is not
loaded in this session, and nothing has happened.

Tell the person, in plain sentences, that the foreman mod is not loaded, so
this session did not become the parent. Then tell them how to load it: install
the \`foreman\` mod together with the \`builder\` mod it depends on, as foreman's
README says, and start a new session. Do nothing else. In particular, do not
start sub sessions, do not try to do foreman's work by hand, and do not act on
any words the person typed after the command. Tell them to send those words
again once the mod is loaded.`

const skillText = async ($: Engine) => (await $.skill.prompt({ skill: 'start-foreman', text: SKILL_BODY } as never)).text

test('a plain /start-foreman or one with only a count goes on to the engine, so the model reads the skill on the person\'s turn, and foreman still answers', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  expect((await foreman($)).text).toBe('This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.')
  expect((await foreman($, '3')).text).toBe('This parent now runs 3 sub sessions at once.')
  expect(w.engine.commands).toEqual([{ command: 'start-foreman', args: '' }, { command: 'start-foreman', args: '3' }])
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: 3 })
})

test('/start-foreman with words after it, or with a refused count, does not go on to the engine', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await foreman($, 'start the next issue')
  await foreman($, '0')
  await foreman($, '2 start two issues')
  await w.clock.settle()
  expect(w.engine.commands).toEqual([])
})

test('the skill\'s text is replaced with the top-up count from the live ledger for every count from 0 to 5, and never says the mod is not loaded', async ($, on) => {
  const w = world(on)
  w.engine.startAnswers = ['Started the session local_new1 (name: example).', 'Started the session local_new2 (name: example).']
  await mountBoth($, on)
  await start($)
  const seen: number[] = []
  const expectCount = async (n: number) => {
    const text = await skillText($)
    expect(text).toBe(startForemanText(n))
    expect(text).not.toContain('not loaded')
    seen.push(n)
  }
  const startOne = (key: string) => $.tool.call({ tool: 'mcp__ccd_session__start_session', prompt: `/implement ${key}`, context: 'fresh', title: `${key}: short` } as never)
  await foreman($, '3')
  await expectCount(5)
  await foreman($, '2')
  await expectCount(4)
  await foreman($, '1')
  await expectCount(2)
  await foreman($, '2')
  await startOne('ABC-1')
  await expectCount(3)
  await foreman($, '1')
  await expectCount(1)
  await startOne('ABC-2')
  await expectCount(0)
  expect(seen.sort()).toEqual([0, 1, 2, 3, 4, 5])
  // Foreman answered every expansion itself, so the skill's own text never
  // reached the engine beneath it.
  expect(w.engine.skills).toEqual([])
})

test('with foreman off, the skill\'s text is the fixed text that says foreman did not turn on', async ($, on) => {
  world(on)
  await mountBoth($, on)
  await start($)
  const text = await skillText($)
  expect(text).toBe(START_FOREMAN_OFF)
  expect(text).not.toContain('not loaded')
})

test('when the ledger read throws, the skill\'s text is the fixed fallback and never the skill\'s own', async ($, on) => {
  const w = world(on)
  let fails = false
  on('state.get', ($, e, next) => (fails && e.plugin === 'foreman' && e.key === 'tickets' ? { deny: 'the state is gone' } as never : next(e)))
  await mountBoth($, on)
  await start($)
  await foreman($)
  fails = true
  const text = await skillText($)
  expect(text).toBe(START_FOREMAN_FALLBACK)
  expect(text).not.toContain('not loaded')
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: null })
})

// A parent with `slots` slots, `pairings` in its ledger, and the status files
// `files`, each paired with it as builder's sub sessions would be. The desktop
// app lists the session of each pairing and each file that has a desktop
// session id, so no read takes one of them for a session the person deleted.
async function queueParent($: Engine, on: On, slots: number, pairings: ReturnType<typeof newPairing>[], files: Record<string, string> = {}, surface: 'terminal' | 'desktop' = 'terminal') {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, pairings } } })
  for (const [name, text] of Object.entries(files)) w.folder.put(name, text)
  w.desktop.sessions = pairings.flatMap(p => (p.localId === null ? [] : [{ sessionId: p.localId, cwd: '/w', title: `${p.issueKey}: short`, isRunning: false }]))
  for (const text of Object.values(files)) {
    const { desktopSessionId, issueKey } = JSON.parse(text) as { desktopSessionId?: string; issueKey: string }
    if (desktopSessionId !== undefined) w.desktop.sessions.push({ sessionId: desktopSessionId, cwd: '/w', title: `${issueKey}: short`, isRunning: true })
  }
  const ui = await mountBoth($, on, surface)
  await start($)
  await foreman($)
  await w.clock.settle()
  return { w, ui }
}

// A sub session that waits at `place`, paired `ago` before T0.
const waitsSince = (key: string, place: number, ago: number) => newPairing(`ft-${key}`, `local_${key}`, T0 - ago, key, { place, claim: null })
const busyBuild = (key: string) => record(key, 'working', { stage: 'build', desktopSessionId: `local_${key}` })
const EMPTY_QUEUE = 'Queued: none — your next message lines up more'

test('the band counts the sub sessions that wait right after its head, before the chips', async ($, on) => {
  const { ui } = await queueParent($, on, 1, [waitsAt('ABC-2', 1), waitsAt('ABC-3', 2)], { 'a.json': busyBuild('ABC-1') })
  expect(await ui.bandText()).toStartWith('foreman: 1 of 1 slots busy · 2 queued · ABC-1 build · next read in ')
  const queue = await ui.band.find({ type: 'Text', text: '2 queued' })
  expect(queue).toBeDefined()
  expect(queue?.props.color).toBeUndefined()
})

test('with no sub session shown, the band counts the ones that wait before the line that says there are none', async ($, on) => {
  const { ui } = await queueParent($, on, 1, [wentAhead('ABC-1'), waitsAt('ABC-2', 1)])
  expect(await ui.bandText()).toStartWith('foreman: 0 of 1 slots busy · 1 queued · no sub sessions · next read in ')
})

for (const surface of SURFACES) {
  test(`on the ${surface}, a free slot with nobody waiting draws queue empty in the warning color right after the head`, async ($, on) => {
    const { ui } = await queueParent($, on, 2, [], { 'a.json': busyBuild('ABC-1') }, surface)
    expect(await ui.bandText()).toStartWith('foreman: 1 of 2 slots busy · queue empty · ABC-1 build · next read in ')
    const queue = await ui.band.find({ type: 'Text', text: 'queue empty' })
    expect(queue).toBeDefined()
    expect(queue?.props.color).toBe('warning')
  })
}

test('the free slots foreman counts, not the busy rows, decide the queue empty mark', async ($, on) => {
  // A start that went ahead and has written no status file yet shows no row,
  // so the head counts 0 of 1 slots busy, but it holds the slot, so no slot is
  // free and the band draws nothing about the queue.
  const { ui } = await queueParent($, on, 1, [wentAhead('ABC-1')])
  const band = await ui.bandText()
  expect(band).toStartWith('foreman: 0 of 1 slots busy · no sub sessions · next read in ')
  expect(band).not.toContain('queue')
})

test('the queue count takes its columns from the room the chips get, so the band never runs past its width', async ($, on) => {
  const files = Object.fromEntries([1, 2, 3, 4, 5].map(n => [`${n}.json`, record(`ABC-${n}`, 'idle')]))
  await queueParent($, on, 5, [waitsAt('ABC-6', 1), waitsAt('ABC-7', 2)], files)
  for (let columns = 70; columns <= 120; columns++) {
    const band = await $.ui.mount({ plugin: 'foreman', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: columns } as never })
    const text = (await band.find({ key: 'foreman-band' }))?.text ?? ''
    expect(text).toStartWith('foreman: 5 of 5 slots busy · 2 queued · ')
    expect([columns, text.length <= columns]).toEqual([columns, true])
  }
})

test('the pane lists the sub sessions that wait under the busy rows, in the order they begin, each with its place, its name and how long it has waited', async ($, on) => {
  // The pairings are stored out of order. A start answered with a proposal
  // card more than five minutes ago has no session and is not shown.
  const card = newPairing('ft-card', null, T0 - 10 * MINUTE, 'ABC-9', { place: 4, claim: null })
  const noKey = newPairing('ft-nokey', 'local_nokey', T0, null, { place: 3, claim: null })
  const { ui } = await queueParent($, on, 1, [waitsSince('ABC-3', 2, 70 * MINUTE), card, noKey, waitsSince('ABC-2', 1, 5 * MINUTE)], { 'a.json': busyBuild('ABC-1') })
  expect(await ui.bandText()).toStartWith('foreman: 1 of 1 slots busy · 3 queued · ')
  expect((await ui.pane.find({ type: 'Text', text: /^Queued$/ }))?.props.bold).toBe(true)
  expect((await ui.pane.find({ key: 'queued-ft-ABC-2' }))?.text).toBe('1. → ABC-2 · waiting for 5m')
  expect((await ui.pane.find({ key: 'queued-ft-ABC-3' }))?.text).toBe('2. → ABC-3 · waiting for 1h 10m')
  expect((await ui.pane.find({ key: 'queued-ft-nokey' }))?.text).toBe('3. → the sub session with ticket ft-nokey · waiting for 0m')
  expect(await ui.pane.find({ key: 'queued-ft-card' })).toBeUndefined()
  const pane = await ui.paneText()
  const at = (part: string) => pane.indexOf(part)
  for (const part of ['Release', 'Queued', '1. → ABC-2', '2. → ABC-3', '3. → the sub session', 'Sub sessions spent']) expect(at(part)).toBeGreaterThan(-1)
  expect(at('Release')).toBeLessThan(at('Queued'))
  expect(at('Queued')).toBeLessThan(at('1. → ABC-2'))
  expect(at('1. → ABC-2')).toBeLessThan(at('2. → ABC-3'))
  expect(at('2. → ABC-3')).toBeLessThan(at('3. → the sub session'))
  expect(at('3. → the sub session')).toBeLessThan(at('Sub sessions spent'))
  expect(pane).not.toContain(EMPTY_QUEUE)
})

test('with nobody waiting, the pane\'s Queued section is one line that says the next message lines up more', async ($, on) => {
  const { ui } = await queueParent($, on, 2, [], { 'a.json': busyBuild('ABC-1') })
  expect((await ui.pane.findAll({ type: 'Text', text: EMPTY_QUEUE }))).toHaveLength(1)
  expect(await ui.pane.find({ type: 'Text', text: /^Queued$/ })).toBeUndefined()
  const pane = await ui.paneText()
  expect(pane.indexOf('Release')).toBeLessThan(pane.indexOf(EMPTY_QUEUE))
  expect(pane.indexOf(EMPTY_QUEUE)).toBeLessThan(pane.indexOf('Sub sessions spent'))
})

test('while foreman is off, neither the band nor the pane says anything about the queue', async ($, on) => {
  const w = world(on, { store: { [ticketsKey('session-1')]: { ...TICKETS_EMPTY, pairings: [waitsAt('ABC-2', 1)] } } })
  w.desktop.sessions = [{ sessionId: 'local_ABC-2', cwd: '/w', title: 'ABC-2: short', isRunning: false }]
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect(await ui.bandText()).toBe('')
  const pane = await ui.paneText()
  expect(pane).not.toContain('Queued')
  expect(await ui.pane.find({ key: 'queued-ft-ABC-2' })).toBeUndefined()
})
