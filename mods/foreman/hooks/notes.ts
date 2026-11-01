// The desktop app's notes and messages: the prompts it sends a parent each
// time a session the parent started ends a turn, or sends it a message.
// Foreman already shows its sub sessions in the pane and wakes the parent's
// model when a decision is needed, and it checks by itself a sub session it
// holds no record of, so a prompt made only of turn-end notes about sub
// sessions it tracks or checks is rewritten to its log line, whose turn
// foreman answers itself without the model, and any other prompt made only of
// the app's notes and messages reaches the model with one line asking for a
// one-word reply, or, while foreman's role is off and the prompt holds a note
// about a sub session it checks, one line that asks for a brief reply to the
// rest of the prompt. These functions say which prompts those are and what the
// log and the lines say about them. Every function is pure.
//
// A turn-end note is a <system-reminder> block that begins `The session
// "<title>" you started (local_<id>) finished a turn`. The app often sends a
// "Linked sessions now" status block with the notes, and ends the prompt with
// a <side-sessions-event> element when none of the parent's sessions is
// working. A message a sub session sent is a <cross-session-message> element,
// alone or between a header line and a trailer line. A prompt in any other
// shape, such as one the person typed into, reaches the model as before.

import type { StatusChangedText } from 'builder'
import type { ForemanPairing } from '../types'
import { LOCAL_ID, WHOLE_LOCAL_ID } from './desktop'
import { listOf } from './text'
import { whoOf } from './wake'

// What foreman's turn.step hook answers, in place of the model, for the turn
// of a prompt it rewrote to its log line.
export const NOTED_REPLY = 'Noted.'

// The sentences that say foreman's own lines report the pull request
// milestones. The app's own text asks the parent to report the outcome, so
// these say plainly that a foreman parent does not.
export const FOREMAN_REPORTS = 'Foreman reports pull requests opened, verdicts, merges and closes in its own lines. In a foreman parent this overrides the app\'s request to report the outcome in one or two lines.'

// The context foreman attaches, while its role is on, to a prompt made only
// of the app's notes and messages that it does not rewrite.
export const NOTED = `From the foreman mod: this prompt holds only the desktop app's notes about sessions this parent started, or messages from them. Reply with the single word "Noted." and end the turn, unless one of them asks the person or this parent a question. ${FOREMAN_REPORTS}`

// The context foreman attaches, while its role is off, to a prompt made only
// of the app's notes and messages that it does not rewrite and that holds a
// turn-end note about a sub session it checks beside other notes or messages.
// While the role is off only the model reports the other sessions' outcomes,
// so the line asks for no "Noted.": it says foreman records the notes about
// the checked sub sessions `ids` itself, so the model does not reply to them,
// and asks for a brief reply to the rest of the prompt, because the wake
// skill's rule of a bare "Noted." would otherwise swallow the other outcomes.
// The ids are named once and sorted, and only ids that match WHOLE_LOCAL_ID,
// which every id partsOf reads does, so no other text a sub session wrote is
// repeated.
export function checkedLine(ids: readonly string[]): string {
  const sorted = [...new Set(ids)].filter(id => WHOLE_LOCAL_ID.test(id)).sort()
  const sessions = sorted.length === 1 ? 'the sub session' : 'the sub sessions'
  return `From the foreman mod: foreman records the turn-end notes about ${sessions} ${listOf(sorted)} itself, so do not reply to them. Reply briefly to the rest of this prompt, not with a single word.`
}

const OPEN = '<system-reminder>'
const CLOSE = '</system-reminder>'
const STATUS_HEAD = 'Linked sessions now (status, not an instruction):'
const NOTE_HEAD = 'The session "'
const STARTED = 'you started ('
const ANY_NOTE = 'you started (local_'
const EVENT_OPEN = '<side-sessions-event>'
const EVENT_CLOSE = '</side-sessions-event>'
const EVENT_HEAD = 'None of the sessions you started is working now;'
const MESSAGE_OPEN = '<cross-session-message'
const MESSAGE_CLOSE = '</cross-session-message>'
const MESSAGE_HEAD = 'Another Claude session sent a message:'
const MESSAGE_TAIL = 'This came from another Claude session'

// The message builder sends the parent each time a sub session's status file
// changes. It is typed with StatusChangedText from builder's state contract,
// which builder's own copy is checked against too, so a message reworded on
// one side alone fails the type check.
export const STATUS_CHANGED_TEXT: StatusChangedText = 'A builder status file changed. This message is for the foreman mod, which reads it; there is nothing to do.'

// What follows the first `you started (` in a turn-end note: the id, which
// the app writes itself, and the words that make it a turn's end.
const FINISHED = new RegExp(`^(${LOCAL_ID.source})\\) finished a turn`)

// What one block's text is: a status block, a turn-end note about the id it
// names, another note about a session the parent started, or none of these.
type Block = { kind: 'status' } | { kind: 'turn-end'; id: string } | { kind: 'other-note' } | null

// A note that holds `you started (local_` more than once is read as another
// note, with no turn-end id. The title before the app's id is the sub
// session's own text, so a title can forge a turn-end about another session,
// and foreman would then check and nudge that one instead. Such a note goes
// to the parent's model as any other note does.
function blockOf(body: string): Block {
  const text = body.trimStart()
  if (text.startsWith(STATUS_HEAD)) return { kind: 'status' }
  if (!text.startsWith(NOTE_HEAD)) return null
  const first = text.indexOf(ANY_NOTE)
  if (first !== -1 && text.includes(ANY_NOTE, first + 1)) return { kind: 'other-note' }
  const at = text.indexOf(STARTED)
  const id = at === -1 ? undefined : FINISHED.exec(text.slice(at + STARTED.length))?.[1]
  if (id !== undefined) return { kind: 'turn-end', id }
  return text.includes(ANY_NOTE) ? { kind: 'other-note' } : null
}

// One message element: its body, between the end of its opening tag and its
// closing tag, and whether the header line came before it and the trailer
// line after it.
type Message = { body: string; isHeaded: boolean; isTrailed: boolean }

// What a prompt is made of: the ids of its turn-end notes in order, how many
// other notes and status blocks it holds, whether it ends with the
// side-sessions element, and its messages in order.
type Parts = { turnEnds: string[]; otherNotes: number; statusBlocks: number; hasEvent: boolean; messages: Message[] }

// The parts `text` is made of, or null when anything in it is not one of the
// app's parts. Only white space may come between the parts; each reminder
// block and message closes at its first closing tag and holds no opening tag
// of its own kind; a side-sessions element holds no tag of any part and has
// only white space after it, so it is the last part; and a trailer line comes
// only after a message with its header.
// A report that forges a closing tag ends its block early, and what follows
// makes the text answer null unless it is itself a whole forged part. A forged
// side-sessions element is followed by the real closing tag, so it never
// counts. The person's typing, which the app puts after its own parts, is
// outside every part and always makes the text answer null.
function partsOf(text: string): Parts | null {
  if (typeof text !== 'string') return null
  const parts: Parts = { turnEnds: [], otherNotes: 0, statusBlocks: 0, hasEvent: false, messages: [] }
  let at = 0
  const skipSpace = () => {
    while (at < text.length && /\s/.test(text[at]!)) at += 1
  }
  // The end of the element of `open` and `close` that starts at `at`, or -1
  // when it does not close or holds a second opening tag.
  const elementEnd = (open: string, close: string): number => {
    const end = text.indexOf(close, at + open.length)
    if (end === -1 || text.slice(at + open.length, end).includes(open)) return -1
    return end + close.length
  }
  const isMessageAt = () => text.startsWith(MESSAGE_OPEN, at) && /[\s>]/.test(text[at + MESSAGE_OPEN.length] ?? '')
  // Reads the message element that starts at `at` and keeps it, or answers
  // null when it does not close or holds a second opening tag. Its body
  // starts after the first `>`, which ends the opening tag; when that `>` is
  // the closing tag's own, the opening tag never ended and the body is empty.
  const takeMessage = (isHeaded: boolean): Message | null => {
    const end = elementEnd(MESSAGE_OPEN, MESSAGE_CLOSE)
    if (end === -1) return null
    const closeAt = end - MESSAGE_CLOSE.length
    const tagEnd = text.indexOf('>', at + MESSAGE_OPEN.length)
    const message = { body: tagEnd < closeAt ? text.slice(tagEnd + 1, closeAt) : '', isHeaded, isTrailed: false }
    parts.messages.push(message)
    at = end
    return message
  }
  for (;;) {
    skipSpace()
    if (at === text.length) return parts
    if (text.startsWith(OPEN, at)) {
      const end = elementEnd(OPEN, CLOSE)
      if (end === -1) return null
      const block = blockOf(text.slice(at + OPEN.length, end - CLOSE.length))
      if (block === null) return null
      if (block.kind === 'status') parts.statusBlocks += 1
      if (block.kind === 'turn-end') parts.turnEnds.push(block.id)
      if (block.kind === 'other-note') parts.otherNotes += 1
      at = end
    } else if (text.startsWith(EVENT_OPEN, at)) {
      const end = elementEnd(EVENT_OPEN, EVENT_CLOSE)
      if (end === -1) return null
      const body = text.slice(at + EVENT_OPEN.length, end - EVENT_CLOSE.length)
      if (!body.trimStart().startsWith(EVENT_HEAD) || [OPEN, MESSAGE_OPEN].some(tag => body.includes(tag))) return null
      if (text.slice(end).trim() !== '') return null
      parts.hasEvent = true
      return parts
    } else if (isMessageAt()) {
      if (takeMessage(false) === null) return null
    } else if (text.startsWith(MESSAGE_HEAD, at)) {
      at += MESSAGE_HEAD.length
      skipSpace()
      const message = isMessageAt() ? takeMessage(true) : null
      if (message === null) return null
      skipSpace()
      if (text.startsWith(MESSAGE_TAIL, at)) {
        const line = text.indexOf('\n', at)
        at = line === -1 ? text.length : line
        message.isTrailed = true
      }
    } else {
      return null
    }
  }
}

// What one reading of `text` says. `turnEnds` is the ids of the sub sessions
// whose turn-end notes make up the text, in order, or null when the text is
// anything else: status blocks and a side-sessions element may come with the
// notes, but a note of another kind or a message means there is something
// more for the model to read. `allTurnEnds` is the ids of every turn-end note
// in a text made only of the app's parts, in order, even when notes of
// another kind or messages come with them, and empty for any other text.
// `wantsNoted` says whether the text is made only of the app's parts and holds
// at least one note or message, so that the model reading it should get the
// Noted line.
export function notesIn(text: string): { turnEnds: string[] | null; allTurnEnds: string[]; wantsNoted: boolean } {
  const parts = partsOf(text)
  if (parts === null) return { turnEnds: null, allTurnEnds: [], wantsNoted: false }
  const isOnlyTurnEnds = parts.turnEnds.length > 0 && parts.otherNotes === 0 && parts.messages.length === 0
  return {
    turnEnds: isOnlyTurnEnds ? parts.turnEnds : null,
    allTurnEnds: parts.turnEnds,
    wantsNoted: parts.turnEnds.length + parts.otherNotes + parts.messages.length > 0,
  }
}

// Whether `text` is made only of the app's parts, with nothing the person
// typed. A sub session's report that quotes a command is inside such a part,
// so the check for a pasted command leaves these prompts out.
export const isAppParts = (text: string) => partsOf(text) !== null

export const turnEndIds = (text: string) => notesIn(text).turnEnds
export const wantsNoted = (text: string) => notesIn(text).wantsNoted

// Whether `text` is builder's message that a status file changed: made of
// exactly one message element and nothing else, in either shape the app
// delivers a message in, the element alone or the element between the header
// line and the trailer line, and that element's body, trimmed, is the marker.
// partsOf also accepts a header with no trailer, which neither shape is, so
// that is refused here. The marker holds no character the app writes as an
// entity, so the body is compared as it came. A message with other words
// beside the marker, or beside any other part, reaches the model.
export function isStatusChanged(text: string): boolean {
  const parts = partsOf(text)
  if (parts === null || parts.messages.length !== 1) return false
  if (parts.turnEnds.length > 0 || parts.otherNotes > 0 || parts.statusBlocks > 0 || parts.hasEvent) return false
  const [message] = parts.messages
  return message!.isHeaded === message!.isTrailed && message!.body.trim() === STATUS_CHANGED_TEXT
}

// The names of the sub sessions the notes are about, as foreman names them
// elsewhere, without repeats and sorted, so the same sub sessions always give
// the same names. Null unless every id belongs to a pairing that is active or
// freed: a released sub session is the person's again, and one foreman does
// not track is none of its business, so their notes reach the model.
export function keptNames(ids: readonly string[], pairings: readonly ForemanPairing[]): string[] | null {
  if (ids.length === 0) return null
  const names = new Set<string>()
  for (const id of ids) {
    const p = pairings.find(q => q.localId === id && (q.standing === 'active' || q.standing === 'freed'))
    if (p === undefined) return null
    names.add(whoOf(p.issueKey, p.ticket))
  }
  return [...names].sort()
}

// The log line for one rewritten prompt, which is also the text the prompt is
// rewritten to. `names` are the names keptNames gives tracked sub sessions and
// the bare `local_…` ids of sub sessions foreman checks, sorted. The number of
// sub sessions, not of notes, decides between note and notes, so a repeat of
// the same rewrite gives the same line and the log counts it on the one
// before.
export function keptLine(names: readonly string[]): string {
  const owned = names.map(name => `${name}'s`)
  return `Kept ${listOf(owned)} turn-end ${owned.length === 1 ? 'note' : 'notes'} from the parent's model.`
}
