import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ElementQuery, Engine, FoundElement } from 'claude-code/testing'

import { RUNS_JQ, snapshotOf, type GhPullRequest } from '../hooks/github'
import { NOTHING_WATCHED, STALE_WARNING } from '../hooks/pane'
import type { BuildStatus } from '../types'

const A = 'a'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const E = 'e'.repeat(40)

function openPullRequest(over: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    baseRefName: 'main',
    headRefName: 'feature',
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
  } as GhPullRequest
}

// A worktree as `git worktree list` sees it. One with no branch is detached,
// and a prunable one is listed though its folder is gone.
type Worktree = { path: string; head?: string; branch?: string; prunable?: boolean }

// One worktree's record in the output of `git worktree list --porcelain -z`:
// each field ends with a NUL byte, and an empty field ends the record.
function worktreeRecord(w: Worktree, head: string): string {
  const fields = [`worktree ${w.path}`, `HEAD ${w.head ?? head}`, w.branch === undefined ? 'detached' : `branch refs/heads/${w.branch}`]
  if (w.prunable) fields.push('prunable gitdir file points to non-existent location')
  return `${fields.map(f => `${f}\0`).join('')}\0`
}

// Answers the mod's gh calls from memory, as repository o/r with pull
// request #7 open, and records every call.
function fakeGitHub(on: On) {
  // `head` is where the local checkout of #7 stands.
  // `hold`, when set, keeps the next read of #7 waiting until it resolves,
  // answering with the pull request as it was when the read began.
  // `readsToFail` makes that many reads of #7 fail, as gh offline does, and
  // `readsThrow` makes every read of #7 throw instead of answering, as the
  // engine does when gh cannot start or runs past its timeout.
  // `onPost`, when set, runs as a review is posted on #7, so a test can
  // change what GitHub shows from then on.
  // `runs` are the head's unfinished workflow runs, printed one JSON line
  // each as `gh api --jq` prints them, and `runsReadsToFail` makes that many
  // reads of them fail. `runsReadsCut` makes every read of them answer the
  // runs with exit code 0 but say its output was cut off, and
  // `runsReadsThrow` makes every read of them throw instead of answering.
  // `loginThrows` makes the read of the gh login throw, and `fetchesThrow`
  // makes `git fetch` throw, in the same way.
  // `ran` records each command with the folder it ran in, beside `calls`.
  // `heads` and `gitDirs` give the commit and the git folder of a folder other
  // than the session's, which stands at `head` with its git folder at
  // `/repo/.git`. `worktrees` is what `git worktree list --porcelain -z`
  // lists, each at its own head unless one is given, and `worktreesFail` makes
  // that listing exit with an error, throw, or say its output was cut off,
  // while still printing the list, so code that read a failed listing would
  // be caught. Every command run in a folder named in `throwsIn` throws, as
  // one does in a folder that is gone.
  // `changed` names the paths that differ between two commits, relative to
  // the folder git runs in, keyed by the two commits with a space between in
  // either order, and `git diff --quiet` exits 1 when one of them matches its
  // pathspecs, else 0. `diffExit`, when set, is the exit code of every
  // `git diff --quiet` instead, and `onQuietDiff`, when set, runs before each
  // `git diff --quiet` answers, as a checkout moving while git runs would.
  // `afterQuietDiff`, when set, runs once each `git diff --quiet` has found
  // its answer and before it returns, as a checkout moving again would.
  // Every git command run in a folder named in `notCheckouts` exits 128, as it
  // does in a folder that is not a checkout. `headHolds` keeps the next
  // `git rev-parse HEAD` in each folder it names waiting until its promise
  // resolves, as a slow git does, and it then answers the head from when it
  // was called, as git does once it has read HEAD.
  // `messages` are the branch's commits, oldest first, with their full
  // messages, as `git log --format=%H%x1f%B%x1e` prints them, and
  // `messagesFail` makes that read exit with an error.
  // `states` gives the state that `gh pr view <n> --repo o/r --json state`
  // answers for pull request n; a number not listed answers the state of
  // `pr`. `stateRead`, when set, makes every such read exit with an error,
  // throw, answer with its output cut off, or answer text that is not JSON.
  const world = {
    pr: openPullRequest(), calls: [] as string[], removalsToFail: 0, labelMissing: false, head: C,
    hold: null as Promise<void> | null, cutDiff: false, otherNumber: 0, readsToFail: 0,
    gitDirFails: false, postsToFail: 0, onPost: null as (() => void) | null,
    runs: [] as { id: number; run_attempt: number; name: string }[], runsReadsToFail: 0,
    runsReadsCut: false, runsReadsThrow: false, readsThrow: false, loginThrows: false, fetchesThrow: false,
    ran: [] as { argv: string; cwd: string | undefined }[],
    heads: {} as Record<string, string>, gitDirs: {} as Record<string, string>,
    worktrees: [{ path: '/repo', branch: 'feature' }] as Worktree[],
    worktreesFail: null as null | 'exit' | 'throw' | 'cut', throwsIn: [] as string[],
    changed: {} as Record<string, string[]>, diffExit: null as number | null, notCheckouts: [] as string[],
    onQuietDiff: null as (() => void) | null, afterQuietDiff: null as (() => void) | null, headHolds: {} as Record<string, Promise<void>>,
    states: {} as Record<number, string>, stateRead: null as null | 'exit' | 'throw' | 'cut' | 'text',
    messages: [{ sha: A, message: 'Build it' }] as { sha: string; message: string }[], messagesFail: false,
  }
  on('process.run', async ($, e) => {
    const argv = e.argv.join(' ')
    const cwd = e.init?.cwd
    world.calls.push(argv)
    world.ran.push({ argv, cwd })
    if (cwd !== undefined && world.throwsIn.includes(cwd)) throw new Error('the process could not be started')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const exit = (exitCode: number) => ({ value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv.startsWith('git ') && cwd !== undefined && world.notCheckouts.includes(cwd)) return exit(128)
    if (argv === 'git worktree list --porcelain -z') {
      const listing = world.worktrees.map(w => worktreeRecord(w, world.heads[w.path] ?? world.head)).join('')
      if (world.worktreesFail === 'throw') throw new Error('the process could not be started')
      if (world.worktreesFail === 'exit') {
        return { value: { exitCode: 128, stdout: listing, stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      if (world.worktreesFail === 'cut') {
        return { value: { exitCode: 0, stdout: listing, stderr: '', isStdoutTruncated: true, isStderrTruncated: false } }
      }
      return out(listing)
    }
    const headHold = argv === 'git rev-parse HEAD' && cwd !== undefined ? world.headHolds[cwd] : undefined
    if (headHold !== undefined) {
      const heldHead = world.heads[cwd as string] ?? world.head
      delete world.headHolds[cwd as string]
      await headHold
      return out(`${heldHead}\n`)
    }
    if (argv === 'git rev-parse HEAD') return out(`${(cwd === undefined ? undefined : world.heads[cwd]) ?? world.head}\n`)
    if (argv === 'git rev-parse --absolute-git-dir' && world.gitDirFails) {
      return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv === 'git rev-parse --absolute-git-dir') return out(`${(cwd === undefined ? undefined : world.gitDirs[cwd]) ?? '/repo/.git'}\n`)
    if (argv.startsWith('git fetch') && world.fetchesThrow) throw new Error('the process could not be started')
    if (argv.startsWith('git fetch')) return out('')
    if (argv.startsWith('git diff --quiet ')) {
      world.onQuietDiff?.()
      const finds = quietDiffFinds(world, e.argv.slice(3))
      world.afterQuietDiff?.()
      if (world.diffExit !== null) return exit(world.diffExit)
      return exit(finds ? 1 : 0)
    }
    if (argv.startsWith('git diff --stat')) return out(' a.ts | 2 +-\n 1 file changed\n')
    if (argv.startsWith('git diff') && world.cutDiff) {
      return { value: { exitCode: 0, stdout: 'diff --git a/a.ts', stderr: '', isStdoutTruncated: true, isStderrTruncated: false } }
    }
    if (argv.startsWith('git diff')) return out('diff --git a/a.ts b/a.ts\n')
    if (argv.startsWith('git log') && argv.includes('%x1f') && world.messagesFail) return exit(128)
    if (argv.startsWith('git log') && argv.includes('%x1f')) return out(world.messages.map(m => `${m.sha}\u001f${m.message}\n\u001e\n`).join(''))
    if (argv.startsWith('git log')) return out('aaaaaaa Build it\nM\ta.ts\n')
    if (argv.startsWith('gh api repos/o/r/pulls/7/reviews') && world.postsToFail > 0) {
      world.postsToFail -= 1
      return { value: { exitCode: 1, stdout: '', stderr: 'network', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv.startsWith('gh api repos/o/r/pulls/7/reviews')) {
      world.onPost?.()
      return out('https://github.com/o/r/pull/7#pullrequestreview-1\n')
    }
    if (world.otherNumber !== 0 && argv.startsWith(`gh api repos/o/r/pulls/${world.otherNumber}/reviews`)) {
      return out(`https://github.com/o/r/pull/${world.otherNumber}#pullrequestreview-2\n`)
    }
    if (argv.startsWith('gh api --paginate repos/o/r/actions/runs?') && world.runsReadsToFail > 0) {
      world.runsReadsToFail -= 1
      return { value: { exitCode: 1, stdout: '', stderr: 'HTTP 403', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv.startsWith('gh api --paginate repos/o/r/actions/runs?') && world.runsReadsThrow) {
      throw new Error('the process could not be started')
    }
    if (argv.startsWith('gh api --paginate repos/o/r/actions/runs?') && world.runsReadsCut) {
      const stdout = world.runs.map(r => `${JSON.stringify(r)}\n`).join('')
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: true, isStderrTruncated: false } }
    }
    if (argv.startsWith('gh api --paginate repos/o/r/actions/runs?')) return out(world.runs.map(r => `${JSON.stringify(r)}\n`).join(''))
    const stateRead = /^gh pr view (\d+) --repo o\/r --json state$/.exec(argv)
    if (stateRead !== null) {
      const answer = JSON.stringify({ state: world.states[Number(stateRead[1])] ?? world.pr.state })
      if (world.stateRead === 'throw') throw new Error('the process could not be started')
      if (world.stateRead === 'exit') {
        return { value: { exitCode: 1, stdout: answer, stderr: 'network', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      if (world.stateRead === 'cut') {
        return { value: { exitCode: 0, stdout: answer, stderr: '', isStdoutTruncated: true, isStderrTruncated: false } }
      }
      return out(world.stateRead === 'text' ? 'state: OPEN\n' : `${answer}\n`)
    }
    if (argv.startsWith('gh repo view')) return out('o/r\n')
    if (argv.startsWith('gh api user') && world.loginThrows) throw new Error('the process could not be started')
    if (argv.startsWith('gh api user')) return out('owner\n')
    if (argv.startsWith('gh pr view 7') && argv.includes('--json labels ')) {
      return out(JSON.stringify((world.pr.labels ?? []).map(label => label.name)))
    }
    if (world.otherNumber !== 0 && argv.startsWith(`gh pr view ${world.otherNumber} `)) return out(JSON.stringify(world.pr))
    if (argv.startsWith('gh pr view 7') && world.readsThrow) throw new Error('the process could not be started')
    if (argv.startsWith('gh pr view 7') && world.readsToFail > 0) {
      world.readsToFail -= 1
      return { value: { exitCode: 1, stdout: '', stderr: 'network', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv.startsWith('gh pr view 7')) {
      const seen = JSON.stringify(world.pr)
      const hold = world.hold
      world.hold = null
      if (hold !== null) await hold
      return out(seen)
    }
    if (argv.includes('--remove-label') && world.removalsToFail > 0) {
      world.removalsToFail -= 1
      return { value: { exitCode: 1, stdout: '', stderr: 'network', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv.startsWith('gh label create')) {
      world.labelMissing = false
      return out('')
    }
    if (argv.includes('--add-label') && world.labelMissing) {
      return { value: { exitCode: 1, stdout: '', stderr: 'label not found', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv.startsWith('gh pr edit')) return out('')
    return { value: { exitCode: 1, stdout: '', stderr: `unexpected: ${argv}`, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return world
}

// Whether `git diff --quiet <a> <b> -- <pathspecs>` finds a difference in the
// fake's world: a path that `changed` names for the two commits matches an
// included pathspec, exactly or as a folder holding it, and no excluded one.
// The mod names the two commits it compares, never the word `HEAD`, so a
// `HEAD` among the arguments is refused like any other unexpected call.
function quietDiffFinds(world: { changed: Record<string, string[]> }, args: string[]): boolean {
  const [a, b, dashes, ...specs] = args
  if (dashes !== '--' || a === undefined || b === undefined || a === 'HEAD' || b === 'HEAD') throw new Error(`unexpected git diff --quiet ${args.join(' ')}`)
  const paths = world.changed[`${a} ${b}`] ?? world.changed[`${b} ${a}`] ?? []
  const matches = (path: string, spec: string) => path === spec || path.startsWith(`${spec}/`)
  const included = specs.filter(spec => !spec.startsWith(':(exclude)'))
  const excluded = specs.filter(spec => spec.startsWith(':(exclude)')).map(spec => spec.slice(':(exclude)'.length))
  return paths.some(path => included.some(spec => matches(path, spec)) && !excluded.some(spec => matches(path, spec)))
}

// What the engine answers beneath the mod in a session: registrations land,
// and the session starts. `schemas`, when given, collects each tool's input
// schema by name. `id`, when given, answers the asks for the session's id in
// place of the plain answer, since the kit takes one hook for them.
function engine(on: On, schemas?: Record<string, unknown>, id?: () => Promise<{ value: string }>) {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => {
    if (schemas) schemas[e.name] = e.inputSchema
    return { value: { tool: `mcp__builder__${e.name}` } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', id ?? (() => ({ value: 'session-1' })))
}

// Starts watching #7 the way /implement does, through the watch tool.
async function watch($: Engine) {
  const call = $.tool.call as unknown as (input: object) => Promise<unknown>
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await call({ tool: 'mcp__builder__watch', number: 7 })
}

function recordPrompts(on: On) {
  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  return prompts
}

test('starting a session watches nothing until the watch tool is called', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  await clock.advance(30 * 60_000)

  expect(world.calls).toEqual([])
  expect(prompts).toEqual([])
})

test('a poll that finds nothing changed starts no turn, and one that finds the checks failed starts one', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)

  await watch($)
  await clock.settle()
  await clock.advance(10 * 60_000)
  expect(prompts).toEqual([])

  world.pr = openPullRequest({
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
  })
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The checks went from passed to failed.')
  expect(prompts[0]).toContain('Continue /implement from this state.')

  // The same failed state found again is not handed over twice.
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
})

test('a new head is reported once, with the move named', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)

  await watch($)
  await clock.settle()
  world.pr = openPullRequest({ headRefOid: D, commits: [{ oid: C }, { oid: D }] })
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain(`The head moved from ${C.slice(0, 8)} to ${D.slice(0, 8)}.`)
})

test('a question to the owner puts needs-decision on the pull request and takes it off once answered', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  let labelledWhileAsking = false
  on('tool.call', async () => {
    // The owner takes a while to answer, as a person does.
    await clock.settle()
    labelledWhileAsking = world.calls.includes('gh pr edit 7 --repo o/r --add-label needs-decision')
    return { result: { answers: {} } }
  })

  await watch($)
  await clock.settle()
  const call = $.tool.call as unknown as (input: object) => Promise<unknown>
  await call({ tool: 'AskUserQuestion', questions: [{ question: 'Which name?' }] })
  await clock.settle()

  expect(labelledWhileAsking).toBe(true)
  expect(world.calls).toContain('gh pr edit 7 --repo o/r --remove-label needs-decision')
})

test('the watch tool starts watching the named pull request and answers with its state', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)

  // Called through a looser signature: the typed one on an MCP tool name
  // sends the type checker into an endless instantiation.
  const call = $.tool.call as unknown as (input: object) => Promise<{ result?: unknown }>
  const ran = await call({ tool: 'mcp__builder__watch', number: 7 })

  expect(String(ran.result)).toContain('builder: Watching this pull request.')
  expect(String(ran.result)).toContain('Checks: passed.')
})

test('the watch tool answers that gh could not read the pull request when the read throws', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.readsThrow = true

  const call = $.tool.call as unknown as (input: object) => Promise<{ result?: unknown }>
  const ran = await call({ tool: 'mcp__builder__watch', number: 7 })

  expect(String(ran.result)).toContain('gh could not read o/r#7')
})

test('the watch tool answers that it could not read the gh login when the read throws', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.loginThrows = true

  const call = $.tool.call as unknown as (input: object) => Promise<{ result?: unknown }>
  const ran = await call({ tool: 'mcp__builder__watch', number: 7 })

  expect(String(ran.result)).toContain('Could not read the repository or the gh login from this folder.')
})

// Spawns agents of the given types and answers the engine's agent list with them.
async function spawnAgents($: Engine, on: On, types: string[]) {
  const spawned: { id: string; type: string }[] = []
  on('agent.spawn', ($, e) => {
    const id = `agent-${spawned.length + 1}`
    spawned.push({ id, type: e.subagentType })
    return { model: 'test', agentId: id }
  })
  on('agent.list', () => ({
    value: spawned.map(agent => ({ ...agent, description: '', status: 'running' as const })),
  }))
  for (const type of types) {
    await $.agent.spawn({ subagentType: type, prompt: 'go', description: type } as never)
  }
}

const loose = ($: Engine) => $.tool.call as unknown as (input: object) => Promise<{ deny?: string; result?: unknown }>
const edit = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' }

test('a reviewer may only read and report back: an edit and a skill are refused, a read, its handback and the claim checker\'s edit are not', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const reached: string[] = []
  on('tool.call', ($, e) => {
    reached.push(`${String(e.agentId)} ${String(e.tool)}`)
    return { result: 'ran' }
  })
  await spawnAgents($, on, ['builder:security-reviewer', 'builder:claim-checker'])

  const reviewerEdit = await loose($)({ ...edit, agentId: 'agent-1' })
  const reviewerSkill = await loose($)({ tool: 'Skill', skill: 'anything', agentId: 'agent-1' })
  await loose($)({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'agent-1' })
  await loose($)({ tool: 'SubagentHandback', report: 'LENS-END security cccccccc findings=0', agentId: 'agent-1' })
  await loose($)({ ...edit, agentId: 'agent-2' })

  // A reviewer must still be able to hand its report back.
  expect(reached).toEqual(['agent-1 Read', 'agent-1 SubagentHandback', 'agent-2 Edit'])
  expect(String(reviewerEdit.deny)).toContain('only reads')
  expect(String(reviewerSkill.deny)).toContain('only reads')
})

test('the owner\'s advocate is fenced as a reviewer is: an edit is refused, a read and its handback are not', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const reached: string[] = []
  on('tool.call', ($, e) => {
    reached.push(`${String(e.agentId)} ${String(e.tool)}`)
    return { result: 'ran' }
  })
  await spawnAgents($, on, ['builder:owners-advocate'])

  const advocateEdit = await loose($)({ ...edit, agentId: 'agent-1' })
  await loose($)({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'agent-1' })
  await loose($)({ tool: 'SubagentHandback', report: 'VOTE: 1', agentId: 'agent-1' })

  expect(reached).toEqual(['agent-1 Read', 'agent-1 SubagentHandback'])
  expect(String(advocateEdit.deny)).toContain('builder:owners-advocate only reads')
})

test('when the fence cannot look an agent up, a subagent\'s edit is refused rather than let through', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  let reached = false
  on('tool.call', () => {
    reached = true
    return { result: 'ran' }
  })
  // No agent.list answer: the lookup fails.

  const ran = await loose($)({ ...edit, agentId: 'agent-9' })

  expect(reached).toBe(false)
  expect(String(ran.deny)).toContain('could not check')
})

test('a subagent cannot choose which pull request the session watches', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)

  const ran = await loose($)({ tool: 'mcp__builder__watch', number: 7, agentId: 'agent-1' })

  expect(String(ran.deny)).toContain('only the session')
  expect(world.calls).toEqual([])
})

test('a change found while the session\'s turn runs is held, then handed over with the change named when the turn ends', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  await watch($)
  await $.turn.start({ text: 'working', turnId: 't1' } as never)
  world.pr = openPullRequest({
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
  })
  await clock.advance(10 * 60_000)
  expect(prompts).toEqual([])

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The checks went from passed to failed.')
})

test('/builder poll shows the state without swallowing a change the session has not been told', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))

  await watch($)
  world.pr = openPullRequest({
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
  })
  const shown = await $.command.run({ command: 'builder', args: 'poll' } as never)
  expect(JSON.stringify(shown)).toContain('Checks: failed')
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The checks went from passed to failed.')
})

test('a mistyped pull request number leaves the watched one in place', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)

  await watch($)
  const bad = await loose($)({ tool: 'mcp__builder__watch', number: 0 })
  const missing = await loose($)({ tool: 'mcp__builder__watch', number: 99 })
  world.calls = []
  await clock.advance(10 * 60_000)

  expect(String(bad.result)).toContain('is not a pull request number')
  expect(String(missing.result)).toContain('still watching what was watched before')
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
})

// This guards behaviour that already works on main rather than reproducing a
// bug. The watch tool reads the pull request before it changes anything, so a
// read that throws leaves the pull request watched before still watched, as
// docs/specs/pilot-command-throws.md says. The fake answers every read of #8
// and throws on every read of #7, so a later poll that reads #8 and never #7
// shows that #8 is still the one being watched.
test('a read that throws leaves the pull request watched before still watched', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  world.pr = openPullRequest({ number: 8 })
  world.otherNumber = 8
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  const first = await loose($)({ tool: 'mcp__builder__watch', number: 8 })
  expect(String(first.result)).toContain('Pull request: o/r#8')

  world.readsThrow = true
  const ran = await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  world.calls = []
  await clock.advance(10 * 60_000)

  expect(String(ran.result)).toContain('still watching what was watched before')
  expect(world.calls.some(call => call.startsWith('gh pr view 8 '))).toBe(true)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(false)

  // /builder poll reads #8 itself, so it runs only after the timed polls have
  // been checked, or its own read would hide a timed poll that never ran.
  const shown = await $.command.run({ command: 'builder', args: 'poll' } as never)
  expect(JSON.stringify(shown)).toContain('Pull request: o/r#8')
})

test('a question asked while needs-decision is already on adds no second label, and takes the label off once answered', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.pr = openPullRequest({ labels: [{ name: 'needs-decision' }] })
  on('tool.call', () => ({ result: { answers: {} } }))

  await watch($)
  await clock.settle()
  await loose($)({ tool: 'AskUserQuestion', questions: [{ question: 'Which name?' }] })
  await clock.settle()

  // The label already on counts as the mod's for the question (spec item 12
  // of docs/specs/implement-runs-unattended.md), so it comes off.
  expect(world.calls.filter(call => call.includes('needs-decision'))).toEqual(['gh pr edit 7 --repo o/r --remove-label needs-decision'])
})

test('a label removal that failed is tried again on the next look', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.removalsToFail = 1
  on('tool.call', () => ({ result: { answers: {} } }))

  await watch($)
  await loose($)({ tool: 'AskUserQuestion', questions: [{ question: 'Which name?' }] })
  await clock.advance(10 * 60_000)

  expect(world.calls.filter(call => call.includes('--remove-label needs-decision')).length).toBe(2)
})

test('the owner\'s answer reaches the session before the label work behind it finishes', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  on('tool.call', () => ({ result: { answers: { q: 'yes' } } }))

  await watch($)
  const answer = await loose($)({ tool: 'AskUserQuestion', questions: [{ question: 'Which name?' }] })
  expect(JSON.stringify(answer)).toContain('yes')
  await clock.settle()

  expect(world.calls).toContain('gh pr edit 7 --repo o/r --add-label needs-decision')
  expect(world.calls).toContain('gh pr edit 7 --repo o/r --remove-label needs-decision')
})

test('a label the repository lacks is created, without --force, and then added', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.labelMissing = true
  on('tool.call', () => ({ result: { answers: {} } }))

  await watch($)
  await loose($)({ tool: 'AskUserQuestion', questions: [{ question: 'Which name?' }] })
  await clock.settle()

  const labelCalls = world.calls.filter(call => call.includes('needs-decision'))
  expect(labelCalls).toEqual([
    'gh pr edit 7 --repo o/r --add-label needs-decision',
    'gh label create needs-decision --repo o/r',
    'gh pr edit 7 --repo o/r --add-label needs-decision',
    'gh pr edit 7 --repo o/r --remove-label needs-decision',
  ])
})

test('/builder watch starts watching through the same path as the watch tool, and refuses a bad number', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const good = await $.command.run({ command: 'builder', args: 'watch 7' } as never)
  const bad = await $.command.run({ command: 'builder', args: 'watch seven' } as never)

  expect(JSON.stringify(good)).toContain('Watching this pull request.')
  expect(JSON.stringify(good)).not.toContain('builder:')
  expect(JSON.stringify(bad)).toContain('is not a pull request number')
})

test('a poll begun before a new watch of the same pull request never hands over what it read', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)

  // The poll reads #7 at head D and is held there.
  world.pr = openPullRequest({ headRefOid: D, commits: [{ oid: C }, { oid: D }] })
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(10 * 60_000)

  // Meanwhile the branch goes back to C and the session watches #7 afresh.
  world.pr = openPullRequest()
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  release()
  await clock.settle()

  // The held read of D belongs to the earlier watch, so nothing is handed over.
  expect(prompts).toEqual([])
})

test('records of pull requests no session has looked at for two weeks are pruned when a session starts', async ($, on) => {
  const now = 30 * 24 * 60 * 60_000
  const clock = mock.clock(on, { now })
  const stored = memoryStore(on, [
    ['prompted:old-session:o/r#1', {}],
    ['seen:old-session:o/r#1', 0],
    ['prompted:live-session:o/r#2', {}],
    ['seen:live-session:o/r#2', now - 1000],
    // Written by a build from before the seen key: kept, and given a time.
    ['prompted:older-build:o/r#3', {}],
    // A seen time whose record is being written as the prune runs: kept.
    ['seen:writing:o/r#4', now],
    // A seen time whose record is long gone: dropped.
    ['seen:orphan:o/r#5', 0],
    ['other', 'kept'],
  ])
  engine(on)
  fakeGitHub(on)

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()

  expect([...stored.keys()].sort()).toEqual([
    'other',
    'prompted:live-session:o/r#2',
    'prompted:older-build:o/r#3',
    'seen:live-session:o/r#2',
    'seen:older-build:o/r#3',
    'seen:writing:o/r#4',
  ])
  expect(stored.get('seen:older-build:o/r#3')).toBe(now)
})

test('an agent the engine does not list keeps its tools', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  on('agent.list', () => ({ value: [] }))
  let reached = false
  on('tool.call', () => {
    reached = true
    return { result: 'ran' }
  })

  await loose($)({ ...edit, agentId: 'compaction-helper' })

  expect(reached).toBe(true)
})


// A store in memory that the test can read and change behind the mod's back.
// `hold.until`, when set, keeps a read of a key starting with `hold.prefix`
// waiting until it resolves: the first such read after `hold.skip` others.
// `hold.refused`, when set, refuses every read of a key with that prefix.
// `hold.full` refuses every write, `hold.deletesRefused` every delete and
// `hold.keysRefused` every listing of the keys. `hold.listings` counts the
// listings of the keys, refused ones included.
function memoryStore(on: On, entries: [string, unknown][] = []) {
  const stored = new Map<string, unknown>(entries)
  const hold = {
    prefix: '', skip: 0, until: null as Promise<void> | null, refused: null as string | null, full: false,
    deletesRefused: false, keysRefused: false, listings: 0,
  }
  on('store.keys', () => {
    hold.listings += 1
    return hold.keysRefused ? { deny: 'the store could not be listed' } : { value: [...stored.keys()] }
  })
  on('store.get', async ($, e) => {
    if (hold.refused !== null && e.key.startsWith(hold.refused)) return { deny: 'the store could not be read' }
    const until = hold.until
    if (until !== null && e.key.startsWith(hold.prefix)) {
      if (hold.skip > 0) hold.skip -= 1
      else {
        hold.until = null
        await until
      }
    }
    return { value: stored.get(e.key) }
  })
  on('store.set', ($, e) => {
    // A full store refuses every write, as the engine does past 4 MiB.
    if (hold.full) return { deny: 'the store is full' }
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    if (hold.deletesRefused) return { deny: 'the store could not delete the key' }
    stored.delete(e.key)
    return { value: undefined }
  })
  return Object.assign(stored, { hold })
}

// A file system in memory that records writes, holding a project whose
// CLAUDE.md names an architecture document that exists. `writes.refused`,
// when set, refuses every write, as a full disk does. `writes.log` lists the
// path of every write that was not refused, in the order the writes began,
// and `writes.hold`, when set, keeps the next write waiting until it
// resolves, and the file then holds that write's text. `dirs` holds the
// folders that exist, so a test can add another checkout beside `/repo`.
function fakeFiles(on: On) {
  const files = new Map<string, string>([['/repo/CLAUDE.md', 'Architecture document: docs/arch.md\n'], ['/repo/docs/arch.md', 'x']])
  const links = new Map<string, string>()
  const dirs = new Set(['/repo'])
  const writes = { refused: false, log: [] as string[], hold: null as Promise<void> | null }
  // Every path read, in order, whether or not it is there.
  const reads: string[] = []
  on('fs.read', ($, e) => {
    reads.push(e.path)
    return files.has(e.path) ? { value: files.get(e.path) as string } : { deny: 'missing' }
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || dirs.has(e.path) }))
  // `links` maps a path to where it really points. A path that is none of the
  // files, folders or links is refused, as the real file system refuses it.
  on('fs.stat', ($, e) => {
    if (!files.has(e.path) && !dirs.has(e.path) && !links.has(e.path)) return { deny: 'missing' }
    const realPath = links.get(e.path) ?? e.path
    return { value: { kind: dirs.has(e.path) ? 'dir' as const : 'file' as const, size: 1, mtimeMs: 0, isLink: links.has(e.path), realPath } }
  })
  on('fs.write', async ($, e) => {
    if (writes.refused) return { deny: 'disk full' }
    writes.log.push(e.path)
    const hold = writes.hold
    writes.hold = null
    if (hold !== null) await hold
    files.set(e.path, e.text)
    return { value: undefined }
  })
  return Object.assign(files, { links, dirs, writes, reads })
}

// The mod loaded through a link into a checkout at `dir`: every stat resolves
// to `dir`, and each one is recorded with the `resolve` flag it asked for.
// The testing kit takes one hook per event, so this stands in for fakeFiles
// and a test uses one or the other.
function linkedMod(on: On, dir: string) {
  const stats: { path: string; resolve: boolean }[] = []
  on('fs.stat', ($, e) => {
    stats.push({ path: e.path, resolve: e.resolve })
    return { value: { kind: 'dir' as const, size: 1, mtimeMs: 0, isLink: true, realPath: dir } }
  })
  return stats
}

const verdictReview = (sha: string, spec: string, adversarial: string) => ({
  author: { login: 'owner' },
  state: 'COMMENTED',
  body: `VERDICTS ${sha.slice(0, 8)} spec=${spec} adversarial=${adversarial}\n\nRound notes.`,
  commit: { oid: sha },
})

test('the package tool refuses when the checkout is not at the pull request\'s head', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.head = D
  fakeFiles(on)
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain(`The checkout is at ${D.slice(0, 8)} but the pull request's head is ${C.slice(0, 8)}`)
})

test('the package tool writes the package and the diff for the head, with the round from the live reviews', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  // The review lands after the watch, so only a live read sees round 2.
  world.pr = openPullRequest({ commits: [{ oid: A }, { oid: C }], reviews: [verdictReview(A, 'REQUEST_CHANGES', 'APPROVE')] })

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.', tests: '3 pass' })
  const text = files.get('/repo/.git/builder/cccccccc/package.md') ?? ''

  expect(String(ran.result)).toContain(`Head: ${C}`)
  expect(text).toContain('- Round: 2')
  expect(text).toContain('### At aaaaaaaa')
  expect(text).toContain('- Architecture document: docs/arch.md')
  expect(text).toContain('- Gotchas document: none in this project')
  expect(files.get('/repo/.git/builder/cccccccc/diff.patch')).toContain('diff --git a/a.ts b/a.ts')
})

test('the package tool lists the decided findings and the areas, and its first line stops the rounds at a streak of three', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  const area = 'hooks/a.ts: the parent race'
  world.messages = [
    { sha: A, message: `Fix the first round\n\nArea: ${area}\n\nDropped:\n- The cache can go stale. Refuted: it is rebuilt.` },
    { sha: D, message: `Fix the second round\n\nArea: ${area}` },
    { sha: C, message: `Fix the third round\n\nArea: ${area}` },
  ]
  world.pr = openPullRequest({ commits: [{ oid: A }, { oid: D }, { oid: C }], reviews: [{ ...verdictReview(D, 'REQUEST_CHANGES', 'APPROVE'), body: 'VERDICTS dddddddd spec=REQUEST_CHANGES adversarial=APPROVE\n\nOutside the spec:\n- Surviving a restart.' }] })

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })
  const text = files.get('/repo/.git/builder/cccccccc/package.md') ?? ''
  const answer = String(ran.result).replace(/^builder: /, '')

  expect(answer.split('\n')[0]).toContain('The review rounds stop here')
  expect(answer.split('\n')[0]).toContain(area)
  expect(answer).toContain(`Review package for ${C.slice(0, 8)}:`)
  expect(text).toContain('## Already decided')
  expect(text).toContain(`- D1 (commit ${A.slice(0, 8)}): The cache can go stale. Refuted: it is rebuilt.`)
  expect(text).toContain(`- D2 (review at ${D.slice(0, 8)}): Surviving a restart.`)
  expect(text).toContain('## Areas fixed so far')
  expect(text).toContain(`- ${area}, fixed at 3 reviewed heads in a row`)
})

test('the package tool answers with the package first when no area stops the rounds', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result).replace(/^builder: /, '').split('\n')[0]).toBe(`Review package for ${C.slice(0, 8)}:`)
  const text = files.get('/repo/.git/builder/cccccccc/package.md') ?? ''
  expect(text.slice(text.indexOf('## Already decided'), text.indexOf('## Areas fixed so far'))).toContain('None yet.')
})

test('the package tool writes no package when git cannot read the commit messages', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  world.messagesFail = true

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain('commit messages')
  expect(String(ran.result)).toContain('no package was written')
  expect(files.has('/repo/.git/builder/cccccccc/package.md')).toBe(false)
})

test('the package tool writes no package when git fetch throws', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  world.fetchesThrow = true

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain('git could not fetch the base')
  expect(files.has('/repo/.git/builder/cccccccc/package.md')).toBe(false)
})

test('the review tool posts one comment review at the reviewed head, with the verdicts line first', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.pr = openPullRequest()
  const files = fakeFiles(on)
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'REQUEST_CHANGES', body: 'Findings.' })

  const post = world.calls.find(call => call.startsWith('gh api repos/o/r/pulls/7/reviews')) ?? ''
  expect(post).toContain(`-f commit_id=${C}`)
  expect(post).toContain('-f event=COMMENT')
  expect(post).toContain('-F body=@/repo/.git/builder/cccccccc/review.md')
  expect(files.get('/repo/.git/builder/cccccccc/review.md')).toBe('VERDICTS cccccccc spec=APPROVE adversarial=REQUEST_CHANGES\n\nFindings.\n')
  // The answer carries the state, so recording it as told hides nothing.
  expect(String(ran.result)).toContain('Posted the review: https://github.com/o/r/pull/7#pullrequestreview-1')
  expect(String(ran.result)).toContain('Checks: passed.')
})

test('the review tool refuses a moved head, a second verdict at the head, and a body holding a credential, and posts none of them', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
  fakeFiles(on)
  await watch($)

  const moved = await loose($)({ tool: 'mcp__builder__post_review', head: D, spec: 'APPROVE', adversarial: 'APPROVE', body: 'x' })
  const twice = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'x' })
  const secret = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: `ghp_${'a'.repeat(36)}` })

  expect(String(moved.result)).toContain('not the reviewed')
  expect(String(twice.result)).toContain('already posted')
  expect(String(secret.result)).toContain('a GitHub token')
  expect(world.calls.some(call => call.startsWith('gh api repos/o/r/pulls/7/reviews'))).toBe(false)
})

// The session started in the main checkout, `/repo`, which stays on main
// behind the head, and the pull request's branch is checked out in the
// worktree `/wt`, which is at the head and names a document only it has.
function sessionInMainCheckout(world: ReturnType<typeof fakeGitHub>, files: ReturnType<typeof fakeFiles>) {
  world.head = D
  world.heads['/wt'] = C
  world.gitDirs['/wt'] = '/repo/.git/worktrees/wt'
  world.worktrees = [{ path: '/repo', branch: 'main' }, { path: '/wt', branch: 'feature' }]
  files.dirs.add('/wt')
  files.set('/wt/CLAUDE.md', 'Architecture document: docs/only-here.md\n')
  files.set('/wt/docs/only-here.md', 'x')
}

const NOT_AT_HEAD = `The checkout is at ${D.slice(0, 8)} but the pull request's head is ${C.slice(0, 8)}; push or pull first.`

test('the package tool builds the package in the worktree that has the head branch checked out, not in the folder the session started in', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  sessionInMainCheckout(world, files)
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  // Before the fix this is the refusal of 2026-10-12, from comparing /repo.
  expect(String(ran.result)).toContain(`Head: ${C}`)
  expect(files.get('/repo/.git/worktrees/wt/builder/cccccccc/package.md') ?? '').toContain('- Architecture document: docs/only-here.md')
  expect(files.get('/repo/.git/worktrees/wt/builder/cccccccc/diff.patch')).toContain('diff --git a/a.ts b/a.ts')
  const folderOf = (prefix: string) => world.ran.filter(r => r.argv.startsWith(prefix)).map(r => r.cwd)
  expect(folderOf('git worktree list')).toEqual(['/repo'])
  expect(folderOf('git rev-parse HEAD')).toEqual(['/wt'])
  expect(folderOf('git fetch')).toEqual(['/wt'])
  expect(folderOf('git diff')).toEqual(['/wt', '/wt'])
  expect(folderOf('git log')).toEqual(['/wt', '/wt'])
})

test('the review tool stages its body in the git folder of the worktree that has the head branch checked out', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  sessionInMainCheckout(world, files)
  await watch($)

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })

  const post = world.calls.find(call => call.startsWith('gh api repos/o/r/pulls/7/reviews')) ?? ''
  expect(post).toContain('-F body=@/repo/.git/worktrees/wt/builder/cccccccc/review.md')
  expect(files.get('/repo/.git/worktrees/wt/builder/cccccccc/review.md')).toBe('VERDICTS cccccccc spec=APPROVE adversarial=APPROVE\n\nFindings.\n')
})

test('when the worktree that has the head branch is behind the head, the refusal names that worktree, even though the session\'s folder is at the head', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  sessionInMainCheckout(world, files)
  world.head = C
  world.heads['/wt'] = D
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain(`${NOT_AT_HEAD} It compared /wt, the worktree that has feature checked out.`)
  expect(files.has('/repo/.git/builder/cccccccc/package.md')).toBe(false)
})

test('when no worktree has the head branch checked out, the refusal names the session\'s folder and says so', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  world.head = D
  // A branch whose name only begins with the head branch's, and a detached
  // worktree at the head, are not the head branch.
  world.worktrees = [{ path: '/repo', branch: 'main' }, { path: '/wt', branch: 'feature-2' }, { path: '/loose', head: C }]
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain(`${NOT_AT_HEAD} It compared /repo, the session's folder, because no worktree has feature checked out.`)
})

test('when git cannot list the worktrees, because it fails, throws or is cut off, the refusal names the session\'s folder and says git could not list them', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  sessionInMainCheckout(world, files)
  await watch($)

  for (const fail of ['exit', 'throw', 'cut'] as const) {
    world.worktreesFail = fail
    const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

    expect(String(ran.result)).toContain(`${NOT_AT_HEAD} It compared /repo, the session's folder, because git could not list the worktrees.`)
    expect(String(ran.result)).not.toContain('no worktree has')
    expect([...files.keys()].some(path => path.startsWith('/repo/.git/worktrees/wt/'))).toBe(false)
  }
})

test('a prunable worktree whose folder is gone still has the head branch, and the refusal names it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  world.head = D
  world.worktrees = [{ path: '/repo', branch: 'main' }, { path: '/gone', branch: 'feature', head: C, prunable: true }]
  world.throwsIn = ['/gone']
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain(`The checkout is at an unknown commit but the pull request's head is ${C.slice(0, 8)}; push or pull first. It compared /gone, the worktree that has feature checked out.`)
})

test('a subagent cannot build a package or post a review', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  // Watched first, so only the refusal can stop the tools reaching GitHub.
  await watch($)
  world.calls = []

  const pkg = await loose($)({ tool: 'mcp__builder__package', issue: 'x', agentId: 'agent-1' })
  const post = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'x', agentId: 'agent-1' })

  expect(String(pkg.deny)).toContain('only the session')
  expect(String(post.deny)).toContain('only the session')
  // Nothing was read, built or posted.
  expect(world.calls).toEqual([])
})

test('a workflow cannot start a reviewer, where the fence could not see it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  on('agent.spawn', () => ({ model: 'test', agentId: 'agent-1' }))

  const ran = await $.agent.spawn({ subagentType: 'builder:security-reviewer', prompt: 'x', description: 'x', workflow: { id: 'w' } } as never)
  const advocate = await $.agent.spawn({ subagentType: 'builder:owners-advocate', prompt: 'x', description: 'x', workflow: { id: 'w' } } as never)

  expect(JSON.stringify(ran)).toContain('runs only from the session')
  expect(JSON.stringify(advocate)).toContain('runs only from the session')
})

test('a diff the engine cut off at 4 MiB is refused, not written as if whole', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.cutDiff = true
  const files = fakeFiles(on)
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(String(ran.result)).toContain('cut off')
  expect(files.has('/repo/.git/builder/cccccccc/diff.patch')).toBe(false)
})

test('the review tool refuses a verdict that is not APPROVE or REQUEST_CHANGES', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)

  const ran = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'approve', adversarial: 'APPROVE', body: 'x' })

  expect(String(ran.result)).toContain('must be APPROVE or REQUEST_CHANGES')
  expect(world.calls.some(call => call.startsWith('gh api repos/o/r/pulls/7/reviews'))).toBe(false)
})

test('a document path in CLAUDE.md that leaves the checkout is not named in the package', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  files.set('/repo/CLAUDE.md', 'Architecture document: ../../.env\nGotchas document: /etc/passwd\n')
  files.set('/.env', 'secret')
  await watch($)

  await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })
  const text = files.get('/repo/.git/builder/cccccccc/package.md') ?? ''

  expect(text).toContain('- Architecture document: none in this project')
  expect(text).toContain('- Gotchas document: none in this project')
})

test('a quiet session keeps its record fresh, so another session starting two weeks on does not prune it', async ($, on) => {
  // The 30-second redraw is refused here: fifteen days of it is some forty
  // thousand timer periods, and it plays no part in keeping the record seen.
  on('clock.every', { ms: 30_000 }, () => ({ deny: 'no redraws in this test' }))
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)

  // Fifteen quiet days of polls, then another session starts and prunes.
  for (let day = 0; day < 15; day += 1) await clock.advance(24 * 60 * 60_000)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  await clock.advance(10 * 60_000)

  // The record survived, so nothing unchanged is handed over as news. The
  // stuck prompts the quiet days draw say nothing about the pull request.
  expect(prompts.filter(text => !text.startsWith('builder: nothing has happened'))).toEqual([])
})

test('a document committed as a link to a file outside the checkout is not named in the package', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  files.links.set('/repo/docs/arch.md', '/home/someone/.secrets')
  await watch($)

  await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })

  expect(files.get('/repo/.git/builder/cccccccc/package.md') ?? '').toContain('- Architecture document: none in this project')
})

test('switching pull requests drops what the session was told about the previous one', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  await watch($)
  expect(stored.has('prompted:session-1:o/r#7')).toBe(true)

  world.pr = openPullRequest({ number: 8 })
  world.otherNumber = 8
  await loose($)({ tool: 'mcp__builder__watch', number: 8 })

  expect(stored.has('prompted:session-1:o/r#7')).toBe(false)
  expect(stored.has('seen:session-1:o/r#7')).toBe(false)
  expect(stored.has('prompted:session-1:o/r#8')).toBe(true)
})

const CI_EVENT = '<ci-monitor-event>Check "tests" failed on pull request #7.</ci-monitor-event>'

test('the desktop app\'s CI event carries the pull request\'s state, and the poll after it repeats nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const seen: { text: string; context: readonly string[] }[] = []
  on('prompt.submit', ($, e) => {
    seen.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text }
  })
  await watch($)

  world.pr = openPullRequest({
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
  })
  await $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.advance(10 * 60_000)

  expect(seen.length).toBe(1)
  expect(seen[0]?.context.join('\n')).toContain('Checks: failed (failed: "tests").')
})

test('a CI event more than a day after the last record is still recorded, so the next poll does not repeat it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)

  // A quiet day passes; then the checks fail and the desktop app reports it,
  // and time moves while the event's own read of the pull request is held.
  await clock.advance(24 * 60 * 60_000 + 5 * 60_000)
  world.pr = openPullRequest({
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
  })
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.advance(1000)
  release()
  await event
  await clock.advance(10 * 60_000)

  // The CI event's own prompt, and no poll prompt repeating the failure.
  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
  expect(prompts.filter(text => text.includes('<ci-monitor-event>')).length).toBe(1)
})

const failing = () => openPullRequest({
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE' }],
})

// Checks still running, as GitHub shows them while a suite is under way.
const checksRunning = () => openPullRequest({
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: null }],
})

// The CI event's prompt waits at the bottom until the test lets it through;
// every other prompt passes and is recorded.
function holdCiPrompt(on: On) {
  const prompts: string[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  on('prompt.submit', async ($, e) => {
    if (e.text.includes('<ci-monitor-event>')) await gate
    else prompts.push(e.text)
    return { text: e.text }
  })
  return { prompts, release: () => release() }
}

test('a change a poll reads while the CI event\'s prompt is held is handed over once, after the event, and the told record ends on it', async ($, on) => {
  const clock = mock.clock(on)
  const { stored } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  await watch($)

  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  // While the event waits, the branch moves and a poll reads that. The poll
  // hands nothing over while the event has not yet told its own read.
  world.pr = { ...failing(), headRefOid: D, commits: [{ oid: C }, { oid: D }] } as GhPullRequest
  await clock.advance(10 * 60_000)
  held.release()
  await event
  // The next poll hands the move over, so the change is delayed, never lost.
  await clock.advance(10 * 60_000)

  expect(held.prompts.filter(text => text.includes('pull request #7 changed')).length).toBe(1)
  expect((stored.get('prompted:session-1:o/r#7') as { head: string }).head).toBe(D)
})

test('a switch of pull requests while the CI event\'s prompt is held leaves no record for the old one', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  await watch($)

  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  world.otherNumber = 8
  await loose($)({ tool: 'mcp__builder__watch', number: 8 })
  held.release()
  await event

  expect(stored.has('prompted:session-1:o/r#7')).toBe(false)
  expect(stored.has('prompted:session-1:o/r#8')).toBe(true)
})

// Once `arm` is called, answers the mod's reads of the watch with the watch
// the mod wrote last. The kit answers a read made inside a hook that is still
// running with the watch as it stood when that hook began, so without this a
// switch of pull requests in the middle of the CI event's handler is caught
// by the module's record of the newest watch before the handler's own
// comparison of the two watches is reached. This stands in for an engine
// whose reads see a watch made since the hook began, which is the case that
// comparison guards.
function freshWatchReads(on: On) {
  let latest: unknown
  let isArmed = false
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'run') latest = e.value
    return next(e)
  })
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    if (!isArmed || e.plugin !== 'builder' || e.key !== 'run') return answer
    // The version the kit reported is kept, so a later write of the watch is
    // not refused as if another write had landed in between.
    const { value: read } = answer as { value: { version: number } }
    return { value: { value: latest, version: read.version } } as never
  })
  return () => { isArmed = true }
}

test('a switch of pull requests between the CI event\'s first read of the watch and its look records nothing new as told for the new one', async ($, on) => {
  const clock = mock.clock(on)
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  recordPrompts(on)
  const readFreshWatch = freshWatchReads(on)
  await watch($)
  await clock.settle()

  // The event reads the watch of #7, and its read of what was told for #7
  // waits. The session watches #8 meanwhile. #8 is in the state #7 was told,
  // and the fingerprint names neither the number nor the repository, so #8's
  // record compares as the same as the one the event read for #7.
  const release = holdNext('get')
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  world.otherNumber = 8
  await loose($)({ tool: 'mcp__builder__watch', number: 8 })
  const toldForEight = stored.get('prompted:session-1:o/r#8')
  expect(toldForEight).toBeDefined()
  // The event's look then reads the watch of #8, and #8 failing.
  readFreshWatch()
  world.pr = failing()
  release()
  await event
  await clock.settle()

  // The watch the look read under is not the one the event read first, so
  // the event records nothing, and the next poll hands the failure over.
  expect(stored.get('prompted:session-1:o/r#8')).toEqual(toldForEight)
})

test('a record stored in an older shape counts as no record, and the next change is still handed over', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  // What builds 40a7a76 and 1a9aea7 stored under this key.
  stored.set('prompted:session-1:o/r#7', { at: 0, snapshot: {} })

  world.pr = failing()
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The mod has no record of what the session was last told')
})

test('a change confined to in-review draws no prompt at a poll or at a held turn end, and do-not-merge draws one', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  const state = writtenState(on)
  await watch($)

  // The session puts in-review on, and the next poll reads it.
  world.pr = openPullRequest({ labels: [{ name: 'in-review' }] })
  await clock.advance(10 * 60_000)
  expect(prompts).toEqual([])
  const polls = state.of<{ source: string; changed: boolean }[]>('wakes', []).filter(w => w.source === 'poll')
  expect(polls.map(w => w.changed)).toEqual([false])

  // A failure is held while a turn runs and is fixed again before the turn
  // ends, so the read at the turn's end differs from what the session was
  // told only by in-review.
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = { ...failing(), labels: [{ name: 'in-review' }] } as GhPullRequest
  await clock.advance(10 * 60_000)
  world.pr = openPullRequest({ labels: [{ name: 'in-review' }] })
  await turnEnds($, 't1')
  await clock.settle()
  expect(prompts).toEqual([])

  // A label that is not the workflow's own is still handed over.
  world.pr = openPullRequest({ labels: [{ name: 'do-not-merge' }, { name: 'in-review' }] })
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
  // The change lines, before the state lines, name only do-not-merge.
  expect(prompts[0]?.split('\n\n')[0]).toBe('builder: pull request #7 changed.\nLabels added: "do-not-merge".')
})

test('a told record whose stored fingerprint no rule produces draws no prompt against an unchanged pull request', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  world.pr = openPullRequest({ labels: [{ name: 'in-review' }] })
  await watch($)
  // The record's fields are the pull request's as it stands, but the
  // fingerprint stored with them is one no rule makes, as a record an older
  // build wrote carries a fingerprint made by an older rule.
  const record = snapshotOf('o/r', world.pr, 'owner')
  stored.set('prompted:session-1:o/r#7', { ...record, fingerprint: 'OPEN|cccccccccccc|in-review|older-format' })

  await clock.advance(10 * 60_000)

  expect(prompts).toEqual([])
})

test('a told record without a labels array counts as no record and does not throw', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  world.pr = openPullRequest({ labels: [{ name: 'do-not-merge' }] })
  await watch($)
  // A record with a fingerprint but no labels, at a head the pull request has
  // left, so the change would be described against it if it were read.
  const { labels: _labels, ...unlabelled } = snapshotOf('o/r', openPullRequest(), 'owner')
  stored.set('prompted:session-1:o/r#7', { ...unlabelled, head: A })

  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The mod has no record of what the session was last told')
})

test('a CI event read under an earlier watch is not recorded after the session watches the same pull request afresh', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  await watch($)

  // The event reads the failure and waits; meanwhile the failure is fixed
  // and the session watches #7 again, which records the passing state.
  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  world.pr = openPullRequest()
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  held.release()
  await event
  await clock.advance(10 * 60_000)

  // Had the event recorded its failing read, the poll would report the
  // passing state as news.
  expect(held.prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('the fence passes through whatever the call beneath it settled to, instead of substituting its own refusal', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  await spawnAgents($, on, ['builder:claim-checker'])

  // Nothing beneath the fence answers tool.call, so the call the fence let
  // through settles as "no implementation"; that, not the fence's refusal,
  // must reach the caller.
  const ran = await loose($)({ tool: 'Bash', command: 'git status', agentId: 'agent-1' }).catch((error: unknown) => ({ error: String(error) }))

  expect(JSON.stringify(ran)).toContain('no implementation for tool.call')
  expect(JSON.stringify(ran)).not.toContain('reviewer fence could not check')
})

test('a session start with a watch already in place reads the pull request at once, without waiting for a poll', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  await watch($)
  world.calls = []

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()

  expect(world.calls.filter(call => call.startsWith('gh pr view 7')).length).toBe(1)
})

// Stands in for what an older build of the mod left in its state before a
// reload. The engine's `$` in a test has no `state` to write with, and only
// the mod may write its own values, so the test answers the mod's reads of
// these keys itself until the mod writes one, after which the kit's own
// value, the one the mod wrote, is read. A test may register only one
// state.get hook, so the next `reads` reads under `refused` are refused here,
// by the same readRefusal that refusedReads uses, before any value is
// answered.
function olderBuildState(on: On, seeded: Record<string, unknown>, refused?: string) {
  const left = new Map(Object.entries(seeded))
  const { refusal, refuses } = readRefusal(refused)
  on('state.get', ($, e, next) => {
    const denial = refuses(e)
    if (denial !== undefined) return denial
    if (e.plugin !== 'builder' || !left.has(e.key)) return next(e)
    // Version 0 is where the kit's own value stands, so the mod's write after
    // this read is not refused as a write that another one beat.
    return { value: { value: left.get(e.key), version: 0 } } as never
  })
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder') left.delete(e.key)
    return next(e)
  })
  return refusal
}

test('the line above the prompt draws nothing of its own over a snapshot an older build saved, and draws once a look replaces it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const { headsReviewed: _dropped, ...older } = snapshotOf('o/r', openPullRequest(), 'owner')
  olderBuildState(on, { run: { repo: 'o/r', number: 7, cwd: '/repo', login: 'owner', since: 1 }, pr: older })
  // What the host draws when the mod passes the band on.
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))

  const band = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect(await band.find({ text: 'builder:' })).toBeUndefined()
  expect(await band.find({ text: 'host line' })).toBeDefined()

  // The session start reads the watched pull request at once, which replaces
  // the older snapshot with one that has the round count.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  // Drawn again by hand: the band's first read was answered by the test, not
  // the kit, so the kit never subscribed the band to the mod's later write.
  await band.redraw()

  expect((await band.find({ text: 'builder:' }))?.text).toContain('builder: #7 open · checks passed')
})

// Mounts the line above the prompt and reads what the mod draws there,
// drawn again by hand so that a relative time is read as of now. The host
// draws its own line when the mod passes the band on, as before a watch.
// Called after the test's other hooks, since it is the first call on `$`.
async function abovePrompt($: Engine, on: On) {
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const band = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  return async () => {
    await band.redraw()
    return (await band.find({ key: 'builder-line' }))?.text ?? ''
  }
}

// The session's own turn, as the engine raises it: start, then complete.
function sessionTurns(on: On) {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
}
const turnEnds = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: 'pushed', durationMs: 1, isAborted: false, turnId, reason: 'answer' } as never)

const pushedD = () => openPullRequest({ headRefOid: D, commits: [{ oid: C }, { oid: D }] })

test('a turn that ends after a push is followed by a look about 10 seconds on, which finds the new head and hands it over 90 seconds later', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  const line = await abovePrompt($, on)

  await watch($)
  await $.turn.start({ text: 'fix round 1', turnId: 't1' } as never)
  world.pr = pushedD()
  await turnEnds($, 't1')
  await clock.settle()
  expect(await line()).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 10m')

  // GitHub has had time to show the push; the mod looks once and sees it.
  await clock.advance(10_000)
  expect(await line()).toBe('builder: #7 open · checks passed · new head, handing over in 2m')

  await clock.advance(89_000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain(`The head moved from ${C.slice(0, 8)} to ${D.slice(0, 8)}.`)
})

// The poll's own look reschedules after it hands the change over, so this
// holds whether or not recording the state as told reschedules; the CI-event
// test below is the one that needs tell() to reschedule.
test('once the poll hands the new head over, its look puts the next one ten minutes out again', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  const line = await abovePrompt($, on)

  await watch($)
  await $.turn.start({ text: 'fix round 1', turnId: 't1' } as never)
  world.pr = pushedD()
  await turnEnds($, 't1')
  await clock.advance(10_000)
  await clock.advance(90_000)

  expect(prompts.length).toBe(1)
  expect(await line()).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 10m')
})

test('once the desktop app\'s CI event hands the new head over, the next look is ten minutes out again', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  const line = await abovePrompt($, on)

  await watch($)
  await $.turn.start({ text: 'fix round 1', turnId: 't1' } as never)
  world.pr = pushedD()
  await turnEnds($, 't1')
  await clock.advance(10_000)
  expect(await line()).toContain('new head, handing over in 2m')

  await $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()

  expect(await line()).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 10m')
  // The event's own prompt was the handover; the poll does not repeat it.
  await clock.advance(10 * 60_000)
  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a redraw is asked for every 30 seconds while a look is scheduled, and stops once the pull request merges', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const redraws: string[] = []
  on('ui.invalidate', ($, e) => {
    redraws.push(e.event)
    return { value: undefined }
  })
  const line = await abovePrompt($, on)

  await watch($)
  await clock.settle()
  redraws.length = 0
  await clock.advance(30_000)
  expect(redraws).toEqual(['ui.render'])
  await clock.advance(60_000)
  expect(redraws).toEqual(['ui.render', 'ui.render', 'ui.render'])

  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)
  expect(await line()).toBe('builder: #7 merged · checks passed · not polling')
  redraws.length = 0
  await clock.advance(5 * 60_000)
  expect(redraws).toEqual([])
})

test('two overlapping reschedules leave one poll, due when the newer one said', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  const line = await abovePrompt($, on)
  await watch($)
  await clock.settle()

  // The poll at ten minutes reads what the session was told once to compare,
  // then is held reading it again as it reschedules.
  let release = () => {}
  stored.hold.prefix = 'prompted:'
  stored.hold.skip = 1
  stored.hold.until = new Promise<void>(resolve => { release = resolve })
  await clock.advance(10 * 60_000)
  // Meanwhile /builder poll reschedules in full, ten minutes on; five minutes
  // later the poll's older reschedule goes on.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.advance(5 * 60_000)
  release()
  await clock.settle()

  // The newer reschedule's look stands, five minutes from now.
  expect(await line()).toContain('next look in 5m')
  world.calls = []
  await clock.advance(5 * 60_000)
  expect(world.calls.filter(call => call.startsWith('gh pr view 7')).length).toBe(1)
  await clock.advance(10 * 60_000 - 1)
  expect(world.calls.filter(call => call.startsWith('gh pr view 7')).length).toBe(1)
})

test('a look that only observes never puts off a poll already due sooner, so a change it finds is not handed over late', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)

  // The poll is due ten minutes after the watch. The checks fail late in a
  // turn, and the look after the turn ends sees it without handing it over.
  await watch($)
  await clock.advance(9 * 60_000)
  await $.turn.start({ text: 'working', turnId: 't1' } as never)
  world.pr = failing()
  await turnEnds($, 't1')
  await clock.advance(10_000)
  expect(prompts).toEqual([])

  // The poll comes when it was due, not ten minutes after that look.
  await clock.advance(50_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The checks went from passed to failed.')
})

test('while a subagent runs the next look is ten minutes out, and the look after the turn its finish starts brings it to 90 seconds when checks run', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  const listed = engineAgents(on)
  const state = writtenState(on)
  const line = await abovePrompt($, on)
  const dueIn = () => state.of<{ at: number } | null>('nextLook', null)!.at - clock.now()
  const reads = () => world.calls.filter(call => call.startsWith('gh pr view 7')).length

  // The checks run when the session watches, and a turn starts a reviewer.
  world.pr = checksRunning()
  await watch($)
  listed.push({ id: 'agent-1', type: 'builder:spec-reviewer', description: 'Review the spec', status: 'running' })
  await $.turn.start({ text: 'review round 1', turnId: 't1' } as never)
  await turnEnds($, 't1')

  // The poll due 90 seconds after the watch finds the reviewer running and
  // sets the next look ten minutes out; nothing reads GitHub meanwhile.
  await clock.advance(90_000)
  expect(dueIn()).toBe(10 * 60_000)
  expect(await line()).toContain('next look in 10m')
  world.calls = []
  await clock.advance(5 * 60_000)
  expect(reads()).toBe(0)

  // The reviewer finishes, and its notification starts a turn of the
  // session's own. The look 10 seconds after that turn ends brings the next
  // poll forward from what is left of the ten minutes to 90 seconds.
  listed[0]!.status = 'completed'
  await $.turn.complete({ answer: 'VERDICT: APPROVE', durationMs: 390_000, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' } as never)
  await $.turn.start({ text: 'the reviewer finished', turnId: 't2' } as never)
  await turnEnds($, 't2')
  await clock.advance(10_000)
  expect(dueIn()).toBe(90_000)
  expect(await line()).toContain('next look in 2m')

  // The checks pass, and that poll hands the change over.
  world.pr = openPullRequest()
  await clock.advance(90_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The checks went from pending to passed.')
})

test('a look that read the pull request under a watch since replaced does not schedule from what it read', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  const line = await abovePrompt($, on)
  await watch($)
  await clock.settle()

  // /builder poll reads #7 merged and is held as it marks the pull request seen.
  world.pr = openPullRequest({ state: 'MERGED' })
  let release = () => {}
  stored.hold.prefix = 'seen:'
  stored.hold.until = new Promise<void>(resolve => { release = resolve })
  const poll = $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  // Meanwhile the session watches #8, which is open.
  world.pr = openPullRequest({ number: 8 })
  world.otherNumber = 8
  await $.command.run({ command: 'builder', args: 'watch 8' } as never)
  release()
  await poll
  await clock.settle()

  // The merged read of #7 belongs to the old watch, so #8 is still polled.
  expect(await line()).toBe('builder: #8 open · checks passed · nothing to hand over · next look in 10m')
  world.calls = []
  await clock.advance(10 * 60_000)
  expect(world.calls.filter(call => call.startsWith('gh pr view 8')).length).toBe(1)
})

test('the pane shows the next step in place of what the session waits on', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
  await watch($)
  await clock.settle()
  await pane.redraw()

  // `find` answers the outermost match, the pane's whole box, with its text.
  const text = (await pane.find({ text: 'Next:' }))?.text ?? ''
  expect(text).toContain('Next: nothing to hand over · next look in 10m.')
  expect(text).not.toContain('Waiting on')
})

test('a rerun that fails the same way is handed over at the next 90-second poll, while the pane says it waits on a fix', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  const run = (completedAt: string) => ({ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE', completedAt })
  world.pr = openPullRequest({ statusCheckRollup: [run('2026-10-07T10:00:00Z')] })
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
  await watch($)
  await clock.settle()
  await pane.redraw()
  expect((await pane.find({ text: 'Next:' }))?.text ?? '').toContain('Next: waiting on a fix · next look in 2m.')

  world.pr = openPullRequest({ statusCheckRollup: [run('2026-10-07T10:00:00Z'), run('2026-10-07T10:05:00Z')] })
  await clock.advance(90_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Check "tests" failed again.')
})

test('an error while scheduling leaves no look scheduled and the line saying so, until the next hook arms the poll again', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  const redraws: string[] = []
  on('ui.invalidate', ($, e) => {
    redraws.push(e.event)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  const line = await abovePrompt($, on)
  await watch($)
  await clock.settle()

  // The record of what the session was told cannot be read while /builder poll
  // reschedules.
  stored.hold.refused = 'prompted:'
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  stored.hold.refused = null
  expect(await line()).toBe('builder: #7 open · checks passed · not polling')

  // Neither the poll nor the redraw runs any more.
  world.calls = []
  redraws.length = 0
  await clock.advance(30 * 60_000)
  expect(world.calls.filter(call => call.startsWith('gh pr view 7'))).toEqual([])
  expect(redraws).toEqual([])

  // The next hook arms the poll again.
  await $.prompt.submit({ text: 'go on', origin: { kind: 'user' } } as never)
  await clock.settle()
  expect(await line()).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 10m')
})

test('when the look that hands a held change over at the end of a turn fails, the look 10 seconds on still runs', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  const line = await abovePrompt($, on)

  // A poll during the turn finds the checks failed and holds the change.
  await watch($)
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = failing()
  await clock.advance(10 * 60_000)
  expect(prompts).toEqual([])

  // The session pushes, and the read that would hand the change over fails.
  world.pr = { ...failing(), headRefOid: D, commits: [{ oid: C }, { oid: D }] } as GhPullRequest
  world.readsToFail = 1
  await turnEnds($, 't1')
  await clock.settle()
  expect(prompts).toEqual([])

  await clock.advance(10_000)
  expect(await line()).toBe('builder: #7 open · checks failed · new head, handing over in 2m')
})

// Records each prompt, and refuses every one while `refusing` is set, as the
// engine does when it will not start a turn.
function refusablePrompts(on: On) {
  const record = { prompts: [] as string[], refusing: false }
  on('prompt.submit', ($, e) => {
    if (record.refusing) return { drop: 'not now' }
    record.prompts.push(e.text)
    return { text: e.text }
  })
  return record
}

// Watches #7, holds a check failure found while a turn runs, has the session
// push D, and ends the turn, which hands the held change over at once.
async function holdThenPush($: Engine, clock: ReturnType<typeof mock.clock>, world: ReturnType<typeof fakeGitHub>) {
  await watch($)
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = failing()
  await clock.advance(10 * 60_000)
  world.pr = { ...failing(), headRefOid: D, commits: [{ oid: C }, { oid: D }] } as GhPullRequest
  await turnEnds($, 't1')
  await clock.settle()
}

test('when the prompt handing a held change over at the end of a turn is refused, the look 10 seconds on still runs', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const record = refusablePrompts(on)
  sessionTurns(on)
  const state = writtenState(on)

  record.refusing = true
  await holdThenPush($, clock, world)
  expect(record.prompts).toEqual([])
  const end = clock.now()

  await clock.advance(10_000)
  // The look that tried to hand the change over, then the one 10 seconds on.
  expect(state.wakesFrom('turn-end')).toEqual([end, end + 10_000])
})

test('when the held change is handed over at the end of a turn, no look follows 10 seconds on', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const record = refusablePrompts(on)
  sessionTurns(on)
  const state = writtenState(on)

  await holdThenPush($, clock, world)
  expect(record.prompts.length).toBe(1)
  const end = clock.now()

  await clock.advance(40_000)
  // Only the look that handed the change over.
  expect(state.wakesFrom('turn-end')).toEqual([end])
})

const COUNSEL = 'mcp__builder__counsel'
const TALLY = 'mcp__builder__counsel_tally'
const MEMBERS = [...['spec', 'adversarial', 'security', 'maintainability', 'performance', 'data'].map(m => `builder:${m}-reviewer`), 'builder:owners-advocate']
const brief = {
  tool: COUNSEL,
  question: 'How often should the mod poll?',
  options: ['a 90-second poll', 'a 5-minute poll'],
  background: 'The pane goes stale between polls.',
  paths: ['docs/arch.md', 'docs/specs/poll.md'],
  lean: 'LEAN-MARKER a 90-second poll',
}
// Each member's vote as the session reports it, in member order; undefined
// leaves that member out, as one that failed.
const ballots = (choices: (string | undefined)[], newOption?: string) => choices.flatMap((vote, i) => vote === undefined ? [] : [{
  member: MEMBERS[i], vote, reason: `reason ${i}`, ...(vote === 'none' && newOption ? { new_option: newOption } : {}),
}])

// Starts a session in /repo without watching anything, as during /spec.
async function startOnly($: Engine) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
}

test('with nothing watched, the counsel tool writes the brief in the git folder and answers with the id and the folder', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
  await startOnly($)

  const ran = await loose($)(brief)
  const text = files.get('/repo/.git/builder/counsel/session-1/c1/brief.md') ?? ''

  expect(String(ran.result)).toContain('c1')
  expect(String(ran.result)).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c1.')
  expect(text).toContain('1. a 90-second poll')
  expect(text).toContain('- docs/arch.md\n')
  expect(text).toContain('- docs/specs/poll.md (not written yet)')
  expect(text).not.toContain('LEAN-MARKER')

  await pane.redraw()
  const drawn = (await pane.find({ text: 'No pull request is watched' }))?.text ?? ''
  expect(drawn).toContain('c1 · round 1 · voting · How often should the mod poll?')
  expect(drawn).toContain('Lean: LEAN-MARKER a 90-second poll')
})

test('the counsel tool refuses a path outside the checkout and writes no brief', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await startOnly($)

  const ran = await loose($)({ ...brief, paths: ['../../.env'] })

  expect(String(ran.result)).toContain('Refused')
  expect([...files.keys()].some(path => path.includes('/counsel/'))).toBe(false)
})

test('when the git folder cannot be found, the counsel could not sit and nothing is recorded', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.gitDirFails = true
  fakeFiles(on)
  await startOnly($)

  const ran = await loose($)(brief)
  const later = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1']) })

  expect(String(ran.result)).toContain('could not sit')
  expect(String(ran.result)).toContain('Ask the person directly')
  expect(String(later.result)).toContain('no counsel question c1')
})

test('after a restart that began the ids again, the counsel tool takes the next id with no brief and leaves the earlier brief alone', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  // A brief from before the restart, still waiting on its votes.
  files.set('/repo/.git/builder/counsel/session-1/c1/brief.md', 'EARLIER-BRIEF')
  await startOnly($)

  const ran = await loose($)(brief)
  // A second question shows the session is not locked out after the first.
  const next = await loose($)(brief)
  const later = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1']) })

  expect(String(ran.result)).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c2.')
  expect(String(next.result)).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c3.')
  expect(files.get('/repo/.git/builder/counsel/session-1/c1/brief.md')).toBe('EARLIER-BRIEF')
  expect(files.get('/repo/.git/builder/counsel/session-1/c2/brief.md') ?? '').toContain('How often should the mod poll?')
  expect(String(later.result)).toContain('no counsel question c1')
})

test('when every id the counsel tool tries already holds a brief, the counsel could not sit and nothing is recorded', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  for (let n = 1; n <= 1000; n += 1) files.set(`/repo/.git/builder/counsel/session-1/c${n}/brief.md`, `EARLIER-${n}`)
  await startOnly($)

  const ran = await loose($)(brief)

  expect(String(ran.result)).toContain('could not sit')
  expect(String(ran.result)).toContain('Ask the person directly')
  expect(files.get('/repo/.git/builder/counsel/session-1/c1/brief.md')).toBe('EARLIER-1')
})

test('the tally refuses an unknown id and a round already tallied, and records nothing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
  await startOnly($)
  await loose($)(brief)

  const unknown = await loose($)({ tool: TALLY, id: 'c9', round: 1, votes: ballots(['1']) })
  // Refused before the real tally, so its refusal is the option's, not the round's.
  const outOfRange = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '3']) })
  const first = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['2', '2', '1', 'none', '1', 'none', 'none']) })
  const again = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '1', '1', '1']) })

  expect(String(unknown.result)).toContain('no counsel question c9')
  expect(String(first.result)).toContain('AskUserQuestion')
  expect(String(again.result)).toContain('already tallied')
  expect(String(outOfRange.result)).toContain('option 3 does not exist')
  await pane.redraw()
  const drawn = (await pane.find({ text: 'No pull request is watched' }))?.text ?? ''
  // The first tally stands; the refused ones changed nothing.
  expect(drawn).toContain('Tally: 1. a 90-second poll 2, 2. a 5-minute poll 2, no option 3, of 7 who took part')
  expect(drawn).not.toContain('Without a vote:')
  expect(drawn).not.toContain('Abstained:')
  expect(drawn).toContain('asked the person')
})

test('a rerun rewrites the brief as round two with the proposed option added', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await startOnly($)
  await loose($)(brief)

  const ran = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '2', 'none', '2', '1', '2', '1'], 'only on events') })
  const text = files.get('/repo/.git/builder/counsel/session-1/c1/brief.md') ?? ''

  expect(String(ran.result)).toContain('round 2')
  expect(text).toContain('round 2')
  expect(text).toContain('3. only on events')
  expect(text).not.toContain('reason 0')
  expect(text).not.toContain('LEAN-MARKER')
})

test('a subagent cannot put a question to the counsel or tally one', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await startOnly($)

  const asked = await loose($)({ ...brief, agentId: 'agent-1' })
  const tallied = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1']), agentId: 'agent-1' })

  expect(String(asked.deny)).toContain('only the session')
  expect(String(tallied.deny)).toContain('only the session')
  expect(world.calls).toEqual([])
  expect([...files.keys()].some(path => path.includes('/counsel/'))).toBe(false)
})

test('a decision tallied while a pull request is watched appears once in the next review posted, and not in the one after', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  const decided = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })
  expect(String(decided.result)).toContain('The counsel chose: a 90-second poll. 4 of 7 members voted for it.')
  // With a pull request watched, the review records the decision, not the spec.
  expect(String(decided.result)).toContain('The mod lists this decision in the next review it posts on o/r#7.')
  expect(String(decided.result)).not.toContain('Record it in the spec')

  // A post that gh could not make leaves the decision to report.
  world.postsToFail = 1
  const failed = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  expect(String(failed.result)).toContain('could not post')

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const first = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(first).toContain('Decided by the counsel')
  expect(first).toContain('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.')

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Second.' })
  const second = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(second).toContain('Second.')
  expect(second).not.toContain('Decided by the counsel')
})

test('a decision reached after a member is asked again reaches the next review as four of seven, without reasons', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  // Maintainability abstains first, and votes when it is launched again.
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', 'abstain', '2', 'none', 'none']) })
  const decided = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })
  expect(String(decided.result)).toContain('Decided:')
  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const review = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(review).toContain('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.')
  expect(review).not.toContain('reason 3')
})

test('a review lists only the decisions made while its own pull request was watched', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })

  // The session moves to #8 and posts a review there; the decision on #7 is not its to list.
  world.pr = openPullRequest({ number: 8 })
  world.otherNumber = 8
  await loose($)({ tool: 'mcp__builder__watch', number: 8 })
  const onOther = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'On eight.' })
  expect(String(onOther.result)).toContain('Posted the review')
  const other = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(other).toContain('On eight.')
  expect(other).not.toContain('Decided by the counsel')

  // Back on #7, the next review there lists it.
  world.pr = openPullRequest()
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'On seven.' })
  const own = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(own).toContain('On seven.')
  expect(own).toContain('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.')
})

const STATE_READ_7 = 'gh pr view 7 --repo o/r --json state'
const DECIDING = ['1', '1', '1', '1', '2', 'none', 'none']
const SPEC_LINE = '- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.'
const SPEC_INSTRUCTION = 'Record it in the spec, under a section headed "Decided by the counsel", as this line:'

test('a decided round owed to a pull request that GitHub reads as open at the tally is owed to its next review', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  world.calls.length = 0
  const decided = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(DECIDING) })).result)

  expect(world.calls).toContain(STATE_READ_7)
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(true)
  expect(decided).toContain('The mod lists this decision in the next review it posts on o/r#7.')
  expect(decided).not.toContain('Record it in the spec')
})

test('a decided round owed to a pull request that merged or closed before the tally is owed to nothing and goes to the spec', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  // The watch still holds #7 as open, so each question is owed to it when
  // put; only the tally's own read sees it merged or closed.
  for (const [id, state, word] of [['c1', 'MERGED', 'merged'], ['c2', 'CLOSED', 'closed']] as const) {
    world.states[7] = 'OPEN'
    await loose($)({ ...brief, pull_request: 7 })
    world.states[7] = state
    world.calls.length = 0
    const decided = String((await loose($)({ tool: TALLY, id, round: 1, votes: ballots(DECIDING) })).result)

    expect([id, world.calls.includes(STATE_READ_7)]).toEqual([id, true])
    expect([id, decided]).toEqual([id, [
      'builder: Decided: The counsel chose: a 90-second poll. 4 of 7 members voted for it. Go with that option, and tell the person in those words.',
      `o/r#7 ${word} before the tally, so no review will list this decision.`,
      SPEC_INSTRUCTION,
      SPEC_LINE,
      'If the person overturns it, their answer is final.',
    ].join('\n')])
  }
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual([])
})

test('a decided round owed to a pull request whose state cannot be read at the tally goes to the spec, without saying it merged or closed', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  const ways: [string, () => void][] = [
    ['exit', () => { world.stateRead = 'exit' }],
    ['throw', () => { world.stateRead = 'throw' }],
    ['cut', () => { world.stateRead = 'cut' }],
    ['text', () => { world.stateRead = 'text' }],
    ['draft', () => { world.states[7] = 'DRAFT' }],
  ]
  for (const [i, [way, breakRead]] of ways.entries()) {
    world.stateRead = null
    world.states = {}
    await loose($)({ ...brief, pull_request: 7 })
    breakRead()
    world.calls.length = 0
    const decided = String((await loose($)({ tool: TALLY, id: `c${i + 1}`, round: 1, votes: ballots(DECIDING) })).result)

    expect([way, world.calls.includes(STATE_READ_7)]).toEqual([way, true])
    expect([way, decided.includes('The state of o/r#7 could not be read at the tally, so no review will list this decision.')]).toEqual([way, true])
    expect([way, decided.includes(`${SPEC_INSTRUCTION}\n${SPEC_LINE}`)]).toEqual([way, true])
    expect([way, /merged|closed/.test(decided)]).toEqual([way, false])
    expect([way, decided.includes('next review')]).toEqual([way, false])
  }
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual([])
})

test('the tally reads the pull request the question was owed to, even after the watch moved to another one', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })

  // The session moves to #8, which has merged; #7 is still open.
  world.pr = openPullRequest({ number: 8 })
  world.otherNumber = 8
  await loose($)({ tool: 'mcp__builder__watch', number: 8 })
  world.states = { 7: 'OPEN', 8: 'MERGED' }
  world.calls.length = 0
  const decided = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(DECIDING) })).result)

  expect(world.calls).toContain(STATE_READ_7)
  expect(world.calls).not.toContain('gh pr view 8 --repo o/r --json state')
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(true)
  expect(decided).toContain('The mod lists this decision in the next review it posts on o/r#7.')
})

test('a question owed to no pull request, and a round that does not decide, read no pull request\'s state', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await loose($)(brief)
  await loose($)({ ...brief, pull_request: 7 })
  world.calls.length = 0

  const toSpec = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(DECIDING) })).result)
  const undecided = String((await loose($)({ tool: TALLY, id: 'c2', round: 1, votes: ballots(['1', '1', '1', '2', '2', '2', 'none']) })).result)

  expect(toSpec).toContain(`${SPEC_INSTRUCTION}\n${SPEC_LINE}`)
  expect(undecided).toContain('Ask the person')
  expect(world.calls.filter(call => call.endsWith('--json state'))).toEqual([])
})

const OWED_7 = 'counsel-owed:o/r#7:session-1:c1'
const ENDED_MERGED = 'These counsel decisions were owed to the next review on o/r#7, which merged before a review listed them, so no review will list them.'
const ENDED_ONE_MERGED = 'This counsel decision was owed to the next review on o/r#7, which merged before a review listed it, so no review will list it.'
const LEAVE_OUT = 'Leave out any line the spec already has.'
const owedKeys = (stored: Map<string, unknown>) => [...stored.keys()].filter(key => key.startsWith('counsel-owed:')).sort()

// Watches #7, puts the question owed to it and tallies a round that decides
// it while #7 is open, so the decision is owed to #7's next review.
async function oweOnSeven($: Engine) {
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(DECIDING) })
}

test('a merge handed over in a change prompt lists every decision owed to that pull request, from every session, and deletes exactly those keys', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const other = '- Where are owed decisions kept? The counsel chose: One key per decision. 5 of 7 members voted for it.'
  const seventy = '- Does #70 belong here? The counsel chose: No. 6 of 7 members voted for it.'
  const stored = memoryStore(on, [
    ['counsel-owed:o/r#7:other-session:c4', { line: other, at: 1 }],
    ['counsel-owed:o/r#70:other-session:c2', { line: seventy, at: 1 }],
  ])
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  await oweOnSeven($)
  expect(stored.has(OWED_7)).toBe(true)

  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The pull request is now merged.')
  expect(prompts[0]).toContain([
    ENDED_MERGED,
    'Record them in the spec, under a section headed "Decided by the counsel", as these lines:',
    other,
    SPEC_LINE,
    LEAVE_OUT,
  ].join('\n'))
  expect(prompts[0]).not.toContain(seventy)
  expect(owedKeys(stored)).toEqual(['counsel-owed:o/r#70:other-session:c2'])
})

test('a refused change prompt deletes no owed decision, and the watch tool\'s answer lists it later', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const record = refusablePrompts(on)
  await oweOnSeven($)

  record.refusing = true
  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)
  expect(record.prompts).toEqual([])
  expect(stored.has(OWED_7)).toBe(true)

  const answer = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(answer).toContain([ENDED_ONE_MERGED, SPEC_INSTRUCTION, SPEC_LINE, LEAVE_OUT].join('\n'))
  expect(stored.has(OWED_7)).toBe(false)
})

test('a decision owed while the change prompt reads the owed list is neither listed nor deleted, and the next watch answer lists it', async ($, on) => {
  const clock = mock.clock(on)
  const later = '- Was this decided after the listing? The counsel chose: Yes. 4 of 7 members voted for it.'
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  await oweOnSeven($)

  // Another session owes a decision to #7 once the keys are listed, while the
  // handover reads the first of them.
  stored.hold.prefix = 'counsel-owed:o/r#7:'
  stored.hold.until = {
    then(resolve: () => void) {
      stored.set('counsel-owed:o/r#7:session-3:c2', { line: later, at: Number.MAX_SAFE_INTEGER })
      resolve()
    },
  } as Promise<void>
  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain(SPEC_LINE)
  expect(prompts[0]).not.toContain(later)
  expect(owedKeys(stored)).toEqual(['counsel-owed:o/r#7:session-3:c2'])

  const answer = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(answer).toContain(later)
  expect(answer).not.toContain(SPEC_LINE)
  expect(owedKeys(stored)).toEqual([])
})

test('a merged read that another look stores while the handover reads busy is handed over with the owed decisions listed', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const busyRead = holdBusyRead(on, world)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  await oweOnSeven($)

  // The poll reads a new head on the open pull request and is held reading
  // busy. Meanwhile #7 merges and /builder poll stores that read, which the
  // held handover then chooses.
  world.pr = pushedD()
  busyRead.arm()
  await clock.advance(10 * 60_000)
  world.pr = { ...pushedD(), state: 'MERGED' } as GhPullRequest
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  expect(prompts).toEqual([])
  busyRead.release()
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The pull request is now merged.')
  expect(prompts[0]).toContain([ENDED_ONE_MERGED, SPEC_INSTRUCTION, SPEC_LINE, LEAVE_OUT].join('\n'))
  expect(stored.has(OWED_7)).toBe(false)
})

test('a refused delete still submits the change prompt with the decisions and records it as told, and the key is listed again later', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  await oweOnSeven($)

  stored.hold.deletesRefused = true
  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain([ENDED_ONE_MERGED, SPEC_INSTRUCTION, SPEC_LINE, LEAVE_OUT].join('\n'))
  expect((stored.get('prompted:session-1:o/r#7') as { state?: string }).state).toBe('MERGED')
  expect(stored.has(OWED_7)).toBe(true)

  stored.hold.deletesRefused = false
  const answer = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(answer).toContain(SPEC_LINE)
  expect(stored.has(OWED_7)).toBe(false)
})

test('a refused listing of the owed decisions still submits the change prompt, without decisions, and records it as told', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  await oweOnSeven($)

  stored.hold.keysRefused = true
  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The pull request is now merged.')
  expect(prompts[0]).not.toContain('Decided by the counsel')
  expect((stored.get('prompted:session-1:o/r#7') as { state?: string }).state).toBe('MERGED')
  expect(stored.has(OWED_7)).toBe(true)
})

test('a change on an open pull request lists no owed decision and keeps it, and a merge with nothing owed says nothing about decisions', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  await oweOnSeven($)

  world.pr = pushedD()
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('dddddddd')
  expect(prompts[0]).not.toContain('Decided by the counsel')
  expect(stored.has(OWED_7)).toBe(true)

  // The next review lists it, and #7 then merges with nothing owed.
  await loose($)({ tool: 'mcp__builder__post_review', head: D, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  expect(stored.has(OWED_7)).toBe(false)
  world.pr = { ...pushedD(), state: 'MERGED' } as GhPullRequest
  await clock.advance(10 * 60_000)
  const merged = prompts.find(text => text.includes('The pull request is now merged.')) ?? ''
  expect(merged).toContain('pull request #7 changed')
  expect(merged).not.toContain('Decided by the counsel')
  expect(merged).not.toContain('no review will list')
})

test('the watch tool\'s answer on a merged pull request lists the owed decisions and deletes their keys, and on an open one reads none', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await oweOnSeven($)

  const listingsBefore = stored.hold.listings
  const open = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(open).not.toContain('Decided by the counsel')
  expect(stored.hold.listings).toBe(listingsBefore)
  expect(stored.has(OWED_7)).toBe(true)

  world.pr = openPullRequest({ state: 'MERGED' })
  const merged = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(merged).toContain('Watching this pull request.')
  expect(merged).toContain([ENDED_ONE_MERGED, SPEC_INSTRUCTION, SPEC_LINE, LEAVE_OUT].join('\n'))
  expect(stored.has(OWED_7)).toBe(false)

  const again = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(again).not.toContain('Decided by the counsel')
})

test('the watch tool\'s answer on a closed pull request lists the decisions owed to it and deletes their keys', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on, [['counsel-owed:o/r#7:other-session:c1', { line: SPEC_LINE, at: 1 }]])
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  world.pr = openPullRequest({ state: 'CLOSED' })

  await startOnly($)
  const closed = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)
  expect(closed).toContain('This counsel decision was owed to the next review on o/r#7, which closed before a review listed it, so no review will list it.')
  expect(owedKeys(stored)).toEqual([])
})

test('after a restart, a watch on the pull request that merged meanwhile lists a decision tallied before the merge', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const restart = restartable(on, ['counsel', 'run', 'pr'])
  const world = fakeGitHub(on)
  fakeFiles(on)
  await oweOnSeven($)
  expect(stored.has(OWED_7)).toBe(true)

  restart()
  world.pr = openPullRequest({ state: 'MERGED' })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  const answer = String((await loose($)({ tool: 'mcp__builder__watch', number: 7 })).result)

  expect(answer).toContain([ENDED_ONE_MERGED, SPEC_INSTRUCTION, SPEC_LINE, LEAVE_OUT].join('\n'))
  expect(stored.has(OWED_7)).toBe(false)
})

test('a question put after the watched pull request merged is recorded in the spec, not owed to that pull request', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await clock.settle()

  // #7 merges, and the next poll sees it; the session goes on to /spec the
  // next issue in the same session, with #7 still the last one watched.
  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)
  // Naming the merged pull request is refused, so the decision cannot be
  // owed to it even when the session asks for that.
  const named = String((await loose($)({ ...brief, pull_request: 7 })).result)
  expect(named).toContain('Refused:')
  expect(named).toContain('o/r#7 is watched, and its last known state is merged.')
  await loose($)(brief)
  const decided = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })

  expect(String(decided.result)).toContain('Record it in the spec')
  expect(String(decided.result)).not.toContain('The mod lists this decision')
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual([])
})

test('with a pull request open and watched, a question put without pull_request is recorded in the spec and owed to nothing', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)(brief)
  const decided = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })

  expect(String(decided.result)).toContain('Record it in the spec')
  expect(String(decided.result)).not.toContain('The mod lists this decision')
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual([])
  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const review = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(review).toContain('Findings.')
  expect(review).not.toContain('Decided by the counsel')
})

// Puts a question naming `named` as its pull request, and checks that it was
// refused with `what` and left no trace: no brief, no question c1 to tally,
// and the next valid question still gets c1.
async function expectRefusedPullRequest($: Engine, files: ReturnType<typeof fakeFiles>, named: unknown, what: string) {
  const ran = String((await loose($)({ ...brief, pull_request: named })).result)
  expect([named, ran.startsWith('builder: Refused: ')]).toEqual([named, true])
  expect([named, ran.includes(what)]).toEqual([named, true])
  expect([named, ran.includes('No brief was written and nothing was recorded.')]).toEqual([named, true])
  expect([named, [...files.keys()].some(path => path.includes('/counsel/'))]).toEqual([named, false])
  const tallied = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '1', '1', '1']) })).result)
  expect([named, tallied.includes('no counsel question c1')]).toEqual([named, true])
}

test('pull_request naming another number, or a value that is not a whole number of at least 1, is refused and records nothing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)

  for (const named of [8, '7', 7.5, 0, -1, null]) {
    await expectRefusedPullRequest($, files, named, 'o/r#7 is watched, and its last known state is open.')
  }
  const valid = String((await loose($)({ ...brief, pull_request: 7 })).result)
  expect(valid).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c1.')
})

test('pull_request is refused when the watched pull request has closed, and when nothing is watched', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  await startOnly($)
  await expectRefusedPullRequest($, files, 7, 'Nothing is watched.')

  await $.tool.call({ tool: 'mcp__builder__watch', number: 7 } as never)
  await clock.settle()
  world.pr = openPullRequest({ state: 'CLOSED' })
  await clock.advance(10 * 60_000)
  await expectRefusedPullRequest($, files, 7, 'o/r#7 is watched, and its last known state is closed.')

  const valid = String((await loose($)(brief)).result)
  expect(valid).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c1.')
})

test('a snapshot of another pull request than the one watched counts as a state not known yet, so naming the watched one is refused', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  // Once armed, the watch is on #7 while the snapshot still describes #8,
  // open, as between the two writes the watch makes. The version the kit
  // reported is kept.
  let isArmed = false
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    if (!isArmed || e.plugin !== 'builder' || e.key !== 'pr') return answer
    const held = answer as { value: { value: { number: number } | null; version: number } | null }
    if (held.value?.value == null) return answer
    return { value: { ...held.value, value: { ...held.value.value, number: 8 } } } as never
  })
  await watch($)
  isArmed = true

  await expectRefusedPullRequest($, files, 7, 'o/r#7 is watched, and its state is not known yet.')
})

test('the counsel tool\'s input schema offers pull_request as a whole number of at least 1, and does not require it', async ($, on) => {
  const schemas: Record<string, unknown> = {}
  engine(on, schemas)
  mock.clock(on)
  mock.store(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)

  const schema = schemas.counsel as { properties: Record<string, { type?: string; minimum?: number; description?: string }>; required: string[] }
  expect(schema.properties.pull_request?.type).toBe('integer')
  expect(schema.properties.pull_request?.minimum).toBe(1)
  expect(schema.properties.pull_request?.description ?? '').toContain('spec')
  expect(schema.required).not.toContain('pull_request')
  expect(JSON.stringify(schemas.counsel_tally)).toContain('word for word')
})

test('a question put while one pull request is watched and tallied after the watch moves to another is owed to the first', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })

  world.pr = openPullRequest({ number: 8 })
  world.otherNumber = 8
  await loose($)({ tool: 'mcp__builder__watch', number: 8 })
  const decided = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })

  expect(String(decided.result)).toContain('The mod lists this decision in the next review it posts on o/r#7.')
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual(['counsel-owed:o/r#7:session-1:c1'])
})

test('when the brief cannot be rewritten for a rerun, the question goes to the person and is recorded as asked', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await startOnly($)
  await loose($)(brief)

  files.writes.refused = true
  const ran = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', 'none', '2', '2', '1', '2', '1'], 'only on events') })
  const again = await loose($)({ tool: TALLY, id: 'c1', round: 2, votes: ballots(['1', '1', '1', '1', '1', '1', '1']) })

  expect(String(ran.result)).toContain('could not be rewritten')
  expect(String(ran.result)).toContain('AskUserQuestion')
  expect(String(ran.result)).toContain('only on events')
  expect(files.get('/repo/.git/builder/counsel/session-1/c1/brief.md') ?? '').toContain('round 1')
  expect(String(again.result)).toContain('Refused')
})

test('a decision whose question looks like it holds a secret is left out of the review, which still posts, and is not listed again', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  await loose($)({ ...brief, pull_request: 7, question: `Should the mod rotate ${key}?` })
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })

  const posted = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const first = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(String(posted.result)).toContain('Posted the review')
  expect(first).not.toContain(key)
  expect(first).toContain('Decided by the counsel')
  expect(first).toContain('- A decision was left out because its question looked like it held a secret.\n')

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Second.' })
  const second = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(second).toContain('Second.')
  expect(second).not.toContain('Decided by the counsel')
  expect(second).not.toContain('left out')
})

test('the session\'s own body is still refused when it looks like it holds a secret', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  await watch($)

  const refused = await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: `Key ${'AKIA' + 'ABCDEFGHIJKLMNOP'}.` })

  expect(String(refused.result)).toContain('Refused: the body looks like it holds an AWS access key id.')
  expect(world.calls.some(call => call.startsWith('gh api repos/o/r/pulls/7/reviews'))).toBe(false)
})

// The value each of the mod's keys starts a session with, for the stand-in
// for a restart below.
const INITIAL_STATE: Record<string, unknown> = {
  counsel: [], questions: [], busy: false, quietSince: null, stuckEvery: 45 * 60_000, usageHold: null,
}

// Stands in for a restart of the session, which starts the mod's state under
// the given keys again from its initial value while the store keeps what it
// held. Once `restart()` is called, the mod reads each of those keys as its
// initial value until it writes that key itself, which the kit then answers
// with as usual. The stand-in replaces the value it hands back but keeps the
// version the kit reported, so the mod's next write carries the real version
// and the kit does not refuse it as if another write had landed in between.
function restartable(on: On, keys: readonly string[]) {
  const restarted = new Set<string>()
  on('state.get', async ($, e, next) => {
    const held = await next(e)
    if (e.plugin !== 'builder' || !restarted.has(e.key)) return held
    // A key never written has no version yet, and stands at version 0, as in
    // olderBuildState.
    const version = (held as { value?: { version?: number } | null }).value?.version ?? 0
    return { value: { value: INITIAL_STATE[e.key], version } } as never
  })
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder') restarted.delete(e.key)
    return next(e)
  })
  return () => {
    for (const key of keys) restarted.add(key)
  }
}

test('a decision tallied while a pull request is watched is still listed once in the next review after a restart', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const restart = restartable(on, ['counsel'])
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(true)

  // A restart: no counsel questions in the state, and the store as the
  // session left it.
  restart()
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const first = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(first.split('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.').length).toBe(2)
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(false)

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Second.' })
  const second = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(second).toContain('Second.')
  expect(second).not.toContain('Decided by the counsel')
})

test('a tally whose owed decision cannot be stored records nothing, so the session can tally the round again', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  const votes = ballots(['1', '1', '1', '1', '2', 'none', 'none'])

  stored.hold.full = true
  const refused = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes })
  expect(String(refused.result)).toContain('The decision could not be stored, so nothing was recorded; tally this round again.')
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(false)

  stored.hold.full = false
  const again = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes })
  expect(String(again.result)).toContain('The counsel chose')
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(true)
})

test('each session\'s decision owed to the pull request is listed in its review, and the post deletes only the keys that review listed', async ($, on) => {
  const now = 30 * 24 * 60 * 60_000
  mock.clock(on, { now })
  const other = '- Where are owed decisions kept? The counsel chose one key per decision, 5 of 6.'
  const seventy = '- Does #70 belong here? The counsel chose no, 6 of 6.'
  const later = '- Was this decided after the listing? The counsel chose yes, 4 of 6.'
  const stored = memoryStore(on, [
    ['counsel-owed:o/r#7:other-session:c1', { line: other, at: now }],
    ['counsel-owed:o/r#70:other-session:c2', { line: seventy, at: now }],
  ])
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })
  expect(stored.has('counsel-owed:o/r#7:session-1:c1')).toBe(true)

  // A third session owes a decision once the review has listed the keys and
  // before it is posted, so this review does not list it and must not delete it.
  // The write is made when the held read awaits it, not before.
  stored.hold.prefix = 'counsel-owed:o/r#7:'
  stored.hold.until = {
    then(resolve: () => void) {
      stored.set('counsel-owed:o/r#7:session-3:c2', { line: later, at: now })
      resolve()
    },
  } as Promise<void>

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const first = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(first).toContain(other)
  expect(first).toContain('- How often should the mod poll? The counsel chose: a 90-second poll. 4 of 7 members voted for it.')
  expect(first).not.toContain(seventy)
  expect(first).not.toContain(later)
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:')).sort()).toEqual([
    'counsel-owed:o/r#70:other-session:c2',
    'counsel-owed:o/r#7:session-3:c2',
  ])

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Second.' })
  const second = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(second).toContain(later)
  expect(second).not.toContain(other)
  expect(second).not.toContain(seventy)
})

test('each decision owed to a pull request is pruned ninety days after it was made, not two weeks, when a session starts', async ($, on) => {
  const now = 100 * 24 * 60 * 60_000
  const month = 30 * 24 * 60 * 60_000
  const clock = mock.clock(on, { now })
  const line = '- Q? The counsel chose a, 4 of 6.'
  const stored = memoryStore(on, [
    ['counsel-owed:o/r#1:old-session:c1', { line, at: 0 }],
    ['counsel-owed:o/r#2:old-session:c2', { line, at: 0 }],
    ['counsel-owed:o/r#2:live-session:c1', { line, at: now - 1000 }],
    ['counsel-owed:o/r#5:quiet-session:c5', { line, at: now - month }],
    ['counsel-owed:o/r#3:old-session:c3', 'an older shape'],
    ['counsel-owed:o/r#4', [{ id: 'old-session:c4', line, at: now - 1000 }]],
  ])
  engine(on)
  fakeGitHub(on)

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()

  expect([...stored.keys()].sort()).toEqual(['counsel-owed:o/r#2:live-session:c1', 'counsel-owed:o/r#5:quiet-session:c5'])
})

// Every member votes.

async function counselPane($: Engine) {
  return $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
}
const drawnOf = async (pane: Awaited<ReturnType<typeof counselPane>>) => {
  await pane.redraw()
  return (await pane.find({ text: 'No pull request is watched' }))?.text ?? ''
}

test('an abstention, an unreadable vote and a member left out each refuse the round, and a second miss asks the person', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  const pane = await counselPane($)
  await startOnly($)

  for (const [id, data] of [['c1', 'abstain'], ['c2', '??'], ['c3', undefined]] as const) {
    await loose($)(brief)
    const ran = String((await loose($)({ tool: TALLY, id, round: 1, votes: ballots(['1', '1', '1', '1', '1', data, '1']) })).result)
    expect(ran).toContain('Refused:')
    expect(ran).toContain('builder:data-reviewer gave no vote')
    expect(ran).toContain(`Launch exactly this member again, with the prompt "Counsel brief: /repo/.git/builder/counsel/session-1/${id}.": builder:data-reviewer.`)
  }
  const drawn = await drawnOf(pane)
  for (const id of ['c1', 'c2', 'c3']) expect(drawn).toContain(`${id} · round 1 · voting ·`)

  const again = String((await loose($)({ tool: TALLY, id: 'c3', round: 1, votes: ballots(['1', '1', '1', '1', '1', undefined, '1']) })).result)
  expect(again).toContain('Ask the person: builder:data-reviewer gave no vote in round 1 after being asked twice')
  const after = await drawnOf(pane)
  expect(after).toContain('c3 · round 1 · asked the person')
  expect(after).toContain('Without a vote: data-reviewer (no readable vote)')
  expect(after).not.toContain('Abstained:')
})

// A member whose vote cannot be read twice, the data reviewer, beside a
// member left out twice, the performance reviewer. Answers with the two
// tallies' answers.
async function unreadableTwice($: Engine) {
  await loose($)(brief)
  const first = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', undefined, 'FIRST-MARKER 2 or 3', '1']) })).result)
  const second = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', undefined, 'SECOND-MARKER 2 or 3', '1']) })).result)
  return { first, second }
}

test('an unreadable vote is quoted in the refusal, and the answer that asks the person quotes the second call\'s text', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)

  const { first, second } = await unreadableTwice($)

  expect(first).toContain('These votes could not be read:\n- builder:data-reviewer: "FIRST-MARKER 2 or 3".')
  expect(first).toContain('A readable vote is an option\'s number')
  expect(first).not.toContain('builder:performance-reviewer: "')
  expect(second).toContain('Ask the person:')
  expect(second).toContain('- builder:data-reviewer: "SECOND-MARKER 2 or 3".')
  expect(second).not.toContain('FIRST-MARKER')
  // No agent was launched in this test, so the member left out twice never
  // started, while the member whose vote could not be read did start.
  expect(second).toContain('- builder:performance-reviewer: never started in this session.')
  expect(second).toContain('Open the question with this sentence: builder:performance-reviewer never started in this session')
  expect(second).not.toContain('builder:data-reviewer never started')
  expect(second).not.toContain('- builder:data-reviewer: never started')
})

// A member that never started: the session launches members through the
// spawn hook, and the clock moves between the steps so that an agent started
// before the members were asked again is told apart from one started after.
const ADVOCATE_LINE = 'Open the question with this sentence: builder:owners-advocate never started in this session, even after being asked again.'
const sixFor1 = ['1', '1', '1', '1', '1', '1']
async function tallyOnce($: Engine, choices: (string | undefined)[]) {
  return String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(choices) })).result)
}

test('an advocate that was never launched is named as never started once it is asked again, and not before', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  spawning(on)
  await startOnly($)

  await loose($)(brief)
  await clock.advance(1_000)
  for (const member of MEMBERS.slice(0, 6)) await spawn($, member)
  await clock.advance(1_000)
  const first = await tallyOnce($, sixFor1)
  await clock.advance(1_000)
  const second = await tallyOnce($, sixFor1)

  expect(first).toContain('Refused:')
  expect(first).not.toMatch(/never started|restart/i)
  expect(second).toContain('Ask the person: builder:owners-advocate gave no vote in round 1 after being asked twice')
  expect(second).toContain(ADVOCATE_LINE)
  expect(second).toContain('"A session started before builder:owners-advocate joined the counsel cannot launch it, and restarting the session lets the counsel decide again."')
  expect(second).toContain('- builder:owners-advocate: never started in this session.')
  expect(second).not.toContain('builder:owners-advocate: no readable vote')
})

test('an advocate launched only before it was asked again is still named as never started', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  spawning(on)
  await startOnly($)

  await loose($)(brief)
  await clock.advance(1_000)
  for (const member of MEMBERS) await spawn($, member)
  await clock.advance(1_000)
  await tallyOnce($, sixFor1)
  await clock.advance(1_000)
  const second = await tallyOnce($, sixFor1)

  expect(second).toContain(ADVOCATE_LINE)
  expect(second).toContain('- builder:owners-advocate: never started in this session.')
})

test('an advocate launched after it was asked again, with an empty vote, is not named as never started', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  spawning(on)
  await startOnly($)

  await loose($)(brief)
  await clock.advance(1_000)
  for (const member of MEMBERS.slice(0, 6)) await spawn($, member)
  await clock.advance(1_000)
  await tallyOnce($, sixFor1)
  await clock.advance(1_000)
  await spawn($, 'builder:owners-advocate')
  await clock.advance(1_000)
  const second = await tallyOnce($, [...sixFor1, ''])

  expect(second).toContain('Ask the person: builder:owners-advocate gave no vote in round 1 after being asked twice')
  expect(second).not.toMatch(/never started|restart/i)
  expect(second).toContain('- builder:owners-advocate: no readable vote.')
})

// The mod missed the advocate's spawn, as it does while its hooks reload, so
// the advocate's card is a placeholder of type 'agent' made when its turn
// ended. The read of the engine's list made beside that end runs at the same
// instant, so it leaves the placeholder alone, and only the read the tally
// makes gives the card the advocate's type.
test('an advocate whose spawn the mod missed, and which the engine lists, is not named as never started', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  const listed = spawning(on)
  await startOnly($)

  await loose($)(brief)
  await clock.advance(1_000)
  for (const member of MEMBERS.slice(0, 6)) await spawn($, member)
  await clock.advance(1_000)
  await tallyOnce($, sixFor1)
  await clock.advance(5_000)
  listed.push({ id: 'agent-missed', type: 'builder:owners-advocate', description: 'owners-advocate work', status: 'running' })
  await finish($, listed, 'agent-missed')
  await clock.advance(1_000)
  const second = await tallyOnce($, sixFor1)

  expect(second).toContain('Ask the person: builder:owners-advocate gave no vote in round 1 after being asked twice')
  expect(second).not.toMatch(/never started|restart/i)
  expect(second).toContain('- builder:owners-advocate: no readable vote.')
})

// The read of the record of agents is refused only at the second tally, so
// the setup reads it as usual. The advocate was never launched and was asked
// again, so it would be named if the record could be read.
test('a refused read of the record of agents at the tally names no member as never started', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  spawning(on)
  const refusal = refusedReads(on, 'agents')
  await startOnly($)

  await loose($)(brief)
  await clock.advance(1_000)
  for (const member of MEMBERS.slice(0, 6)) await spawn($, member)
  await clock.advance(1_000)
  await tallyOnce($, sixFor1)
  await clock.advance(1_000)
  refusal.reads = 100
  const second = await tallyOnce($, sixFor1)

  expect(second).toContain('Ask the person: builder:owners-advocate gave no vote in round 1 after being asked twice')
  expect(second).toContain('- builder:owners-advocate: no readable vote.')
  expect(second).not.toMatch(/never started|restart/i)
})

test('the text of an unreadable vote is never written to the state or the store, and the pane still says no readable vote', async ($, on) => {
  // Every value written to the state is recorded by this interceptor, which
  // passes each write on to the engine.
  const written: string[] = []
  on('state.set', ($, e, next) => {
    written.push(JSON.stringify(e.value))
    return next(e)
  })
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  const pane = await counselPane($)
  await startOnly($)

  const { second } = await unreadableTwice($)

  expect(second).toContain('SECOND-MARKER')
  // The interceptor saw the tallies being recorded, so its silence on the
  // markers means something.
  expect(written.some(value => value.includes('builder:data-reviewer'))).toBe(true)
  expect(written.filter(value => /FIRST-MARKER|SECOND-MARKER/.test(value))).toEqual([])
  // This question has no pull request, so nothing is owed and the store may
  // hold nothing at all. The next test covers a store that is written to.
  expect([...stored.values()].map(value => JSON.stringify(value)).filter(value => /FIRST-MARKER|SECOND-MARKER/.test(value))).toEqual([])
  const drawn = await drawnOf(pane)
  expect(drawn).toContain('data-reviewer (no readable vote)')
  expect(drawn).not.toMatch(/FIRST-MARKER|SECOND-MARKER/)
})

test('the text of an unreadable vote is not in the decision owed to a watched pull request, nor in any state write', async ($, on) => {
  const written: string[] = []
  on('state.set', ($, e, next) => {
    written.push(JSON.stringify(e.value))
    return next(e)
  })
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await watch($)
  await loose($)({ ...brief, pull_request: 7 })

  // The data reviewer's vote cannot be read, so it is asked again, and then
  // all seven votes are readable and four of them choose the first option.
  const asked = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'OWED-MARKER 2 or 3', 'none']) })).result)
  expect(asked).toContain('OWED-MARKER')
  const decided = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })).result)
  expect(decided).toContain('The counsel chose: a 90-second poll. 4 of 7 members voted for it.')

  // The decision is owed to the pull request, so the store was written to and
  // its silence on the marker means something.
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual(['counsel-owed:o/r#7:session-1:c1'])
  expect([...stored.values()].map(value => JSON.stringify(value)).filter(value => value.includes('OWED-MARKER'))).toEqual([])
  expect(written.some(value => value.includes('builder:data-reviewer'))).toBe(true)
  expect(written.filter(value => value.includes('OWED-MARKER'))).toEqual([])
})

test('after a member is asked again, a tally with all seven votes counts as usual', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)
  await loose($)(brief)
  await loose($)(brief)

  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', undefined, 'none']) })
  const decided = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })).result)
  expect(decided).toContain('The counsel chose: a 90-second poll. 4 of 7 members voted for it.')

  await loose($)({ tool: TALLY, id: 'c2', round: 1, votes: ballots(['1', '1', '1', '2', '2', undefined, 'none']) })
  const short = String((await loose($)({ tool: TALLY, id: 'c2', round: 1, votes: ballots(['1', '1', '1', '2', '2', 'none', 'none']) })).result)
  expect(short).toContain('Ask the person: no option reached 4 of the 7 members who took part in round 1.')
})

test('a refusal for a member named twice records no one as asked again', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)
  await loose($)(brief)

  const twice = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: [...ballots(['1', '1', '1', '1', '1']), ballots(['1'])[0]] })).result)
  expect(twice).toContain('named twice')
  const missing = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '1']) })).result)
  expect(missing).toContain('Refused:')
  expect(missing).not.toContain('Ask the person')
})

test('a member asked again in round one gets a second chance of its own in round two', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)
  await loose($)(brief)

  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '2', 'none', '1', '2']) })
  const rerun = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '2', 'none', '1', '2', '2', '1'], 'only on events') })).result)
  expect(rerun).toContain('round 2')
  const second = String((await loose($)({ tool: TALLY, id: 'c1', round: 2, votes: ballots(['1', '2', '3', '1', '2']) })).result)
  expect(second).toContain('Refused:')
  expect(second).not.toContain('Ask the person')
})

test('the tally tool tells the session to report every member, and no longer to leave one out or abstain', async ($, on) => {
  const schemas: Record<string, unknown> = {}
  engine(on, schemas)
  mock.clock(on)
  mock.store(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)

  const text = JSON.stringify(schemas.counsel_tally)
  expect(text).not.toMatch(/leave out|abstain/i)
  expect(text).toContain('every member')
  expect(text).toContain('asked again')
})

const FOLLOW_UPS = ['The pane cuts long agent names.', 'The poll logs every look twice.', 'A retry message has a typo.']
const followUpsBrief = {
  tool: COUNSEL,
  question: 'What happens to each follow-up of this round?',
  follow_ups: FOLLOW_UPS,
  background: 'The verdicts approved round 2.',
  paths: ['docs/arch.md'],
  lean: 'LEAN-MARKER file the first',
}
// Each member's follow-up votes as the session reports them: one row per
// follow-up, member i voting column i; undefined leaves that vote out.
const followUpBallots = (rows: (string | undefined)[][]) => MEMBERS.map((member, i) => ({
  member,
  follow_ups: rows.flatMap((row, n) => (row[i] === undefined ? [] : [{ number: n + 1, vote: row[i], reason: `reason ${i} on ${n + 1}` }])),
}))
const DECIDING_ROWS = [
  ['file', 'file', 'file', 'file', 'fix', 'drop', 'none'],
  ['drop', 'drop', 'drop', 'drop', 'drop', 'file', 'file'],
  ['drop', 'drop', 'drop', 'file', 'file', 'file', 'fix'],
]

test('a follow-ups call writes a brief that numbers the follow-ups without the lean, and its tally decides each follow-up on its own', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
  await startOnly($)

  const asked = String((await loose($)(followUpsBrief)).result)
  const text = files.get('/repo/.git/builder/counsel/session-1/c1/brief.md') ?? ''
  expect(asked).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c1.')
  expect(asked).toContain('follow_ups')
  expect(text).toContain('1. The pane cuts long agent names.\n2. The poll logs every look twice.\n3. A retry message has a typo.')
  expect(text).toContain('VOTE 3: <fix|file|drop|none>')
  expect(text).not.toContain('NEW OPTION')
  expect(text).not.toContain('LEAN-MARKER')

  const counted = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(DECIDING_ROWS) })).result)
  expect(counted).toContain('Follow-up 1, "The pane cuts long agent names.": the counsel decided to file it as an issue, 4 of 7. Its reason: reason 0 on 1.')
  expect(counted).toContain('Follow-up 2, "The poll logs every look twice.": the counsel decided to drop it, 5 of 7.')
  expect(counted).toContain('Follow-up 3, "A retry message has a typo.": the counsel did not decide, so drop it.')
  expect(counted).toContain('Do not ask the person')
  expect(counted).not.toContain('Record it in the spec')

  // The round is counted once; a second tally is refused.
  const again = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(DECIDING_ROWS) })).result)
  expect(again).toContain('already tallied')

  await pane.redraw()
  const drawn = (await pane.find({ text: 'No pull request is watched' }))?.text ?? ''
  expect(drawn).toContain('c1 · round 1 · counted · What happens to each follow-up of this round?')
  expect(drawn).toContain('1. The pane cuts long agent names. · fix 1, file 4, drop 1, no option 1 · decided: file it as an issue')
  expect(drawn).toContain('3. A retry message has a typo. · fix 1, file 3, drop 3, no option 0 · not decided, so dropped')
})

test('a follow-ups call with options, an empty list, twenty-one follow-ups, two that say the same thing, or pull_request is refused and writes no brief, and twenty are accepted', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  const many = (n: number) => Array.from({ length: n }, (_, i) => `follow-up ${i + 1}`)

  const refusals = [
    { ...followUpsBrief, options: ['a', 'b'] },
    { ...followUpsBrief, follow_ups: [] },
    { ...followUpsBrief, follow_ups: many(21) },
    { ...followUpsBrief, follow_ups: ['The poll logs twice.', ' the poll LOGS twice. '] },
    { ...followUpsBrief, pull_request: 7 },
  ]
  for (const input of refusals) {
    const ran = String((await loose($)(input)).result)
    expect([input, ran.includes('Refused')]).toEqual([input, true])
  }
  expect([...files.keys()].some(path => path.includes('/counsel/'))).toBe(false)

  const accepted = String((await loose($)({ ...followUpsBrief, follow_ups: many(20) })).result)
  expect(accepted).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c1.')
  expect(files.get('/repo/.git/builder/counsel/session-1/c1/brief.md') ?? '').toContain('VOTE 20: <fix|file|drop|none>')
})

test('a follow-up given as an object outside the spec is offered only file and drop, and a vote to fix it sends its member back', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await startOnly($)

  const asked = String((await loose($)({ ...followUpsBrief, follow_ups: [FOLLOW_UPS[0], { text: FOLLOW_UPS[1], outside_spec: true }, FOLLOW_UPS[2]] })).result)
  const text = files.get('/repo/.git/builder/counsel/session-1/c1/brief.md') ?? ''
  expect(asked).toContain('Counsel brief: /repo/.git/builder/counsel/session-1/c1.')
  expect(text).toContain(`2. ${FOLLOW_UPS[1]} (outside the spec: file or drop only)`)
  expect(text).toContain('VOTE 2: <file|drop|none>')
  expect(text).toContain('VOTE 1: <fix|file|drop|none>')

  const rows = DECIDING_ROWS.map(row => [...row])
  rows[1]![0] = 'fix'
  const refused = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(rows) })).result)
  expect(refused).toContain('follow-up 2 is outside the spec and cannot be fixed in this pull request')
  expect(refused).toContain(`Launch exactly this member again, with the prompt "Counsel brief: /repo/.git/builder/counsel/session-1/c1.": ${MEMBERS[0]}.`)

  const refusedObject = String((await loose($)({ ...followUpsBrief, follow_ups: [{ text: 'x', outside_spec: false }] })).result)
  expect(refusedObject).toContain('Refused')
})

test('with a pull request watched, a follow-ups tally owes nothing, and the next review has no paragraph of counsel decisions', async ($, on) => {
  mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  fakeGitHub(on)
  const files = fakeFiles(on)
  await watch($)
  await loose($)(followUpsBrief)
  const counted = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(DECIDING_ROWS) })).result)
  expect(counted).toContain('nothing is owed to any review or spec')
  expect(counted).not.toContain('The mod lists this decision')
  expect([...stored.keys()].filter(key => key.startsWith('counsel-owed:'))).toEqual([])

  await loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  const review = files.get('/repo/.git/builder/cccccccc/review.md') ?? ''
  expect(review).toContain('Findings.')
  expect(review).not.toContain('Decided by the counsel')
})

test('a member lacking one follow-up\'s vote is asked again, and still lacking it, the round is counted without asking the person', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)
  await loose($)(followUpsBrief)
  // The data reviewer gives no vote on the third follow-up.
  const rows = [
    ['file', 'file', 'file', 'file', 'drop', 'drop', 'drop'],
    ['drop', 'drop', 'drop', 'drop', 'file', 'file', 'file'],
    ['fix', 'fix', 'fix', 'drop', 'drop', undefined, 'drop'],
  ]

  const first = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(rows) })).result)
  expect(first).toContain('Refused: round 1 of c1 is not counted')
  expect(first).toContain('- builder:data-reviewer: no vote on follow-up 3.')
  expect(first).toContain('Launch exactly this member again')

  const second = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(rows) })).result)
  expect(second).toContain('the counsel decided to file it as an issue, 4 of 7')
  expect(second).toContain('the counsel decided to drop it, 4 of 7')
  // 3 of the 6 votes that exist does not decide.
  expect(second).toContain('Follow-up 3, "A retry message has a typo.": the counsel did not decide, so drop it.')
  expect(second).toContain('Without a vote: builder:data-reviewer (no readable vote).')
  expect(second).not.toContain('Ask the person:')
})

test('a top-level vote on a follow-ups question and follow-up votes on an ordinary one are refused, and nothing is recorded', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)
  await loose($)(followUpsBrief)
  await loose($)(brief)

  const withVote = followUpBallots(DECIDING_ROWS).map((entry, i) => (i === 0 ? { ...entry, vote: '1', reason: 'r' } : entry))
  const refused = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: withVote })).result)
  expect(refused).toContain('Refused')
  expect(refused).toContain('Nothing was recorded.')
  const outOfRange = followUpBallots(DECIDING_ROWS).map((entry, i) => (i === 0 ? { ...entry, follow_ups: [{ number: 4, vote: 'fix', reason: '' }] } : entry))
  expect(String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: outOfRange })).result)).toContain('Refused')

  const ordinary = ballots(['1', '1', '1', '1', '2', 'none', 'none']).map((entry, i) => (i === 0 ? { ...entry, follow_ups: [{ number: 1, vote: 'fix', reason: '' }] } : entry))
  expect(String((await loose($)({ tool: TALLY, id: 'c2', round: 1, votes: ordinary })).result)).toContain('Refused')

  // Neither question was recorded as tallied, so both still count.
  expect(String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: followUpBallots(DECIDING_ROWS) })).result)).toContain('Counted:')
  expect(String((await loose($)({ tool: TALLY, id: 'c2', round: 1, votes: ballots(['1', '1', '1', '1', '2', 'none', 'none']) })).result)).toContain('Decided:')
})

test('the counsel tool offers follow_ups of 1 to 20 and no longer requires options, and the tally takes follow-up votes by number with only the member required', async ($, on) => {
  const schemas: Record<string, unknown> = {}
  engine(on, schemas)
  mock.clock(on)
  mock.store(on)
  fakeGitHub(on)
  fakeFiles(on)
  await startOnly($)

  type Schema = { properties: Record<string, { type?: string; minItems?: number; maxItems?: number; description?: string; items?: Schema & { required?: string[] } }>; required: string[] }
  const counselSchema = schemas.counsel as Schema
  expect(counselSchema.properties.follow_ups?.type).toBe('array')
  expect(counselSchema.properties.follow_ups?.minItems).toBe(1)
  expect(counselSchema.properties.follow_ups?.maxItems).toBe(20)
  expect(counselSchema.required).not.toContain('options')
  expect(counselSchema.required).not.toContain('follow_ups')

  const tallySchema = schemas.counsel_tally as Schema
  const entry = tallySchema.properties.votes?.items
  expect(entry?.required).toEqual(['member'])
  const followUps = entry?.properties.follow_ups?.items
  expect(Object.keys(followUps?.properties ?? {})).toEqual(['number', 'vote', 'reason'])
  expect(followUps?.required).toEqual(['number', 'vote', 'reason'])
})

// Answers the mod's $.ui.open as the engine would, with whatever `answer`
// holds at the time, and records each pane it was asked to open. The panes
// opened and not closed since are `listed`, which `$.ui.panes()` answers, and
// each pane the mod closes is recorded in `closed`. The test may change
// `listed` itself, as the person closing a pane does. While `isRefusing` is
// set, `$.ui.panes()` rejects.
function fakePanes(on: On) {
  const panes = {
    answer: { isPlaced: true } as { isPlaced: true } | { isPlaced: false; reason: string },
    opened: [] as { id: string; title?: string }[],
    closed: [] as string[],
    listed: [] as string[],
    isRefusing: false,
  }
  on('ui.open', ($, e) => {
    panes.opened.push({ id: e.id, title: e.title })
    if (!panes.listed.includes(e.id)) panes.listed.push(e.id)
    return { value: panes.answer }
  })
  on('ui.close', ($, e) => {
    panes.closed.push(e.id)
    panes.listed = panes.listed.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => {
    if (panes.isRefusing) throw new Error('the engine fell over')
    return { value: panes.listed.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) as never }
  })
  return panes
}

const NARROW = 'The terminal is 100 columns wide, under the 144 a pane opened unasked needs.'

test('the open_pane tool opens the builder pane and says it is open when the engine places it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = fakePanes(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const ran = await loose($)({ tool: 'mcp__builder__open_pane' })

  expect(panes.opened).toEqual([{ id: 'builder', title: 'builder' }])
  expect(String(ran.result)).toBe('builder: The pane is open.')
})

test('the open_pane tool says the pane waits, with the engine\'s reason exactly, when the engine does not place it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = fakePanes(on)
  panes.answer = { isPlaced: false, reason: NARROW }
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const ran = await loose($)({ tool: 'mcp__builder__open_pane' })

  expect(String(ran.result)).toContain('builder: The pane waits and is not drawn yet.')
  expect(String(ran.result)).toContain(`"${NARROW}"`)
  expect(String(ran.result)).not.toContain('is open')
})

test('/builder and the open_pane tool both say the pane is open when the engine places it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = fakePanes(on)
  on('command.run', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const tool = await loose($)({ tool: 'mcp__builder__open_pane' })
  const command = await $.command.run({ command: 'builder', args: '' } as never) as { text: string }

  expect(String(tool.result)).toBe('builder: The pane is open.')
  expect(command.text).toBe('The pane is open.')
  expect(panes.opened).toEqual(Array(2).fill({ id: 'builder', title: 'builder' }))
})

test('when the pane waits, both replies quote the engine\'s reason, and only the tool\'s tells the person to type /builder', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = fakePanes(on)
  panes.answer = { isPlaced: false, reason: NARROW }
  on('command.run', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const tool = String((await loose($)({ tool: 'mcp__builder__open_pane' })).result)
  const command = (await $.command.run({ command: 'builder', args: '' } as never) as { text: string }).text

  for (const reply of [tool, command]) {
    expect(reply).toContain('The pane waits and is not drawn yet.')
    expect(reply).toContain(`"${NARROW}"`)
    expect(reply).toContain('widening the terminal')
    expect(reply).not.toContain('is open')
  }
  expect(tool).toContain('typing /builder')
  // The person has just typed /builder, so the command's reply does not tell them to.
  expect(command).not.toContain('/builder')
})

test('calling the open_pane tool again answers the same as the first time', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = fakePanes(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const first = await loose($)({ tool: 'mcp__builder__open_pane' })
  const second = await loose($)({ tool: 'mcp__builder__open_pane' })

  expect(String(second.result)).toBe(String(first.result))
  expect(panes.opened).toHaveLength(2)
})

test('a subagent cannot open the builder pane', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = fakePanes(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })

  const ran = await loose($)({ tool: 'mcp__builder__open_pane', agentId: 'agent-1' })

  expect(String(ran.deny)).toContain('only the session')
  expect(panes.opened).toEqual([])
})

// The engine's list of agents, as `$.agent.list()` answers it. The test
// changes the list as it goes, as the engine does when an agent starts,
// finishes or is dropped.
function engineAgents(on: On) {
  const listed: { id: string; type: string; description: string; status: string }[] = []
  on('agent.list', () => ({ value: listed as never }))
  return listed
}

// Mounts the line above the prompt with the given props, and reads what it
// shows without drawing it again, so a test sees only the redraws the mod
// itself caused. The host draws its own line when the mod passes the band on.
// Called after the test's other hooks, since it is the first call on `$`.
async function liveBand($: Engine, on: On, props: object = {}) {
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const band = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, ...props } as never })
  return {
    band,
    shown: async () => (await band.find({ key: 'builder-line' }))?.text ?? '',
    isHost: async () => (await band.find({ text: 'host line' })) !== undefined,
  }
}

// The mod's values as it last wrote them, by key. The engine's `$` in a test
// has no `state` to read with, so the test watches the mod's writes instead.
function writtenState(on: On) {
  const written = new Map<string, unknown>()
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder') written.set(e.key, e.value)
    return next(e)
  })
  return {
    of: <T>(key: string, empty: T): T => (written.has(key) ? written.get(key) as T : empty),
    // The times of the wakes from one source, as the mod recorded them.
    wakesFrom: (source: string) => (written.get('wakes') as { at: number; source: string }[] | undefined ?? [])
      .filter(w => w.source === source).map(w => w.at),
  }
}
const idsOf = (list: { id: string }[]) => list.map(item => item.id)

// Answers every tool call that reaches beneath the mod, and keeps each one
// running until the test settles it by its tool_use_id: `finish` answers it
// with `answer`, and `fail` makes the tool throw.
function heldTools(on: On) {
  const open = new Map<string, { finish: (answer?: object) => void; fail: () => void }>()
  on('tool.call', ($, e) => new Promise((resolve, reject) => {
    open.set(String(e.tool_use_id), {
      finish: answer => resolve((answer ?? { result: 'done' }) as never),
      fail: () => reject(new Error('the tool threw')),
    })
  }))
  return open
}

// The session's own turn end as the Stop hook reports it, with its
// background work. The test's hook is the bottom of the chain.
const stops = (on: On) => on('classic.Stop', () => ({}))
const shellTask = { id: 'b1', type: 'shell', status: 'running', description: 'Run the suite', command: 'npm test' }
const agentTask = { id: 'b2', type: 'subagent', status: 'running', description: 'Review', agent_type: 'Explore' }
const monitorTask = { id: 'b3', type: 'monitor', status: 'running', description: 'Watch the build' }

test('an agent the mod never saw spawn is counted and named once a turn starts, and a waiting one counts too', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const listed = engineAgents(on)
  const line = await abovePrompt($, on)
  await startOnly($)

  // Resumed with SendMessage: the engine lists it, and no spawn reached the mod.
  listed.push({ id: 'agent-9', type: 'builder:spec-reviewer', description: 'Review the spec', status: 'running' })
  await $.turn.start({ text: 'go on', turnId: 't1' } as never)
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 agent: spec-reviewer')

  listed[0]!.status = 'waiting'
  await $.turn.start({ text: 'go on', turnId: 't2' } as never)
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 agent: spec-reviewer')
})

test('an agent that finishes leaves the line at the next 5-second read, with no turn.complete and no redraw by hand', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const listed = engineAgents(on)
  const state = writtenState(on)
  const { shown, isHost } = await liveBand($, on)
  await startOnly($)
  // Nothing runs yet, so the ticker the session start began stops; the read
  // at the turn's start, which finds the agents, starts it again.
  await clock.advance(5000)
  listed.push({ id: 'agent-1', type: 'Explore', description: 'Look around', status: 'running' }, { id: 'agent-2', type: 'Plan', description: 'Plan it', status: 'running' })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.settle()
  expect(await shown()).toBe('builder: no pull request yet · 2 agents: Explore, Plan')

  // One finishes, and the engine drops the other while it still says running.
  listed[0]!.status = 'completed'
  listed.splice(1, 1)
  await clock.advance(5000)

  expect(await shown()).toBe('')
  expect(await isHost()).toBe(true)
  const cards = state.of<{ id: string; status: string; isListed?: boolean }[]>('agents', [])
  expect(cards.map(card => [card.id, card.status, card.isListed])).toEqual([['agent-1', 'completed', true], ['agent-2', 'running', false]])
})

test('the line is shown with nothing watched while an agent runs, and hidden when nothing does', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const listed = engineAgents(on)
  const { shown, isHost, band } = await liveBand($, on)
  await startOnly($)
  await clock.settle()
  await band.redraw()
  expect(await shown()).toBe('')
  expect(await isHost()).toBe(true)

  // The engine refuses the spawn, so the mod never sees the agent start, and
  // only the ticker's read of the engine's list before it stops can find it.
  listed.push({ id: 'agent-1', type: 'general-purpose', description: 'Build it', status: 'running' })
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'go', description: 'Build it' } as never).catch(() => undefined)
  await clock.advance(5000)
  expect(await shown()).toBe('builder: no pull request yet · 1 agent: general-purpose')
})

test('an agent the mod sees spawn is on the line at the next second', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const listed = engineAgents(on)
  on('agent.spawn', () => ({ model: 'test', agentId: 'agent-1' }))
  const { shown, band } = await liveBand($, on)
  await startOnly($)
  await clock.settle()
  await band.redraw()
  expect(await shown()).toBe('')

  listed.push({ id: 'agent-1', type: 'general-purpose', description: 'Build it', status: 'running' })
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'go', description: 'Build it' } as never)
  await clock.advance(1000)
  expect(await shown()).toBe('builder: no pull request yet · 1 agent: general-purpose')
})

test('the Stop hook\'s background work is named, a background subagent is not counted twice, and the next turn end without it clears it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  const line = await abovePrompt($, on)
  await startOnly($)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask, agentTask] } as never)
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 background command')

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [monitorTask, shellTask] } as never)
  expect(await line()).toBe('builder: no pull request yet · 2 background tasks')

  // A subagent's own Stop says nothing about the session's work.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], agent_id: 'agent-1' } as never)
  expect(await line()).toBe('builder: no pull request yet · 2 background tasks')

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  expect(await line()).toBe('')

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await $.classic.Stop({ stop_hook_active: false } as never)
  expect(await line()).toBe('')
})

// Ends a subagent as the engine does, with the fields of the event a test
// varies, such as its background_tasks list.
function subagentStop($: Engine, over: object) {
  return $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '/t', agent_type: 'Explore', ...over } as never)
}

test('a subagent\'s end replaces the background work with the session-wide list it carries, and one without that list leaves it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  on('classic.SubagentStop', () => ({}))
  const line = await abovePrompt($, on)
  await startOnly($)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 background command')

  // An older engine sends no list, and a field that is not a list says nothing either.
  await subagentStop($, {})
  expect(await line()).toBe('builder: no pull request yet · 1 background command')
  await subagentStop($, { background_tasks: 'not a list' })
  expect(await line()).toBe('builder: no pull request yet · 1 background command')

  await subagentStop($, { background_tasks: [] })
  expect(await line()).toBe('')

  // The list is filtered as the Stop's is, so a background subagent is not counted twice.
  await subagentStop($, { background_tasks: [monitorTask, shellTask, agentTask] })
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 2 background tasks')
})

// The origin the engine stamps on a background task's notification row.
const NOTIFIED = { kind: 'task-notification' }

// Draws a user message row as the host does beneath the mod, with the row's
// text, and counts those draws. Registered before the line's own host hook,
// so it is the one that draws this row, and before the test's first call on
// `$`, as every hook beneath the mod is.
function rowHost(on: On) {
  const drawn = { count: 0 }
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    drawn.count += 1
    return ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'the task ended' })
  })
  return drawn
}

// Mounts a transcript row as the engine draws a user message.
async function transcriptRow($: Engine, props: { origin: object; task?: object }) {
  return $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'UserMessage', props: { text: 'the task ended', isExpanded: true, ...props } as never })
}

// Counts the mod's writes of its background list.
function backgroundWrites(on: On) {
  const writes = { count: 0 }
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'background') writes.count += 1
    return next(e)
  })
  return writes
}

for (const status of ['completed', 'failed', 'killed']) {
  test(`a notification row for a listed background command that ${status} takes it off the line, and the row still draws`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engine(on)
    fakeGitHub(on)
    stops(on)
    const writes = backgroundWrites(on)
    rowHost(on)
    const line = await abovePrompt($, on)
    await startOnly($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
    await clock.settle()
    expect(await line()).toBe('builder: no pull request yet · 1 background command')
    writes.count = 0

    // Mounting the row is its first draw.
    const notice = await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status } })
    await clock.settle()

    expect(await notice.find({ text: 'the task ended' })).toBeDefined()
    expect(await line()).toBe('')
    expect(writes.count).toBe(1)
    // The same row drawn again, as on every redraw or after a resume, finds no match and writes nothing.
    await notice.redraw()
    await clock.settle()
    expect(writes.count).toBe(1)
  })
}

const leftAlone: [string, { origin: object; task?: object }][] = [
  ['another task\'s id', { origin: NOTIFIED, task: { id: 'other', status: 'completed' } }],
  ['no id', { origin: NOTIFIED, task: { status: 'completed' } }],
  ['an empty id', { origin: NOTIFIED, task: { id: '', status: 'completed' } }],
  ['a status of running', { origin: NOTIFIED, task: { id: shellTask.id, status: 'running' } }],
  ['no task', { origin: NOTIFIED }],
  ['the composer\'s origin', { origin: { kind: 'composer' }, task: { id: shellTask.id, status: 'completed' } }],
]
for (const [what, props] of leftAlone) {
  test(`a transcript row with ${what} leaves the background command on the line and writes nothing`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engine(on)
    fakeGitHub(on)
    stops(on)
    const writes = backgroundWrites(on)
    rowHost(on)
    const line = await abovePrompt($, on)
    await startOnly($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
    await clock.settle()
    writes.count = 0

    const notice = await transcriptRow($, props)
    await notice.redraw()
    await clock.settle()

    expect(await notice.find({ text: 'the task ended' })).toBeDefined()
    expect(await line()).toBe('builder: no pull request yet · 1 background command')
    expect(writes.count).toBe(0)
  })
}

test('a notification row is not drawn again when the background list changes later, because its draw reads nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  on('classic.SubagentStop', () => ({}))
  const drawn = rowHost(on)
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.settle()
  const drawsBefore = drawn.count
  expect(drawsBefore).toBeGreaterThan(0)

  // An empty list keeps the live ticker from redrawing everything, so only a
  // subscription could draw the row again.
  await subagentStop($, { background_tasks: [monitorTask] })
  await subagentStop($, { background_tasks: [] })
  await clock.settle()

  expect(drawn.count).toBe(drawsBefore)
})

for (const fault of ['get', 'set'] as const) {
  test(`a refused ${fault === 'get' ? 'read' : 'write'} of the background list leaves the command on the line, and the row draws`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engine(on)
    fakeGitHub(on)
    stops(on)
    const refusal = fault === 'get' ? refusedReads(on, 'background') : refusedWrites(on, 'background')
    rowHost(on)
    const line = await abovePrompt($, on)
    await startOnly($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
    await clock.settle()

    if ('reads' in refusal) refusal.reads = 1
    else refusal.writes = 1
    const notice = await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
    await clock.settle()

    expect(await notice.find({ text: 'the task ended' })).toBeDefined()
    expect('reads' in refusal ? refusal.reads : refusal.writes).toBe(0)
    // Nothing was removed, so the line still names the command until the next turn end.
    expect(await line()).toBe('builder: no pull request yet · 1 background command')
  })
}

// Counts the mod's reads of its background list.
function backgroundReads(on: On) {
  const reads = { count: 0 }
  on('state.get', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'background') reads.count += 1
    return next(e)
  })
  return reads
}

test('an ended subagent\'s notification row, and a row whose task already left the list, start no removal and read nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  const reads = backgroundReads(on)
  const writes = backgroundWrites(on)
  rowHost(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask, agentTask] } as never)
  await clock.settle()
  const handled = await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.settle()
  expect(await line()).toBe('')
  reads.count = 0
  writes.count = 0

  // A subagent is never in the background list, and the shell task has left it.
  const subagent = await transcriptRow($, { origin: NOTIFIED, task: { id: agentTask.id, status: 'completed' } })
  await subagent.redraw()
  await handled.redraw()
  await clock.settle()

  expect(await subagent.find({ text: 'the task ended' })).toBeDefined()
  expect(reads.count).toBe(0)
  expect(writes.count).toBe(0)
})

test('a task that a later subagent\'s list puts back after its notification removed it is taken off again at the row\'s next draw', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  on('classic.SubagentStop', () => ({}))
  rowHost(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  const notice = await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.settle()
  expect(await line()).toBe('')

  await subagentStop($, { background_tasks: [shellTask] })
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 background command')
  await notice.redraw()
  await clock.settle()

  expect(await line()).toBe('')
})

test('a notification row drawn before this module has written or read the list, as after a hot reload, still takes its task off', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  // The list a build before the reload saved, which this module has not written.
  olderBuildState(on, { background: [shellTask] })
  rowHost(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 background command')

  const notice = await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.settle()

  expect(await notice.find({ text: 'the task ended' })).toBeDefined()
  expect(await line()).toBe('')
})

test('a turn end that replaces the list while a removal waits on a late read is not undone in the ids the rows check', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  on('classic.SubagentStop', () => ({}))
  rowHost(on)
  // Holds the answer to the next read of the list, as a slow store would.
  const late = answerWaits(on, 'state.get', 'background')
  const line = await abovePrompt($, on)
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.settle()

  // The shell command's row starts a removal whose read answers late, and a
  // subagent's end replaces the list with a monitor in the meantime.
  late.arm()
  await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.advance(0)
  await subagentStop($, { background_tasks: [monitorTask] })
  late.release()
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 background task')

  // The monitor's own row still takes it off.
  await transcriptRow($, { origin: NOTIFIED, task: { id: monitorTask.id, status: 'completed' } })
  await clock.settle()
  expect(await line()).toBe('')
})

test('after a hot reload, a notification row whose task is not listed fills in the ids, so a later subagent\'s row reads nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  // An empty list an earlier build saved, so nothing runs and only the rows
  // read it. A read refused below is how the test sees that one was made.
  const refusal = olderBuildState(on, { background: [] }, 'background')
  rowHost(on)
  await startOnly($)
  await clock.settle()

  // The ids are not known yet, so this row's task is looked up once.
  await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.settle()
  refusal.reads = 1

  await transcriptRow($, { origin: NOTIFIED, task: { id: agentTask.id, status: 'completed' } })
  await clock.settle()

  expect(refusal.reads).toBe(1)
})

test('ids that a removal\'s late answer left behind after a subagent\'s end are put right at the next tick, so the new task\'s row still takes it off', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  on('classic.SubagentStop', () => ({}))
  rowHost(on)
  // Holds the answer to the next write of the list after the write has landed,
  // as another plugin's hook on writes may.
  const late = answerWaits(on, 'state.set', 'background')
  const line = await abovePrompt($, on)
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.settle()

  late.arm()
  await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.advance(0)
  await clock.advance(0)
  await subagentStop($, { background_tasks: [monitorTask] })
  late.release()
  await clock.settle()
  expect(await line()).toBe('builder: no pull request yet · 1 background task')

  await transcriptRow($, { origin: NOTIFIED, task: { id: monitorTask.id, status: 'completed' } })
  await clock.advance(2_000)

  expect(await line()).toBe('')
})

test('once a notification row has taken the last background command away and nothing runs, the live ticker stops', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  const engineList = countedAgents(on)
  const redraws = redrawsAsked(on)
  rowHost(on)
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.advance(10_000)
  // The command keeps the display redrawn every second while it is listed.
  expect(redraws.length).toBeGreaterThanOrEqual(10)

  await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
  await clock.advance(5000)
  redraws.length = 0
  engineList.reads = 0
  await clock.advance(10_000)

  expect(redraws).toEqual([])
  expect(engineList.reads).toBe(0)
})

test('a tick whose read of the background list a turn end\'s write overtakes neither stops the ticker nor keeps the older list, so the new task\'s row takes it off', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  countedAgents(on)
  const redraws = redrawsAsked(on)
  rowHost(on)
  const late = answerWaits(on, 'state.get', 'background')
  const line = await abovePrompt($, on)
  await startOnly($)
  await clock.settle()

  // Nothing runs, so the first tick starts the read of the engine's list that
  // the ticker needs before it stops, and the second tick would stop it. That
  // second tick's read of the background list answers late, and a turn end
  // writes a task while it does.
  await clock.advance(1000)
  const seen = late.seen
  late.arm()
  try {
    await clock.advance(1000)
    expect(late.seen).toBe(seen + 1)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [monitorTask] } as never)
  } finally {
    late.release()
  }
  await clock.settle()

  redraws.length = 0
  await clock.advance(1000)
  expect(redraws).toContain('ui.render')
  expect(await line()).toBe('builder: no pull request yet · 1 background task')
  await transcriptRow($, { origin: NOTIFIED, task: { id: monitorTask.id, status: 'completed' } })
  await clock.settle()
  expect(await line()).toBe('')
})

test('a tick whose read of the background list a turn end\'s write of an empty list overtakes lets the ticker stop after its idle read', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  const engineList = countedAgents(on)
  const redraws = redrawsAsked(on)
  const late = answerWaits(on, 'state.get', 'background')
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.advance(3000)

  // A tick's read answers late, and a turn end empties the list meanwhile.
  late.arm()
  try {
    await clock.advance(1000)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  } finally {
    late.release()
  }
  await clock.advance(5000)

  redraws.length = 0
  engineList.reads = 0
  const seen = late.seen
  await clock.advance(10_000)
  expect(redraws).toEqual([])
  expect(engineList.reads).toBe(0)
  expect(late.seen).toBe(seen)
})

test('a removal by a notification row that lands while a tick\'s read of the background list is answered leaves the ids as the removal wrote them', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  rowHost(on)
  const late = answerWaits(on, 'state.get', 'background')
  await startOnly($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.advance(500)

  // The tick's read answers with the command still listed, after the
  // command's row has taken it off.
  late.arm()
  let row: Awaited<ReturnType<typeof transcriptRow>>
  try {
    await clock.advance(500)
    row = await transcriptRow($, { origin: NOTIFIED, task: { id: shellTask.id, status: 'completed' } })
    await clock.advance(0)
  } finally {
    late.release()
  }
  await clock.settle()

  // The row drawn again before the next tick finds its task gone from the
  // ids, and so reads nothing.
  const seen = late.seen
  await row.redraw()
  await clock.settle()
  expect(late.seen).toBe(seen)
})

test('a question still open when the session starts again is settled, and the label the mod put on for it is taken off', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const tools = heldTools(on)
  const line = await abovePrompt($, on)
  await watch($)
  await clock.settle()

  const asked = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Which name?' }] })
  await clock.settle()
  expect(await line()).toContain('waiting on your answer')
  expect(world.calls).toContain('gh pr edit 7 --repo o/r --add-label needs-decision')

  // The mod's hooks load again, as after a hot reload, with the question open.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  expect(await line()).not.toContain('waiting on your answer')
  expect(world.calls).toContain('gh pr edit 7 --repo o/r --remove-label needs-decision')

  tools.get('q1')!.finish({ result: { answers: {} } })
  await asked
})

test('the band mounted with the width it is given fits the line to it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const listed = engineAgents(on)
  sessionTurns(on)
  const { band, shown } = await liveBand($, on, { bodyColumns: 50 })
  await startOnly($)
  for (const type of ['Explore', 'builder:spec-reviewer', 'builder:adversarial-reviewer', 'builder:security-reviewer', 'Plan']) {
    listed.push({ id: `agent-${listed.length + 1}`, type, description: type, status: 'running' })
  }
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.settle()
  await band.redraw()

  const text = await shown()
  expect(text.startsWith('builder: no pull request yet · 5 agents:')).toBe(true)
  expect(text.length).toBeLessThanOrEqual(50)
  expect(text.endsWith('…')).toBe(true)
})

test('pressing the line opens the builder pane', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  const listed = engineAgents(on)
  sessionTurns(on)
  const { band } = await liveBand($, on)
  await startOnly($)
  listed.push({ id: 'agent-1', type: 'Explore', description: 'Look', status: 'running' })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.settle()
  await band.redraw()

  await band.press({ key: 'builder-line' })

  expect(panes.opened).toEqual([{ id: 'builder', title: 'builder' }])
})

test('the session\'s own call is named once it has run 10 seconds, with no keystroke, and not before', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const tools = heldTools(on)
  const state = writtenState(on)
  const { shown } = await liveBand($, on)
  // The ticker starts with the session, out of phase with the call.
  await startOnly($)
  await clock.advance(3000)

  const call = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'claude plugin test .', description: 'Run the gates' })
  await clock.advance(9999)
  expect(await shown()).toBe('')
  await clock.advance(1)
  expect(await shown()).toBe('builder: no pull request yet · running: Run the gates (10s)')

  tools.get('u1')!.finish()
  await call
  await clock.settle()
  expect(state.of('calls', [1])).toEqual([])
  expect(await shown()).toBe('')
})

test('a call that throws is no longer recorded, and of two overlapping calls the one still running is named', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const tools = heldTools(on)
  const state = writtenState(on)
  const line = await abovePrompt($, on)
  await startOnly($)

  const first = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'npm test' }).catch(() => undefined)
  await clock.advance(2000)
  const second = loose($)({ tool: 'Grep', tool_use_id: 'u2', pattern: 'x' })
  await clock.advance(10_000)
  expect(await line()).toBe('builder: no pull request yet · running: npm test (12s)')
  expect(idsOf(state.of('calls', []))).toEqual(['u1', 'u2'])

  tools.get('u1')!.fail()
  await first
  await clock.settle()
  expect(idsOf(state.of('calls', []))).toEqual(['u2'])
  expect(await line()).toBe('builder: no pull request yet · running: Grep (10s)')

  tools.get('u2')!.finish()
  await second
  expect(state.of('calls', [1])).toEqual([])
})

test('a subagent\'s call, a question to the owner and an Agent call are never named', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  engineAgents(on)
  const tools = heldTools(on)
  const state = writtenState(on)
  const line = await abovePrompt($, on)
  await startOnly($)

  const calls = [
    loose($)({ tool: 'Read', tool_use_id: 'u1', file_path: '/repo/a.ts', agentId: 'agent-1' }),
    loose($)({ tool: 'AskUserQuestion', tool_use_id: 'u2', questions: [{ question: 'Which?' }] }),
    loose($)({ tool: 'Agent', tool_use_id: 'u3', subagent_type: 'Explore', prompt: 'look', description: 'look' }),
  ]
  await clock.advance(15_000)

  // The session start emptied the calls, and none was recorded since.
  expect(state.of('calls', [1])).toEqual([])
  expect(await line()).not.toContain('running:')
  for (const id of ['u1', 'u2', 'u3']) tools.get(id)!.finish()
  await Promise.all(calls)
})

test('before a pull request is watched, the pane lists the agents and the background work above the counsel', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  stops(on)
  sessionTurns(on)
  const listed = engineAgents(on)
  const pane = await counselPane($)
  await startOnly($)
  listed.push({ id: 'agent-1', type: 'Explore', description: 'Map the hooks', status: 'running' })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await loose($)(brief)
  await clock.settle()

  const drawn = await drawnOf(pane)
  expect(drawn).toContain('running Explore · Map the hooks')
  expect(drawn).toContain('running shell · Run the suite')
  expect(drawn.indexOf('Agents')).toBeLessThan(drawn.indexOf('Background'))
  expect(drawn.indexOf('Background')).toBeLessThan(drawn.indexOf('Counsel'))
})

// Answers the session's Bash calls beneath the mod with `answer`, which the
// test sets: a success, an error, a command moved to the background, or a
// refusal.
function bashAnswers(on: On) {
  const bash = { answer: { result: { stdout: '', stderr: '', interrupted: false } } as object }
  on('tool.call', () => bash.answer as never)
  return bash
}

test('a gh pr merge in the middle of a turn is followed by looks 10 and 40 seconds on, and the line then says merged', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  bashAnswers(on)
  const state = writtenState(on)
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'merge it', turnId: 't1' } as never)
  const at = clock.now()

  world.pr = openPullRequest({ state: 'MERGED' })
  await loose($)({ tool: 'Bash', command: 'gh pr merge 7 --merge --match-head-commit cccccccc', description: 'Merge the pull request' })
  await clock.advance(10_000)
  expect(await line()).toBe('builder: #7 merged · checks passed · not polling')
  await clock.advance(30_000)

  expect(state.wakesFrom('after-command')).toEqual([at + 10_000, at + 40_000])
})

test('a second push replaces the looks still pending from the first, and the merge command the project names counts as a merge', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  bashAnswers(on)
  const files = fakeFiles(on)
  files.set('/repo/CLAUDE.md', 'Merge command: node scripts/merge-gate.mjs <pr>\n')
  const state = writtenState(on)
  await watch($)
  const at = clock.now()

  await loose($)({ tool: 'Bash', command: 'git push origin HEAD' })
  await clock.advance(20_000)
  await loose($)({ tool: 'Bash', command: 'cd /repo && node scripts/merge-gate.mjs 7' })
  await clock.advance(60_000)

  expect(state.wakesFrom('after-command')).toEqual([at + 10_000, at + 30_000, at + 60_000])
})

test('a push that failed, was moved to the background or was refused is followed by no look', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const bash = bashAnswers(on)
  const state = writtenState(on)
  await watch($)

  bash.answer = { isError: true, result: 'rejected', text: 'rejected' }
  await loose($)({ tool: 'Bash', command: 'git push' })
  bash.answer = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
  await loose($)({ tool: 'Bash', command: 'git push' })
  bash.answer = { deny: 'not allowed' }
  await loose($)({ tool: 'Bash', command: 'git push' })
  await clock.advance(60_000)

  expect(state.wakesFrom('after-command')).toEqual([])
})

test('turns that end at 0 and 16 seconds are followed by looks at 10, 26 and 40 seconds, so a short turn cancels no look', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const state = writtenState(on)
  await watch($)
  const at = clock.now()

  await $.turn.start({ text: 'one', turnId: 't1' } as never)
  await turnEnds($, 't1')
  await clock.advance(16_000)
  await $.turn.start({ text: 'two', turnId: 't2' } as never)
  await turnEnds($, 't2')
  await clock.advance(24_000)

  expect(state.wakesFrom('turn-end')).toEqual([at + 10_000, at + 26_000, at + 40_000])
})

test('a look whose read lands after a newer look\'s result was stored is dropped, so the line still says merged', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  const line = await abovePrompt($, on)
  await watch($)
  await clock.settle()

  // The older look reads the pull request open and is held there.
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  const older = $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  // A newer look reads it merged and stores that.
  world.pr = openPullRequest({ state: 'MERGED' })
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await older
  await clock.settle()

  expect(await line()).toBe('builder: #7 merged · checks passed · not polling')
})

test('the look after posting a review that a newer look overtakes still records the review as told, so no poll hands it back', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  // Once the review is posted GitHub shows it, and the look that follows
  // the post is held reading it.
  let release = () => {}
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
    world.hold = new Promise<void>(resolve => { release = resolve })
  }
  await watch($)
  await clock.settle()

  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  // A newer look, which only observes, reads the review and stores it first.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await post
  await clock.advance(10 * 60_000)

  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('the look after posting a review still records the review as told when two newer looks overtake it, so no poll hands it back', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  // Once the review is posted GitHub shows it, and the look that follows
  // the post is held reading it.
  let release = () => {}
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
    world.hold = new Promise<void>(resolve => { release = resolve })
  }
  await watch($)
  await clock.settle()

  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  // A newer look, which only observes, reads the review and stores it first.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  // The next read of the pull request is held too, whichever look makes it,
  // while a third look, which only observes, stores the review once more.
  const releaseFirst = release
  world.hold = new Promise<void>(resolve => { release = resolve })
  releaseFirst()
  await clock.settle()
  const third = $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  release()
  await third
  await post
  await clock.advance(10 * 60_000)

  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a held change is still handed over at the end of the turn when a newer look overtakes the look that hands it over', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  on('command.run', () => ({ text: '' }))

  // A poll during the turn finds the checks failed and holds the change.
  await watch($)
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = failing()
  await clock.advance(10 * 60_000)
  expect(prompts).toEqual([])

  // The turn ends, and the look that hands the change over is held reading
  // the pull request while a newer look, which only observes, stores it.
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  await turnEnds($, 't1')
  await clock.settle()
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('The checks went from passed to failed.')
})

test('the desktop app\'s CI event still carries the pull request\'s state when a newer look overtakes its read', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  const seen: { text: string; context: readonly string[] }[] = []
  on('prompt.submit', ($, e) => {
    seen.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text }
  })
  await watch($)
  await clock.settle()

  // The event's read is held while a newer look, which only observes, stores
  // the failure first.
  world.pr = failing()
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await event
  await clock.advance(10 * 60_000)

  // The event's own prompt carries the state, and no poll repeats the failure.
  expect(seen.length).toBe(1)
  expect(seen[0]?.context.join('\n')).toContain('Checks: failed (failed: "tests").')
})

test('an overtaken poll hands nothing over once a newer look has handed a newer state over, so the session is never told the pull request went backwards', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)

  // A poll during the turn finds the checks failed and holds the change.
  await watch($)
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = failing()
  await clock.advance(10 * 60_000)
  // The next poll is held reading the failure while the turn runs on.
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(10 * 60_000)
  // The pull request moves to head D, and the look at the end of the turn
  // hands D over.
  world.pr = pushedD()
  await turnEnds($, 't1')
  await clock.settle()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('dddddddd')

  // The held poll's older read comes back after D was handed over.
  release()
  await clock.settle()
  await clock.advance(10 * 60_000)

  expect(prompts.slice(1)).toEqual([])
})

// The pull request with one check, "tests", completed with `conclusion` at
// `completedAt`, so a rerun is told apart from the run before it.
const testsRun = (conclusion: string, completedAt: string) => openPullRequest({
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'tests', status: 'COMPLETED', conclusion, completedAt }],
})
const RUN_1 = '2026-10-12T10:00:00Z'
const RUN_2 = '2026-10-12T10:05:00Z'
const RUN_3 = '2026-10-12T10:10:00Z'

test('a poll that reads a check passing again, with nothing else changed, submits no prompt and logs no change', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  const state = writtenState(on)
  world.pr = testsRun('SUCCESS', RUN_1)
  await watch($)
  await clock.settle()

  // The check is rerun between two polls and passes as it passed before.
  world.pr = testsRun('SUCCESS', RUN_2)
  await clock.advance(10 * 60_000)

  expect(prompts).toEqual([])
  const polls = state.of<{ source: string; changed: boolean }[]>('wakes', []).filter(w => w.source === 'poll')
  expect(polls.map(w => w.changed)).toEqual([false])
})

test('an overtaken poll hands over the newer stored read: a rerun that passed, not a failure that failed again', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  // The session is told the check failed.
  world.pr = testsRun('FAILURE', RUN_1)
  await watch($)
  await clock.settle()

  // The poll reads the check failed again and is held there.
  world.pr = testsRun('FAILURE', RUN_2)
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(90_000)
  // The rerun passes, and a newer look, which only observes, stores that.
  world.pr = testsRun('SUCCESS', RUN_3)
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Check "tests" went from failed to passed.')
  expect(prompts[0]).not.toContain('failed again')
  const toldRecord = stored.get('prompted:session-1:o/r#7') as { checks: unknown[] }
  expect(toldRecord.checks).toEqual([{ name: 'tests', state: 'passed', completedAt: RUN_3 }])
})

test('an overtaken poll whose newer stored read is what the session was told sends no prompt', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  world.pr = testsRun('SUCCESS', RUN_1)
  await watch($)
  await clock.settle()

  // The poll reads a failure and is held there; then the pull request goes
  // back to the state the session was told, and a newer look stores that.
  world.pr = testsRun('FAILURE', RUN_2)
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(10 * 60_000)
  world.pr = testsRun('SUCCESS', RUN_1)
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await clock.settle()
  await clock.advance(10 * 60_000)

  expect(prompts).toEqual([])
})

test('the look after posting a review, overtaken by the desktop app\'s CI event, does not record its older state over the failure the event told, so no prompt repeats the failure', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  sessionTurns(on)
  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const reviewed = [verdictReview(C, 'APPROVE', 'APPROVE')]
  // Once the review is posted GitHub shows it, and the look that follows
  // the post is held reading it.
  let release = () => {}
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: reviewed })
    world.hold = new Promise<void>(resolve => { release = resolve })
  }
  await watch($)
  await clock.settle()

  await $.turn.start({ text: 'review it', turnId: 't1' } as never)
  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  // The checks fail, and the CI event's look reads the failure, passes it
  // in the event's context and records it as told.
  world.pr = { ...failing(), reviews: reviewed }
  await $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  // The look after the post comes back with its older, passing read.
  release()
  await post
  await turnEnds($, 't1')
  await clock.advance(10 * 60_000)

  expect(prompts.filter(text => text.includes('The checks went from passed to failed.'))).toEqual([])
})

// Holds the first read of the session's busy flag made after `arm`, once a
// read of #7 has been made since `arm`, until `release`. The held read answers
// the value from when it began, as a read that the engine is slow to answer
// does.
function holdBusyRead(on: On, world: ReturnType<typeof fakeGitHub>) {
  const gate = { isArmed: false, mark: 0, release: () => {} }
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    const isAfterRead = world.calls.slice(gate.mark).some(call => call.startsWith('gh pr view 7'))
    if (gate.isArmed && e.plugin === 'builder' && e.key === 'busy' && isAfterRead) {
      gate.isArmed = false
      await new Promise<void>(resolve => { gate.release = resolve })
    }
    return answer
  })
  return {
    arm: () => {
      gate.isArmed = true
      gate.mark = world.calls.length
    },
    release: () => gate.release(),
  }
}

test('a hold recorded after the turn ended is handed over at once', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const busyRead = holdBusyRead(on, world)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  await watch($)
  await $.turn.start({ text: 'push', turnId: 't1' } as never)

  // The poll reads the new head and then reads busy while the turn runs; the
  // turn ends before that read answers.
  world.pr = pushedD()
  busyRead.arm()
  await clock.advance(10 * 60_000)
  await turnEnds($, 't1')
  await clock.settle()
  busyRead.release()
  await clock.settle()

  // Handed over without the clock moving, not at the next poll.
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('dddddddd')
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
})

test('a turn that starts again before the second read of busy keeps the hold, and that turn\'s end hands the change over', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const busyRead = holdBusyRead(on, world)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  await watch($)
  await $.turn.start({ text: 'push', turnId: 't1' } as never)

  // As above, but a new turn starts before the held read answers.
  world.pr = pushedD()
  busyRead.arm()
  await clock.advance(10 * 60_000)
  await turnEnds($, 't1')
  await clock.settle()
  await $.turn.start({ text: 'go on', turnId: 't2' } as never)
  busyRead.release()
  await clock.settle()
  expect(prompts).toEqual([])

  await turnEnds($, 't2')
  await clock.settle()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('dddddddd')
})

test('a turn that starts while the handover reads the owed decisions keeps the hold, and that turn\'s end hands the change over', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  sessionTurns(on)
  await oweOnSeven($)

  // The poll passes both reads of busy and waits on the owed decisions, and a
  // turn starts before that read answers.
  let release = () => {}
  stored.hold.prefix = 'counsel-owed:o/r#7:'
  stored.hold.until = new Promise<void>(resolve => { release = resolve })
  world.pr = pushedD()
  await clock.advance(10 * 60_000)
  await $.turn.start({ text: 'go on', turnId: 't2' } as never)
  release()
  await clock.settle()
  expect(prompts).toEqual([])

  await turnEnds($, 't2')
  await clock.settle()
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('dddddddd')
})

test('a new head whose handover was held polls at the ordinary interval, and a later head brings 90 seconds back', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'push', turnId: 't1' } as never)

  // The poll finds the new head while the turn runs, and holds it.
  world.pr = pushedD()
  await clock.advance(10 * 60_000)
  expect(await line()).toBe('builder: #7 open · checks passed · new head, handing over in 10m')

  world.pr = openPullRequest({ headRefOid: A, commits: [{ oid: C }, { oid: D }, { oid: A }] })
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  expect(await line()).toBe('builder: #7 open · checks passed · new head, handing over in 2m')
})

test('a new head whose handover was refused polls at the ordinary interval', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const record = refusablePrompts(on)
  const line = await abovePrompt($, on)
  await watch($)

  record.refusing = true
  world.pr = pushedD()
  await clock.advance(10 * 60_000)

  expect(record.prompts).toEqual([])
  expect(await line()).toBe('builder: #7 open · checks passed · new head, handing over in 10m')
})

test('a turn-end read that matches what the session was told, with no prompt submitted, still arms the looks after the turn end', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const record = refusablePrompts(on)
  sessionTurns(on)
  const state = writtenState(on)

  // A failure is held during the turn, and is fixed again before it ends.
  await watch($)
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = failing()
  await clock.advance(10 * 60_000)
  world.pr = openPullRequest()
  await turnEnds($, 't1')
  await clock.settle()
  const end = clock.now()
  await clock.advance(40_000)

  expect(record.prompts).toEqual([])
  expect(state.wakesFrom('turn-end')).toEqual([end, end + 10_000, end + 40_000])
})

test('a call that runs on past 10 seconds has its time kept current every second', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const tools = heldTools(on)
  const { shown } = await liveBand($, on)
  await startOnly($)
  // Nothing runs, so the ticker the session start began stops; the call
  // starts it again.
  await clock.advance(5000)

  const call = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'npm test' })
  await clock.advance(10_000)
  expect(await shown()).toBe('builder: no pull request yet · running: npm test (10s)')
  await clock.advance(1000)
  expect(await shown()).toBe('builder: no pull request yet · running: npm test (11s)')
  await clock.advance(4000)
  expect(await shown()).toBe('builder: no pull request yet · running: npm test (15s)')

  tools.get('u1')!.finish()
  await call
})

test('background work reported at a turn end keeps the line live, so an agent the engine lists later is named without a keystroke', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  stops(on)
  const listed = engineAgents(on)
  const { shown } = await liveBand($, on)
  await startOnly($)
  await clock.advance(5000)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shellTask] } as never)
  await clock.settle()
  expect(await shown()).toBe('builder: no pull request yet · 1 background command')
  listed.push({ id: 'agent-1', type: 'Explore', description: 'Look', status: 'running' })
  await clock.advance(5000)

  expect(await shown()).toBe('builder: no pull request yet · 1 agent: Explore · 1 background command')
})

test('a subagent that finishes records how it ended, on a card of its own when the mod never saw it start', async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const pane = await counselPane($)
  await startOnly($)

  await $.turn.complete({ answer: 'Findings.\nLENS-END security cccccccc findings=0', durationMs: 3000, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-5' } as never)
  await clock.settle()
  // Finished agents are folded under one button until it is pressed.
  await pane.press({ key: 'builder-fold' })

  const drawn = await drawnOf(pane)
  expect(drawn).toContain('completed agent')
  expect(drawn).toContain('3s · LENS-END security cccccccc findings=0')
})

// A store in memory whose next read or next write of a told record waits,
// once the test asks for it with `holdNext`, until the test calls the
// function `holdNext` answers. A test that passes `holdNext` another key
// prefix, such as the seen key's, holds the next call on a key with that
// prefix instead. A held read answers with the record as it
// stood when the read began, as a read the engine had already answered would,
// and a held write lets a later write finish before it, as the engine may.
function storeHoldingTold(on: On) {
  const stored = new Map<string, unknown>()
  const gates: Record<'get' | 'set', { held: Promise<void>; prefix: string } | null> = { get: null, set: null }
  const waitIfHeld = async (call: 'get' | 'set', key: string) => {
    const gate = gates[call]
    if (gate === null || !key.startsWith(gate.prefix)) return
    gates[call] = null
    await gate.held
  }
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('store.get', async ($, e) => {
    const value = stored.get(e.key)
    await waitIfHeld('get', e.key)
    return { value }
  })
  on('store.set', async ($, e) => {
    await waitIfHeld('set', e.key)
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => { stored.delete(e.key); return { value: undefined } })
  const holdNext = (call: 'get' | 'set', prefix = 'prompted:') => {
    let release = () => {}
    gates[call] = { held: new Promise<void>(resolve => { release = resolve }), prefix }
    return () => release()
  }
  return { stored, holdNext }
}

test('a poll whose handover is overtaken by the desktop app\'s CI event while it reads what was told sends no prompt repeating the event', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, so the CI event can record its
  // state as told in that moment.
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.settle()

  world.pr = failing()
  const release = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The poll's handover now waits on its read of what was told, and the CI
  // event tells the same failure meanwhile.
  await $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  release()
  await clock.settle()

  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a poll that read no change hands over nothing for a read the desktop app\'s CI event stored and has not yet told', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, so the CI event's look can
  // store its read in that moment.
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const release = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The checks fail, and the CI event's look stores the failure while the
  // event's own prompt waits.
  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  release()
  await clock.settle()
  held.release()
  await event
  await clock.settle()

  // The event's own prompt tells the failure, and the poll tells nothing.
  expect(held.prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
  // The event recorded the failure as told.
  const toldRecord = stored.get('prompted:session-1:o/r#7') as { head: string; checks: { name: string; state: string }[] }
  expect(toldRecord.head).toBe(C)
  expect(toldRecord.checks.map(check => [check.name, check.state])).toEqual([['tests', 'failed']])
})

test('a poll that read no change hands over nothing while the desktop app\'s CI event has not yet told its read, even after another look reads the same failure', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, so the CI event's look and
  // then /builder poll can store their reads in that moment.
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  on('command.run', () => ({ text: '' }))
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const release = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The checks fail, and the CI event's look stores the failure while the
  // event's own prompt waits.
  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  // /builder poll, a look that only observes and leaves its read for a
  // handover to tell, reads the same failure after the event's look.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  release()
  await clock.settle()
  held.release()
  await event
  await clock.advance(10 * 60_000)

  // The event's own prompt tells the failure once, and no poll repeats it.
  expect(held.prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
  const toldRecord = stored.get('prompted:session-1:o/r#7') as { head: string; checks: { name: string; state: string }[] }
  expect(toldRecord.head).toBe(C)
  expect(toldRecord.checks.map(check => [check.name, check.state])).toEqual([['tests', 'failed']])
})

test('a poll that read no change hands over nothing for a read the look after posting a review stored and has not yet told', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, and so does the look after the
  // post when it reads the seen time, between storing its read and telling it.
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
  }
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const releaseTold = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The review is posted, and the look after the post stores it and waits
  // before it records it as told.
  const releaseSeen = holdNext('get', 'seen:')
  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  releaseTold()
  await clock.settle()
  releaseSeen()
  await post
  await clock.settle()

  // The post's answer tells the review, and the poll tells nothing.
  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a poll that read no change hands over nothing while the look after posting a review has not yet told its read, even after another look reads the same review', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, and so does the look after the
  // post when it reads the seen time, between storing its read and telling it.
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
  }
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const releaseTold = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The review is posted, and the look after the post stores it and waits
  // before it records it as told.
  const releaseSeen = holdNext('get', 'seen:')
  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  // /builder poll, a look that only observes and leaves its read for a
  // handover to tell, reads the same review after the post's look.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  releaseTold()
  await clock.settle()
  releaseSeen()
  await post
  await clock.advance(10 * 60_000)

  // The post's answer tells the review, and no poll repeats it.
  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a poll that read no change hands over nothing while the desktop app\'s CI event, overtaken by /builder poll, has not yet told the failure it read', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, so the other looks can run in
  // that moment.
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  on('command.run', () => ({ text: '' }))
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const releaseTold = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The checks fail, and the CI event's look is held in its read of the pull
  // request.
  world.pr = failing()
  let releaseCiRead = () => {}
  world.hold = new Promise<void>(resolve => { releaseCiRead = resolve })
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  // /builder poll, a look that only observes, reads the failure and stores it
  // first.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  // The CI event's look comes back overtaken, goes on with its read, and its
  // prompt waits.
  releaseCiRead()
  await clock.settle()
  // The waiting poll chooses what to hand over, and then the event's prompt
  // goes on.
  releaseTold()
  await clock.settle()
  held.release()
  await event
  await clock.advance(10 * 60_000)

  // The event's own prompt tells the failure once, and no poll repeats it.
  expect(held.prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
  const toldRecord = stored.get('prompted:session-1:o/r#7') as { head: string; checks: { name: string; state: string }[] }
  expect(toldRecord.head).toBe(C)
  expect(toldRecord.checks.map(check => [check.name, check.state])).toEqual([['tests', 'failed']])
})

test('a poll that read no change hands over nothing while the look after posting a review, overtaken by /builder poll, has not yet told the review it read', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, and so does the look after the
  // post when it reads the seen time, between going on with its read and
  // telling it.
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  // The look after the post is held in its read of the pull request.
  let releaseReviewRead = () => {}
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
    world.hold = new Promise<void>(resolve => { releaseReviewRead = resolve })
  }
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const releaseTold = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  // /builder poll, a look that only observes, reads the review and stores it
  // first.
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.settle()
  // The look after the post comes back overtaken, goes on with its read, and
  // waits before it records it as told.
  const releaseSeen = holdNext('get', 'seen:')
  releaseReviewRead()
  await clock.settle()
  // The waiting poll chooses what to hand over, and then the post's look
  // finishes.
  releaseTold()
  await clock.settle()
  releaseSeen()
  await post
  await clock.advance(10 * 60_000)

  // The post's answer tells the review, and no poll repeats it.
  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a poll whose read of the told record is older than the CI event\'s record of the failure hands over nothing, even after another look reads the same failure', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, and answers with the record as
  // it stood before the CI event recorded the failure as told.
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  on('command.run', () => ({ text: '' }))
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const release = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The checks fail, the CI event's look stores the failure while the
  // event's own prompt waits, and /builder poll reads the same failure.
  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  // The event's prompt goes on and the event records the failure as told,
  // all while the poll still waits on its read of the told record.
  held.release()
  await event
  release()
  await clock.advance(10 * 60_000)

  // The event's own prompt tells the failure once, and no poll repeats it.
  expect(held.prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
  const toldRecord = stored.get('prompted:session-1:o/r#7') as { head: string; checks: { name: string; state: string }[] }
  expect(toldRecord.checks.map(check => [check.name, check.state])).toEqual([['tests', 'failed']])
})

test('a poll whose read of the told record is older than the record the look after posting a review wrote hands over nothing, even after another look reads the same review', async ($, on) => {
  const clock = mock.clock(on)
  // The poll's read of the told record waits, and so does the look after the
  // post when it reads the seen time, between storing its read and telling it.
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  const prompts = recordPrompts(on)
  on('command.run', () => ({ text: '' }))
  world.onPost = () => {
    world.pr = openPullRequest({ reviews: [verdictReview(C, 'APPROVE', 'APPROVE')] })
  }
  await watch($)
  await clock.settle()

  // The poll reads the pull request unchanged, and its handover waits on its
  // read of what was told.
  const releaseTold = holdNext('get')
  await clock.advance(10 * 60_000)
  await clock.settle()
  // The review is posted, the look after the post stores it and waits before
  // it records it as told, and /builder poll reads the same review.
  const releaseSeen = holdNext('get', 'seen:')
  const post = loose($)({ tool: 'mcp__builder__post_review', head: C, spec: 'APPROVE', adversarial: 'APPROVE', body: 'Findings.' })
  await clock.settle()
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  // The look after the post records the review as told, all while the poll
  // still waits on its read of the told record.
  releaseSeen()
  await post
  releaseTold()
  await clock.advance(10 * 60_000)

  // The post's answer tells the review, and no poll repeats it.
  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('a refused CI event prompt leaves the failure for the next poll, which hands it over once', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    if (e.text.includes('<ci-monitor-event>')) return { drop: 'not now' }
    prompts.push(e.text)
    return { text: e.text }
  })
  await watch($)
  await clock.settle()

  world.pr = failing()
  await $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  // Nothing recorded the failure as told, because the event's prompt was
  // refused, so the next poll hands it over, and the poll after that does not
  // repeat it.
  await clock.advance(10 * 60_000)
  await clock.advance(10 * 60_000)

  expect(prompts.filter(text => text.includes('pull request #7 changed')).length).toBe(1)
  const toldRecord = stored.get('prompted:session-1:o/r#7') as { checks: { name: string; state: string }[] }
  expect(toldRecord.checks.map(check => [check.name, check.state])).toEqual([['tests', 'failed']])
})

test('a poll overtaken by the desktop app\'s CI event hands over neither its own older read nor the event\'s, so the failure is told once', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const held = holdCiPrompt(on)
  await watch($)
  await clock.settle()

  // The poll reads the checks running and is held there.
  world.pr = checksRunning()
  let release = () => {}
  world.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(10 * 60_000)
  // The checks fail, and the CI event's look stores the failure while the
  // event's own prompt waits.
  world.pr = failing()
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  // The poll comes back with its older read, and then the event's prompt
  // goes on.
  release()
  await clock.settle()
  held.release()
  await event
  await clock.advance(10 * 60_000)

  // The event's own prompt tells the failure; no poll tells the running
  // checks the display has already moved past, or repeats the failure.
  expect(held.prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('two overlapping tells whose writes finish newest first leave the newer read told', async ($, on) => {
  const clock = mock.clock(on)
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.settle()

  // The poll hands the failure over, and its write of the told record waits.
  world.pr = failing()
  const release = holdNext('set')
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
  // The branch moves to D, and the desktop app's CI event tells that while
  // the poll's write still waits. The event is not awaited yet, because its
  // write may queue behind the held one.
  world.pr = { ...failing(), headRefOid: D, commits: [{ oid: C }, { oid: D }] } as GhPullRequest
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.settle()
  release()
  await event
  await clock.settle()

  expect((stored.get('prompted:session-1:o/r#7') as { head: string }).head).toBe(D)
})

test('a switch of pull requests while a told write for the old one waits leaves no record for the old one', async ($, on) => {
  const clock = mock.clock(on)
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.settle()

  // The poll hands the failure over, and its write of #7's told record waits.
  world.pr = failing()
  const release = holdNext('set')
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
  // The session watches #8 while that write still waits. The switch is not
  // awaited yet, because its delete of #7's record queues behind the write.
  world.otherNumber = 8
  const switching = loose($)({ tool: 'mcp__builder__watch', number: 8 })
  await clock.settle()
  release()
  await switching
  await clock.settle()

  // The delete ran after the held write, so the write did not bring #7 back.
  expect(stored.has('prompted:session-1:o/r#7')).toBe(false)
  expect(stored.has('prompted:session-1:o/r#8')).toBe(true)
})

test('a poll under a new watch whose told record is still being written hands over nothing, and a later change is handed over', async ($, on) => {
  const clock = mock.clock(on)
  const { stored, holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  const changes = () => prompts.filter(text => text.includes('pull request #7 changed'))
  await watch($)
  await clock.settle()

  // The checks fail, and the session watches #7 again. The watch tool
  // reports the failure, and its write of the told record waits, so the
  // record still says the checks passed.
  world.pr = failing()
  const release = holdNext('set')
  const watching = loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await clock.settle()
  // The poll the first watch scheduled runs under the new watch meanwhile.
  await clock.advance(10 * 60_000)
  expect(changes()).toEqual([])

  // The write lands, and the next poll finds what the watch tool reported.
  release()
  await watching
  await clock.settle()
  await clock.advance(10 * 60_000)
  expect(changes()).toEqual([])
  expect((stored.get('prompted:session-1:o/r#7') as { checks: { state: string }[] }).checks.map(check => check.state)).toEqual(['failed'])

  // A real change after that is handed over.
  world.pr = openPullRequest()
  await clock.advance(10 * 60_000)
  expect(changes().length).toBe(1)
  expect(changes()[0]).toContain('The checks went from failed to passed.')
})

test('a poll that began reading the told record while the watch tool\'s write was in flight hands over nothing, even when the write lands before the read answers', async ($, on) => {
  const clock = mock.clock(on)
  // The watch tool's write of the told record waits, and then so does the
  // poll's read of it, which answers with the record as it stood before.
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.settle()

  world.pr = failing()
  const releaseWrite = holdNext('set')
  const watching = loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await clock.settle()
  const releaseRead = holdNext('get')
  await clock.advance(10 * 60_000)
  // The write lands first, and then the poll's read answers with the old
  // record, after nothing is being written any more.
  releaseWrite()
  await watching
  await clock.settle()
  releaseRead()
  await clock.settle()
  await clock.advance(10 * 60_000)

  expect(prompts.filter(text => text.includes('pull request #7 changed'))).toEqual([])
})

test('no stuck prompt comes while a told record is being written, and once the write lands it comes', async ($, on) => {
  const clock = mock.clock(on)
  const { holdNext } = storeHoldingTold(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  const stuck = () => prompts.filter(text => text.includes('nothing has happened on pull request #7'))
  await watch($)
  await clock.settle()

  // Forty minutes into the quiet time, the session watches #7 again, and the
  // watch tool's write of the told record waits past the stuck prompt's time.
  await clock.advance(40 * 60_000)
  const release = holdNext('set')
  const watching = loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await clock.settle()
  await clock.advance(10 * 60_000)
  expect(stuck()).toEqual([])

  release()
  await watching
  await clock.advance(45 * 60_000)
  expect(stuck().length).toBe(1)
})

test('a told write that fails does not stop later handovers', async ($, on) => {
  const clock = mock.clock(on)
  const stored = memoryStore(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)
  const changes = () => prompts.filter(text => text.includes('pull request #7 changed'))
  await watch($)
  await clock.settle()

  // The poll hands the failure over, and the store refuses its write of the
  // told record.
  world.pr = failing()
  stored.hold.full = true
  await clock.advance(10 * 60_000)
  expect(changes().length).toBe(1)

  // Nothing recorded the failure as told, so the next poll hands it over
  // again, and its write lands.
  stored.hold.full = false
  await clock.advance(10 * 60_000)
  expect(changes().length).toBe(2)
  expect((stored.get('prompted:session-1:o/r#7') as { checks: { state: string }[] }).checks.map(check => check.state)).toEqual(['failed'])
})

const PROGRESS = 'mcp__builder__progress'
const TITLE = 'ABC-123 builder progress'
// A stage report as /implement makes it, under TITLE unless the case names another.
const report = ($: Engine, stage: string, over: object = {}) => loose($)({ tool: PROGRESS, title: TITLE, stage, ...over })

// Mounts the band above the prompt on a surface, with the width the band
// gives, and reads its rows, each drawn again by hand first so that a read
// shows the state as of now: the buttons by key, and the terminal's bar as
// the text row that counts the stages, since a text row carries no key. The host draws its own line when the mod
// passes the band on. Called after the test's other hooks, since it is the
// first call on `$`.
async function progressBand($: Engine, on: On, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 120) {
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const band = await $.ui.mount({ plugin: 'builder', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns } as never })
  const textOf = (query: { key: string } | { type: string; text: RegExp }) => async () => {
    await band.redraw()
    return (await band.find(query))?.text ?? ''
  }
  return { band, line: textOf({ key: 'builder-line' }), bar: textOf({ type: 'Text', text: / of 9 · / }), agents: textOf({ key: 'builder-agents' }) }
}

test('before open_pane and with nothing running there is no band; after it the line reads started and idle, and after a spec report the stage', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  const { line, bar, band } = await progressBand($, on)
  await startOnly($)
  expect(await line()).toBe('')
  expect(await band.find({ text: 'host line' })).toBeDefined()

  await loose($)({ tool: 'mcp__builder__open_pane' })
  expect(await line()).toBe('builder: started · idle')
  expect(await bar()).toBe('')

  const ran = await report($, 'spec')
  expect(String(ran.result)).toBe('builder: spec (2 of 9)')
  expect(await line()).toBe('builder: spec · idle')
  expect(await bar()).toBe(`${TITLE} · spec · ██░░░░░░░░ 2 of 9 · 22%`)
})

test('/builder starts builder as the open_pane tool does, so the band shows from then on', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  on('command.run', () => ({ text: '' }))
  const { line } = await progressBand($, on)
  await startOnly($)
  expect(await line()).toBe('')

  await $.command.run({ command: 'builder', args: 'wakes' } as never)
  expect(await line()).toBe('builder: started · idle')
})

test('a reported stage sets the bar to the stages before it, an earlier one changes only the label, one outside the list is refused, and a new title resets the bar', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  const { bar, line } = await progressBand($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })

  await report($, 'review', { note: 'round 2' })
  expect(await bar()).toBe(`${TITLE} · review rounds · round 2 · ████████░░ 7 of 9 · 78%`)
  const back = await report($, 'build')
  expect(String(back.result)).toBe('builder: build (7 of 9)')
  expect(await bar()).toBe(`${TITLE} · build · ████████░░ 7 of 9 · 78%`)

  const refused = await report($, 'deploy')
  expect(String(refused.result)).toBe('builder: deploy is not a stage of /implement; the stages are grounding, issue, spec, plan, build, verify, pr, review and merge.')
  expect(await bar()).toBe(`${TITLE} · build · ████████░░ 7 of 9 · 78%`)
  expect(await line()).toBe('builder: build · idle')

  await clock.advance(1000)
  await report($, 'issue', { title: 'ABC-300 the next issue' })
  expect(await bar()).toBe('ABC-300 the next issue · checking the issue · █░░░░░░░░░ 1 of 9 · 11%')
})

test('a started mark and a stage an older session left draw the band, and a malformed stage draws as none reported', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const seeded = { title: TITLE, stage: 'plan', furthest: 'build', note: '', since: 1, autoOpened: true }
  olderBuildState(on, { started: true, progress: seeded })
  const { line, bar } = await progressBand($, on)
  expect(await line()).toBe('builder: plan tournament · idle')
  expect(await bar()).toBe(`${TITLE} · plan tournament · ████░░░░░░ 4 of 9 · 44%`)
})

test('a progress value in another shape draws as no stage reported, without throwing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  olderBuildState(on, { started: true, progress: { title: TITLE, stage: 'deploy', furthest: 'deploy', note: '', since: 1 } })
  const { line, bar } = await progressBand($, on)
  expect(await line()).toBe('builder: started · idle')
  expect(await bar()).toBe('')
})

test('on the desktop the band is one drawing and two buttons with no text rows, and on the terminal it has no drawing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const desktop = await $.ui.mount({ plugin: 'builder', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } as never })
  const terminal = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } as never })
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec', { title: 'a<&>"b\'c' })
  await desktop.redraw()
  await terminal.redraw()

  expect(await desktop.findAll({ type: 'Text' })).toHaveLength(0)
  const drawings = await desktop.findAll({ type: 'Svg' })
  expect(drawings).toHaveLength(1)
  expect(String(drawings[0]!.props.source)).toContain('a&lt;&amp;&gt;&quot;b&apos;c')
  expect(String(drawings[0]!.props.source)).not.toContain('a<&>')
  expect((await desktop.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['builder-agents', 'builder-line'])

  expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
  const row = (await terminal.find({ type: 'Text', text: / of 9 · / }))?.text ?? ''
  expect(row).toContain('█')
  expect(row).toContain('░')
})

const ISSUE_ADDRESS = 'https://tracker.example.com/issue/{key}'
const ISSUE_LINK = 'https://tracker.example.com/issue/ABC-123'
// The bar's whole text row for the spec stage under TITLE.
const SPEC_ROW = `${TITLE} · spec · ██░░░░░░░░ 2 of 9 · 22%`

// Adds the Issue link fact to a file of fakeFiles, after what it already holds.
function issueLinkFact(files: ReturnType<typeof fakeFiles>, value: string, path = '/repo/CLAUDE.md') {
  files.set(path, `${files.get(path) ?? ''}Issue link: ${value}\n`)
}

// Records the text of every toast the mod shows.
function toastsOf(on: On) {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

// A mounted band or pane on any surface, as far as these reads need it.
type Drawing = {
  redraw: () => Promise<void>
  find: (query: ElementQuery) => Promise<FoundElement | undefined>
  findAll: (query: ElementQuery) => Promise<FoundElement[]>
}
// The links a drawing holds, each as its address and its children, drawn again
// first. A found link's text also holds its address, so the children are what
// show the key.
async function linksIn(drawing: Drawing) {
  await drawing.redraw()
  return (await drawing.findAll({ type: 'Link' })).map(link => ({ href: link.props.href, children: link.children }))
}
// The bar's text row on the terminal, found by its count, since a text row
// carries no key.
async function barRowIn(drawing: Drawing) {
  await drawing.redraw()
  return drawing.find({ type: 'Text', text: / of 9 · / })
}
// The tags and keys of a drawing's elements, outermost first in document order.
async function shapeOf(drawing: Drawing) {
  await drawing.redraw()
  return (await drawing.findAll({})).map(element => `${element.type}${element.key === undefined ? '' : ` ${element.key}`}`)
}

// Starts a session in `cwd`, opens builder and reports the spec stage under
// `title`, which draws the bar in the band and the pane.
async function reportSpec($: Engine, clock: { settle: () => Promise<void> }, cwd = '/repo', title = TITLE) {
  await $.session.start({ cwd, surface: null, isInteractive: true })
  await clock.settle()
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec', { title })
}

test('with an Issue link fact, the terminal band draws the key as a link inside the bar\'s text row, followed by the rest of the row', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), ISSUE_ADDRESS)
  const { band } = await progressBand($, on)
  await reportSpec($, clock)

  expect(await linksIn(band)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])
  const row = await barRowIn(band)
  expect(row?.type).toBe('Text')
  expect(row?.children).toHaveLength(2)
  expect(row?.children[1]).toBe(SPEC_ROW.slice('ABC-123'.length))
  expect(await shapeOf(band)).toEqual(['Box', 'Text', 'Link', 'Button builder-agents', 'Button builder-line'])
})

test('with an Issue link fact, the desktop band draws the key as a link on its own row above the drawing, which keeps its whole title', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), ISSUE_ADDRESS)
  const { band } = await progressBand($, on, 'desktop', 100)
  await reportSpec($, clock)

  expect(await linksIn(band)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])
  expect(await shapeOf(band)).toEqual(['Box', 'Link', 'Svg', 'Button builder-agents', 'Button builder-line'])
  const drawing = await band.find({ type: 'Svg' })
  expect(String(drawing?.props.source)).toContain(TITLE)
  expect(drawing?.props.alt).toBe(SPEC_ROW)
})

test('with an Issue link fact, the pane\'s work row has the link on the terminal and above the drawing on the desktop', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), ISSUE_ADDRESS)
  const terminal = await paneOn($, 'terminal', 120)
  const desktop = await paneOn($, 'desktop', 100)
  await reportSpec($, clock)

  expect(await linksIn(terminal)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])
  const row = await barRowIn(terminal)
  expect(row?.children[1]).toBe(SPEC_ROW.slice('ABC-123'.length))
  expect(await linksIn(desktop)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])
  const shape = await shapeOf(desktop)
  // The pane's first drawing is the bar, and the link comes directly before it.
  expect(shape.slice(shape.indexOf('Link'), shape.indexOf('Link') + 2)).toEqual(['Link', 'Svg'])
  expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toContain(TITLE)
})

test('at a width where the bar drops its title, the terminal row has no link and reads as it does without the fact', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), ISSUE_ADDRESS)
  const { band, bar } = await progressBand($, on, 'terminal', 50)
  await reportSpec($, clock)

  expect(await linksIn(band)).toEqual([])
  expect(await bar()).toBe('spec · ██░░░░░░░░ 2 of 9 · 22%')
  expect((await barRowIn(band))?.children).toEqual(['spec · ██░░░░░░░░ 2 of 9 · 22%'])
})

test('at a width where the bar drops its title, the terminal pane\'s work row has no link and reads as it does without the fact', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), ISSUE_ADDRESS)
  const terminal = await paneOn($, 'terminal', 50)
  await reportSpec($, clock)

  expect(await linksIn(terminal)).toEqual([])
  expect((await barRowIn(terminal))?.children).toEqual(['spec · ██░░░░░░░░ 2 of 9 · 22%'])
})

test('a title that does not begin with an issue key has no link on the terminal or the desktop', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), ISSUE_ADDRESS)
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const terminal = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 120 } as never })
  const desktop = await $.ui.mount({ plugin: 'builder', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } as never })
  await reportSpec($, clock, '/repo', 'builder progress')

  expect(await linksIn(terminal)).toEqual([])
  expect((await barRowIn(terminal))?.children).toEqual(['builder progress · spec · ██░░░░░░░░ 2 of 9 · 22%'])
  expect(await linksIn(desktop)).toEqual([])
  expect(await shapeOf(desktop)).toEqual(['Box', 'Svg', 'Button builder-agents', 'Button builder-line'])
})

test('without an Issue link fact, the band and the pane draw no link and the bar as before', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  fakeFiles(on)
  const { band } = await progressBand($, on)
  const desktop = await paneOn($, 'desktop', 100)
  await reportSpec($, clock)

  expect(await linksIn(band)).toEqual([])
  expect((await barRowIn(band))?.children).toEqual([SPEC_ROW])
  expect(await linksIn(desktop)).toEqual([])
  expect(String((await desktop.find({ type: 'Svg' }))?.props.source)).toContain(TITLE)
})

for (const place of [
  { name: 'the working folder\'s CLAUDE.md', cwd: '/repo', path: '/repo/CLAUDE.md' },
  { name: 'the working folder\'s CLAUDE.local.md', cwd: '/repo', path: '/repo/CLAUDE.local.md' },
  { name: 'the main checkout\'s CLAUDE.local.md', cwd: '/wt', path: '/repo/CLAUDE.local.md' },
]) {
  test(`an Issue link fact in ${place.name} reaches the band`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engine(on)
    fakeGitHub(on)
    fakePanes(on)
    const files = fakeFiles(on)
    // A worktree of /repo, whose CLAUDE.md names no address.
    files.set('/wt/CLAUDE.md', 'Architecture document: docs/arch.md\n')
    files.set('/wt/.git', 'gitdir: /repo/.git/worktrees/wt\n')
    files.set('/repo/.git/worktrees/wt/commondir', '../..\n')
    issueLinkFact(files, ISSUE_ADDRESS, place.path)
    const { band } = await progressBand($, on)
    await reportSpec($, clock, place.cwd)

    expect(await linksIn(band)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])
  })
}

for (const unusable of [
  { value: '', reason: 'it does not begin with https://' },
  { value: 'http://tracker.example.com/issue/{key}', reason: 'it does not begin with https://' },
  { value: 'https://tracker.example.com/issue/', reason: 'it has no {key}' },
  { value: 'https://tracker.example.com/issue/{key} now', reason: 'it holds spaces or control characters' },
]) {
  test(`an Issue link fact of ${JSON.stringify(unusable.value)} shows one toast saying ${unusable.reason}, and the keys stay plain`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engine(on)
    fakeGitHub(on)
    fakePanes(on)
    issueLinkFact(fakeFiles(on), unusable.value)
    const toasts = toastsOf(on)
    const { band } = await progressBand($, on)
    await reportSpec($, clock)

    expect(toasts).toEqual([`builder: the Issue link fact was ignored because ${unusable.reason}`])
    expect(await linksIn(band)).toEqual([])
    expect((await barRowIn(band))?.children).toEqual([SPEC_ROW])
  })
}

test('a missing or a usable Issue link fact shows no toast', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  const files = fakeFiles(on)
  const toasts = toastsOf(on)
  await reportSpec($, clock)
  issueLinkFact(files, ISSUE_ADDRESS)
  await reloads($, clock)

  expect(toasts).toEqual([])
})

test('a toast the engine refuses does not stop the session from starting or the band from drawing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  issueLinkFact(fakeFiles(on), 'https://tracker.example.com/issue/')
  on('ui.toast', () => {
    throw new Error('the engine fell over')
  })
  const { bar } = await progressBand($, on)
  await reportSpec($, clock)

  expect(await bar()).toBe(SPEC_ROW)
})

test('a session start reads CLAUDE.md once and still finds both its merge command and its Issue link fact', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  bashAnswers(on)
  const files = fakeFiles(on)
  files.set('/repo/CLAUDE.md', 'Merge command: node scripts/merge-gate.mjs <pr>\n')
  issueLinkFact(files, ISSUE_ADDRESS)
  const state = writtenState(on)
  const { band } = await progressBand($, on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()

  expect(files.reads.filter(path => path === '/repo/CLAUDE.md')).toHaveLength(1)

  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec', { title: TITLE })
  expect(await linksIn(band)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])

  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  const at = clock.now()
  await loose($)({ tool: 'Bash', command: 'git push origin HEAD' })
  await clock.advance(20_000)
  await loose($)({ tool: 'Bash', command: 'cd /repo && node scripts/merge-gate.mjs 7' })
  await clock.advance(60_000)
  expect(state.wakesFrom('after-command')).toEqual([at + 10_000, at + 30_000, at + 60_000])
})

test('the fact is read again at the session start that follows a hot reload, so the links come back', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  const files = fakeFiles(on)
  issueLinkFact(files, ISSUE_ADDRESS)
  const { band } = await progressBand($, on)
  await reportSpec($, clock)
  expect(await linksIn(band)).toHaveLength(1)

  files.set('/repo/CLAUDE.md', 'Architecture document: docs/arch.md\n')
  await reloads($, clock)
  expect(await linksIn(band)).toEqual([])

  issueLinkFact(files, ISSUE_ADDRESS)
  await reloads($, clock)
  expect(await linksIn(band)).toEqual([{ href: ISSUE_LINK, children: ['ABC-123'] }])
})

test('the agent-count button counts the running agents and opens the pane, also when the engine cannot list the panes, or closes it when it is open; the line only opens it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  sessionTurns(on)
  const listed = engineAgents(on)
  const { band, agents } = await progressBand($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec')
  listed.push({ id: 'agent-1', type: 'Explore', description: 'Look', status: 'running' })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.settle()
  expect(await agents()).toBe('1 agent running')
  listed.push({ id: 'agent-2', type: 'Plan', description: 'Plan', status: 'completed' })
  await $.turn.start({ text: 'go', turnId: 't2' } as never)
  await clock.settle()
  expect(await agents()).toBe('1 agent running · 1 finished')

  // The person closes the pane open_pane opened.
  panes.listed = []
  panes.opened = []
  await band.press({ key: 'builder-agents' })
  expect(panes.opened).toEqual([{ id: 'builder', title: 'builder' }])
  await band.press({ key: 'builder-agents' })
  expect(panes.closed).toEqual(['builder'])
  expect(panes.listed).toEqual([])

  await band.press({ key: 'builder-line' })
  await band.press({ key: 'builder-line' })
  expect(panes.opened).toHaveLength(3)
  expect(panes.closed).toEqual(['builder'])

  // A list of panes the engine refuses counts as the pane being closed, so
  // the agent-count button opens it rather than doing nothing.
  panes.isRefusing = true
  await band.press({ key: 'builder-agents' })
  expect(panes.opened).toHaveLength(4)
  expect(panes.closed).toEqual(['builder'])
})

test('the pane opens on its own at the first report of each title, once, and not when it is already open', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  await startOnly($)

  await report($, 'grounding')
  await report($, 'issue')
  expect(panes.opened).toEqual([{ id: 'builder', title: 'builder' }])

  // Closed by the person, the pane stays closed for the same title.
  panes.listed = []
  await report($, 'spec')
  expect(panes.opened).toHaveLength(1)

  await clock.advance(1000)
  await report($, 'grounding', { title: 'ABC-300 the next issue' })
  expect(panes.opened).toHaveLength(2)

  // Already open, it is not opened again for a new title.
  await clock.advance(1000)
  await report($, 'grounding', { title: 'ABC-301 another' })
  expect(panes.opened).toHaveLength(2)
})

test('the automatic opening says nothing when the engine refuses it, and the report still answers', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  on('ui.open', () => { throw new Error('no panes here') })
  await startOnly($)

  const ran = await report($, 'spec')
  expect(String(ran.result)).toBe('builder: spec (2 of 9)')
})

test('a subagent cannot report progress, and nothing is recorded', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  const state = writtenState(on)
  await startOnly($)

  const ran = await report($, 'spec', { agentId: 'agent-1' })

  expect(String(ran.deny)).toContain('only the session')
  expect(String(ran.deny)).toContain('reports progress')
  expect(state.of('progress', null)).toBeNull()
  expect(panes.opened).toEqual([])
})

test('the progress tool takes the stage as one of the nine', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const schemas: Record<string, unknown> = {}
  engine(on, schemas)
  await startOnly($)
  const schema = schemas.progress as { properties: { stage: { enum: string[] } }; required: string[] }
  expect(schema.properties.stage.enum).toEqual(['grounding', 'issue', 'spec', 'plan', 'build', 'verify', 'pr', 'review', 'merge'])
  expect(schema.required).toEqual(['title', 'stage'])
})

test('a merged pull request reads nine of nine and merged on both rows, and a new title afterwards shows its own count', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakePanes(on)
  const { bar, line } = await progressBand($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'review')
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  expect(await bar()).toContain('7 of 9 · 78%')

  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * 60_000)
  expect(await bar()).toBe(`${TITLE} · merged · ██████████ 9 of 9 · 100%`)
  expect(await line()).toBe('builder: #7 merged · checks passed · not polling')

  await clock.advance(1000)
  await report($, 'grounding', { title: 'ABC-300 the next issue' })
  expect(await bar()).toBe('ABC-300 the next issue · grounding · ░░░░░░░░░░ 0 of 9 · 0%')
  expect(await line()).toBe('builder: #7 merged · checks passed · not polling')
})

test('a pull request closed without merging keeps the count and reads closed, and both rows stay', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakePanes(on)
  const { bar, line } = await progressBand($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'review')
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })

  world.pr = openPullRequest({ state: 'CLOSED' })
  await clock.advance(10 * 60_000)
  expect(await bar()).toBe(`${TITLE} · closed · ████████░░ 7 of 9 · 78%`)
  expect(await line()).toBe('builder: #7 closed · checks passed · not polling')
})

// The engine beneath the mod's agent and turn hooks: each spawn is answered
// with the next id on Opus 5.5, and listed as running in the engine's list,
// which the test changes as agents finish.
function spawning(on: On) {
  const model = 'claude-opus-5-5'
  sessionTurns(on)
  const listed = engineAgents(on)
  on('agent.spawn', ($, e) => {
    const id = `agent-${listed.length + 1}`
    listed.push({ id, type: e.subagentType, description: e.description, status: 'running' })
    return { model, agentId: id }
  })
  return listed
}
const spawn = ($: Engine, type: string, description = `${type} work`) =>
  $.agent.spawn({ subagentType: type, prompt: `Please ${description}.`, description } as never)
// An agent's turn ending as the engine reports it, with the engine's list
// saying so too.
async function finish($: Engine, listed: { id: string; status: string }[], id: string, answer = 'Done.') {
  listed.find(agent => agent.id === id)!.status = 'completed'
  await $.turn.complete({ answer, durationMs: 4000, isAborted: false, turnId: `t-${id}`, reason: 'answer', agentId: id } as never)
}
const paneOn = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 120) =>
  $.ui.mount({ plugin: 'builder', surface, component: 'Pane', requestId: 'builder', props: { bodyColumns } as never })
// The planned rows the terminal pane draws, by the type each names.
async function plannedIn(pane: Awaited<ReturnType<typeof paneOn>>) {
  await pane.redraw()
  return (await pane.findAll({ type: 'Text', text: /^planned / })).map(row => row.text.slice('planned '.length))
}

test('on the desktop the pane\'s work header and agent rows are drawings and no description is in a text row; the terminal draws none', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  spawning(on)
  const desktop = await paneOn($, 'desktop', 100)
  const terminal = await paneOn($, 'terminal', 100)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'pr')
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await spawn($, 'builder:security-reviewer', 'DESCRIPTION-MARKER <review>')
  await clock.settle()
  await desktop.redraw()
  await terminal.redraw()

  const drawings = (await desktop.findAll({ type: 'Svg' })).map(svg => String(svg.props.source))
  expect(drawings).toHaveLength(2)
  expect(drawings[0]).toContain('6 of 9')
  expect(drawings[1]).toContain('security-reviewer')
  expect(drawings[1]).toContain('DESCRIPTION-MARKER &lt;review&gt;')
  expect(drawings[1]).toContain('Opus 5.5')
  expect(await desktop.findAll({ type: 'Text', text: 'DESCRIPTION-MARKER' })).toHaveLength(0)
  // The pull request's lines are text on every surface.
  expect(await desktop.find({ type: 'Text', text: 'o/r#7 · open' })).toBeDefined()

  expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await terminal.find({ type: 'Text', text: `${TITLE} · pull request open · ` })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: 'running security-reviewer · DESCRIPTION-MARKER <review> · Opus 5.5 · 0s' })).toBeDefined()
})

test('finished agents are folded under one button that unfolds and folds them, and running ones stay above it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const listed = spawning(on)
  const pane = await paneOn($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await spawn($, 'Plan', 'plan the change')
  await finish($, listed, 'agent-1', 'Mapped.')
  await clock.settle()
  await pane.redraw()

  expect((await pane.find({ key: 'builder-fold' }))?.text).toBe('Finished · 1')
  expect(await pane.find({ type: 'Text', text: 'running Plan · plan the change' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'map the hooks' })).toBeUndefined()

  await pane.press({ key: 'builder-fold' })
  expect(await pane.find({ type: 'Text', text: 'completed Explore · map the hooks · Opus 5.5 · 4s · Mapped.' })).toBeDefined()
  await pane.press({ key: 'builder-fold' })
  expect(await pane.find({ type: 'Text', text: 'map the hooks' })).toBeUndefined()
})

test('a package call plans the four focused reviewers, each leaves as it starts, and the verdict pair follows once the four finish, until the head moves', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  fakeFiles(on)
  recordPrompts(on)
  const listed = spawning(on)
  const pane = await paneOn($)
  await watch($)
  expect(await plannedIn(pane)).toEqual([])

  await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })
  const focused = ['security-reviewer', 'maintainability-reviewer', 'performance-reviewer', 'data-reviewer']
  expect(await plannedIn(pane)).toEqual(focused)

  await spawn($, 'builder:security-reviewer')
  expect(await plannedIn(pane)).toEqual(focused.slice(1))
  for (const type of focused.slice(1)) await spawn($, `builder:${type}`)
  expect(await plannedIn(pane)).toEqual([])
  for (const agent of [...listed]) await finish($, listed, agent.id)
  expect(await plannedIn(pane)).toEqual(['spec-reviewer', 'adversarial-reviewer'])

  world.pr = openPullRequest({ headRefOid: D, commits: [{ oid: C }, { oid: D }] })
  await clock.advance(10 * 60_000)
  expect(await plannedIn(pane)).toEqual([])
})

test('a counsel question plans its seven members, an ask-again plans only the three asked, a decided tally plans none, and a type planned twice is listed once', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  spawning(on)
  const pane = await paneOn($)
  await watch($)

  await loose($)(brief)
  const members = ['security-reviewer', 'maintainability-reviewer', 'performance-reviewer', 'data-reviewer', 'spec-reviewer', 'adversarial-reviewer', 'owners-advocate']
  expect(await plannedIn(pane)).toEqual(members)
  for (const member of MEMBERS) await spawn($, member)
  expect(await plannedIn(pane)).toEqual([])

  await clock.advance(1000)
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1']) })
  expect(await plannedIn(pane)).toEqual(['performance-reviewer', 'data-reviewer', 'owners-advocate'])

  // The package call plans the four focused reviewers too; each type is listed once,
  // and the owner's advocate is still waited on by the counsel.
  await loose($)({ tool: 'mcp__builder__package', issue: 'Do it.' })
  expect(await plannedIn(pane)).toEqual([...members.slice(0, 4), 'owners-advocate'])

  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '1', '1', '1']) })
  expect(await plannedIn(pane)).toEqual(members.slice(0, 4))
})

test('a split vote tallied into a rerun after the seven members ran plans all seven again for round two', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  spawning(on)
  const pane = await paneOn($)
  await startOnly($)

  await loose($)(brief)
  for (const member of MEMBERS) await spawn($, member)
  expect(await plannedIn(pane)).toEqual([])

  await clock.advance(1000)
  const rerun = String((await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '2', 'none', '2', '1', '2', '1'], 'only on events') })).result)
  expect(rerun).toContain('round 2')
  expect(await plannedIn(pane)).toEqual(['security-reviewer', 'maintainability-reviewer', 'performance-reviewer', 'data-reviewer', 'spec-reviewer', 'adversarial-reviewer', 'owners-advocate'])
})

test('a counsel question tallied as decided leaves no planned members', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakeFiles(on)
  const pane = await paneOn($)
  await startOnly($)

  await loose($)(brief)
  expect(await plannedIn(pane)).toHaveLength(7)
  await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '1', '1', '1', '1']) })
  expect(await plannedIn(pane)).toEqual([])
})

test('values an older build stored draw without throwing: a card without a model, a question without a launch time, an unreadable fold', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const question = { id: 'c1', question: 'Which?', options: ['a', 'b'], background: '', paths: [], lean: '', folder: '/f', round: 1, tallies: [] }
  olderBuildState(on, {
    started: true,
    agents: [{ id: 'agent-1', type: 'builder:spec-reviewer', description: 'old card', status: 'running', startedAt: 40_000 }],
    counsel: [question],
    finishedFolded: 'sideways',
    packaged: { head: 7 },
  })
  const pane = await paneOn($)
  expect(await pane.find({ type: 'Text', text: 'running spec-reviewer · old card · - · 1m 0s' })).toBeDefined()
  expect(await plannedIn(pane)).toEqual([])
})

// Answers the mod's reads of an agent's messages with `answer`, which the test
// sets, and records whose messages were read.
function agentMessages(on: On) {
  const messages = { answer: (() => ({ value: [] })) as () => unknown, readFor: [] as (string | undefined)[] }
  on('session.messages', ($, e) => {
    messages.readFor.push(e.agentId)
    return messages.answer() as never
  })
  return messages
}
const said = (text: string) => ({ role: 'assistant', text, toolUses: [] })
const agentPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'builder', surface, component: 'Pane', requestId: 'builder-agent', props: { bodyColumns: 100 } as never })

test('an agent\'s output button opens the agent pane with its card, what it was asked, and its last forty messages', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  spawning(on)
  const messages = agentMessages(on)
  const older = Array.from({ length: 44 }, (_, i) => said(`message ${i + 1}`))
  messages.answer = () => ({
    value: [
      ...older,
      { role: 'user', text: 'USER-MARKER', toolUses: [] },
      { role: 'assistant', text: 'Reading \u001b[31mthe diff\u001b[0m', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: '/repo/a.ts' } }] },
    ],
  })
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'builder:security-reviewer', 'review the diff')
  await clock.settle()
  await pane.redraw()

  // The pane opens at once, and the read of the messages settles before the
  // pane is drawn again.
  await pane.press({ key: 'output-agent-1' })
  await clock.settle()
  await output.redraw()

  expect(messages.readFor).toEqual(['agent-1'])
  expect(panes.opened.at(-1)?.id).toBe('builder-agent')
  expect(await output.find({ type: 'Text', text: 'running security-reviewer · review the diff · Opus 5.5 · 0s' })).toBeDefined()
  expect(await output.find({ type: 'Text', text: 'Asked: Please review the diff.' })).toBeDefined()
  expect(await output.find({ type: 'Text', text: 'Reading the diff' })).toBeDefined()
  expect(await output.find({ type: 'Text', text: 'Read: /repo/a.ts' })).toBeDefined()
  expect(await output.find({ type: 'Text', text: 'USER-MARKER' })).toBeUndefined()
  // The last forty of forty-six messages: the first six are left out.
  expect(await output.find({ type: 'Text', text: /^message 6$/ })).toBeUndefined()
  expect(await output.find({ type: 'Text', text: /^message 7$/ })).toBeDefined()
})

test('the agent pane says why when the engine refuses the read, throws, or answers something other than a list, and still shows the card', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  spawning(on)
  const messages = agentMessages(on)
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()
  const reason = async () => {
    await pane.press({ key: 'output-agent-1' })
    await clock.settle()
    await output.redraw()
    expect(await output.find({ type: 'Text', text: 'running Explore · map the hooks' })).toBeDefined()
    return (await output.find({ type: 'Text', text: 'The messages could not be read' }))?.text ?? ''
  }

  messages.answer = () => ({ value: { deny: 'no transcript was saved for agent-1' } })
  expect(await reason()).toBe('The messages could not be read: no transcript was saved for agent-1')

  // A hook that throws makes the read reject, which the pane reports with the
  // engine's words for the failure.
  messages.answer = () => { throw new Error('the engine fell over') }
  expect(await reason()).toMatch(/^The messages could not be read: \S/)

  messages.answer = () => ({ value: 'not a list' })
  expect(await reason()).toBe('The messages could not be read: the engine answered something other than a list.')
})

test('on the desktop the agent pane draws the card as a drawing, with the messages as text', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  spawning(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('Found two problems.')] })
  const pane = await paneOn($, 'desktop')
  const output = await agentPane($, 'desktop')
  await startOnly($)
  await spawn($, 'Explore', 'DESCRIPTION-MARKER')
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'output-agent-1' })
  await clock.settle()
  await output.redraw()

  const drawings = await output.findAll({ type: 'Svg' })
  expect(drawings).toHaveLength(1)
  expect(String(drawings[0]!.props.source)).toContain('DESCRIPTION-MARKER')
  // Only what it was asked names the description in a text row; the card does not.
  expect((await output.findAll({ type: 'Text', text: 'DESCRIPTION-MARKER' })).map(row => row.text)).toEqual(['Asked: Please DESCRIPTION-MARKER.'])
  expect(await output.find({ type: 'Text', text: 'Found two problems.' })).toBeDefined()
})

test('the output button opens the agent pane at once, which says it is reading the messages until the read is answered, and then shows them from that one read', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  spawning(on)
  const messages = agentMessages(on)
  // The read answers half a second late, which is before the live ticker's
  // next tick, so nothing else reads the messages meanwhile, and the test
  // lets it through by moving the clock.
  messages.answer = async () => {
    await clock.sleep(500)
    return { value: [said('Found two problems.')] }
  }
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()

  const pressed = pane.press({ key: 'output-agent-1' })
  try {
    await clock.settle()
    expect(panes.opened.at(-1)?.id).toBe('builder-agent')
    await output.redraw()
    expect(await output.find({ type: 'Text', text: 'running Explore · map the hooks' })).toBeDefined()
    expect(await output.find({ type: 'Text', text: 'Reading the messages.' })).toBeDefined()
    expect(messages.readFor).toEqual(['agent-1'])
  } finally {
    await clock.advance(500)
    await pressed
  }
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'Found two problems.' })).toBeDefined()
  expect(await output.find({ type: 'Text', text: 'Reading the messages.' })).toBeUndefined()
  expect(messages.readFor).toEqual(['agent-1'])
})

test('pressing a second agent\'s output button while the agent pane shows the first switches it at once to the second, reading its messages', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  spawning(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('FIRST-AGENT')] })
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await spawn($, 'Plan', 'plan the change')
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'output-agent-1' })
  await clock.settle()
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'FIRST-AGENT' })).toBeDefined()

  // As in the test of the first press, the read answers half a second late.
  messages.answer = async () => {
    await clock.sleep(500)
    return { value: [said('SECOND-AGENT')] }
  }
  const pressed = pane.press({ key: 'output-agent-2' })
  try {
    await clock.settle()
    await output.redraw()
    expect(await output.find({ type: 'Text', text: 'running Plan · plan the change' })).toBeDefined()
    expect(await output.find({ type: 'Text', text: 'Reading the messages.' })).toBeDefined()
    expect(await output.find({ type: 'Text', text: 'FIRST-AGENT' })).toBeUndefined()
  } finally {
    await clock.advance(500)
    await pressed
  }
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'SECOND-AGENT' })).toBeDefined()
  expect(messages.readFor).toEqual(['agent-1', 'agent-2'])
})

test('a draw of the agent pane that starts reading the pressed agent\'s messages before the press is done with its write shares that read with the press', async ($, on) => {
  const writing = answerWaits(on, 'state.set', 'outputAgent')
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  spawning(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('Found two problems.')] })
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()

  // The store has saved the pressed agent, but the press does not yet know,
  // so a draw meanwhile finds that agent and starts the read of its messages.
  writing.arm()
  const pressed = pane.press({ key: 'output-agent-1' })
  try {
    await clock.settle()
    await output.redraw()
    expect(messages.readFor).toEqual(['agent-1'])
  } finally {
    writing.release()
    await pressed
  }
  await clock.settle()
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'Found two problems.' })).toBeDefined()
  expect(messages.readFor).toEqual(['agent-1'])
})

// The engine's list of agents with every read counted. `hold`, when set,
// keeps each read waiting until it resolves.
function countedAgents(on: On) {
  const engineList = { listed: [] as { id: string; type: string; description: string; status: string }[], reads: 0, hold: null as Promise<void> | null }
  on('agent.list', async () => {
    engineList.reads += 1
    if (engineList.hold !== null) await engineList.hold
    return { value: engineList.listed as never }
  })
  on('agent.spawn', ($, e) => {
    const id = `agent-${engineList.listed.length + 1}`
    engineList.listed.push({ id, type: e.subagentType, description: e.description, status: 'running' })
    return { model: 'claude-opus-5-5', agentId: id }
  })
  return engineList
}
function redrawsAsked(on: On) {
  const asked: string[] = []
  on('ui.invalidate', ($, e) => {
    asked.push(e.event)
    return { value: undefined }
  })
  return asked
}

test('while an agent runs the display is redrawn every second and the engine\'s list is read every fifth second, until nothing runs', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const engineList = countedAgents(on)
  const redraws = redrawsAsked(on)
  const pane = await paneOn($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  engineList.reads = 0
  redraws.length = 0

  await clock.advance(1000)
  expect(redraws).toEqual(['ui.render'])
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'running Explore · map the hooks · Opus 5.5 · 1s' })).toBeDefined()
  await clock.advance(1000)
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'running Explore · map the hooks · Opus 5.5 · 2s' })).toBeDefined()

  await clock.advance(8000)
  expect(engineList.reads).toBe(2)
  expect(redraws).toHaveLength(10)

  engineList.listed[0]!.status = 'completed'
  await clock.advance(5000)
  redraws.length = 0
  // Before it stops, the ticker reads the list once more after the read that
  // found the agent ended, and then neither redraws nor reads again.
  engineList.reads = 0
  await clock.advance(5000)
  expect(redraws).toEqual([])
  expect(engineList.reads).toBe(1)
  engineList.reads = 0
  await clock.advance(10_000)
  expect(redraws).toEqual([])
  expect(engineList.reads).toBe(0)
})

test('a read of the engine\'s list that is slow is not started again while it runs', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const engineList = countedAgents(on)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  engineList.reads = 0

  let release = () => {}
  engineList.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(15_000)
  expect(engineList.reads).toBe(1)

  engineList.hold = null
  release()
  await clock.advance(5000)
  expect(engineList.reads).toBe(2)
})

test('a read of the list already under way when the agent ends does not count as the read before the ticker stops, so it reads the list once more after that', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const engineList = countedAgents(on)
  const redraws = redrawsAsked(on)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  engineList.reads = 0

  // The ticker's read at the fifth second is held, so it is still under way
  // when the agent ends.
  let release = () => {}
  engineList.hold = new Promise<void>(resolve => { release = resolve })
  await clock.advance(5000)
  expect(engineList.reads).toBe(1)
  engineList.listed[0]!.status = 'completed'
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' } as never)
  await clock.settle()
  // Nothing runs now, but the held read started while the agent ran, so the
  // ticks that find nothing running while it is held start no read of their own.
  await clock.advance(3000)

  engineList.hold = null
  release()
  await clock.settle()
  // Once the held read has finished, the ticker starts the read that counts,
  // and then neither redraws nor reads again.
  engineList.reads = 0
  redraws.length = 0
  await clock.advance(10_000)
  expect(engineList.reads).toBe(1)
  expect(redraws).toEqual([])
  engineList.reads = 0
  await clock.advance(10_000)
  expect(engineList.reads).toBe(0)
  expect(redraws).toEqual([])
})

test('the agent pane follows its agent\'s messages on each read of the list while it runs, and once more when it ends', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  sessionTurns(on)
  const engineList = countedAgents(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('first look')] })
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'output-agent-1' })

  messages.answer = () => ({ value: [said('first look'), said('second look')] })
  await clock.advance(1000)
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'second look' })).toBeUndefined()
  await clock.advance(4000)
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'second look' })).toBeDefined()

  messages.answer = () => ({ value: [said('first look'), said('second look'), said('LENS-END done')] })
  engineList.listed[0]!.status = 'completed'
  await $.turn.complete({ answer: 'LENS-END done', durationMs: 6000, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' } as never)
  await clock.settle()
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'LENS-END done' })).toBeDefined()
  const reads = messages.readFor.length
  await clock.advance(10_000)
  expect(messages.readFor.length).toBe(reads)
})

test('a read of the list started while the agent ran, and answered after the read made when it ended, leaves the agent pane on the messages it ended with', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  fakePanes(on)
  sessionTurns(on)
  const engineList = countedAgents(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('first look')] })
  const pane = await paneOn($)
  const output = await agentPane($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'output-agent-1' })

  // The live ticker's read of the list reads the messages, and the engine
  // keeps that read waiting.
  let release = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  messages.answer = async () => {
    await held
    return { value: [said('first look'), said('second look')] }
  }
  const reads = messages.readFor.length
  await clock.advance(5000)
  expect(messages.readFor.length).toBe(reads + 1)

  // The agent ends, and the read made then answers at once with its last
  // messages.
  messages.answer = () => ({ value: [said('first look'), said('second look'), said('the last word')] })
  engineList.listed[0]!.status = 'completed'
  await $.turn.complete({ answer: 'LENS-END done', durationMs: 6000, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'agent-1' } as never)
  await clock.settle()
  expect(messages.readFor.length).toBe(reads + 2)

  // The older read answers last, and the pane still shows how the agent ended.
  release()
  await clock.settle()
  await output.redraw()
  expect(await output.find({ type: 'Text', text: 'the last word' })).toBeDefined()
})

test('once the person closes the agent pane, reads of the list no longer read its agent\'s messages, and a pane the engine cannot list counts as closed', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  countedAgents(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('first look')] })
  const pane = await paneOn($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'output-agent-1' })
  await clock.advance(5000)
  expect(messages.readFor.length).toBeGreaterThan(1)

  panes.listed = panes.listed.filter(id => id !== 'builder-agent')
  await clock.advance(5000)
  const reads = messages.readFor.length
  await clock.advance(20_000)
  expect(messages.readFor.length).toBe(reads)

  // A list of panes the engine refuses counts as the agent pane being closed.
  await pane.press({ key: 'output-agent-1' })
  panes.isRefusing = true
  await clock.advance(5000)
  const refused = messages.readFor.length
  await clock.advance(20_000)
  expect(messages.readFor.length).toBe(refused)
})

test('while the agent pane waits on a slow read of its agent\'s messages, a second draw shares that read rather than start another', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const panes = fakePanes(on)
  countedAgents(on)
  const messages = agentMessages(on)
  messages.answer = () => ({ value: [said('first look')] })
  const pane = await paneOn($)
  await startOnly($)
  await spawn($, 'Explore', 'map the hooks')
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'output-agent-1' })
  await clock.advance(5000)

  // The person closes the agent pane, so the next read of the list empties
  // the cache, and the pane's next draw has to read the messages itself.
  panes.listed = panes.listed.filter(id => id !== 'builder-agent')
  await clock.advance(5000)

  // The engine now keeps every read of the messages waiting. Meanwhile the
  // agent pane is drawn twice, as two of the live ticker's redraws a second
  // apart draw it. The test draws it once on the terminal and once on the
  // desktop, because one surface holds only one instance of the pane.
  let release = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  messages.answer = async () => {
    await held
    return { value: [said('slow look')] }
  }
  const reads = messages.readFor.length
  let drawn: Awaited<ReturnType<typeof agentPane>>[]
  try {
    drawn = await Promise.all([agentPane($, 'terminal'), agentPane($, 'desktop')])
    await clock.settle()
    expect(messages.readFor.length).toBe(reads + 1)
    // Neither draw waits on the read: both say the messages are being read.
    for (const output of drawn) expect(await output.find({ type: 'Text', text: 'Reading the messages.' })).toBeDefined()
  } finally {
    release()
  }

  // Once the read answers, every draw shows what it read, and none reads again.
  await clock.settle()
  for (const output of drawn) {
    await output.redraw()
    expect(await output.find({ type: 'Text', text: 'slow look' })).toBeDefined()
  }
  expect(messages.readFor.length).toBe(reads + 1)
})

// The stuck prompt and the usage-limit hold. These tests start the clock at a
// known moment, because a hold's resume time is compared with the reset times
// the usage report gives as dates.
const T0 = Date.parse('2026-10-12T00:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const stuckOf = (prompts: string[]) => prompts.filter(text => text.includes('nothing has happened on pull request #7'))
const resumesOf = (prompts: string[]) => prompts.filter(text => text.includes('the usage limit has reset'))

// A turn of the session's own that starts and ends at once, with the reason
// given: `answer` for a turn that ended as usual, `refusal` for one the model
// declined, `aborted` for one the person interrupted, and `error` for one an
// API error ended.
async function ownTurn($: Engine, turnId: string, reason: 'answer' | 'refusal' | 'aborted' | 'error' = 'answer') {
  await $.turn.start({ text: 'go', turnId } as never)
  await $.turn.complete({ answer: reason === 'error' ? '' : 'waiting', durationMs: 1, isAborted: reason === 'aborted', turnId, reason } as never)
}

// Answers `$.session.usage()` with the windows in `rateLimits`, or throws
// when `fails` is set, as when the engine cannot read the usage.
function usageAnswers(on: On) {
  const usage = { rateLimits: [] as object[], fails: false }
  on('session.usage', () => {
    if (usage.fails) throw new Error('the usage could not be read')
    return { value: { startedAt: 0, context: {}, rateLimits: usage.rateLimits } } as never
  })
  return usage
}
const fiveHourAt = (resetsAt: string, percentUsed = 100) => ({ kind: 'five_hour', percentUsed, resetsAt })

// The StopFailure hook as the engine raises it for the session's own turn.
// The test's hook is the bottom of the chain.
const stopFailures = (on: On) => on('classic.StopFailure', () => ({}))
const rateLimited = ($: Engine) => $.classic.StopFailure({ error: 'rate_limit' } as never)

test('after a watch and 45 quiet minutes one stuck prompt comes, and after each of its turns the next comes 90, 180, 360 and again 360 minutes later', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.settle()

  const minutes = [45, 90, 180, 360, 360]
  for (const [i, interval] of minutes.entries()) {
    await clock.advance(interval * MINUTE - 1000)
    expect(stuckOf(prompts).length).toBe(i)
    await clock.advance(1000)
    expect(stuckOf(prompts).length).toBe(i + 1)
    expect(stuckOf(prompts)[i]).toContain(`for ${interval} minutes.`)
    await ownTurn($, `t${i}`)
    await clock.settle()
  }
  expect(stuckOf(prompts)[0]).toContain('Check with gh whether what you are waiting on is real.')
  expect(prompts.length).toBe(5)
})

test('no stuck prompt comes while a question to the person is open', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const tools = heldTools(on)
  const prompts = recordPrompts(on)
  await watch($)
  const asked = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Which name?' }] })
  await clock.advance(3 * HOUR)

  expect(stuckOf(prompts)).toEqual([])
  tools.get('q1')!.finish({ result: { answers: {} } })
  await asked
})

test('no stuck prompt comes while a subagent runs, and once it ends one comes 45 minutes later', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const listed = spawning(on)
  const prompts = recordPrompts(on)
  await watch($)
  await spawn($, 'builder:claim-checker')
  // In steps, because the live ticker redraws every second while it runs.
  // The agent ends ten minutes past a whole interval, so its end is not
  // hidden by a postponement that falls at the same moment.
  for (let hour = 0; hour < 3; hour += 1) await clock.advance(HOUR)
  await clock.advance(10 * MINUTE)
  expect(stuckOf(prompts)).toEqual([])

  await finish($, listed, 'agent-1')
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('an agent the engine dropped from its list no longer holds the stuck prompt back, which comes 45 minutes after the read that showed it gone', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const listed = spawning(on)
  const prompts = recordPrompts(on)
  await watch($)
  await spawn($, 'builder:claim-checker')
  await clock.advance(30 * MINUTE)
  // The engine drops the agent with no turn.complete for it, and the live
  // ticker's read of the list, within five seconds, shows it gone.
  listed.splice(0, 1)
  await clock.advance(45 * MINUTE - 10_000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(20_000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('no stuck prompt comes while the session\'s own turn runs, and once it ends one comes 45 minutes later', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await watch($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  // The turn ends ten minutes past a whole interval, so its end is not
  // hidden by a postponement that falls at the same moment.
  await clock.advance(3 * HOUR + 10 * MINUTE)
  expect(stuckOf(prompts)).toEqual([])

  await turnEnds($, 't1')
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('no stuck prompt comes with no pull request watched, even with a stage reported and a turn ended', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await startOnly($)
  await report($, 'build')
  await ownTurn($, 't1')
  await clock.advance(3 * HOUR)

  expect(prompts).toEqual([])
})

test('a stuck label on the pull request does not stop the stuck prompt', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.pr = openPullRequest({ labels: [{ name: 'stuck' }] })
  const prompts = recordPrompts(on)
  await watch($)
  await clock.advance(45 * MINUTE)

  expect(stuckOf(prompts).length).toBe(1)
})

// Watches #7, lets the first stuck prompt come at 45 minutes and its turn
// end, so the interval stands at 90 minutes.
async function firstStuckPrompt($: Engine, clock: ReturnType<typeof mock.clock>, prompts: string[]) {
  await watch($)
  await clock.advance(45 * MINUTE)
  expect(stuckOf(prompts).length).toBe(1)
  await ownTurn($, 't-stuck')
  await clock.settle()
}

// Expects the next stuck prompt 45 minutes from now, not before, and naming
// 45 minutes.
async function nextStuckIn45($: Engine, clock: ReturnType<typeof mock.clock>, prompts: string[]) {
  const before = stuckOf(prompts).length
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts).length).toBe(before)
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(before + 1)
  expect(stuckOf(prompts).at(-1)).toContain('for 45 minutes.')
}

test('a look that finds the pull request changed brings the stuck interval back to 45 minutes', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await firstStuckPrompt($, clock, prompts)

  world.pr = failing()
  await clock.advance(10 * MINUTE)
  expect(prompts.some(text => text.includes('The checks went from passed to failed.'))).toBe(true)
  await ownTurn($, 't-change')
  await clock.settle()

  await nextStuckIn45($, clock, prompts)
})

test('a prompt the person types brings the stuck interval back to 45 minutes', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await firstStuckPrompt($, clock, prompts)

  await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' } } as never)
  await ownTurn($, 't-person')
  await clock.settle()

  await nextStuckIn45($, clock, prompts)
})

test('a prompt from the SDK that is not the CI event brings the stuck interval back to 45 minutes, and a task notification does not', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await firstStuckPrompt($, clock, prompts)

  // A task notification and its turn leave the interval at 90 minutes.
  await $.prompt.submit({ text: 'a background task finished', origin: { kind: 'task-notification' } } as never)
  await ownTurn($, 't-task')
  await clock.advance(90 * MINUTE - 1000)
  expect(stuckOf(prompts).length).toBe(1)
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(2)
  expect(stuckOf(prompts)[1]).toContain('for 90 minutes.')

  await $.prompt.submit({ text: 'carry on', origin: { kind: 'sdk' } } as never)
  await ownTurn($, 't-sdk')
  await clock.settle()
  await nextStuckIn45($, clock, prompts)
})

test('a question left open across twelve hours of polls keeps its needs-decision label and draws no stuck prompt', async ($, on) => {
  // The 30-second redraw is refused, as in the test of fifteen quiet days: it
  // plays no part here.
  on('clock.every', { ms: 30_000 }, () => ({ deny: 'no redraws in this test' }))
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const tools = heldTools(on)
  const prompts = recordPrompts(on)
  await watch($)
  world.calls = []
  const asked = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Which name?' }] })
  await clock.advance(12 * HOUR)

  expect(world.calls).toContain('gh pr edit 7 --repo o/r --add-label needs-decision')
  expect(world.calls.filter(call => call.includes('--remove-label'))).toEqual([])
  expect(world.calls.filter(call => call.startsWith('gh pr view 7 --repo o/r --json') && !call.includes('--json labels ')).length).toBeGreaterThan(60)
  expect(stuckOf(prompts)).toEqual([])
  tools.get('q1')!.finish({ result: { answers: {} } })
  await asked
})

test('after a restart with a question left open, the stuck prompt counts from the new watch, and the resumed session\'s answered question takes needs-decision off', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const restart = restartable(on, ['quietSince', 'stuckEvery', 'usageHold', 'questions', 'busy'])
  const world = fakeGitHub(on)
  const tools = heldTools(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await watch($)
  // The killed session's question, which is never answered. The call is
  // still held when the test ends, and the kit settles it then as a call that
  // nothing beneath the mod answers, so its refusal is caught here rather than
  // reported as a rejection nothing handled.
  void loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Which name?' }] }).catch(() => undefined)
  await clock.settle()
  expect(world.calls).toContain('gh pr edit 7 --repo o/r --add-label needs-decision')
  world.pr = openPullRequest({ labels: [{ name: 'needs-decision' }] })
  // The killed session's turn is not started here: the test keeps this
  // module loaded, so the turn would stay running across the stand-in
  // restart, which a real restart does not do. The restart still puts the
  // busy flag back to its default.
  await clock.advance(30 * MINUTE)

  // The restart: the mod's values are back at their defaults, and the
  // resumed session watches the pull request again.
  restart()
  world.calls = []
  await watch($)
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
  expect(world.calls.filter(call => call.includes('--remove-label needs-decision'))).toEqual([])

  // The resumed session asks again, and the person answers.
  const asked = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q2', questions: [{ question: 'Which name?' }] })
  await clock.settle()
  tools.get('q2')!.finish({ result: { answers: {} } })
  await asked
  await clock.settle()
  expect(world.calls.filter(call => call.includes('needs-decision'))).toEqual(['gh pr edit 7 --repo o/r --remove-label needs-decision'])
})

// The atoms a hot reload finds, as the mod left them before it: #7 watched
// and open, with `more` beside them. The engine keeps the atoms across a
// reload and the module starts afresh, which is what each test's first call
// on `$` does, so a test that seeds these and then starts the session runs
// the path a reload takes. Reads under `refused` are refused as
// olderBuildState says.
function reloadedOver(on: On, more: Record<string, unknown>, refused?: string) {
  return olderBuildState(on, {
    run: { repo: 'o/r', number: 7, cwd: '/repo', login: 'owner', since: T0 },
    pr: snapshotOf('o/r', openPullRequest(), 'owner'),
    ...more,
  }, refused)
}

test('the hooks loaded afresh over a quiet stretch arm the stuck prompt from the saved quiet time and interval', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + HOUR })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  reloadedOver(on, { quietSince: T0, stuckEvery: 90 * MINUTE })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.advance(30 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
  expect(stuckOf(prompts)[0]).toContain('for 90 minutes.')
})

test('the hooks loaded afresh during a hold resume once, at the saved resume time', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + HOUR })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  reloadedOver(on, { quietSince: T0, usageHold: { until: T0 + 2 * HOUR + MINUTE } })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.advance(HOUR + MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

// A refused read of the usage-limit hold during arming (see
// docs/specs/pilot-wake-ups.md). The saved state's own hook refuses the read of
// the hold, because a test may register only one state.get hook. The session
// start's look reads the hold too, so a refusal used up by the session start
// does not by itself show whose read it was. It is the arming's, because the
// session start runs the arming up to its read of the hold before it starts the
// look.
test('the hooks loaded afresh during a hold with the read of the hold refused try the arming again, and resume once at the saved resume time', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + HOUR })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  const refusal = reloadedOver(on, { quietSince: T0, usageHold: { until: T0 + 2 * HOUR + MINUTE } }, 'usageHold')
  refusal.reads = 1
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  expect(refusal.reads).toBe(0)
  await clock.advance(HOUR + MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

test('the hooks loaded afresh over a quiet stretch with the read of the hold refused arm the stuck prompt when the arming is tried again', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + HOUR })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  // The session has been quiet for longer than the first interval, so a
  // stuck timer armed at the session start would fire at once. It fires only
  // when the arming is tried again, 15 minutes later.
  const refusal = reloadedOver(on, { quietSince: T0 }, 'usageHold')
  refusal.reads = 1
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  expect(refusal.reads).toBe(0)
  await clock.advance(15 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('a retry of the arming whose own read of the hold is refused tries again, and the resume still comes once', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + HOUR })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  // The resume time falls between the first retry and the second, so the
  // resume comes when the second retry arms the hold's timer, and not at the
  // resume time itself.
  const refusal = reloadedOver(on, { quietSince: T0, usageHold: { until: T0 + HOUR + 20 * MINUTE } }, 'usageHold')
  refusal.reads = 1
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  expect(refusal.reads).toBe(0)
  await clock.advance(15 * MINUTE - 1000)
  refusal.reads = 1
  await clock.advance(1000)
  expect(refusal.reads).toBe(0)
  await clock.advance(15 * MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a second session start during a quiet stretch neither moves nor doubles the stuck prompt', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.advance(30 * MINUTE)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.advance(15 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
  await clock.advance(60 * MINUTE)
  expect(stuckOf(prompts).length).toBe(1)
})

test('a stuck prompt the engine refuses is tried again one interval later, without the interval doubling', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const record = refusablePrompts(on)
  await watch($)
  record.refusing = true
  await clock.advance(45 * MINUTE)
  record.refusing = false
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(record.prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(record.prompts).length).toBe(1)
  expect(stuckOf(record.prompts)[0]).toContain('for 45 minutes.')
})

// The refusal of the next `reads` reads of the mod's state under `key`, as a
// state the engine cannot read refuses them. It registers no hook, because a
// test may register only one state.get hook: that hook asks `refuses` first,
// which counts the read down and answers the refusal when it refuses one, and
// answers undefined for any other read.
function readRefusal(key: string | undefined) {
  const refusal = { reads: 0 }
  const refuses = (e: { plugin: string; key: string }) => {
    if (refusal.reads <= 0 || e.plugin !== 'builder' || e.key !== key) return undefined
    refusal.reads -= 1
    return { deny: 'the state could not be read' } as never
  }
  return { refusal, refuses }
}

// Refuses the next `reads` reads of the mod's state under `key`, as a state
// the engine cannot read does.
function refusedReads(on: On, key: string) {
  const { refusal, refuses } = readRefusal(key)
  on('state.get', ($, e, next) => refuses(e) ?? next(e))
  return refusal
}

// Refuses the next `writes` writes of the mod's state under `key` whose value
// passes `matches`, as a state the engine cannot write does, and `refusals`
// counts the writes it has refused.
function refusedWrites(on: On, key: string, matches: (value: unknown) => boolean = () => true) {
  const refusal = { writes: 0, refusals: 0 }
  on('state.set', ($, e, next) => {
    if (refusal.writes > 0 && e.plugin === 'builder' && e.key === key && matches(e.value)) {
      refusal.writes -= 1
      refusal.refusals += 1
      return { deny: 'the state could not be written' } as never
    }
    return next(e)
  })
  return refusal
}

// While `isArmed` is set, each write of the mod's state under `written` whose
// value passes `matches` lets the next `count` reads (`refuses: 'get'`) or
// writes (`refuses: 'set'`) under `refused` be refused, and `refusals` counts
// them. It registers one state.set hook, and a state.get hook only when it
// refuses reads, so a test that uses it registers neither itself.
function refusedAfterWrite(on: On, fault: {
  written: string
  matches?: (value: unknown) => boolean
  refused: string
  refuses: 'get' | 'set'
  count?: number
}) {
  const { written, matches = () => true, refused, refuses, count = 1 } = fault
  const refusal = { isArmed: false, refusals: 0 }
  let left = 0
  const refuse = () => {
    left -= 1
    refusal.refusals += 1
    return { deny: refuses === 'get' ? 'the state could not be read' : 'the state could not be written' } as never
  }
  on('state.set', ($, e, next) => {
    if (refusal.isArmed && e.plugin === 'builder' && e.key === written && matches(e.value)) left = count
    else if (refuses === 'set' && left > 0 && e.plugin === 'builder' && e.key === refused) return refuse()
    return next(e)
  })
  if (refuses === 'get') {
    on('state.get', ($, e, next) => {
      if (left > 0 && e.plugin === 'builder' && e.key === refused) return refuse()
      return next(e)
    })
  }
  return refusal
}

test('a read of the state refused as the stuck prompt falls sends nothing, and the stuck prompt comes one interval later', async ($, on) => {
  const refusal = refusedReads(on, 'agents')
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.advance(45 * MINUTE - 1000)
  refusal.reads = 1
  await clock.advance(1000)
  expect(refusal.reads).toBe(0)
  expect(stuckOf(prompts)).toEqual([])

  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
  expect(stuckOf(prompts)[0]).toContain('for 90 minutes.')
})

test('an accepted stuck prompt whose doubled interval cannot be saved, with no turn after it, is followed by another one interval later', async ($, on) => {
  const refusal = refusedWrites(on, 'stuckEvery')
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  refusal.writes = 1
  await clock.advance(45 * MINUTE)
  expect(refusal.writes).toBe(0)
  expect(stuckOf(prompts).length).toBe(1)

  // The interval was not saved doubled, so the next prompt comes after the
  // first interval again.
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts).length).toBe(1)
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(2)
})

// The stuck timer's fire restarts the quiet time, which arms the stuck prompt
// afresh under a newer number. When that arming's own read is refused, it
// arms nothing and the fire fails, so the fire's retry must arm in its place
// even though the number has moved on.
test('an accepted stuck prompt whose fresh arming cannot read the quiet time is followed by another one interval later', async ($, on) => {
  // While armed, the first read of the quiet time after its write is refused.
  const fault = refusedAfterWrite(on, { written: 'quietSince', refused: 'quietSince', refuses: 'get' })
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const prompts = recordPrompts(on)
  await watch($)
  await clock.advance(45 * MINUTE - 1000)
  fault.isArmed = true
  await clock.advance(1000)
  fault.isArmed = false
  expect(fault.refusals).toBe(1)
  expect(stuckOf(prompts).length).toBe(1)

  // The doubled interval was saved, so the next prompt comes 90 minutes on.
  await clock.advance(90 * MINUTE - 1000)
  expect(stuckOf(prompts).length).toBe(1)
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(2)
  expect(stuckOf(prompts)[1]).toContain('for 90 minutes.')
})

// The end of a turn restarts the quiet time and arms the stuck prompt afresh,
// which stops the timer armed before. When that arming's own read is refused,
// it must still leave a stuck timer, or a quiet pull request would never draw
// a stuck prompt.
test('a turn end whose arming of the stuck prompt cannot read the interval still draws the stuck prompt 45 minutes later', async ($, on) => {
  // While armed, the first read of the interval after the write of the quiet
  // time is refused.
  const fault = refusedAfterWrite(on, { written: 'quietSince', refused: 'stuckEvery', refuses: 'get' })
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const prompts = recordPrompts(on)
  await watch($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.advance(10 * MINUTE)
  fault.isArmed = true
  await turnEnds($, 't1')
  await clock.settle()
  fault.isArmed = false
  expect(fault.refusals).toBe(1)

  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('a stuck prompt that falls while a change is being handed over is dropped, and the next comes one interval later', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  on('command.run', () => ({ text: '' }))
  // The prompt that hands a change over waits at the bottom until the test
  // lets it through, so the handover is under way for as long as it waits.
  const prompts: string[] = []
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  on('prompt.submit', async ($, e) => {
    if (e.text.includes('pull request #7 changed')) await gate
    prompts.push(e.text)
    return { text: e.text }
  })
  await watch($)
  // /builder poll reads the failure first, which restarts the quiet time, so
  // the poll after it finds nothing new to record and only hands the
  // change over, which leaves the quiet time alone.
  await clock.advance(20 * MINUTE)
  world.pr = failing()
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.advance(45 * MINUTE)
  expect(prompts).toEqual([])

  release()
  await clock.settle()
  expect(prompts.filter(text => text.includes('pull request #7 changed')).length).toBe(1)
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
  expect(stuckOf(prompts)[0]).toContain('for 45 minutes.')
})

test('a stuck prompt that falls while the CI event\'s look has not yet told its read is dropped, and the next comes one interval later', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  const held = holdCiPrompt(on)
  await watch($)
  await clock.advance(40 * MINUTE)
  const event = $.prompt.submit({ text: CI_EVENT, origin: { kind: 'sdk' } } as never)
  await clock.advance(5 * MINUTE)
  expect(stuckOf(held.prompts)).toEqual([])

  held.release()
  await event
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(held.prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(held.prompts).length).toBe(1)
  expect(stuckOf(held.prompts)[0]).toContain('for 45 minutes.')
})

// Watches #7 with a five-hour window at 100 percent that resets two hours
// on, and ends a turn as usual and then one with an error, both at T0, so
// the turn-end looks of the first are due during the hold. /builder is
// answered beneath the mod, for a test that runs it. `runs` are the head's
// unfinished workflow runs from the start, and `id`, when given, answers the
// asks for the session's id (see engine).
async function holdOnWindow($: Engine, on: On, runs: { id: number; run_attempt: number; name: string }[] = [], id?: () => Promise<{ value: string }>) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on, undefined, id)
  const world = fakeGitHub(on)
  world.runs = runs
  sessionTurns(on)
  on('command.run', () => ({ text: '' }))
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1')
  await ownTurn($, 't2', 'error')
  await clock.settle()
  return { clock, world, prompts, line, usage }
}

test('a turn that dies with a window at 100 percent holds: the line says until when, no gh runs, and one resume prompt comes a minute after the reset', async ($, on) => {
  const { clock, world, prompts, line } = await holdOnWindow($, on)
  expect(await line()).toBe('builder: #7 open · checks passed · waiting on the usage limit until 02:01:00')
  // A subagent that ends during the hold restarts the quiet time, but no
  // stuck prompt comes while the hold is on.
  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't-agent', reason: 'answer', agentId: 'agent-9' } as never)

  world.calls = []
  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(world.calls.filter(call => call.startsWith('gh '))).toEqual([])
  expect(prompts).toEqual([])

  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  expect(prompts.length).toBe(1)
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
})

// An unfinished workflow run makes the session wait on the checks, which
// polls every 90 seconds, and the hold still stops that poll and its read of
// the runs.
test('an unfinished workflow run polls nothing during a hold, neither the pull request nor the runs', async ($, on) => {
  const { clock, world, prompts } = await holdOnWindow($, on, [{ id: 1, run_attempt: 1, name: 'build' }])
  world.calls = []
  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(world.calls.filter(call => call.startsWith('gh '))).toEqual([])
  expect(prompts).toEqual([])

  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(90_000)
  expect(world.calls.some(call => call.startsWith('gh api --paginate repos/o/r/actions/runs?'))).toBe(true)
})

test('/builder poll still reads the pull request during a hold', async ($, on) => {
  const { world } = await holdOnWindow($, on)
  world.calls = []
  const shown = await $.command.run({ command: 'builder', args: 'poll' } as never)

  expect(JSON.stringify(shown)).toContain('Checks: passed')
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
})

test('a hold whose pull request merged meanwhile, as a /builder poll during the hold read it, clears at the resume time with no resume prompt', async ($, on) => {
  const { clock, world, prompts, line } = await holdOnWindow($, on)
  world.pr = openPullRequest({ state: 'MERGED' })
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.advance(HOUR)
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await clock.advance(HOUR + MINUTE)
  expect(resumesOf(prompts)).toEqual([])
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('a turn that starts during a hold and still runs at the resume time clears the hold with no resume prompt', async ($, on) => {
  const { clock, prompts, line } = await holdOnWindow($, on)
  await clock.advance(HOUR)
  await $.turn.start({ text: 'go on', turnId: 't3' } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await clock.advance(HOUR + MINUTE)
  expect(resumesOf(prompts)).toEqual([])
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('a handover still being submitted at the resume time clears the hold with no resume prompt', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  on('command.run', () => ({ text: '' }))
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  // The prompt that hands a change over waits at the bottom until the test
  // lets it through, so the handover is under way for as long as it waits.
  const prompts: string[] = []
  let isWaiting = false
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  on('prompt.submit', async ($, e) => {
    if (e.text.includes('pull request #7 changed')) {
      isWaiting = true
      await gate
    }
    prompts.push(e.text)
    return { text: e.text }
  })
  const line = await abovePrompt($, on)
  await watch($)
  // /builder poll reads the failure, and the poll after it hands it over.
  world.pr = failing()
  await $.command.run({ command: 'builder', args: 'poll' } as never)
  await clock.advance(15 * MINUTE)
  expect(isWaiting).toBe(true)

  // A turn of the session's own starts and dies on the limit while that
  // handover is still being submitted.
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE)
  expect(await line()).not.toContain('waiting on the usage limit')
  expect(resumesOf(prompts)).toEqual([])
  release()
  await clock.settle()
  expect(prompts.filter(text => text.includes('pull request #7 changed')).length).toBe(1)
  await clock.advance(HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

// Once `arm()` is called, lets the store act on the next read or write of the
// builder value `key` and then holds its answer until the test calls
// `release()`, as a slow store or another plugin's hook may. Unlike
// writeWaits below, which holds an operation before the store acts, this one
// holds it after. `seen` counts every read or write of `key`, held or not,
// so a test can tell which one it held. It is set up before the test first
// calls `$`, as the kit requires of a hook beneath the mod.
function answerWaits(on: On, event: 'state.get' | 'state.set', key: string) {
  let isArmed = false
  const late = { arm: () => { isArmed = true }, release: () => {}, seen: 0 }
  const gate = new Promise<void>(resolve => { late.release = resolve })
  const isHeld = (e: { plugin: string; key: string }) => {
    if (e.plugin !== 'builder' || e.key !== key) return false
    late.seen += 1
    if (!isArmed) return false
    isArmed = false
    return true
  }
  if (event === 'state.get') {
    on('state.get', async ($, e, next) => {
      if (!isHeld(e)) return next(e)
      const answer = await next(e)
      await gate
      return answer
    })
  } else {
    on('state.set', async ($, e, next) => {
      if (!isHeld(e)) return next(e)
      const answer = await next(e)
      await gate
      return answer
    })
  }
  return late
}

// Once `arm()` is called, makes the next write of the builder value `key` that
// `matches` wait until the test lets it through. `isWaiting` says whether a
// write is waiting now. It is set up before the test first calls `$`, as the
// kit requires of a hook beneath the mod.
function writeWaits(on: On, key: string, matches: (value: unknown) => boolean) {
  let isArmed = false
  const write = { isWaiting: false, release: () => {}, arm: () => { isArmed = true } }
  on('state.set', async ($, e, next) => {
    if (isArmed && e.plugin === 'builder' && e.key === key && matches(e.value)) {
      isArmed = false
      write.isWaiting = true
      await new Promise<void>(resolve => { write.release = resolve })
      write.isWaiting = false
    }
    return next(e)
  })
  return write
}

test('a person\'s turn that starts while the resume time is clearing the hold gets only the person\'s prompt', async ($, on) => {
  const clearing = writeWaits(on, 'usageHold', value => value === null)
  const { clock, prompts, line } = await holdOnWindow($, on)
  clearing.arm()
  await clock.advance(2 * HOUR + MINUTE)
  expect(clearing.isWaiting).toBe(true)

  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'go on', turnId: 't3' } as never)
  clearing.release()
  await clock.settle()
  expect(prompts).toEqual(['go on'])
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a write that fails as the resume time clears the hold sends no prompt, and the resume comes 15 minutes later once the write succeeds', async ($, on) => {
  const refusal = refusedWrites(on, 'usageHold', value => value === null)
  const { clock, prompts, line } = await holdOnWindow($, on)
  refusal.writes = 1
  await clock.advance(2 * HOUR + MINUTE)
  expect(refusal.writes).toBe(0)
  expect(prompts).toEqual([])

  // The hold is tried again one step later, with nobody there to type.
  await clock.advance(15 * MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  expect(prompts.length).toBe(1)
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('a read of the hold refused at the resume time sends nothing, and the resume comes 15 minutes later', async ($, on) => {
  const refusal = refusedReads(on, 'usageHold')
  const { clock, prompts, line } = await holdOnWindow($, on)
  await clock.advance(2 * HOUR + MINUTE - 1000)
  refusal.reads = 1
  await clock.advance(1000)
  expect(refusal.reads).toBe(0)
  expect(prompts).toEqual([])

  await clock.advance(15 * MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  expect(prompts.length).toBe(1)
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('a read of the hold refused at the end of a turn that ended with an answer leaves the hold on, and its resume comes once at the resume time', async ($, on) => {
  const refusal = refusedReads(on, 'usageHold')
  const { clock, prompts, line } = await holdOnWindow($, on)
  refusal.reads = 1
  await ownTurn($, 't3')
  await clock.settle()
  expect(refusal.reads).toBe(0)
  expect(await line()).toBe('builder: #7 open · checks passed · waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  expect(prompts.length).toBe(1)
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('a write of the quiet time refused just after the resume time clears the hold still sends the resume prompt, and the stuck prompt counts from the clear', async ($, on) => {
  // While armed, the write of the quiet time that follows the write clearing
  // the hold is refused.
  const fault = refusedAfterWrite(on, { written: 'usageHold', matches: value => value === null, refused: 'quietSince', refuses: 'set' })
  const { clock, prompts, line } = await holdOnWindow($, on)
  fault.isArmed = true
  await clock.advance(2 * HOUR + MINUTE)
  fault.isArmed = false
  expect(fault.refusals).toBe(1)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  expect(await line()).not.toContain('waiting on the usage limit')

  // No turn follows the resume prompt here, so the stuck prompt comes 45
  // minutes after the clear.
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('a person\'s prompt that is still on its way when the hold\'s timer fires gets only the person\'s prompt', async ($, on) => {
  // The person's prompt brings the stuck interval back first, and that write
  // waits, so the prompt is still on its way when the resume time comes.
  const resetting = writeWaits(on, 'stuckEvery', () => true)
  const { clock, prompts, line } = await holdOnWindow($, on)
  resetting.arm()
  await clock.advance(2 * HOUR + MINUTE - 1000)
  const typed = $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await clock.settle()
  expect(resetting.isWaiting).toBe(true)

  await clock.advance(1000)
  resetting.release()
  await typed
  await clock.settle()
  expect(prompts).toEqual(['go on'])
  expect(await line()).not.toContain('waiting on the usage limit')
})

// The look for the foreman's ticket awaits the session's id, so the person's
// prompt is held there, and the hold's timer must already have given way.
test('a person\'s prompt that is held at the session\'s id when the hold\'s timer fires gets only the person\'s prompt', async ($, on) => {
  let isArmed = false
  const asked = { isWaiting: false, release: () => {} }
  const id = async () => {
    if (isArmed) {
      isArmed = false
      asked.isWaiting = true
      await new Promise<void>(resolve => { asked.release = resolve })
      asked.isWaiting = false
    }
    return { value: 'session-1' }
  }
  const { clock, prompts, line } = await holdOnWindow($, on, [], id)
  await clock.advance(2 * HOUR + MINUTE - 1000)
  isArmed = true
  const typed = $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await clock.settle()
  expect(asked.isWaiting).toBe(true)

  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual([])
  asked.release()
  await typed
  await clock.settle()
  expect(prompts).toEqual(['go on'])
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('a person\'s prompt that fails to bring the stuck interval back leaves the hold on, and its resume time still comes', async ($, on) => {
  const refusal = refusedWrites(on, 'stuckEvery')
  const { clock, prompts, line } = await holdOnWindow($, on)
  refusal.writes = 1
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await clock.settle()
  expect(refusal.writes).toBe(0)
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a pull request merged by a command just before the turn dies on the limit is read once at the resume time, which sends no prompt and clears the hold', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  bashAnswers(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const state = writtenState(on)
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'merge it', turnId: 't1' } as never)
  world.pr = openPullRequest({ state: 'MERGED' })
  await loose($)({ tool: 'Bash', command: 'gh pr merge 7 --merge --match-head-commit cccccccc', description: 'Merge the pull request' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  world.calls = []
  await clock.advance(2 * HOUR + MINUTE)
  expect(world.calls.filter(call => call.startsWith('gh pr view 7') && !call.includes('--json labels ')).length).toBe(1)
  expect(state.wakesFrom('resume')).toEqual([T0 + 2 * HOUR + MINUTE])
  expect(resumesOf(prompts)).toEqual([])
  expect(prompts).toEqual([])
  expect(await line()).toContain('#7 merged')
  expect(await line()).not.toContain('waiting on the usage limit')
})

test('the person\'s prompt during a hold clears it, with no resume prompt, and polling starts again', async ($, on) => {
  const { clock, world, prompts, line } = await holdOnWindow($, on)
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')

  world.calls = []
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
})

// The person's prompt alone, with no turn after it, so that the stuck prompt
// can only count from the clear.
test('a hold that runs past 45 minutes and is cleared by the person\'s prompt draws the stuck prompt 45 minutes after the clear, not before', async ($, on) => {
  const { clock, prompts } = await holdOnWindow($, on)
  await clock.advance(HOUR)
  expect(stuckOf(prompts)).toEqual([])

  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await clock.settle()
  await clock.advance(45 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
  expect(stuckOf(prompts)[0]).toContain('for 45 minutes.')
})

test('a turn that starts a hold arms no turn-end looks, keeps the change held during it for the turn after the hold, and does not restart the quiet time', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const state = writtenState(on)
  const line = await abovePrompt($, on)
  await watch($)
  // A poll during the turn finds the failure and holds it.
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  world.pr = failing()
  await clock.advance(10 * MINUTE)
  await clock.advance(30_000)
  expect(prompts).toEqual([])
  const quietBefore = state.of<number | null>('quietSince', null)
  expect(quietBefore).not.toBe(clock.now())

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')
  expect(state.of<number | null>('quietSince', null)).toBe(quietBefore)

  // The person clears the hold at once, before a look 10 seconds on would
  // fall, and the end of the person's turn hands the held change over.
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await ownTurn($, 't2')
  await clock.settle()
  const end = clock.now()
  expect(prompts.filter(text => text.includes('pull request #7 changed')).length).toBe(1)
  await clock.advance(40_000)
  expect(state.wakesFrom('turn-end')).toEqual([end])
})

test('a task notification during a hold leaves it on, and a prompt from the SDK that is not the CI event clears it', async ($, on) => {
  const { clock, prompts, line } = await holdOnWindow($, on)
  await $.prompt.submit({ text: 'a background task finished', origin: { kind: 'task-notification' } } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await $.prompt.submit({ text: 'go on', origin: { kind: 'sdk' } } as never)
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a task notification\'s turn during a hold leaves it on until that turn ends with an answer, which takes it off with no resume prompt', async ($, on) => {
  const { clock, prompts, line } = await holdOnWindow($, on)
  await $.prompt.submit({ text: 'a background task finished', origin: { kind: 'task-notification' } } as never)
  await $.turn.start({ text: 'a background task finished', turnId: 't3' } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await $.turn.complete({ answer: 'noted', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' } as never)
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

for (const reason of ['answer', 'refusal'] as const) {
  test(`a turn of the session's own that ends with ${reason === 'answer' ? 'an answer' : 'a refusal'} during a hold takes the hold off with no resume prompt, and polling starts again`, async ($, on) => {
    const { clock, world, prompts, line } = await holdOnWindow($, on)
    await ownTurn($, 't3', reason)
    await clock.settle()
    expect(await line()).not.toContain('waiting on the usage limit')

    world.calls = []
    await clock.advance(10 * MINUTE)
    expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
    await clock.advance(3 * HOUR)
    expect(resumesOf(prompts)).toEqual([])
  })
}

test('a turn of the session\'s own that is aborted during a hold leaves the hold on, and its resume prompt comes once at the resume time', async ($, on) => {
  const { clock, prompts, line } = await holdOnWindow($, on)
  await ownTurn($, 't3', 'aborted')
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(resumesOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a turn that ends with an answer during a hold, when taking the hold off is refused, leaves the hold on, and its resume prompt comes once at the resume time', async ($, on) => {
  const refusal = refusedWrites(on, 'usageHold', value => value === null)
  const { clock, prompts, line } = await holdOnWindow($, on)
  refusal.writes = 1
  await ownTurn($, 't3')
  await clock.settle()
  expect(refusal.writes).toBe(0)
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(resumesOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a second session start during a hold neither moves nor doubles the resume', async ($, on) => {
  const { clock, prompts } = await holdOnWindow($, on)
  await clock.advance(HOUR)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.advance(HOUR + MINUTE - 1000)
  expect(resumesOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a resume prompt the engine refuses holds again and is tried 15 minutes later', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const record = refusablePrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1', 'error')
  record.refusing = true
  await clock.advance(2 * HOUR + MINUTE)
  record.refusing = false
  expect(await line()).toContain('waiting on the usage limit until 02:16:00')
  await clock.advance(15 * MINUTE - 1000)
  expect(resumesOf(record.prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(record.prompts).length).toBe(1)
})

test('a refused resume prompt whose new hold cannot be saved is tried again 15 minutes later, and the stuck prompt stays armed and comes one interval after the clear', async ($, on) => {
  const refusal = refusedWrites(on, 'usageHold', value => value !== null)
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const record = refusablePrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  refusal.writes = 1
  record.refusing = true
  await clock.advance(2 * HOUR + MINUTE)
  record.refusing = false
  expect(refusal.refusals).toBe(1)
  expect(await line()).not.toContain('waiting on the usage limit')

  await clock.advance(15 * MINUTE - 1000)
  expect(resumesOf(record.prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(record.prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])

  // No turn follows the resume prompt here, so the stuck prompt still comes
  // 45 minutes after the clear.
  await clock.advance(30 * MINUTE - 1000)
  expect(stuckOf(record.prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(record.prompts).length).toBe(1)
  expect(resumesOf(record.prompts).length).toBe(1)
})

// A refused resume prompt holds again. When the new hold is saved but the
// read that arms its timer is refused, the hold must still get a timer,
// because the stuck prompt stays off while a hold is saved.
test('a refused resume prompt whose new hold is saved but whose timer cannot read it still resumes 15 minutes later', async ($, on) => {
  // While armed, the next two reads of the hold after it is saved are
  // refused: the poll's, which gives up quietly, and then the read that arms
  // the hold's timer.
  const fault = refusedAfterWrite(on, { written: 'usageHold', matches: value => value !== null, refused: 'usageHold', refuses: 'get', count: 2 })
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const record = refusablePrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  fault.isArmed = true
  record.refusing = true
  await clock.advance(2 * HOUR + MINUTE)
  record.refusing = false
  fault.isArmed = false
  expect(fault.refusals).toBe(2)
  expect(await line()).toContain('waiting on the usage limit until 02:16:00')

  await clock.advance(15 * MINUTE - 1000)
  expect(resumesOf(record.prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(record.prompts).length).toBe(1)
})

test('a turn that dies after a StopFailure of rate_limit, with no usage readable, resumes 15 minutes later, and a resume turn that dies the same way holds again', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  stopFailures(on)
  const usage = usageAnswers(on)
  usage.fails = true
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await rateLimited($)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 00:15:00')

  await clock.advance(15 * MINUTE - 1000)
  expect(resumesOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)

  // The resume turn dies on the limit too.
  await $.turn.start({ text: 'resume', turnId: 't2' } as never)
  await rateLimited($)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'error' } as never)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 00:30:00')
  await clock.advance(15 * MINUTE - 1000)
  expect(resumesOf(prompts).length).toBe(1)
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(2)
})

test('a StopFailure of rate_limit that comes after the turn ended still holds', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  stopFailures(on)
  const usage = usageAnswers(on)
  usage.fails = true
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')

  await rateLimited($)
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 00:15:00')
  await clock.advance(15 * MINUTE)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a late StopFailure of rate_limit whose hold cannot be saved leaves the stuck prompt armed, and it comes one interval after the turn ended', async ($, on) => {
  const refusal = refusedWrites(on, 'usageHold', value => value !== null)
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  stopFailures(on)
  const usage = usageAnswers(on)
  usage.fails = true
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1', 'error')
  await clock.settle()
  await clock.advance(10 * MINUTE)

  refusal.writes = 1
  await rateLimited($)
  await clock.settle()
  expect(refusal.refusals).toBe(1)
  expect(await line()).not.toContain('waiting on the usage limit')

  await clock.advance(35 * MINUTE - 1000)
  expect(stuckOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(stuckOf(prompts).length).toBe(1)
})

test('a turn that dies on the limit while a late StopFailure is still deciding an earlier turn holds from its own end', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  stopFailures(on)
  // The usage report shows no window used up, and once `slow` is set it
  // waits until the test lets it through.
  let slow = false
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  on('session.usage', async () => {
    if (slow) await gate
    return { value: { startedAt: 0, context: {}, rateLimits: [] } } as never
  })
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  // The first turn dies with neither signal, so it stays pending.
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')

  // Its StopFailure comes late, and the decision it starts waits on the
  // usage report while the second turn starts, is marked by its own
  // StopFailure, and dies a second later.
  slow = true
  const late = rateLimited($)
  await clock.settle()
  await $.turn.start({ text: 'go', turnId: 't2' } as never)
  await clock.advance(1000)
  await rateLimited($)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'error' } as never)
  await clock.settle()

  release()
  await late
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 00:15:01')
  await clock.advance(15 * MINUTE)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a person\'s prompt that comes while an error turn\'s hold decision reads the usage starts no hold, and the person\'s turn ends as any other', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  // The usage report shows a five-hour window used up, and once `slow` is
  // set it waits until the test lets it through.
  let slow = false
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  on('session.usage', async () => {
    if (slow) await gate
    return { value: { startedAt: 0, context: {}, rateLimits: [fiveHourAt('2026-10-12T02:00:00Z')] } } as never
  })
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)

  // The turn dies, and its hold decision waits on the usage report while the
  // person's prompt goes through.
  slow = true
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  const ended = $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await clock.settle()
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  release()
  await ended
  await clock.settle()

  // The person's turn runs and ends as usual.
  await ownTurn($, 't2')
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  world.calls = []
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
  // Past the resume time the window's reset would have given.
  await clock.advance(2 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

// Watches #7 with a five-hour window at 100 percent that resets two hours
// on, and ends a turn of the session's own with an error while the write
// saving its hold waits, so that the test can send a prompt before the hold
// is saved. `release` lets the write through and waits for the turn's end.
// Once `refuseClear` is called, the next write taking the hold off is
// refused. The one hook does both, because the kit allows one hook for each
// event.
async function holdBeingSaved($: Engine, on: On) {
  let isSaveWaiting = false
  let letSaveThrough = () => {}
  let isClearRefused = false
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'usageHold') {
      if (e.value === null && isClearRefused) {
        isClearRefused = false
        return { deny: 'the state could not be written' } as never
      }
      if (e.value !== null && !isSaveWaiting) {
        isSaveWaiting = true
        await new Promise<void>(resolve => { letSaveThrough = resolve })
      }
    }
    return next(e)
  })
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  const ended = $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await clock.settle()
  expect(isSaveWaiting).toBe(true)
  const release = async () => {
    letSaveThrough()
    await ended
    await clock.settle()
  }
  const refuseClear = () => { isClearRefused = true }
  const isClearStillRefused = () => isClearRefused
  return { clock, world, prompts, line, release, refuseClear, isClearStillRefused }
}

// Leaves a session that watches nothing, in the spec stage, whose hold from a
// turn that ended with an error was cleared at the resume time, and whose
// decision after that clear could not read the stage and waits 15 minutes to
// be tried again, with no prompt sent yet. The one state.get hook asks both
// refusals, because the kit allows one hook for each event.
async function holdClearedWithStageRefused($: Engine, on: On) {
  const holdRead = readRefusal('usageHold')
  const stageRead = readRefusal('progress')
  on('state.get', ($, e, next) => holdRead.refuses(e) ?? stageRead.refuses(e) ?? next(e))
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  fakePanes(on)
  // Neither the session's start nor the turn's end can read the hold to arm
  // the timers, so each hook after them tries that arming again.
  holdRead.refusal.reads = 1
  await startOnly($)
  await clock.settle()
  expect(holdRead.refusal.reads).toBe(0)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec')
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  holdRead.refusal.reads = 1
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await clock.settle()
  expect(holdRead.refusal.reads).toBe(0)

  // At the resume time the hold is cleared, and the decision after the clear
  // cannot read the stage, so it waits 15 minutes to be tried again.
  await clock.advance(2 * HOUR + MINUTE - 1000)
  stageRead.refusal.reads = 1
  await clock.advance(1000)
  expect(stageRead.refusal.reads).toBe(0)
  expect(prompts).toEqual([])
  return { clock, prompts, holdRead, stageRead }
}

test('a person\'s prompt that comes while the hold is being saved takes the hold off once it is saved, and polling starts again with no resume prompt', async ($, on) => {
  const { clock, world, prompts, line, release } = await holdBeingSaved($, on)
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  await release()

  await ownTurn($, 't2')
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  world.calls = []
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
  // Past the resume time the window's reset would have given.
  await clock.advance(2 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a person\'s prompt that comes while the hold is being saved, when taking the hold off again is refused after the save and at the end of the person\'s turn, leaves the hold on and its resume prompt still comes at the resume time', async ($, on) => {
  const { clock, world, prompts, line, release, refuseClear, isClearStillRefused } = await holdBeingSaved($, on)
  await $.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
  refuseClear()
  await release()
  expect(isClearStillRefused()).toBe(false)

  // The person's turn ends with an answer, which takes the hold off too, and
  // that clear is refused as well.
  refuseClear()
  await ownTurn($, 't2')
  await clock.settle()
  expect(isClearStillRefused()).toBe(false)
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')
  world.calls = []
  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(world.calls.filter(call => call.startsWith('gh '))).toEqual([])
  expect(resumesOf(prompts)).toEqual([])
  expect(stuckOf(prompts)).toEqual([])

  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
})

test('a turn of the session\'s own that starts and ends with an answer while the hold is being saved takes the hold off once it is saved, and polling and the stuck prompt start again with no resume prompt', async ($, on) => {
  const { clock, world, prompts, line, release } = await holdBeingSaved($, on)
  try {
    await ownTurn($, 't2')
  } finally {
    await release()
  }
  expect(await line()).not.toContain('waiting on the usage limit')

  world.calls = []
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
  // The quiet time counts from the end of that turn.
  await clock.advance(40 * MINUTE)
  expect(stuckOf(prompts).length).toBe(1)
  // Past the resume time the window's reset would have given.
  await clock.advance(2 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a turn of the session\'s own that starts while the hold is being saved and still runs when it is saved leaves the hold on until it ends with an answer', async ($, on) => {
  const { clock, world, prompts, line, release } = await holdBeingSaved($, on)
  try {
    await $.turn.start({ text: 'go', turnId: 't2' } as never)
  } finally {
    await release()
  }
  expect(await line()).toContain('waiting on the usage limit until 02:01:00')

  await $.turn.complete({ answer: 'waiting', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  world.calls = []
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a turn of the session\'s own that starts and ends with an answer while an error turn\'s end is still clearing busy, before the hold is decided, leaves no hold once it is saved', async ($, on) => {
  const clearingBusy = writeWaits(on, 'busy', value => value === false)
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  clearingBusy.arm()
  const ended = $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
  try {
    await clock.settle()
    expect(clearingBusy.isWaiting).toBe(true)
    // This turn's end finds no hold yet, so only the save that follows can
    // tell that the limit lifted after the error turn ended.
    await ownTurn($, 't2')
  } finally {
    clearingBusy.release()
    await ended
    await clock.settle()
  }
  expect(await line()).not.toContain('waiting on the usage limit')

  world.calls = []
  await clock.advance(10 * MINUTE)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
  // Past the resume time the window's reset would have given.
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a turn of the session\'s own that ends with an answer while a later turn starts, dies on the limit and saves its hold before this end reads it leaves that hold on, and its resume prompt comes once at the resume time', async ($, on) => {
  const clearingBusy = writeWaits(on, 'busy', value => value === false)
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  clearingBusy.arm()
  const ended = $.turn.complete({ answer: 'waiting', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  try {
    await clock.settle()
    expect(clearingBusy.isWaiting).toBe(true)
    // The later turn's end decides and saves its hold while the answer
    // turn's end has not yet read the hold.
    await ownTurn($, 't2', 'error')
    await clock.settle()
    expect(await line()).toBe('builder: #7 open · checks passed · waiting on the usage limit until 02:01:00')
  } finally {
    clearingBusy.release()
    await ended
    await clock.settle()
  }
  expect(await line()).toBe('builder: #7 open · checks passed · waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE - 1000)
  expect(resumesOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in.'])
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a turn that dies with neither a window at 100 percent nor a StopFailure does not hold, and the look 10 seconds on runs', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z', 99.9)]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  world.calls = []
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toContain('next look in')
  expect(await line()).not.toContain('waiting on the usage limit')

  await clock.advance(10_000)
  expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

// Only the session's own StopFailure of rate_limit marks a turn for the hold.
// A subagent's StopFailure carries its agent_id, and a StopFailure of any
// other error is not the usage limit. The usage cannot be read, so a hold
// could only come from the StopFailure, and it would resume 15 minutes on.
for (const [whose, failure] of [
  ['a subagent\'s StopFailure of rate_limit', { error: 'rate_limit', agent_id: 'agent-1' }],
  ['the session\'s own StopFailure of server_error', { error: 'server_error' }],
] as const) {
  test(`a turn that dies after ${whose} does not hold, and the look 10 seconds on runs`, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    mock.store(on)
    engine(on)
    const world = fakeGitHub(on)
    sessionTurns(on)
    stopFailures(on)
    const usage = usageAnswers(on)
    usage.fails = true
    const prompts = recordPrompts(on)
    const line = await abovePrompt($, on)
    await watch($)
    world.calls = []
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await $.classic.StopFailure(failure as never)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' } as never)
    await clock.settle()
    expect(await line()).toContain('next look in')
    expect(await line()).not.toContain('waiting on the usage limit')

    await clock.advance(10_000)
    expect(world.calls.some(call => call.startsWith('gh pr view 7'))).toBe(true)
    await clock.advance(3 * HOUR)
    expect(resumesOf(prompts)).toEqual([])
  })
}

test('a turn that dies on the limit in a session with no watch and no stage reported does not hold', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  fakePanes(on)
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  expect(await line()).toContain('idle')
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(3 * HOUR)
  expect(prompts).toEqual([])
})

test('a turn that dies on the limit after the watched pull request merged does not hold', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  world.pr = openPullRequest({ state: 'MERGED' })
  await clock.advance(10 * MINUTE)
  expect(await line()).toContain('merged')

  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).not.toContain('waiting on the usage limit')
  await clock.advance(3 * HOUR)
  expect(resumesOf(prompts)).toEqual([])
})

test('a turn that dies on the limit with a stage reported and nothing watched holds, and the resume names the stage', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  fakePanes(on)
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec')
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toBe('builder: spec · waiting on the usage limit until 02:01:00')

  await clock.advance(2 * HOUR + MINUTE)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in (spec).'])
})

// With nothing watched there is no stuck prompt to fall back on, so a read
// refused after the resume time has cleared the hold must not leave the
// session with no hold, no turn and no timer.
test('a read of the stage refused just after the resume time clears a hold with nothing watched sends nothing, and the resume comes 15 minutes later', async ($, on) => {
  // While armed, the first read of the stage after the write clearing the
  // hold is refused.
  const fault = refusedAfterWrite(on, { written: 'usageHold', matches: value => value === null, refused: 'progress', refuses: 'get' })
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const prompts = recordPrompts(on)
  fakePanes(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec')
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toBe('builder: spec · waiting on the usage limit until 02:01:00')

  fault.isArmed = true
  await clock.advance(2 * HOUR + MINUTE)
  fault.isArmed = false
  expect(fault.refusals).toBe(1)
  expect(prompts).toEqual([])

  await clock.advance(15 * MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in (spec).'])
  expect(prompts.length).toBe(1)
})

test('a refused resume prompt whose new hold cannot be saved, with nothing watched, is tried again 15 minutes later', async ($, on) => {
  const refusal = refusedWrites(on, 'usageHold', value => value !== null)
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const record = refusablePrompts(on)
  fakePanes(on)
  const line = await abovePrompt($, on)
  await startOnly($)
  await loose($)({ tool: 'mcp__builder__open_pane' })
  await report($, 'spec')
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toBe('builder: spec · waiting on the usage limit until 02:01:00')

  refusal.writes = 1
  record.refusing = true
  await clock.advance(2 * HOUR + MINUTE)
  record.refusing = false
  expect(refusal.refusals).toBe(1)
  expect(resumesOf(record.prompts)).toEqual([])

  await clock.advance(15 * MINUTE - 1000)
  expect(resumesOf(record.prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(record.prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in (spec).'])
})

// The retry of the decision after the clear sits in the hold's timer slot,
// where a refused arming of the timers also arms its own retry. With nothing
// watched there is no stuck prompt, so the arming's retry must not replace
// the decision's, or the session is left with no hold, no resume and no
// timer.
test('a prompt that is not the person\'s, whose read of the hold is refused while the decision after the clear waits to be tried again, still lets the resume come', async ($, on) => {
  const { clock, prompts, holdRead } = await holdClearedWithStageRefused($, on)

  // A prompt that is not the person's, here a task notification, arms the
  // timers again, and cannot read the hold either.
  holdRead.refusal.reads = 1
  await $.prompt.submit({ text: 'a background task finished', origin: { kind: 'task-notification' } } as never)
  await clock.settle()
  expect(holdRead.refusal.reads).toBe(0)

  await clock.advance(15 * MINUTE)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in (spec).'])
})

// The end of a turn that ended with an answer reads the hold to take it off.
// When that read is refused, the end must touch no timer, because arming the
// hold's timer with no hold saved would cancel the retry of the decision
// after the clear, and the resume would never come.
test('a turn that ends with an answer, whose read of the hold is refused while the decision after the clear waits to be tried again, still lets the resume come', async ($, on) => {
  const { clock, prompts, holdRead } = await holdClearedWithStageRefused($, on)

  // The turn's end arms the timers again before it takes the hold off, and
  // each of those reads the hold, so both reads are refused.
  holdRead.refusal.reads = 2
  await ownTurn($, 't2')
  await clock.settle()
  expect(holdRead.refusal.reads).toBe(0)

  await clock.advance(15 * MINUTE)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in (spec).'])
  expect(prompts.length).toBe(1)
})

// A timer of the hold that has fired is no longer armed. When the retry of the
// decision after the clear fires and its work ends without arming anything,
// a refused arming of the timers after it must still arm its own retry, and
// must not take the fired timer for a retry of the decision that is still to
// come.
test('a prompt that is not the person\'s, whose read of the hold is refused after the decision after the clear was tried again and sent the resume, still has the arming tried again 15 minutes later', async ($, on) => {
  const { clock, prompts, holdRead } = await holdClearedWithStageRefused($, on)
  // The decision after the clear, tried again 15 minutes later, sends the
  // resume prompt, which arms nothing more.
  await clock.advance(15 * MINUTE)
  expect(resumesOf(prompts)).toEqual(['builder: the usage limit has reset; carry on /implement from the stage you were in (spec).'])

  // A prompt that is not the person's, here a task notification, arms the
  // timers again, and cannot read the hold either.
  holdRead.refusal.reads = 1
  await $.prompt.submit({ text: 'a background task finished', origin: { kind: 'task-notification' } } as never)
  await clock.settle()
  expect(holdRead.refusal.reads).toBe(0)

  // Nothing else reads the hold in the next 15 minutes, so the read refused
  // at their end is the retry of the arming.
  holdRead.refusal.reads = 1
  await clock.advance(15 * MINUTE - 1000)
  expect(holdRead.refusal.reads).toBe(1)
  await clock.advance(1000)
  expect(holdRead.refusal.reads).toBe(0)
})

test('a reset time already past when the turn dies resumes one minute after the turn', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-11T23:00:00Z')]
  const prompts = recordPrompts(on)
  await watch($)
  await ownTurn($, 't1', 'error')
  await clock.advance(MINUTE - 1000)
  expect(resumesOf(prompts)).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
})

test('a hold on a spend limit 30 days away has not resumed after 25 days and resumes 30 days and one minute after it began', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  fakeGitHub(on)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [{ kind: 'spend_limit', percentUsed: 140, resetsAt: new Date(T0 + 30 * DAY).toISOString() }]
  const prompts = recordPrompts(on)
  const line = await abovePrompt($, on)
  await watch($)
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toContain('waiting on the usage limit until 2026-11-11 00:01:00')

  await clock.advance(25 * DAY)
  expect(prompts).toEqual([])
  await clock.advance(5 * DAY + MINUTE - 1000)
  expect(prompts).toEqual([])
  await clock.advance(1000)
  expect(resumesOf(prompts).length).toBe(1)
})

test('failed reads of the workflow runs hand nothing over, and the next good read says once that the run finished', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)

  world.runs = [{ id: 1, run_attempt: 1, name: 'build' }]
  await watch($)
  await clock.settle()
  // The run finishes without a check while the runs cannot be read.
  world.runs = []
  world.runsReadsToFail = 3
  await clock.advance(3 * 90_000)
  expect(world.runsReadsToFail).toBe(0)
  expect(prompts).toEqual([])

  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Workflow run "build" finished.')
  expect(prompts[0]).not.toContain('could not be read')
  await clock.advance(10 * 60_000)
  expect(prompts.length).toBe(1)
})

test('a moved head whose runs cannot be read is handed over with the move, no run named, and the runs said to be unread', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  const prompts = recordPrompts(on)

  world.runs = [{ id: 1, run_attempt: 1, name: 'build' }]
  await watch($)
  await clock.settle()
  world.pr = openPullRequest({ headRefOid: D, commits: [{ oid: C }, { oid: D }] })
  world.runsReadsToFail = 100
  await clock.advance(90_000)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain(`The head moved from ${C.slice(0, 8)} to ${D.slice(0, 8)}.`)
  expect(prompts[0]).not.toContain('Workflow run')
  expect(prompts[0]).toContain('The workflow runs could not be read at the last look.')
})

// A runs read whose output was cut off, or whose process threw, counts as a
// read that failed: the look keeps the run stored at the same head, hands no
// turn over, and the state lines say the runs could not be read.
for (const [how, fail] of [
  ['answers with its output cut off', (world: ReturnType<typeof fakeGitHub>) => { world.runsReadsCut = true }],
  ['throws', (world: ReturnType<typeof fakeGitHub>) => { world.runsReadsThrow = true }],
] as const) {
  test(`a runs read that ${how} keeps the stored run at the same head and hands nothing over`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engine(on)
    const world = fakeGitHub(on)
    const prompts = recordPrompts(on)
    on('command.run', () => ({ text: '' }))

    world.runs = [{ id: 1, run_attempt: 1, name: 'build' }]
    await watch($)
    await clock.settle()
    fail(world)
    const readsBefore = world.calls.filter(call => call.startsWith('gh api --paginate')).length
    await clock.advance(3 * 90_000)
    expect(world.calls.filter(call => call.startsWith('gh api --paginate')).length).toBeGreaterThan(readsBefore)
    expect(prompts).toEqual([])

    const shown = await $.command.run({ command: 'builder', args: 'poll' } as never)
    expect(JSON.stringify(shown)).toContain('The workflow runs could not be read at the last look.')
    expect(prompts).toEqual([])
  })
}

test('the workflow runs are read at the head gh pr view gave, not at the local checkout', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.head = A

  await watch($)
  await clock.settle()
  const reads = world.calls.filter(call => call.startsWith('gh api --paginate'))
  expect(reads.length).toBeGreaterThan(0)
  expect(reads[0]).toBe(`gh api --paginate repos/o/r/actions/runs?head_sha=${C}&per_page=100 --jq ${RUNS_JQ}`)
  expect(reads.some(call => call.includes(A))).toBe(false)
})

// The checkout the mod is loaded from through a link, as a machine that links
// the mod into a git checkout has it, standing at C when the session starts.
const MOD = '/checkout/mods/builder'
const SESSION_DIFF = `git diff --quiet ${C} ${D} -- agents .claude-plugin/plugin.json hooks/hooks.json`
const HOOKS_DIFF = `git diff --quiet ${C} ${D} -- hooks :(exclude)hooks/hooks.json`

// A session whose mod is linked into MOD, at C, with the line above the
// prompt mounted, started and settled. It answers the fake world, what the
// stats asked, the line's reader, and the session's turn end.
async function linkedSession($: Engine, on: On) {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.heads[MOD] = C
  const stats = linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  let turns = 0
  const turnEnd = async () => {
    turns += 1
    await $.turn.start({ text: 'go on', turnId: `t${turns}` } as never)
    await turnEnds($, `t${turns}`)
    await clock.settle()
  }
  const quietDiffs = () => world.ran.filter(r => r.argv.startsWith('git diff --quiet'))
  return { clock, world, stats, line, turnEnd, quietDiffs }
}

// The checkout moves from C to D, changing `paths`.
function moves(world: ReturnType<typeof fakeGitHub>, paths: string[]) {
  world.heads[MOD] = D
  world.changed[`${C} ${D}`] = paths
}

test('with nothing watched, the turn end after the checkout moved and changed an agent warns that builder changed on disk', async ($, on) => {
  const { world, stats, line, turnEnd, quietDiffs } = await linkedSession($, on)
  expect(await line()).toBe('')

  moves(world, ['agents/spec-reviewer.md'])
  await turnEnd()

  expect(await line()).toBe(STALE_WARNING)
  // The mod found its checkout by resolving its own folder, and ran git there.
  expect(stats.length).toBeGreaterThan(0)
  expect(stats.every(stat => stat.resolve)).toBe(true)
  expect(quietDiffs().map(r => r.argv)).toEqual([SESSION_DIFF, HOOKS_DIFF])
  expect(quietDiffs().every(r => r.cwd === MOD)).toBe(true)
  expect(world.ran.filter(r => r.argv === 'git rev-parse HEAD').every(r => r.cwd === MOD)).toBe(true)
})

test('a move that changes only files outside the ones the session loaded says nothing', async ($, on) => {
  const { world, line, turnEnd, quietDiffs } = await linkedSession($, on)

  moves(world, ['README.md', 'tests/x.test.ts'])
  await turnEnd()

  expect(quietDiffs().length).toBe(2)
  expect(await line()).toBe('')
})

test('a comparison runs no git diff while the head is unchanged, and one for each part due once it moves', async ($, on) => {
  const { world, turnEnd, quietDiffs } = await linkedSession($, on)

  await turnEnd()
  await turnEnd()
  expect(quietDiffs()).toEqual([])

  moves(world, ['hooks/register.tsx'])
  await turnEnd()
  expect(quietDiffs().length).toBe(2)

  // Compared at D already, so the next turn end compares nothing.
  await turnEnd()
  expect(quietDiffs().length).toBe(2)
})

test('a comparison is dropped when the checkout moves while git diff runs, and the next turn end compares again', async ($, on) => {
  const { world, line, turnEnd, quietDiffs } = await linkedSession($, on)
  moves(world, ['agents/spec-reviewer.md'])
  // The checkout moves on to E during the first git diff, and E changes the
  // agents too.
  world.changed[`${C} ${E}`] = ['agents/spec-reviewer.md']
  world.onQuietDiff = () => {
    world.heads[MOD] = E
    world.onQuietDiff = null
  }

  await turnEnd()
  // The comparison at D ran, but HEAD was no longer D after it, so what it
  // found is not kept.
  expect(quietDiffs().length).toBe(2)
  expect(await line()).toBe('')

  await turnEnd()
  expect(quietDiffs().length).toBe(4)
  expect(await line()).toBe(STALE_WARNING)
})

test('a comparison is made against the commit it read, so a move away and back while git diff runs keeps the warning right', async ($, on) => {
  const { world, line, turnEnd, quietDiffs } = await linkedSession($, on)
  moves(world, ['agents/spec-reviewer.md'])
  await turnEnd()
  expect(await line()).toBe(STALE_WARNING)

  // The checkout moves on to E, whose files are the ones the session loaded
  // at C. While each git diff runs it stands at D again, and it is back at E
  // before HEAD is read again, so only the commit read says what was compared.
  world.heads[MOD] = E
  world.onQuietDiff = () => { world.heads[MOD] = D }
  world.afterQuietDiff = () => { world.heads[MOD] = E }
  await turnEnd()

  expect(await line()).toBe('')
  expect(quietDiffs().slice(2).map(r => r.argv)).toEqual([SESSION_DIFF.replace(D, E), HOOKS_DIFF.replace(D, E)])
})

test('a git diff that exits 128 gives no warning', async ($, on) => {
  const { world, line, turnEnd, quietDiffs } = await linkedSession($, on)
  world.diffExit = 128

  moves(world, ['agents/spec-reviewer.md'])
  await turnEnd()

  expect(quietDiffs().length).toBe(2)
  expect(await line()).toBe('')
})

test('a mod folder that is not a git checkout gives no warning and runs no git diff', async ($, on) => {
  const { world, line, turnEnd, quietDiffs } = await linkedSession($, on)
  world.notCheckouts.push(MOD)

  moves(world, ['agents/spec-reviewer.md'])
  await turnEnd()

  expect(quietDiffs()).toEqual([])
  expect(await line()).toBe('')
})

test('the pane of a stale session leads with the warning, in yellow, with a pull request watched or not', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.heads[MOD] = C
  linkedMod(on, MOD)
  sessionTurns(on)
  const pane = await $.ui.mount({ plugin: 'builder', surface: 'terminal', component: 'Pane', requestId: 'builder', props: {} as never })
  const firstRow = async () => {
    await pane.redraw()
    const [first] = await pane.findAll({ type: 'Text' })
    return { text: first?.text, color: first?.props.color }
  }
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  expect((await firstRow()).text).toBe(NOTHING_WATCHED)

  moves(world, ['agents/spec-reviewer.md'])
  await $.turn.start({ text: 'go on', turnId: 't1' } as never)
  await turnEnds($, 't1')
  await clock.settle()
  expect(await firstRow()).toEqual({ text: STALE_WARNING, color: 'yellow' })

  await $.tool.call({ tool: 'mcp__builder__watch', number: 7 } as never)
  await clock.settle()
  expect(await firstRow()).toEqual({ text: STALE_WARNING, color: 'yellow' })
  expect((await pane.find({ text: 'Next:' }))?.text).toContain('o/r#7 · open')
})

// A hot reload of the hooks, as the suite stands for it elsewhere: the hooks'
// session start runs again in the same session.
async function reloads($: Engine, clock: { settle: () => Promise<void> }) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
}

test('a hot reload after a change only to the hooks module clears the warning, because it loaded those hooks', async ($, on) => {
  const { clock, world, line, turnEnd } = await linkedSession($, on)
  moves(world, ['hooks/register.tsx'])
  await turnEnd()
  expect(await line()).toBe(STALE_WARNING)

  await reloads($, clock)
  expect(await line()).toBe('')
  // It stays clear, since the reloaded hooks are the ones at HEAD.
  await turnEnd()
  expect(await line()).toBe('')
})

test('a hot reload after a change to an agent keeps the warning, because agents are read only when a session starts', async ($, on) => {
  const { clock, world, line, turnEnd } = await linkedSession($, on)
  moves(world, ['agents/spec-reviewer.md', 'hooks/register.tsx'])
  await turnEnd()
  expect(await line()).toBe(STALE_WARNING)

  await reloads($, clock)
  expect(await line()).toBe(STALE_WARNING)
})

test('a hot reload after a change to the list of hook modules keeps the warning', async ($, on) => {
  const { clock, world, line, turnEnd } = await linkedSession($, on)
  moves(world, ['hooks/hooks.json'])
  await turnEnd()
  expect(await line()).toBe(STALE_WARNING)

  await reloads($, clock)
  expect(await line()).toBe(STALE_WARNING)
})

test('a hot reload that comes before any turn end has compared the move still warns about the agents', async ($, on) => {
  const { clock, world, line } = await linkedSession($, on)
  moves(world, ['agents/spec-reviewer.md'])

  await reloads($, clock)
  expect(await line()).toBe(STALE_WARNING)
})

test('a hot reload from an older build that kept no record of its commits warns at once, and the warning stays until a restart', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  // The older build set the session's folder and recorded no commits, and
  // the checkout has moved on to D since that session started.
  olderBuildState(on, { cwd: '/repo' })
  world.heads[MOD] = D
  linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)

  await reloads($, clock)
  expect(await line()).toBe(STALE_WARNING)

  // Neither a turn end nor another reload at the same head clears it.
  await $.turn.start({ text: 'go on', turnId: 't1' } as never)
  await turnEnds($, 't1')
  await clock.settle()
  expect(await line()).toBe(STALE_WARNING)
  await reloads($, clock)
  expect(await line()).toBe(STALE_WARNING)
})

test('a hot reload while the first load still waits on git takes the session for one of this build, and warns of nothing when nothing changed', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.heads[MOD] = C
  linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)
  // The first load's read of the head is held, so the session's start sets
  // its folder before that load records anything, and a reload comes then.
  let release = () => {}
  world.headHolds[MOD] = new Promise<void>(resolve => { release = resolve })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await reloads($, clock)
  release()
  await clock.settle()
  expect(await line()).toBe('')
})

test('a hot reload while the first load still waits on git leaves the session commit to that load, so agents changed meanwhile still warn', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.heads[MOD] = C
  linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)
  // The first load reads the head at C and is held there. The checkout moves
  // to D, changing an agent and the hooks, and a reload loads D's hooks
  // before the first load records anything.
  let release = () => {}
  world.headHolds[MOD] = new Promise<void>(resolve => { release = resolve })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  moves(world, ['agents/spec-reviewer.md', 'hooks/register.tsx'])
  await reloads($, clock)
  release()
  await clock.settle()
  expect(await line()).toBe(STALE_WARNING)

  // The agents running are C's, so neither a turn end nor another reload clears it.
  await $.turn.start({ text: 'go on', turnId: 't1' } as never)
  await turnEnds($, 't1')
  await clock.settle()
  expect(await line()).toBe(STALE_WARNING)
  await reloads($, clock)
  expect(await line()).toBe(STALE_WARNING)
})

test('a second reload while the reload from an older build still waits on git keeps the warning that reload owes', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  olderBuildState(on, { cwd: '/repo' })
  world.heads[MOD] = C
  linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)
  let release = () => {}
  world.headHolds[MOD] = new Promise<void>(resolve => { release = resolve })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await reloads($, clock)
  release()
  await clock.settle()
  expect(await line()).toBe(STALE_WARNING)
})

test('a first start whose read of the head failed never warns, even after the checkout moves', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.notCheckouts.push(MOD)
  linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  expect(await line()).toBe('')

  world.notCheckouts.length = 0
  moves(world, ['agents/spec-reviewer.md'])
  await $.turn.start({ text: 'go on', turnId: 't1' } as never)
  await turnEnds($, 't1')
  await clock.settle()
  expect(await line()).toBe('')
})

test('a move back to the commit the session loaded clears the warning at the next turn end', async ($, on) => {
  const { world, line, turnEnd } = await linkedSession($, on)
  moves(world, ['agents/spec-reviewer.md'])
  await turnEnd()
  expect(await line()).toBe(STALE_WARNING)

  world.heads[MOD] = C
  await turnEnd()
  expect(await line()).toBe('')
})

test('with a pull request watched, a poll alone finds that builder changed on disk, with no turn end', async ($, on) => {
  const { clock, world, line } = await linkedSession($, on)
  await $.tool.call({ tool: 'mcp__builder__watch', number: 7 } as never)
  await clock.settle()
  expect(await line()).toBe('builder: #7 open · checks passed · nothing to hand over · next look in 10m')

  moves(world, ['agents/spec-reviewer.md'])
  await clock.advance(10 * 60_000)

  expect(await line()).toBe(`${STALE_WARNING} · #7 open · checks passed · nothing to hand over · next look in 10m`)
})

test('a reload whose comparison finishes after the first load fills in the session commit leaves that commit to be compared, so agents changed meanwhile still warn', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.heads[MOD] = C
  linkedMod(on, MOD)
  sessionTurns(on)
  const line = await abovePrompt($, on)
  // The first load reads the head at C and is held there.
  let releaseFirst = () => {}
  world.headHolds[MOD] = new Promise<void>(resolve => { releaseFirst = resolve })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  // The checkout moves to D, changing the hooks, and a reload reads D and is
  // held there. Then it moves to E, changing an agent.
  world.heads[MOD] = D
  world.changed[`${C} ${D}`] = ['hooks/register.tsx']
  world.changed[`${D} ${E}`] = ['agents/spec-reviewer.md']
  world.changed[`${C} ${E}`] = ['agents/spec-reviewer.md', 'hooks/register.tsx']
  let releaseReload = () => {}
  world.headHolds[MOD] = new Promise<void>(resolve => { releaseReload = resolve })
  await reloads($, clock)
  world.heads[MOD] = E
  // The reload records its hooks at D and compares them against E, and its
  // second read of the head, which confirms E, is held.
  let releaseReloadCheck = () => {}
  let diffs = 0
  world.onQuietDiff = () => {
    diffs += 1
    if (diffs === 1) world.headHolds[MOD] = new Promise<void>(resolve => { releaseReloadCheck = resolve })
  }
  releaseReload()
  await clock.settle()
  // The first load now fills in the session commit C, and its own read of
  // the head is held, so the reload's comparison, which never compared C,
  // finishes first.
  let releaseFirstCompare = () => {}
  world.headHolds[MOD] = new Promise<void>(resolve => { releaseFirstCompare = resolve })
  releaseFirst()
  await clock.settle()
  releaseReloadCheck()
  await clock.settle()
  releaseFirstCompare()
  await clock.settle()
  expect(await line()).toBe(STALE_WARNING)
})

test('a turn end during a usage-limit hold still finds that builder changed on disk', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  engine(on)
  const world = fakeGitHub(on)
  world.heads[MOD] = C
  linkedMod(on, MOD)
  sessionTurns(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  const line = await abovePrompt($, on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await clock.settle()
  await watch($)
  // A turn that dies with the window at 100 percent starts the hold.
  await ownTurn($, 't1', 'error')
  await clock.settle()
  expect(await line()).toBe('builder: #7 open · checks passed · waiting on the usage limit until 02:01:00')

  // The checkout moves and changes an agent, and another turn dies during the hold.
  moves(world, ['agents/spec-reviewer.md'])
  await ownTurn($, 't2', 'error')
  await clock.settle()
  expect((await line()).startsWith(STALE_WARNING)).toBe(true)
})

// The status file for the foreman. Each test starts a session in /repo whose
// first prompt carries a ticket, unless it says otherwise, with HOME set to
// /home/me and the desktop app's session id set, and reads the file the mod
// wrote through the fake file system.

const BUILD = '/home/me/.claude/foreman/builds/session-1.json'
const TICKETED = 'Implement the next issue.\nforeman-ticket: slot-1\n'
const S0 = Date.parse('2026-10-12T00:00:00Z')

// What the engine answers beneath the mod for a session the foreman started:
// the registrations, the session's id (which a test may change, as a /clear
// does), its start and end, its prompts and turns, its skills, the classic
// events the tests raise, and the transcript, which is `messages` or refused.
// `env` is the environment the mod reads. `transcriptReads` counts the reads
// of the transcript.
function foremanSession(on: On, over: { env?: Record<string, string>; messages?: object[] | 'refused' } = {}) {
  const clock = mock.clock(on, { now: S0 })
  mock.store(on)
  mock.env(on, over.env ?? { HOME: '/home/me', CLAUDE_CODE_HOST_SESSION_ID: 'desk-1' })
  const ids = { current: 'session-1' }
  engine(on, undefined, async () => ({ value: ids.current }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  const transcript = { reads: 0 }
  on('session.messages', () => {
    transcript.reads += 1
    return over.messages === 'refused' ? { deny: 'the transcript could not be read' } : { value: (over.messages ?? []) as never }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  stops(on)
  sessionTurns(on)
  const world = fakeGitHub(on)
  const files = fakeFiles(on)
  const statusAt = (path = BUILD) => {
    const text = files.get(path)
    return text === undefined ? undefined : JSON.parse(text) as BuildStatus
  }
  const writesOf = (path = BUILD) => files.writes.log.filter(written => written === path).length
  const transcriptReads = () => transcript.reads
  return { clock, ids, world, files, statusAt, writesOf, transcriptReads }
}

// Starts the session and submits its first prompt, typed by the person.
async function firstPrompt($: Engine, clock: ReturnType<typeof mock.clock>, text = TICKETED) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  await clock.settle()
}

const endSession = ($: Engine, reason: string, sessionId = 'session-1') =>
  $.session.end({ reason, sessionId, resume: { id: sessionId } } as never)

const mergedPullRequest = () => openPullRequest({ state: 'MERGED' })

// Watches #7 and lets a poll find it merged, which also ends the watch's looks.
async function watchUntilMerged($: Engine, s: ReturnType<typeof foremanSession>) {
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await s.clock.settle()
  s.world.pr = mergedPullRequest()
  await s.clock.advance(10 * MINUTE)
}

test('a session whose first prompt holds a ticket writes its record under the configuration folder, idle, with its ticket, ids and folder', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)

  expect(s.statusAt()).toEqual({
    version: 1, sessionId: 'session-1', ticket: 'slot-1', desktopSessionId: 'desk-1', cwd: '/repo', issueKey: null, issueTitle: '',
    stage: null, stageDone: 0, pr: null, state: 'idle', reason: 'Nothing runs and nothing is waiting.', stateSince: S0, writtenAt: S0,
  })
})

test('a session with no ticket writes no status file and deletes none, whatever it does', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock, 'Implement the next issue.')
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.skill.prompt({ skill: 'cleanup', text: 'clean' } as never)
  await turnEnds($, 't1')
  await s.clock.advance(5 * MINUTE)
  await endSession($, 'prompt_input_exit')

  expect(s.files.writes.log.filter(path => path.includes('/foreman/'))).toEqual([])
  expect(s.world.calls.filter(call => call.startsWith('rm '))).toEqual([])
})

test('a ticket in the first prompt of a resumed transcript counts, though the prompt being submitted has none', async ($, on) => {
  const s = foremanSession(on, { messages: [
    { role: 'assistant', text: 'Resumed.', toolUses: [] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'ok', isError: false }] },
    { role: 'user', text: TICKETED, toolUses: [] },
  ] })
  await firstPrompt($, s.clock, 'Carry on.')
  expect(s.statusAt()?.ticket).toBe('slot-1')
})

test('when the transcript cannot be read, the prompt being submitted is checked for the ticket instead', async ($, on) => {
  const s = foremanSession(on, { messages: 'refused' })
  await firstPrompt($, s.clock)
  expect(s.statusAt()?.ticket).toBe('slot-1')
})

test('CLAUDE_CONFIG_DIR is preferred to HOME, and the desktop id is left out when it is unset', async ($, on) => {
  const s = foremanSession(on, { env: { CLAUDE_CONFIG_DIR: '/config', HOME: '/home/me' } })
  await firstPrompt($, s.clock)

  expect(s.statusAt()).toBeUndefined()
  const record = s.statusAt('/config/foreman/builds/session-1.json')
  expect(record?.ticket).toBe('slot-1')
  expect(record !== undefined && 'desktopSessionId' in record).toBe(false)
})

test('the session\'s own turn reads working, and its end reads idle again from that moment', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await s.clock.advance(MINUTE / 2)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'working', reason: 'The session\'s own turn is running.', stateSince: S0 + MINUTE / 2 })

  await s.clock.advance(MINUTE / 4)
  await turnEnds($, 't1')
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'idle', stateSince: S0 + (3 * MINUTE) / 4 })
})

test('a held tool call of the session\'s own reads working, naming the tool and never its command', async ($, on) => {
  const s = foremanSession(on)
  const tools = heldTools(on)
  await firstPrompt($, s.clock)

  const ran = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'npm test', description: 'Run the suite' })
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'working', reason: 'A Bash call of the session\'s own is running.' })
  expect(JSON.stringify(s.statusAt())).not.toContain('npm test')
  tools.get('u1')!.finish()
  await ran
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('idle')
})

test('a running agent reads working', async ($, on) => {
  const s = foremanSession(on)
  await spawnAgents($, on, ['Explore'])
  await firstPrompt($, s.clock)
  expect(s.statusAt()).toMatchObject({ state: 'working', reason: '1 agent is running.' })
})

test('a watch reads waiting on builder with the pull request, and the poll that finds it merged reads done', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await loose($)({ tool: 'mcp__builder__progress', title: 'ABC-123 short issue name', stage: 'review' })
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({
    state: 'waiting-on-builder', reason: 'Builder has a look at the pull request scheduled.', issueKey: 'ABC-123', issueTitle: 'short issue name',
    stage: 'review', stageDone: 7, pr: { repo: 'o/r', number: 7, state: 'OPEN', checks: 'passed' },
  })

  s.world.pr = mergedPullRequest()
  await s.clock.advance(10 * MINUTE)
  expect(s.statusAt()).toMatchObject({ state: 'done', reason: 'The pull request o/r#7 merged.', stageDone: 9, pr: { state: 'MERGED' } })
})

test('a usage-limit hold reads waiting on builder until the session resumes', async ($, on) => {
  const s = foremanSession(on)
  const usage = usageAnswers(on)
  usage.rateLimits = [fiveHourAt('2026-10-12T02:00:00Z')]
  await firstPrompt($, s.clock)
  // A hold is kept only while /implement works on something.
  await loose($)({ tool: 'mcp__builder__progress', title: 'ABC-123 short issue name', stage: 'build' })
  await ownTurn($, 't1', 'error')
  await s.clock.settle()

  expect(s.statusAt()).toMatchObject({ state: 'waiting-on-builder', reason: 'A usage-limit hold is on; builder resumes the session at 2026-10-12T02:01:00.000Z.' })
})

test('the cleanup skill reads in cleanup, with an empty cleanup record, and a question open during it reads needs you', async ($, on) => {
  const s = foremanSession(on)
  const tools = heldTools(on)
  await firstPrompt($, s.clock)
  await $.skill.prompt({ skill: 'builder-tools:cleanup', text: 'clean' } as never)
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'in-cleanup', reason: 'The cleanup skill has started in this session.', cleanup: { failedCalls: 0, lastError: '' } })

  const asked = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Remove the branch?' }] })
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'needs-you', reason: 'An AskUserQuestion call is waiting on the person\'s answer.' })
  tools.get('q1')!.finish({ result: { answers: {} } })
  await asked
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('in-cleanup')
})

test('a merged pull request reads working while a turn runs, and in cleanup once the cleanup skill started', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await watchUntilMerged($, s)
  expect(s.statusAt()?.state).toBe('done')

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('working')
  await $.skill.prompt({ skill: 'cleanup', text: 'clean' } as never)
  await turnEnds($, 't1')
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('in-cleanup')
})

// Puts a question to the counsel and tallies a split round with no proposal,
// which sends the question to the person.
async function counselAsks($: Engine, clock: ReturnType<typeof mock.clock>) {
  await loose($)(brief)
  const ran = await loose($)({ tool: TALLY, id: 'c1', round: 1, votes: ballots(['1', '1', '1', '2', '2', '2', 'none']) })
  expect(String(ran.result)).toContain('AskUserQuestion')
  await clock.settle()
}

test('a tally that sends the question to the person reads needs you until a question that started after it ends', async ($, on) => {
  const s = foremanSession(on)
  const tools = heldTools(on)
  await firstPrompt($, s.clock)
  const before = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Something else?' }] })
  await s.clock.advance(1000)
  await counselAsks($, s.clock)

  // The question that was already open when the tally ended does not clear it.
  tools.get('q1')!.finish({ result: { answers: {} } })
  await before
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'needs-you', reason: 'The counsel sent a question to the person, and it has not been asked yet.' })

  await s.clock.advance(1000)
  const asked = loose($)({ tool: 'AskUserQuestion', tool_use_id: 'q2', questions: [{ question: 'How often should the mod poll?' }] })
  await s.clock.settle()
  expect(s.statusAt()?.reason).toBe('An AskUserQuestion call is waiting on the person\'s answer.')
  tools.get('q2')!.finish({ result: { answers: {} } })
  await asked
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('idle')
})

test('after a tally sends the question to the person, a prompt of the person\'s clears needs you and a plugin\'s prompt does not', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await counselAsks($, s.clock)

  await $.prompt.submit({ text: 'a plugin speaks', origin: { kind: 'plugin', plugin: 'other' } } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('needs-you')
  await $.prompt.submit({ text: 'Use a 90-second poll.', origin: { kind: 'composer' } } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('idle')
})

test('a permission prompt reads needs you, naming the tool and never its input, until the call returns, and two prompts need two returns', async ($, on) => {
  const s = foremanSession(on)
  const tools = heldTools(on)
  await firstPrompt($, s.clock)
  const first = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'echo hunter2' })
  const second = loose($)({ tool: 'Bash', tool_use_id: 'u2', command: 'echo hunter3' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'echo hunter2' } } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'echo hunter3' } } as never)
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'needs-you', reason: 'A permission prompt for Bash in the session is waiting on the person.' })
  expect(s.files.get(BUILD)).not.toContain('hunter')

  tools.get('u1')!.finish()
  await first
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('needs-you')
  tools.get('u2')!.finish()
  await second
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('idle')
})

test('the session\'s own turn end closes its permission prompts, and a subagent\'s prompt closes at that agent\'s end, not at a return of the session\'s own', async ($, on) => {
  const s = foremanSession(on)
  const tools = heldTools(on)
  await firstPrompt($, s.clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} } as never)
  await turnEnds($, 't1')
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('idle')

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'agent-9' } as never)
  await s.clock.settle()
  expect(s.statusAt()?.reason).toBe('A permission prompt for Bash in a subagent is waiting on the person.')
  const own = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' })
  await s.clock.settle()
  tools.get('u1')!.finish()
  await own
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('needs-you')

  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't-agent', reason: 'answer', agentId: 'agent-9' } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('idle')
})

test('the cleanup record counts the failed calls since the skill started and keeps the newest error\'s last line, withholding a secret', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'u0', error: 'before cleanup' } as never)
  await $.skill.prompt({ skill: 'cleanup', text: 'clean' } as never)
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'u1', error: 'first\nfatal: the worktree is dirty' } as never)
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'u2', error: 'git push\nerror: branch is checked out\n\n', agent_id: 'agent-1' } as never)
  await s.clock.settle()
  expect(s.statusAt()?.cleanup).toEqual({ failedCalls: 2, lastError: 'error: branch is checked out' })

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'u3', error: `remote: ghp_${'A'.repeat(36)} is not valid` } as never)
  await s.clock.settle()
  expect(s.statusAt()?.cleanup).toEqual({ failedCalls: 3, lastError: '(withheld: it looks like a secret)' })
})

test('a minute later the file is written again with a new write time and the same state time, and an event that changes nothing writes nothing', async ($, on) => {
  const s = foremanSession(on)
  const progressWrites = { count: 0 }
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'progress') progressWrites.count += 1
    return next(e)
  })
  await firstPrompt($, s.clock)
  await loose($)({ tool: PROGRESS, title: 'ABC-123 short issue name', stage: 'build' })
  await s.clock.settle()
  expect(s.writesOf()).toBe(2)

  // The same report again writes the builder state, which asks for the file
  // to be worked out again, but the record comes out as the one last written.
  const before = progressWrites.count
  await loose($)({ tool: PROGRESS, title: 'ABC-123 short issue name', stage: 'build' })
  await s.clock.settle()
  expect(progressWrites.count).toBe(before + 1)
  await s.clock.advance(MINUTE - 1000)
  expect(s.writesOf()).toBe(2)
  await s.clock.advance(1000)
  expect(s.writesOf()).toBe(3)
  expect(s.statusAt()).toMatchObject({ state: 'idle', stage: 'build', stateSince: S0, writtenAt: S0 + MINUTE })
})

test('a refused write is tried again at the next minute', async ($, on) => {
  const s = foremanSession(on)
  s.files.writes.refused = true
  await firstPrompt($, s.clock)
  expect(s.statusAt()).toBeUndefined()

  s.files.writes.refused = false
  await s.clock.advance(MINUTE)
  expect(s.statusAt()).toMatchObject({ state: 'idle', writtenAt: S0 + MINUTE })
})

test('after a merge the session\'s end deletes the file, and nothing is written after the end', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await watchUntilMerged($, s)
  const writes = s.writesOf()
  await endSession($, 'prompt_input_exit')
  await s.clock.advance(5 * MINUTE)

  expect(s.world.calls).toContain(`rm -f ${BUILD}`)
  expect(s.writesOf()).toBe(writes)
})

test('without a merge the session\'s end leaves the file in place', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await loose($)({ tool: 'mcp__builder__watch', number: 7 })
  await s.clock.settle()
  await endSession($, 'prompt_input_exit')

  expect(s.world.calls.filter(call => call.startsWith('rm '))).toEqual([])
  expect(s.statusAt()?.state).toBe('waiting-on-builder')
})

test('with one write held, two changes write once more after it, last, with the newest state', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  let release = () => {}
  s.files.writes.hold = new Promise(resolve => {
    release = resolve
  })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()
  await turnEnds($, 't1')
  await $.skill.prompt({ skill: 'cleanup', text: 'clean' } as never)
  await s.clock.settle()
  expect(s.writesOf()).toBe(2)

  release()
  await s.clock.settle()
  expect(s.writesOf()).toBe(3)
  expect(s.statusAt()?.state).toBe('in-cleanup')
})

test('after a /clear and a new session id, a first prompt with no ticket writes nothing', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  const writes = s.writesOf()
  await endSession($, 'clear')
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'Something new.', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'go', turnId: 't2' } as never)
  await s.clock.advance(5 * MINUTE)

  expect(s.writesOf()).toBe(writes)
  expect(s.files.writes.log.filter(path => path.includes('session-2'))).toEqual([])
})

test('after a /clear and a new session id, the new conversation\'s own ticket writes its own file and the old file is left alone', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  const oldWrites = s.writesOf()
  await endSession($, 'clear')
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'foreman-ticket: slot-2', origin: { kind: 'composer' } } as never)
  await s.clock.advance(5 * MINUTE)

  expect(s.statusAt('/home/me/.claude/foreman/builds/session-2.json')).toMatchObject({ sessionId: 'session-2', ticket: 'slot-2', state: 'idle' })
  expect(s.writesOf()).toBe(oldWrites)
})

test('a ticket with neither CLAUDE_CONFIG_DIR nor HOME set writes nothing', async ($, on) => {
  const s = foremanSession(on, { env: {} })
  await firstPrompt($, s.clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.advance(2 * MINUTE)

  expect(s.files.writes.log.filter(path => path.includes('/foreman/'))).toEqual([])
})

test('a call that returns with no permission prompt open, and a turn that starts with none, leave the memo unwritten', async ($, on) => {
  const s = foremanSession(on)
  const memos: string[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'statusMemo') memos.push(JSON.stringify(e.value))
    return next(e)
  })
  const tools = heldTools(on)
  await firstPrompt($, s.clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  const ran = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'ls' })
  await s.clock.settle()
  tools.get('u1')!.finish()
  await ran
  await turnEnds($, 't1')
  await s.clock.settle()

  // Each write of the memo after the first changes it: the ones the writer
  // makes when the state moves, and none from a change that changed nothing.
  expect(memos.length).toBeGreaterThan(1)
  expect(memos.filter((memo, i) => i > 0 && memo === memos[i - 1])).toEqual([])
})

test('after a merge, a write still held when the session ends is followed by a second rm once it lands', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await watchUntilMerged($, s)
  let release = () => {}
  s.files.writes.hold = new Promise(resolve => {
    release = resolve
  })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()
  const ended = endSession($, 'prompt_input_exit')
  await s.clock.advance(1000)
  await ended
  const rms = () => s.world.calls.filter(call => call === `rm -f ${BUILD}`).length
  expect(rms()).toBe(1)

  release()
  await s.clock.settle()
  expect(rms()).toBe(2)
})

test('after a resume and a new session id, a prompt with no ticket writes nothing', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  const writes = s.writesOf()
  await endSession($, 'resume')
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'Something new.', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'go', turnId: 't2' } as never)
  await s.clock.advance(5 * MINUTE)

  expect(s.writesOf()).toBe(writes)
  expect(s.files.writes.log.filter(path => path.includes('session-2'))).toEqual([])
})

test('after a resume and a new session id, the new conversation\'s own ticket writes its own file', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await endSession($, 'resume')
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'foreman-ticket: slot-2', origin: { kind: 'composer' } } as never)
  await s.clock.settle()

  expect(s.statusAt('/home/me/.claude/foreman/builds/session-2.json')).toMatchObject({ sessionId: 'session-2', ticket: 'slot-2', state: 'idle' })
})

test('after a /clear whose reset of the memo is refused, the new conversation\'s own ticket still writes its own file', async ($, on) => {
  const refusal = refusedWrites(on, 'statusMemo', value => value === null)
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  refusal.writes = 1
  await endSession($, 'clear')
  expect(refusal.refusals).toBe(1)
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'foreman-ticket: slot-2', origin: { kind: 'composer' } } as never)
  await s.clock.settle()

  expect(s.statusAt('/home/me/.claude/foreman/builds/session-2.json')).toMatchObject({ sessionId: 'session-2', ticket: 'slot-2', state: 'idle' })
})

test('a write that never settles is given up on after its timeout, and the next minute writes again', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  s.files.writes.hold = new Promise(() => {})
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()
  const writes = s.writesOf()
  expect(s.statusAt()?.writtenAt).toBe(S0)

  await s.clock.advance(31_000)
  await s.clock.advance(MINUTE)
  expect(s.writesOf()).toBeGreaterThan(writes)
  expect(s.statusAt()).toMatchObject({ state: 'working', writtenAt: S0 + MINUTE })
})

test('after a merge, a write whose read is held across the end of a session ended by /clear never writes once the read answers', async ($, on) => {
  // Holds the answer to the writer's last read of the state, the usage
  // hold's, so the writer has read the memo before the end resets it.
  const late = answerWaits(on, 'state.get', 'usageHold')
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await watchUntilMerged($, s)
  late.arm()
  await s.clock.advance(MINUTE)
  const writes = s.writesOf()
  const ended = endSession($, 'clear')
  await s.clock.advance(1000)
  await ended
  s.ids.current = 'session-2'
  expect(s.world.calls).toContain(`rm -f ${BUILD}`)

  late.release()
  await s.clock.settle()
  expect(s.writesOf()).toBe(writes)
})

test('after a merge, a write whose read is held across a /clear whose reset of the memo is refused never writes once the read answers', async ($, on) => {
  // The end's reset of the memo is refused, so the memo of the ended session
  // stays, with this copy's generation, and writing opens again once the
  // reset has failed. The writer's last read of the state, the usage hold's,
  // is held, so the writer has read the memo before the end. No new
  // conversation takes a memo up before the read answers, so only the end's
  // raise of this copy's generation keeps the writer from writing the old
  // file again.
  const refusal = refusedWrites(on, 'statusMemo', value => value === null)
  const late = answerWaits(on, 'state.get', 'usageHold')
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await watchUntilMerged($, s)
  late.arm()
  await s.clock.advance(MINUTE)
  const writes = s.writesOf()
  refusal.writes = 1
  const ended = endSession($, 'clear')
  await s.clock.advance(1000)
  await ended
  expect(refusal.refusals).toBe(1)
  expect(s.world.calls).toContain(`rm -f ${BUILD}`)
  s.ids.current = 'session-2'

  late.release()
  await s.clock.settle()
  expect(s.writesOf()).toBe(writes)
})

test('a hot reload takes the ticket from the memo without reading the transcript again, keeps the state\'s start time, and starts the minute\'s write again', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  expect(s.transcriptReads()).toBe(1)

  await s.clock.advance(MINUTE / 2)
  await reloads($, s.clock)
  await $.prompt.submit({ text: 'Carry on.', origin: { kind: 'composer' } } as never)
  await s.clock.settle()
  expect(s.transcriptReads()).toBe(1)
  expect(s.statusAt()).toMatchObject({ ticket: 'slot-1', state: 'idle', stateSince: S0, writtenAt: S0 + MINUTE / 2 })

  // The tick runs a minute after the reload, not a minute after the start.
  await s.clock.advance(MINUTE)
  expect(s.statusAt()).toMatchObject({ state: 'idle', stateSince: S0, writtenAt: S0 + (3 * MINUTE) / 2 })
})

test('a turn that starts closes a permission prompt raised while no turn ran, so the file reads working', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('needs-you')

  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ state: 'working', reason: 'The session\'s own turn is running.' })
})

test('a subagent\'s own tool call that returns closes the permission prompt that subagent raised', async ($, on) => {
  const s = foremanSession(on)
  // The agent is none of the mod's reviewers, so the fence lets its call run.
  on('agent.list', () => ({ value: [] }))
  const tools = heldTools(on)
  await firstPrompt($, s.clock)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'agent-9' } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('needs-you')

  const call = loose($)({ tool: 'Bash', tool_use_id: 'u1', command: 'ls', agentId: 'agent-9' })
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('needs-you')
  tools.get('u1')!.finish()
  await call
  await s.clock.settle()
  expect(s.statusAt()?.state).not.toBe('needs-you')
})

// Once `raise()` is called, every read of the memo answers with its
// generation one above the one stored, as the memo reads to a copy of the
// module from before a hot reload once the new copy has raised it. The kit
// runs one copy of the module, so this stands in for the new copy.
// `raiseAtRead(key)` raises it instead at the next read of the builder value
// `key`, once that read has answered. `writes` holds the value of every write
// of the memo after the raise.
function raisedMemo(on: On) {
  const memo = {
    isRaised: false,
    raiseAt: null as string | null,
    raise: () => { memo.isRaised = true },
    raiseAtRead: (key: string) => { memo.raiseAt = key },
    writes: [] as { state: string | null }[],
  }
  on('state.get', async ($, e, next) => {
    const answer = await next(e)
    if (e.plugin === 'builder' && e.key === memo.raiseAt) {
      memo.raiseAt = null
      memo.isRaised = true
    }
    if (!memo.isRaised || e.plugin !== 'builder' || e.key !== 'statusMemo') return answer
    const held = answer as { value: { value: { generation: number } | null; version: number } | null }
    if (held.value?.value == null) return answer
    return { value: { ...held.value, value: { ...held.value.value, generation: held.value.value.generation + 1 } } } as never
  })
  on('state.set', ($, e, next) => {
    if (memo.isRaised && e.plugin === 'builder' && e.key === 'statusMemo') memo.writes.push(e.value as { state: string | null })
    return next(e)
  })
  return memo
}

test('a writer that finds the memo raised to a newer generation while it read the state writes neither the file nor the memo', async ($, on) => {
  const memo = raisedMemo(on)
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  const writes = s.writesOf()

  // The memo is raised at the writer's last read of the state, the usage
  // hold's, after the writer has read the memo. The minute's tick writes
  // even when nothing changed, so only the raise can keep it from writing.
  memo.raiseAtRead('usageHold')
  await s.clock.advance(MINUTE)
  expect(memo.isRaised).toBe(true)
  expect(s.writesOf()).toBe(writes)
  expect(memo.writes).toEqual([])
})

test('a writer whose memo is raised to a newer generation while its write runs leaves the memo\'s state as it was', async ($, on) => {
  const memo = raisedMemo(on)
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  let release = () => {}
  s.files.writes.hold = new Promise(resolve => {
    release = resolve
  })
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await s.clock.settle()

  memo.raise()
  release()
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('working')
  expect(memo.writes.map(written => written.state).filter(state => state !== 'idle')).toEqual([])
})

test('a change to the memo made while a hot reload reads it survives the reload\'s raise of its generation', async ($, on) => {
  const late = answerWaits(on, 'state.get', 'statusMemo')
  const s = foremanSession(on)
  await firstPrompt($, s.clock)

  late.arm()
  const started = $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await s.clock.settle()
  const seen = late.seen
  await $.skill.prompt({ skill: 'cleanup', text: 'clean' } as never)
  await s.clock.settle()
  expect(late.seen).toBeGreaterThan(seen)

  late.release()
  await started
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('in-cleanup')
})

test('a new session id with no end of the old session, as after a /clear whose end was cut off, writes nothing for either id after prompts with no ticket', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  const writes = s.writesOf()
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'Something new.', origin: { kind: 'composer' } } as never)
  await s.clock.advance(5 * MINUTE)
  await $.prompt.submit({ text: 'Something else.', origin: { kind: 'composer' } } as never)
  await s.clock.advance(5 * MINUTE)

  expect(s.writesOf()).toBe(writes)
  expect(s.files.writes.log.filter(path => path.includes('session-2'))).toEqual([])
})

test('a new session id with no end of the old session, as after a /clear whose end was cut off, looks for the ticket again, so the new conversation\'s own ticket writes its own file', async ($, on) => {
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  const oldWrites = s.writesOf()
  s.ids.current = 'session-2'
  await $.prompt.submit({ text: 'foreman-ticket: slot-2', origin: { kind: 'composer' } } as never)
  await s.clock.advance(5 * MINUTE)

  expect(s.statusAt('/home/me/.claude/foreman/builds/session-2.json')).toMatchObject({ sessionId: 'session-2', ticket: 'slot-2', state: 'idle' })
  expect(s.writesOf()).toBe(oldWrites)
})

test('a session that takes its memo up at a prompt, with its own generation not the memo\'s and the reload\'s take-up refused, writes the file again', async ($, on) => {
  const refusal = refusedWrites(on, 'statusMemo')
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  // A hot reload that gets through takes the memo up under its own load
  // stamp, one above the first load's, since the clock has not moved.
  await reloads($, s.clock)
  // The kit runs one copy of the module, so a new copy, which starts with
  // its own generation at 0 and no ticket known, cannot be loaded. An end of
  // the session whose reset of the memo is refused stands in for one: it
  // forgets the ticket and leaves this copy's generation not the memo's,
  // while the memo stays this session's. The hot reload after it gets a load
  // stamp above the memo's generation, and then has its take-up of the memo
  // refused, as a failed start of the hooks would.
  refusal.writes = 1
  await endSession($, 'resume')
  refusal.writes = 1
  await reloads($, s.clock)
  expect(refusal.refusals).toBe(2)

  await s.clock.advance(MINUTE / 2)
  await $.prompt.submit({ text: 'Carry on.', origin: { kind: 'composer' } } as never)
  await s.clock.settle()
  expect(s.statusAt()).toMatchObject({ ticket: 'slot-1', writtenAt: S0 + MINUTE / 2 })
  await s.clock.advance(MINUTE)
  expect(s.statusAt()?.writtenAt).toBe(S0 + (3 * MINUTE) / 2)
})

test('a prompt that found no memo keeps the memo of this session that another prompt wrote while it looked, rather than write its own over it', async ($, on) => {
  const late = answerWaits(on, 'state.get', 'statusMemo')
  const s = foremanSession(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await s.clock.settle()

  // The first prompt's read of the memo answers that there is none and is
  // held, while a second prompt finds the ticket, writes the memo and moves
  // the state on.
  late.arm()
  const first = $.prompt.submit({ text: TICKETED, origin: { kind: 'composer' } } as never)
  await s.clock.settle()
  await $.prompt.submit({ text: TICKETED, origin: { kind: 'composer' } } as never)
  await s.clock.settle()
  await $.skill.prompt({ skill: 'cleanup', text: 'clean' } as never)
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('in-cleanup')

  late.release()
  await first
  await s.clock.settle()
  expect(s.statusAt()?.state).toBe('in-cleanup')
})

// Stands in for a newer copy of the module, one loaded after this copy, that
// owns the memo of session-1. The kit runs one copy of the module, so once
// `appear()` is called, every read of the memo answers the newer copy's memo,
// whose generation is one above this copy's load stamp, until the mod writes
// the memo. `holdNext()` makes the next read of the memo wait, with the
// answer it had when it was read, until `release()`. `writes` holds the value
// of every write of the memo after `appear()`.
function newerOwnersMemo(on: On) {
  const newer = {
    sessionId: 'session-1', ticket: 'slot-9', path: BUILD, cwd: '/repo', state: null, stateSince: 0,
    askedAt: null, prompts: [], cleanup: null, generation: S0 + 1,
  }
  let hasAppeared = false
  let isHeld = false
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const owner = {
    newer,
    writes: [] as { ticket: string | null; generation: number }[],
    appear: () => { hasAppeared = true },
    holdNext: () => { isHeld = true },
    release: () => release(),
  }
  let isSeeded = true
  on('state.get', async ($, e, next) => {
    if (e.plugin !== 'builder' || e.key !== 'statusMemo') return next(e)
    const answer = hasAppeared && isSeeded ? { value: { value: newer, version: 0 } } as never : await next(e)
    if (isHeld) {
      isHeld = false
      await gate
    }
    return answer
  })
  on('state.set', ($, e, next) => {
    if (hasAppeared && e.plugin === 'builder' && e.key === 'statusMemo') {
      isSeeded = false
      owner.writes.push(e.value as { ticket: string | null; generation: number })
    }
    return next(e)
  })
  return owner
}

test('a copy whose load stamp is lower than the memo\'s generation does not take the memo up, write the file, or change the stored generation', async ($, on) => {
  const owner = newerOwnersMemo(on)
  const s = foremanSession(on)
  // This copy loads first, with no memo stored, so its stamp is the time of
  // its load. A newer copy then owns the memo of this session.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await s.clock.settle()
  owner.appear()

  await $.prompt.submit({ text: TICKETED, origin: { kind: 'composer' } } as never)
  await s.clock.advance(5 * MINUTE)
  expect(s.files.writes.log.filter(path => path.includes('/foreman/'))).toEqual([])
  // The one write of the memo is this copy's take-up, which finds the memo
  // owned by the newer copy and writes it back exactly as it was.
  expect(owner.writes).toEqual([owner.newer])
  expect(s.transcriptReads()).toBe(0)
})

test('a prompt that found no memo does not write its own over the memo of this session that a newer copy wrote while it looked', async ($, on) => {
  const owner = newerOwnersMemo(on)
  const s = foremanSession(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  await s.clock.settle()

  // The prompt's read of the memo answers that there is none and is held,
  // while a newer copy writes the memo of this session.
  owner.holdNext()
  const first = $.prompt.submit({ text: TICKETED, origin: { kind: 'composer' } } as never)
  await s.clock.settle()
  owner.appear()
  owner.release()
  await first
  await s.clock.advance(5 * MINUTE)

  expect(s.transcriptReads()).toBe(1)
  expect(s.files.writes.log.filter(path => path.includes('/foreman/'))).toEqual([])
  // The one write of the memo is this copy's take-up, which finds the memo
  // owned by the newer copy and writes it back exactly as it was.
  expect(owner.writes).toEqual([owner.newer])
})

test('a hot reload whose clock has not moved past the memo\'s generation still takes the memo up under a larger generation', async ($, on) => {
  const generations: number[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'builder' && e.key === 'statusMemo') generations.push((e.value as { generation: number }).generation)
    return next(e)
  })
  const s = foremanSession(on)
  await firstPrompt($, s.clock)
  expect(generations.at(-1)).toBe(S0)

  // The clock is frozen, as for two loads in one millisecond.
  await reloads($, s.clock)
  expect(generations.at(-1)).toBe(S0 + 1)
  await reloads($, s.clock)
  expect(generations.at(-1)).toBe(S0 + 2)
})
