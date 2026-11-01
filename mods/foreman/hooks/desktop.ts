// Opening a sub session beside the parent through the desktop app's own
// tools. Every call goes through a DesktopCall, which register.tsx makes from
// $.mcp.call, so the tests can answer the calls without the engine.

import type { ForemanNudgeText } from 'builder'
import type { McpToolResult } from 'claude-code'

import type { SubRecord } from './record'

export type DesktopCall = (server: string, tool: string, args?: Record<string, unknown>) => Promise<McpToolResult>

// The desktop app's servers and tools that foreman calls.
export const WINDOW_SERVER = 'ccd_window'
export const OPEN_TOOL = 'open_session_in'
export const SESSIONS_SERVER = 'ccd_session_mgmt'
export const LIST_TOOL = 'list_sessions'
export const SEND_TOOL = 'send_message'
export const EVENTS_TOOL = 'list_events'

// The shape of a desktop session id, such as local_ab-12_c. The turn-end
// notes in hooks/notes.ts read ids with it too, so the two cannot drift.
export const LOCAL_ID = /local_[A-Za-z0-9_-]+/

// A whole desktop session id with nothing around it, which is all an
// unwatched entry, a check's id and a begin message's target may be.
export const WHOLE_LOCAL_ID = new RegExp(`^${LOCAL_ID.source}$`)

// The nudge foreman sends an idle sub session. Both nudges are typed with
// ForemanNudgeText from builder's state contract, which builder's recogniser
// of a turn that answers a nudge is also checked against, so a nudge
// reworded here alone fails the type check.
export const NUDGE_TEXT: ForemanNudgeText = 'what\'s next?'
// The nudge foreman sends a sub session that waits only on background work,
// which asks about that work rather than what is next.
export const BACKGROUND_NUDGE_TEXT: ForemanNudgeText = 'could you check that your background work is still making progress, and stop it if it hangs?'
// The message that tells a waiting sub session to begin. It is a constant, so
// no text from an issue or a status file ever reaches a sub session through
// it, and it does not begin with "foreman: ", which would read as a wake line
// to a sub session that loads foreman's wake skill. Its last sentence makes a
// begin that arrives twice harmless. The wait line in tickets.ts quotes it, so
// the sub session knows it when it comes.
export const BEGIN_TEXT = 'foreman begins this session now: first bring your branch up to date with the base branch, with the desktop app\'s sync_with_base_branch tool, and then run the /implement command your brief gives. If you have already begun it, ignore this message.'
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
  sendRefused: 'the desktop app refused the message',
  eventsRefused: 'the desktop app could not read its events',
  eventsUnreadable: 'the desktop app\'s answer about its events could not be read',
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

// The entries of the list's answer: its first text block parsed as a JSON
// array, or null when the answer is not such a list. Each caller picks the
// fields it needs from the entries.
function entriesIn(result: McpToolResult): unknown[] | null {
  const block = result.content.find(b => b.type === 'text') as { text?: unknown } | undefined
  if (block === undefined || typeof block.text !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(block.text)
  } catch {
    return null
  }
  return Array.isArray(raw) ? raw : null
}

// The sessions in the list's answer, each kept when it has a string session
// id and folder, or null when the answer is not a list.
function sessionsIn(result: McpToolResult): { sessionId: string; cwd: string }[] | null {
  const raw = entriesIn(result)
  if (raw === null) return null
  return raw.flatMap(entry => {
    const s = entry as { sessionId?: unknown; cwd?: unknown } | null
    return typeof s?.sessionId === 'string' && typeof s.cwd === 'string' ? [{ sessionId: s.sessionId, cwd: s.cwd }] : []
  })
}

// The desktop session id for a record: its own when it has one, else the
// first listed session whose folder is the record's.
async function sessionIdOf(call: DesktopCall, record: Pick<SubRecord, 'desktopSessionId' | 'cwd'>): Promise<{ id: string } | { reason: string }> {
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
export async function openSession(call: DesktopCall, record: Pick<SubRecord, 'desktopSessionId' | 'cwd'>): Promise<OpenResult> {
  const found = await sessionIdOf(call, record)
  if ('reason' in found) return found
  const answer = await answerOf(call, WINDOW_SERVER, OPEN_TOOL, { session_id: found.id, target: 'split' })
  if (answer === 'not-connected') return { reason: REASONS.notConnected }
  if (answer === 'refused') return { reason: REASONS.openRefused }
  return { opened: found.id }
}

// How a message to a sub session went: sent, or why not.
export type SendResult = 'sent' | 'not-connected' | 'refused'

// Sends `text` to the desktop session `sessionId` with the desktop app's
// send_message tool, which needs no permission when called through
// $.mcp.call.
export async function sendMessage(call: DesktopCall, sessionId: string, text: string): Promise<SendResult> {
  const answer = await answerOf(call, SESSIONS_SERVER, SEND_TOOL, { session_id: sessionId, message: text })
  return answer === 'not-connected' || answer === 'refused' ? answer : 'sent'
}

// One session as the desktop app's list gives it. `title` is its title, or
// null when it has none, and `surelyUnarchived` says that the list gave its
// archived flag as exactly false, which only the release of a hold reads.
export type Listed = { sessionId: string; isArchived: boolean; isRunning: boolean; title: string | null; surelyUnarchived: boolean }

// The desktop app's sessions, archived ones included, each with whether it
// is archived and whether it runs, and whether the list is complete, or why
// they could not be read. The list holds only the most recently active
// sessions, so it is complete only when it came back shorter than
// LIST_LIMIT, entries foreman could not read included. An entry
// whose flags are not true or false reads as not archived and running, so a
// doubtful entry frees no slot and wakes no one. The same doubtful entry is
// not sure to be unarchived, so it releases no hold either.
export async function listSessions(call: DesktopCall): Promise<{ sessions: Listed[]; complete: boolean } | { reason: string }> {
  const answer = await answerOf(call, SESSIONS_SERVER, LIST_TOOL, { limit: LIST_LIMIT, include_archived: true })
  if (answer === 'not-connected') return { reason: REASONS.notConnected }
  if (answer === 'refused') return { reason: REASONS.listRefused }
  const raw = entriesIn(answer)
  if (raw === null) return { reason: REASONS.listUnreadable }
  return {
    sessions: raw.flatMap(entry => {
      const s = entry as { sessionId?: unknown; isArchived?: unknown; isRunning?: unknown; title?: unknown } | null
      if (typeof s?.sessionId !== 'string') return []
      const title = typeof s.title === 'string' ? s.title : null
      return [{ sessionId: s.sessionId, isArchived: s.isArchived === true, isRunning: s.isRunning !== false, title, surelyUnarchived: s.isArchived === false }]
    }),
    complete: raw.length < LIST_LIMIT,
  }
}

// The first line of a session's events as the desktop app's list_events tool
// answers them, asking for a single event, since only the header line that
// opens the answer is read. Answers that line, or why it could not be read.
// A session the app does not know answers a tool error, which reads as
// refused. Nothing below the first line is ever returned.
export async function readHeader(call: DesktopCall, id: string): Promise<{ header: string } | { reason: string }> {
  const answer = await answerOf(call, SESSIONS_SERVER, EVENTS_TOOL, { session_id: id, limit: 1 })
  if (answer === 'not-connected') return { reason: REASONS.notConnected }
  if (answer === 'refused') return { reason: REASONS.eventsRefused }
  const block = answer.content.find(b => b.type === 'text') as { text?: unknown } | undefined
  if (block === undefined || typeof block.text !== 'string') return { reason: REASONS.eventsUnreadable }
  return { header: block.text.split(/\r?\n/, 1)[0]! }
}
