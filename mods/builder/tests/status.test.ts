import { expect, test } from 'claude-code/testing'

import { snapshotOf } from '../hooks/github'
import {
  afterCallReturn, afterCleanupSkill, afterCounselAsk, afterFailedCall, afterLoopEnd, afterPermissionRequest, afterPersonPrompt, afterQuestionEnd, afterWrite,
  buildPathOf, comparedTextOf, configDirOf, ERROR_CHARS, errorLineOf, firstPromptOf, generationIn, isCleanupSkill, issueOf, newMemo, recordOf, STATE_RULES, stateOf,
  statusMemoIn, ticketIn, WITHHELD, type StatusFacts,
} from '../hooks/status'
import type { AgentCard, StatusMemo } from '../types'

const NOW = 1_000_000
const HEAD = 'a'.repeat(40)

function pullRequest(state: 'OPEN' | 'MERGED' | 'CLOSED' = 'OPEN', conclusion = 'SUCCESS') {
  return snapshotOf('o/r', {
    number: 7, url: 'u', state, headRefOid: HEAD, commits: [{ oid: HEAD }],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion }],
  }, 'owner')
}

// A memo of session-1 with a ticket, nothing open and nothing written yet,
// unless the case says otherwise.
function memo(over: Partial<StatusMemo> = {}): StatusMemo & { ticket: string } {
  return { ...newMemo({ sessionId: 'session-1', ticket: 't-1', path: '/home/me/.claude/foreman/builds/session-1.json', cwd: '/repo', generation: 1 }), ...over } as StatusMemo & { ticket: string }
}

// The facts of an idle session with a ticket, unless the case says otherwise.
function facts(over: Partial<StatusFacts> = {}): StatusFacts {
  return {
    memo: memo(), progress: null, run: null, pr: null, busy: false, agents: [], background: [], calls: [], questions: [],
    nextLook: null, usageHold: null, ...over,
  }
}

const watched = { repo: 'o/r', number: 7, cwd: '/repo', login: 'owner', since: NOW - 60_000 }
const runningAgent: AgentCard = { id: 'agent-1', type: 'Explore', description: 'look', status: 'running', startedAt: NOW }

test('a ticket is the value of a foreman-ticket line, wherever it sits among the lines, with the white space around it removed', () => {
  expect(ticketIn('foreman-ticket: abc-1')).toBe('abc-1')
  expect(ticketIn('Implement the thing.\n\n  foreman-ticket:   slot 3  \nThanks.')).toBe('slot 3')
  expect(ticketIn('first\r\nforeman-ticket: x\r\n')).toBe('x')
  expect(ticketIn('foreman-ticket: one\nforeman-ticket: two')).toBe('one')
})

test('a prompt with no ticket line, an empty ticket, or the words inside a line holds no ticket', () => {
  expect(ticketIn('Implement ABC-123.')).toBeNull()
  expect(ticketIn('foreman-ticket:')).toBeNull()
  expect(ticketIn('foreman-ticket:    \nmore')).toBeNull()
  expect(ticketIn('see foreman-ticket: abc')).toBeNull()
  expect(ticketIn(undefined as unknown as string)).toBeNull()
})

test('the first prompt is the first user message with text, and the prompt being submitted when the transcript holds none', () => {
  const toolResultOnly = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'ok', isError: false }] }
  const first = { role: 'user', text: 'foreman-ticket: from-the-transcript', toolUses: [] }
  const answer = { role: 'assistant', text: 'Working on it.', toolUses: [] }
  expect(firstPromptOf([answer, toolResultOnly, first, { role: 'user', text: 'later', toolUses: [] }], 'now')).toBe('foreman-ticket: from-the-transcript')
  expect(firstPromptOf([toolResultOnly, answer], 'the submitted prompt')).toBe('the submitted prompt')
  expect(firstPromptOf([], 'the submitted prompt')).toBe('the submitted prompt')
  expect(firstPromptOf({ deny: 'no' }, 'the submitted prompt')).toBe('the submitted prompt')
  expect(firstPromptOf([null, 3, { role: 'user', text: '   ' }], 'the submitted prompt')).toBe('the submitted prompt')
})

test('a title splits into its leading issue key and the rest, and a title without a key keeps it all', () => {
  expect(issueOf('ABC-123 short issue name')).toEqual({ issueKey: 'ABC-123', issueTitle: 'short issue name' })
  expect(issueOf('ABC-123: short issue name')).toEqual({ issueKey: 'ABC-123', issueTitle: 'short issue name' })
  expect(issueOf('ABC-123 — short issue name')).toEqual({ issueKey: 'ABC-123', issueTitle: 'short issue name' })
  expect(issueOf('ABC-123')).toEqual({ issueKey: 'ABC-123', issueTitle: '' })
  expect(issueOf('short issue name')).toEqual({ issueKey: null, issueTitle: 'short issue name' })
  expect(issueOf('ABC-123x is not a key')).toEqual({ issueKey: null, issueTitle: 'ABC-123x is not a key' })
  expect(issueOf('the fix for ABC-123')).toEqual({ issueKey: null, issueTitle: 'the fix for ABC-123' })
})

test('the cleanup skill is the skill named cleanup or a plugin skill whose name ends in :cleanup', () => {
  expect(isCleanupSkill('cleanup')).toBe(true)
  expect(isCleanupSkill('acme:cleanup')).toBe(true)
  expect(isCleanupSkill('cleanup-old')).toBe(false)
  expect(isCleanupSkill('precleanup')).toBe(false)
  expect(isCleanupSkill('implement')).toBe(false)
})

test('an error keeps its last line that is not blank, cleaned of control characters', () => {
  expect(errorLineOf('first line\nfatal: the worktree is dirty\n\n   \n')).toBe('fatal: the worktree is dirty')
  expect(errorLineOf('\u001b[31mred\u001b[0m and\u0007 bell')).toBe('red and bell')
  expect(errorLineOf('\n\n')).toBe('')
  expect(errorLineOf(undefined)).toBe('')
})

test('an error line is cut to 200 characters, and a line that looks like a secret is withheld', () => {
  const cut = errorLineOf('x'.repeat(500))
  expect(cut.length).toBe(ERROR_CHARS)
  expect(cut.endsWith('…')).toBe(true)
  expect(errorLineOf(`push failed\nremote: token ghp_${'A'.repeat(36)} was refused`)).toBe(WITHHELD)
  expect(errorLineOf(`bad key sk-\u0007${'b'.repeat(30)}`)).toBe(WITHHELD)
})

test('the configuration folder is CLAUDE_CONFIG_DIR when set, else .claude under HOME, and only when absolute', () => {
  expect(configDirOf('/custom/config/', '/home/me')).toBe('/custom/config')
  expect(configDirOf(undefined, '/home/me/')).toBe('/home/me/.claude')
  expect(configDirOf('', '/home/me')).toBe('/home/me/.claude')
  expect(configDirOf('relative/config', '/home/me')).toBeNull()
  expect(configDirOf(undefined, 'home')).toBeNull()
  expect(configDirOf(undefined, undefined)).toBeNull()
  expect(configDirOf('/', '/home/me')).toBeNull()
  // A Windows drive path counts as absolute, with its trailing backslashes
  // dropped, and a drive with no separator after it is relative.
  expect(configDirOf('C:\\Users\\me\\.claude\\', undefined)).toBe('C:\\Users\\me\\.claude')
  expect(configDirOf(undefined, 'C:\\Users\\me')).toBe('C:\\Users\\me/.claude')
  expect(configDirOf('C:config', '/home/me')).toBeNull()
})

test('the path is the session id under the builds folder, and refused for an id that could leave it', () => {
  expect(buildPathOf('/home/me/.claude', 'session-1')).toBe('/home/me/.claude/foreman/builds/session-1.json')
  expect(buildPathOf('/home/me/.claude', 'a/b')).toBeNull()
  expect(buildPathOf('/home/me/.claude', '..')).toBeNull()
  expect(buildPathOf('/home/me/.claude', '')).toBeNull()
  expect(buildPathOf(null, 'session-1')).toBeNull()
})

test('the rules list the six states in the order the counsel chose', () => {
  expect(STATE_RULES.map(rule => rule.state)).toEqual(['needs-you', 'working', 'waiting-on-builder', 'in-cleanup', 'done', 'idle'])
})

test('each state holds with its reason', () => {
  expect(stateOf(facts())).toEqual({ state: 'idle', reason: 'Nothing runs and nothing is waiting.' })
  expect(stateOf(facts({ busy: true }))).toEqual({ state: 'working', reason: 'The session\'s own turn is running.' })
  expect(stateOf(facts({ agents: [runningAgent, { ...runningAgent, id: 'agent-2' }] }))).toEqual({ state: 'working', reason: '2 agents are running.' })
  expect(stateOf(facts({ background: [{ id: 'b1', type: 'shell', status: 'running', description: 'x' }] }))).toEqual({ state: 'working', reason: '1 background task is running.' })
  expect(stateOf(facts({ calls: [{ id: 'c', tool: 'Bash', label: 'npm test', startedAt: NOW }] }))).toEqual({ state: 'working', reason: 'A Bash call of the session\'s own is running.' })
  expect(stateOf(facts({ nextLook: { at: NOW + 90_000, isNewHead: false } }))).toEqual({ state: 'waiting-on-builder', reason: 'Builder has a look at the pull request scheduled.' })
  expect(stateOf(facts({ usageHold: { until: 0 } }))).toEqual({ state: 'waiting-on-builder', reason: 'A usage-limit hold is on; builder resumes the session at 1970-01-01T00:00:00.000Z.' })
  expect(stateOf(facts({ memo: memo({ cleanup: { failedCalls: 0, lastError: '' } }) }))).toEqual({ state: 'in-cleanup', reason: 'The cleanup skill has started in this session.' })
  expect(stateOf(facts({ run: watched, pr: pullRequest('MERGED') }))).toEqual({ state: 'done', reason: 'The pull request o/r#7 merged.' })
  expect(stateOf(facts({ questions: [{ asked: 'Which?', at: NOW, answered: false, labelled: false }] }))).toEqual({ state: 'needs-you', reason: 'An AskUserQuestion call is waiting on the person\'s answer.' })
  expect(stateOf(facts({ memo: memo({ askedAt: NOW }) }))).toEqual({ state: 'needs-you', reason: 'The counsel sent a question to the person, and it has not been asked yet.' })
  expect(stateOf(facts({ memo: memo({ prompts: [{ loop: '', tool: 'Bash', count: 1 }] }) }))).toEqual({ state: 'needs-you', reason: 'A permission prompt for Bash in the session is waiting on the person.' })
})

test('a merged pull request with a turn running reads working, a question open during cleanup reads needs-you, and a merge after cleanup started reads in-cleanup', () => {
  const merged = { run: watched, pr: pullRequest('MERGED') }
  const cleaning = memo({ cleanup: { failedCalls: 0, lastError: '' } })
  expect(stateOf(facts({ ...merged, busy: true })).state).toBe('working')
  expect(stateOf(facts({ memo: cleaning, questions: [{ asked: 'Which?', at: NOW, answered: false, labelled: false }] })).state).toBe('needs-you')
  expect(stateOf(facts({ ...merged, memo: cleaning })).state).toBe('in-cleanup')
})

test('a closed pull request, or a merged one that is not the watched one, is not done', () => {
  expect(stateOf(facts({ run: watched, pr: pullRequest('CLOSED') })).state).toBe('idle')
  expect(stateOf(facts({ run: { ...watched, number: 8 }, pr: pullRequest('MERGED') })).state).toBe('idle')
  expect(stateOf(facts({ pr: pullRequest('MERGED') })).state).toBe('idle')
})

test('a subagent\'s permission prompt counts while its agent runs, and not once its card has ended', () => {
  const prompts = [{ loop: 'agent-1', tool: 'Bash', count: 1 }]
  expect(stateOf(facts({ memo: memo({ prompts }), agents: [runningAgent] })).reason).toBe('A permission prompt for Bash in a subagent is waiting on the person.')
  expect(stateOf(facts({ memo: memo({ prompts }) })).state).toBe('needs-you')
  expect(stateOf(facts({ memo: memo({ prompts }), agents: [{ ...runningAgent, status: 'completed' }] })).state).toBe('idle')
})

test('the record holds the ticket, the ids, the issue, the stage, the bar\'s count and the watched pull request', () => {
  const progress = { title: 'ABC-123 short issue name', stage: 'review' as const, furthest: 'review' as const, note: '', since: NOW - 120_000, autoOpened: true }
  const record = recordOf(facts({
    memo: memo({ desktopSessionId: 'desk-1' }), progress, run: watched, pr: pullRequest('OPEN', 'FAILURE'), nextLook: { at: NOW, isNewHead: false },
  }), NOW)
  expect(record).toEqual({
    version: 1, sessionId: 'session-1', ticket: 't-1', desktopSessionId: 'desk-1', cwd: '/repo', issueKey: 'ABC-123', issueTitle: 'short issue name',
    stage: 'review', stageDone: 7, pr: { repo: 'o/r', number: 7, state: 'OPEN', checks: 'failed' }, state: 'waiting-on-builder',
    reason: 'Builder has a look at the pull request scheduled.', stateSince: NOW, writtenAt: NOW,
  })
})

test('before any report the record has no issue, no stage and no count, and no desktop id or cleanup when there are none', () => {
  const record = recordOf(facts(), NOW)
  expect(record.issueKey).toBeNull()
  expect(record.issueTitle).toBe('')
  expect(record.stage).toBeNull()
  expect(record.stageDone).toBe(0)
  expect(record.pr).toBeNull()
  expect('desktopSessionId' in record).toBe(false)
  expect('cleanup' in record).toBe(false)
  expect(recordOf(facts({ memo: memo({ cleanup: { failedCalls: 2, lastError: 'boom' } }) }), NOW).cleanup).toEqual({ failedCalls: 2, lastError: 'boom' })
})

test('the state keeps the time it began while it holds, and begins again when it changes', () => {
  const written = afterWrite(memo(), recordOf(facts(), NOW))
  expect(written.state).toBe('idle')
  expect(written.stateSince).toBe(NOW)
  expect(recordOf(facts({ memo: memo({ ...written }) }), NOW + 60_000).stateSince).toBe(NOW)
  expect(recordOf(facts({ memo: memo({ ...written }), busy: true }), NOW + 60_000).stateSince).toBe(NOW + 60_000)
})

test('two records are the same when only the write time differs', () => {
  const one = recordOf(facts(), NOW)
  const written = memo({ ...afterWrite(memo(), one) })
  expect(comparedTextOf(recordOf(facts({ memo: written }), NOW + 60_000))).toBe(comparedTextOf(one))
  expect(comparedTextOf(recordOf(facts({ memo: written, busy: true }), NOW))).not.toBe(comparedTextOf(one))
})

test('a stored memo reads back only for its own session and only when every field is sound', () => {
  const good = memo({ desktopSessionId: 'desk-1', prompts: [{ loop: '', tool: 'Bash', count: 2 }], cleanup: { failedCalls: 1, lastError: 'x' }, askedAt: NOW, state: 'idle' })
  expect(statusMemoIn(good, 'session-1')).toEqual(good)
  expect(statusMemoIn({ ...good, ticket: null }, 'session-1')?.ticket).toBeNull()
  expect(statusMemoIn(good, 'session-2')).toBeNull()
  expect(statusMemoIn(null, 'session-1')).toBeNull()
  expect(statusMemoIn({ ...good, state: 'busy' }, 'session-1')).toBeNull()
  expect(statusMemoIn({ ...good, prompts: [{ loop: '', tool: 'Bash', count: -1 }] }, 'session-1')).toBeNull()
  expect(statusMemoIn({ ...good, cleanup: { failedCalls: 'one', lastError: '' } }, 'session-1')).toBeNull()
  expect(statusMemoIn({ ...good, generation: Number.NaN }, 'session-1')).toBeNull()
})

test('a stored memo gives its generation whichever session it belongs to, and null when the generation is missing or not finite', () => {
  const good = memo({ generation: NOW })
  expect(generationIn(good)).toBe(NOW)
  expect(generationIn({ ...good, sessionId: 'session-2' })).toBe(NOW)
  expect(generationIn({ generation: NOW })).toBe(NOW)
  const missing: Partial<StatusMemo> = { ...good }
  delete missing.generation
  expect(generationIn(missing)).toBeNull()
  expect(generationIn({ ...good, generation: Number.NaN })).toBeNull()
  expect(generationIn({ ...good, generation: Number.POSITIVE_INFINITY })).toBeNull()
  expect(generationIn({ ...good, generation: String(NOW) })).toBeNull()
  expect(generationIn(null)).toBeNull()
  expect(generationIn(NOW)).toBeNull()
})

test('permission prompts are counted per loop and tool, each return closes one, and a loop\'s end closes all of its own', () => {
  let m: StatusMemo = memo()
  m = afterPermissionRequest(m, '', 'Bash')
  m = afterPermissionRequest(m, '', 'Bash')
  m = afterPermissionRequest(m, 'agent-1', 'Bash')
  expect(m.prompts).toEqual([{ loop: '', tool: 'Bash', count: 2 }, { loop: 'agent-1', tool: 'Bash', count: 1 }])
  m = afterCallReturn(m, '', 'Bash')
  expect(m.prompts).toEqual([{ loop: '', tool: 'Bash', count: 1 }, { loop: 'agent-1', tool: 'Bash', count: 1 }])
  m = afterCallReturn(m, '', 'Edit')
  m = afterCallReturn(m, '', 'Bash')
  expect(m.prompts).toEqual([{ loop: 'agent-1', tool: 'Bash', count: 1 }])
  expect(afterLoopEnd(m, '').prompts).toEqual([{ loop: 'agent-1', tool: 'Bash', count: 1 }])
  expect(afterLoopEnd(m, 'agent-1').prompts).toEqual([])
})

test('failed calls are counted only once the cleanup skill started, with the newest error\'s last line', () => {
  let m: StatusMemo = afterFailedCall(memo(), 'before cleanup')
  expect(m.cleanup).toBeNull()
  m = afterCleanupSkill(m)
  expect(m.cleanup).toEqual({ failedCalls: 0, lastError: '' })
  m = afterFailedCall(m, 'one\nfirst error')
  m = afterFailedCall(m, 'two\nsecond error\n')
  expect(m.cleanup).toEqual({ failedCalls: 2, lastError: 'second error' })
  expect(afterCleanupSkill(m).cleanup).toEqual({ failedCalls: 2, lastError: 'second error' })
})

test('the counsel\'s question is cleared by a question that started after the tally ended, and by the person\'s prompt', () => {
  const asked = afterCounselAsk(memo(), NOW)
  expect(asked.askedAt).toBe(NOW)
  expect(afterQuestionEnd(asked, NOW - 1).askedAt).toBe(NOW)
  expect(afterQuestionEnd(asked, NOW).askedAt).toBe(NOW)
  expect(afterQuestionEnd(asked, NOW + 1).askedAt).toBeNull()
  expect(afterPersonPrompt(asked).askedAt).toBeNull()
})
