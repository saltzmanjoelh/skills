// The update of the linked checkout after a merge. Skills, agents and this
// mod load through links under ~/.claude into a repository's main checkout,
// so a session started a moment after a merge runs whatever that checkout
// holds. When a look first chooses the Merged step, the mod fast-forwards that
// checkout to the merge commit, once, and the Merged step states the outcome.
//
// The procedure is the one docs/specs/merged-updates-linked-checkout.md and
// docs/specs/linked-checkout-any-machine.md describe, with the same commands,
// checks and outcomes: find the links, match the merged repository, check the
// base, choose where to fetch from, fetch the merge commit and what it needs,
// check it is safe and fast-forward, and confirm. It never moves a checkout
// that is on another branch or has changes to tracked files, and it never
// forces, resets or retries, except once after a lock.
//
// Every command runs through `process.run` as an argument vector, never
// through a shell, with a time limit. The module imports only types from the
// engine, so a script can load it and run it against real repositories.

import type { EngineInterface } from 'claude-code'
import { isFullSha, SECRET_SHAPES } from './review'
import { isPlainRepo, listed, printable } from './text'

// What the update needs from the engine: commands, and the store for the
// record of each update.
export type LinkedIo = {
  process: Pick<EngineInterface['process'], 'run'>
  store: Pick<EngineInterface['store'], 'get' | 'set'>
}

// `home` is the HOME variable, read by the caller, and undefined when it is
// not set. `repo` is the merged repository as owner and name, `base` the
// branch the pull request merged into, and `merge` its merge commit.
export type LinkedInput = { home: string | undefined; repo: string; base: string; merge: string }

// A command's time limit, and the longer one for a fetch and for the
// fast-forward, which may download or write many files.
const COMMAND_MS = 20_000
const LONG_MS = 120_000
// Git prints its messages in English, so the lock failure can be spotted, and
// a fetch that would ask for a password fails at once instead of waiting
// until its time limit.
const GIT_ENV = { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }
// How much of a message from git or gh a sentence quotes.
const QUOTE_MAX = 300
// The batched fetch of what a partial clone lacks runs this many rounds at
// most.
const BATCH_ROUNDS = 3
// How many sentences an outcome may hold, which is also how many the Merged
// step accepts, and how many of the broken links and failed lookups it names
// one by one before it counts the rest.
export const LINKED_KEPT = 30
const PROBLEMS_SHOWN = 10

const OLD_CODE = 'New sessions will run the old code until someone updates it.'
const MAY_SHOW_AHEAD = 'the checkout may show ahead of its remote until its next fetch'

// The outcome of an update whose record says it started and holds no
// outcome, because the mod stopped in the middle of it.
export const STARTED_NOT_FINISHED = `Left alone: the update of the linked checkout for this merge started and did not finish, because the mod stopped in the middle of it, and the mod never runs an update twice. ${OLD_CODE}`

// ----- Cleaning what a sentence quotes -----

// Global copies of the secret shapes the review package checks for, so every
// match is removed rather than the first, together with credentials written
// into an address.
const SECRETS = SECRET_SHAPES.map(([, shape]) => new RegExp(shape.source, shape.flags.includes('g') ? shape.flags : `${shape.flags}g`))
const CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g
// A remote's address is never shown, whether it is a URL or the short ssh
// form `user@host:path`.
const ADDRESSES = [/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, /\b[\w.-]+@[\w.-]+:[^\s'"]+/g]

function withoutSecrets(text: string): string {
  let clean = text.replace(PRIVATE_KEY, '[a private key, removed]').replace(CREDENTIALS, '$1[removed]@')
  for (const shape of SECRETS) clean = clean.replace(shape, '[removed]')
  for (const shape of ADDRESSES) clean = clean.replace(shape, '[an address]')
  return clean
}

// A message from git or gh as a sentence quotes it: secrets and addresses
// removed, made printable on one line, and cut to 300 characters. Secrets
// are removed before the cut, so the cut cannot leave half of one behind,
// and once more after it.
export function quoted(message: string): string {
  return withoutSecrets(printable(withoutSecrets(message), QUOTE_MAX))
}

const quote = (message: string) => (message.trim() === '' ? '' : `: "${quoted(message)}"`)
// A path or a name from the file system or from git, made printable.
const shown = (text: string) => printable(text, QUOTE_MAX)

// ----- Running commands -----

type Ran = { ok: boolean; exitCode: number; stdout: string; message: string }

// A command's outcome. One that throws, because it could not start or ran
// past its time limit, or whose output was cut off, counts as failed.
async function run($: LinkedIo, argv: string[], options: { cwd?: string; stdin?: string; timeoutMs?: number } = {}): Promise<Ran> {
  try {
    const ran = await $.process.run(argv, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(argv[0] === 'git' ? { env: GIT_ENV } : {}),
      timeoutMs: options.timeoutMs ?? COMMAND_MS,
    })
    if (ran.isStdoutTruncated) return { ok: false, exitCode: ran.exitCode === 0 ? 1 : ran.exitCode, stdout: '', message: 'its output was cut off' }
    return { ok: ran.exitCode === 0, exitCode: ran.exitCode, stdout: ran.stdout, message: ran.stderr.trim() || ran.stdout.trim() }
  } catch {
    return { ok: false, exitCode: -1, stdout: '', message: 'the command could not start or ran past its time limit' }
  }
}

function gitIn($: LinkedIo, dir: string, args: string[], timeoutMs = COMMAND_MS, stdin?: string): Promise<Ran> {
  return run($, ['git', '-C', dir, ...args], { timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
}

const firstLine = (text: string) => text.split('\n')[0]!.trim()
// A branch name that is safe in a git argument: never an option or a range.
const isPlainBranch = (name: string) => name.length <= 200 && !name.startsWith('-') && !name.includes('..') && /^[A-Za-z0-9._/-]+$/.test(name)
const parentOf = (path: string) => {
  const trimmed = path.replace(/\/+$/, '')
  const at = trimmed.lastIndexOf('/')
  return at <= 0 ? '/' : trimmed.slice(0, at)
}
const unique = <T>(items: T[]) => [...new Set(items)]

// ----- Choosing the source -----

// Whether a remote's address names the repository: with trailing slashes and
// then a trailing `.git` removed, it ends in `/<owner>/<name>` or
// `:<owner>/<name>`, compared without regard to case. The slash or colon is
// part of the match, so a fork whose owner's name merely ends in the same
// letters does not match.
export function namesRepository(address: string, repo: string): boolean {
  const plain = address.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase()
  const name = repo.toLowerCase()
  return plain.endsWith(`/${name}`) || plain.endsWith(`:${name}`)
}

// The remote to fetch from among those whose address names the repository:
// the only one; among several, the one the base tracks, then `origin`, then
// the first in byte order; null when none does.
export function sourceOf(matching: string[], tracked: string | null): string | null {
  if (matching.length === 0) return null
  if (matching.length === 1) return matching[0]!
  if (tracked !== null && matching.includes(tracked)) return tracked
  if (matching.includes('origin')) return 'origin'
  return [...matching].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0]!
}

// ----- The sentences -----

const leftAlone = (path: string, reason: string) => `Left alone: the linked checkout ${shown(path)} was not updated, because ${reason}. ${OLD_CODE}`
const leftAloneAll = (reason: string) => `Left alone: no linked checkout was updated, because ${reason}. ${OLD_CODE}`

export function updatedLine(o: { path: string; merge: string; head: string | null; remote: string | null; isHeld: boolean; repo: string }): string {
  const held = o.isHeld ? `already held the merge commit ${o.merge}, so nothing needed to move` : `now holds the merge commit ${o.merge}`
  const head = o.head === null ? 'its HEAD could not be read' : `its HEAD is ${o.head}`
  const remote = o.remote === null ? '' : shown(o.remote)
  const source = o.remote !== null
    ? (o.isHeld ? `The fetch that refreshes its remote-tracking branch came from the remote ${remote}.` : `The fetch came from the remote ${remote}.`)
    : (o.isHeld
      ? `No remote of the checkout names ${o.repo}, so nothing was fetched because the checkout already held the merge, and ${MAY_SHOW_AHEAD}.`
      : `No remote of the checkout names ${o.repo}, so the fetch used the repository's https address, and ${MAY_SHOW_AHEAD}.`)
  return `Updated: the linked checkout ${shown(o.path)} ${held}, and ${head}. ${source}`
}

export function notLinkedLine(repo: string, home: string, names: string[]): string {
  const into = names.length === 0 ? 'no git checkout' : listed(names)
  return `Not linked: ${repo} merged, and the links under ${shown(home)}/.claude point into ${into}, none of which is ${repo}, so no checkout was moved.`
}

export function noLinksLine(folders: string[]): string[] {
  return [
    `No links found: none of ${listed(folders.map(shown))} is a link or holds one, so no checkout was updated.`,
    'If the skills or the mod load some other way, such as a plugin folder named in settings or with `--plugin-dir`, or a copy, this update moved nothing, so new sessions may run old code.',
  ]
}

export function onlyWorktreesLine(repo: string, trees: string[]): string {
  return `Only worktrees linked: every link into ${repo} lies in a worktree (${listed(trees.map(shown))}), so no link leads into the main checkout and it was not moved. Sessions loading through those worktrees still run the worktree's code.`
}

export function nothingToUpdateLine(repo: string, base: string): string {
  return `Nothing to update: the pull request merged into ${base}, which is not the default branch of ${repo}, so the main checkout stays on the default branch, which the merge did not touch.`
}

const worktreesLine = (repo: string, trees: string[]) =>
  `The links into ${listed(trees.map(shown))} lie in worktrees of ${repo}, which were not moved, so sessions loading through them still run the worktree's code.`

// ----- Step 1: finding the links -----

// A link and what was found at its end: the tree it lies in and the main
// checkout of that tree, or that it is broken, or that a lookup failed.
type Found =
  | { kind: 'linked'; link: string; tree: string; main: string }
  | { kind: 'broken'; link: string }
  | { kind: 'failed'; link: string; what: string; message: string }

// The links in ~/.claude/skills, agents and commands: a folder that is itself
// a link, and every link directly inside each folder. A target outside any
// git repository points into no checkout and is left out; `isAny` still says
// whether any link was found at all.
async function findLinks($: LinkedIo, folders: string[]): Promise<{ found: Found[]; isAny: boolean }> {
  const found: Found[] = []
  const targets: { link: string; target: string }[] = []
  for (const folder of folders) {
    // Without a trailing slash, since one would follow the link.
    if ((await run($, ['test', '-L', folder])).ok) {
      const real = await run($, ['realpath', folder])
      const target = firstLine(real.stdout)
      if (!real.ok || target === '') {
        found.push({ kind: 'broken', link: folder })
        continue
      }
      targets.push({ link: folder, target })
    } else if (!(await run($, ['test', '-d', folder])).ok) {
      continue
    }
    // The trailing slash makes `find` look inside a folder that is a link.
    const inside = await run($, ['find', `${folder}/`, '-mindepth', '1', '-maxdepth', '1', '-type', 'l', '-print0'])
    if (!inside.ok) {
      found.push({ kind: 'failed', link: folder, what: `the links inside ${shown(folder)} could not be listed`, message: inside.message })
      continue
    }
    for (const link of inside.stdout.split('\0').filter(path => path !== '')) {
      if (!(await run($, ['test', '-e', link])).ok) {
        found.push({ kind: 'broken', link })
        continue
      }
      const real = await run($, ['realpath', link])
      const target = firstLine(real.stdout)
      if (!real.ok || target === '') {
        found.push({ kind: 'failed', link, what: `the link ${shown(link)} could not be resolved`, message: real.message })
        continue
      }
      targets.push({ link, target })
    }
  }
  const isAny = found.length > 0 || targets.length > 0
  const trees = new Map<string, Promise<Ran>>()
  for (const { link, target } of targets) {
    // A link under agents points at a file, which counts by its folder.
    const dir = (await run($, ['test', '-d', target])).ok ? target : parentOf(target)
    if (!trees.has(dir)) trees.set(dir, gitIn($, dir, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel']))
    const parsed = await trees.get(dir)!
    if (!parsed.ok) {
      if (parsed.exitCode === 128 && /not a git repository/i.test(parsed.message)) continue
      found.push({ kind: 'failed', link, what: `the checkout that ${shown(link)} leads into could not be found`, message: parsed.message })
      continue
    }
    const [common, tree] = parsed.stdout.split('\n').map(line => line.trim())
    if (common === undefined || common === '' || tree === undefined || tree === '') {
      found.push({ kind: 'failed', link, what: `the checkout that ${shown(link)} leads into could not be found`, message: parsed.message })
      continue
    }
    // The main checkout is the parent of the shared git folder.
    found.push({ kind: 'linked', link, tree: tree.replace(/\/+$/, ''), main: parentOf(common) })
  }
  return { found, isAny }
}

// ----- Steps 2 to 7 -----

// Runs the whole update and answers its outcome as finished sentences. It
// never throws: an error of its own becomes a left-alone sentence.
export async function updateLinkedCheckout($: LinkedIo, input: LinkedInput): Promise<string[]> {
  try {
    return withinKept(await updateAll($, input))
  } catch {
    return [leftAloneAll('the mod met an error of its own while it ran the update')]
  }
}

// An outcome cut to the sentences the Merged step accepts, the last of them
// saying how many were left out. The broken links and failed lookups are
// already counted rather than listed past the first few (see shownProblems),
// so only an outcome for many checkouts of one repository reaches the cut.
export function withinKept(lines: string[]): string[] {
  if (lines.length <= LINKED_KEPT) return lines
  const kept = lines.slice(0, LINKED_KEPT - 1)
  return [...kept, `The outcome went on for ${lines.length - kept.length} more sentences, which are left out here.`]
}

type Problem = { short: string; sentence: string }

// The broken links and failed lookups as the outcome names them: the first
// few one by one, and the rest counted in one more, so that a folder of many
// broken links never pushes the rest of the outcome out of the step.
function shownProblems(problems: Problem[]): Problem[] {
  if (problems.length <= PROBLEMS_SHOWN) return problems
  const more = problems.length - PROBLEMS_SHOWN
  const what = `${more} more links were broken or could not be looked up`
  return [...problems.slice(0, PROBLEMS_SHOWN), { short: what, sentence: `Also, ${what}, and they are not listed here.` }]
}

async function updateAll($: LinkedIo, input: LinkedInput): Promise<string[]> {
  const { home, repo, base, merge } = input
  if (home === undefined || home === '') return [leftAloneAll('HOME is not set, so the links under ~/.claude could not be found')]
  if (!isPlainRepo(repo) || !isPlainBranch(base) || !isFullSha(merge)) {
    return [leftAloneAll('the repository, the base branch or the merge commit that GitHub gave is not safe to pass to git')]
  }
  const folders = ['skills', 'agents', 'commands'].map(name => `${home.replace(/\/+$/, '')}/.claude/${name}`)
  const { found, isAny } = await findLinks($, folders)
  if (!isAny) return noLinksLine(folders)

  // Step 2: look at each main checkout once, however many links lead into it.
  const linked = found.filter((f): f is Extract<Found, { kind: 'linked' }> => f.kind === 'linked')
  const names = new Map<string, string>()
  const problems: Problem[] = found.filter(f => f.kind !== 'linked').map(f => f.kind === 'broken'
    ? { short: `the link ${shown(f.link)} is broken`, sentence: `The link ${shown(f.link)} is broken, so whatever it pointed into was not looked at.` }
    : { short: `${f.what}${quote(f.message)}`, sentence: `Also, ${f.what}${quote(f.message)}.` })
  for (const main of unique(linked.map(f => f.main))) {
    const looked = await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: main })
    const name = firstLine(looked.stdout)
    if (!looked.ok || name === '') {
      const what = `the repository of ${shown(main)} could not be looked up${quote(looked.message)}`
      problems.push({ short: what, sentence: `Also, ${what}.` })
      continue
    }
    names.set(main, isPlainRepo(name) ? name : 'a repository whose name is not plain')
  }
  const named = shownProblems(problems)
  const matched = [...names].filter(([, name]) => name.toLowerCase() === repo.toLowerCase()).map(([main]) => main)
  if (matched.length === 0) {
    if (named.length > 0) return [leftAloneAll(`no linked checkout is ${repo}, and ${named.map(p => p.short).join('; ')}, which might have been it`)]
    return [notLinkedLine(repo, home, unique([...names.values()]))]
  }

  // A link whose tree is not the main checkout lies in a worktree, which is
  // someone's branch and is never moved.
  const isMatched = (f: { main: string }) => matched.includes(f.main)
  const worktrees = unique(linked.filter(f => isMatched(f) && f.tree !== f.main).map(f => f.tree))
  const toUpdate = matched.filter(main => linked.some(f => f.main === main && f.tree === main))
  const extras = [...(worktrees.length > 0 && toUpdate.length > 0 ? [worktreesLine(repo, worktrees)] : []), ...named.map(p => p.sentence)]
  if (toUpdate.length === 0) return [onlyWorktreesLine(repo, worktrees), ...extras]

  // Step 3: the repository's address and default branch, named so that gh
  // does not pick a repository from a checkout's remotes.
  const viewed = await run($, ['gh', 'repo', 'view', repo, '--json', 'url,defaultBranchRef'])
  const facts = repoFactsIn(viewed)
  if (facts === null) return [...toUpdate.map(main => leftAlone(main, `the default branch of ${repo} could not be read${quote(viewed.message)}`)), ...extras]
  if (facts.defaultBranch !== base) return [nothingToUpdateLine(repo, base), ...extras]
  const lines: string[] = []
  for (const main of toUpdate) lines.push(...await updateOne($, main, { repo, base, merge, url: facts.url }))
  return [...lines, ...extras]
}

function repoFactsIn(viewed: Ran): { url: string | null; defaultBranch: string } | null {
  if (!viewed.ok) return null
  try {
    const raw = JSON.parse(viewed.stdout) as { url?: unknown; defaultBranchRef?: { name?: unknown } | null }
    const name = raw.defaultBranchRef?.name
    if (typeof name !== 'string' || name === '') return null
    // The address is used only as an https address with no credentials in it.
    const url = typeof raw.url === 'string' && /^https:\/\/[^\s@]+$/.test(raw.url) ? raw.url : null
    return { url, defaultBranch: name }
  } catch {
    return null
  }
}

// Steps 3 to 7 for one main checkout of the merged repository.
async function updateOne($: LinkedIo, dir: string, o: { repo: string; base: string; merge: string; url: string | null }): Promise<string[]> {
  const { repo, base, merge } = o
  const extras: string[] = []

  // Step 3: whether anything needs to move.
  const branch = await gitIn($, dir, ['branch', '--show-current'])
  const isOnBase = branch.ok && firstLine(branch.stdout) === base
  const isHeld = isOnBase && (await gitIn($, dir, ['merge-base', '--is-ancestor', merge, 'HEAD'])).ok

  // Step 4: the source. A remote whose name starts with a dash could read as
  // an option, so it is never used.
  const remotes = await gitIn($, dir, ['remote'])
  if (!remotes.ok) return [leftAlone(dir, `its remotes could not be listed${quote(remotes.message)}`)]
  const matching: string[] = []
  for (const name of remotes.stdout.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('-'))) {
    const address = await gitIn($, dir, ['remote', 'get-url', name])
    if (address.ok && namesRepository(firstLine(address.stdout), repo)) matching.push(name)
  }
  let tracked: string | null = null
  if (matching.length > 1) {
    const read = await gitIn($, dir, ['config', `branch.${base}.remote`])
    tracked = read.ok ? firstLine(read.stdout) : null
  }
  const remote = sourceOf(matching, tracked)

  // Step 5: fetch. From a remote, the base comes along into its
  // remote-tracking branch, so the checkout does not show ahead of it.
  if (isHeld) {
    if (remote !== null) {
      const refreshed = await gitIn($, dir, ['fetch', '--no-write-fetch-head', remote, merge, `+refs/heads/${base}:refs/remotes/${remote}/${base}`], LONG_MS)
      if (!refreshed.ok) extras.push(`The fetch that refreshes the remote-tracking branch in ${shown(dir)} exited with an error${quote(refreshed.message)}, so ${MAY_SHOW_AHEAD}.`)
    }
    return [await headLine($, dir, { repo, merge, remote, isHeld: true }), ...extras]
  }
  if (remote === null && o.url === null) return [leftAlone(dir, `no remote names ${repo}, and GitHub gave no https address to fetch from`)]
  const source = remote ?? o.url!
  const fetched = remote !== null
    ? await gitIn($, dir, ['fetch', '--no-write-fetch-head', remote, merge, `+refs/heads/${base}:refs/remotes/${remote}/${base}`], LONG_MS)
    : await gitIn($, dir, ['fetch', '--no-write-fetch-head', source, merge], LONG_MS)
  // Whether the merge commit arrived decides, not how the fetch exited.
  if (!(await gitIn($, dir, ['cat-file', '-e', `${merge}^{commit}`])).ok) {
    return [leftAlone(dir, `the fetch did not bring the merge commit${quote(fetched.message)}`)]
  }
  if (!fetched.ok) extras.push(`The fetch in ${shown(dir)} exited with an error after the merge commit arrived${quote(fetched.message)}. The remote-tracking branch may not have moved, so ${MAY_SHOW_AHEAD}.`)
  const missing = await fetchMissing($, dir, merge, source)
  if (missing !== null) return [leftAlone(dir, missing)]

  // Step 6: check it is safe, and fast-forward, once more after a lock.
  for (let attempt = 1; ; attempt += 1) {
    const stopped = await stoppedBy($, dir, base)
    if (stopped !== null) return [leftAlone(dir, stopped)]
    const forwarded = await gitIn($, dir, ['merge', '--ff-only', '--no-overwrite-ignore', merge], LONG_MS)
    if (forwarded.ok) break
    if (attempt === 1 && forwarded.message.includes('index.lock')) continue
    return [leftAlone(dir, `the fast-forward refused${attempt > 1 ? ' after the one retry for a lock' : ''}${quote(forwarded.message)}`)]
  }

  // Step 7: confirm. A branch checked out in the instant around the
  // fast-forward may or may not have moved, so nothing is reset.
  const after = await gitIn($, dir, ['branch', '--show-current'])
  const now = firstLine(after.stdout)
  if (!after.ok || now !== base) {
    if (!after.ok || now === '') return [leftAlone(dir, 'the confirmation could not find it on the base branch'), ...extras]
    return [
      leftAlone(dir, `the confirmation found the branch ${shown(now)} checked out instead of ${base}`),
      `The fast-forward may or may not have moved ${shown(now)}: \`git -C ${shown(dir)} reflog -2 ${shown(now)}\` shows whether it did and, if so, from where. Nothing was reset.`,
      ...extras,
    ]
  }
  if (!(await gitIn($, dir, ['merge-base', '--is-ancestor', merge, 'HEAD'])).ok) {
    return [leftAlone(dir, 'the confirmation found that the merge commit is not an ancestor of its HEAD'), ...extras]
  }
  return [await headLine($, dir, { repo, merge, remote, isHeld: false }), ...extras]
}

// The updated sentence, with the checkout's HEAD as it is now.
async function headLine($: LinkedIo, dir: string, o: { repo: string; merge: string; remote: string | null; isHeld: boolean }): Promise<string> {
  const head = await gitIn($, dir, ['rev-parse', 'HEAD'])
  const sha = firstLine(head.stdout)
  return updatedLine({ path: dir, merge: o.merge, head: head.ok && isFullSha(sha) ? sha : null, remote: o.remote, isHeld: o.isHeld, repo: o.repo })
}

// What a partial clone lacks of the merge: the hashes of the missing objects
// the listing printed, and whether it succeeded.
async function missingOf($: LinkedIo, dir: string, mergeTree: string, headTree: string): Promise<{ ok: boolean; hashes: string[] }> {
  const ran = await gitIn($, dir, ['rev-list', '--objects', '--quiet', '--missing=print', mergeTree, '--not', headTree])
  const hashes = ran.stdout.split('\n').map(line => line.trim()).filter(line => line.startsWith('?')).map(line => line.slice(1)).filter(isFullSha)
  return { ok: ran.ok, hashes }
}

// Step 5's check that the merge commit arrived whole, with the batched fetch
// of what a partial clone lacks. Answers what stopped it, or null.
async function fetchMissing($: LinkedIo, dir: string, merge: string, source: string): Promise<string | null> {
  // The snapshots to compare are read from the commits, because a partial
  // clone may not hold the top folder itself.
  const mergeTree = firstLine((await gitIn($, dir, ['log', '-1', '--format=%T', merge])).stdout)
  const headTree = firstLine((await gitIn($, dir, ['log', '-1', '--format=%T', 'HEAD'])).stdout)
  if (!isFullSha(mergeTree) || !isFullSha(headTree)) return 'the snapshots of the merge commit and of its HEAD could not be read'
  let listing = await missingOf($, dir, mergeTree, headTree)
  // An empty listing that succeeded means nothing is missing, as in a full
  // clone, and the object check need not run.
  if (listing.ok && listing.hashes.length === 0) return null
  for (let round = 0; listing.ok && listing.hashes.length > 0 && round < BATCH_ROUNDS; round += 1) {
    // No `--filter`, which would record the source as a partial-clone source
    // in the checkout's settings; the setting given with -c applies to this
    // one fetch.
    await gitIn($, dir, ['-c', `remote.${source}.partialclonefilter=blob:none`, '-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '--no-write-fetch-head', '--no-tags', '--stdin', source], LONG_MS, `${listing.hashes.join('\n')}\n`)
    listing = await missingOf($, dir, mergeTree, headTree)
  }
  const check = await gitIn($, dir, ['rev-list', '--objects', '--quiet', '--missing=error', mergeTree, '--not', headTree])
  return check.ok ? null : `something the merge brings is still missing and could not be downloaded${quote(check.message)}`
}

// Step 6's checks: what stops the fast-forward, or null when it is safe.
// Untracked and ignored files do not stop it, because the fast-forward leaves
// them alone and refuses rather than overwrite one.
async function stoppedBy($: LinkedIo, dir: string, base: string): Promise<string | null> {
  const branch = await gitIn($, dir, ['branch', '--show-current'])
  if (!branch.ok) return `its branch could not be read${quote(branch.message)}`
  const current = firstLine(branch.stdout)
  if (current === '') return 'it has a detached HEAD, and someone may have it out'
  if (current !== base) return `it is on the branch ${shown(current)} rather than ${base}, and someone may have it out`
  const status = await gitIn($, dir, ['status', '--porcelain', '--untracked-files=no'])
  if (!status.ok) return `its status could not be read${quote(status.message)}`
  if (status.stdout.trim() !== '') return 'it has changes to tracked files, and someone may be working in it'
  return null
}

// ----- The record and the claim -----

export const LINKED_PREFIX = 'linked-checkout:'
export const linkedKey = (repo: string, number: number) => `${LINKED_PREFIX}${repo}#${number}`
// A record is pruned ninety days after its update started.
export const LINKED_KEPT_MS = 90 * 24 * 60 * 60_000

// The record of an update: the merge commit, when the update started, and
// its outcome once it ended.
export type LinkedRecord = { merge: string; at: number; lines?: string[] }

export function linkedRecordIn(raw: unknown): LinkedRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.merge !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  const lines = Array.isArray(r.lines) && r.lines.every(line => typeof line === 'string') ? r.lines as string[] : undefined
  return lines === undefined ? { merge: r.merge, at: r.at } : { merge: r.merge, at: r.at, lines }
}

// The updates running in this process, by key. The check and the claim
// follow each other with no await between, because the store has no
// compare-and-set, so only one look runs an update and every other look
// waits for its outcome.
const running = new Map<string, Promise<string[]>>()

// The outcome for one pull request's merge commit: the recorded one, or the
// update run now, once. The record of the start is written before any
// command runs, so a later look never runs it again; a record with no
// outcome reads as an update that started and did not finish.
export function linkedCheckout($: LinkedIo, key: string, input: LinkedInput & { now: number }): Promise<string[]> {
  const held = running.get(key)
  if (held !== undefined) return held
  const work = Promise.resolve().then(() => claimed($, key, input)).finally(() => { running.delete(key) })
  running.set(key, work)
  return work
}

async function claimed($: LinkedIo, key: string, input: LinkedInput & { now: number }): Promise<string[]> {
  try {
    const stored = await storedLines($, key)
    if (stored !== null) return stored
    await $.store.set(key, { merge: input.merge, at: input.now })
  } catch {
    return [leftAloneAll('the mod could not read or write the record of the update in its store')]
  }
  const { now, ...update } = input
  const lines = await updateLinkedCheckout($, update)
  try {
    await $.store.set(key, { merge: input.merge, at: now, lines })
  } catch {
    // The look still states the outcome; a later rendering reads the record
    // as an update that did not finish.
  }
  return lines
}

async function storedLines($: LinkedIo, key: string): Promise<string[] | null> {
  const raw = await $.store.get(key)
  if (raw === undefined || raw === null) return null
  return linkedRecordIn(raw)?.lines ?? [STARTED_NOT_FINISHED]
}

// The outcome as recorded, without running anything: the running update's
// when one runs in this process, the stored one, or null when there is no
// record. For a step text built from a stored snapshot rather than a look.
export async function recordedLinked($: LinkedIo, key: string): Promise<string[] | null> {
  const held = running.get(key)
  if (held !== undefined) return held
  try {
    return await storedLines($, key)
  } catch {
    return null
  }
}

// Whether a stored value under the record's prefix is due to be pruned.
export function isLinkedStale(raw: unknown, now: number): boolean {
  const record = linkedRecordIn(raw)
  return record === null || now - record.at > LINKED_KEPT_MS
}
