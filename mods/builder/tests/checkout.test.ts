import { expect, test } from 'claude-code/testing'

import { checkoutSentence, otherRepositorySentence, worktreeWithBranch } from '../hooks/checkout'

const HEAD = 'c'.repeat(40)

// One record of `git worktree list --porcelain -z`, as git prints it: each
// field ends with a NUL byte, and an empty field ends the record.
function record(...fields: string[]): string {
  return `${fields.map(f => `${f}\0`).join('')}\0`
}

const main = record('worktree /repo', `HEAD ${HEAD}`, 'branch refs/heads/main')

test('a branch whose name begins with the wanted name does not match it', () => {
  const listing = main + record('worktree /wt', `HEAD ${HEAD}`, 'branch refs/heads/feature-2')
  expect(worktreeWithBranch(listing, 'feature')).toBeNull()
  expect(worktreeWithBranch(listing, 'feature-2')).toBe('/wt')
})

test('a detached worktree has no branch, so it never matches', () => {
  const listing = main + record('worktree /loose', `HEAD ${HEAD}`, 'detached')
  expect(worktreeWithBranch(listing, 'feature')).toBeNull()
  expect(worktreeWithBranch(listing, 'detached')).toBeNull()
})

test('a bare entry has no branch, so it never matches', () => {
  const listing = record('worktree /repo.git', 'bare') + record('worktree /wt', `HEAD ${HEAD}`, 'branch refs/heads/feature')
  expect(worktreeWithBranch(listing, 'feature')).toBe('/wt')
  expect(worktreeWithBranch(listing, 'bare')).toBeNull()
})

test('a path with spaces is read whole', () => {
  const listing = main + record('worktree /my work/the tree', `HEAD ${HEAD}`, 'branch refs/heads/feature')
  expect(worktreeWithBranch(listing, 'feature')).toBe('/my work/the tree')
})

test('a prunable worktree still matches, since git keeps its branch reserved', () => {
  const listing = main + record('worktree /gone', `HEAD ${HEAD}`, 'branch refs/heads/feature', 'prunable gitdir file points to non-existent location')
  expect(worktreeWithBranch(listing, 'feature')).toBe('/gone')
})

test('an empty listing matches nothing', () => {
  expect(worktreeWithBranch('', 'feature')).toBeNull()
})

test('an empty branch matches nothing, not even a record with an empty branch field', () => {
  const listing = main + record('worktree /odd', `HEAD ${HEAD}`, 'branch refs/heads/')
  expect(worktreeWithBranch(listing, '')).toBeNull()
})

test('when two records have the branch, the first one is used', () => {
  const listing = main
    + record('worktree /first', `HEAD ${HEAD}`, 'branch refs/heads/feature')
    + record('worktree /second', `HEAD ${HEAD}`, 'branch refs/heads/feature')
  expect(worktreeWithBranch(listing, 'feature')).toBe('/first')
})

test('the main checkout is listed too, so it matches when it has the branch out', () => {
  expect(worktreeWithBranch(main, 'main')).toBe('/repo')
})

test('each way of finding the checkout has its own sentence', () => {
  expect(checkoutSentence({ dir: '/wt', branch: 'feature', how: 'worktree' }))
    .toBe('It compared /wt, the worktree that has feature checked out.')
  expect(checkoutSentence({ dir: '/repo', branch: 'feature', how: 'no-worktree' }))
    .toBe('It compared /repo, the session\'s folder, because no worktree has feature checked out.')
  expect(checkoutSentence({ dir: '/repo', branch: 'feature', how: 'unlisted' }))
    .toBe('It compared /repo, the session\'s folder, because git could not list the worktrees.')
})

test('a checkout given to the watch tool is named as that, not as the session\'s folder', () => {
  expect(checkoutSentence({ dir: '/web', branch: 'feature', how: 'no-worktree', given: true }))
    .toBe('It compared /web, the checkout given to the watch tool, because no worktree has feature checked out.')
  expect(checkoutSentence({ dir: '/web', branch: 'feature', how: 'unlisted', given: true }))
    .toBe('It compared /web, the checkout given to the watch tool, because git could not list the worktrees.')
})

test('a session\'s folder of another repository is named, and one of the watched repository, in any case, or unread, is not', () => {
  expect(otherRepositorySentence('o/api', 'o/r'))
    .toBe('The session\'s folder is a checkout of o/api, not of o/r, so call the watch tool again with checkout set to a folder inside a checkout of o/r.')
  expect(otherRepositorySentence('O/R', 'o/r')).toBeNull()
  expect(otherRepositorySentence(null, 'o/r')).toBeNull()
})

test('a branch name with control characters is printed without them', () => {
  expect(checkoutSentence({ dir: '/wt', branch: 'fea\u001b[31mture\u0007', how: 'worktree' }))
    .toBe('It compared /wt, the worktree that has feature checked out.')
})
