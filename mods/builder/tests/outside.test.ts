import { expect, test } from 'claude-code/testing'

import { changesBetween, isLogin, outsideIn, outsideOf, PR_FIELDS, snapshotOf, type GhPullRequest } from '../hooks/github'
import { pollFor, POLL_MS, waitingOn } from '../hooks/state'
import { chooseStep, labelFor, reviewersOf, stepLines } from '../hooks/step'
import type { BaseFacts, HeadRun, Snapshot } from '../types'

// The reviewers other than the session's own login: who they are, what state
// each is in, and how that holds the merge (see
// docs/specs/builder-waits-for-outside-reviewer.md).

const ME = 'owner'
const C = 'c'.repeat(40)
const T1 = '2026-11-05T10:00:00Z'
const T2 = '2026-11-05T11:00:00Z'

const FACTS: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'none', merge: 'default', isClaudeRead: true }
const passedRun: HeadRun = { id: 1, workflow: 1, event: 'pull_request', number: 1, attempt: 1, name: 'ci', completed: true, conclusion: 'success' }

function verdicts(spec: string, adversarial: string) {
  return { author: { login: ME }, state: 'COMMENTED', body: `VERDICTS ${C.slice(0, 8)} spec=${spec} adversarial=${adversarial}\n\nfindings`, commit: { oid: C }, submittedAt: T1 }
}

const approvedBySession = verdicts('APPROVE', 'APPROVE')

function outsideReview(login: string, state: string, submittedAt = T1) {
  return { author: { login }, state, body: '', commit: { oid: C }, submittedAt }
}

function pullRequest(over: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', headRefOid: C, labels: [],
    reviews: [approvedBySession], reviewRequests: [], statusCheckRollup: [], mergeable: 'MERGEABLE', commits: [{ oid: C }],
    ...over,
  }
}

function snapshot(over: Partial<GhPullRequest> = {}, reviewers: string[] = []): Snapshot {
  const facts = reviewers.length === 0 ? FACTS : { ...FACTS, reviewers }
  return snapshotOf('o/r', pullRequest(over), ME, [], { headRuns: [passedRun], facts })
}

const kind = (s: Snapshot) => chooseStep(s, false).kind

test('the pull request read asks GitHub for the review requests', () => {
  expect(PR_FIELDS.split(',')).toContain('reviewRequests')
})

test('a GitHub login passes, and a bot, a name with spaces, an option or a hyphen at either end does not', () => {
  for (const login of ['alice', 'Bob-Smith', 'a1', 'x'.repeat(39)]) expect(isLogin(login)).toBe(true)
  for (const login of ['copilot[bot]', 'two words', '-rf', 'trailing-', 'double--hyphen', 'x'.repeat(40), '', 7]) expect(isLogin(login)).toBe(false)
})

test('the project names the reviewer, else the user does, and none in the project turns the user\'s off', () => {
  expect(reviewersOf('Reviewer: alice', 'Reviewer: bob')).toEqual(['alice'])
  expect(reviewersOf('Checks: none', 'Reviewer: bob')).toEqual(['bob'])
  expect(reviewersOf(null, 'Reviewer: bob')).toEqual(['bob'])
  expect(reviewersOf('Reviewer: none', 'Reviewer: bob')).toEqual([])
  expect(reviewersOf('Checks: none', null)).toEqual([])
  expect(reviewersOf(null, null)).toEqual([])
})

test('the fact takes several logins, drops a leading @ and a repeat, and leaves out what is not a login', () => {
  expect(reviewersOf('Reviewer: @alice, bob , Alice, not a login, `$(rm)`', null)).toEqual(['alice', 'bob'])
  expect(reviewersOf('Reviewer: `carol`', null)).toEqual(['carol'])
})

test('an outside reviewer is anyone but the session who is requested, has reviewed, or is named, sorted by login', () => {
  const pr = pullRequest({
    reviews: [approvedBySession, outsideReview('zed', 'COMMENTED')],
    reviewRequests: [{ __typename: 'User', login: 'mia' }],
  })
  expect(outsideOf(pr, ME, ['alice']).map(r => r.login)).toEqual(['alice', 'mia', 'zed'])
})

test('the session\'s own login, a bot, a team request and a pending review are left out', () => {
  const pr = pullRequest({
    reviews: [approvedBySession, outsideReview('helper[bot]', 'COMMENTED'), outsideReview('pat', 'PENDING')],
    reviewRequests: [{ __typename: 'Team', login: undefined }, { __typename: 'User', login: 'Owner' }],
  })
  expect(outsideOf(pr, ME, ['OWNER'])).toEqual([])
})

test('a reviewer whose newest review was dismissed is asked again, not dropped or sent back to old comments', () => {
  const onlyDismissed = pullRequest({ reviews: [approvedBySession, outsideReview('dee', 'DISMISSED', T1)] })
  expect(outsideOf(onlyDismissed, ME, [])).toEqual([{ login: 'dee', state: 'unrequested', at: T1 }])
  const commentsThenDismissed = pullRequest({ reviews: [approvedBySession, outsideReview('dee', 'COMMENTED', T1), outsideReview('dee', 'DISMISSED', T2)] })
  expect(outsideOf(commentsThenDismissed, ME, [])).toEqual([{ login: 'dee', state: 'unrequested', at: T2 }])
  expect(kind(snapshotOf('o/r', commentsThenDismissed, ME, [], { headRuns: [passedRun], facts: FACTS }))).toBe('request-review')
})

test('each reviewer\'s state: a request first, then their newest review, and named with neither is unrequested', () => {
  const pr = pullRequest({
    reviews: [
      outsideReview('ann', 'COMMENTED', T1), outsideReview('ann', 'APPROVED', T2),
      outsideReview('ben', 'APPROVED', T1), outsideReview('ben', 'CHANGES_REQUESTED', T2),
      outsideReview('cat', 'COMMENTED', T1),
    ],
    reviewRequests: [{ __typename: 'User', login: 'cat' }],
  })
  expect(outsideOf(pr, ME, ['dan'])).toEqual([
    { login: 'ann', state: 'approved', at: T2 },
    { login: 'ben', state: 'feedback', at: T2 },
    { login: 'cat', state: 'requested', at: T1 },
    { login: 'dan', state: 'unrequested' },
  ])
})

test('a solo pull request has no outside field and fingerprints as it did before outside reviewers were read', () => {
  const s = snapshot()
  expect('outside' in s).toBe(false)
  expect(s.fingerprint).not.toContain('outside')
})

test('a review arriving, a request made and a newer review in the same state each change the fingerprint', () => {
  const requested = snapshot({ reviewRequests: [{ __typename: 'User', login: 'ann' }] })
  const commented = snapshot({ reviews: [approvedBySession, outsideReview('ann', 'COMMENTED', T1)] })
  const commentedAgain = snapshot({ reviews: [approvedBySession, outsideReview('ann', 'COMMENTED', T1), outsideReview('ann', 'COMMENTED', T2)] })
  const fingerprints = new Set([snapshot(), requested, commented, commentedAgain].map(s => s.fingerprint))
  expect(fingerprints.size).toBe(4)
})

test('the change prompt names who reviewed and whose review was requested', () => {
  const requested = snapshot({ reviewRequests: [{ __typename: 'User', login: 'ann' }] })
  const commented = snapshot({ reviews: [approvedBySession, outsideReview('ann', 'COMMENTED', T2)] })
  const approved = snapshot({ reviews: [approvedBySession, outsideReview('ann', 'APPROVED', T2)] })
  expect(changesBetween(snapshot(), requested)).toContain('A review is requested from ann.')
  expect(changesBetween(requested, commented)).toContain('ann submitted a review with comments or requested changes.')
  expect(changesBetween(commented, approved)).toContain('ann approved the pull request.')
})

test('a stored outside list keeps only entries of the right shape', () => {
  expect(outsideIn([{ login: 'ann', state: 'approved', at: T1 }, { login: 'bad name', state: 'approved' }, { login: 'ben', state: 'other' }, null, 'x'])).toEqual([{ login: 'ann', state: 'approved', at: T1 }])
  expect(outsideIn(undefined)).toEqual([])
})

test('with no outside reviewer the step is the merge, as before', () => {
  expect(kind(snapshot())).toBe('merge')
})

test('feedback comes first, then a named reviewer not yet asked, then a review asked for and not given', () => {
  const all = {
    reviews: [approvedBySession, outsideReview('ann', 'COMMENTED')],
    reviewRequests: [{ __typename: 'User', login: 'cat' }],
  }
  expect(chooseStep(snapshot(all, ['dan']), false)).toEqual({ kind: 'outside-feedback', number: 7, reviewers: ['ann'] })
  expect(chooseStep(snapshot({ reviewRequests: all.reviewRequests }, ['dan']), false)).toEqual({ kind: 'request-review', number: 7, reviewers: ['dan'] })
  expect(chooseStep(snapshot({ reviewRequests: all.reviewRequests }), false)).toEqual({ kind: 'awaiting-review', reviewers: ['cat'] })
})

test('the merge waits until every outside reviewer approves', () => {
  const oneApproved = snapshot({ reviews: [approvedBySession, outsideReview('ann', 'APPROVED')], reviewRequests: [{ __typename: 'User', login: 'cat' }] })
  expect(kind(oneApproved)).toBe('awaiting-review')
  const bothApproved = snapshot({ reviews: [approvedBySession, outsideReview('ann', 'APPROVED'), outsideReview('cat', 'APPROVED')] }, ['ann'])
  expect(kind(bothApproved)).toBe('merge')
})

test('outside reviews wait while the session\'s own review is due or requests changes', () => {
  const comments = [outsideReview('ann', 'COMMENTED')]
  expect(kind(snapshot({ reviews: comments }, ['bob']))).toBe('review')
  expect(kind(snapshot({ reviews: [verdicts('APPROVE', 'REQUEST_CHANGES'), ...comments] }, ['bob']))).toBe('changes-requested')
})

test('feedback gives waiting-on-author, and requesting and waiting on the review give ready-to-merge', () => {
  expect(labelFor({ kind: 'outside-feedback', number: 7, reviewers: ['ann'] })).toBe('waiting-on-author')
  expect(labelFor({ kind: 'request-review', number: 7, reviewers: ['ann'] })).toBe('ready-to-merge')
  expect(labelFor({ kind: 'awaiting-review', reviewers: ['ann'] })).toBe('ready-to-merge')
})

test('the step texts name the reviewers and the command that asks for their review', () => {
  const feedback = stepLines({ kind: 'outside-feedback', number: 7, reviewers: ['ann', 'ben'] }).join('\n')
  expect(feedback).toContain('`/pr-comments`')
  expect(feedback).toContain('`gh pr edit 7 --add-reviewer ann,ben`')
  expect(feedback).toContain('ann and ben')
  const request = stepLines({ kind: 'request-review', number: 7, reviewers: ['dan'] }).join('\n')
  expect(request).toContain('`gh pr edit 7 --add-reviewer dan`')
  const awaiting = stepLines({ kind: 'awaiting-review', reviewers: ['cat'] }).join('\n')
  expect(awaiting).toContain('waiting on the review of cat')
})

test('a requested outside review is waited on at the reviewer interval, after failed or running checks', () => {
  const requested = snapshot({ labels: [{ name: 'ready-to-merge' }], reviewRequests: [{ __typename: 'User', login: 'ann' }] })
  expect(waitingOn(requested, [], [])).toBe('reviewer')
  expect(pollFor(requested, C, [], [], null).ms).toBe(POLL_MS.reviewer)
  expect(POLL_MS.reviewer).toBe(5 * 60_000)
  const running = snapshot({ reviewRequests: [{ __typename: 'User', login: 'ann' }], statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS' }] })
  expect(waitingOn(running, [], [])).toBe('ci')
})
