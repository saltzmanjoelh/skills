// Opening a sub session beside the parent through the desktop app's own
// tools. Every call goes through a DesktopCall, which register.tsx makes from
// $.mcp.call, so the tests can answer the calls without the engine.

import type { McpToolResult } from 'claude-code'

import type { StatusRecord } from './record'

export type DesktopCall = (server: string, tool: string, args?: Record<string, unknown>) => Promise<McpToolResult>

// The desktop app's servers and tools that foreman calls.
export const WINDOW_SERVER = 'ccd_window'
export const OPEN_TOOL = 'open_session_in'
export const SESSIONS_SERVER = 'ccd_session_mgmt'
export const LIST_TOOL = 'list_sessions'
// How many sessions to ask the list for. The list answers the most recently
// active ones, twenty when not told otherwise, and a sub session that has been
// quiet a while could fall outside twenty.
export const LIST_LIMIT = 100

// Why an open failed, one fixed reason for each cause. A tool's own error
// text is never repeated, because it is not foreman's to show and may be
// long or hold anything.
export const REASONS = {
  noAddress: 'its record names neither a desktop session nor a folder',
  noSessionInFolder: 'no desktop session works in its folder',
  notConnected: 'the desktop app\'s tools are not connected in this session',
  listRefused: 'the desktop app could not list its sessions',
  listUnreadable: 'the desktop app\'s list of sessions could not be read',
  openRefused: 'the desktop app refused to open it, as it does for a session this one did not start or while this session is not on screen',
} as const

export type OpenResult = { opened: string } | { reason: string }

// The sentence a failed open shows as a toast and writes to the log.
export const failureLine = (issueKey: string, reason: string) => `Could not open ${issueKey}: ${reason}.`

// A call's answer, or the cause it failed: the call rejected, which is how a
// server that is not connected answers, or the tool answered an error.
async function answerOf(call: DesktopCall, server: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult | 'not-connected' | 'refused'> {
  let result: McpToolResult
  try {
    result = await call(server, tool, args)
  } catch {
    return 'not-connected'
  }
  return result.isError === true ? 'refused' : result
}

// A folder without its trailing slashes, so `/a/b/` and `/a/b` match. The
// root stays `/`.
const folderOf = (path: string) => path.replace(/\/+$/, '') || '/'

// The sessions in the list's answer: the first text block parsed as a JSON
// array, each entry kept when it has a string session id and folder. Null
// when the answer is not such a list.
function sessionsIn(result: McpToolResult): { sessionId: string; cwd: string }[] | null {
  const block = result.content.find(b => b.type === 'text') as { text?: unknown } | undefined
  if (block === undefined || typeof block.text !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(block.text)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  return raw.flatMap(entry => {
    const s = entry as { sessionId?: unknown; cwd?: unknown } | null
    return typeof s?.sessionId === 'string' && typeof s.cwd === 'string' ? [{ sessionId: s.sessionId, cwd: s.cwd }] : []
  })
}

// The desktop session id for a record: its own when it has one, else the
// first listed session whose folder is the record's.
async function sessionIdOf(call: DesktopCall, record: Pick<StatusRecord, 'desktopSessionId' | 'cwd'>): Promise<{ id: string } | { reason: string }> {
  if (record.desktopSessionId !== undefined) return { id: record.desktopSessionId }
  if (record.cwd === null) return { reason: REASONS.noAddress }
  const answer = await answerOf(call, SESSIONS_SERVER, LIST_TOOL, { limit: LIST_LIMIT })
  if (answer === 'not-connected') return { reason: REASONS.notConnected }
  if (answer === 'refused') return { reason: REASONS.listRefused }
  const list = sessionsIn(answer)
  if (list === null) return { reason: REASONS.listUnreadable }
  const wanted = folderOf(record.cwd)
  const found = list.find(s => folderOf(s.cwd) === wanted)
  return found === undefined ? { reason: REASONS.noSessionInFolder } : { id: found.sessionId }
}

// Opens the record's session beside the parent, as a split, so the parent's
// band and pane stay on screen. Answers the id it opened, or why it could
// not. An answer that is not an error counts as opened, including the
// desktop app's answer that the session is already showing.
export async function openSession(call: DesktopCall, record: Pick<StatusRecord, 'desktopSessionId' | 'cwd'>): Promise<OpenResult> {
  const found = await sessionIdOf(call, record)
  if ('reason' in found) return found
  const answer = await answerOf(call, WINDOW_SERVER, OPEN_TOOL, { session_id: found.id, target: 'split' })
  if (answer === 'not-connected') return { reason: REASONS.notConnected }
  if (answer === 'refused') return { reason: REASONS.openRefused }
  return { opened: found.id }
}
