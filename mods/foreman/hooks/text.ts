// Small text rules shared by the pane and the drawings. This module imports
// nothing from the rest of the mod, so every other module can import it.
//
// Both functions are copies of the ones in builder's hooks/text.ts, because a
// mod cannot import another plugin's files. tests/art.test.ts holds them to
// what builder's answer, so change them only together with builder's.

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

// A moment as the log writes it: the UTC time as HH:MM:SS, with the UTC date
// (YYYY-MM-DD) and a space before it when `at` is not on the same UTC day as
// `now`.
export function timeOfDay(at: number, now: number): string {
  const stamp = new Date(at).toISOString()
  const time = stamp.slice(11, 19)
  return stamp.slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? time : `${stamp.slice(0, 10)} ${time}`
}
