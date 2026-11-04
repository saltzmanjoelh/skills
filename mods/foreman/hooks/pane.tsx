// The band above the prompt and the pane, drawn from a View. Nothing here
// reads or writes state; hooks/register.tsx builds the View and wires the
// presses.

import type { Elements as EngineElements, PluginState } from 'claude-code'

import type { ForemanFolds, ForemanLogLine, ForemanSpend, ForemanTimes } from '../types'
import { hasSvg, svgWidth } from './art'
import {
  BUSY_CHAR, FREE_CHAR, LIGHT_OF, lightsOf, lightsSvg, lightsText, lightsWidth, LIGHTS_SVG_HEIGHT, SEGMENT_CHAR, segmentsOf, stageBarOf, stagesCount, stagesSvg, stagesText, STAGES_SVG_HEIGHT,
  type Light,
} from './glance'
import { linkOf } from './links'
import { markersLine, type MarkersRecord } from './markers'
import type { BuildState } from './record'
import { plusKnown, spendOf, spendWords, TIMES_UNKNOWN, type Merged } from './spend'
import { stageLabel } from './stages'
import {
  ageWords, busyCount, chipParts, chipText, fitChips, isBusy, isProbablyHung, keyOf, moreWords, SEPARATOR, STATE_LOOK, staleWords, untilWords, waitWords, type SubRow,
  type Tone,
} from './subs'
import { printable, timeOfDay } from './text'
import { whoOf } from './wake'

export const PANE = 'foreman'

// A sub session that waits in foreman's queue, as the band and the pane show
// it: its ticket, its issue key only when the key is whole, else null, how
// long ago it was paired, and its place in the order the queue begins,
// counted from 1.
export type QueuedEntry = { ticket: string; issueKey: string | null; waitedMs: number; place: number }

// What the band and the pane draw from, read by the hooks.
export type View = {
  // Whether this session ran /start-foreman and so is a parent.
  isOn: boolean
  // The slot count in force.
  slots: number
  // The sub sessions, in issue-key order.
  rows: SubRow[]
  now: number
  // When the next read is due, or null when none is scheduled.
  nextReadAt: number | null
  log: ForemanLogLine[]
  // The project's usable issue address while the session is a parent, else
  // null, which draws every key as plain text.
  issueLink: string | null
  // What every sub session this parent started spent, and what this session
  // spent itself, or null for each while it is unknown. Only the pane's view
  // works them out, so in the band's view both are always null.
  subsSpent: ForemanSpend | null
  ownSpent: ForemanSpend | null
  // Each shown row's four times, by its file name, and each of the four
  // summed over every sub session this parent started, or null. Only the
  // pane's view works them out, so in the band's view the map is empty and
  // the sums are null.
  rowTimes: ReadonlyMap<string, ForemanTimes>
  subsTime: ForemanTimes | null
  // The newest notice the band shows, as shownReport gives it, else null: a
  // report sentence, or a kept needs-you, held or begin-held notice. The band
  // shows it after the chips.
  report: string | null
  // The count of builder's status messages consumed since foreman's hooks
  // loaded, while the session is a parent, else null.
  markers: MarkersRecord | null
  // The sub sessions that wait in the queue, in the order they begin, while
  // the session is a parent, else none.
  queued: QueuedEntry[]
  // Whether foreman counts a slot as free, while the session is a parent and
  // its ledger could be read.
  isSlotFree: boolean
  // Whether the ledger could be read, while the session is a parent. When it
  // could not, nothing is known about which slots are busy, so the pane draws
  // no lights and no count of busy slots.
  isLedgerRead: boolean
  // Which of the pane's rows the person unfolded. Only the pane's view reads
  // them, so in the band's view every row is folded.
  folds: ForemanFolds
  // How many issues merged and what each cost on average, or null while
  // unknown, as when the ledger could not be read. Only the pane's view works
  // it out, so in the band's view it is always null.
  merged: Merged | null
}

// How long the band shows a report sentence after foreman showed it.
export const REPORT_SHOWN_MS = 10 * 60_000

// The fewest columns a report sentence is drawn in. A band with less room
// left after the chips drops the sentence rather than show a stub of it.
export const REPORT_MIN_COLUMNS = 16

// The most characters of a report sentence the band draws when it is given no
// width.
const REPORT_MAX = 240

// How many notices the band keeps since the person last typed, from the
// value foreman keeps in $.state: its `kept` when that is a positive whole
// number, else 0, so a value stored before `kept` existed is not kept.
export function keptOf(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0
  const { kept } = raw as { kept?: unknown }
  return typeof kept === 'number' && Number.isInteger(kept) && kept > 0 ? kept : 0
}

// A notice that reaches the band: its newest sentence, how many notices it
// counts as, and whether it is a report, which the band shows for
// REPORT_SHOWN_MS even when its notification went.
export type BandNotice = { newest: string; count: number; isReport: boolean }

// The value foreman keeps in $.state for the band, taken from the state
// contract in types/index.d.ts, so the two cannot drift apart.
export type StoredReport = PluginState['foreman']['report']

// The band's value when a notice arrives at `at`, before its notification
// is raised, so the band never waits on that call. A notice that arrives while
// another is kept becomes the newest and is counted now, whether its own
// notification goes or not, so a delivered one never pushes a kept one out of
// the count. Otherwise a report shows for its ten minutes, as it always has,
// and any other notice leaves the band as it was until its notification
// fails. `counted` says whether the notice is in the count already.
export function noticeArrived(raw: StoredReport, notice: BandNotice, at: number): { value: StoredReport; counted: boolean } {
  const kept = keptOf(raw)
  if (kept > 0) return { value: { text: notice.newest, at, kept: kept + notice.count }, counted: true }
  return { value: notice.isReport ? { text: notice.newest, at, kept: 0 } : raw, counted: false }
}

// The band's value once the notification of a notice that arrived at `at`
// and was not counted yet has failed: the notice is kept. When a later notice
// is in the band already, as when this call answered last, that one stays the
// newest and this one joins the count. A later notice that is not counted
// yet, because nothing was kept when it arrived, stays out of the count and
// is marked `newestOut`, so that its own failure, if it comes, adds it once
// with all its sentences. A value the person's typing released is not a later
// notice, even when typing moved its `at` to the moment they typed: they saw
// it before they typed, so it keeps its ten minutes and this notice is kept
// alone.
export function noticeFailed(raw: StoredReport, notice: BandNotice, at: number): StoredReport {
  const kept = keptOf(raw)
  if (raw !== null && raw.released !== true && typeof raw.text === 'string' && typeof raw.at === 'number' && raw.at > at) {
    const newestOut = kept === 0 || raw.newestOut === true
    return newestOut
      ? { text: raw.text, at: raw.at, kept: kept + notice.count, newestOut: true }
      : { text: raw.text, at: raw.at, kept: kept + notice.count }
  }
  return { text: notice.newest, at, kept: kept + notice.count }
}

// The band's value once the person types. A kept notice shows for
// REPORT_SHOWN_MS more from `now`, alone, since the count said "since your
// last message". Any notice the band holds is marked `released`, kept or not,
// so that noticeFailed never takes a notice the person saw before typing for
// one that arrived after. A value that is released already, or null, is left
// as it was, so only the first message after a new notice writes the band.
export function afterTyped(raw: StoredReport, now: number): StoredReport {
  if (raw === null || raw.released === true) return raw
  return keptOf(raw) > 0 ? { text: raw.text, at: now, kept: 0, released: true } : { text: raw.text, at: raw.at, released: true }
}

// The report the band shows, from the value foreman keeps in $.state. A kept
// notice shows whatever its age, followed by the count of the others kept
// since the person last typed, which is all of `kept` when the newest is
// marked `newestOut` and is not in it. Any other shows while it is less than
// REPORT_SHOWN_MS old at `now`, else nothing. A value of any other shape
// shows nothing.
export function shownReport(raw: unknown, now: number): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { text, at } = raw as { text?: unknown; at?: unknown }
  if (typeof text !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null
  const kept = keptOf(raw)
  const more = (raw as { newestOut?: unknown }).newestOut === true ? kept : kept - 1
  if (kept > 0) return more > 0 ? `${text} (${more} more since your last message.)` : text
  return now - at < REPORT_SHOWN_MS ? text : null
}

// The elements the band and the pane draw with, as hooks/register.tsx builds
// them: `Svg` is there only on a surface that draws images.
export type Elements = Pick<EngineElements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'> & { Svg?: EngineElements['desktop']['Svg'] }

// The theme color each tone is drawn in; plain text takes no color.
const TONE_COLOR: Record<Tone, string | undefined> = { red: 'error', amber: 'warning', plain: undefined }

// What the band says about the next read.
export function nextReadWords(v: View): string {
  if (v.nextReadAt === null) return 'no read scheduled'
  const when = untilWords(v.nextReadAt - v.now)
  return when === null ? 'next read due now' : `next read in ${when}`
}

// The start of the band: the slots busy out of the slots allowed.
export function bandHead(v: View): string {
  return `foreman: ${busyCount(v.rows)} of ${v.slots} slots busy`
}

// What the band says about the queue right after its head: how many sub
// sessions wait, `queue empty` in the warning color when nobody waits and a
// slot is free, and nothing when nobody waits and no slot is free.
export function queueWords(v: Pick<View, 'queued' | 'isSlotFree'>): { text: string; tone: Tone } | null {
  if (v.queued.length > 0) return { text: `${v.queued.length} queued`, tone: 'plain' }
  return v.isSlotFree ? { text: 'queue empty', tone: 'amber' } : null
}

// The link to a row's issue, or null when there is no address or the row's
// key is not linked. The key is linked only when it is drawn as the record
// holds it, so a key that `printable` cut or cleaned of an escape sequence
// stays plain text.
export function rowLink(row: SubRow, address: string | null): string | null {
  const key = row.record.issueKey
  return keyOf(row) === key ? linkOf(address, key) : null
}

// `open` opens a chip's sub session, and `pane` opens foreman's pane.
export type BandPresses = { open: (file: string) => void; pane: () => void }

// The band, in a parent only: the head, then what queueWords says about the
// queue, then a chip for each sub session that fits `width` with `+N more`
// for the rest, when the next read is due, and last the report sentence while
// there is one, cut to the columns the rest left over. The words about the
// queue take their columns before the chips are fitted, so the band never
// runs past its width. The chips are fitted before the report, exactly as
// without one, so they never give up width to it, and the report is dropped
// when fewer than REPORT_MIN_COLUMNS columns are left for it.
// The head is a button that opens foreman's pane. Each chip is a button that
// opens its sub session; it is colored by its state's tone, or dimmed and
// uncolored when its file is stale. A chip whose issue has a link draws its
// key as that link, then a space as its own text, then the button holding the
// rest of the chip. The chips are fitted by their whole text either way. A
// released sub session has no chip. Null in a session that is not a parent,
// so the host draws what it would without foreman.
export function bandTree(ui: Elements, view: View, width: number | undefined, presses: BandPresses) {
  if (!view.isOn) return null
  const v = { ...view, rows: view.rows.filter(row => row.isReleased !== true) }
  const { Box, Text, Button, Link } = ui
  const head = bandHead(v)
  const tail = `${SEPARATOR}${nextReadWords(v)}`
  const queue = queueWords(v)
  const queueText = queue === null ? '' : `${SEPARATOR}${queue.text}`
  const queueParts = queue === null
    ? null
    : [
      <Text key="queue-gap">{SEPARATOR}</Text>,
      queue.tone === 'plain' ? <Text key="queue">{queue.text}</Text> : <Text key="queue" color={TONE_COLOR[queue.tone]}>{queue.text}</Text>,
    ]
  // The report after the rest of the band, which takes `used` columns.
  const report = (used: number) => {
    if (v.report === null) return null
    const room = width === undefined ? REPORT_MAX : width - used - SEPARATOR.length
    if (room < REPORT_MIN_COLUMNS) return null
    return <Text key="report">{`${SEPARATOR}${printable(v.report, room)}`}</Text>
  }
  // The head is a plain button that opens foreman's pane, drawn with the same
  // text, so the band's width does not change.
  const headButton = <Button key="foreman-head" plain onPress={presses.pane}><Text>{head}</Text></Button>
  if (v.rows.length === 0) {
    const rest = `${SEPARATOR}no sub sessions${tail}`
    return <Box key="foreman-band" flexDirection="row">{headButton}{queueParts}<Text key="rest">{rest}</Text>{report(head.length + queueText.length + rest.length)}</Box>
  }
  const chips = v.rows.map(row => chipText(row, v.now))
  const room = width === undefined ? Infinity : width - head.length - queueText.length - tail.length
  const { shown, more } = fitChips(chips, room)
  const moreText = more > 0 ? `${SEPARATOR}${moreWords(more)}` : ''
  const used = head.length + queueText.length + chips.slice(0, shown).reduce((sum, chip) => sum + SEPARATOR.length + chip.length, 0) + moreText.length + tail.length
  const chip = (row: SubRow, text: string) => (row.isStale
    ? <Button key={`chip-${row.file}`} plain dimColor onPress={() => presses.open(row.file)}><Text dimColor>{text}</Text></Button>
    : <Button key={`chip-${row.file}`} plain onPress={() => presses.open(row.file)}><Text color={TONE_COLOR[STATE_LOOK[row.record.state].tone]}>{text}</Text></Button>)
  return (
    <Box key="foreman-band" flexDirection="row">
      {headButton}
      {queueParts}
      {v.rows.slice(0, shown).flatMap((row, i) => {
        const gap = <Text key={`gap-${row.file}`}>{SEPARATOR}</Text>
        const link = rowLink(row, v.issueLink)
        if (link === null) return [gap, chip(row, chips[i]!)]
        const { key, rest } = chipParts(row, v.now)
        return [
          gap,
          <Link key={`link-${row.file}`} href={link}>{key}</Link>,
          <Text key={`chip-gap-${row.file}`}> </Text>,
          chip(row, rest),
        ]
      })}
      {more > 0 && <Text key="more">{moreText}</Text>}
      <Text key="next">{tail}</Text>
      {report(used)}
    </Box>
  )
}

// About how many CSS pixels wide one column of the pane is on the desktop,
// which turns the columns the engine gives into a drawing's width, as
// builder's pane does.
const PX_PER_COLUMN = 8

function drawingWidth(columns: number | undefined): number {
  return svgWidth(typeof columns === 'number' && Number.isFinite(columns) ? columns * PX_PER_COLUMN : Number.NaN)
}

// The theme color each light is drawn in on the terminal, and on a card's
// state word. A muted light takes no color and is dimmed instead.
const LIGHT_COLOR: Record<Light, string | undefined> = { green: 'success', red: 'error', amber: 'warning', muted: undefined }

// The icon a card draws before its state word. It is typed over every state,
// so a state added to the record fails the type check until it has one. A
// state's words and tone are in STATE_LOOK in hooks/subs.ts, and its light is
// in LIGHT_OF in hooks/glance.ts.
const STATE_ICON: Record<BuildState, string> = {
  'working': '▸',
  'waiting-on-builder': '…',
  'idle': '◦',
  'needs-you': '!',
  'in-cleanup': '↺',
  'done': '✓',
}

// The words for a figure in dollars, or `cost unknown`, never $0.00 for a
// figure foreman does not know.
const usdWords = (usd: number | null) => (usd === null ? 'cost unknown' : `$${usd.toFixed(2)}`)

// The words for a time, or `time unknown`, never zero for a time foreman
// does not know.
const timeWords = (ms: number | null) => (ms === null ? 'time unknown' : ageWords(ms))

// What a row's sub session has worked and spent, as a card and a compact
// line show it at the right: its working time and its dollars.
function workedWords(row: SubRow, times: ForemanTimes): string {
  return `${timeWords(times.working)}${SEPARATOR}${usdWords(spendOf(row.record.usage)?.usd ?? null)}`
}

// The pull request as a card names it.
function pullRequestWords(row: SubRow): string | null {
  const pr = row.record.pr
  if (pr === null) return null
  return `#${pr.number} ${printable(pr.state, 20)} · checks ${printable(pr.checks, 20)}`
}

// A card's dim line, before its time and cost: the stage, or `no stage yet`,
// then the pull request and its checks when there is one, the reason the
// record gives when it gives one, the background task the sub session waits
// on when the record names one, and last how long the file has gone without
// an update when it is stale.
export function cardLineWords(row: SubRow, now: number): string {
  const { stage } = row.record
  const parts = [stage === null ? 'no stage yet' : stageLabel(stage)]
  const pr = pullRequestWords(row)
  if (pr !== null) parts.push(pr)
  const reason = printable(row.record.reason, 120)
  if (reason !== '') parts.push(reason)
  const wait = waitWords(row, now)
  if (wait !== null) parts.push(wait)
  if (row.isStale) parts.push(staleWords(row, now))
  return parts.join(SEPARATOR)
}

// `open`, `nudge` and `release` act on a row's sub session by its file, and
// `openQueued` opens a waiting sub session by its ticket. `log`, `tokens` and
// `menu` unfold or fold a row: each is given the state the press asks for,
// which is the opposite of the one it was drawn in.
export type PanePresses = {
  open: (file: string) => void
  nudge: (file: string) => void
  release: (file: string) => void
  openQueued: (ticket: string) => void
  log: (isOpen: boolean) => void
  tokens: (isOpen: boolean) => void
  menu: (file: string, isOpen: boolean) => void
}

// The words a released row shows in place of its state.
export const RELEASED = 'released'

// The slot lights, then `N of M busy`, then the badge queueWords gives, as
// the band words it. The lights are a drawing on a surface that draws images,
// whose text alternative is the terminal's characters, and a character each
// on the terminal: `●` in its light's color, dimmed when muted, and `○`
// dimmed for a free slot. When the ledger could not be read, which slots are
// busy is unknown, so the row says so and draws no lights and no badge.
function lightsRow(ui: Elements, v: View, busy: readonly SubRow[]) {
  const { Box, Text } = ui
  if (!v.isLedgerRead) {
    return (
      <Box key="lights" flexDirection="row" alignItems="center" gap={1}>
        <Box key="busy"><Text dimColor>{`busy slots unknown of ${v.slots}`}</Text></Box>
      </Box>
    )
  }
  const lights = lightsOf(busy, v.slots)
  const drawn = hasSvg(ui)
    ? [<Box key="lights-drawing"><ui.Svg source={lightsSvg(lights)} alt={lightsText(lights)} width={lightsWidth(lights)} height={LIGHTS_SVG_HEIGHT} /></Box>]
    : [
      ...lights.lights.map((light, i) => (LIGHT_COLOR[light] === undefined
        ? <Box key={`light-${i}`}><Text dimColor>{BUSY_CHAR}</Text></Box>
        : <Box key={`light-${i}`}><Text color={LIGHT_COLOR[light]}>{BUSY_CHAR}</Text></Box>)),
      ...Array.from({ length: lights.free }, (_, i) => <Box key={`light-${lights.lights.length + i}`}><Text dimColor>{FREE_CHAR}</Text></Box>),
    ]
  const queue = queueWords(v)
  return (
    <Box key="lights" flexDirection="row" alignItems="center" gap={1}>
      {drawn}
      <Box key="busy"><Text bold>{`${busy.length} of ${v.slots} busy`}</Text></Box>
      {queue === null ? null : queue.tone === 'plain' ? <Box key="badge"><Text>{queue.text}</Text></Box> : <Box key="badge"><Text color={TONE_COLOR[queue.tone]}>{queue.text}</Text></Box>}
    </Box>
  )
}

// A row's key: the issue's link when it has one, else text, in bold on a
// card and dimmed on a compact line. The engine keeps a key only on a Box or
// a Button, never on a Text, a Link or a drawing, so this, like every keyed
// text, link and drawing in the pane, sits in a Box of its own that carries
// the key a test finds it by.
function keyElement(ui: Elements, row: SubRow, address: string | null, isDim = false) {
  const { Box, Text, Link } = ui
  const link = rowLink(row, address)
  if (link !== null) return <Box key={`key-${row.file}`}><Link href={link}>{keyOf(row)}</Link></Box>
  return <Box key={`key-${row.file}`}>{isDim ? <Text dimColor>{keyOf(row)}</Text> : <Text bold>{keyOf(row)}</Text>}</Box>
}

// A card's stage bar: a drawing on a surface that draws images, whose text
// alternative is the terminal's cells, and cells of text on the terminal,
// with the current stage's cell in red when the sub session needs the person.
function stagesRow(ui: Elements, row: SubRow, columns: number | undefined) {
  const { Box, Text } = ui
  const bar = stageBarOf(row)
  if (hasSvg(ui)) {
    const width = drawingWidth(columns)
    return <Box key={`stages-${row.file}`}><ui.Svg source={stagesSvg(bar, width)} alt={stagesText(bar)} width={width} height={STAGES_SVG_HEIGHT} /></Box>
  }
  const at = bar.current
  // With no stage yet nothing is filled or highlighted, so the whole bar is
  // dimmed.
  if (at === null) {
    return <Box key={`stages-${row.file}`} flexDirection="row"><Box key={`stage-after-${row.file}`}><Text dimColor>{stagesText(bar)}</Text></Box></Box>
  }
  const cells = segmentsOf(bar).map(s => SEGMENT_CHAR[s])
  return (
    <Box key={`stages-${row.file}`} flexDirection="row">
      <Box key={`stage-before-${row.file}`}><Text>{cells.slice(0, at).join('')}</Text></Box>
      <Box key={`stage-now-${row.file}`}><Text color={bar.isRed ? 'error' : 'suggestion'}>{cells[at]}</Text></Box>
      <Box key={`stage-after-${row.file}`}><Text dimColor>{`${cells.slice(at + 1).join('')} ${stagesCount(bar)}`}</Text></Box>
    </Box>
  )
}

// One card for a busy sub session: a top line with the key, the title cut
// short and the state at the right, colored by its light, with its icon; the
// stage bar; one dim line with what cardLineWords says and, at the right, its
// working time and cost; and the open button with the `⋯` button at the
// right. A press of `⋯` shows a row with the Nudge and Release buttons under
// the card, and a second press hides it. The state is drawn in the warning
// color once the oldest background task is probably hung, unless it is red
// already, so the mark never makes a card look less urgent; a stale state is
// dimmed. A card whose sub session needs the person has a red border on a
// surface that draws images, and starts with `!` on the terminal.
function card(ui: Elements, v: View, row: SubRow, presses: PanePresses, columns: number | undefined) {
  const { Box, Text, Button } = ui
  const { state } = row.record
  const own = LIGHT_OF[state]
  const light: Light = own !== 'red' && isProbablyHung(row, v.now) ? 'amber' : own
  const isRed = state === 'needs-you'
  const isMenuOpen = v.folds.openMenus.includes(row.file)
  const stateText = `${STATE_ICON[state]} ${STATE_LOOK[state].words}`
  const stateElement = row.isStale || LIGHT_COLOR[light] === undefined
    ? <Box key={`state-${row.file}`}><Text dimColor>{stateText}</Text></Box>
    : <Box key={`state-${row.file}`}><Text color={LIGHT_COLOR[light]}>{stateText}</Text></Box>
  const border = hasSvg(ui) ? (isRed ? { borderStyle: 'round', borderColor: 'error' } : { borderStyle: 'round', borderDimColor: true }) : {}
  return (
    <Box key={`card-${row.file}`} flexDirection="column" marginBottom={1} paddingX={hasSvg(ui) ? 1 : 0} {...border}>
      <Box key={`card-top-${row.file}`} flexDirection="row" justifyContent="space-between">
        <Box key={`card-name-${row.file}`} flexDirection="row" flexShrink={1}>
          {isRed && !hasSvg(ui) ? <Box key={`alert-${row.file}`}><Text color="error" bold>! </Text></Box> : null}
          {keyElement(ui, row, v.issueLink)}
          <Box key={`title-${row.file}`}><Text>{` ${printable(row.record.issueTitle, 60)}`}</Text></Box>
        </Box>
        {stateElement}
      </Box>
      {stagesRow(ui, row, columns)}
      <Box key={`line-${row.file}`} flexDirection="row" justifyContent="space-between">
        <Box key={`line-words-${row.file}`}><Text dimColor>{cardLineWords(row, v.now)}</Text></Box>
        <Box key={`line-worked-${row.file}`}><Text dimColor>{` ${workedWords(row, v.rowTimes.get(row.file) ?? TIMES_UNKNOWN)}`}</Text></Box>
      </Box>
      <Box key={`actions-${row.file}`} flexDirection="row" justifyContent="space-between">
        <Button key={`open-${row.file}`} variant="primary" label="→ open" onPress={() => presses.open(row.file)} />
        <Button key={`menu-${row.file}`} plain label="⋯" onPress={() => presses.menu(row.file, !isMenuOpen)} />
      </Box>
      {isMenuOpen
        ? (
          <Box key={`menu-row-${row.file}`} flexDirection="row" gap={1}>
            <Button key={`nudge-${row.file}`} label="Nudge" onPress={() => presses.nudge(row.file)} />
            <Button key={`release-${row.file}`} label="Release" onPress={() => presses.release(row.file)} />
          </Box>
        )
        : null}
    </Box>
  )
}

// One dim compact line for a sub session that is not busy: its key, drawn as
// the issue's link when it has one, the word `released` or `done`, a button
// that opens its session, and its working time and cost. It has no `⋯`
// button, so it cannot be nudged or released.
function quietLine(ui: Elements, v: View, row: SubRow, presses: PanePresses) {
  const { Box, Text, Button } = ui
  const words = row.isReleased === true ? RELEASED : STATE_LOOK.done.words
  return (
    <Box key={`quiet-${row.file}`} flexDirection="row" gap={1}>
      <Box key={`quiet-name-${row.file}`} flexDirection="row">
        {keyElement(ui, row, v.issueLink, true)}
        <Text dimColor>{` ${words}`}</Text>
      </Box>
      <Button key={`open-${row.file}`} plain dimColor label="→ open" onPress={() => presses.open(row.file)} />
      <Box key={`quiet-worked-${row.file}`}><Text dimColor>{workedWords(row, v.rowTimes.get(row.file) ?? TIMES_UNKNOWN)}</Text></Box>
    </Box>
  )
}

// One waiting sub session in the up-next row: its place, then the button
// that opens it, naming it and how long it has waited. When its issue has a
// link, the place is followed by the key as that link, a space, and the
// button naming the wait alone. One with no whole key is named by its ticket.
function queuedRow(ui: Elements, entry: QueuedEntry, address: string | null, presses: PanePresses) {
  const { Box, Text, Button, Link } = ui
  const open = () => presses.openQueued(entry.ticket)
  const waited = `waiting for ${ageWords(entry.waitedMs)}`
  const place = <Text>{`${entry.place}. `}</Text>
  const link = linkOf(address, entry.issueKey)
  const button = (label: string) => <Button key={`open-queued-${entry.ticket}`} label={label} onPress={open} />
  if (link === null || entry.issueKey === null) {
    return <Box key={`queued-${entry.ticket}`} flexDirection="row">{place}{button(`→ ${printable(whoOf(entry.issueKey, entry.ticket), 80)} · ${waited}`)}</Box>
  }
  return (
    <Box key={`queued-${entry.ticket}`} flexDirection="row">
      {place}
      <Link href={link}>{entry.issueKey}</Link>
      <Text> </Text>
      {button(`→ ${waited}`)}
    </Box>
  )
}

// What the up-next row reads when nobody waits.
export const NOTHING_QUEUED = 'Up next: nothing queued'

// The up-next row: a chip for each waiting sub session, in the order the
// queue begins them, or NOTHING_QUEUED when nobody waits.
function upNext(ui: Elements, v: View, presses: PanePresses) {
  const { Box, Text } = ui
  if (v.queued.length === 0) return <Box key="up-next" flexDirection="row"><Text dimColor>{NOTHING_QUEUED}</Text></Box>
  return (
    <Box key="up-next" flexDirection="row" flexWrap="wrap" gap={1}>
      <Box key="up-next-head"><Text bold>Up next: </Text></Box>
      {v.queued.map(entry => queuedRow(ui, entry, v.issueLink, presses))}
    </Box>
  )
}

// The three tiles' words: a figure and its small print each.
export type Tile = { key: string; figure: string; small: string }

// The Merged tile's small print: nothing when nothing merged or the ledger
// could not be read, `cost unknown` when no merged issue has a dollar figure,
// and otherwise the average cost of each merged issue.
function mergedSmallPrint(merged: Merged | null): string {
  if (merged === null || merged.count === 0) return ''
  if (merged.average === null) return 'cost unknown'
  return `${usdWords(merged.average)} per merged issue`
}

// The tiles: what the sub sessions and this session spent together, with the
// split; the working time summed over every sub session this parent started,
// with the time spent waiting on the person; and how many issues merged, with
// the average cost of each, `cost unknown` when no merged issue has a dollar
// figure, and nothing when nothing merged. A figure foreman does not know,
// as when the ledger could not be read, reads unknown, never zero.
export function tilesOf(v: View): Tile[] {
  const subs = v.subsSpent?.usd ?? null
  const own = v.ownSpent?.usd ?? null
  const total = plusKnown(subs, own)
  const times = v.subsTime ?? TIMES_UNKNOWN
  const merged = v.merged
  return [
    { key: 'tile-spent', figure: `Spent ${usdWords(total)}`, small: `sub sessions ${usdWords(subs)}${SEPARATOR}this session ${usdWords(own)}` },
    { key: 'tile-working', figure: `Working ${timeWords(times.working)}`, small: `waiting on you ${timeWords(times.needsYou)}` },
    { key: 'tile-merged', figure: `Merged ${merged === null ? 'unknown' : merged.count}`, small: mergedSmallPrint(merged) },
  ]
}

// The tiles: side by side on a surface that draws images, each a bordered
// box with its figure and, under it in small print, what tilesOf says; and
// one line each on the terminal.
function tiles(ui: Elements, v: View) {
  const { Box, Text } = ui
  const all = tilesOf(v)
  if (!hasSvg(ui)) {
    return (
      <Box key="tiles" flexDirection="column">
        {all.map(t => <Box key={t.key}><Text>{t.small === '' ? t.figure : `${t.figure}${SEPARATOR}${t.small}`}</Text></Box>)}
      </Box>
    )
  }
  return (
    <Box key="tiles" flexDirection="row" gap={1}>
      {all.map(t => (
        <Box key={t.key} flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
          <Box key={`${t.key}-figure`}><Text bold>{t.figure}</Text></Box>
          {t.small === '' ? null : <Box key={`${t.key}-small`}><Text dimColor size="caption">{t.small}</Text></Box>}
        </Box>
      ))}
    </Box>
  )
}

// A log line's text with its count when it came more than once in a row.
const logWords = (line: ForemanLogLine) => `${line.text}${(line.times ?? 1) > 1 ? ` (${line.times} times)` : ''}`

// A folded row's heading: a plain button that asks for the row's other state.
function heading(ui: Elements, key: string, title: string, isOpen: boolean, press: (isOpen: boolean) => void) {
  const { Button } = ui
  return <Button key={key} plain label={`${isOpen ? '▾' : '▸'} ${title}`} onPress={() => press(!isOpen)} />
}

// The Log row. Folded, it shows the newest line alone, as `last: <text>
// <time of day>`, which never begins with a time of day, so it cannot be
// taken for a line of the open log. Open, it shows every kept line, newest
// last, each after its time.
function logRow(ui: Elements, v: View, presses: PanePresses) {
  const { Box, Text } = ui
  const isOpen = v.folds.isLogOpen
  const newest = v.log.at(-1)
  const lines = isOpen
    ? (v.log.length === 0
      ? [<Box key="log-none"><Text dimColor>Nothing yet.</Text></Box>]
      : v.log.map((line, i) => <Box key={`log-${i}`}><Text dimColor>{`${timeOfDay(line.at, v.now)} ${logWords(line)}`}</Text></Box>))
    : [<Box key="log-last"><Text dimColor>{newest === undefined ? 'last: nothing yet' : `last: ${logWords(newest)} ${timeOfDay(newest.at, v.now)}`}</Text></Box>]
  return <Box key="log" flexDirection="column">{heading(ui, 'log-toggle', 'Log', isOpen, presses.log)}{lines}</Box>
}

// The Token details row. Open, it shows the four token kinds for the sub
// sessions together and for this session, then what each sub session shown
// spent, then the count of builder's status messages consumed since
// foreman's hooks loaded.
function tokensRow(ui: Elements, v: View, presses: PanePresses) {
  const { Box, Text } = ui
  const isOpen = v.folds.isTokensOpen
  const lines = isOpen
    ? [
      <Box key="spent-subs"><Text>{`Sub sessions spent: ${spendWords(v.subsSpent)}`}</Text></Box>,
      <Box key="spent-own"><Text>{`This session spent: ${spendWords(v.ownSpent)}`}</Text></Box>,
      ...v.rows.map(row => <Box key={`spent-${row.file}`}><Text dimColor>{`${keyOf(row)} spent: ${spendWords(spendOf(row.record.usage))}`}</Text></Box>),
      v.markers === null ? null : <Box key="markers"><Text>{markersLine(v.markers, v.now)}</Text></Box>,
    ]
    : []
  return <Box key="tokens" flexDirection="column">{heading(ui, 'tokens-toggle', 'Token details', isOpen, presses.tokens)}{lines}</Box>
}

export const NOT_A_PARENT = 'This session is not a parent. Run /start-foreman to make it one.'

// The pane of a parent, top to bottom: the slot lights with the count of
// busy slots and the queue's badge, a card for each busy sub session, a
// compact line for each one that is released or done, the up-next row, the
// three tiles, and the Log and Token details rows, which start folded. Each
// section is drawn on the terminal too, in the same order and with the same
// content, only as text.
export function paneTree(ui: Elements, v: View, presses: PanePresses, columns?: number) {
  const { Box, Text } = ui
  if (!v.isOn) return <Box key="foreman-pane" flexDirection="column"><Text dimColor>{NOT_A_PARENT}</Text></Box>
  const busy = v.rows.filter(isBusy)
  const rest = v.rows.filter(row => !isBusy(row))
  return (
    <Box key="foreman-pane" flexDirection="column" gap={1}>
      {lightsRow(ui, v, busy)}
      {busy.length === 0 ? null : <Box key="cards" flexDirection="column">{busy.map(row => card(ui, v, row, presses, columns))}</Box>}
      {rest.length === 0 ? null : <Box key="not-busy" flexDirection="column">{rest.map(row => quietLine(ui, v, row, presses))}</Box>}
      {upNext(ui, v, presses)}
      {tiles(ui, v)}
      {logRow(ui, v, presses)}
      {tokensRow(ui, v, presses)}
    </Box>
  )
}
