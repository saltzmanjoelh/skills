import { expect, test } from 'claude-code/testing'

import { RANGE, USAGE, becameParentAnswer, commandOf, slotsAnswer } from '../hooks/commands'

test('/start-foreman turns the role on, and a whole number from 1 to 20 also sets the slot count', () => {
  expect(commandOf('')).toEqual({ kind: 'on' })
  expect(commandOf('   ')).toEqual({ kind: 'on' })
  expect(commandOf('3')).toEqual({ kind: 'slots', count: 3 })
  expect(commandOf('  20 ')).toEqual({ kind: 'slots', count: 20 })
  expect(commandOf('1')).toEqual({ kind: 'slots', count: 1 })
})

test('a count that is not a whole number from 1 to 20 is refused with the range, and anything else with the usage', () => {
  for (const bad of ['0', '21', '2.5', '-1', '1e1', '03x']) {
    expect(commandOf(bad)).toEqual({ kind: 'refused', text: RANGE })
  }
  for (const bad of ['x', '3 4', 'slots 3', 'pause', 'resume']) expect(commandOf(bad)).toEqual({ kind: 'refused', text: USAGE })
  expect(RANGE).toContain('from 1 to 20')
  expect(USAGE).toContain('/start-foreman <n>')
})

test('the slots answer says sub session for one and sub sessions for any other count', () => {
  expect(slotsAnswer(1)).toBe('This parent now runs 1 sub session at once.')
  expect(slotsAnswer(2)).toBe('This parent now runs 2 sub sessions at once.')
  expect(becameParentAnswer(1)).toBe('This session is now the parent and runs 1 sub session at once, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(becameParentAnswer(2)).toBe('This session is now the parent and runs 2 sub sessions at once, and foreman shows its sub sessions above the prompt and in its pane.')
})
