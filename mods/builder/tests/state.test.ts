import { expect, test } from 'claude-code/testing'

import { snapshotOf } from '../hooks/github'
import { isDrawable } from '../hooks/pane'
import type { PromptOrigin } from 'claude-code'

import { backgroundOf, endedCards, endedTaskOf, exhaustedWindows, holdIn, isPersonPrompt, isPushOrMerge, isRunning, keepQuestions, labelOf, mergeAgents, mergePatternOf, NEW_HEAD_POLL_MS, nextStuckEvery, pollFor, POLL_MS, QUESTIONS_KEPT, quietIn, RESUME_AFTER_RESET_MS, RESUME_FALLBACK_MS, resumeAt, shownStatus, statusOf, stepDelay, STUCK_CEILING_MS, stuckEveryIn, STUCK_FIRST_MS, summaryOf, TIMER_STEP_MS, UNNAMED_TOOLS, waitingOn } from '../hooks/state'
import type { AgentCard } from '../types'

const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const open = (checks: { status: string; conclusion: string | null }[], labels: string[] = []) => snapshotOf('o/r', {
  number: 7,
  url: 'u',
  state: 'OPEN',
  headRefOid: C,
  labels: labels.map(name => ({ name })),
  statusCheckRollup: checks.map(check => ({ __typename: 'CheckRun', name: 'tests', ...check })),
  commits: [{ oid: C }],
}, 'owner')
const card = (status: AgentCard['status'], over: Partial<AgentCard> = {}): AgentCard => ({ id: 'a', type: 't', description: '', asked: '', status, startedAt: 0, ...over })
// A card an older build saved, with a status word the engine no longer uses.
const saved = (status: string): AgentCard => card(status as AgentCard['status'])

test('the session waits on the owner first, then its agents, then the checks, then the merge', () => {
  const pending = open([{ status: 'IN_PROGRESS', conclusion: null }])
  expect(waitingOn(pending, [card('running')], [{ asked: 'q', at: 0, answered: false, labelled: true }])).toBe('owner')
  expect(waitingOn(pending, [card('running')], [])).toBe('agents')
  expect(waitingOn(pending, [card('completed')], [])).toBe('ci')
  expect(waitingOn(open([{ status: 'COMPLETED', conclusion: 'SUCCESS' }], ['ready-to-merge']), [], [])).toBe('merge')
  expect(waitingOn(null, [], [])).toBe('nothing')
})

test('a failed check makes the session wait on a fix, after the owner and its agents and before the merge', () => {
  const failed = [{ status: 'COMPLETED', conclusion: 'FAILURE' }]
  expect(waitingOn(open(failed), [card('completed')], [])).toBe('fix')
  expect(waitingOn(open(failed, ['ready-to-merge']), [], [])).toBe('fix')
  expect(waitingOn(open(failed), [card('running')], [])).toBe('agents')
  expect(waitingOn(open(failed), [], [{ asked: 'q', at: 0, answered: false, labelled: true }])).toBe('owner')
})

test('waiting on a fix polls as quickly as waiting on checks', () => {
  expect(POLL_MS.fix).toBe(POLL_MS.ci)
  expect(POLL_MS.fix).toBe(90_000)
})

test('the poll is quick while waiting on checks or a merge and slow otherwise', () => {
  expect(POLL_MS.ci).toBeLessThan(POLL_MS.agents)
  expect(POLL_MS.merge).toBe(POLL_MS.ci)
  expect(POLL_MS.owner).toBeGreaterThanOrEqual(POLL_MS.agents)
})

test('waiting on a subagent polls as slowly as waiting on nothing, because its finish starts a turn whose end looks again', () => {
  expect(POLL_MS.agents).toBe(POLL_MS.nothing)
  expect(POLL_MS.agents).toBe(10 * 60_000)
})

test('an agent\'s summary is its end line when it has one, else the start of its answer', () => {
  expect(summaryOf('findings\n\nLENS-END security 401d5b09 findings=2\n')).toBe('LENS-END security 401d5b09 findings=2')
  expect(summaryOf('x\nVERDICT: APPROVE ' + C)).toBe('VERDICT: APPROVE ' + C)
  expect(summaryOf('I looked.\nNothing ended properly.')).toBe('I looked.')
})

test('a finished subagent is killed, failed or completed, in that order of precedence, in the engine\'s words', () => {
  expect(statusOf(true, 'error')).toBe('killed')
  expect(statusOf(false, 'error')).toBe('failed')
  expect(statusOf(false, 'answer')).toBe('completed')
  expect(statusOf(false, 'refusal')).toBe('completed')
})

test('trimming the questions keeps an old one whose label removal is still owed', () => {
  const question = (at: number, labelled: boolean, unlabelled?: boolean) => ({ asked: `q${at}`, at, answered: true, labelled, unlabelled })
  const owed = question(0, true)
  const done = question(1, true, true)
  const newer = Array.from({ length: QUESTIONS_KEPT }, (_, i) => question(i + 2, false))
  const kept = keepQuestions([owed, done, ...newer])
  expect(kept.length).toBe(QUESTIONS_KEPT + 1)
  expect(kept[0]).toEqual(owed)
  expect(kept.some(q => q.at === 1)).toBe(false)
})

test('a snapshot an older build saved, without the round count, is not drawn', () => {
  const current = open([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])
  const { headsReviewed: _dropped, ...older } = current
  expect(isDrawable(current)).toBe(true)
  expect(isDrawable(older as typeof current)).toBe(false)
  expect(isDrawable(null)).toBe(false)
})

test('the poll is 90 seconds while the head differs from the head the session was last told, whatever else waits', () => {
  const passed = open([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])
  const asked = [{ asked: 'q', at: 0, answered: false, labelled: false }]
  expect(NEW_HEAD_POLL_MS).toBe(90_000)
  expect(pollFor(passed, D, [], [], null)).toEqual({ ms: 90_000, isNewHead: true })
  // An open question would otherwise poll every ten minutes.
  expect(pollFor(passed, D, [], asked, null)).toEqual({ ms: 90_000, isNewHead: true })
})

test('with the told head current, or no record of one, or the pull request closed, the other states set the poll', () => {
  const passed = open([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])
  expect(pollFor(passed, C, [], [], null)).toEqual({ ms: POLL_MS.nothing, isNewHead: false })
  expect(pollFor(passed, null, [card('running')], [], null)).toEqual({ ms: POLL_MS.agents, isNewHead: false })
  expect(pollFor({ ...passed, state: 'MERGED' }, D, [], [], null).isNewHead).toBe(false)
  expect(pollFor(null, D, [], [], null).isNewHead).toBe(false)
})

test('an agent the engine no longer lists reads no longer listed while its stored status is a running one, and keeps a finished word', () => {
  for (const status of ['pending', 'running', 'waiting'] as const) {
    expect(shownStatus(card(status, { isListed: true }))).toBe(status)
    expect(shownStatus(card(status, { isListed: false }))).toBe('no longer listed')
    // A card an older build saved with no isListed field counts as listed.
    expect(shownStatus(card(status, { isListed: undefined }))).toBe(status)
  }
  for (const status of ['idle', 'completed', 'failed', 'killed'] as const) {
    for (const isListed of [true, false, undefined]) expect(shownStatus(card(status, { isListed }))).toBe(status)
  }
})

test('an agent counts as running while it is listed and pending, running or waiting', () => {
  for (const status of ['pending', 'running', 'waiting'] as const) expect(isRunning(card(status))).toBe(true)
  for (const status of ['idle', 'completed', 'failed', 'killed'] as const) expect(isRunning(card(status))).toBe(false)
  // A card from before the engine's list was read counts as listed.
  expect(isRunning(card('running', { isListed: undefined }))).toBe(true)
  expect(isRunning(card('running', { isListed: false }))).toBe(false)
  // Words an older build saved.
  expect(isRunning(saved('done'))).toBe(false)
  expect(isRunning(saved('aborted'))).toBe(false)
  expect(waitingOn(null, [saved('done'), saved('aborted')], [])).toBe('nothing')
  expect(waitingOn(null, [card('waiting')], [])).toBe('agents')
  expect(waitingOn(null, [card('running', { isListed: false })], [])).toBe('nothing')
})

const listed = (id: string, status: AgentCard['status'], type = 'Explore') => ({ id, type, description: `d ${id}`, status })

test('an agent the engine lists that the mod never saw spawn gets a card, as a resumed one does', () => {
  const merged = mergeAgents([], [listed('x', 'running')], 500, 400)
  expect(merged).toEqual([{ id: 'x', type: 'Explore', description: 'd x', status: 'running', startedAt: 500, isListed: true, lastSeenAt: 500 }])
  expect(isRunning(merged[0]!)).toBe(true)

  // An agent that finished and was resumed with SendMessage runs again, and
  // what it reported the first time no longer stands.
  const finished = card('completed', { id: 'r', startedAt: 100, endedAt: 200, durationMs: 100, summary: 'VERDICT: APPROVE x' })
  const [resumed] = mergeAgents([finished], [listed('r', 'running', 't')], 900, 800)
  expect(resumed!.status).toBe('running')
  expect(isRunning(resumed!)).toBe(true)
  expect(resumed!.endedAt).toBeUndefined()
  expect(resumed!.durationMs).toBeUndefined()
  expect(resumed!.summary).toBeUndefined()
  expect(resumed!.asked).toBe('')
  expect(resumed!.startedAt).toBe(100)
})

test('an agent that leaves running is marked ended once, and one the engine dropped is kept but no longer counts', () => {
  const running = card('running', { id: 'a', startedAt: 100 })
  const [ended] = mergeAgents([running], [listed('a', 'completed', 't')], 600, 500)
  expect(ended!.status).toBe('completed')
  expect(ended!.endedAt).toBe(600)
  const [again] = mergeAgents([ended!], [listed('a', 'completed', 't')], 900, 800)
  expect(again!.endedAt).toBe(600)

  const [dropped] = mergeAgents([card('running', { id: 'a', startedAt: 100, lastSeenAt: 300 })], [], 600, 500)
  expect(dropped!.isListed).toBe(false)
  expect(dropped!.status).toBe('running')
  expect(dropped!.lastSeenAt).toBe(300)
  expect(isRunning(dropped!)).toBe(false)
})

test('a read that began before a card was spawned or ended leaves that card alone', () => {
  // Spawned after the read began, so the read could not have named it.
  const [spawned] = mergeAgents([card('running', { id: 'a', startedAt: 500 })], [], 600, 500)
  expect(spawned!.isListed).toBeUndefined()
  expect(isRunning(spawned!)).toBe(true)
  // Its turn completed after the read began, so the read's running is older.
  const finished = card('completed', { id: 'a', startedAt: 100, endedAt: 550 })
  expect(mergeAgents([finished], [listed('a', 'running', 't')], 600, 500)).toEqual([finished])
})

test('the cards a merge ended are the ones running before it and not after it', () => {
  const before = [
    card('running', { id: 'ends', startedAt: 100 }),
    card('running', { id: 'dropped', startedAt: 100 }),
    card('running', { id: 'runs', startedAt: 100 }),
    card('completed', { id: 'done', startedAt: 100, endedAt: 200 }),
  ]
  const after = mergeAgents(before, [listed('ends', 'completed', 't'), listed('runs', 'running', 't'), listed('done', 'completed', 't'), listed('new', 'completed')], 600, 500)
  // The engine dropping a running agent from its list ends its card too. A
  // card that had already ended, or that the merge added already ended, was
  // not running before, so the merge did not end it.
  expect(endedCards(before, after).map(ended => ended.id)).toEqual(['ends', 'dropped'])
  expect(endedCards(after, after)).toEqual([])
})

test('merging keeps the newest hundred cards', () => {
  const many = Array.from({ length: 100 }, (_, i) => card('completed', { id: `c${i}` }))
  const merged = mergeAgents(many, [listed('new', 'running')], 600, 500)
  expect(merged.length).toBe(100)
  expect(merged.at(-1)!.id).toBe('new')
  expect(merged[0]!.id).toBe('c1')
})

test('background work keeps shell commands, monitors and workflows, and drops subagents and anything malformed', () => {
  expect(backgroundOf(undefined)).toEqual([])
  expect(backgroundOf('tasks')).toEqual([])
  expect(backgroundOf([
    { id: 'b1', type: 'shell', status: 'running', description: 'gates', command: 'claude plugin test .', extra: 'x' },
    { id: 'b2', type: 'subagent', status: 'running', description: 'builder', agent_type: 'general-purpose' },
    { id: 'b3', type: 'monitor', status: 'running', description: 'ci', server: 's', tool: 't' },
    null,
    'shell',
  ])).toEqual([
    { id: 'b1', type: 'shell', status: 'running', description: 'gates', command: 'claude plugin test .' },
    { id: 'b3', type: 'monitor', status: 'running', description: 'ci' },
  ])
})

test('a call is labelled by its Bash description, else its command, else the tool name', () => {
  expect(labelOf({ tool: 'Bash', description: 'Run the gates', command: 'claude plugin test .' })).toBe('Run the gates')
  expect(labelOf({ tool: 'Bash', description: '  ', command: 'claude plugin test .' })).toBe('claude plugin test .')
  expect(labelOf({ tool: 'Bash' })).toBe('Bash')
  expect(labelOf({ tool: 'Read', description: 'not a Bash call' })).toBe('Read')
  expect(UNNAMED_TOOLS.has('AskUserQuestion')).toBe(true)
  expect(UNNAMED_TOOLS.has('Agent')).toBe(true)
  expect(UNNAMED_TOOLS.has('Bash')).toBe(false)
})

test('a push or a merge is recognised at the start of a command or after an operator, and nothing else is', () => {
  const merge = mergePatternOf('gh pr merge <n> --merge --match-head-commit <sha>')
  for (const command of [
    'git push',
    'git push -u origin HEAD',
    '  git push',
    'git -C /repo/wt push origin x',
    'gh pr merge 7 --squash',
    'cd /repo && git push',
    'npm test; gh pr merge 7',
    'false || git push',
    '(git push)',
    'git add a\ngit push',
    'git -c a=b push',
    'git -C x -c a=b push',
    'git -c a=b -c c=d push',
  ]) expect(isPushOrMerge(command, null)).toBe(true)
  for (const command of [
    'echo git push',
    'git pushx',
    'git log --grep push',
    'gh pr view 7',
    'grep "gh pr merge" README.md',
    'git status',
    'git -c a=b pushx',
    'git -c a=b log',
  ]) expect(isPushOrMerge(command, null)).toBe(false)

  const gate = mergePatternOf('node scripts/merge-gate.mjs <pr>')
  expect(isPushOrMerge('node scripts/merge-gate.mjs 12', gate)).toBe(true)
  expect(isPushOrMerge('cd x && node scripts/merge-gate.mjs 12', gate)).toBe(true)
  expect(isPushOrMerge('node scripts/other.mjs 12', gate)).toBe(false)
  expect(isPushOrMerge('gh pr merge 7', merge)).toBe(true)
  // One word is too little to tell a merge from anything else.
  expect(mergePatternOf('make <pr>')).toBeNull()
  expect(isPushOrMerge('make 12', mergePatternOf('make <pr>'))).toBe(false)
  // The merge command's words are matched as text, never as a pattern.
  expect(isPushOrMerge('node scriptsXmerge-gate.mjs 12', gate)).toBe(false)
})

test('a new head whose handover was refused or held polls at the ordinary interval, and another new head brings 90 seconds back', () => {
  const passed = open([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])
  expect(pollFor(passed, D, [], [], C)).toEqual({ ms: POLL_MS.nothing, isNewHead: true })
  expect(pollFor(passed, D, [], [], D)).toEqual({ ms: NEW_HEAD_POLL_MS, isNewHead: true })
  expect(pollFor(passed, D, [], [], null)).toEqual({ ms: NEW_HEAD_POLL_MS, isNewHead: true })
})

test('the stuck interval starts at 45 minutes and doubles to a ceiling of 360 minutes, where it stays', () => {
  expect(STUCK_FIRST_MS).toBe(45 * 60_000)
  expect(STUCK_CEILING_MS).toBe(360 * 60_000)
  const intervals = [STUCK_FIRST_MS]
  while (intervals.length < 5) intervals.push(nextStuckEvery(intervals.at(-1)!))
  expect(intervals.map(ms => ms / 60_000)).toEqual([45, 90, 180, 360, 360])
})

test('a step toward a due time waits nothing once it is past, the time left when that is short, and at most one timer step', () => {
  expect(stepDelay(1_000, 5_000)).toBe(0)
  expect(stepDelay(5_000, 5_000)).toBe(0)
  expect(stepDelay(65_000, 5_000)).toBe(60_000)
  expect(stepDelay(5_000 + TIMER_STEP_MS, 5_000)).toBe(TIMER_STEP_MS)
  expect(stepDelay(5_000 + 30 * 24 * 60 * 60_000, 5_000)).toBe(TIMER_STEP_MS)
})

test('an exhausted window is one at 100 percent or more, and anything that is not a sound window is dropped', () => {
  for (const raw of [undefined, null, 'windows', 7, { kind: 'five_hour', percentUsed: 100 }]) expect(exhaustedWindows(raw)).toEqual([])
  const full = { kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-12T02:00:00Z' }
  const spend = { kind: 'spend_limit', percentUsed: 140 }
  expect(exhaustedWindows([
    full,
    { kind: 'seven_day', percentUsed: 99.9, resetsAt: '2026-10-13T00:00:00Z' },
    spend,
    null,
    'five_hour',
    { kind: 'five_hour' },
    { kind: 'five_hour', percentUsed: '100' },
    { kind: 'five_hour', percentUsed: Number.NaN },
    { kind: 'five_hour', percentUsed: Infinity },
  ])).toEqual([full, spend])
})

test('a hold resumes one minute after the latest reset of the exhausted windows, or fifteen minutes after the turn without one', () => {
  const ended = Date.parse('2026-10-12T00:00:00Z')
  const window = (percentUsed: number, resetsAt?: string) => ({ kind: 'five_hour', percentUsed, ...(resetsAt === undefined ? {} : { resetsAt }) })
  expect(RESUME_AFTER_RESET_MS).toBe(60_000)
  expect(RESUME_FALLBACK_MS).toBe(15 * 60_000)
  // The latest of several exhausted windows decides.
  expect(resumeAt([window(100, '2026-10-12T02:00:00Z'), window(120, '2026-10-12T05:00:00Z'), window(100, '2026-10-12T01:00:00Z')], ended))
    .toBe(Date.parse('2026-10-12T05:01:00Z'))
  // A window below 100 percent is not exhausted, however late it resets.
  expect(resumeAt(exhaustedWindows([window(100, '2026-10-12T02:00:00Z'), window(99.9, '2026-10-19T00:00:00Z')]), ended))
    .toBe(Date.parse('2026-10-12T02:01:00Z'))
  // A reset already past resumes one minute after the turn ended.
  expect(resumeAt([window(100, '2026-10-11T23:00:00Z')], ended)).toBe(ended + 60_000)
  expect(resumeAt([window(100, '2026-10-12T00:00:00Z')], ended)).toBe(ended + 60_000)
  // No exhausted window, or none with a reset time, resumes fifteen minutes later.
  expect(resumeAt([], ended)).toBe(ended + 15 * 60_000)
  expect(resumeAt([window(100)], ended)).toBe(ended + 15 * 60_000)
  // A reset time that cannot be read is ignored.
  expect(resumeAt([window(100, 'soon')], ended)).toBe(ended + 15 * 60_000)
  expect(resumeAt([window(100, 'soon'), window(100, '2026-10-12T03:00:00Z')], ended)).toBe(Date.parse('2026-10-12T03:01:00Z'))
  // A spend limit past 100 percent counts, even a month away.
  expect(resumeAt(exhaustedWindows([{ kind: 'spend_limit', percentUsed: 140, resetsAt: '2026-11-11T00:00:00Z' }]), ended))
    .toBe(Date.parse('2026-11-11T00:01:00Z'))
})

test('a prompt is the person\'s from the composer, the bridge, Slack, or the SDK other than the CI event, and from nowhere else', () => {
  const origins: [PromptOrigin, boolean][] = [
    [{ kind: 'composer' }, true],
    [{ kind: 'bridge' }, true],
    [{ kind: 'slack-ping' }, true],
    [{ kind: 'sdk' }, true],
    [{ kind: 'plugin', name: 'builder' }, false],
    [{ kind: 'plugin', name: 'builder', asUser: true }, false],
    [{ kind: 'task-notification' }, false],
    [{ kind: 'scheduled-trigger' }, false],
    [{ kind: 'peer' }, false],
    [{ kind: 'peer-send-message' }, false],
    [{ kind: 'projects-relay' }, false],
    [{ kind: 'channel', server: 's' }, false],
    [{ kind: 'coordinator' }, false],
    [{ kind: 'observer' }, false],
    [{ kind: 'observer-activity' }, false],
    [{ kind: 'auto-continuation' }, false],
    [{ kind: 'unclassified' }, false],
  ]
  for (const [origin, isPerson] of origins) expect(isPersonPrompt(origin, 'carry on')).toBe(isPerson)
  // The desktop app's CI event arrives from the SDK too, and is not the person.
  expect(isPersonPrompt({ kind: 'sdk' }, '<ci-monitor-event kind="failure">checks failed</ci-monitor-event>')).toBe(false)
  expect(isPersonPrompt({ kind: 'composer' }, '<ci-monitor-event kind="failure">')).toBe(true)
})

test('an unfinished workflow run makes the session wait on the checks and poll every 90 seconds, and a failed check still waits on a fix first', () => {
  const withRun = (checks: { status: string; conclusion: string | null }[], labels: string[] = []) =>
    ({ ...open(checks, labels), runs: [{ id: 1, attempt: 1, name: 'build' }] })
  const passed = withRun([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])
  expect(waitingOn(passed, [], [])).toBe('ci')
  expect(waitingOn(withRun([]), [], [])).toBe('ci')
  expect(waitingOn(withRun([{ status: 'COMPLETED', conclusion: 'SUCCESS' }], ['ready-to-merge']), [], [])).toBe('ci')
  expect(pollFor(passed, C, [], [], null)).toEqual({ ms: 90_000, isNewHead: false })
  expect(waitingOn(withRun([{ status: 'COMPLETED', conclusion: 'FAILURE' }]), [], [])).toBe('fix')
})

test('a saved stuck interval that is not a positive finite number reads as the first interval', () => {
  for (const raw of [undefined, null, '60000', {}, NaN, Infinity, -Infinity, 0, -5]) expect(stuckEveryIn(raw)).toBe(STUCK_FIRST_MS)
  expect(stuckEveryIn(90 * 60_000)).toBe(90 * 60_000)
})

test('a saved quiet time that is not a finite number reads as no quiet time', () => {
  for (const raw of [undefined, null, '1000', {}, NaN, Infinity, -Infinity]) expect(quietIn(raw)).toBe(null)
  expect(quietIn(1_000)).toBe(1_000)
  expect(quietIn(0)).toBe(0)
})

test('a saved hold without a finite numeric until reads as no hold, and a sound hold is kept', () => {
  for (const raw of [undefined, null, 5, 'hold', {}, { until: '1000' }, { until: NaN }, { until: Infinity }]) expect(holdIn(raw)).toBe(null)
  expect(holdIn({ until: 1_000 })).toEqual({ until: 1_000 })
})

test('a transcript row reports a task as ended only when it is a task notification naming an id and a status of completed, failed or killed', () => {
  const notice: PromptOrigin = { kind: 'task-notification' }
  for (const status of ['completed', 'failed', 'killed']) {
    expect(endedTaskOf({ origin: notice, task: { id: 'b1', status } })).toBe('b1')
  }
  expect(endedTaskOf({ origin: notice, task: { id: 'b1', status: 'running' } })).toBeNull()
  expect(endedTaskOf({ origin: notice, task: { id: '', status: 'completed' } })).toBeNull()
  expect(endedTaskOf({ origin: notice, task: { status: 'completed' } })).toBeNull()
  expect(endedTaskOf({ origin: notice, task: { id: 'b1' } })).toBeNull()
  expect(endedTaskOf({ origin: notice })).toBeNull()
  expect(endedTaskOf({ origin: { kind: 'composer' }, task: { id: 'b1', status: 'completed' } })).toBeNull()
})
