// The rules of the sub sessions the band and the pane show: what a read of
// the status folder leaves in place, when a file is stale, when the next read
// comes, how many slots are busy, how each state looks, and how many chips fit
// the band. Nothing here draws; hooks/pane.tsx does. Every function is pure,
// so the tests can check each rule without the engine.

import type { ForemanFile } from '../types'
import { recordIn, type BuildStatus, type BuildState } from './record'
import { stageLabel } from './stages'
import { printable } from './text'

// How old a file may be, against the read that listed it, before it is
// stale: three minutes.
export const STALE_MS = 3 * 60_000

// Whether a file modified at `mtimeMs` is stale at a read made at `at`.
export const isStale = (mtimeMs: number, at: number) => at - mtimeMs > STALE_MS

// How long after a read the next one comes: soon while a sub session is
// working and its file is fresh, and later otherwise.
export const READ_SOON_MS = 30_000
export const READ_LATER_MS = 2 * 60_000

// One file as a read found it: its name, its modification time as the
// listing gave it, and its text, or null when it could not be read.
export type FileRead = { file: string; mtimeMs: number; text: string | null }

// What a read leaves in place: for each file the read found, its new text
// when that parses as a record, else the last good read of it when there is
// one. A file the read did not find leaves, and a file that never parsed is
// not kept. The result is in file name order.
export function afterRead(kept: readonly ForemanFile[], found: readonly FileRead[]): ForemanFile[] {
  const before = new Map(kept.map(entry => [entry.file, entry]))
  const next: ForemanFile[] = []
  for (const f of found) {
    if (f.text !== null && recordIn(f.text) !== null) next.push({ file: f.file, text: f.text, mtimeMs: f.mtimeMs })
    else {
      const last = before.get(f.file)
      if (last !== undefined) next.push(last)
    }
  }
  return next.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

// One sub session as the band and the pane show it. It is keyed by the name
// of its file, whatever session id the record holds.
export type SubRow = { file: string; record: BuildStatus; mtimeMs: number; isStale: boolean }

// The rows for the kept files, judged stale against the read made at
// `readAt`, in issue-key order and then file name order, with the rows that
// have no issue yet after every row that has one. A kept text that no
// longer parses, as one an older build kept might not, is left out.
export function rowsOf(files: readonly ForemanFile[], readAt: number): SubRow[] {
  const rows: SubRow[] = []
  for (const f of files) {
    const record = recordIn(f.text)
    if (record !== null) rows.push({ file: f.file, record, mtimeMs: f.mtimeMs, isStale: isStale(f.mtimeMs, readAt) })
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const keyOrder = (a: string | null, b: string | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : order(a, b))
  return rows.sort((a, b) => keyOrder(a.record.issueKey, b.record.issueKey) || order(a.file, b.file))
}

// How long until the next read, given the rows the read found.
export function nextReadDelay(rows: readonly SubRow[]): number {
  return rows.some(row => row.record.state === 'working' && !row.isStale) ? READ_SOON_MS : READ_LATER_MS
}

// How many slots are busy: every listed sub session whose state is not done,
// stale ones included.
export const busyCount = (rows: readonly SubRow[]) => rows.filter(row => row.record.state !== 'done').length

// How a state is shown: red, amber, or the plain text color.
export type Tone = 'red' | 'amber' | 'plain'

// Every state's words and tone. It is typed over every state, so a state
// added to the record fails the type check until it has an entry here.
export const STATE_LOOK: Record<BuildState, { words: string; tone: Tone }> = {
  'working': { words: 'working', tone: 'plain' },
  'waiting-on-builder': { words: 'waiting on builder', tone: 'plain' },
  'idle': { words: 'idle', tone: 'amber' },
  'needs-you': { words: 'needs you', tone: 'red' },
  'in-cleanup': { words: 'in cleanup', tone: 'amber' },
  'done': { words: 'done', tone: 'plain' },
}

// An age in whole minutes, or hours and minutes from an hour on.
export function ageWords(ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60_000), 0)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// How long until a time `ms` away, in whole seconds under a minute and whole
// minutes from then on, each rounded up. Null once the time has come.
export function untilWords(ms: number): string | null {
  if (!(ms > 0)) return null
  return ms < 60_000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60_000)}m`
}

// How long a sub session's file has gone without an update, as a stale row
// says it.
export const staleWords = (row: SubRow, now: number) => `no update for ${ageWords(now - row.mtimeMs)}`

// What a row with no issue yet shows where the key would go.
export const NO_ISSUE = 'no issue yet'

// The issue key, cleaned, as every row and chip shows it, or the words for a
// row with no issue yet.
export const keyOf = (row: SubRow) => (row.record.issueKey === null ? NO_ISSUE : printable(row.record.issueKey, 40))

// How a sentence names a row: by its issue key, cleaned, or as the sub
// session with no issue yet.
export const nameOf = (row: SubRow) => (row.record.issueKey === null ? `the sub session with ${NO_ISSUE}` : keyOf(row))

// A chip's text: the issue key, then the stage while the sub session works or
// waits on builder and has reported one, else the state in words. A stale
// chip shows its last state and how long it has gone without an update.
export function chipText(row: SubRow, now: number): string {
  const { state, stage } = row.record
  const words = STATE_LOOK[state].words
  if (row.isStale) return `${keyOf(row)} ${words} · ${staleWords(row, now)}`
  const isMoving = state === 'working' || state === 'waiting-on-builder'
  return `${keyOf(row)} ${isMoving && stage !== null ? stageLabel(stage) : words}`
}

// The separator between the band's parts.
export const SEPARATOR = ' · '

// The words that end a band whose chips did not all fit.
export const moreWords = (more: number) => `+${more} more`

// How many of the chips fit `room` cells, each costing its length and a
// separator, and how many are left over. When they do not all fit, room is
// kept for the separator and `+N more`. When the room is not a number, every
// chip is shown.
export function fitChips(chips: readonly string[], room: number): { shown: number; more: number } {
  const n = chips.length
  if (typeof room !== 'number' || !Number.isFinite(room)) return { shown: n, more: 0 }
  const costs = chips.map(chip => chip.length + SEPARATOR.length)
  const total = costs.reduce((sum, cost) => sum + cost, 0)
  if (total <= room) return { shown: n, more: 0 }
  for (let shown = n - 1; shown > 0; shown--) {
    const used = costs.slice(0, shown).reduce((sum, cost) => sum + cost, 0) + SEPARATOR.length + moreWords(n - shown).length
    if (used <= room) return { shown, more: n - shown }
  }
  return { shown: 0, more: n }
}
