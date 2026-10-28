import { expect, test } from 'claude-code/testing'

import { snapshotOf } from '../hooks/github'
import { ADVERSARIAL_REVIEWER, afterReport, barOf, endedOf, FOCUSED_REVIEWERS, focusedReviewersFor, MAINTAINABILITY_REVIEWER, modelLabel, plannedOf, progressIn, reportAnswer, reportOf, STAGES, VERDICT_REVIEWERS, type PlannedInput } from '../hooks/progress'
import { COUNSEL_MEMBERS } from '../hooks/counsel'
import { OWNERS_ADVOCATE, READ_ONLY_AGENTS, REVIEWERS } from '../hooks/state'
import type { AgentCard, CounselQuestion, Progress } from '../types'

const NOW = 1_000_000
const HEAD = 'a'.repeat(40)
const OTHER_HEAD = 'b'.repeat(40)

function pullRequest(state: 'OPEN' | 'MERGED' | 'CLOSED' = 'OPEN', head = HEAD) {
  return snapshotOf('o/r', { number: 7, url: 'u', state, headRefOid: head, commits: [{ oid: head }] }, 'owner')
}

// Progress as the mod records it, at the spec stage of one title unless the
// case says otherwise.
function progress(over: Partial<Progress> = {}): Progress {
  return { title: 'ABC-123 builder progress', stage: 'spec', furthest: 'spec', note: '', since: NOW - 60_000, autoOpened: true, ...over }
}

// Applies a report and fails the test when it was refused.
function reported(prev: Progress | null, input: { title?: unknown; stage?: unknown; note?: unknown }, now = NOW) {
  const report = reportOf(input)
  if ('refusal' in report) throw new Error(`refused: ${report.refusal}`)
  return afterReport(prev, report, now)
}

test('the stages are the nine of /implement, in order, with the labels the band shows', () => {
  expect(STAGES.map(stage => stage.id)).toEqual(['grounding', 'issue', 'spec', 'plan', 'build', 'verify', 'pr', 'review', 'merge'])
  expect(STAGES.map(stage => stage.label)).toEqual([
    'grounding', 'checking the issue', 'spec', 'plan tournament', 'build', 'verify', 'pull request open', 'review rounds', 'merge',
  ])
})

test('a stored progress value reads back only when every field is sound', () => {
  const good = progress({ stage: 'build', furthest: 'review', note: 'round 2' })
  expect(progressIn(good)).toEqual(good)
  expect(progressIn(null)).toBeNull()
  expect(progressIn(undefined)).toBeNull()
  expect(progressIn('spec')).toBeNull()
  expect(progressIn({ ...good, stage: 'deploy' })).toBeNull()
  expect(progressIn({ ...good, furthest: 'deploy' })).toBeNull()
  expect(progressIn({ ...good, title: 7 })).toBeNull()
  expect(progressIn({ ...good, note: null })).toBeNull()
  expect(progressIn({ ...good, since: Number.NaN })).toBeNull()
  expect(progressIn({ ...good, since: '1' })).toBeNull()
  expect(progressIn({ ...good, autoOpened: 'yes' })).toBeNull()
  // The furthest stage is never behind the stage shown.
  expect(progressIn({ ...good, stage: 'review', furthest: 'build' })).toBeNull()
})

test('a first report starts the work at its stage, cleaned, not yet opened, from now', () => {
  const next = reported(null, { title: 'ABC-123\u001b[2J builder\nprogress', stage: 'spec', note: 'first\tpass' })
  expect(next).toEqual({ title: 'ABC-123 builder progress', stage: 'spec', furthest: 'spec', note: 'first pass', since: NOW, autoOpened: false })
})

test('the title is cut to sixty characters and the note to forty, and a missing note or title is empty', () => {
  const next = reported(null, { title: 't'.repeat(100), stage: 'spec', note: 'n'.repeat(100) })
  expect(next.title).toBe(`${'t'.repeat(59)}…`)
  expect(next.note).toBe(`${'n'.repeat(39)}…`)
  const bare = reported(null, { stage: 'spec' })
  expect(bare.title).toBe('')
  expect(bare.note).toBe('')
})

test('a stage outside the nine is refused, naming all nine, and each of the nine is read', () => {
  for (const stage of ['deploy', '', undefined, 3, 'SPEC']) {
    const result = reportOf({ title: 'ABC-123 builder progress', stage })
    expect('refusal' in result).toBe(true)
    if (!('refusal' in result)) continue
    for (const { id } of STAGES) expect(result.refusal).toContain(id)
  }
  for (const { id } of STAGES) expect(reportOf({ stage: id })).toEqual({ title: '', stage: id, note: '' })
})

test('the answer names the stage reported and the stages before the furthest one, out of nine', () => {
  expect(reportAnswer(progress({ stage: 'spec', furthest: 'spec' }))).toBe('spec (2 of 9)')
  expect(reportAnswer(progress({ stage: 'build', furthest: 'review' }))).toBe('build (7 of 9)')
})

test('a later stage of the same title moves the furthest stage on and keeps when the work began', () => {
  const prev = progress()
  const next = reported(prev, { title: prev.title, stage: 'build', note: 'build 2 of 5' })
  expect(next).toEqual({ ...prev, stage: 'build', furthest: 'build', note: 'build 2 of 5' })
})

test('an earlier stage of the same title changes the stage but never lowers the furthest one', () => {
  const prev = progress({ stage: 'review', furthest: 'review', note: 'round 2' })
  const next = reported(prev, { title: prev.title, stage: 'build' })
  expect(next.stage).toBe('build')
  expect(next.furthest).toBe('review')
  // A report without a note clears the note the last report left.
  expect(next.note).toBe('')
  expect(barOf(next, null, null)?.done).toBe(7)
})

test('a different title starts new work from its own stage, and the pane may open on its own again', () => {
  const prev = progress({ stage: 'review', furthest: 'review', autoOpened: true })
  const next = reported(prev, { title: 'ABC-124 something else', stage: 'grounding' }, NOW + 5)
  expect(next).toEqual({ title: 'ABC-124 something else', stage: 'grounding', furthest: 'grounding', note: '', since: NOW + 5, autoOpened: false })
  // The same title once cleaned is the same work.
  expect(reported(prev, { title: ` ${prev.title}\n`, stage: 'review' }).autoOpened).toBe(true)
})

test('the bar counts the stages before the furthest one out of nine, with its percentage', () => {
  expect(barOf(progress(), null, null)).toEqual({ title: 'ABC-123 builder progress', label: 'spec', done: 2, total: 9, percent: 22 })
  expect(barOf(progress({ stage: 'grounding', furthest: 'grounding' }), null, null)).toMatchObject({ done: 0, percent: 0 })
  expect(barOf(progress({ stage: 'merge', furthest: 'merge' }), null, null)).toMatchObject({ label: 'merge', done: 8, percent: 89 })
  expect(barOf(progress({ stage: 'review', furthest: 'review', note: 'round 2' }), null, null)?.label).toBe('review rounds · round 2')
  expect(barOf(progress({ stage: 'issue', furthest: 'issue' }), pullRequest(), NOW)?.label).toBe('checking the issue')
  expect(barOf(null, null, null)).toBeNull()
  expect(barOf(null, pullRequest(), NOW)).toBeNull()
})

test('a pull request merged under this work fills the bar and reads merged; a closed one keeps the count and reads closed', () => {
  const p = progress({ stage: 'review', furthest: 'review', note: 'round 2' })
  expect(barOf(p, pullRequest('MERGED'), p.since)).toEqual({ title: p.title, label: 'merged', done: 9, total: 9, percent: 100 })
  expect(barOf(p, pullRequest('CLOSED'), p.since + 1)).toEqual({ title: p.title, label: 'closed', done: 7, total: 9, percent: 78 })
  // With no stage reported, a merged or closed pull request still draws a bar.
  expect(barOf(null, pullRequest('MERGED'), NOW)).toEqual({ title: '', label: 'merged', done: 9, total: 9, percent: 100 })
  expect(barOf(null, pullRequest('CLOSED'), NOW)).toEqual({ title: '', label: 'closed', done: 0, total: 9, percent: 0 })
})

test('a pull request watched before the work began does not count as this work merging or closing', () => {
  const p = progress()
  expect(barOf(p, pullRequest('MERGED'), p.since - 1)).toEqual({ title: p.title, label: 'spec', done: 2, total: 9, percent: 22 })
  expect(barOf(p, pullRequest('CLOSED'), null)?.label).toBe('spec')
})

test('the work has ended exactly when the bar reads merged or closed', () => {
  const p = progress({ stage: 'review', furthest: 'review', note: 'round 2' })
  const cases: [Progress | null, ReturnType<typeof pullRequest> | null, number | null, 'MERGED' | 'CLOSED' | null][] = [
    [p, null, null, null],
    [null, null, null, null],
    [p, pullRequest(), p.since, null],
    [null, pullRequest(), NOW, null],
    [p, pullRequest('MERGED'), p.since, 'MERGED'],
    [p, pullRequest('CLOSED'), p.since + 1, 'CLOSED'],
    [null, pullRequest('MERGED'), NOW, 'MERGED'],
    [null, pullRequest('CLOSED'), NOW, 'CLOSED'],
    // Watched before the work began, or with no watch, it is not this work's.
    [p, pullRequest('MERGED'), p.since - 1, null],
    [p, pullRequest('CLOSED'), null, null],
  ]
  for (const [work, pr, since, ended] of cases) {
    expect(endedOf(work, pr, since)).toBe(ended)
    const label = barOf(work, pr, since)?.label
    expect(label === 'merged' || label === 'closed').toBe(ended !== null)
  }
})

const card = (id: string, type: string, startedAt: number, over: Partial<AgentCard> = {}): AgentCard =>
  ({ id, type, description: `about ${id}`, status: 'running', startedAt, ...over })
const done = (id: string, type: string, startedAt: number) => card(id, type, startedAt, { status: 'completed', endedAt: startedAt + 1_000 })

const FOCUSED = ['builder:security-reviewer', 'builder:maintainability-reviewer', 'builder:performance-reviewer', 'builder:data-reviewer']
const VERDICT = ['builder:spec-reviewer', 'builder:adversarial-reviewer']
// A counsel question plans the reviewers in the review round's order, then the
// owner's advocate, which no review round plans.
const COUNSEL = [...FOCUSED, ...VERDICT, 'builder:owners-advocate']
const PACKAGED_AT = NOW - 30_000

function input(over: Partial<PlannedInput> = {}): PlannedInput {
  return { pr: pullRequest(), packaged: { head: HEAD, at: PACKAGED_AT }, agents: [], counsel: [], ...over }
}

function question(over: Partial<CounselQuestion> = {}): CounselQuestion {
  return {
    id: 'c1', question: 'Q?', options: ['a', 'b'], background: '', paths: [], lean: 'a', folder: '/f', round: 1, tallies: [],
    launchedAt: NOW - 10_000, ...over,
  }
}

test('the focused and verdict reviewers together are the six reviewers', () => {
  expect([...FOCUSED_REVIEWERS]).toEqual(FOCUSED)
  expect([...VERDICT_REVIEWERS]).toEqual(VERDICT)
  expect([...FOCUSED_REVIEWERS, ...VERDICT_REVIEWERS].sort()).toEqual([...REVIEWERS].sort())
})

test('the counsel is the six reviewers and the owner\'s advocate, which reviews no pull request but is held to the read-only fence', () => {
  expect([...COUNSEL_MEMBERS].sort()).toEqual([...REVIEWERS, 'builder:owners-advocate'].sort())
  expect(OWNERS_ADVOCATE).toBe('builder:owners-advocate')
  expect(REVIEWERS.has(OWNERS_ADVOCATE)).toBe(false)
  expect([...READ_ONLY_AGENTS].sort()).toEqual([...COUNSEL_MEMBERS].sort())
})

test('after a package call at the watched head the four focused reviewers are planned until each starts', () => {
  expect(plannedOf(input())).toEqual(FOCUSED)
  const oneStarted = input({ agents: [card('s', 'builder:security-reviewer', PACKAGED_AT + 1)] })
  expect(plannedOf(oneStarted)).toEqual(FOCUSED.slice(1))
  // A reviewer that started at the very time of the call counts as started since.
  expect(plannedOf(input({ agents: [card('s', 'builder:security-reviewer', PACKAGED_AT)] }))).toEqual(FOCUSED.slice(1))
  // One that started before the call belongs to an earlier round.
  expect(plannedOf(input({ agents: [done('s', 'builder:security-reviewer', PACKAGED_AT - 1)] }))).toEqual(FOCUSED)
})

test('once the four focused reviewers have finished since the call, the two verdict reviewers are planned until each starts', () => {
  const four = FOCUSED.map((type, i) => done(`f${i}`, type, PACKAGED_AT + i))
  expect(plannedOf(input({ agents: four }))).toEqual(VERDICT)
  // While one of the four still runs, nothing is planned.
  const oneRunning = [...four.slice(0, 3), card('f3', FOCUSED[3]!, PACKAGED_AT + 3)]
  expect(plannedOf(input({ agents: oneRunning }))).toEqual([])
  const specStarted = [...four, card('v', 'builder:spec-reviewer', PACKAGED_AT + 10)]
  expect(plannedOf(input({ agents: specStarted }))).toEqual(['builder:adversarial-reviewer'])
  const bothStarted = [...specStarted, card('w', 'builder:adversarial-reviewer', PACKAGED_AT + 11)]
  expect(plannedOf(input({ agents: bothStarted }))).toEqual([])
})

test('no review row is planned once the head moves, the pull request merges or closes, or without a sound package record', () => {
  expect(plannedOf(input({ pr: pullRequest('OPEN', OTHER_HEAD) }))).toEqual([])
  expect(plannedOf(input({ pr: pullRequest('MERGED') }))).toEqual([])
  expect(plannedOf(input({ pr: pullRequest('CLOSED') }))).toEqual([])
  expect(plannedOf(input({ pr: null }))).toEqual([])
  expect(plannedOf(input({ packaged: null }))).toEqual([])
  expect(plannedOf(input({ packaged: { head: HEAD, at: Number.NaN } }))).toEqual([])
  expect(plannedOf(input({ packaged: { head: 7, at: PACKAGED_AT } as unknown as PlannedInput['packaged'] }))).toEqual([])
})

test('a counsel question waiting for votes plans its seven members until each starts, in the fixed order', () => {
  const none = { pr: null, packaged: null }
  expect(plannedOf(input({ ...none, counsel: [question()] }))).toEqual(COUNSEL)
  const started = [card('a', 'builder:data-reviewer', NOW - 10_000), card('b', 'builder:spec-reviewer', NOW - 5)]
  expect(plannedOf(input({ ...none, counsel: [question()], agents: started }))).toEqual([...FOCUSED.slice(0, 3), 'builder:adversarial-reviewer', 'builder:owners-advocate'])
  // An agent that started before the launch was for something else.
  expect(plannedOf(input({ ...none, counsel: [question()], agents: [done('a', 'builder:data-reviewer', NOW - 10_001)] }))).toEqual(COUNSEL)
})

test('a counsel question asked again of two members plans only those two', () => {
  const asked = question({ askedAgain: ['builder:spec-reviewer', 'builder:data-reviewer'], launchedAt: NOW - 1_000 })
  const before = [done('d', 'builder:data-reviewer', NOW - 9_000), done('s', 'builder:spec-reviewer', NOW - 9_000)]
  expect(plannedOf(input({ pr: null, packaged: null, counsel: [asked], agents: before }))).toEqual(['builder:data-reviewer', 'builder:spec-reviewer'])
})

test('a counsel question plans nothing once its round is tallied, and plans the next round after a rerun', () => {
  const none = { pr: null, packaged: null }
  const decided = question({ tallies: [{ round: 1, votes: [], counts: [4, 2], outcome: 'decided', chosen: 1, proposed: [] }] })
  expect(plannedOf(input({ ...none, counsel: [decided] }))).toEqual([])
  const rerun = question({ round: 2, tallies: [{ round: 1, votes: [], counts: [3, 3], outcome: 'rerun', proposed: ['c'] }] })
  expect(plannedOf(input({ ...none, counsel: [rerun] }))).toEqual(COUNSEL)
  // A question stored before the launch time was kept plans nothing.
  const { launchedAt: _, ...older } = question()
  expect(plannedOf(input({ ...none, counsel: [older] }))).toEqual([])
})

test('a type planned by a review round and a counsel question is listed once', () => {
  expect(plannedOf(input({ counsel: [question(), question({ id: 'c2' })] }))).toEqual(COUNSEL)
})

test('the focused reviewers named follow from the kinds of the changed files', () => {
  expect(MAINTAINABILITY_REVIEWER).toBe('builder:maintainability-reviewer')
  expect(ADVERSARIAL_REVIEWER).toBe('builder:adversarial-reviewer')
  // A missing reviewed head names all four.
  expect(focusedReviewersFor(null)).toEqual(FOCUSED)
  expect(focusedReviewersFor(['test', 'documentation', 'other'])).toEqual(FOCUSED)
  expect(focusedReviewersFor(['other'])).toEqual(FOCUSED)
  expect(focusedReviewersFor(['test', 'documentation'])).toEqual([MAINTAINABILITY_REVIEWER])
  expect(focusedReviewersFor(['test'])).toEqual([MAINTAINABILITY_REVIEWER])
  expect(focusedReviewersFor([])).toEqual([MAINTAINABILITY_REVIEWER])
})

test('a package that named only the maintainability reviewer plans it, and then the verdict pair once it has finished', () => {
  const packaged = { head: HEAD, at: PACKAGED_AT, reviewers: [MAINTAINABILITY_REVIEWER], check: false }
  expect(plannedOf(input({ packaged }))).toEqual([MAINTAINABILITY_REVIEWER])
  const running = [card('m', MAINTAINABILITY_REVIEWER, PACKAGED_AT + 1)]
  expect(plannedOf(input({ packaged, agents: running }))).toEqual([])
  const finished = [done('m', MAINTAINABILITY_REVIEWER, PACKAGED_AT + 1)]
  expect(plannedOf(input({ packaged, agents: finished }))).toEqual(VERDICT)
})

test('a package up for the check after approval plans only the adversarial reviewer, until it starts', () => {
  const packaged = { head: HEAD, at: PACKAGED_AT, reviewers: FOCUSED, check: true }
  expect(plannedOf(input({ packaged }))).toEqual([ADVERSARIAL_REVIEWER])
  expect(plannedOf(input({ packaged, agents: [card('v', ADVERSARIAL_REVIEWER, PACKAGED_AT + 1)] }))).toEqual([])
})

test('a package without a sound list of named reviewers plans all four focused reviewers, as one an older build stored does', () => {
  for (const reviewers of [undefined, [], ['builder:spec-reviewer'], [MAINTAINABILITY_REVIEWER, 'builder:unknown'], 'builder:maintainability-reviewer', [7]]) {
    const packaged = { head: HEAD, at: PACKAGED_AT, reviewers } as unknown as PlannedInput['packaged']
    expect(plannedOf(input({ packaged }))).toEqual(FOCUSED)
  }
})

test('a model is named short, and an agent with no model shows a hyphen', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(modelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('haiku')).toBe('Haiku')
  expect(modelLabel('opus')).toBe('Opus')
  expect(modelLabel('some\u001b[31m-other-model-with-a-long-name')).toBe('some-other-model-with-a…')
  expect(modelLabel(undefined)).toBe('-')
  expect(modelLabel('')).toBe('-')
  expect(modelLabel('  ')).toBe('-')
  expect(modelLabel(7)).toBe('-')
  expect(modelLabel('\u001b[31m')).toBe('-')
})
