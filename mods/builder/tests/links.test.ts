import { expect, test } from 'claude-code/testing'

import { ignoredLine, issueLinkIn, linkFactIn, linkOf, NO_LINK, readIssueLink, resolved, whyUnusable, gitDirOf, mainCheckoutOf } from '../hooks/links'
import { factIn } from '../hooks/review'

const ADDRESS = 'https://tracker.example.com/issue/{key}'

// A reader backed by a map of paths to answers. An answer that is an Error is
// thrown, and a path that is not in the map is refused as a missing file.
// Every path asked for is recorded in order.
function reader(files: Record<string, unknown>): { read: (path: string) => Promise<unknown>; asked: string[] } {
  const asked: string[] = []
  const read = async (path: string): Promise<unknown> => {
    asked.push(path)
    if (!(path in files)) throw new Error(`ENOENT: ${path}`)
    const answer = files[path]
    if (answer instanceof Error) throw answer
    return answer
  }
  return { read, asked }
}

test('the fact is the rest of its own line, trimmed, with its backticks removed', () => {
  expect(linkFactIn(`# Notes\nIssue link: ${ADDRESS}\nOther: x`)).toBe(ADDRESS)
  expect(linkFactIn(`Issue link:   \`${ADDRESS}\`  `)).toBe(ADDRESS)
  expect(linkFactIn(`Issue link:\t${ADDRESS}\r\n`)).toBe(ADDRESS)
  expect(linkFactIn(`Issue link: one\nIssue link: two`)).toBe('one')
  expect(linkFactIn('No fact here.\n  Issue link: indented')).toBe(null)
  expect(linkFactIn('')).toBe(null)
})

test('a bare fact is empty, whether it ends the file or another line follows it', () => {
  expect(linkFactIn('Issue link:')).toBe('')
  expect(linkFactIn('Issue link:   ')).toBe('')
  expect(linkFactIn(`Issue link:\n${ADDRESS}`)).toBe('')
})

test('the fact agrees with the other facts on a line that has a value', () => {
  for (const line of [
    `Issue link: ${ADDRESS}`,
    `Issue link:   \`${ADDRESS}\`  `,
    'Issue link: http://tracker.example.com/{key}',
    'Issue link: has spaces {key}',
    'Before\nIssue link: `x`\nAfter',
  ]) {
    expect(linkFactIn(line), line).toBe(factIn(line, 'Issue link'))
  }
})

test('a usable address begins with https://, holds {key} and holds no space or control character', () => {
  expect(whyUnusable(ADDRESS)).toBe(null)
  expect(whyUnusable('https://tracker.example.com/{key}/and/{key}')).toBe(null)
  expect(whyUnusable('')).toBe('it does not begin with https://')
  expect(whyUnusable('http://tracker.example.com/{key}')).toBe('it does not begin with https://')
  expect(whyUnusable('javascript:alert({key})')).toBe('it does not begin with https://')
  expect(whyUnusable('https://tracker.example.com/issue/')).toBe('it has no {key}')
  expect(whyUnusable('https://tracker.example.com/issue/{key} now')).toBe('it holds spaces or control characters')
  expect(whyUnusable('https://tracker.example.com/issue/\t{key}')).toBe('it holds spaces or control characters')
  expect(whyUnusable('https://tracker.example.com/\u001b[31m{key}')).toBe('it holds spaces or control characters')
  expect(whyUnusable('https://tracker.example.com/\u0085{key}')).toBe('it holds spaces or control characters')
})

test('the reasons are checked in order, and the first that fails is the one given', () => {
  expect(whyUnusable('http://no key here')).toBe('it does not begin with https://')
  expect(whyUnusable('https://no key here')).toBe('it has no {key}')
})

test('a text with a fact answers the usable address or the reason it was ignored', () => {
  expect(issueLinkIn(null)).toBe(null)
  expect(issueLinkIn('No fact here.')).toBe(null)
  expect(issueLinkIn(`Issue link: ${ADDRESS}`)).toEqual({ address: ADDRESS, ignored: null })
  expect(issueLinkIn('Issue link:')).toEqual({ address: null, ignored: 'it does not begin with https://' })
  expect(issueLinkIn('Issue link: https://tracker.example.com/')).toEqual({ address: null, ignored: 'it has no {key}' })
  expect(NO_LINK).toEqual({ address: null, ignored: null })
})

test('a key becomes a link with every {key} replaced', () => {
  expect(linkOf(ADDRESS, 'ABC-123')).toBe('https://tracker.example.com/issue/ABC-123')
  expect(linkOf('https://tracker.example.com/{key}?q={key}', 'ABC-123')).toBe('https://tracker.example.com/ABC-123?q=ABC-123')
  expect(linkOf(ADDRESS, 'A1-7')).toBe('https://tracker.example.com/issue/A1-7')
})

test('only a key of the issue-key shape, with an address, becomes a link', () => {
  for (const key of ['abc-123', 'ABC-', 'ABC-12a', 'ABC 123', '1BC-123', 'ABC-123 ', 'ABC-\u001b[31m123', 'ABC-123\u001b[0m', 'ABC-123\nx', '']) {
    expect(linkOf(ADDRESS, key), JSON.stringify(key)).toBe(null)
  }
  expect(linkOf(ADDRESS, null)).toBe(null)
  expect(linkOf(null, 'ABC-123')).toBe(null)
})

test('a path is resolved against a folder, with dots and repeated slashes folded', () => {
  expect(resolved('/work/repo', 'CLAUDE.md')).toBe('/work/repo/CLAUDE.md')
  expect(resolved('/work/repo/', 'CLAUDE.md')).toBe('/work/repo/CLAUDE.md')
  expect(resolved('/work/repo', '/elsewhere//git/./x')).toBe('/elsewhere/git/x')
  expect(resolved('/main/.git/worktrees/wt', '../..')).toBe('/main/.git')
  expect(resolved('/a', '../../..')).toBe('/')
  expect(resolved('/a/b', '.')).toBe('/a/b')
})

test('a worktree\'s .git file names its git folder, and anything else names none', () => {
  expect(gitDirOf('/wt', 'gitdir: /main/.git/worktrees/wt\n')).toBe('/main/.git/worktrees/wt')
  expect(gitDirOf('/work/wt', 'gitdir: ../main/.git/worktrees/wt')).toBe('/work/main/.git/worktrees/wt')
  expect(gitDirOf('/wt', 'gitdir:   /main/.git/worktrees/wt  \r\n')).toBe('/main/.git/worktrees/wt')
  expect(gitDirOf('/wt', '')).toBe(null)
  expect(gitDirOf('/wt', 'gitdir:')).toBe(null)
  expect(gitDirOf('/wt', 'something else\ngitdir: /main/.git')).toBe(null)
})

test('the main checkout is the folder that holds the common git folder', () => {
  expect(mainCheckoutOf('/main/.git/worktrees/wt', '../..\n')).toBe('/main')
  expect(mainCheckoutOf('/main/.git/worktrees/wt', '/main/.git')).toBe('/main')
  expect(mainCheckoutOf('/main/.git/worktrees/wt', '')).toBe(null)
  expect(mainCheckoutOf('/main/.git/worktrees/wt', '  \n')).toBe(null)
})

test('the line the person is told names the mod and the reason', () => {
  expect(ignoredLine('builder', 'it has no {key}')).toBe('builder: the Issue link fact was ignored because it has no {key}')
})

test('a fact in the working folder\'s CLAUDE.md is read from that one file', async () => {
  const { read, asked } = reader({ '/wt/CLAUDE.md': `Issue link: ${ADDRESS}` })
  expect(await readIssueLink(read, '/wt')).toEqual({ address: ADDRESS, ignored: null })
  expect(asked).toEqual(['/wt/CLAUDE.md'])
})

test('a fact in the working folder\'s CLAUDE.local.md is read when CLAUDE.md has none', async () => {
  const { read, asked } = reader({ '/wt/CLAUDE.md': '# Project', '/wt/CLAUDE.local.md': `Issue link: ${ADDRESS}` })
  expect(await readIssueLink(read, '/wt')).toEqual({ address: ADDRESS, ignored: null })
  expect(asked).toEqual(['/wt/CLAUDE.md', '/wt/CLAUDE.local.md'])
})

test('a fact in the main checkout\'s CLAUDE.local.md is found through an absolute gitdir', async () => {
  const { read, asked } = reader({
    '/main/.claude/worktrees/wt/CLAUDE.md': '# Project',
    '/main/.claude/worktrees/wt/.git': 'gitdir: /main/.git/worktrees/wt\n',
    '/main/.git/worktrees/wt/commondir': '../..\n',
    '/main/CLAUDE.local.md': `Issue link: ${ADDRESS}\n`,
  })
  expect(await readIssueLink(read, '/main/.claude/worktrees/wt')).toEqual({ address: ADDRESS, ignored: null })
  expect(asked).toEqual([
    '/main/.claude/worktrees/wt/CLAUDE.md',
    '/main/.claude/worktrees/wt/CLAUDE.local.md',
    '/main/.claude/worktrees/wt/.git',
    '/main/.git/worktrees/wt/commondir',
    '/main/CLAUDE.local.md',
  ])
})

test('a fact in the main checkout\'s CLAUDE.local.md is found through a relative gitdir', async () => {
  const { read, asked } = reader({
    '/main/.claude/worktrees/wt/.git': 'gitdir: ../../../.git/worktrees/wt',
    '/main/.git/worktrees/wt/commondir': '../..',
    '/main/CLAUDE.local.md': `Issue link: ${ADDRESS}`,
  })
  expect(await readIssueLink(read, '/main/.claude/worktrees/wt')).toEqual({ address: ADDRESS, ignored: null })
  expect(asked[asked.length - 1]).toBe('/main/CLAUDE.local.md')
})

test('an unusable fact in an earlier file stops the search', async () => {
  const { read, asked } = reader({
    '/wt/CLAUDE.md': 'Issue link: https://tracker.example.com/',
    '/wt/CLAUDE.local.md': `Issue link: ${ADDRESS}`,
  })
  expect(await readIssueLink(read, '/wt')).toEqual({ address: null, ignored: 'it has no {key}' })
  expect(asked).toEqual(['/wt/CLAUDE.md'])
})

test('a read that is refused counts as no file, and the search goes on', async () => {
  const { read, asked } = reader({ '/wt/CLAUDE.md': new Error('too large'), '/wt/CLAUDE.local.md': `Issue link: ${ADDRESS}` })
  expect(await readIssueLink(read, '/wt')).toEqual({ address: ADDRESS, ignored: null })
  expect(asked).toEqual(['/wt/CLAUDE.md', '/wt/CLAUDE.local.md'])
})

test('a read that throws before it answers counts as no file too', async () => {
  const read = (path: string): Promise<unknown> => {
    if (path === '/wt/CLAUDE.md') throw new Error('refused')
    return Promise.resolve(`Issue link: ${ADDRESS}`)
  }
  expect(await readIssueLink(read, '/wt')).toEqual({ address: ADDRESS, ignored: null })
})

test('an answer that is not a string counts as no file', async () => {
  const { read } = reader({ '/wt/CLAUDE.md': { text: `Issue link: ${ADDRESS}` }, '/wt/CLAUDE.local.md': 42 })
  expect(await readIssueLink(read, '/wt')).toEqual(NO_LINK)
})

test('a .git folder, which does not read as text, gives no third place', async () => {
  const { read, asked } = reader({ '/main/.git': new Error('EISDIR: illegal operation on a directory') })
  expect(await readIssueLink(read, '/main')).toEqual(NO_LINK)
  expect(asked).toEqual(['/main/CLAUDE.md', '/main/CLAUDE.local.md', '/main/.git'])
})

test('a missing .git gives no third place', async () => {
  const { read, asked } = reader({})
  expect(await readIssueLink(read, '/wt/sub')).toEqual(NO_LINK)
  expect(asked).toEqual(['/wt/sub/CLAUDE.md', '/wt/sub/CLAUDE.local.md', '/wt/sub/.git'])
})

test('a missing commondir gives no third place', async () => {
  const { read, asked } = reader({ '/wt/.git': 'gitdir: /main/.git/worktrees/wt' })
  expect(await readIssueLink(read, '/wt')).toEqual(NO_LINK)
  expect(asked).toEqual(['/wt/CLAUDE.md', '/wt/CLAUDE.local.md', '/wt/.git', '/main/.git/worktrees/wt/commondir'])
})

test('a main checkout that is the working folder is not read a second time', async () => {
  const { read, asked } = reader({
    '/main/.git': 'gitdir: /main/.git/worktrees/self',
    '/main/.git/worktrees/self/commondir': '../..',
  })
  expect(await readIssueLink(read, '/main/')).toEqual(NO_LINK)
  expect(asked).toEqual(['/main/CLAUDE.md', '/main/CLAUDE.local.md', '/main/.git', '/main/.git/worktrees/self/commondir'])
})

test('a main checkout whose CLAUDE.local.md has no fact gives no link', async () => {
  const { read } = reader({
    '/wt/.git': 'gitdir: /main/.git/worktrees/wt',
    '/main/.git/worktrees/wt/commondir': '../..',
    '/main/CLAUDE.local.md': '# Notes',
  })
  expect(await readIssueLink(read, '/wt')).toEqual(NO_LINK)
})
