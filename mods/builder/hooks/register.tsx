import { atom, read, update } from 'claude-code'
import type { EngineInterface, Next, PromptOrigin, Register, ResolveInput, ToolCallInput, ToolCallResult } from 'claude-code'

import type { AgentCard, BackgroundTask, BuilderRun, CounselQuestion, CounselTally, ForegroundCall, LoadBegun, StatusMemo, Wake } from '../types'
import { isSvgSurface } from './art'
import { checkoutSentence, worktreeWithBranch, type Checkout } from './checkout'
import { afterAskAgain, afterTally, askAgainAnswer, briefAnswer, briefFactsOf, briefRefusal, briefText, counselAnswer, decisionLine, destinationOf, endedDecisionLines, FOLLOW_UP_OPTIONS, followUpAnswer, followUpAskAgainAnswer, followUpsInput, followUpsRefusal, followUpStepOf, followUpVotesOf, keepCounsel, MAX_BRIEF_OPTIONS, MAX_FOLLOW_UPS, MIN_OPTIONS, neverStartedCandidatesOf, neverStartedOf, type PullRequestRef, reviewParagraph, stepOf, type UnreadableVote, votesOf } from './counsel'
import { carriedRuns, changesBetween, DECISION_LABEL, isCiMonitorEvent, isSameState, PR_FIELDS, pullRequestStateIn, roundInProgress, RUNS_JQ, runsOf, snapshotIn, snapshotOf, verdictsOf, type GhPullRequest, type Snapshot, type Verdict, type WorkflowRun } from './github'
import { afterComparison, afterLoad, dueComparisons, isStale, LOADED_PATHS, loadBegunAs, loadBegunIn, loadedIn, type Found } from './loaded'
import { AGENT_PANE, agentPaneTree, bandTree, isDrawable, messagesReadOf, NAMED_AFTER_MS, PANE, paneTree, secondRow, type Elements, type MessagesRead, type View } from './pane'
import { afterReport, endedOf, plannedOf, progressIn, reportAnswer, reportOf, stageLabel, STAGES, type ReportInput } from './progress'
import { changePrompt, ciEventContext, resumePrompt, stateLines, stuckPrompt } from './prompts'
import { commitRecordsOf, decidedItems, factIn, packageText, secretIn, trendOf, trendStopLine, verdictsLine, type PackageInput } from './review'
import { AGENTS_KEPT, backgroundOf, endedCards, endedTaskOf, exhaustedWindows, holdIn, isPersonPrompt, isPushOrMerge, isRunning, keepQuestions, labelOf, mergeAgents, mergePatternOf, nextStuckEvery, pollFor, quietIn, READ_ONLY_AGENTS, RESUME_FALLBACK_MS, resumeAt, REVIEWER_TOOLS, statusOf, stepDelay, stuckEveryIn, STUCK_FIRST_MS, summaryOf, TIMER_STEP_MS, UNNAMED_TOOLS, type ListedAgent } from './state'
import { afterCallReturn, afterCleanupSkill, afterCounselAsk, afterFailedCall, afterLoopEnd, afterPermissionRequest, afterPersonPrompt, afterQuestionEnd, afterWrite, buildPathOf, comparedTextOf, configDirOf, firstPromptOf, generationIn, isCleanupSkill, newMemo, recordOf, statusMemoIn, ticketIn, watchedSnapshotOf, type StatusFacts } from './status'
import { timeOfDay } from './text'

type $ = EngineInterface

// The session's values the pane draws from. They survive a hot reload.
const run = atom({ plugin: 'builder', key: 'run' } as const, null)
const pr = atom({ plugin: 'builder', key: 'pr' } as const, null)
const agents = atom({ plugin: 'builder', key: 'agents' } as const, [])
const questions = atom({ plugin: 'builder', key: 'questions' } as const, [])
const wakes = atom({ plugin: 'builder', key: 'wakes' } as const, [])
const cwd = atom({ plugin: 'builder', key: 'cwd' } as const, null)
const busy = atom({ plugin: 'builder', key: 'busy' } as const, false)
const nextLook = atom({ plugin: 'builder', key: 'nextLook' } as const, null)
const counsel = atom({ plugin: 'builder', key: 'counsel' } as const, [])
const background = atom({ plugin: 'builder', key: 'background' } as const, [])
const calls = atom({ plugin: 'builder', key: 'calls' } as const, [])
const started = atom({ plugin: 'builder', key: 'started' } as const, false)
const progress = atom({ plugin: 'builder', key: 'progress' } as const, null)
const packaged = atom({ plugin: 'builder', key: 'packaged' } as const, null)
const finishedFolded = atom({ plugin: 'builder', key: 'finishedFolded' } as const, true)
const outputAgent = atom({ plugin: 'builder', key: 'outputAgent' } as const, null)
// The stuck prompt's quiet time and interval, and the usage-limit hold. They
// survive a hot reload too, so the timers armed from them come back at their
// original times, and a restart starts without them, as the README says.
const quietSince = atom({ plugin: 'builder', key: 'quietSince' } as const, null)
const stuckEvery = atom({ plugin: 'builder', key: 'stuckEvery' } as const, STUCK_FIRST_MS)
const usageHold = atom({ plugin: 'builder', key: 'usageHold' } as const, null)
// The commits the mod was loaded from. It survives a hot reload, so the
// session commit recorded at the session's first start is never rewritten,
// and a restart starts without it.
const loaded = atom({ plugin: 'builder', key: 'loaded' } as const, null)
// How the first load of this build in the session began. It survives a hot
// reload too, and a restart starts without it.
const loadBegun = atom({ plugin: 'builder', key: 'loadBegun' } as const, null)
// What the status file for the foreman needs beyond the values above. It
// survives a hot reload, so the ticket is not looked for again and the time
// the state began is kept; a /clear resets it. The state.set hook in
// `register` leaves its writes out, so writing it never asks for another
// write of the status file.
const statusMemo = atom({ plugin: 'builder', key: 'statusMemo' } as const, null)

// The builder mod: it watches the pull request the session works on, shows that
// pull request and the session's agents in a pane, and starts a turn when the
// pull request changes while the session is idle. GitHub is the record.
// `$.store` remembers the state last handed to the session, so a restart does
// not hand it over twice and every change is described against what the
// session was last told. It also keeps the counsel's decisions still owed to
// a review, so a restart does not lose them either; the package and review
// tools write their files under the checkout's git folder (see the README).

// Module variables reset on every hot reload, which drops the timers too.
// `armed` going false is how the next hook knows to start polling again.
let armed = false
let timer: { cancel: () => void } | undefined
// The time `timer` is due to fire, so that a look which only observes can
// keep that timer when it is sooner than the one it would set.
let timerDue: number | undefined
// Counts the calls to schedule(). A call that finds a newer one has started
// since it began leaves the timer and the due time to that newer call.
let scheduleGen = 0
// Asks for a redraw while a look is scheduled, so the time shown stays true.
let ticker: { cancel: () => void } | undefined
// The pair of looks armed after the session's own push or merge. A newer
// push or merge cancels the pair still pending and arms its own.
let commandLooks: { cancel: () => void }[] = []
// Each look is numbered as it starts. `newestStoredLook` is the number of the
// newest look whose result was stored, so an older look that finishes later
// never stores its result over a newer one. `toldSeq` is the number of the
// read last recorded as told, so an older read neither records itself as told
// over a newer one nor is handed over after it. Recording as told without a
// look (the watch tool) takes a fresh number, so every read is ordered.
// `toldSeq` moves when a read is claimed as told, before its record is
// written, so for a while the store still holds the older record; the writes
// still in flight are counted in `toldWrites`, below.
// `newestRead` is the newest stored read that a delivering look may hand
// over, with the watch it was read under and its number. Only a look that
// leaves its read for others to tell keeps its read here: a delivering look,
// and a look that only observes other than the desktop app's CI event. The
// CI event's look and the look after the mod posts a review each tell the
// session their own read themselves (see untoldOwnReads), so a delivering
// look that handed it over too would tell the session the same state twice.
// A read is kept here together with `newestStoredLook`, with no await
// between, and is never read back from the store, so the read and its number
// always match; a delivering look that a newer one overtook hands this read
// over instead of its own (see newestFor). A new watch empties it, so no
// look under that watch hands over the old watch's read. A hot reload sets
// the three numbers back to zero and empties the read, which is accepted: a
// look in flight across a reload is rare, and the next poll corrects what it
// leaves.
let lookSeq = 0
let newestStoredLook = 0
let toldSeq = 0
let newestRead: { r: BuilderRun; s: Snapshot; seq: number } | null = null
// One mark for each look that tells the session its own read (the desktop
// app's CI event's look and the look after the mod posts a review) that has
// gone on with its read but not yet finished: it has neither recorded the
// read as told nor given up. Such a look goes on with its read whether it
// stored it or was overtaken by a newer look. While any mark is here, a
// delivering look hands nothing over (see newestFor). Without this, a look
// that only observes could read the same state before or after such a look
// read it, keep it in `newestRead`, and have a waiting poll hand it over
// while the CI event's prompt is still on its way, so the session would hear
// the same failure twice. Each mark is
// taken out in a `finally` by tellingOwnRead, so no early return or error
// leaves one behind to block handovers for good. A hot reload empties the
// set, as it resets the numbers above; the look in flight then removes its
// mark from the old module's set, and the next poll corrects what the
// reload leaves.
const untoldOwnReads = new Set<object>()
// The number of calls to `tell` that have claimed their read's number and not
// yet finished writing the told record, whichever look or tool made them.
// `tell` raises it in the same step as the claim and lowers it in a `finally`
// around everything after, so a write or a read of the key that fails, or an
// early return, still lowers it. While it is raised, the told record in the
// store may not yet say what the session was told, so a delivering look hands
// nothing over (see newestFor and deliver) and the stuck prompt is dropped
// (see fireStuck). Without this, a poll that ran while the watch tool's write
// was in flight would read the record from before the watch and hand over
// the whole state the watch tool had just reported. A write that never
// settles would hold handovers back for good, which is the hazard the marks
// in `untoldOwnReads` already accept. A hot reload sets it back to zero, as
// it resets the numbers above; a write in flight then finishes in the old
// module, and the next poll compares against whatever was written.
let toldWrites = 0
// A change found while the session's turn ran, to deliver when it ends.
let isHeld = false
// The head whose handover was last held or refused. It polls at the ordinary
// interval rather than every 90 seconds, until another head comes.
let stalledHead: string | null = null
// A prompt is being submitted. A look that finds another change meanwhile
// leaves it for the next look rather than submit a second prompt at once.
let isDelivering = false
// The stuck prompt's timer, and the number of the arming it belongs to. Each
// arming takes a new number, so a timer an older arming set does nothing when
// it fires. While a pull request is watched and open, the session always has
// one of the two timers below: the hold's timer when a hold is saved, and the
// stuck timer when none is. That holds even when a write of the state is
// refused, so a step that has stopped one timer arms the other before it lets
// a refused write's error go on. It holds for a refused read too: when the
// work of either timer fails, the timer's own callback arms it again, in
// setStuckTimer and setHoldTimer, and when a read made to arm either timer
// fails, armStuck and armHold arm it again themselves. When armUnattended
// cannot read the hold to choose between the two, it arms a retry of itself
// in the hold's timer slot RESUME_FALLBACK_MS later, and the retry chooses
// once its own read succeeds (see armingRetry), unless the slot already holds
// a retry of the decision after a clear, which it leaves in place (see
// armUnattended). A hold during the spec or the build has nothing watched
// and so no stuck prompt to fall back on, so once the resume time has cleared
// the hold, the hold's timer is armed again until the resume decision has
// been made, even with no hold saved (see resumeFromHold).
let stuckTimer: { cancel: () => void } | undefined
let stuckGen = 0
// The usage-limit hold's timer, with the work it is armed for, and the number
// of the hold it belongs to, so a timer set for a hold since cleared or
// replaced does nothing. The timer is undefined when none is armed or the
// armed one has fired. armUnattended reads its work so that its retry never
// replaces a retry of the decision after a clear (see armUnattended). The
// work lives on the timer, so whatever cancels the timer drops it too.
let holdTimer: { cancel: () => void; work: HoldWork } | undefined
let holdGen = 0
// Whether the session's own turn runs, as `busy` says, but kept here so the
// check that must sit right before a prompt needs no await. It is set first
// when a turn starts and cleared first when it ends. A hot reload sets it
// false, and the read of `busy` beside it decides.
let turnRunning = false
// The StopFailure hook reported `rate_limit` for the session's turn under way
// or just ended. A turn's start clears it.
let rateLimitSeen = false
// The number of the person's prompts so far. Each one moves it on before its
// first await, so a hold decided for a turn that ended before the prompt can
// tell that the prompt came, and start no hold.
let personPrompts = 0
// The number of the session's own turns that have started, and the number of
// the last of them that ended with an answer or a refusal, the two reasons
// that mean the API replied. Each turn moves the first on before its first
// await, and its end sets the second before its first await, so a hold saved
// for an error turn can tell that a turn which started after that error turn
// ended has replied, and that the limit has lifted since (see
// saveHoldOrTakeItOff). The first also lets the end of a turn that replied
// tell that a later turn has started since, and leave the hold that later
// turn may have saved alone (see repliedTurnClearsHold). A hot reload sets
// both to zero, which is safe because it also forgets the pending error turn,
// and each comparison only asks whether a number moved during one turn's end
// or between an error turn's end and its hold's save.
let ownTurnsStarted = 0
let repliedTurn = 0
// The session's own turn that an error ended and that no hold has come of
// yet, for a StopFailure that arrives after the turn's end, with the number
// of the person's prompts at its end and the number of the session's own
// turns started when its end began. A turn's start clears it, and so does a
// hold.
let pendingErrorTurn: { endedAt: number; personPrompts: number; turnsStarted: number } | null = null
// A hold is being decided, so the end of a turn and the StopFailure hook
// cannot both start one. A decision asked for meanwhile sets isHoldOwed, and
// the running one decides again for the pending turn when it starts no hold.
let isDecidingHold = false
let isHoldOwed = false
// Whether the stuck timer or the hold timer was armed from the atoms since
// this module loaded. A hot reload sets it false, and ensureArmed arms them
// again, as it does the poll.
let isUnattendedArmed = false

const COMMAND_TIMEOUT_MS = 20_000
// How long after the session's own turn ends, and after its own push or
// merge, the mod looks: once when GitHub has usually shown the change, and
// again for a change GitHub shows late.
const AFTER_LOOK_MS = [10_000, 40_000]
// How often the display is redrawn while a look is scheduled.
const REDRAW_MS = 30_000
const WATCH_TOOL = 'mcp__builder__watch'
const PACKAGE_TOOL = 'mcp__builder__package'
const REVIEW_TOOL = 'mcp__builder__post_review'
const COUNSEL_TOOL = 'mcp__builder__counsel'
const TALLY_TOOL = 'mcp__builder__counsel_tally'
const OPEN_PANE_TOOL = 'mcp__builder__open_pane'
const PROGRESS_TOOL = 'mcp__builder__progress'
const SESSION_TOOLS = new Set([WATCH_TOOL, PACKAGE_TOOL, REVIEW_TOOL, COUNSEL_TOOL, TALLY_TOOL, OPEN_PANE_TOOL, PROGRESS_TOOL])

// gh's output, trimmed, or null when gh failed or the engine cut its output
// off at 4 MiB, as the git helper below also does. A cut-off answer is never
// parsed as if it were whole: a cut-off runs read fails, and so does a
// cut-off `gh pr view`, which is safer than parsing part of its JSON. A
// command that throws, because it could not start or ran past its timeout,
// counts as a failure too.
async function gh($: $, dir: string | null, args: string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['gh', ...args], { cwd: dir ?? undefined, timeoutMs: COMMAND_TIMEOUT_MS })
    return ran.exitCode === 0 && !ran.isStdoutTruncated ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

// A look reads the pull request, and then the unfinished workflow runs at
// the head that read gave. When the runs read fails, for any reason, the look
// carries on with the pull request's other facts and keeps the runs the
// stored snapshot had (see carriedRuns), so a failed read never changes the
// fingerprint. The mark that says so is set after the fingerprint is made,
// which keeps it out of the fingerprint.
async function fetchSnapshot($: $, r: Pick<BuilderRun, 'repo' | 'number' | 'cwd' | 'login'>): Promise<Snapshot | null> {
  const out = await gh($, r.cwd, ['pr', 'view', String(r.number), '--repo', r.repo, '--json', PR_FIELDS])
  if (out === null) return null
  const live = JSON.parse(out) as GhPullRequest
  const runs = await readRuns($, r, live.headRefOid)
  if (runs !== null) return snapshotOf(r.repo, live, r.login, runs)
  const s = snapshotOf(r.repo, live, r.login, carriedRuns(await read($, pr), r.repo, live.number, live.headRefOid))
  return { ...s, runsCarriedOver: true }
}

// The state GitHub gives now for a pull request, or null when it could not be
// read: gh failed, threw or had its output cut off (the gh helper refuses all
// three), or the answer named no state the mod knows. It runs from the
// session's folder and names the repository, so it reads the pull request it
// is given whatever the watch follows.
async function readPullRequestState($: $, target: Pick<BuilderRun, 'repo' | 'number'>): Promise<Snapshot['state'] | null> {
  const out = await gh($, await read($, cwd), ['pr', 'view', String(target.number), '--repo', target.repo, '--json', 'state'])
  return pullRequestStateIn(out)
}

// The head's unfinished workflow runs, or null when they could not be read:
// gh failed, threw or had its output cut off (the gh helper refuses all
// three), or a line was not a run.
async function readRuns($: $, r: Pick<BuilderRun, 'repo' | 'cwd'>, head: string): Promise<WorkflowRun[] | null> {
  const out = await gh($, r.cwd, ['api', '--paginate', `repos/${r.repo}/actions/runs?head_sha=${head}&per_page=100`, '--jq', RUNS_JQ])
  return out === null ? null : runsOf(out)
}

// What this session was last told, per pull request, and when it last
// looked. Keyed by session as well, because the store is shared by every
// session that loads the mod.
const TOLD_PREFIX = 'prompted:'
const SEEN_PREFIX = 'seen:'

async function promptedKey($: $, r: Pick<BuilderRun, 'repo' | 'number'>): Promise<string> {
  return `${TOLD_PREFIX}${await $.session.id()}:${r.repo}#${r.number}`
}
const seenKeyFor = (toldKey: string) => `${SEEN_PREFIX}${toldKey.slice(TOLD_PREFIX.length)}`
const toldKeyFor = (seenKey: string) => `${TOLD_PREFIX}${seenKey.slice(SEEN_PREFIX.length)}`

// The counsel's decisions on questions put while an open pull request was
// watched, not yet listed in a review posted on it. Each is kept under its own key,
// `counsel-owed:<repo>#<number>:<session id>:<question id>`, holding its line
// and when it was made. The pull request leads the key because whichever
// session posts the next review there lists them all; the session's id
// follows because every session numbers its questions from c1. Each decision
// has a key of its own because the store has no atomic update, so a list
// shared by the sessions on one pull request, read and written back, would
// lose a decision another session wrote in between. A review lists the keys
// owed to its pull request and deletes them once it is posted. When the pull
// request merges or closes before such a review, the change prompt that hands
// the merge or the close over, and the watch tool's answer on a pull request
// that is not open, list them instead and delete the keys they listed.
const OWED_PREFIX = 'counsel-owed:'
type OwedDecision = { key: string; line: string; at: number }

// The prefix ends with the separator, so the keys for #1 do not include #12's.
const owedPrefix = (target: Pick<BuilderRun, 'repo' | 'number'>) => `${OWED_PREFIX}${target.repo}#${target.number}:`

// A stored value of another shape counts as nothing owed, as a told record of
// another shape counts as no record.
function owedIn(key: string, stored: unknown): OwedDecision | null {
  const d = stored as { line?: unknown; at?: unknown } | null | undefined
  return typeof d?.line === 'string' && typeof d.at === 'number' ? { key, line: d.line, at: d.at } : null
}

async function owedDecisions($: $, target: Pick<BuilderRun, 'repo' | 'number'>): Promise<OwedDecision[]> {
  const prefix = owedPrefix(target)
  const owed: OwedDecision[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const decision = owedIn(key, await $.store.get(key))
    if (decision !== null) owed.push(decision)
  }
  return owed.sort((a, b) => a.at - b.at)
}

// The decisions still owed to a pull request, or none when the store could
// not list or read them. The change prompt and the watch tool's answer list
// them on the way to something else, so a store that fails must stop neither.
async function owedSafely($: $, target: Pick<BuilderRun, 'repo' | 'number'>): Promise<OwedDecision[]> {
  try {
    return await owedDecisions($, target)
  } catch {
    return []
  }
}

// Deletes the keys of the decisions just listed, and only those, so a
// decision owed after the list was read is listed the next time. Each delete
// has its own try, so one that fails stops neither the others nor the caller;
// its key is listed again the next time, and the session finds the line
// already in its spec.
async function forgetListed($: $, listed: readonly OwedDecision[]) {
  for (const d of listed) {
    try {
      await $.store.delete(d.key)
    } catch {
      // Listed again the next time, as said above.
    }
  }
}

async function oweDecision($: $, target: Pick<BuilderRun, 'repo' | 'number'>, questionId: string, line: string, at: number) {
  await $.store.set(`${owedPrefix(target)}${await $.session.id()}:${questionId}`, { line, at })
}

async function forgetTold($: $, toldKey: string) {
  await $.store.delete(toldKey)
  await $.store.delete(seenKeyFor(toldKey))
}

const isSameRun = (a: BuilderRun | null, b: BuilderRun) =>
  a !== null && a.repo === b.repo && a.number === b.number && a.since === b.since
// The stamp of the newest watch, as a module variable, because a state read
// inside a hook that is still running does not see a watch made since it
// began. After a reload it is unset, and the state read decides.
let currentSince: number | undefined
// The half of stillWatching that needs no await, for a check that must sit
// right before a prompt with nothing between them.
const isCurrentWatch = (r: BuilderRun) => currentSince === undefined || r.since === currentSince
const stillWatching = async ($: $, r: BuilderRun) =>
  isCurrentWatch(r) && isSameRun(await read($, run), r)

const WAKES_KEPT = 50

async function recordWake($: $, wake: Wake) {
  await update($, wakes, list => [...list, wake].slice(-WAKES_KEPT))
  // A look that found the pull request changed, and a new watch, which is
  // always recorded as changed, bring the stuck interval back to the first
  // and restart the quiet time. This runs behind the look, and a failure in
  // it is its own.
  if (wake.changed) void resetStuckInterval($).then(() => markQuiet($, wake.at)).catch(() => undefined)
}

// How a look treats what it finds:
// - `deliver` hands a change to the session, or holds it while the session's
//   own turn runs (the poll, and the end of a turn that held a change);
// - `known` records the state as already in front of the session (after the
//   mod posts the session's own review);
// - `observe` hands nothing over (/builder poll, the looks after any other turn
//   ends and after the session's own push or merge, and the desktop app's CI
//   event, which records what was told once its prompt goes on). It
//   refreshes the display and reschedules the next poll, which it may bring
//   forward, as for a new head, but never put off.
type Mode = 'deliver' | 'known' | 'observe'

async function look($: $, source: Wake['source'], mode: Mode): Promise<Snapshot | null> {
  return (await lookAt($, source, mode))?.s ?? null
}

// A look that also answers which watch it read under and the number of its
// read, for a caller that records something afterwards and must record it
// against the same watch and in the same order, and whether it handed a
// change over with a prompt.
//
// A look overtaken by a newer one (a newer look stored its result first)
// never stores its snapshot or records a wake, so the display never goes
// back to an older state. A look that only observes is then dropped.
// A known look still records its own read as told, and the CI event's caller
// still gets its own read for its prompt and records it as told. Acting on
// the older read is safe there while no newer read has been recorded as told,
// because a newer state is still a change against it and the next poll hands
// it over. A delivering look hands over the newest read that a look of the
// same watch stored and left for others to tell, under that read's number,
// and chooses it after its last await before the prompt, so a newer look that
// stores its read while the delivering look waits also counts as overtaking
// it; the session is then told the newest state the mod knows and shows. A
// delivering look hands over nothing when the newest stored read is one that
// the CI event's look or the known look stored, because that look tells the
// session that read itself (see newestFor). Once a newer read has been
// recorded as told, `tell` and `deliver` refuse the older one, so it can
// neither undo that record nor tell the session the pull request went
// backwards. An overtaken look does not schedule the next
// poll: the newer look scheduled it from a newer snapshot, and a record of
// what was told schedules again by itself. Of the looks that only observe,
// only the CI event's acts on its read, so its caller says so by name.
//
// `ownRead` is given by a look that tells the session its own read, through
// tellingOwnRead: the CI event's look, which tells its read after its
// prompt goes on, and the known look, which tells it below. Such a look does
// not keep its read in `newestRead`. It marks its read as not yet told in
// `untoldOwnReads` as soon as it knows it goes on with that read, whether it
// stores the read or was overtaken, so no delivering look hands anything
// over until the look finishes. An overtaken look needs the mark as much as
// one that stores: the look that overtook it may be one that only observes,
// which keeps the same state in `newestRead`, and a delivering look would
// otherwise hand that over while this look is about to tell it.
async function lookAt(
  $: $,
  source: Wake['source'],
  mode: Mode,
  { actsOnRead = mode !== 'observe', ownRead }: { actsOnRead?: boolean; ownRead?: object } = {},
): Promise<{ r: BuilderRun; s: Snapshot; seq: number; delivered: boolean } | null> {
  const leavesReadForHandover = ownRead === undefined
  // No look runs during a usage-limit hold, except the /builder poll the person
  // asks for. The look at the resume time runs once the hold is cleared.
  if (source !== 'command' && (await isHoldOn($))) return null
  const r = await read($, run)
  if (r === null) return null
  refreshLater($)
  lookSeq += 1
  const seq = lookSeq
  const s = await fetchSnapshot($, r)
  // Watching may have moved on while gh ran.
  if (s === null || !(await stillWatching($, r))) return null

  const shown = await read($, pr)
  if (!(await stillWatching($, r))) return null
  // The check and the claim follow each other with no await between.
  const isOvertaken = seq < newestStoredLook
  if (isOvertaken && !actsOnRead) return null
  // The look goes on with its read from here, so a look that tells its own
  // read marks it as not yet told now, in the same step as the check above,
  // whether or not it was overtaken.
  if (ownRead !== undefined) untoldOwnReads.add(ownRead)
  if (!isOvertaken) {
    // The read is kept beside its number in the same step, before the await
    // that stores it, so a delivering look never pairs one with the other's.
    // A look that tells its own read is not kept for a delivering look to
    // hand over, because it was marked as not yet told above.
    newestStoredLook = seq
    if (leavesReadForHandover) newestRead = { r, s, seq }
    await update($, pr, () => s)
    // A pane snapshot an older build saved counts as different, rather than
    // throwing in the middle of the look, because isSameState checks both
    // sides with snapshotIn.
    await recordWake($, { at: await $.clock.now(), source, changed: !isSameState(shown, s) })
    // Label work for an answered question runs behind the look, never in front.
    void inLabelQueue(() => takeOffAnsweredLabels($))
  }

  await keepSeen($, r)
  if (mode === 'known') await tell($, r, s, seq)
  const delivered = mode === 'deliver' ? await deliver($, r, s, seq) : false
  // Given the snapshot just read, so the comparison with the told head does
  // not rest on a state read that a still-running hook might see stale. A
  // look whose watch was replaced meanwhile schedules nothing: the new watch
  // scheduled its own poll, and this hook's reads of the state still show
  // the old pull request, which could stop that poll.
  if (!isOvertaken && await stillWatching($, r)) await schedule($, s, mode === 'observe')
  return { r, s, seq, delivered }
}

// The snapshot last handed to the session sits under its prompted key; the
// time the session last looked at that pull request sits under a seen key of
// its own. Only the seen key is refreshed in passing, so refreshing can never
// write an older snapshot over a newer one.
const TOLD_KEPT_MS = 14 * 24 * 60 * 60_000
const SEEN_REFRESH_MS = 24 * 60 * 60_000
// A decision owed to a review is kept far longer than a told record, because
// pruning cannot tell a pull request that closed from one that is still open
// and waiting for its next review; deleting it too early would lose it.
const OWED_KEPT_MS = 90 * 24 * 60 * 60_000

// A stored value that lacks a field the comparison reads (the builds of this
// mod before the seen key stored another shape, or a record without labels)
// counts as no record, rather than throwing on every poll and silencing the
// session. The pane's guard against a snapshot an older build saved in its
// state is `isDrawable` in hooks/pane.tsx.
async function told($: $, r: BuilderRun): Promise<Snapshot | null> {
  return snapshotIn(await $.store.get(await promptedKey($, r)))
}

// Makes a queue that runs the work given to it one at a time, in the order it
// was queued. Work that fails never stops the queue: the next piece runs
// either way. The two queues below differ only in what the caller of a
// failed piece sees. With `passesErrors`, the caller's promise rejects with
// that failure; without it, the caller's promise resolves without an error
// and the failure goes no further.
function oneAtATime({ passesErrors }: { passesErrors: boolean }) {
  let last: Promise<unknown> = Promise.resolve()
  return (work: () => Promise<unknown>): Promise<unknown> => {
    const done = last.then(work, work)
    last = done.catch(() => undefined)
    return passesErrors ? done : last
  }
}

// Writes and deletes of told records run one at a time, in the order they
// were queued, so the record never depends on the order in which the engine
// finishes the mod's store calls. A write that fails lets the next one run,
// and its caller still gets the error, unlike a caller of the label queue.
const inToldQueue = oneAtATime({ passesErrors: true })

// `seq` is the number of the read being recorded. A read older than the one
// last recorded as told is refused, so a look that finishes late never writes
// its older state over a newer record. The check and the claim follow each
// other with no await between, and the claim raises `toldWrites` in the same
// step, so from the moment the number moves no delivering look hands
// anything over until this call has finished, however it ends. The write
// itself waits its turn in the told queue, and is skipped there when a newer
// read has been claimed as told since it was queued, so the record ends on
// the newest read even when an older write is still running as the newer one
// is queued.
async function tell($: $, r: BuilderRun, s: Snapshot, seq: number) {
  if (seq < toldSeq) return
  toldSeq = seq
  toldWrites += 1
  try {
    const key = await promptedKey($, r)
    await inToldQueue(async () => {
      if (seq < toldSeq) return
      // The seen time first, so another session's prune never finds the new
      // snapshot without one.
      await $.store.set(seenKeyFor(key), await $.clock.now())
      await $.store.set(key, s)
    })
    // A head that differed from the told one has now been handed over, so the
    // interval goes back to what the other states set at once.
    await schedule($)
  } finally {
    toldWrites -= 1
  }
}

// A live session marks the pull request seen once a day even when nothing is
// delivered, so pruning only ever removes records of sessions that ended.
async function keepSeen($: $, r: BuilderRun) {
  const key = seenKeyFor(await promptedKey($, r))
  const now = await $.clock.now()
  const seen = await $.store.get(key)
  if (typeof seen !== 'number' || now - seen > SEEN_REFRESH_MS) await $.store.set(key, now)
}

// Drops the records of pull requests no session has looked at for two weeks,
// whichever session wrote them, so the store (refused past 4 MiB) does not
// fill up. A record without a seen time is adopted with one, and ages out
// two weeks later like any other.
async function pruneTold($: $) {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  const present = new Set(keys)
  for (const key of keys) {
    if (!key.startsWith(TOLD_PREFIX)) continue
    const seen = await $.store.get(seenKeyFor(key))
    // A record from before the seen key was kept (an older build of the mod)
    // is given a seen time rather than deleted, so a live session keeps it;
    // if no session looks again, it goes two weeks later like any other.
    if (typeof seen !== 'number') await $.store.set(seenKeyFor(key), now)
    else if (now - seen > TOLD_KEPT_MS) await forgetTold($, key)
  }
  // A seen key without its record is dropped once it is stale too, never
  // while fresh: a session writing a record writes its seen time first, so a
  // fresh one may belong to a record being written as this prune runs.
  for (const key of keys) {
    if (!key.startsWith(SEEN_PREFIX) || present.has(toldKeyFor(key))) continue
    const seen = await $.store.get(key)
    if (typeof seen !== 'number' || now - seen > TOLD_KEPT_MS) await $.store.delete(key)
  }
}

// A pull request closed without another review leaves its owed counsel
// decisions behind. Each is dropped ninety days after it was made, and one
// stored in another shape at once.
async function pruneOwed($: $) {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith(OWED_PREFIX)) continue
    const decision = owedIn(key, await $.store.get(key))
    if (decision === null || now - decision.at > OWED_KEPT_MS) await $.store.delete(key)
  }
}

// Runs `work`, a look that tells the session its own read, with a mark that
// lookAt puts in `untoldOwnReads` once the look goes on with its read,
// whether it stored that read or was overtaken. The mark is taken out when
// `work` finishes, whether it told the read, gave up at an early return, or
// threw, so it never outlives the look. Taking out a mark that lookAt never
// put in, because the look gave up before going on with its read, does
// nothing.
async function tellingOwnRead<T>(work: (ownRead: object) => Promise<T>): Promise<T> {
  const mark = {}
  try {
    return await work(mark)
  } finally {
    untoldOwnReads.delete(mark)
  }
}

// The read a delivering look hands over: the newest read in `newestRead`
// when it belongs to the same watch and is newer than the look's own, and
// otherwise the look's own read `s` under its own number `seq`. The answer is
// null, and the look hands over nothing, in three cases. First, while a
// told record is being written (see toldWrites), whichever look or tool
// writes it, because the record in the store may not yet say what the session
// was told, and a change measured against it could be one the session has
// just heard, such as the whole state the watch tool has just reported. The
// other two come from a look that tells the session its own read (the CI
// event's look or the known look). Second, while such a look has gone on with
// its read and not yet finished (see untoldOwnReads), because that look is
// about to tell the session the newest state, and a look that only observes
// may since have read the same state and kept it in `newestRead`, so handing
// that over would tell the session the same change twice. Third, when a look
// newer than the chosen read stored a read of its own, because that newer
// look is one whose reads `newestRead` never keeps; it has told the session
// its read, and the display already shows it, so handing over an older read
// would tell the session the pull request went backwards. No case loses a
// change: the poll that hands nothing over still schedules the next one,
// which compares the pull request with whatever was then recorded as told.
// When the CI event's prompt is refused, nothing records its read as told,
// its mark is taken out, and the next poll hands the change over; when a
// told write fails, `toldWrites` is lowered all the same, and the next poll
// hands the change over.
function newestFor(r: BuilderRun, s: Snapshot, seq: number): { s: Snapshot; seq: number } | null {
  if (toldWrites > 0 || untoldOwnReads.size > 0) return null
  const newest = newestRead !== null && newestRead.seq > seq && isSameRun(newestRead.r, r) ? newestRead : { s, seq }
  return newest.seq < newestStoredLook ? null : newest
}

// Hands a change over with a prompt, and answers whether it submitted one.
// A change held because the session's turn runs, or whose prompt was
// refused, marks its head as stalled, so the poll for it slows down.
// `s` and `seq` are the look's own read and its number, but the read handed
// over is the newest one a look of the same watch stored and left for others
// to tell (see newestFor), chosen again after the last await before the
// prompt. Nothing is handed over while a told record is being written,
// because the record read here may be the one from before it; while a look
// that tells its own read has stored one and not yet finished, or when such
// a look stored a read newer than the chosen one, because that look tells
// the session that state. The chosen read hands nothing over when its number
// is not newer than the read last recorded as told, because the session
// already has that state or a newer one and the difference would tell it the
// pull request went backwards; when it matches what the session was told;
// when another read was recorded as told after this handover began reading
// the told record, because the record it read is then out of date; or when
// the watch has changed since the look began. When the chosen read is merged
// or closed, the prompt also lists the counsel's decisions still owed to the
// pull request, because no review will list them now, and the keys it listed
// are deleted once the prompt is accepted. A refused prompt deletes none, so
// the next handover or the watch tool's answer lists them.
async function deliver($: $, r: BuilderRun, s: Snapshot, seq: number): Promise<boolean> {
  // Claimed before any await, so the poll and the end of a turn cannot both
  // pass this point and hand the same change over twice.
  if (isDelivering) return false
  isDelivering = true
  try {
    // The number of the read last recorded as told is noted before the told
    // record is read. While a later look records another read as told, the
    // record read here no longer says what the session was told, so a change
    // measured against it could be one the session has already heard. Every
    // call to `tell` claims its number before it writes the record and counts
    // itself in `toldWrites` from that claim until the write has finished or
    // failed, and nothing is handed over while that count is raised, so a
    // number that has not moved, with no write in flight, means the record
    // read here is the newest one. When it has moved, nothing is handed over:
    // the next poll compares the pull request with the new record, so a
    // change is delayed and never lost. A write already in flight as the
    // number is noted gives up at once, in the same step, because the read
    // below could begin before that write lands and answer with the old
    // record after it has landed and the count has dropped, and neither the
    // number nor the count would then show it.
    const toldSeqBeforeRead = toldSeq
    if (toldWrites > 0) return false
    const last = await told($, r)
    if (!(await stillWatching($, r))) return false
    const newest = newestFor(r, s, seq)
    if (newest === null || toldSeq !== toldSeqBeforeRead || newest.seq <= toldSeq || isSameState(last, newest.s)) return false
    if (await read($, busy)) {
      // The hold is recorded before busy is read a second time, with no await
      // between. The end of a turn clears busy before it checks for a hold, so
      // either that check sees this hold, or the second read sees that the
      // turn has ended and the change is handed over here, with no poll.
      // A failed read is not caught, as the first read's is not: the hold is
      // already recorded, so the end of the turn still hands the change over.
      isHeld = true
      if (await read($, busy)) {
        // Recorded again, because the end of a turn may have taken the hold
        // while the second read ran and a new turn begun since; that new
        // turn's end hands the change over.
        isHeld = true
        stalledHead = newestFor(r, s, seq)?.s.head ?? s.head
        return false
      }
      isHeld = false
    }
    // The decisions still owed to the pull request are read here, after the
    // reads of busy and before the read is chosen again, whatever state the
    // read seen so far had. A look that only observes can store a merged read
    // while busy is being read, and the read chosen below is then that one.
    // Had the decisions been read only for a merged read seen before busy, the
    // merge would be handed over with none listed, and since polling stops
    // once the pull request is not open, nothing would list them again until
    // the session called the watch tool. They are listed only when the chosen
    // read is merged or closed.
    const owed = await owedSafely($, r)
    // The read is chosen again here, after the last await, and every guard is
    // checked again with no await before the submit, because a newer look can
    // store a newer read, the desktop app's CI event or the look after a
    // posted review can record a read as told, which leaves the record read
    // above out of date, and a new watch can begin while the reads above run.
    // The guard on the number refuses a read with the same number as the one
    // last told, because the read chosen may be one another look has already
    // told. No await may be added between choosing the read and the submit.
    const chosen = newestFor(r, s, seq)
    if (
      chosen === null || !isCurrentWatch(r) || toldSeq !== toldSeqBeforeRead ||
      chosen.seq <= toldSeq || isSameState(last, chosen.s)
    ) return false
    // A turn may have started while the owed decisions were read, after busy
    // was last read. The change is then held for that turn's end, as the
    // second read of busy holds it, rather than queued behind the turn. The
    // end of a turn clears turnRunning before it checks the hold, so either
    // this check sees the turn, or that check sees this hold.
    if (turnRunning) {
      isHeld = true
      stalledHead = chosen.s.head
      return false
    }
    let listed: OwedDecision[] = []
    let decisions: string[] = []
    if (chosen.s.state !== 'OPEN') {
      listed = owed
      decisions = endedDecisionLines(r, chosen.s.state, owed.map(d => d.line))
    }
    const submitted = await $.prompt.submit({ text: changePrompt(chosen.s, changesBetween(last, chosen.s), decisions) })
    // Recorded only once the prompt is accepted, so a refused one is retried,
    // and its decisions are listed again.
    if (submitted.drop !== undefined) {
      stalledHead = chosen.s.head
      return false
    }
    // The told record is written first, with no await before it, and the
    // listed keys are deleted after it however that write ends, because the
    // session has the decisions once the prompt is accepted.
    try {
      await tell($, r, chosen.s, chosen.seq)
    } finally {
      await forgetListed($, listed)
    }
    return true
  } finally {
    isDelivering = false
  }
}

// The interval to the next poll, or null when no poll should be scheduled:
// nothing is watched, the pull request merged or closed, or a usage-limit
// hold is on.
async function nextPoll($: $, known?: Snapshot): Promise<{ ms: number; isNewHead: boolean } | null> {
  const r = await read($, run)
  if (r === null || (await isHoldOn($))) return null
  const s = known ?? await read($, pr)
  if (s !== null && s.state !== 'OPEN') return null
  const toldHead = (await told($, r))?.head ?? null
  return pollFor(s, toldHead, await read($, agents), await read($, questions), stalledHead)
}

// Sets the timer for the next look and records when it is due. Every look
// and every handover calls this, so calls overlap: the newest call decides,
// and the cancel, the new timer and the due time's write follow each other
// with no await between, so no older call can slip in among them.
// `keepSooner` is for a look that hands nothing over: it may bring the next
// poll forward but never put off one already due sooner, which would delay
// handing over a change that look saw.
async function schedule($: $, known?: Snapshot, keepSooner = false) {
  const gen = ++scheduleGen
  try {
    const poll = await nextPoll($, known)
    const now = await $.clock.now()
    if (gen !== scheduleGen) return
    // A sooner poll already pending is kept by a look that hands nothing over.
    const pending = timer !== undefined ? timerDue : undefined
    const isSoonerPollPending = poll !== null && pending !== undefined && pending > now && pending <= now + poll.ms
    if (keepSooner && isSoonerPollPending) {
      await update($, nextLook, () => ({ at: pending, isNewHead: poll.isNewHead }))
      return
    }
    timer?.cancel()
    timer = undefined
    timerDue = undefined
    if (poll === null) {
      stopTicker()
      await update($, nextLook, () => null)
      return
    }
    const at = now + poll.ms
    timerDue = at
    timer = $.clock.after(poll.ms, () => {
      // Each poll also compares the mod's files, so a watched session learns
      // that builder changed on disk without waiting for a turn end.
      void compareLoaded($).catch(() => undefined)
      // A look that read the pull request schedules the next one itself; one
      // that failed (gh offline, a timeout) or found nothing watched leaves it
      // to this.
      void look($, 'poll', 'deliver')
        .then(seen => (seen === null ? schedule($) : undefined))
        .catch(() => schedule($))
        .catch(() => undefined)
    })
    ticker ??= $.clock.every(REDRAW_MS, () => $.ui.invalidate('ui.render'))
    await update($, nextLook, () => ({ at, isNewHead: poll.isNewHead }))
  } catch {
    // With no look scheduled the display says so rather than show a wrong
    // time, and the next hook arms the poll again.
    if (gen !== scheduleGen) return
    timer?.cancel()
    timer = undefined
    timerDue = undefined
    stopTicker()
    armed = false
    await update($, nextLook, () => null).catch(() => undefined)
  }
}

// The looks after one of the session's own turns ends, which is how the mod
// learns of a head the session pushed in that turn and starts the short
// interval. Each turn end arms its own pair and cancels nothing, so a short
// turn never cancels the later look of the turn before it.
function armTurnEndLooks($: $) {
  for (const ms of AFTER_LOOK_MS) {
    $.clock.after(ms, () => {
      void look($, 'turn-end', 'observe').catch(() => null)
    })
  }
}

// The looks after the session's own push or merge, while its turn may go on,
// so the line does not say open for a pull request the session merged. A
// newer push or merge replaces the pair still pending.
function armCommandLooks($: $) {
  for (const pending of commandLooks) pending.cancel()
  commandLooks = AFTER_LOOK_MS.map(ms => $.clock.after(ms, () => {
    void look($, 'after-command', 'observe').catch(() => null)
  }))
}

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

async function ensureArmed($: $) {
  if (!isUnattendedArmed) {
    isUnattendedArmed = true
    void armUnattended($).catch(() => {
      isUnattendedArmed = false
    })
  }
  if (armed || (await read($, run)) === null) return
  armed = true
  await schedule($)
}

const isHoldOn = async ($: $) => holdIn(await read($, usageHold)) !== null

// Arms the hold's timer when a hold is on, and the stuck timer otherwise,
// from the atoms. The hold is armed with nothing watched too, so a hold in
// the spec stage comes back after a hot reload. When the hold cannot be read,
// neither timer can be chosen, so the whole of this step is tried again
// RESUME_FALLBACK_MS later in the hold's timer slot, under the hold's number
// as it stood before the read, before the failure goes on to ensureArmed. A
// new hold or a clear moves that number on and arms what follows, so the
// retry is armed only when the number has not moved, and it does nothing
// when it fires after a move. Nor is it armed when the slot holds a retry of
// the decision after a clear under that number, because it would replace
// that retry: it would find no hold and arm only the stuck prompt, which
// with nothing watched arms nothing, and the resume would never come. The
// decision's retry keeps the session armed on its own, since its failure
// arms it again.
async function armUnattended($: $) {
  const gen = holdGen
  let isOn: boolean
  try {
    isOn = await isHoldOn($)
  } catch (error) {
    if (gen === holdGen && holdTimer?.work !== 'after-clear') setHoldTimer($, gen, RESUME_FALLBACK_MS, 'arm')
    throw error
  }
  if (isOn) await armHold($)
  else await armStuck($)
}

// The hold's timer for a retry of armUnattended, armed under the hold's
// number `gen`. It does nothing once that number has moved on. When its own
// read of the hold is refused, armUnattended's catch arms the retry again,
// and then setHoldTimer's catch does the same, in the same slot and under the
// same number, so the second cancels the first and one retry is left.
async function armingRetry($: $, gen: number) {
  if (gen !== holdGen) return
  await armUnattended($)
}

// Restarts the quiet time at `at`, or now, unless it already stands later,
// and arms the stuck prompt from it. When the quiet time cannot be saved, the
// stuck prompt is still armed from `at` or now before the failure goes on to
// the caller, so a refused write never leaves the session with no stuck
// timer.
async function markQuiet($: $, at?: number) {
  const now = at ?? await $.clock.now()
  try {
    await update($, quietSince, last => Math.max(quietIn(last) ?? now, now))
  } catch (error) {
    await armStuck($, now)
    throw error
  }
  await armStuck($)
}

// Brings the stuck interval back to the first. It arms nothing, so that a
// caller arms the stuck prompt once, after whatever else it changes.
async function resetStuckInterval($: $) {
  await update($, stuckEvery, () => STUCK_FIRST_MS)
}

// What the stuck prompt is timed from, read from the atoms, or null when no
// stuck prompt is due at all: a hold is on, nothing is watched, the pull
// request is not open, or the session has not gone quiet since it started.
// `quietFrom` is a quiet time that could not be saved, which counts when it
// is later than the saved one.
async function stuckDue($: $, quietFrom?: number): Promise<{ r: BuilderRun; since: number; every: number; now: number } | null> {
  const r = await read($, run)
  const s = await read($, pr)
  const hold = holdIn(await read($, usageHold))
  const saved = quietIn(await read($, quietSince))
  const since = quietFrom === undefined ? saved : Math.max(saved ?? quietFrom, quietFrom)
  const every = stuckEveryIn(await read($, stuckEvery))
  const now = await $.clock.now()
  if (hold !== null || r === null || s === null || s.state !== 'OPEN' || since === null) return null
  return { r, since, every, now }
}

// Stops the stuck timer: moves its number on, so a stuck timer whose work is
// under way gives way at its next check, and cancels the timer. Answers the
// new number.
function stopStuckTimer(): number {
  stuckGen += 1
  stuckTimer?.cancel()
  stuckTimer = undefined
  return stuckGen
}

// Arms the stuck prompt for when the session will have been quiet for the
// current interval, in place of any timer armed before. Nothing is armed
// while a hold is on, with nothing watched, with the pull request not open,
// or before the session first went quiet. As in schedule, the newest call
// decides: the timer armed before is stopped before the first await, and only
// a call that no other has followed since arms a new one. A wait longer than
// TIMER_STEP_MS is taken in steps, so a value the engine's timer cannot hold
// never reaches it. `quietFrom` is for markQuiet, when the quiet time it
// restarts could not be saved. When stuckDue's reads fail and no newer call
// has taken over, the stuck prompt is armed again one interval from now, as
// after a failed fire, before the failure goes on to the caller. Most callers
// drop that failure, so without this one refused read would end the stuck
// prompt for good. A timer armed this way during a hold, or with nothing
// watched, finds that when it fires and does nothing.
async function armStuck($: $, quietFrom?: number) {
  const gen = stopStuckTimer()
  let due: Awaited<ReturnType<typeof stuckDue>>
  try {
    due = await stuckDue($, quietFrom)
  } catch (error) {
    if (gen === stuckGen) await rearmStuck($, gen)
    throw error
  }
  if (gen !== stuckGen || due === null) return
  setStuckTimer($, gen, stepDelay(due.since + due.every, due.now))
}

// Arms the stuck timer `ms` from now, numbered `gen`, to run fireStuck. When
// that work fails, as when a read of the state is refused, the stuck prompt
// is armed again rather than dropped, so a refused read cannot end the stuck
// prompt for good.
function setStuckTimer($: $, gen: number, ms: number) {
  stuckTimer = $.clock.after(ms, () => {
    void fireStuck($, gen).catch(() => rearmStuck($, gen)).catch(() => undefined)
  })
}

// Arms the stuck prompt again after the stuck timer's work failed. It counts
// one interval from now rather than from the saved quiet time, because the
// saved quiet time is already an interval old, so a timer counted from it
// would fire at once and spin for as long as the read stays refused. An
// interval that cannot be read counts as the first. A timer numbered `gen`
// whose number has moved on has given way to a newer arming, which is left
// alone when it armed a timer. When it armed none, because its own read
// failed, this one arms in its place. The wait is at most TIMER_STEP_MS, as
// each of armStuck's steps is, and a step that ends early arms the next.
async function rearmStuck($: $, gen: number) {
  if (gen !== stuckGen && stuckTimer !== undefined) return
  const retryGen = stopStuckTimer()
  const every = await read($, stuckEvery).then(stuckEveryIn, () => STUCK_FIRST_MS)
  if (retryGen !== stuckGen) return
  setStuckTimer($, retryGen, Math.min(every, TIMER_STEP_MS))
}

// The stuck timer's work. Once the session has been quiet for the interval
// with its pull request open, and nothing it could be waiting on is under
// way, it starts a turn asking the session whether its wait is real. A
// condition that fails restarts the quiet time, so the mod looks again one
// interval later. A prompt the engine accepts doubles the interval; a refused
// one leaves it as it was, because it never reached the session.
async function fireStuck($: $, gen: number) {
  if (gen !== stuckGen) return
  // The engine's list is read first, so an agent it has dropped no longer
  // counts as running. A read that ends a card restarts the quiet time, which
  // arms the stuck prompt again, so this one gives way to it.
  await refreshAgents($).catch(() => undefined)
  if (gen !== stuckGen) return
  const due = await stuckDue($)
  if (gen !== stuckGen || due === null) return
  const { r, since, every, now } = due
  // A wait taken in steps arms the next step.
  if (now - since < every) return armStuck($)
  const isWaiting = (await read($, busy))
    || (await read($, agents)).some(isRunning)
    || (await read($, questions)).some(q => !q.answered)
  // Checked with no await before the submit, as deliver does. A turn about a
  // real change is already coming when one is being handed over, one waits
  // for the turn to end, or a look has a read it has not told yet, so the
  // stuck prompt is dropped then too. It is dropped as well while a told
  // record is being written (see toldWrites), because the state being
  // recorded has just been put in front of the session. No await may be
  // added between this check and the call to submitClaimed, which claims the
  // submit at once.
  if (gen !== stuckGen) return
  if (
    isWaiting || turnRunning || isDelivering || isHeld || toldWrites > 0 ||
    untoldOwnReads.size > 0 || !isCurrentWatch(r)
  ) return markQuiet($)
  const isAccepted = await submitClaimed($, stuckPrompt(r.number, now - since))
  // This timer has fired, so the stuck prompt is armed again even when the
  // doubled interval cannot be saved.
  try {
    if (isAccepted) await update($, stuckEvery, ms => nextStuckEvery(stuckEveryIn(ms)))
  } finally {
    await markQuiet($)
  }
}

// Submits one of the mod's own prompts, the stuck prompt or the resume
// prompt, and answers whether the engine accepted it. A submit that throws
// counts as refused. isDelivering is claimed before the first await and given
// back however the submit ends, so a caller that checks isDelivering and then
// calls this with no await between knows no other prompt is being submitted.
async function submitClaimed($: $, text: string): Promise<boolean> {
  isDelivering = true
  try {
    return (await $.prompt.submit({ text })).drop === undefined
  } catch {
    return false
  } finally {
    isDelivering = false
  }
}

// Whether the session is running /implement: a pull request is watched or a
// stage was reported, and the work has not ended by the test the bar uses.
async function isImplementing($: $): Promise<boolean> {
  const r = await read($, run)
  const p = progressIn(await read($, progress))
  if (r === null && p === null) return false
  const s = await read($, pr)
  return endedOf(p, isDrawable(s) ? s : null, r?.since ?? null) === null
}

// Decides, for the session's own turn that an error ended at `endedAt`,
// whether a usage window ran out, and starts the hold when one did. Only one
// decision runs at a time. One asked for while another runs is owed rather
// than dropped: once the running one ends without a hold, it decides again
// for the turn then pending, which may be a turn that ended while it waited
// on the usage report. Answers whether a hold started.
async function decideHold($: $, endedAt: number): Promise<boolean> {
  if (isDecidingHold) {
    isHoldOwed = true
    return false
  }
  isDecidingHold = true
  try {
    let at: number | undefined = endedAt
    while (at !== undefined) {
      isHoldOwed = false
      if (await holdsFor($, at)) return true
      at = isHoldOwed ? pendingErrorTurn?.endedAt : undefined
    }
    return false
  } finally {
    isDecidingHold = false
    isHoldOwed = false
  }
}

// One decision of decideHold's. The usage report is read first, and the
// StopFailure mark after that read, because the hook may land while the read
// runs. With neither signal the turn stays pending, for a StopFailure that
// comes later.
async function holdsFor($: $, endedAt: number): Promise<boolean> {
  if (!(await isImplementing($))) return false
  let windows: ReturnType<typeof exhaustedWindows> = []
  try {
    windows = exhaustedWindows((await $.session.usage()).rateLimits)
  } catch {
    // The hold then rests on the StopFailure mark alone.
  }
  // A turn that started meanwhile decides again when it ends, or, when it
  // ended meanwhile too, through the decision it left owed.
  const turn = pendingErrorTurn
  if (turn?.endedAt !== endedAt) return false
  if (windows.length === 0 && !rateLimitSeen) return false
  return startHold($, resumeAt(windows, endedAt), turn.personPrompts, turn.turnsStarted)
}

// The end of the session's own turn that an error ended: answers whether a
// hold started. `turnsStarted` is the number of the session's own turns
// started when that end began, counted before its first await. A failure in
// it starts none, so the turn's end goes on as after any other turn.
async function errorTurnHolds($: $, turnsStarted: number): Promise<boolean> {
  try {
    const endedAt = await $.clock.now()
    pendingErrorTurn = { endedAt, personPrompts, turnsStarted }
    return await decideHold($, endedAt)
  } catch {
    return false
  }
}

// Starts a hold until `until`, in place of any hold before it, unless a
// person's prompt has come since the number of the person's prompts stood at
// `prompted`. Such a prompt clears a hold, so a hold started after it would
// last through the person's turn and send a resume prompt nobody wants. When
// the hold starts, the looks after a push or merge still pending are
// cancelled, the stuck prompt and the poll stop, and the hold's timer is
// armed. `turnsStarted` is the number of the session's own turns started when
// the turn the hold is for ended, or when the resume prompt that was refused
// was tried, which saveHoldOrTakeItOff compares after the save. Answers
// whether a hold started.
async function startHold($: $, until: number, prompted: number, turnsStarted: number): Promise<boolean> {
  pendingErrorTurn = null
  if (personPrompts !== prompted) return false
  const isTakenOff = await saveHoldOrTakeItOff($, until, prompted, turnsStarted)
  if (isTakenOff) return false
  stopHoldTimer()
  for (const pending of commandLooks) pending.cancel()
  commandLooks = []
  await schedule($)
  await armHold($)
  return true
}

// Saves the hold for startHold, and answers whether it came off again. A
// person's prompt that comes while the save is under way may read no hold yet
// and leave the saved one in place, so the number of the person's prompts is
// checked again after the save, and the hold is taken off when it moved on;
// the poll and the stuck prompt then start again. A turn of the session's own
// that starts and ends with an answer or a refusal after the turn the hold is
// for ended, whether while the end was still deciding the hold or while the
// save was under way, may likewise read no hold yet at its end (see
// repliedTurnClearsHold). So the hold is taken off too when the last turn that
// replied is past `turnsStarted`, the number of turns started when the turn
// the hold is for ended. A turn that started meanwhile and still runs leaves
// the hold for its own end to decide. When taking it off is refused, the hold
// stays on, and the answer is that it did not come off, so that startHold arms
// its timer and its resume time still comes. With neither a timer nor the
// poll, the session would otherwise wait until the person typed again.
async function saveHoldOrTakeItOff($: $, until: number, prompted: number, turnsStarted: number): Promise<boolean> {
  // Stopped before the hold is saved, so a stuck timer whose last check runs
  // while the save is under way gives way instead of missing the hold. That
  // leaves no stuck timer, so when the save is refused and no hold is on, the
  // stuck prompt is armed again before the failure goes on.
  stopStuckTimer()
  try {
    await update($, usageHold, () => ({ until }))
  } catch (error) {
    await armStuck($)
    throw error
  }
  if (personPrompts === prompted && repliedTurn <= turnsStarted) return false
  try {
    await update($, usageHold, () => null)
  } catch {
    return false
  }
  await schedule($)
  await armStuck($)
  return true
}

// Stops the hold's timer: moves the hold's number on, so a timer of the hold
// whose work is under way gives way at its next check, and cancels the timer.
// Answers the new number.
function stopHoldTimer(): number {
  holdGen += 1
  holdTimer?.cancel()
  holdTimer = undefined
  return holdGen
}

// Arms the hold's timer for its resume time, in steps of at most
// TIMER_STEP_MS, because a reset a month away is longer than the engine's
// longest timer. A step that ends before the resume time arms the next.
// When the hold or the time cannot be read, the hold's timer is armed anyway,
// RESUME_FALLBACK_MS from now under the same number, before the failure goes
// on to the caller. A hold saved just before keeps the stuck prompt off, so
// without this a refused read here would leave the session with neither
// timer. The timer that fires reads the hold again, arms the rest of the wait
// when the resume time is still ahead, and does nothing when no hold is on.
async function armHold($: $) {
  const gen = holdGen
  let hold: ReturnType<typeof holdIn>
  let now: number
  try {
    hold = holdIn(await read($, usageHold))
    now = await $.clock.now()
  } catch (error) {
    if (gen === holdGen) setHoldTimer($, gen, RESUME_FALLBACK_MS, 'resume')
    throw error
  }
  if (gen !== holdGen) return
  if (hold === null) {
    // This cancels without moving holdGen on, because armHold arms under the
    // current number and moving it on would make its own timer do nothing.
    holdTimer?.cancel()
    holdTimer = undefined
    return
  }
  setHoldTimer($, gen, stepDelay(hold.until, now), 'resume')
}

// The work the hold's timer does when it fires: resumeFromHold for a hold
// that is on, resumeAfterClear for a hold its number already cleared, and
// armingRetry for an arming that could not read the hold.
type HoldWork = 'resume' | 'after-clear' | 'arm'

// Cancels the hold's timer and arms one in its place that does `work` for the
// hold numbered `gen`, `ms` from now. When that work fails, as when a read of
// the state is refused, and the hold's number has not moved on since, the
// timer is armed again RESUME_FALLBACK_MS later under the same number and for
// the same work, so a refused read cannot end the resume, or the arming, for
// good. A number that has moved on means a clear or a new hold took over, and
// that one arms what follows.
function setHoldTimer($: $, gen: number, ms: number, work: HoldWork) {
  holdTimer?.cancel()
  const timer = $.clock.after(ms, () => {
    // A timer that has fired is no longer armed, unless another has taken
    // its place since.
    if (holdTimer === armed) holdTimer = undefined
    void doHoldWork($, gen, work)
      .catch(() => {
        if (gen === holdGen) setHoldTimer($, gen, RESUME_FALLBACK_MS, work)
      })
      .catch(() => undefined)
  })
  const armed = { cancel: () => timer.cancel(), work }
  holdTimer = armed
}

// Does the work a hold's timer was armed for, for the hold numbered `gen`.
function doHoldWork($: $, gen: number, work: HoldWork): Promise<void> {
  switch (work) {
    case 'resume':
      return resumeFromHold($, gen)
    case 'after-clear':
      return resumeAfterClear($, gen)
    case 'arm':
      return armingRetry($, gen)
  }
}

// The hold's timer. Before the resume time it waits another step. At the
// resume time it clears the hold first, reads the watched pull request once,
// and then starts the turn that carries on /implement, unless the work has
// ended or a turn already runs, whose end decides again. A clear that fails
// sends nothing and tries again RESUME_FALLBACK_MS later, so the hold does
// not last until the person types. A resume prompt the engine refuses, or one
// whose submit fails, holds again for RESUME_FALLBACK_MS. A decision after the
// clear that fails is tried again RESUME_FALLBACK_MS later.
async function resumeFromHold($: $, gen: number) {
  if (gen !== holdGen) return
  const hold = holdIn(await read($, usageHold))
  const now = await $.clock.now()
  if (gen !== holdGen || hold === null) return
  if (now < hold.until) return armHold($)
  // Clearing the hold starts the poll again and restarts the quiet time, so
  // an accepted prompt needs nothing more.
  let cleared: number
  try {
    cleared = await clearHold($)
  } catch {
    // clearHold fails only when the hold's own write does, so the hold is
    // still on. It moved the hold's number on and cancelled the timer before
    // it failed, so the retry is armed under the number as it stands now. A
    // person's prompt or a new hold moves it on again, and the retry then
    // does nothing.
    setHoldTimer($, holdGen, RESUME_FALLBACK_MS, 'resume')
    return
  }
  // The hold is off now, so a retry of resumeFromHold would find no hold and
  // send nothing. When the decision after the clear fails, as when one of its
  // reads is refused, or when a refused resume prompt's new hold cannot be
  // saved, the decision alone is tried again RESUME_FALLBACK_MS later under
  // the number the clear left. With nothing watched there is no stuck prompt
  // to fall back on, so without this the session would be left with no hold,
  // no turn and no timer. A person's prompt or a new hold moves the number
  // on, and the retry then does nothing.
  try {
    await resumeAfterClear($, cleared)
  } catch {
    if (cleared === holdGen) setHoldTimer($, cleared, RESUME_FALLBACK_MS, 'after-clear')
  }
}

// The decision resumeFromHold makes once it has cleared the hold numbered
// `cleared`, and its retry when that decision failed. It sends the resume
// prompt unless the hold's number has moved on, the work has ended or a turn
// already runs. A resume prompt the engine refuses, or one whose submit
// fails, holds again for RESUME_FALLBACK_MS.
async function resumeAfterClear($: $, cleared: number) {
  if (cleared !== holdGen) return
  // No look ran during the hold, and the looks after a push or merge still
  // pending when it began were cancelled, so the stored pull request may
  // still say open for one merged or closed just before the limit. One look
  // that hands nothing over reads it now, before the decision. It runs after
  // the clear, so lookAt's hold guard does not stop it. With nothing watched,
  // as in a hold during the spec or the build, there is nothing to read. A
  // look that fails leaves the decision to the stored pull request.
  if ((await read($, run)) !== null) await look($, 'resume', 'observe').catch(() => null)
  const stage = progressIn(await read($, progress))?.stage
  if (!(await isImplementing($)) || (await read($, busy))) return
  // The checks and the claim follow each other with no await between, so the
  // resume prompt goes out only if, at that moment, no person's prompt has
  // come and no hold has started since the clear (either moves the hold's
  // number on), no turn of the session's own runs, and no other prompt is
  // being submitted. `busy` cannot be read without an await, so turnRunning
  // stands for it here. No await may be added between these checks and the
  // call to submitClaimed, which claims the submit at once.
  if (cleared !== holdGen || turnRunning || isDelivering) return
  const prompted = personPrompts
  const turnsStarted = ownTurnsStarted
  const isAccepted = await submitClaimed($, resumePrompt(stage === undefined ? null : stageLabel(stage)))
  if (!isAccepted) await startHold($, (await $.clock.now()) + RESUME_FALLBACK_MS, prompted, turnsStarted)
}

// Ends the hold: the poll starts again, and the quiet time restarts, so the
// stuck prompt counts from the end of the hold rather than from the turn the
// limit stopped. The hold's number moves on and its timer is cancelled before
// the first await, so a timer of the hold that is still under way gives way
// at once. Answers the hold's number as this clear left it, so a caller can
// tell whether anything moved it on since. It throws only when the hold's own
// write fails.
async function clearHold($: $): Promise<number> {
  const gen = stopHoldTimer()
  await update($, usageHold, () => null)
  // The hold is off once that write lands, so nothing after it fails the
  // clear: a caller that tried the clear again would find no hold and do
  // nothing, and the session would get neither the resume prompt nor the
  // stuck prompt. markQuiet arms the stuck prompt even when it cannot save the
  // quiet time.
  await schedule($).catch(() => undefined)
  await markQuiet($).catch(() => undefined)
  return gen
}

// The end of a turn of the session's own that ended with an answer or a
// refusal. The API replied, so the usage limit is not in force, and a saved
// hold comes off as the person's prompt takes it off: with no resume prompt,
// and with the poll and the stuck prompt started again. When the hold cannot
// be read, nothing is touched, so the hold's timer stays as it was. When
// taking the hold off is refused, the hold is still on, and clearHold has
// cancelled its timer, so the timer is armed again and the resume time still
// comes. It arms nothing unless that clear was refused, because armHold with
// no hold saved cancels a retry waiting in the hold's timer slot. It never
// fails, so the turn's end goes on as after any other turn. `turnsStarted` is
// the number of turns started when this turn ended. When a turn of the
// session's own has started since, a hold found here may be that later turn's,
// saved because the limit stopped it after this turn replied, so the hold is
// left alone and that turn's own end decides it. The number is checked after
// the read of the hold too, because a later turn may start while the read is
// under way.
async function repliedTurnClearsHold($: $, turnsStarted: number) {
  if (ownTurnsStarted !== turnsStarted) return
  let isOn: boolean
  try {
    isOn = await isHoldOn($)
  } catch {
    return
  }
  if (!isOn || ownTurnsStarted !== turnsStarted) return
  try {
    await clearHold($)
  } catch {
    await armHold($).catch(() => undefined)
  }
}

// A prompt the person started a turn with brings the stuck interval back to
// the first, and clears a hold at once, with no resume turn. Every other
// prompt, the mod's own among them, changes neither. Before the first await,
// the number of the person's prompts moves on, so a hold being decided while
// this runs is not started (see startHold), and the hold's number moves on
// and its timer is cancelled, so a resume time that falls while this runs
// sends no resume prompt beside the person's, whether its timer has yet to
// fire or has fired and not yet submitted. With no hold on, the hold's number
// touches nothing else, because only the hold's timer and its arming read
// it. The interval is reset next, so the stuck prompt is armed once, from it:
// by clearing the hold, or here when no hold is on. When the rest fails, the
// hold's timer is armed again for a hold still on.
//
// The person's prompt also answers whatever question the counsel left for
// them, but that reset lives in the prompt.submit hook rather than here. It
// awaits, so it cannot come before the count and the timer move. It also has
// to come after the look for the foreman's ticket, which awaits as well and so
// runs after this: a session that takes its memo up only at this prompt, a
// resumed one or one after a hot reload, has no memo to clear until that look
// has run.
async function personPromptResets($: $, origin: PromptOrigin, text: string) {
  if (!isPersonPrompt(origin, text)) return
  personPrompts += 1
  stopHoldTimer()
  try {
    await resetStuckInterval($)
    if (await isHoldOn($)) await clearHold($)
    else await armStuck($)
  } catch (error) {
    await armHold($).catch(() => undefined)
    throw error
  }
}

// The pull request is read before anything changes, so a wrong number leaves
// the one already watched in place.
async function watch($: $, target: Omit<BuilderRun, 'since'>): Promise<Snapshot | null> {
  const s = await fetchSnapshot($, target)
  if (s === null) return null
  const previous = await read($, run)
  // Always later than the watch it replaces, even within one millisecond.
  const r: BuilderRun = { ...target, since: Math.max(await $.clock.now(), (previous?.since ?? 0) + 1) }
  currentSince = r.since
  newestRead = null
  await update($, run, () => r)
  await update($, pr, () => s)
  if (previous !== null && (previous.repo !== r.repo || previous.number !== r.number)) {
    // Through the told queue, so a write for the previous pull request that
    // is already queued cannot land after the delete and bring it back.
    const previousKey = await promptedKey($, previous)
    await inToldQueue(() => forgetTold($, previousKey))
  }
  // Armed before the state is recorded as told, because recording it
  // schedules the first poll of this watch.
  armed = true
  await tell($, r, s, ++lookSeq)
  await recordWake($, { at: r.since, source: 'watch', changed: true })
  return s
}

type WatchInput = { number: number; repo?: string }

async function serveWatch($: $, input: WatchInput): Promise<string> {
  if (!Number.isInteger(input.number) || input.number <= 0) return `${String(input.number)} is not a pull request number.`
  const dir = await read($, cwd)
  const [repo, login] = await Promise.all([
    input.repo ?? gh($, dir, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
    gh($, dir, ['api', 'user', '--jq', '.login']),
  ])
  if (!repo || !login) return 'Could not read the repository or the gh login from this folder.'
  const s = await watch($, { repo, number: input.number, cwd: dir ?? '.', login })
  if (s === null) return `gh could not read ${repo}#${input.number}; still watching what was watched before.`
  const lines = ['Watching this pull request.', ...stateLines(s)]
  // A pull request that merged or closed gets no further review, so the
  // decisions still owed to it are listed here and their keys deleted. This
  // reaches a session resumed after a restart, which the change prompt for
  // the merge or the close never reached. An open pull request's are left
  // for its next review, and not even read.
  if (s.state !== 'OPEN') {
    const owed = await owedSafely($, s)
    const ended = endedDecisionLines(s, s.state, owed.map(d => d.line))
    if (ended.length > 0) lines.push('', ...ended)
    await forgetListed($, owed)
  }
  return lines.join('\n')
}

// The engine keeps only the first 4 MiB of a command's output. A cut-off
// output is treated as a failure, so a package never holds part of a diff
// that reviewers would take for all of it. A command that throws, because it
// could not start or ran past its timeout, counts as a failure too.
async function git($: $, dir: string, args: string[]): Promise<string | null> {
  const ran = await gitRun($, dir, args)
  return ran !== null && ran.exitCode === 0 ? ran.stdout : null
}

// A git command's exit code and output, for a caller that reads the exit code
// itself, or null when it threw or its output was cut off.
async function gitRun($: $, dir: string, args: string[]): Promise<{ exitCode: number; stdout: string } | null> {
  try {
    const ran = await $.process.run(['git', ...args], { cwd: dir, timeoutMs: COMMAND_TIMEOUT_MS })
    return ran.isStdoutTruncated ? null : { exitCode: ran.exitCode, stdout: ran.stdout }
  } catch {
    return null
  }
}

// The checkout the mod was loaded from: its own folder with links resolved,
// since the mod is usually loaded through a link into a git checkout. Null
// when the folder cannot be resolved.
async function modCheckoutOf($: $): Promise<string | null> {
  try {
    return (await $.fs.stat($.plugin.root, { resolve: true })).realPath ?? null
  } catch {
    return null
  }
}

// The commit a checkout stands at, or null when git cannot say, as in a
// folder that is not a checkout.
async function headOf($: $, dir: string): Promise<string | null> {
  return (await git($, dir, ['rev-parse', 'HEAD']))?.trim() || null
}

// Whether the files `paths` name differ between `commit` and `head`, the
// commit compareLoaded read. It names that commit rather than the word HEAD,
// which git resolves only when it starts, so a checkout that moves away and
// back between compareLoaded's two reads of HEAD cannot have its result
// stored under the wrong commit. Only exit code 1 says they do: an error, a
// throw or cut-off output says nothing, so a broken git never warns.
async function filesDiffer($: $, dir: string, commit: string, head: string, paths: readonly string[]): Promise<boolean> {
  return (await gitRun($, dir, ['diff', '--quiet', commit, head, '--', ...paths]))?.exitCode === 1
}

// Compares the commits the mod was loaded from with its checkout's HEAD, at
// each load of the hooks, at the end of every turn of the session's own, and
// on each poll. It reads HEAD and stops there when the read fails or
// dueComparisons says no comparison is needed. Otherwise it runs git diff for
// each part that is due against the commit it read and reads HEAD again, and
// keeps what it found only if HEAD has not moved meanwhile. A slower result
// that still lands over a newer one names the older HEAD, so the next
// comparison sees the difference and compares again. The exception is a hot
// reload and a comparison at the new head that both finish before the slower
// write: the stored head then already names the new commit, so the stale
// result lasts until HEAD next moves, which the spec accepts.
async function compareLoaded($: $) {
  const dir = await modCheckoutOf($)
  if (dir === null) return
  const head = await headOf($, dir)
  if (head === null) return
  const l = loadedIn(await read($, loaded))
  const due = l === null ? null : dueComparisons(l, head)
  if (due === null) return
  const found: Found[] = []
  for (const comparison of due) {
    found.push({ ...comparison, differs: await filesDiffer($, dir, comparison.commit, head, LOADED_PATHS[comparison.part]) })
  }
  if ((await headOf($, dir)) !== head) return
  await update($, loaded, prev => {
    const recorded = loadedIn(prev)
    return recorded === null ? prev : afterComparison(recorded, head, found)
  })
}

// Records a load of the hooks module, at its first start in the session and
// at each hot reload, through afterLoad, and then compares. HEAD is read at
// the start of the load, so files git is still writing can only make it warn
// too much, and their writes start another reload. How the first load of this
// build began is settled by loadBegunAs and written before any git runs, so a
// reload that comes while this load waits on git finds it, and leaves the
// session commit for this load to record. The session's folder is read first,
// before the session start that called this sets it.
async function loadHooks($: $) {
  const cwdSet = (await read($, cwd)) !== null
  // The updater both decides how the first load began and writes it, so the
  // decision is made from the value stored at the moment of the write and not
  // from an earlier read that a reload could have overtaken. `begun` keeps
  // what it decided, because the atom's own type also allows null, and
  // `first` whether this load found nothing stored, which makes it the first
  // load of this build.
  let begun: LoadBegun = 'atStart'
  let first = false
  await update($, loadBegun, stored => {
    first = loadBegunIn(stored) === null
    begun = loadBegunAs(stored, cwdSet)
    return begun
  })
  const dir = await modCheckoutOf($)
  const head = dir === null ? null : await headOf($, dir)
  await update($, loaded, prev => afterLoad(loadedIn(prev), head, begun, first))
  await compareLoaded($)
}

// The project's documents the package names. Each is a `Label: path` line
// anywhere in the project's CLAUDE.md, else the default, and is named only if
// the file exists. The mod's README lists these labels.
async function projectDocuments($: $, dir: string): Promise<{ architecture: string | null; gotchas: string | null }> {
  const claude = await $.fs.read(`${dir}/CLAUDE.md`).catch(() => '')
  const text = typeof claude === 'string' ? claude : ''
  return {
    architecture: await documentPath($, dir, factIn(text, 'Architecture document') ?? 'docs/architecture.md'),
    gotchas: await documentPath($, dir, factIn(text, 'Gotchas document') ?? 'docs/gotchas.md'),
  }
}

// A path the branch's CLAUDE.md names must stay inside the checkout, so a
// reviewer is never sent to read a file elsewhere on the machine.
async function documentPath($: $, dir: string, path: string): Promise<string | null> {
  return (await placeOf($, dir, await checkoutPath($, dir), path)) === 'file' ? path : null
}

// Where the checkout really is, with links resolved, so each path checked
// against it is compared with the same answer.
async function checkoutPath($: $, dir: string): Promise<string | undefined> {
  return (await $.fs.stat(dir, { resolve: true })).realPath
}

// Where a relative path leads: a file or something else inside the checkout,
// nowhere yet, or outside the checkout. `root` is the checkout's resolved
// path, from checkoutPath.
async function placeOf($: $, dir: string, root: string | undefined, path: string): Promise<'file' | 'other' | 'missing' | 'outside'> {
  if (path.startsWith('/') || path.split('/').includes('..')) return 'outside'
  if (!(await $.fs.exists(`${dir}/${path}`))) return 'missing'
  // Resolved, so a link committed on the branch cannot point outside either.
  const file = await $.fs.stat(`${dir}/${path}`, { resolve: true })
  const inside = file.realPath !== undefined && root !== undefined && file.realPath.startsWith(`${root}/`)
  if (!inside) return 'outside'
  return file.kind === 'file' ? 'file' : 'other'
}

// Which of the named paths do not exist yet, or the first one that leads
// outside the checkout.
async function unwrittenPaths($: $, dir: string, paths: readonly string[]): Promise<{ unwritten: string[]; outside: string | null }> {
  const unwritten: string[] = []
  const root = await checkoutPath($, dir)
  for (const path of paths) {
    const place = await placeOf($, dir, root, path)
    if (place === 'outside') return { unwritten, outside: path }
    if (place === 'missing') unwritten.push(path)
  }
  return { unwritten, outside: null }
}

// The checkout's git folder, or null when git cannot say.
async function gitDirOf($: $, dir: string): Promise<string | null> {
  return (await git($, dir, ['rev-parse', '--absolute-git-dir']))?.trim() || null
}

// The checkout of the watched pull request: the worktree that has its head
// branch checked out, asked of git from `from` each time, else `from` itself.
// The list includes the main checkout, so a main checkout that has the branch
// out is found too. A null from git covers an error exit, a throw and cut-off
// output, and all three fall back to `from`. The package and review tools find
// the folder by this same rule from the same field, so they agree whenever the
// worktrees have not changed in between.
async function checkoutOf($: $, from: string, branch: string): Promise<Checkout> {
  const listing = await git($, from, ['worktree', 'list', '--porcelain', '-z'])
  if (listing === null) return { dir: from, branch, how: 'unlisted' }
  const dir = worktreeWithBranch(listing, branch)
  return dir === null ? { dir: from, branch, how: 'no-worktree' } : { dir, branch, how: 'worktree' }
}

// Derived files for one head, kept inside the checkout's git folder so they
// are never committed and go away with the worktree. Writing a file creates
// its folders.
async function packageDir($: $, dir: string, head: string): Promise<string | null> {
  const gitDir = await gitDirOf($, dir)
  return gitDir === null ? null : `${gitDir}/builder/${head.slice(0, 8)}`
}

// The folder that holds the session's counsel briefs, one folder per question,
// beside the review packages in the checkout's git folder. It is found from
// the session folder so it works with no pull request watched. Every session
// in the checkout shares the git folder, so the folder is named by the session.
async function counselDir($: $, dir: string): Promise<string | null> {
  const gitDir = await gitDirOf($, dir)
  return gitDir === null ? null : `${gitDir}/builder/counsel/${await $.session.id()}`
}

type PrForReview = GhPullRequest & { baseRefName: string; headRefName: string }

async function livePullRequest($: $, r: BuilderRun): Promise<PrForReview | null> {
  const out = await gh($, r.cwd, ['pr', 'view', String(r.number), '--repo', r.repo, '--json', `${PR_FIELDS},baseRefName,headRefName`])
  if (out === null) return null
  try {
    return JSON.parse(out) as PrForReview
  } catch {
    return null
  }
}

async function servePackage($: $, input: PackageInput): Promise<string> {
  const r = await read($, run)
  if (r === null) return 'No pull request is watched; call the watch tool first.'
  const live = await livePullRequest($, r)
  if (live === null) return `gh could not read ${r.repo}#${r.number}.`
  // Every git command and the project's documents use the folder found here,
  // and a refusal names it, so a wrong folder is never compared in silence.
  const checkout = await checkoutOf($, r.cwd, live.headRefName)
  const checkoutDir = checkout.dir
  const local = (await git($, checkoutDir, ['rev-parse', 'HEAD']))?.trim()
  if (local !== live.headRefOid) {
    return `The checkout is at ${local?.slice(0, 8) ?? 'an unknown commit'} but the pull request's head is ${live.headRefOid.slice(0, 8)}; push or pull first. ${checkoutSentence(checkout)}`
  }
  if ((await git($, checkoutDir, ['fetch', '-q', 'origin', live.baseRefName])) === null) {
    return `git could not fetch the base, ${live.baseRefName}, so the diff against it would be stale.`
  }
  const range = `origin/${live.baseRefName}...HEAD`
  // The full messages are read beside the diff, because the findings already
  // decided and the areas fixed so far are read from them. A package without
  // them would tell the reviewers that nothing was decided, so a failed read
  // refuses the package as a failed diff does.
  const [stat, diff, commits, messages, dir] = await Promise.all([
    git($, checkoutDir, ['diff', '--stat', range]),
    git($, checkoutDir, ['diff', range]),
    git($, checkoutDir, ['log', '--reverse', '--name-status', '--format=%h %s', `origin/${live.baseRefName}..HEAD`]),
    git($, checkoutDir, ['log', '--reverse', '--format=%H%x1f%B%x1e', `origin/${live.baseRefName}..HEAD`]),
    packageDir($, checkoutDir, live.headRefOid),
  ])
  if (stat === null || diff === null || commits === null || messages === null || dir === null) {
    return 'git could not produce the whole diff against the base or the commit messages (it failed, or its output was over 4 MiB and cut off), so no package was written.'
  }

  // The round and the earlier rounds come from the same live read, so the
  // package never states a round behind the reviews it lists.
  const earlier = (live.reviews ?? [])
    .filter(review => review.author?.login === r.login && verdictsOf(review) !== null)
    .map(review => ({ sha: review.commit?.oid ?? '', body: review.body ?? '' }))
  const records = commitRecordsOf(messages)
  const trend = trendOf(records)
  const text = packageText(input, {
    repo: r.repo,
    number: r.number,
    head: live.headRefOid,
    base: live.baseRefName,
    stat,
    commits,
    round: roundInProgress(snapshotOf(r.repo, live, r.login)),
    ...(await projectDocuments($, checkoutDir)),
    earlier,
    decided: decidedItems(records, earlier),
    trend,
  })
  await $.fs.write(`${dir}/package.md`, text)
  await $.fs.write(`${dir}/diff.patch`, diff)
  // Recorded only once both files are written, so the pane plans the focused
  // reviewers only for a package they can read.
  const packagedAt = await $.clock.now()
  await update($, packaged, () => ({ head: live.headRefOid, at: packagedAt }))
  $.ui.invalidate('ui.render')
  // A streak that stops the rounds comes first, so the session reads it
  // before it launches any reviewer on the package.
  const stop = trendStopLine(trend)
  return [
    ...(stop === null ? [] : [stop]),
    `Review package for ${live.headRefOid.slice(0, 8)}:`,
    `Head: ${live.headRefOid}`,
    `${dir}/package.md`,
    `${dir}/diff.patch`,
    'Give every reviewer the folder and the full head sha.',
  ].join('\n')
}

const isVerdict = (value: unknown): value is Verdict => value === 'APPROVE' || value === 'REQUEST_CHANGES'

type ReviewInput = { head: string; spec: Verdict; adversarial: Verdict; body: string }

// GitHub refuses an approval or a change request on one's own pull request,
// and the session posts under the same login that opened it, so every review
// is a comment. The verdict lives in its first line, which the snapshot reads.
async function serveReview($: $, input: ReviewInput): Promise<string> {
  const r = await read($, run)
  if (r === null) return 'No pull request is watched; call the watch tool first.'
  if (!isVerdict(input.spec) || !isVerdict(input.adversarial)) {
    return 'Refused: each verdict must be APPROVE or REQUEST_CHANGES, exactly as the reviewer\'s VERDICT line says.'
  }
  // Only the session's own text is refused for a secret, since only the
  // session can remove it. The counsel's decisions owed to this pull request
  // are appended after the check, read from the store so that a decision made
  // before a restart, or by another session, is listed too; reviewParagraph
  // leaves out any decision line that looks like it holds a secret.
  const secret = secretIn(input.body)
  if (secret !== null) return `Refused: the body looks like it holds ${secret}. Remove it and post again.`
  const live = await livePullRequest($, r)
  if (live === null) return `gh could not read ${r.repo}#${r.number}.`
  if (live.headRefOid !== input.head) {
    return `Refused: the pull request's head is ${live.headRefOid.slice(0, 8)}, not the reviewed ${input.head.slice(0, 8)}. Review the new head.`
  }
  if (snapshotOf(r.repo, live, r.login).verdicts !== null) {
    return `Refused: a verdict review is already posted at ${input.head.slice(0, 8)}. One review per round.`
  }
  // The body is staged beside the package, in the git folder of the checkout
  // found as the package tool finds it. The post itself works from any
  // checkout, so it keeps the session's folder.
  const checkout = await checkoutOf($, r.cwd, live.headRefName)
  const dir = await packageDir($, checkout.dir, input.head)
  if (dir === null) return 'Could not find the checkout\'s git folder to stage the review body.'
  // Read only for a post that will go out, after the checks that can refuse it.
  const owed = await owedDecisions($, r)
  const paragraph = reviewParagraph(owed.map(d => d.line))
  const body = paragraph === null ? input.body.trim() : `${input.body.trim()}\n\n${paragraph}`
  const file = `${dir}/review.md`
  await $.fs.write(file, `${verdictsLine(input.head, input.spec, input.adversarial)}\n\n${body}\n`)
  const posted = await gh($, r.cwd, [
    'api', `repos/${r.repo}/pulls/${r.number}/reviews`,
    '-f', `commit_id=${input.head}`, '-f', 'event=COMMENT', '-F', `body=@${file}`, '--jq', '.html_url',
  ])
  if (posted === null) return 'gh could not post the review.'
  // Settled only once gh says the review is posted, so a failed post lists
  // them again next time. A decision left out for looking like a secret is
  // settled too, so it does not take the place of a line in every later review.
  // Only the keys this review listed are deleted, so a decision owed after the
  // body was built waits for the next review.
  for (const d of owed) await $.store.delete(d.key)
  // The session is told the whole state here, so recording it as told hides
  // nothing: a check that failed meanwhile is in the lines below. The look
  // tells its own read, so no delivering look hands anything over from the
  // moment it goes on with that read, stored or overtaken, until it has told
  // it, however it ends (see untoldOwnReads).
  const s = (await tellingOwnRead(ownRead => lookAt($, 'review', 'known', { ownRead })))?.s ?? null
  return [`Posted the review: ${posted}`, ...(s ? stateLines(s) : [])].join('\n')
}

type CounselInput = { question?: unknown; options?: unknown; follow_ups?: unknown; background?: unknown; paths?: unknown; lean?: unknown; pull_request?: unknown }

// How many ids the counsel tool tries before it gives up looking for a brief
// folder that is still empty.
const COUNSEL_ID_TRIES = 100

// The answer when the counsel cannot meet, which tells the session to ask
// the person instead. The cause is one sentence ending in a full stop.
const couldNotSit = (cause: string) =>
  `The counsel could not sit: ${cause} Ask the person directly, and say the counsel could not sit.`

// The first id from one past the highest kept whose folder in `briefs` holds
// no brief, or null when the next COUNSEL_ID_TRIES all hold one. The ids only
// grow within the session, but the questions are kept in memory, so after a
// restart they begin again at c1 while a brief already on disk may still be
// waiting on votes; each id whose folder holds a brief is skipped, and that
// brief is left alone.
async function freeCounselId($: $, briefs: string, kept: readonly CounselQuestion[]): Promise<string | null> {
  // An id is c followed by its number, so the number is what follows the c.
  const first = Math.max(0, ...kept.map(q => Number(q.id.slice(1)) || 0)) + 1
  for (let n = first; n < first + COUNSEL_ID_TRIES; n += 1) {
    if (!(await $.fs.exists(`${briefs}/c${n}/brief.md`))) return `c${n}`
  }
  return null
}

// Where a decision on a question put now goes, from the pull request the
// session named (see destinationOf). The watch and the snapshot are read once
// each. The watch tool writes the watched pull request and then its snapshot
// in two updates, so a call between them sees the new number beside the old
// pull request's state; the snapshot's state counts only when its repo and
// number are the watched ones, and is otherwise not known yet.
async function counselDestination($: $, named: unknown): Promise<ReturnType<typeof destinationOf>> {
  const r = await read($, run)
  const s = await read($, pr)
  const watched = r === null ? null : { repo: r.repo, number: r.number }
  const state = watchedSnapshotOf(r, s)?.state ?? null
  return destinationOf(named, watched, state)
}

// The follow-ups a question records, with the numbers of those outside the
// spec only when there are any, so a question with none in that list is
// stored as one was before follow-ups could be outside the spec.
function followUpsRecord(raw: readonly unknown[]): Pick<CounselQuestion, 'followUps' | 'outsideSpec'> {
  const { followUps, outsideSpec } = followUpsInput(raw)
  return { followUps, ...(outsideSpec.length > 0 ? { outsideSpec } : {}) }
}

// Writes the brief, then records the question; a refusal or a failed write
// records nothing. Where a decision goes is settled first, before an id is
// taken or anything is written, and when the question is put, not when it is
// tallied, because the watch may move on or the pull request merge while the
// counsel sits. A call with follow_ups puts a follow-ups question, which
// takes the three fixed options and is owed to nothing, so its refusal
// covers pull_request and no destination is looked up.
async function serveCounsel($: $, input: CounselInput): Promise<string> {
  const isFollowUps = input.follow_ups !== undefined
  let options: unknown[]
  let owedTo: PullRequestRef | null
  if (isFollowUps) {
    options = [...FOLLOW_UP_OPTIONS]
    const refusal = followUpsRefusal(input.question, input.follow_ups, input.options, input.pull_request)
    if (refusal !== null) return `Refused: ${refusal}`
    owedTo = null
  } else {
    options = Array.isArray(input.options) ? input.options as unknown[] : []
    const refusal = briefRefusal(input.question, options)
    if (refusal !== null) return `Refused: ${refusal}`
    const destination = await counselDestination($, input.pull_request)
    if ('refusal' in destination) return `Refused: ${destination.refusal}`
    owedTo = destination.owedTo
  }
  const paths = Array.isArray(input.paths) ? (input.paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(p => p.trim()) : []
  const dir = await read($, cwd)
  if (dir === null) return couldNotSit('the mod does not know the session folder.')
  const { unwritten, outside } = await unwrittenPaths($, dir, paths)
  if (outside !== null) return `Refused: ${outside} leads outside the checkout; name paths inside it, relative to it.`

  const briefs = await counselDir($, dir)
  if (briefs === null) return couldNotSit('git could not find the checkout\'s git folder for the brief.')
  const id = await freeCounselId($, briefs, await read($, counsel))
  if (id === null) return couldNotSit(`the next ${COUNSEL_ID_TRIES} brief folders already hold briefs, which are left alone.`)
  const folder = `${briefs}/${id}`
  const q: CounselQuestion = {
    id,
    question: String(input.question).trim(),
    options: (options as string[]).map(option => option.trim()),
    background: typeof input.background === 'string' ? input.background : '',
    paths,
    lean: typeof input.lean === 'string' ? input.lean : '',
    folder,
    round: 1,
    tallies: [],
    ...(owedTo ? { pr: owedTo } : {}),
    launchedAt: await $.clock.now(),
    ...(isFollowUps ? followUpsRecord(input.follow_ups as unknown[]) : {}),
  }
  try {
    await $.fs.write(`${folder}/brief.md`, briefText(briefFactsOf(q), unwritten))
  } catch {
    return couldNotSit('the brief could not be written.')
  }
  await update($, counsel, list => keepCounsel([...list, q]))
  $.ui.invalidate('ui.render')
  return briefAnswer(q)
}

type TallyInput = { id?: unknown; round?: unknown; votes?: unknown }

// Records the members as asked again on question id. It is applied to the
// stored question, not a copy read earlier. The members asked again are
// launched from now, so the pane plans them again.
async function recordAskedAgain($: $, id: string, members: readonly string[]): Promise<void> {
  const launchedAt = await $.clock.now()
  await update($, counsel, list => list.map(question => question.id === id ? { ...afterAskAgain(question, members), launchedAt } : question))
  $.ui.invalidate('ui.render')
}

// Counts a round and records it. A round with members that have no vote, none
// of them asked again yet, is refused, and only those members are recorded as
// asked again. A rerun rewrites the brief as round 2 first; if that write
// fails, the question goes to the person instead.
async function serveTally($: $, input: TallyInput): Promise<string> {
  const q = (await read($, counsel)).find(question => question.id === input.id)
  if (q === undefined) return `Refused: there is no counsel question ${String(input.id)} in this session.`
  if (q.followUps !== undefined) return serveFollowUpsTally($, q, input)
  const counted = votesOf(q, input.round, input.votes)
  if ('refusal' in counted) return `Refused: ${counted.refusal} Nothing was recorded.`
  const step = stepOf(q, counted.votes)
  if ('askAgain' in step) {
    await recordAskedAgain($, q.id, step.askAgain)
    return askAgainAnswer(q, step.askAgain, counted.unreadable)
  }
  let t = step.tally
  let recorded = afterTally(q, t)
  let note = ''
  if (t.outcome === 'rerun') {
    const dir = await read($, cwd)
    const { unwritten } = dir === null ? { unwritten: [] } : await unwrittenPaths($, dir, recorded.paths)
    try {
      await $.fs.write(`${q.folder}/brief.md`, briefText(briefFactsOf(recorded), unwritten))
    } catch {
      t = { ...t, outcome: 'ask' }
      recorded = afterTally(q, t)
      note = 'The brief could not be rewritten for round 2, so the question goes to the person now.\n'
    }
  }
  // A rerun tells the session to launch every member for round 2.
  if (t.outcome === 'rerun') recorded = { ...recorded, launchedAt: await $.clock.now() }
  // A decision is owed to the pull request the question stored, never to
  // whatever the watch follows now, and only while GitHub says that pull
  // request is open. One that merged or closed, or whose state cannot be
  // read, would never have a review to list it, so the answer sends the
  // decision to the spec instead. Only a decided round of a question that
  // named a pull request can owe it anything, and only then is its state
  // read; for any other round there is no state, and the answer ignores it.
  const owedTo = t.outcome === 'decided' ? q.pr : undefined
  const state = owedTo === undefined ? undefined : await readPullRequestState($, owedTo)
  // The store keeps what the next review on the pull request owes, so a
  // restart before that review does not lose it. It is written before the
  // round is recorded, so a store that refuses the write leaves the round
  // untallied and the session can tally it again.
  if (owedTo !== undefined && state === 'OPEN') {
    try {
      await oweDecision($, owedTo, q.id, decisionLine(recorded, t), await $.clock.now())
    } catch {
      return 'The decision could not be stored, so nothing was recorded; tally this round again.'
    }
  }
  await update($, counsel, list => list.map(question => question.id === q.id ? recorded : question))
  $.ui.invalidate('ui.render')
  // A question sent to the person shows in the status file until it is asked.
  if (t.outcome === 'ask') {
    const at = await $.clock.now()
    await changeMemo($, memo => afterCounselAsk(memo, at)).catch(() => undefined)
  }
  return `${note}${counselAnswer(recorded, t, counted.unreadable, await neverStartedIn($, recorded, t, counted.unreadable), state)}`
}

// The members of a round sent to the person that never started, by the
// mod's record of agents. The record is read again from the engine's list
// first, only when a member could be named, so that an agent whose spawn the
// mod missed during a reload has its type rather than none. A record that
// cannot be read names nobody, so the answer is the one without the names.
async function neverStartedIn($: $, q: CounselQuestion, t: CounselTally, unreadable: readonly UnreadableVote[]): Promise<string[]> {
  if (neverStartedCandidatesOf(q, t, unreadable).length === 0) return []
  await refreshAgents($).catch(() => undefined)
  try {
    return neverStartedOf(q, t, unreadable, await read($, agents))
  } catch {
    return []
  }
}

// Counts a follow-ups question's one round and records it. Members without a
// vote on some follow-up, not yet asked again, are recorded as asked again
// and the round is refused, as for any question. Otherwise the round is
// counted whoever is still missing. Nothing is owed to a pull request and
// nothing goes to the person, so there is nothing to store first and no
// brief to rewrite.
async function serveFollowUpsTally($: $, q: CounselQuestion, input: TallyInput): Promise<string> {
  const counted = followUpVotesOf(q, input.round, input.votes)
  if ('refusal' in counted) return `Refused: ${counted.refusal} Nothing was recorded.`
  const step = followUpStepOf(q, counted.followUps)
  if ('askAgain' in step) {
    await recordAskedAgain($, q.id, step.askAgain)
    return followUpAskAgainAnswer(q, step.askAgain, counted.followUps, counted.unreadable)
  }
  const recorded = afterTally(q, step.tally)
  await update($, counsel, list => list.map(question => question.id === q.id ? recorded : question))
  $.ui.invalidate('ui.render')
  return followUpAnswer(recorded, step.tally)
}

type AskInput = { questions?: { question?: string }[] }

// The session is blocked inside AskUserQuestion until the owner answers, so
// the mod, not the session, puts needs-decision on and takes it off. The
// label work runs beside the question, never in front of it or of the
// answer. A label already on when the question is asked counts as the mod's
// (see labelForQuestion).
async function asking<T>($: $, question: string | undefined, call: () => Promise<T>): Promise<T> {
  const r = await read($, run)
  const at = await $.clock.now()
  await update($, questions, list => keepQuestions([...list, {
    asked: question ?? 'a question', at, answered: false, labelled: false, repo: r?.repo, number: r?.number,
  }]))
  if (r !== null) void inLabelQueue(() => labelForQuestion($, r, at))
  try {
    return await call()
  } finally {
    await update($, questions, list => list.map(q => q.at === at ? { ...q, answered: true } : q))
    void inLabelQueue(() => takeOffAnsweredLabels($))
    await changeMemo($, memo => afterQuestionEnd(memo, at)).catch(() => undefined)
  }
}

// Label calls run one at a time, so a question asked while a removal is in
// flight sees the result of that removal, not the state before it. Every
// caller starts label work without waiting for it, so a failure is hidden
// from the caller rather than passed on as it is by the told queue, because a
// rejected promise that nobody waits for would be reported as unhandled.
const inLabelQueue = oneAtATime({ passesErrors: false })

// Reads the labels fresh, since the last poll can be ten minutes old, and
// records the question as labelled only once the label is really on. A label
// already on counts as the mod's for this question, so it comes off once no
// question is open. That is what takes off a label left on by a session that
// was killed while its question was open, which a restarted mod has no
// record of.
async function labelForQuestion($: $, r: BuilderRun, at: number) {
  const names = await gh($, r.cwd, ['pr', 'view', String(r.number), '--repo', r.repo, '--json', 'labels', '--jq', '[.labels[].name]'])
  if (names === null) return
  const isOn = (JSON.parse(names) as string[]).includes(DECISION_LABEL)
  if (!isOn && !(await addLabel($, r, DECISION_LABEL))) return
  await update($, questions, list => list.map(q => q.at === at ? { ...q, labelled: true } : q))
}

// Takes needs-decision off once no question is open, on each pull request
// the mod labelled; a removal that failed is tried again on the next look.
async function takeOffAnsweredLabels($: $) {
  const list = await read($, questions)
  if (list.some(q => !q.answered)) return
  const owed = list.filter(q => q.labelled && q.unlabelled !== true && q.repo !== undefined && q.number !== undefined)
  const dir = await read($, cwd)
  for (const target of new Set(owed.map(q => `${q.repo}#${q.number}`))) {
    const [repo, number] = target.split('#') as [string, string]
    const removed = await gh($, dir, ['pr', 'edit', number, '--repo', repo, '--remove-label', DECISION_LABEL])
    if (removed === null) continue
    await update($, questions, all => all.map(q => `${q.repo}#${q.number}` === target && q.labelled ? { ...q, unlabelled: true } : q))
  }
}

async function addLabel($: $, r: BuilderRun, name: string): Promise<boolean> {
  const args = ['pr', 'edit', String(r.number), '--repo', r.repo, '--add-label', name]
  if ((await gh($, r.cwd, args)) !== null) return true
  // The label may not exist in this repository yet. Creating it without
  // --force leaves an existing label's colour and description alone.
  await gh($, r.cwd, ['label', 'create', name, '--repo', r.repo])
  return (await gh($, r.cwd, args)) !== null
}

// The lines the agent pane shows for its agent's messages, as last read, so
// that a redraw every second neither reads nor cleans them again. They are
// read when the pane is opened on the agent, and again on each read of the
// engine's agent list while the agent runs and the pane is open (see
// refreshAgents). Closing the pane or a hot reload empties it, and the pane's
// next draw reads them. The cache holds an entry for the read, with the read's
// answer once it has settled. While a read is still under way, every draw for
// that agent finds the same entry in the cache and starts no read of its own,
// so the draws share that one read, and they show that the messages are being
// read. A read that settles while the cache still holds its entry asks for a
// redraw, so the draws then show what it read.
//
// Each read is numbered when it starts, and the cache keeps the number of the
// read it holds. Reads can answer out of order: a read of the list started
// while the agent ran can answer after the read made when the agent ended. A
// read that answers replaces the cache only when it started after the read
// the cache holds, so an older read never puts older messages back.
type MessagesReading = { id: string; started: number; answer: MessagesRead | null }
let outputCache: MessagesReading | undefined
// The number given to the last read of an agent's messages that started.
let readsStarted = 0

// Starts a read of the messages of agent `id` and numbers it. Answers the
// cache entry for the read, and the read itself for a caller that waits on
// it. When the read settles, its answer is kept on the entry, and a redraw is
// asked for if the cache still holds that entry.
function startRead($: $, id: string): { reading: MessagesReading; read: Promise<MessagesRead> } {
  readsStarted += 1
  const reading: MessagesReading = { id, started: readsStarted, answer: null }
  const read = readMessages($, id)
  void read
    .then(answer => {
      reading.answer = answer
      if (outputCache === reading) $.ui.invalidate('ui.render')
    })
    .catch(() => undefined)
  return { reading, read }
}

// The lines the agent pane draws for an agent's messages, or why they could
// not be read: an error, or what messagesReadOf makes of the engine's answer.
// It never rejects, so a read the cache holds always ends with something the
// pane can show.
async function readMessages($: $, id: string): Promise<MessagesRead> {
  try {
    return messagesReadOf(await $.session.messages({ agentId: id }))
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) }
  }
}

// The output button's press: the agent pane shows that agent and is opened at
// once, without waiting on its messages. They are read now, unless a draw of
// the pane that the write of the agent caused has already started that read,
// which is then shared. Until the read settles, the pane shows that the
// messages are being read. When opening the pane is refused, the read's entry
// stays in the cache for the pane's next draw.
async function showOutput($: $, id: string) {
  const before = readsStarted
  await update($, outputAgent, () => id)
  // A read numbered after `before` began during this press, so a draw that the
  // write of the agent caused started it, and it is fresh enough to share.
  const isReadByDrawSincePress = outputCache?.id === id && outputCache.started > before
  if (!isReadByDrawSincePress) outputCache = startRead($, id).reading
  await $.ui.open({ id: AGENT_PANE, title: 'builder agent' })
  $.ui.invalidate('ui.render')
}

// Asks for a redraw every LIVE_REDRAW_MS while anything runs, so running
// times move by the second, and reads the engine's list of agents on every
// LIST_EVERY_TICKS-th tick, so finished work leaves the display without a
// keystroke. The list is read less often than the display is redrawn because
// a read asks the engine for every agent of the session.
let liveTicker: { cancel: () => void } | undefined
const LIVE_REDRAW_MS = 1_000
const LIST_EVERY_TICKS = 5
// The ticks since the live ticker last started, which decides the list reads.
let liveTicks = 0
// A list read the ticker started is still running, so the next one waits for
// a later tick rather than pile up behind a slow engine.
let isRefreshing = false
// Where the ticker stands with the read of the engine's list that it needs
// before it stops: 'none' when no such read has started since the ticker
// last found something running, 'running' while that read runs, and 'done'
// once it has finished.
let idleRead: 'none' | 'running' | 'done' = 'none'

// Reads the engine's list of agents and merges it into the cards. A read that
// fails, or answers something other than a list, keeps the stored cards until
// a read succeeds. A running agent starts the live ticker. While the agent the
// agent pane shows runs and the engine lists that pane as open, its messages
// are read again too. Once the pane is closed the cache is emptied, so nothing
// reads the messages until the pane is drawn again, and its draw reads them.
async function refreshAgents($: $) {
  const readStartedAt = await $.clock.now()
  let listed: unknown
  try {
    listed = await $.agent.list()
  } catch {
    return
  }
  if (!Array.isArray(listed)) return
  const kept: ListedAgent[] = (listed as ListedAgent[]).map(agent => ({ id: agent.id, type: agent.type, description: agent.description, status: agent.status }))
  const now = await $.clock.now()
  // The cards as the update found them, kept so the ended ones can be told
  // apart once it has saved the merge.
  let before: AgentCard[] = []
  const cards = await update($, agents, list => {
    before = list
    return mergeAgents(list, kept, now, readStartedAt)
  })
  // An agent whose end only the list shows restarts the quiet time, as the
  // end of a subagent's turn does.
  if (endedCards(before, cards).length > 0) await markQuiet($).catch(() => undefined)
  if (cards.some(isRunning)) ensureLive($)
  const shown = outputCache?.id
  if (shown === undefined || !cards.some(card => card.id === shown && isRunning(card))) return
  if (await isPaneOpen($, AGENT_PANE)) await refreshOutput($, shown)
  else if (outputCache?.id === shown) outputCache = undefined
}

// Whether the engine lists the pane `id` as open. A list the engine refuses
// counts as the pane being closed.
async function isPaneOpen($: $, id: string): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === id)
  } catch {
    return false
  }
}

// Reads the messages of the agent the agent pane shows again and asks for a
// redraw. The answer is kept only when the pane still shows that agent and no
// read that started later is already in the cache. Until it answers, the
// cache keeps the older answer, so the pane keeps showing the messages it
// already has rather than going back to "Reading the messages." while this
// read is under way.
async function refreshOutput($: $, id: string) {
  const { reading, read } = startRead($, id)
  // startRead's own handler on this read runs first and puts the answer in
  // the entry, so the entry is complete once this await resumes.
  await read
  if (outputCache?.id !== id || outputCache.started > reading.started) return
  outputCache = reading
  $.ui.invalidate('ui.render')
}

// The card for a subagent that ended without the mod having seen it start (it
// started before the hooks were loaded). Its type and description are filled
// in by the next read of the engine's list, in refreshAgents.
function placeholderCard(agentId: string, now: number, ended: Pick<AgentCard, 'status' | 'summary' | 'endedAt'> & { durationMs: number }): AgentCard {
  return { id: agentId, type: 'agent', description: '', startedAt: now - ended.durationMs, ...ended }
}

// For the hooks that refresh in passing: the refresh runs behind the hook and
// its failure is its own.
function refreshLater($: $) {
  void refreshAgents($).catch(() => undefined)
}

// Starts the live ticker unless it runs. Every LIST_EVERY_TICKS-th tick starts
// a read of the engine's list, unless the last one still runs, and each tick
// asks for a redraw while anything runs (an agent, background work, or a call
// of the session's own). A list read that finds an agent running starts the
// ticker again.
//
// The ticker reads the engine's list before it stops. Whether anything runs is
// decided from stored state, and that state only knows of an agent the mod saw
// start or an earlier read of the list found. An agent the mod did not see
// start, such as a background agent resumed with SendMessage, is known only
// to the engine's list. So when a tick first finds nothing running, it starts
// a read of the list and keeps ticking, and the ticker stops at the first tick
// after that read has finished with still nothing running. A ticker started by
// a short call of the session's own therefore still reads the list once, and
// finds such an agent within a second or two rather than at the turn's end.
function ensureLive($: $) {
  if (liveTicker !== undefined) return
  liveTicks = 0
  idleRead = 'none'
  liveTicker = $.clock.every(LIVE_REDRAW_MS, () => {
    void liveTick($).catch(() => undefined)
  })
}

// The ids in the background list, so that a notification row can tell
// without reading the store, which a draw must not do, whether its task could
// still be listed. The live ticker redraws every user-message row each second
// while anything runs, and most ended notifications are a subagent's, which the
// list never holds, or a task already taken off. Three places set it:
// replaceBackground and removeBackground from the list they wrote, through
// wroteBackground, which keeps it in step as they write, removeBackground also
// from its read while it is still unknown, and the live ticker from the store
// at every tick whose read no write overtook, which puts right a set that
// writes answered out of order left behind. Any new writer of the list must go
// through wroteBackground too. Undefined until one of these has run since this
// module loaded, as after a hot reload, when every ended row is checked.
let backgroundIds: Set<string> | undefined
// The number of writes of the background list that have answered, so that a
// tick of the live ticker can tell that a write answered while its own read
// was under way, and that its read may be older than the list now stored.
let backgroundWrites = 0

// Takes the ids from the list a write of the background list answered with,
// and counts the write. Every writer of the list goes through it, so the ids
// and the count never move apart.
function wroteBackground(tasks: readonly BackgroundTask[]) {
  backgroundIds = idsOf(tasks)
  backgroundWrites += 1
}

// Whether a task could still be in the background list, as far as the ids
// tell: it could when they hold it, or when they are not known yet.
function couldBeListed(id: string): boolean {
  return backgroundIds === undefined || backgroundIds.has(id)
}

// Replaces the background work with what a turn end reported, filtered by
// backgroundOf, and keeps the line live while any of it is in flight. The
// session's Stop and a subagent's SubagentStop both use it, so their filtering
// cannot drift apart.
async function replaceBackground($: $, raw: unknown) {
  const tasks = backgroundOf(raw)
  wroteBackground(await update($, background, () => tasks))
  if (tasks.length > 0) ensureLive($)
}

// The ids of a background list.
function idsOf(tasks: readonly BackgroundTask[]): Set<string> {
  return new Set(tasks.map(task => task.id))
}

// Takes one task off the background list. It writes only when the id is in
// the list, so a row drawn again, or after a turn end already replaced the
// list, costs one read and no write. It never adds a task. After a write, the
// ids are taken from the list update wrote rather than from the read before
// it, because a turn end may have replaced the list while the read was
// answered, and an older copy would then hide a task the list now holds from
// its row. The read fills the ids in only when none are known yet, as after a
// hot reload, and the check comes after the read is answered, so a set that a
// turn end wrote in the meantime is kept.
async function removeBackground($: $, id: string) {
  const tasks = await read($, background)
  if (!tasks.some(task => task.id === id)) {
    if (backgroundIds === undefined) backgroundIds = idsOf(tasks)
    return
  }
  wroteBackground(await update($, background, list => list.filter(task => task.id !== id)))
}

async function liveTick($: $) {
  liveTicks += 1
  const isListTick = liveTicks % LIST_EVERY_TICKS === 0
  const writes = backgroundWrites
  // Every tick reads the background list. It refreshes the ids the
  // notification rows check only when no write of the list answered while
  // its reads were under way (see the check below). Ids that a write
  // answered out of order left behind are then put right within a tick, and
  // the redraw below lets the row of a task they had missed take it off.
  const tasks = await read($, background)
  const isAnythingRunning = tasks.length > 0
    || (await read($, agents)).some(isRunning)
    || (await read($, calls)).length > 0
  // A write of the list that answered while these reads were under way may
  // hold a task the read missed, and replaceBackground's ensureLive found the
  // ticker still set and did nothing. So such a tick neither takes the ids
  // from its read nor decides anything, and the next tick reads again. No
  // await may come between this check and the decisions below, or a write
  // could answer after it and be overruled by this read.
  if (backgroundWrites !== writes) return
  backgroundIds = idsOf(tasks)
  if (isAnythingRunning) {
    idleRead = 'none'
    if (isListTick) startListRead($)
    $.ui.invalidate('ui.render')
    return
  }
  if (idleRead === 'done') {
    liveTicker?.cancel()
    liveTicker = undefined
    return
  }
  // Nothing runs, and no read of the list has finished since the ticker last
  // found something running. A read already under way may have started while
  // something ran, so it does not count, and the read that does count starts
  // at a later tick once that one has finished.
  if (idleRead === 'none' && !isRefreshing) {
    idleRead = 'running'
    startListRead($)
  }
}

// Starts a read of the engine's list for the live ticker, unless the last one
// it started still runs. Only one such read runs at a time, so when the read
// that the ticker needs before it stops finishes, it is the one that marks
// that read done.
function startListRead($: $) {
  if (isRefreshing) return
  isRefreshing = true
  void refreshAgents($)
    .catch(() => undefined)
    .finally(() => {
      isRefreshing = false
      if (idleRead === 'running') idleRead = 'done'
    })
}

// Runs one of the session's own tool calls with a record of it in `calls`, so
// the line can name it once it has run NAMED_AFTER_MS. A redraw is asked for
// at that mark, so the name appears without a keystroke. The record goes when
// the call returns, throws or is refused.
let callCount = 0
async function foreground<T>($: $, e: { tool: string; tool_use_id?: string }, call: () => Promise<T>): Promise<T> {
  callCount += 1
  const record: ForegroundCall = {
    id: e.tool_use_id ?? `call-${callCount}`,
    tool: e.tool,
    label: labelOf(e),
    startedAt: await $.clock.now(),
  }
  await update($, calls, list => [...list, record])
  const named = $.clock.after(NAMED_AFTER_MS, () => $.ui.invalidate('ui.render'))
  ensureLive($)
  try {
    return await call()
  } finally {
    named.cancel()
    await update($, calls, list => list.filter(c => c.id !== record.id)).catch(() => undefined)
  }
}

// The pattern for the merge command the project's CLAUDE.md names, built
// once when the session starts, or null when there is none, it has too few
// fixed words, or the file cannot be read.
let mergePattern: RegExp | null = null

async function projectMergeCommand($: $, dir: string): Promise<string | null> {
  try {
    const text = await $.fs.read(`${dir}/CLAUDE.md`)
    return typeof text === 'string' ? factIn(text, 'Merge command') : null
  } catch {
    return null
  }
}

// The type the engine spawned an agent as, from its own list, so the fence
// does not depend on this mod having recorded the spawn.
async function agentType($: $, id: string): Promise<string | undefined> {
  const listed = (await $.agent.list()).find(agent => agent.id === id)
  return listed?.type ?? (await read($, agents)).find(card => card.id === id)?.type
}

// What the band and the panes draw from. A value an older build stored in
// another shape is read as its default: no progress, not started, folded.
async function view($: $): Promise<View> {
  const s = await read($, pr)
  const shown = isDrawable(s) ? s : null
  const cards = await read($, agents)
  const counselQuestions = await read($, counsel)
  const lastPackage = await read($, packaged)
  return {
    pr: shown,
    agents: cards,
    questions: await read($, questions),
    wakes: await read($, wakes),
    now: await $.clock.now(),
    nextLook: await read($, nextLook),
    counsel: counselQuestions,
    background: await read($, background),
    calls: await read($, calls),
    started: (await read($, started)) === true,
    progress: progressIn(await read($, progress)),
    watchSince: (await read($, run))?.since ?? null,
    finishedFolded: (await read($, finishedFolded)) !== false,
    planned: plannedOf({ pr: shown, packaged: lastPackage, agents: cards, counsel: counselQuestions }),
    usageHold: holdIn(await read($, usageHold))?.until ?? null,
    stale: isStale(loadedIn(await read($, loaded))),
  }
}

// The elements the band and the panes draw with on the surface `e` names:
// `Svg` only on a surface that draws images, because the engine's table names
// every element on every surface and draws one the surface lacks as nothing.
function elementsOf($: $, e: ResolveInput): Elements {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  if (!isSvgSurface(e.surface)) return { Box, Text, Button }
  return { Box, Text, Button, Svg: (ui as { Svg: NonNullable<Elements['Svg']> }).Svg }
}

// The columns the engine gives a band or a pane, when they are a number.
function columnsOf(columns: unknown): number | undefined {
  return typeof columns === 'number' && Number.isFinite(columns) ? columns : undefined
}

// Builder counts as started from the first open_pane call or /builder command of
// the session, and stays started.
async function markStarted($: $) {
  await update($, started, () => true)
}

// Who asked for the pane: the person, by typing /builder, or anything else,
// which is the open_pane tool or the mod's own opening and gets the tool's
// wording. It is required so that a new caller chooses its wording.
type Asker = 'tool' | 'command'

// Opens the pane for the open_pane tool and for /builder alike, so the two
// cannot drift apart, and says what the engine answered. A pane the mod opens
// on its own is drawn only from 144 terminal columns, and an app that places
// no panes never draws it, so the answer never claims the pane opened when it
// only waits. It quotes the engine's reason exactly, because the reason is
// what tells the person which remedy applies. The person who has just typed
// /builder is not told to type it, only that widening the terminal shows it.
async function openPane($: $, asker: Asker): Promise<string> {
  const opened = await $.ui.open({ id: PANE, title: 'builder' })
  if (opened.isPlaced) return 'The pane is open.'
  const waits = `The pane waits and is not drawn yet. The engine says: "${opened.reason}"`
  if (asker === 'command') return `${waits} When the reason is the terminal's width, widening the terminal shows it.`
  return `${waits} When the reason is the terminal's width, typing /builder or widening the terminal shows it.`
}

// The agent-count button's press: closes the pane when the engine lists it as
// open, and opens it otherwise, including when the engine cannot list it.
async function togglePane($: $) {
  if (await isPaneOpen($, PANE)) await $.ui.close({ id: PANE })
  else await openPane($, 'tool')
}

// Records a stage report and answers with the stage and the count, or with
// why the report was refused, in which case nothing is recorded. The report
// is applied to the stored value inside `update`, which may run the reducer
// again when another write got in first, so whether to open the pane, and the
// answer, are taken from the run whose value was kept. At the first report of a title the pane
// opens on its own, unless the engine already lists it; that opening is the
// mod's own, so whatever the engine answers, the report's answer says nothing
// of it.
async function serveProgress($: $, input: ReportInput): Promise<string> {
  const now = await $.clock.now()
  const report = reportOf(input)
  if ('refusal' in report) return report.refusal
  let opens = false
  let answer = ''
  await update($, progress, raw => {
    const next = afterReport(progressIn(raw), report, now)
    const written = { ...next, autoOpened: true }
    opens = !next.autoOpened
    answer = reportAnswer(written)
    return written
  })
  $.ui.invalidate('ui.render')
  if (opens) {
    try {
      if (!(await isPaneOpen($, PANE))) await openPane($, 'tool')
    } catch {
      // The pane is the mod's own idea here; the report still stands.
    }
  }
  return answer
}

// What the tool.call hook does with every call: serves the mod's own tools,
// labels the pull request while the owner is asked, and fences the reviewers.
async function route($: $, e: ToolCallInput, next: Next<'tool.call'>): Promise<ToolCallResult> {
  const tool = String(e.tool)
  if (SESSION_TOOLS.has(tool) && e.agentId !== undefined) {
    return { deny: 'builder: only the session opens the pane, reports progress, watches, packages, posts and puts questions to the counsel; a subagent reports to it.' }
  }
  if (tool === OPEN_PANE_TOOL) {
    await markStarted($)
    return { result: `builder: ${await openPane($, 'tool')}` }
  }
  if (tool === PROGRESS_TOOL) return { result: `builder: ${await serveProgress($, e as unknown as ReportInput)}` }
  if (tool === WATCH_TOOL) return { result: `builder: ${await serveWatch($, e as unknown as WatchInput)}` }
  if (tool === PACKAGE_TOOL) return { result: `builder: ${await servePackage($, e as unknown as PackageInput)}` }
  if (tool === REVIEW_TOOL) return { result: `builder: ${await serveReview($, e as unknown as ReviewInput)}` }
  if (tool === COUNSEL_TOOL) return { result: `builder: ${await serveCounsel($, e as unknown as CounselInput)}` }
  if (tool === TALLY_TOOL) return { result: `builder: ${await serveTally($, e as unknown as TallyInput)}` }
  if (tool === 'AskUserQuestion' && e.agentId === undefined) {
    return asking($, (e as unknown as AskInput).questions?.[0]?.question, () => next(e))
  }
  if (e.agentId !== undefined && !REVIEWER_TOOLS.has(tool)) {
    // An agent the engine does not list (its own helpers for compaction and
    // memory, a workflow's agents) is not one of the read-only agents this
    // mod launched, the reviewers and the owner's advocate, so it keeps its
    // tools.
    const type = await agentType($, e.agentId)
    if (type !== undefined && READ_ONLY_AGENTS.has(type)) {
      return { deny: `builder: ${type} only reads; ${tool} is not available to it.` }
    }
  }
  return next(e)
}

// Whether a call succeeded: it was not refused, did not end in an error, and
// was not moved to the background, where a command has not finished yet.
function succeeded(ran: ToolCallResult): boolean {
  if (ran.deny !== undefined || ran.isError === true) return false
  const result = ran.result as { backgroundTaskId?: unknown } | null | undefined
  return typeof result !== 'object' || result === null || result.backgroundTaskId === undefined
}

// The status file for the foreman. A session whose first prompt holds a
// `foreman-ticket:` line writes one JSON file, which the foreman reads on its
// own timer to see what every session it started is doing. hooks/status.ts
// holds the rules; what follows reads the state, writes the file and keeps
// it fresh. The README section "The status file for the foreman" describes
// the file.
//
// Whether this session has a ticket: 'some' once one was found, 'none' once
// the first prompt was looked at and holds none, and undefined before that
// and after a /clear. `ticketFor` is the session id the answer belongs to, so
// a /clear whose end was cut off is noticed at the next prompt. Both are
// module variables so that every write of state can ask for a write of the
// file with no await, and a hot reload sets them from the memo again.
let ticketKnown: 'some' | 'none' | undefined
let ticketFor: string | undefined
// A write of the file was asked for since the writer last read the state,
// and whether one of those asks was the minute's tick, which writes even
// when nothing changed.
let statusDirty = false
let statusForced = false
// A writer is scheduled or running, and the promise of the one running, which
// the session's end waits on.
let statusPending = false
let statusFlight: Promise<void> | null = null
// Every write of the file that has not settled, including one the writer gave
// up on after its timeout, so the session's end can delete the file again
// after a write that lands once it was deleted.
const statusWrites = new Set<Promise<void>>()
// When this copy of the module loaded, as a number that orders the copies of
// the module by when they loaded: a later load always has a larger stamp. It
// is set once, at the start of the hooks that each load runs (see
// stampLoad). A copy from before a hot reload keeps running the work it had
// in flight, and the stamp is what tells it apart from the newest copy.
let loadStamp = 0
// The generation this copy of the module writes under. Two values share the
// word: the memo's stored `generation`, which survives a hot reload and holds
// the load stamp of the copy that owns the memo, and this module variable.
// Only the newest copy owns the memo: a copy takes it up only when its own
// stamp is not below the stored generation, and then sets both to its stamp
// (see takeUpMemo). So a writer that a copy from before a hot reload left
// running finds the stored generation is not its own and stops, and that
// copy can never take the memo back. The session's end raises only this
// module variable, so a writer of the ended session that captured the old
// value stops, and the stored generation stays as it is until the next
// conversation writes a memo of its own.
let statusGen = 0
// The text of the record last written, as comparedTextOf gives it, to
// compare the next one with. A hot reload forgets it, which costs one write.
let lastWrittenText: string | null = null
// The minute's tick, and whether the session has ended, after which nothing
// more is written.
let statusTick: { cancel: () => void } | undefined
let statusClosed = false

// The file is written at least this often while the session lives, so a file
// whose write time stops moving tells the foreman the session is gone or hung.
const STATUS_EVERY_MS = 60_000
// How long one write may take before the writer gives up on it, so a write
// that never settles cannot stop writing for good. A write that finishes
// after the writer gave up on it, over a newer one, is put right by the next.
const STATUS_WRITE_TIMEOUT_MS = 30_000
// The time the session's end leaves of the engine's budget for ending a
// session, for the reads and the delete that follow its wait.
const END_MARGIN_MS = 250
// The longest the session's end waits for the write in flight, and the
// longest it lets each `rm -f` run.
const END_WAIT_CAP_MS = 1_000

// Asks for the file to be worked out again and written when it changed, or
// written in any case when `force` is set. It does nothing in a session that
// has no ticket, or none known yet, and nothing once the session has ended.
// Asks that arrive while a writer is scheduled or running are folded into
// it: the writer reads the state again before it finishes, so the newest
// record is normally the last one written. A write given up after
// STATUS_WRITE_TIMEOUT_MS can still land later, over a newer record, and the
// next change or the next minute's write replaces it.
function statusChanged($: $, force = false) {
  if (ticketKnown !== 'some' || statusClosed) return
  statusDirty = true
  if (force) statusForced = true
  if (statusPending) return
  statusPending = true
  const gen = statusGen
  try {
    $.clock.after(0, () => {
      statusFlight = writeStatus($, gen).finally(() => {
        statusFlight = null
      })
    })
  } catch {
    statusPending = false
  }
}

// Writes the record while a write has been asked for since the last read of
// the state. A record equal to the last one written in every field but the
// write time is not written, unless the tick asked. A write that fails or
// times out is dropped: the next change or the next tick tries again, and
// nothing here can stop a hook. It stops when the memo belongs to another
// session, holds no ticket or no path, or was taken up by a newer copy of
// the module, whose load stamp is now its generation.
// A copy of the module from before a hot reload keeps running the writer it
// had in flight, so the memo's generation is read again right before the
// file is written, with no await between that read and the start of the
// write, and once more inside the memo's update. Its own `statusGen` cannot
// tell it that a newer copy has started.
async function writeStatus($: $, gen: number): Promise<void> {
  try {
    while (statusDirty && !statusClosed && gen === statusGen) {
      statusDirty = false
      const force = statusForced
      statusForced = false
      const facts = await statusFacts($)
      if (facts === null || facts.memo.generation !== gen || facts.memo.path === null) return
      const record = recordOf(facts, await $.clock.now())
      const text = comparedTextOf(record)
      if (!force && text === lastWrittenText) continue
      const { sessionId, path } = facts.memo
      const current = statusMemoIn(await read($, statusMemo), sessionId)
      if (statusClosed || gen !== statusGen || current?.generation !== gen) return
      await withinTimeout($, trackedWrite($, path, JSON.stringify(record)), STATUS_WRITE_TIMEOUT_MS)
      lastWrittenText = text
      if (facts.memo.state === record.state && facts.memo.stateSince === record.stateSince) continue
      await update($, statusMemo, raw => {
        const memo = statusMemoIn(raw, sessionId)
        return memo === null || memo.generation !== gen ? raw : afterWrite(memo, record)
      })
    }
  } catch {
    // Dropped, as said above.
  } finally {
    statusPending = false
    if (statusDirty) statusChanged($)
  }
}

// Writes the file, keeping the write among the unsettled ones until it
// settles.
function trackedWrite($: $, path: string, text: string): Promise<void> {
  const write = $.fs.write(path, text).then(() => undefined)
  statusWrites.add(write)
  const settled = () => {
    statusWrites.delete(write)
  }
  write.then(settled, settled)
  return write
}

// Settles as `work` does, or rejects once `ms` have passed.
function withinTimeout<T>($: $, work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = $.clock.after(ms, () => reject(new Error('timed out')))
    work.then(
      value => {
        timer.cancel()
        resolve(value)
      },
      error => {
        timer.cancel()
        reject(error)
      },
    )
  })
}

// Everything the record is worked out from, read fresh, or null when the
// memo is not this session's or holds no ticket.
async function statusFacts($: $): Promise<StatusFacts | null> {
  const memo = statusMemoIn(await read($, statusMemo), await $.session.id())
  if (memo === null || memo.ticket === null) return null
  return {
    memo: { ...memo, ticket: memo.ticket },
    progress: progressIn(await read($, progress)),
    run: await read($, run),
    pr: snapshotIn(await read($, pr)),
    busy: (await read($, busy)) === true,
    agents: await read($, agents),
    background: await read($, background),
    calls: await read($, calls),
    questions: await read($, questions),
    nextLook: await read($, nextLook),
    usageHold: holdIn(await read($, usageHold)),
  }
}

// Applies an event's change to the memo and asks for a write. It does nothing
// in a session that has no ticket, or none known yet. The changes return the
// memo they were given when they change nothing, as after most calls and at
// every turn's start and end; then the memo is left as it is and no write is
// asked for. The memo is read first, because `update` writes even when its
// change hands back the value it was given.
async function changeMemo($: $, change: (memo: StatusMemo) => StatusMemo) {
  if (ticketKnown !== 'some') return
  const sessionId = await $.session.id()
  const stored = statusMemoIn(await read($, statusMemo), sessionId)
  if (stored === null || change(stored) === stored) return
  let changed = false
  await update($, statusMemo, raw => {
    const memo = statusMemoIn(raw, sessionId)
    const next = memo === null ? memo : change(memo)
    changed = next !== memo
    return changed ? next : raw
  })
  if (changed) statusChanged($)
}

// Starts the minute's tick, or starts it again. Each tick works the record
// out again from the state, so it also puts right a change whose ask was
// missed.
function armStatusTick($: $) {
  statusTick?.cancel()
  statusTick = $.clock.every(STATUS_EVERY_MS, () => statusChanged($, true))
}

// Takes the answer a memo of this session already holds: the ticket, or that
// there is none. A ticket with no path to write to counts as none, since
// nothing can be written. A memo with a ticket starts the tick and a write.
function adoptMemo($: $, memo: StatusMemo) {
  ticketKnown = memo.ticket === null || memo.path === null ? 'none' : 'some'
  ticketFor = memo.sessionId
  if (ticketKnown === 'some') {
    armStatusTick($)
    statusChanged($, true)
  }
}

// Sets this copy's load stamp, once, at the start of the hooks, before the
// memo is taken up. It is the time of the load, or one more than the memo's
// stored generation when the clock has not moved past it, as with two loads
// in one millisecond, so a later load always gets a larger stamp than any
// copy before it. Any memo's generation counts, whichever session it
// belongs to. When the memo cannot be read the time of the load stands
// alone, and when the clock cannot be read either the stamp stays as it is.
async function stampLoad($: $) {
  let stored = 0
  try {
    stored = generationIn(await read($, statusMemo)) ?? 0
  } catch {
    // The time of the load stands alone, as said above.
  }
  const now = await $.clock.now()
  loadStamp = now > stored ? now : stored + 1
}

// Takes a memo of this session up for this copy of the module, when this copy
// owns it: the memo's stored generation is not above this copy's load stamp.
// Then the memo as it stands when it is written gets this copy's stamp as its
// generation, which this copy then writes under, and its answer is taken.
// Only the generation changes, so a change that landed since the memo was
// last read is kept. A memo whose generation is above the stamp belongs to a
// newer copy, so it is left as it is and nothing is taken: this copy does no
// more for the status file. When the session has no memo by then, `found`,
// which carries this copy's stamp, is written instead and taken, or, when
// `found` is null, nothing is written or taken. Both ways of taking a memo
// up, at the start of the hooks and at a prompt, come through here, so that
// a copy whose start failed, or that found no memo at its start because the
// copy before it wrote one later, still takes the memo up.
async function takeUpMemo($: $, sessionId: string, found: StatusMemo | null) {
  const stored = await update($, statusMemo, raw => {
    const memo = statusMemoIn(raw, sessionId)
    if (memo === null) return found ?? raw
    return memo.generation > loadStamp ? raw : { ...memo, generation: loadStamp }
  })
  const taken = statusMemoIn(stored, sessionId)
  if (taken === null || taken.generation !== loadStamp) return
  statusGen = loadStamp
  adoptMemo($, taken)
}

// Looks for the ticket at a prompt, once per session id. A memo of this
// session is taken up as it is (see startStatus), so a hot reload does not
// look again. Otherwise the first prompt is the first user message of the
// transcript, or the prompt being submitted when the transcript holds none
// or cannot be read. The configuration folder and the desktop id are read
// only when there is a ticket, so a session without one reads nothing more.
// The new memo carries this copy's load stamp. A memo of this session that
// another prompt, the copy of the module from before a hot reload, or a
// newer copy wrote while this one looked is never written over: it is taken
// up when this copy owns it, and left as it is when a newer copy does.
async function lookForTicket($: $, submitted: string) {
  const sessionId = await $.session.id()
  if (ticketKnown !== undefined && ticketFor === sessionId) return
  if (await startStatus($)) return
  let first = submitted
  try {
    first = firstPromptOf(await $.session.messages(), submitted)
  } catch {
    // The prompt being submitted is checked instead.
  }
  const ticket = ticketIn(first)
  const found = ticket === null
    ? newMemo({ sessionId, ticket: null, path: null, cwd: '', generation: loadStamp })
    : newMemo({
        sessionId,
        ticket,
        path: buildPathOf(configDirOf(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME')), sessionId),
        desktopSessionId: await $.env.get('CLAUDE_CODE_HOST_SESSION_ID'),
        cwd: (await read($, cwd)) ?? (await $.session.cwd()),
        generation: loadStamp,
      })
  await takeUpMemo($, sessionId, found)
}

// Takes a memo of this session up when there is one (see takeUpMemo), and
// says whether there was one, taken up or left to a newer copy. It runs at
// each start of the hooks, the session's start and every hot reload, and at
// a prompt before the ticket is looked for, so the two cannot come to take a
// memo up in different ways. The memo is read first, because `update` writes
// even when its change hands back the value it was given.
async function startStatus($: $): Promise<boolean> {
  const sessionId = await $.session.id()
  if (statusMemoIn(await read($, statusMemo), sessionId) === null) return false
  await takeUpMemo($, sessionId, null)
  return true
}

// At the session's end nothing more is written. Writing is closed and this
// module copy's statusGen raised first, leaving the memo's stored generation
// and this copy's load stamp alone, so a writer of the ended session that is
// still awaiting a read stops before it writes. Raising statusGen claims no
// memo: only the load stamp does that. Once a new conversation takes a memo
// up, statusGen is this copy's stamp again, but a writer of the ended
// session that holds a record read before the end still stops, because the
// memo under the ended session's id is gone by then: it was reset, or the
// new conversation's memo replaced it. A session with a ticket then deletes
// the file after a merge, and when the process goes on under another session
// id, after a /clear or a resume, everything is made ready for the new
// conversation, whether or not the delete got through.
async function endStatus($: $, reason: string, sessionId: string, budget: { remainingMs: number }) {
  const wasTicketed = ticketKnown === 'some'
  statusClosed = true
  statusGen += 1
  statusTick?.cancel()
  statusTick = undefined
  try {
    if (wasTicketed) await deleteAfterMerge($, sessionId, budget)
  } finally {
    if (reason === 'clear' || reason === 'resume') await reopenForNextConversation($)
  }
}

// Waits for the write in flight, within the engine's short budget for ending
// a session, and then, when the watched pull request merged, deletes the file
// with `rm -f`, since the engine's file interface has no delete. Without a
// merge the file stays for the foreman to read. A write that has not settled
// by the delete, because it took longer than the wait or the writer gave up
// on it, could still land and bring the file back with an older record, so
// each one deletes the file again when it settles.
async function deleteAfterMerge($: $, sessionId: string, budget: { remainingMs: number }) {
  const flight = statusFlight
  const wait = Math.max(0, Math.min(budget.remainingMs - END_MARGIN_MS, END_WAIT_CAP_MS))
  if (flight !== null) await withinTimeout($, flight, wait).catch(() => undefined)
  const memo = statusMemoIn(await read($, statusMemo), sessionId)
  const isMerged = watchedSnapshotOf(await read($, run), snapshotIn(await read($, pr)))?.state === 'MERGED'
  if (memo === null || memo.path === null || !isMerged) return
  const path = memo.path
  const remove = () => $.process.run(['rm', '-f', path], { timeoutMs: END_WAIT_CAP_MS })
  const unsettled = [...statusWrites]
  await remove()
  for (const write of unsettled) void write.catch(() => undefined).then(remove).catch(() => undefined)
}

// After a /clear or a resume the memo is reset, and the new conversation
// looks for a ticket in its own first prompt. Writing opens again only once
// the memo's reset has settled, whether it landed or failed.
async function reopenForNextConversation($: $) {
  ticketKnown = undefined
  ticketFor = undefined
  lastWrittenText = null
  statusDirty = false
  statusForced = false
  // Writing opens again even when the reset fails. That is safe, because a
  // memo left under the ended session's id reads as none for the new one (see
  // statusMemoIn), and the new conversation looks for its own ticket and
  // writes a memo of its own.
  try {
    await update($, statusMemo, () => null)
  } finally {
    statusClosed = false
  }
}

export const register: Register = on => {
  // Every write of the mod's own state asks for the status file to be worked
  // out again, so a writer of state added later cannot forget to. A wrapper
  // around `update` cannot do this, because the engine reads which values a
  // module writes from each call's atom at the call site, and refuses a call
  // whose atom is a parameter. The memo's own writes are left out, so writing
  // it never asks for another write. They are told apart by the key the memo's
  // atom holds, so the hook and the atom cannot come to name different keys.
  // In a session with no ticket the ask returns at once, so such a session
  // does what it did before the file existed.
  on('state.set', async ($, e, next) => {
    const set = await next(e)
    if (e.plugin === 'builder' && e.key !== statusMemo.ref.key) statusChanged($)
    return set
  })

  on('session.start', async ($, e, next) => {
    // The commit this load of the hooks reads its files at, recorded first,
    // and not awaited, so the session's start never waits on git.
    void loadHooks($).catch(() => undefined)
    await $.command.register({
      name: 'builder',
      description: 'Open the builder pane. `/builder poll` reads the pull request now, `/builder watch <number>` watches one, `/builder wakes` lists what woke the mod.',
    })
    await $.tool.register({
      name: 'watch',
      description: 'Tell the builder mod which pull request this session works on, right after opening it. The mod then shows its state and starts a turn when it changes.',
      inputSchema: {
        type: 'object',
        properties: {
          number: { type: 'integer', description: 'The pull request number.' },
          repo: { type: 'string', description: 'owner/name; defaults to the repository of the session folder.' },
        },
        required: ['number'],
      },
    })
    await $.tool.register({
      name: 'package',
      description: 'Build the review package for the watched pull request at its current head: package.md (the issue, spec and plan paths, changed files, earlier rounds, the findings already decided, read from the Dropped: and Outside the spec: lists of the fix commits and earlier reviews, and the areas fixed so far, read from the fix commits\' Reviewed:, Area: and Trend: lines) and diff.patch. Answers with the folder to hand every reviewer. When an area was fixed at 3 reviewed heads in a row, the answer\'s first line says the rounds stop, and the session puts the area to the counsel before launching any reviewer. The checkout used is the worktree that has the pull request\'s head branch checked out, or the session\'s folder when no worktree has it, and it must be at the pull request\'s head.',
      inputSchema: {
        type: 'object',
        properties: {
          issue: { type: 'string', description: 'The issue in a few lines.' },
          spec: { type: 'string', description: 'Path of the spec, if there is one.' },
          plan: { type: 'string', description: 'Path of the plan, if there is one.' },
          tests: { type: 'string', description: 'The test run\'s summary line.' },
        },
        required: ['issue'],
      },
    })
    await $.tool.register({
      name: 'post_review',
      description: 'Post this round\'s review on the watched pull request, under the gh login, at the head that was reviewed. The mod writes the first line from the two verdicts; the body is everything after it. Refused when the head has moved or the body looks like it holds a secret.',
      inputSchema: {
        type: 'object',
        properties: {
          head: { type: 'string', description: 'The full sha the reviewers reviewed.' },
          spec: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES'] },
          adversarial: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES'] },
          body: { type: 'string', description: 'The findings, what was fixed in which commit, and the follow-ups, in Markdown.' },
        },
        required: ['head', 'spec', 'adversarial', 'body'],
      },
    })
    await $.tool.register({
      name: 'counsel',
      description: 'Put a question to the counsel of seven members, the six reviewers and the owner\'s advocate, before asking the person. The mod writes the brief (without the lean) and answers with the question id, the brief folder and which members to launch. A decision is recorded in the spec unless pull_request names the watched pull request while it is open; then the mod lists it in that pull request\'s next review. To put a review round\'s follow-ups, give follow_ups and no options or pull_request: each follow-up gets the same three options, fix it in this pull request, file it as an issue or drop it, and is decided on its own; the decisions are recorded only in the round\'s Follow-ups section. A follow-up outside the spec, given as { text, outside_spec: true }, is offered only file and drop, and a vote to fix it is not counted.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question, as it would be asked.' },
          options: { type: 'array', items: { type: 'string' }, minItems: MIN_OPTIONS, maxItems: MAX_BRIEF_OPTIONS, description: `${MIN_OPTIONS} to ${MAX_BRIEF_OPTIONS} options, in the order given; no recommendation. Required unless follow_ups is given, and refused with it.` },
          follow_ups: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    outside_spec: { type: 'boolean', enum: [true] },
                  },
                  required: ['text', 'outside_spec'],
                  additionalProperties: false,
                },
              ],
            },
            minItems: 1,
            maxItems: MAX_FOLLOW_UPS,
            description: `1 to ${MAX_FOLLOW_UPS} follow-ups, each in one or two sentences saying what it is and what a person would see if it is never fixed. Give a follow-up as its text, or, for a finding the claim checker confirmed is outside the spec, as { text, outside_spec: true }, which the counsel may only file or drop. Give it in place of options, and without pull_request.`,
          },
          background: { type: 'string', description: 'The issue in a few lines, what was tried, and what is at stake.' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Paths, relative to the checkout, of the spec, plan or code the question touches.' },
          lean: { type: 'string', description: 'The session\'s own lean. Kept out of the brief and shown to the person only if they are asked.' },
          pull_request: { type: 'integer', minimum: 1, description: 'The number of the watched, open pull request the decision belongs to, so the mod lists it in that pull request\'s next review. Leave it out to record the decision in the spec, as a spec interview always does. Any other number is refused, and so is any number with follow_ups.' },
        },
        required: ['question', 'background', 'lean'],
      },
    })
    await $.tool.register({
      name: 'counsel_tally',
      description: 'Report the counsel members\' votes on one round of a question. The mod counts them and answers decided, rerun or ask the person, with what to do next. On a follow-ups question, report each member\'s votes in follow_ups, by the follow-up\'s number, and no vote of its own; the mod counts each follow-up on its own and answers with every decision.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The question id the counsel tool answered with.' },
          round: { type: 'integer', enum: [1, 2] },
          votes: {
            type: 'array',
            description: 'One entry for every member of the counsel, all seven. Report a member that failed or was stopped with an empty vote; a member without a vote is asked again before the round is counted.',
            items: {
              type: 'object',
              properties: {
                member: { type: 'string', description: 'The member\'s agent type, such as builder:spec-reviewer.' },
                vote: { type: 'string', description: 'The text after VOTE:, word for word as the member reported it, without tidying it. Empty for a member that failed or was stopped, and always empty or left out on a follow-ups question.' },
                reason: { type: 'string', description: 'The text after REASON:, as reported.' },
                new_option: { type: 'string', description: 'The text after NEW OPTION:, if the member gave one.' },
                follow_ups: {
                  type: 'array',
                  description: 'On a follow-ups question only, in place of vote and reason: one entry for each follow-up the member voted on. Give none for a member that failed or was stopped.',
                  items: {
                    type: 'object',
                    properties: {
                      number: { type: 'integer', minimum: 1, description: 'The follow-up\'s number, from the brief.' },
                      vote: { type: 'string', description: 'The text after VOTE n:, word for word as the member reported it.' },
                      reason: { type: 'string', description: 'The text after REASON n:, as reported.' },
                    },
                    required: ['number', 'vote', 'reason'],
                  },
                },
              },
              required: ['member'],
            },
          },
        },
        required: ['id', 'round', 'votes'],
      },
    })
    await $.tool.register({
      name: 'open_pane',
      description: 'Open the builder pane, as /builder does, so the person can see the mod from the start of the session. Takes no input. Answers that the pane is open, or that it waits and is not drawn yet, with the engine\'s reason.',
    })
    await $.tool.register({
      name: 'progress',
      description: 'Report the stage of /implement the session is entering, so the bar above the prompt shows it. The bar counts the stages before the furthest one reported, out of nine, and never goes back. A different title starts new work.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The issue in a few words, such as ABC-123 short issue name.' },
          stage: { type: 'string', enum: STAGES.map(stage => stage.id), description: 'The stage being entered.' },
          note: { type: 'string', description: 'A sub-step shown beside the stage, such as round 2. It never moves the bar.' },
        },
        required: ['title', 'stage'],
      },
    })
    // This load's stamp is set first, so it orders this copy after every
    // copy loaded before it (see stampLoad). A memo of this session, kept
    // across a hot reload, is then taken up again, so the writes below
    // already count for the status file. When taking it up fails, the next
    // prompt takes the memo up instead (see lookForTicket), and until then
    // the file is not written.
    await stampLoad($).catch(() => undefined)
    await startStatus($).catch(() => undefined)
    await update($, cwd, () => e.cwd)
    // The hooks start again after a hot reload too, which drops every call in
    // flight from this module, so the records of them go. A question still
    // marked unanswered is settled, and its label taken off, rather than leave
    // the line waiting on the owner for the rest of the session.
    await update($, calls, () => [])
    await update($, questions, list => list.map(q => (q.answered ? q : { ...q, answered: true })))
    void inLabelQueue(() => takeOffAnsweredLabels($))
    mergePattern = mergePatternOf(await projectMergeCommand($, e.cwd))
    refreshLater($)
    ensureLive($)
    void pruneTold($).catch(() => undefined)
    void pruneOwed($).catch(() => undefined)
    // Watching starts only when asked (the watch tool or /builder watch), so a
    // session that has not named a pull request is never handed one.
    void ensureArmed($)
    // A watch that survived a reload is read at once, so the pane does not
    // wait for the first poll to replace a snapshot an older build saved.
    void look($, 'session-start', 'observe').catch(() => null)
    return next(e)
  })

  // One hook for every tool call. It serves the session's own tools (open_pane,
  // progress, watch, package, post_review, counsel and counsel_tally), which a subagent may not call; it labels the
  // pull request while the owner is asked a question; and it is a second
  // fence behind the read-only agents' tool lists, so the agents in
  // READ_ONLY_AGENTS, the reviewers and the owner's advocate, may use only the
  // tools in REVIEWER_TOOLS. The tools are matched by name inside the
  // hook because a matcher on an MCP tool name sends the type checker into an
  // endless instantiation. Each tool's answer begins with the mod's name; a
  // command's output does not, because the host already names the mod there.
  // A call of the session's own runs inside a record of it, so the line can
  // name it while it runs; AskUserQuestion and Agent calls are left out,
  // because the line names the question and the agent already. After a push
  // or merge of the session's own that succeeded, the mod looks at the pull
  // request soon, even while the turn goes on.
  // However the call ends, its return closes one permission prompt of its
  // loop and tool for the status file.
  on('tool.call', async ($, e, next) => {
    try {
      if (e.agentId !== undefined || UNNAMED_TOOLS.has(String(e.tool))) return await route($, e, next)
      const ran = await foreground($, e, () => route($, e, next))
      if (e.tool === 'Bash' && succeeded(ran) && isPushOrMerge(String(e.command), mergePattern)) armCommandLooks($)
      return ran
    } finally {
      await changeMemo($, memo => afterCallReturn(memo, e.agentId ?? '', String(e.tool))).catch(() => undefined)
    }
  }).catch(($, e, next) => {
    // Once the call went on, a failure is the tool's own, not the fence's.
    if (next.called) return next(e)
    // The fence could not decide. A subagent's call that a reviewer could not
    // make is refused rather than let through.
    if (e.agentId !== undefined && !REVIEWER_TOOLS.has(String(e.tool))) {
      return { deny: 'builder: the reviewer fence could not check this call, so it is refused.' }
    }
    return next(e)
  })

  // The host already puts the mod's name in front of a command's output.
  on('command.run', { command: 'builder' }, async ($, e) => {
    await markStarted($)
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'poll') {
      const s = await look($, 'command', 'observe')
      return { text: s ? stateLines(s).join('\n') : 'No pull request is watched, or gh could not read it.' }
    }
    if (verb === 'watch' && arg) return { text: await serveWatch($, { number: Number(arg) }) }
    if (verb === 'wakes') {
      const list = await read($, wakes)
      if (list.length === 0) return { text: 'Nothing has woken the mod yet.' }
      const now = await $.clock.now()
      return { text: list.map(w => `${timeOfDay(w.at, now)} ${w.source} ${w.changed ? 'changed' : 'unchanged'}`).join('\n') }
    }
    return { text: await openPane($, 'command') }
  })

  // Only the session's own turn raises turn.start; a subagent's run does not.
  on('turn.start', async ($, e, next) => {
    ownTurnsStarted += 1
    turnRunning = true
    rateLimitSeen = false
    pendingErrorTurn = null
    // A new turn means the last one ended, so the session's own permission
    // prompts are closed for the status file.
    void changeMemo($, memo => afterLoopEnd(memo, '')).catch(() => undefined)
    await update($, busy, () => true)
    refreshLater($)
    return next(e)
  })

  // The session's own turn end reports its background work in flight, which
  // replaces what the last one reported. A subagent's Stop carries its
  // agent_id and says nothing about the session's work.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id === undefined) await replaceBackground($, e.background_tasks)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent's end carries the same session-wide list of background work as
  // the session's own turn end, so it replaces the list too, and a command
  // that finished while a subagent ran leaves the line sooner. Only a list is
  // taken: an older engine sends no field, and its absence says nothing about
  // the session's work, where the Stop's absence means nothing is in flight.
  on('classic.SubagentStop', async ($, e, next) => {
    if (Array.isArray(e.background_tasks)) await replaceBackground($, e.background_tasks)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The session's own turn that an API error ended reports the error here. A
  // usage limit marks the turn for the hold, which is decided here when the
  // turn's end came first and found no window used up. A subagent's carries
  // its agent_id.
  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id === undefined && e.error === 'rate_limit') {
      rateLimitSeen = true
      const pending = pendingErrorTurn
      if (pending !== null && !turnRunning) await decideHold($, pending.endedAt)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The desktop app wakes the session for a CI failure or a merge conflict.
  // The turn it starts gets the rest of the pull request's state with it.
  //
  // A prompt of the person's resets the stuck interval and the hold first,
  // before any await (see personPromptResets). The first prompt the mod sees
  // for a session id is then where it looks for the foreman's ticket, and
  // after that look a prompt of the person's answers whatever question the
  // counsel left for them, so a session that takes its memo up only at this
  // prompt clears that question too.
  on('prompt.submit', async ($, e, next) => {
    void ensureArmed($)
    await personPromptResets($, e.origin, e.text).catch(() => undefined)
    await lookForTicket($, e.text).catch(() => undefined)
    if (isPersonPrompt(e.origin, e.text)) await changeMemo($, afterPersonPrompt).catch(() => undefined)
    if (e.origin.kind !== 'sdk' || !isCiMonitorEvent(e.text)) return next(e)
    const r0 = await read($, run)
    const toldBefore = r0 === null ? null : await told($, r0)
    // The look tells its own read, so no delivering look hands anything over
    // from the moment it goes on with that read, stored or overtaken, until
    // this handler is done with it, however it ends (see untoldOwnReads).
    return tellingOwnRead(async ownRead => {
      const seen = await lookAt($, 'ci-monitor', 'observe', { actsOnRead: true, ownRead })
      if (seen === null) return next(e)
      const { r, s, seq } = seen
      const passed = await next({ ...e, context: [...(e.context ?? []), ciEventContext(s)] })
      // Recorded as told only once the prompt goes on to start its turn, under
      // the watch it was read under, and only if nothing else recorded a
      // different state for that watch meanwhile. `tell` also refuses the read
      // when a newer one was recorded as told meanwhile. The record check stays
      // beside that rule rather than folded into it, because it is stricter: it
      // also holds back when an older read was recorded meanwhile, and the
      // next poll then hands the difference over.
      if (passed.drop !== undefined) return passed
      if (!(await stillWatching($, r))) return passed
      // A switch before the look is caught here too, by comparing the watch
      // read before the look with the watch the look read under. The
      // fingerprint names neither the repository nor the number, so without
      // that check the records of two pull requests in the same state would
      // compare as one.
      if (!isSameRun(r0, r) || !isSameState(await told($, r), toldBefore)) return passed
      await tell($, r, s, seq)
      return passed
    })
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    // A workflow's agents carry ids the engine's list never names, which
    // would leave a read-only agent, a reviewer or the owner's advocate,
    // outside the fence; they run from the session.
    if (e.workflow !== undefined && READ_ONLY_AGENTS.has(e.subagentType)) {
      return { deny: `builder: ${e.subagentType} runs only from the session, where the reviewer fence can see it.` }
    }
    const spawned = await next(e)
    const id = spawned.agentId
    if (id !== undefined) {
      const startedAt = await $.clock.now()
      await update($, agents, list => [...list, {
        id,
        type: e.subagentType,
        description: e.description,
        asked: e.prompt.slice(0, 160),
        status: 'running' as const,
        startedAt,
        ...(typeof spawned.model === 'string' ? { model: spawned.model } : {}),
      }].slice(-AGENTS_KEPT))
      ensureLive($)
      refreshLater($)
    }
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      // Both are read or set before the first await. The number of turns
      // started goes with a hold this end may start, so that hold's save can
      // tell that a later turn replied while this end was still under way,
      // and with the clear a reply makes, so that the clear can tell that a
      // later turn started and leave that turn's hold alone.
      // The last turn that replied is set so that a hold whose save is under
      // way sees that this turn replied (see saveHoldOrTakeItOff).
      const turnsStarted = ownTurnsStarted
      const isReplied = e.reason === 'answer' || e.reason === 'refusal'
      if (isReplied) repliedTurn = ownTurnsStarted
      // Busy and turnRunning are cleared before the check of isHeld, the held
      // handover, below. A handover that records a held change reads busy
      // again afterwards, and deliver's last check before its submit reads
      // turnRunning; both rely on this order: either that check sees the held
      // change, or the handover sees the turn ended.
      turnRunning = false
      // The turn's end closes the session's own permission prompts.
      void changeMemo($, memo => afterLoopEnd(memo, '')).catch(() => undefined)
      await update($, busy, () => false)
      refreshLater($)
      void ensureArmed($)
      // Every turn end compares the mod's files, hold or not, so a session
      // with nothing watched still learns that builder changed on disk.
      void compareLoaded($).catch(() => undefined)
      // A turn an API error ended may start a usage-limit hold. While the
      // hold is on, a change held during the turn stays held for the end of
      // the turn after the hold, and no look runs. A turn that ended with an
      // answer or a refusal takes a saved hold off first, so the held
      // handover and the looks below run; one that was aborted may never
      // have reached the API, and leaves the hold as it is. Any turn end
      // that starts no hold restarts the quiet time.
      if (e.reason === 'error' && (await errorTurnHolds($, turnsStarted))) return next(e)
      if (isReplied) await repliedTurnClearsHold($, turnsStarted)
      void markQuiet($).catch(() => undefined)
      // A change found during the turn is delivered now, not at the next poll.
      // When that hands the change over with a prompt, nothing more is needed.
      // When it does not (gh could not read the pull request, the prompt was
      // refused, the read matched what the session was already told, a newer
      // read was already told, or another handover was in progress), the
      // looks afterwards run as they do after any turn.
      if (isHeld) {
        isHeld = false
        void lookAt($, 'turn-end', 'deliver')
          .then(seen => {
            if (seen?.delivered !== true) armTurnEndLooks($)
          })
          .catch(() => armTurnEndLooks($))
        return next(e)
      }
      armTurnEndLooks($)
      return next(e)
    }
    // A subagent's card records how it ended. An agent the mod has no card
    // for (it started before the hooks were loaded) gets a placeholder card.
    const agentId = e.agentId
    // The agent's end closes its permission prompts.
    void changeMemo($, memo => afterLoopEnd(memo, agentId)).catch(() => undefined)
    const now = await $.clock.now()
    const ended = { status: statusOf(e.isAborted, e.reason), durationMs: e.durationMs, summary: summaryOf(e.answer), endedAt: now }
    await update($, agents, list => {
      if (list.some(card => card.id === agentId)) {
        return list.map(card => (card.id === agentId ? { ...card, ...ended } : card))
      }
      return [...list, placeholderCard(agentId, now, ended)].slice(-AGENTS_KEPT)
    })
    // The agent pane on this agent shows the messages it ended with.
    if (outputCache?.id === agentId) void refreshOutput($, agentId).catch(() => undefined)
    void markQuiet($).catch(() => undefined)
    refreshLater($)
    return next(e)
  })

  // A permission prompt is open from here until the same loop's call of the
  // same tool returns, or that loop's turn ends. The loop is the session's
  // own, or the subagent the event's agent_id names. The status file names
  // the tool and never copies its input.
  on('classic.PermissionRequest', async ($, e, next) => {
    await changeMemo($, memo => afterPermissionRequest(memo, e.agent_id ?? '', String(e.tool_name)))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every failed call, the session's own and its subagents', counts in the
  // status file's cleanup record once the cleanup skill has started.
  on('classic.PostToolUseFailure', async ($, e, next) => {
    await changeMemo($, memo => afterFailedCall(memo, e.error))
    return next(e)
  }).catch(($, e, next) => next(e))

  // The cleanup skill starting puts the status file in cleanup until the
  // session ends. The skill's text is passed on unchanged.
  on('skill.prompt', async ($, e, next) => {
    if (isCleanupSkill(e.skill)) await changeMemo($, afterCleanupSkill)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The session's end stops the status file, and deletes it after a merge,
  // within the engine's short budget for ending a session.
  on('session.end', async ($, e, next) => {
    await endStatus($, e.reason, e.sessionId, next.budget).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The pane. Pressing the fold folds or unfolds the finished agents.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const presses = {
      // The pane read the fold while drawing, which subscribes the drawing,
      // so this write redraws it without a call to $.ui.invalidate.
      fold: () => {
        void update($, finishedFolded, folded => folded === false).catch(() => undefined)
      },
      output: (id: string) => {
        void showOutput($, id).catch(() => undefined)
      },
    }
    return paneTree(elementsOf($, e), await view($), presses, columnsOf(e.props.bodyColumns))
  })

  // The agent pane, on the agent whose output button was pressed last. When
  // the cache holds no read for that agent, as after it was emptied, its draw
  // starts a read of the messages and keeps it in the cache, so a draw that
  // comes while that read is under way shares the same read. No draw waits on
  // a read: until it settles, the pane shows that the messages are being
  // read, and the read asks for a redraw when it settles.
  on('ui.render', { component: 'Pane', requestId: AGENT_PANE }, async ($, e) => {
    const chosen = await read($, outputAgent)
    const id = typeof chosen === 'string' ? chosen : null
    const card = id === null ? undefined : (await read($, agents)).find(c => c.id === id)
    if (id !== null && outputCache?.id !== id) outputCache = startRead($, id).reading
    const messages = id === null || outputCache === undefined ? null : outputCache.answer
    return agentPaneTree(elementsOf($, e), card, messages, await $.clock.now(), columnsOf(e.props.bodyColumns))
  })

  // A background task's notification row in the transcript names the task
  // that ended and how, so drawing it takes that task off the background list
  // without waiting for the next turn end, which may never come while the
  // session is idle. The engine refuses a state write while a render hook
  // draws, and a read made while drawing would subscribe the row to every
  // later change of the list, so the hook touches no state: it only schedules
  // the removal. A row whose task cannot be listed, a subagent's or one already
  // taken off, schedules nothing and reads nothing. If scheduling throws, the
  // registered catch passes the row on unchanged, and the next turn end still
  // clears the list.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const id = endedTaskOf(e.props)
    if (id !== null && couldBeListed(id)) {
      $.clock.after(0, () => {
        void removeBackground($, id).catch(() => undefined)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band gives way to Claude Code's survey, and to the host when it has
  // nothing to draw, which bandTree answers with null. Pressing the line opens the
  // pane, as /builder does; pressing the agent count opens it or closes it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await view($)
    const width = columnsOf(e.props.bodyColumns)
    const line = secondRow(v, width)
    const presses = {
      agents: () => {
        void togglePane($).catch(() => undefined)
      },
      line: () => {
        void openPane($, 'tool').catch(() => undefined)
      },
    }
    return bandTree(elementsOf($, e), v, line, width, presses) ?? next(e)
  })
}
