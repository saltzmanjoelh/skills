import { expect, test } from 'claude-code/testing'

import { countingRuns, failedRunsOf, hasFailed, isReplaced, isUnfinished, needsJobs, snapshotOf, type GhPullRequest } from '../hooks/github'
import { baseFactsOf, chooseStep, DEFAULT_MERGE_COMMAND, SKILL_SECTIONS, stepLines, type Step } from '../hooks/step'
import type { BaseFacts, HeadRun, Snapshot } from '../types'

const ME = 'owner'
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)

// One workflow run at the head. Each test names only what it is about; the
// rest is a passed run of workflow 1 started by a pull_request event.
function headRun(over: Partial<HeadRun> = {}): HeadRun {
  return {
    id: 1, workflow: 1, event: 'pull_request', number: 1, attempt: 1, name: 'ci',
    completed: true, conclusion: 'success', ...over,
  }
}

function pullRequest(over: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    state: 'OPEN',
    headRefOid: C,
    labels: [],
    reviews: [],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    mergeable: 'MERGEABLE',
    commits: [{ oid: C }],
    ...over,
  }
}

function review(sha: string, spec: string, adversarial: string) {
  return {
    author: { login: ME },
    state: 'COMMENTED',
    body: `VERDICTS ${sha.slice(0, 8)} spec=${spec} adversarial=${adversarial}\n\nfindings`,
    commit: { oid: sha },
  }
}

const FACTS: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'default' }
const approved = [review(C, 'APPROVE', 'APPROVE')]

// A snapshot of #7 at head C as a look stores it: the pull request, every
// run at the head, and the base branch's facts.
function snapshot(over: Partial<GhPullRequest> = {}, headRuns: HeadRun[] = [], facts: BaseFacts = FACTS, carried = false): Snapshot {
  return snapshotOf('o/r', pullRequest(over), ME, headRuns.filter(isUnfinished).map(r => ({ id: r.id, attempt: r.attempt, name: r.name })), {
    headRuns, facts, base: 'main', ...(carried ? { runsCarriedOver: true as const } : {}),
  })
}

const kind = (s: Snapshot, isAsking = false) => chooseStep(s, isAsking).kind

// The runs #40, #41 and #42 of the skill's old worked example: a workflow
// that listens for `labeled`, skips its jobs on that action, and cancels
// pending runs through a concurrency group. #40 was cancelled before its jobs
// started, and #41, from the same workflow and event, skipped every job.
const run40 = headRun({ id: 40, number: 40, conclusion: 'cancelled', realWork: false })
const run41 = headRun({ id: 41, number: 41, conclusion: 'success', realWork: false })

test('a run is unfinished until its status is completed, and a completed run failed unless it succeeded, was skipped or was neutral', () => {
  expect(isUnfinished(headRun({ completed: false, conclusion: null }))).toBe(true)
  expect(isUnfinished(headRun())).toBe(false)
  for (const conclusion of ['success', 'skipped', 'neutral']) expect(hasFailed(headRun({ conclusion }))).toBe(false)
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']) {
    expect(hasFailed(headRun({ conclusion }))).toBe(true)
  }
  // A completed run with no conclusion is not known to have passed.
  expect(hasFailed(headRun({ conclusion: null }))).toBe(true)
  expect(hasFailed(headRun({ completed: false, conclusion: null }))).toBe(false)
})

test('in the worked example, #41 did no real work, so #40 still counts as failed and #41 as passed', () => {
  const all = [run40, run41]
  expect(isReplaced(run40, all)).toBe(false)
  expect(countingRuns(all).map(r => r.id)).toEqual([40, 41])
  expect(failedRunsOf(all).map(r => r.id)).toEqual([40])
})

test('in the worked example, #42 replaces both while it runs, and the step waits for it', () => {
  const run42 = headRun({ id: 42, number: 42, completed: false, conclusion: null })
  const all = [run40, run41, run42]
  expect(countingRuns(all).map(r => r.id)).toEqual([42])
  expect(failedRunsOf(all)).toEqual([])
  expect(kind(snapshot({ reviews: approved }, all))).toBe('waiting')
})

test('in the worked example, #42 passing with real work replaces both, and the pull request can merge', () => {
  const run42 = headRun({ id: 42, number: 42, conclusion: 'success', realWork: true })
  const all = [run40, run41, run42]
  expect(countingRuns(all).map(r => r.id)).toEqual([42])
  expect(kind(snapshot({ reviews: approved }, all))).toBe('merge')
})

test('the worked example before #42 chooses the failed step even though both verdicts approve', () => {
  const step = chooseStep(snapshot({ reviews: approved }, [run40, run41]), false)
  expect(step).toEqual({ kind: 'failed', runs: [40] })
})

test('runs of one workflow from different events never replace each other', () => {
  const pushed = headRun({ id: 1, number: 1, event: 'push', conclusion: 'failure' })
  const newer = headRun({ id: 2, number: 2, event: 'pull_request', conclusion: 'success', realWork: true })
  expect(isReplaced(pushed, [pushed, newer])).toBe(false)
  expect(failedRunsOf([pushed, newer]).map(r => r.id)).toEqual([1])
})

test('runs of different workflows never replace each other', () => {
  const failed = headRun({ id: 1, workflow: 1, number: 1, conclusion: 'failure' })
  const other = headRun({ id: 2, workflow: 2, number: 2, conclusion: 'success', realWork: true })
  expect(failedRunsOf([failed, other]).map(r => r.id)).toEqual([1])
})

test('a newer run whose jobs read failed, or whose jobs list was empty, did no real work and replaces nothing', () => {
  const failed = headRun({ id: 1, number: 1, conclusion: 'failure' })
  // A failed jobs read leaves realWork unset; an empty list sets it false.
  const unread = headRun({ id: 2, number: 2, conclusion: 'success' })
  const empty = headRun({ id: 2, number: 2, conclusion: 'success', realWork: false })
  expect(failedRunsOf([failed, unread]).map(r => r.id)).toEqual([1])
  expect(failedRunsOf([failed, empty]).map(r => r.id)).toEqual([1])
})

test('a skipped newer run did no real work whatever its jobs say', () => {
  const failed = headRun({ id: 1, number: 1, conclusion: 'failure' })
  const skipped = headRun({ id: 2, number: 2, conclusion: 'skipped', realWork: true })
  expect(failedRunsOf([failed, skipped]).map(r => r.id)).toEqual([1])
})

test('an older run is replaced whatever it ended as, cancelled, failed or passed', () => {
  for (const conclusion of ['cancelled', 'failure', 'success']) {
    const older = headRun({ id: 1, number: 1, conclusion })
    const newer = headRun({ id: 2, number: 2, conclusion: 'failure', realWork: true })
    expect(isReplaced(older, [older, newer])).toBe(true)
  }
})

test('a run with a field GitHub left out is never compared for replacement', () => {
  const failed = headRun({ id: 1, number: 1, conclusion: 'failure' })
  const noWorkflow = headRun({ id: 2, number: 2, workflow: null, conclusion: 'success', realWork: true })
  const noEvent = headRun({ id: 3, number: 3, event: null, conclusion: 'success', realWork: true })
  const noNumber = headRun({ id: 4, number: null, conclusion: 'success', realWork: true })
  expect(failedRunsOf([failed, noWorkflow, noEvent, noNumber]).map(r => r.id)).toEqual([1])
})

test('only a completed, not skipped run with an older run of the same workflow and event needs its jobs read', () => {
  const older = headRun({ id: 1, number: 1, conclusion: 'failure' })
  const newer = headRun({ id: 2, number: 2 })
  expect(needsJobs(newer, [older, newer])).toBe(true)
  expect(needsJobs(older, [older, newer])).toBe(false)
  // One run per workflow and event reads no jobs.
  expect(needsJobs(newer, [newer])).toBe(false)
  expect(needsJobs(headRun({ id: 2, number: 2, completed: false, conclusion: null }), [older])).toBe(false)
  expect(needsJobs(headRun({ id: 2, number: 2, conclusion: 'skipped' }), [older])).toBe(false)
  expect(needsJobs(headRun({ id: 2, number: 2, event: 'push' }), [older])).toBe(false)
})

// The chooser's table: one row per state, in the list's order.
test('a merged or closed pull request chooses merged or closed before anything else', () => {
  expect(kind(snapshot({ state: 'MERGED', mergeable: 'CONFLICTING' }), true)).toBe('merged')
  expect(kind(snapshot({ state: 'CLOSED' }), true)).toBe('closed')
})

test('an open question comes before every other step of an open pull request', () => {
  expect(kind(snapshot({ mergeable: 'CONFLICTING', reviews: approved }), true)).toBe('question')
})

test('more commits since the last changes-requested verdict than the limit chooses over a limit, with the counts', () => {
  const commits = ['1', '2', '3', '4'].map(c => ({ oid: c.repeat(40) }))
  const reviews = [review('1'.repeat(40), 'REQUEST_CHANGES', 'APPROVE')]
  const s = snapshot({ headRefOid: '4'.repeat(40), commits, reviews }, [], { ...FACTS, maxPushes: 2 })
  expect(chooseStep(s, false)).toEqual({ kind: 'over-limit', limits: [{ which: 'pushes', count: 3, max: 2 }] })
  expect(kind(snapshot({ headRefOid: '4'.repeat(40), commits, reviews }, [], { ...FACTS, maxPushes: 3 }))).not.toBe('over-limit')
})

test('a round past the limit chooses over a limit, with the counts', () => {
  const heads = ['1', '2', '3'].map(c => c.repeat(40))
  const reviews = heads.map(h => review(h, 'APPROVE', 'REQUEST_CHANGES'))
  const s = snapshot({ headRefOid: C, commits: [...heads.map(oid => ({ oid })), { oid: C }], reviews }, [], { ...FACTS, maxRounds: 3, maxPushes: 99 })
  // Three heads reviewed and none at C, so round 4 is in progress.
  expect(chooseStep(s, false)).toEqual({ kind: 'over-limit', limits: [{ which: 'rounds', count: 4, max: 3 }] })
})

test('the push count before the first changes-requested verdict counts the commits after the pull request opened', () => {
  const commits = [
    { oid: '1'.repeat(40), committedDate: '2026-01-01T00:00:00Z' },
    { oid: '2'.repeat(40), committedDate: '2026-01-03T00:00:00Z' },
    { oid: '3'.repeat(40), committedDate: '2026-01-04T00:00:00Z' },
    { oid: C },
  ]
  const s = snapshot({ createdAt: '2026-01-02T00:00:00Z', commits }, [], { ...FACTS, maxPushes: 2 })
  // Two commits are dated after the opening, and one has no date, which counts.
  expect(s.pushesSinceVerdict).toBe(3)
  expect(chooseStep(s, false)).toEqual({ kind: 'over-limit', limits: [{ which: 'pushes', count: 3, max: 2 }] })
})

test('a conflict chooses conflicting, and an unknown mergeability holds nothing', () => {
  expect(kind(snapshot({ mergeable: 'CONFLICTING', reviews: approved }))).toBe('conflicting')
  expect(kind(snapshot({ mergeable: 'UNKNOWN', reviews: approved }))).toBe('merge')
})

test('a failed check chooses the failed step, with no run ids when no run failed', () => {
  const failing = [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }]
  expect(chooseStep(snapshot({ statusCheckRollup: failing }), false)).toEqual({ kind: 'failed', runs: [] })
  expect(chooseStep(snapshot({ statusCheckRollup: failing, reviews: approved }), false)).toEqual({ kind: 'failed', runs: [] })
})

test('a failed run chooses the failed step with its id, even with no check failed', () => {
  const runs = [headRun({ id: 9, conclusion: 'failure' }), headRun({ id: 3, workflow: 2, conclusion: 'startup_failure' })]
  expect(chooseStep(snapshot({}, runs), false)).toEqual({ kind: 'failed', runs: [3, 9] })
})

test('a failed run that was carried over from the stored snapshot still chooses the failed step', () => {
  const runs = [headRun({ id: 9, conclusion: 'failure' })]
  expect(chooseStep(snapshot({ reviews: approved }, runs, FACTS, true), false)).toEqual({ kind: 'failed', runs: [9] })
})

test('no verdict review at the head chooses review this head, with the head', () => {
  expect(chooseStep(snapshot(), false)).toEqual({ kind: 'review', head: C })
  // A verdict review at another head is not one at this head.
  expect(kind(snapshot({ reviews: [review(D, 'APPROVE', 'APPROVE')], commits: [{ oid: D }, { oid: C }] }))).toBe('review')
})

test('a verdict at the head that requests changes chooses changes requested, from either reviewer', () => {
  expect(kind(snapshot({ reviews: [review(C, 'REQUEST_CHANGES', 'APPROVE')] }))).toBe('changes-requested')
  expect(kind(snapshot({ reviews: [review(C, 'APPROVE', 'REQUEST_CHANGES')] }))).toBe('changes-requested')
})

test('both verdicts approving with the runs carried over holds the merge', () => {
  expect(kind(snapshot({ reviews: approved }, [headRun()], FACTS, true))).toBe('runs-unread')
})

test('a snapshot an older build stored, with no runs at the head, holds the merge as if the runs could not be read', () => {
  const { headRuns: _dropped, ...older } = snapshot({ reviews: approved })
  expect(kind(older as Snapshot)).toBe('runs-unread')
})

test('both verdicts approving with a pending check or an unfinished run waits on checks', () => {
  const pending = [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: null }]
  expect(kind(snapshot({ reviews: approved, statusCheckRollup: pending }))).toBe('waiting')
  expect(kind(snapshot({ reviews: approved }, [headRun({ completed: false, conclusion: null })]))).toBe('waiting')
})

test('both verdicts approving with every check passed merges, with the number, the head and the merge command kind', () => {
  expect(chooseStep(snapshot({ reviews: approved }, [headRun()]), false)).toEqual({ kind: 'merge', number: 7, head: C, command: 'default', checks: 'passed' })
  expect(chooseStep(snapshot({ reviews: approved }, [], { ...FACTS, merge: 'custom' }), false)).toEqual({ kind: 'merge', number: 7, head: C, command: 'custom', checks: 'passed' })
})

test('both verdicts approving with no checks merges under Checks: none and asks under Checks: expected or an unread base', () => {
  const none = { reviews: approved, statusCheckRollup: [] }
  expect(chooseStep(snapshot(none, [], { ...FACTS, checks: 'none' }), false)).toEqual({ kind: 'merge', number: 7, head: C, command: 'default', checks: 'none' })
  expect(chooseStep(snapshot(none, [headRun({ id: 5 })], FACTS), false)).toEqual({ kind: 'ask-merge', number: 7, head: C, command: 'default', runs: ['5.1'] })
  const unread: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'unread' }
  expect(kind(snapshot(none, [], unread))).toBe('ask-merge')
})

test('a snapshot without base facts takes the defaults, which never merge without checks', () => {
  const { facts: _dropped, ...older } = snapshot({ reviews: approved, statusCheckRollup: [] })
  expect(chooseStep(older as Snapshot, false)).toEqual({ kind: 'ask-merge', number: 7, head: C, command: 'unread', runs: [] })
})

test('malformed entries in the stored runs are dropped rather than throwing', () => {
  const s = snapshot({ reviews: approved }, [headRun()])
  const damaged = { ...s, headRuns: [null, 'x', { id: 'one' }, ...s.headRuns!] } as unknown as Snapshot
  expect(kind(damaged)).toBe('merge')
})

test('the base facts are read from the base branch CLAUDE.md, with defaults for every line it lacks', () => {
  expect(baseFactsOf('Max pushes per round: 3\nMax rounds: 2\nChecks: none\n', null)).toEqual({ maxPushes: 3, maxRounds: 2, checks: 'none', merge: 'default' })
  expect(baseFactsOf('Merge command: `./merge.sh <n> <sha>`\nChecks: expected\n', null)).toEqual({ maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'custom' })
  expect(baseFactsOf(`Merge command: ${DEFAULT_MERGE_COMMAND}\nChecks: none\n`, null).merge).toBe('default')
  // A limit that is not a whole number takes its default.
  expect(baseFactsOf('Max pushes per round: many\nChecks: none\n', null).maxPushes).toBe(8)
  // Without a Checks line, the base's workflow files decide, and a listing
  // that failed leans to expected.
  expect(baseFactsOf('', true).checks).toBe('expected')
  expect(baseFactsOf('', false).checks).toBe('none')
  expect(baseFactsOf('', null).checks).toBe('expected')
  // Anything but none is expected.
  expect(baseFactsOf('Checks: maybe\n', false).checks).toBe('expected')
})

// Every step, as the chooser can return it, for the text tests.
const EVERY_STEP: Step[] = [
  { kind: 'merged' },
  { kind: 'closed' },
  { kind: 'question' },
  { kind: 'over-limit', limits: [{ which: 'pushes', count: 9, max: 8 }, { which: 'rounds', count: 6, max: 5 }] },
  { kind: 'conflicting' },
  { kind: 'failed', runs: [123456, 789] },
  { kind: 'review', head: C },
  { kind: 'changes-requested' },
  { kind: 'runs-unread' },
  { kind: 'waiting' },
  { kind: 'merge', number: 7, head: C, command: 'default', checks: 'passed' },
  { kind: 'merge', number: 7, head: C, command: 'custom', checks: 'passed' },
  { kind: 'merge', number: 7, head: C, command: 'unread', checks: 'none' },
  { kind: 'ask-merge', number: 7, head: C, command: 'default', runs: ['5.1', '6.2'] },
  { kind: 'ask-merge', number: 7, head: C, command: 'unread', runs: [] },
]

const textOf = (step: Step) => stepLines(step).join('\n')

test('every step text begins with a line naming the step', () => {
  const names = EVERY_STEP.map(step => stepLines(step)[0])
  for (const name of names) expect(name).toMatch(/^The step that applies: .+\.$/)
  expect(names[0]).toBe('The step that applies: Merged.')
  expect(names[6]).toBe('The step that applies: Review this head.')
})

test('the default merge text holds the merge command with the number and the full head, and the guards', () => {
  const text = textOf({ kind: 'merge', number: 7, head: C, command: 'default', checks: 'passed' })
  expect(text).toContain(`gh pr merge 7 --merge --match-head-commit ${C}`)
  expect(text).toContain('Commits the pull request lacks')
  expect(text).toContain('mcp__builder__progress')
  expect(text).toContain('ready-to-merge')
  expect(text).toContain(`gh pr view 7 --json headRefOid,statusCheckRollup`)
  expect(text).toContain('Never merge any other way')
  expect(text).toContain('If the command refuses, say why and wait.')
  // The facts that govern the merge must not have been changed by the branch.
  expect(text).toContain('Merge command:')
  expect(text).toContain('Max pushes per round:')
})

test('the custom and unread merge texts say to read Merge command: from the base and never to merge around a gate with the default', () => {
  for (const command of ['custom', 'unread'] as const) {
    const text = textOf({ kind: 'merge', number: 7, head: C, command, checks: 'passed' })
    expect(text).toContain('git show origin/<base>:CLAUDE.md')
    expect(text).toContain('`Merge command:`')
    expect(text).toContain('with <n> as 7 and <sha> as ' + C)
    expect(text).toContain('never merge around a project\'s own gate with the default command')
    expect(text).not.toContain(`gh pr merge 7 --merge --match-head-commit ${C}`)
  }
})

test('the merge text under Checks: none says there are no checks and does not claim they passed', () => {
  const text = textOf({ kind: 'merge', number: 7, head: C, command: 'default', checks: 'none' })
  expect(text).toContain('Checks: none')
  expect(text).not.toContain('every check passed')
})

test('the question for a merge without checks covers this head and these runs, and keeps the read again before merging on a yes', () => {
  const text = textOf({ kind: 'ask-merge', number: 7, head: C, command: 'default', runs: ['5.1', '6.2'] })
  expect(text).toContain(C)
  expect(text).toContain('run 5 (attempt 1), run 6 (attempt 2)')
  expect(text).toContain('They already said no to this head and these runs')
  expect(text).toContain('They already said yes to this head and these runs')
  expect(text).toContain('Read again before merging on a yes')
  expect(text).toContain('no checks, no unfinished run and no new run')
  expect(text).toContain(`gh pr merge 7 --merge --match-head-commit ${C}`)
  expect(text).toContain('Commits the pull request lacks')
  expect(textOf({ kind: 'ask-merge', number: 7, head: C, command: 'unread', runs: [] })).toContain('no workflow runs')
})

test('the failed text holds the run ids and how to read them', () => {
  const text = textOf({ kind: 'failed', runs: [123456, 789] })
  expect(text).toContain('123456, 789')
  expect(text).toContain('gh run view <id> --log-failed')
  expect(text).toContain('gh run rerun <id> --failed')
  expect(text).toContain('waiting-on-author')
  expect(textOf({ kind: 'failed', runs: [] })).toContain('No workflow run counts as failed')
})

test('the over-limit text holds each limit and its counts', () => {
  const text = textOf({ kind: 'over-limit', limits: [{ which: 'pushes', count: 9, max: 8 }, { which: 'rounds', count: 6, max: 5 }] })
  expect(text).toContain('9 pushes')
  expect(text).toContain('`Max pushes per round` is 8')
  expect(text).toContain('Round 6')
  expect(text).toContain('`Max rounds` is 5')
  expect(text).toContain('stuck')
  expect(text).toContain('The line to the starting session')
})

test('the review text holds the head and says how to tell which half is due', () => {
  const text = textOf({ kind: 'review', head: C })
  expect(text).toContain(C)
  expect(text).toContain('first half')
  expect(text).toContain('second half')
  expect(text).toContain('mcp__builder__package')
  expect(text).toContain('The check after approval')
})

test('the waiting and unread texts end the turn and never merge', () => {
  expect(textOf({ kind: 'waiting' })).toContain('waiting on checks')
  expect(textOf({ kind: 'waiting' })).toContain('ready-to-merge')
  const unread = textOf({ kind: 'runs-unread' })
  expect(unread).toContain('could not be read')
  expect(unread).toContain('Merge nothing')
  expect(unread).toContain('end the turn')
})

test('the merged text keeps updating the linked checkout, the follow-ups and the cleanup', () => {
  const text = textOf({ kind: 'merged' })
  expect(text).toContain('Updating the linked checkout')
  expect(text).toContain('Follow-ups from <owner>/<name>#<n>')
  expect(text).toContain('/cleanup')
  expect(text).toContain('Commits the pull request lacks')
})

test('no step text holds a check or label name, only the state labels the skill sets', () => {
  const names = ['tests', 'build', 'lint', 'needs-decision']
  for (const step of EVERY_STEP) {
    const text = textOf(step)
    for (const name of names) expect(text).not.toContain(`"${name}"`)
  }
})

// No test can read skills/implement/SKILL.md, because the testing kit refuses
// a file outside the mod's folder, so the sections the step texts point to
// are pinned in SKILL_SECTIONS in hooks/step.ts. A change to one of those
// headings in the skill has to be made in SKILL_SECTIONS too. This test
// checks that every section a text names is one of the pinned ones.
test('every section of /implement that a step text names is one of the pinned headings', () => {
  const named = new Set<string>()
  for (const step of EVERY_STEP) {
    for (const match of textOf(step).matchAll(/"([^"]+)" in \/implement/g)) named.add(match[1]!)
  }
  expect(named.size).toBeGreaterThan(0)
  for (const name of named) expect(SKILL_SECTIONS).toContain(name)
})
