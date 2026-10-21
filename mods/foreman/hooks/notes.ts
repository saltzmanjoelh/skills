// The desktop app's notes and messages: the prompts it sends a parent each
// time a session the parent started ends a turn, or sends it a message.
// Foreman already shows its sub sessions in the pane and wakes the parent's
// model when a decision is needed, so a prompt made only of turn-end notes
// about sub sessions it tracks is kept from the model, and any other prompt
// made only of the app's notes and messages reaches it with one line asking
// for a one-word reply. These functions say which prompts those are and what
// the log says about them. Every function is pure.
//
// A turn-end note is a <system-reminder> block that begins `The session
// "<title>" you started (local_<id>) finished a turn`. The app often sends a
// "Linked sessions now" status block with the notes, and ends the prompt with
// a <side-sessions-event> element when none of the parent's sessions is
// working. A message a sub session sent is a <cross-session-message> element,
// alone or between a header line and a trailer line. A prompt in any other
// shape, such as one the person typed into, reaches the model as before.

import type { ForemanPairing } from '../types'
import { LOCAL_ID } from './tickets'
import { whoOf } from './wake'

// Why foreman's prompt.submit hook dropped a prompt. The host shows it to the
// person each time, so it names nobody; the pane's log does.
export const NOTES_KEPT = 'foreman kept a sub session\'s turn-end note from the parent\'s model; its pane shows the sub sessions'

// The context foreman attaches to a prompt made only of the app's notes and
// messages that it does not drop. The app's own text asks the parent to report
// the outcome, so this says plainly that a foreman parent does not.
export const NOTED = 'From the foreman mod: this prompt holds only the desktop app\'s notes about sessions this parent started, or messages from them. Reply with the single word "Noted." and end the turn, unless one of them reports a milestone (a pull request opened, a verdict or a merge) or asks the person or this parent a question. In a foreman parent this overrides the app\'s request to report the outcome in one or two lines.'

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

// What follows the first `you started (` in a turn-end note: the id, which
// the app writes itself, and the words that make it a turn's end.
const FINISHED = new RegExp(`^(${LOCAL_ID.source})\\) finished a turn`)

// What one block's text is: a status block, a turn-end note about the id it
// names, another note about a session the parent started, or none of these.
type Block = { kind: 'status' } | { kind: 'turn-end'; id: string } | { kind: 'other-note' } | null

function blockOf(body: string): Block {
  const text = body.trimStart()
  if (text.startsWith(STATUS_HEAD)) return { kind: 'status' }
  if (!text.startsWith(NOTE_HEAD)) return null
  const at = text.indexOf(STARTED)
  const id = at === -1 ? undefined : FINISHED.exec(text.slice(at + STARTED.length))?.[1]
  if (id !== undefined) return { kind: 'turn-end', id }
  return text.includes(ANY_NOTE) ? { kind: 'other-note' } : null
}

// What a prompt is made of: the ids of its turn-end notes in order, and how
// many other notes and messages it holds.
type Parts = { turnEnds: string[]; otherNotes: number; messages: number }

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
  const parts: Parts = { turnEnds: [], otherNotes: 0, messages: 0 }
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
  // Reads the message element that starts at `at` and counts it, or answers
  // false when it does not close or holds a second opening tag.
  const takeMessage = (): boolean => {
    const end = elementEnd(MESSAGE_OPEN, MESSAGE_CLOSE)
    if (end === -1) return false
    parts.messages += 1
    at = end
    return true
  }
  for (;;) {
    skipSpace()
    if (at === text.length) return parts
    if (text.startsWith(OPEN, at)) {
      const end = elementEnd(OPEN, CLOSE)
      if (end === -1) return null
      const block = blockOf(text.slice(at + OPEN.length, end - CLOSE.length))
      if (block === null) return null
      if (block.kind === 'turn-end') parts.turnEnds.push(block.id)
      if (block.kind === 'other-note') parts.otherNotes += 1
      at = end
    } else if (text.startsWith(EVENT_OPEN, at)) {
      const end = elementEnd(EVENT_OPEN, EVENT_CLOSE)
      if (end === -1) return null
      const body = text.slice(at + EVENT_OPEN.length, end - EVENT_CLOSE.length)
      if (!body.trimStart().startsWith(EVENT_HEAD) || [OPEN, MESSAGE_OPEN].some(tag => body.includes(tag))) return null
      if (text.slice(end).trim() !== '') return null
      return parts
    } else if (isMessageAt()) {
      if (!takeMessage()) return null
    } else if (text.startsWith(MESSAGE_HEAD, at)) {
      at += MESSAGE_HEAD.length
      skipSpace()
      if (!isMessageAt() || !takeMessage()) return null
      skipSpace()
      if (text.startsWith(MESSAGE_TAIL, at)) {
        const line = text.indexOf('\n', at)
        at = line === -1 ? text.length : line
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
// more for the model to read. `wantsNoted` says whether the text is made only
// of the app's parts and holds at least one note or message, so that the
// model reading it should get the Noted line.
export function notesIn(text: string): { turnEnds: string[] | null; wantsNoted: boolean } {
  const parts = partsOf(text)
  if (parts === null) return { turnEnds: null, wantsNoted: false }
  const isOnlyTurnEnds = parts.turnEnds.length > 0 && parts.otherNotes === 0 && parts.messages === 0
  return {
    turnEnds: isOnlyTurnEnds ? parts.turnEnds : null,
    wantsNoted: parts.turnEnds.length + parts.otherNotes + parts.messages > 0,
  }
}

export const turnEndIds = (text: string) => notesIn(text).turnEnds
export const wantsNoted = (text: string) => notesIn(text).wantsNoted

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

// The log line for one drop. The number of sub sessions, not of notes,
// decides between note and notes, so a repeat of the same drop gives the same
// line and the log counts it on the one before.
export function keptLine(names: readonly string[]): string {
  const owned = names.map(name => `${name}'s`)
  const list = owned.length === 1 ? owned[0]! : `${owned.slice(0, -1).join(', ')} and ${owned.at(-1)!}`
  return `Kept ${list} turn-end ${owned.length === 1 ? 'note' : 'notes'} from the parent's model.`
}
