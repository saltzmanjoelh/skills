import { expect, test } from 'claude-code/testing'

import { verdictsOf } from '../hooks/github'
import { commitRecordsOf, DECIDED_HEADINGS, DECIDED_ITEM_CHARS, decidedItems, decidedSection, factIn, packageText, recordItems, secretIn, STREAK_STOP, trendOf, trendSection, trendStopLine, verdictsLine } from '../hooks/review'

const facts = {
  repo: 'o/r',
  number: 7,
  head: 'c'.repeat(40),
  base: 'main',
  stat: ' a.ts | 2 +-\n 1 file changed',
  commits: 'aaaaaaa Spec: the thing\nA\tdocs/specs/thing.md\nbbbbbbb Build the thing\nM\ta.ts',
  round: 1,
  architecture: 'docs/architecture.md',
  gotchas: null,
  earlier: [],
  decided: [],
  trend: trendOf([]),
}

test('the package names the head, the round, the documents and the commits, and points at the diff first', () => {
  const text = packageText({ issue: 'Make the thing.', spec: 'docs/specs/thing.md' }, facts)
  expect(text).toContain('# Review package for o/r#7 at cccccccc')
  expect(text).toContain('Read `diff.patch` beside this file first')
  expect(text).toContain('- Round: 1')
  expect(text).toContain('- Spec: docs/specs/thing.md')
  expect(text).toContain('- Plan: none given')
  expect(text).toContain('- Gotchas document: none in this project')
  expect(text).toContain('A\tdocs/specs/thing.md')
  expect(text).not.toContain('## Earlier rounds')
})

test('earlier verdict reviews are carried into the package, newest last', () => {
  const text = packageText({ issue: 'x' }, {
    ...facts,
    round: 3,
    earlier: [{ sha: 'a'.repeat(40), body: 'VERDICTS aaaaaaaa first' }, { sha: 'b'.repeat(40), body: 'VERDICTS bbbbbbbb second' }],
  })
  expect(text).toContain('- Round: 3')
  expect(text.indexOf('### At aaaaaaaa')).toBeLessThan(text.indexOf('### At bbbbbbbb'))
})

test('the verdicts line the review tool writes is the one the snapshot parses', () => {
  const head = 'c'.repeat(40)
  for (const [spec, adversarial] of [['APPROVE', 'REQUEST_CHANGES'], ['REQUEST_CHANGES', 'APPROVE'], ['APPROVE', 'APPROVE']] as const) {
    const body = `${verdictsLine(head, spec, adversarial)}\n\nThe findings.`
    expect(verdictsOf({ author: { login: 'owner' }, body, commit: { oid: head } })).toEqual({ sha: head, spec, adversarial })
  }
})

test('credential shapes are caught and ordinary review text is not', () => {
  expect(secretIn(`token ghp_${'a'.repeat(36)} leaked`)).toBe('a GitHub token')
  expect(secretIn('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe('a private key')
  expect(secretIn(`key AKIA${'A'.repeat(16)}`)).toBe('an AWS access key id')
  expect(secretIn('- [security] src/auth.ts:12: the sk- prefix check is skipped. Fix: check it.')).toBe(null)
})

test('a project fact is one Label: value line anywhere in CLAUDE.md', () => {
  const claude = '# Project\n\nSome prose.\nArchitecture document: `docs/design/overview.md`\nGotchas document:docs/traps.md\n'
  expect(factIn(claude, 'Architecture document')).toBe('docs/design/overview.md')
  expect(factIn(claude, 'Gotchas document')).toBe('docs/traps.md')
  expect(factIn(claude, 'Base branch')).toBe(null)
  expect(factIn('Architecture documents: x', 'Architecture document')).toBe(null)
})

// The records the decided section and the trend are read from: commits
// oldest first, each a full sha and a message.
const sha = (c: string) => c.repeat(40)
const commit = (c: string, message: string) => ({ sha: sha(c), message })

test('git log output is read into commit records, and a record without a full sha is skipped', () => {
  const raw = `${sha('a')}\u001fFirst\n\nBody line.\n\u001e\n${sha('b')}\u001fSecond\n\u001e\nnot a sha\u001fThird\n\u001e\n`
  expect(commitRecordsOf(raw)).toEqual([
    { sha: sha('a'), message: 'First\n\nBody line.' },
    { sha: sha('b'), message: 'Second' },
  ])
  expect(commitRecordsOf('')).toEqual([])
})

test('the items under Dropped and Outside the spec are read, and a bold heading counts', () => {
  const body = [
    'VERDICTS aaaaaaaa spec=APPROVE adversarial=REQUEST_CHANGES',
    '',
    '**Dropped:**',
    '- The cache can go stale. Refuted: it is rebuilt on every read.',
    '- The loop is quadratic. Speculative: no input is that large.',
    '',
    '## Outside the spec:',
    '- Surviving a restart of the parent. The spec never asks for it.',
  ].join('\n')
  expect(recordItems(body, DECIDED_HEADINGS)).toEqual([
    'The cache can go stale. Refuted: it is rebuilt on every read.',
    'The loop is quadratic. Speculative: no input is that large.',
    'Surviving a restart of the parent. The spec never asks for it.',
  ])
})

test('a list ends at a Markdown heading that has no colon', () => {
  const message = ['Fix the round', '', 'Dropped:', '- The dropped item.', '## Notes', '- A note, not a dropped item.'].join('\n')
  expect(recordItems(message, DECIDED_HEADINGS)).toEqual(['The dropped item.'])
})

test('a list ends at a blank line or at another heading, and a line without a dash is skipped', () => {
  const message = [
    'Fix the round',
    '',
    'Dropped:',
    '- First dropped item.',
    'a stray line that is not an item',
    '- Second dropped item.',
    'Fixed:',
    '- A fixed finding, not a dropped one.',
    '',
    'Outside the spec:',
    '- An outside item.',
    '',
    '- A dash after the blank line, under no heading.',
    '  - An indented line.',
  ].join('\n')
  expect(recordItems(message, DECIDED_HEADINGS)).toEqual(['First dropped item.', 'Second dropped item.', 'An outside item.'])
  expect(recordItems('', DECIDED_HEADINGS)).toEqual([])
  expect(recordItems('Dropped: inline text is not a heading\n- not read', DECIDED_HEADINGS)).toEqual([])
})

test('decided items are numbered with their sources, a review after the commit it was posted at', () => {
  const commits = [
    commit('a', 'Build the thing'),
    commit('b', 'Fix the first round\n\nDropped:\n- The cache can go stale. Refuted.\n'),
    commit('c', 'Fix the second round\n\nOutside the spec:\n- Surviving a restart.\n'),
  ]
  const earlier = [
    { sha: sha('b'), body: 'VERDICTS bbbbbbbb spec=APPROVE adversarial=APPROVE\n\nDropped:\n- A finding dropped at b.' },
    { sha: sha('f'), body: 'VERDICTS ffffffff\n\nDropped:\n- A finding at a head no longer on the branch.' },
  ]
  expect(decidedItems(commits, earlier)).toEqual([
    { number: 1, source: 'commit bbbbbbbb', text: 'The cache can go stale. Refuted.' },
    { number: 2, source: 'review at bbbbbbbb', text: 'A finding dropped at b.' },
    { number: 3, source: 'commit cccccccc', text: 'Surviving a restart.' },
    { number: 4, source: 'review at ffffffff', text: 'A finding at a head no longer on the branch.' },
  ])
})

test('an item repeated with a different case and spacing is listed once, at its first place', () => {
  const commits = [
    commit('a', 'Fix\n\nDropped:\n- The cache can go stale.\n'),
    commit('b', 'Fix again\n\nDropped:\n-   THE CACHE   can go stale.  \n- Something new.\n'),
  ]
  expect(decidedItems(commits, [{ sha: sha('b'), body: 'Dropped:\n- the cache can go stale.' }])).toEqual([
    { number: 1, source: 'commit aaaaaaaa', text: 'The cache can go stale.' },
    { number: 2, source: 'commit bbbbbbbb', text: 'Something new.' },
  ])
})

test('an item is cleaned of control characters and cut', () => {
  const long = 'x'.repeat(500)
  const items = decidedItems([commit('a', `Fix\n\nDropped:\n- Plain \u001b[31mred\u001b[0m and ‮flipped.\n- ${long}\n`)], [])
  expect(items[0]?.text).toBe('Plain red and flipped.')
  expect(items[1]?.text.length).toBe(DECIDED_ITEM_CHARS)
  expect(items[1]?.text.endsWith('…')).toBe(true)
})

test('the numbers of earlier items stay the same when a commit is appended', () => {
  const commits = [commit('a', 'Fix\n\nDropped:\n- One.\n'), commit('b', 'Fix\n\nDropped:\n- Two.\n')]
  const before = decidedItems(commits, [])
  const after = decidedItems([...commits, commit('c', 'Fix\n\nDropped:\n- Three.\n- One.\n')], [])
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after.map(i => i.text)).toEqual(['One.', 'Two.', 'Three.'])
})

test('the decided section quotes each item after its number and source, or says none yet', () => {
  const text = decidedSection([{ number: 1, source: 'commit aaaaaaaa', text: 'The cache can go stale.' }])
  expect(text).toContain('## Already decided')
  expect(text).toContain('Repeats: D<n>. New evidence:')
  expect(text).toContain('- D1 (commit aaaaaaaa): The cache can go stale.')
  expect(decidedSection([])).toContain('None yet.')
  expect(decidedSection([])).not.toContain('- D1')
})

// A fix commit for the findings raised at `reviewed`, naming `areas`.
const fix = (c: string, reviewed: string | null, areas: string[], extra = '') => commit(c, [
  'Fix the findings',
  '',
  ...(reviewed === null ? [] : [`Reviewed: ${reviewed}`]),
  ...areas.map(area => `Area: ${area}`),
  ...(extra === '' ? [] : [extra]),
].join('\n'))
const RACE = 'hooks/a.ts: the parent race'
const CACHE = 'hooks/b.ts: the cache'

test('a Reviewed: value with a trailing full stop names the same head as one without', () => {
  const commits = [commit('1', 'Build'), fix('2', '11111111.', [RACE]), fix('3', '11111111', [RACE])]
  expect(trendOf(commits).streaks).toEqual([])
})

test('an empty list written as None. holds no decided item', () => {
  expect(recordItems('Fix\n\nDropped:\n- None.\n\nOutside the spec:\n- none', DECIDED_HEADINGS)).toEqual([])
})

test('two commits for one reviewed head are one group, whether the head is named short or in full', () => {
  const commits = [
    commit('1', 'Build'),
    fix('2', '11111111', [RACE]),
    fix('3', sha('1'), [RACE]),
    commit('4', 'Another head'),
    fix('5', '44444444', [RACE]),
  ]
  const report = trendOf(commits)
  expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
  expect(report.stops).toEqual([])
  expect(trendSection(report)).toContain(`- ${RACE}, fixed at 2 reviewed heads in a row`)
  expect(trendStopLine(report)).toBe(null)
})

test('two commits that name the same unknown reviewed head are one group, whether the value is hex or not', () => {
  // Neither value matches a commit on the branch, so each groups by itself.
  for (const unknown of ['abcdef99', 'the first head']) {
    const commits = [fix('1', null, [RACE]), fix('2', unknown, [RACE]), fix('3', unknown.toUpperCase(), [RACE])]
    const report = trendOf(commits)
    expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
    expect(report.stops).toEqual([])
  }
})

test('a streak of three stops the rounds, at the top of the package', () => {
  const commits = [fix('1', null, [RACE]), fix('2', null, [RACE, CACHE]), fix('3', null, [RACE])]
  const report = trendOf(commits)
  expect(report.stops).toEqual([{ area: RACE, streak: STREAK_STOP }])
  const stop = trendStopLine(report)
  expect(stop).toContain(RACE)
  expect(stop).toContain('3 reviewed heads in a row')
  const text = packageText({ issue: 'x' }, { ...facts, decided: [], trend: report })
  expect(text.split('\n').slice(0, 3).join('\n')).toContain(stop!)
  expect(text).toContain('## Areas fixed so far')
  expect(text).toContain('## Already decided')
  // The cache was fixed at the middle head only, so it has no streak shown.
  expect(trendSection(report).split('\n')).toContain(`- ${CACHE}`)
})

test('a commit that fixed findings without an Area line is listed and changes no streak', () => {
  const without = [fix('1', null, [RACE]), fix('2', null, [RACE])]
  const withIt = [fix('1', null, [RACE]), fix('9', sha('1'), []), fix('2', null, [RACE])]
  expect(trendOf(withIt).streaks).toEqual(trendOf(without).streaks)
  expect(trendOf(withIt).unlabelled).toEqual(['99999999'])
  expect(trendSection(trendOf(withIt))).toContain('99999999')
  // A commit that fixed no review findings is not listed.
  expect(trendOf([commit('8', 'Build the thing')]).unlabelled).toEqual([])
})

test('keep going counts the streak from zero, so two later groups do not stop and a third does', () => {
  const before = [fix('1', null, [RACE]), fix('2', null, [RACE]), fix('3', null, [RACE])]
  const kept = [...before, commit('4', `Record the counsel's answer\n\nTrend: ${RACE}: keep going`)]
  expect(trendOf(kept).stops).toEqual([])
  const two = [...kept, fix('5', null, [RACE]), fix('6', null, [RACE])]
  expect(trendOf(two).stops).toEqual([])
  expect(trendOf(two).streaks).toEqual([{ area: RACE, streak: 2 }])
  const three = [...two, fix('7', null, [RACE])]
  expect(trendOf(three).stops).toEqual([{ area: RACE, streak: 3 }])
})

test('a Trend: answer that ends in a full stop is still read', () => {
  const commits = [
    fix('1', null, [RACE]), fix('2', null, [RACE]), fix('3', null, [RACE]),
    commit('4', `Record the answer\n\nTrend: ${RACE}: keep going.`),
  ]
  const report = trendOf(commits)
  expect(report.stops).toEqual([])
  expect(report.unreadable).toEqual([])
})

test('file the rest and cut it out close an area, which then never stops', () => {
  for (const answer of ['file the rest', 'cut it out']) {
    const commits = [
      fix('1', null, [RACE]), fix('2', null, [RACE]), fix('3', null, [RACE]),
      commit('4', `Record the answer\n\nTrend: ${RACE}: ${answer}`),
      fix('5', null, [RACE]), fix('6', null, [RACE]), fix('7', null, [RACE]),
    ]
    const report = trendOf(commits)
    expect(report.stops).toEqual([])
    expect(report.streaks).toEqual([])
    expect(report.closed).toEqual([{ area: RACE, answer }])
    expect(trendSection(report)).toContain(`- ${RACE}: ${answer}`)
    expect(trendSection(report)).toContain('unless it breaks working behaviour or is a safety finding')
  }
})

test('a Trend line for one area leaves another area\'s streak alone', () => {
  const commits = [
    fix('1', null, [RACE, CACHE]), fix('2', null, [RACE, CACHE]),
    commit('3', `Record the answer\n\nTrend: ${RACE}: keep going`),
    fix('4', null, [RACE, CACHE]),
  ]
  const report = trendOf(commits)
  expect(report.stops).toEqual([{ area: CACHE, streak: 3 }])
  expect(report.streaks).toEqual([{ area: CACHE, streak: 3 }])
})

test('areas differing in case, spaces and a trailing full stop are one area, kept in its first wording', () => {
  const commits = [fix('1', null, [RACE]), fix('2', null, ['HOOKS/a.ts:   the parent race.']), fix('3', null, ['hooks/A.ts: The Parent Race'])]
  const report = trendOf(commits)
  expect(report.areas).toEqual([RACE])
  expect(report.stops).toEqual([{ area: RACE, streak: 3 }])
})

test('a Trend: line that names no area is unreadable, and a blank Area: line names no area', () => {
  const report = trendOf([commit('1', 'Fix\n\nReviewed: abc\nArea:   '), commit('2', 'Answer\n\nTrend: : keep going')])
  expect(report.unreadable).toEqual([': keep going'])
  expect(report.areas).toEqual([])
})

test('a closed area that no Area: line named is cleaned before it is printed', () => {
  const report = trendOf([commit('1', 'Answer\n\nTrend: hooks/x.ts: \u001b[31mred‮: file the rest')])
  expect(report.closed).toHaveLength(1)
  expect(report.closed[0]!.area).not.toMatch(/[\u0000-\u001f‮]/)
})

test('a Trend line that cannot be read is listed and changes nothing', () => {
  const commits = [fix('1', null, [RACE]), fix('2', null, [RACE]), fix('3', null, [RACE]), commit('4', `Answer\n\nTrend: ${RACE}: keep on going\ntrend: no answer here`)]
  const report = trendOf(commits)
  expect(report.unreadable).toEqual([`${RACE}: keep on going`, 'no answer here'])
  expect(report.stops).toEqual([{ area: RACE, streak: 3 }])
  expect(trendSection(report)).toContain('keep on going')
})

test('with no fix commits the trend section says none yet', () => {
  const report = trendOf([commit('1', 'Build the thing')])
  expect(trendSection(report)).toContain('None yet.')
  expect(trendStopLine(report)).toBe(null)
})

test('an area closed by a Trend: line that no Area: line named is still listed as closed', () => {
  const section = trendSection(trendOf([commit('1', 'Record the answer\n\nTrend: hooks/x.ts: the thing: file the rest')]))
  expect(section).toContain('No area named yet.')
  expect(section).toContain('- hooks/x.ts: the thing: file the rest')
})

// Two branch commits whose shas share their first seven characters.
const TWIN_A = { sha: 'abcdef1' + 'a'.repeat(33), message: 'Build' }
const TWIN_B = { sha: 'abcdef1' + 'b'.repeat(33), message: 'Build more' }
// A fix commit for the findings raised at `reviewed` that names `tidied` on
// Tidied: lines and `areas` on Area: lines.
const tidy = (c: string, reviewed: string | null, tidied: string[], areas: string[] = []) => commit(c, [
  'Fix the findings',
  '',
  ...(reviewed === null ? [] : [`Reviewed: ${reviewed}`]),
  ...areas.map(area => `Area: ${area}`),
  ...tidied.map(area => `Tidied: ${area}`),
].join('\n'))

test('a Reviewed: value of seven hex characters that matches one commit groups under it', () => {
  const commits = [commit('1', 'Build'), fix('2', '1111111', [RACE]), fix('3', sha('1'), [RACE])]
  const report = trendOf(commits)
  expect(report.streaks).toEqual([])
  expect(report.unmatched).toEqual([])
})

test('a Reviewed: value of six characters keys a group of its own and is listed', () => {
  const commits = [commit('1', 'Build'), fix('2', '111111', [RACE]), fix('3', sha('1'), [RACE])]
  const report = trendOf(commits)
  expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
  expect(report.unmatched).toEqual([{ sha: '22222222', value: '111111' }])
  expect(trendSection(report)).toContain('- 22222222: 111111')
})

test('a Reviewed: value that matches two commits keys a group of its own, which commits giving it share', () => {
  const commits = [TWIN_A, TWIN_B, fix('2', 'abcdef1', [RACE]), fix('3', 'ABCDEF1.', [RACE]), fix('4', TWIN_A.sha, [RACE])]
  const report = trendOf(commits)
  expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
  expect(report.unmatched).toEqual([{ sha: '22222222', value: 'abcdef1' }, { sha: '33333333', value: 'ABCDEF1.' }])
})

test('a seven-character value that matched one commit keys a group of its own once a second commit shares its prefix', () => {
  const before = [TWIN_A, fix('2', 'abcdef1', [RACE]), fix('3', TWIN_A.sha, [RACE])]
  expect(trendOf(before).streaks).toEqual([])
  const after = [TWIN_A, fix('2', 'abcdef1', [RACE]), fix('3', TWIN_A.sha, [RACE]), TWIN_B]
  expect(trendOf(after).streaks).toEqual([{ area: RACE, streak: 2 }])
  expect(trendOf(after).unmatched).toEqual([{ sha: '22222222', value: 'abcdef1' }])
})

test('a blank Reviewed: value keeps the commit in a group of its own and is listed as no value', () => {
  const report = trendOf([fix('1', '', [RACE]), fix('2', '', [RACE])])
  expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
  expect(report.unmatched).toEqual([{ sha: '11111111', value: '(no value)' }, { sha: '22222222', value: '(no value)' }])
})

test('a Tidied: line neither lengthens nor breaks a streak, and is listed with its commit', () => {
  const without = [fix('1', null, [RACE]), fix('3', null, [RACE])]
  // The tidied commit names no head, so a group it formed would stand alone and
  // change the streak, whether it named the area or not.
  const withIt = [fix('1', null, [RACE]), tidy('2', null, [RACE]), fix('3', null, [RACE])]
  expect(trendOf(withIt).streaks).toEqual(trendOf(without).streaks)
  const report = trendOf([fix('1', null, [RACE]), fix('2', null, [RACE]), tidy('3', null, [RACE])])
  expect(report.stops).toEqual([])
  expect(report.tidied).toEqual([{ sha: '33333333', area: RACE, retagged: false }])
  expect(trendSection(report)).toContain(`- ${RACE} (33333333)`)
  expect(trendSection(report)).toContain('is a finding')
})

test('a commit with a Reviewed: line and only Tidied: lines is not listed among the commits without an area', () => {
  const report = trendOf([commit('1', 'Build'), tidy('2', sha('1'), [RACE])])
  expect(report.unlabelled).toEqual([])
  expect(report.areas).toEqual([])
})

test('an Area: line and a Tidied: line for one area in one commit count the area once and list the Tidied: line', () => {
  const report = trendOf([fix('1', null, [RACE]), tidy('2', null, [RACE], [RACE])])
  expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
  expect(report.tidied).toEqual([{ sha: '22222222', area: RACE, retagged: false }])
})

test('a trend section with only Tidied: lines does not say none yet', () => {
  const section = trendSection(trendOf([tidy('1', null, [RACE])]))
  expect(section).not.toContain('None yet.')
  expect(section).toContain('No area named yet.')
})

test('a Retag: line counts the area at the retagged commit\'s own place, so a streak of two becomes three and stops', () => {
  const mislabelled = [fix('1', null, [RACE]), tidy('2', null, [RACE]), fix('3', null, [RACE])]
  expect(trendOf(mislabelled).stops).toEqual([])
  const report = trendOf([...mislabelled, commit('4', `Correct the record\n\nRetag: 22222222: ${RACE}`)])
  expect(report.stops).toEqual([{ area: RACE, streak: 3 }])
  expect(report.tidied).toEqual([{ sha: '22222222', area: RACE, retagged: true }])
  expect(trendSection(report)).toContain('read as an Area: line')
  expect(report.unappliedRetags).toEqual([])
})

test('a keep going line between the retagged commit and the Retag: line still resets the streak', () => {
  const commits = [
    fix('1', null, [RACE]), tidy('2', null, [RACE]),
    commit('3', `Record the answer\n\nTrend: ${RACE}: keep going`),
    fix('4', null, [RACE]), fix('5', null, [RACE]),
    commit('6', `Correct the record\n\nRetag: 2222222: ${RACE}`),
  ]
  const report = trendOf(commits)
  expect(report.stops).toEqual([])
  expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
})

test('a Retag: line in the commit it names, or before it, is applied', () => {
  const inItself = commit('2', `Fix the findings\n\nTidied: ${RACE}\nRetag: 22222222: ${RACE}`)
  expect(trendOf([fix('1', null, [RACE]), inItself, fix('3', null, [RACE])]).stops).toEqual([{ area: RACE, streak: 3 }])
  const before = commit('0', `Correct the record\n\nRetag: 22222222: ${RACE}`)
  expect(trendOf([before, fix('1', null, [RACE]), tidy('2', null, [RACE]), fix('3', null, [RACE])]).stops).toEqual([{ area: RACE, streak: 3 }])
})

test('a second Retag: line for the same commit and area changes nothing and is not listed', () => {
  const commits = [
    fix('1', null, [RACE]), tidy('2', null, [RACE]), fix('3', null, [RACE]),
    commit('4', `Correct the record\n\nRetag: 22222222: ${RACE}\nRetag: 2222222222: ${RACE}`),
  ]
  const report = trendOf(commits)
  expect(report.stops).toEqual([{ area: RACE, streak: 3 }])
  expect(report.unappliedRetags).toEqual([])
})

test('a Retag: line naming a commit in a closed area leaves the area closed', () => {
  const commits = [
    fix('1', null, [RACE]), fix('2', null, [RACE]), fix('3', null, [RACE]),
    commit('4', `Record the answer\n\nTrend: ${RACE}: file the rest`),
    fix('5', null, [RACE]), tidy('6', null, [RACE]), fix('7', null, [RACE]),
    commit('8', `Correct the record\n\nRetag: 66666666: ${RACE}`),
  ]
  const report = trendOf(commits)
  expect(report.stops).toEqual([])
  expect(report.closed).toEqual([{ area: RACE, answer: 'file the rest' }])
})

test('a Retag: line that cannot be applied is listed, cleaned, and changes nothing', () => {
  const base = [fix('1', null, [RACE]), tidy('2', null, [RACE]), fix('3', null, [RACE]), TWIN_A, TWIN_B]
  const bad = [
    `222222: ${RACE}`,
    `abcdef1: ${RACE}`,
    `99999999: ${RACE}`,
    '22222222 no colon here',
    '22222222:   ',
    `11111111: ${RACE}`,
    `22222222: ${CACHE}`,
    '22222222: hooks/x.ts: \u001b[31mred‮',
  ]
  for (const value of bad) {
    const report = trendOf([...base, commit('4', `Correct the record\n\nRetag: ${value}`)])
    expect(report.stops).toEqual([])
    expect(report.streaks).toEqual([{ area: RACE, streak: 2 }])
    expect(report.unappliedRetags).toHaveLength(1)
    expect(report.unappliedRetags[0]!).not.toMatch(/[\u0000-\u001f‮]/)
    expect(trendSection(report)).toContain('changed nothing')
  }
})

test('an unmatched Reviewed: value is cleaned before it is printed', () => {
  const report = trendOf([fix('1', '\u001b[31mred‮', [RACE])])
  expect(report.unmatched).toHaveLength(1)
  expect(report.unmatched[0]!.value).not.toMatch(/[\u0000-\u001f‮]/)
})

test('the stop line says later safety findings and findings that break working behaviour stay blocking whatever the answer, on one line', () => {
  const stop = trendStopLine(trendOf([fix('1', null, [RACE]), fix('2', null, [RACE]), fix('3', null, [RACE])]))!
  expect(stop).toContain('whatever the findings behind the streak were')
  expect(stop).toContain('safety finding')
  expect(stop).toContain('breaks working behaviour')
  expect(stop).toContain('stays in scope and blocking whatever the answer')
  expect(stop).toContain("governs only the area's other later findings")
  expect(stop).not.toContain('\n')
})
