// Small text rules shared by the pane and the drawings. This module imports
// nothing from the rest of the mod, so every other module can import it.
//
// printable, clockTime and timeOfDay are copies of the ones in builder's
// hooks/text.ts, because a mod cannot import another plugin's files.
// tests/art.test.ts holds them to what builder's answer, so change them only
// together with builder's.

// Text a record or a tool supplied, made safe to print: escape sequences are
// removed whole, other control characters and bidirectional overrides are
// removed, line breaks and tabs become spaces, runs of spaces become one, and
// the result is cut to `max` characters, ending with `…` when it was cut.
export function printable(text: string, max = 80): string {
  const plain = (typeof text === 'string' ? text : '')
    // An operating system command (as a link or a title), then any other
    // control sequence, then a lone escape with the character after it.
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]?/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

// How long something has run, as builder writes a duration on its line:
// 45s, 1m 7s, 1h 2m. A row says with it how long a sub session's oldest
// background task has run.
export function clockTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// A moment as the log writes it: the UTC time as HH:MM:SS, with the UTC date
// (YYYY-MM-DD) and a space before it when `at` is not on the same UTC day as
// `now`.
export function timeOfDay(at: number, now: number): string {
  const stamp = new Date(at).toISOString()
  const time = stamp.slice(11, 19)
  return stamp.slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? time : `${stamp.slice(0, 10)} ${time}`
}

// Names joined as a sentence lists them: "A", "A and B", "A, B and C".
export const listOf = (names: readonly string[]) => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`)

// A count with its word, plural unless the count is one: "1 minute", "5 minutes".
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// A stored value as an object, or null when it is not one: null and lists are
// not objects here.
export const objectOf = (raw: unknown): Record<string, unknown> | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null)
