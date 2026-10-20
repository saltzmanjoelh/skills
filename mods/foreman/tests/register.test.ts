import { expect, mock, test } from 'claude-code/testing'
import type { McpToolResult, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { REASONS } from '../hooks/desktop'

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOME = '/home/me'
const FOLDER = `${HOME}/.claude/foreman/builds`
const SECRET = 'SECRET-ERROR-TEXT'
const SURFACES = ['terminal', 'desktop'] as const

// A status record as builder writes it, with `over` changing its fields.
const record = (issueKey: string | null, state: string, over: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: `s-${issueKey}`, ticket: null, cwd: `/work/${issueKey}`, issueKey, issueTitle: `Title of ${issueKey}`,
  stage: null, stageDone: 0, pr: null, state, reason: '', stateSince: T0, writtenAt: T0, ...over,
})

// The status folder, answered from memory: each file's text and modification
// time, whether the folder exists, and a refusal every listing meets when
// `listFails` is set. It counts the listings and the reads.
function statusFolder(on: On, at = FOLDER) {
  const w = {
    files: new Map<string, { text: string; mtimeMs: number }>(),
    exists: true,
    listFails: null as string | null,
    lists: 0,
    reads: 0,
    put(name: string, text: string, mtimeMs = T0) {
      w.files.set(name, { text, mtimeMs })
    },
  }
  on('fs.list', ($, e) => {
    w.lists += 1
    if (w.listFails !== null) return { deny: w.listFails }
    if (!w.exists || e.path !== at) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: [...w.files].map(([name, f]) => ({ name, kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })) }
  })
  on('fs.exists', ($, e) => ({ value: w.exists && e.path === at }))
  on('fs.read', ($, e) => {
    w.reads += 1
    const f = e.path.startsWith(`${at}/`) ? w.files.get(e.path.slice(at.length + 1)) : undefined
    return f === undefined ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: f.text }
  })
  return w
}

// The desktop app's tools, answered from a script, recording each call.
// `list` and `open` say how list_sessions and open_session_in answer:
// normally, with an error that has text or none, with text that is not a
// list, or not at all, as a server that is not connected does.
function desktopApp(on: On) {
  const d = {
    calls: [] as { server: string; tool: string; args: Record<string, unknown> }[],
    sessions: [] as { sessionId: string; cwd: string }[],
    list: 'ok' as 'ok' | 'error' | 'garbage' | 'not-connected',
    open: 'ok' as 'ok' | 'error' | 'error-empty' | 'not-connected',
  }
  const answer = (result: McpToolResult) => ({ value: result })
  on('mcp.call', ($, e) => {
    d.calls.push({ server: e.server, tool: e.tool, args: e.args })
    const how = e.tool === 'list_sessions' ? d.list : d.open
    if (how === 'not-connected') return { deny: `${SECRET}: server ${e.server} is not connected` }
    if (how === 'error') return answer({ content: [{ type: 'text', text: SECRET }], isError: true })
    if (how === 'error-empty') return answer({ content: [], isError: true })
    if (how === 'garbage') return answer({ content: [{ type: 'text', text: SECRET }], isError: false })
    if (e.tool === 'list_sessions') return answer({ content: [{ type: 'text', text: JSON.stringify(d.sessions) }], isError: false })
    return answer({ content: [{ type: 'text', text: 'Opened in split view.' }], isError: false })
  })
  return d
}

// What the engine answers beneath the mod in a session.
function engine(on: On) {
  const toasts: string[] = []
  const panes: string[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('command.run', () => ({ text: '' }))
  on('ui.open', ($, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } as never }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { toasts, panes }
}

// The usual world: the clock at T0, a store in memory that the test can read,
// empty unless one is given, HOME set, the folder, the desktop app and the
// engine.
function world(on: On, options: { store?: Record<string, unknown>; env?: Record<string, string>; at?: string } = {}) {
  const clock = mock.clock(on, { now: T0 })
  const stored = new Map<string, unknown>(Object.entries(options.store ?? {}))
  on('store.get', ($, e) => ({ value: stored.get(e.key) }))
  on('store.set', ($, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  mock.env(on, options.env ?? { HOME })
  const folder = statusFolder(on, options.at)
  const desktop = desktopApp(on)
  const { toasts, panes } = engine(on)
  return { clock, folder, desktop, toasts, panes, stored }
}

// Stands in for what the mod left in $.state before a reload, as builder's
// tests do: the test answers the mod's reads of these keys until the mod
// writes one. A test's first call on `$` starts the module afresh, so seeding
// these and then raising an event runs the path a reload takes.
function leftInState(on: On, seeded: Record<string, unknown>) {
  const left = new Map(Object.entries(seeded))
  on('state.get', ($, e, next) => {
    if (e.plugin !== 'foreman' || !left.has(e.key)) return next(e)
    return { value: { value: left.get(e.key), version: 0 } } as never
  })
  on('state.set', ($, e, next) => {
    if (e.plugin === 'foreman') left.delete(e.key)
    return next(e)
  })
}

// Mounts the band and the pane on a surface. The host draws its own line when
// the mod passes the band on. Called after the test's other hooks, since it
// is the first call on `$`. Each read draws again, so a relative time is read
// as of now.
async function mountBoth($: Engine, on: On, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 200) {
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const band = await $.ui.mount({ plugin: 'foreman', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns } as never })
  const pane = await $.ui.mount({ plugin: 'foreman', surface, component: 'Pane', requestId: 'foreman', props: { bodyColumns } as never })
  return {
    band,
    pane,
    bandText: async () => {
      await band.redraw()
      return (await band.find({ key: 'foreman-band' }))?.text ?? ''
    },
    paneText: async () => {
      await pane.redraw()
      return (await pane.find({ key: 'foreman-pane' }))?.text ?? ''
    },
    newestLog: async () => {
      await pane.redraw()
      return (await pane.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d / })).at(-1)?.text.slice(9) ?? ''
    },
  }
}

const start = ($: Engine) => $.session.start({ cwd: '/work/parent', surface: null, isInteractive: true })
const foreman = ($: Engine, args = '') => $.command.run({ command: 'foreman', args } as never) as Promise<{ text: string }>

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
  expect(await ui.newestLog()).toBe('Opened ABC-1 beside this session.')
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
  for (const [key, line, arrange] of cases) {
    arrange()
    const before = w.toasts.length
    await ui.pane.press({ key })
    expect(w.toasts.length).toBe(before + 1)
    expect(w.toasts.at(-1)).toBe(line)
    expect(await ui.newestLog()).toBe(line)
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
  leftInState(on, { parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 - SECOND, readAt: T0 - 31 * SECOND })
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
  leftInState(on, { parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 - SECOND, readAt: T0 - 31 * SECOND })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  const passed = await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'person' } } as never)
  expect((passed as { text: string }).text).toBe('next')
  await w.clock.settle()
  expect(w.folder.lists).toBe(1)
  await w.clock.advance(30 * SECOND)
  expect(w.folder.lists).toBe(2)
})

test('after a reload whose read is not yet due, the end of a turn arms the timer for the saved time', async ($, on) => {
  const w = world(on)
  leftInState(on, { parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 + 20 * SECOND, readAt: T0 - 100 * SECOND })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await w.clock.advance(19 * SECOND)
  expect(w.folder.lists).toBe(0)
  await w.clock.advance(SECOND)
  expect(w.folder.lists).toBe(1)
})

test('after a reload that lost the timer, a /foreman subcommand arms it again', async ($, on) => {
  const w = world(on)
  leftInState(on, { parent: { isOn: true, slots: null, isPaused: false }, nextReadAt: T0 + 20 * SECOND, readAt: T0 - 100 * SECOND })
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

test('a slots or pause command before /foreman is kept and takes effect once the role is on', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($, 'slots 5')
  expect(await ui.bandText()).toBe('')
  expect(w.folder.lists).toBe(0)
  await foreman($)
  expect(await ui.bandText()).toContain('0 of 5 slots busy')
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

test('Nudge and Release each add a line to the log and call nothing', async ($, on) => {
  const w = world(on)
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await ui.pane.press({ key: 'nudge-a.json' })
  expect(await ui.newestLog()).toBe('Nudge pressed for ABC-1; nudging comes in a later step.')
  await ui.pane.press({ key: 'release-b.json' })
  expect(await ui.newestLog()).toBe('Release pressed for ABC-2; releasing comes in a later step.')
  expect(w.desktop.calls).toEqual([])
  expect(w.toasts).toEqual([])
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
