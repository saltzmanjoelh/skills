import { expect, test } from 'claude-code/testing'
import type { McpToolResult } from 'claude-code'

import { failureLine, openSession, REASONS, type DesktopCall } from '../hooks/desktop'

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
