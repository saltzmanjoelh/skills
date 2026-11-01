// The band above the prompt and the pane, drawn from a View. Nothing here
// reads or writes state; hooks/register.tsx builds the View and wires the
// presses.

import type { Elements as EngineElements } from 'claude-code'

import type { ForemanLogLine, ForemanSpend } from '../types'
import { BAR_SVG_HEIGHT, barSvg, fitBar, hasSvg, svgWidth, type Bar } from './art'
import { linkOf } from './links'
import { spendOf, spendWords } from './spend'
import { STAGES, stageLabel } from './stages'
import {
  busyCount, chipParts, chipText, fitChips, isProbablyHung, keyOf, moreWords, SEPARATOR, STATE_LOOK, staleWords, untilWords, waitWords, type SubRow,
  type Tone,
} from './subs'
import { printable, timeOfDay } from './text'

export const PANE = 'foreman'

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
  // The newest report sentence foreman showed, while it is less than
  // REPORT_SHOWN_MS old, else null. The band shows it after the chips.
  report: string | null
}

// How long the band shows a report sentence after foreman showed it.
export const REPORT_SHOWN_MS = 10 * 60_000

// The fewest columns a report sentence is drawn in. A band with less room
// left after the chips drops the sentence rather than show a stub of it.
export const REPORT_MIN_COLUMNS = 16

// The most characters of a report sentence the band draws when it is given no
// width.
const REPORT_MAX = 240

// The report the band shows, from the value foreman keeps in $.state: its
// sentence while it is less than REPORT_SHOWN_MS old at `now`, else null. A
// value of any other shape shows nothing.
export function shownReport(raw: unknown, now: number): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { text, at } = raw as { text?: unknown; at?: unknown }
  if (typeof text !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null
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

// The link to a row's issue, or null when there is no address or the row's
// key is not linked. The key is linked only when it is drawn as the record
// holds it, so a key that `printable` cut or cleaned of an escape sequence
// stays plain text.
export function rowLink(row: SubRow, address: string | null): string | null {
  const key = row.record.issueKey
  return keyOf(row) === key ? linkOf(address, key) : null
}

export type BandPresses = { open: (file: string) => void }

// The band, in a parent only: the head, a chip for each sub session that
// fits `width` with `+N more` for the rest, when the next read is due, and
// last the report sentence while there is one, cut to the columns the rest
// left over. The chips are fitted first, exactly as without a report, so they
// never give up width to it, and the report is dropped when fewer than
// REPORT_MIN_COLUMNS columns are left for it.
// Each chip is a button that opens its sub session; it is colored by its
// state's tone, or dimmed and uncolored when its file is stale. A chip whose
// issue has a link draws its key as that link, then a space as its own text,
// then the button holding the rest of the chip. The chips are fitted by their
// whole text either way. A released sub session has no chip. Null in a
// session that is not a parent, so the host draws what it would without
// foreman.
export function bandTree(ui: Elements, view: View, width: number | undefined, presses: BandPresses) {
  if (!view.isOn) return null
  const v = { ...view, rows: view.rows.filter(row => row.isReleased !== true) }
  const { Box, Text, Button, Link } = ui
  const head = bandHead(v)
  const tail = `${SEPARATOR}${nextReadWords(v)}`
  // The report after the rest of the band, which takes `used` columns.
  const report = (used: number) => {
    if (v.report === null) return null
    const room = width === undefined ? REPORT_MAX : width - used - SEPARATOR.length
    if (room < REPORT_MIN_COLUMNS) return null
    return <Text key="report">{`${SEPARATOR}${printable(v.report, room)}`}</Text>
  }
  if (v.rows.length === 0) {
    const line = `${head}${SEPARATOR}no sub sessions${tail}`
    return <Box key="foreman-band" flexDirection="row"><Text>{line}</Text>{report(line.length)}</Box>
  }
  const chips = v.rows.map(row => chipText(row, v.now))
  const room = width === undefined ? Infinity : width - head.length - tail.length
  const { shown, more } = fitChips(chips, room)
  const moreText = more > 0 ? `${SEPARATOR}${moreWords(more)}` : ''
  const used = head.length + chips.slice(0, shown).reduce((sum, chip) => sum + SEPARATOR.length + chip.length, 0) + moreText.length + tail.length
  const chip = (row: SubRow, text: string) => (row.isStale
    ? <Button key={`chip-${row.file}`} plain dimColor onPress={() => presses.open(row.file)}><Text dimColor>{text}</Text></Button>
    : <Button key={`chip-${row.file}`} plain onPress={() => presses.open(row.file)}><Text color={TONE_COLOR[STATE_LOOK[row.record.state].tone]}>{text}</Text></Button>)
  return (
    <Box key="foreman-band" flexDirection="row">
      <Text>{head}</Text>
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

// A row's bar: its issue title, its stage, and its stages done out of nine.
export function barOfRow(row: SubRow): Bar {
  const { issueTitle, stage, stageDone } = row.record
  const total = STAGES.length
  return {
    title: printable(issueTitle, 60),
    label: stage === null ? 'no stage yet' : stageLabel(stage),
    done: stageDone,
    total,
    percent: Math.round((stageDone / total) * 100),
  }
}

// The bar as one row: a drawing on a surface that draws images, else text
// cells fitted to `columns`. The drawing's text alternative is the text row.
function barRow(ui: Elements, row: SubRow, columns: number | undefined) {
  const bar = barOfRow(row)
  if (hasSvg(ui)) {
    const { Svg } = ui
    const width = drawingWidth(columns)
    return <Svg key={`bar-${row.file}`} source={barSvg(bar, width)} alt={fitBar(bar, Infinity)} width={width} height={BAR_SVG_HEIGHT} />
  }
  const { Text } = ui
  return <Text key={`bar-${row.file}`}>{fitBar(bar, columns ?? Infinity)}</Text>
}

// The pull request as the issue button names it.
function pullRequestWords(row: SubRow): string {
  const pr = row.record.pr
  if (pr === null) return 'no pull request yet'
  return `#${pr.number} ${printable(pr.state, 20)} · checks ${printable(pr.checks, 20)}`
}

// The state in words with its reason, then the background task the sub
// session waits on and how long it has run when the record names one, and
// last how long the file has gone without an update when it is stale.
export function stateWords(row: SubRow, now: number): string {
  const parts = [STATE_LOOK[row.record.state].words]
  const reason = printable(row.record.reason, 120)
  if (reason !== '') parts.push(reason)
  const wait = waitWords(row, now)
  if (wait !== null) parts.push(wait)
  if (row.isStale) parts.push(staleWords(row, now))
  return parts.join(SEPARATOR)
}

export type PanePresses = { open: (file: string) => void; nudge: (file: string) => void; release: (file: string) => void }

// The words a released row shows in place of its state.
export const RELEASED = 'released'

// The issue row: the button that opens the sub session, naming its key and
// its pull request. When the issue has a link, the row is the key as that
// link, a space, and the button naming the pull request alone.
function issueRow(ui: Elements, row: SubRow, address: string | null, presses: PanePresses) {
  const { Box, Text, Button, Link } = ui
  const open = () => presses.open(row.file)
  const link = rowLink(row, address)
  if (link === null) return <Button key={`open-${row.file}`} variant="primary" label={`→ ${keyOf(row)} · ${pullRequestWords(row)}`} onPress={open} />
  return (
    <Box key={`issue-${row.file}`} flexDirection="row">
      <Link href={link}>{keyOf(row)}</Link>
      <Text> </Text>
      <Button key={`open-${row.file}`} variant="primary" label={`→ ${pullRequestWords(row)}`} onPress={open} />
    </Box>
  )
}

// What a row's sub session spent, from its status file, dimmed. A file that
// carries no spending shows it as unknown.
function spentRow(ui: Elements, row: SubRow) {
  const { Text } = ui
  return <Text key={`spent-${row.file}`} dimColor>{`Spent: ${spendWords(spendOf(row.record.usage))}`}</Text>
}

// One sub session in the pane: the issue row, the bar, the state, what it
// spent, and the Nudge and Release buttons. A released one shows `released`,
// dimmed, in place of its state and has no Nudge or Release button; its issue
// button still opens it, and it still shows what it spent. The state is
// drawn in its own tone, or in the warning tone once the sub session's oldest
// background task is probably hung, unless its own tone is red, so the mark
// never makes a row look less urgent. A stale state stays dimmed and
// uncolored either way.
function subTree(ui: Elements, row: SubRow, now: number, address: string | null, columns: number | undefined, presses: PanePresses) {
  const { Box, Text, Button } = ui
  const own = STATE_LOOK[row.record.state].tone
  const tone: Tone = own !== 'red' && isProbablyHung(row, now) ? 'amber' : own
  const issue = issueRow(ui, row, address, presses)
  const bar = barRow(ui, row, columns)
  if (row.isReleased === true) {
    return [
      issue,
      bar,
      <Text key={`state-${row.file}`} dimColor>{RELEASED}</Text>,
      spentRow(ui, row),
      <Text key={`gap-${row.file}`}> </Text>,
    ]
  }
  return [
    issue,
    bar,
    row.isStale
      ? <Text key={`state-${row.file}`} dimColor>{stateWords(row, now)}</Text>
      : <Text key={`state-${row.file}`} color={TONE_COLOR[tone]}>{stateWords(row, now)}</Text>,
    spentRow(ui, row),
    <Box key={`actions-${row.file}`} flexDirection="row">
      <Button key={`nudge-${row.file}`} label="Nudge" onPress={() => presses.nudge(row.file)} />
      <Text> </Text>
      <Button key={`release-${row.file}`} label="Release" onPress={() => presses.release(row.file)} />
    </Box>,
    <Text key={`gap-${row.file}`}> </Text>,
  ]
}

export const NOT_A_PARENT = 'This session is not a parent. Run /start-foreman to make it one.'
export const NO_SUBS = 'No sub sessions are in the status folder.'

// The pane: one row for each sub session, then what the sub sessions spent
// together and what this session spent itself, then the log, newest last,
// each line with its time.
export function paneTree(ui: Elements, v: View, presses: PanePresses, columns?: number) {
  const { Box, Text } = ui
  if (!v.isOn) return <Box key="foreman-pane" flexDirection="column"><Text dimColor>{NOT_A_PARENT}</Text></Box>
  return (
    <Box key="foreman-pane" flexDirection="column">
      {v.rows.length === 0 ? [<Text key="none" dimColor>{NO_SUBS}</Text>, <Text key="none-gap"> </Text>] : null}
      {v.rows.flatMap(row => subTree(ui, row, v.now, v.issueLink, columns, presses))}
      <Text key="spent-subs">{`Sub sessions spent: ${spendWords(v.subsSpent)}`}</Text>
      <Text key="spent-own">{`This session spent: ${spendWords(v.ownSpent)}`}</Text>
      <Text key="spent-gap"> </Text>
      <Text key="log-head" bold>Log</Text>
      {v.log.length === 0
        ? <Text key="log-none" dimColor>Nothing yet.</Text>
        : v.log.map((line, i) => <Text key={`log-${i}`} dimColor>{`${timeOfDay(line.at, v.now)} ${line.text}${(line.times ?? 1) > 1 ? ` (${line.times} times)` : ''}`}</Text>)}
    </Box>
  )
}
