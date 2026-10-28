import { expect, test } from 'claude-code/testing'

import type { ForemanFile } from '../types'
import { STATES } from '../hooks/record'
import {
  afterRead, ageWords, busyCount, byKeyThenFile, chipParts, chipText, fitChips, isProbablyHung, isStale, nextReadDelay, READ_LATER_MS, READ_SOON_MS,
  rowsOf, STALE_MS, STATE_LOOK, untilWords, waitWords,
} from '../hooks/subs'

const MIN = 60_000

const record = (issueKey: string, state: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ sessionId: `s-${issueKey}`, issueKey, state, cwd: `/work/${issueKey}`, ...over })
const kept = (file: string, text: string, mtimeMs: number): ForemanFile => ({ file, text, mtimeMs })

test('a file is stale once it is more than three minutes older than the read', () => {
  expect(STALE_MS).toBe(3 * MIN)
  expect(isStale(0, 3 * MIN + 1000)).toBe(true)
  expect(isStale(0, 3 * MIN + 1)).toBe(true)
  expect(isStale(0, 3 * MIN)).toBe(false)
  expect(isStale(0, 2 * MIN + 59_000)).toBe(false)
  expect(isStale(10 * MIN, 9 * MIN)).toBe(false)
})

test('a read keeps each good file, keeps the last good read of a file that does not parse, and drops a file that left', () => {
  const before = [kept('a.json', record('ABC-1', 'working'), 1), kept('b.json', record('ABC-2', 'idle'), 2), kept('c.json', record('ABC-3', 'done'), 3)]
  const after = afterRead(before, [
    { file: 'b.json', mtimeMs: 20, text: '{"sessionId": "s-ABC-2", "issu' },
    { file: 'a.json', mtimeMs: 10, text: record('ABC-1', 'needs-you') },
    { file: 'd.json', mtimeMs: 40, text: record('ABC-4', 'working') },
    { file: 'e.json', mtimeMs: 50, text: 'not json' },
    { file: 'f.json', mtimeMs: 60, text: null },
  ])
  expect(after).toEqual([
    kept('a.json', record('ABC-1', 'needs-you'), 10),
    kept('b.json', record('ABC-2', 'idle'), 2),
    kept('d.json', record('ABC-4', 'working'), 40),
  ])
})

test('rows are in issue-key order with numbers compared as numbers, keyed by the file name, each judged stale against the read', () => {
  const files = [kept('y.json', record('ABC-10', 'idle', { sessionId: 'other' }), 5 * MIN), kept('z.json', record('ABC-9', 'working'), 0)]
  const rows = rowsOf(files, 6 * MIN)
  expect(rows.map(row => [row.file, row.record.issueKey, row.isStale])).toEqual([['z.json', 'ABC-9', true], ['y.json', 'ABC-10', false]])
  // A row with no issue yet sorts after the keyed rows, by file name.
  const unkeyed = rowsOf([
    kept('b.json', record('ABC-2', 'idle', { issueKey: null }), 0),
    kept('a.json', record('ABC-1', 'idle', { issueKey: null }), 0),
    kept('c.json', record('ABC-3', 'idle'), 0),
  ], 0)
  expect(unkeyed.map(row => row.file)).toEqual(['c.json', 'a.json', 'b.json'])
  // A kept file whose text no longer parses is left out rather than thrown on.
  expect(rowsOf([kept('x.json', '{', 0)], 0)).toEqual([])
})

test('the next read is 30 seconds away after a read with a working file that is not stale, and 2 minutes away otherwise', () => {
  expect(READ_SOON_MS).toBe(30_000)
  expect(READ_LATER_MS).toBe(2 * MIN)
  const at = 10 * MIN
  expect(nextReadDelay(rowsOf([kept('a.json', record('ABC-1', 'working'), at - MIN)], at))).toBe(READ_SOON_MS)
  expect(nextReadDelay(rowsOf([kept('a.json', record('ABC-1', 'working'), at - 4 * MIN)], at))).toBe(READ_LATER_MS)
  expect(nextReadDelay(rowsOf([kept('a.json', record('ABC-1', 'waiting-on-builder'), at)], at))).toBe(READ_LATER_MS)
  expect(nextReadDelay([])).toBe(READ_LATER_MS)
})

test('every listed sub session that is not done counts as busy, stale ones included', () => {
  const rows = rowsOf([
    kept('a.json', record('ABC-1', 'working'), 0),
    kept('b.json', record('ABC-2', 'done'), 10 * MIN),
    kept('c.json', record('ABC-3', 'idle'), 10 * MIN),
  ], 10 * MIN)
  expect(busyCount(rows)).toBe(2)
})

test('every state has its words and its tone: only needs you is red, and only idle and in cleanup are amber', () => {
  expect(Object.keys(STATE_LOOK).sort()).toEqual([...STATES].sort())
  expect(STATE_LOOK['needs-you']).toEqual({ words: 'needs you', tone: 'red' })
  expect(STATE_LOOK.idle).toEqual({ words: 'idle', tone: 'amber' })
  expect(STATE_LOOK['in-cleanup']).toEqual({ words: 'in cleanup', tone: 'amber' })
  expect(STATE_LOOK.working).toEqual({ words: 'working', tone: 'plain' })
  expect(STATE_LOOK['waiting-on-builder']).toEqual({ words: 'waiting on builder', tone: 'plain' })
  expect(STATE_LOOK.done).toEqual({ words: 'done', tone: 'plain' })
})

test('a chip holds the issue key and the stage while working or waiting on builder, else the state, and its age when stale', () => {
  const at = 10 * MIN
  const [working, waiting, idle, stale, unstaged] = rowsOf([
    kept('a.json', record('ABC-1', 'working', { stage: 'build' }), at),
    kept('b.json', record('ABC-2', 'waiting-on-builder', { stage: 'review' }), at),
    kept('c.json', record('ABC-3', 'needs-you', { stage: 'spec' }), at),
    kept('d.json', record('ABC-4', 'working', { stage: 'build' }), at - 5 * MIN - 1000),
    kept('e.json', record('ABC-5', 'working'), at),
  ], at)
  expect(chipText(working!, at)).toBe('ABC-1 build')
  expect(chipText(waiting!, at)).toBe('ABC-2 review rounds')
  expect(chipText(idle!, at)).toBe('ABC-3 needs you')
  expect(chipText(stale!, at + MIN)).toBe('ABC-4 working · no update for 6m')
  expect(chipText(unstaged!, at)).toBe('ABC-5 working')
  // A row with no issue yet says so where the key would go.
  const [unkeyed] = rowsOf([kept('n.json', record('ABC-6', 'working', { issueKey: null, stage: 'grounding' }), at)], at)
  expect(chipText(unkeyed!, at)).toBe('no issue yet grounding')
  // Text in a record is cleaned before it is drawn.
  const [marked] = rowsOf([kept('m.json', record('ABC-\u001b[31m7', 'idle'), at)], at)
  expect(chipText(marked!, at)).toBe('ABC-7 idle')
})

test('a chip splits into its key and the rest, and the two joined by a space are its text', () => {
  const at = 10 * MIN
  const rows = rowsOf([
    kept('a.json', record('ABC-1', 'working', { stage: 'build' }), at),
    kept('d.json', record('ABC-4', 'working', { stage: 'build' }), at - 5 * MIN - 1000),
    kept('n.json', record('ABC-6', 'idle', { issueKey: null }), at),
  ], at)
  expect(chipParts(rows[0]!, at)).toEqual({ key: 'ABC-1', rest: 'build' })
  expect(chipParts(rows[1]!, at + MIN)).toEqual({ key: 'ABC-4', rest: 'working · no update for 6m' })
  expect(chipParts(rows[2]!, at)).toEqual({ key: 'no issue yet', rest: 'idle' })
  for (const row of rows) {
    const { key, rest } = chipParts(row, at)
    expect(chipText(row, at)).toBe(`${key} ${rest}`)
  }
})

test('ages and waits are said in whole units', () => {
  expect(ageWords(3 * MIN + 1000)).toBe('3m')
  expect(ageWords(59 * MIN)).toBe('59m')
  expect(ageWords(61 * MIN)).toBe('1h 1m')
  expect(ageWords(-5)).toBe('0m')
  expect(untilWords(30_000)).toBe('30s')
  expect(untilWords(29_400)).toBe('30s')
  expect(untilWords(2 * MIN)).toBe('2m')
  expect(untilWords(90_000)).toBe('2m')
  expect(untilWords(0)).toBeNull()
})

test('the band shows as many chips as fit its room and says how many more there are', () => {
  const chips = ['ABC-1 build', 'ABC-2 idle', 'ABC-3 spec']
  expect(fitChips(chips, Infinity)).toEqual({ shown: 3, more: 0 })
  expect(fitChips(chips, Number.NaN)).toEqual({ shown: 3, more: 0 })
  // Every chip costs its length and a separator of three.
  expect(fitChips(chips, 14 + 13 + 13)).toEqual({ shown: 3, more: 0 })
  // When not all fit, room is kept for ` · +N more`, which is ten long here.
  expect(fitChips(chips, 14 + 13 + 12)).toEqual({ shown: 2, more: 1 })
  expect(fitChips(chips, 14 + 13 + 10)).toEqual({ shown: 2, more: 1 })
  expect(fitChips(chips, 14 + 13 + 9)).toEqual({ shown: 1, more: 2 })
  expect(fitChips(chips, 5)).toEqual({ shown: 0, more: 3 })
  expect(fitChips([], 5)).toEqual({ shown: 0, more: 0 })
})

test('with many chips at a narrow width, the band shows the most that fit beside the words for the rest', () => {
  // Every chip is five long, so it costs eight cells with its separator.
  const chips = Array.from({ length: 200 }, () => 'ABC-1')
  // Three chips use 24 cells, and ` · +197 more` takes 12 more.
  expect(fitChips(chips, 36)).toEqual({ shown: 3, more: 197 })
  expect(fitChips(chips, 35)).toEqual({ shown: 2, more: 198 })
  expect(fitChips(chips, 11)).toEqual({ shown: 0, more: 200 })
  expect(fitChips(chips, 200 * 8 - 1)).toEqual({ shown: 198, more: 2 })
  expect(fitChips(chips, 200 * 8)).toEqual({ shown: 200, more: 0 })
})

test('rows with an issue key come first in key order, then rows with none, and file names break ties', () => {
  expect(byKeyThenFile(null, 'a.json', 'ABC-1', 'z.json')).toBe(1)
  expect(byKeyThenFile('ABC-1', 'z.json', null, 'a.json')).toBe(-1)
  expect(byKeyThenFile('ABC-1', 'z.json', 'ABC-2', 'a.json')).toBe(-1)
  // The collator counts ABC-01 and ABC-1 as equal; their text decides.
  expect(byKeyThenFile('ABC-01', 'z.json', 'ABC-1', 'a.json')).toBe(-1)
  expect(byKeyThenFile('ABC-1', 'a.json', 'ABC-01', 'z.json')).toBe(1)
  expect(byKeyThenFile('ABC-2', 'a.json', 'ABC-1', 'z.json')).toBe(1)
  expect(byKeyThenFile('ABC-1', 'a.json', 'ABC-1', 'b.json')).toBe(-1)
  expect(byKeyThenFile(null, 'b.json', null, 'a.json')).toBe(1)
  expect(byKeyThenFile(null, 'a.json', null, 'a.json')).toBe(0)
})

test('a read keeps the kept text with the new time for an unchanged text, replaces it for a changed text that parses, and keeps the last good read of a half-written file', () => {
  const a = record('ABC-1', 'working')
  const b = record('ABC-2', 'idle')
  const c = record('ABC-3', 'idle')
  const before = [kept('a.json', a, 1), kept('b.json', b, 2), kept('c.json', c, 3)]
  const changed = record('ABC-3', 'done')
  const after = afterRead(before, [
    { file: 'a.json', mtimeMs: 10, text: a },
    { file: 'b.json', mtimeMs: 20, text: '{"sessionId": "s-ABC-2", "issu' },
    { file: 'c.json', mtimeMs: 30, text: changed },
  ])
  // The unchanged text keeps the kept text, but takes the time this read
  // listed, because a file rewritten with the same text is fresh.
  expect(after[0]).toEqual({ ...before[0]!, mtimeMs: 10 })
  expect(afterRead(after, [{ file: 'a.json', mtimeMs: 10, text: a }])[0]).toBe(after[0])
  // The half-written file keeps its last good read.
  expect(after[1]).toBe(before[1])
  // The changed text that parses replaces the kept entry.
  expect(after[2]).toEqual(kept('c.json', changed, 30))
})

// A fresh working row whose record holds `oldestBackground` as given, read
// as foreman reads a file.
const waitingRow = (oldestBackground: unknown) =>
  rowsOf([kept('a.json', record('ABC-1', 'working', { reason: '1 background task running.', oldestBackground }), 0)], 0)[0]!

test('a row waiting on background work names its oldest task and how long it has run, in builder\'s duration format', () => {
  const startedAt = 10 * MIN
  const row = waitingRow({ description: 'full UI test run', startedAt, hungAt: startedAt + 15 * MIN })
  expect(waitWords(row, startedAt)).toBe('waiting on: full UI test run (0s)')
  expect(waitWords(row, startedAt + 45_000)).toBe('waiting on: full UI test run (45s)')
  expect(waitWords(row, startedAt + 7 * MIN + 40_000)).toBe('waiting on: full UI test run (7m 40s)')
  expect(waitWords(row, startedAt + 65 * MIN)).toBe('waiting on: full UI test run (1h 5m), it may be hung')
})

test('the elapsed time of a background task is never below zero when the clock reads earlier than its start', () => {
  const startedAt = 10 * MIN
  const row = waitingRow({ description: 'full UI test run', startedAt, hungAt: startedAt + 15 * MIN })
  expect(waitWords(row, startedAt - 1)).toBe('waiting on: full UI test run (0s)')
  expect(waitWords(row, 0)).toBe('waiting on: full UI test run (0s)')
})

test('a task\'s description is cleaned before it is drawn, and one that is empty reads as a background task', () => {
  const at = 10 * MIN
  const task = (description: unknown) => waitingRow({ description, startedAt: at, hungAt: at + 15 * MIN })
  expect(waitWords(task('run \u001b[31mthe\u001b[0m\ntests'), at)).toBe('waiting on: run the tests (0s)')
  expect(waitWords(task(''), at)).toBe('waiting on: a background task (0s)')
  expect(waitWords(task(' \u001b[2J '), at)).toBe('waiting on: a background task (0s)')
  expect(waitWords(task(7), at)).toBe('waiting on: a background task (0s)')
  expect(waitWords(task('x'.repeat(100)), at)).toBe(`waiting on: ${'x'.repeat(79)}… (0s)`)
})

test('a row is probably hung from its hung time on and not a millisecond before', () => {
  const startedAt = 10 * MIN
  const hungAt = startedAt + 15 * MIN
  const row = waitingRow({ description: 'full UI test run', startedAt, hungAt })
  expect(isProbablyHung(row, hungAt - 1)).toBe(false)
  expect(waitWords(row, hungAt - 1)).toBe('waiting on: full UI test run (14m 59s)')
  expect(isProbablyHung(row, hungAt)).toBe(true)
  expect(waitWords(row, hungAt)).toBe('waiting on: full UI test run (15m 0s), it may be hung')
  expect(isProbablyHung(row, hungAt + 1)).toBe(true)
})

test('a row whose hung time could not be read is never marked, and a row without a background task has no wait words', () => {
  const startedAt = 10 * MIN
  const unmarked = waitingRow({ description: 'full UI test run', startedAt, hungAt: 'later' })
  expect(unmarked.record.oldestBackground?.hungAt).toBeNull()
  expect(isProbablyHung(unmarked, startedAt + 1000 * MIN)).toBe(false)
  expect(waitWords(unmarked, startedAt + 65 * MIN)).toBe('waiting on: full UI test run (1h 5m)')
  const plain = rowsOf([kept('a.json', record('ABC-1', 'working', { reason: 'building' }), 0)], 0)[0]!
  expect(isProbablyHung(plain, 1000 * MIN)).toBe(false)
  expect(waitWords(plain, 1000 * MIN)).toBeNull()
})
