// What the pull request says, read with one `gh pr view` and reduced to the
// few facts /implement decides on. Everything here is a pure function of the
// JSON gh printed, so the tests can feed it fixtures and the hooks can call it
// without touching the network.

import type { Check, CheckState, Snapshot, Verdict, Verdicts, WorkflowRun } from '../types'

export type { Check, CheckState, Snapshot, Verdict, Verdicts, WorkflowRun }

// The JSON fields the snapshot reads, in the order gh is asked for them.
export const PR_FIELDS = 'number,url,state,headRefOid,labels,reviews,statusCheckRollup,mergeable,commits'

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
}

export type GhPullRequest = {
  number: number
  url: string
  state: string
  headRefOid: string
  labels?: { name: string }[]
  reviews?: GhReview[]
  statusCheckRollup?: GhCheck[]
  mergeable?: string
  commits?: { oid: string }[]
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

function isChangesRequested(verdicts: Verdicts) {
  return verdicts.spec === 'REQUEST_CHANGES' || verdicts.adversarial === 'REQUEST_CHANGES'
}

// The filter for `gh api --paginate "repos/<repo>/actions/runs?head_sha=<head>"`.
// It keeps the runs that have not completed, and only the three fields the
// snapshot reads. gh prints each result as one compact JSON object per line
// when its output is not a terminal, and nothing for a head with no runs. It
// runs on each page alone, which is right because it keeps or drops each run
// on its own.
export const RUNS_JQ = '.workflow_runs[] | select(.status != "completed") | {id, run_attempt, name}'

// The unfinished runs in what the runs read printed, or null when any line is
// not a run, so a read that went wrong counts as a failed read. --paginate
// reads page by page, so a run queued while it reads can be listed twice;
// each id is kept once, at its highest attempt. A run without an attempt is
// on its first, and so is a run whose attempt is null, because jq writes a
// key the input lacks as null. An attempt that is present but not a number
// still makes the read fail.
export function runsOf(out: string): WorkflowRun[] | null {
  const byId = new Map<number, WorkflowRun>()
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return null
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const { id, run_attempt: rawAttempt, name } = raw as { id?: unknown; run_attempt?: unknown; name?: unknown }
    const attempt = rawAttempt ?? 1
    if (typeof id !== 'number' || typeof attempt !== 'number') return null
    const seen = byId.get(id)
    if (seen !== undefined && seen.attempt >= attempt) continue
    byId.set(id, { id, attempt, name: plainName(typeof name === 'string' ? name : 'unnamed run') })
  }
  return [...byId.values()].sort((a, b) => a.id - b.id || a.attempt - b.attempt)
}

// The runs a look keeps when its runs read failed: those of the snapshot the
// mod last stored for the pull request, if that snapshot is of the same
// repository, number and head, and otherwise none. The fingerprint then never
// changes because a read failed. `stored` is passed in unchecked, as the
// state holds it.
export function carriedRuns(stored: unknown, repo: string, number: number, head: string): WorkflowRun[] {
  const s = snapshotIn(stored)
  if (s === null || s.repo !== repo || s.number !== number || s.head !== head) return []
  return s.runs ?? []
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

export function snapshotOf(repo: string, pr: GhPullRequest, login: string, runs: WorkflowRun[] = []): Snapshot {
  const head = pr.headRefOid
  const commits = (pr.commits ?? []).map(commit => commit.oid)
  // Only verdict reviews this login posted count: a review anyone else posts
  // with the same first line is not one the session wrote.
  const verdictReviews = (pr.reviews ?? [])
    .filter(review => review.author?.login === login)
    .map(verdictsOf)
    .filter((verdicts): verdicts is Verdicts => verdicts !== null)

  const atHead = verdictReviews.filter(verdicts => verdicts.sha === head)
  const changesRequested = verdictReviews.filter(isChangesRequested)
  const headsReviewed = new Set(verdictReviews.map(verdicts => verdicts.sha)).size
  const pushesSinceVerdict = pushesAfter(changesRequested.at(-1)?.sha, commits)

  const snapshot: Omit<Snapshot, 'fingerprint'> = {
    repo,
    number: pr.number,
    url: pr.url,
    state: pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN',
    head,
    labels: (pr.labels ?? []).map(label => plainName(label.name)).sort(),
    mergeable: pr.mergeable === 'MERGEABLE' || pr.mergeable === 'CONFLICTING' ? pr.mergeable : 'UNKNOWN',
    checks: (pr.statusCheckRollup ?? []).map(checkOf).sort(compareChecks),
    verdicts: atHead.at(-1) ?? null,
    headsReviewed,
    pushesSinceVerdict,
    runs,
  }
  return { ...snapshot, fingerprint: fingerprintOf(snapshot) }
}

function pushesAfter(sha: string | undefined, commits: readonly string[]): number {
  if (sha === undefined) return 0
  const at = commits.indexOf(sha)
  // A verdict on a commit the branch no longer holds (a force push) leaves
  // every commit on the branch unreviewed.
  if (at === -1) return commits.length
  return commits.length - at - 1
}

// The label the mod puts on the pull request while the owner is asked a
// question, and takes off once the question is answered.
export const DECISION_LABEL = 'needs-decision'

// The labels the workflow sets on the pull request itself: the state labels
// /implement moves between, and the mod's own decision label. A change to
// them is the session's own doing, or a person's by hand, and /implement
// never decides from them, so it is not news to hand the session. The
// snapshot still keeps them, because the poll interval and the pane read them.
export const WORKFLOW_LABELS: ReadonlySet<string> = new Set(['in-review', 'waiting-on-author', 'ready-to-merge', 'stuck', DECISION_LABEL])

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
// as queued to in progress, is not.
export function fingerprintOf(s: Omit<Snapshot, 'fingerprint'>): string {
  const verdicts = s.verdicts ? `${s.verdicts.spec}/${s.verdicts.adversarial}@${s.verdicts.sha.slice(0, 8)}` : 'none'
  return [
    s.state,
    s.head.slice(0, 12),
    countedLabels(s.labels).join(','),
    verdicts,
    [...newestRuns(s.checks).values()].map(checkPartOf).join(','),
    s.mergeable === 'CONFLICTING' ? 'conflicting' : 'no-conflict',
    (s.runs ?? []).map(run => `${run.id}.${run.attempt}`).join(','),
  ].join('|')
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

export type CiState = 'none' | 'pending' | 'failed' | 'passed'

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
  if (before.head === after.head) changes.push(...runSentences(before.runs ?? [], after.runs ?? []))
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
  if (JSON.stringify(before.verdicts) !== JSON.stringify(after.verdicts)) {
    changes.push(after.verdicts
      ? `A verdict review is posted at the head: spec ${after.verdicts.spec}, adversarial ${after.verdicts.adversarial}.`
      : 'The head has no verdict review yet.')
  }
  // Something the fingerprint covers moved without changing a field named
  // above; never hand over a change with nothing in it.
  if (changes.length === 0) changes.push('The pull request changed in a way the lines below show.')
  return changes
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
