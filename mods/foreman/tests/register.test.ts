import { expect, test } from 'claude-code/testing'
import type { On, SessionReceiveOrigin } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { REASONS } from '../hooks/desktop'
import { STATUS_CHANGED_TEXT } from '../hooks/notes'
import { ticketsIn, ticketsKey, TICKETS_EMPTY } from '../hooks/tickets'
import { CHANGED, CHANGED_ELEMENT, foreman, HOME, MINUTE, SECOND, SECRET, SURFACES, T0, leftInState, mountBoth, record, SENT, start, statusFolder, world } from './world'

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

  test(`on the ${surface}, an empty folder says there are no sub sessions`, async ($, on) => {
    const w = world(on)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    expect(await ui.bandText()).toBe('foreman: 0 of 2 slots busy · no sub sessions · next read in 2m')
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
