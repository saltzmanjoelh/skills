import { expect, test } from 'claude-code/testing'

import {
  abstainerReason, afterAskAgain, afterTally, askAgainAnswer, askOrder, briefAnswer, briefFactsOf, briefRefusal, briefText, COUNSEL_KEPT, counselAnswer, decisionLine, destinationOf, endedDecisionLines,
  FOLLOW_UP_OPTIONS, FOLLOW_UP_PATTERNS, FOLLOW_UP_WORDS, followUpAnswer, followUpAskAgainAnswer, followUpOutcomes, followUpsRefusal, followUpStepOf, followUpTally, followUpVotesOf,
  keepCounsel, MAX_FOLLOW_UPS, MAX_OPTIONS, neededOf, neverStartedCandidatesOf, neverStartedOf, noOptionCount, QUOTE_CHARS, quoteVote, READABLE_FOLLOW_UP_VOTE, READABLE_VOTE, readVote, reviewParagraph, stepOf, tally, turnoutOf,
  votesOf, type WatchedState, WITHHELD_REASON, WITHHELD_VOTE,
} from '../hooks/counsel'
import type { AgentCard, CounselQuestion, CounselVote } from '../types'

const LEAN = 'LEAN-MARKER the session leans to a 90-second poll'

function question(over: Partial<CounselQuestion> = {}): CounselQuestion {
  return {
    id: 'c1',
    question: 'How often should the mod poll?',
    options: ['a 90-second poll', 'a 5-minute poll', 'only on events'],
    background: 'The pane goes stale between polls.',
    paths: ['docs/specs/poll.md'],
    lean: LEAN,
    folder: '/repo/.git/pilot/counsel/c1',
    round: 1,
    tallies: [],
    ...over,
  }
}

// The members by short name, in the counsel's order: the six reviewers, then
// the owner's advocate.
const MEMBERS = ['spec', 'adversarial', 'security', 'maintainability', 'performance', 'data', 'owners-advocate']
const fullName = (short: string) => (short === 'owners-advocate' ? `pilot:${short}` : `pilot:${short}-reviewer`)
const ADVOCATE = 'pilot:owners-advocate'
type Choice = CounselVote['vote']
const vote = (i: number, choice: Choice, newOption?: string): CounselVote => ({
  member: fullName(MEMBERS[i]!), vote: choice, reason: `reason of ${MEMBERS[i]}`, ...(newOption ? { newOption } : {}),
})
// Members vote in order; a missing entry is a member left out.
const votes = (choices: Choice[]) => choices.map((choice, i) => vote(i, choice))
const N = 'none'
const A = 'abstain'

test('four of seven for one option decides it, and three of seven does not', () => {
  const decided = tally(question(), votes([2, 2, 2, 2, 1, N, N]))
  expect(neededOf(7)).toBe(4)
  expect(decided.outcome).toBe('decided')
  expect(decided.chosen).toBe(2)
  expect(decided.counts).toEqual([1, 4, 0])

  const short = tally(question(), votes([2, 2, 2, 1, 1, N, N]))
  expect(short.outcome).toBe('ask')
  expect(short.chosen).toBeUndefined()
})

test('a split of four to three decides for the four', () => {
  const t = tally(question(), votes([1, 1, 1, 2, 2, 2, 1]))
  expect(t.outcome).toBe('decided')
  expect(t.chosen).toBe(1)
  expect(t.counts).toEqual([4, 3, 0])
  const line = decisionLine(afterTally(question(), t), t)
  expect(line).toBe('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.')
})

test('a tie at three and three with one vote for none and no proposal asks the person', () => {
  const t = tally(question(), votes([1, 1, 1, 2, 2, 2, N]))
  expect(t.outcome).toBe('ask')
  expect(t.counts).toEqual([3, 3, 0])
})

test('round one without a decision and with a proposal from a member who voted none reruns, keeping the numbers', () => {
  const q = question({ options: ['a', 'b', 'c', 'd'] })
  const t = tally(q, [
    vote(0, 1), vote(1, 1), vote(2, 2),
    vote(3, N, 'e'),
    vote(4, N, '  A '), // a repeat of an existing option once trimmed
    vote(5, N, 'f'),
    vote(6, 3),
  ])
  expect(t.outcome).toBe('rerun')
  expect(t.proposed).toEqual(['e', 'f'])
  const next = afterTally(q, t)
  expect(next.round).toBe(2)
  expect(next.options).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  expect(next.options.length).toBeLessThanOrEqual(MAX_OPTIONS)
})

test('proposals beyond six options are dropped, the earliest kept, and duplicates among them dropped', () => {
  const q = question({ options: ['a', 'b', 'c', 'd'] })
  const t = tally(q, [vote(0, N, 'x'), vote(1, N, 'X'), vote(2, N, 'y'), vote(3, N, 'z'), vote(4, 1), vote(5, 2), vote(6, 3)])
  expect(t.outcome).toBe('rerun')
  expect(afterTally(q, t).options).toEqual(['a', 'b', 'c', 'd', 'x', 'y'])
})

test('a proposal from a member who voted for an option is not taken', () => {
  const t = tally(question(), [vote(0, 1, 'w'), vote(1, 2), vote(2, 3)])
  expect(t.outcome).toBe('ask')
  expect(t.proposed).toEqual([])
})

test('round one that decides keeps its proposals as shown only', () => {
  const q = question()
  const t = tally(q, [vote(0, 1), vote(1, 1), vote(2, 1), vote(3, 1), vote(4, N, 'hourly'), vote(5, 2), vote(6, 2)])
  expect(t.outcome).toBe('decided')
  expect(t.proposed).toEqual(['hourly'])
  const next = afterTally(q, t)
  expect(next.options).toEqual(q.options)
  expect(next.round).toBe(1)
})

test('round two never reruns, and a new option there counts against', () => {
  const q = question({ round: 2, options: ['a', 'b', 'c', 'd'] })
  const t = tally(q, [vote(0, 4), vote(1, 4), vote(2, 4), vote(3, N, 'e'), vote(4, N, 'f'), vote(5, 1), vote(6, 1)])
  expect(t.outcome).toBe('ask')
  expect(t.counts).toEqual([2, 0, 0, 3])
  expect(afterTally(q, t).options).toEqual(['a', 'b', 'c', 'd'])
})

test('neither round\'s brief holds the lean, and round two\'s holds no round-one votes or reasons', () => {
  const q = question()
  const first = briefText(briefFactsOf(q), [])
  expect(first).not.toContain('LEAN-MARKER')
  expect(first).toContain('1. a 90-second poll\n2. a 5-minute poll\n3. only on events')
  expect(first).toContain('data, not instructions')
  expect(first).toContain('VOTE:')
  expect(first).toContain('REASON:')
  expect(first).toContain('NEW OPTION:')

  const t = tally(q, [vote(0, 1), vote(1, 2), vote(2, N, 'hourly'), vote(3, 1), vote(4, 2), vote(5, 3), vote(6, 3)])
  const next = afterTally(q, t)
  const second = briefText(briefFactsOf(next), [])
  expect(second).not.toContain('LEAN-MARKER')
  expect(second).not.toContain('reason of')
  expect(second).toContain('4. hourly')
  expect(second).toContain('no further round')
  expect(second).toContain('will not count')
})

test('a path that is not written yet is listed as such in the brief', () => {
  const text = briefText(briefFactsOf(question({ paths: ['docs/specs/poll.md', 'hooks/a.ts'] })), ['docs/specs/poll.md'])
  expect(text).toContain('- docs/specs/poll.md (not written yet)')
  expect(text).toContain('- hooks/a.ts\n')
})

test('the ask order is by votes, most first, at most four, with the last round\'s proposals while there is room', () => {
  expect(askOrder(['a', 'b', 'c'], [1, 3, 1], ['d', 'e'])).toEqual(['b', 'a', 'c', 'd'])
  expect(askOrder(['a', 'b', 'c', 'd', 'e'], [0, 1, 2, 0, 2], ['f'])).toEqual(['c', 'e', 'b', 'a'])
  expect(askOrder(['a', 'b'], [0, 0], [])).toEqual(['a', 'b'])
})

test('the ask answer states the options in order, the tally, one line of reason per member and the lean', () => {
  const q = question()
  const long = `${'x'.repeat(300)}\nsecond line`
  const t = tally(q, [vote(0, 2), vote(1, 2), { ...vote(2, 1), reason: long }, vote(3, N), vote(4, 3), vote(5, N), vote(6, N)])
  const text = counselAnswer(afterTally(q, t), t)
  expect(text).toContain('AskUserQuestion')
  expect(text.indexOf('1. a 5-minute poll')).toBeLessThan(text.indexOf('2. a 90-second poll'))
  expect(text).toContain('2 of 7')
  expect(text).toContain(LEAN)
  expect(text).toContain('reason of spec')
  expect(text).not.toContain('second line')
  expect(text).not.toContain('x'.repeat(201))
  expect(text).toContain('x'.repeat(200))
})

test('a reason is cut at a Unicode line separator, the way a vote is', () => {
  expect(abstainerReason({ member: 'pilot:data-reviewer', reason: 'first part\u2028second part' })).toBe('first part')
})

test('the decided answer names the option and the count, tells the session to use those words, and gives the spec line to record', () => {
  const q = question()
  const t = tally(q, [vote(0, 1), vote(1, 1), vote(2, 1), vote(3, 1), vote(4, 1), vote(5, 2), vote(6, 2)])
  const text = counselAnswer(afterTally(q, t), t)
  expect(text.split('\n')[0]).toBe('Decided: The counsel chose: a 90-second poll. 5 of 7 members voted for it. Go with that option, and tell the person in those words.')
  expect(text).toContain('Decided by the counsel')
  expect(text).toContain('- How often should the mod poll? The counsel chose: a 90-second poll. 5 of 7 members voted for it.')
})

test('the rerun answer says to launch all seven again with the brief, for round two', () => {
  const q = question()
  const t = tally(q, [vote(0, 1), vote(1, N, 'hourly'), vote(2, 2), vote(3, 2), vote(4, 3), vote(5, 1), vote(6, 3)])
  const text = counselAnswer(afterTally(q, t), t)
  expect(text).toContain('Counsel brief: /repo/.git/pilot/counsel/c1.')
  expect(text).toContain('round 2')
  expect(text).toContain('launch all seven members')
  for (const member of MEMBERS) expect(text).toContain(fullName(member))
  expect(text).toContain('call counsel_tally with id c1, round 2,')
  expect(text).toContain('Report every member, with an empty VOTE for a member that failed or was stopped')
})

test('a brief with fewer than two options, more than four, an empty question or a repeated option is refused', () => {
  expect(briefRefusal('Q?', ['a'])).not.toBeNull()
  expect(briefRefusal('Q?', ['a', 'b', 'c', 'd', 'e'])).not.toBeNull()
  expect(briefRefusal('  ', ['a', 'b'])).not.toBeNull()
  expect(briefRefusal('Q?', ['a', ' '])).not.toBeNull()
  expect(briefRefusal('Q?', ['a', 'A '])).not.toBeNull()
  expect(briefRefusal('Q?', ['a', 'b'])).toBeNull()
  expect(briefRefusal('Q?', ['a', 'b', 'c', 'd'])).toBeNull()
})

test('a tally naming an unknown member or one member twice is refused', () => {
  const q = question()
  const raw = (member: string, v = '1') => ({ member, vote: v, reason: 'r' })
  expect('refusal' in votesOf(q, 1, [raw('pilot:release-reviewer')])).toBe(true)
  expect('refusal' in votesOf(q, 1, [raw('pilot:spec-reviewer'), raw('spec-reviewer')])).toBe(true)
  // The prefix may be left off.
  const read = votesOf(q, 1, [raw('spec-reviewer'), raw('pilot:data-reviewer', 'none')])
  expect(read).toEqual({ votes: [
    { member: 'pilot:spec-reviewer', vote: 1, reason: 'r' },
    { member: 'pilot:data-reviewer', vote: 'none', reason: 'r' },
  ], unreadable: [] })
})

test('a tally with more than seven votes is refused', () => {
  const eight = [...MEMBERS, 'spec'].map(m => ({ member: fullName(m), vote: '1', reason: 'r' }))
  expect('refusal' in votesOf(question(), 1, eight)).toBe(true)
})

test('a vote naming option 0 or one past the last is refused', () => {
  const q = question()
  expect('refusal' in votesOf(q, 1, [{ member: 'pilot:spec-reviewer', vote: '0', reason: 'r' }])).toBe(true)
  expect('refusal' in votesOf(q, 1, [{ member: 'pilot:spec-reviewer', vote: '4', reason: 'r' }])).toBe(true)
  expect(readVote('4', 3)).toHaveProperty('refusal')
})

test('an option that does not exist is refused when it comes with a remark or is written as option N', () => {
  expect(readVote('7 (a remark)', 3)).toEqual({ refusal: 'option 7 does not exist; this round has options 1 to 3.' })
  expect(readVote('option 7', 3)).toEqual({ refusal: 'option 7 does not exist; this round has options 1 to 3.' })
  expect('refusal' in votesOf(question(), 1, [{ member: 'pilot:spec-reviewer', vote: '**option 4**', reason: 'r' }])).toBe(true)
})

test('a tally for a round the question does not wait on, or one already tallied, is refused', () => {
  const raw = [{ member: 'pilot:spec-reviewer', vote: '1', reason: 'r' }]
  expect(votesOf(question(), 2, raw)).toHaveProperty('refusal')
  const q = question()
  const t = tally(q, [vote(0, 1), vote(1, N, 'hourly'), vote(2, 2), vote(3, 2), vote(4, 3), vote(5, 1), vote(6, 3)])
  const second = afterTally(q, t)
  expect(String((votesOf(second, 1, raw) as { refusal: string }).refusal)).toContain('already tallied')
  expect(votesOf(second, 2, raw)).toHaveProperty('votes')
  const done = afterTally(second, tally(second, votes([1, 1, 1, 1, 2, N, N])))
  expect(String((votesOf(done, 2, raw) as { refusal: string }).refusal)).toContain('already tallied')
})

test('the review paragraph lists each decision with its option and count', () => {
  const q = question()
  const t = tally(q, votes([3, 3, 3, 3, 1, 2, N]))
  const text = reviewParagraph([decisionLine(afterTally(q, t), t)]) ?? ''
  expect(text).toContain('Decided by the counsel')
  expect(text).toContain('- How often should the mod poll? The counsel chose: only on events. 4 of 7 members voted for it.')
  expect(reviewParagraph([])).toBeNull()
})

test('the counsel keeps only the newest twenty questions, an older decision on a pull request included', () => {
  const pr = { repo: 'o/r', number: 7 }
  const q = question({ id: 'c1', pr })
  const decided = afterTally(q, tally(q, votes([1, 1, 1, 1, 2, N, N])))
  const list = [decided, ...Array.from({ length: 21 }, (_, i) => question({ id: `c${i + 2}` }))]
  const kept = keepCounsel(list)
  expect(COUNSEL_KEPT).toBe(20)
  expect(kept.length).toBe(20)
  expect(kept[0]?.id).toBe('c3')
  expect(kept.at(-1)?.id).toBe('c22')
})

// How votes are read. A member that abstains, a member left out and a member
// whose vote could not be read have no vote, and each is asked again rather
// than left out of the count.

const raw = (i: number, v: string, newOption?: string) => ({
  member: fullName(MEMBERS[i]!), vote: v, reason: `reason of ${MEMBERS[i]}`, ...(newOption ? { new_option: newOption } : {}),
})
const read = (q: CounselQuestion, round: 1 | 2, input: unknown[]) => {
  const result = votesOf(q, round, input)
  if ('refusal' in result) throw new Error(result.refusal)
  return result.votes
}

test('a vote is read from every form that plainly names one option, none or abstain, and from no other', () => {
  const readable: [string, CounselVote['vote']][] = [
    ['2', 2], ['2.', 2], ['2 .', 2], [' 3. ', 3], ['option 2', 2], ['Option 2', 2], ['option 2.', 2],
    ['**2**', 2], ['*2*', 2], ['__2__', 2], ['_2_', 2], ['**option 2**', 2], ['**2** (a 5-minute poll)', 2],
    ['2 (a 5-minute poll)', 2], ['2 (a 5-minute poll).', 2], ['2:', 2], ['2 (though 3 is close)', 2], ['2 (or-so)', 2],
    ['none .', 'none'], ['None.', 'none'], ['**none**', 'none'], ['*none*', 'none'],
    ['abstain', 'abstain'], ['Abstain.', 'abstain'], [' ABSTAIN ', 'abstain'], ['abstain .', 'abstain'],
  ]
  for (const [text, choice] of readable) expect([text, readVote(text, 3)]).toEqual([text, { vote: choice }])
  const unreadable: unknown[] = [
    '2 or 3', '2, 3', '2/3', 'not 2', 'two', 'option two', '2 - the poll is cheaper',
    '2 (or 3)', '2 ( Or 3 )', '2 (AND 3)', '2 (and 3)', '2 (or, 3)', '2 (and/or 3)', '2 (a) (b)', '2 (a) then 3', '(2)',
    '**2*', '***2***', '*__2__*', '2\nmore text', '', 'abstained', 'two, I think', undefined,
  ]
  for (const text of unreadable) expect([text, readVote(text, 3)]).toEqual([text, { unreadable: true }])
})

test('an unreadable vote is left out of the votes, like a member the session left out, and an abstention is kept with its reason', () => {
  const q = question()
  const votes = read(q, 1, [raw(0, '1'), raw(1, 'abstain'), raw(2, 'two, I think'), raw(3, '')])
  expect(votes).toEqual([
    { member: 'pilot:spec-reviewer', vote: 1, reason: 'reason of spec' },
    { member: 'pilot:adversarial-reviewer', vote: 'abstain', reason: 'reason of adversarial' },
  ])
  // An unreadable vote is still checked: naming its member twice is refused.
  expect(votesOf(q, 1, [raw(2, 'maybe'), raw(2, '1')])).toHaveProperty('refusal')
})

test('a member without a vote keeps the round from deciding, and seven votes decide at four', () => {
  const outcome = (choices: Choice[]) => tally(question(), votes(choices)).outcome
  expect(outcome([1, 1, 1, 1, 1, 1, A])).toBe('ask')
  // The six reviewers agreeing do not decide without the owner's advocate.
  expect(outcome([1, 1, 1, 1, 1, 1])).toBe('ask')
  expect(outcome([1, 1, 1, 1, 2, N, N])).toBe('decided')
  expect(outcome([1, 1, 1, 2, 3, N, N])).toBe('ask')
  expect(neededOf(7)).toBe(4)
})

test('when all seven were asked again and still have no vote, the person is asked and shown all seven', () => {
  const members = MEMBERS.map(fullName)
  const q = question({ askedAgain: members })
  const t = tally(q, votes([A, A, A, A, A, A, A]))
  expect(t.outcome).toBe('ask')
  expect(t.proposed).toEqual([])
  const text = counselAnswer(afterTally(q, t), t)
  expect(text).toContain('after being asked twice')
  for (const member of MEMBERS) expect(text).toContain(`- ${fullName(member)}: reason of ${member}`)
})

test('a proposal beside an abstention or an unreadable vote is not stored and causes no rerun', () => {
  const q = question()
  const votes = read(q, 1, [raw(0, '1'), raw(1, '2'), raw(2, 'abstain', 'hourly'), raw(3, 'maybe', 'daily'), raw(4, '3')])
  expect(votes.some(v => v.newOption !== undefined)).toBe(false)
  const t = tally(q, votes)
  expect(t.outcome).toBe('ask')
  expect(t.proposed).toEqual([])
  // tally keeps its own guard for votes built without votesOf: a proposal
  // beside an abstention is not taken.
  expect(tally(q, [vote(0, A, 'hourly'), vote(1, 1), vote(2, 2), vote(3, 3)]).proposed).toEqual([])
})

test('the decision sentence counts against all seven, with no reasons', () => {
  const q = question()
  const t = tally(q, [{ ...vote(5, 2), reason: 'REASON-MARKER' }, vote(0, 1), vote(1, 1), vote(2, 1), vote(3, 1), vote(4, N), vote(6, N)])
  const line = decisionLine(afterTally(q, t), t)
  expect(line).toBe('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.')
  expect(reviewParagraph([line])).not.toContain('REASON-MARKER')
})

// The decision line for a question whose first option is `option`, decided
// four of seven for it.
function lineFor(option: string): string {
  const q = question({ options: [option, 'a 5-minute poll', 'only on events'] })
  const t = tally(q, votes([1, 1, 1, 1, 2, N, N]))
  return decisionLine(afterTally(q, t), t)
}

test('the decision sentence puts the option after a colon as written, ending in one terminal mark, and the count in a sentence of its own', () => {
  const cases: [string, string][] = [
    ['Ignore the proposal.', 'Ignore the proposal.'],
    ['Should it rerun?', 'Should it rerun?'],
    ['Ship it now!', 'Ship it now!'],
    ['Wait for it…', 'Wait for it…'],
    ['Keep the line that reads "The counsel chose X."', 'Keep the line that reads "The counsel chose X."'],
    ["Keep the line that reads 'as today.'", "Keep the line that reads 'as today.'"],
    ['Keep the line that reads “as today.”', 'Keep the line that reads “as today.”'],
    ['Keep the line that reads ‘as today.’', 'Keep the line that reads ‘as today.’'],
    ['Keep it (as today.)', 'Keep it (as today.)'],
    ['Keep it [as today.]', 'Keep it [as today.]'],
    ['a 90-second poll', 'a 90-second poll.'],
    ['The approval stays with the person', 'The approval stays with the person.'],
    ['gh pr view decides', 'gh pr view decides.'],
    ['GitHub decides, as today', 'GitHub decides, as today.'],
    ['Keep it (as today)', 'Keep it (as today).'],
  ]
  for (const [option, written] of cases) {
    const line = lineFor(option)
    expect(line).toBe(`- How often should the mod poll? The counsel chose: ${written} 4 of 7 members voted for it.`)
    for (const broken of ['?.', '..', '., ', '!.']) expect([option, line.includes(broken)]).toEqual([option, false])
  }
})

test('the ask answer lists the members without a vote apart from the votes, with their reasons or no readable vote', () => {
  const q = question({ askedAgain: ['pilot:maintainability-reviewer', 'pilot:performance-reviewer', 'pilot:data-reviewer'] })
  const votes = read(q, 1, [
    { ...raw(0, '2'), reason: 'A whole sentence.' }, raw(1, '1'), raw(2, 'none'), { ...raw(3, 'abstain'), reason: 'Outside my angle.\nsecond line' },
    { ...raw(4, 'abstain'), reason: '' }, { ...raw(5, '??'), reason: 'UNREAD-MARKER' },
  ])
  const t = tally(q, votes)
  expect(t.outcome).toBe('ask')
  const text = counselAnswer(afterTally(q, t), t)
  expect(text).toContain('pilot:maintainability-reviewer, pilot:performance-reviewer and pilot:data-reviewer gave no vote in round 1 after being asked twice')
  expect(text).toContain('Tally: a 90-second poll 1 of 3, a 5-minute poll 1 of 3, only on events 0 of 3, no option 1 of 3.')
  const [took, without] = text.split('Without a vote:')
  // Each reason ends in one full stop, whether or not the member wrote one.
  expect(took).toContain('- pilot:spec-reviewer, for a 5-minute poll: A whole sentence.\n')
  expect(took).toContain('- pilot:adversarial-reviewer, for a 90-second poll: reason of adversarial.\n')
  expect(took).toContain('- pilot:security-reviewer, for no option: reason of security')
  expect(took).not.toContain('- pilot:maintainability')
  expect(without).toContain('- pilot:maintainability-reviewer: Outside my angle.\n')
  // An abstention with no reason is still told apart from no readable vote.
  expect(without).toContain('- pilot:performance-reviewer: no reason given.')
  expect(without).toContain('- pilot:data-reviewer: no readable vote.')
  expect(text).not.toContain('second line')
  expect(text).not.toContain('UNREAD-MARKER')
})

test('turnout lists both groups in member order, and a null kept from before abstentions reads as none', () => {
  const old = { member: 'pilot:security-reviewer', vote: null, reason: 'old none' } as unknown as CounselVote
  const t = { votes: [vote(6, N), vote(5, 2), old, vote(1, N), vote(0, 1), vote(3, A)] }
  const { took, abstained } = turnoutOf(t)
  expect(took.map(v => [v.member, v.vote])).toEqual([
    ['pilot:spec-reviewer', 1], ['pilot:adversarial-reviewer', 'none'], ['pilot:security-reviewer', 'none'], ['pilot:data-reviewer', 2], [ADVOCATE, 'none'],
  ])
  expect(abstained).toEqual([
    { member: 'pilot:maintainability-reviewer', reason: 'reason of maintainability' },
    { member: 'pilot:performance-reviewer', reason: null },
  ])
  expect(noOptionCount({ votes: t.votes })).toBe(3)
})

// Every member votes: a member without a vote is asked again once
// in each round, and a second time without a vote sends the question to the
// person.

const DATA = 'pilot:data-reviewer'
// Every member but the data reviewer, each voting for option 1.
const othersFor1 = [raw(0, '1'), raw(1, '1'), raw(2, '1'), raw(3, '1'), raw(4, '1'), raw(6, '1')]
const stepFor = (q: CounselQuestion, input: unknown[]) => stepOf(q, read(q, q.round, input))

test('a member that abstains, gives an unreadable vote or is left out has no vote, and the round is asked again for it', () => {
  // The question has no askedAgain field, as one stored before this change.
  for (const input of [[...othersFor1, raw(5, 'abstain')], [...othersFor1, raw(5, 'two, I think')], othersFor1]) {
    expect(stepFor(question(), input)).toEqual({ askAgain: [DATA] })
  }
})

test('the owner\'s advocate is a member: the six reviewers alone are not counted, and the advocate is asked again', () => {
  const six = [raw(0, '1'), raw(1, '1'), raw(2, '1'), raw(3, '1'), raw(4, '1'), raw(5, '1')]
  expect(stepFor(question(), six)).toEqual({ askAgain: [ADVOCATE] })
  expect(read(question(), 1, [raw(6, '2')])).toEqual([{ member: ADVOCATE, vote: 2, reason: 'reason of owners-advocate' }])
  // The plugin's prefix may be left off the advocate's name too.
  expect(read(question(), 1, [{ member: 'owners-advocate', vote: 'none', reason: 'r' }])).toEqual([{ member: ADVOCATE, vote: 'none', reason: 'r' }])
})

test('every member without a vote is asked again together, in member order', () => {
  expect(stepFor(question(), [raw(5, '1'), raw(0, 'abstain'), raw(1, '1'), raw(2, '1'), raw(6, '1')])).toEqual({
    askAgain: ['pilot:spec-reviewer', 'pilot:maintainability-reviewer', 'pilot:performance-reviewer'],
  })
})

test('seven votes are counted as usual: four of seven decides', () => {
  const step = stepFor(question({ askedAgain: [DATA] }), [raw(0, '1'), raw(1, '1'), raw(2, '1'), raw(3, '2'), raw(4, 'none'), raw(5, '1'), raw(6, '2')])
  if (!('tally' in step)) throw new Error('expected a tally')
  expect(step.tally.outcome).toBe('decided')
  expect(step.tally.counts).toEqual([4, 2, 0])
})

test('a member asked again that still has no vote sends the question to the person, even when the other six agree', () => {
  const q = question({ askedAgain: [DATA] })
  const step = stepFor(q, othersFor1)
  if (!('tally' in step)) throw new Error('expected a tally')
  expect(step.tally.outcome).toBe('ask')
  expect(step.tally.chosen).toBeUndefined()
  const text = counselAnswer(afterTally(q, step.tally), step.tally)
  expect(text).toContain('Ask the person: pilot:data-reviewer gave no vote in round 1 after being asked twice, so the counsel cannot decide.')
  expect(text).toContain('Without a vote:\n- pilot:data-reviewer: no readable vote.')
})

test('a member asked again that still has no vote sends the question to the person even when a none voter proposed an option', () => {
  const q = question({ askedAgain: [DATA] })
  const step = stepFor(q, [raw(0, '1'), raw(1, '1'), raw(2, '2'), raw(3, 'none', 'hourly'), raw(4, '2'), raw(6, '3')])
  if (!('tally' in step)) throw new Error('expected a tally')
  expect(step.tally.outcome).toBe('ask')
  expect(afterTally(q, step.tally).round).toBe(1)
})

test('when one member misses its second chance and another misses its first, only the first is named as asked twice', () => {
  const q = question({ askedAgain: [DATA] })
  const step = stepFor(q, othersFor1.filter((_, i) => i !== 2))
  if (!('tally' in step)) throw new Error('expected a tally')
  expect(step.tally.outcome).toBe('ask')
  const text = counselAnswer(afterTally(q, step.tally), step.tally)
  const [first, rest] = [text.split('\n')[0], text.split('Without a vote:')[1] ?? '']
  expect(first).toBe('Ask the person: pilot:data-reviewer gave no vote in round 1 after being asked twice, so the counsel cannot decide.')
  expect(rest).toContain('- pilot:security-reviewer: no readable vote.')
  expect(rest).toContain('- pilot:data-reviewer: no readable vote.')
})

test('a different member without a vote on the second tally is asked again, not sent to the person', () => {
  const step = stepFor(question({ askedAgain: [DATA] }), [raw(0, '1'), raw(1, '1'), raw(2, '1'), raw(3, '1'), raw(5, '1'), raw(6, '1')])
  expect(step).toEqual({ askAgain: ['pilot:performance-reviewer'] })
})

test('a rerun empties the members asked again, so round two gives each member a second chance of its own', () => {
  const q = question({ askedAgain: [DATA] })
  const step = stepFor(q, [raw(0, '1'), raw(1, '1'), raw(2, '2'), raw(3, 'none', 'hourly'), raw(4, '2'), raw(5, '2'), raw(6, '3')])
  if (!('tally' in step)) throw new Error('expected a tally')
  expect(step.tally.outcome).toBe('rerun')
  const second = afterTally(q, step.tally)
  expect(second.askedAgain).toEqual([])
  expect(stepFor(second, othersFor1)).toEqual({ askAgain: [DATA] })
})

test('the refusal names the members, says to launch exactly them again with the same brief and to tally with every vote', () => {
  const text = askAgainAnswer(question(), ['pilot:security-reviewer', DATA])
  expect(text).toContain('Refused: round 1 of c1 is not counted, because every member votes and pilot:security-reviewer and pilot:data-reviewer gave no vote.')
  expect(text).toContain('launch exactly these members again, each with the prompt "Counsel brief: /repo/.git/pilot/counsel/c1.": pilot:security-reviewer, pilot:data-reviewer.')
  expect(text).not.toContain('pilot:spec-reviewer')
  expect(text).toContain('call counsel_tally again with id c1, round 1,')
  expect(text).toContain('asked twice')
  expect(text).not.toContain('Nothing was recorded')
  // With no unreadable vote, nothing is quoted and the readable form is not
  // explained. The launch line quotes the prompt, so the test looks for the
  // list of quotes rather than for any quotation mark.
  expect(text).not.toContain('could not be read:')
  expect(text).not.toContain(READABLE_VOTE)
  expect(askAgainAnswer(question(), [DATA])).toContain('Launch exactly this member again, with the prompt')
})

test('the brief offers an option or none, never abstain, in both rounds, and says to vote none when only the person can answer', () => {
  const q = question()
  for (const text of [briefText(briefFactsOf(q), []), briefText(briefFactsOf({ ...q, round: 2 }), [])]) {
    expect(text).toContain('VOTE: <number|none>')
    expect(text).not.toMatch(/abstain/i)
    expect(text).toContain('only the person can answer')
  }
})

test('the counsel and rerun answers say to report every member, and no longer to leave one out', () => {
  const q = question()
  const t = tally(q, [vote(0, 1), vote(1, 1), vote(2, 2), vote(3, N, 'hourly'), vote(4, 2), vote(5, 3), vote(6, 3)])
  for (const text of [briefAnswer(q), counselAnswer(afterTally(q, t), t)]) {
    expect(text).not.toMatch(/leave out|left out|abstain/i)
    expect(text).toContain('Report every member')
  }
})

test('asking members again adds them to the members asked again, starting from none on a question stored without the list', () => {
  const once = afterAskAgain(question(), [DATA])
  expect(once.askedAgain).toEqual([DATA])
  expect(once.tallies).toEqual([])
  expect(afterAskAgain(once, ['pilot:security-reviewer']).askedAgain).toEqual([DATA, 'pilot:security-reviewer'])
})

// How a vote that cannot be read is shown. Its text is quoted in the answer
// the tally writes and is kept nowhere else.

const SECURITY = 'pilot:security-reviewer'
const unreadableOf = (q: CounselQuestion, input: unknown[]) => {
  const result = votesOf(q, q.round, input)
  if ('refusal' in result) throw new Error(result.refusal)
  return result.unreadable
}

test('votesOf keeps the raw text of each unreadable vote that is not empty, with its case, and nothing for a readable one', () => {
  const input = [raw(0, '1'), raw(1, ' UNREAD-Marker 2 or 3 '), raw(2, ''), raw(3, ' . '), raw(4, 'abstain')]
  expect(unreadableOf(question(), input)).toEqual([{ member: 'pilot:adversarial-reviewer', text: ' UNREAD-Marker 2 or 3 ' }])
})

test('a vote is quoted by its first line, trimmed, in double quotation marks, and cut to eighty characters with the ellipsis', () => {
  expect(QUOTE_CHARS).toBe(80)
  expect(quoteVote('  2 or 3  ')).toBe('"2 or 3"')
  expect(quoteVote(' 2 or 3\nsecond line')).toBe('"2 or 3"')
  expect(quoteVote('2 or 3\r\nsecond')).toBe('"2 or 3"')
  expect(quoteVote('2 or 3\u2028second')).toBe('"2 or 3"')
  expect(quoteVote('2\tor\u00073')).toBe('"2 or 3"')
  const long = quoteVote('y'.repeat(100))
  expect(long).toBe(`"${'y'.repeat(79)}…"`)
  expect([...long.slice(1, -1)].length).toBe(80)
  expect(quoteVote('y'.repeat(80))).toBe(`"${'y'.repeat(80)}"`)
})

test('a vote that looks like it holds a secret anywhere in its text is withheld, even past its first line and its eightieth character', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  expect(WITHHELD_VOTE).toBe('its text was withheld because it looks like a secret')
  expect(quoteVote(`2 or 3\n${'z'.repeat(90)} ${key}`)).toBe(WITHHELD_VOTE)
  const text = askAgainAnswer(question(), [DATA], [{ member: DATA, text: `2 or 3\n${'z'.repeat(90)} ${key}` }])
  expect(text).toContain(`- ${DATA}: ${WITHHELD_VOTE}.`)
  expect(text).not.toContain(key)
})

test('the refusal quotes each unreadable vote in member order and says once what a readable vote looks like', () => {
  expect(READABLE_VOTE).toBe('A readable vote is an option\'s number, alone or as option N, optionally followed by one remark in brackets, or none.')
  const q = question()
  const unreadable = unreadableOf(q, [raw(0, '1'), raw(1, '1'), raw(2, 'UNREAD-MARKER 2 or 3'), raw(3, ''), raw(5, 'two')])
  const text = askAgainAnswer(q, [SECURITY, 'pilot:maintainability-reviewer', 'pilot:performance-reviewer', DATA], unreadable)
  const lines = text.split('\n')
  const start = lines.indexOf('These votes could not be read:')
  expect(start).toBe(1)
  expect(lines.slice(start + 1, start + 3)).toEqual([`- ${SECURITY}: "UNREAD-MARKER 2 or 3".`, `- ${DATA}: "two".`])
  expect(text.split(READABLE_VOTE).length).toBe(2)
  // An empty vote and a member left out are named as before, with no quote.
  expect(text).not.toMatch(/maintainability-reviewer: "|performance-reviewer: "/)
  expect(lines[0]).toContain('pilot:maintainability-reviewer, pilot:performance-reviewer')
})

test('the answer that asks the person quotes an unreadable vote in place of no readable vote, and keeps it for a member left out', () => {
  const q = question({ askedAgain: [SECURITY, DATA] })
  const input = [raw(0, '1'), raw(1, '1'), raw(2, 'SECOND-MARKER 2 or 3'), raw(3, '1'), { ...raw(4, 'abstain'), reason: 'Outside my angle.' }]
  const t = tally(q, read(q, 1, input))
  const text = counselAnswer(afterTally(q, t), t, unreadableOf(q, input))
  const without = text.split('Without a vote:')[1] ?? ''
  expect(without).toContain(`- ${SECURITY}: "SECOND-MARKER 2 or 3".`)
  expect(without).toContain('- pilot:performance-reviewer: Outside my angle.')
  expect(without).toContain(`- ${DATA}: no readable vote.`)
  // The same tally without the quotes is the answer as it was.
  expect(counselAnswer(afterTally(q, t), t)).toContain(`- ${SECURITY}: no readable vote.`)
})

// Which members never started: asked again, still without a vote, and with
// no agent of their type started since the members were last launched.

const LAUNCHED = 1_000
const card = (type: string, startedAt: number, status: AgentCard['status'] = 'completed'): AgentCard => ({ id: `${type}-${startedAt}`, type, description: 'counsel', status, startedAt })
// The six reviewers, each voting for option 1, with the advocate left out.
const sixFor1 = [raw(0, '1'), raw(1, '1'), raw(2, '1'), raw(3, '1'), raw(4, '1'), raw(5, '1')]
const neverStartedFor = (q: CounselQuestion, input: unknown[], cards: AgentCard[]) => {
  const result = votesOf(q, q.round, input)
  if ('refusal' in result) throw new Error(result.refusal)
  const t = tally(q, result.votes)
  return neverStartedOf(q, t, result.unreadable, cards)
}

test('a member asked again without a vote never started when no agent of its type started at or after the launch', () => {
  const q = question({ askedAgain: [ADVOCATE], launchedAt: LAUNCHED })
  expect(neverStartedFor(q, sixFor1, [])).toEqual([ADVOCATE])
  expect(neverStartedFor(q, sixFor1, [card(ADVOCATE, LAUNCHED)])).toEqual([])
  // An agent that started and failed did start.
  expect(neverStartedFor(q, sixFor1, [card(ADVOCATE, LAUNCHED + 500, 'failed')])).toEqual([])
  expect(neverStartedFor(q, sixFor1, [card(ADVOCATE, LAUNCHED - 1)])).toEqual([ADVOCATE])
  // Another member's agent does not count for the advocate.
  expect(neverStartedFor(q, sixFor1, [card(DATA, LAUNCHED + 1)])).toEqual([ADVOCATE])
  const result = votesOf(q, 1, sixFor1)
  if ('refusal' in result) throw new Error(result.refusal)
  expect(neverStartedCandidatesOf(q, tally(q, result.votes), result.unreadable)).toEqual([ADVOCATE])
})

test('an abstainer, a member with an unreadable vote and a member left out but not asked again are never named as never started', () => {
  const q = question({ askedAgain: [ADVOCATE], launchedAt: LAUNCHED })
  expect(neverStartedFor(q, [...sixFor1, raw(6, 'abstain')], [])).toEqual([])
  expect(neverStartedFor(q, [...sixFor1, raw(6, 'two, I think')], [])).toEqual([])
  // The security reviewer is left out for the first time, so only the data
  // reviewer, asked again, can be named.
  const asked = question({ askedAgain: [DATA], launchedAt: LAUNCHED })
  expect(neverStartedFor(asked, othersFor1.filter((_, i) => i !== 2), [])).toEqual([DATA])
})

test('a question without a launch time, a round where all seven voted and a decided round name nobody as never started', () => {
  expect(neverStartedFor(question({ askedAgain: [ADVOCATE] }), sixFor1, [])).toEqual([])
  const all = question({ askedAgain: [ADVOCATE], launchedAt: LAUNCHED })
  expect(neverStartedFor(all, [raw(0, '1'), raw(1, '1'), raw(2, '1'), raw(3, '2'), raw(4, '2'), raw(5, '2'), raw(6, 'none')], [])).toEqual([])
  expect(neverStartedFor(all, [...sixFor1, raw(6, '1')], [])).toEqual([])
})

const opening = (names: string) => `Open the question with this sentence: ${names} never started in this session, even after being asked again.`
const ifNotFound = (member: string) =>
  `If the Agent tool answered your launch of ${member} with an error saying that its agent type was not found, add this sentence after the opening sentence: "A session started before ${member} joined the counsel cannot launch it, and restarting the session lets the counsel decide again." If the Agent tool answered in any other way, add nothing for ${member}, so that the question says only that it never started.`

test('the answer that asks the person names a member that never started, says when to add the restart, and lists it as never started', () => {
  const q = question({ askedAgain: [ADVOCATE], launchedAt: LAUNCHED })
  const t = tally(q, read(q, 1, sixFor1))
  const lines = counselAnswer(afterTally(q, t), t, [], [ADVOCATE]).split('\n')
  const at = lines.indexOf(opening(ADVOCATE))
  // After the numbered options and before the line about what the question states.
  expect(lines[at - 1]).toMatch(/^\d\. /)
  expect(lines[at + 1]).toBe(ifNotFound(ADVOCATE))
  expect(lines[at + 2]).toMatch(/^In the question, state the tally/)
  expect(lines).toContain(`- ${ADVOCATE}: never started in this session.`)
  expect(lines.join('\n')).not.toContain(`${ADVOCATE}: no readable vote`)
})

test('two members that never started are named together in member order, each with its own line about the restart', () => {
  const q = question({ askedAgain: [DATA, ADVOCATE], launchedAt: LAUNCHED })
  const t = tally(q, read(q, 1, sixFor1.slice(0, 5)))
  const text = counselAnswer(afterTally(q, t), t, [], [DATA, ADVOCATE])
  expect(text).toContain(`${opening(`${DATA} and ${ADVOCATE}`)}\n${ifNotFound(DATA)}\n${ifNotFound(ADVOCATE)}\n`)
  expect(text).toContain(`Without a vote:\n- ${DATA}: never started in this session.\n- ${ADVOCATE}: never started in this session.`)
})

test('with no member that never started, or a name given for an abstainer, the answer that asks the person is unchanged', () => {
  const q = question({ askedAgain: [DATA], launchedAt: LAUNCHED })
  const t = tally(q, read(q, 1, othersFor1))
  expect(counselAnswer(afterTally(q, t), t, [], [])).toBe(counselAnswer(afterTally(q, t), t))
  const abstained = tally(q, read(q, 1, [...othersFor1, raw(5, 'abstain')]))
  expect(counselAnswer(afterTally(q, abstained), abstained, [], [DATA])).toBe(counselAnswer(afterTally(q, abstained), abstained))
})

test('the answer that asks members again never mentions a member that never started or a restart', () => {
  for (const text of [askAgainAnswer(question(), [ADVOCATE]), askAgainAnswer(question(), [DATA, ADVOCATE], [{ member: DATA, text: 'two' }])]) {
    expect(text).not.toMatch(/never started|restart/i)
  }
})

// Where a decision goes: the spec, unless the session names the watched pull
// request while it is open.

test('a decision goes to the spec without pull_request, and to the watched pull request only when it is named and open', () => {
  const watched = { repo: 'o/r', number: 7 }
  expect(destinationOf(undefined, null, null)).toEqual({ owedTo: null })
  expect(destinationOf(undefined, watched, 'OPEN')).toEqual({ owedTo: null })
  expect(destinationOf(7, watched, 'OPEN')).toEqual({ owedTo: watched })

  const refusalOf = (named: unknown, w: typeof watched | null, state: WatchedState) => {
    const result = destinationOf(named, w, state)
    if (!('refusal' in result)) throw new Error(`${String(named)} was not refused`)
    return result.refusal
  }
  const spec = 'Call counsel again without pull_request to record the decision in the spec'
  const done = 'No brief was written and nothing was recorded.'
  const cases: [unknown, typeof watched | null, WatchedState, string, boolean][] = [
    [7, null, null, 'Nothing is watched.', false],
    [8, watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [7, watched, 'MERGED', 'o/r#7 is watched, and its last known state is merged.', false],
    [7, watched, 'CLOSED', 'o/r#7 is watched, and its last known state is closed.', false],
    [7, watched, null, 'o/r#7 is watched, and its state is not known yet.', false],
    ['7', watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [7.5, watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [0, watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [-1, watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [null, watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [2 ** 53, watched, 'OPEN', 'o/r#7 is watched, and its last known state is open.', true],
    [12, null, null, 'Nothing is watched.', false],
  ]
  for (const [named, w, state, what, offersNumber] of cases) {
    const text = refusalOf(named, w, state)
    expect([named, text.includes(what)]).toEqual([named, true])
    expect([named, text.includes(spec)]).toEqual([named, true])
    expect([named, text.includes('with pull_request 7')]).toEqual([named, offersNumber])
    expect([named, text.endsWith(done)]).toEqual([named, true])
  }
  // No refusal repeats the value it was given.
  for (const named of [8, 12, 7.5, '7.5', 0, -1, 2 ** 53]) {
    expect([named, refusalOf(named, watched, 'OPEN').includes(String(named))]).toEqual([named, false])
  }
  expect(refusalOf(12, null, null)).not.toContain('12')
})

test('the decided answer for a question owed to a pull request follows that pull request\'s state at the tally', () => {
  const q = { ...question(), pr: { repo: 'o/r', number: 7 } }
  const t = tally(q, votes([1, 1, 1, 1, 2, N, N]))
  const recorded = afterTally(q, t)
  const line = '- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.'
  const spec = `Record it in the spec, under a section headed "Decided by the counsel", as this line:\n${line}`

  const open = counselAnswer(recorded, t, [], [], 'OPEN')
  expect(open).toContain('The mod lists this decision in the next review it posts on o/r#7.')
  expect(open).not.toContain('Record it in the spec')
  expect(counselAnswer(recorded, t)).toBe(open)

  const merged = counselAnswer(recorded, t, [], [], 'MERGED')
  expect(merged).toContain(`o/r#7 merged before the tally, so no review will list this decision.\n${spec}`)
  expect(merged).not.toContain('next review')
  const closed = counselAnswer(recorded, t, [], [], 'CLOSED')
  expect(closed).toContain(`o/r#7 closed before the tally, so no review will list this decision.\n${spec}`)
  const unread = counselAnswer(recorded, t, [], [], null)
  expect(unread).toContain(`The state of o/r#7 could not be read at the tally, so no review will list this decision.\n${spec}`)
  expect(unread).not.toMatch(/merged|closed/)

  // Without a pull request the state is not read, and the answer is the same
  // spec instruction whatever is passed.
  const unowed = afterTally(question(), t)
  expect(counselAnswer(unowed, t, [], [], 'MERGED')).toBe(counselAnswer(unowed, t))
  expect(counselAnswer(unowed, t)).toContain(spec)
})

test('the decided answer says to record a decision in the spec when the question is owed to no pull request', () => {
  const q = question()
  const t = tally(q, votes([1, 1, 1, 1, 2, N, N]))
  expect(counselAnswer(afterTally(q, t), t)).toContain('Record it in the spec')
  expect(counselAnswer(afterTally({ ...q, pr: { repo: 'o/r', number: 7 } }, t), t)).toContain('The mod lists this decision in the next review it posts on o/r#7.')
})

// A follow-ups question with three follow-ups, as the counsel tool records it.
const FOLLOW_UPS = ['The pane cuts long agent names.', 'The poll logs every look twice.', 'A retry message has a typo.']
function followUpsQuestion(over: Partial<CounselQuestion> = {}): CounselQuestion {
  return question({ question: 'What happens to each follow-up of this round?', options: [...FOLLOW_UP_OPTIONS], followUps: FOLLOW_UPS, ...over })
}
// One member's follow-up votes as the session reports them: one vote per
// follow-up in order, undefined leaving that follow-up out.
const followUpRaw = (i: number, words: (string | undefined)[]) => ({
  member: fullName(MEMBERS[i]!),
  follow_ups: words.flatMap((v, n) => (v === undefined ? [] : [{ number: n + 1, vote: v, reason: `reason of ${MEMBERS[i]} on ${n + 1}` }])),
})
// Every member's follow-up votes, member i voting column i of each row: one
// row per follow-up.
const followUpRaws = (rows: (string | undefined)[][]) => MEMBERS.map((_, i) => followUpRaw(i, rows.map(row => row[i])))
const followUpRead = (q: CounselQuestion, input: unknown[]) => {
  const read = followUpVotesOf(q, 1, input)
  if ('refusal' in read) throw new Error(read.refusal)
  return read
}

test('a follow-ups brief numbers the follow-ups, gives the three options once, asks for one vote and one reason per follow-up, and holds no lean or new option', () => {
  expect(FOLLOW_UP_OPTIONS).toEqual(['fix it in this pull request', 'file it as an issue', 'drop it'])
  expect(FOLLOW_UP_WORDS).toEqual(['fix', 'file', 'drop'])
  const text = briefText(briefFactsOf(followUpsQuestion()), [])
  expect(text).toContain('What happens to each follow-up of this round?')
  expect(text).toContain('The pane goes stale between polls.')
  expect(text).toContain('- docs/specs/poll.md')
  expect(text).toContain('1. The pane cuts long agent names.\n2. The poll logs every look twice.\n3. A retry message has a typo.')
  expect(text.split('1. fix it in this pull request').length).toBe(2)
  expect(text).toContain('2. file it as an issue')
  expect(text).toContain('3. drop it')
  for (const n of [1, 2, 3]) {
    expect(text).toContain(`VOTE ${n}: <fix|file|drop|none>\nREASON ${n}: <one sentence>`)
  }
  expect(text).not.toContain('VOTE 4')
  expect(text).not.toContain('NEW OPTION')
  expect(text).not.toContain('round 2')
  expect(text).not.toContain('LEAN-MARKER')
  // The follow-ups come after the question and the background.
  expect(text.indexOf('The pane goes stale')).toBeLessThan(text.indexOf('1. The pane cuts long agent names.'))
  expect(briefAnswer(followUpsQuestion())).toContain('follow_ups')
  expect(briefAnswer(followUpsQuestion())).not.toContain('NEW OPTION')
})

test('a follow-ups call with options, an empty list, more than twenty follow-ups, a blank one, two that say the same thing, or pull_request is refused, and twenty are accepted', () => {
  const twenty = Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => `follow-up ${i + 1}`)
  expect(MAX_FOLLOW_UPS).toBe(20)
  expect(followUpsRefusal('Q?', twenty, undefined, undefined)).toBeNull()
  expect(followUpsRefusal('Q?', ['one'], undefined, undefined)).toBeNull()
  expect(followUpsRefusal('Q?', ['one'], ['a', 'b'], undefined)).toContain('options')
  expect(followUpsRefusal('Q?', [], undefined, undefined)).toContain('empty')
  expect(followUpsRefusal('Q?', [...twenty, 'one more'], undefined, undefined)).toContain('21')
  expect(followUpsRefusal('Q?', ['one', '  '], undefined, undefined)).not.toBeNull()
  expect(followUpsRefusal('Q?', ['one', 7], undefined, undefined)).not.toBeNull()
  expect(followUpsRefusal('Q?', ['The poll logs twice.', '  the POLL logs twice. '], undefined, undefined)).toContain('same thing')
  expect(followUpsRefusal('Q?', 'one', undefined, undefined)).not.toBeNull()
  expect(followUpsRefusal('Q?', ['one'], undefined, 7)).toContain('pull_request')
  expect(followUpsRefusal('  ', ['one'], undefined, undefined)).toContain('question')
})

test('the follow-up words are read with emphasis and remarks as their options, and an ordinary question does not read them', () => {
  const read = (text: string) => readVote(text, 3, FOLLOW_UP_PATTERNS)
  expect(read('fix')).toEqual({ vote: 1 })
  expect(read('File.')).toEqual({ vote: 2 })
  expect(read('**drop**')).toEqual({ vote: 3 })
  expect(read('_file_ (cheap enough)')).toEqual({ vote: 2 })
  expect(read('2')).toEqual({ vote: 2 })
  expect(read('none')).toEqual({ vote: 'none' })
  expect(read('abstain')).toEqual({ vote: 'abstain' })
  expect(read('fix (or file)')).toEqual({ unreadable: true })
  expect(read('fixed')).toEqual({ unreadable: true })
  expect(read('fix it')).toEqual({ unreadable: true })
  expect(read('**fix*')).toEqual({ unreadable: true })
  expect(read('4')).toEqual({ refusal: 'option 4 does not exist; this round has options 1 to 3.' })
  // Without the words, as on an ordinary question, they are not votes.
  expect(readVote('fix', 3)).toEqual({ unreadable: true })
  expect(readVote('**2**', 3)).toEqual({ vote: 2 })
})

test('seven members over three follow-ups decide each on its own: file at 4 of 7, drop at 5 of 7, and a 3, 3 and 1 split undecided', () => {
  const q = followUpsQuestion()
  const read = followUpRead(q, followUpRaws([
    ['file', 'file', 'file', 'file', 'fix', 'drop', 'none'],
    ['drop', 'drop', '3', 'drop', 'drop', 'file', 'file'],
    ['drop', 'drop', 'drop', 'file', 'file', 'file', 'fix'],
  ]))
  const step = followUpStepOf(q, read.followUps)
  if (!('tally' in step)) throw new Error('the round was not counted')
  const t = step.tally
  expect(neededOf(7)).toBe(4)
  expect(t.outcome).toBe('counted')
  expect(t.votes).toEqual([])
  expect(t.counts).toEqual([])
  expect(t.proposed).toEqual([])
  expect(t.followUps?.map(f => f.counts)).toEqual([[1, 4, 1], [0, 2, 5], [1, 3, 3]])
  expect(t.followUps?.map(f => f.chosen)).toEqual([2, 3, undefined])
  const outcomes = followUpOutcomes(afterTally(q, t), t)
  expect(outcomes.map(o => o.decision)).toEqual(['file it as an issue', 'drop it', null])

  const answer = followUpAnswer(afterTally(q, t), t)
  expect(answer).toContain('the counsel decided to file it as an issue, 4 of 7')
  expect(answer).toContain('the counsel decided to drop it, 5 of 7')
  expect(answer).toContain('the counsel did not decide, so drop it')
  expect(answer).toContain('fix it in this pull request 1 of 7, file it as an issue 3 of 7, drop it 3 of 7, no option 0 of 7')
  expect(answer).toContain('To file:')
  expect(answer).toContain('Dropped:')
  expect(answer).toContain('Fixed:')
  expect(answer).toContain('Do not ask the person')
  expect(answer).not.toContain('Record it in the spec')
  expect(answer).not.toContain('next review it posts')
})

test('the follow-ups answer gives each decision, its count of seven and the reason of the first member in the counsel\'s order that chose it, whatever the input order', () => {
  const q = followUpsQuestion()
  // Spec votes drop on the first follow-up, so adversarial is the first in
  // the counsel's order to choose file; the input lists the members backwards.
  const input = followUpRaws([
    ['drop', 'file', 'file', 'file', 'file', 'drop', 'drop'],
    ['fix', 'fix', 'fix', 'fix', 'drop', 'drop', 'drop'],
    ['drop', 'drop', 'drop', 'drop', 'drop', 'drop', 'drop'],
  ]).reverse()
  // On the second follow-up the spec reviewer, first in the counsel's order,
  // voted fix, so its reason is the one given; the blank case below empties
  // that reason and checks that the next reason in the counsel's order is
  // given instead.
  const step = followUpStepOf(q, followUpRead(q, input).followUps)
  if (!('tally' in step)) throw new Error('the round was not counted')
  const outcomes = followUpOutcomes(afterTally(q, step.tally), step.tally)
  expect(outcomes.map(o => o.reason)).toEqual(['reason of adversarial on 1', 'reason of spec on 2', 'reason of spec on 3'])
  expect(outcomes.map(o => o.count)).toEqual([4, 4, 7])

  const blank = input.map(entry => entry.member === 'pilot:spec-reviewer'
    ? { ...entry, follow_ups: entry.follow_ups.map(f => (f.number === 2 ? { ...f, reason: '  ' } : f)) }
    : entry)
  const blankStep = followUpStepOf(q, followUpRead(q, blank).followUps)
  if (!('tally' in blankStep)) throw new Error('the round was not counted')
  expect(followUpOutcomes(q, blankStep.tally)[1]?.reason).toBe('reason of adversarial on 2')

  const answer = followUpAnswer(afterTally(q, step.tally), step.tally)
  expect(answer).toContain('Follow-up 1, "The pane cuts long agent names.": the counsel decided to file it as an issue, 4 of 7. Its reason: reason of adversarial on 1.')
  expect(answer).toContain('Follow-up 2, "The poll logs every look twice.": the counsel decided to fix it in this pull request, 4 of 7. Its reason: reason of spec on 2.')
  expect(answer).toContain('Follow-up 3, "A retry message has a typo.": the counsel decided to drop it, 7 of 7.')
})

test('a decided follow-up whose choosing members all gave an empty reason says that no member that chose it gave a reason', () => {
  const q = followUpsQuestion({ followUps: ['The pane cuts long agent names.'] })
  // Five members choose file with an empty or blank reason, and the two that
  // choose drop give reasons, which must not stand in for the file reason.
  const input = MEMBERS.map((_, i) => ({
    member: fullName(MEMBERS[i]!),
    follow_ups: [i < 5 ? { number: 1, vote: 'file', reason: i % 2 === 0 ? '' : '   ' } : { number: 1, vote: 'drop', reason: `reason of ${MEMBERS[i]} on 1` }],
  }))
  const step = followUpStepOf(q, followUpRead(q, input).followUps)
  if (!('tally' in step)) throw new Error('the round was not counted')
  const answer = followUpAnswer(afterTally(q, step.tally), step.tally)
  expect(answer).toContain('Follow-up 1, "The pane cuts long agent names.": the counsel decided to file it as an issue, 5 of 7. No member that chose it gave a reason.')
  expect(answer).not.toContain('reason: .')
  expect(answer).not.toContain('Its reason')
})

test('a reason that looks like a secret is withheld from the follow-ups answer', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  const q = followUpsQuestion({ followUps: ['The pane cuts long agent names.'] })
  const input = MEMBERS.map((_, i) => ({ member: fullName(MEMBERS[i]!), follow_ups: [{ number: 1, vote: 'file', reason: i === 0 ? `the key ${key} leaks` : 'later' }] }))
  const step = followUpStepOf(q, followUpRead(q, input).followUps)
  if (!('tally' in step)) throw new Error('the round was not counted')
  expect(followUpOutcomes(q, step.tally)[0]?.reason).toBe(WITHHELD_REASON)
  const answer = followUpAnswer(afterTally(q, step.tally), step.tally)
  expect(answer).not.toContain(key)
  expect(answer).toContain(WITHHELD_REASON)
})

test('a member lacking one follow-up\'s vote is asked again, and still lacking it, a follow-up at 4 is decided, one below is dropped naming the member, and the person is not asked', () => {
  const q = followUpsQuestion()
  // The data reviewer gives no vote on the second follow-up, and its vote on
  // the third cannot be read.
  const rows: (string | undefined)[][] = [
    ['file', 'file', 'file', 'file', 'drop', 'drop', 'drop'],
    ['drop', 'drop', 'drop', 'file', 'file', undefined, 'file'],
    ['fix', 'fix', 'fix', 'fix', 'drop', 'fix (or file)', 'drop'],
  ]
  const first = followUpRead(q, followUpRaws(rows))
  expect(first.unreadable).toEqual([{ member: DATA, number: 3, text: 'fix (or file)' }])
  const step = followUpStepOf(q, first.followUps)
  expect(step).toEqual({ askAgain: [DATA] })
  const asked = followUpAskAgainAnswer(q, [DATA], first.followUps, first.unreadable)
  expect(asked).toContain(`- ${DATA}: no vote on follow-ups 2 and 3.`)
  expect(asked).toContain('"fix (or file)"')
  expect(READABLE_FOLLOW_UP_VOTE).toBe('A readable vote on a follow-up is fix, file, drop, an option\'s number, or none.')
  expect(asked).toContain(READABLE_FOLLOW_UP_VOTE)
  expect(asked).toContain('Launch exactly this member again')
  expect(asked).not.toContain('to the person')

  // Asked again, it still gives no vote on the second follow-up.
  const again = afterAskAgain(q, [DATA])
  rows[2]![5] = 'drop'
  const second = followUpRead(again, followUpRaws(rows))
  const counted = followUpStepOf(again, second.followUps)
  if (!('tally' in counted)) throw new Error('the round was not counted')
  const t = counted.tally
  // 3 of 6 does not decide, and 4 of 7 does.
  expect(t.followUps?.map(f => f.counts)).toEqual([[0, 4, 3], [0, 3, 3], [4, 0, 3]])
  expect(t.followUps?.map(f => f.chosen)).toEqual([2, undefined, 1])
  const outcomes = followUpOutcomes(again, t)
  expect(outcomes[1]?.without.map(a => a.member)).toEqual([DATA])
  const answer = followUpAnswer(afterTally(again, t), t)
  expect(answer).toContain('the counsel did not decide, so drop it')
  expect(answer).toContain(`Without a vote: ${DATA} (no readable vote).`)
  expect(answer).toContain('the counsel decided to fix it in this pull request, 4 of 7')
  expect(answer).toContain('Do not ask the person')
  expect(answer).not.toContain('Ask the person:')
})

test('a follow-up with 3 votes to file and 2 to drop, with two members still without a vote, is not decided by a majority of those who voted and is dropped as undecided', () => {
  const q = followUpsQuestion()
  // The performance and data reviewers give no vote on the first follow-up,
  // so 3 of the 5 votes that exist choose file: a majority of those who
  // voted, but not 4 of the 7.
  const rows: (string | undefined)[][] = [
    ['file', 'file', 'file', 'drop', undefined, undefined, 'drop'],
    ['drop', 'drop', 'drop', 'drop', 'drop', 'drop', 'drop'],
    ['fix', 'fix', 'fix', 'fix', 'fix', 'fix', 'fix'],
  ]
  const first = followUpRead(q, followUpRaws(rows))
  expect(followUpStepOf(q, first.followUps)).toEqual({ askAgain: ['pilot:performance-reviewer', DATA] })

  // Asked again, both still give no vote on the first follow-up.
  const again = afterAskAgain(q, ['pilot:performance-reviewer', DATA])
  const second = followUpRead(again, followUpRaws(rows))
  const counted = followUpStepOf(again, second.followUps)
  if (!('tally' in counted)) throw new Error('the round was not counted')
  const t = counted.tally
  expect(t.followUps?.[0]?.counts).toEqual([0, 3, 2])
  expect(t.followUps?.[0]?.chosen).toBeUndefined()
  expect(t.followUps?.map(f => f.chosen)).toEqual([undefined, 3, 1])
  const answer = followUpAnswer(afterTally(again, t), t)
  expect(answer).toContain(`- Follow-up 1, "${FOLLOW_UPS[0]}": the counsel did not decide, so drop it.`)
  expect(answer).not.toContain(`- Follow-up 1, "${FOLLOW_UPS[0]}": the counsel decided`)
  expect(answer).not.toContain('Ask the person:')
})

test('a member with no follow-up votes at all is asked again, and every member missing a vote is asked together in member order', () => {
  const q = followUpsQuestion()
  const input = followUpRaws([
    ['file', 'file', 'file', 'file', 'drop', 'drop', 'drop'],
    ['drop', 'drop', 'drop', 'file', 'file', 'file', 'file'],
    ['fix', 'fix', 'abstain', 'fix', 'drop', 'drop', 'drop'],
  ]).filter(entry => entry.member !== 'pilot:spec-reviewer')
  const read = followUpRead(q, input)
  const step = followUpStepOf(q, read.followUps)
  expect(step).toEqual({ askAgain: ['pilot:spec-reviewer', SECURITY] })
  // No vote here was unreadable, so the answer does not say what a readable one is.
  expect(read.unreadable).toEqual([])
  expect(followUpAskAgainAnswer(q, ['pilot:spec-reviewer', SECURITY], read.followUps, read.unreadable)).not.toContain(READABLE_FOLLOW_UP_VOTE)
})

test('a follow-ups question never reruns, a NEW OPTION on it is ignored, and a tally for round 2 or one already tallied is refused', () => {
  const q = followUpsQuestion()
  const input = followUpRaws([
    ['none', 'none', 'none', 'file', 'file', 'drop', 'drop'],
    ['drop', 'drop', 'drop', 'drop', 'drop', 'drop', 'drop'],
    ['drop', 'drop', 'drop', 'drop', 'drop', 'drop', 'drop'],
  ]).map(entry => ({ ...entry, new_option: 'NEW-OPTION-MARKER fix it later' }))
  const step = followUpStepOf(q, followUpRead(q, input).followUps)
  if (!('tally' in step)) throw new Error('the round was not counted')
  expect(step.tally.outcome).toBe('counted')
  expect(step.tally.proposed).toEqual([])
  const recorded = afterTally(q, step.tally)
  expect(recorded.round).toBe(1)
  expect(recorded.options).toEqual([...FOLLOW_UP_OPTIONS])
  expect(JSON.stringify(recorded)).not.toContain('NEW-OPTION-MARKER')
  expect(followUpAnswer(recorded, step.tally)).not.toContain('NEW-OPTION-MARKER')

  expect(followUpVotesOf(q, 2, input)).toEqual({ refusal: 'a follow-ups question has only round 1.' })
  expect(followUpVotesOf(recorded, 1, input)).toEqual({ refusal: 'round 1 of c1 was already tallied.' })
})

test('a follow-up number out of range or given twice refuses the tally, and so do a top-level vote on a follow-ups question and follow-ups on an ordinary one', () => {
  const q = followUpsQuestion()
  const entry = (follow_ups: unknown, extra: object = {}) => [{ member: 'pilot:spec-reviewer', follow_ups, ...extra }]
  const refused = (input: unknown[]) => 'refusal' in followUpVotesOf(q, 1, input)
  expect(refused(entry([{ number: 0, vote: 'fix', reason: '' }]))).toBe(true)
  expect(refused(entry([{ number: 4, vote: 'fix', reason: '' }]))).toBe(true)
  expect(refused(entry([{ number: 1.5, vote: 'fix', reason: '' }]))).toBe(true)
  expect(refused(entry([{ number: 1, vote: 'fix', reason: '' }, { number: 1, vote: 'drop', reason: '' }]))).toBe(true)
  expect(refused(entry([{ number: 1, vote: '4', reason: '' }]))).toBe(true)
  expect(refused(entry('fix'))).toBe(true)
  expect(refused(entry([{ number: 1, vote: 'fix', reason: '' }], { vote: '1' }))).toBe(true)
  expect(refused([{ member: 'pilot:nobody', follow_ups: [] }])).toBe(true)
  expect(refused([...entry([]), ...entry([])])).toBe(true)
  expect(refused(entry([{ number: 1, vote: 'fix', reason: '' }]))).toBe(false)
  // A member with no follow_ups at all is not refused, nor one reported with
  // an empty vote as a member that failed; neither has a vote.
  expect(refused([{ member: 'pilot:spec-reviewer' }])).toBe(false)
  expect(refused([{ member: 'pilot:spec-reviewer', vote: ' ', reason: '' }])).toBe(false)

  const ordinary = votesOf(question(), 1, [{ member: 'pilot:spec-reviewer', vote: '1', reason: '', follow_ups: [{ number: 1, vote: 'fix', reason: '' }] }])
  expect('refusal' in ordinary).toBe(true)
})

test('a stored question without follow-ups tallies as before, with no follow-up counts', () => {
  const q = question()
  const t = tally(q, votes([1, 1, 1, 1, 2, N, N]))
  expect(t.outcome).toBe('decided')
  expect(t.followUps).toBeUndefined()
  expect(briefFactsOf(q).followUps).toBeUndefined()
  expect(briefText(briefFactsOf(q), [])).toContain('NEW OPTION')
})

test('the decisions still owed to a pull request that ended are worded once, with the spec instruction, and nothing when none are owed', () => {
  const pr = { repo: 'o/r', number: 7 }
  expect(endedDecisionLines(pr, 'MERGED', [])).toEqual([])
  expect(endedDecisionLines(pr, 'CLOSED', ['- Q? A.'])).toEqual([
    'This counsel decision was owed to the next review on o/r#7, which closed before a review listed it, so no review will list it.',
    'Record it in the spec, under a section headed "Decided by the counsel", as this line:',
    '- Q? A.',
    'Leave out any line the spec already has.',
  ])
  expect(endedDecisionLines(pr, 'MERGED', ['- Q? A.', '- R? B.'])).toEqual([
    'These counsel decisions were owed to the next review on o/r#7, which merged before a review listed them, so no review will list them.',
    'Record them in the spec, under a section headed "Decided by the counsel", as these lines:',
    '- Q? A.',
    '- R? B.',
    'Leave out any line the spec already has.',
  ])
})
