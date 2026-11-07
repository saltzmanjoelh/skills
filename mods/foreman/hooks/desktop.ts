// Opening a sub session beside the parent through the desktop app's own
// tools. Every call goes through a DesktopCall, which register.tsx makes from
// $.mcp.call, so the tests can answer the calls without the engine.

import type { ForemanNudgeText } from 'builder'
import type { McpToolResult } from 'claude-code'

import type { SubRecord } from './record'

export type DesktopCall = (server: string, tool: string, args?: Record<string, unknown>) => Promise<McpToolResult>

// What a read of the list needs from Claude Code's saved tool results, which
// register.tsx makes from the engine, so the tests can answer it from memory:
// the configuration folder without trailing slashes, a saved copy's text, and
// a file's size in bytes. Each may reject.
export type SavedCopies = { config: () => Promise<string>; read: (path: string) => Promise<string>; size: (path: string) => Promise<number> }

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
// to a sub session that loads foreman's wake skill. Its second sentence makes
// a begin that arrives twice harmless. The wait line in tickets.ts quotes it,
// so the sub session knows it when it comes, and so it holds no double quote.
// Its first two sentences are the whole of an older version, which a sub
// session that waits under an older brief knows it by, so that text stays its
// exact start. The three sentences after them cover an issue that went stale
// while its sub session waited: the session does not wait for an answer,
// first marks an issue that is done but shows as not started, so the next
// top-up skips it, and in every stale case runs /cleanup, which archives it
// and frees its slot.
export const BEGIN_TEXT = 'foreman begins this session now: first bring your branch up to date with the base branch, with the desktop app\'s sync_with_base_branch tool, and then run the /implement command your brief gives. If you have already begun it, ignore this message.'
  + ' If /implement stops because your issue is already done on the base branch or already has an open pull request, do not wait for an answer. If the issue is already done but the tracker still shows it not started, first comment on the issue with the evidence and move it to the tracker\'s in-progress state. In every such case, then run /cleanup.'
// How many sessions to ask the list for. Every read asks for the parent's
// linked family alone, which the list answers most recently active first,
// twenty when not told otherwise, and a sub session that has been quiet a
// while could fall outside twenty.
export const LIST_LIMIT = 100

// The most a saved copy may hold for $.fs.read to read it, 4 MiB.
const SAVED_LIMIT = 4 * 1024 * 1024

// Why an open failed, one fixed reason for each cause. A tool's own error
// text is never repeated, because it is not foreman's to show and may be
// long or hold anything.
export const REASONS = {
  noAddress: 'its record names neither a desktop session nor a folder',
  noSessionId: 'foreman holds no usable desktop session id for it yet',
  noSessionInFolder: 'no desktop session works in its folder',
  notConnected: 'the desktop app\'s tools are not connected in this session',
  listRefused: 'the desktop app could not list its sessions',
  listUnreadable: 'the desktop app\'s list of sessions could not be read',
  openRefused: 'the desktop app refused to open it, as it does for a session this one did not start or while this session is not on screen',
  sendRefused: 'the desktop app refused the message',
  eventsRefused: 'the desktop app could not read its events',
  eventsUnreadable: 'the desktop app\'s answer about its events could not be read',
  notLinked: 'it is not a session in this parent\'s family of linked sessions',
  savedOutside: 'the desktop app\'s list of sessions was too large to pass back whole, and the place named for its saved copy is outside Claude Code\'s saved tool results',
  savedMissing: 'the desktop app\'s list of sessions was too large to pass back whole, and its saved copy is missing',
  savedTooLarge: 'the desktop app\'s list of sessions was too large to pass back whole, and its saved copy is over the 4 MiB foreman can read',
  savedNotList: 'the desktop app\'s list of sessions was too large to pass back whole, and its saved copy is not a list of sessions',
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

// The text of an answer's first text block, or null when it has none.
function firstTextOf(result: McpToolResult): string | null {
  const block = result.content.find(b => b.type === 'text') as { text?: unknown } | undefined
  return block === undefined || typeof block.text !== 'string' ? null : block.text
}

// The text parsed as a JSON array, or null when it is not one.
function arrayIn(text: string): unknown[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  return Array.isArray(raw) ? raw : null
}

// The notice Claude Code passes back in place of a tool answer too large to
// pass back whole, after saving the answer to a file. The greedy capture
// backs up to the last full stop before the first newline, so the path is
// everything between "saved to " and that final full stop.
const SAVED_NOTICE = /^Error: result \([^)]*\) exceeds maximum allowed tokens\. Output has been saved to ([^\n]*)\.\n/

// The path the notice names, or null when the text is not the notice in
// exactly that shape.
export function savedPathIn(text: string): string | null {
  return SAVED_NOTICE.exec(text)?.[1] ?? null
}

// A path that begins with a drive letter, a colon and a slash of either kind.
const DRIVE_PATH = /^[A-Za-z]:[\\/]/

// A Windows path written with `/` alone and with its drive letter in lower
// case, so that two ways of writing the same path compare equal. Its test for
// a drive letter needs no slash after the colon, unlike DRIVE_PATH, because
// it is also given the configuration folder, which is a bare `C:` when
// CLAUDE_CONFIG_DIR is the root of a drive. The saved path it is given has
// already passed DRIVE_PATH.
function windowsForm(text: string): string {
  const slashed = text.replace(/\\/g, '/')
  return /^[A-Za-z]:/.test(slashed) ? slashed.charAt(0).toLowerCase() + slashed.slice(1) : slashed
}

// Whether Windows may read a part as something other than a plain name: one
// made only of dots and spaces, such as `... `, which it may read as `..`, or
// one with a colon, such as `x.json:stream`, which names a hidden alternate
// data stream of a file.
const unsafeOnWindows = (part: string) => /^[. ]+$/.test(part) || part.includes(':')

// Whether one part of a saved path is a plain name: not empty, `.` or `..`,
// and, on a drive-letter path, not a name that Windows reads otherwise.
function plainName(part: string, onDrive: boolean): boolean {
  if (part === '' || part === '.' || part === '..') return false
  if (onDrive && unsafeOnWindows(part)) return false
  return true
}

// Whether `path` lies in Claude Code's saved tool results under the
// configuration folder `config`: exactly
// <config>/projects/<folder>/<folder>/tool-results/<file>, each part one
// segment that is not empty, `.` or `..`. A path that starts with a drive
// letter is compared with the folder in their Windows form, so either slash
// and either case of the drive letter match, and no part may be one that
// Windows reads as something other than a plain name. Any other path must
// start with `/` and is checked as it is. The notice is text a tool answer
// could imitate, so no other file is ever read for it.
export function isSavedResult(path: string, config: string): boolean {
  const onDrive = DRIVE_PATH.test(path)
  if (!onDrive && !path.startsWith('/')) return false
  const seen = onDrive ? windowsForm(path) : path
  const root = `${onDrive ? windowsForm(config) : config}/projects/`
  if (!seen.startsWith(root)) return false
  const parts = seen.slice(root.length).split('/')
  return parts.length === 4 && parts.every(part => plainName(part, onDrive)) && parts[2] === 'tool-results'
}

// The entries of the saved copy at `path`, or why they could not be read.
// When the read fails, the file's size tells a copy too large to read from
// one that is missing; the engine's error text is never parsed. Claude Code
// saves a copy only for an answer too large to pass back, so a copy in which
// no entry has a string session id cannot be an honest list.
async function savedEntries(saved: SavedCopies, path: string): Promise<{ entries: unknown[] } | { reason: string }> {
  let config: string
  try {
    config = await saved.config()
  } catch {
    return { reason: REASONS.savedOutside }
  }
  if (!isSavedResult(path, config)) return { reason: REASONS.savedOutside }
  let text: string
  try {
    text = await saved.read(path)
  } catch {
    let size: number | null
    try {
      size = await saved.size(path)
    } catch {
      size = null
    }
    return { reason: size !== null && size > SAVED_LIMIT ? REASONS.savedTooLarge : REASONS.savedMissing }
  }
  const entries = arrayIn(text)
  if (entries === null) return { reason: REASONS.savedNotList }
  if (!entries.some(entry => typeof (entry as { sessionId?: unknown } | null)?.sessionId === 'string')) return { reason: REASONS.savedNotList }
  return { entries }
}

// The entries of the list's answer to `args`, or why they could not be read.
// The answer's first text block is parsed as a JSON array, unless it is
// Claude Code's notice that it saved the answer, when the saved copy is read
// instead. A tool error reads as refused even when its text is the notice.
// Every call is caught, so this never rejects. Each caller picks the fields it
// needs from the entries.
async function listEntries(call: DesktopCall, saved: SavedCopies, args: Record<string, unknown>): Promise<{ entries: unknown[] } | { reason: string }> {
  const answer = await answerOf(call, SESSIONS_SERVER, LIST_TOOL, args)
  if (answer === 'not-connected') return { reason: REASONS.notConnected }
  if (answer === 'refused') return { reason: REASONS.listRefused }
  const text = firstTextOf(answer)
  if (text === null) return { reason: REASONS.listUnreadable }
  const path = savedPathIn(text)
  if (path !== null) return savedEntries(saved, path)
  const entries = arrayIn(text)
  return entries === null ? { reason: REASONS.listUnreadable } : { entries }
}

// The desktop session id for a record: its own when it has one, else the
// first session in the parent's linked family whose folder is the record's.
// It leaves archived sessions out, because an archived session is never
// opened.
async function sessionIdOf(call: DesktopCall, record: Pick<SubRecord, 'desktopSessionId' | 'cwd'>, saved: SavedCopies): Promise<{ id: string } | { reason: string }> {
  if (record.desktopSessionId !== undefined) return { id: record.desktopSessionId }
  if (record.cwd === null) return { reason: REASONS.noAddress }
  const read = await listEntries(call, saved, { linked: true, limit: LIST_LIMIT })
  if ('reason' in read) return read
  const list = read.entries.flatMap(entry => {
    const s = entry as { sessionId?: unknown; cwd?: unknown } | null
    return typeof s?.sessionId === 'string' && typeof s.cwd === 'string' ? [{ sessionId: s.sessionId, cwd: s.cwd }] : []
  })
  const wanted = folderOf(record.cwd)
  const found = list.find(s => folderOf(s.cwd) === wanted)
  return found === undefined ? { reason: REASONS.noSessionInFolder } : { id: found.sessionId }
}

// Opens the record's session beside the parent, as a split, so the parent's
// band and pane stay on screen. Answers the id it opened, or why it could
// not. An answer that is not an error counts as opened, including the
// desktop app's answer that the session is already showing.
export async function openSession(call: DesktopCall, record: Pick<SubRecord, 'desktopSessionId' | 'cwd'>, saved: SavedCopies): Promise<OpenResult> {
  const found = await sessionIdOf(call, record, saved)
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

// The sessions in a list's entries, each with whether it is archived and
// whether it runs. An entry whose flags are not true or false reads as not
// archived and running, so a doubtful entry frees no slot and wakes no one.
// The same doubtful entry is not sure to be unarchived, so it releases no
// hold either.
function listedIn(entries: readonly unknown[]): Listed[] {
  return entries.flatMap(entry => {
    const s = entry as { sessionId?: unknown; isArchived?: unknown; isRunning?: unknown; title?: unknown } | null
    if (typeof s?.sessionId !== 'string') return []
    const title = typeof s.title === 'string' ? s.title : null
    return [{ sessionId: s.sessionId, isArchived: s.isArchived === true, isRunning: s.isRunning !== false, title, surelyUnarchived: s.isArchived === false }]
  })
}

// The sessions of the parent's family of linked sessions, as the desktop
// app's list gives them when asked for that family alone, archived ones
// included, and whether the list is complete, or why they could not be read.
// Every session foreman tracks is one the parent started, so it is in that
// family. The list holds only the most recently active sessions, so it is
// complete only when it came back shorter than LIST_LIMIT, entries foreman
// could not read included, whether they came from the answer or from its
// saved copy.
export async function listSessions(call: DesktopCall, saved: SavedCopies): Promise<{ sessions: Listed[]; complete: boolean } | { reason: string }> {
  const read = await listEntries(call, saved, { linked: true, limit: LIST_LIMIT, include_archived: true })
  if ('reason' in read) return read
  return { sessions: listedIn(read.entries), complete: read.entries.length < LIST_LIMIT }
}

// The desktop app's most recently active sessions, whoever started them,
// archived ones included, or why they could not be read. Only the release of
// a held key reads this list, because the person may start a held issue by
// hand, and a session started by hand is outside the parent's linked family.
// Its answer is read from the saved copy when it is too large to pass back
// whole, as every list read is.
export async function everySession(call: DesktopCall, saved: SavedCopies): Promise<{ sessions: Listed[] } | { reason: string }> {
  const read = await listEntries(call, saved, { limit: LIST_LIMIT, include_archived: true })
  return 'reason' in read ? read : { sessions: listedIn(read.entries) }
}

// The ids of this parent's family of linked sessions, archived ones included,
// as the desktop app's list gives them when asked for the linked family alone:
// the session that started the parent, the sessions it or they started, and
// their own linked sessions. Answers those ids and whether the list is
// complete, which it is only when it came back shorter than LIST_LIMIT,
// entries foreman could not read included, or why it could not be read.
export async function linkedFamily(call: DesktopCall, saved: SavedCopies): Promise<{ ids: string[]; complete: boolean } | { reason: string }> {
  const read = await listEntries(call, saved, { linked: true, limit: LIST_LIMIT, include_archived: true })
  if ('reason' in read) return read
  const raw = read.entries
  return {
    ids: raw.flatMap(entry => {
      const s = entry as { sessionId?: unknown } | null
      return typeof s?.sessionId === 'string' ? [s.sessionId] : []
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
  const text = firstTextOf(answer)
  if (text === null) return { reason: REASONS.eventsUnreadable }
  return { header: text.split(/\r?\n/, 1)[0]! }
}
