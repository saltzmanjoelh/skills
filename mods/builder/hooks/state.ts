// Pure rules the hooks apply to the session's state.

import type { PromptOrigin, SessionRateLimit, UserMessageTask } from 'claude-code'

import type { AgentCard, AgentStatus, BackgroundTask, Question, UsageHold, WaitingOn } from '../types'
import { ciOf, isCiMonitorEvent, type Snapshot } from './github'

// The verdict and lens reviewers, the agents a pull request's review rounds
// launch. The read-only fence uses READ_ONLY_AGENTS below, not this set. The
// claim checker and the bug reproducer may run commands, so they are in
// neither.
export const REVIEWERS = new Set([
  'builder:spec-reviewer',
  'builder:adversarial-reviewer',
  'builder:security-reviewer',
  'builder:maintainability-reviewer',
  'builder:performance-reviewer',
  'builder:data-reviewer',
])

// The owner's advocate sits on the counsel only and is never launched in a
// pull request's review rounds, so it is not in REVIEWERS. It only reads, as
// the reviewers do.
export const OWNERS_ADVOCATE = 'builder:owners-advocate'

// The agents the mod holds to REVIEWER_TOOLS, the reviewers and the owner's
// advocate. The engine's tool lists in the agent files are the first fence,
// and this set is the second.
export const READ_ONLY_AGENTS: ReadonlySet<string> = new Set([...REVIEWERS, OWNERS_ADVOCATE])

// What a reviewer may use: reading, and SubagentHandback, which is how any
// subagent hands its report back. Everything else is refused, so a tool added
// later is refused until someone decides a reviewer needs it.
export const REVIEWER_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch', 'SubagentHandback'])

const RUNNING_STATUSES = new Set<string>(['pending', 'running', 'waiting'])

// Whether an agent still runs: the engine's list named it at the last read
// and its loop is pending, running or waiting. Every reader of a card's status
// asks this, so a word an older build saved ('done', 'aborted') reads as not
// running, and so does an agent the engine has dropped from its list.
export function isRunning(card: AgentCard): boolean {
  return card.isListed !== false && RUNNING_STATUSES.has(card.status)
}

// The word an agent's row shows for its status. An agent the engine has
// dropped from its list while its stored status still says it runs reads
// `no longer listed`, because it is not running in the sense `isRunning`
// gives the word. A finished word is kept whether or not the agent is listed,
// and nothing stored changes.
export function shownStatus(card: AgentCard): string {
  if (card.isListed === false && RUNNING_STATUSES.has(card.status)) return 'no longer listed'
  return card.status
}

// An agent as `$.agent.list()` gives it, with only the fields the mod keeps.
export type ListedAgent = { id: string; type: string; description: string; status: AgentStatus }

export const AGENTS_KEPT = 100

// The cards after a read of the engine's list that began at `readStartedAt`
// and is merged at `now`. A listed agent updates its card, or gets one when
// the mod never saw it spawn (a forked skill, or one this mod's hooks were not
// loaded for). A card that leaves running is marked ended once, and one that
// runs again (resumed with SendMessage) loses what it reported when it ended.
// A card the list does not name is marked not listed and otherwise kept, so
// the pane still shows it. A card spawned or ended after the read began is
// left alone, because the read is older than what the card records.
export function mergeAgents(cards: readonly AgentCard[], listed: readonly ListedAgent[], now: number, readStartedAt: number): AgentCard[] {
  const isNewer = (card: AgentCard) => card.startedAt >= readStartedAt || (card.endedAt ?? -Infinity) >= readStartedAt
  const byId = new Map(listed.map(agent => [agent.id, agent]))
  const merged = cards.map(card => {
    if (isNewer(card)) return card
    const agent = byId.get(card.id)
    if (agent === undefined) return { ...card, isListed: false }
    const next: AgentCard = { ...card, type: agent.type, description: agent.description, status: agent.status, isListed: true, lastSeenAt: now }
    if (isRunning(next)) {
      if (!isRunning(card)) {
        delete next.endedAt
        delete next.durationMs
        delete next.summary
      }
    } else if (next.endedAt === undefined) {
      next.endedAt = now
    }
    return next
  })
  const known = new Set(cards.map(card => card.id))
  for (const agent of listed) {
    if (known.has(agent.id)) continue
    const fresh: AgentCard = { id: agent.id, type: agent.type, description: agent.description, status: agent.status, startedAt: now, isListed: true, lastSeenAt: now }
    if (!isRunning(fresh)) fresh.endedAt = now
    merged.push(fresh)
  }
  return merged.slice(-AGENTS_KEPT)
}

// The cards in `after` that a merge ended: those that ran in `before`, the
// cards as they stood before the merge, and no longer run. A card the engine
// dropped from its list counts, because it no longer runs either.
export function endedCards(before: readonly AgentCard[], after: readonly AgentCard[]): AgentCard[] {
  const runningBefore = new Set(before.filter(isRunning).map(card => card.id))
  return after.filter(card => !isRunning(card) && runningBefore.has(card.id))
}

// The session's background work as the session's own Stop and each subagent's
// SubagentStop report it. Anything that is not a list, or an entry that is not
// an object, is dropped, and so is a subagent, which the line and the pane
// already show as an agent. Only the fields the mod draws are kept.
export function backgroundOf(raw: unknown): BackgroundTask[] {
  if (!Array.isArray(raw)) return []
  const tasks: BackgroundTask[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const task = entry as Record<string, unknown>
    if (task.type === 'subagent') continue
    const kept: BackgroundTask = { id: String(task.id ?? ''), type: String(task.type ?? ''), status: String(task.status ?? ''), description: String(task.description ?? '') }
    if (typeof task.command === 'string') kept.command = task.command
    tasks.push(kept)
  }
  return tasks
}

// Tools whose calls the line does not name while they run. The line already
// says `waiting on your answer` for an AskUserQuestion call, and names the
// agent an Agent call starts, so each running thing is named once.
export const UNNAMED_TOOLS = new Set(['AskUserQuestion', 'Agent'])

// What the line names a running call by: a Bash call's description when it is
// not blank, else its command, else the tool's name.
export function labelOf(e: { tool: string; description?: unknown; command?: unknown }): string {
  if (e.tool !== 'Bash') return e.tool
  if (typeof e.description === 'string' && e.description.trim() !== '') return e.description
  if (typeof e.command === 'string' && e.command.trim() !== '') return e.command
  return e.tool
}

// Where a command may start inside a command line: at its start, or after a
// separator or an opening parenthesis. It ends at a space, a separator, a
// closing parenthesis or the end.
const COMMAND_START = String.raw`(?:^|[;&|(\n])\s*`
const COMMAND_END = String.raw`(?=\s|$|[;&|)])`
const PUSH_OR_MERGE = new RegExp(String.raw`${COMMAND_START}(?:git(?:\s+-[cC]\s+\S+)*\s+push|gh\s+pr\s+merge)${COMMAND_END}`)

// The pattern for the project's merge command: the fixed words before its
// first `<`, when there are at least two of them, because a single word is
// too common to mark a merge. The words are escaped so that they are matched
// as text. It answers null when there is no merge command or too few words.
// The session builds it once, when it reads the merge command at its start,
// rather than on every command the session runs.
export function mergePatternOf(mergeCommand: string | null): RegExp | null {
  if (mergeCommand === null) return null
  const words = mergeCommand.split('<')[0]!.trim().split(/\s+/).filter(word => word !== '')
  if (words.length < 2) return null
  const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`${COMMAND_START}${escaped.join(String.raw`\s+`)}${COMMAND_END}`)
}

// Whether a command the session ran pushes or merges: `git push` (also after
// any number of `-c <key=value>` and `-C <dir>` options), `gh pr merge`, or
// the project's merge command, given as the pattern mergePatternOf built from
// it. The command is only matched against these patterns and passed nowhere.
// The pattern knows nothing of quotes, so it also matches `git push` inside a
// quoted string, such as `echo "a; git push"`, which costs one extra read of
// the pull request. It misses a `-c` value quoted with spaces in it, such as
// `git -c "a=b c" push`, and other options before `push`, such as
// `--git-dir=<dir>`; the looks after the turn ends find what such a push did.
// An option and its value are separated by whitespace and the value holds
// none, so the repeated group cannot match one stretch of text two ways.
export function isPushOrMerge(command: string, mergePattern: RegExp | null): boolean {
  return PUSH_OR_MERGE.test(command) || (mergePattern?.test(command) ?? false)
}

export function waitingOn(s: Snapshot | null, cards: readonly AgentCard[], asked: readonly Question[]): WaitingOn {
  if (asked.some(question => !question.answered)) return 'owner'
  if (cards.some(isRunning)) return 'agents'
  if (s === null || s.state !== 'OPEN') return 'nothing'
  // A failed check is waited on first. A workflow run that has not finished
  // is waited on as a pending check is, because it may never register one.
  const ci = ciOf(s.checks)
  if (ci === 'failed') return 'fix'
  if (ci === 'pending' || (s.runs ?? []).length > 0) return 'ci'
  if (s.labels.includes('ready-to-merge')) return 'merge'
  return 'nothing'
}

// Short while a state is about to change on GitHub's side, long otherwise. A
// failed check counts as about to change, because the session is fixing it or
// has rerun it, and a rerun that fails the same way raises no event from the
// desktop app, so only the poll sees it finish. A running subagent polls as
// slowly as a pull request with nothing pending, because its finish starts a
// turn of the session's own, and the looks after that turn ends work out the
// next poll again from the new state.
// The README's section "How often it looks at the pull request" lists every
// state, its interval and what ends its wait. Whoever changes an interval
// here, or NEW_HEAD_POLL_MS below, updates that list too, because no test
// reads it.
export const POLL_MS: Record<WaitingOn, number> = {
  ci: 90_000,
  fix: 90_000,
  merge: 90_000,
  agents: 10 * 60_000,
  owner: 10 * 60_000,
  nothing: 10 * 60_000,
}

// While the pull request's head differs from the head the session was last
// told, a change waits to be handed over (usually the session's own push),
// so the mod looks again soon whatever else is waiting.
export const NEW_HEAD_POLL_MS = 90_000

// How long until the next look, and whether it was shortened for a new head.
// With no record of what the session was told, the head cannot be compared,
// and the other states set the interval. `stalledHead` is the head whose
// handover was last refused or held; it keeps its new-head mark but polls at
// the ordinary interval, so a head that cannot be handed over does not poll
// every 90 seconds for the rest of the session. A later head polls quickly again.
export function pollFor(
  s: Snapshot | null,
  toldHead: string | null,
  cards: readonly AgentCard[],
  asked: readonly Question[],
  stalledHead: string | null,
): { ms: number; isNewHead: boolean } {
  const isNewHead = s !== null && s.state === 'OPEN' && toldHead !== null && s.head !== toldHead
  if (isNewHead && s.head !== stalledHead) return { ms: NEW_HEAD_POLL_MS, isNewHead }
  return { ms: POLL_MS[waitingOn(s, cards, asked)], isNewHead }
}

const END_LINE = /^(LENS-END|CLAIMS-END|VERDICT:)\s/

export function summaryOf(answer: string): string {
  const lines = answer.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
  const last = lines.at(-1) ?? ''
  if (END_LINE.test(last)) return last
  return (lines[0] ?? '').slice(0, 120)
}

// The words a task's notification uses for a task that has ended, the same
// three a subagent's card takes when its turn completes.
const ENDED_TASK_STATUSES = new Set<string>(['completed', 'failed', 'killed'] satisfies ReturnType<typeof statusOf>[])

// The id of the task a transcript row reports as ended: a task notification's
// row whose task has a non-empty id and a status of completed, failed or
// killed. Any other row gives null.
export function endedTaskOf(props: { origin: PromptOrigin; task?: UserMessageTask }): string | null {
  if (props.origin.kind !== 'task-notification') return null
  const id = props.task?.id
  const status = props.task?.status
  if (typeof id !== 'string' || id === '' || typeof status !== 'string') return null
  return ENDED_TASK_STATUSES.has(status) ? id : null
}

// The status a subagent's card takes when its turn completes, in the
// engine's words.
export function statusOf(isAborted: boolean, reason: string): 'completed' | 'failed' | 'killed' {
  if (isAborted) return 'killed'
  if (reason === 'error') return 'failed'
  return 'completed'
}

export const QUESTIONS_KEPT = 20

// The newest questions, plus any older one whose label removal is still owed,
// since the question is the only record that it is.
export function keepQuestions(list: Question[]): Question[] {
  const newest = list.slice(-QUESTIONS_KEPT)
  const owed = list.slice(0, -QUESTIONS_KEPT).filter(q => q.labelled && q.unlabelled !== true)
  return [...owed, ...newest]
}

// How long the session may stay quiet before the mod starts a turn asking it
// whether its wait is real, and the ceiling that interval doubles up to; and
// when a usage-limit hold resumes: one minute after the exhausted windows
// reset, or fifteen minutes after the turn ended when no reset time can be
// read. The README's section "When the session goes quiet, and when a usage
// limit runs out" states these numbers; whoever changes one here updates it
// too, because no test reads it.
export const STUCK_FIRST_MS = 45 * 60_000
export const STUCK_CEILING_MS = 360 * 60_000
export const RESUME_AFTER_RESET_MS = 60_000
export const RESUME_FALLBACK_MS = 15 * 60_000

// The longest single wait the mod hands to the engine's timer, for the stuck
// prompt and for the hold alike. The engine's timer holds about 24.8 days at
// most, and a spend limit can reset a month away, so a longer wait is taken
// in steps of this length, each of which checks the time and arms the next.
// The README's section named above states it as six hours.
export const TIMER_STEP_MS = 6 * 60 * 60_000

// The wait for the next step toward the due time `due`, from `now`. It is
// never negative, so a due time already past fires at once, and never longer
// than TIMER_STEP_MS, so a step that ends early arms the next.
export function stepDelay(due: number, now: number): number {
  return Math.min(Math.max(due - now, 0), TIMER_STEP_MS)
}

// The stuck interval after a stuck prompt was accepted: twice the last one, up
// to the ceiling.
export function nextStuckEvery(ms: number): number {
  return Math.min(ms * 2, STUCK_CEILING_MS)
}

// The stuck prompt's atoms and the hold's as they are read. A value in
// another shape reads as its default: no quiet time, the first interval, and
// no hold.
export const quietIn = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null)
export const stuckEveryIn = (raw: unknown): number => (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : STUCK_FIRST_MS)
export function holdIn(raw: unknown): UsageHold | null {
  const hold = raw as { until?: unknown } | null | undefined
  return typeof hold?.until === 'number' && Number.isFinite(hold.until) ? { until: hold.until } : null
}

// The usage windows at 100 percent or more, from `$.session.usage().rateLimits`
// as it was read. Anything that is not a list answers none, and an entry that
// is not an object, or whose percentage is not a finite number, is dropped. A
// spend limit can read past 100, and counts.
export function exhaustedWindows(raw: unknown): SessionRateLimit[] {
  if (!Array.isArray(raw)) return []
  return (raw as unknown[]).filter((entry): entry is SessionRateLimit => {
    if (typeof entry !== 'object' || entry === null) return false
    const used = (entry as Record<string, unknown>).percentUsed
    return typeof used === 'number' && Number.isFinite(used) && used >= 100
  })
}

// When a hold that began with a turn ended at `endedAt` resumes: one minute
// after the latest reset time among the exhausted windows, or one minute
// after the turn ended when that reset is already past. With no reset time
// that can be read, it resumes fifteen minutes after the turn ended.
export function resumeAt(exhausted: readonly SessionRateLimit[], endedAt: number): number {
  const resets = exhausted
    .map(window => (typeof window.resetsAt === 'string' ? Date.parse(window.resetsAt) : Number.NaN))
    .filter(at => Number.isFinite(at))
  if (resets.length === 0) return endedAt + RESUME_FALLBACK_MS
  return Math.max(Math.max(...resets), endedAt) + RESUME_AFTER_RESET_MS
}

const PERSON_ORIGINS = new Set<PromptOrigin['kind']>(['composer', 'bridge', 'slack-ping'])

// Whether a prompt was the person's: typed at the terminal, sent through the
// bridge or pinged from Slack, or arrived from the SDK, which is how a prompt
// typed in the desktop app arrives, unless it is the desktop app's CI event.
// A prompt a plugin submitted, this mod's own among them, and every other
// origin is not the person's.
export function isPersonPrompt(origin: PromptOrigin, text: string): boolean {
  if (PERSON_ORIGINS.has(origin.kind)) return true
  return origin.kind === 'sdk' && !isCiMonitorEvent(text)
}
