import { expect, test } from 'claude-code/testing'
import type { McpToolResult } from 'claude-code'

import { failureLine, LIST_LIMIT, listSessions, openSession, REASONS, type DesktopCall } from '../hooks/desktop'

const SECRET = 'SECRET-ERROR-TEXT'

const text = (value: string): McpToolResult => ({ content: [{ type: 'text', text: value }], isError: false })
const sessions = (list: unknown) => text(JSON.stringify(list))

// A desktop app that answers from a script and records each call.
function desktop(answers: { list?: () => Promise<McpToolResult>; open?: () => Promise<McpToolResult> }) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  const call: DesktopCall = async (server, tool, args = {}) => {
    calls.push({ server, tool, args })
    if (tool === 'list_sessions') return (answers.list ?? (async () => sessions([])))()
    if (tool === 'open_session_in') return (answers.open ?? (async () => text('Opened.')))()
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
