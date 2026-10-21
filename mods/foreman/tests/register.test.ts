import { expect, test } from 'claude-code/testing'

import { REASONS } from '../hooks/desktop'
import { ticketsKey } from '../hooks/tickets'
import { foreman, HOME, MINUTE, SECOND, SECRET, SURFACES, T0, leftInState, mountBoth, record, start, statusFolder, world } from './world'

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

test('a session that never ran /foreman draws no band of its own and reads no file', async ($, on) => {
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

test('/foreman turns the role on, opens the pane and keeps the role in the store under the session id', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  const answer = await foreman($)
  expect(answer.text).toBe('This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: null, isPaused: false })
  expect(w.panes).toEqual(['foreman'])
  expect(w.folder.lists).toBe(1)
})

test('a session whose stored role is on draws the band and reads the folder at its start, and reads again 30 seconds on', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 3, isPaused: false } } })
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
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 - SECOND, readAt: T0 - 31 * SECOND })
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
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 - SECOND, readAt: T0 - 31 * SECOND })
  const passed = await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'person' } } as never)
  expect((passed as { text: string }).text).toBe('next')
  await w.clock.settle()
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
})

test('after a reload whose read is not yet due, the end of a turn arms the timer for the saved time', async ($, on) => {
  const w = world(on)
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 + 20 * SECOND, readAt: T0 - 100 * SECOND })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await w.clock.advance(19 * SECOND)
  expect(w.folder.lists).toBe(0)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(1)
})

test('after a reload that lost the timer, a /foreman subcommand arms it again', async ($, on) => {
  const w = world(on)
  leftInState(on, { tickets: w.stored.get(ticketsKey('session-1')), parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 + 20 * SECOND, readAt: T0 - 100 * SECOND })
  await foreman($, 'pause')
  await w.clock.advance(19 * SECOND)
  expect(w.folder.lists).toBe(0)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(1)
})

test('/foreman slots sets the count, a count outside 1 to 20 is refused and changes nothing, and pause adds paused until resume', async ($, on) => {
  world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect((await foreman($, 'slots 1')).text).toBe('This parent now runs 1 sub session at once.')
  expect((await foreman($, 'slots 3')).text).toBe('This parent now runs 3 sub sessions at once.')
  expect(await ui.bandText()).toContain('0 of 3 slots busy')
  for (const bad of ['slots 0', 'slots 2.5', 'slots x']) {
    expect((await foreman($, bad)).text).toContain('from 1 to 20')
    expect(await ui.bandText()).toContain('0 of 3 slots busy')
  }
  expect((await foreman($, 'slots')).text).toContain('Use /foreman')
  expect((await foreman($, 'pause')).text).toBe('This parent is paused.')
  expect(await ui.bandText()).toContain('foreman: 0 of 3 slots busy · paused · ')
  expect((await foreman($, 'resume')).text).toBe('This parent is no longer paused.')
  expect(await ui.bandText()).not.toContain('paused')
})

test('/foreman slots before /foreman makes the session the parent with that count, reads the folder and opens the pane', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  const answer = await foreman($, 'slots 5')
  expect(answer.text).toBe('This session is now the parent and runs 5 sub sessions at once, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(await ui.bandText()).toContain('0 of 5 slots busy')
  expect(w.folder.lists).toBe(1)
  expect(w.panes).toEqual(['foreman'])
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: 5, isPaused: false })
})

test('a pause or a resume before /foreman is kept, says it waits for /foreman, and leaves the role off', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  expect((await foreman($, 'pause')).text).toBe('The pause is kept. This session is not the parent yet, so it takes effect once /foreman makes it one.')
  expect(await ui.bandText()).toBe('')
  expect(w.folder.lists).toBe(0)
  expect(w.panes).toEqual([])
  await foreman($)
  expect(await ui.bandText()).toContain('paused')
})

test('a resume before /foreman clears a kept pause and says it waits for /foreman', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: false, slots: null, isPaused: true } } })
  const ui = await mountBoth($, on)
  await start($)
  expect((await foreman($, 'resume')).text).toBe('The pause is cleared. This session is not the parent yet, so it takes effect once /foreman makes it one.')
  expect(w.folder.lists).toBe(0)
  await foreman($)
  expect(await ui.bandText()).not.toContain('paused')
})

test('slots and pause stored before /foreman survive a resume, and /foreman then keeps them in the band and the store', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: false, slots: 3, isPaused: true } } })
  const ui = await mountBoth($, on)
  await start($)
  expect(w.folder.lists).toBe(0)
  await foreman($)
  const band = await ui.bandText()
  expect(band).toContain('0 of 3 slots busy')
  expect(band).toContain('paused')
  expect(w.stored.get('parent:session-1')).toEqual({ isOn: true, slots: 3, isPaused: true })
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
