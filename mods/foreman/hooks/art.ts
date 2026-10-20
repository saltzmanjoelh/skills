// The bar's drawing and its text form, and the rules that keep text placed in
// a drawing safe. On a surface whose element table has `Svg` (the desktop,
// the mobile app and the editor) the bar is one SVG image, so the desktop app
// cannot wrap its parts onto separate lines; on the terminal it is drawn as
// cells of text.
//
// Everything here is a copy of the same code in builder's hooks/art.ts,
// because a mod cannot import another plugin's files. tests/art.test.ts holds
// each copy to what builder's answers, so change it only together with
// builder's. Text a record supplied is placed only as an element's text,
// escaped by xmlText, and every attribute holds a number or a fixed class
// name, so nothing a record holds can reach an attribute.

import type { ElementConstructor, SvgProps } from 'claude-code'

import { printable } from './text'

// The bar's numbers, in the shape builder's hooks/progress.ts gives them: the
// title, what the label says, the stages done out of the total, and that as a
// whole percentage.
export type Bar = { title: string; label: string; done: number; total: number; percent: number }

// The surfaces whose element table has `Svg`: every remote surface. The
// engine completes every surface's table with every element name, drawing a
// name the surface lacks as nothing, so the table the engine hands out names
// `Svg` on the terminal too; the surface's name is what tells them apart.
const SVG_SURFACES: ReadonlySet<string> = new Set(['desktop', 'mobile', 'vscode'])

export function isSvgSurface(surface: unknown): boolean {
  return typeof surface === 'string' && SVG_SURFACES.has(surface)
}

// Whether a table of elements draws images: it has `Svg`. The mod builds the
// tables it draws with so that only a surface isSvgSurface names has `Svg`
// (see elementsOf in hooks/register.tsx), and every choice between a drawing
// and text rows asks this, and nothing else.
export function hasSvg<T extends object>(ui: T): ui is T & { Svg: ElementConstructor<SvgProps> } {
  return 'Svg' in ui && typeof (ui as { Svg?: unknown }).Svg === 'function'
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
// Characters XML never allows in text: half of a surrogate pair on its own,
// and U+FFFE and U+FFFF. printable has already removed the control characters.
const NOT_XML = /^(?:[\ud800-\udfff]|￾|￿)$/

// Text made safe to place in a drawing: cleaned as printable cleans it, with
// the characters XML never allows dropped, cut to `max` whole characters
// (ending with `…` when it was cut, so a pair of surrogates is never split),
// and escaped for XML.
export function xmlText(text: string, max: number): string {
  const chars = Array.from(printable(text, Infinity)).filter(ch => !NOT_XML.test(ch))
  const kept = chars.length > max ? [...chars.slice(0, Math.max(max - 1, 0)), '…'] : chars
  return kept.join('').replace(/[&<>"']/g, ch => ENTITIES[ch]!)
}

// How much of a whole, from 0 to 1, with anything out of range held inside it.
function share(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) return 0
  return Math.min(Math.max(done / total, 0), 1)
}

// The terminal's bar: `cells` cells, filled for the share of stages done and
// empty for the rest.
export function barCells(done: number, total: number, cells: number): string {
  const count = Number.isFinite(cells) ? Math.max(Math.floor(cells), 0) : 0
  const filled = Math.round(share(done, total) * count)
  return '█'.repeat(filled) + '░'.repeat(count - filled)
}

// How many cells the terminal bar row draws its bar in.
export const BAR_CELLS = 10

// The terminal's bar row, fitted to `columns` cells when that is a number:
// the title is dropped first, then the stage, then the percentage, and only
// then is the row cut with `…`.
export function fitBar(bar: Bar, columns: number): string {
  const count = `${barCells(bar.done, bar.total, BAR_CELLS)} ${bar.done} of ${bar.total}`
  const percent = `${bar.percent}%`
  const title = bar.title === '' ? [] : [bar.title]
  const rows = [
    [...title, bar.label, count, percent],
    [bar.label, count, percent],
    [count, percent],
    [count],
  ].map(parts => parts.join(' · '))
  if (typeof columns !== 'number' || !Number.isFinite(columns)) return rows[0]!
  const fitting = rows.find(text => text.length <= columns)
  if (fitting !== undefined) return fitting
  const shortest = rows.at(-1)!
  return `${shortest.slice(0, Math.max(columns - 1, 0))}…`
}

// The width a drawing is drawn at, in CSS pixels: the width asked for, made a
// whole number and held between a narrow and a very wide band, or a middling
// width when the width asked for is not a number. pane.tsx passes the same
// width to `Svg`, so the image and its box agree.
export const MIN_SVG_WIDTH = 160
export const MAX_SVG_WIDTH = 4000
const DEFAULT_SVG_WIDTH = 600
export function svgWidth(px: number): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) return DEFAULT_SVG_WIDTH
  return Math.min(Math.max(Math.round(px), MIN_SVG_WIDTH), MAX_SVG_WIDTH)
}

// The height of the bar's drawing, in CSS pixels, for pane.tsx to pass to `Svg`.
export const BAR_SVG_HEIGHT = 34

// About how wide one character of the drawings' 12-pixel text is, which
// decides how many characters a piece of text is cut to.
const CHAR_PX = 7
const charsIn = (px: number) => Math.max(Math.floor(px / CHAR_PX), 0)
// How many characters `text` has, counting a pair of surrogates as one. It
// counts the text as given and does not clean it, because xmlText alone
// cleans and escapes what is placed in a drawing. The text it measures is
// already clean: the bar's count is numbers and its label is a stage's words.
// Text that was not cleaned can only count longer than it draws, which leaves
// less room beside it and never lets text overflow.
const lengthOf = (text: string) => Array.from(text).length

// The class names the drawings use: t is ordinary text, m muted text, b bold,
// e text anchored at its end, k the bar's empty track and f the bar's fill.
// The style block is builder's whole, with the classes of builder's agent
// rows that foreman does not draw, so that the bar's drawing is the same text
// as builder's.
const STYLE = [
  '<style>',
  'text{font:12px ui-sans-serif,system-ui,-apple-system,sans-serif}',
  '.t{fill:#1f1e1d}.m{fill:#73726c}.b{font-weight:600}.e{text-anchor:end}',
  '.k{fill:#e8e6dc}.f{fill:#d97757}.ok{fill:#5f8a4c}.bad{fill:#c0453a}.o{fill:none;stroke:#73726c;stroke-width:1.5}',
  '@media (prefers-color-scheme: dark){',
  '.t{fill:#ecebe8}.m{fill:#a3a29c}.k{fill:#3a3936}.f{fill:#e08a6c}.ok{fill:#7fae6a}.bad{fill:#e06c5f}.o{stroke:#a3a29c}',
  '}',
  '</style>',
].join('')

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${body}</svg>`
}

// The bar: the title in bold and the label on the left, the stages done out
// of the total and the percentage on the right, and under them a track filled
// for the share done. The label keeps its room before the title does.
export function barSvg(bar: Bar, widthPx: number): string {
  const width = svgWidth(widthPx)
  const count = `${bar.done} of ${bar.total} · ${bar.percent}%`
  const room = charsIn(width - lengthOf(count) * CHAR_PX - 16)
  const labelChars = Math.min(lengthOf(bar.label), room)
  const titleChars = room - labelChars - 3
  const label = xmlText(bar.label, Math.max(labelChars, 1))
  const left = bar.title === '' || titleChars < 4
    ? `<tspan class="t">${label}</tspan>`
    : `<tspan class="t b">${xmlText(bar.title, titleChars)}</tspan><tspan class="m"> · </tspan><tspan class="t">${label}</tspan>`
  const fill = Math.round(width * share(bar.done, bar.total))
  return svg(width, BAR_SVG_HEIGHT, [
    `<text x="0" y="14">${left}</text>`,
    `<text class="m e" x="${width}" y="14">${xmlText(count, 40)}</text>`,
    `<rect class="k" x="0" y="22" width="${width}" height="6" rx="3"/>`,
    `<rect class="f" x="0" y="22" width="${fill}" height="6" rx="3"/>`,
  ].join(''))
}

