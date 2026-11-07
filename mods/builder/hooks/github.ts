// What the pull request says, read with one `gh pr view` and reduced to the
// few facts /implement decides on. Everything here is a pure function of the
// JSON gh printed, so the tests can feed it fixtures and the hooks can call it
// without touching the network.

import type { BaseFacts, BuildStatus, Check, CheckState, HeadRun, OtherReviewer, OutsideReviewer, OutsideState, Snapshot, Unpushed, Verdict, Verdicts, WorkflowRun } from '../types'

export type { BaseFacts, Check, CheckState, HeadRun, OtherReviewer, OutsideReviewer, OutsideState, Snapshot, Unpushed, Verdict, Verdicts, WorkflowRun }

// The JSON fields the snapshot reads, in the order gh is asked for them. The
// merge commit is read by the same request that reports the pull request
// merged, for the update of the linked checkout, and is never part of the
// snapshot or its fingerprint. The review requests tell an outside reviewer
// whose review is asked for now.
export const PR_FIELDS = 'number,url,state,headRefOid,labels,reviews,reviewRequests,statusCheckRollup,mergeable,commits,baseRefName,headRefName,createdAt,mergeCommit'

type GhCheck = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  completedAt?: string
  startedAt?: string
  createdAt?: string
}

type GhReview = {
  author?: { login?: string } | null
  state?: string
  body?: string
  commit?: { oid?: string } | null
  submittedAt?: string
  // The author's relation to the repository, which GitHub sets on its own
  // servers: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE and others.
  authorAssociation?: string
}

export type GhPullRequest = {
  number: number
  url: string
  state: string
  headRefOid: string
  labels?: { name: string }[]
  reviews?: GhReview[]
  // A request for a user carries their login. The mod leaves out by its type
  // any request that is not for a user, such as one for a team or a bot.
  // A request with no type counts as a request for a user, so that a reply
  // from an older gh, or one that leaves the type out, still asks the named
  // person rather than silently dropping a real request.
  reviewRequests?: { __typename?: string; login?: string }[]
  statusCheckRollup?: GhCheck[]
  mergeable?: string
  commits?: { oid: string; committedDate?: string }[]
  baseRefName?: string
  headRefName?: string
  createdAt?: string
  // Null until GitHub has merged the pull request.
  mergeCommit?: { oid?: string } | null
}

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

// Check and label names are written by whoever can push a workflow or edit
// labels, and they reach the session's prompt. Keep only plain characters,
// and only enough of them to recognise the name.
export function plainName(name: string): string {
  const plain = name.replace(/\s+/g, ' ').replace(/[^A-Za-z0-9 ._:/()#+-]/g, '').replace(/ +/g, ' ').trim().slice(0, 60)
  return plain === '' ? 'unnamed' : plain
}

export function checkOf(raw: GhCheck): Check {
  const name = plainName(raw.name ?? raw.context ?? 'unnamed check')
  if (raw.__typename === 'StatusContext' || raw.state !== undefined) {
    const state = raw.state ?? 'PENDING'
    if (state === 'PENDING' || state === 'EXPECTED') return { name, state: 'pending' }
    // gh asks GitHub for a commit status's createdAt but prints it as
    // startedAt, so startedAt is read first and createdAt is the fallback.
    return withTime({ name, state: state === 'SUCCESS' ? 'passed' : 'failed' }, raw.startedAt ?? raw.createdAt)
  }
  // A check run that is still running reports GitHub's zero time as its
  // completedAt, and it returns here before that time is read.
  if (raw.status !== 'COMPLETED') return { name, state: 'pending' }
  return withTime({ name, state: PASSING.has(raw.conclusion ?? '') ? 'passed' : 'failed' }, raw.completedAt)
}

// A check whose gh output carries no time is left without the key, so it
// compares and fingerprints exactly as checks did before times were read.
function withTime(check: Check, time: string | undefined): Check {
  return typeof time === 'string' && time !== '' ? { ...check, completedAt: time } : check
}

// GitHub promises no order for checks, and a rerun can appear as a second
// check with the same name beside the first. Checks are ordered by name, then
// by when they completed, then by state, so a reorder alone never changes the
// fingerprint. A check with no time comes after every check with one, because
// a run that has not completed is newer than any that has, so the last check
// of each name is its newest run. GitHub prints every time in one UTC form, so
// comparing the strings compares the times.
function compareChecks(a: Check, b: Check): number {
  if (a.name !== b.name) return a.name.localeCompare(b.name)
  if (a.completedAt !== b.completedAt) {
    if (a.completedAt === undefined) return 1
    if (b.completedAt === undefined) return -1
    return a.completedAt < b.completedAt ? -1 : 1
  }
  if (a.state !== b.state) return a.state < b.state ? -1 : 1
  return 0
}

// The one line of a verdict review the snapshot parses:
// `VERDICTS <sha8> spec=<APPROVE|REQUEST_CHANGES> adversarial=<APPROVE|REQUEST_CHANGES>`.
const VERDICTS_LINE = /^VERDICTS ([0-9a-f]{7,40}) spec=(APPROVE|REQUEST_CHANGES) adversarial=(APPROVE|REQUEST_CHANGES)\s*$/

export function verdictsOf(review: GhReview): Verdicts | null {
  const first = (review.body ?? '').split(/\r?\n/, 1)[0] ?? ''
  const match = VERDICTS_LINE.exec(first.trim())
  const sha = review.commit?.oid
  if (!match || !sha || !sha.startsWith(match[1] ?? '-')) return null
  return { sha, spec: match[2] as Verdict, adversarial: match[3] as Verdict }
}

// The second line of a record review of the /code-review pass, which the mod
// writes under the verdicts line: `CODE-REVIEW <sha8> since=<sha8>`,
// `CODE-REVIEW <sha8> since=base` or `CODE-REVIEW <sha8> waived`.
const CODE_REVIEW_LINE = /^CODE-REVIEW ([0-9a-f]{8}) (?:since=(?:[0-9a-f]{8}|base)|(waived))$/

// The record of a /code-review pass that a review holds: the review's full
// commit sha, and whether the person waived the pass there. The marker counts
// only on the second line, under a verdicts line that approves with both
// verdicts, and only when the review's commit is the head the marker names.
// The start of a later pass is taken from the commit sha rather than from the
// `since` text, so git is always given a full sha.
export type CodeReview = { sha: string; isWaiver: boolean }

export function codeReviewOf(review: GhReview): CodeReview | null {
  const verdicts = verdictsOf(review)
  if (verdicts === null || isChangesRequested(verdicts)) return null
  const second = (review.body ?? '').split(/\r?\n/, 2)[1] ?? ''
  const match = CODE_REVIEW_LINE.exec(second)
  if (!match || !verdicts.sha.startsWith(match[1] ?? '-')) return null
  return { sha: verdicts.sha, isWaiver: match[2] !== undefined }
}

export function isChangesRequested(verdicts: Verdicts) {
  return verdicts.spec === 'REQUEST_CHANGES' || verdicts.adversarial === 'REQUEST_CHANGES'
}

// The filter for `gh api --paginate "repos/<repo>/actions/runs?head_sha=<head>"`.
// It keeps every run, finished or not, and only the eight fields the snapshot
// and the step chooser read. gh prints each result as one compact JSON object
// per line when its output is not a terminal, and nothing for a head with no
// runs. It runs on each page alone, which is right because it keeps each run
// on its own.
export const RUNS_JQ = '.workflow_runs[] | {id, workflow_id, event, run_number, status, conclusion, run_attempt, name}'

// Every run in what the runs read printed, or null when any line is not a
// run, so a read that went wrong counts as a failed read. --paginate reads
// page by page, so a run queued while it reads can be listed twice; each id
// is kept once, at its highest attempt. A run without an attempt is on its
// first, and so is a run whose attempt is null, because jq writes a key the
// input lacks as null. A run without a status counts as unfinished, the side
// that never merges. The workflow, the event and the run number are null
// when they are missing, and such a run is never compared for replacement. A
// field that is present but of the wrong kind still makes the read fail.
export function headRunsOf(out: string): HeadRun[] | null {
  const byId = new Map<number, HeadRun>()
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return null
    }
    const run = headRunIn(raw)
    if (run === null) return null
    const seen = byId.get(run.id)
    if (seen !== undefined && seen.attempt >= run.attempt) continue
    byId.set(run.id, run)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

// One run as the runs filter prints it, or null when it is not one.
function headRunIn(raw: unknown): HeadRun | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const attempt = r.run_attempt ?? 1
  const workflow = r.workflow_id ?? null
  const number = r.run_number ?? null
  const event = r.event ?? null
  const status = r.status ?? null
  const conclusion = r.conclusion ?? null
  if (typeof r.id !== 'number' || typeof attempt !== 'number') return null
  if (workflow !== null && typeof workflow !== 'number') return null
  if (number !== null && typeof number !== 'number') return null
  if (event !== null && typeof event !== 'string') return null
  if (status !== null && typeof status !== 'string') return null
  if (conclusion !== null && typeof conclusion !== 'string') return null
  return {
    id: r.id, workflow, event, number, attempt,
    name: plainName(typeof r.name === 'string' ? r.name : 'unnamed run'),
    completed: status === 'completed',
    conclusion: conclusion === null ? null : conclusion.toLowerCase(),
  }
}

// The unfinished runs among every run at the head, the meaning the
// snapshot's `runs` keeps for the readers that wait on them.
export function unfinishedOf(headRuns: readonly HeadRun[]): WorkflowRun[] {
  return headRuns.filter(isUnfinished).map(run => ({ id: run.id, attempt: run.attempt, name: run.name }))
}

// The runs at the head a snapshot holds, with every entry that is not a run
// dropped, or null when the snapshot has none, as one an older build stored
// has not. The chooser and the fingerprint read the stored runs through
// this, so a damaged entry never throws in the middle of a look.
export function headRunsIn(s: Pick<Snapshot, 'headRuns'>): HeadRun[] | null {
  if (!Array.isArray(s.headRuns)) return null
  return s.headRuns.filter(isStoredRun)
}

function isStoredRun(value: unknown): value is HeadRun {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return typeof r.id === 'number' && typeof r.attempt === 'number' && typeof r.name === 'string' &&
    typeof r.completed === 'boolean' && (r.conclusion === null || typeof r.conclusion === 'string') &&
    (r.workflow === null || typeof r.workflow === 'number') && (r.number === null || typeof r.number === 'number') &&
    (r.event === null || typeof r.event === 'string') && (r.realWork === undefined || typeof r.realWork === 'boolean')
}

// The definitions /implement decides on for workflow runs. The step chooser
// and the fingerprint both read them, so the two can never disagree on which
// runs failed.

// A run is unfinished until its status is completed, whether it is queued,
// in progress, requested, waiting for an approval or pending in a
// concurrency group.
export function isUnfinished(run: HeadRun): boolean {
  return !run.completed
}

// A completed run failed when its conclusion is anything other than success,
// skipped or neutral, the conclusions a check passes with too. A completed run
// with no conclusion is not known to have passed, so it counts as failed.
export function hasFailed(run: HeadRun): boolean {
  return run.completed && !PASSING.has((run.conclusion ?? '').toUpperCase())
}

// A completed run did real work when its conclusion is not skipped and at
// least one of its jobs ended other than skipped. A run whose jobs were not
// read, or whose read failed or listed no jobs, did none.
export function didRealWork(run: HeadRun): boolean {
  return run.completed && run.conclusion !== 'skipped' && run.realWork === true
}

// Whether `newer` is a later run than `older` of the same workflow, started
// by the same event. Runs of one workflow from different events never
// compare, and neither does a run with a field GitHub left out.
function isLaterOfSameKind(newer: HeadRun, older: HeadRun): boolean {
  if (newer.workflow === null || newer.event === null || newer.number === null || older.number === null) return false
  return newer.workflow === older.workflow && newer.event === older.event && newer.number > older.number
}

// A run is replaced, and stops counting, when a later run of the same
// workflow and event has not completed or did real work. That holds whatever
// the older run ended as. A later run that did no real work replaces nothing
// and counts by its own conclusion, so a run that skipped every job counts as
// passed. A later run that has not completed replaces the older one only
// until it completes, and then this rule decides again.
export function isReplaced(run: HeadRun, all: readonly HeadRun[]): boolean {
  return all.some(other => isLaterOfSameKind(other, run) && (isUnfinished(other) || didRealWork(other)))
}

// The runs that count: every run at the head that no later run replaced.
export function countingRuns(all: readonly HeadRun[]): HeadRun[] {
  return all.filter(run => !isReplaced(run, all))
}

// The runs that count as failed at the head.
export function failedRunsOf(all: readonly HeadRun[]): HeadRun[] {
  return countingRuns(all).filter(hasFailed)
}

// Whether a run's jobs must be read to apply the rule above: only a
// completed run that is not skipped, with an earlier run of the same
// workflow and event, can replace anything by doing real work. A head with
// one run per workflow and event reads no jobs.
export function needsJobs(run: HeadRun, all: readonly HeadRun[]): boolean {
  return run.completed && run.conclusion !== 'skipped' && all.some(other => isLaterOfSameKind(run, other))
}

// The filter for `gh api --paginate "repos/<repo>/actions/runs/<id>/attempts/<attempt>/jobs"`,
// one compact JSON object per job, so output that is not jobs can be told
// from jobs.
export const JOBS_JQ = '.jobs[] | {conclusion}'

// Whether the jobs a jobs read printed include one that ended other than
// skipped, or null when any line is not a job, so the read counts as failed.
// A job with no conclusion has not ended, so it is not real work. An empty
// list did no real work.
export function realWorkOf(out: string): boolean | null {
  let isReal = false
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return null
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const conclusion = (raw as { conclusion?: unknown }).conclusion ?? null
    if (conclusion !== null && typeof conclusion !== 'string') return null
    if (conclusion !== null && conclusion.toLowerCase() !== 'skipped') isReal = true
  }
  return isReal
}

// The snapshot the mod last stored for the pull request, when it is of the
// same repository, number and head, and otherwise null. A look whose runs
// read failed keeps the runs of this snapshot and no other. `stored` is passed
// in unchecked, as the state holds it.
function sameHeadSnapshot(stored: unknown, repo: string, number: number, head: string): Snapshot | null {
  const s = snapshotIn(stored)
  return s !== null && s.repo === repo && s.number === number && s.head === head ? s : null
}

// The runs a look keeps when its runs read failed: those of the stored
// snapshot at the same head (see sameHeadSnapshot), and otherwise none. The
// fingerprint then never changes because a read failed.
export function carriedRuns(stored: unknown, repo: string, number: number, head: string): WorkflowRun[] {
  return sameHeadSnapshot(stored, repo, number, head)?.runs ?? []
}

// Every run at the head that a look keeps when its runs read failed, by the
// same rule as carriedRuns, so a failed read still shows the runs that had
// failed. A stored snapshot without them gives none.
export function carriedHeadRuns(stored: unknown, repo: string, number: number, head: string): HeadRun[] {
  const s = sameHeadSnapshot(stored, repo, number, head)
  return s === null ? [] : headRunsIn(s) ?? []
}

// The state in what `gh pr view <n> --json state` printed: OPEN, MERGED or
// CLOSED only when the JSON holds exactly one of those, and null for
// anything else, which is no output, text that is not JSON, a missing state or
// another state. It does not share snapshotOf's mapping, which reads an
// unknown state as open, because a caller of this one must treat an unknown
// state as not open.
export function pullRequestStateIn(out: string | null): Snapshot['state'] | null {
  if (out === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(out)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const state = (raw as { state?: unknown }).state
  return state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : null
}

// What a look read beside the pull request itself: every run at the head,
// whether the runs read failed so they were carried over, the facts of the
// base branch's CLAUDE.md, and, at a look that chose a merge step or the
// Merged step, the commits the worktree holds that the head lacks.
// It also carries the time of the look itself, which the step chooser
// measures a requested review's wait against.
export type SnapshotExtras = Pick<Snapshot, 'headRuns' | 'runsCarriedOver' | 'facts' | 'unpushed' | 'lookedAt'>

// The verdicts of every verdict review the session's own login posted, in the
// order GitHub lists the reviews. Only verdict reviews this login posted
// count: a review anyone else posts with the same first line is not one the
// session wrote.
export function sessionVerdictsOf(pr: Pick<GhPullRequest, 'reviews'>, login: string): Verdicts[] {
  return (pr.reviews ?? [])
    .filter(review => review.author?.login === login)
    .map(verdictsOf)
    .filter((verdicts): verdicts is Verdicts => verdicts !== null)
}

// The newest of the session's verdicts at the head, or null when it posted
// none there. These are the verdicts a snapshot holds.
export function headVerdictsOf(verdictReviews: readonly Verdicts[], head: string): Verdicts | null {
  return verdictReviews.filter(verdicts => verdicts.sha === head).at(-1) ?? null
}

// Whether both verdicts approve: there are verdicts, and neither requests
// changes.
export function bothApprove(verdicts: Verdicts | null): verdicts is Verdicts {
  return verdicts !== null && !isChangesRequested(verdicts)
}

// `requestTimes` holds when each reviewer's review was last requested, keyed by
// the login in lower case, as requestTimesOf reads it. A look that did not
// read them, or whose read failed, passes none.
export function snapshotOf(repo: string, pr: GhPullRequest, login: string, runs: WorkflowRun[] = [], extras: SnapshotExtras = {}, requestTimes: ReadonlyMap<string, string> = new Map()): Snapshot {
  const head = pr.headRefOid
  const commits = (pr.commits ?? []).map(commit => commit.oid)
  const verdictReviews = sessionVerdictsOf(pr, login)
  const changesRequested = verdictReviews.filter(isChangesRequested)
  const headsReviewed = new Set(verdictReviews.map(verdicts => verdicts.sha)).size
  const lastChangesRequested = changesRequested.at(-1)?.sha
  const pushesSinceVerdict = lastChangesRequested === undefined
    ? committedAfter(pr.createdAt, pr.commits ?? [])
    : pushesAfter(lastChangesRequested, commits)

  const snapshot: Omit<Snapshot, 'fingerprint'> = {
    repo,
    number: pr.number,
    url: pr.url,
    state: pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN',
    head,
    labels: (pr.labels ?? []).map(label => plainName(label.name)).sort(),
    mergeable: pr.mergeable === 'MERGEABLE' || pr.mergeable === 'CONFLICTING' ? pr.mergeable : 'UNKNOWN',
    checks: (pr.statusCheckRollup ?? []).map(checkOf).sort(compareChecks),
    verdicts: headVerdictsOf(verdictReviews, head),
    headsReviewed,
    pushesSinceVerdict,
    runs,
    ...extras,
  }
  // The record of the /code-review pass, read from the same reviews of this
  // login. Both fields are left out when they do not apply, so a snapshot
  // without them fingerprints as it did before the pass existed. The start
  // of the next pass is the newest pass, never a waiver, at a head that is
  // still one of the pull request's commits.
  const passes = (pr.reviews ?? [])
    .filter(review => review.author?.login === login)
    .map(codeReviewOf)
    .filter((pass): pass is CodeReview => pass !== null)
  if (passes.some(pass => pass.sha === head)) snapshot.codeReviewed = true
  const since = passes.filter(pass => !pass.isWaiver && commits.includes(pass.sha)).at(-1)?.sha
  if (since !== undefined) snapshot.codeReviewSince = since
  const named = extras.facts?.reviewers ?? []
  const newest = newestReviewsOf(pr, login)
  const outside = outsideOf(pr, login, named, newest, requestTimes)
  if (outside.length > 0) snapshot.outside = outside
  const others = othersOf(pr, login, named, newest, outside)
  if (others.length > 0) snapshot.others = others
  return { ...snapshot, fingerprint: fingerprintOf(snapshot) }
}

// A GitHub login: letters, digits and single hyphens, at most 39 characters,
// not starting or ending with a hyphen. A bot's login, which ends in `[bot]`,
// is not one, so bots are never outside reviewers. Only a login that passes
// is ever put into a step text.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

export function isLogin(value: unknown): value is string {
  return typeof value === 'string' && LOGIN.test(value)
}

// The associations that make a reviewer who is neither named nor requested
// an outside reviewer. GitHub sets them from the author's relation to the
// repository, so a GitHub app's automatic review, which carries CONTRIBUTOR,
// and a stranger's review on a public repository, which carries NONE, never
// hold the merge.
const HOLDING = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

// The review states that count as a submitted review. Only these four count,
// so a pending review, which is a draft nobody else can see yet, and any state
// GitHub may add later are both left out.
const STANDING = new Set(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED'])

// The newest review whose state is in STANDING of each reviewer other than
// the session's own login whose login passes isLogin, keyed by the login in
// lower case, because GitHub compares logins without regard to case.
type NewestReviews = Map<string, GhReview & { author: { login: string } }>

function newestReviewsOf(pr: Pick<GhPullRequest, 'reviews'>, login: string): NewestReviews {
  const self = login.toLowerCase()
  const newest: NewestReviews = new Map()
  for (const review of pr.reviews ?? []) {
    const author = review.author?.login
    if (!isLogin(author) || author.toLowerCase() === self) continue
    if (!STANDING.has(review.state ?? '')) continue
    const key = author.toLowerCase()
    const seen = newest.get(key)
    if (seen === undefined || (seen.submittedAt ?? '') <= (review.submittedAt ?? '')) newest.set(key, { ...review, author: { login: author } })
  }
  return newest
}

// The outside reviewers, who hold the merge until they approve, sorted by
// login: everyone other than the session's own login whom the `Reviewer:`
// fact names, whose review is requested now as a user, or whose newest
// review that is not pending carries OWNER, MEMBER or COLLABORATOR. The last
// rule keeps a requested reviewer holding the merge after they review,
// because GitHub removes them from the review requests when they submit.
// Which review requests count as requests for a user is said in the comment
// on GhPullRequest.reviewRequests, and how each reviewer's state is decided
// is said in the comment on outsideStateOf. The mod keeps the spelling GitHub
// gave where it gave one.
//
// The caller may pass the newest reviews it has already read from the same
// pull request, so they are read only once. A reviewer in the Requested state
// carries the time of their newest request from `requestTimes`, keyed by the
// login in lower case, when it holds one, and no other reviewer carries it.
export function outsideOf(
  pr: Pick<GhPullRequest, 'reviews' | 'reviewRequests'>,
  login: string,
  named: readonly string[],
  newest: NewestReviews = newestReviewsOf(pr, login),
  requestTimes: ReadonlyMap<string, string> = new Map(),
): OutsideReviewer[] {
  const self = login.toLowerCase()
  const isOutside = (name: unknown): name is string => isLogin(name) && name.toLowerCase() !== self
  const spelled = new Map<string, string>()
  for (const [key, review] of newest) {
    if (HOLDING.has(review.authorAssociation ?? '')) spelled.set(key, review.author.login)
  }
  const requested = requestedUsersOf(pr.reviewRequests, login)
  for (const [key, name] of requested) {
    if (!spelled.has(key)) spelled.set(key, newest.get(key)?.author.login ?? name)
  }
  for (const name of named) {
    const key = name.toLowerCase()
    if (isOutside(name) && !spelled.has(key)) spelled.set(key, newest.get(key)?.author.login ?? name)
  }
  return [...spelled.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, name]) => {
      const review = newest.get(key)
      const state = outsideStateOf(requested.has(key), review)
      const at = review?.submittedAt
      const reviewer: OutsideReviewer = typeof at === 'string' && at !== '' ? { login: name, state, at } : { login: name, state }
      const requestedAt = requestTimes.get(key)
      return state === 'requested' && requestedAt !== undefined ? { ...reviewer, requestedAt } : reviewer
    })
}

// The users whose review is requested now, other than the session's own
// login, keyed by the login in lower case, because GitHub compares logins
// without regard to case, with the login as GitHub spelled it. Which requests
// count as requests for a user is said in the comment on
// GhPullRequest.reviewRequests, and only a login that passes isLogin counts.
// outsideOf decides who is requested by it, and the look decides by it
// whether to read the request times, so the two never differ.
export function requestedUsersOf(requests: GhPullRequest['reviewRequests'], login: string): Map<string, string> {
  const self = login.toLowerCase()
  const users = new Map<string, string>()
  for (const request of requests ?? []) {
    if (request.__typename !== undefined && request.__typename !== 'User') continue
    if (!isLogin(request.login) || request.login.toLowerCase() === self) continue
    const key = request.login.toLowerCase()
    if (!users.has(key)) users.set(key, request.login)
  }
  return users
}

// The GraphQL query for the newest 100 review-request events in the pull
// request's timeline, with the login each was for. A request for a team has
// no login. GitHub keeps every request in the timeline, so the newest event
// for a login is when that reviewer was last asked.
export const REQUEST_TIMES_QUERY = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } } } } } }'

// When each reviewer's review was last requested, keyed by the login in lower
// case, from what the query above printed. Only the newest time for each login
// is kept, compared as times, so asking a reviewer again counts from the new
// request. An event whose login does not pass isLogin, or whose time cannot be
// read, is left out. Output that is missing, cannot be parsed or holds no list
// of events is a read that failed, and gives null, so the look can keep the
// times an earlier look read (see carriedRequestTimes).
export function requestTimesOf(out: string | null): Map<string, string> | null {
  if (out === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(out)
  } catch {
    return null
  }
  const nodes = (raw as { data?: { repository?: { pullRequest?: { timelineItems?: { nodes?: unknown } } } } } | null)
    ?.data?.repository?.pullRequest?.timelineItems?.nodes
  if (!Array.isArray(nodes)) return null
  const times = new Map<string, string>()
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const n = node as { createdAt?: unknown; requestedReviewer?: { login?: unknown } | null }
    const login = n.requestedReviewer?.login
    if (!isLogin(login) || typeof n.createdAt !== 'string' || Number.isNaN(Date.parse(n.createdAt))) continue
    const key = login.toLowerCase()
    const seen = times.get(key)
    if (seen === undefined || Date.parse(seen) < Date.parse(n.createdAt)) times.set(key, n.createdAt)
  }
  return times
}

// The request times a look keeps when its read of them failed: those the
// stored snapshot of the same pull request at the same head holds (see
// sameHeadSnapshot), keyed by the login in lower case, and otherwise none.
// The stored snapshot holds a time only for a reviewer who was requested at
// that look, and outsideOf attaches a kept time only to a reviewer who is
// still requested, so a reviewer whose time no look ever read gets no limit.
// The next read that succeeds replaces the kept times.
export function carriedRequestTimes(stored: unknown, repo: string, number: number, head: string): Map<string, string> {
  const times = new Map<string, string>()
  for (const r of sameHeadSnapshot(stored, repo, number, head)?.outside ?? []) {
    if (typeof r.requestedAt === 'string' && r.requestedAt !== '') times.set(r.login.toLowerCase(), r.requestedAt)
  }
  return times
}

// The time limits on a requested review. A reviewer still requested ten
// minutes after the request, while the pull request does not carry
// reviewer-working, has not picked the request up. A reviewer still requested
// two hours after the request, whether or not the label is on, has not given
// the review. The same limits apply to every outside reviewer, person or bot.
export const PICK_UP_MS = 10 * 60_000
export const ARRIVAL_MS = 2 * 60 * 60_000

// The requested reviewers past each limit at the look that made the snapshot,
// by login, in the order the snapshot lists them. A reviewer whose request
// time could not be read, and every reviewer of a snapshot that holds no time
// of its look, is in neither list, so no limit ever rests on a time that was
// not read. A reviewer past two hours is in the arrival list only, with the
// label on or off, because the stuck label that the two-hour step gives takes
// reviewer-working off, and the look after it must not then say the reviewer
// has not picked the request up.
export type Overdue = { arrival: string[]; pickUp: string[] }

export function overdueOf(s: Pick<Snapshot, 'outside' | 'labels' | 'lookedAt'>): Overdue {
  const overdue: Overdue = { arrival: [], pickUp: [] }
  const now = s.lookedAt
  if (typeof now !== 'number' || !Number.isFinite(now)) return overdue
  const isWorking = Array.isArray(s.labels) && s.labels.includes(WORKING_LABEL)
  for (const r of outsideIn(s.outside)) {
    if (r.state !== 'requested' || r.requestedAt === undefined) continue
    const asked = Date.parse(r.requestedAt)
    if (Number.isNaN(asked)) continue
    const waited = now - asked
    if (waited >= ARRIVAL_MS) overdue.arrival.push(r.login)
    else if (waited >= PICK_UP_MS && !isWorking) overdue.pickUp.push(r.login)
  }
  return overdue
}

// The facts a base branch's CLAUDE.md that could not be read gives, and a
// snapshot an older build stored, which has none. `Checks:` leans to
// expected, so a project that needs checks is never merged as if it had
// none, and the merge command is read by the session from the base itself.
export const UNREAD_FACTS: BaseFacts = { maxPushes: 8, maxRounds: 5, checks: 'expected', merge: 'unread', isClaudeRead: false }

// The facts a snapshot holds, or the unread ones when it holds none or does
// not say the file was read, as for any other damaged field.
export function factsOf(s: Pick<Snapshot, 'facts'>): BaseFacts {
  const f = s.facts as Partial<BaseFacts> | undefined
  if (typeof f !== 'object' || f === null) return UNREAD_FACTS
  const merge = f.merge === 'default' || f.merge === 'custom' ? f.merge : 'unread'
  if (f.isClaudeRead !== true) return UNREAD_FACTS
  const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
  return {
    maxPushes: isCount(f.maxPushes) ? f.maxPushes : UNREAD_FACTS.maxPushes,
    maxRounds: isCount(f.maxRounds) ? f.maxRounds : UNREAD_FACTS.maxRounds,
    checks: f.checks === 'none' ? 'none' : 'expected',
    merge,
    isClaudeRead: true,
  }
}

export type Limit = { which: 'pushes' | 'rounds'; count: number; max: number }

// The pushes and rounds limits the pull request is past, read from the facts
// the snapshot holds. The step chooser names the over-limit step when any is
// passed, and the overdue guard below reads the same list, so the two never
// parse the facts apart.
export function limitsPassedIn(s: Pick<Snapshot, 'facts' | 'pushesSinceVerdict' | 'headsReviewed' | 'verdicts'>): Limit[] {
  const facts = factsOf(s)
  const limits: Limit[] = []
  if (s.pushesSinceVerdict > facts.maxPushes) limits.push({ which: 'pushes', count: s.pushesSinceVerdict, max: facts.maxPushes })
  const round = roundInProgress(s)
  if (round > facts.maxRounds) limits.push({ which: 'rounds', count: round, max: facts.maxRounds })
  return limits
}

// The requested reviewers past each limit, counted only where the step
// chooser can reach the two limit steps: the pull request is past no pushes
// or rounds limit, both verdicts approve at the head, the /code-review pass is
// recorded there, the pull request does not conflict, no check or run at the
// head failed, and no outside reviewer has feedback or lacks a request, since
// chooseStep names each of those steps first. Anywhere else both lists are
// empty, so crossing a limit while another step applies starts no turn, and
// the look at which a limit step first applies is handed over as a change.
// The open question is left out, because a change during a question is held
// until the turn that asks it ends, and that turn settles the question. The
// fingerprint and the change sentences both read the lists through it, so a
// sentence is written exactly when that part of the fingerprint moves.
export function overdueAtLimitStep(s: Omit<Snapshot, 'fingerprint'>): Overdue {
  const none: Overdue = { arrival: [], pickUp: [] }
  if (limitsPassedIn(s).length > 0) return none
  if (!bothApprove(s.verdicts) || s.codeReviewed !== true || s.mergeable === 'CONFLICTING') return none
  if (failedCheckNames(s.checks).length > 0 || failedRunsOf(headRunsIn(s) ?? []).length > 0) return none
  if (outsideIn(s.outside).some(r => r.state === 'feedback' || r.state === 'unrequested')) return none
  return overdueOf(s)
}

// Every state an outside reviewer can be in, in the order OutsideState lists
// them. The line after the list stops the type check when the list and
// OutsideState differ in either direction.
const OUTSIDE_STATES = ['requested', 'approved', 'feedback', 'unrequested'] as const
const OUTSIDE_STATES_MATCH_THE_TYPE: [(typeof OUTSIDE_STATES)[number], OutsideState] extends [OutsideState, (typeof OUTSIDE_STATES)[number]] ? true : never = true
void OUTSIDE_STATES_MATCH_THE_TYPE

// An outside reviewer's state, decided in the order OutsideState lists where
// the rules allow: a request first, because GitHub clears a request when the
// reviewer submits and sets it again when they are asked again; then a
// missing or dismissed newest review, which counts as no review, so the
// reviewer is unrequested and is asked again; then an approval; and any
// other newest review is feedback.
function outsideStateOf(isRequested: boolean, review: GhReview | undefined): OutsideState {
  if (isRequested) return 'requested'
  if (review === undefined || review.state === 'DISMISSED') return 'unrequested'
  if (review.state === 'APPROVED') return 'approved'
  return 'feedback'
}

// The other reviewers, sorted by login: everyone other than the session's own
// login who reviewed and is not an outside reviewer, whose newest review that
// is not pending comments or requests changes, with that review's time. The
// merge never waits for them and nobody asks them again, because a review
// request to them fails, but their review wakes the session and the steps
// send it to their comments before it merges. snapshotOf passes the newest
// reviews and the outside reviewers it has already worked out, so this only
// filters them; a caller that passes neither has them worked out here.
export function othersOf(
  pr: Pick<GhPullRequest, 'reviews' | 'reviewRequests'>,
  login: string,
  named: readonly string[],
  newest: NewestReviews = newestReviewsOf(pr, login),
  outsideReviewers: readonly OutsideReviewer[] = outsideOf(pr, login, named, newest),
): OtherReviewer[] {
  const outside = new Set(outsideReviewers.map(r => r.login.toLowerCase()))
  return [...newest.entries()]
    .filter(([key, review]) => !outside.has(key) && (review.state === 'COMMENTED' || review.state === 'CHANGES_REQUESTED'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, review]) => {
      const at = review.submittedAt
      return typeof at === 'string' && at !== '' ? { login: review.author.login, at } : { login: review.author.login }
    })
}

function pushesAfter(sha: string, commits: readonly string[]): number {
  const at = commits.indexOf(sha)
  // A verdict on a commit the branch no longer holds (a force push) leaves
  // every commit on the branch unreviewed.
  if (at === -1) return commits.length
  return commits.length - at - 1
}

// Before the first changes-requested verdict, the pushes are the commits
// committed after the pull request was opened. Commit dates only approximate
// when a commit was pushed, which is close enough for a limit. A commit whose
// date is missing or cannot be read counts, the side that stops sooner. With
// no opening time to compare against, as in a pull request read by an older
// build, nothing counts, as before.
function committedAfter(createdAt: string | undefined, commits: readonly { committedDate?: string }[]): number {
  const opened = Date.parse(createdAt ?? '')
  if (Number.isNaN(opened)) return 0
  return commits.filter(commit => {
    const at = Date.parse(commit.committedDate ?? '')
    return Number.isNaN(at) || at > opened
  }).length
}

// The label the mod puts on the pull request while the owner is asked a
// question, and takes off once the question is answered.
export const DECISION_LABEL = 'needs-decision'

// The label an automated outside reviewer puts on the pull request when it
// picks a review request up. It is not a state label: it sits beside them and
// never replaces waiting-on-reviewer. The mod reads it at every look, creates
// it when the session asks for an outside review and the repository lacks it,
// and takes it off when it sets any state label other than
// waiting-on-reviewer, so a reviewer that forgets cannot leave it behind.
export const WORKING_LABEL = 'reviewer-working'

// The state labels /implement moves between. The pull request carries one of
// them at a time, and the session never edits them itself. The mod sets the
// one that follows from the step it chose, and it sets `stuck` when the
// session judges the pull request stuck and calls `mcp__builder__set_stuck`.
// That tool records the judgement with the label that followed from the step,
// and the mod keeps `stuck` on until the label that follows from the step
// changes.
export const STATE_LABELS = ['in-review', 'waiting-on-author', 'waiting-on-reviewer', 'ready-to-merge', 'stuck'] as const
export type StateLabel = typeof STATE_LABELS[number]

// The labels the workflow sets on the pull request itself: the state labels,
// the mod's own decision label, and the label a reviewer puts on when it
// picks a request up. A change to them is the mod's or the
// session's own doing, or a person's by hand, and /implement never decides
// from them, so it is not news to hand the session. The snapshot still keeps
// them, because the poll interval and the pane read them.
export const WORKFLOW_LABELS: ReadonlySet<string> = new Set([...STATE_LABELS, DECISION_LABEL, WORKING_LABEL])

// The labels that count as a change to the pull request: every label but the
// workflow's own.
export function countedLabels(labels: readonly string[]): string[] {
  return labels.filter(label => !WORKFLOW_LABELS.has(label))
}

// Two snapshots with the same fingerprint need nothing new from the session.
// GitHub reports mergeable as UNKNOWN while it recomputes, so only a conflict
// counts: a flip between mergeable and unknown is not news. Each check name
// is in it by its newest run only, so GitHub listing or dropping an old run
// that a rerun replaced is not news either. That run's completion time is in
// it when completing again in its state is news, so a check that fails again
// is a change to hand over, and a check that passes again, as it passed
// before, is not. The workflow's own labels are left out of it. Each
// unfinished run is in it by its id and attempt alone, so a run appearing,
// rerun or completing is news, and a move between unfinished statuses, such
// as queued to in progress, is not. Two parts are added only when they
// apply, so a snapshot without them fingerprints as it did before they
// existed. One says the runs could not be read while both verdicts approve
// at the head, where the step chooser holds the merge on it, so the first
// look that reads them again is news and the session is woken to merge. At
// any other step a failed read changes nothing the session decides on, so it
// is not news there, as it never was. The other names the runs that count as
// failed, by id and attempt, because a run that fails before any job starts
// creates no check, and one that starts and fails between two looks changes
// nothing else here. The parts are a fixed list of fields, so the commits a
// worktree holds that the head lacks, which a look lists only at a merge step
// or the Merged step, are never news and never wake the session.
export function fingerprintOf(s: Omit<Snapshot, 'fingerprint'>): string {
  const verdicts = s.verdicts ? `${s.verdicts.spec}/${s.verdicts.adversarial}@${s.verdicts.sha.slice(0, 8)}` : 'none'
  const parts = [
    s.state,
    s.head.slice(0, 12),
    countedLabels(s.labels).join(','),
    verdicts,
    [...newestRuns(s.checks).values()].map(checkPartOf).join(','),
    s.mergeable === 'CONFLICTING' ? 'conflicting' : 'no-conflict',
    (s.runs ?? []).map(run => `${run.id}.${run.attempt}`).join(','),
  ]
  if (s.runsCarriedOver === true && s.verdicts !== null && !isChangesRequested(s.verdicts)) parts.push('runs-unread')
  // The same holds for a user CLAUDE.md that could not be read while the base
  // branch's names no reviewer: the step chooser holds the merge on it once
  // both verdicts approve, so the first look that reads the file is news.
  if (s.facts?.reviewersUnknown === true && s.verdicts !== null && !isChangesRequested(s.verdicts)) parts.push('reviewers-unknown')
  // A record of the /code-review pass at the head, or of a waiver, moves the
  // step on, so it is news. The start of the next pass changes nothing the
  // session decides on at this head, so it is not part of the fingerprint.
  if (s.codeReviewed === true) parts.push('code-reviewed')
  const failed = failedRunsOf(headRunsIn(s) ?? [])
  if (failed.length > 0) parts.push(`failed-runs:${failed.map(run => `${run.id}.${run.attempt}`).join(',')}`)
  // The outside reviewers, added only when there are any, so a solo project's
  // snapshot fingerprints as it did before they were read. A review
  // submitted, a request made or withdrawn, and a newer review in the same
  // state are all news.
  const outside = outsideIn(s.outside)
  if (outside.length > 0) parts.push(`outside:${outside.map(r => `${r.login.toLowerCase()}=${r.state}@${r.at ?? ''}`).join(',')}`)
  // The other reviewers with comments, under the same rule: a review of
  // theirs arriving, or a newer one, is news.
  const others = othersIn(s.others)
  if (others.length > 0) parts.push(`others:${others.map(r => `${r.login.toLowerCase()}@${r.at ?? ''}`).join(',')}`)
  // The requested reviewers past a time limit, added only where the step
  // chooser can name a limit step for them (see overdueAtLimitStep), and only
  // when there are any. So crossing the ten-minute limit is
  // news, and crossing the two-hour limit is news again even when the person
  // said to keep waiting at ten minutes. The request time itself stays out, so
  // a reviewer asked again starts no turn until a limit passes again.
  const overdue = overdueAtLimitStep(s)
  if (overdue.arrival.length > 0 || overdue.pickUp.length > 0) {
    const logins = (list: readonly string[]) => list.map(login => login.toLowerCase()).join(',')
    parts.push(`overdue:${logins(overdue.arrival)}/${logins(overdue.pickUp)}`)
  }
  return parts.join('|')
}

// A check's part of the fingerprint: its name and state, with its completion
// time added only when it has one and completing again in its state is news.
function checkPartOf(check: Check): string {
  const part = `${check.name}:${check.state}`
  if (check.completedAt === undefined) return part
  if (!isRepeatNews(check.state)) return part
  return `${part}@${check.completedAt}`
}

// A snapshot read back from the store or from the state, or null when it
// lacks a field that fingerprintOf and changesBetween read. A value an older
// build saved in another shape then counts as no snapshot rather than
// throwing in the middle of a look.
export function snapshotIn(value: unknown): Snapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const s = value as Record<string, unknown>
  if (typeof s.head !== 'string' || typeof s.state !== 'string') return null
  if (!Array.isArray(s.labels) || !Array.isArray(s.checks)) return null
  // A snapshot an older build stored has no runs, which every reader takes
  // as none; a runs field that is there must be a list.
  if (s.runs !== undefined && !Array.isArray(s.runs)) return null
  // The same holds for every run at the head, which an older build did not
  // store either.
  if (s.headRuns !== undefined && !Array.isArray(s.headRuns)) return null
  const verdicts = s.verdicts as { sha?: unknown } | null | undefined
  if (verdicts !== null && (typeof verdicts !== 'object' || typeof verdicts.sha !== 'string')) return null
  return value as Snapshot
}

// Whether two snapshots need nothing new from the session. Both fingerprints
// are worked out again from the snapshots' fields with the rule above, and
// the fingerprint a snapshot carries is never read, because a record an older
// build stored carries a fingerprint made by an older rule, which would make
// an unchanged pull request compare as changed. No snapshot on both sides is
// the same; no snapshot on one side is not. A value of an older shape, such
// as a pane snapshot or a told record an older build saved, fails snapshotIn
// and so counts as different rather than throwing, which lets a caller pass
// a stored value straight in without checking it first.
export function isSameState(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true
  const one = snapshotIn(a)
  const other = snapshotIn(b)
  if (one === null || other === null) return false
  return fingerprintOf(one) === fingerprintOf(other)
}

// The checks' overall state, the same words the status file for the foreman
// writes, so the two cannot drift apart.
export type CiState = NonNullable<BuildStatus['pr']>['checks']

// Each check name is judged by its newest run, so a passing rerun that GitHub
// lists beside the old failed run it replaced reads as passed.
export function ciOf(checks: readonly Check[]): CiState {
  if (checks.length === 0) return 'none'
  const newest = [...newestRuns(checks).values()]
  if (newest.some(check => check.state === 'failed')) return 'failed'
  if (newest.some(check => check.state === 'pending')) return 'pending'
  return 'passed'
}

// The names whose newest run failed, which are the failures ciOf counts. The
// state lines and the pane list these, so they never name a failure that a
// rerun has already replaced.
export function failedCheckNames(checks: readonly Check[]): string[] {
  return [...newestRuns(checks).values()].filter(check => check.state === 'failed').map(check => check.name)
}

// Plain sentences naming what moved between two snapshots, for the prompt
// that wakes the session. The first snapshot of a run has nothing to compare.
export function changesBetween(before: Snapshot | null, after: Snapshot): string[] {
  if (before === null) return ['The mod has no record of what the session was last told about this pull request.']
  const changes: string[] = []
  if (before.state !== after.state) changes.push(`The pull request is now ${after.state.toLowerCase()}.`)
  if (before.head !== after.head) changes.push(`The head moved from ${before.head.slice(0, 8)} to ${after.head.slice(0, 8)}.`)
  const ciBefore = ciOf(before.checks)
  const ciAfter = ciOf(after.checks)
  if (ciBefore !== ciAfter) changes.push(`The checks went from ${ciBefore} to ${ciAfter}.`)
  changes.push(...checkSentences(before.checks, after.checks, before.head !== after.head))
  // At a new head the runs are new runs on a new commit, and the head-moved
  // sentence already says so.
  if (before.head === after.head) {
    changes.push(...runSentences(before.runs ?? [], after.runs ?? []))
    changes.push(...failedRunSentences(before, after))
  }
  if (before.runsCarriedOver !== true && after.runsCarriedOver === true) {
    changes.push('The workflow runs at the head could not be read.')
  }
  if (before.runsCarriedOver === true && after.runsCarriedOver !== true) {
    changes.push('The workflow runs at the head could be read again.')
  }
  const unknownBefore = before.facts?.reviewersUnknown === true
  if (unknownBefore !== (after.facts?.reviewersUnknown === true)) {
    changes.push(unknownBefore
      ? 'The CLAUDE.md in the user\'s Claude configuration folder could be read again.'
      : 'The CLAUDE.md in the user\'s Claude configuration folder could not be read.')
  }
  const conflictBefore = before.mergeable === 'CONFLICTING'
  if (conflictBefore !== (after.mergeable === 'CONFLICTING')) {
    changes.push(conflictBefore ? 'The merge conflict is gone.' : 'The pull request now has a merge conflict with its base.')
  }
  // The workflow's own labels are left out on both sides, as they are from
  // the fingerprint.
  const labelsBefore = countedLabels(before.labels)
  const labelsAfter = countedLabels(after.labels)
  const hadBefore = new Set(labelsBefore)
  const hasAfter = new Set(labelsAfter)
  const added = labelsAfter.filter(label => !hadBefore.has(label))
  const removed = labelsBefore.filter(label => !hasAfter.has(label))
  if (added.length > 0) changes.push(`Labels added: ${quoted(added)}.`)
  if (removed.length > 0) changes.push(`Labels removed: ${quoted(removed)}.`)
  changes.push(...outsideSentences(outsideIn(before.outside), outsideIn(after.outside)))
  changes.push(...overdueSentences(before, after))
  changes.push(...otherSentences(othersIn(before.others), othersIn(after.others)))
  if (JSON.stringify(before.verdicts) !== JSON.stringify(after.verdicts)) {
    changes.push(after.verdicts
      ? `A verdict review is posted at the head: spec ${after.verdicts.spec}, adversarial ${after.verdicts.adversarial}.`
      : 'The head has no verdict review yet.')
  }
  if (before.head === after.head && before.codeReviewed !== true && after.codeReviewed === true) {
    changes.push('A record of the /code-review pass, or of the person\'s waiver of it, is posted at the head.')
  }
  // Something the fingerprint covers moved without changing a field named
  // above; never hand over a change with nothing in it.
  if (changes.length === 0) changes.push('The pull request changed in a way the lines below show.')
  return changes
}

// The outside reviewers a stored snapshot holds, keeping only entries of the
// right shape, with a login that passes isLogin, so a value an older build
// saved or a damaged one never reaches a step text.
export function outsideIn(raw: unknown): OutsideReviewer[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const r = entry as Record<string, unknown>
    const state = OUTSIDE_STATES.find(s => s === r.state)
    if (!isLogin(r.login) || state === undefined) return []
    const reviewer: OutsideReviewer = typeof r.at === 'string' && r.at !== '' ? { login: r.login, state, at: r.at } : { login: r.login, state }
    // The request time is kept, because the label job and the set_stuck tool
    // choose the step again from the stored snapshot and must agree with the
    // look that stored it.
    return typeof r.requestedAt === 'string' && r.requestedAt !== '' ? [{ ...reviewer, requestedAt: r.requestedAt }] : [reviewer]
  })
}

// The other reviewers a stored snapshot holds, under the same rule as
// outsideIn: an entry whose time is missing, empty or not a string is kept
// without it, because the time only feeds the fingerprint, and dropping the
// entry would remove a reviewer from the step texts.
export function othersIn(raw: unknown): OtherReviewer[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const r = entry as Record<string, unknown>
    if (!isLogin(r.login)) return []
    return typeof r.at === 'string' && r.at !== '' ? [{ login: r.login, at: r.at }] : [{ login: r.login }]
  })
}

// One sentence per outside reviewer whose state or newest review moved, and
// one per reviewer who left the list: a request withdrawn from someone the
// fact does not name and who has no review that keeps them on it.
function outsideSentences(before: readonly OutsideReviewer[], after: readonly OutsideReviewer[]): string[] {
  const was = new Map(before.map(r => [r.login.toLowerCase(), r]))
  const still = new Set(after.map(r => r.login.toLowerCase()))
  const sentences: string[] = []
  for (const r of before) {
    if (!still.has(r.login.toLowerCase())) sentences.push(`${r.login} is no longer an outside reviewer, so the merge does not wait for them.`)
  }
  for (const r of after) {
    const old = was.get(r.login.toLowerCase())
    if (old !== undefined && old.state === r.state && old.at === r.at) continue
    const isNewReview = r.at !== undefined && r.at !== old?.at
    switch (r.state) {
      case 'requested': sentences.push(`A review is requested from ${r.login}.`); break
      case 'approved': sentences.push(`${r.login} approved the pull request.`); break
      case 'feedback': sentences.push(isNewReview ? `${r.login} submitted a review with comments or requested changes.` : `${r.login}'s review request was withdrawn, and their newest review has comments.`); break
      case 'unrequested': sentences.push(`${r.login} has no review and no review request.`); break
    }
  }
  return sentences
}

// One sentence per reviewer who is past a time limit now and was not before,
// read through overdueAtLimitStep, as the fingerprint reads them. When the lists only
// shrank, as when reviewer-working went on after the ten-minute limit, one
// sentence says so.
function overdueSentences(before: Snapshot, after: Snapshot): string[] {
  const was = overdueAtLimitStep(before)
  const now = overdueAtLimitStep(after)
  const isNew = (list: readonly string[], login: string) => !list.some(l => l.toLowerCase() === login.toLowerCase())
  const sentences = [
    ...now.arrival.filter(login => isNew(was.arrival, login)).map(login => `The review of ${login} has not arrived two hours after it was requested.`),
    ...now.pickUp.filter(login => isNew(was.pickUp, login)).map(login => `${login} has not picked up the review request ten minutes after it was made, and the pull request does not carry ${WORKING_LABEL}.`),
  ]
  if (sentences.length > 0) return sentences
  const isShorter = now.arrival.length < was.arrival.length || now.pickUp.length < was.pickUp.length
  return isShorter ? ['Fewer requested reviews are past a time limit than at the last look.'] : []
}

// One sentence per other reviewer whose review with comments is new, or
// newer than before.
function otherSentences(before: readonly OtherReviewer[], after: readonly OtherReviewer[]): string[] {
  const was = new Map(before.map(r => [r.login.toLowerCase(), r]))
  return after
    .filter(r => { const old = was.get(r.login.toLowerCase()); return old === undefined || old.at !== r.at })
    .map(r => `${r.login} has a review with comments or requested changes, which the merge does not wait for.`)
}

// Names others wrote are quoted, so the session reads them as names.
export function quoted(names: readonly string[]): string {
  return names.map(name => `"${name}"`).join(', ')
}

// How many per-check sentences are listed before they are only counted. It
// covers the checks that moved and the checks that completed again together.
// The workflow run sentences are held to the same limit, counted on their
// own and not together with the check sentences.
const CHECK_SENTENCE_LIMIT = 6

// One sentence per check name whose state moved, so a check passing while
// another has already failed is still named. A name GitHub lists more than
// once is judged by its newest run on each side, so an old run kept beside a
// rerun is never read as a move. A check whose state did not move but which
// completed again, as a rerun that fails the same way does, is named as
// failing again; one that passed again is not named, because the fingerprint
// does not count it as a change. A new head resets every check, so past a
// handful the sentences are counted instead of listed.
function checkSentences(before: readonly Check[], after: readonly Check[], isNewHead: boolean): string[] {
  const was = newestRuns(before)
  const moved: string[] = []
  const namesThatMoved = new Set<string>()
  for (const [name, check] of newestRuns(after)) {
    const from = was.get(name)?.state
    if (from === check.state) continue
    namesThatMoved.add(name)
    moved.push(from === undefined
      ? `Check "${name}" appeared, ${check.state}.`
      : `Check "${name}" went from ${from} to ${check.state}.`)
  }
  // At a new head the checks are new runs on a new commit, so none of them
  // completed again; the head-moved sentence already says what happened.
  const again = isNewHead ? [] : completedAgain(before, after, namesThatMoved)
  if (moved.length + again.length <= CHECK_SENTENCE_LIMIT) return [...moved, ...again]
  const counts: string[] = []
  if (moved.length > 0) counts.push(`${checksCount(moved.length)} changed state.`)
  if (again.length > 0) counts.push(`${checksCount(again.length)} completed again.`)
  return counts
}

// The newest run of each check name, which is the last of that name in a
// snapshot's sorted checks. A snapshot an older build stored was sorted by
// name alone, so for a name listed twice its pick follows GitHub's order, as
// it did before.
export function newestRuns(checks: readonly Check[]): Map<string, Check> {
  return new Map(checks.map(check => [check.name, check]))
}

// One sentence per workflow run that started, started again or finished.
// A run that left the unfinished list finished, whether or not it registered
// a check. Past the same limit the check sentences use, the runs are counted
// by what they did instead of listed.
function runSentences(before: readonly WorkflowRun[], after: readonly WorkflowRun[]): string[] {
  const was = new Map(before.map(run => [run.id, run.attempt]))
  const isStill = new Set(after.map(run => run.id))
  const started: string[] = []
  const startedAgain: string[] = []
  for (const run of after) {
    if (was.get(run.id) === run.attempt) continue
    if (run.attempt === 1) started.push(`Workflow run "${run.name}" started.`)
    else startedAgain.push(`Workflow run "${run.name}" started again (attempt ${run.attempt}).`)
  }
  const finished = before.filter(run => !isStill.has(run.id)).map(run => `Workflow run "${run.name}" finished.`)
  const sentences = [...started, ...startedAgain, ...finished]
  if (sentences.length <= CHECK_SENTENCE_LIMIT) return sentences
  const counts: string[] = []
  if (started.length > 0) counts.push(`${runsCount(started.length)} started.`)
  if (startedAgain.length > 0) counts.push(`${runsCount(startedAgain.length)} started again.`)
  if (finished.length > 0) counts.push(`${runsCount(finished.length)} finished.`)
  return counts
}

// One sentence per run that counts as failed now and did not before, at the
// same head, held to the same limit as the other run sentences.
function failedRunSentences(before: Snapshot, after: Snapshot): string[] {
  const was = new Set(failedRunsOf(headRunsIn(before) ?? []).map(run => `${run.id}.${run.attempt}`))
  const failed = failedRunsOf(headRunsIn(after) ?? []).filter(run => !was.has(`${run.id}.${run.attempt}`))
  if (failed.length <= CHECK_SENTENCE_LIMIT) return failed.map(run => `Workflow run "${run.name}" failed.`)
  return [`${runsCount(failed.length)} failed.`]
}

function runsCount(n: number): string {
  return n === 1 ? '1 workflow run' : `${n} workflow runs`
}

function checksCount(n: number): string {
  return n === 1 ? '1 check' : `${n} checks`
}

// Whether a check that completed again in the state it had before is news to
// hand the session. A check that fails again is, since the session may be
// waiting on a fix; one that passes again tells the session nothing. The
// fingerprint and the sentences both ask this, so a turn is never started
// with a prompt that names no change.
function isRepeatNews(state: CheckState): boolean {
  return state !== 'passed'
}

// One sentence per check name whose newest completion is newer than it was,
// unless the name already has a sentence because its state moved, or its
// repeat is not news.
function completedAgain(before: readonly Check[], after: readonly Check[], named: ReadonlySet<string>): string[] {
  const newestBefore = newestCompletions(before)
  const sentences: string[] = []
  for (const [name, check] of newestCompletions(after)) {
    if (named.has(name)) continue
    if (!isRepeatNews(check.state)) continue
    const last = newestBefore.get(name)
    // A name with no completion before has nothing to complete again; a
    // record kept before checks carried times is one of these.
    if (last === undefined) continue
    if (check.completedAt <= last.completedAt) continue
    sentences.push(`Check "${name}" ${check.state} again.`)
  }
  return sentences
}

type Completed = Check & { completedAt: string }

// The newest completion each check name has. A rerun that GitHub lists as a
// second check beside the first is then compared with the first, and two
// different checks are never paired. Of two runs that share a completion
// time the later in the sorted checks is kept, so the pick is the same run
// that newestRuns picks.
function newestCompletions(checks: readonly Check[]): Map<string, Completed> {
  const newest = new Map<string, Completed>()
  for (const check of checks) {
    if (check.completedAt === undefined) continue
    const seen = newest.get(check.name)
    if (seen === undefined || seen.completedAt <= check.completedAt) newest.set(check.name, { ...check, completedAt: check.completedAt })
  }
  return newest
}

// The text the desktop app hands the session when CI fails or a conflict
// appears. The spike found these arrive through prompt.submit with origin sdk.
export function isCiMonitorEvent(text: string): boolean {
  return /<ci-monitor-event\b/.test(text)
}

// The round in progress. Every head that drew a verdict review was a round,
// whichever way the verdicts went, so an approval followed by more commits
// moves the count on. While the head has no verdict review its round is
// still to come; once it has one, the round is that review's.
export function roundInProgress(s: Pick<Snapshot, 'headsReviewed' | 'verdicts'>): number {
  return s.verdicts === null ? s.headsReviewed + 1 : s.headsReviewed
}
