import { expect, test } from 'claude-code/testing'

import { verdictsOf } from '../hooks/github'
import { factIn, packageText, secretIn, verdictsLine } from '../hooks/review'

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
