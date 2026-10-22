import { expect, test } from 'claude-code/testing'

import { snapshotOf } from '../hooks/github'
import {
  afterCallReturn, afterCleanupSkill, afterCounselAsk, afterFailedCall, afterLoopEnd, afterPermissionRequest, afterPersonPrompt, afterQuestionEnd, afterWrite,
  backgroundWaitOf, buildPathOf, comparedTextOf, configDirOf, ERROR_CHARS, errorLineOf, firstPromptOf, generationIn, isBackgroundOnly, isCleanupSkill, issueOf, newMemo,
  recordOf, shownOrWithheld, STATE_RULES, stateOf, statusMemoIn, TASK_CHARS, taskKeyOf, ticketIn, WITHHELD, type StatusFacts,
} from '../hooks/status'
import type { AgentCard, BackgroundTask, StatusMemo } from '../types'

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
    stage: 'review', stageDone: 7, pr: { repo: 'o/r', number: 7, state: 'OPEN', checks: 'failed', verdicts: null }, state: 'waiting-on-builder',
    reason: 'Builder has a look at the pull request scheduled.', stateSince: NOW, writtenAt: NOW,
  })
})

test('the record\'s pull request holds the verdict pair at the head, and null when the head has none or the pair is at another head', () => {
  const pair = { sha: HEAD, spec: 'APPROVE' as const, adversarial: 'REQUEST_CHANGES' as const }
  const withPair = (verdicts: typeof pair | null) => recordOf(facts({ run: watched, pr: { ...pullRequest(), verdicts } }), NOW).pr
  expect(withPair(pair)?.verdicts).toEqual({ sha: HEAD, spec: 'APPROVE', adversarial: 'REQUEST_CHANGES' })
  expect(withPair(null)?.verdicts).toBeNull()
  expect(withPair({ ...pair, sha: 'b'.repeat(40) })?.verdicts).toBeNull()
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

// A shell task in flight, with a command the record must never show.
function task(id: string, description: string, over: Partial<BackgroundTask> = {}): BackgroundTask {
  return { id, type: 'shell', status: 'running', description, command: `secret-command-${id}`, ...over }
}

const suite = task('b1', 'Run the suite')
const waiting = (since: number, keys: string[]) => memo({ backgroundWait: { since, keys } })

test('a background-only wait shows in the record with its start and its tasks, and the state stays working', () => {
  const record = recordOf(facts({ memo: waiting(NOW - 5000, ['b1']), background: [suite] }), NOW)
  expect(record.state).toBe('working')
  expect(record.backgroundOnly).toEqual({ since: NOW - 5000, tasks: ['Run the suite'] })
  expect(Object.keys(record).slice(-2)).toEqual(['writtenAt', 'backgroundOnly'])
})

test('the field is left out while the turn runs, an agent runs, an own call runs, a permission prompt is open, or nothing runs', () => {
  const m = waiting(NOW - 5000, ['b1'])
  const without = (over: Partial<StatusFacts>) => 'backgroundOnly' in recordOf(facts({ memo: m, background: [suite], ...over }), NOW)
  expect(without({})).toBe(true)
  expect(without({ busy: true })).toBe(false)
  expect(without({ agents: [runningAgent] })).toBe(false)
  expect(without({ calls: [{ id: 'c', tool: 'Bash', label: 'npm test', startedAt: NOW }] })).toBe(false)
  expect(without({ memo: { ...m, prompts: [{ loop: '', tool: 'Bash', count: 1 }] } })).toBe(false)
  expect(without({ background: [] })).toBe(false)
  // A finished agent does not count as running, and the memo must hold a wait.
  expect(without({ agents: [{ ...runningAgent, status: 'completed' }] })).toBe(true)
  expect('backgroundOnly' in recordOf(facts({ background: [suite] }), NOW)).toBe(false)
})

test('only background work in flight is background-only', () => {
  expect(isBackgroundOnly(facts({ background: [suite] }))).toBe(true)
  expect(isBackgroundOnly(facts())).toBe(false)
  expect(isBackgroundOnly(facts({ background: [suite], busy: true }))).toBe(false)
  expect(isBackgroundOnly(facts({ background: [suite], agents: [runningAgent] }))).toBe(false)
  expect(isBackgroundOnly(facts({ background: [suite], calls: [{ id: 'c', tool: 'Bash', label: 'ls', startedAt: NOW }] }))).toBe(false)
})

test('a wait begins when only background work runs, and none begins otherwise', () => {
  expect(backgroundWaitOf(facts({ background: [suite, task('b3', 'Watch the build', { type: 'monitor' })] }), NOW)).toEqual({ since: NOW, keys: ['b1', 'b3'] })
  expect(backgroundWaitOf(facts(), NOW)).toBeNull()
  expect(backgroundWaitOf(facts({ background: [suite], busy: true }), NOW)).toBeNull()
})

test('a wait keeps its start across a busy step while one of its tasks is still in flight, and begins again when none is', () => {
  const m = waiting(NOW - 60_000, ['b1'])
  const kept = { since: NOW - 60_000, keys: ['b1'] }
  expect(backgroundWaitOf(facts({ memo: m, background: [suite], busy: true }), NOW)).toEqual(kept)
  expect(backgroundWaitOf(facts({ memo: m, background: [suite] }), NOW)).toEqual(kept)
  // A second task that joins partway keeps the wait as it was, ids and all.
  expect(backgroundWaitOf(facts({ memo: m, background: [suite, task('b4', 'Build')] }), NOW)).toEqual(kept)
  // Once the first task has ended, the next background-only wait begins afresh.
  expect(backgroundWaitOf(facts({ memo: m, background: [task('b4', 'Build')] }), NOW)).toEqual({ since: NOW, keys: ['b4'] })
  expect(backgroundWaitOf(facts({ memo: m, background: [task('b4', 'Build')], busy: true }), NOW)).toBeNull()
  expect(backgroundWaitOf(facts({ memo: m }), NOW)).toBeNull()
})

test('a task without an id is keyed by its kind and description, so it cannot keep a wait alive for a different one', () => {
  const first = task('', 'Run the suite')
  const second = task('', 'Run the linter')
  expect(taskKeyOf(suite)).toBe('b1')
  expect(taskKeyOf(first)).not.toBe(taskKeyOf(second))
  expect(taskKeyOf(first)).not.toBe(taskKeyOf({ ...first, type: 'monitor' }))
  const m = waiting(NOW - 60_000, [taskKeyOf(first)])
  expect(backgroundWaitOf(facts({ memo: m, background: [first] }), NOW)?.since).toBe(NOW - 60_000)
  expect(backgroundWaitOf(facts({ memo: m, background: [second] }), NOW)).toEqual({ since: NOW, keys: [taskKeyOf(second)] })
})

test('the record names at most three tasks, the wait\'s own first, each cleaned and cut to 80 characters, and drops empty ones', () => {
  const m = waiting(NOW - 5000, ['b5'])
  const background = [task('b1', 'one'), task('b2', '\u001b[31mtwo\u001b[0m\tlines\nhere'), task('b3', '  '), task('b4', 'x'.repeat(200)), task('b5', 'the wait\'s own')]
  const tasks = recordOf(facts({ memo: m, background }), NOW).backgroundOnly?.tasks
  expect(tasks?.length).toBe(3)
  expect(tasks?.[0]).toBe('the wait\'s own')
  expect(tasks?.[1]).toBe('one')
  expect(tasks?.[2]).toBe('two lines here')
  const cut = recordOf(facts({ memo: waiting(NOW, ['b4']), background }), NOW).backgroundOnly?.tasks[0] ?? ''
  expect(cut.length).toBe(TASK_CHARS)
  expect(cut.endsWith('…')).toBe(true)
})

test('a task\'s command never reaches the record, even when it has no description', () => {
  const record = recordOf(facts({ memo: waiting(NOW, ['b1']), background: [suite, task('b2', '')] }), NOW)
  expect(record.backgroundOnly?.tasks).toEqual(['Run the suite'])
  expect(JSON.stringify(record)).not.toContain('secret-command')
})

test('a description that looks like a secret is withheld, before or after cleaning', () => {
  const background = [task('b1', `deploy with ghp_${'A'.repeat(36)}`), task('b2', `key sk-\u0007${'b'.repeat(30)}`), task('b3', 'fine')]
  expect(recordOf(facts({ memo: waiting(NOW, ['b1']), background }), NOW).backgroundOnly?.tasks).toEqual([WITHHELD, WITHHELD, 'fine'])
  expect(shownOrWithheld('plain \u0007text', 80)).toBe('plain text')
  expect(shownOrWithheld(`sk-\u0007${'b'.repeat(30)}`, 80)).toBe(WITHHELD)
})

test('two records with the same wait compare the same, and a new wait compares different', () => {
  const written = (since: number) => memo({ state: 'working', stateSince: NOW, backgroundWait: { since, keys: ['b1'] } })
  const one = recordOf(facts({ memo: written(NOW), background: [suite] }), NOW)
  expect(comparedTextOf(recordOf(facts({ memo: written(NOW), background: [suite] }), NOW + 60_000))).toBe(comparedTextOf(one))
  expect(comparedTextOf(recordOf(facts({ memo: written(NOW + 1), background: [suite] }), NOW))).not.toBe(comparedTextOf(one))
})

test('a stored wait reads back, and a memo without one or with a malformed one reads with none and is kept', () => {
  const good = waiting(NOW, ['b1', 'b2'])
  expect(statusMemoIn(good, 'session-1')).toEqual(good)
  expect(newMemo({ sessionId: 'session-1', ticket: null, path: null, cwd: '', generation: 1 }).backgroundWait).toBeNull()
  const older: Partial<StatusMemo> = { ...memo({ state: 'idle' }) }
  delete older.backgroundWait
  expect(statusMemoIn(older, 'session-1')).toEqual(memo({ state: 'idle' }))
  for (const bad of ['soon', { since: 'now', keys: ['b1'] }, { since: Number.NaN, keys: ['b1'] }, { since: NOW, keys: 'b1' }, { since: NOW, keys: [] }, { since: NOW, keys: [''] }, { since: NOW, keys: [3] }, { since: NOW }]) {
    const read = statusMemoIn({ ...memo({ state: 'idle' }), backgroundWait: bad }, 'session-1')
    expect(read).toEqual(memo({ state: 'idle' }))
  }
})
