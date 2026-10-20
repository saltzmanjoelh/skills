// What the arguments of /foreman ask for, read without the engine.

// The fewest and the most slots a parent may have.
export const MIN_SLOTS = 1
export const MAX_SLOTS = 20

export const USAGE = 'Use /foreman to make this session the parent, /foreman slots <n> to set how many sub sessions it runs at once, and /foreman pause or /foreman resume to pause or resume it.'
export const RANGE = `The slot count must be a whole number from ${MIN_SLOTS} to ${MAX_SLOTS}, so it was left as it was.`

export type Command =
  | { kind: 'on' }
  | { kind: 'slots'; count: number }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'refused'; text: string }

// The command the arguments ask for. No arguments turn the role on. A slots
// count that is not a whole number from 1 to 20 is refused with the range,
// and any other form is refused with the usage.
export function commandOf(args: string): Command {
  const words = (typeof args === 'string' ? args : '').trim().split(/\s+/).filter(word => word !== '')
  const [verb, ...rest] = words
  if (verb === undefined) return { kind: 'on' }
  if (verb === 'slots' && rest.length === 1) {
    const raw = rest[0]!
    const count = Number(raw)
    if (!/^\d+$/.test(raw) || count < MIN_SLOTS || count > MAX_SLOTS) return { kind: 'refused', text: RANGE }
    return { kind: 'slots', count }
  }
  if (verb === 'pause' && rest.length === 0) return { kind: 'pause' }
  if (verb === 'resume' && rest.length === 0) return { kind: 'resume' }
  return { kind: 'refused', text: USAGE }
}
