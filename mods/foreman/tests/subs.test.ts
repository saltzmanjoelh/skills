import { expect, test } from 'claude-code/testing'

import type { ForemanFile } from '../types'
import { RANGE, USAGE, commandOf } from '../hooks/commands'
import { STATES } from '../hooks/record'
import {
  afterRead, ageWords, busyCount, chipText, fitChips, isStale, nextReadDelay, READ_LATER_MS, READ_SOON_MS, rowsOf,
  STALE_MS, STATE_LOOK, untilWords,
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

test('rows are in issue-key order, keyed by the file name, each judged stale against the read', () => {
  const files = [kept('z.json', record('ABC-9', 'working'), 0), kept('y.json', record('ABC-10', 'idle', { sessionId: 'other' }), 5 * MIN)]
  const rows = rowsOf(files, 6 * MIN)
  expect(rows.map(row => [row.file, row.record.issueKey, row.isStale])).toEqual([['y.json', 'ABC-10', false], ['z.json', 'ABC-9', true]])
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
  // Text in a record is cleaned before it is drawn.
  const [marked] = rowsOf([kept('m.json', record('ABC-\u001b[31m7', 'idle'), at)], at)
  expect(chipText(marked!, at)).toBe('ABC-7 idle')
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

test('/foreman turns the role on, slots takes a whole number from 1 to 20, and pause and resume set and clear the pause', () => {
  expect(commandOf('')).toEqual({ kind: 'on' })
  expect(commandOf('   ')).toEqual({ kind: 'on' })
  expect(commandOf('slots 3')).toEqual({ kind: 'slots', count: 3 })
  expect(commandOf('  slots   20 ')).toEqual({ kind: 'slots', count: 20 })
  expect(commandOf('slots 1')).toEqual({ kind: 'slots', count: 1 })
  expect(commandOf('pause')).toEqual({ kind: 'pause' })
  expect(commandOf('resume')).toEqual({ kind: 'resume' })
})

test('a slots count that is not a whole number from 1 to 20 is refused with the range, and anything else with the usage', () => {
  for (const bad of ['slots 0', 'slots 21', 'slots 2.5', 'slots x', 'slots -1', 'slots 1e1', 'slots 03x']) {
    expect(commandOf(bad)).toEqual({ kind: 'refused', text: RANGE })
  }
  for (const bad of ['slots', 'slots 3 4', 'pause now', 'start', 'resume 2']) expect(commandOf(bad)).toEqual({ kind: 'refused', text: USAGE })
  expect(RANGE).toContain('from 1 to 20')
})
