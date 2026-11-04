import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { REASONS } from '../hooks/desktop'
import { newPairing, ticketsKey, TICKETS_EMPTY } from '../hooks/tickets'
import { foreman, MINUTE, mountBoth, record, SURFACES, start, T0, world } from './world'

// The reason the engine gives when an open the mod made on its own waits.
const NARROW = 'The terminal is 100 columns wide, under the 144 a pane opened unasked needs.'
const WAITS = `foreman's pane waits and is not drawn yet. The engine says: "${NARROW}"`
// The engine names the mod and the call before the message of an open it
// refused, and foreman quotes the whole message.
const FAILED = 'Could not open foreman\'s pane (foreman: $.ui.open: the engine fell over).'
const HEAD = 'Pressing the band\'s head opens the pane.'

for (const surface of SURFACES) {
  test(`on the ${surface}, pressing the head of a band with chips opens foreman's pane and leaves the band as it was`, async ($, on) => {
    const w = world(on)
    w.folder.put('a.json', record('ABC-1', 'working'))
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    const before = await ui.bandText()
    w.toasts.length = 0
    w.panes.length = 0

    await ui.band.press({ key: 'foreman-head' })

    expect(w.panes).toEqual(['foreman'])
    expect(await ui.bandText()).toBe(before)
    expect(before).toStartWith('foreman: 1 of 2 slots busy · ')
    expect(w.toasts).toEqual([])
  })

  test(`on the ${surface}, pressing the head of a band with no sub sessions opens foreman's pane and leaves the band as it was`, async ($, on) => {
    const w = world(on)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    w.panes.length = 0

    await ui.band.press({ key: 'foreman-head' })

    expect(w.panes).toEqual(['foreman'])
    expect(await ui.bandText()).toBe('foreman: 0 of 2 slots busy · queue empty · no sub sessions · next read in 2m')
  })
}

test('pressing the head while the engine lists the pane as open opens it again and closes nothing', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect(w.engine.listed).toEqual(['foreman'])
  w.panes.length = 0

  await ui.band.press({ key: 'foreman-head' })
  await ui.band.press({ key: 'foreman-head' })

  expect(w.panes).toEqual(['foreman', 'foreman'])
  expect(w.engine.closed).toEqual([])
  expect(w.engine.listed).toEqual(['foreman'])
})

test('a press whose open waits shows the waits toast with the engine\'s reason and writes the same log line', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  w.toasts.length = 0
  w.engine.open = { isPlaced: false, reason: NARROW }

  await ui.band.press({ key: 'foreman-head' })

  expect(w.toasts).toEqual([WAITS])
  expect(await ui.newestLog()).toBe(WAITS)
})

test('a press whose open throws shows the "Could not open" toast and writes the same log line', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  w.toasts.length = 0
  w.engine.open = { throws: 'the engine fell over' }

  await ui.band.press({ key: 'foreman-head' })

  expect(w.toasts).toEqual([FAILED])
  expect(await ui.newestLog()).toBe(FAILED)
})

test('the engine\'s reason is cleaned of control characters, and an empty reason reads "no reason was given"', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  w.toasts.length = 0

  w.engine.open = { isPlaced: false, reason: 'too\u001b[31m narrow\nnow' }
  await ui.band.press({ key: 'foreman-head' })
  w.engine.open = { isPlaced: false, reason: '' }
  await ui.band.press({ key: 'foreman-head' })

  expect(w.toasts).toHaveLength(2)
  expect(w.toasts[0]).not.toContain('\u001b')
  expect(w.toasts[0]).not.toContain('\n')
  expect(w.toasts[0]).toStartWith('foreman\'s pane waits and is not drawn yet. The engine says: "too')
  expect(w.toasts[1]).toBe('foreman\'s pane waits and is not drawn yet. The engine says: "no reason was given"')
})

test('a placed open shows no toast and writes no line about the pane', async ($, on) => {
  const w = world(on)
  const ui = await mountBoth($, on)
  await start($)
  const answer = await foreman($)
  await ui.band.press({ key: 'foreman-head' })

  expect(answer.text).toBe('This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.')
  expect(w.toasts).toEqual([])
  expect(await ui.paneText()).not.toContain('foreman\'s pane')
})

for (const [name, open, sentence] of [
  ['waits', { isPlaced: false, reason: NARROW }, WAITS],
  ['throws', { throws: 'the engine fell over' }, FAILED],
] as const) {
  test(`when the open of /start-foreman ${name}, the answer without a count says so and points at the band's head, and the toast and log line follow`, async ($, on) => {
    const w = world(on)
    w.engine.open = open
    const ui = await mountBoth($, on)
    await start($)

    const answer = await foreman($)

    expect(answer.text).toBe(`This session is now the parent, and foreman shows its sub sessions above the prompt. ${sentence} ${HEAD}`)
    expect(w.toasts).toEqual([sentence])
    expect(await ui.newestLog()).toBe(sentence)
    expect(await ui.bandText()).toStartWith('foreman: 0 of 2 slots busy')
  })

  test(`when the open of /start-foreman <n> ${name}, the answer with a count says so and points at the band's head`, async ($, on) => {
    const w = world(on)
    w.engine.open = open
    await mountBoth($, on)
    await start($)

    const answer = await foreman($, '3')

    expect(answer.text).toBe(`This session is now the parent and runs 3 sub sessions at once, and foreman shows its sub sessions above the prompt. ${sentence} ${HEAD}`)
    expect(w.toasts).toEqual([sentence])
  })
}

test('when the open waits, the words after /start-foreman are still passed on after the pointer to the head', async ($, on) => {
  const w = world(on)
  w.engine.open = { isPlaced: false, reason: NARROW }
  await mountBoth($, on)
  await start($)

  const answer = await foreman($, 'start the next issue')

  expect(answer.text).toBe(`This session is now the parent, and foreman shows its sub sessions above the prompt. ${WAITS} ${HEAD} It passes the rest of your line to this session as your prompt.`)
})

test('/start-foreman again in a parent reports an open that waits', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await foreman($)
  w.engine.open = { isPlaced: false, reason: NARROW }

  const answer = await foreman($)

  expect(answer.text).toBe(`This session is now the parent, and foreman shows its sub sessions above the prompt. ${WAITS} ${HEAD}`)
})

test('/start-foreman <n> in a session that is already the parent makes no open, and its answer does not change', async ($, on) => {
  const w = world(on)
  await mountBoth($, on)
  await start($)
  await foreman($)
  w.panes.length = 0
  w.engine.open = { isPlaced: false, reason: NARROW }

  const answer = await foreman($, '3')

  expect(w.panes).toEqual([])
  expect(answer.text).toBe('This parent now runs 3 sub sessions at once.')
})

// The test engine swallows a throw from a ui.toast hook before it reaches the
// mod, as issue-links.test.ts notes, so this test shows that a refused toast
// does no harm in the engine as it is, not that the try around the toast works.
test('a toast the engine refuses does not stop the log line, the role or the answer', async ($, on) => {
  const w = world(on)
  w.engine.toastThrows = true
  w.engine.open = { isPlaced: false, reason: NARROW }
  const ui = await mountBoth($, on)
  await start($)

  const answer = await foreman($)

  expect(answer.text).toContain(WAITS)
  expect(await ui.newestLog()).toBe(WAITS)
  expect(await ui.bandText()).toStartWith('foreman: 0 of 2 slots busy')
})

// A parent with one slot, ABC-1 busy in it, and `waiting` in its queue. The
// desktop app lists ABC-1's session and that of each waiting one with an id.
async function queued($: Engine, on: On, waiting: ReturnType<typeof newPairing>[]) {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 1 }, [ticketsKey('session-1')]: { ...TICKETS_EMPTY, pairings: waiting } } })
  w.folder.put('a.json', record('ABC-1', 'working', { stage: 'build', desktopSessionId: 'local_a' }))
  w.desktop.sessions = [{ sessionId: 'local_a', cwd: '/w', title: 'ABC-1: short', isRunning: true }, ...waiting.flatMap(p => (p.localId === null ? [] : [{ sessionId: p.localId, cwd: '/w', title: 'short', isRunning: false }]))]
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  w.toasts.length = 0
  return { w, ui }
}

const opens = (w: ReturnType<typeof world>) => w.desktop.calls.filter(c => c.tool === 'open_session_in')

test('pressing a queued entry opens its sub session beside the parent by its desktop session id, and logs it', async ($, on) => {
  const { w, ui } = await queued($, on, [newPairing('ft-ABC-2', 'local_b', T0, 'ABC-2', { place: 1, claim: null })])
  await ui.pane.press({ key: 'open-queued-ft-ABC-2' })
  expect(opens(w).map(c => c.args)).toEqual([{ session_id: 'local_b', target: 'split' }])
  expect(w.toasts).toEqual([])
  expect(await ui.newestLog()).toBe('Opened ABC-2 beside this session.')
})

test('pressing a queued entry with no desktop session yet, or with a damaged one, opens nothing and says why in a toast and the log', async ($, on) => {
  // A start answered with a proposal card a minute ago has no session yet,
  // and a stored id that is not a whole local_ id is never passed on.
  const card = newPairing('ft-ABC-2', null, T0 - MINUTE, 'ABC-2', { place: 1, claim: null })
  const damaged = newPairing('ft-ABC-3', 'local_c and more', T0, 'ABC-3', { place: 2, claim: null })
  const { w, ui } = await queued($, on, [card, damaged])
  const cardLine = `Could not open ABC-2: ${REASONS.noSessionId}.`
  const damagedLine = `Could not open ABC-3: ${REASONS.noSessionId}.`
  await ui.pane.press({ key: 'open-queued-ft-ABC-2' })
  expect(w.toasts).toEqual([cardLine])
  expect(await ui.newestLog()).toBe(cardLine)
  await ui.pane.press({ key: 'open-queued-ft-ABC-3' })
  expect(w.toasts).toEqual([cardLine, damagedLine])
  expect(opens(w)).toEqual([])
})
