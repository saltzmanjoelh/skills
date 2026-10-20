import { expect, test } from 'claude-code/testing'

import { barCells, barSvg, BAR_SVG_HEIGHT, fitBar, hasSvg, isSvgSurface, svgWidth, xmlText, type Bar } from '../hooks/art'
import { STAGES, stageLabel, type StageId } from '../hooks/stages'
import { printable, timeOfDay } from '../hooks/text'
import { BUILDER_DRAWN, BUILDER_STAGE_IDS } from './builder-drawn'

// Foreman copies builder's drawing code, because a mod cannot import another
// plugin's files. These tests hold each copy to what builder's own function
// answered for the same input, as tests/builder-drawn.ts wrote it down.

// Each copied function, by the name the fixture gives it.
const COPIES: Record<string, (...args: never[]) => unknown> = {
  printable: printable as (...args: never[]) => unknown,
  timeOfDay: timeOfDay as (...args: never[]) => unknown,
  isSvgSurface: isSvgSurface as (...args: never[]) => unknown,
  xmlText: xmlText as (...args: never[]) => unknown,
  barCells: barCells as (...args: never[]) => unknown,
  svgWidth: svgWidth as (...args: never[]) => unknown,
  fitBar: fitBar as (...args: never[]) => unknown,
  barSvg: barSvg as (...args: never[]) => unknown,
  stageLabel: stageLabel as (...args: never[]) => unknown,
}

test('every copied function answers what builder\'s answered for the same input', () => {
  const named = new Set(BUILDER_DRAWN.map(drawn => drawn.fn))
  expect([...named].sort()).toEqual(Object.keys(COPIES).sort())
  for (const drawn of BUILDER_DRAWN) {
    const copy = COPIES[drawn.fn]!
    expect(copy(...(drawn.args as never[])), `${drawn.fn}(${JSON.stringify(drawn.args)})`).toEqual(drawn.out)
  }
})

test('the bar drawing is as tall as builder\'s, and only a function tells a table that draws images', () => {
  expect(BAR_SVG_HEIGHT).toBe(34)
  expect(hasSvg({ Svg: () => null })).toBe(true)
  expect(hasSvg({})).toBe(false)
  expect(hasSvg({ Svg: 'not a function' })).toBe(false)
})

test('the nine stages are builder\'s, in builder\'s order', () => {
  expect(STAGES.map(stage => stage.id)).toEqual([...BUILDER_STAGE_IDS])
  const ids: readonly StageId[] = BUILDER_STAGE_IDS
  expect(ids).toHaveLength(9)
})

test('the bar a stage draws counts the stages before it out of nine', () => {
  const bar: Bar = { title: '', label: stageLabel('plan'), done: 3, total: 9, percent: 33 }
  expect(fitBar(bar, Infinity)).toBe('plan tournament · ███░░░░░░░ 3 of 9 · 33%')
})
