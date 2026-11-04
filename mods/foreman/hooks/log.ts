import type { ForemanLogLine } from '../types'

// The pure helpers behind foreman's log: adding lines, and taking back the
// lines of a report whose notification failed. register.tsx keeps the log in
// the store and writes these results there.

// How many lines the log keeps.
export const LOG_KEPT = 20

// The lines a report wrote to the log before its notification was tried:
// their texts, the time addLogs wrote them at, and for each text the time
// of the line it was counted on, or null when it added a line of its own.
export type LoggedReport = { texts: readonly string[]; at: number; before: readonly (number | null)[] }

// The log with `texts` added at `at`, as withLines says, and for each text
// the time the line it was counted on had before, or null when it added a
// line of its own.
export function loggedLines(lines: readonly ForemanLogLine[], texts: readonly string[], at: number): { lines: ForemanLogLine[]; before: (number | null)[] } {
  let kept = [...lines]
  const before: (number | null)[] = []
  for (const text of texts) {
    const last = kept.at(-1)
    if (last !== undefined && last.text === text) {
      before.push(last.at)
      kept = [...kept.slice(0, -1), { at, text, times: (last.times ?? 1) + 1 }]
    } else {
      before.push(null)
      kept = [...kept, { at, text }].slice(-LOG_KEPT)
    }
  }
  return { lines: kept, before }
}

// The log with `texts` added at `at`: a line the same as the newest one is
// counted on that one rather than added, and only the newest LOG_KEPT lines
// are kept.
export function withLines(lines: readonly ForemanLogLine[], texts: readonly string[], at: number): ForemanLogLine[] {
  return loggedLines(lines, texts, at).lines
}

// The log without the lines that a report `logged`, as showReports wrote its
// sentences before its notification failed. The newest line with each text
// and the report's time is taken out, or, when the text was counted on an
// earlier line, has its count lowered by one and gets back the time that
// line had before. A line already pushed out of the kept lines is skipped.
export function withoutLines(lines: readonly ForemanLogLine[], logged: LoggedReport): ForemanLogLine[] {
  const kept = [...lines]
  const { texts, at, before } = logged
  for (let j = texts.length - 1; j >= 0; j--) {
    const text = texts[j]!
    let i = kept.length - 1
    while (i >= 0 && !(kept[i]!.text === text && kept[i]!.at === at)) i--
    if (i < 0) continue
    const times = kept[i]!.times ?? 1
    if (times === 1) {
      kept.splice(i, 1)
      continue
    }
    const earlier = before[j] ?? at
    kept[i] = times === 2 ? { at: earlier, text } : { at: earlier, text, times: times - 1 }
  }
  return kept
}

// The log after a notice whose notification failed: the report lines it
// `logged`, when it logged any, taken out as withoutLines says, then `added`,
// the reason line when it is the first for its reason and the marked line,
// added at `now` as withLines says. notify writes it in one update.
export function failedNoticeLog(lines: readonly ForemanLogLine[], logged: LoggedReport | undefined, added: readonly string[], now: number): ForemanLogLine[] {
  const without = logged === undefined ? lines : withoutLines(lines, logged)
  return withLines(without, added, now)
}
