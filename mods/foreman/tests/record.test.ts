import { expect, test } from 'claude-code/testing'

import { prStateOf, recordIn, STATES, verdictsIn, type SubRecord } from '../hooks/record'

// A whole record as builder writes it, which each test changes.
const WHOLE = {
  sessionId: 'session-a',
  ticket: 'ticket-1',
  desktopSessionId: 'local_a',
  cwd: '/work/a',
  issueKey: 'ABC-123',
  issueTitle: 'Make the thing',
  stage: 'build',
  stageDone: 4,
  pr: { repo: 'acme/example-app', number: 12, state: 'open', checks: 'passed', verdicts: { sha: 'f'.repeat(40), spec: 'APPROVE', adversarial: 'REQUEST_CHANGES' } },
  state: 'working',
  reason: 'building',
  stateSince: 1000,
  writtenAt: 2000,
}

const text = (over: Record<string, unknown> = {}, drop: string[] = []) => {
  const fields: Record<string, unknown> = { ...WHOLE, ...over }
  for (const name of drop) delete fields[name]
  return JSON.stringify(fields)
}

test('a whole record reads back field for field', () => {
  const expected: SubRecord = { ...WHOLE, pr: { ...WHOLE.pr, verdicts: { sha: 'f'.repeat(40), spec: 'APPROVE', adversarial: 'REQUEST_CHANGES' } }, stage: 'build', state: 'working' }
  expect(recordIn(text())).toEqual(expected)
})

test('text that is not a JSON object does not parse', () => {
  for (const bad of ['', '{', '{"sessionId": "a", "issueKey": ', 'null', '[]', '3', '"text"']) expect(recordIn(bad)).toBeNull()
})

test('a record without a session id, an issue key field or a known state does not parse', () => {
  expect(recordIn(text({}, ['sessionId']))).toBeNull()
  expect(recordIn(text({ sessionId: '' }))).toBeNull()
  expect(recordIn(text({ sessionId: 7 }))).toBeNull()
  expect(recordIn(text({}, ['issueKey']))).toBeNull()
  expect(recordIn(text({ issueKey: '' }))).toBeNull()
  expect(recordIn(text({ issueKey: '   ' }))).toBeNull()
  expect(recordIn(text({ issueKey: 12 }))).toBeNull()
  expect(recordIn(text({}, ['state']))).toBeNull()
  expect(recordIn(text({ state: 'gone' }))).toBeNull()
  expect(recordIn(text({ state: 'WORKING' }))).toBeNull()
})

test('a null issue key, as before the first progress report, parses with an empty title', () => {
  const r = recordIn(text({ issueKey: null, issueTitle: '' }))
  expect(r?.issueKey).toBeNull()
  expect(r?.issueTitle).toBe('')
  expect(r?.sessionId).toBe('session-a')
})

test('each of the six states parses', () => {
  expect([...STATES]).toEqual(['working', 'waiting-on-builder', 'idle', 'needs-you', 'in-cleanup', 'done'])
  for (const state of STATES) expect(recordIn(text({ state }))?.state).toBe(state)
})

test('every other field falls back to a safe default when it is missing or of the wrong type', () => {
  const bare = recordIn(JSON.stringify({ sessionId: 's', issueKey: 'ABC-123', state: 'idle' }))
  expect(bare).toEqual({
    sessionId: 's', ticket: null, cwd: null, issueKey: 'ABC-123', issueTitle: '', stage: null, stageDone: 0,
    pr: null, state: 'idle', reason: '', stateSince: null, writtenAt: null,
  })
  const wrong = recordIn(text({
    ticket: 3, desktopSessionId: 4, cwd: [], issueTitle: {}, stage: 7, stageDone: 'four', pr: 'twelve',
    reason: null, stateSince: 'then', writtenAt: Number.MAX_VALUE * 2,
  }))
  expect(wrong).toEqual({ ...bare, sessionId: 'session-a', state: 'working' })
})

test('an empty desktop session id or folder counts as none', () => {
  const r = recordIn(text({ desktopSessionId: '', cwd: '' }))
  expect(r?.desktopSessionId).toBeUndefined()
  expect(r?.cwd).toBeNull()
})

test('a stage outside builder\'s nine reads as none, and the stages done are held between 0 and 9', () => {
  expect(recordIn(text({ stage: 'deploy' }))?.stage).toBeNull()
  expect(recordIn(text({ stage: null }))?.stage).toBeNull()
  expect(recordIn(text({ stageDone: 12 }))?.stageDone).toBe(9)
  expect(recordIn(text({ stageDone: -3 }))?.stageDone).toBe(0)
  expect(recordIn(text({ stageDone: 3.7 }))?.stageDone).toBe(3)
  expect(recordIn(text({ stageDone: Number.NaN }))?.stageDone).toBe(0)
})

test('a pull request needs a whole number, and its state and checks fall back to unknown', () => {
  expect(recordIn(text({ pr: null }))?.pr).toBeNull()
  expect(recordIn(text({ pr: { number: 1.5, state: 'open', checks: 'passed' } }))?.pr).toBeNull()
  expect(recordIn(text({ pr: { number: 0, state: 'open', checks: 'passed' } }))?.pr).toBeNull()
  expect(recordIn(text({ pr: { number: 9 } }))?.pr).toEqual({ repo: '', number: 9, state: 'unknown', checks: 'unknown', verdicts: null })
})

test('a verdict pair is kept only with a sha of 7 to 40 lowercase hexadecimal characters and two known verdicts', () => {
  const pair = { sha: 'abc1234', spec: 'APPROVE', adversarial: 'REQUEST_CHANGES' }
  expect(verdictsIn(pair)).toEqual(pair)
  expect(verdictsIn({ ...pair, sha: '0'.repeat(40), spec: 'REQUEST_CHANGES', adversarial: 'APPROVE' })).toEqual({ sha: '0'.repeat(40), spec: 'REQUEST_CHANGES', adversarial: 'APPROVE' })
  expect(verdictsIn({ ...pair, extra: 'words' })).toEqual(pair)
  for (const bad of [
    undefined, null, 'APPROVE', [], { ...pair, sha: 'abc123' }, { ...pair, sha: 'a'.repeat(41) }, { ...pair, sha: 'ABC1234' },
    { ...pair, sha: 'abc123g' }, { ...pair, sha: 7 }, { ...pair, spec: 'approve' }, { ...pair, spec: 'COMMENT' },
    { ...pair, adversarial: null }, { sha: 'abc1234', spec: 'APPROVE' },
  ]) expect(verdictsIn(bad)).toBeNull()
})

test('a pull request keeps a well-formed verdict pair and reads a malformed or missing one as null', () => {
  const pr = { repo: 'o/r', number: 9, state: 'OPEN', checks: 'passed' }
  const pair = { sha: 'abc1234', spec: 'APPROVE', adversarial: 'APPROVE' }
  expect(recordIn(text({ pr: { ...pr, verdicts: pair } }))?.pr?.verdicts).toEqual(pair)
  expect(recordIn(text({ pr: { ...pr, verdicts: { ...pair, spec: 'MAYBE' } } }))?.pr?.verdicts).toBeNull()
  expect(recordIn(text({ pr: { ...pr, verdicts: 'approved' } }))?.pr?.verdicts).toBeNull()
  expect(recordIn(text({ pr }))?.pr?.verdicts).toBeNull()
})

test('a pull request\'s state reads as OPEN, MERGED or CLOSED whatever its case, and as null for anything else or no pull request', () => {
  const pr = (state: string) => ({ repo: 'o/r', number: 9, state, checks: 'passed', verdicts: null })
  expect(prStateOf(pr('OPEN'))).toBe('OPEN')
  expect(prStateOf(pr('merged'))).toBe('MERGED')
  expect(prStateOf(pr('Closed'))).toBe('CLOSED')
  expect(prStateOf(pr('unknown'))).toBeNull()
  expect(prStateOf(pr('DRAFT'))).toBeNull()
  expect(prStateOf(null)).toBeNull()
})

test('the cleanup counts are read in any state once present, and are absent until then', () => {
  const cleanup = { failedCalls: 2, lastError: 'the folder is in use' }
  expect(recordIn(text({ state: 'in-cleanup', cleanup }))?.cleanup).toEqual(cleanup)
  expect(recordIn(text({ state: 'done', cleanup: { failedCalls: 0, lastError: '' } }))?.cleanup).toEqual({ failedCalls: 0, lastError: '' })
  expect(recordIn(text({ state: 'in-cleanup', cleanup: { failedCalls: 'two' } }))?.cleanup).toEqual({ failedCalls: 0, lastError: '' })
  expect(recordIn(text({ state: 'in-cleanup' }))?.cleanup).toBeUndefined()
  expect(recordIn(text({ state: 'working', cleanup: 'soon' }))?.cleanup).toBeUndefined()
})

test('a background-only wait is read with its since and at most three of its string tasks, and is absent until then', () => {
  const since = 1500
  expect(recordIn(text({ backgroundOnly: { since, tasks: ['run the tests', 'build'] } }))?.backgroundOnly).toEqual({ since, tasks: ['run the tests', 'build'] })
  expect(recordIn(text({ backgroundOnly: { since, tasks: ['a', 7, 'b', null, 'c', 'd'] } }))?.backgroundOnly).toEqual({ since, tasks: ['a', 'b', 'c'] })
  expect(recordIn(text())?.backgroundOnly).toBeUndefined()
  expect(recordIn(text())).not.toHaveProperty('backgroundOnly')
})

test('a background-only wait without a finite since reads as none, and one whose tasks are not a list reads with no tasks', () => {
  for (const bad of ['soon', 3, null, [], {}, { since: 'then', tasks: [] }, { since: Number.NaN, tasks: ['x'] }, { since: null, tasks: ['x'] }, { tasks: ['x'] }]) {
    expect(recordIn(text({ backgroundOnly: bad }))).not.toHaveProperty('backgroundOnly')
  }
  expect(recordIn(text({ backgroundOnly: { since: 1500 } }))?.backgroundOnly).toEqual({ since: 1500, tasks: [] })
  expect(recordIn(text({ backgroundOnly: { since: 1500, tasks: 'run the tests' } }))?.backgroundOnly).toEqual({ since: 1500, tasks: [] })
})

test('a background-only wait reads its taskSince when it is a finite number, and has no such key when it is missing or not one', () => {
  const since = 1500
  const tasks = ['run the tests']
  expect(recordIn(text({ backgroundOnly: { since, tasks, taskSince: 1200 } }))?.backgroundOnly).toEqual({ since, tasks, taskSince: 1200 })
  expect(recordIn(text({ backgroundOnly: { since, tasks, taskSince: 0 } }))?.backgroundOnly).toEqual({ since, tasks, taskSince: 0 })
  // A wait with no first-seen time, as a record from an older builder has,
  // reads as it did before the field existed, with no key for it at all
  // rather than a key set to undefined, so the tests that compare a wait
  // with toEqual keep their meaning.
  const reads = [
    recordIn(text({ backgroundOnly: { since, tasks } }))?.backgroundOnly,
    ...['then', '1200', null, true, {}, [1200]].map(bad => recordIn(text({ backgroundOnly: { since, tasks, taskSince: bad } }))?.backgroundOnly),
  ]
  for (const read of reads) {
    expect(read).toEqual({ since, tasks })
    expect(read).not.toHaveProperty('taskSince')
  }
})
