import { expect, test } from 'claude-code/testing'

import { afterPackage, afterPr, afterReview, afterStage, afterState, emptyTiming, recordTiming, ROUNDS_KEPT, statesAt, timingIn, timingLines } from '../hooks/timing'
import type { TimingLedger } from '../types'

const T0 = 1_000_000_000
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const TITLE = 'ABC-123 a change'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

const fresh = () => emptyTiming('session-1', T0)
const zeroStates = { working: 0, 'waiting-on-builder': 0, idle: 0, 'needs-you': 0, 'in-cleanup': 0, done: 0 }
const open = { repo: 'o/r', number: 7, state: 'OPEN' as const }
const merged = { repo: 'o/r', number: 7, state: 'MERGED' as const }

test('an empty record starts at the time given, with nothing stamped and no state open', () => {
  const t = fresh()
  expect(t.startedAt).toBe(T0)
  expect(t.stages).toEqual([])
  expect(t.state).toBe(null)
  expect(statesAt(t, T0 + HOUR)).toEqual(zeroStates)
})

test('a stage reported twice keeps its first stamp, and the same report hands back the same record', () => {
  const once = afterStage(fresh(), TITLE, 'spec', T0 + MINUTE)
  const again = afterStage(once, TITLE, 'spec', T0 + 2 * MINUTE)
  expect(again).toBe(once)
  const next = afterStage(once, TITLE, 'plan', T0 + 3 * MINUTE)
  expect(next.stages).toEqual([{ stage: 'spec', at: T0 + MINUTE }, { stage: 'plan', at: T0 + 3 * MINUTE }])
  expect(next.title).toBe(TITLE)
})

test('a new title starts a new set of stages', () => {
  const first = afterStage(afterStage(fresh(), TITLE, 'spec', T0 + MINUTE), TITLE, 'plan', T0 + 2 * MINUTE)
  const second = afterStage(first, 'ABC-123 another change', 'grounding', T0 + HOUR)
  expect(second.title).toBe('ABC-123 another change')
  expect(second.stages).toEqual([{ stage: 'grounding', at: T0 + HOUR }])
})

test('the pull request\'s opening and merge are stamped by the first reading that sees each, and later readings change nothing', () => {
  const opened = afterPr(fresh(), open, T0 + MINUTE)
  expect(opened.prOpenedAt).toBe(T0 + MINUTE)
  expect(afterPr(opened, open, T0 + 2 * MINUTE)).toBe(opened)
  const done = afterPr(opened, merged, T0 + HOUR)
  expect(done.prOpenedAt).toBe(T0 + MINUTE)
  expect(done.prMergedAt).toBe(T0 + HOUR)
  expect(afterPr(done, merged, T0 + 2 * HOUR)).toBe(done)
})

test('a pull request first seen merged gets a merge stamp and no opening stamp', () => {
  const t = afterPr(fresh(), merged, T0 + MINUTE)
  expect(t.prOpenedAt).toBe(null)
  expect(t.prMergedAt).toBe(T0 + MINUTE)
})

test('a different pull request replaces the stored one and resets both stamps', () => {
  const first = afterPr(fresh(), open, T0 + MINUTE)
  const other = afterPr(first, { repo: 'o/r', number: 8, state: 'OPEN' }, T0 + 2 * MINUTE)
  expect(other.pr).toEqual({ repo: 'o/r', number: 8 })
  expect(other.prOpenedAt).toBe(T0 + 2 * MINUTE)
  expect(other.prMergedAt).toBe(null)
})

test('the first state opened counts from the record\'s start, so the totals add up to the elapsed time', () => {
  const t = afterState(fresh(), 'idle', T0 + 10 * MINUTE)
  expect(t.state).toBe('idle')
  expect(statesAt(t, T0 + 10 * MINUTE).idle).toBe(10 * MINUTE)
  const working = afterState(t, 'working', T0 + 30 * MINUTE)
  const totals = statesAt(working, T0 + HOUR)
  expect(totals).toEqual({ ...zeroStates, idle: 30 * MINUTE, working: 30 * MINUTE })
  expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(HOUR)
})

test('a state change adds the stretch to the outgoing state\'s total and moves the start in the one record it hands back', () => {
  const t = afterState(afterState(fresh(), 'working', T0), 'needs-you', T0 + 20 * MINUTE)
  expect(t.states.working).toBe(20 * MINUTE)
  expect(t.state).toBe('needs-you')
  expect(t.stateSince).toBe(T0 + 20 * MINUTE)
  expect(t.states['needs-you']).toBe(0)
  expect(statesAt(t, T0 + 25 * MINUTE)['needs-you']).toBe(5 * MINUTE)
})

test('the open state again hands back the same record, so a rerun counts nothing twice', () => {
  const t = afterState(fresh(), 'working', T0 + MINUTE)
  expect(afterState(t, 'working', T0 + HOUR)).toBe(t)
})

test('the totals stop growing after the merge, and a state change after it changes nothing', () => {
  const working = afterState(fresh(), 'working', T0)
  const done = afterPr(afterPr(working, open, T0 + MINUTE), merged, T0 + HOUR)
  expect(statesAt(done, T0 + HOUR)).toEqual({ ...zeroStates, working: HOUR })
  expect(statesAt(done, T0 + 5 * HOUR)).toEqual({ ...zeroStates, working: HOUR })
  expect(afterState(done, 'in-cleanup', T0 + 2 * HOUR)).toBe(done)
})

test('a different pull request after a merged one resumes the clock from now without counting the frozen stretch', () => {
  const working = afterState(fresh(), 'working', T0)
  const done = afterPr(working, merged, T0 + HOUR)
  const resumed = afterPr(done, { repo: 'o/r', number: 8, state: 'OPEN' }, T0 + 3 * HOUR)
  expect(resumed.prMergedAt).toBe(null)
  expect(statesAt(resumed, T0 + 4 * HOUR)).toEqual({ ...zeroStates, working: 2 * HOUR })
})

test('a clock that goes back never makes a total fall', () => {
  const t = afterState(afterState(fresh(), 'working', T0), 'idle', T0 + HOUR)
  const back = afterState(t, 'working', T0 + 30 * MINUTE)
  expect(back.states).toEqual({ ...zeroStates, working: HOUR })
  expect(statesAt(back, T0)).toEqual({ ...zeroStates, working: HOUR })
})

test('a round runs from the first package call to post_review, and a second package call for the same head starts nothing', () => {
  const packaged = afterPackage(fresh(), A, T0 + MINUTE)
  expect(afterPackage(packaged, A, T0 + 2 * MINUTE)).toBe(packaged)
  const reviewed = afterReview(packaged, A, T0 + 20 * MINUTE)
  expect(reviewed.rounds).toEqual([{ head: A, startedAt: T0 + MINUTE, endedAt: T0 + 20 * MINUTE, ended: 'reviewed' }])
  expect(afterPackage(reviewed, A, T0 + 30 * MINUTE)).toBe(reviewed)
})

test('a head replaced before its review is closed as superseded at the next package call', () => {
  const t = afterPackage(afterPackage(fresh(), A, T0 + MINUTE), B, T0 + 10 * MINUTE)
  expect(t.rounds).toEqual([
    { head: A, startedAt: T0 + MINUTE, endedAt: T0 + 10 * MINUTE, ended: 'superseded' },
    { head: B, startedAt: T0 + 10 * MINUTE, endedAt: null, ended: null },
  ])
})

test('a superseded round never ends before it began, even when the clock goes back', () => {
  const t = afterPackage(afterPackage(fresh(), A, T0 + 10 * MINUTE), B, T0 + MINUTE)
  expect(t.rounds[0]).toEqual({ head: A, startedAt: T0 + 10 * MINUTE, endedAt: T0 + 10 * MINUTE, ended: 'superseded' })
})

test('a review posted at a head that was never packaged adds a zero-length entry marked carried over', () => {
  const reviewed = afterReview(afterPackage(fresh(), A, T0 + MINUTE), A, T0 + 10 * MINUTE)
  const carried = afterReview(reviewed, B, T0 + HOUR)
  expect(carried.rounds.at(-1)).toEqual({ head: B, startedAt: T0 + HOUR, endedAt: T0 + HOUR, ended: 'carried-over' })
})

test('a review carried over at a superseded head adds a zero-length entry too', () => {
  const t = afterPackage(afterPackage(fresh(), A, T0 + MINUTE), B, T0 + 10 * MINUTE)
  const carried = afterReview(t, A, T0 + 20 * MINUTE)
  expect(carried.rounds.at(-1)).toEqual({ head: A, startedAt: T0 + 20 * MINUTE, endedAt: T0 + 20 * MINUTE, ended: 'carried-over' })
})

test('past 20 entries the oldest drop and the count of older rounds grows', () => {
  let t = fresh()
  for (let i = 0; i < ROUNDS_KEPT + 3; i += 1) t = afterPackage(t, `${i}`.padStart(40, '0'), T0 + i * MINUTE)
  expect(t.rounds.length).toBe(ROUNDS_KEPT)
  expect(t.olderRounds).toBe(3)
  expect(t.rounds[0]?.head).toBe('3'.padStart(40, '0'))
})

test('a sound record reads back as itself, and one damaged in any part or kept for another session reads as none', () => {
  const t = afterReview(afterPackage(afterPr(afterState(afterStage(fresh(), TITLE, 'spec', T0 + 1), 'working', T0 + 2), open, T0 + 3), A, T0 + 4), A, T0 + 5)
  const stored = JSON.parse(JSON.stringify(t)) as unknown
  expect(timingIn(stored, 'session-1')).toEqual(t)
  expect(timingIn(stored, 'session-2')).toBe(null)
  expect(timingIn('garbage', 'session-1')).toBe(null)
  expect(timingIn(null, 'session-1')).toBe(null)
  const damaged = (over: Partial<Record<keyof TimingLedger, unknown>>) => timingIn({ ...t, ...over }, 'session-1')
  expect(damaged({ startedAt: 'soon' })).toBe(null)
  expect(damaged({ stages: [{ stage: 'nowhere', at: 1 }] })).toBe(null)
  expect(damaged({ states: { ...zeroStates, working: -1 } })).toBe(null)
  expect(damaged({ states: { working: 0 } })).toBe(null)
  expect(damaged({ state: 'asleep' })).toBe(null)
  expect(damaged({ rounds: [{ head: A, startedAt: 1, endedAt: null, ended: 'reviewed' }] })).toBe(null)
  expect(damaged({ rounds: [{ head: A, startedAt: 1, endedAt: 2, ended: 'lost' }] })).toBe(null)
  expect(damaged({ rounds: [{ head: A, startedAt: 1, endedAt: 2, ended: null }] })).toBe(null)
  expect(damaged({ olderRounds: 1.5 })).toBe(null)
  expect(damaged({ pr: { repo: 'o/r' } })).toBe(null)
  expect(damaged({ title: 7 })).toBe(null)
})

test('the status file\'s field holds the stamps, the rounds and the totals as of the time given', () => {
  const t = afterPackage(afterState(afterStage(fresh(), TITLE, 'spec', T0 + MINUTE), 'working', T0 + MINUTE), A, T0 + 2 * MINUTE)
  expect(recordTiming(t, T0 + HOUR)).toEqual({
    startedAt: T0,
    stages: [{ stage: 'spec', at: T0 + MINUTE }],
    prOpenedAt: null,
    prMergedAt: null,
    states: { ...zeroStates, working: HOUR },
    rounds: [{ head: A, startedAt: T0 + 2 * MINUTE, endedAt: null, ended: null }],
    olderRounds: 0,
  })
})

test('the pane\'s lines give the elapsed time split by state, the stages with their times, the pull request and each round, an open round counting up', () => {
  let t = afterStage(fresh(), TITLE, 'spec', T0 + MINUTE)
  t = afterState(t, 'working', T0 + 10 * MINUTE)
  t = afterState(t, 'needs-you', T0 + 40 * MINUTE)
  t = afterState(t, 'idle', T0 + 50 * MINUTE)
  t = afterPr(t, open, T0 + 20 * MINUTE)
  t = afterPackage(t, A, T0 + 30 * MINUTE)
  t = afterReview(t, A, T0 + 45 * MINUTE)
  t = afterPackage(t, B, T0 + 55 * MINUTE)
  const at = (offset: number) => new Date(T0 + offset).toISOString().slice(11, 19)
  expect(timingLines(t, T0 + HOUR)).toEqual([
    'Time: 1h 0m so far · working 40m 0s, waiting on you 10m 0s, other waiting 10m 0s',
    `  Stages: spec at ${at(MINUTE)}`,
    `  Pull request: opened at ${at(20 * MINUTE)}, not merged yet`,
    '  Round at aaaaaaaa: 15m 0s, reviewed',
    '  Round at bbbbbbbb: 5m 0s so far, open',
  ])
})

test('after the merge the elapsed time runs from start to merge', () => {
  let t = afterState(fresh(), 'working', T0)
  t = afterPr(afterPr(t, open, T0 + MINUTE), merged, T0 + 2 * HOUR)
  const at = (offset: number) => new Date(T0 + offset).toISOString().slice(11, 19)
  const lines = timingLines(t, T0 + 5 * HOUR)
  expect(lines[0]).toBe('Time: 2h 0m from start to merge · working 2h 0m, waiting on you 0s, other waiting 0s')
  expect(lines[1]).toBe(`  Pull request: opened at ${at(MINUTE)}, merged at ${at(2 * HOUR)}`)
})

test('in a session without a foreman ticket the split is shown as not kept, never as zero', () => {
  const lines = timingLines(fresh(), T0 + 30 * MINUTE)
  expect(lines).toEqual(['Time: 30m 0s so far · the split by state is kept only for a foreman ticket'])
})

test('older rounds are counted on a line of their own, and no record says nothing is counted yet', () => {
  let t = fresh()
  for (let i = 0; i < ROUNDS_KEPT + 2; i += 1) t = afterPackage(t, `${i}`.padStart(40, '0'), T0 + i * MINUTE)
  expect(timingLines(t, T0 + HOUR)).toContain('  2 older rounds not shown')
  expect(timingLines(null, T0)).toEqual(['Time: not counted yet'])
})

test('a carried-over round and a superseded one say how they ended', () => {
  let t = afterPackage(afterPackage(fresh(), A, T0), B, T0 + MINUTE)
  t = afterReview(t, C, T0 + 2 * MINUTE)
  const lines = timingLines(t, T0 + HOUR)
  expect(lines).toContain('  Round at aaaaaaaa: 1m 0s, superseded')
  // The review at another head closes the round still open, since a push
  // replaced its head before any review of it.
  expect(lines).toContain('  Round at bbbbbbbb: 1m 0s, superseded')
  expect(lines).toContain('  Round at cccccccc: 0s, carried over')
})
