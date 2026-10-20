// The band above the prompt and the pane, drawn from a View. Nothing here
// reads or writes state; hooks/register.tsx builds the View and wires the
// presses.

import type { Elements as EngineElements } from 'claude-code'

import type { ForemanLogLine } from '../types'
import { BAR_SVG_HEIGHT, barSvg, fitBar, hasSvg, svgWidth, type Bar } from './art'
import { STAGES, stageLabel } from './stages'
import {
  busyCount, chipText, fitChips, keyOf, moreWords, SEPARATOR, STATE_LOOK, staleWords, untilWords, type SubRow, type Tone,
} from './subs'
import { printable, timeOfDay } from './text'

export const PANE = 'foreman'

// What the band and the pane draw from, read by the hooks.
export type View = {
  // Whether this session ran /foreman and so is a parent.
  isOn: boolean
  // The slot count in force.
  slots: number
  isPaused: boolean
  // The sub sessions, in issue-key order.
  rows: SubRow[]
  now: number
  // When the next read is due, or null when none is scheduled.
  nextReadAt: number | null
  log: ForemanLogLine[]
}

// The elements the band and the pane draw with, as hooks/register.tsx builds
// them: `Svg` is there only on a surface that draws images.
export type Elements = Pick<EngineElements['terminal'], 'Box' | 'Text' | 'Button'> & { Svg?: EngineElements['desktop']['Svg'] }

// The theme color each tone is drawn in; plain text takes no color.
const TONE_COLOR: Record<Tone, string | undefined> = { red: 'error', amber: 'warning', plain: undefined }

// What the band says about the next read.
export function nextReadWords(v: View): string {
  if (v.nextReadAt === null) return 'no read scheduled'
  const when = untilWords(v.nextReadAt - v.now)
  return when === null ? 'next read due now' : `next read in ${when}`
}

// The start of the band: the slots busy out of the slots allowed, and
// `paused` while paused.
export function bandHead(v: View): string {
  const head = `foreman: ${busyCount(v.rows)} of ${v.slots} slots busy`
  return v.isPaused ? `${head}${SEPARATOR}paused` : head
}

export type BandPresses = { open: (file: string) => void }

// The band, in a parent only: the head, a chip for each sub session that
// fits `width` with `+N more` for the rest, and when the next read is due.
// Each chip is a button that opens its sub session; it is colored by its
// state's tone, or dimmed and uncolored when its file is stale. A released
// sub session has no chip. Null in a session that is not a parent, so the
// host draws what it would without foreman.
export function bandTree(ui: Elements, view: View, width: number | undefined, presses: BandPresses) {
  if (!view.isOn) return null
  const v = { ...view, rows: view.rows.filter(row => row.isReleased !== true) }
  const { Box, Text, Button } = ui
  const head = bandHead(v)
  const tail = `${SEPARATOR}${nextReadWords(v)}`
  if (v.rows.length === 0) {
    return <Box key="foreman-band" flexDirection="row"><Text>{`${head}${SEPARATOR}no sub sessions${tail}`}</Text></Box>
  }
  const chips = v.rows.map(row => chipText(row, v.now))
  const room = width === undefined ? Infinity : width - head.length - tail.length
  const { shown, more } = fitChips(chips, room)
  return (
    <Box key="foreman-band" flexDirection="row">
      <Text>{head}</Text>
      {v.rows.slice(0, shown).flatMap((row, i) => [
        <Text key={`gap-${row.file}`}>{SEPARATOR}</Text>,
        row.isStale
          ? <Button key={`chip-${row.file}`} plain dimColor onPress={() => presses.open(row.file)}><Text dimColor>{chips[i]!}</Text></Button>
          : <Button key={`chip-${row.file}`} plain onPress={() => presses.open(row.file)}><Text color={TONE_COLOR[STATE_LOOK[row.record.state].tone]}>{chips[i]!}</Text></Button>,
      ])}
      {more > 0 && <Text key="more">{`${SEPARATOR}${moreWords(more)}`}</Text>}
      <Text key="next">{tail}</Text>
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

// The state in words with its reason, and how long the file has gone without
// an update when it is stale.
export function stateWords(row: SubRow, now: number): string {
  const parts = [STATE_LOOK[row.record.state].words]
  const reason = printable(row.record.reason, 120)
  if (reason !== '') parts.push(reason)
  if (row.isStale) parts.push(staleWords(row, now))
  return parts.join(SEPARATOR)
}

export type PanePresses = { open: (file: string) => void; nudge: (file: string) => void; release: (file: string) => void }

// The words a released row shows in place of its state.
export const RELEASED = 'released'

// One sub session in the pane: the issue button, the bar, the state, and the
// Nudge and Release buttons. A released one shows `released`, dimmed, in
// place of its state and has no Nudge or Release button; its issue button
// still opens it.
function subTree(ui: Elements, row: SubRow, now: number, columns: number | undefined, presses: PanePresses) {
  const { Box, Text, Button } = ui
  const tone = STATE_LOOK[row.record.state].tone
  if (row.isReleased === true) {
    return [
      <Button key={`open-${row.file}`} variant="primary" label={`→ ${keyOf(row)} · ${pullRequestWords(row)}`} onPress={() => presses.open(row.file)} />,
      barRow(ui, row, columns),
      <Text key={`state-${row.file}`} dimColor>{RELEASED}</Text>,
      <Text key={`gap-${row.file}`}> </Text>,
    ]
  }
  return [
    <Button key={`open-${row.file}`} variant="primary" label={`→ ${keyOf(row)} · ${pullRequestWords(row)}`} onPress={() => presses.open(row.file)} />,
    barRow(ui, row, columns),
    row.isStale
      ? <Text key={`state-${row.file}`} dimColor>{stateWords(row, now)}</Text>
      : <Text key={`state-${row.file}`} color={TONE_COLOR[tone]}>{stateWords(row, now)}</Text>,
    <Box key={`actions-${row.file}`} flexDirection="row">
      <Button key={`nudge-${row.file}`} label="Nudge" onPress={() => presses.nudge(row.file)} />
      <Text> </Text>
      <Button key={`release-${row.file}`} label="Release" onPress={() => presses.release(row.file)} />
    </Box>,
    <Text key={`gap-${row.file}`}> </Text>,
  ]
}

export const NOT_A_PARENT = 'This session is not a parent. Run /foreman to make it one.'
export const NO_SUBS = 'No sub sessions are in the status folder.'

// The pane: one row for each sub session, then the log, newest last, each
// line with its time.
export function paneTree(ui: Elements, v: View, presses: PanePresses, columns?: number) {
  const { Box, Text } = ui
  if (!v.isOn) return <Box key="foreman-pane" flexDirection="column"><Text dimColor>{NOT_A_PARENT}</Text></Box>
  return (
    <Box key="foreman-pane" flexDirection="column">
      {v.rows.length === 0 ? [<Text key="none" dimColor>{NO_SUBS}</Text>, <Text key="none-gap"> </Text>] : null}
      {v.rows.flatMap(row => subTree(ui, row, v.now, columns, presses))}
      <Text key="log-head" bold>Log</Text>
      {v.log.length === 0
        ? <Text key="log-none" dimColor>Nothing yet.</Text>
        : v.log.map((line, i) => <Text key={`log-${i}`} dimColor>{`${timeOfDay(line.at, v.now)} ${line.text}${(line.times ?? 1) > 1 ? ` (${line.times} times)` : ''}`}</Text>)}
    </Box>
  )
}
