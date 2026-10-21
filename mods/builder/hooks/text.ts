// Small text rules shared by the pane, the progress rules, the drawings, the
// counsel and the review package.
// This module imports nothing from the rest of the mod, so every other module
// can import it without making two modules import each other.

// Text a model supplied (a description, a command, a summary line), made safe
// to print: escape sequences are removed whole, other control characters and
// bidirectional overrides are removed, line breaks and tabs become spaces,
// runs of spaces become one, and the result is cut to `max` characters,
// ending with `…` when it was cut.
export function printable(text: string, max = 80): string {
  const plain = (typeof text === 'string' ? text : '')
    // An operating system command (as a link or a title), then any other
    // control sequence, then a lone escape with the character after it.
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]?/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

// How long a foreground call has run, as the line names it: 45s, 1m 7s, 1h 2m.
export function clockTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// A moment as the mod writes it on the line and in `/builder wakes`: the UTC
// time as HH:MM:SS, with the UTC date (YYYY-MM-DD) and a space before it when
// `at` is not on the same UTC day as `now`.
export function timeOfDay(at: number, now: number): string {
  const stamp = new Date(at).toISOString()
  const time = stamp.slice(11, 19)
  return stamp.slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? time : `${stamp.slice(0, 10)} ${time}`
}

// Two texts say the same thing when they are equal once each is trimmed and
// put in lower case. normalText is that one definition. The counsel compares
// its options and follow-ups with it, and the review package compares the
// items already decided with it, so both say the same thing the same way.
export const normalText = (text: string) => text.trim().toLowerCase()
export const sameText = (a: string, b: string) => normalText(a) === normalText(b)

// An area named on a fix commit's Area:, Tidied: or Retag: line, as the
// streaks compare it: in lower case, with each run of spaces made one space,
// and without one trailing full stop, so the same area written with a
// different case or spacing counts as one area.
export const areaKey = (area: string) => area.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '').trim()
