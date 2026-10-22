import { expect, test } from 'claude-code/testing'

import { PASTED_LINE, RANGE, becameParentAnswer, commandOf, pastedCommandIn, slotsAnswer } from '../hooks/commands'

test('/start-foreman turns the role on, and a whole number from 1 to 20 also sets the slot count', () => {
  expect(commandOf('')).toEqual({ kind: 'on', prompt: null })
  expect(commandOf('   ')).toEqual({ kind: 'on', prompt: null })
  expect(commandOf('3')).toEqual({ kind: 'slots', count: 3, prompt: null })
  expect(commandOf('  20 ')).toEqual({ kind: 'slots', count: 20, prompt: null })
  expect(commandOf('1')).toEqual({ kind: 'slots', count: 1, prompt: null })
})

test('the words after the count, or every word when there is no count, are the prompt for the parent', () => {
  expect(commandOf('2 clean up the worktrees, then start the next 2 "skills" issues')).toEqual({
    kind: 'slots', count: 2, prompt: 'clean up the worktrees, then start the next 2 "skills" issues',
  })
  expect(commandOf('  3   4 ')).toEqual({ kind: 'slots', count: 3, prompt: '4' })
  expect(commandOf('start the next issue')).toEqual({ kind: 'on', prompt: 'start the next issue' })
  expect(commandOf(' pause ')).toEqual({ kind: 'on', prompt: 'pause' })
  expect(commandOf('2\nthen start\n  two issues')).toEqual({ kind: 'slots', count: 2, prompt: 'then start\n  two issues' })
})

test('a count that is not a whole number from 1 to 20 is refused with the range, words after it or not', () => {
  for (const bad of ['0', '21', '2.5', '-1', '1e1', '03x', '0 start two issues', '-2 clean up']) {
    expect(commandOf(bad)).toEqual({ kind: 'refused', text: RANGE })
  }
  expect(RANGE).toContain('from 1 to 20')
})

test('the slots answer says sub session for one and sub sessions for any other count', () => {
  expect(slotsAnswer(1)).toBe('This parent now runs 1 sub session at once.')
  expect(slotsAnswer(2)).toBe('This parent now runs 2 sub sessions at once.')
  expect(becameParentAnswer(1)).toBe('This session is now the parent and runs 1 sub session at once, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(becameParentAnswer(2)).toBe('This session is now the parent and runs 2 sub sessions at once, and foreman shows its sub sessions above the prompt and in its pane.')
})

test('a line that begins with /start-foreman, after white space or opening tags, holds the command as text', () => {
  for (const text of [
    '/start-foreman',
    '/start-foreman 3 start the next three issues',
    '  /start-foreman 2',
    '\t/start-foreman\n',
    'Here is what I typed:\n/start-foreman 3',
    '<pasted_content id="x">/start-foreman 3 clean up',
    '<pasted_content id="x">\n/start-foreman',
    ' <outer><pasted_content id="x"> /start-foreman 2',
  ]) expect(pastedCommandIn(text)).toBe(true)
})

test('the command inside a sentence, glued to other text, longer, or after a closing tag is not held as text', () => {
  for (const text of [
    '',
    'Please run /start-foreman 3 for me.',
    'a/start-foreman',
    '/start-foremanx',
    '/start-foreman-later',
    '`/start-foreman`',
    '</pasted_content>/start-foreman',
    'start-foreman 3',
  ]) expect(pastedCommandIn(text)).toBe(false)
})

test('the pasted line says the command did not run, that foreman is off, and what to do, and begins as foreman\'s lines do', () => {
  expect(PASTED_LINE.startsWith('foreman: ')).toBe(true)
  for (const words of ['/start-foreman', 'did not run', 'foreman is off', 'one line', 'type /start-foreman themselves', 'start no sub session']) {
    expect(PASTED_LINE).toContain(words)
  }
})
