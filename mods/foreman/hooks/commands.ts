// What the arguments of /start-foreman ask for, read without the engine.

// The command the person types. It is a skill in the person's skills folder
// rather than a command the mod registers, so that the desktop app knows it
// before a session starts. The mod answers it in place of the skill.
export const COMMAND = 'start-foreman'

// The fewest and the most slots a parent may have.
export const MIN_SLOTS = 1
export const MAX_SLOTS = 20

export const RANGE = `The slot count must be a whole number from ${MIN_SLOTS} to ${MAX_SLOTS}, so it was left as it was.`

// What /start-foreman <n> answers in a session that was already the parent:
// one sub session in the singular, and every other count in the plural.
export const slotsAnswer = (count: number) => `This parent now runs ${count} sub ${subSessions(count)} at once.`

// What /start-foreman <n> answers when it also made the session the parent.
export const becameParentAnswer = (count: number) =>
  `This session is now the parent and runs ${count} sub ${subSessions(count)} at once, and foreman shows its sub sessions above the prompt and in its pane.`

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
