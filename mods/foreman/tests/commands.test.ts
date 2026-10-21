import { expect, test } from 'claude-code/testing'

import { RANGE, USAGE, commandOf, slotsAnswer } from '../hooks/commands'

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

test('the slots answer says sub session for one and sub sessions for any other count', () => {
  expect(slotsAnswer(1)).toBe('This parent now runs 1 sub session at once.')
  expect(slotsAnswer(2)).toBe('This parent now runs 2 sub sessions at once.')
})
