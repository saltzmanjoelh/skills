import { expect, test } from 'claude-code/testing'

import { countingRuns, failedRunsOf, hasFailed, isReplaced, isUnfinished, needsJobs, snapshotOf, type GhPullRequest } from '../hooks/github'
import { baseFactsOf, chooseStep, CLEANUP_SECTIONS, DEFAULT_MERGE_COMMAND, FRONTEND_FILE, FRONTEND_SECTIONS, isJudgementKept, labelActionOf, LINKED_KEPT, linkedIn, labelFor, labelRecordIn, needsListing, otherStateLabelsOf, reviewerFactOf, SCREENSHOTS_MARKER, SKILL_POINTS, SKILL_SECTIONS, stepFor, stepLines, UNREAD_FACTS, unpushedIn, type Step } from '../hooks/step'
import type { BaseFacts, HeadRun, Snapshot, Unpushed } from '../types'

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

// The commits a worktree holds that the head lacks, as a step carries them:
// a snapshot that holds no listing reads as could not be listed.
const UNLISTED: Unpushed = { kind: 'unlisted' }
const NONE: Unpushed = { kind: 'none' }

// A record review the session posts once the /code-review pass ran at `sha`,
// as the mod writes it: the verdicts line that approves with both verdicts,
// then the marker line, then the body. Each test names only what it is about.
function recordReview(sha: string, marker: string, over: { login?: string; commit?: string; verdicts?: string } = {}) {
  return {
    author: { login: over.login ?? ME },
    state: 'COMMENTED',
    body: `VERDICTS ${sha.slice(0, 8)} ${over.verdicts ?? 'spec=APPROVE adversarial=APPROVE'}\n${marker}\n\nThe /code-review pass ran.`,
    commit: { oid: over.commit ?? sha },
  }
}

// The record of a pass at `sha` that started from `since`, and of a waiver.
const passAt = (sha: string, since = 'base') => recordReview(sha, `CODE-REVIEW ${sha.slice(0, 8)} since=${since === 'base' ? 'base' : since.slice(0, 8)}`)
const waiverAt = (sha: string) => recordReview(sha, `CODE-REVIEW ${sha.slice(0, 8)} waived`)

const FACTS: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'default', isClaudeRead: true }
// Both verdicts approve at the head, and the /code-review pass ran there, so
// the steps after the pass are chosen.
const approved = [review(C, 'APPROVE', 'APPROVE'), passAt(C)]
// Both verdicts approve at the head, and no pass ran there yet.
const approvedOnly = [review(C, 'APPROVE', 'APPROVE')]

// A snapshot of #7 at head C as a look stores it: the pull request, every
// run at the head, and the base branch's facts.
function snapshot(over: Partial<GhPullRequest> = {}, headRuns: HeadRun[] = [], facts: BaseFacts = FACTS, carried = false): Snapshot {
  return snapshotOf('o/r', pullRequest(over), ME, headRuns.filter(isUnfinished).map(r => ({ id: r.id, attempt: r.attempt, name: r.name })), {
    headRuns, facts, ...(carried ? { runsCarriedOver: true as const } : {}),
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

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

test('both verdicts approving with no record of a /code-review pass at the head chooses the pass, reading the whole pull request', () => {
  const s = snapshot({ reviews: approvedOnly }, [headRun()])
  expect(chooseStep(s, false)).toEqual({ kind: 'code-review', head: C, since: null })
  expect(labelFor(chooseStep(s, false))).toBe('in-review')
})

test('a pass or a waiver at the head moves on to the outside reviewer and merge steps', () => {
  for (const marker of [passAt(C), passAt(C, A), waiverAt(C)]) {
    const reviews = [review(C, 'APPROVE', 'APPROVE'), marker]
    const commits = [{ oid: A }, { oid: C }]
    expect(snapshot({ reviews, commits }).codeReviewed).toBe(true)
    expect(kind(snapshot({ reviews, commits }, [headRun()]))).toBe('merge')
    expect(kind(snapshot({ reviews, commits, reviewRequests: [{ __typename: 'User', login: 'ann' }] }, [headRun()]))).toBe('awaiting-review')
  }
})

test('a marker from another login, one whose head is not the review\'s commit, one off the second line, and one under a verdict that requests changes are ignored', () => {
  const ignored = [
    recordReview(C, `CODE-REVIEW ${C.slice(0, 8)} since=base`, { login: 'someone-else' }),
    recordReview(C, `CODE-REVIEW ${D.slice(0, 8)} since=base`),
    { author: { login: ME }, state: 'COMMENTED', body: `CODE-REVIEW ${C.slice(0, 8)} since=base\n\nThe pass ran.`, commit: { oid: C } },
    { author: { login: ME }, state: 'COMMENTED', body: `VERDICTS ${C.slice(0, 8)} spec=APPROVE adversarial=APPROVE\n\nCODE-REVIEW ${C.slice(0, 8)} since=base`, commit: { oid: C } },
  ]
  for (const marker of ignored) {
    const s = snapshot({ reviews: [review(C, 'APPROVE', 'APPROVE'), marker] }, [headRun()])
    expect(s.codeReviewed).toBeUndefined()
    expect(s.codeReviewSince).toBeUndefined()
    expect(kind(s)).toBe('code-review')
  }
  const underChanges = snapshot({ reviews: [review(C, 'APPROVE', 'APPROVE'), recordReview(C, `CODE-REVIEW ${C.slice(0, 8)} since=base`, { verdicts: 'spec=REQUEST_CHANGES adversarial=APPROVE' })] })
  expect(underChanges.codeReviewed).toBeUndefined()
  expect(underChanges.codeReviewSince).toBeUndefined()
})

test('the next pass starts from the newest pass marker among the pull request\'s commits, and never from a waiver', () => {
  const commits = [{ oid: A }, { oid: B }, { oid: C }]
  const passes = snapshot({ commits, reviews: [review(A, 'APPROVE', 'APPROVE'), passAt(A), review(B, 'APPROVE', 'APPROVE'), passAt(B, A), review(C, 'APPROVE', 'APPROVE')] })
  expect(passes.codeReviewSince).toBe(B)
  expect(chooseStep(passes, false)).toEqual({ kind: 'code-review', head: C, since: B })
  const waived = snapshot({ commits, reviews: [review(A, 'APPROVE', 'APPROVE'), passAt(A), review(B, 'APPROVE', 'APPROVE'), waiverAt(B), review(C, 'APPROVE', 'APPROVE')] })
  expect(waived.codeReviewSince).toBe(A)
  expect(chooseStep(waived, false)).toEqual({ kind: 'code-review', head: C, since: A })
  const onlyWaived = snapshot({ commits, reviews: [review(B, 'APPROVE', 'APPROVE'), waiverAt(B), review(C, 'APPROVE', 'APPROVE')] })
  expect(chooseStep(onlyWaived, false)).toEqual({ kind: 'code-review', head: C, since: null })
})

test('a marked head that is no longer among the pull request\'s commits gives a pass over the whole pull request', () => {
  const s = snapshot({ commits: [{ oid: B }, { oid: C }], reviews: [review(A, 'APPROVE', 'APPROVE'), passAt(A), review(C, 'APPROVE', 'APPROVE')] })
  expect(s.codeReviewSince).toBeUndefined()
  expect(chooseStep(s, false)).toEqual({ kind: 'code-review', head: C, since: null })
})

test('changes requested and a failed check still come before the /code-review pass', () => {
  const failing = [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }]
  expect(kind(snapshot({ reviews: [review(C, 'APPROVE', 'APPROVE'), review(C, 'REQUEST_CHANGES', 'APPROVE')] }))).toBe('changes-requested')
  expect(kind(snapshot({ reviews: approvedOnly, statusCheckRollup: failing }))).toBe('failed')
  expect(kind(snapshot({ reviews: approvedOnly, mergeable: 'CONFLICTING' }))).toBe('conflicting')
})

test('a snapshot an older build stored, with neither fact of the pass, counts as no pass at the head', () => {
  const { codeReviewed: _reviewed, codeReviewSince: _since, ...older } = snapshot({ reviews: approved }, [headRun()])
  expect(kind(older as Snapshot)).toBe('code-review')
})

test('a start that is not a full commit sha is never put into the step', () => {
  const s = { ...snapshot({ reviews: approvedOnly }), codeReviewSince: 'abcdef01' }
  expect(chooseStep(s, false)).toEqual({ kind: 'code-review', head: C, since: null })
})

test('the /code-review pass text names the head and the start, or the whole pull request, and points to the skill\'s paragraph', () => {
  const later = textOf({ kind: 'code-review', head: C, since: A })
  expect(later).toContain('The step that applies: Run the /code-review pass at this head.')
  expect(later).toContain(C)
  expect(later).toContain(`${A}..${C}`)
  expect(later).toContain('"The /code-review pass" in /implement')
  expect(later).toContain(`since: "${A}"`)
  expect(later).not.toContain('--fix')
  const first = textOf({ kind: 'code-review', head: C, since: null })
  expect(first).toContain('whole pull request')
  expect(first).toContain(`git merge-base origin/<base> ${C}`)
  expect(first).toContain('since: "base"')
})

test('both verdicts approving with the runs carried over holds the merge', () => {
  expect(kind(snapshot({ reviews: approved }, [headRun()], FACTS, true))).toBe('runs-unread')
})

test('a snapshot an older build stored, with no runs at the head, holds the merge as if the runs could not be read', () => {
  const { headRuns: _dropped, ...older } = snapshot({ reviews: approved })
  expect(kind(older as Snapshot)).toBe('runs-unread')
})

// The base facts of a look that found the user's own CLAUDE.md unreadable
// while the base branch's CLAUDE.md named no reviewer.
const UNKNOWN: BaseFacts = { ...FACTS, reviewersUnknown: true }

test('both verdicts approving with the reviewers unknown holds the merge, in place of every later step where both verdicts approve', () => {
  const pending = [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: null }]
  const none = { reviews: approved, statusCheckRollup: [] }
  // Without the mark: merge, runs unread, waiting, merge without checks.
  expect(kind(snapshot({ reviews: approved }, [headRun()]))).toBe('merge')
  expect(kind(snapshot({ reviews: approved }, [headRun()], UNKNOWN))).toBe('user-claude-unread')
  expect(kind(snapshot({ reviews: approved }, [headRun()], UNKNOWN, true))).toBe('user-claude-unread')
  expect(kind(snapshot({ reviews: approved, statusCheckRollup: pending }, [], UNKNOWN))).toBe('user-claude-unread')
  expect(kind(snapshot(none, [], { ...UNKNOWN, checks: 'none' }))).toBe('user-claude-unread')
  expect(kind(snapshot(none, [headRun({ id: 5 })], UNKNOWN))).toBe('user-claude-unread')
  const sha = 'abcdef0123456789'
  expect(kind(snapshot({ reviews: [review(sha, 'APPROVE', 'APPROVE'), passAt(sha)], headRefOid: sha, commits: [{ oid: sha }] }, [headRun()], UNKNOWN))).toBe('user-claude-unread')
  // The base branch's file unread too: factsOf would answer the unread facts,
  // which have no mark, so the chooser reads the mark from the snapshot.
  expect(kind(snapshot(none, [], { ...UNREAD_FACTS, reviewersUnknown: true }))).toBe('user-claude-unread')
})

test('with the reviewers unknown, the steps before both verdicts approve and the outside reviewer steps still come first', () => {
  expect(kind(snapshot({}, [headRun()], UNKNOWN))).toBe('review')
  expect(kind(snapshot({ reviews: [review(C, 'REQUEST_CHANGES', 'APPROVE')] }, [], UNKNOWN))).toBe('changes-requested')
  expect(kind(snapshot({ reviews: approved, mergeable: 'CONFLICTING' }, [], UNKNOWN))).toBe('conflicting')
  expect(kind(snapshot({ reviews: approved }, [], UNKNOWN), true)).toBe('question')
  expect(kind(snapshot({ reviews: approved, reviewRequests: [{ __typename: 'User', login: 'ann' }] }, [headRun()], UNKNOWN))).toBe('awaiting-review')
  const annComments = { author: { login: 'ann' }, state: 'COMMENTED', body: '', commit: { oid: C }, submittedAt: '2026-11-05T10:00:00Z', authorAssociation: 'MEMBER' }
  expect(kind(snapshot({ reviews: [...approved, annComments] }, [headRun()], UNKNOWN))).toBe('outside-feedback')
  const annApproves = { ...annComments, state: 'APPROVED' }
  expect(kind(snapshot({ reviews: [...approved, annApproves] }, [headRun()], UNKNOWN))).toBe('user-claude-unread')
})

test('a snapshot without the unknown mark counts as known and merges, including one with unread base facts', () => {
  const none = { reviews: approved, statusCheckRollup: [] }
  expect(kind(snapshot({ reviews: approved }, [headRun()]))).toBe('merge')
  expect(kind(snapshot(none, [], UNREAD_FACTS))).toBe('ask-merge')
  const { facts: _facts, ...noFacts } = snapshot(none)
  expect(kind(noFacts as Snapshot)).toBe('ask-merge')
})

test('the reviewers are unknown only when the user\'s file is unreadable and the base branch\'s file names no reviewer', () => {
  expect(reviewerFactOf('Checks: none\n', { kind: 'unreadable' })).toEqual({ reviewers: [], isUnknown: true })
  expect(reviewerFactOf(null, { kind: 'unreadable' })).toEqual({ reviewers: [], isUnknown: true })
  expect(reviewerFactOf('Reviewer: ann\n', { kind: 'unreadable' })).toEqual({ reviewers: ['ann'], isUnknown: false })
  expect(reviewerFactOf('Reviewer: none\n', { kind: 'unreadable' })).toEqual({ reviewers: [], isUnknown: false })
  expect(reviewerFactOf('Checks: none\n', { kind: 'read', text: 'Reviewer: bob\n' })).toEqual({ reviewers: ['bob'], isUnknown: false })
  expect(reviewerFactOf(null, { kind: 'read', text: 'Reviewer: bob\n' })).toEqual({ reviewers: ['bob'], isUnknown: false })
  expect(reviewerFactOf('Reviewer: ann\n', { kind: 'read', text: 'Reviewer: bob\n' })).toEqual({ reviewers: ['ann'], isUnknown: false })
  expect(reviewerFactOf('Checks: none\n', { kind: 'missing' })).toEqual({ reviewers: [], isUnknown: false })
  expect(reviewerFactOf(null, { kind: 'missing' })).toEqual({ reviewers: [], isUnknown: false })
})

test('a user CLAUDE.md that was read and whose whole text is the word unreadable is not taken for an unreadable file', () => {
  expect(reviewerFactOf('Checks: none\n', { kind: 'read', text: 'unreadable' })).toEqual({ reviewers: [], isUnknown: false })
})

test('both verdicts approving with a pending check or an unfinished run waits on checks', () => {
  const pending = [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: null }]
  expect(kind(snapshot({ reviews: approved, statusCheckRollup: pending }))).toBe('waiting')
  expect(kind(snapshot({ reviews: approved }, [headRun({ completed: false, conclusion: null })]))).toBe('waiting')
})

test('both verdicts approving with every check passed merges, with the number, the head and the merge command kind', () => {
  expect(chooseStep(snapshot({ reviews: approved }, [headRun()]), false)).toEqual({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'passed', runs: [{ id: 1, attempt: 1 }], unpushed: UNLISTED })
  expect(chooseStep(snapshot({ reviews: approved }, [], { ...FACTS, merge: 'custom' }), false)).toEqual({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'custom', checks: 'passed', runs: [], unpushed: UNLISTED })
})

test('both verdicts approving with no checks merges under Checks: none and asks under Checks: expected or an unread base', () => {
  const none = { reviews: approved, statusCheckRollup: [] }
  expect(chooseStep(snapshot(none, [], { ...FACTS, checks: 'none' }), false)).toEqual({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'none', runs: [], unpushed: UNLISTED })
  expect(chooseStep(snapshot(none, [headRun({ id: 5 })], FACTS), false)).toEqual({ kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'default', runs: [{ id: 5, attempt: 1 }], isClaudeRead: true, unpushed: UNLISTED })
  const unread: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'unread', isClaudeRead: false }
  expect(chooseStep(snapshot(none, [], unread), false)).toEqual({ kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'unread', runs: [], isClaudeRead: false, unpushed: UNLISTED })
})

test('a snapshot without base facts takes the defaults, which never merge without checks', () => {
  const { facts: _dropped, ...older } = snapshot({ reviews: approved, statusCheckRollup: [] })
  expect(chooseStep(older as Snapshot, false)).toEqual({ kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'unread', runs: [], isClaudeRead: false, unpushed: UNLISTED })
})

test('stored base facts say whether the base CLAUDE.md was read, and facts that do not say it was are the unread ones', () => {
  const none = { reviews: approved, statusCheckRollup: [] }
  // Facts without the field are damaged, and count as unread whatever else
  // they hold, so they never allow a merge without checks.
  const missing = { maxPushes: 8, maxRounds: 5, checks: 'none', merge: 'default' } as unknown as BaseFacts
  expect(chooseStep(snapshot(none, [], missing), false)).toMatchObject({ kind: 'ask-merge', command: 'unread', isClaudeRead: false })
  // Facts that say the file was not read never allow a merge without checks
  // or the default command, whatever else they hold.
  const damaged: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'none', merge: 'default', isClaudeRead: false }
  expect(chooseStep(snapshot(none, [], damaged), false)).toMatchObject({ kind: 'ask-merge', command: 'unread', isClaudeRead: false })
  const read: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'custom', isClaudeRead: true }
  expect(chooseStep(snapshot(none, [], read), false)).toMatchObject({ kind: 'ask-merge', command: 'custom', isClaudeRead: true })
})

test('a repository that is not a plain owner and name is left out of the step', () => {
  const s = { ...snapshot({ reviews: approved }, [headRun()]), repo: 'o/r; rm -rf /' }
  expect(chooseStep(s, false)).toMatchObject({ kind: 'merge', repo: null })
  expect(stepLines(chooseStep(s, false)).join('\n')).not.toContain('rm -rf')
})

test('malformed entries in the stored runs are dropped rather than throwing', () => {
  const s = snapshot({ reviews: approved }, [headRun()])
  const damaged = { ...s, headRuns: [null, 'x', { id: 'one' }, ...s.headRuns!] } as unknown as Snapshot
  expect(kind(damaged)).toBe('merge')
})

test('the base facts are read from the base branch CLAUDE.md, with defaults for every line it lacks', () => {
  expect(baseFactsOf('Max pushes per round: 3\nMax rounds: 2\nChecks: none\n', null)).toEqual({ maxPushes: 3, maxRounds: 2, checks: 'none', merge: 'default', isClaudeRead: true })
  expect(baseFactsOf('Merge command: `./merge.sh <n> <sha>`\nChecks: expected\n', null)).toEqual({ maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'custom', isClaudeRead: true })
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

// An outcome of the update of the linked checkout, as a look stores it.
const UPDATED = [`Updated: the linked checkout /repo now holds the merge commit ${D}, and its HEAD is ${D}. The fetch came from the remote origin.`]

// Every step, as the chooser can return it, for the text tests.
const EVERY_STEP: Step[] = [
  { kind: 'merged', unpushed: NONE, linked: UPDATED },
  { kind: 'closed' },
  { kind: 'question' },
  { kind: 'over-limit', limits: [{ which: 'pushes', count: 9, max: 8 }, { which: 'rounds', count: 6, max: 5 }] },
  { kind: 'conflicting' },
  { kind: 'failed', runs: [123456, 789] },
  { kind: 'review', head: C },
  { kind: 'changes-requested' },
  { kind: 'code-review', head: C, since: null },
  { kind: 'code-review', head: C, since: D },
  { kind: 'code-review', head: null, since: null },
  { kind: 'user-claude-unread' },
  { kind: 'runs-unread' },
  { kind: 'waiting' },
  { kind: 'head-unchecked' },
  { kind: 'review', head: null },
  { kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'passed', runs: [{ id: 5, attempt: 1 }], unpushed: NONE },
  { kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'custom', checks: 'passed', runs: [], unpushed: UNLISTED },
  { kind: 'merge', number: 7, head: C, repo: null, command: 'unread', checks: 'none', runs: [], unpushed: { kind: 'some', commits: ['abcdef012345'], total: 1, isAncestor: true } },
  { kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'default', runs: [{ id: 5, attempt: 1 }, { id: 6, attempt: 2 }], isClaudeRead: true, unpushed: NONE },
  { kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'unread', runs: [], isClaudeRead: false, unpushed: UNLISTED },
  { kind: 'merged', unpushed: UNLISTED, linked: null },
  { kind: 'merged', unpushed: NONE, linked: 'unread' },
  { kind: 'merged', unpushed: { kind: 'some', commits: ['abcdef012345', '0123456789ab'], total: 2, isAncestor: false }, linked: UPDATED },
  { kind: 'outside-feedback', number: 7, reviewers: ['ann', 'ben'], others: ['review-app'] },
  { kind: 'outside-feedback', number: 7, reviewers: ['ann'] },
  { kind: 'request-review', number: 7, reviewers: ['dan'], others: ['review-app'] },
  { kind: 'request-review', number: 7, reviewers: ['dan', 'eve'] },
  { kind: 'awaiting-review', reviewers: ['cat'], others: ['review-app', 'passerby'] },
  { kind: 'awaiting-review', reviewers: ['cat'] },
]

const textOf = (step: Step) => stepLines(step).join('\n')

test('every step text begins with a line naming the step', () => {
  const names = EVERY_STEP.map(step => stepLines(step)[0])
  for (const name of names) expect(name).toMatch(/^The step that applies: .+\.$/)
  expect(names[0]).toBe('The step that applies: Merged.')
  expect(names[6]).toBe('The step that applies: Review this head.')
})

test('a head that is not a full commit sha never reaches a step text, and never leads to a merge', () => {
  const bad = 'abcdef0123456789'
  const approvedAt = [review(bad, 'APPROVE', 'APPROVE'), passAt(bad)]
  const passed = snapshot({ headRefOid: bad, commits: [{ oid: bad }], reviews: approvedAt }, [headRun()])
  expect(kind(passed)).toBe('head-unchecked')
  const none = snapshot({ headRefOid: bad, commits: [{ oid: bad }], reviews: approvedAt, statusCheckRollup: [] }, [], { ...FACTS, checks: 'none' })
  expect(kind(none)).toBe('head-unchecked')
  const unreviewed = snapshot({ headRefOid: bad, commits: [{ oid: bad }] }, [headRun()])
  expect(chooseStep(unreviewed, false)).toEqual({ kind: 'review', head: null })
  for (const s of [passed, none, unreviewed]) expect(stepFor(s, false).join('\n')).not.toContain(bad)
})

test('the default merge text holds the merge command with the number and the full head, and the guards', () => {
  const text = textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'passed', runs: [], unpushed: NONE })
  expect(text).toContain(`gh pr merge 7 --merge --match-head-commit ${C}`)
  expect(text).toContain('Commits the pull request lacks')
  // The mod sets the label and reports the merge stage itself.
  expect(text).not.toContain('mcp__builder__progress')
  expect(text).not.toContain('ready-to-merge')
  expect(text).toContain(`gh pr view 7 --json headRefOid,statusCheckRollup,reviews,reviewRequests`)
  expect(text).toContain('Never merge any other way')
  expect(text).toContain('If the command refuses, say why and wait.')
  // The facts that govern the merge must not have been changed by the branch.
  expect(text).toContain('Merge command:')
  expect(text).toContain('Max pushes per round:')
})

test('the custom and unread merge texts say to read Merge command: from the base and never to merge around a gate with the default', () => {
  for (const command of ['custom', 'unread'] as const) {
    const text = textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command, checks: 'passed', runs: [], unpushed: NONE })
    expect(text).toContain('git show origin/<base>:CLAUDE.md')
    expect(text).toContain('`Merge command:`')
    expect(text).toContain('with <n> as 7 and <sha> as ' + C)
    expect(text).toContain('never merge around a project\'s own gate with the default command')
    expect(text).not.toContain(`gh pr merge 7 --merge --match-head-commit ${C}`)
  }
})

test('the merge text under Checks: none says there are no checks and does not claim they passed', () => {
  const text = textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'none', runs: [], unpushed: NONE })
  expect(text).toContain('Checks: none')
  expect(text).not.toContain('every check passed')  // The file can count as none by the default, with no `Checks:` line of
  // its own, so the text never claims the file says so.
  expect(text).toContain('or it has no `Checks:` line and the base has no files under `.github/workflows`')
  expect(text).not.toContain('CLAUDE.md says `Checks: none`')
})

test('every merge text fetches the base and reads its CLAUDE.md again before merging, because the mod read a local copy', () => {
  const merges = EVERY_STEP.filter(step => step.kind === 'merge' || step.kind === 'ask-merge')
  for (const step of merges) {
    const text = textOf(step)
    expect(text).toContain('git fetch origin <base>')
    expect(text).toContain('If the fetch fails, do not merge')
  }
  const none = textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'none', runs: [], unpushed: NONE })
  expect(none).toContain('If the fetched file no longer counts as `Checks: none`, because it names `Checks:` with another value, or has no `Checks:` line while `git ls-tree --full-tree origin/<base> .github/workflows` lists anything, do not merge')
  expect(none).toContain('If the fetched file now names a `Merge command:`')
  const passed = textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'custom', checks: 'passed', runs: [], unpushed: NONE })
  expect(passed).not.toContain('no longer counts as `Checks: none`')
  expect(passed).not.toContain('now names a `Merge command:`')
})

test('every merge text reads the head\'s runs again and calls the watch tool for a run the mod did not see', () => {
  const read = `gh api --paginate "repos/o/r/actions/runs?head_sha=${C}" --jq '.workflow_runs[] | {id, run_attempt, status, conclusion}'`
  const merges = EVERY_STEP.filter(step => step.kind === 'merge' || step.kind === 'ask-merge')
  expect(merges.length).toBe(5)
  for (const step of merges) {
    const text = textOf(step)
    expect(text).toContain(step.repo === null ? read.replace('repos/o/r/', 'repos/<repo>/') : read)
    expect(text).toContain('unfinished, has failed or passed')
    expect(text).toContain('call `mcp__builder__watch` and follow the step it names')
  }
  const seen = textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'passed', runs: [{ id: 5, attempt: 1 }, { id: 6, attempt: 2 }], unpushed: NONE })
  expect(seen).toContain('The mod saw run 5 (attempt 1), run 6 (attempt 2) at this head')
  expect(textOf({ kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'none', runs: [], unpushed: NONE })).toContain('The mod saw no workflow runs at this head')
  // A repository left out is named by a placeholder the text explains.
  expect(textOf({ kind: 'merge', number: 7, head: C, repo: null, command: 'unread', checks: 'none', runs: [], unpushed: NONE })).toContain('<repo> as the pull request\'s repository')
})

// The `Reviewer:` line decides who holds the merge, so a branch that adds
// `Reviewer: none` or changes the line must not merge without the person.
test('every merge text asks the person before merging when the branch changes the Reviewer: line or any other line that governs the merge', () => {
  const merges = EVERY_STEP.filter(step => step.kind === 'merge' || step.kind === 'ask-merge')
  expect(merges.length).toBe(5)
  for (const step of merges) {
    expect(textOf(step)).toContain('- If the branch changes any of the `Merge command:`, `Checks:`, `Max pushes per round:`, `Max rounds:`, `Reviewer:` or `Base branch:` lines of CLAUDE.md, ask the person before merging, because those lines govern the merge and are read from the base branch.')
  }
})

// The session posts its own verdict reviews as comment reviews, so its newest
// review is never an approval, and its login usually carries OWNER or
// COLLABORATOR. A rule on the association that did not leave the session out
// would hold every merge, and the watch would name the merge again.
test('every merge text reads the reviews and review requests again and merges nothing while a reviewer other than the session holds the merge', () => {
  const merges = EVERY_STEP.filter(step => step.kind === 'merge' || step.kind === 'ask-merge')
  expect(merges.length).toBe(5)
  for (const step of merges) {
    const text = textOf(step)
    expect(text).toContain(`gh pr view ${step.number} --json headRefOid,statusCheckRollup,reviews,reviewRequests`)
    expect(text).toContain('If any reviewer other than the session is now requested as a user, or any login that the `Reviewer:` fact names, other than the session\'s own, has not approved the pull request, because they have no review of it or their newest review of it is not an approval, or any reviewer other than the session\'s own login whose newest review is not an approval carries the association `OWNER`, `MEMBER` or `COLLABORATOR`, merge nothing: call `mcp__builder__watch` and follow the step it names. The `Reviewer:` fact is the fetched base branch\'s `Reviewer:` line when that file has one, and the user\'s own `Reviewer:` line only when it has none. A line that says `none` names nobody, so `Reviewer: none` in the base branch turns the user\'s line off, and the branch\'s own CLAUDE.md never counts here. The session\'s own verdict reviews, which are comment reviews, never hold the merge under any of these rules.')
  }
  const ask = textOf({ kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'default', runs: [], isClaudeRead: true, unpushed: NONE })
  expect(ask).toContain('no new run, and no reviewer other than the session holds the merge as those reads say')
})

test('the question for a merge without checks covers this head and these runs, and keeps the read again before merging on a yes', () => {
  const text = textOf({ kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'default', runs: [{ id: 5, attempt: 1 }, { id: 6, attempt: 2 }], isClaudeRead: true, unpushed: NONE })
  expect(text).toContain(C)
  expect(text).toContain('run 5 (attempt 1), run 6 (attempt 2)')
  expect(text).toContain('They already said no to this head and these runs')
  expect(text).toContain('They already said yes to this head and these runs')
  expect(text).toContain('Read again before merging on a yes')
  expect(text).toContain('no checks, no unfinished run and no new run')
  expect(text).toContain(`gh pr merge 7 --merge --match-head-commit ${C}`)
  expect(text).toContain('Commits the pull request lacks')
  expect(textOf({ kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'unread', runs: [], isClaudeRead: false, unpushed: NONE })).toContain('no workflow runs')
})

test('the question for a merge without checks says the base CLAUDE.md could not be read only when it was not read', () => {
  const step = { kind: 'ask-merge' as const, number: 7, head: C, repo: 'o/r', runs: [], unpushed: NONE }
  expect(textOf({ ...step, command: 'unread', isClaudeRead: false })).toContain('could not be read, which counts as `Checks: expected`')
  // A file that was read and names a merge command of its own says what it says.
  const read = textOf({ ...step, command: 'custom', isClaudeRead: true })
  expect(read).toContain('the base branch\'s CLAUDE.md counts as `Checks: expected`: it says so, or it has no `Checks:` line and the base has workflow files, or they could not be listed')
  expect(read).not.toContain('which counts as `Checks: expected`')
})

test('the failed text holds the run ids and how to read them', () => {
  const text = textOf({ kind: 'failed', runs: [123456, 789] })
  expect(text).toContain('123456, 789')
  expect(text).toContain('gh run view <id> --log-failed')
  expect(text).toContain('gh run rerun <id> --failed')
  // The mod sets waiting-on-author itself; only the judgement stuck stays.
  expect(text).not.toContain('waiting-on-author')
  expect(text).toContain('set `stuck` with `mcp__builder__set_stuck` and ask the person')
  expect(textOf({ kind: 'failed', runs: [] })).toContain('No workflow run counts as failed')
})

test('the over-limit text holds each limit and its counts', () => {
  const text = textOf({ kind: 'over-limit', limits: [{ which: 'pushes', count: 9, max: 8 }, { which: 'rounds', count: 6, max: 5 }] })
  expect(text).toContain('9 pushes')
  expect(text).toContain('`Max pushes per round` is 8')
  expect(text).toContain('Round 6')
  expect(text).toContain('`Max rounds` is 5')
  // The mod sets stuck for this step itself.
  expect(text).not.toContain('stuck')
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
  expect(textOf({ kind: 'waiting' })).not.toContain('ready-to-merge')
  const unread = textOf({ kind: 'runs-unread' })
  expect(unread).toContain('could not be read')
  expect(unread).toContain('Merge nothing')
  expect(unread).toContain('end the turn')
})

test('the text for an unreadable user CLAUDE.md names the file by its place, holds no path, merges nothing and ends the turn', () => {
  expect(stepLines({ kind: 'user-claude-unread' })).toEqual([
    'The step that applies: Both verdicts approve at this head, but the user\'s own CLAUDE.md could not be read.',
    'Both verdicts approve at this head, but the CLAUDE.md in the user\'s Claude configuration folder exists and could not be read at the mod\'s last look, so the reviewers its `Reviewer:` line may name are unknown.',
    'Merge nothing, and end the turn. The mod looks again at its next poll, and starts a turn once the file can be read.',
  ])
  const text = textOf({ kind: 'user-claude-unread' })
  expect(text).not.toContain('/')
  expect(text).not.toContain('~')
  expect(text).not.toContain('gh pr merge')
})

test('the merged text states the outcome of the mod\'s update of the linked checkout and never tells the session to run it, and keeps the follow-ups and the cleanup', () => {
  const text = textOf({ kind: 'merged', unpushed: NONE, linked: UPDATED })
  expect(text).toContain(UPDATED[0]!)
  expect(text).toContain('Report it as "Updating the linked checkout" in /implement says')
  expect(text).not.toContain('First update the linked checkout')
  expect(text).not.toContain('mcp__builder__watch')
  expect(text).toContain('Follow-ups from <owner>/<name>#<n>')
  expect(text).toContain('/cleanup')
  expect(text).toContain('Commits the pull request lacks')
})

test('no step text holds a check, label or run name from GitHub', () => {
  const names = ['zz-check-name', 'zz-label-name', 'zz-run-name']
  const check = (conclusion: string, status = 'COMPLETED') => [{ __typename: 'CheckRun', name: names[0]!, status, conclusion }]
  const labels = [{ name: names[1]! }]
  const run = (over: Partial<HeadRun> = {}) => [headRun({ name: names[2]!, ...over })]
  const snapshots = [
    snapshot({ labels, statusCheckRollup: check('FAILURE') }, run({ conclusion: 'failure' })),
    snapshot({ labels, statusCheckRollup: check('', 'IN_PROGRESS'), reviews: approved }, run({ completed: false, conclusion: null })),
    snapshot({ labels, statusCheckRollup: check('SUCCESS'), reviews: approved }, run()),
    snapshot({ labels, statusCheckRollup: check('SUCCESS') }, run()),
    snapshot({ labels, statusCheckRollup: [], reviews: approved }),
  ]
  for (const s of snapshots) {
    for (const isAsking of [false, true]) {
      const text = stepFor(s, isAsking).join('\n')
      for (const name of names) expect(text).not.toContain(name)
    }
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

// The same holds for the sections of skills/cleanup/SKILL.md that the texts
// name, pinned in CLEANUP_SECTIONS.
test('every section of /cleanup that a step text names is one of the pinned headings', () => {
  const named = new Set<string>()
  for (const step of EVERY_STEP) {
    for (const match of textOf(step).matchAll(/"([^"]+)" in \/cleanup/g)) named.add(match[1]!)
  }
  expect(named.size).toBeGreaterThan(0)
  for (const name of named) expect(CLEANUP_SECTIONS).toContain(name)
})

// The same holds for skills/implement/frontend.md and the sections of it that
// the texts name, pinned in FRONTEND_FILE and FRONTEND_SECTIONS. A text may
// mention the file only in the pinned form, so a mention written any other way
// fails here. The path is written out in the regex rather than built from the
// constant, so that a stale old path in a text is still caught after a rename,
// and the last assertion ties the two together.
test('every mention of frontend.md in a step text names a pinned section of the pinned file', () => {
  const form = /"([^"\n]+)" in `skills\/implement\/frontend\.md`/g
  const named = new Set<string>()
  for (const step of EVERY_STEP) {
    const text = textOf(step)
    for (const match of text.matchAll(form)) named.add(match[1]!)
    expect(text.replace(form, '\u0000')).not.toContain('frontend.md')
  }
  expect(named.size).toBeGreaterThan(0)
  for (const name of named) expect(FRONTEND_SECTIONS).toContain(name)
  expect(FRONTEND_FILE).toBe('skills/implement/frontend.md')
})

// The skills write and read the screenshot marker as literal text, and no
// test can read the skill files, so the constant is pinned here word for word.
// A change to it has to be made in every file that its comment lists.
test('the screenshot marker is pinned word for word', () => {
  expect(SCREENSHOTS_MARKER).toBe('<!-- implement:screenshots -->')
})

// A text points to a numbered point of a skill only where the skill gives the
// point no name, and each such reference is pinned in SKILL_POINTS, so a
// renumbering in the skill has to be made there too.
test('every numbered point of a skill that a step text names is one of the pinned references', () => {
  const pinned = new Set<string>()
  for (const step of EVERY_STEP) {
    let text = textOf(step)
    for (const point of SKILL_POINTS) {
      if (text.includes(point)) pinned.add(point)
      text = text.split(point).join('')
    }
    expect(text).not.toMatch(/\b(point|step) \d+\b/i)
  }
  expect([...pinned].sort()).toEqual([...SKILL_POINTS].sort())
})

test('each step gives the state label that follows from it, and Merged, An open question and unread runs give none', () => {
  const labels = Object.fromEntries(EVERY_STEP.map(step => [step.kind, labelFor(step)]))
  expect(labels).toEqual({
    merged: null,
    closed: 'stuck',
    question: null,
    'over-limit': 'stuck',
    conflicting: 'waiting-on-author',
    failed: 'waiting-on-author',
    review: 'in-review',
    'changes-requested': 'waiting-on-author',
    'code-review': 'in-review',
    'outside-feedback': 'waiting-on-author',
    'request-review': 'waiting-on-reviewer',
    'awaiting-review': 'waiting-on-reviewer',
    'user-claude-unread': null,
    'runs-unread': null,
    waiting: 'ready-to-merge',
    'head-unchecked': 'ready-to-merge',
    merge: 'ready-to-merge',
    'ask-merge': 'ready-to-merge',
  })
})

test('setting waiting-on-reviewer removes the other four state labels, and setting any other removes it', () => {
  const all = ['bug', 'in-review', 'waiting-on-author', 'waiting-on-reviewer', 'ready-to-merge', 'stuck', 'needs-decision']
  expect(otherStateLabelsOf('waiting-on-reviewer', all)).toEqual(['in-review', 'waiting-on-author', 'ready-to-merge', 'stuck'])
  for (const kept of ['in-review', 'waiting-on-author', 'ready-to-merge', 'stuck'] as const) {
    expect(otherStateLabelsOf(kept, ['bug', 'waiting-on-reviewer'])).toEqual(['waiting-on-reviewer'])
  }
})

test('a judgement is kept while the step gives its label or no label, and labelActionOf keeps it exactly then', () => {
  const labels = ['in-review', 'waiting-on-author', 'waiting-on-reviewer', 'ready-to-merge', 'stuck', null] as const
  for (const judged of ['in-review', 'waiting-on-author', null] as const) {
    for (const derived of labels) {
      const kept = judged !== null && (derived === null || derived === judged)
      expect(isJudgementKept(derived, judged)).toBe(kept)
      expect(labelActionOf(derived, 'in-review', ['stuck'], judged).kind === 'keep').toBe(kept)
    }
  }
})

test('without a judgement, a derived label equal to the record, or no derived label, changes nothing', () => {
  expect(labelActionOf('in-review', 'in-review', ['stuck'])).toEqual({ kind: 'none' })
  expect(labelActionOf(null, 'in-review', [])).toEqual({ kind: 'none' })
  expect(labelActionOf(null, null, ['stuck'])).toEqual({ kind: 'none' })
  expect(labelActionOf(null, 'in-review', ['stuck'], null)).toEqual({ kind: 'none' })
})

test('with no record while stuck is on, the derived label is recorded without a write, so a reload never removes it', () => {
  expect(labelActionOf('in-review', null, ['bug', 'stuck'])).toEqual({ kind: 'record', remove: [] })
  // Another state label beside that stuck still comes off.
  expect(labelActionOf('in-review', null, ['in-review', 'stuck', 'ready-to-merge'])).toEqual({ kind: 'record', remove: ['in-review', 'ready-to-merge'] })
})

test('without a judgement, a stuck that is on comes off once the derived label differs from the record', () => {
  expect(labelActionOf('ready-to-merge', 'in-review', ['in-review', 'stuck'])).toEqual({ kind: 'write', remove: ['in-review', 'stuck'] })
  expect(labelActionOf('ready-to-merge', 'in-review', ['stuck'], null)).toEqual({ kind: 'write', remove: ['stuck'] })
})

test('while a judgement holds and the derived label is the judged one, stuck is kept, put on when missing, and the other state labels come off', () => {
  // stuck is on alone, so there is nothing to do but keep it.
  expect(labelActionOf('ready-to-merge', 'in-review', ['bug', 'stuck'], 'ready-to-merge')).toEqual({ kind: 'keep', add: false, remove: [] })
  // stuck is on beside other state labels, which come off.
  expect(labelActionOf('ready-to-merge', 'in-review', ['in-review', 'stuck', 'ready-to-merge'], 'ready-to-merge')).toEqual({ kind: 'keep', add: false, remove: ['in-review', 'ready-to-merge'] })
  // stuck is missing, as after a failed edit or a removal by hand, so it goes on and the others come off in the same edit.
  expect(labelActionOf('ready-to-merge', 'ready-to-merge', ['ready-to-merge'], 'ready-to-merge')).toEqual({ kind: 'keep', add: true, remove: ['ready-to-merge'] })
  expect(labelActionOf('in-review', null, [], 'in-review')).toEqual({ kind: 'keep', add: true, remove: [] })
})

test('while a judgement holds and the step gives no label, stuck is kept as though the step\'s label were unchanged', () => {
  expect(labelActionOf(null, 'in-review', ['in-review'], 'in-review')).toEqual({ kind: 'keep', add: true, remove: ['in-review'] })
  expect(labelActionOf(null, 'in-review', ['stuck'], 'in-review')).toEqual({ kind: 'keep', add: false, remove: [] })
})

test('a derived label that differs from the judged one ends the judgement: the derived label is written and stuck comes off', () => {
  expect(labelActionOf('waiting-on-author', 'in-review', ['stuck'], 'in-review')).toEqual({ kind: 'write', remove: ['stuck'] })
  expect(labelActionOf('waiting-on-author', 'in-review', ['bug', 'stuck', 'in-review'], 'in-review')).toEqual({ kind: 'write', remove: ['in-review', 'stuck'] })
  // Even when the derived label is the record's own label but not the judged one.
  expect(labelActionOf('in-review', 'in-review', ['stuck'], 'ready-to-merge')).toEqual({ kind: 'write', remove: ['stuck'] })
})

test('otherwise the derived label is written, removing only the other state labels the live read saw', () => {
  expect(labelActionOf('in-review', null, [])).toEqual({ kind: 'write', remove: [] })
  expect(labelActionOf('ready-to-merge', 'in-review', ['bug', 'in-review', 'needs-decision'])).toEqual({ kind: 'write', remove: ['in-review'] })
  // With a record, a stuck the session set comes off once the derived label changes.
  expect(labelActionOf('waiting-on-author', 'ready-to-merge', ['stuck', 'ready-to-merge', 'waiting-on-author'])).toEqual({ kind: 'write', remove: ['ready-to-merge', 'stuck'] })
})

test('a stored label record reads back only in the shape the mod writes, with a judgement only in its own shape', () => {
  expect(labelRecordIn({ label: 'stuck', at: 5 })).toEqual({ label: 'stuck', at: 5 })
  expect(labelRecordIn({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9 } })).toEqual({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9 } })
  expect(labelRecordIn({ label: 'in-review', at: 5, judgement: { label: 'ready-to-merge', at: 0 } })).toEqual({ label: 'in-review', at: 5, judgement: { label: 'ready-to-merge', at: 0 } })
  // A judgement of any other shape is left out: not an object, a label that is not a state label or is stuck itself, a missing or non-finite time.
  for (const judgement of [null, 'in-review', 5, { label: 'bug', at: 9 }, { label: 'needs-decision', at: 9 }, { label: 'stuck', at: 9 }, { label: 'in-review' },
    { label: 'in-review', at: '9' }, { label: 'in-review', at: Number.NaN }, { label: 'in-review', at: Number.POSITIVE_INFINITY }, { at: 9 }]) {
    expect(labelRecordIn({ label: 'in-review', at: 5, judgement })).toEqual({ label: 'in-review', at: 5 })
  }
  // The note and derived fields of records written before the judgement are ignored, alone or beside a judgement.
  expect(labelRecordIn({ label: 'stuck', at: 5, derived: 'in-review' })).toEqual({ label: 'stuck', at: 5 })
  expect(labelRecordIn({ label: 'stuck', at: 5, note: { label: 'in-review', sawStuck: false } })).toEqual({ label: 'stuck', at: 5 })
  expect(labelRecordIn({ label: 'in-review', at: 5, derived: 'in-review', note: { label: 'ready-to-merge', sawStuck: false }, judgement: { label: 'in-review', at: 9 } }))
    .toEqual({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9 } })
  for (const raw of [null, undefined, 'stuck', { label: 'bug', at: 5 }, { label: 'stuck' }, { label: 'stuck', at: Number.NaN }, { label: 'needs-decision', at: 1 }]) {
    expect(labelRecordIn(raw)).toBeNull()
  }
})

test('a stored judgement keeps the marker that its label came from a step only when the marker is exactly true', () => {
  expect(labelRecordIn({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9, fromStep: true } }))
    .toEqual({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9, fromStep: true } })
  // Any other value, or none, reads as unmarked and keeps the judgement
  // itself. The keys are checked directly, because toEqual ignores a field
  // whose value is undefined.
  for (const fromStep of [false, 'true', 1, null, {}, undefined]) {
    const record = labelRecordIn({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9, fromStep } })
    expect(record).toEqual({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9 } })
    expect(Object.keys(record?.judgement ?? {}).sort()).toEqual(['at', 'label'])
  }
  const record = labelRecordIn({ label: 'in-review', at: 5, judgement: { label: 'in-review', at: 9 } })
  expect(Object.keys(record?.judgement ?? {}).sort()).toEqual(['at', 'label'])
  // A judgement whose label or time is of the wrong shape is still left out,
  // even when it carries the marker.
  for (const judgement of [{ label: 'stuck', at: 9, fromStep: true }, { label: 'bug', at: 9, fromStep: true }, { label: 'in-review', fromStep: true }]) {
    expect(labelRecordIn({ label: 'in-review', at: 5, judgement })).toEqual({ label: 'in-review', at: 5 })
  }
})

test('only the merge steps and the Merged step need the listing of commits the pull request lacks', () => {
  const listed = EVERY_STEP.filter(needsListing).map(step => step.kind)
  expect([...new Set(listed)].sort()).toEqual(['ask-merge', 'merge', 'merged'])
})

test('a listing a snapshot holds reaches its step, and a missing or malformed one reads as could not be listed', () => {
  const some: Unpushed = { kind: 'some', commits: ['abcdef012345'], total: 1, isAncestor: false }
  expect(unpushedIn(some)).toEqual(some)
  expect(unpushedIn(NONE)).toEqual(NONE)
  for (const raw of [undefined, null, 'none', { kind: 'some' }, { kind: 'some', commits: [], total: 0, isAncestor: true },
    { kind: 'some', commits: ['$(rm -rf /)'], total: 1, isAncestor: true }, { kind: 'some', commits: ['abcdef012345'], total: 0, isAncestor: true },
    { kind: 'some', commits: ['abcdef012345'], total: 1, isAncestor: 'yes' }, { kind: 'other' }]) {
    expect(unpushedIn(raw)).toEqual(UNLISTED)
  }
  expect(chooseStep({ ...snapshot({ reviews: approved }, [headRun()]), unpushed: some }, false)).toMatchObject({ kind: 'merge', unpushed: some })
  expect(chooseStep({ ...snapshot({ state: 'MERGED' }), unpushed: NONE }, false)).toEqual({ kind: 'merged', unpushed: NONE, linked: null })
  expect(chooseStep(snapshot({ state: 'MERGED' }), false)).toEqual({ kind: 'merged', unpushed: UNLISTED, linked: null })
  expect(chooseStep({ ...snapshot({ state: 'CLOSED' }), unpushed: some }, false)).toEqual({ kind: 'closed' })
})

test('the merge, ask-merge and Merged texts carry none, the short hashes with the ancestor answer, or could not be listed', () => {
  const merge = { kind: 'merge' as const, number: 7, head: C, repo: 'o/r', command: 'default' as const, checks: 'passed' as const, runs: [] }
  const ask = { kind: 'ask-merge' as const, number: 7, head: C, repo: 'o/r', command: 'default' as const, runs: [], isClaudeRead: true }
  for (const base of [merge, ask, { kind: 'merged' as const, linked: UPDATED }]) {
    expect(textOf({ ...base, unpushed: NONE } as Step)).toContain('found none')
    const unlisted = textOf({ ...base, unpushed: UNLISTED } as Step)
    expect(unlisted).toContain('could not list the commits')
    expect(unlisted).toContain('counts as holding some')
    const ancestor = textOf({ ...base, unpushed: { kind: 'some', commits: ['abcdef012345', '0123456789ab'], total: 2, isAncestor: true } } as Step)
    expect(ancestor).toContain('2 commits')
    expect(ancestor).toContain('abcdef012345, 0123456789ab')
    expect(ancestor).toContain('The head is an ancestor of the worktree\'s HEAD')
    const notAncestor = textOf({ ...base, unpushed: { kind: 'some', commits: ['abcdef012345'], total: 25, isAncestor: false } } as Step)
    expect(notAncestor).toContain('25 commits')
    expect(notAncestor).toContain('abcdef012345 and 24 more')
    expect(notAncestor).toContain('The head is not an ancestor of the worktree\'s HEAD')
  }
  const one = textOf({ ...merge, unpushed: { kind: 'some', commits: ['abcdef012345'], total: 1, isAncestor: true } })
  expect(one).toContain('1 commit that')
  // The Closed step lists nothing.
  expect(textOf({ kind: 'closed' })).not.toContain('commits')
})

test('no step text tells the session to set a label the mod sets, to report a stage, or to list commits itself, and stuck is set only through the tool', () => {
  for (const step of EVERY_STEP) {
    const text = textOf(step)
    for (const label of ['in-review', 'waiting-on-author', 'waiting-on-reviewer', 'ready-to-merge']) expect(text).not.toContain(label)
    expect(text).not.toContain('mcp__builder__progress')
    expect(text).not.toContain('git fetch origin pull/')
    expect(text).not.toMatch(/git log [^`]*\.\.HEAD/)
    expect(text).not.toContain('list the commits the worktree holds')
    if (step.kind === 'closed' || step.kind === 'over-limit') expect(text).not.toContain('stuck')
    // stuck is set only through the tool, which records the judgement first.
    expect(text).not.toMatch(/gh pr edit[^`]*--add-label/)
    for (const said of text.matchAll(/set `stuck`(.{0,40})/gi)) expect(said[1]).toMatch(/^ with `mcp__builder__set_stuck`/)
  }
  // The texts that tell the session to set stuck still do, through the tool.
  expect(EVERY_STEP.filter(step => textOf(step).includes('`mcp__builder__set_stuck`')).length).toBeGreaterThan(0)
})

test('each outcome of the update of the linked checkout reaches the Merged step\'s text as the snapshot holds it', () => {
  const outcomes = [
    UPDATED,
    ['Updated: the linked checkout /repo already held the merge commit x, so nothing needed to move, and its HEAD is x. No remote of the checkout names o/r, so nothing was fetched because the checkout already held the merge, and the checkout may show ahead of its remote until its next fetch.'],
    ['Not linked: o/r merged, and the links under /h/.claude point into x/y, none of which is o/r, so no checkout was moved.'],
    ['No links found: none of a, b and c is a link or holds one, so no checkout was updated.', 'If the skills or the mod load some other way, this update moved nothing.'],
    ['Only worktrees linked: every link into o/r lies in a worktree (/w), so no link leads into the main checkout and it was not moved.'],
    ['Nothing to update: the pull request merged into release, which is not the default branch of o/r.'],
    ['Left alone: the linked checkout /repo was not updated, because it has changes to tracked files. New sessions will run the old code until someone updates it.'],
  ]
  for (const linked of outcomes) {
    const step = chooseStep({ ...snapshot({ state: 'MERGED' }), unpushed: NONE, linked }, false)
    expect(step).toEqual({ kind: 'merged', unpushed: NONE, linked })
    const text = textOf(step)
    for (const line of linked) expect(text).toContain(line)
    expect(text).not.toContain('First update the linked checkout')
  }
})

test('a Merged snapshot whose merge commit was not read yet says so and asks for one more look', () => {
  const step = chooseStep({ ...snapshot({ state: 'MERGED' }), linked: 'unread' }, false)
  expect(step).toMatchObject({ kind: 'merged', linked: 'unread' })
  const text = textOf(step)
  expect(text).toContain('had not given the merge commit yet')
  expect(text).toContain('call `mcp__builder__watch` once more')
  expect(text).toContain('Follow-ups from <owner>/<name>#<n>')
})

// A snapshot with no outcome for any other reason: an older build stored
// it, or it holds an outcome the step does not accept, such as one with more
// sentences than it keeps.
test('a Merged snapshot with no outcome for another reason says the mod has none to state, without blaming GitHub or asking for another look', () => {
  for (const linked of [undefined, Array.from({ length: LINKED_KEPT + 1 }, () => 'a'), [1], 'other']) {
    const step = chooseStep({ ...snapshot({ state: 'MERGED' }), ...(linked === undefined ? {} : { linked }) } as Snapshot, false)
    expect(step).toMatchObject({ kind: 'merged', linked: null })
    const text = textOf(step)
    // The line after the step's name states the update; the follow-ups
    // further on name GitHub for another reason.
    const line = stepLines(step)[1]
    expect(line).toContain('The mod has no outcome of the update of the linked checkout to state')
    expect(line).toContain('may not have been updated')
    expect(line).not.toContain('GitHub')
    expect(text).not.toContain('merge commit yet')
    expect(text).not.toContain('mcp__builder__watch')
    expect(text).toContain('Follow-ups from <owner>/<name>#<n>')
  }
})

test('an outcome a snapshot holds is kept only in its own shape, and made printable', () => {
  expect(linkedIn(['a', 'b'])).toEqual(['a', 'b'])
  expect(linkedIn(['a\nb\u001b[31m'])).toEqual(['a b'])
  expect(linkedIn('unread')).toBe('unread')
  for (const raw of [undefined, null, 'a', [], [1], Array.from({ length: LINKED_KEPT + 1 }, () => 'a')]) expect(linkedIn(raw)).toBe(null)
})

// A solo project, with no reviewer other than the session, behaves exactly as
// before outside reviewers were read: every fixture of the chooser's table
// above chooses the step it chose then, written out here in full.
test('every chooser fixture with no outside reviewer chooses what it did before', () => {
  const pending = [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: null }]
  const failing = [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }]
  const unread: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'unread', isClaudeRead: false }
  const none = { reviews: approved, statusCheckRollup: [] }
  const { headRuns: _runs, ...noRuns } = snapshot({ reviews: approved })
  const { facts: _facts, ...noFacts } = snapshot(none)
  const table: [Snapshot, boolean, Step][] = [
    [snapshot({ state: 'MERGED' }), true, { kind: 'merged', unpushed: UNLISTED, linked: null }],
    [snapshot({ state: 'CLOSED' }), true, { kind: 'closed' }],
    [snapshot({ reviews: approved }), true, { kind: 'question' }],
    [snapshot({ mergeable: 'CONFLICTING', reviews: approved }), false, { kind: 'conflicting' }],
    [snapshot({ statusCheckRollup: failing, reviews: approved }), false, { kind: 'failed', runs: [] }],
    [snapshot(), false, { kind: 'review', head: C }],
    [snapshot({ reviews: [review(C, 'REQUEST_CHANGES', 'APPROVE')] }), false, { kind: 'changes-requested' }],
    [snapshot({ reviews: approved }, [headRun()], FACTS, true), false, { kind: 'runs-unread' }],
    [noRuns as Snapshot, false, { kind: 'runs-unread' }],
    [snapshot({ reviews: approved, statusCheckRollup: pending }), false, { kind: 'waiting' }],
    [snapshot({ reviews: [review('abcdef0123456789', 'APPROVE', 'APPROVE'), passAt('abcdef0123456789')], headRefOid: 'abcdef0123456789', commits: [{ oid: 'abcdef0123456789' }] }, [headRun()]), false, { kind: 'head-unchecked' }],
    [snapshot({ reviews: approved }, [headRun()]), false, { kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'passed', runs: [{ id: 1, attempt: 1 }], unpushed: UNLISTED }],
    [snapshot(none, [], { ...FACTS, checks: 'none' }), false, { kind: 'merge', number: 7, head: C, repo: 'o/r', command: 'default', checks: 'none', runs: [], unpushed: UNLISTED }],
    [snapshot(none, [headRun({ id: 5 })], FACTS), false, { kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'default', runs: [{ id: 5, attempt: 1 }], isClaudeRead: true, unpushed: UNLISTED }],
    [snapshot(none, [], unread), false, { kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'unread', runs: [], isClaudeRead: false, unpushed: UNLISTED }],
    [noFacts as Snapshot, false, { kind: 'ask-merge', number: 7, head: C, repo: 'o/r', command: 'unread', runs: [], isClaudeRead: false, unpushed: UNLISTED }],
  ]
  for (const [s, isAsking, step] of table) {
    expect('outside' in s).toBe(false)
    expect('others' in s).toBe(false)
    expect(chooseStep(s, isAsking)).toEqual(step)
  }
})

test('a solo snapshot fingerprints exactly as it did before outside reviewers were read', () => {
  const s = snapshot({ reviews: approvedOnly, labels: [{ name: 'docs' }] }, [headRun()])
  expect(s.fingerprint).toBe(`OPEN|cccccccccccc|docs|APPROVE/APPROVE@cccccccc|tests:passed|no-conflict|`)
})
