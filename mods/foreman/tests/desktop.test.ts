import { expect, test } from 'claude-code/testing'
import type { McpToolResult } from 'claude-code'

import { EVENTS_TOOL, failureLine, linkedFamily, LIST_LIMIT, listSessions, openSession, readHeader, REASONS, type DesktopCall } from '../hooks/desktop'
import { desktopApp, eventsAnswer } from './world'

const SECRET = 'SECRET-ERROR-TEXT'

const text = (value: string): McpToolResult => ({ content: [{ type: 'text', text: value }], isError: false })
const sessions = (list: unknown) => text(JSON.stringify(list))

// A desktop app that answers from a script and records each call.
function desktop(answers: { list?: () => Promise<McpToolResult>; open?: () => Promise<McpToolResult>; events?: () => Promise<McpToolResult> }) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  const call: DesktopCall = async (server, tool, args = {}) => {
    calls.push({ server, tool, args })
    if (tool === 'list_sessions') return (answers.list ?? (async () => sessions([])))()
    if (tool === 'open_session_in') return (answers.open ?? (async () => text('Opened.')))()
    if (tool === 'list_events') return (answers.events ?? (async () => text('Session "t" (idle) — showing 1 of 2 messages')))()
    throw new Error(`unexpected ${server} ${tool}`)
  }
  return { call, calls }
}

test('a record with a desktop session id is opened beside the parent without listing the sessions', async () => {
  const d = desktop({})
  const got = await openSession(d.call, { desktopSessionId: 'local_a', cwd: '/work/a' })
  expect(got).toEqual({ opened: 'local_a' })
  expect(d.calls).toEqual([{ server: 'ccd_window', tool: 'open_session_in', args: { session_id: 'local_a', target: 'split' } }])
})

test('without a desktop session id, the session whose folder matches is opened, a trailing slash included', async () => {
  for (const [cwd, listed] of [['/work/b', '/work/b/'], ['/work/b/', '/work/b']] as const) {
    const d = desktop({ list: async () => sessions([{ sessionId: 'local_x', cwd: '/work/x' }, { sessionId: 'local_b', cwd: listed }]) })
    expect(await openSession(d.call, { cwd })).toEqual({ opened: 'local_b' })
    expect(d.calls.map(c => c.tool)).toEqual(['list_sessions', 'open_session_in'])
    expect(d.calls[0]).toEqual({ server: 'ccd_session_mgmt', tool: 'list_sessions', args: { limit: 100 } })
    expect(d.calls[1]!.args).toEqual({ session_id: 'local_b', target: 'split' })
  }
})

test('each way an open can fail answers its own reason and never the tool\'s own error text', async () => {
  const cases: [string, Parameters<typeof openSession>[1], Parameters<typeof desktop>[0]][] = [
    [REASONS.noAddress, { cwd: null }, {}],
    [REASONS.noSessionInFolder, { cwd: '/work/c' }, { list: async () => sessions([{ sessionId: 'local_x', cwd: '/work/x' }]) }],
    [REASONS.notConnected, { cwd: '/work/c' }, { list: async () => { throw new Error(SECRET) } }],
    [REASONS.notConnected, { desktopSessionId: 'local_c', cwd: null }, { open: async () => { throw new Error(SECRET) } }],
    [REASONS.listRefused, { cwd: '/work/c' }, { list: async () => ({ content: [{ type: 'text', text: SECRET }], isError: true }) }],
    [REASONS.listUnreadable, { cwd: '/work/c' }, { list: async () => text(SECRET) }],
    [REASONS.listUnreadable, { cwd: '/work/c' }, { list: async () => sessions({ sessions: [] }) }],
    [REASONS.listUnreadable, { cwd: '/work/c' }, { list: async () => ({ content: [], isError: false }) }],
    [REASONS.openRefused, { desktopSessionId: 'local_c', cwd: null }, { open: async () => ({ content: [{ type: 'text', text: SECRET }], isError: true }) }],
    [REASONS.openRefused, { desktopSessionId: 'local_c', cwd: null }, { open: async () => ({ content: [], isError: true }) }],
  ]
  for (const [reason, record, answers] of cases) {
    const got = await openSession(desktop(answers).call, record)
    expect(got).toEqual({ reason })
    expect(JSON.stringify(got)).not.toContain(SECRET)
  }
  expect(new Set(Object.values(REASONS)).size).toBe(Object.values(REASONS).length)
})

test('a failed open is one sentence naming the issue and the reason', () => {
  expect(failureLine('ABC-123', REASONS.openRefused)).toBe(`Could not open ABC-123: ${REASONS.openRefused}.`)
})

test('the list of sessions asks for archived ones too, and reads an entry without flags as running and not archived', async () => {
  const d = desktop({
    list: async () => sessions([
      { sessionId: 'local_a', isArchived: true, isRunning: false },
      { sessionId: 'local_b' },
      { sessionId: 7 },
    ]),
  })
  expect(await listSessions(d.call)).toEqual({
    sessions: [
      { sessionId: 'local_a', isArchived: true, isRunning: false, title: null, surelyUnarchived: false },
      { sessionId: 'local_b', isArchived: false, isRunning: true, title: null, surelyUnarchived: false },
    ],
    complete: true,
  })
  expect(d.calls[0]!.args).toEqual({ limit: 100, include_archived: true })
})

test('the list keeps each session\'s title, and is sure a session is not archived only when its flag is exactly false', async () => {
  const d = desktop({
    list: async () => sessions([
      { sessionId: 'local_a', title: 'ABC-1: short', isArchived: false, isRunning: false },
      { sessionId: 'local_b', title: 7, isArchived: 'false' },
      { sessionId: 'local_c', title: 'ABC-3 short', isArchived: null },
    ]),
  })
  const got = await listSessions(d.call)
  expect('sessions' in got ? got.sessions.map(s => [s.sessionId, s.title, s.surelyUnarchived, s.isArchived]) : got).toEqual([
    ['local_a', 'ABC-1: short', true, false],
    ['local_b', null, false, false],
    ['local_c', 'ABC-3 short', false, false],
  ])
})

test('a list that is refused, not connected or not a list answers its own reason and never the tool\'s error text', async () => {
  const refused = desktop({ list: async () => ({ content: [{ type: 'text', text: SECRET }], isError: true }) })
  expect(await listSessions(refused.call)).toEqual({ reason: REASONS.listRefused })
  const gone = desktop({ list: async () => { throw new Error(SECRET) } })
  expect(await listSessions(gone.call)).toEqual({ reason: REASONS.notConnected })
  const garbage = desktop({ list: async () => text(SECRET) })
  expect(await listSessions(garbage.call)).toEqual({ reason: REASONS.listUnreadable })
})

test('a list is complete only when it came back shorter than the most foreman asks for, counting entries it could not read', async () => {
  const of = async (n: number, entry = (i: number) => ({ sessionId: `local_${i}` })) => {
    const got = await listSessions(desktop({ list: async () => sessions(Array.from({ length: n }, (_, i) => entry(i))) }).call)
    return 'complete' in got ? got.complete : got
  }
  expect(await of(LIST_LIMIT - 1)).toBe(true)
  expect(await of(LIST_LIMIT)).toBe(false)
  expect(await of(LIST_LIMIT, i => (i === 0 ? { sessionId: 7 } : { sessionId: `local_${i}` }) as never)).toBe(false)
})

test('the header is read with list_events for the one session, asking for a single event, and is the first line of the first text block', async () => {
  const d = desktop({ events: async () => ({ content: [{ type: 'image', data: '', mimeType: 'image/png' } as never, { type: 'text', text: eventsAnswer('Session "t" (idle) — showing 1 of 1972 messages') }, { type: 'text', text: 'other' }], isError: false }) })
  expect(EVENTS_TOOL).toBe('list_events')
  expect(await readHeader(d.call, 'local_a')).toEqual({ header: 'Session "t" (idle) — showing 1 of 1972 messages' })
  expect(d.calls).toEqual([{ server: 'ccd_session_mgmt', tool: 'list_events', args: { session_id: 'local_a', limit: 1 } }])
})

test('a header read that is refused, not connected or has no text answers its own reason and never the tool\'s error text', async () => {
  const cases: [string, () => Promise<McpToolResult>][] = [
    [REASONS.eventsRefused, async () => ({ content: [{ type: 'text', text: `Session local_a not found. ${SECRET}` }], isError: true })],
    [REASONS.notConnected, async () => { throw new Error(SECRET) }],
    [REASONS.eventsUnreadable, async () => ({ content: [], isError: false })],
    [REASONS.eventsUnreadable, async () => ({ content: [{ type: 'text', text: 7 }], isError: false }) as never],
  ]
  for (const [reason, events] of cases) {
    const got = await readHeader(desktop({ events }).call, 'local_a')
    expect(got).toEqual({ reason })
    expect(JSON.stringify(got)).not.toContain(SECRET)
  }
  expect(new Set(Object.values(REASONS)).size).toBe(Object.values(REASONS).length)
})

test('the linked family asks the list for this session\'s linked sessions, archived ones included, and answers their ids', async () => {
  const d = desktop({ list: async () => sessions([{ sessionId: 'local_a', startedBy: 'local_parent' }, { sessionId: 7 }, null, { sessionId: 'local_b' }]) })
  expect(await linkedFamily(d.call)).toEqual({ ids: ['local_a', 'local_b'], complete: true })
  expect(d.calls).toEqual([{ server: 'ccd_session_mgmt', tool: 'list_sessions', args: { linked: true, limit: LIST_LIMIT, include_archived: true } }])
})

test('a linked family as long as the limit is not complete, entries it could not read included', async () => {
  const full = [...Array.from({ length: LIST_LIMIT - 1 }, (_, i) => ({ sessionId: `local_${i}` })), { sessionId: null }]
  const got = await linkedFamily(desktop({ list: async () => sessions(full) }).call)
  expect('ids' in got && got.ids.length).toBe(LIST_LIMIT - 1)
  expect('ids' in got && got.complete).toBe(false)
})

test('each way the linked family can fail to be read answers its own reason and never the tool\'s own error text', async () => {
  const cases: [string, () => Promise<McpToolResult>][] = [
    [REASONS.notConnected, async () => { throw new Error(SECRET) }],
    [REASONS.listRefused, async () => ({ content: [{ type: 'text', text: SECRET }], isError: true })],
    [REASONS.listUnreadable, async () => text(SECRET)],
    [REASONS.listUnreadable, async () => sessions({ sessions: [] })],
    [REASONS.listUnreadable, async () => ({ content: [], isError: false })],
  ]
  for (const [reason, list] of cases) {
    const got = await linkedFamily(desktop({ list }).call)
    expect(got).toEqual({ reason })
    expect(JSON.stringify(got)).not.toContain(SECRET)
  }
})

// Whether `promise` settles within a few turns of the event loop's microtask
// queue, which a call that hangs never does.
async function settles<T>(promise: Promise<T>): Promise<{ value: T } | 'hung'> {
  const hung = (async () => {
    for (let i = 0; i < 50; i++) await null
    return 'hung' as const
  })()
  return Promise.race([promise.then(value => ({ value })), hung])
}

// The desktop app of the engine tests, driven without the engine: its
// mcp.call hook is called the way the engine calls it, and a deny is thrown as
// the engine's $.mcp.call throws it.
function engineDesktop() {
  let hook: ((e: { server: string; tool: string; args: Record<string, unknown> }) => unknown) | undefined
  const on = ((name: string, handler: ($: unknown, e: never) => unknown) => {
    if (name === 'mcp.call') hook = e => handler(undefined, e as never)
  }) as unknown as Parameters<typeof desktopApp>[0]
  const d = desktopApp(on)
  const call: DesktopCall = async (server, tool, args = {}) => {
    const got = await hook!({ server, tool, args }) as { value?: McpToolResult; deny?: string }
    if (got.deny !== undefined) throw new Error(got.deny)
    return got.value!
  }
  return { d, call }
}

test('the desktop app of the engine tests answers list_events for each session as the test sets it', async () => {
  const { d, call } = engineDesktop()
  d.events.set('local_idle', { state: 'idle' })
  d.events.set('local_old', { state: 'idle', archived: true, title: 'ABC-1: "quoted" (and more)' })
  d.events.set('local_gone', 'not-connected')
  d.events.set('local_bad', 'garbage')
  d.events.set('local_hang', 'hang')
  d.events.set('local_err', 'error')
  expect(await readHeader(call, 'local_idle')).toEqual({ header: 'Session "example" (idle) — showing 1 of 1972 messages' })
  expect(await readHeader(call, 'local_old')).toEqual({ header: 'Session "ABC-1: "quoted" (and more)" (idle, archived) — showing 1 of 1972 messages' })
  expect(await readHeader(call, 'local_gone')).toEqual({ reason: REASONS.notConnected })
  expect(await readHeader(call, 'local_bad')).toEqual({ header: SECRET })
  expect(await readHeader(call, 'local_err')).toEqual({ reason: REASONS.eventsRefused })
  expect(await readHeader(call, 'local_unknown')).toEqual({ reason: REASONS.eventsRefused })
  expect(await settles(readHeader(call, 'local_hang'))).toBe('hung')
  expect(d.calls.filter(c => c.tool === 'list_events').map(c => c.args.session_id))
    .toEqual(['local_idle', 'local_old', 'local_gone', 'local_bad', 'local_err', 'local_unknown', 'local_hang'])
})

test('the list_events answer of the engine tests holds the paging line, the warning and an empty body below its header', async () => {
  const { d, call } = engineDesktop()
  d.events.set('local_a', { state: 'idle' })
  const got = await call('ccd_session_mgmt', 'list_events', { session_id: 'local_a', limit: 1 })
  const lines = (got.content[0] as { text: string }).text.split('\n')
  expect(lines).toHaveLength(4)
  expect(lines[3]).toBe('(no messages)')
  const unknown = await call('ccd_session_mgmt', 'list_events', { session_id: 'local_b', limit: 1 })
  expect(unknown).toEqual({ content: [{ type: 'text', text: 'Session local_b not found.' }], isError: true })
})
