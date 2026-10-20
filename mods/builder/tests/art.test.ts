import { expect, test } from 'claude-code/testing'

import { agentSvg, barCells, barSvg, fitBar, hasSvg, isSvgSurface, plannedSvg, xmlText, type AgentRow } from '../hooks/art'
import type { Bar } from '../hooks/progress'

const NOW = 1_000_000
const MARKUP = `a<&>"b'c`
const ESCAPED = 'a&lt;&amp;&gt;&quot;b&apos;c'

const bar = (over: Partial<Bar> = {}): Bar => ({ title: 'ABC-123 builder progress', label: 'spec', done: 2, total: 9, percent: 22, ...over })

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    type: 'security-reviewer', description: 'review the diff', model: 'Opus 5.5', status: 'running', time: '1m 7s', isRunning: true, ...over,
  }
}

// Every attribute in a drawing, as name and value.
const attributesOf = (svg: string) => [...svg.matchAll(/([A-Za-z][\w:-]*)="([^"]*)"/g)].map(([, name, value]) => ({ name: name!, value: value! }))

// A drawing is one svg element with its size given in numbers, whose
// attributes, other than its namespace and the class names, hold only
// numbers, and whose colours change with the dark scheme.
function expectOneDrawing(svg: string, width: number) {
  expect(svg.startsWith('<svg ')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg.match(/<svg/g)?.length).toBe(1)
  const top = attributesOf(svg.slice(0, svg.indexOf('>')))
  expect(top.find(a => a.name === 'width')?.value).toBe(String(width))
  expect(top.find(a => a.name === 'height')?.value).toMatch(/^\d+$/)
  expect(top.find(a => a.name === 'viewBox')?.value).toMatch(new RegExp(`^0 0 ${width} \\d+$`))
  for (const { name, value } of attributesOf(svg)) {
    if (name === 'xmlns') expect(value).toBe('http://www.w3.org/2000/svg')
    else if (name === 'class') expect(value).toMatch(/^[a-z]+( [a-z]+)*$/)
    else expect(value).toMatch(/^-?\d+(\.\d+)?( -?\d+(\.\d+)?)*$/)
  }
  expect(svg).toContain('@media (prefers-color-scheme: dark)')
}

test('text placed in a drawing is cleaned, cut by whole characters, and escaped for XML', () => {
  expect(xmlText(MARKUP, 80)).toBe(ESCAPED)
  expect(xmlText('\u001b[31mred\u001b[0m\nline', 80)).toBe('red line')
  expect(xmlText('😀😀😀😀😀', 3)).toBe('😀😀…')
  expect(xmlText('ab', 3)).toBe('ab')
  // A lone half of a surrogate pair, and the two characters XML never allows, are dropped.
  expect(xmlText('\ud800x\udc00y', 80)).toBe('xy')
  expect(xmlText('￾ok￿', 80)).toBe('ok')
  expect(xmlText(undefined as unknown as string, 80)).toBe('')
})

test('the terminal bar is filled cells for the stages done and empty cells for the rest', () => {
  expect(barCells(2, 9, 9)).toBe('██░░░░░░░')
  expect(barCells(9, 9, 4)).toBe('████')
  expect(barCells(0, 9, 4)).toBe('░░░░')
  expect(barCells(5, 10, 10)).toBe('█████░░░░░')
  // Numbers out of range are held inside the bar.
  expect(barCells(12, 9, 4)).toBe('████')
  expect(barCells(-1, 9, 4)).toBe('░░░░')
  expect(barCells(3, 0, 4)).toBe('░░░░')
  expect(barCells(3, 9, 0)).toBe('')
})

test('the bar drawing carries the title, the label, the count and the percentage, escaped', () => {
  const svg = barSvg(bar({ title: MARKUP, label: 'review rounds · round 2' }), 600)
  expectOneDrawing(svg, 600)
  expect(svg).toContain(ESCAPED)
  expect(svg).not.toContain(MARKUP)
  expect(svg).toContain('review rounds · round 2')
  expect(svg).toContain('2 of 9')
  expect(svg).toContain('22%')
})

test('the bar drawing fills its track in proportion to the stages done', () => {
  const fillOf = (svg: string) => Number(/<rect class="f" [^>]*width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0)
  const trackOf = (svg: string) => Number(/<rect class="k" [^>]*width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1])
  const half = barSvg(bar({ done: 9, total: 18, percent: 50 }), 600)
  expect(Math.abs(fillOf(half) - trackOf(half) / 2)).toBeLessThanOrEqual(1)
  const full = barSvg(bar({ done: 9, total: 9, percent: 100, label: 'merged' }), 600)
  expect(fillOf(full)).toBe(trackOf(full))
  expect(fillOf(barSvg(bar({ done: 0, percent: 0 }), 600))).toBe(0)
})

test('a width that is not a sound number still gives a drawing with numbers for its size', () => {
  for (const width of [Number.NaN, -5, 10, 1e9]) {
    const svg = barSvg(bar(), width)
    const drawn = Number(/width="(\d+)"/.exec(svg)?.[1])
    expect(Number.isFinite(drawn)).toBe(true)
    expectOneDrawing(svg, drawn)
  }
})

test('an agent row shows its type, description, model, status, time and summary, escaped', () => {
  const svg = agentSvg(row({ description: MARKUP, summary: 'VERDICT: APPROVE <x>', status: 'completed', isRunning: false }), NOW, 700)
  expectOneDrawing(svg, 700)
  for (const text of ['security-reviewer', ESCAPED, 'Opus 5.5', 'completed', '1m 7s', 'VERDICT: APPROVE &lt;x&gt;']) expect(svg).toContain(text)
  expect(svg).not.toContain(MARKUP)
})

test('a running agent row has a mark that alternates each second, and a finished row does not change with the clock', () => {
  const running = row()
  expect(agentSvg(running, 4_000, 700)).not.toBe(agentSvg(running, 5_000, 700))
  expect(agentSvg(running, 4_000, 700)).toBe(agentSvg(running, 4_999, 700))
  expect(agentSvg(running, 4_000, 700)).toBe(agentSvg(running, 6_000, 700))
  const finished = row({ status: 'completed', isRunning: false })
  expect(agentSvg(finished, 4_000, 700)).toBe(agentSvg(finished, 5_000, 700))
})

test('a finished agent row\'s mark is ok when it completed, bad when it failed or was killed, and muted otherwise', () => {
  const markOf = (status: string) => /<circle class="([a-z]+)"/.exec(agentSvg(row({ status, isRunning: false }), NOW, 700))?.[1]
  expect(markOf('completed')).toBe('ok')
  expect(markOf('failed')).toBe('bad')
  expect(markOf('killed')).toBe('bad')
  expect(markOf('stopped')).toBe('m')
  expect(markOf('no longer listed')).toBe('m')
  expect(markOf('')).toBe('m')
})

test('a planned row shows its type and planned, escaped', () => {
  const svg = plannedSvg(MARKUP, 500)
  expectOneDrawing(svg, 500)
  expect(svg).toContain(ESCAPED)
  expect(svg).toContain('planned')
  expect(svg).not.toContain(MARKUP)
})

test('a row drops the builder prefix from its type, and a type an older build stored as something other than text draws as none', () => {
  expect(agentSvg(row({ type: 'builder:spec-reviewer' }), NOW, 700)).toContain('>spec-reviewer<')
  expect(plannedSvg('builder:data-reviewer', 500)).toContain('>data-reviewer<')
  expectOneDrawing(agentSvg(row({ type: 7 as never }), NOW, 700), 700)
  expectOneDrawing(plannedSvg(null as never, 500), 500)
})

test('the terminal bar row drops the title, then the stage, then the percentage, and only then is cut', () => {
  const b = bar()
  const full = fitBar(b, 200)
  expect(full).toBe(`ABC-123 builder progress · spec · ${barCells(2, 9, 10)} 2 of 9 · 22%`)
  expect(fitBar(b, Number.NaN)).toBe(full)
  expect(fitBar(b, full.length)).toBe(full)
  const noTitle = `spec · ${barCells(2, 9, 10)} 2 of 9 · 22%`
  expect(fitBar(b, full.length - 1)).toBe(noTitle)
  const noStage = `${barCells(2, 9, 10)} 2 of 9 · 22%`
  expect(fitBar(b, noTitle.length - 1)).toBe(noStage)
  const noPercent = `${barCells(2, 9, 10)} 2 of 9`
  expect(fitBar(b, noStage.length - 1)).toBe(noPercent)
  expect(fitBar(b, 8)).toBe(`${noPercent.slice(0, 7)}…`)
  // With no title, the row starts at the stage.
  expect(fitBar(bar({ title: '' }), 200)).toBe(noTitle)
})

test('a surface draws images only when its element table has Svg', () => {
  const draw = () => ({}) as never
  expect(hasSvg({ Box: draw, Text: draw, Svg: draw })).toBe(true)
  expect(hasSvg({ Box: draw, Text: draw })).toBe(false)
})

test('the remote surfaces draw images and the terminal does not, whatever its table names', () => {
  expect(['desktop', 'mobile', 'vscode'].map(isSvgSurface)).toEqual([true, true, true])
  expect(isSvgSurface('terminal')).toBe(false)
  expect(isSvgSurface(undefined)).toBe(false)
})
