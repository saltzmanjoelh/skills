import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { FOLDS_CLOSED, foldsIn, menuPressed, prunedMenus, rowPressed } from '../hooks/glance'
import { mergedOf } from '../hooks/spend'
import { newPairing, ticketsKey, TICKETS_EMPTY } from '../hooks/tickets'
import type { ForemanSpent, ForemanTiming } from '../types'
import { builderUsage, foreman, held, leftInState, MINUTE, mountBoth, record, SECOND, SURFACES, start, T0, world } from './world'

// Foreman's pane at a glance: the slot lights, a card for each busy sub
// session, a compact line for each one that is not busy, the up-next row, the
// three tiles, and the Log and Token details rows, which start folded.

type Ui = Awaited<ReturnType<typeof mountBoth>>

// What a sub session spent, as builder writes it in its status file.
const USAGE = { models: [{ model: 'model-a', input: 4000, output: 1000, cacheRead: 90_000, cacheWrite: 2000 }], usd: 1.75 }

// How long a sub session's issue has taken, as builder writes it, with the
// pull request merged at `mergedAt`, or not merged when that is null.
const timing = (mergedAt: number | null, working = 10 * MINUTE): ForemanTiming => ({
  startedAt: T0, stages: [{ stage: 'spec', at: T0 }], prOpenedAt: null, prMergedAt: mergedAt,
  states: { 'working': working, 'waiting-on-builder': MINUTE, 'idle': 2 * MINUTE, 'needs-you': 5 * MINUTE, 'in-cleanup': 0, 'done': 0 },
  rounds: [], olderRounds: 0,
})

// A parent with `slots` slots, the `pairings` in its ledger and the status
// files `files`, each paired with it. The desktop app lists every session a
// file names, as running, so no read takes one for a session that ended.
async function parent($: Engine, on: On, slots: number, files: Record<string, string | [string, number]>, surface: 'terminal' | 'desktop' = 'terminal', pairings: ReturnType<typeof newPairing>[] = []) {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, pairings } } })
  for (const [name, file] of Object.entries(files)) {
    const [text, mtime] = typeof file === 'string' ? [file, T0] : file
    w.folder.put(name, text, mtime)
    const { desktopSessionId, issueKey } = JSON.parse(text) as { desktopSessionId?: string; issueKey: string }
    if (desktopSessionId !== undefined) w.desktop.sessions.push({ sessionId: desktopSessionId, cwd: '/w', title: `${issueKey}: short`, isRunning: true })
  }
  w.desktop.sessions.push(...pairings.flatMap(p => (p.localId === null ? [] : [{ sessionId: p.localId, cwd: '/w', title: `${p.issueKey}: short`, isRunning: false }])))
  const ui = await mountBoth($, on, surface)
  await start($)
  await foreman($)
  await w.clock.settle()
  return { w, ui }
}

const busy = (key: string, state = 'working', over: Record<string, unknown> = {}) => record(key, state, { desktopSessionId: `local_${key}`, ...over })

// The lines of the pane that begin with a time of day, as the open log draws
// them.
const timedLines = async (ui: Ui) => {
  await ui.pane.redraw()
  return (await ui.pane.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d / })).map(line => line.text)
}

const tokenLines = async (ui: Ui) => {
  await ui.pane.redraw()
  return (await ui.pane.findAll({ type: 'Text', text: / spent: / })).map(line => line.text)
}

test('on a fresh mount the Log and Token details rows are folded, the last line is the newest log line, and each heading opens and folds its row', async ($, on) => {
  const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1', 'working', { usage: USAGE }) })
  await ui.pane.press({ key: 'open-a.json' })
  await ui.pane.press({ key: 'open-a.json' })
  expect(await timedLines(ui)).toEqual([])
  expect((await ui.pane.find({ key: 'log-last' }))?.text).toBe('last: Opened ABC-1 beside this session. (2 times) 12:00:00')
  expect(await tokenLines(ui)).toEqual([])

  await ui.pane.press({ key: 'log-toggle' })
  const open = await timedLines(ui)
  expect(open.at(-1)).toBe('12:00:00 Opened ABC-1 beside this session. (2 times)')
  expect(await ui.pane.find({ key: 'log-last' })).toBeUndefined()
  await ui.pane.press({ key: 'log-toggle' })
  expect(await timedLines(ui)).toEqual([])
  expect(await ui.pane.find({ key: 'log-last' })).toBeDefined()

  await ui.pane.press({ key: 'tokens-toggle' })
  const tokens = await tokenLines(ui)
  expect(tokens).toContain('Sub sessions spent: 4K in, 1K out, 90K cache read, 2K cache write · $1.75')
  expect(tokens).toContain('This session spent: unknown')
  expect(tokens).toContain('ABC-1 spent: 4K in, 1K out, 90K cache read, 2K cache write · $1.75')
  await ui.pane.press({ key: 'tokens-toggle' })
  expect(await tokenLines(ui)).toEqual([])
})

test('the last line never begins with a time of day, and reads nothing yet on an empty log', async ($, on) => {
  world(on)
  leftInState(on, { parent: { isOn: true, slots: null }, log: [] })
  const ui = await mountBoth($, on)
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'log-last' }))?.text).toBe('last: nothing yet')
})

test('the folds survive a second mount on the same state, a value left in state draws as it says, and a damaged value draws folded', async ($, on) => {
  const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1') })
  await ui.pane.press({ key: 'open-a.json' })
  await ui.pane.press({ key: 'log-toggle' })
  await ui.pane.press({ key: 'tokens-toggle' })
  await ui.pane.press({ key: 'menu-a.json' })
  await ui.pane.unmount()
  const again = await $.ui.mount({ plugin: 'foreman', surface: 'terminal', component: 'Pane', requestId: 'foreman', props: { bodyColumns: 200 } as never })
  expect(await again.find({ key: 'log-last' })).toBeUndefined()
  expect((await again.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d / })).length).toBeGreaterThan(0)
  expect(await again.find({ type: 'Text', text: /^Sub sessions spent: / })).toBeDefined()
  expect(await again.find({ key: 'nudge-a.json' })).toBeDefined()
})

for (const [what, folds, isOpen] of [
  ['a value left in state with both rows open', { isLogOpen: true, isTokensOpen: true, openMenus: [] }, true],
  ['a value that is not an object', 'open', false],
  ['a value whose fields have the wrong shape', { isLogOpen: 'yes', isTokensOpen: 1, openMenus: 'a.json' }, false],
] as const) {
  test(`after a reload, ${what} draws ${isOpen ? 'open' : 'folded'}`, async ($, on) => {
    world(on)
    leftInState(on, { parent: { isOn: true, slots: null }, folds, log: [{ at: T0, text: 'A line.' }] })
    const ui = await mountBoth($, on)
    await ui.pane.redraw()
    expect(await ui.pane.find({ key: 'log-last' }) === undefined).toBe(isOpen)
    expect(await ui.pane.find({ type: 'Text', text: /^Sub sessions spent: / }) !== undefined).toBe(isOpen)
  })
}

test('Nudge and Release are hidden until the card\'s menu button is pressed, and hidden again by a second press', async ($, on) => {
  const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1', 'idle'), 'b.json': busy('ABC-2') })
  for (const key of ['nudge-a.json', 'release-a.json', 'nudge-b.json', 'release-b.json']) expect(await ui.pane.find({ key })).toBeUndefined()
  expect((await ui.pane.find({ key: 'menu-a.json' }))?.text).toBe('⋯')
  await ui.pane.press({ key: 'menu-a.json' })
  expect(await ui.pane.find({ key: 'nudge-a.json' })).toBeDefined()
  expect(await ui.pane.find({ key: 'release-a.json' })).toBeDefined()
  expect(await ui.pane.find({ key: 'nudge-b.json' })).toBeUndefined()
  await ui.pane.press({ key: 'menu-a.json' })
  expect(await ui.pane.find({ key: 'nudge-a.json' })).toBeUndefined()
  expect(await ui.pane.find({ key: 'release-a.json' })).toBeUndefined()
})

test('a card that stops being busy with its menu open drops the menu, so it is folded when the card comes back', async ($, on) => {
  const { w, ui } = await parent($, on, 2, { 'a.json': busy('ABC-1') })
  await ui.pane.press({ key: 'menu-a.json' })
  expect(await ui.pane.find({ key: 'nudge-a.json' })).toBeDefined()
  w.folder.put('a.json', busy('ABC-1', 'done'), T0 + 30 * SECOND, false)
  await w.clock.advance(30 * SECOND)
  await w.clock.settle()
  await ui.pane.redraw()
  expect(await ui.pane.find({ key: 'menu-a.json' })).toBeUndefined()
  w.folder.put('a.json', busy('ABC-1'), T0 + 2 * MINUTE + 30 * SECOND, false)
  await w.clock.advance(2 * MINUTE)
  await w.clock.settle()
  await ui.pane.redraw()
  expect(await ui.pane.find({ key: 'menu-a.json' })).toBeDefined()
  expect(await ui.pane.find({ key: 'nudge-a.json' })).toBeUndefined()
})

test('a menu or heading press sets the state it was drawn for, and a menu press for a file with no busy card changes nothing', () => {
  const open = menuPressed(FOLDS_CLOSED, 'a.json', true, ['a.json'])
  expect(open.openMenus).toEqual(['a.json'])
  expect(menuPressed(open, 'a.json', true, ['a.json'])).toBe(open)
  expect(menuPressed(open, 'a.json', false, ['a.json']).openMenus).toEqual([])
  expect(menuPressed(FOLDS_CLOSED, 'gone.json', true, ['a.json'])).toBe(FOLDS_CLOSED)
  expect(prunedMenus(open, ['a.json'])).toBe(open)
  expect(prunedMenus(open, ['b.json'])).toEqual(FOLDS_CLOSED)
  expect(foldsIn(undefined)).toEqual(FOLDS_CLOSED)
  const logOpen = rowPressed(FOLDS_CLOSED, 'isLogOpen', true)
  expect(logOpen).toEqual({ ...FOLDS_CLOSED, isLogOpen: true })
  expect(rowPressed(logOpen, 'isLogOpen', true)).toBe(logOpen)
  expect(rowPressed(logOpen, 'isLogOpen', false)).toEqual(FOLDS_CLOSED)
  expect(rowPressed(FOLDS_CLOSED, 'isTokensOpen', true)).toEqual({ ...FOLDS_CLOSED, isTokensOpen: true })
  expect(rowPressed(FOLDS_CLOSED, 'isTokensOpen', false)).toBe(FOLDS_CLOSED)
  expect(foldsIn({ isLogOpen: true, isTokensOpen: false, openMenus: ['a.json', 3] })).toEqual({ isLogOpen: true, isTokensOpen: false, openMenus: ['a.json'] })
})

test('a done sub session has no card, no menu and cannot be nudged or released through a press its old card left', async ($, on) => {
  // Once set, the reads of the status files see the sub session as done.
  let isDoneForHandlers = false
  on('state.get', async ($, e, next) => {
    const got = await next(e) as { value?: { value?: unknown } }
    if (!isDoneForHandlers || e.plugin !== 'foreman' || e.key !== 'files' || !Array.isArray(got?.value?.value)) return got as never
    const files = (got.value.value as { file: string }[]).map(f => (f.file === 'a.json' ? { ...f, text: busy('ABC-1', 'done') } : f))
    return { ...got, value: { ...got.value, value: files } } as never
  })
  const { w, ui } = await parent($, on, 2, { 'a.json': busy('ABC-1', 'idle') })
  await ui.pane.press({ key: 'menu-a.json' })
  await ui.pane.redraw()
  expect(await ui.drawnPane.find({ key: 'nudge-a.json' })).toBeDefined()
  // From here the press handlers read the sub session as done, while the
  // drawing still holds the buttons of its busy card, as an older drawing on
  // another surface would. Reading changes nothing stored, so the pane is not
  // drawn again, and only the guards in the handlers stand in the way.
  isDoneForHandlers = true
  const sent = w.desktop.sent.length
  await ui.drawnPane.press({ key: 'nudge-a.json' })
  await ui.drawnPane.press({ key: 'release-a.json' })
  isDoneForHandlers = false
  await w.clock.settle()
  expect(w.desktop.sent.length).toBe(sent)
  expect((await ui.logLines()).filter(line => line.startsWith('Nudged') || line.startsWith('Released'))).toEqual([])
})

// The classes of the drawing's circles, in order.
const circles = (source: unknown) => [...String(source).matchAll(/<circle class="(\w+)"/g)].map(m => m[1])

// The six states a light can show, one sub session each, in card order.
const SIX = {
  'a.json': busy('ABC-1', 'working'),
  'b.json': busy('ABC-2', 'waiting-on-builder'),
  'c.json': busy('ABC-3', 'needs-you', { reason: 'a question' }),
  'd.json': busy('ABC-4', 'idle'),
  'e.json': busy('ABC-5', 'in-cleanup'),
  'f.json': [busy('ABC-6', 'working'), T0 - 10 * MINUTE] as [string, number],
}

test('on the desktop, the slot lights are green, red, amber or muted by state, and each free slot is a dashed ring', async ($, on) => {
  const { ui } = await parent($, on, 8, SIX, 'desktop')
  await ui.pane.redraw()
  const lights = held(await ui.pane.find({ key: 'lights-drawing' }))
  expect(lights?.type).toBe('Svg')
  expect(circles(lights?.props?.source)).toEqual(['lg', 'lg', 'lr', 'la', 'la', 'lm', 'lf', 'lf'])
  expect(String(lights?.props?.source)).toContain('stroke-dasharray')
  expect(lights?.props?.alt).toBe('●●●●●●○○')
  expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('6 of 8 busy')
})

test('on the terminal, each slot light is a character in its state\'s color, and each free slot is an empty ring', async ($, on) => {
  const { ui } = await parent($, on, 8, SIX)
  await ui.pane.redraw()
  const expected: [string, string | undefined, boolean][] = [
    ['●', 'success', false], ['●', 'success', false], ['●', 'error', false], ['●', 'warning', false], ['●', 'warning', false], ['●', undefined, true], ['○', undefined, true], ['○', undefined, true],
  ]
  for (const [i, [text, color, dim]] of expected.entries()) {
    const light = await ui.pane.find({ key: `light-${i}` })
    expect([i, light?.text, held(light)?.props?.color, held(light)?.props?.dimColor === true]).toEqual([i, text, color, dim])
  }
  expect(await ui.pane.find({ key: 'light-8' })).toBeUndefined()
  expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('6 of 8 busy')
})

for (const surface of SURFACES) {
  test(`on the ${surface}, more busy sub sessions than slots draw one light each and no ring`, async ($, on) => {
    const { ui } = await parent($, on, 1, { 'a.json': busy('ABC-1'), 'b.json': busy('ABC-2'), 'c.json': busy('ABC-3') }, surface)
    await ui.pane.redraw()
    if (surface === 'desktop') expect(circles(held(await ui.pane.find({ key: 'lights-drawing' }))?.props?.source)).toEqual(['lg', 'lg', 'lg'])
    else {
      for (const i of [0, 1, 2]) expect((await ui.pane.find({ key: `light-${i}` }))?.text).toBe('●')
      expect(await ui.pane.find({ key: 'light-3' })).toBeUndefined()
    }
    expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('3 of 1 busy')
  })
}

test('the badge after the lights counts the sub sessions that wait, in the plain color', async ($, on) => {
  const waits = newPairing('ft-ABC-2', 'local_ABC-2', T0, 'ABC-2', { place: 1, claim: null })
  const queued = await parent($, on, 1, { 'a.json': busy('ABC-1') }, 'terminal', [waits])
  const badge = await queued.ui.pane.find({ key: 'badge' })
  expect([badge?.text, held(badge)?.props?.color]).toEqual(['1 queued', undefined])
})

test('the badge reads queue empty in the warning color when a slot is free and nobody waits', async ($, on) => {
  const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1') })
  const badge = await ui.pane.find({ key: 'badge' })
  expect([badge?.text, held(badge)?.props?.color]).toEqual(['queue empty', 'warning'])
})

test('the badge is left out when nobody waits and no slot is free', async ($, on) => {
  const { ui } = await parent($, on, 1, { 'a.json': busy('ABC-1') })
  await ui.pane.redraw()
  expect(await ui.pane.find({ key: 'badge' })).toBeUndefined()
})

for (const surface of SURFACES) {
  test(`on the ${surface}, a card that needs the person is marked and its current stage is red`, async ($, on) => {
    const { ui } = await parent($, on, 2, {
      'a.json': busy('ABC-1', 'needs-you', { stage: 'plan', stageDone: 3, reason: 'a question' }),
      'b.json': busy('ABC-2', 'working', { stage: 'plan', stageDone: 3 }),
    }, surface)
    await ui.pane.redraw()
    const needs = await ui.pane.find({ key: 'card-a.json' })
    const fine = await ui.pane.find({ key: 'card-b.json' })
    if (surface === 'desktop') {
      expect(needs?.props.borderColor).toBe('error')
      expect(fine?.props.borderColor).not.toBe('error')
      const red = String(held(await ui.pane.find({ key: 'stages-a.json' }))?.props?.source)
      expect([...red.matchAll(/<rect class="(\w+)"/g)].map(m => m[1])).toEqual(['sd', 'sd', 'sd', 'sn', 'se', 'se', 'se', 'se', 'se'])
      const plain = String(held(await ui.pane.find({ key: 'stages-b.json' }))?.props?.source)
      expect([...plain.matchAll(/<rect class="(\w+)"/g)].map(m => m[1])).toEqual(['sd', 'sd', 'sd', 'sc', 'se', 'se', 'se', 'se', 'se'])
    } else {
      expect(needs?.text.startsWith('!')).toBe(true)
      expect(fine?.text.startsWith('!')).toBe(false)
      const current = await ui.pane.find({ key: 'stage-now-a.json' })
      expect([current?.text, held(current)?.props?.color]).toEqual(['▓', 'error'])
      expect(held(await ui.pane.find({ key: 'stage-now-b.json' }))?.props?.color).not.toBe('error')
    }
    expect(held(await ui.pane.find({ key: 'state-a.json' }))?.props?.color).toBe('error')
  })
}

test('on the desktop, a card\'s stage drawing fits inside the card\'s border and padding', async ($, on) => {
  const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1', 'working', { stage: 'build' }) }, 'desktop')
  await ui.pane.redraw()
  // The width is worked out from the padding the card draws and the round
  // border's one column on each side, so a change to the card's padding that
  // the drawing's width does not follow fails here.
  const frame = (await ui.pane.find({ key: 'card-a.json' }))?.props
  expect(frame?.borderStyle).toBe('round')
  const padding = frame?.paddingX
  expect(typeof padding).toBe('number')
  expect(held(await ui.pane.find({ key: 'stages-a.json' }))?.props?.width).toBe((200 - 2 * Number(padding) - 2) * 8)
})

for (const surface of SURFACES) {
  test(`on the ${surface}, a card with no stage yet fills nothing and its line says so`, async ($, on) => {
    const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1', 'working', { stageDone: 4 }) }, surface)
    await ui.pane.redraw()
    if (surface === 'desktop') {
      const source = String(held(await ui.pane.find({ key: 'stages-a.json' }))?.props?.source)
      expect([...source.matchAll(/<rect class="(\w+)"/g)].map(m => m[1])).toEqual(Array(9).fill('se'))
    } else {
      expect(await ui.pane.find({ key: 'stage-now-a.json' })).toBeUndefined()
      expect(await ui.pane.find({ key: 'stage-before-a.json' })).toBeUndefined()
      const after = await ui.pane.find({ key: 'stage-after-a.json' })
      expect([after?.text, held(after)?.props?.dimColor]).toEqual(['░░░░░░░░░ 0 of 9', true])
    }
    expect((await ui.pane.find({ key: 'line-a.json' }))?.text).toContain('no stage yet')
  })
}

test('a card shows its key, title, state, stage, pull request, time worked and cost, and its open button opens the sub session', async ($, on) => {
  const { w, ui } = await parent($, on, 2, {
    'a.json': busy('ABC-1', 'working', { stage: 'review', stageDone: 7, usage: USAGE, timing: timing(null), pr: { repo: 'o/r', number: 4, state: 'OPEN', checks: 'passed' } }),
    'b.json': busy('ABC-2', 'idle'),
  })
  await ui.pane.redraw()
  const a = (await ui.pane.find({ key: 'card-a.json' }))?.text ?? ''
  for (const part of ['ABC-1', 'Title of ABC-1', 'working', 'review rounds', '#4 OPEN · checks passed', '10m · $1.75']) expect(a).toContain(part)
  expect((await ui.pane.find({ key: 'card-b.json' }))?.text).toContain('time unknown · cost unknown')
  await ui.pane.press({ key: 'open-a.json' })
  expect(w.desktop.calls.at(-1)).toEqual({ server: 'ccd_window', tool: 'open_session_in', args: { session_id: 'local_ABC-1', target: 'split' } })
})

test('released and done sub sessions get one compact line each, with an open button and no menu', async ($, on) => {
  const { w, ui } = await parent($, on, 3, { 'a.json': busy('ABC-1'), 'b.json': busy('ABC-2', 'done', { usage: USAGE }), 'c.json': busy('ABC-3') })
  await ui.pane.press({ key: 'menu-a.json' })
  await ui.pane.press({ key: 'release-a.json' })
  await w.clock.settle()
  await ui.pane.redraw()
  expect(await ui.pane.find({ key: 'card-a.json' })).toBeUndefined()
  expect(await ui.pane.find({ key: 'card-b.json' })).toBeUndefined()
  expect((await ui.pane.find({ key: 'compact-a.json' }))?.text).toContain('ABC-1 released')
  expect((await ui.pane.find({ key: 'compact-b.json' }))?.text).toContain('ABC-2 done')
  expect((await ui.pane.find({ key: 'compact-b.json' }))?.text).toContain('$1.75')
  for (const file of ['a.json', 'b.json']) {
    expect(await ui.pane.find({ key: `menu-${file}` })).toBeUndefined()
    expect(await ui.pane.find({ key: `open-${file}` })).toBeDefined()
  }
  expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('1 of 3 busy')
  const calls = w.desktop.calls.length
  await ui.pane.press({ key: 'open-b.json' })
  expect(w.desktop.calls.length).toBe(calls + 1)
})

// One entry of the ledger's spent list.
const entry = (ticket: string, usd: number | null, mergedAt: number | null | 'no timing'): ForemanSpent => ({
  ticket, counts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, usd, timing: mergedAt === 'no timing' ? null : timing(mergedAt), queuedMs: null,
})

test('the merged figures count only entries with a merge time and average over the ones with a known cost', () => {
  const earlier = { counts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 50, times: { working: 1, needsYou: 1, otherWaiting: 1, queued: 1 } }
  const t = { ...TICKETS_EMPTY, earlier, spent: [entry('a', 2, T0), entry('b', 4, T0), entry('c', null, T0), entry('d', 10, null), entry('e', 10, 'no timing')] }
  expect(mergedOf(t)).toEqual({ count: 3, average: 3 })
  expect(mergedOf({ ...TICKETS_EMPTY, spent: [entry('c', null, T0)] })).toEqual({ count: 1, average: null })
  expect(mergedOf(TICKETS_EMPTY)).toEqual({ count: 0, average: null })
})

test('the tiles show what was spent, the working time and the merged count with its average, and unknown where nothing is known', async ($, on) => {
  const spent = [entry('ft-x', 2, T0), entry('ft-y', 4, T0), entry('ft-z', 1, null)]
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, spent } } })
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'tile-spent' }))?.text).toContain('$7.00')
  expect((await ui.pane.find({ key: 'tile-spent' }))?.text).toContain('sub sessions $7.00 · this session cost unknown')
  expect((await ui.pane.find({ key: 'tile-working' }))?.text).toContain('30m')
  expect((await ui.pane.find({ key: 'tile-working' }))?.text).toContain('waiting on you 15m')
  expect((await ui.pane.find({ key: 'tile-merged' }))?.text).toContain('2')
  expect((await ui.pane.find({ key: 'tile-merged' }))?.text).toContain('$3.00 per merged issue')
})

test('with nothing merged the merged tile reads 0 with no small print', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, spent: [entry('ft-z', 3, null)] } } })
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'tile-merged' }))?.text).toBe('Merged 0')
})

test('with no known cost among the merged entries the merged tile reads cost unknown', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, spent: [entry('ft-z', null, T0)] } } })
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'tile-merged' }))?.text).toContain('cost unknown')
  expect((await ui.pane.find({ key: 'tile-spent' }))?.text).toContain('cost unknown')
})

test('a ledger that cannot be read leaves the tiles and the merged count unknown instead of failing the pane', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, spent: [entry('ft-x', 2, T0)] } } })
  let fails = false
  on('state.get', ($, e, next) => (fails && e.plugin === 'foreman' && e.key === 'tickets' ? { deny: 'the state is gone' } as never : next(e)))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  fails = true
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'tile-merged' }))?.text).toContain('unknown')
  expect((await ui.pane.find({ key: 'tile-merged' }))?.text).not.toContain('Merged 0')
  expect((await ui.pane.find({ key: 'tile-spent' }))?.text).toContain('unknown')
})

// Builder's usage value for the parent session itself, so the parent's own
// spend is known, at $1.75.
const OWN_USAGE = { ...USAGE, sessionId: 'session-1', lastEngineUsd: 1.75, turns: [], at: T0 }

// The Spent tile's figure, and its small print on the desktop, or its one
// line on the terminal.
async function spentTile(ui: Awaited<ReturnType<typeof mountBoth>>, surface: typeof SURFACES[number]) {
  await ui.pane.redraw()
  if (surface === 'terminal') return [(await ui.pane.find({ key: 'tile-spent' }))?.text]
  return [(await ui.pane.find({ key: 'tile-spent-figure' }))?.text, (await ui.pane.find({ key: 'tile-spent-small' }))?.text]
}

for (const surface of SURFACES) {
  // The test above sets no spend of the parent's own, so its total was
  // unknown even before the Spent tile checked whether the ledger was read.
  test(`on the ${surface}, a ledger that cannot be read makes the Spent figure unknown even when the parent's own spend is known`, async ($, on) => {
    const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, spent: [entry('ft-x', 2, T0)] } } })
    // The engine takes one state.get handler per test, so this one answers
    // builder's usage value, as builderUsage does, and refuses the ledger.
    let fails = false
    on('state.get', ($, e, next) => {
      if (e.plugin === 'builder' && e.key === 'usage') return { value: { value: OWN_USAGE, version: 0 } } as never
      return fails && e.plugin === 'foreman' && e.key === 'tickets' ? { deny: 'the state is gone' } as never : next(e)
    })
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    await w.clock.settle()
    fails = true
    expect(await spentTile(ui, surface)).toEqual(surface === 'terminal'
      ? ['Spent cost unknown · sub sessions cost unknown · this session $1.75']
      : ['Spent cost unknown', 'sub sessions cost unknown · this session $1.75'])
  })

  test(`on the ${surface}, a ledger that reads with no sub session spending leaves the parent's own spend as the Spent figure`, async ($, on) => {
    const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY } } })
    builderUsage(on, OWN_USAGE)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    await w.clock.settle()
    expect(await spentTile(ui, surface)).toEqual(surface === 'terminal'
      ? ['Spent $1.75 · sub sessions cost unknown · this session $1.75']
      : ['Spent $1.75', 'sub sessions cost unknown · this session $1.75'])
  })
}

test('a ledger that cannot be read hands the band back to the host rather than claim no slot is busy', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY } } })
  w.folder.put('a.json', record('ABC-1', 'working', { stage: 'build', desktopSessionId: 'local_ABC-1' }))
  w.desktop.sessions = [{ sessionId: 'local_ABC-1', cwd: '/w', title: 'ABC-1: short', isRunning: true }]
  let fails = false
  on('state.get', ($, e, next) => (fails && e.plugin === 'foreman' && e.key === 'tickets' ? { deny: 'the state is gone' } as never : next(e)))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  expect(await ui.bandText()).toContain('1 of 2 slots busy')
  fails = true
  expect(await ui.bandText()).toBe('')
  expect(await ui.band.find({ text: 'host line' })).toBeDefined()
})

test('a ledger that cannot be read draws no slot lights, says the busy slots are unknown and shows no badge', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 2 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, spent: [] } } })
  let fails = false
  on('state.get', ($, e, next) => (fails && e.plugin === 'foreman' && e.key === 'tickets' ? { deny: 'the state is gone' } as never : next(e)))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('0 of 2 busy')
  expect((await ui.pane.find({ key: 'badge' }))?.text).toBe('queue empty')
  fails = true
  await ui.pane.redraw()
  expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('busy slots unknown of 2')
  expect(await ui.pane.find({ key: 'light-0' })).toBeUndefined()
  expect(await ui.pane.find({ key: 'badge' })).toBeUndefined()
})

for (const surface of SURFACES) {
  test(`on the ${surface}, the empty parent pane shows the lights, the up-next row, the tiles and both headings, and no line about the status folder`, async ($, on) => {
    const { ui } = await parent($, on, 2, {}, surface)
    await ui.pane.redraw()
    expect((await ui.pane.find({ key: 'busy' }))?.text).toBe('0 of 2 busy')
    expect((await ui.pane.find({ key: 'up-next' }))?.text).toBe('Up next: nothing queued')
    for (const key of ['tile-spent', 'tile-working', 'tile-merged', 'log-toggle', 'tokens-toggle']) expect(await ui.pane.find({ key })).toBeDefined()
    const text = (await ui.pane.find({ key: 'foreman-pane' }))?.text ?? ''
    expect(text).not.toContain('status folder')
  })
}

test('the up-next row shows a chip for each waiting sub session in the order they begin, and each chip opens its session', async ($, on) => {
  const second = newPairing('ft-ABC-3', 'local_ABC-3', T0 - 70 * MINUTE, 'ABC-3', { place: 2, claim: null })
  const first = newPairing('ft-ABC-2', 'local_ABC-2', T0 - 5 * MINUTE, 'ABC-2', { place: 1, claim: null })
  const { w, ui } = await parent($, on, 1, { 'a.json': busy('ABC-1') }, 'terminal', [second, first])
  const row = (await ui.pane.find({ key: 'up-next' }))?.text ?? ''
  expect(row.startsWith('Up next: ')).toBe(true)
  expect(row.indexOf('ABC-2')).toBeLessThan(row.indexOf('ABC-3'))
  await ui.pane.press({ key: 'open-queued-ft-ABC-2' })
  expect(w.desktop.calls.at(-1)?.args).toEqual({ session_id: 'local_ABC-2', target: 'split' })
})

test('the terminal and the desktop draw the same sections in the same order', async ($, on) => {
  const waits = newPairing('ft-ABC-9', 'local_ABC-9', T0, 'ABC-9', { place: 1, claim: null })
  const { ui } = await parent($, on, 2, { 'a.json': busy('ABC-1'), 'b.json': busy('ABC-2', 'done') }, 'terminal', [waits])
  const desktop = await $.ui.mount({ plugin: 'foreman', surface: 'desktop', component: 'Pane', requestId: 'foreman', props: { bodyColumns: 200 } as never })
  const keysOf = async (pane: typeof desktop | typeof ui.pane) => ((await pane.find({ key: 'foreman-pane' }))?.children ?? []).map(child => (child as { props?: { key?: string } }).props?.key)
  const terminal = await keysOf(ui.pane)
  expect(terminal).toEqual(['lights', 'cards', 'not-busy', 'up-next', 'tiles', 'log', 'tokens'])
  expect(await keysOf(desktop)).toEqual(terminal)
})

test('record text never reaches a drawing: every attribute is a number, the namespace or a fixed class name', async ($, on) => {
  const title = 'a <b> & "c" \'d\''
  const { ui } = await parent($, on, 3, {
    'a.json': busy('ABC-1', 'needs-you', { issueTitle: title, reason: title, stage: 'build', stageDone: 4 }),
    'b.json': busy('ABC-2', 'working', { issueTitle: title }),
  }, 'desktop')
  await ui.pane.redraw()
  const drawings = await ui.pane.findAll({ type: 'Svg' })
  expect(drawings.length).toBeGreaterThan(0)
  for (const drawing of drawings) {
    const source = String(drawing.props.source)
    for (const part of ['<b>', '&lt;b', '&amp;', 'quot', 'apos', 'Title', 'ABC-']) expect(source).not.toContain(part)
    for (const [, name, value] of source.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      const fixed = name === 'xmlns' ? value === 'http://www.w3.org/2000/svg' : name === 'class' ? /^[a-z]{2}$/.test(value!) : /^[\d. -]+$/.test(value!)
      expect([name, value, fixed]).toEqual([name, value, true])
    }
  }
  expect((await ui.pane.find({ key: 'title-a.json' }))?.text).toContain('a <b> & "c"')
})
