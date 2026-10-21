// What the arguments of /start-foreman ask for, read without the engine.

// The command the person types. It is a skill in the person's skills folder
// rather than a command the mod registers, so that the desktop app knows it
// before a session starts. The mod answers it in place of the skill.
export const COMMAND = 'start-foreman'

// The fewest and the most slots a parent may have.
export const MIN_SLOTS = 1
export const MAX_SLOTS = 20

export const USAGE = `Use /${COMMAND} to make this session the parent, or /${COMMAND} <n> to do the same and set how many sub sessions it runs at once.`
export const RANGE = `The slot count must be a whole number from ${MIN_SLOTS} to ${MAX_SLOTS}, so it was left as it was.`

// What /start-foreman <n> answers in a session that was already the parent:
// one sub session in the singular, and every other count in the plural.
export const slotsAnswer = (count: number) => `This parent now runs ${count} sub ${subSessions(count)} at once.`

// What /start-foreman <n> answers when it also made the session the parent.
export const becameParentAnswer = (count: number) =>
  `This session is now the parent and runs ${count} sub ${subSessions(count)} at once, and foreman shows its sub sessions above the prompt and in its pane.`

const subSessions = (count: number) => (count === 1 ? 'session' : 'sessions')

export type Command =
  | { kind: 'on' }
  | { kind: 'slots'; count: number }
  | { kind: 'refused'; text: string }

// The command the arguments ask for. No arguments turn the role on. One word
// that is a whole number from 1 to 20 also sets the slot count. A word that
// starts with a digit but is not such a number is refused with the range, and
// any other form is refused with the usage.
export function commandOf(args: string): Command {
  const words = (typeof args === 'string' ? args : '').trim().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return { kind: 'on' }
  const raw = words[0]!
  if (words.length > 1 || !/^[-\d]/.test(raw)) return { kind: 'refused', text: USAGE }
  const count = Number(raw)
  if (!/^\d+$/.test(raw) || count < MIN_SLOTS || count > MAX_SLOTS) return { kind: 'refused', text: RANGE }
  return { kind: 'slots', count }
}
