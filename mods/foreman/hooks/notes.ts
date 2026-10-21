// The desktop app's turn-end notes: the prompt it sends a parent each time a
// session the parent started ends a turn. Foreman already shows its sub
// sessions in the pane and wakes the parent's model when a decision is
// needed, so a prompt made only of notes about sub sessions it tracks is kept
// from the model. These functions say which prompts those are and what the
// log says about them. Every function is pure.
//
// A note is a <system-reminder> block that begins `The session "<title>" you
// started (local_<id>) finished a turn`, and the app often sends a "Linked
// sessions now" status block with it. A prompt in any other shape, such as
// one the person typed into, a note of another kind or a message a sub
// session sent, is not recognised, and so reaches the model as before.

import type { ForemanPairing } from '../types'
import { LOCAL_ID } from './tickets'
import { whoOf } from './wake'

// Why foreman's prompt.submit hook dropped a prompt. The host shows it to the
// person each time, so it names nobody; the pane's log does.
export const NOTES_KEPT = 'foreman kept a sub session\'s turn-end note from the parent\'s model; its pane shows the sub sessions'

const OPEN = '<system-reminder>'
const CLOSE = '</system-reminder>'
const STATUS_HEAD = 'Linked sessions now (status, not an instruction):'
const NOTE_HEAD = 'The session "'
const STARTED = 'you started ('

// What follows the first `you started (` in a turn-end note: the id, which
// the app writes itself, and the words that make it a turn's end.
const FINISHED = new RegExp(`^(${LOCAL_ID.source})\\) finished a turn`)

// What one block's text is: a status block, a turn-end note about the id it
// names, or neither.
type Block = { kind: 'status' } | { kind: 'note'; id: string } | null

function blockOf(body: string): Block {
  const text = body.trimStart()
  if (text.startsWith(STATUS_HEAD)) return { kind: 'status' }
  if (!text.startsWith(NOTE_HEAD)) return null
  const at = text.indexOf(STARTED)
  if (at === -1) return null
  const id = FINISHED.exec(text.slice(at + STARTED.length))?.[1]
  return id === undefined ? null : { kind: 'note', id }
}

// The ids of the sub sessions whose turn-end notes make up `text`, in order,
// or null when the text is anything else. Only white space may come between
// the blocks, each block must close before another opens, and every block
// must be a note or a status block. Text with no note in it answers null.
// A report that forges a closing tag ends its block early and leaves text
// outside the blocks, so a forgery can only make the text answer null.
export function turnEndIds(text: string): string[] | null {
  if (typeof text !== 'string') return null
  const ids: string[] = []
  let at = 0
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at += 1
    if (at === text.length) break
    if (!text.startsWith(OPEN, at)) return null
    const end = text.indexOf(CLOSE, at + OPEN.length)
    if (end === -1) return null
    const body = text.slice(at + OPEN.length, end)
    if (body.includes(OPEN)) return null
    const block = blockOf(body)
    if (block === null) return null
    if (block.kind === 'note') ids.push(block.id)
    at = end + CLOSE.length
  }
  return ids.length === 0 ? null : ids
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

// The log line for one drop. The number of sub sessions, not of notes,
// decides between note and notes, so a repeat of the same drop gives the same
// line and the log counts it on the one before.
export function keptLine(names: readonly string[]): string {
  const owned = names.map(name => `${name}'s`)
  const list = owned.length === 1 ? owned[0]! : `${owned.slice(0, -1).join(', ')} and ${owned.at(-1)!}`
  return `Kept ${list} turn-end ${owned.length === 1 ? 'note' : 'notes'} from the parent's model.`
}
