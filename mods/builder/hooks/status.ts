// The rules of the status file builder writes for the foreman: which session
// writes one, where it goes, which of the six states holds and why, the
// record itself, and how each event changes the memo the record is worked
// out from. Nothing here touches the engine; hooks/register.tsx reads the
// state, calls these and writes the file. Every function is pure, so the
// tests can check each rule without the engine.

import type { SessionMessage } from 'claude-code'

import type { AgentCard, BackgroundTask, BuilderRun, BuildState, BuildStatus, ForegroundCall, NextLook, OpenPrompt, Progress, Question, StatusMemo, UsageHold } from '../types'
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

// The line of a failed call's error that the cleanup record keeps: the last
// line that is not blank, cleaned of control characters and cut to
// ERROR_CHARS characters, or WITHHELD when it looks like it holds a secret.
// An error with no line that is not blank gives the empty string. The line
// is checked for a secret both before and after it is cleaned, because a
// control character inside a token would otherwise hide its shape.
export function errorLineOf(error: unknown): string {
  const lines = (typeof error === 'string' ? error : '').split(/\r?\n/)
  const last = [...lines].reverse().find(line => printable(line, Infinity) !== '') ?? ''
  if (last === '') return ''
  const shown = printable(last, ERROR_CHARS)
  if (secretIn(last) !== null || secretIn(printable(last, Infinity)) !== null) return WITHHELD
  return shown
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
  calls: readonly ForegroundCall[]
  questions: readonly Question[]
  nextLook: NextLook | null
  usageHold: UsageHold | null
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

// The state that holds and why: the first rule that answers a reason. The
// last rule always answers, so there is always one.
export function stateOf(f: StatusFacts): { state: BuildState; reason: string } {
  for (const rule of STATE_RULES as readonly StateRule[]) {
    const reason = rule.reasonOf(f)
    if (reason !== null) return { state: rule.state, reason }
  }
  return { state: 'idle', reason: IDLE_REASON }
}

// The record to write at `writtenAt`. The state keeps the time it began when
// it is the state last written, and otherwise begins now. The fields are
// built in one fixed order, so two records that hold the same values print
// the same text.
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
    pr: s === null ? null : { repo: s.repo, number: s.number, state: s.state, checks: ciOf(s.checks) },
    state,
    reason,
    stateSince: f.memo.state === state ? f.memo.stateSince : writtenAt,
    writtenAt,
  }
  if (f.memo.cleanup !== null) record.cleanup = { failedCalls: f.memo.cleanup.failedCalls, lastError: f.memo.cleanup.lastError }
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

// A stored memo, or null when it belongs to another session than
// `sessionId`, as after a /clear whose end was cut off, or when any field is
// not what the mod writes, so a value an older build saved reads as none.
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
    generation: m.generation,
  }
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
