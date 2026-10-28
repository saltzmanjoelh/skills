import type { Elements as EngineElements } from 'claude-code'

import type { AgentCard, BackgroundTask, CounselQuestion, CounselTally, ForegroundCall, NextLook, Progress, Question, WaitingOn, Wake } from '../types'
import { AGENT_SVG_HEIGHT, agentSvg, BAR_SVG_HEIGHT, barSvg, fitBar, hasSvg, PLANNED_SVG_HEIGHT, plannedSvg, svgWidth, type AgentRow } from './art'
import { abstainerReason, chosenOf, COUNSEL_KEPT, FOLLOW_UP_WORDS, followUpOutcomes, noOptionCount, shortName, turnoutOf } from './counsel'
import { ciOf, failedCheckNames, roundInProgress, type Snapshot } from './github'
import { linkOf } from './links'
import { barOf, modelLabel, stageLabel, type Bar } from './progress'
import { isRunning, shownStatus, waitingOn } from './state'
import { firstSeenOrNow, issueOf, oldestOf } from './status'
import { clockTime, printable, timeOfDay } from './text'

export const PANE = 'builder'
// The second pane, which shows one agent's card and messages.
export const AGENT_PANE = 'builder-agent'

// What the pane and the line above the prompt draw from, read by the hooks.
export type View = {
  // The watched pull request, or null when none is watched or the snapshot
  // cannot be drawn (see isDrawable).
  pr: Snapshot | null
  agents: AgentCard[]
  questions: Question[]
  wakes: Wake[]
  now: number
  // The mod's next scheduled look, or null when none is scheduled.
  nextLook: NextLook | null
  counsel: CounselQuestion[]
  // The session's background work as the last turn end or subagent end
  // reported it, less any task whose notification the transcript has drawn.
  background: BackgroundTask[]
  // The session's own tool calls in progress.
  calls: ForegroundCall[]
  // Whether builder was started this session (open_pane or /builder).
  started: boolean
  // The work last reported through the progress tool, read through progressIn.
  progress: Progress | null
  // When the watch of the watched pull request began, or null when none is
  // watched, so the bar can tell whether its merge belongs to this work.
  watchSince: number | null
  // Whether the pane folds its finished agents under one heading.
  finishedFolded: boolean
  // The agent types the pane lists as planned, worked out by plannedOf.
  planned: string[]
  // When a usage-limit hold resumes, or null when no hold is on.
  usageHold: number | null
  // Whether the mod's files on disk differ from the ones this session loaded,
  // as isStale in hooks/loaded.ts says.
  stale: boolean
  // The project's usable issue address, with `{key}` where the key goes, or
  // null when the project names none or names one that cannot be used.
  issueLink: string | null
}

type El = Pick<EngineElements['terminal'], 'Box' | 'Text'>
// The elements the band and the panes draw with, as hooks/register.tsx builds
// them: `Svg` is there only on a surface that draws images.
export type Elements = Pick<EngineElements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'> & { Svg?: EngineElements['desktop']['Svg'] }

// How long ago the last look was, in the pane's coarser format (rounded, as
// in 45s, 1m and 1h2m). It differs from `clockTime` on purpose: the agents'
// rows and the line count seconds, which move every second while anything
// runs, while the last look only needs the rough size.
function elapsed(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

// How long until a time, as the line above the prompt says it: whole minutes
// rounded up, or under a minute. Null once the time has passed (as after the
// machine slept, or a reload that dropped the timer), which the line words
// as due now.
export function timeUntil(at: number, now: number): string | null {
  const ms = at - now
  if (ms <= 0) return null
  if (ms < 60_000) return 'under a minute'
  return `${Math.ceil(ms / 60_000)}m`
}

// The due time of the next look when it can be read. A value that is not a
// finite number counts as no look scheduled, so the display never shows a
// wrong time.
function dueAt(next: NextLook | null): number | null {
  if (typeof next !== 'object' || next === null) return null
  return typeof next.at === 'number' && Number.isFinite(next.at) ? next.at : null
}

// What the line says while a usage-limit hold is on, or null when none is:
// the time it resumes, as timeOfDay writes it.
function holdWords(v: View): string | null {
  return v.usageHold === null ? null : `waiting on the usage limit until ${timeOfDay(v.usageHold, v.now)}`
}

// What runs, and then the hold when one is on, as the segments of one part of
// a line with no pull request watched; empty when neither is there.
function runningOrHold(v: View, names: number): LineSegment[] {
  const hold = holdWords(v)
  const running = runningPart(v, names)
  if (hold === null) return running
  return running.length === 0 ? [plain(hold)] : merged([...running, plain(`${SEPARATOR}${hold}`)])
}

// How many agents run now, in words, for the next step and the agent-count
// button alike, so the two never disagree on the count or its wording.
function runningAgents(v: View): string {
  const running = v.agents.filter(isRunning).length
  return running === 1 ? '1 agent running' : `${running} agents running`
}

// What the mod will do next and when, for the line above the prompt and the
// pane alike: the first of these that applies, starting with a usage-limit
// hold. When the line already shows its running part (`isRunningShown`), the
// count of running agents and the background work are left out, so neither
// is named twice.
export function nextStep(v: View, isRunningShown = false): string {
  const hold = holdWords(v)
  if (hold !== null) return hold
  const at = dueAt(v.nextLook)
  if (at === null) return 'not polling'
  const when = timeUntil(at, v.now)
  if (v.nextLook?.isNewHead === true) return when === null ? 'new head, handing over now' : `new head, handing over in ${when}`
  const look = when === null ? 'next look due now' : `next look in ${when}`
  const reason = nextReason(v)
  // When the line shows its running part, that part already names the agents
  // and the background work, so the next step says only when the look is due.
  if (isRunningShown && (reason === 'agents' || reason === 'background')) return look
  return `${waitingWords(v, reason)} · ${look}`
}

// What the next step says it waits on, by reason, as one function per reason,
// so that only the chosen reason's words are built. The record's type keeps
// it exhaustive: a reason without words fails the type check.
const WAITING_WORDS: Record<NextReason, (v: View) => string> = {
  owner: () => 'waiting on your answer',
  agents: runningAgents,
  background: v => `waiting on its background ${backgroundNoun(v.background)}`,
  ci: () => 'waiting on checks',
  fix: () => 'waiting on a fix',
  merge: () => 'waiting on the merge',
  nothing: () => 'nothing to hand over',
}

// What the next step says it waits on, for the one reason nextStep chose.
function waitingWords(v: View, reason: NextReason): string {
  return WAITING_WORDS[reason](v)
}

// What the next step waits on: one of waitingOn's reasons, or the background
// work in flight.
type NextReason = WaitingOn | 'background'

// The reason the next step names, the first of these that applies: the
// owner's answer, then the running agents, both as waitingOn answers them;
// then the background work in flight; then the pull request's state, as
// waitingOn answers that. Background work is the session's own work, as
// running agents are, so it comes after them and before the pull request's
// states. It is worked out here rather than in waitingOn, because waitingOn
// keys the poll interval, and a background task changes nothing about how
// often the mod looks at the pull request.
function nextReason(v: View): NextReason {
  const why = waitingOn(v.pr, v.agents, v.questions)
  if (why === 'owner' || why === 'agents') return why
  if (v.background.length > 0) return 'background'
  return why
}

// How long a foreground call runs before the line names it.
export const NAMED_AFTER_MS = 10_000

// How long the session may have waited on a background task before the line
// and the pane mark it: five minutes. This is builder's own copy of the
// number foreman uses by default for its idle threshold, because one mod
// cannot read another's options. A project that sets foreman's `idleMinutes`
// option to another number therefore sees builder's `past 5m` and foreman's
// first nudge part company. The README's section on the band says so.
export const BACKGROUND_CEILING_MS = 5 * 60_000

// The ceiling as the suffix names it, `5m`, worked out from the constant so
// that the two cannot disagree.
const CEILING_WORDS = `${BACKGROUND_CEILING_MS / 60_000}m`

// How long the session has waited on a task: the time since builder first
// saw it, never negative, so a stamp in the future prints as no time rather
// than a negative one. A task with no sound stamp counts as first seen now,
// as firstSeenOrNow in status.ts says.
function waitedFor(task: BackgroundTask, now: number): number {
  return Math.max(now - firstSeenOrNow(task, now), 0)
}

// Whether the session has waited on a task for the ceiling or longer.
export function isPastCeiling(task: BackgroundTask, now: number): boolean {
  return waitedFor(task, now) >= BACKGROUND_CEILING_MS
}

// How long the session has waited on a task, as the line and the pane print
// it: in clockTime's form, like the slow foreground call beside it, with the
// suffix `, past 5m` once the wait has reached the ceiling, so a surface or a
// test that sees only text still tells the two states apart.
export function taskTime(task: BackgroundTask, now: number): string {
  const time = clockTime(waitedFor(task, now))
  return isPastCeiling(task, now) ? `${time}, past ${CEILING_WORDS}` : time
}

// What a background task is named by, on the line and in the pane: its
// description, or its command when the description is blank, printed without
// control characters and cut short.
function taskName(task: BackgroundTask): string {
  return printable(task.description.trim() !== '' ? task.description : task.command ?? '')
}

// The noun the next step gives the background work: `command` when every
// task is a shell command, else `task`, in the plural for several.
function backgroundNoun(tasks: readonly BackgroundTask[]): string {
  const noun = tasks.every(task => task.type === 'shell') ? 'command' : 'task'
  return tasks.length === 1 ? noun : `${noun}s`
}

// One piece of the line above the prompt: its text, whether it is the
// background part, and whether the task that part names is past the ceiling.
// The line is built from these so that the band can draw the part in yellow
// without searching the fitted string for it, and the string the line's other
// readers get is the segments' texts joined, so the two cannot disagree.
export type LineSegment = { text: string; isBackground: boolean; isPast: boolean }

// A segment of ordinary text.
const plain = (text: string): LineSegment => ({ text, isBackground: false, isPast: false })

// The line the segments spell.
const textOf = (segments: readonly LineSegment[]): string => segments.map(segment => segment.text).join('')

// Segments laid end to end, with each run of plain segments merged into one
// and empty segments dropped, so a line holds at most one plain segment
// before the background part and one after it.
function merged(segments: readonly LineSegment[]): LineSegment[] {
  const out: LineSegment[] = []
  for (const segment of segments) {
    if (segment.text === '') continue
    const last = out.at(-1)
    if (last !== undefined && !last.isBackground && !segment.isBackground) out[out.length - 1] = plain(`${last.text}${segment.text}`)
    else out.push(segment)
  }
  return out
}

// What runs, as the line names it, as segments, empty when nothing does: the
// session's own call that started first, once it has run NAMED_AFTER_MS; the
// running agents' types, oldest first, at most `names` of them; and the
// background work, as the oldest task in flight, the one builder saw first
// as oldestOf in status.ts finds it, named by taskName with how long the
// session has waited on it. The background part is the one segment marked as
// such, and it is marked past when its task is past the ceiling. It reads
// `waiting on:` when it is the only running part, and `background:` beside a
// call or agents, because the session is then working beside the task rather
// than waiting on it, and it ends with ` and <n> more` when several tasks run.
// The segments come back already merged: the call and the agents are one
// plain segment, which carries the separator before the part when both are
// there, so at most one plain segment stands before the part and a caller may
// hand the segments on without running merged over them.
export function runningPart(v: View, names = Infinity): LineSegment[] {
  const parts: string[] = []
  const slow = v.calls
    .filter(call => v.now - call.startedAt >= NAMED_AFTER_MS)
    .sort((a, b) => a.startedAt - b.startedAt)[0]
  if (slow !== undefined) parts.push(`running: ${printable(slow.label)} (${clockTime(v.now - slow.startedAt)})`)
  const agents = v.agents.filter(isRunning).sort((a, b) => a.startedAt - b.startedAt)
  if (agents.length > 0) {
    const types = agents.map(card => printable(shortName(card.type), 40))
    const shown = types.length > names ? [...types.slice(0, names), '…'] : types
    parts.push(`${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}: ${shown.join(', ')}`)
  }
  const joined = parts.join(SEPARATOR)
  const oldest = oldestOf(v.background, v.now)
  if (oldest === undefined) return parts.length === 0 ? [] : [plain(joined)]
  const lead = parts.length === 0 ? 'waiting on' : 'background'
  const more = v.background.length > 1 ? ` and ${v.background.length - 1} more` : ''
  const part: LineSegment = { text: `${lead}: ${taskName(oldest)} (${taskTime(oldest, v.now)})${more}`, isBackground: true, isPast: isPastCeiling(oldest, v.now) }
  return parts.length === 0 ? [part] : [plain(`${joined}${SEPARATOR}`), part]
}

// One line above the prompt, or null when there is nothing to say. With a pull
// request watched: the pull request, its checks, what runs when anything does,
// and what the mod will do next and when. With none watched: what runs and
// the usage-limit hold, or no line when neither is there. The line fits
// `width` cells when it is a number: agent names are dropped from the end
// first, then the line is cut with `…`. A stale session's line leads with the
// warning, as withWarning says. The line is the texts of abovePromptSegments
// joined, so the string and the segments agree by construction.
export function abovePromptLine(v: View, width?: number): string | null {
  const segments = abovePromptSegments(v, width)
  return segments === null ? null : textOf(segments)
}

// The line above the prompt as segments, with its background part marked, for
// the band to draw that part in yellow once its task is past the ceiling.
export function abovePromptSegments(v: View, width?: number): LineSegment[] | null {
  return withWarning(v, width, room => lineAbove(v, room))
}

// The line above the prompt without the stale warning.
function lineAbove(v: View, width: number | undefined): LineSegment[] | null {
  return fitLine(v, width, names => {
    if (v.pr === null) {
      const shown = runningOrHold(v, names)
      return shown.length === 0 ? null : merged([plain(`${PREFIX}no pull request yet${SEPARATOR}`), ...shown])
    }
    const running = runningPart(v, names)
    const head = `${PREFIX}#${v.pr.number} ${v.pr.state.toLowerCase()} · checks ${ciOf(v.pr.checks)}`
    if (running.length === 0) return [plain(`${head}${SEPARATOR}${nextStep(v)}`)]
    return merged([plain(`${head}${SEPARATOR}`), ...running, plain(`${SEPARATOR}${nextStep(v, true)}`)])
  })
}

// What the line says when the mod's files on disk differ from the ones this
// session loaded. It never claims the loaded mod is the older one, because
// the checkout may have moved either way.
export const STALE_WARNING = 'builder changed on disk since this session loaded it; restart this session to load it'

const SEPARATOR = ' · '
// How every line above the prompt begins. withWarning drops it after the
// warning, which already names builder, so the functions that build each
// line take the prefix from this constant rather than writing it themselves.
const PREFIX = 'builder: '

// The line `lineWith` builds for a width, led by the stale warning when the
// session is stale. The warning is never cut: the rest of the line follows it
// without its `builder: ` prefix, which is taken off the first segment only,
// fitted to the width the warning and its separator leave, and the line is
// the warning alone when there is nothing else to say or too little room for
// more than an ellipsis. The rest keeps its marks, so the warning and a part
// past the ceiling draw together.
function withWarning(v: View, width: number | undefined, lineWith: (width: number | undefined) => LineSegment[] | null): LineSegment[] | null {
  if (!v.stale) return lineWith(width)
  const isFitted = typeof width === 'number' && Number.isFinite(width)
  const room = isFitted ? width - STALE_WARNING.length - SEPARATOR.length : undefined
  if (room !== undefined && room < 2) return [plain(STALE_WARNING)]
  const [first, ...others] = lineWith(room === undefined ? undefined : room + PREFIX.length) ?? []
  if (first === undefined) return [plain(STALE_WARNING)]
  const unprefixed = first.text.startsWith(PREFIX) ? { ...first, text: first.text.slice(PREFIX.length) } : first
  return merged([plain(`${STALE_WARNING}${SEPARATOR}`), unprefixed, ...others])
}

// A line built by `lineWith`, which names at most the given number of running
// agents, fitted to `width` cells when that is a number: agent names are
// dropped from the end first, then the line is cut with `…`. Null when the
// line is.
function fitLine(v: View, width: number | undefined, lineWith: (names: number) => LineSegment[] | null): LineSegment[] | null {
  const full = lineWith(Infinity)
  if (full === null || typeof width !== 'number' || !Number.isFinite(width) || lengthOf(full) <= width) return full
  for (let names = v.agents.filter(isRunning).length - 1; names >= 0; names--) {
    const shorter = lineWith(names)!
    if (lengthOf(shorter) <= width) return shorter
  }
  const shortest = lineWith(0)!
  return lengthOf(shortest) <= width ? shortest : cut(shortest, Math.max(width - 1, 0))
}

// How many cells the segments take.
const lengthOf = (segments: readonly LineSegment[]): number => segments.reduce((cells, segment) => cells + segment.text.length, 0)

// The segments cut to `chars` characters, in order, ending with `…`. A
// segment the cut empties is dropped, and one the cut falls inside keeps what
// is left of its text and its marks, so a cut inside the background part
// leaves the remainder marked and a cut before it leaves nothing marked. The
// ellipsis joins the last segment kept, or stands alone when none is.
function cut(segments: readonly LineSegment[], chars: number): LineSegment[] {
  const kept: LineSegment[] = []
  let left = chars
  for (const segment of segments) {
    if (left <= 0) break
    kept.push(segment.text.length <= left ? segment : { ...segment, text: segment.text.slice(0, left) })
    left -= segment.text.length
  }
  const last = kept.pop()
  return last === undefined ? [plain('…')] : [...kept, { ...last, text: `${last.text}…` }]
}

// The words for the stage last reported, or `started` before any report.
function stageWords(progress: Progress | null): string {
  if (progress === null) return 'started'
  return stageLabel(progress.stage)
}

// The band's second row. With a pull request watched it is the line above,
// whether builder was started or not. Once builder is started with none watched,
// it names the stage (or `started`), what runs and the usage-limit hold, or
// `idle` when neither is there, fitted as the line is. Before builder is
// started it is the line as it was before there was a bar: none while nothing
// runs and no hold is on. A stale session's row leads with the warning, as the
// line does. The row is the texts of secondRowSegments joined.
export function secondRow(v: View, width?: number): string | null {
  const segments = secondRowSegments(v, width)
  return segments === null ? null : textOf(segments)
}

// The band's second row as segments, with its background part marked, as
// abovePromptSegments gives the line.
export function secondRowSegments(v: View, width?: number): LineSegment[] | null {
  if (v.pr !== null || !v.started) return abovePromptSegments(v, width)
  const stage = stageWords(v.progress)
  return withWarning(v, width, room => fitLine(v, room, names => {
    const shown = runningOrHold(v, names)
    return merged([plain(`${PREFIX}${stage}${SEPARATOR}`), ...(shown.length === 0 ? [plain('idle')] : shown)])
  }))
}

// About how many CSS pixels wide one column of the band or the pane is on the
// desktop, which turns the columns the engine gives into a drawing's width.
const PX_PER_COLUMN = 8

// The width a drawing is drawn at for `columns` columns, or the drawings'
// middling width when the columns are not known.
export function drawingWidth(columns: number | undefined): number {
  return svgWidth(typeof columns === 'number' && Number.isFinite(columns) ? columns * PX_PER_COLUMN : Number.NaN)
}

// The bar as one row: a drawing on a surface that draws images, else text
// cells fitted to `columns`. The drawing's text alternative is the text row.
// When `address` is the project's usable issue address and the title begins
// with an issue key, the key is a link too: on a picture surface, on its own
// row above the drawing, whose title then leaves the key out so the key is
// not shown twice; on the terminal, as the start of the text row, but only
// while the fitted row still holds the title, so a row whose title was
// dropped stays plain.
function barRow(ui: Elements, bar: Bar, columns: number | undefined, key: string, address: string | null) {
  const { Link } = ui
  const { issueKey, issueTitle } = issueOf(bar.title)
  const link = linkOf(address, issueKey)
  if (hasSvg(ui)) {
    const { Svg } = ui
    const width = drawingWidth(columns)
    const drawn = link === null ? bar : { ...bar, title: issueTitle }
    const drawing = <Svg key={key} source={barSvg(drawn, width)} alt={fitBar(drawn, Infinity)} width={width} height={BAR_SVG_HEIGHT} />
    return link === null ? drawing : [<Link key={`${key}-link`} href={link}>{issueKey}</Link>, drawing]
  }
  const { Text } = ui
  const row = fitBar(bar, columns ?? Infinity)
  // linkOf already answers null for a null key, so the check on the key here
  // only narrows its type.
  if (link === null || issueKey === null) return <Text key={key}>{row}</Text>
  // The key is drawn as a link only when the row still holds the whole title,
  // and so begins with the key, rather than a row the width cut short.
  const titleKept = row === fitBar(bar, Infinity) && row.startsWith(issueKey)
  if (!titleKept) return <Text key={key}>{row}</Text>
  return <Text key={key}><Link href={link}>{issueKey}</Link>{row.slice(issueKey.length)}</Text>
}

// The agent-count button's label: how many agents run now, then how many are
// planned when any are, then how many have finished when any have. The
// running count comes first because it is what the person looks for; a single
// total read as if every agent the session had ever started were still
// running. An agent the engine no longer lists counts as finished.
export function agentCount(v: View): string {
  const parts = [runningAgents(v)]
  if (v.planned.length > 0) parts.push(`${v.planned.length} planned`)
  const finished = v.agents.filter(card => !isRunning(card)).length
  if (finished > 0) parts.push(`${finished} finished`)
  return parts.join(' · ')
}

export type BandPresses = { agents: () => void; line: () => void }

// The band above the prompt, as a column: the bar, once builder is started and
// there is one, with the agent-count button on its own row below it, then the
// second row as a button. Before builder is started there is no bar, as before
// there was one. `line` is the second row, secondRowSegments(v, width), which
// the caller has already worked out. Null when there is neither a bar nor a
// second row.
export function bandTree(ui: Elements, v: View, line: readonly LineSegment[] | null, width: number | undefined, presses: BandPresses) {
  const { Box, Button } = ui
  const bar = v.started ? barOf(v.progress, v.pr, v.watchSince) : null
  if (bar === null && line === null) return null
  return (
    <Box flexDirection="column">
      {bar !== null && barRow(ui, bar, width, 'builder-bar', v.issueLink)}
      {bar !== null && <Button key="builder-agents" plain dimColor label={agentCount(v)} onPress={presses.agents} />}
      {line !== null && lineButton(ui, line, presses.line)}
    </Box>
  )
}

// The line's button. Its label is the whole line, as it always was, and that
// is all it has until a segment is past the ceiling. Then it also takes the
// line as children: the text before the part, the part as a yellow Text, the
// colour of the pane's stale warning, and the text after it, less either text
// when it is empty, so a surface that draws children shows the part in yellow
// and one that draws none still shows the label.
function lineButton(ui: Elements, segments: readonly LineSegment[], onPress: () => void) {
  const { Button, Text } = ui
  const label = textOf(segments)
  const at = segments.findIndex(segment => segment.isBackground && segment.isPast)
  if (at === -1) return <Button key="builder-line" plain dimColor label={label} onPress={onPress} />
  const part = <Text key="builder-line-part" color="yellow">{segments[at]!.text}</Text>
  const children = [textOf(segments.slice(0, at)), part, textOf(segments.slice(at + 1))].filter(child => child !== '')
  return <Button key="builder-line" plain dimColor label={label} onPress={onPress}>{children}</Button>
}

// A snapshot an older build saved lacks the round count; until the next look
// replaces it, nothing is drawn rather than a wrong round.
export function isDrawable(s: Snapshot | null): s is Snapshot {
  return s !== null && typeof s.headsReviewed === 'number'
}

// What the pane calls each outcome of a counted round. A rerun's round is
// shown as still voting, so it has no word here.
const OUTCOME_WORDS: Record<Exclude<CounselTally['outcome'], 'rerun'>, string> = { decided: 'decided', ask: 'asked the person', counted: 'counted' }

// One round's tally per option counted against the members who took part,
// then the members without a vote listed under "Without a vote:" with their
// reasons, each line starting with `indent`.
function tallyLines(options: readonly string[], t: CounselTally, indent: string): string[] {
  const lines: string[] = []
  const { took, abstained } = turnoutOf(t)
  const counted = options.map((option, i) => `${i + 1}. ${option} ${t.counts[i] ?? 0}`)
  lines.push(took.length === 0
    ? `${indent}Tally: no member took part`
    : `${indent}Tally: ${[...counted, `no option ${noOptionCount(t)}`].join(', ')}, of ${took.length} who took part`)
  if (abstained.length > 0) {
    const named = abstained.map(a => `${shortName(a.member)} (${abstainerReason(a)})`)
    lines.push(`${indent}Without a vote: ${named.join(', ')}`)
  }
  return lines
}

// The counsel's questions as the pane lists them, newest first: the question
// and its round, the last tally per option counted against the members who
// took part, the members without a vote listed under "Without a vote:" with
// their reasons, the outcome, the chosen option, any proposal a decided round
// only showed, and the session's lean. The label is the one the question put
// to the person uses, so the pane never suggests that abstaining is still
// allowed. Members without a vote appear only in a tally recorded before
// every member had to vote, or before the owner's advocate joined, or in a
// round sent to the person because a member asked again still had none. While
// round 2 is voted on after a rerun, round 1's tally is drawn under a `Round
// 1:` line over round 1's options only, and the options its proposals added
// are named as new with their numbers and no count. A counted follow-ups
// question lists each follow-up in place of the tally, with its own tally and
// decision and its members without a vote.
export function counselLines(list: readonly CounselQuestion[]): string[] {
  const lines: string[] = []
  for (const q of list.slice(-COUNSEL_KEPT).reverse()) {
    const t = q.tallies.at(-1)
    const head = `${q.id} · round ${q.round}`
    if (t === undefined) {
      lines.push(`${head} · voting · ${q.question}`, `  Lean: ${q.lean}`)
      continue
    }
    // A rerun's tally belongs to round 1; round 2 is still being voted on.
    if (t.outcome === 'rerun') {
      lines.push(`${head} · voting · ${q.question}`, '  Round 1:')
      lines.push(...tallyLines(q.options.slice(0, t.counts.length), t, '    '))
      const added = q.options.slice(t.counts.length).map((option, i) => `${t.counts.length + i + 1}. ${option}`)
      if (added.length > 0) lines.push(`    New in round 2: ${added.join(', ')}`)
      lines.push(`  Lean: ${q.lean}`)
      continue
    }
    lines.push(`${head} · ${OUTCOME_WORDS[t.outcome]} · ${q.question}`)
    if (t.outcome === 'counted') {
      lines.push(...followUpLines(q, t), `  Lean: ${q.lean}`)
      continue
    }
    lines.push(...tallyLines(q.options, t, '  '))
    if (t.outcome === 'decided') {
      lines.push(`  Chosen: ${chosenOf(q, t)}`)
      if (t.proposed.length > 0) lines.push(`  Proposed, shown only: ${t.proposed.join(', ')}`)
    }
    lines.push(`  Lean: ${q.lean}`)
  }
  return lines
}

// A counted follow-ups question's follow-ups, each with its votes for fix,
// file, drop and none, and the counsel's decision or that it did not decide,
// then the members without a vote on it.
function followUpLines(q: CounselQuestion, t: CounselTally): string[] {
  return followUpOutcomes(q, t).flatMap(o => {
    const counted = [...FOLLOW_UP_WORDS.map((word, i) => `${word} ${o.counts[i] ?? 0}`), `no option ${o.noOption}`].join(', ')
    const decision = o.decision === null ? 'not decided, so dropped' : `decided: ${o.decision}`
    const line = `  ${o.number}. ${o.text} · ${counted} · ${decision}`
    if (o.without.length === 0) return [line]
    return [line, `    Without a vote: ${o.without.map(a => `${shortName(a.member)} (${abstainerReason(a)})`).join(', ')}`]
  })
}

function counselTree({ Text }: El, list: readonly CounselQuestion[]) {
  if (list.length === 0) return null
  return [
    <Text key="counsel-gap"> </Text>,
    <Text key="counsel-head" bold>Counsel</Text>,
    ...counselLines(list).map((line, i) => <Text key={`counsel-${i}`} dimColor={line.startsWith('  ')}>{line}</Text>),
  ]
}

export const NOTHING_WATCHED =
  'No pull request is watched. The session calls the watch tool after opening one, or run /builder watch <number>.'

// The agents as the pane lists them: running ones first, newest first within
// each group.
function agentsInOrder(cards: readonly AgentCard[]): AgentCard[] {
  const newestFirst = [...cards].sort((a, b) => b.startedAt - a.startedAt)
  return [...newestFirst.filter(isRunning), ...newestFirst.filter(card => !isRunning(card))]
}

// A running agent has run until now. A finished one ran for the duration its
// turn reported, else until the mod saw it end, else until the engine's list
// last named it.
function ranFor(card: AgentCard, now: number): number {
  if (isRunning(card)) return now - card.startedAt
  if (card.durationMs !== undefined) return card.durationMs
  if (card.endedAt !== undefined) return card.endedAt - card.startedAt
  if (card.lastSeenAt !== undefined) return card.lastSeenAt - card.startedAt
  return now - card.startedAt
}

// What an agent's row shows, cleaned: its type without the `builder:` prefix,
// its description, its model as modelLabel names it, its status as
// shownStatus words it, how long it has run or ran, and its summary line once
// it has one.
export function agentRowOf(card: AgentCard, now: number): AgentRow {
  const summary = typeof card.summary === 'string' ? printable(card.summary, 120) : ''
  return {
    type: printable(shortName(card.type), 60),
    description: printable(card.description),
    model: modelLabel(card.model),
    status: printable(shownStatus(card), 20),
    time: clockTime(ranFor(card, now)),
    ...(summary === '' ? {} : { summary }),
    isRunning: isRunning(card),
  }
}

// An agent's row as a line of text: the status and the type, then the
// description when there is one, the model, the time and the summary.
function lineOfRow(r: AgentRow): string {
  const parts = [`${r.status} ${r.type}`, r.description, r.model, r.time, r.summary ?? '']
  return parts.filter(part => part !== '').join(' · ')
}

// One row per agent, every agent, in the pane's order, as the terminal draws them.
export function agentLines(v: View): string[] {
  return agentsInOrder(v.agents).map(card => lineOfRow(agentRowOf(card, v.now)))
}

// A background task's row as a line of text: its status and type, its
// description or command, and how long the session has waited on it, with
// the suffix past the ceiling, as taskTime prints it.
function backgroundLine(task: BackgroundTask, now: number): string {
  return `${printable(task.status, 20)} ${printable(task.type, 20)} · ${taskName(task)} · ${taskTime(task, now)}`
}

// One row per background task, with its status, type and description, or its
// command when it has no description, and how long the session has waited on it.
export function backgroundLines(v: View): string[] {
  return v.background.map(task => backgroundLine(task, v.now))
}

// A background task's row, in yellow, the colour of the stale warning, once
// the session has waited on it past the ceiling, and plain before that.
function backgroundRow({ Text }: El, task: BackgroundTask, i: number, now: number) {
  return <Text key={`background-${i}`} color={isPastCeiling(task, now) ? 'yellow' : undefined}>{backgroundLine(task, now)}</Text>
}

// One agent's row: a drawing on a surface that draws images, else a line of
// text, dimmed once the agent has finished. The card is cleaned once, and the
// drawing's text alternative is made from that same row.
function agentRow(ui: Elements, card: AgentCard, now: number, columns: number | undefined) {
  const row = agentRowOf(card, now)
  if (hasSvg(ui)) {
    const { Svg } = ui
    const width = drawingWidth(columns)
    return <Svg key={`agent-${card.id}`} source={agentSvg(row, now, width)} alt={lineOfRow(row)} width={width} height={AGENT_SVG_HEIGHT} />
  }
  const { Text } = ui
  return <Text key={`agent-${card.id}`} dimColor={!isRunning(card)}>{lineOfRow(row)}</Text>
}

// A planned agent's row: its type and that it is planned. The type can come
// from the members a counsel tally named, so it is cleaned once here for the
// image's text alternative and the terminal row alike.
function plannedRow(ui: Elements, type: string, columns: number | undefined) {
  const line = `planned ${printable(shortName(type), 60)}`
  if (hasSvg(ui)) {
    const { Svg } = ui
    const width = drawingWidth(columns)
    return <Svg key={`planned-${type}`} source={plannedSvg(type, width)} alt={line} width={width} height={PLANNED_SVG_HEIGHT} />
  }
  const { Text } = ui
  return <Text key={`planned-${type}`} dimColor>{line}</Text>
}

export type PanePresses = { fold: () => void; output: (id: string) => void }

// An agent's row followed, on a row of its own, by the button that opens the
// agent pane on it.
function agentWithOutput(ui: Elements, card: AgentCard, now: number, columns: number | undefined, presses: PanePresses) {
  const { Button } = ui
  return [
    agentRow(ui, card, now, columns),
    <Button key={`output-${card.id}`} plain dimColor label="output" onPress={() => presses.output(card.id)} />,
  ]
}

// The agents in three groups: running ones, then planned ones, then finished
// ones under a button that folds and unfolds them, followed by the session's
// background work.
function agentsTree(ui: Elements, v: View, columns: number | undefined, presses: PanePresses) {
  const { Text, Button } = ui
  const ordered = agentsInOrder(v.agents)
  const running = ordered.filter(isRunning)
  const finished = ordered.filter(card => !isRunning(card))
  const isEmpty = v.agents.length === 0 && v.planned.length === 0
  return [
    <Text key="agents-head" bold>Agents</Text>,
    ...(isEmpty ? [<Text key="agents-none" dimColor>None launched yet.</Text>] : []),
    ...running.flatMap(card => agentWithOutput(ui, card, v.now, columns, presses)),
    ...v.planned.map(type => plannedRow(ui, type, columns)),
    ...(finished.length === 0 ? [] : [
      <Button key="builder-fold" plain dimColor label={`Finished · ${finished.length}`} onPress={presses.fold} />,
      ...(v.finishedFolded ? [] : finished.flatMap(card => agentWithOutput(ui, card, v.now, columns, presses))),
    ]),
    ...(v.background.length === 0 ? [] : [
      <Text key="background-gap"> </Text>,
      <Text key="background-head" bold>Background</Text>,
      ...v.background.map((task, i) => backgroundRow(ui, task, i, v.now)),
    ]),
  ]
}

// The top of the pane: the work as the bar shows it, once there is a bar.
function workTree(ui: Elements, v: View, columns: number | undefined) {
  const bar = barOf(v.progress, v.pr, v.watchSince)
  if (bar === null) return null
  const { Text } = ui
  return [barRow(ui, bar, columns, 'work-bar', v.issueLink), <Text key="work-gap"> </Text>]
}

// The stale warning at the top of the pane, in yellow, when the session is
// stale.
function staleTree({ Text }: El, v: View) {
  if (!v.stale) return null
  return [<Text key="stale-warning" color="yellow">{STALE_WARNING}</Text>, <Text key="stale-gap"> </Text>]
}

// The pane, with a pull request watched or not: the stale warning when the
// session is stale, then the work, then the pull
// request's state when one is watched, then the agents, the background work,
// the open questions, the counsel and, with a pull request, the next step and
// the last look. With none watched, as during /spec, it still lists the
// agents, the background work and the counsel.
export function paneTree(ui: Elements, v: View, presses: PanePresses, columns?: number) {
  const { Box, Text } = ui
  const s = v.pr
  if (s === null) {
    return (
      <Box flexDirection="column">
        {staleTree(ui, v)}
        {workTree(ui, v, columns)}
        <Text dimColor>{NOTHING_WATCHED}</Text>
        <Text> </Text>
        {agentsTree(ui, v, columns, presses)}
        {counselTree(ui, v.counsel)}
      </Box>
    )
  }
  const failed = failedCheckNames(s.checks)
  const open = v.questions.filter(q => !q.answered)
  const last = v.wakes.at(-1)
  const verdicts = s.verdicts
    ? `spec ${s.verdicts.spec.toLowerCase()}, adversarial ${s.verdicts.adversarial.toLowerCase()}`
    : 'none'

  return (
    <Box flexDirection="column">
      {staleTree(ui, v)}
      {workTree(ui, v, columns)}
      <Text bold>{`${s.repo}#${s.number} · ${s.state.toLowerCase()} · head ${s.head.slice(0, 8)}`}</Text>
      <Text>{`Labels: ${s.labels.length > 0 ? s.labels.join(', ') : 'none'} · mergeable ${s.mergeable.toLowerCase()}`}</Text>
      <Text>{`Checks: ${ciOf(s.checks)}${failed.length > 0 ? ` (failed: ${failed.join(', ')})` : ''}`}</Text>
      <Text>{`Verdicts at head: ${verdicts}`}</Text>
      <Text>{`Round ${roundInProgress(s)} (${s.headsReviewed} reviewed) · ${s.pushesSinceVerdict} ${s.pushesSinceVerdict === 1 ? 'push' : 'pushes'} since the last changes-requested verdict`}</Text>
      <Text> </Text>
      {agentsTree(ui, v, columns, presses)}
      {open.length > 0 && <Text> </Text>}
      {open.map(q => <Text key={String(q.at)} color="yellow">{`Asked: ${q.asked}`}</Text>)}
      {counselTree(ui, v.counsel)}
      <Text> </Text>
      <Text>{`Next: ${nextStep(v)}.`}</Text>
      {last && <Text dimColor>{`Last look: ${last.source}, ${elapsed(v.now - last.at)} ago, ${last.changed ? 'changed' : 'unchanged'}.`}</Text>}
    </Box>
  )
}

// How many of an agent's newest messages the agent pane shows.
export const MESSAGES_SHOWN = 40

// The input keys that say best what a tool use did, in the order they are
// tried: a Bash call's description before its command, then the paths,
// patterns and prompts other tools take.
const INPUT_KEYS = ['description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'skill']

// A tool use's input in a few words: the first of INPUT_KEYS it holds as
// text, else the whole input as JSON, cleaned and cut short.
function shortInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  const named = INPUT_KEYS.map(key => fields[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '')
  if (named !== undefined) return printable(named, 80)
  let json: string
  try {
    json = JSON.stringify(input) ?? ''
  } catch {
    json = ''
  }
  return printable(json, 80)
}

// The lines the agent pane shows for an agent's messages, as the engine holds
// them: of the newest MESSAGES_SHOWN messages, each assistant message's text
// and each of its tool uses as the tool's name and its input in a few words.
// The agent's prompt and the tools' answers are user messages and are left
// out. Anything not in the shape of a message is skipped.
export function messageLines(messages: readonly unknown[]): string[] {
  const lines: string[] = []
  for (const raw of messages.slice(-MESSAGES_SHOWN)) {
    if (typeof raw !== 'object' || raw === null) continue
    const message = raw as { role?: unknown; text?: unknown; toolUses?: unknown }
    if (message.role !== 'assistant') continue
    const text = typeof message.text === 'string' ? printable(message.text, 200) : ''
    if (text !== '') lines.push(text)
    const uses = Array.isArray(message.toolUses) ? message.toolUses as unknown[] : []
    for (const use of uses) {
      if (typeof use !== 'object' || use === null) continue
      const { tool, input } = use as { tool?: unknown; input?: unknown }
      if (typeof tool !== 'string') continue
      lines.push(`${printable(tool, 60)}: ${shortInput(input)}`)
    }
  }
  return lines
}

// What reading an agent's messages gave: the lines the agent pane draws for
// them, cleaned once at the read rather than at every draw, or why they could
// not be read.
export type MessagesRead = { lines: readonly string[] } | { reason: string }

// What the engine answered for an agent's messages, as the agent pane keeps
// it: the lines messageLines gives for a list, the engine's refusal, or why
// any other answer could not be read. The whole list is not kept.
export function messagesReadOf(got: unknown): MessagesRead {
  if (Array.isArray(got)) return { lines: messageLines(got) }
  const deny = (got as { deny?: unknown } | null | undefined)?.deny
  if (typeof deny === 'string') return { reason: deny }
  return { reason: 'the engine answered something other than a list.' }
}

// The agent pane: the agent's card as its row in the builder pane draws it,
// what it was asked, and its messages, or why they could not be read. `card`
// is undefined when the mod has no record of the agent chosen, and `read` is
// null while its messages have not been read yet.
export function agentPaneTree(ui: Elements, card: AgentCard | undefined, read: MessagesRead | null, now: number, columns?: number) {
  const { Box, Text } = ui
  if (card === undefined) {
    return <Box flexDirection="column"><Text dimColor>No agent is chosen. Press an agent's output button in the builder pane.</Text></Box>
  }
  const asked = typeof card.asked === 'string' && card.asked.trim() !== ''
    ? `Asked: ${printable(card.asked, 200)}`
    : 'Asked: not known, because the mod did not see this agent start.'
  return (
    <Box flexDirection="column">
      {agentRow(ui, card, now, columns)}
      <Text>{asked}</Text>
      <Text> </Text>
      <Text bold>Messages</Text>
      {messagesTree(ui, read)}
    </Box>
  )
}

// The agent pane's messages: still being read, why they could not be, none
// yet, or one row per line the read kept.
function messagesTree({ Text }: Elements, read: MessagesRead | null) {
  if (read === null) return [<Text key="messages-reading" dimColor>Reading the messages.</Text>]
  if ('reason' in read) {
    return [<Text key="messages-refused" color="yellow">{`The messages could not be read: ${printable(read.reason, 200)}`}</Text>]
  }
  const lines = read.lines
  if (lines.length === 0) return [<Text key="messages-none" dimColor>No messages yet.</Text>]
  return lines.map((line, i) => <Text key={`message-${i}`}>{line}</Text>)
}
