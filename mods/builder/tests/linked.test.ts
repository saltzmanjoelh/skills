import { expect, test } from 'claude-code/testing'

import { LINKED_KEPT, linkedCheckout, linkedKey, linkedRecordIn, namesRepository, quoted, recordedLinked, sourceOf, STARTED_NOT_FINISHED, updateLinkedCheckout, withinKept, type LinkedIo } from '../hooks/linked'

// The update of the linked checkout after a merge, run against a hand-built
// io: `process.run` answers from a script keyed on the argument vector, joined
// with spaces, and records every call. A key may start with a folder and `$ `
// to answer only a command run in that folder. An entry that is a list
// answers its calls in turn, the last one repeating. A command the script
// does not name exits 1, and `unexpected` lists it, so a test sees every
// command the update ran that it did not expect.
//
// The file calls `fs.stat` and `fs.list` answer from the same script, under
// the keys `stat <path>` and `list <path>`, and each call is recorded in
// `fsCalls`. A stat answers a value or rejects with a message, and a listing
// answers its entries or rejects. A path the script does not name is listed
// in `unexpected` too and rejects with an ENOENT message, as a missing path
// does. Every command named `test`, `realpath` or `find` is listed in
// `forbidden`, because the update must never run one.

const HOME = '/h'
const CONFIG = `${HOME}/.claude`
const MERGE = 'f'.repeat(40)
const MERGE_TREE = '1'.repeat(40)
const HEAD_TREE = '0'.repeat(40)
const MISSING = 'b'.repeat(40)
type Input = { configDir: string | undefined; home: string | undefined; userProfile: string | undefined; repo: string; base: string; merge: string }
const INPUT: Input = { configDir: undefined, home: HOME, userProfile: undefined, repo: 'o/r', base: 'main', merge: MERGE }

type Answer = { exitCode?: number; stdout?: string; stderr?: string; throws?: boolean; isStdoutTruncated?: boolean }
type StatAnswer = { kind: 'file' | 'dir' | 'other'; isLink: boolean; realPath?: string }
type EntryAnswer = { name: string; kind?: 'file' | 'dir' | 'other'; isLink: boolean }
type FsAnswer = { stat: StatAnswer } | { entries: EntryAnswer[] } | { rejects: string; code?: string }
type Script = Record<string, Answer | Answer[] | FsAnswer>
type Call = { argv: string[]; cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }

const ok = (stdout = ''): Answer => ({ exitCode: 0, stdout })
const exit = (exitCode: number, stderr = ''): Answer => ({ exitCode, stderr })
const rejected = (answer: { rejects: string; code?: string }) => Object.assign(new Error(answer.rejects), answer.code === undefined ? {} : { code: answer.code })

function ioFrom(script: Script, store = new Map<string, unknown>()) {
  const calls: Call[] = []
  const fsCalls: string[] = []
  const used: Record<string, number> = {}
  const unexpected: string[] = []
  const forbidden: string[] = []
  const fsAnswer = (key: string): FsAnswer => {
    const entry = script[key] as FsAnswer | undefined
    if (entry !== undefined) return entry
    unexpected.push(key)
    return { rejects: `ENOENT: no such file or directory, ${key.split(' ')[0]} '${key.slice(key.indexOf(' ') + 1)}'` }
  }
  const io: LinkedIo = {
    process: {
      run: async (argv, init) => {
        calls.push({ argv: [...argv], cwd: init?.cwd, env: init?.env, stdin: init?.stdin, timeoutMs: init?.timeoutMs })
        if (['test', 'realpath', 'find'].includes(argv[0]!)) forbidden.push(argv.join(' '))
        const plain = argv.join(' ')
        const inFolder = init?.cwd === undefined ? undefined : `${init.cwd}$ ${plain}`
        const key = inFolder !== undefined && script[inFolder] !== undefined ? inFolder : plain
        const entry = script[key] as Answer | Answer[] | undefined
        if (entry === undefined) {
          unexpected.push(plain)
          return { exitCode: 1, stdout: '', stderr: `unexpected: ${plain}`, isStdoutTruncated: false, isStderrTruncated: false }
        }
        const list = Array.isArray(entry) ? entry : [entry]
        const n = used[key] ?? 0
        used[key] = n + 1
        const answer = list[Math.min(n, list.length - 1)]!
        if (answer.throws === true) throw new Error('the command ran past its time limit')
        return { exitCode: answer.exitCode ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', isStdoutTruncated: answer.isStdoutTruncated ?? false, isStderrTruncated: false }
      },
    },
    fs: {
      stat: async (path, options) => {
        fsCalls.push(`stat ${path}${options?.resolve === true ? ' resolve' : ''}`)
        const answer = fsAnswer(`stat ${path}`)
        if ('rejects' in answer) throw rejected(answer)
        if (!('stat' in answer)) throw new Error(`the script answers a listing for stat ${path}`)
        const { realPath, ...rest } = answer.stat
        return { size: 1, mtimeMs: 0, ...rest, ...(options?.resolve === true && realPath !== undefined ? { realPath } : {}) }
      },
      list: async path => {
        fsCalls.push(`list ${String(path)}`)
        const answer = fsAnswer(`list ${String(path)}`)
        if ('rejects' in answer) throw rejected(answer)
        if (!('entries' in answer)) throw new Error(`the script answers a stat for list ${String(path)}`)
        return answer.entries.map(entry => ({ kind: entry.kind ?? 'other', size: 0, mtimeMs: 0, ...entry }))
      },
    },
    store: {
      get: async key => store.get(key),
      set: async (key, value) => { store.set(key, JSON.parse(JSON.stringify(value))) },
    },
  }
  const ran = (prefix: string) => calls.filter(call => call.argv.join(' ').startsWith(prefix))
  return { io, calls, fsCalls, store, unexpected, forbidden, ran }
}

const gitAt = (dir: string, ...args: string[]) => ['git', '-C', dir, ...args].join(' ')
const git = (...args: string[]) => gitAt('/repo', ...args)
const FETCH = git('fetch', '--no-write-fetch-head', 'origin', MERGE, '+refs/heads/main:refs/remotes/origin/main')
const FETCH_BY_ADDRESS = git('fetch', '--no-write-fetch-head', 'https://github.com/o/r', MERGE)
const LISTING = git('rev-list', '--objects', '--quiet', '--missing=print', MERGE_TREE, '--not', HEAD_TREE)
const OBJECT_CHECK = git('rev-list', '--objects', '--quiet', '--missing=error', MERGE_TREE, '--not', HEAD_TREE)
const BATCHED_FETCH = git('-c', 'remote.origin.partialclonefilter=blob:none', '-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-write-fetch-head', '--no-tags', '--stdin', 'origin')
const MERGE_FF = git('merge', '--ff-only', '--no-overwrite-ignore', MERGE)
const ANCESTOR = git('merge-base', '--is-ancestor', MERGE, 'HEAD')
const BRANCH = git('branch', '--show-current')
const STATUS = git('status', '--porcelain', '--untracked-files=no')
const REV_PARSE = (folder: string) => `git -C ${folder} rev-parse --path-format=absolute --git-common-dir --show-toplevel`
const LOCK = "fatal: Unable to create '/repo/.git/index.lock': File exists."
const LOOK_UP = 'gh repo view --json nameWithOwner --jq .nameWithOwner'

// A path that is not there: its stat rejects as a missing path does.
const missingAt = (path: string): Script => ({ [`stat ${path}`]: { rejects: `ENOENT: no such file or directory, stat '${path}'`, code: 'ENOENT' } })

// The links one folder of the configuration folder holds: none when the
// folder is missing, or the links whose full paths are given, which the
// listing names by their last part. `others` are entries of the folder that
// are not links.
function folder(name: 'skills' | 'agents' | 'commands', links: string[] | null, config = CONFIG, others: EntryAnswer[] = []): Script {
  const path = `${config}/${name}`
  if (links === null) return missingAt(path)
  return {
    [`stat ${path}`]: { stat: { kind: 'dir', isLink: false, realPath: path } },
    [`list ${path}`]: { entries: [...others, ...links.map(link => ({ name: link.slice(link.lastIndexOf('/') + 1), isLink: true }))] },
  }
}

// One link that exists and resolves to a folder, which lies in `tree` of the
// repository whose shared git folder is `common`.
function link(path: string, target: string, common = '/repo/.git', tree = '/repo'): Script {
  return {
    [`stat ${path}`]: { stat: { kind: 'dir', isLink: true, realPath: target } },
    [REV_PARSE(target)]: ok(`${common}\n${tree}\n`),
  }
}

// The commands of an update that fast-forwards the main checkout at `dir`:
// it is o/r, its only remote is an ssh address of o/r, it is on the base,
// with no tracked changes, behind the merge commit, and a full clone.
function checkoutAt(dir: string): Script {
  const g = (...args: string[]) => gitAt(dir, ...args)
  return {
    [`${dir}$ ${LOOK_UP}`]: ok('o/r\n'),
    'gh repo view o/r --json url,defaultBranchRef': ok('{"url":"https://github.com/o/r","defaultBranchRef":{"name":"main"}}\n'),
    [g('branch', '--show-current')]: ok('main\n'),
    [g('merge-base', '--is-ancestor', MERGE, 'HEAD')]: [exit(1), ok()],
    [g('remote')]: ok('origin\n'),
    [g('remote', 'get-url', 'origin')]: ok('git@github.com:o/r.git\n'),
    [g('fetch', '--no-write-fetch-head', 'origin', MERGE, '+refs/heads/main:refs/remotes/origin/main')]: ok(),
    [g('cat-file', '-e', `${MERGE}^{commit}`)]: ok(),
    [g('log', '-1', '--format=%T', MERGE)]: ok(`${MERGE_TREE}\n`),
    [g('log', '-1', '--format=%T', 'HEAD')]: ok(`${HEAD_TREE}\n`),
    [g('rev-list', '--objects', '--quiet', '--missing=print', MERGE_TREE, '--not', HEAD_TREE)]: ok(),
    [g('status', '--porcelain', '--untracked-files=no')]: ok(),
    [g('merge', '--ff-only', '--no-overwrite-ignore', MERGE)]: ok('Updating aaaaaaa..fffffff\nFast-forward\n'),
    [g('rev-parse', 'HEAD')]: ok(`${MERGE}\n`),
  }
}

// The standard world: the configuration folder's skills folder holds one
// link into the main checkout /repo of o/r, which checkoutAt describes.
function world(over: Script = {}): Script {
  return {
    ...folder('skills', [`${CONFIG}/skills/implement`]),
    ...folder('agents', null),
    ...folder('commands', null),
    ...link(`${CONFIG}/skills/implement`, '/repo/skills/implement'),
    ...checkoutAt('/repo'),
    ...over,
  }
}

async function updated(script: Script, input: Partial<Input> = {}) {
  const t = ioFrom(script)
  const lines = await updateLinkedCheckout(t.io, { ...INPUT, ...input })
  // No test may see the update run a command that Windows is not known to
  // have.
  expect(t.forbidden).toEqual([])
  return { ...t, lines, text: lines.join('\n') }
}

test('updated from a matched ssh remote: the step text names the checkout, the merge commit, HEAD and the remote by name', async () => {
  const t = await updated(world())
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('/repo')
  expect(t.text).toContain(MERGE)
  expect(t.text).toContain('the remote origin')
  expect(t.text).not.toContain('git@github.com')
  expect(t.ran(MERGE_FF).length).toBe(1)
  expect(t.ran(FETCH).length).toBe(1)
  // Nothing is missing in a full clone, so the object check does not run.
  expect(t.ran(OBJECT_CHECK).length).toBe(0)
})

test('every command runs as an argument vector with a time limit, and every git command in plain English without a password prompt', async () => {
  const t = await updated(world())
  for (const call of t.calls) {
    expect(typeof call.timeoutMs).toBe('number')
    if (call.argv[0] === 'git') expect(call.env).toEqual({ LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' })
  }
  expect(t.ran(FETCH)[0]!.timeoutMs).toBe(120_000)
  expect(t.ran(MERGE_FF)[0]!.timeoutMs).toBe(120_000)
  expect(t.ran(STATUS)[0]!.timeoutMs).toBe(20_000)
})

test('updated from the https address when no remote names the repository', async () => {
  const t = await updated(world({
    [git('remote', 'get-url', 'origin')]: ok('https://github.com/someone/fork.git\n'),
    [FETCH_BY_ADDRESS]: ok(),
  }))
  expect(t.unexpected).toEqual([])
  expect(t.ran(FETCH_BY_ADDRESS).length).toBe(1)
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('https address')
  expect(t.text).toContain('may show ahead of its remote until its next fetch')
  expect(t.text).not.toContain('someone/fork')
})

test('already updated: nothing moves, and the fetch still refreshes the remote-tracking branch from the matched remote', async () => {
  const t = await updated(world({ [ANCESTOR]: ok() }))
  expect(t.unexpected).toEqual([])
  expect(t.ran(FETCH).length).toBe(1)
  expect(t.ran(MERGE_FF).length).toBe(0)
  expect(t.ran(STATUS).length).toBe(0)
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('already held the merge commit')
  expect(t.text).toContain('the remote origin')
})

test('already updated with a refresh fetch that fails: still updated, with one sentence quoting the fetch', async () => {
  const t = await updated(world({ [ANCESTOR]: ok(), [FETCH]: exit(1, 'fatal: could not read from remote repository') }))
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('could not read from remote repository')
  expect(t.text).toContain('may show ahead of its remote until its next fetch')
  expect(t.text).not.toContain('Left alone')
})

test('already updated with no remote naming the repository: nothing is fetched', async () => {
  const t = await updated(world({ [ANCESTOR]: ok(), [git('remote')]: ok('') }))
  expect(t.unexpected).toEqual([])
  expect(t.ran(git('fetch')).length).toBe(0)
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('nothing was fetched')
})

test('not linked: names the merged repository and the repositories the links point into, and moves nothing', async () => {
  const t = await updated(world({ [`/repo$ ${LOOK_UP}`]: ok('x/y\n') }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Not linked')
  expect(t.text).toContain('o/r')
  expect(t.text).toContain('x/y')
  expect(t.ran('git -C /repo fetch').length).toBe(0)
  expect(t.ran('gh repo view o/r').length).toBe(0)
})

test('no links found: names the three folders and the other ways skills load, and runs no git', async () => {
  const t = await updated(world({ ...folder('skills', []) }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('No links found')
  expect(t.text).toContain('/h/.claude/skills')
  expect(t.text).toContain('/h/.claude/agents')
  expect(t.text).toContain('/h/.claude/commands')
  expect(t.text).toContain('--plugin-dir')
  expect(t.calls.filter(call => call.argv[0] === 'git' || call.argv[0] === 'gh')).toEqual([])
})

test('a folder of the configuration folder that is itself a link counts as a link and is listed through the link, and a link to a file counts by its folder', async () => {
  const t = await updated(world({
    [`stat ${CONFIG}/skills`]: { stat: { kind: 'dir', isLink: true, realPath: '/repo/skills' } },
    [`list ${CONFIG}/skills`]: { entries: [{ name: 'implement', kind: 'dir', isLink: false }] },
    [REV_PARSE('/repo/skills')]: ok('/repo/.git\n/repo\n'),
    ...folder('agents', [`${CONFIG}/agents/a.md`]),
    [`stat ${CONFIG}/agents/a.md`]: { stat: { kind: 'file', isLink: true, realPath: '/repo/agents/a.md' } },
    [REV_PARSE('/repo/agents')]: ok('/repo/.git\n/repo\n'),
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  // The folder that is a link is listed by its own path, which follows the
  // link, and every stat asks where the path lands.
  expect(t.fsCalls).toContain(`list ${CONFIG}/skills`)
  expect(t.fsCalls.filter(call => call.startsWith('stat ')).every(call => call.endsWith(' resolve'))).toBe(true)
  // The checkout is looked up once, however many links lead into it.
  expect(t.ran('gh repo view --json nameWithOwner').length).toBe(1)
  expect(t.ran(MERGE_FF).length).toBe(1)
})

test('only the entries the listing marks as links are resolved, and a folder that is not a folder is skipped', async () => {
  const t = await updated(world({
    ...folder('skills', [`${CONFIG}/skills/implement`], CONFIG, [{ name: 'plain', kind: 'dir', isLink: false }, { name: 'notes.md', kind: 'file', isLink: false }]),
    [`stat ${CONFIG}/commands`]: { stat: { kind: 'file', isLink: false, realPath: `${CONFIG}/commands` } },
  }))
  expect(t.unexpected).toEqual([])
  expect(t.fsCalls).not.toContain(`stat ${CONFIG}/skills/plain resolve`)
  expect(t.fsCalls).not.toContain(`list ${CONFIG}/commands`)
  expect(t.text).toContain('Updated')
})

test('only worktrees linked: names the worktree, and the main checkout is not moved', async () => {
  const t = await updated(world({ [REV_PARSE('/repo/skills/implement')]: ok('/repo/.git\n/work/tree\n') }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Only worktrees linked')
  expect(t.text).toContain('/work/tree')
  expect(t.ran('git -C /repo fetch').length).toBe(0)
  expect(t.ran(MERGE_FF).length).toBe(0)
})

test('a worktree link of the merged repository beside a link into the main checkout is named, and the main checkout is updated', async () => {
  const t = await updated(world({
    ...folder('skills', [`${CONFIG}/skills/implement`, `${CONFIG}/skills/spec`]),
    ...link(`${CONFIG}/skills/spec`, '/work/tree/skills/spec', '/repo/.git', '/work/tree'),
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('/work/tree')
  expect(t.text).toContain('worktree')
})

test('nothing to update: a merge into a branch other than the default names that branch and moves nothing', async () => {
  const t = await updated(world(), { base: 'release' })
  expect(t.text).toContain('Nothing to update')
  expect(t.text).toContain('release')
  expect(t.ran('git -C /repo fetch').length).toBe(0)
  expect(t.ran(MERGE_FF).length).toBe(0)
})

test('left alone: a checkout on another branch is never moved', async () => {
  const t = await updated(world({ [BRANCH]: ok('feature\n') }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('/repo')
  expect(t.text).toContain('feature')
  expect(t.text).toContain('New sessions will run the old code until someone updates it.')
  expect(t.ran(MERGE_FF).length).toBe(0)
})

test('left alone: a checkout with a detached HEAD is never moved', async () => {
  const t = await updated(world({ [BRANCH]: ok('\n') }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('detached')
  expect(t.ran(MERGE_FF).length).toBe(0)
})

test('left alone: changes to tracked files stop the fast-forward, and untracked files alone do not', async () => {
  const tracked = await updated(world({ [STATUS]: ok(' M skills/implement/SKILL.md\n') }))
  expect(tracked.text).toContain('Left alone')
  expect(tracked.text).toContain('changes to tracked files')
  expect(tracked.ran(MERGE_FF).length).toBe(0)
  // The status read leaves untracked files out, so a checkout holding only
  // untracked files prints nothing there and is updated.
  const untracked = await updated(world())
  expect(untracked.ran(STATUS)[0]!.argv).toContain('--untracked-files=no')
  expect(untracked.text).toContain('Updated')
})

test('left alone: a merge commit the fetch did not bring, quoting the fetch', async () => {
  const t = await updated(world({
    [FETCH]: exit(128, 'fatal: remote error: upload-pack: not our ref'),
    [git('cat-file', '-e', `${MERGE}^{commit}`)]: exit(1),
  }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('not our ref')
  expect(t.ran(MERGE_FF).length).toBe(0)
  expect(t.ran(LISTING).length).toBe(0)
})

test('a fetch that exits with an error after the merge commit arrived does not stop the update, and adds one sentence', async () => {
  const t = await updated(world({ [FETCH]: exit(1, "error: cannot lock ref 'refs/remotes/origin/main'") }))
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('cannot lock ref')
  expect(t.text).toContain('remote-tracking branch may not have moved')
  expect(t.ran(MERGE_FF).length).toBe(1)
})

test('a partial clone fetches what the merge needs in one batched request a round, and passes the object check', async () => {
  const t = await updated(world({ [LISTING]: [ok(`?${MISSING}\n`), ok('')], [OBJECT_CHECK]: ok(), [BATCHED_FETCH]: ok() }))
  expect(t.unexpected).toEqual([])
  const batched = t.ran(BATCHED_FETCH)
  expect(batched.length).toBe(1)
  expect(batched[0]!.stdin).toBe(`${MISSING}\n`)
  expect(batched[0]!.argv.some(arg => arg.startsWith('--filter'))).toBe(false)
  expect(t.ran(OBJECT_CHECK).length).toBe(1)
  expect(t.text).toContain('Updated')
})

test('left alone: a failed object check, after three rounds at most', async () => {
  const t = await updated(world({ [LISTING]: ok(`?${MISSING}\n`), [OBJECT_CHECK]: exit(1, `fatal: missing blob object '${MISSING}'`), [BATCHED_FETCH]: exit(1, 'fatal: unable to fetch') }))
  expect(t.unexpected).toEqual([])
  expect(t.ran(BATCHED_FETCH).length).toBe(3)
  expect(t.ran(OBJECT_CHECK).length).toBe(1)
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('missing blob object')
  expect(t.ran(MERGE_FF).length).toBe(0)
})

test('a listing that fails runs the object check without a batched fetch', async () => {
  const t = await updated(world({ [LISTING]: exit(129, 'error: unknown option'), [OBJECT_CHECK]: ok() }))
  expect(t.ran(BATCHED_FETCH).length).toBe(0)
  expect(t.ran(OBJECT_CHECK).length).toBe(1)
  expect(t.text).toContain('Updated')
})

test('left alone: a fast-forward that refuses, quoting git', async () => {
  const t = await updated(world({ [MERGE_FF]: exit(128, 'error: The following untracked working tree files would be overwritten by merge') }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('would be overwritten by merge')
  expect(t.ran(MERGE_FF).length).toBe(1)
})

test('a lock that clears on the retry: the checks and the fast-forward run once more, and the checkout is updated', async () => {
  const t = await updated(world({ [MERGE_FF]: [exit(128, LOCK), ok()] }))
  expect(t.ran(MERGE_FF).length).toBe(2)
  expect(t.ran(STATUS).length).toBe(2)
  expect(t.text).toContain('Updated')
})

test('left alone: a lock that does not clear on the one retry', async () => {
  const t = await updated(world({ [MERGE_FF]: exit(128, LOCK) }))
  expect(t.ran(MERGE_FF).length).toBe(2)
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('index.lock')
})

test('left alone: a confirmation that finds another branch checked out names it and the reflog to read, and resets nothing', async () => {
  const t = await updated(world({ [BRANCH]: [ok('main\n'), ok('main\n'), ok('other\n')] }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('other')
  expect(t.text).toContain('git -C /repo reflog -2 other')
  expect(t.calls.some(call => call.argv.includes('reset'))).toBe(false)
})

test('left alone: a confirmation that finds the merge commit is not an ancestor of HEAD', async () => {
  const t = await updated(world({ [ANCESTOR]: exit(1) }))
  expect(t.text).toContain('Left alone')
})

test('left alone: a broken link when nothing matched, since it might have been the match', async () => {
  for (const broken of [missingAt(`${CONFIG}/skills/implement`), { [`stat ${CONFIG}/skills/implement`]: { stat: { kind: 'other', isLink: true } } } as Script]) {
    const t = await updated(world(broken))
    expect(t.unexpected).toEqual([])
    expect(t.text).toContain('Left alone')
    expect(t.text).toContain('/h/.claude/skills/implement')
    expect(t.text).toContain('is broken')
    expect(t.text).not.toContain('Not linked')
    expect(t.text).not.toContain('No links found')
    expect(t.ran('git').length).toBe(0)
  }
})

test('a folder that is itself a broken link is named as broken', async () => {
  const t = await updated(world({
    ...folder('skills', []),
    [`stat ${CONFIG}/agents`]: { stat: { kind: 'other', isLink: true } },
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain(`the link ${CONFIG}/agents is broken`)
  expect(t.fsCalls).not.toContain(`list ${CONFIG}/agents`)
})

test('a link whose stat is refused for a reason other than a missing path could not be resolved, quoting the error, and the other links go on', async () => {
  const t = await updated(world({
    ...folder('skills', [`${CONFIG}/skills/implement`, `${CONFIG}/skills/locked`]),
    [`stat ${CONFIG}/skills/locked`]: { rejects: "EACCES: permission denied, stat '/h/.claude/skills/locked'", code: 'EACCES' },
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  expect(t.text).toContain(`the link ${CONFIG}/skills/locked could not be resolved`)
  expect(t.text).toContain('EACCES: permission denied')
  expect(t.text).not.toContain('broken')
})

test('a folder whose stat is refused for a reason other than a missing path counts as a failed lookup', async () => {
  const t = await updated(world({ [`stat ${CONFIG}/agents`]: { rejects: 'EACCES: permission denied', code: 'EACCES' } }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  expect(t.text).toContain(`the links inside ${CONFIG}/agents could not be listed`)
  expect(t.text).toContain('EACCES: permission denied')
})

test('a missing path is known by an ENOENT code alone or by ENOENT in the message alone', async () => {
  for (const rejection of [{ rejects: 'no such file or directory', code: 'ENOENT' }, { rejects: "ENOENT: no such file or directory, stat '/h/.claude/skills/implement'" }]) {
    const t = await updated(world({ [`stat ${CONFIG}/skills/implement`]: rejection }))
    expect(t.text).toContain('is broken')
    expect(t.text).not.toContain('could not be resolved')
  }
})

test('left alone: a failed lookup when nothing matched', async () => {
  const t = await updated(world({ [`/repo$ ${LOOK_UP}`]: exit(1, 'HTTP 502') }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('HTTP 502')
  expect(t.text).not.toContain('Not linked')
})

test('a broken link elsewhere, when one checkout matched, is named in one sentence and does not stop the update', async () => {
  const t = await updated(world({
    ...folder('skills', [`${CONFIG}/skills/implement`, `${CONFIG}/skills/gone`]),
    ...missingAt(`${CONFIG}/skills/gone`),
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  expect(t.text).toContain('/h/.claude/skills/gone')
  expect(t.text).toContain('broken')
})

test('a link outside any git repository points into no checkout and is skipped', async () => {
  const t = await updated(world({
    ...folder('skills', [`${CONFIG}/skills/implement`, `${CONFIG}/skills/loose`]),
    ...link(`${CONFIG}/skills/loose`, '/loose'),
    [REV_PARSE('/loose')]: exit(128, 'fatal: not a git repository (or any of the parent directories): .git'),
  }))
  expect(t.text).toContain('Updated')
  expect(t.text).not.toContain('/loose')
})

test('a command that throws, as one past its time limit does, counts as failed at that point', async () => {
  const t = await updated(world({ [MERGE_FF]: { throws: true } }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('time limit')
})

test('left alone: a listing of links that is refused counts as a failed lookup, quoting the error, and nothing is fast-forwarded', async () => {
  const t = await updated(world({ [`list ${CONFIG}/skills`]: { rejects: 'EMFILE: too many open files', code: 'EMFILE' } }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain(`the links inside ${CONFIG}/skills could not be listed`)
  expect(t.text).toContain('EMFILE: too many open files')
  expect(t.text).not.toContain('Updated')
  expect(t.ran(git('fetch')).length).toBe(0)
  expect(t.ran(MERGE_FF).length).toBe(0)
})

test('left alone: an address from GitHub that carries credentials is never fetched from when no remote names the repository', async () => {
  const t = await updated(world({
    [git('remote', 'get-url', 'origin')]: ok('https://github.com/someone/fork.git\n'),
    'gh repo view o/r --json url,defaultBranchRef': ok('{"url":"https://user:token@github.com/o/r","defaultBranchRef":{"name":"main"}}\n'),
  }))
  expect(t.text).toContain('Left alone')
  expect(t.text).toContain('GitHub gave no https address to fetch from')
  expect(t.text).not.toContain('token')
  expect(t.text).not.toContain('user:')
  expect(t.ran(git('fetch')).length).toBe(0)
  expect(t.ran(MERGE_FF).length).toBe(0)
})

// An update that finds no configuration folder: one sentence, and no command
// or file call at all.
async function folderless(input: Partial<Input>) {
  const t = ioFrom(world())
  const lines = await updateLinkedCheckout(t.io, { ...INPUT, ...input })
  expect(t.calls).toEqual([])
  expect(t.fsCalls).toEqual([])
  expect(lines.length).toBe(1)
  expect(lines[0]).toContain('Left alone: no linked checkout was updated')
  return lines[0]!
}

test('left alone, with no command or file call, when CLAUDE_CONFIG_DIR, HOME and USERPROFILE are all unset or empty', async () => {
  for (const input of [{ home: undefined }, { configDir: '', home: '', userProfile: '' }, { configDir: undefined, home: '', userProfile: undefined }]) {
    const line = await folderless(input)
    expect(line).toContain("Claude Code's configuration folder could not be found")
    expect(line).toContain('CLAUDE_CONFIG_DIR, HOME and USERPROFILE are all unset or empty')
    expect(line).not.toContain('~/.claude')
  }
})

test('left alone, with no command or file call, when CLAUDE_CONFIG_DIR is a relative path, naming its value, even with HOME set', async () => {
  const line = await folderless({ configDir: 'conf/claude', home: HOME })
  expect(line).toContain('CLAUDE_CONFIG_DIR is set to conf/claude, which is not an absolute path')
  expect(line).toContain("Claude Code's configuration folder could not be found")
})

test('left alone, with no command or file call, when CLAUDE_CONFIG_DIR is only slashes, which names no folder rather than a relative path', async () => {
  const line = await folderless({ configDir: '/', home: HOME })
  expect(line).toContain('CLAUDE_CONFIG_DIR is set to /')
  expect(line).toContain('names no folder')
  expect(line).not.toContain('not an absolute path')
})

test('left alone, with no command or file call, when HOME is a relative path and USERPROFILE is not set', async () => {
  const line = await folderless({ home: 'h', userProfile: undefined })
  expect(line).toContain('CLAUDE_CONFIG_DIR is unset or empty, and neither HOME nor USERPROFILE is set to an absolute path')
})

test('the update never runs test, realpath or find, and finds the links with stat and list alone', async () => {
  const t = await updated(world())
  expect(t.calls.filter(call => ['test', 'realpath', 'find'].includes(call.argv[0]!))).toEqual([])
  expect(t.fsCalls).toEqual([
    `stat ${CONFIG}/skills resolve`, `list ${CONFIG}/skills`, `stat ${CONFIG}/skills/implement resolve`,
    `stat ${CONFIG}/agents resolve`, `stat ${CONFIG}/commands resolve`,
  ])
  expect(t.text).toContain('Updated')
})

test('CLAUDE_CONFIG_DIR, with its trailing slashes dropped, is searched instead of HOME, and the not-linked sentence names it', async () => {
  const at = (over: Script = {}): Script => ({
    ...folder('skills', ['/c/skills/implement'], '/c'),
    ...folder('agents', null, '/c'),
    ...folder('commands', null, '/c'),
    ...link('/c/skills/implement', '/repo/skills/implement'),
    ...checkoutAt('/repo'),
    ...over,
  })
  const t = await updated(at(), { configDir: '/c//', home: HOME })
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
  expect(t.fsCalls.some(call => call.startsWith(`stat ${CONFIG}`))).toBe(false)

  const other = await updated(at({ [`/repo$ ${LOOK_UP}`]: ok('x/y\n') }), { configDir: '/c', home: HOME })
  expect(other.text).toContain('Not linked: o/r merged, and the links under /c point into x/y')
})

test('HOME is searched before USERPROFILE, and USERPROFILE when HOME is unset', async () => {
  const first = await updated(world(), { home: HOME, userProfile: '/u' })
  expect(first.unexpected).toEqual([])
  expect(first.text).toContain('Updated')

  const t = await updated({
    ...folder('skills', ['/u/.claude/skills/implement'], '/u/.claude'),
    ...folder('agents', null, '/u/.claude'),
    ...folder('commands', null, '/u/.claude'),
    ...link('/u/.claude/skills/implement', '/repo/skills/implement'),
    ...checkoutAt('/repo'),
  }, { home: undefined, userProfile: '/u' })
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated')
})

// The configuration folder that USERPROFILE gives on Windows, and a world of
// links in it.
const WIN = 'C:\\Users\\me'
const WIN_CONFIG = `${WIN}/.claude`
function windows(over: Script): Script {
  return {
    ...folder('skills', [`${WIN_CONFIG}/skills/implement`], WIN_CONFIG),
    ...folder('agents', null, WIN_CONFIG),
    ...folder('commands', null, WIN_CONFIG),
    ...over,
  }
}
const onWindows = { home: undefined, userProfile: WIN }

test('on a drive, a target with backslashes and a lower-case drive and git output with an upper-case drive and slashes are matched, and git runs on each path as written', async () => {
  const t = await updated(windows({
    ...link(`${WIN_CONFIG}/skills/implement`, 'c:\\repo\\skills\\implement', 'c:/repo/.git', 'C:\\repo\\'),
    ...checkoutAt('c:/repo'),
  }), onWindows)
  expect(t.unexpected).toEqual([])
  expect(t.fsCalls).toContain(`list ${WIN_CONFIG}/skills`)
  expect(t.ran(REV_PARSE('c:\\repo\\skills\\implement')).length).toBe(1)
  expect(t.text).toContain(`Updated: the linked checkout c:/repo now holds the merge commit ${MERGE}`)
  expect(t.ran(gitAt('c:/repo', 'merge', '--ff-only', '--no-overwrite-ignore', MERGE)).length).toBe(1)
})

test('on a drive, two spellings of one main checkout are looked up and moved once, and two spellings of one target share one git lookup', async () => {
  const t = await updated(windows({
    ...folder('skills', [`${WIN_CONFIG}/skills/implement`, `${WIN_CONFIG}/skills/again`], WIN_CONFIG),
    ...link(`${WIN_CONFIG}/skills/implement`, 'C:\\repo\\skills\\implement', 'C:/repo/.git', 'C:/repo'),
    [`stat ${WIN_CONFIG}/skills/again`]: { stat: { kind: 'dir', isLink: true, realPath: 'c:/repo/skills/implement/' } },
    ...folder('agents', [`${WIN_CONFIG}/agents/a.md`], WIN_CONFIG),
    [`stat ${WIN_CONFIG}/agents/a.md`]: { stat: { kind: 'file', isLink: true, realPath: 'c:\\repo\\agents\\a.md' } },
    [REV_PARSE('c:\\repo\\agents')]: ok('c:\\repo\\.git\nc:\\repo\n'),
    ...checkoutAt('C:/repo'),
  }), onWindows)
  expect(t.unexpected).toEqual([])
  expect(t.ran('git -C ').filter(call => call.argv.includes('rev-parse') && call.argv.includes('--git-common-dir')).length).toBe(2)
  expect(t.ran(LOOK_UP).length).toBe(1)
  expect(t.ran(LOOK_UP)[0]!.cwd).toBe('C:/repo')
  expect(t.ran(gitAt('C:/repo', 'merge', '--ff-only', '--no-overwrite-ignore', MERGE)).length).toBe(1)
  expect(t.text).toContain('Updated: the linked checkout C:/repo now holds')
  expect(t.text).not.toContain('worktree')
})

test('on a drive, the rest of the path keeps its case, so a main checkout C:/a and a top folder C:/A are not the same checkout', async () => {
  const t = await updated(windows({
    ...link(`${WIN_CONFIG}/skills/implement`, 'C:\\a\\skills\\implement', 'C:/a/.git', 'C:/A'),
    ...checkoutAt('C:/a'),
  }), onWindows)
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Only worktrees linked')
  expect(t.text).toContain('C:/A')
  expect(t.ran(gitAt('C:/a', 'merge')).length).toBe(0)
  expect(t.ran(gitAt('C:/a', 'fetch')).length).toBe(0)
})

test('on a drive, a link to a file runs git in its parent folder, and one at the top of the drive in the top of the drive, never in a bare drive letter', async () => {
  const t = await updated(windows({
    ...folder('agents', [`${WIN_CONFIG}/agents/a.md`, `${WIN_CONFIG}/agents/top.md`], WIN_CONFIG),
    [`stat ${WIN_CONFIG}/agents/a.md`]: { stat: { kind: 'file', isLink: true, realPath: 'C:\\repo\\agents\\a.md' } },
    [`stat ${WIN_CONFIG}/agents/top.md`]: { stat: { kind: 'file', isLink: true, realPath: 'C:\\top.md' } },
    [REV_PARSE('C:\\repo\\agents')]: ok('C:/repo/.git\nC:/repo\n'),
    [REV_PARSE('C:\\')]: exit(128, 'fatal: not a git repository (or any of the parent directories): .git'),
    ...link(`${WIN_CONFIG}/skills/implement`, 'C:\\repo\\skills\\implement', 'C:/repo/.git', 'C:/repo'),
    ...checkoutAt('C:/repo'),
  }), onWindows)
  expect(t.unexpected).toEqual([])
  expect(t.ran(REV_PARSE('C:\\repo\\agents')).length).toBe(1)
  expect(t.ran(REV_PARSE('C:\\')).length).toBe(1)
  expect(t.ran('git -C C: ').length).toBe(0)
  expect(t.text).toContain('Updated: the linked checkout C:/repo')
})

test('on macOS, a target that resolves through /private matches the main checkout git gives for it', async () => {
  const t = await updated(world({
    ...link(`${CONFIG}/skills/implement`, '/private/var/t/repo/skills/implement', '/private/var/t/repo/.git', '/private/var/t/repo'),
    ...checkoutAt('/private/var/t/repo'),
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('Updated: the linked checkout /private/var/t/repo now holds')
  expect(t.ran(gitAt('/private/var/t/repo', 'merge', '--ff-only', '--no-overwrite-ignore', MERGE)).length).toBe(1)
})


test('left alone, with no command run, for a repository, base or merge commit that is not safe to pass to git', async () => {
  for (const over of [{ repo: 'o/r; rm' }, { base: '--upload-pack=x' }, { merge: 'HEAD' }, { merge: 'f'.repeat(64) }]) {
    const t = ioFrom(world())
    const lines = await updateLinkedCheckout(t.io, { ...INPUT, ...over })
    expect(lines.join('\n')).toContain('Left alone')
    expect(t.calls).toEqual([])
  }
})

test('a remote names the repository at the end of its address, after slashes and .git, without regard to case', () => {
  for (const address of [
    'https://github.com/o/r.git', 'https://github.com/o/r', 'https://github.com/O/R/', 'git@github.com:o/r.git',
    'git@github-work:o/r', 'ssh://git@github.com/o/r.git', 'https://github.com/o/r.git/',
  ]) expect(namesRepository(address, 'o/r')).toBe(true)
  for (const address of ['https://github.com/xo/r.git', 'git@github.com:o/rr.git', 'https://github.com/o/r/extra', 'o/r']) {
    expect(namesRepository(address, 'o/r')).toBe(false)
  }
})

test('the source among several remotes: the one the base tracks, then origin, then the first in byte order', () => {
  expect(sourceOf(['b'], null)).toBe('b')
  expect(sourceOf(['b', 'origin', 'up'], 'up')).toBe('up')
  expect(sourceOf(['b', 'origin', 'up'], 'gone')).toBe('origin')
  expect(sourceOf(['b', 'a', 'Z'], null)).toBe('Z')
  expect(sourceOf([], null)).toBe(null)
})

test('several remotes naming the repository fetch from the one the base tracks', async () => {
  const t = await updated(world({
    [git('remote')]: ok('origin\nupstream\n'),
    [git('remote', 'get-url', 'upstream')]: ok('https://github.com/o/r.git\n'),
    [git('config', 'branch.main.remote')]: ok('upstream\n'),
    [git('fetch', '--no-write-fetch-head', 'upstream', MERGE, '+refs/heads/main:refs/remotes/upstream/main')]: ok(),
  }))
  expect(t.unexpected).toEqual([])
  expect(t.text).toContain('the remote upstream')
})

const TOKEN = `ghp_${'A'.repeat(36)}`

test('a quoted message loses anything shaped like a token, a key or credentials in an address, even at the cut', () => {
  expect(quoted(`fatal: ${TOKEN} refused`)).not.toContain(TOKEN.slice(0, 12))
  expect(quoted(`key sk-${'x'.repeat(30)} and AKIA${'B'.repeat(16)}`)).not.toMatch(/sk-x|AKIAB/)
  const key = quoted('before\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\nafter')
  expect(key).toContain('before')
  expect(key).not.toContain('b3BlbnNzaC1rZXktdjEAAAAA')
  expect(key).not.toContain('after')
  const address = quoted("fatal: unable to access 'https://me:hunter2@github.com/o/r/': 403")
  expect(address).not.toContain('hunter2')
  expect(address).not.toContain('github.com/o/r')
  expect(quoted('fatal: could not read from git@github.com:o/r.git')).not.toContain('git@github.com')
  // A token that the cut would leave half of is removed before the cut.
  const cut = quoted(`${'x'.repeat(290)} ${TOKEN}`)
  expect(cut.length).toBeLessThanOrEqual(300)
  expect(cut).not.toContain('ghp_')
  expect(quoted('a\nb\u001b[31m c')).toBe('a b c')
})

test('a token in a message git printed is stored and shown without it', async () => {
  const t = ioFrom(world({ [MERGE_FF]: exit(128, `fatal: https://x-access-token:${TOKEN}@github.com refused ${TOKEN}`) }))
  const lines = await linkedCheckout(t.io, linkedKey('o/r', 7), { ...INPUT, now: 1 })
  expect(lines.join('\n')).toContain('Left alone')
  expect(lines.join('\n')).not.toContain(TOKEN.slice(0, 12))
  expect(JSON.stringify([...t.store.values()])).not.toContain(TOKEN.slice(0, 12))
})

test('the record of the start is written before the first command runs, and holds the outcome when the update ends', async () => {
  const t = ioFrom(world())
  const key = linkedKey('o/r', 7)
  let seenAtFirst: unknown = 'nothing ran'
  const run = t.io.process.run
  t.io.process.run = async (argv, init) => {
    if (seenAtFirst === 'nothing ran') seenAtFirst = t.store.get(key)
    return run(argv, init)
  }
  const lines = await linkedCheckout(t.io, key, { ...INPUT, now: 5 })
  expect(seenAtFirst).toEqual({ merge: MERGE, at: 5 })
  expect(t.store.get(key)).toEqual({ merge: MERGE, at: 5, lines })
  expect(key).toBe('linked-checkout:o/r#7')
})

test('two looks at the same moment run the update once and both get its outcome', async () => {
  const t = ioFrom(world())
  const key = linkedKey('o/r', 7)
  const [one, two] = await Promise.all([linkedCheckout(t.io, key, { ...INPUT, now: 1 }), linkedCheckout(t.io, key, { ...INPUT, now: 2 })])
  expect(one).toEqual(two)
  expect(one.join('\n')).toContain('Updated')
  expect(t.ran(MERGE_FF).length).toBe(1)
})

test('a later look for a recorded merge commit runs nothing and uses the record', async () => {
  const t = ioFrom(world())
  const key = linkedKey('o/r', 7)
  const first = await linkedCheckout(t.io, key, { ...INPUT, now: 1 })
  const count = t.calls.length
  expect(await linkedCheckout(t.io, key, { ...INPUT, now: 2 })).toEqual(first)
  expect(await recordedLinked(t.io, key)).toEqual(first)
  expect(t.calls.length).toBe(count)
})

test('a record of an update that started and holds no outcome reads as left alone, and nothing runs again', async () => {
  const key = linkedKey('o/r', 7)
  for (const seeded of [{ merge: MERGE, at: 1 }, 'damaged']) {
    const t = ioFrom(world(), new Map([[key, seeded]]))
    const lines = await linkedCheckout(t.io, key, { ...INPUT, now: 2 })
    expect(lines).toEqual([STARTED_NOT_FINISHED])
    expect(STARTED_NOT_FINISHED).toContain('Left alone')
    expect(STARTED_NOT_FINISHED).toContain('started and did not finish')
    expect(await recordedLinked(t.io, key)).toEqual([STARTED_NOT_FINISHED])
    expect(t.calls).toEqual([])
  }
})

test('with no record, the store read alone gives no outcome', async () => {
  const t = ioFrom(world())
  expect(await recordedLinked(t.io, linkedKey('o/r', 7))).toBe(null)
  expect(t.calls).toEqual([])
})

test('a stored record reads back only in its own shape', () => {
  expect(linkedRecordIn({ merge: MERGE, at: 1, lines: ['a'] })).toEqual({ merge: MERGE, at: 1, lines: ['a'] })
  expect(linkedRecordIn({ merge: MERGE, at: 1 })).toEqual({ merge: MERGE, at: 1 })
  expect(linkedRecordIn({ merge: MERGE, at: 1, lines: [1] })).toEqual({ merge: MERGE, at: 1 })
  for (const raw of [null, 'x', { merge: 1, at: 1 }, { merge: MERGE }]) expect(linkedRecordIn(raw)).toBe(null)
})

test('a store that fails gives a left-alone outcome rather than an error', async () => {
  const t = ioFrom(world())
  t.io.store.set = async () => { throw new Error('the store is full') }
  const lines = await linkedCheckout(t.io, linkedKey('o/r', 7), { ...INPUT, now: 1 })
  expect(lines.join('\n')).toContain('Left alone')
  expect(t.calls).toEqual([])
})

test('an outcome longer than the step accepts is cut to that length, its last sentence counting what was left out', () => {
  const short = Array.from({ length: LINKED_KEPT }, (_, i) => `line ${i}`)
  expect(withinKept(short)).toEqual(short)
  const long = Array.from({ length: LINKED_KEPT + 5 }, (_, i) => `line ${i}`)
  const cut = withinKept(long)
  expect(cut.length).toBe(LINKED_KEPT)
  expect(cut.slice(0, -1)).toEqual(long.slice(0, LINKED_KEPT - 1))
  expect(cut.at(-1)).toBe('The outcome went on for 6 more sentences, which are left out here.')
})
