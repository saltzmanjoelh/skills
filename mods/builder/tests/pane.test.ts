import { expect, test } from 'claude-code/testing'

import { agentSvg } from '../hooks/art'
import { SETTINGS_HINT } from '../hooks/context'
import { snapshotOf } from '../hooks/github'
import { abovePromptLine, agentCount, agentLines, agentRowOf, backgroundLines, contextLines, counselLines, messageLines, messagesReadOf, NAMED_AFTER_MS, nextStep, secondRow, STALE_WARNING, timeUntil, type View } from '../hooks/pane'
import { RELOAD_LINE, resumePrompt, stuckPrompt } from '../hooks/prompts'
import { clockTime, printable, timeOfDay } from '../hooks/text'
import type { AgentCard, BackgroundTask, Compactions, ContextMeasure, CounselQuestion, CounselVote, ForegroundCall, NextLook, Progress, Question } from '../types'

const C = 'c'.repeat(40)
const NOW = 1_000_000

function pullRequest(checks: { status: string; conclusion: string | null }[], labels: string[] = []) {
  return snapshotOf('o/r', {
    number: 7,
    url: 'u',
    state: 'OPEN',
    headRefOid: C,
    labels: labels.map(name => ({ name })),
    statusCheckRollup: checks.map(check => ({ __typename: 'CheckRun', name: 'tests', ...check })),
    commits: [{ oid: C }],
  }, 'owner')
}

const passed = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]
const running = [{ status: 'IN_PROGRESS', conclusion: null }]
const failed = [{ status: 'COMPLETED', conclusion: 'FAILURE' }]
const agent = (id: string): AgentCard => ({ id, type: 't', description: '', asked: '', status: 'running', startedAt: NOW })
const question: Question = { asked: 'q', at: 0, answered: false, labelled: false }

// A view of #7 whose next look is seven minutes out unless the case says otherwise.
function view(over: Partial<View> = {}): View {
  return {
    pr: pullRequest(passed),
    agents: [],
    questions: [],
    wakes: [],
    now: NOW,
    nextLook: { at: NOW + 7 * 60_000, isNewHead: false },
    counsel: [],
    background: [],
    calls: [],
    started: false,
    progress: null,
    watchSince: null,
    finishedFolded: true,
    planned: [],
    usageHold: null,
    stale: false,
    issueLink: null,
    context: null,
    compactions: null,
    ...over,
  }
}

test('the time until a look is whole minutes rounded up, under a minute, or nothing once it has passed', () => {
  expect(timeUntil(NOW + 7 * 60_000, NOW)).toBe('7m')
  expect(timeUntil(NOW + 6 * 60_000 + 1, NOW)).toBe('7m')
  expect(timeUntil(NOW + 90_000, NOW)).toBe('2m')
  expect(timeUntil(NOW + 60_000, NOW)).toBe('1m')
  expect(timeUntil(NOW + 59_999, NOW)).toBe('under a minute')
  expect(timeUntil(NOW, NOW)).toBeNull()
  // The machine slept past the look by more than an interval.
  expect(timeUntil(NOW - 30 * 60_000, NOW)).toBeNull()
})

test('the next step names the first thing that applies, in the order the spec gives', () => {
  const newHead: NextLook = { at: NOW + 90_000, isNewHead: true }
  expect(nextStep(view({ nextLook: newHead, questions: [question], agents: [agent('a')] }))).toBe('new head, handing over in 2m')
  expect(nextStep(view({ questions: [question], agents: [agent('a')] }))).toBe('waiting on your answer · next look in 7m')
  expect(nextStep(view({ agents: [agent('a'), agent('b')], pr: pullRequest(running) }))).toBe('2 agents running · next look in 7m')
  expect(nextStep(view({ agents: [agent('a')] }))).toBe('1 agent running · next look in 7m')
  expect(nextStep(view({ pr: pullRequest(running, ['ready-to-merge']) }))).toBe('waiting on checks · next look in 7m')
  expect(nextStep(view({ pr: pullRequest(passed, ['ready-to-merge']) }))).toBe('waiting on the merge · next look in 7m')
  expect(nextStep(view())).toBe('nothing to hand over · next look in 7m')
})

test('a failed check reads as waiting on a fix, in the next step and the line above the prompt', () => {
  expect(nextStep(view({ pr: pullRequest(failed) }))).toBe('waiting on a fix · next look in 7m')
  expect(abovePromptLine(view({ pr: pullRequest(failed) }))).toBe('builder: #7 open · checks failed · waiting on a fix · next look in 7m')
})

test('once the time of the look has passed, the next step says it is due now rather than in now', () => {
  expect(nextStep(view({ nextLook: { at: NOW, isNewHead: true } }))).toBe('new head, handing over now')
  expect(nextStep(view({ nextLook: { at: NOW - 30 * 60_000, isNewHead: false } }))).toBe('nothing to hand over · next look due now')
  expect(nextStep(view({ nextLook: { at: NOW - 1, isNewHead: false }, questions: [question] }))).toBe('waiting on your answer · next look due now')
  for (const at of [NOW, NOW - 1]) {
    for (const isNewHead of [true, false]) expect(nextStep(view({ nextLook: { at, isNewHead } }))).not.toContain('in now')
  }
})

test('with no look scheduled, or a due time that cannot be read, the next step is not polling', () => {
  expect(nextStep(view({ nextLook: null, questions: [question] }))).toBe('not polling')
  expect(nextStep(view({ nextLook: { at: Number.NaN, isNewHead: true } }))).toBe('not polling')
  expect(nextStep(view({ nextLook: { at: 'soon', isNewHead: false } as unknown as NextLook }))).toBe('not polling')
  expect(nextStep(view({ nextLook: 'garbage' as unknown as NextLook }))).toBe('not polling')
})

test('the line above the prompt reads the pull request, its checks and the next step, and never says waiting on nothing', () => {
  expect(abovePromptLine(view())).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 7m')
  expect(abovePromptLine(view({ nextLook: { at: NOW + 30_000, isNewHead: false } }))).toBe('builder: #7 open · checks passed · nothing to hand over · next look in under a minute')
  expect(abovePromptLine(view({ nextLook: { at: NOW - 1, isNewHead: true } }))).toBe('builder: #7 open · checks passed · new head, handing over now')
  const merged = { ...pullRequest(passed), state: 'MERGED' as const }
  expect(abovePromptLine(view({ pr: merged, nextLook: null }))).toBe('builder: #7 merged · checks passed · not polling')
  for (const v of [view(), view({ nextLook: null }), view({ pr: merged })]) {
    expect(abovePromptLine(v)).not.toContain('waiting on nothing')
  }
})

// The six reviewers on the counsel. The seventh member, the owner's advocate,
// never votes in these fixtures, as in a tally stored before it joined.
const MEMBERS = ['spec', 'adversarial', 'security', 'maintainability', 'performance', 'data']
// Votes matching per-option counts, the members voting in order, then the
// given number of none votes; members past those were left out.
const ballots = (counts: number[], none = 0): CounselVote[] => {
  const choices: CounselVote['vote'][] = [...counts.flatMap((count, i) => Array<number>(count).fill(i + 1)), ...Array<'none'>(none).fill('none')]
  return choices.map((vote, i) => ({ member: `builder:${MEMBERS[i]}-reviewer`, vote, reason: `reason ${i}` }))
}

// A counsel question as the mod records it, decided 4 of 6 for its second
// option unless the case says otherwise, as a tally stored before the owner's
// advocate joined the counsel.
function counselQuestion(n: number, over: Partial<CounselQuestion> = {}): CounselQuestion {
  return {
    id: `c${n}`,
    question: `Question ${n}?`,
    options: ['first way', 'second way'],
    background: '',
    paths: [],
    lean: `lean ${n}`,
    folder: `/repo/.git/builder/counsel/c${n}`,
    round: 1,
    tallies: [{ round: 1, votes: ballots([1, 4], 1), counts: [1, 4], outcome: 'decided', chosen: 2, proposed: [] }],
    ...over,
  }
}

test('the counsel lines show the newest twenty of twenty-two questions, newest first, with the tally per option, the outcome and the lean', () => {
  const list = Array.from({ length: 22 }, (_, i) => counselQuestion(i + 1))
  list[21] = counselQuestion(22, {
    round: 2,
    options: ['first way', 'second way', 'third way'],
    tallies: [
      { round: 1, votes: ballots([2, 2], 2), counts: [2, 2], outcome: 'rerun', proposed: ['third way'] },
      { round: 2, votes: ballots([3, 1, 2]), counts: [3, 1, 2], outcome: 'ask', proposed: [] },
    ],
  })
  list[20] = counselQuestion(21, { tallies: [{ round: 1, votes: ballots([1, 4], 1), counts: [1, 4], outcome: 'decided', chosen: 2, proposed: ['a fourth way'] }] })
  list[19] = counselQuestion(20, { tallies: [] })
  const text = counselLines(list).join('\n')

  expect(text.indexOf('Question 22?')).toBeLessThan(text.indexOf('Question 21?'))
  expect(text.indexOf('Question 21?')).toBeLessThan(text.indexOf('Question 3?'))
  expect(text).not.toContain('Question 2?')
  expect(text).not.toContain('Question 1?')
  expect(text).toContain('c22 · round 2 · asked the person · Question 22?')
  expect(text).toContain('Tally: 1. first way 3, 2. second way 1, 3. third way 2, no option 0, of 6 who took part')
  expect(text).toContain('c21 · round 1 · decided · Question 21?')
  expect(text).toContain('Chosen: second way')
  expect(text).toContain('Proposed, shown only: a fourth way')
  expect(text).toContain('c20 · round 1 · voting · Question 20?')
  expect(text).toContain('Lean: lean 22')
})

test('the counsel lines count against the members who took part and list an old tally\'s abstainers apart under Without a vote, with the first line of each reason', () => {
  const votes: CounselVote[] = [
    ...ballots([1, 2]),
    { member: 'builder:maintainability-reviewer', vote: 'abstain', reason: 'outside my angle\nsecond line' },
  ]
  const text = counselLines([counselQuestion(1, { tallies: [{ round: 1, votes, counts: [1, 2], outcome: 'decided', chosen: 2, proposed: [] }] })]).join('\n')
  expect(text).toContain('Tally: 1. first way 1, 2. second way 2, no option 0, of 3 who took part')
  expect(text.split('\n')).toContain('  Without a vote: maintainability-reviewer (outside my angle), performance-reviewer (no readable vote), data-reviewer (no readable vote), owners-advocate (no readable vote)')
  expect(text).not.toContain('Abstained:')
  expect(text).not.toContain('second line')

  const nobody = ballots([]).concat(MEMBERS.map(m => ({ member: `builder:${m}-reviewer`, vote: 'abstain' as const, reason: 'not mine' })))
  const empty = counselLines([counselQuestion(2, { tallies: [{ round: 1, votes: nobody, counts: [0, 0], outcome: 'ask', proposed: [] }] })]).join('\n')
  expect(empty).toContain('Tally: no member took part')
})

test('the pane lists a follow-ups question with each follow-up\'s tally and decision, and the members without a vote', () => {
  const members = [...MEMBERS.map(m => `builder:${m}-reviewer`), 'builder:owners-advocate']
  // Each follow-up's votes, member i voting choice i; undefined leaves it out.
  const votesOf = (choices: (CounselVote['vote'] | undefined)[]): CounselVote[] =>
    choices.flatMap((vote, i) => (vote === undefined ? [] : [{ member: members[i]!, vote, reason: `reason ${i}` }]))
  const q = counselQuestion(3, {
    question: 'What happens to each follow-up of this round?',
    options: ['fix it in this pull request', 'file it as an issue', 'drop it'],
    followUps: ['The pane cuts long agent names.', 'The poll logs\nevery look twice.'],
    tallies: [{
      round: 1, votes: [], counts: [], outcome: 'counted', proposed: [],
      followUps: [
        { votes: votesOf([2, 2, 2, 2, 3, 3, 'none']), counts: [0, 4, 2], chosen: 2 },
        { votes: votesOf([1, 1, 1, 3, 3, 3, undefined]), counts: [3, 0, 3] },
      ],
    }],
  })
  const lines = counselLines([q])
  expect(lines).toContain('c3 · round 1 · counted · What happens to each follow-up of this round?')
  expect(lines).toContain('  1. The pane cuts long agent names. · fix 0, file 4, drop 2, no option 1 · decided: file it as an issue')
  expect(lines).toContain('  2. The poll logs every look twice. · fix 3, file 0, drop 3, no option 0 · not decided, so dropped')
  expect(lines).toContain('    Without a vote: owners-advocate (no readable vote)')
  expect(lines).toContain('  Lean: lean 3')
  expect(lines.join('\n')).not.toContain('Tally:')
  expect(lines.join('\n')).not.toContain('Chosen:')
})

test('a tally stored before the owner\'s advocate joined is still shown, with the advocate among the members without a vote', () => {
  const lines = counselLines([counselQuestion(1)])
  expect(lines).toContain('  Tally: 1. first way 1, 2. second way 4, no option 1, of 6 who took part')
  expect(lines).toContain('  Without a vote: owners-advocate (no readable vote)')
  expect(lines.join('\n')).not.toContain('Abstained:')
  expect(lines).toContain('  Chosen: second way')
})

// A question whose round 1 was sent to a rerun and whose round 2 is still
// being voted on, with round 1's votes and the options round 2 has.
const rerunQuestion = (votes: CounselVote[], counts: number[], options: string[]) => counselQuestion(22, {
  round: 2,
  options,
  tallies: [{ round: 1, votes, counts, outcome: 'rerun', proposed: options.slice(counts.length) }],
})

test('a question in round 2 after a rerun shows round 1\'s tally over round 1\'s options, its members without a vote, and the added options as new with no count', () => {
  const votes: CounselVote[] = [
    ...ballots([2, 2]),
    { member: 'builder:performance-reviewer', vote: 'abstain', reason: 'outside my angle' },
  ]
  const lines = counselLines([rerunQuestion(votes, [2, 2], ['first way', 'second way', 'third way'])])
  expect(lines).toEqual([
    'c22 · round 2 · voting · Question 22?',
    '  Round 1:',
    '    Tally: 1. first way 2, 2. second way 2, no option 0, of 4 who took part',
    '    Without a vote: performance-reviewer (outside my angle), data-reviewer (no readable vote), owners-advocate (no readable vote)',
    '    New in round 2: 3. third way',
    '  Lean: lean 22',
  ])
  expect(lines.join('\n')).not.toMatch(/third way \d/)
})

test('round 1 of a rerun has no line of members without a vote when every member voted', () => {
  const votes: CounselVote[] = [...ballots([3, 3]), { member: 'builder:owners-advocate', vote: 2, reason: 'reason 6' }]
  const lines = counselLines([rerunQuestion(votes, [3, 4], ['first way', 'second way', 'third way'])])
  expect(lines).toEqual([
    'c22 · round 2 · voting · Question 22?',
    '  Round 1:',
    '    Tally: 1. first way 3, 2. second way 4, no option 0, of 7 who took part',
    '    New in round 2: 3. third way',
    '  Lean: lean 22',
  ])
})

test('round 1 of a rerun that added no option has no line naming new options', () => {
  const lines = counselLines([rerunQuestion(ballots([2, 2]), [2, 2], ['first way', 'second way'])])
  expect(lines).toContain('    Tally: 1. first way 2, 2. second way 2, no option 0, of 4 who took part')
  expect(lines.join('\n')).not.toContain('New in round 2')
  expect(lines.at(-1)).toBe('  Lean: lean 22')
})

const typed = (id: string, type: string, startedAt: number, over: Partial<AgentCard> = {}): AgentCard =>
  ({ id, type, description: `about ${id}`, status: 'running', startedAt, ...over })
const shell = (id: string): BackgroundTask => ({ id, type: 'shell', status: 'running', description: `run ${id}`, command: `make ${id}` })
const call = (id: string, startedAt: number, label = `label ${id}`): ForegroundCall => ({ id, tool: 'Bash', label, startedAt })

test('one running agent is one agent, never one agents, on the line and in the next step', () => {
  const v = view({ agents: [typed('a', 'builder:spec-reviewer', NOW)] })
  expect(abovePromptLine(v)).toBe('builder: #7 open · checks passed · 1 agent: spec-reviewer · next look in 7m')
  expect(abovePromptLine(v)).not.toContain('1 agents')
  expect(nextStep(v)).toBe('1 agent running · next look in 7m')
  // The line names the agents in its running part, so the next step does not count them again.
  expect(nextStep(v, true)).toBe('next look in 7m')
  expect(nextStep(view({ agents: [agent('a'), agent('b')] }), false)).toBe('2 agents running · next look in 7m')
})

test('the agent-count button counts the agents running now, then the planned ones, then the finished ones', () => {
  const done = (id: string): AgentCard => ({ ...agent(id), status: 'completed' })
  const finished = Array.from({ length: 52 }, (_, i) => done(`f${i}`))
  const runningNow = Array.from({ length: 7 }, (_, i) => agent(`r${i}`))
  // Seven reviewers running among fifty-nine agents the session has had: the
  // label leads with the seven, never the fifty-nine alone.
  expect(agentCount(view({ agents: [...finished, ...runningNow] }))).toBe('7 agents running · 52 finished')
  expect(agentCount(view({ agents: [agent('a')] }))).toBe('1 agent running')
  expect(agentCount(view({ agents: [done('a'), done('b')] }))).toBe('0 agents running · 2 finished')
  expect(agentCount(view({ agents: [done('a')], planned: ['builder:spec-reviewer', 'builder:adversarial-reviewer'] }))).toBe('0 agents running · 2 planned · 1 finished')
  // A card the engine has dropped from its list counts as finished, not running.
  expect(agentCount(view({ agents: [{ ...agent('a'), isListed: false }] }))).toBe('0 agents running · 1 finished')
  expect(agentCount(view())).toBe('0 agents running')
})

test('with nothing watched the line names what runs, and there is no line when nothing does', () => {
  const agents = [typed('a', 'Explore', NOW - 3), typed('b', 'builder:spec-reviewer', NOW - 2), typed('c', 'builder:data-reviewer', NOW - 1)]
  expect(abovePromptLine(view({ pr: null, nextLook: null, agents }))).toBe('builder: no pull request yet · 3 agents: Explore, spec-reviewer, data-reviewer')
  expect(abovePromptLine(view({ pr: null, nextLook: null }))).toBeNull()
  // Finished agents, and words an older build saved, are not running.
  const finished = [typed('d', 'Explore', 0, { status: 'completed' }), typed('e', 'Explore', 0, { status: 'done' as AgentCard['status'] }), typed('f', 'Explore', 0, { isListed: false })]
  expect(abovePromptLine(view({ pr: null, nextLook: null, agents: finished }))).toBeNull()
  expect(abovePromptLine(view({ pr: null, nextLook: null, background: [shell('x')] }))).toBe('builder: no pull request yet · 1 background command')
})

test('background work is counted as commands when every task is a shell command, and as tasks otherwise', () => {
  const none = { pr: null, nextLook: null }
  expect(abovePromptLine(view({ ...none, background: [shell('x'), shell('y')] }))).toBe('builder: no pull request yet · 2 background commands')
  const monitor: BackgroundTask = { id: 'm', type: 'monitor', status: 'running', description: 'ci' }
  expect(abovePromptLine(view({ ...none, background: [monitor] }))).toBe('builder: no pull request yet · 1 background task')
  expect(abovePromptLine(view({ ...none, background: [monitor, shell('x')] }))).toBe('builder: no pull request yet · 2 background tasks')
  expect(abovePromptLine(view({ agents: [typed('a', 'Explore', NOW)], background: [shell('x')] })))
    .toBe('builder: #7 open · checks passed · 1 agent: Explore · 1 background command · next look in 7m')
})

test('a foreground call is named once it has run ten seconds, the earliest first, and not before', () => {
  expect(NAMED_AFTER_MS).toBe(10_000)
  const none = { pr: null, nextLook: null }
  expect(abovePromptLine(view({ ...none, calls: [call('x', NOW - 9_999)] }))).toBeNull()
  expect(abovePromptLine(view({ ...none, calls: [call('x', NOW - 10_000, 'Run the gates')] }))).toBe('builder: no pull request yet · running: Run the gates (10s)')
  const two = [call('late', NOW - 20_000), call('early', NOW - 67_000)]
  expect(abovePromptLine(view({ calls: two }))).toBe('builder: #7 open · checks passed · running: label early (1m 7s) · nothing to hand over · next look in 7m')
  // The call comes first, then the agents, then the background work.
  expect(abovePromptLine(view({ ...none, calls: [call('x', NOW - 10_000)], agents: [typed('a', 'Explore', NOW)], background: [shell('y')] })))
    .toBe('builder: no pull request yet · running: label x (10s) · 1 agent: Explore · 1 background command')
})

test('a long line drops agent names from the end first, then is cut, to the width the band gives', () => {
  const agents = ['Explore', 'builder:spec-reviewer', 'builder:data-reviewer', 'builder:security-reviewer', 'general-purpose']
    .map((type, i) => typed(`a${i}`, type, NOW - 10 + i))
  const fitted = abovePromptLine(view({ pr: null, nextLook: null, agents }), 52)!
  expect(fitted.length).toBeLessThanOrEqual(52)
  expect(fitted).toBe('builder: no pull request yet · 5 agents: Explore, …')
  expect(abovePromptLine(view({ pr: null, nextLook: null, agents }), 22)).toBe('builder: no pull requ…')
  expect(abovePromptLine(view({ pr: null, nextLook: null, agents }))).toBe('builder: no pull request yet · 5 agents: Explore, spec-reviewer, data-reviewer, security-reviewer, general-purpose')
  expect(abovePromptLine(view({ pr: null, nextLook: null, agents }), Number.NaN)).toContain('general-purpose')
  expect(abovePromptLine(view(), 32)).toBe('builder: #7 open · checks passe…')
})

test('text a model supplies loses its escape sequences and control characters and is cut to a fixed length', () => {
  expect(printable('\u001b[31mred\u001b[0m text')).toBe('red text')
  expect(printable('a\u001b]8;;http://x\u0007link\u001b]8;;\u0007 b')).toBe('alink b')
  expect(printable('one\ntwo\r\nthree\tfour')).toBe('one two three four')
  expect(printable('bell\u0007 and \u0085C1 and \u202eevil\u202c')).toBe('bell and C1 and evil')
  expect(printable('  many    spaces  ')).toBe('many spaces')
  expect(printable('x'.repeat(100))).toBe(`${'x'.repeat(79)}…`)
  expect(printable('x'.repeat(30), 10)).toBe(`${'x'.repeat(9)}…`)
  expect(printable(undefined as unknown as string)).toBe('')
  // On the line, a call's label is cleaned too.
  expect(abovePromptLine(view({ pr: null, nextLook: null, calls: [call('x', NOW - 10_000, 'gates\n\u001b[2Jnow')] }))).toBe('builder: no pull request yet · running: gates now (10s)')
})

test('a clock time is seconds, minutes and seconds, or hours and minutes', () => {
  expect(clockTime(45_400)).toBe('45s')
  expect(clockTime(67_000)).toBe('1m 7s')
  expect(clockTime(3_720_000)).toBe('1h 2m')
  expect(clockTime(0)).toBe('0s')
})

test('a time of day is UTC hours, minutes and seconds, with the UTC date before it when it is not today', () => {
  const now = Date.parse('2026-10-12T15:30:00Z')
  expect(timeOfDay(Date.parse('2026-10-12T02:01:00Z'), now)).toBe('02:01:00')
  expect(timeOfDay(Date.parse('2026-10-12T23:59:59.999Z'), now)).toBe('23:59:59')
  expect(timeOfDay(Date.parse('2026-10-13T00:00:00Z'), now)).toBe('2026-10-13 00:00:00')
  expect(timeOfDay(Date.parse('2026-11-11T00:01:00Z'), now)).toBe('2026-11-11 00:01:00')
  expect(timeOfDay(Date.parse('2026-10-11T23:59:00Z'), now)).toBe('2026-10-11 23:59:00')
})

test('while a usage-limit hold is on, the next step waits on the usage limit until the resume time, before anything else', () => {
  const hold = NOW + 2 * 60 * 60_000
  const until = `waiting on the usage limit until ${timeOfDay(hold, NOW)}`
  expect(until).toBe('waiting on the usage limit until 02:16:40')
  expect(nextStep(view({ usageHold: hold }))).toBe(until)
  // The hold comes first, before not polling, a new head, a question or agents.
  expect(nextStep(view({ usageHold: hold, nextLook: null }))).toBe(until)
  expect(nextStep(view({ usageHold: hold, nextLook: { at: NOW + 60_000, isNewHead: true } }))).toBe(until)
  expect(nextStep(view({ usageHold: hold, questions: [question], agents: [agent('a')] }), true)).toBe(until)
  // A resume on another UTC day carries its date.
  expect(nextStep(view({ usageHold: NOW + 2 * 24 * 60 * 60_000 }))).toBe('waiting on the usage limit until 1970-01-03 00:16:40')
  expect(abovePromptLine(view({ usageHold: hold, nextLook: null }))).toBe(`builder: #7 open · checks passed · ${until}`)
})

test('the stuck prompt names the pull request and the whole minutes, and asks the session to check its wait with gh', () => {
  expect(stuckPrompt(7, 45 * 60_000 + 59_999)).toBe([
    'builder: nothing has happened on pull request #7 for 45 minutes.',
    'Check with gh whether what you are waiting on is real.',
    'Then take the first step of the list in /implement that applies, or end the turn if the wait is real.',
  ].join('\n'))
  expect(stuckPrompt(12, 360 * 60_000).split('\n')[0]).toBe('builder: nothing has happened on pull request #12 for 360 minutes.')
})

test('the resume prompt says the usage limit has reset and names the stage, or no stage when none was reported', () => {
  expect(resumePrompt('build')).toBe('builder: the usage limit has reset; carry on /implement from the stage you were in (build).')
  expect(resumePrompt(null)).toBe('builder: the usage limit has reset; carry on /implement from the stage you were in.')
})

test('with the compacted flag set, the stuck prompt begins with the reload line and a blank line, and the rest is its usual text', () => {
  expect(stuckPrompt(7, 45 * 60_000, false)).toBe(stuckPrompt(7, 45 * 60_000))
  expect(stuckPrompt(7, 45 * 60_000, true)).toBe([
    RELOAD_LINE,
    '',
    'builder: nothing has happened on pull request #7 for 45 minutes.',
    'Check with gh whether what you are waiting on is real.',
    'Then take the first step of the list in /implement that applies, or end the turn if the wait is real.',
  ].join('\n'))
})

test('with the compacted flag set, the resume prompt begins with the reload line and a blank line, and the rest is its usual text', () => {
  expect(resumePrompt('build', false)).toBe(resumePrompt('build'))
  expect(resumePrompt('build', true)).toBe([RELOAD_LINE, '', 'builder: the usage limit has reset; carry on /implement from the stage you were in (build).'].join('\n'))
  expect(resumePrompt(null, true)).toBe([RELOAD_LINE, '', 'builder: the usage limit has reset; carry on /implement from the stage you were in.'].join('\n'))
})

test('with no pull request watched, a hold shows in place of idle on the second row and on the line', () => {
  const hold = NOW + 15 * 60_000
  const until = `waiting on the usage limit until ${timeOfDay(hold, NOW)}`
  const none = { pr: null, nextLook: null, usageHold: hold }
  expect(secondRow(view({ ...none, started: true }))).toBe(`builder: started · ${until}`)
  expect(secondRow(view({ ...none, started: true, progress: reported() }))).toBe(`builder: spec · ${until}`)
  // Before builder is started, the line shows the hold even when nothing runs.
  expect(abovePromptLine(view(none))).toBe(`builder: no pull request yet · ${until}`)
  expect(secondRow(view(none))).toBe(`builder: no pull request yet · ${until}`)
  // What still runs is named before the hold.
  expect(secondRow(view({ ...none, started: true, agents: [typed('a', 'Explore', NOW)] }))).toBe(`builder: started · 1 agent: Explore · ${until}`)
  expect(abovePromptLine(view({ ...none, agents: [typed('a', 'Explore', NOW)] }))).toBe(`builder: no pull request yet · 1 agent: Explore · ${until}`)
  // With no hold, the rows read as before.
  expect(secondRow(view({ ...none, usageHold: null, started: true }))).toBe('builder: started · idle')
  expect(abovePromptLine(view({ ...none, usageHold: null }))).toBeNull()
})

test('the pane lists running agents first and finished ones below, newest first in each group, with every agent', () => {
  const agents = [
    typed('old-done', 'Explore', NOW - 50_000, { status: 'completed', durationMs: 4_000, summary: 'VERDICT: APPROVE x' }),
    typed('old-run', 'builder:spec-reviewer', NOW - 40_000, { model: 'claude-opus-5-5' }),
    typed('new-done', 'Explore', NOW - 30_000, { status: 'failed', endedAt: NOW - 10_000 }),
    typed('new-run', 'general-purpose', NOW - 20_000, { description: 'build\u001b[2J it' }),
    typed('dropped', 'Explore', NOW - 60_000, { isListed: false, lastSeenAt: NOW - 55_000 }),
    ...Array.from({ length: 12 }, (_, i) => typed(`f${i}`, 'Explore', i, { status: 'completed', durationMs: 1_000 })),
  ]
  const lines = agentLines(view({ agents }))
  expect(lines.length).toBe(17)
  expect(lines.slice(0, 5)).toEqual([
    'running general-purpose · build it · - · 20s',
    'running spec-reviewer · about old-run · Opus 5.5 · 40s',
    'failed Explore · about new-done · - · 20s',
    'completed Explore · about old-done · - · 4s · VERDICT: APPROVE x',
    'no longer listed Explore · about dropped · - · 5s',
  ])
  // An agent with no description, as one the mod never saw spawn, leaves it out.
  expect(agentLines(view({ agents: [typed('p', 'agent', NOW - 67_000, { description: '' })] }))).toEqual(['running agent · - · 1m 7s'])
})

test('a dropped agent whose stored status is finished keeps that word, and a dropped running one is drawn as finished', () => {
  const done = typed('done', 'Explore', NOW - 60_000, { status: 'completed', isListed: false, durationMs: 3_000 })
  expect(agentLines(view({ agents: [done] }))).toEqual(['completed Explore · about done · - · 3s'])
  const dropped = typed('dropped', 'Explore', NOW - 60_000, { isListed: false, lastSeenAt: NOW - 55_000 })
  const row = agentRowOf(dropped, NOW)
  expect(row.status).toBe('no longer listed')
  expect(row.isRunning).toBe(false)
  const svg = agentSvg(row, NOW, 700)
  expect(svg).toContain('no longer listed')
  expect(/<circle class="([a-z]+)"/.exec(svg)?.[1]).toBe('m')
  // Its time is frozen, so the drawing does not change from one second to the next.
  expect(agentSvg(agentRowOf(dropped, NOW + 1_000), NOW + 1_000, 700)).toBe(svg)
})

test('the pane lists background tasks with their status and description, else their command', () => {
  const tasks: BackgroundTask[] = [shell('x'), { id: 'y', type: 'shell', status: 'running', description: ' ', command: 'npm\u0007 test' }]
  expect(backgroundLines(view({ background: tasks }))).toEqual(['running shell · run x', 'running shell · npm test'])
})

const reported = (over: Partial<Progress> = {}): Progress =>
  ({ title: 'ABC-123 builder progress', stage: 'spec', furthest: 'spec', note: '', since: 0, autoOpened: true, ...over })

test('with a pull request watched, the second row is the line above the prompt, at every width, started or not', () => {
  const agents = ['Explore', 'builder:spec-reviewer', 'builder:data-reviewer', 'builder:security-reviewer']
    .map((type, i) => typed(`a${i}`, type, NOW - 10 + i))
  const views = [view(), view({ agents }), view({ agents, calls: [call('x', NOW - 20_000)] }), view({ pr: { ...pullRequest(failed), state: 'MERGED' }, nextLook: null })]
  for (const v of views) {
    for (const width of [undefined, Number.NaN, 200, 90, 70, 50, 20]) {
      for (const started of [false, true]) {
        const progress = started ? reported() : null
        expect(secondRow({ ...v, started, progress }, width)).toBe(abovePromptLine(v, width))
      }
    }
  }
})

test('once builder is started with no pull request watched, the second row names the stage, or started, and what runs, or idle', () => {
  const none = { pr: null, nextLook: null, started: true }
  expect(secondRow(view(none))).toBe('builder: started · idle')
  expect(secondRow(view({ ...none, progress: reported() }))).toBe('builder: spec · idle')
  expect(secondRow(view({ ...none, progress: reported({ stage: 'plan', furthest: 'plan', note: 'round 2' }) }))).toBe('builder: plan tournament · idle')
  expect(secondRow(view({ ...none, agents: [typed('a', 'builder:spec-reviewer', NOW)] }))).toBe('builder: started · 1 agent: spec-reviewer')
  // Fitted as the line is: agent names go from the end first, then the row is cut.
  const agents = ['Explore', 'builder:spec-reviewer', 'builder:data-reviewer'].map((type, i) => typed(`a${i}`, type, NOW - 10 + i))
  expect(secondRow(view({ ...none, progress: reported(), agents }), 42)).toBe('builder: spec · 3 agents: Explore, …')
  expect(secondRow(view({ ...none, progress: reported(), agents }), 17)).toBe('builder: spec · …')
  expect(secondRow(view({ ...none, progress: reported() }), 12)).toBe('builder: sp…')
})

test('before builder is started the second row is the line as before: none while nothing runs and no hold is on, whatever was reported', () => {
  const none = { pr: null, nextLook: null }
  expect(secondRow(view(none))).toBeNull()
  expect(secondRow(view({ ...none, progress: reported() }))).toBeNull()
  expect(secondRow(view({ ...none, agents: [typed('a', 'Explore', NOW)] }))).toBe('builder: no pull request yet · 1 agent: Explore')
})

test('the stale warning says the mod changed on disk and asks for a restart, without saying which way it moved', () => {
  expect(STALE_WARNING).toBe('builder changed on disk since this session loaded it; restart this session to load it')
})

test('a stale session leads the line with the warning, and the rest of the line follows without its prefix', () => {
  const agents = [typed('a', 'builder:spec-reviewer', NOW)]
  expect(abovePromptLine(view({ stale: true, agents })))
    .toBe(`${STALE_WARNING} · #7 open · checks passed · 1 agent: spec-reviewer · next look in 7m`)
  expect(secondRow(view({ stale: true, agents, started: true }))).toBe(abovePromptLine(view({ stale: true, agents })))
  // With nothing watched, once builder is started, the stage follows the warning.
  expect(secondRow(view({ stale: true, pr: null, nextLook: null, started: true, progress: reported() })))
    .toBe(`${STALE_WARNING} · spec · idle`)
})

test('with nothing else to say, a stale session\'s line is the warning alone, before builder is started too', () => {
  const none = { pr: null, nextLook: null, stale: true }
  expect(abovePromptLine(view(none))).toBe(STALE_WARNING)
  expect(secondRow(view(none))).toBe(STALE_WARNING)
  expect(secondRow(view(none), 40)).toBe(STALE_WARNING)
})

test('the rest of a stale line is fitted to the width the warning leaves, and the warning itself is never cut', () => {
  const agents = ['Explore', 'builder:spec-reviewer', 'builder:data-reviewer'].map((type, i) => typed(`a${i}`, type, NOW - 10 + i))
  const v = view({ stale: true, agents })
  for (const width of [200, 150, 120, 100, 90]) {
    const line = abovePromptLine(v, width)!
    expect(line.startsWith(`${STALE_WARNING} · `)).toBe(true)
    expect(line.length).toBeLessThanOrEqual(width)
  }
  const room = 120 - STALE_WARNING.length - ' · '.length
  expect(abovePromptLine(v, 120)).toBe(`${STALE_WARNING} · ${abovePromptLine(view({ agents }), room + 'builder: '.length)!.slice('builder: '.length)}`)
  // At or below the warning's own width the line is the warning alone, whole.
  for (const width of [STALE_WARNING.length + 3, STALE_WARNING.length, 60, 20, 0]) {
    expect(abovePromptLine(v, width)).toBe(STALE_WARNING)
    expect(secondRow({ ...v, started: true }, width)).toBe(STALE_WARNING)
  }
  // A width that cannot be read fits nothing, as it does without the warning.
  expect(abovePromptLine(v, Number.NaN)).toBe(abovePromptLine(v))
})

test('a session that is not stale draws its line as before', () => {
  expect(abovePromptLine(view())).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 7m')
  expect(abovePromptLine(view({ pr: null, nextLook: null }))).toBeNull()
})

test('an agent\'s messages are its assistant text and its tool uses, the last forty, cleaned, and nothing else', () => {
  const lines = messageLines([
    { role: 'user', text: 'the prompt', toolUses: [] },
    { role: 'assistant', text: 'Looking \u001b[2Jnow', toolUses: [
      { tool_use_id: 'a', tool: 'Bash', input: { command: 'npm test', description: 'Run the suite' } },
      { tool_use_id: 'b', tool: 'Grep', input: { pattern: 'x\ny' } },
      { tool_use_id: 'c', tool: 'mcp__builder__watch', input: { number: 7 } },
    ] },
    { role: 'assistant', text: '', toolUses: [] },
    'not a message',
    { role: 'assistant', text: 'x'.repeat(500), toolUses: 'not a list' },
  ])
  expect(lines).toEqual([
    'Looking now',
    'Bash: Run the suite',
    'Grep: x y',
    'mcp__builder__watch: {"number":7}',
    `${'x'.repeat(199)}…`,
  ])
  const many = Array.from({ length: 41 }, (_, i) => ({ role: 'assistant', text: `m${i}`, toolUses: [] }))
  expect(messageLines(many)).toEqual(many.slice(1).map(m => m.text))
})

test('a read of an agent\'s messages keeps only the lines the agent pane draws, or why the engine gave none', () => {
  const said = (text: string) => ({ role: 'assistant', text, toolUses: [] })
  const many = Array.from({ length: 45 }, (_, i) => said(`m${i}`))
  expect(messagesReadOf([{ role: 'user', text: 'the prompt', toolUses: [] }, ...many])).toEqual({ lines: many.slice(5).map(m => m.text) })
  expect(messagesReadOf({ deny: 'no transcript was saved' })).toEqual({ reason: 'no transcript was saved' })
  expect(messagesReadOf('not a list')).toEqual({ reason: 'the engine answered something other than a list.' })
  expect(messagesReadOf(undefined)).toEqual({ reason: 'the engine answered something other than a list.' })
})

// The context cap (see docs/specs/implement-session-context-cap.md): the
// segment at the end of the line above the prompt, and the pane's context
// lines.

// A measure of the context taken at NOW: 212,345 tokens against builder's
// default ceiling unless the case says otherwise.
const measure = (tokens: number | null = 212_345, ceiling = 300_000, source: ContextMeasure['source'] = 'default'): ContextMeasure =>
  ({ tokens, ceiling, source, at: NOW, sessionId: 's' })
const SEGMENT = ' · context 212K of 300K'

test('every variant of the line ends with the context once a measure with a size exists, and is unchanged by a measure without one', () => {
  const agents = [typed('a', 'builder:spec-reviewer', NOW)]
  const none = { pr: null, nextLook: null }
  const variants: Partial<View>[] = [
    {},
    { agents },
    { agents, calls: [call('x', NOW - 20_000)] },
    { usageHold: NOW + 15 * 60_000, nextLook: null },
    { ...none, agents },
    { ...none, usageHold: NOW + 15 * 60_000 },
    { ...none, started: true },
    { ...none, started: true, progress: reported(), agents },
    { stale: true, agents },
    { ...none, stale: true, started: true, progress: reported() },
  ]
  for (const over of variants) {
    const plain = secondRow(view(over))
    expect(plain).not.toBeNull()
    expect(secondRow(view({ ...over, context: measure() }))).toBe(`${plain}${SEGMENT}`)
    expect(secondRow(view({ ...over, context: measure(null) }))).toBe(plain)
    expect(secondRow(view({ ...over, context: measure(null, 300_000, 'unreadable') }))).toBe(plain)
  }
  expect(abovePromptLine(view({ context: measure() }))).toBe(`builder: #7 open · checks passed · nothing to hand over · next look in 7m${SEGMENT}`)
  expect(abovePromptLine(view({ ...none, agents, context: measure() }))).toBe(`builder: no pull request yet · 1 agent: spec-reviewer${SEGMENT}`)
  expect(abovePromptLine(view({ ...none, agents, context: measure(212_345, 400_000, 'settings') }))).toBe('builder: no pull request yet · 1 agent: spec-reviewer · context 212K of 400K')
  // A measure alone makes no line: with nothing watched and nothing running,
  // before builder is started, there is still none, and a stale session's
  // line is still the warning alone.
  expect(abovePromptLine(view({ ...none, context: measure() }))).toBeNull()
  expect(secondRow(view({ ...none, context: measure() }))).toBeNull()
  expect(abovePromptLine(view({ ...none, stale: true, context: measure() }))).toBe(STALE_WARNING)
})

test('when the line must be cut, the context goes first, before any agent name is dropped', () => {
  const agents = ['Explore', 'builder:spec-reviewer'].map((type, i) => typed(`a${i}`, type, NOW - 10 + i))
  const v = view({ pr: null, nextLook: null, agents, context: measure() })
  const plain = 'builder: no pull request yet · 2 agents: Explore, spec-reviewer'
  expect(abovePromptLine(v)).toBe(`${plain}${SEGMENT}`)
  expect(abovePromptLine(v, plain.length + SEGMENT.length)).toBe(`${plain}${SEGMENT}`)
  expect(abovePromptLine(v, plain.length + SEGMENT.length - 1)).toBe(plain)
  expect(abovePromptLine(v, plain.length)).toBe(plain)
  expect(abovePromptLine(v, plain.length - 1)).toBe('builder: no pull request yet · 2 agents: Explore, …')
  expect(abovePromptLine(v, 22)).toBe('builder: no pull requ…')
  // With nothing to drop but the context, the line is cut only after the context has gone.
  const watched = 'builder: #7 open · checks passed · nothing to hand over · next look in 7m'
  expect(abovePromptLine(view({ context: measure() }), watched.length)).toBe(watched)
  expect(abovePromptLine(view({ context: measure() }), 32)).toBe('builder: #7 open · checks passe…')
  // The second row once builder is started is fitted the same way.
  const started = view({ pr: null, nextLook: null, started: true, progress: reported(), agents, context: measure() })
  expect(secondRow(started)).toBe(`builder: spec · 2 agents: Explore, spec-reviewer${SEGMENT}`)
  expect(secondRow(started, 48)).toBe('builder: spec · 2 agents: Explore, spec-reviewer')
  expect(secondRow(started, 42)).toBe('builder: spec · 2 agents: Explore, …')
})

// A compaction record of `count` compactions, the newest three minutes ago,
// manual, from 115,205 to 15,893 tokens, unless the case says otherwise.
const compacted = (count: number, over: Partial<Compactions> = {}): Compactions =>
  ({ count, last: { at: NOW - 3 * 60_000, trigger: 'manual', before: 115_205, after: 15_893 }, failed: null, owedAt: null, sessionId: 's', ...over })
const CONTEXT_SET = 'Context: 212K of 300K (settings)'

test('the pane\'s context line reads the size, the ceiling and its source, or that nothing is measured yet, or that the figures could not be read and the ceiling it fell back to', () => {
  expect(contextLines(view({ context: measure(212_345, 300_000, 'settings') }))).toEqual([CONTEXT_SET])
  expect(contextLines(view({ context: measure(212_345, 500_000, 'environment') }))).toEqual(['Context: 212K of 500K (environment)'])
  expect(contextLines(view())).toEqual(['Context: not measured yet'])
  expect(contextLines(view({ context: measure(null, 300_000, 'unreadable') }))).toEqual(['Context: could not be read; ceiling 300K (unreadable)'])
  // A window read without a size names the ceiling that was read.
  expect(contextLines(view({ context: measure(null, 400_000, 'settings') }))).toEqual(['Context: could not be read; ceiling 400K (settings)'])
})

test('the pane counts the compactions that stood as once, twice or so many times, with how long ago the newest was, what started it, and its sizes when both are known', () => {
  const settled = (count: number, over: Partial<Compactions> = {}) => view({ context: measure(212_345, 300_000, 'settings'), compactions: compacted(count, over) })
  expect(contextLines(settled(1))).toEqual([CONTEXT_SET, 'Compacted once, 3m ago (manual), 115K to 16K.'])
  expect(contextLines(settled(2))).toEqual([CONTEXT_SET, 'Compacted twice, 3m ago (manual), 115K to 16K.'])
  expect(contextLines(settled(3))).toEqual([CONTEXT_SET, 'Compacted 3 times, 3m ago (manual), 115K to 16K.'])
  expect(contextLines(settled(12, { last: { at: NOW - 65 * 60_000, trigger: 'auto', before: 280_000, after: 20_500 } }))).toEqual([CONTEXT_SET, 'Compacted 12 times, 1h5m ago (auto), 280K to 21K.'])
  // The sizes are left out unless the engine reported both.
  expect(contextLines(settled(1, { last: { at: NOW - 3 * 60_000, trigger: 'plugin', before: null, after: 15_893 } }))).toEqual([CONTEXT_SET, 'Compacted once, 3m ago (plugin).'])
  expect(contextLines(settled(2, { last: { at: NOW - 3 * 60_000, trigger: 'plugin', before: 115_205, after: null } }))).toEqual([CONTEXT_SET, 'Compacted twice, 3m ago (plugin).'])
  expect(contextLines(settled(3, { last: { at: NOW - 3 * 60_000, trigger: 'plugin', before: null, after: null } }))).toEqual([CONTEXT_SET, 'Compacted 3 times, 3m ago (plugin).'])
  // No compaction line while none has stood, or when the record counts one but holds no newest.
  expect(contextLines(settled(0, { last: null }))).toEqual([CONTEXT_SET])
  expect(contextLines(settled(1, { last: null }))).toEqual([CONTEXT_SET])
})

test('the pane says when and why the mod\'s own compact command last failed, after the compaction line, with the reason cleaned and ended once', () => {
  const failed = { at: NOW - 3 * 60_000, reason: 'the compact command returned without a compaction' }
  const failure = 'The last compaction failed, 3m ago: the compact command returned without a compaction. It is tried again at the next turn end above the threshold.'
  const settled = (count: number, over: Partial<Compactions> = {}) => view({ context: measure(212_345, 300_000, 'settings'), compactions: compacted(count, over) })
  expect(contextLines(settled(0, { last: null, failed }))).toEqual([CONTEXT_SET, failure])
  expect(contextLines(settled(1, { failed }))).toEqual([CONTEXT_SET, 'Compacted once, 3m ago (manual), 115K to 16K.', failure])
  expect(contextLines(settled(0, { last: null, failed: { at: NOW - 45_000, reason: 'refused.\u001b[2J' } }))[1]).toBe('The last compaction failed, 45s ago: refused. It is tried again at the next turn end above the threshold.')
  expect(contextLines(settled(0, { last: null, failed: null }))).toEqual([CONTEXT_SET])
})

test('the settings hint is one line of the pane while the ceiling is the default and no compaction has stood, and never on the line above the prompt', () => {
  expect(contextLines(view({ context: measure() }))).toEqual(['Context: 212K of 300K (default)', SETTINGS_HINT])
  expect(contextLines(view({ context: measure(), compactions: compacted(0, { last: null }) }))).toEqual(['Context: 212K of 300K (default)', SETTINGS_HINT])
  expect(contextLines(view({ context: measure(212_345, 400_000, 'settings') }))).not.toContain(SETTINGS_HINT)
  expect(contextLines(view({ context: measure(212_345, 500_000, 'environment') }))).not.toContain(SETTINGS_HINT)
  expect(contextLines(view({ context: measure(null, 300_000, 'unreadable') }))).not.toContain(SETTINGS_HINT)
  expect(contextLines(view())).not.toContain(SETTINGS_HINT)
  expect(contextLines(view({ context: measure(), compactions: compacted(1) }))).toEqual(['Context: 212K of 300K (default)', 'Compacted once, 3m ago (manual), 115K to 16K.'])
  // The hint stays while only a failure is recorded, since no compaction has stood.
  const failed = { at: NOW - 3 * 60_000, reason: 'the compact command was refused' }
  expect(contextLines(view({ context: measure(), compactions: compacted(0, { last: null, failed }) })).at(-1)).toBe(SETTINGS_HINT)
  expect(abovePromptLine(view({ context: measure() }))).not.toContain('autoCompactWindow')
  expect(secondRow(view({ pr: null, nextLook: null, started: true, context: measure() }))).not.toContain('autoCompactWindow')
})
