// The pane's two drawings, the slot lights and a card's stage bar, with their
// text forms, and the rules of the pane's fold states. Every function is pure,
// so the tests can check each rule without the engine.
//
// Neither drawing holds any text: the lights are circles and the stage bar is
// rectangles, so no text a record supplied can reach a drawing. Every
// attribute holds a number, the SVG namespace or a fixed class name. The words
// beside the drawings are ordinary elements that hooks/pane.tsx draws. These
// drawings are foreman's own; hooks/art.ts holds the copy of builder's bar,
// which this module leaves alone.

import type { ForemanFolds } from '../types'
import type { BuildState } from './record'
import { STAGES } from './stages'
import type { SubRow } from './subs'

// The color of one slot light.
export type Light = 'green' | 'red' | 'amber' | 'muted'

// Every state's light. It is typed over every state, so a state added to the
// record fails the type check until it has an entry here. A done sub session
// takes no slot and so draws no light; its entry is there only to complete
// the table.
export const LIGHT_OF: Record<BuildState, Light> = {
  'working': 'green',
  'waiting-on-builder': 'green',
  'idle': 'amber',
  'needs-you': 'red',
  'in-cleanup': 'amber',
  'done': 'muted',
}

// A busy sub session's light: its state's, or muted while its file is stale.
export const lightOf = (row: SubRow): Light => (row.isStale ? 'muted' : LIGHT_OF[row.record.state])

// The slot lights: one for each busy sub session, in the order of the cards,
// and how many slots no busy sub session takes, which is none when more sub
// sessions are busy than there are slots.
export type Lights = { lights: Light[]; free: number }

export function lightsOf(busy: readonly SubRow[], slots: number): Lights {
  return { lights: busy.map(lightOf), free: Math.max(slots - busy.length, 0) }
}

// The characters the terminal draws a busy and a free slot with.
export const BUSY_CHAR = '●'
export const FREE_CHAR = '○'

// The lights as text: one character for each slot, which is also the
// drawing's text alternative.
export const lightsText = (l: Lights) => BUSY_CHAR.repeat(l.lights.length) + FREE_CHAR.repeat(l.free)

// The drawings' class names: lg, lr, la and lm fill a light green, red, amber
// or muted, lf draws a free slot as a dashed ring; sd fills a stage done, sc
// highlights the current stage, sn highlights it in red, and se is a stage
// not reached.
const STYLE = [
  '<style>',
  '.lg{fill:#5f8a4c}.lr{fill:#c0453a}.la{fill:#c98a1b}.lm{fill:#b8b6ae}.lf{fill:none;stroke:#73726c;stroke-width:1.5;stroke-dasharray:3 2}',
  '.sd{fill:#d97757}.sc{fill:#3d6fb6}.sn{fill:#c0453a}.se{fill:#e8e6dc}',
  '@media (prefers-color-scheme: dark){',
  '.lg{fill:#7fae6a}.lr{fill:#e06c5f}.la{fill:#e0a64a}.lm{fill:#5a5955}.lf{stroke:#a3a29c}',
  '.sd{fill:#e08a6c}.sc{fill:#6e9be0}.sn{fill:#e06c5f}.se{fill:#3a3936}',
  '}',
  '</style>',
].join('')

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${body}</svg>`
}

const LIGHT_CLASS: Record<Light, string> = { green: 'lg', red: 'lr', amber: 'la', muted: 'lm' }

// How far apart the lights are, and the drawing's height, in CSS pixels.
export const LIGHT_PX = 18
export const LIGHTS_SVG_HEIGHT = 18

// The width of the lights' drawing, in CSS pixels: one step for each slot it
// draws, and never less than one step.
export const lightsWidth = (l: Lights) => Math.max(l.lights.length + l.free, 1) * LIGHT_PX

// The lights' drawing: a filled circle for each busy slot, then a dashed ring
// for each free one.
export function lightsSvg(l: Lights): string {
  const radius = LIGHT_PX / 2 - 3
  const at = (i: number) => i * LIGHT_PX + LIGHT_PX / 2
  const busy = l.lights.map((light, i) => `<circle class="${LIGHT_CLASS[light]}" cx="${at(i)}" cy="${LIGHTS_SVG_HEIGHT / 2}" r="${radius}"/>`)
  const free = Array.from({ length: l.free }, (_, i) => `<circle class="lf" cx="${at(l.lights.length + i)}" cy="${LIGHTS_SVG_HEIGHT / 2}" r="${radius}"/>`)
  return svg(lightsWidth(l), LIGHTS_SVG_HEIGHT, [...busy, ...free].join(''))
}

// A card's stage bar: how many of the nine stages are done, which one is
// current, or null when the sub session has reported none yet, and whether
// the current one is drawn in red because the sub session needs the person.
// A sub session with no stage yet has nothing filled.
export type StageBar = { done: number; current: number | null; isRed: boolean }

export function stageBarOf(row: SubRow): StageBar {
  const { stage, stageDone, state } = row.record
  if (stage === null) return { done: 0, current: null, isRed: false }
  const done = Number.isFinite(stageDone) ? Math.min(Math.max(Math.floor(stageDone), 0), STAGES.length) : 0
  return { done, current: STAGES.findIndex(s => s.id === stage), isRed: state === 'needs-you' }
}

// What each of the nine segments is: done, current, or not reached. The
// current stage is drawn as current even when the count of stages done
// reaches past it.
export type Segment = 'done' | 'current' | 'empty'

export function segmentsOf(bar: StageBar): Segment[] {
  return STAGES.map((_, i) => (i === bar.current ? 'current' : i < bar.done ? 'done' : 'empty'))
}

// The characters the terminal draws each kind of segment with.
export const SEGMENT_CHAR: Record<Segment, string> = { done: '█', current: '▓', empty: '░' }

// The bar as text, which is also the drawing's text alternative: a cell for
// each stage, then how many are done out of nine.
export const stagesText = (bar: StageBar) => `${segmentsOf(bar).map(s => SEGMENT_CHAR[s]).join('')} ${bar.done} of ${STAGES.length}`

// The height of the stage bar's drawing, in CSS pixels, and the gap between
// its segments.
export const STAGES_SVG_HEIGHT = 8
const SEGMENT_GAP = 3

// The stage bar's drawing, `width` CSS pixels wide: nine rectangles side by
// side, each filled for its kind.
export function stagesSvg(bar: StageBar, width: number): string {
  const count = STAGES.length
  const each = Math.max((width - SEGMENT_GAP * (count - 1)) / count, 1)
  const rects = segmentsOf(bar).map((segment, i) => {
    const kind = segment === 'current' ? (bar.isRed ? 'sn' : 'sc') : segment === 'done' ? 'sd' : 'se'
    return `<rect class="${kind}" x="${Math.round(i * (each + SEGMENT_GAP))}" y="0" width="${Math.round(each)}" height="${STAGES_SVG_HEIGHT}" rx="2"/>`
  })
  return svg(width, STAGES_SVG_HEIGHT, rects.join(''))
}

// Every row folded, as a restart leaves them.
export const FOLDS_CLOSED: ForemanFolds = { isLogOpen: false, isTokensOpen: false, openMenus: [] }

// The fold states from the value foreman keeps in $.state. A flag is open
// only when it is exactly true, and the open menus keep only names that are
// text, so a value an older build left in another shape reads as folded.
export function foldsIn(raw: unknown): ForemanFolds {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return FOLDS_CLOSED
  const r = raw as Record<string, unknown>
  const openMenus = Array.isArray(r.openMenus) ? r.openMenus.filter((file): file is string => typeof file === 'string') : []
  return { isLogOpen: r.isLogOpen === true, isTokensOpen: r.isTokensOpen === true, openMenus }
}

// The folds after a press of the `⋯` button of the card for `file`, which
// asks for its row to be `isOpen`. A press sets the state rather than toggle
// it, so a press handled twice, or one from an older drawing, cannot undo a
// newer one. A press for a file that has no busy card, as one that arrives
// after its card went away, changes nothing. A press that changes nothing
// gives back the very folds it was handed.
export function menuPressed(f: ForemanFolds, file: string, isOpen: boolean, busyFiles: readonly string[]): ForemanFolds {
  if (!busyFiles.includes(file)) return f
  const has = f.openMenus.includes(file)
  if (has === isOpen) return f
  return { ...f, openMenus: isOpen ? [...f.openMenus, file] : f.openMenus.filter(name => name !== file) }
}

// The folds with every open menu dropped whose file no longer has a busy card,
// so a card that comes back starts folded. When nothing is dropped it gives
// back the very folds it was handed, so the caller writes nothing.
export function prunedMenus(f: ForemanFolds, busyFiles: readonly string[]): ForemanFolds {
  const kept = f.openMenus.filter(file => busyFiles.includes(file))
  return kept.length === f.openMenus.length ? f : { ...f, openMenus: kept }
}
