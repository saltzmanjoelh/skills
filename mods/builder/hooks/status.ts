// The rules of the status file builder writes for the foreman: which session
// writes one, where it goes, which of the six states holds and why, the
// record itself, and how each event changes the memo the record is worked
// out from. It also holds the rules for the start times of background tasks
// and the rule that marks one as probably hung, which the line above the
// prompt and the pane share with the record. Nothing here touches the
// engine; hooks/register.tsx reads the state, calls these and writes the
// file. Every function is pure, so the tests can check each rule without the
// engine.

import type { SessionMessage } from 'claude-code'

import type { AgentCard, BackgroundTask, BuilderRun, BuildState, BuildStatus, ForegroundCall, ForemanNudgeText, LastTurn, NextLook, OpenPrompt, Progress, Question, StatusMemo, UsageHold, UsageLedger, Verdicts } from '../types'
import { ciOf, type Snapshot } from './github'
import { barOf } from './progress'
import { secretIn } from './review'
import { isRunning } from './state'
import { printable } from './text'

// The version the record carries. Whoever changes what a field means raises
// it here and in BuildStatus, so the foreman can tell an older record apart.
export const STATUS_VERSION = 1

// How long the last line of a failed call's error may be once cleaned.
export const ERROR_CHARS = 200

// What the cleanup record holds in place of an error line that looks like it
// holds a secret, because the foreman's folder is read by another session.
export const WITHHELD = '(withheld: it looks like a secret)'

// The line the foreman adds to the first prompt of a session it starts. The
// value is the rest of the line with the white space around it removed. A
// line may have spaces or tabs before the word, as a prompt indented in a
// brief would.
const TICKET_LINE = /^[ \t]*foreman-ticket:(.*)$/m

// The ticket a prompt's text holds, or null when it holds no ticket line or
// the line's value is empty. Only the first ticket line counts.
export function ticketIn(text: string): string | null {
  const match = TICKET_LINE.exec(typeof text === 'string' ? text : '')
  const value = match?.[1]?.trim() ?? ''
  return value === '' ? null : value
}

// The nudges foreman sends a sub session, word for word. The type check
// requires the object to name every text of ForemanNudgeText and nothing
// else, so a nudge reworded in the state contract cannot be missed here.
const NUDGES: Record<ForemanNudgeText, true> = {
  'what\'s next?': true,
  'could you check that your background work is still making progress, and stop it if it hangs?': true,
}

// The nudge texts as a list, which the tests build their prompts from.
export const FOREMAN_NUDGE_TEXTS = Object.keys(NUDGES) as readonly ForemanNudgeText[]

// A message from another session as the desktop app delivers it in a prompt:
// the cross-session element, which may carry attributes, and its body, which
// may run across lines.
const CROSS_SESSION = /<cross-session-message(?:\s[^>]*)?>([\s\S]*?)<\/cross-session-message>/g

// The few entities a body is decoded from before it is compared. The idle
// nudge holds an apostrophe, and if the desktop app ever escaped it, no nudge
// would be recognised. They are decoded in one pass, so an escaped entity
// stays escaped once.
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&apos;': '\'' }
const ENTITY = /&(?:amp|lt|gt|quot|#39|apos);/g

// Whether a prompt's text is a foreman nudge: some cross-session element in
// it holds a body that, once decoded and with the white space around it
// removed, is exactly one of the nudge texts. Text outside the elements is
// not read, so a nudge text typed as a plain prompt is not a nudge.
export function isForemanNudge(text: string): boolean {
  if (typeof text !== 'string') return false
  for (const match of text.matchAll(CROSS_SESSION)) {
    const body = (match[1] ?? '').replace(ENTITY, entity => ENTITIES[entity] ?? entity).trim()
    if ((FOREMAN_NUDGE_TEXTS as readonly string[]).includes(body)) return true
  }
  return false
}

// The text of the session's first prompt: the first user message of the
// transcript that has text, so a user message that only carries a tool's
// result is passed over, or `submitted`, the prompt being submitted now,
// when the transcript holds no such message yet. Anything that is not a list
// of messages counts as an empty transcript.
export function firstPromptOf(messages: unknown, submitted: string): string {
  if (!Array.isArray(messages)) return submitted
  for (const entry of messages as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const message = entry as Partial<SessionMessage>
    if (message.role !== 'user' || typeof message.text !== 'string') continue
    if (message.text.trim() === '') continue
    return message.text
  }
  return submitted
}

// An issue key at the start of a title, such as ABC-123, followed by white
// space, a colon or a dash, or by nothing.
const LEADING_KEY = /^([A-Z][A-Z0-9]*-[0-9]+)(?=$|[\s:\u2013\u2014-])[\s:\u2013\u2014-]*/

// A title split into its leading issue key, or null when it has none, and the
// rest of the title. The progress tool has already cleaned the title.
export function issueOf(title: string): { issueKey: string | null; issueTitle: string } {
  const match = LEADING_KEY.exec(title)
  if (match === null) return { issueKey: null, issueTitle: title }
  return { issueKey: match[1]!, issueTitle: title.slice(match[0].length) }
}

// Whether a skill the engine expanded is the cleanup skill: the skill named
// `cleanup`, or a plugin's skill whose name ends in `:cleanup`.
export function isCleanupSkill(skill: string): boolean {
  return skill === 'cleanup' || (typeof skill === 'string' && skill.endsWith(':cleanup'))
}

// How long a background task's description may be once cleaned, and how many
// descriptions the record names.
export const TASK_CHARS = 80
export const TASKS_SHOWN = 3

// Text another session will read: cleaned of control characters and cut to
// `max` characters, or WITHHELD when it looks like it holds a secret. The
// text is checked for a secret both before and after it is cleaned, because
// a control character inside a token would otherwise hide its shape.
export function shownOrWithheld(text: string, max: number): string {
  if (secretIn(text) !== null || secretIn(printable(text, Infinity)) !== null) return WITHHELD
  return printable(text, max)
}

// The line of a failed call's error that the cleanup record keeps: the last
// line that is not blank, as shownOrWithheld shows it with ERROR_CHARS
// characters at most. An error with no line that is not blank gives the empty
// string.
export function errorLineOf(error: unknown): string {
  const lines = (typeof error === 'string' ? error : '').split(/\r?\n/)
  const last = [...lines].reverse().find(line => printable(line, Infinity) !== '') ?? ''
  return last === '' ? '' : shownOrWithheld(last, ERROR_CHARS)
}

// Whether a path is absolute, on a Unix-like system or with a Windows drive.
const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

// A path with the slashes at its end dropped.
const withoutTrailingSlashes = (path: string) => path.replace(/[\\/]+$/, '')

// The configuration folder the foreman reads from: CLAUDE_CONFIG_DIR when it
// is set and not empty, and otherwise `.claude` under HOME. A folder that is
// not an absolute path, including a CLAUDE_CONFIG_DIR that is set but
// relative, gives null, so nothing is written rather than written somewhere
// that depends on the folder the session runs in. Trailing slashes are
// dropped.
export function configDirOf(configDir: string | undefined, home: string | undefined): string | null {
  if (configDir !== undefined && configDir !== '') {
    if (!isAbsolute(configDir)) return null
    const trimmed = withoutTrailingSlashes(configDir)
    return trimmed === '' ? null : trimmed
  }
  if (home === undefined || home === '' || !isAbsolute(home)) return null
  return `${withoutTrailingSlashes(home)}/.claude`
}

// A session id that can name a file inside the builds folder and nothing
// else: letters, digits, underscores and hyphens only.
const SAFE_ID = /^[A-Za-z0-9_-]+$/

// Where the session's status file goes, or null when there is no
// configuration folder or the session id could leave the builds folder.
export function buildPathOf(config: string | null, sessionId: string): string | null {
  if (config === null || typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) return null
  return `${config}/foreman/builds/${sessionId}.json`
}

// Everything the record is worked out from, as the mod's state holds it.
// `memo` belongs to this session and holds a ticket.
export type StatusFacts = {
  memo: StatusMemo & { ticket: string }
  progress: Progress | null
  run: BuilderRun | null
  pr: Snapshot | null
  busy: boolean
  agents: readonly AgentCard[]
  background: readonly BackgroundTask[]
  // When each background task started, keyed as taskKeyOf keys a task.
  backgroundStarts: Starts
  calls: readonly ForegroundCall[]
  questions: readonly Question[]
  nextLook: NextLook | null
  usageHold: UsageHold | null
  // What the session has spent, read through usageIn in hooks/usage.ts. The
  // session's start seeds an empty ledger, with no models and no dollar
  // figure, so from then on this is a ledger even before anything is
  // counted, and the record carries it. It is null only while no ledger for
  // this session is held: before that seed lands, or when the held one is
  // another session's or cannot be read.
  usage: UsageLedger | null
}

// The snapshot of the pull request the watch follows, or null when nothing
// is watched or the stored snapshot is of another pull request.
export function watchedSnapshotOf(run: BuilderRun | null, pr: Snapshot | null): Snapshot | null {
  if (run === null || pr === null) return null
  return pr.repo === run.repo && pr.number === run.number ? pr : null
}

const watchedOf = (f: StatusFacts) => watchedSnapshotOf(f.run, f.pr)

// The permission prompts that still count as open: the session's own, and a
// subagent's while its agent runs. A subagent the mod has no card for counts,
// because nothing says it has stopped.
function openPromptsOf(f: StatusFacts): OpenPrompt[] {
  return f.memo.prompts.filter(prompt => {
    if (prompt.count <= 0) return false
    if (prompt.loop === '') return true
    const card = f.agents.find(agent => agent.id === prompt.loop)
    return card === undefined || isRunning(card)
  })
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one} is` : `${n} ${many} are`)

// A tool's name as a reason names it: cleaned and cut short, since an MCP
// tool's name is chosen by its server.
const toolName = (tool: string) => printable(tool, 60) || 'a tool'

// Each rule answers the reason its state holds, or null when it does not.
type StateRule = { state: BuildState; reasonOf: (f: StatusFacts) => string | null }

// Why the session is idle: the reason of the last rule, which always answers.
const IDLE_REASON = 'Nothing runs and nothing is waiting.'

// The six states in the order the counsel chose: the first whose rule
// answers a reason is the state. So done and in-cleanup show only once
// nothing runs, and the foreman sees done only when the merged session has
// stopped working.
export const STATE_RULES = [
  {
    state: 'needs-you',
    reasonOf: f => {
      if (f.questions.some(question => !question.answered)) return 'An AskUserQuestion call is waiting on the person\'s answer.'
      if (f.memo.askedAt !== null) return 'The counsel sent a question to the person, and it has not been asked yet.'
      const prompt = openPromptsOf(f)[0]
      if (prompt === undefined) return null
      const whose = prompt.loop === '' ? 'the session' : 'a subagent'
      return `A permission prompt for ${toolName(prompt.tool)} in ${whose} is waiting on the person.`
    },
  },
  {
    state: 'working',
    reasonOf: f => {
      if (f.busy) return 'The session\'s own turn is running.'
      const running = f.agents.filter(isRunning).length
      if (running > 0) return `${plural(running, 'agent', 'agents')} running.`
      if (f.background.length > 0) return `${plural(f.background.length, 'background task', 'background tasks')} running.`
      const call = f.calls[0]
      return call === undefined ? null : `A ${toolName(call.tool)} call of the session's own is running.`
    },
  },
  {
    state: 'waiting-on-builder',
    reasonOf: f => {
      if (f.usageHold !== null) return `A usage-limit hold is on; builder resumes the session at ${new Date(f.usageHold.until).toISOString()}.`
      return f.nextLook === null ? null : 'Builder has a look at the pull request scheduled.'
    },
  },
  {
    state: 'in-cleanup',
    reasonOf: f => (f.memo.cleanup === null ? null : 'The cleanup skill has started in this session.'),
  },
  {
    state: 'done',
    reasonOf: f => {
      const s = watchedOf(f)
      return s?.state === 'MERGED' ? `The pull request ${s.repo}#${s.number} merged.` : null
    },
  },
  {
    state: 'idle',
    reasonOf: () => IDLE_REASON,
  },
] as const satisfies readonly StateRule[]

// The contract in types/index.d.ts spells the states out again, because that
// file must stand alone. This line stops the type check when the rules and
// the contract's list differ in either direction.
type RuledState = (typeof STATE_RULES)[number]['state']
const RULES_MATCH_THE_STATE: [RuledState, BuildState] extends [BuildState, RuledState] ? true : never = true
void RULES_MATCH_THE_STATE

// What tells a background task apart from the others: its id, or, when the
// engine reported none and builder stored the empty string, its kind and its
// description with a character between them that neither holds. So tasks
// without ids that differ cannot keep one wait alive.
export function taskKeyOf(task: BackgroundTask): string {
  return task.id !== '' ? taskKeyOfId(task.id) : `${task.type}\u0000${task.description}`
}

// The key taskKeyOf gives a task that has an id. The hooks that write or drop
// a start time knowing only the task's id, before the task is listed or once a
// completion notice names it, build their key here, so that they and
// taskKeyOf cannot drift apart.
export function taskKeyOfId(id: string): string {
  return id
}

// How long a background task runs, from its start, before builder counts it
// as probably hung: 15 minutes. It mirrors the moment foreman, at its default
// `idleMinutes` of 5, wakes the parent about a session that waits only on
// background work. It does not follow a different `idleMinutes` setting, so
// at any other setting the mark and foreman's wake come at different moments.
export const HUNG_AFTER_MS = 15 * 60_000

// The moment a task that started at `startedAt` counts as probably hung.
export function hungAtOf(startedAt: number): number {
  return startedAt + HUNG_AFTER_MS
}

// Whether a task that started at `startedAt` counts as probably hung at
// `now`: once it has run HUNG_AFTER_MS or longer. The line and the pane both
// ask this rule, so given the same moment they mark the same task. The status
// record does not ask it: recordOf writes `hungAt` from hungAtOf, the moment
// this rule turns true, and foreman's row repeats the `now >= hungAt`
// comparison in its own isProbablyHung, so a change to the comparison has to
// be made in both mods.
export function isProbablyHung(startedAt: number, now: number): boolean {
  return now >= hungAtOf(startedAt)
}

// When each background task started, in milliseconds since the epoch, keyed
// as taskKeyOf keys a task, as builder's backgroundStarts atom holds them.
export type Starts = Readonly<Record<string, number>>

// The start times as builder's state holds them, read without trusting them,
// as every value builder reads from its state is: a value that is not an
// object, or is a list, holds no start, and an entry whose start is not a
// finite number is left out. The same object comes back when every entry is
// a finite number, so a caller can still tell that a rule changed nothing.
export function startsIn(raw: unknown): Starts {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const entries = Object.entries(raw)
  const kept = entries.filter(([, at]) => isFiniteTime(at))
  return kept.length === entries.length ? raw as Starts : Object.fromEntries(kept)
}

// The start `starts` holds for `key`, or undefined when it holds none. Only
// the object's own keys count, so a key such as `__proto__` or `toString`
// never reads what every object inherits.
function startAt(starts: Starts, key: string): number | undefined {
  return Object.hasOwn(starts, key) ? starts[key] : undefined
}

// `starts` with `key` set to `at`. The copy is built from its entries rather
// than by assignment, so a key such as `__proto__` becomes an own key like any
// other instead of changing the copy's prototype.
function withStart(starts: Starts, key: string, at: number): Starts {
  return Object.fromEntries([...Object.entries(starts), [key, at]])
}

// When a task started: the start `starts` holds under the task's key, or
// `now` when it holds none.
export function startOf(task: BackgroundTask, starts: Starts, now: number): number {
  return startAt(starts, taskKeyOf(task)) ?? now
}

// The task with the earliest start and that start, or null when the list is
// empty. Only a strictly earlier start replaces the task picked so far, so of
// two tasks with the same start the one the engine listed first is the
// oldest.
export function oldestTaskOf(tasks: readonly BackgroundTask[], starts: Starts, now: number): { task: BackgroundTask; startedAt: number } | null {
  let oldest: { task: BackgroundTask; startedAt: number } | null = null
  for (const task of tasks) {
    const startedAt = startOf(task, starts, now)
    if (oldest === null || startedAt < oldest.startedAt) oldest = { task, startedAt }
  }
  return oldest
}

// The starts once a turn end has listed `tasks` at `now`: each listed task
// that has no start takes `now`, and every other start is kept. The same
// object comes back when no task needed one, so the caller can skip a write
// that would change nothing.
export function startsSeen(starts: Starts, tasks: readonly BackgroundTask[], now: number): Starts {
  let seen = starts
  for (const task of tasks) {
    const key = taskKeyOf(task)
    if (startAt(seen, key) === undefined) seen = withStart(seen, key, now)
  }
  return seen
}

// The starts of the tasks still listed in `tasks`, with every other start
// dropped. The same object comes back when every start is still listed.
export function startsPruned(starts: Starts, tasks: readonly BackgroundTask[]): Starts {
  const listed = new Set(tasks.map(taskKeyOf))
  const entries = Object.entries(starts)
  const kept = entries.filter(([key]) => listed.has(key))
  return kept.length === entries.length ? starts : Object.fromEntries(kept)
}

// The starts once a call that started at `at` went to the background as the
// task keyed `key`. The earlier of `at` and the start already stored is kept,
// so two writes that cross still keep the true start. The same object comes
// back when the stored start is already as early, or when `at` is not a
// finite number.
export function startsBackgrounded(starts: Starts, key: string, at: number): Starts {
  const stored = startAt(starts, key)
  if (!isFiniteTime(at) || (stored !== undefined && stored <= at)) return starts
  return withStart(starts, key, at)
}

// The starts without the one stored under `key`. The same object comes back
// when there is none.
export function startsWithout(starts: Starts, key: string): Starts {
  const entries = Object.entries(starts)
  const kept = entries.filter(([stored]) => stored !== key)
  return kept.length === entries.length ? starts : Object.fromEntries(kept)
}

// Whether background work is the only thing running: the session's own turn
// is not running, no agent and no tool call of its own is running, and at
// least one background task is in flight.
export function isBackgroundOnly(f: StatusFacts): boolean {
  return !f.busy && !f.agents.some(isRunning) && f.calls.length === 0 && f.background.length > 0
}

// The background-only wait at `now`. The memo's wait is kept, unchanged,
// while at least one of its tasks is still in flight, so a short turn of the
// session's own, such as its answer to a nudge, does not restart it, and a
// task that joins partway does not join its keys. Otherwise a wait begins now
// with the tasks in flight when background work is the only thing running,
// and there is none when it is not.
export function backgroundWaitOf(f: StatusFacts, now: number): StatusMemo['backgroundWait'] {
  const keys = f.background.map(taskKeyOf)
  const wait = f.memo.backgroundWait
  if (wait !== null && wait.keys.some(key => keys.includes(key))) return wait
  return isBackgroundOnly(f) ? { since: now, keys } : null
}

// The descriptions the record names for a wait: the wait's own tasks first,
// then the others, each shown as shownOrWithheld shows it, with the empty
// ones dropped and at most TASKS_SHOWN kept. A task's command is never read,
// since it can hold paths or secrets.
function taskDescriptionsOf(f: StatusFacts, keys: readonly string[]): string[] {
  const own = f.background.filter(task => keys.includes(taskKeyOf(task)))
  const others = f.background.filter(task => !keys.includes(taskKeyOf(task)))
  return [...own, ...others]
    .map(task => shownOrWithheld(task.description, TASK_CHARS))
    .filter(description => description !== '')
    .slice(0, TASKS_SHOWN)
}

// The state that holds and why: the first rule that answers a reason. The
// last rule always answers, so there is always one.
export function stateOf(f: StatusFacts): { state: BuildState; reason: string } {
  for (const rule of STATE_RULES as readonly StateRule[]) {
    const reason = rule.reasonOf(f)
    if (reason !== null) return { state: rule.state, reason }
  }
  return { state: 'idle', reason: IDLE_REASON }
}

// The snapshot's verdict pair, copied field by field so the compared text
// keeps one order, or null when it has none. A pair at another head than the
// snapshot's, as a snapshot an older build stored may hold, counts as none.
function verdictsAtHead(s: Snapshot): Verdicts | null {
  const v = s.verdicts
  return v !== null && v.sha === s.head ? { sha: v.sha, spec: v.spec, adversarial: v.adversarial } : null
}

// The record to write at `writtenAt`. The state keeps the time it began when
// it is the state last written, and otherwise begins now. The fields are
// built in one fixed order, so two records that hold the same values print
// the same text. The background-only wait is the one the memo holds, which
// the writer works out with backgroundWaitOf and stores before it calls this.
// The session's own last turn is written, whatever the state, once one has
// ended.
// The oldest background task is named whenever one is in flight, whatever
// the state, by its description as shownOrWithheld shows it, never by its
// command, with its start and the moment it counts as probably hung. Those
// stay fixed while the same task is the oldest, so the field asks for no
// write as time passes.
export function recordOf(f: StatusFacts, writtenAt: number): BuildStatus {
  const { state, reason } = stateOf(f)
  const s = watchedOf(f)
  const issue = f.progress === null ? { issueKey: null, issueTitle: '' } : issueOf(f.progress.title)
  const record: BuildStatus = {
    version: STATUS_VERSION,
    sessionId: f.memo.sessionId,
    ticket: f.memo.ticket,
    ...(f.memo.desktopSessionId === undefined ? {} : { desktopSessionId: f.memo.desktopSessionId }),
    cwd: f.memo.cwd,
    issueKey: issue.issueKey,
    issueTitle: issue.issueTitle,
    stage: f.progress?.stage ?? null,
    stageDone: barOf(f.progress, s, f.run?.since ?? null)?.done ?? 0,
    pr: s === null ? null : { repo: s.repo, number: s.number, state: s.state, checks: ciOf(s.checks), verdicts: verdictsAtHead(s) },
    state,
    reason,
    stateSince: f.memo.state === state ? f.memo.stateSince : writtenAt,
    writtenAt,
  }
  const wait = f.memo.backgroundWait
  if (state === 'working' && isBackgroundOnly(f) && wait !== null) record.backgroundOnly = { since: wait.since, tasks: taskDescriptionsOf(f, wait.keys) }
  if (f.memo.lastTurn !== null) record.lastTurn = { endedAt: f.memo.lastTurn.endedAt, answeredNudge: f.memo.lastTurn.answeredNudge }
  const oldest = oldestTaskOf(f.background, f.backgroundStarts, writtenAt)
  if (oldest !== null) {
    record.oldestBackground = { description: shownOrWithheld(oldest.task.description, TASK_CHARS), startedAt: oldest.startedAt, hungAt: hungAtOf(oldest.startedAt) }
  }
  if (f.memo.cleanup !== null) record.cleanup = { failedCalls: f.memo.cleanup.failedCalls, lastError: f.memo.cleanup.lastError }
  // Only the totals are written; the remembered turns and the engine's last
  // reading are the ledger's own bookkeeping.
  if (f.usage !== null) record.usage = { models: f.usage.models, usd: f.usage.usd }
  return record
}

// The text two records are compared by: the record with its write time left
// out. Two records whose texts are equal hold the same values in every field
// but the write time, so the second needs no write of its own.
export function comparedTextOf(record: BuildStatus): string {
  return JSON.stringify({ ...record, writtenAt: 0 })
}

const STATES: readonly BuildState[] = STATE_RULES.map(rule => rule.state)
const isFiniteTime = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t)
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

// The memo's open permission prompts, or null when the stored value is not a
// list of well-formed prompts. An empty list is a valid value.
function promptsIn(raw: unknown): OpenPrompt[] | null {
  if (!Array.isArray(raw)) return null
  const prompts: OpenPrompt[] = []
  for (const entry of raw as unknown[]) {
    const p = entry as Partial<OpenPrompt> | null
    if (typeof p !== 'object' || p === null || typeof p.loop !== 'string' || typeof p.tool !== 'string' || !isCount(p.count)) return null
    prompts.push({ loop: p.loop, tool: p.tool, count: p.count })
  }
  return prompts
}

// The memo's cleanup record, or undefined when the stored value cannot be
// read. Unlike promptsIn, null here is a valid value: it means the cleanup
// skill has not started, so an unreadable value needs undefined instead.
function cleanupIn(raw: unknown): StatusMemo['cleanup'] | undefined {
  if (raw === null) return null
  const c = raw as { failedCalls?: unknown; lastError?: unknown } | undefined
  if (typeof c !== 'object' || !isCount(c.failedCalls) || typeof c.lastError !== 'string') return undefined
  return { failedCalls: c.failedCalls, lastError: c.lastError }
}

// The memo's background-only wait, or null when the stored value is missing
// or not what the mod writes: a finite start and a list of keys that are
// strings and not empty. Unlike the other fields, a value that cannot be read
// does not reject the memo, so a memo an older build saved without it is
// still read, with no wait.
function backgroundWaitIn(raw: unknown): StatusMemo['backgroundWait'] {
  const w = raw as { since?: unknown; keys?: unknown } | null | undefined
  if (typeof w !== 'object' || w === null || !isFiniteTime(w.since) || !Array.isArray(w.keys) || w.keys.length === 0) return null
  const keys = w.keys as unknown[]
  return keys.every(key => typeof key === 'string' && key !== '') ? { since: w.since, keys: [...keys] as string[] } : null
}

// The memo's flag for a turn a nudge started. Only true reads as true, so a
// memo an older build saved without it, or with another value, reads as
// false and is kept.
function nudgeTurnIn(raw: unknown): boolean {
  return raw === true
}

// The memo's last turn, or null when the stored value is missing or not what
// the mod writes: a finite end and a flag that is true or false. As with the
// background-only wait, a value that cannot be read does not reject the memo.
function lastTurnIn(raw: unknown): LastTurn | null {
  const t = raw as { endedAt?: unknown; answeredNudge?: unknown } | null | undefined
  if (typeof t !== 'object' || t === null || !isFiniteTime(t.endedAt) || typeof t.answeredNudge !== 'boolean') return null
  return { endedAt: t.endedAt, answeredNudge: t.answeredNudge }
}

// A stored memo, or null when it belongs to another session than
// `sessionId`, as after a /clear whose end was cut off, or when any field is
// not what the mod writes, so a value an older build saved reads as none.
// Three fields are the exceptions: the background-only wait, the flag for a
// turn a nudge started and the last turn. Their readers read a value they
// cannot read as none, or as false for the flag, and the memo is kept.
export function statusMemoIn(raw: unknown, sessionId: string): StatusMemo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.sessionId !== sessionId || typeof sessionId !== 'string') return null
  if (m.ticket !== null && typeof m.ticket !== 'string') return null
  if (m.path !== null && typeof m.path !== 'string') return null
  if (m.desktopSessionId !== undefined && typeof m.desktopSessionId !== 'string') return null
  if (typeof m.cwd !== 'string') return null
  if (m.state !== null && !STATES.includes(m.state as BuildState)) return null
  if (!isFiniteTime(m.stateSince) || !isFiniteTime(m.generation)) return null
  if (m.askedAt !== null && !isFiniteTime(m.askedAt)) return null
  const prompts = promptsIn(m.prompts)
  const cleanup = cleanupIn(m.cleanup)
  if (prompts === null || cleanup === undefined) return null
  return {
    sessionId,
    ticket: m.ticket as string | null,
    path: m.path as string | null,
    ...(typeof m.desktopSessionId === 'string' ? { desktopSessionId: m.desktopSessionId } : {}),
    cwd: m.cwd,
    state: m.state as BuildState | null,
    stateSince: m.stateSince,
    askedAt: m.askedAt as number | null,
    prompts,
    cleanup,
    backgroundWait: backgroundWaitIn(m.backgroundWait),
    nudgeTurn: nudgeTurnIn(m.nudgeTurn),
    lastTurn: lastTurnIn(m.lastTurn),
    generation: m.generation,
  }
}

// The generation a stored memo holds, whichever session the memo belongs to,
// or null when the stored value is not an object or its generation is missing
// or not a finite number. Only the generation is read, so a memo whose other
// fields an older build wrote still gives its generation.
export function generationIn(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null
  const generation = (raw as { generation?: unknown }).generation
  return isFiniteTime(generation) ? generation : null
}

// A new memo for a session whose first prompt was just looked at, with
// nothing written yet and nothing open.
export function newMemo(found: Pick<StatusMemo, 'sessionId' | 'ticket' | 'path' | 'cwd' | 'generation'> & { desktopSessionId?: string }): StatusMemo {
  return {
    sessionId: found.sessionId,
    ticket: found.ticket,
    path: found.path,
    ...(found.desktopSessionId === undefined || found.desktopSessionId === '' ? {} : { desktopSessionId: found.desktopSessionId }),
    cwd: found.cwd,
    state: null,
    stateSince: 0,
    askedAt: null,
    prompts: [],
    cleanup: null,
    backgroundWait: null,
    nudgeTurn: false,
    lastTurn: null,
    generation: found.generation,
  }
}

// A permission prompt opened in `loop` for `tool`: one more is counted open.
export function afterPermissionRequest(memo: StatusMemo, loop: string, tool: string): StatusMemo {
  const found = memo.prompts.some(p => p.loop === loop && p.tool === tool)
  const prompts = found
    ? memo.prompts.map(p => (p.loop === loop && p.tool === tool ? { ...p, count: p.count + 1 } : p))
    : [...memo.prompts, { loop, tool, count: 1 }]
  return { ...memo, prompts }
}

// A call of `tool` in `loop` returned: it closes one open prompt of that loop
// and tool, if there is one, and a count that reaches nothing is dropped.
export function afterCallReturn(memo: StatusMemo, loop: string, tool: string): StatusMemo {
  if (!memo.prompts.some(p => p.loop === loop && p.tool === tool)) return memo
  const prompts = memo.prompts
    .map(p => (p.loop === loop && p.tool === tool ? { ...p, count: p.count - 1 } : p))
    .filter(p => p.count > 0)
  return { ...memo, prompts }
}

// The turn of `loop` ended, or a new turn of the session's own began: every
// prompt that loop had open is closed.
export function afterLoopEnd(memo: StatusMemo, loop: string): StatusMemo {
  if (!memo.prompts.some(p => p.loop === loop)) return memo
  return { ...memo, prompts: memo.prompts.filter(p => p.loop !== loop) }
}

// A turn of the session's own began, and `nudged` says whether a foreman
// nudge started it. The flag is kept in the memo, so a hot reload during the
// turn still knows it at the turn's end.
export function afterTurnStart(memo: StatusMemo, nudged: boolean): StatusMemo {
  return memo.nudgeTurn === nudged ? memo : { ...memo, nudgeTurn: nudged }
}

// A turn of the session's own ended at `at`, whatever ended it. It becomes the
// last turn, with whether a nudge started it.
export function afterTurnEnd(memo: StatusMemo, at: number): StatusMemo {
  return { ...memo, lastTurn: { endedAt: at, answeredNudge: memo.nudgeTurn } }
}

// The cleanup skill started. A record that already began is kept, so a second
// start does not forget the failures counted since the first.
export function afterCleanupSkill(memo: StatusMemo): StatusMemo {
  return memo.cleanup === null ? { ...memo, cleanup: { failedCalls: 0, lastError: '' } } : memo
}

// A tool call failed. It is counted only once the cleanup skill has started,
// and its error's last line replaces the one kept.
export function afterFailedCall(memo: StatusMemo, error: unknown): StatusMemo {
  if (memo.cleanup === null) return memo
  return { ...memo, cleanup: { failedCalls: memo.cleanup.failedCalls + 1, lastError: errorLineOf(error) } }
}

// A counsel tally sent its question to the person at `at`, the time the
// tally ended.
export function afterCounselAsk(memo: StatusMemo, at: number): StatusMemo {
  return { ...memo, askedAt: at }
}

// An AskUserQuestion call of the session's own that started at `startedAt`
// ended. It clears the counsel's question when it started after the tally
// ended, since then it is the question the person was asked; one that was
// already open when the tally ended was asked something else.
export function afterQuestionEnd(memo: StatusMemo, startedAt: number): StatusMemo {
  return memo.askedAt !== null && startedAt > memo.askedAt ? { ...memo, askedAt: null } : memo
}

// The person sent a prompt, which answers whatever the counsel left for them.
export function afterPersonPrompt(memo: StatusMemo): StatusMemo {
  return memo.askedAt === null ? memo : { ...memo, askedAt: null }
}

// The record was written: its state and when it began are the ones the next
// record compares with.
export function afterWrite(memo: StatusMemo, record: BuildStatus): StatusMemo {
  return { ...memo, state: record.state, stateSince: record.stateSince }
}
