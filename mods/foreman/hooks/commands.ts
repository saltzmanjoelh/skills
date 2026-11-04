// What the arguments of /start-foreman ask for, read without the engine.

import { topUpSentence } from './held'

// The command the person types. It is a skill in the person's skills folder
// rather than a command the mod registers, so that the desktop app knows it
// before a session starts. The mod answers it in place of the skill.
export const COMMAND = 'start-foreman'

// A prompt whose text is the command: after optional white space comes the
// command followed by white space or the end of the text. The prompt.submit
// hook checks it beside the prompt's own command field, so that the prompt of
// a typed /start-foreman never gets the top-up line, whose count the text
// that replaces the skill already gives.
const TYPED = new RegExp(`^\\s*/${COMMAND}(?=\\s|$)`)

export const isCommandText = (text: unknown) => typeof text === 'string' && TYPED.test(text)

// A line that begins with the command as text, as when the person pasted it
// rather than typed it, so it never ran: after optional spaces or tabs and an
// optional chain of opening tags, such as the one that wraps pasted text,
// comes the command followed by white space or the end of the line. A
// closing tag does not count, and neither does the command inside a sentence
// or glued to other characters.
const PASTED = new RegExp(`^[ \\t]*(?:<[A-Za-z][\\w-]*(?:\\s[^<>]*)?>[ \\t]*)*/${COMMAND}(?=\\s|$)`, 'm')

// Whether `text` holds the command as text at the start of a line.
export const pastedCommandIn = (text: string) => typeof text === 'string' && PASTED.test(text)

// The context line for a person's prompt that holds the command as text while
// the role is off. It repeats nothing from the prompt, so a pasted count or
// words are never acted on as though the command had run.
export const PASTED_LINE = 'foreman: this prompt holds /start-foreman as text, but the command did not run, so foreman is off in this session.'
  + ' Tell the person so in one line and ask them to type /start-foreman themselves, and start no sub session until they have.'

// The fewest and the most slots a parent may have.
export const MIN_SLOTS = 1
export const MAX_SLOTS = 20

export const RANGE = `The slot count must be a whole number from ${MIN_SLOTS} to ${MAX_SLOTS}, so it was left as it was.`

// What /start-foreman <n> answers in a session that was already the parent:
// one sub session in the singular, and every other count in the plural.
export const slotsAnswer = (count: number) => `This parent now runs ${count} sub ${subSessions(count)} at once.`

// What /start-foreman answers when it made the session the parent, or ran
// again in one: with the slot count when one was given, or null. `unplaced` is
// the sentence foreman showed when its open did not place the pane, or null
// when it did, and then the answer no longer says the pane shows the sub
// sessions but gives the sentence and says how to open the pane.
export const becameParentAnswer = (count: number | null, unplaced: string | null = null) => {
  const runs = count === null ? '' : ` and runs ${count} sub ${subSessions(count)} at once`
  const shown = unplaced === null ? 'above the prompt and in its pane.' : `above the prompt. ${unplaced} Pressing the band's head opens the pane.`
  return `This session is now the parent${runs}, and foreman shows its sub sessions ${shown}`
}

const subSessions = (count: number) => (count === 1 ? 'session' : 'sessions')

// What /start-foreman adds to its answer when it passes the person's words on.
export const PASSED_ON = 'It passes the rest of your line to this session as your prompt.'

// `prompt` is what the person typed after the command and the count, which
// the parent's model reads as the person's own prompt once the role is on, or
// null when nothing followed.
export type Command =
  | { kind: 'on'; prompt: string | null }
  | { kind: 'slots'; count: number; prompt: string | null }
  | { kind: 'refused'; text: string }

// The command the arguments ask for. No arguments turn the role on. A first
// word that is a whole number from 1 to 20 also sets the slot count. A first
// word that starts with a digit or a minus sign but is not such a number is
// refused with the range, and nothing else happens, so the words after it are
// not passed on either. Every other word, from the first one that is not the
// count, is the person's prompt for the parent's model, such as "2 clean up
// the worktrees, then start the next two issues".
export function commandOf(args: string): Command {
  const text = (typeof args === 'string' ? args : '').trim()
  if (text === '') return { kind: 'on', prompt: null }
  const raw = text.split(/\s+/)[0]!
  if (!/^[-\d]/.test(raw)) return { kind: 'on', prompt: text }
  const count = Number(raw)
  if (!/^\d+$/.test(raw) || count < MIN_SLOTS || count > MAX_SLOTS) return { kind: 'refused', text: RANGE }
  const rest = text.slice(raw.length).trim()
  return { kind: 'slots', count, prompt: rest === '' ? null : rest }
}

// The text the model reads in place of the start-foreman skill's own text,
// which says the mod is not loaded, once a plain /start-foreman or one with
// only a count has turned foreman on. It gives the top-up count, as topUpCount
// in act.ts works it out from the live ledger, with the same rule as the
// top-up line, or says that the queue is full when the count is 0.
const ON_TEXT = 'foreman: foreman is on, and this session is its parent.'

export const startForemanText = (n: number) => (n > 0
  ? `${ON_TEXT} Top up its queue now, as the foreman:wake skill says: ${topUpSentence(n)}`
  : `${ON_TEXT} Its queue is full, with one waiting sub session for every slot, so start no sub session now; tell the person in one line that foreman is on and its queue is full.`)

// The text in its place when foreman is still off as the skill is read, as
// when the command's hook failed and the engine ran the skill by itself.
export const START_FOREMAN_OFF = 'foreman: /start-foreman did not turn foreman on in this session, so start no sub session; tell the person in one line that foreman did not turn on and that the log in foreman\'s pane may say why.'

// The text in its place when working out the count failed, so that the
// skill's own text never reaches the model while the mod runs.
export const START_FOREMAN_FALLBACK = 'foreman: foreman could not count its queue, so start no sub session on this turn; tell the person in one line that foreman could not count its queue and that their next message lines up more.'
