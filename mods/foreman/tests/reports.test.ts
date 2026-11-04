import { expect, test } from 'claude-code/testing'

import { BEGIN_TEXT } from '../hooks/desktop'
import { afterTyped, keptOf, REPORT_SHOWN_MS, shownReport, withNotice } from '../hooks/pane'
import { ticketsIn, ticketsKey } from '../hooks/tickets'
import type { Engine } from 'claude-code/testing'

import { EVENT, foreman, MINUTE, mountBoth, record, SECOND, start, T0, world } from './world'

// The five report sentences: a sub session's pull request opened, got its
// verdict pair, merged or was closed, and foreman began a queued issue.
// Foreman shows each itself, in one notification titled "foreman", in the
// log and in the band, and never wakes the parent's model with one.

type World = ReturnType<typeof world>

const ledger = (w: World) => ticketsIn(w.stored.get(ticketsKey('session-1')))

// Moves the clock on a minute at a time for `minutes` minutes, rewriting the
// files `live` names first each minute, as builder does while its session
// lives, so they never look stopped.
async function minutesPass(w: World, minutes: number, live: Record<string, string> = {}) {
  for (let i = 0; i < minutes; i++) {
    const now = T0 + (Math.round((w.clock.now() - T0) / MINUTE) + 1) * MINUTE
    for (const [name, text] of Object.entries(live)) w.folder.put(name, text, now, false)
    await w.clock.advance(MINUTE)
    await w.clock.settle()
  }
}

// Every notification raised, with its title.
const raised = (w: World) => w.engine.notices.map((text, i) => ({ title: w.engine.raised[i]!.title, text }))

const pr = (number: number, state: string, verdicts: unknown = null) => ({ repo: 'o/r', number, state, checks: 'pending', verdicts })
const working = (key: string, over: Record<string, unknown> = {}) => record(key, 'working', { desktopSessionId: `local_${key}`, ...over })

const PAIR = { sha: 'a'.repeat(40), spec: 'APPROVE', adversarial: 'APPROVE' }

// Each milestone, as the file that first shows it after an open pull request,
// and the sentence foreman reports for it. The opened case starts from a file
// with no pull request.
const MILESTONES = [
  { name: 'opened', before: working('ABC-1'), after: working('ABC-1', { pr: pr(7, 'OPEN') }), sentence: 'ABC-1 opened pull request #7.' },
  {
    name: 'verdicts',
    before: working('ABC-1', { pr: pr(7, 'OPEN') }),
    after: working('ABC-1', { pr: pr(7, 'OPEN', PAIR) }),
    sentence: 'ABC-1\'s pull request #7 has verdicts at aaaaaaa: spec approves, adversarial approves.',
  },
  { name: 'merged', before: working('ABC-1', { pr: pr(7, 'OPEN') }), after: working('ABC-1', { pr: pr(7, 'MERGED') }), sentence: 'ABC-1\'s pull request #7 merged.' },
  {
    name: 'closed',
    before: working('ABC-1', { pr: pr(7, 'OPEN') }),
    after: working('ABC-1', { pr: pr(7, 'CLOSED') }),
    sentence: 'ABC-1\'s pull request #7 was closed without merging.',
  },
]

for (const m of MILESTONES) {
  test(`a read that finds the ${m.name} milestone wakes nobody, raises one notification titled foreman with the sentence, and logs it`, async ($, on) => {
    const w = world(on)
      w.folder.put('a.json', m.before)
    const ui = await mountBoth($, on)
    await start($)
    await foreman($)
    // A new pairing's first read can already report the open pull request,
    // so only what the next read reports counts.
    await minutesPass(w, 1, { 'a.json': m.before })
    const before = w.engine.notices.length
    await minutesPass(w, 1, { 'a.json': m.after })
    expect(w.engine.prompts).toEqual([])
    expect(w.engine.appended).toEqual([])
    expect(raised(w).slice(before)).toEqual([{ title: 'foreman', text: m.sentence }])
    const pane = await ui.paneText()
    expect(pane).toContain(m.sentence)
    expect(pane).not.toContain('Raised a notification')
    expect(await ui.bandText()).toContain(m.sentence)
    await minutesPass(w, 3, { 'a.json': m.after })
    expect(w.engine.notices).toHaveLength(before + 1)
    expect(ledger(w).outbox.reports).toEqual([])
  })
}

test('a begin that went wakes nobody, raises one notification titled foreman with the began sentence, and logs it', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: 1 } } })
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  // With one slot, ABC-1 starts and ABC-2 waits in the queue.
  w.engine.startAnswers = ['Started session (session_id: local_new1, name: example).', 'Started session (session_id: local_new2, name: example).']
  for (const key of ['ABC-1', 'ABC-2']) {
    await $.tool.call({ tool: 'mcp__ccd_session__start_session', prompt: `/implement ${key}`, context: 'fresh', title: `${key}: short` } as never)
  }
  const ticketOf = (n: number) => String(w.engine.started[n]!.prompt).split('foreman-ticket: ')[1]!.split('\n')[0]!
  const live = {
    'a.json': record('ABC-1', 'working', { ticket: ticketOf(0), desktopSessionId: 'local_new1', stage: 'build' }),
    'b.json': record(null, 'idle', { sessionId: 's-local_new2', ticket: ticketOf(1), desktopSessionId: 'local_new2', issueTitle: null }),
  }
  w.desktop.sessions = ['local_new1', 'local_new2'].map(id => ({ sessionId: id, cwd: '/w', title: 'example', isArchived: false, isRunning: true }))
  await minutesPass(w, 1, live)
  expect(w.desktop.sent).toEqual([])
  // A second slot lets ABC-2 begin.
  await foreman($, '2')
  await w.clock.settle()
  expect(w.desktop.sent).toEqual([['local_new2', BEGIN_TEXT]])
  const began = 'foreman began ABC-2, the next issue in the queue, in a free slot.'
  expect(w.engine.prompts).toEqual([])
  expect(w.engine.appended).toEqual([])
  expect(raised(w)).toEqual([{ title: 'foreman', text: began }])
  expect(await ui.paneText()).toContain(began)
  expect(await ui.bandText()).toContain(began)
})

test('two milestones in one read give one notification holding both, both in the log, and the band shows the newer', async ($, on) => {
  const w = world(on)
  const a = working('ABC-1')
  const b = working('ABC-2')
  w.folder.put('a.json', a)
  w.folder.put('b.json', b)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a, 'b.json': b })
  await minutesPass(w, 1, { 'a.json': working('ABC-1', { pr: pr(7, 'OPEN') }), 'b.json': working('ABC-2', { pr: pr(8, 'OPEN') }) })
  expect(w.engine.prompts).toEqual([])
  expect(raised(w)).toEqual([{ title: 'foreman', text: 'ABC-1 opened pull request #7. ABC-2 opened pull request #8.' }])
  const pane = await ui.paneText()
  expect(pane).toContain('ABC-1 opened pull request #7.')
  expect(pane).toContain('ABC-2 opened pull request #8.')
  const band = await ui.bandText()
  expect(band).toContain('ABC-2 opened pull request #8.')
  expect(band).not.toContain('ABC-1 opened pull request #7.')
})

test('a milestone and an idle sub session in one read wake the parent with exactly the idle line, and report the milestone', async ($, on) => {
  const w = world(on)
  const a = working('ABC-1')
  // ABC-2 has no desktop session, so foreman cannot nudge it and wakes the
  // parent once it has been idle for twice the threshold, at ten minutes.
  // The read then is due exactly at that time, and ABC-1's working file
  // makes a read every thirty seconds, so ABC-1's pull request is written
  // just after the read before it.
  const idle = record('ABC-2', 'idle')
  w.folder.put('a.json', a)
  w.folder.put('b.json', idle)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 9, { 'a.json': a, 'b.json': idle })
  await w.clock.advance(30 * SECOND)
  await w.clock.settle()
  expect(w.engine.prompts).toEqual([])
  w.folder.put('a.json', working('ABC-1', { pr: pr(7, 'OPEN') }), w.clock.now(), false)
  w.folder.put('b.json', idle, w.clock.now(), false)
  await w.clock.advance(30 * SECOND)
  await w.clock.settle()
  expect(w.engine.prompts).toEqual(['foreman: ABC-2 has been idle for 10 minutes and cannot be nudged, because foreman knows no desktop session for it.'])
  expect(raised(w)).toEqual([{ title: 'foreman', text: 'ABC-1 opened pull request #7.' }])
  expect(await ui.bandText()).toContain('ABC-1 opened pull request #7.')
})

// A parent with ABC-1 and ABC-2 working, whose first read is over, and the
// file that shows ABC-1's pull request open. The desktop app lists both
// sessions as running, so neither slot frees while the clock moves on past
// their files, which would add the dry-queue report as the newest one.
async function twoWorking($: Parameters<typeof mountBoth>[0], on: Parameters<typeof world>[0]) {
  const w = world(on)
  const a = working('ABC-1')
  const b = working('ABC-2')
  w.folder.put('a.json', a)
  w.folder.put('b.json', b)
  w.desktop.sessions = ['local_ABC-1', 'local_ABC-2'].map(sessionId => ({ sessionId, cwd: '/w', isArchived: false, isRunning: true }))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a, 'b.json': b })
  return { w, ui, b, openA: working('ABC-1', { pr: pr(7, 'OPEN') }) }
}

test('the band shows the newest report at nine minutes and fifty-nine seconds after it was shown, and not at ten minutes and one second', async ($, on) => {
  expect(REPORT_SHOWN_MS).toBe(10 * MINUTE)
  const { w, ui, b, openA } = await twoWorking($, on)
  await minutesPass(w, 1, { 'a.json': openA, 'b.json': b })
  const shownAt = w.engine.raised.at(-1)!.at
  await w.clock.advance(shownAt + 9 * MINUTE + 59 * SECOND - w.clock.now())
  expect(await ui.bandText()).toContain('ABC-1 opened pull request #7.')
  await w.clock.advance(2 * SECOND)
  expect(await ui.bandText()).not.toContain('opened pull request')
})

test('a newer report replaces an older one in the band and starts the ten minutes again', async ($, on) => {
  const { w, ui, openA } = await twoWorking($, on)
  await minutesPass(w, 1, { 'a.json': openA, 'b.json': working('ABC-2') })
  const olderAt = w.engine.raised.at(-1)!.at
  await minutesPass(w, 3, { 'a.json': openA, 'b.json': working('ABC-2') })
  const openB = working('ABC-2', { pr: pr(8, 'OPEN') })
  await minutesPass(w, 1, { 'a.json': openA, 'b.json': openB })
  const newerAt = w.engine.raised.at(-1)!.at
  expect(newerAt).toBeGreaterThan(olderAt)
  const band = await ui.bandText()
  expect(band).toContain('ABC-2 opened pull request #8.')
  expect(band).not.toContain('ABC-1 opened')
  // Past the older report's ten minutes, the newer one still shows.
  await w.clock.advance(olderAt + 10 * MINUTE + SECOND - w.clock.now())
  expect(await ui.bandText()).toContain('ABC-2 opened pull request #8.')
  await w.clock.advance(newerAt + 10 * MINUTE + SECOND - w.clock.now())
  expect(await ui.bandText()).not.toContain('opened pull request')
})

test('on a narrow band every chip keeps its full text, and the report is cut to the room left or dropped', async ($, on) => {
  const w = world(on)
  const a = working('ABC-1')
  w.folder.put('a.json', a)
  const wide = await mountBoth($, on, 'terminal', 200)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a })
  const openA = working('ABC-1', { pr: pr(7, 'OPEN') })
  await minutesPass(w, 1, { 'a.json': openA })
  const full = await wide.bandText()
  expect(full).toContain(' · ABC-1 opened pull request #7.')
  const withoutReport = full.slice(0, full.indexOf(' · ABC-1 opened'))
  for (const columns of [withoutReport.length + 20, withoutReport.length + 10, withoutReport.length]) {
    const band = await $.ui.mount({ plugin: 'foreman', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: columns } as never })
    const text = (await band.find({ key: 'foreman-band' }))?.text ?? ''
    expect(text.startsWith(withoutReport)).toBe(true)
    expect(text.length).toBeLessThanOrEqual(columns)
    if (columns - withoutReport.length >= 19) expect(text).toBe(`${withoutReport} · ${'ABC-1 opened pull request #7.'.slice(0, columns - withoutReport.length - 4)}…`)
    else expect(text).toBe(withoutReport)
  }
})

test('a report whose notification is not raised is in the log once and in the band, and the log says once why notifications fail', async ($, on) => {
  const w = world(on)
  w.engine.notify = 'off'
  const a = working('ABC-1')
  w.folder.put('a.json', a)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a })
  await minutesPass(w, 1, { 'a.json': working('ABC-1', { pr: pr(7, 'OPEN') }) })
  const lines = await ui.logLines()
  expect(lines.filter(line => line.includes('ABC-1 opened pull request #7.'))).toEqual(['ABC-1 opened pull request #7.'])
  expect(lines).toContain('Could not raise notifications (disabled; surfaces attached: none), so the band keeps each report until your next message.')
  expect(await ui.bandText()).toContain('ABC-1 opened pull request #7.')
  expect(w.engine.prompts).toEqual([])
})

test('with no sub sessions left, the band shows the report after the no sub sessions line in full when wide, and cuts or drops it when narrow', async ($, on) => {
  const w = world(on)
  const a = working('ABC-1', { pr: pr(7, 'OPEN') })
  w.folder.put('a.json', a)
  const wide = await mountBoth($, on, 'terminal', 200)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a })
  await minutesPass(w, 1, { 'a.json': working('ABC-1', { pr: pr(7, 'MERGED') }) })
  w.folder.files.clear()
  await minutesPass(w, 1)
  // The read that finds the file gone reports the merge and then, since its
  // slot freed with nobody waiting, the dry queue, which is the newest report.
  expect(await wide.paneText()).toContain('ABC-1\'s pull request #7 merged.')
  const sentence = 'foreman\'s queue ran dry: a slot is free and no sub session waits, so your next message lines up more.'
  const full = await wide.bandText()
  expect(full).toMatch(/^foreman: 0 of 2 slots busy · queue empty · no sub sessions · next read in \S+ · /)
  expect(full.endsWith(` · ${sentence}`)).toBe(true)
  const withoutReport = full.slice(0, full.length - ` · ${sentence}`.length)
  for (const columns of [withoutReport.length + 20, withoutReport.length + 10, withoutReport.length]) {
    const band = await $.ui.mount({ plugin: 'foreman', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: columns } as never })
    const text = (await band.find({ key: 'foreman-band' }))?.text ?? ''
    expect(text.startsWith(withoutReport)).toBe(true)
    expect(text).toContain('no sub sessions')
    expect(text.length).toBeLessThanOrEqual(columns)
    if (columns - withoutReport.length >= 19) expect(text).toBe(`${withoutReport} · ${sentence.slice(0, columns - withoutReport.length - 4)}…`)
    else expect(text).toBe(withoutReport)
  }
})

// A report whose notification fails stays in the band until the person next
// types a message in the parent, then for REPORT_SHOWN_MS more. The fake
// engine answers every notification with `no-surface`, as the desktop app's
// engine does.

const OPENED = 'ABC-1 opened pull request #7.'
const VERDICTS = 'ABC-1\'s pull request #7 has verdicts at aaaaaaa: spec approves, adversarial approves.'
const MERGED = 'ABC-1\'s pull request #7 merged.'
const reasonLine = (words: string, surfaces: string) => `Could not raise notifications (${words}; surfaces attached: ${surfaces}), so the band keeps each report until your next message.`

const typed = ($: Engine, text = 'go on', origin: Record<string, unknown> = { kind: 'composer' }) => $.prompt.submit({ text, wait: false, origin } as never)

// A parent watching ABC-1, whose notifications fail with `no-surface`, after
// the read that reported its pull request opened.
async function openedUnseen($: Engine, on: Parameters<typeof world>[0], surfaces: readonly string[] = ['desktop']) {
  const w = world(on)
  w.engine.notify = 'off'
  w.engine.notifyReason = 'no-surface'
  w.engine.surfaces = surfaces
  const before = working('ABC-1')
  w.folder.put('a.json', before)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': before })
  const opened = working('ABC-1', { pr: pr(7, 'OPEN') })
  await minutesPass(w, 1, { 'a.json': opened })
  return { w, ui, live: { 'a.json': opened } }
}

test('a report whose notification fails stays in the band past ten minutes, and leaves ten minutes after the person types, not before', async ($, on) => {
  const { w, ui, live } = await openedUnseen($, on)
  await minutesPass(w, 25, live)
  expect(await ui.bandText()).toContain(OPENED)
  await typed($)
  await w.clock.settle()
  await minutesPass(w, 9, live)
  await w.clock.advance(59 * SECOND)
  expect(await ui.bandText()).toContain(OPENED)
  await w.clock.advance(2 * SECOND)
  expect(await ui.bandText()).not.toContain(OPENED)
})

test('a prompt from a mod, a peer, the app\'s own wake or a CI event does not release a kept report', async ($, on) => {
  const { w, ui, live } = await openedUnseen($, on)
  const others: [string, Record<string, unknown>][] = [
    ['from another mod', { kind: 'plugin', name: 'other', asUser: true }],
    ['from a peer', { kind: 'peer' }],
    [EVENT, { kind: 'sdk' }],
    ['<ci-monitor-event>The checks passed.</ci-monitor-event>', { kind: 'sdk' }],
  ]
  for (const [text, origin] of others) {
    await typed($, text, origin)
    await w.clock.settle()
    await minutesPass(w, 15, live)
    expect([text, await ui.bandText()]).toEqual([text, expect.stringContaining(OPENED)])
  }
})

test('three failed reports show the newest and the count of the others, and one shows its sentence alone', async ($, on) => {
  const { w, ui } = await openedUnseen($, on)
  const single = await ui.bandText()
  expect(single).toContain(OPENED)
  expect(single).not.toContain('more since')
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  const merged = working('ABC-1', { pr: pr(7, 'MERGED', PAIR) })
  await minutesPass(w, 1, { 'a.json': merged })
  const band = await ui.bandText()
  expect(band).toContain(`${MERGED} (2 more since your last message.)`)
  expect(band).not.toContain(VERDICTS)
  expect(band).not.toContain(OPENED)
})

test('after the person types, the kept report shows alone, and a report that fails after that message counts from one', async ($, on) => {
  const { w, ui } = await openedUnseen($, on)
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  expect(await ui.bandText()).toContain(`${VERDICTS} (1 more since your last message.)`)
  await typed($)
  await w.clock.settle()
  const shown = await ui.bandText()
  expect(shown).toContain(VERDICTS)
  expect(shown).not.toContain('more since')
  const merged = working('ABC-1', { pr: pr(7, 'MERGED', PAIR) })
  await minutesPass(w, 1, { 'a.json': merged })
  const after = await ui.bandText()
  expect(after).toContain(MERGED)
  expect(after).not.toContain('more since')
})

test('a report delivered while another is kept adds to the count, so the kept one is never lost', async ($, on) => {
  const { w, ui } = await openedUnseen($, on)
  w.engine.notify = 'sent'
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  await minutesPass(w, 20, { 'a.json': verdicts })
  expect(await ui.bandText()).toContain(`${VERDICTS} (1 more since your last message.)`)
})

test('a failed report adds one log line, its sentence, and the first failure of a load adds one line naming the reason and the surfaces', async ($, on) => {
  const { w, ui } = await openedUnseen($, on)
  const first = await ui.logLines()
  expect(first.filter(line => line.startsWith('Could not raise'))).toEqual([reasonLine('no-surface', 'desktop')])
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  expect((await ui.logLines()).slice(first.length)).toEqual([VERDICTS])
})

test('a notification that does not answer in time, and one that throws, each log a reason line of their own once', async ($, on) => {
  const { w, ui } = await openedUnseen($, on, [])
  w.engine.notify = 'hang'
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  await w.clock.advance(31 * SECOND)
  await w.clock.settle()
  w.engine.notify = 'throws'
  w.engine.surfaces = 'throws'
  const merged = working('ABC-1', { pr: pr(7, 'MERGED', PAIR) })
  await minutesPass(w, 1, { 'a.json': merged })
  const reasons = (await ui.logLines()).filter(line => line.startsWith('Could not raise'))
  expect(reasons).toEqual([
    reasonLine('no-surface', 'none'),
    reasonLine('no answer within 30 seconds', 'none'),
    reasonLine('the call failed', 'unknown'),
  ])
  expect(await ui.bandText()).toContain(`${MERGED} (2 more since your last message.)`)
})

test('the band\'s value: a failure or a kept value adds to the count, typing releases it, and old or damaged values read as not kept', () => {
  const at = T0
  const report = { newest: OPENED, count: 1, isReport: true }
  expect(keptOf(null)).toBe(0)
  expect(keptOf({ text: OPENED, at })).toBe(0)
  expect(keptOf({ text: OPENED, at, kept: -1 })).toBe(0)
  expect(keptOf({ text: OPENED, at, kept: 1.5 })).toBe(0)
  expect(keptOf({ text: OPENED, at, kept: 2 })).toBe(2)
  expect(withNotice(null, report, false, at)).toEqual({ text: OPENED, at, kept: 0 })
  expect(withNotice(null, report, true, at)).toEqual({ text: OPENED, at, kept: 1 })
  expect(withNotice(null, { newest: MERGED, count: 2, isReport: true }, true, at)).toEqual({ text: MERGED, at, kept: 2 })
  expect(withNotice({ text: OPENED, at, kept: 1 }, { newest: MERGED, count: 1, isReport: true }, false, at + 1)).toEqual({ text: MERGED, at: at + 1, kept: 2 })
  const needs = { newest: 'ABC-1 needs you.', count: 1, isReport: false }
  const shown = { text: OPENED, at }
  expect(withNotice(shown, needs, false, at + 1)).toBe(shown)
  expect(withNotice(shown, needs, true, at + 1)).toEqual({ text: 'ABC-1 needs you.', at: at + 1, kept: 1 })
  expect(afterTyped({ text: OPENED, at, kept: 3 }, at + 5)).toEqual({ text: OPENED, at: at + 5, kept: 0 })
  expect(afterTyped(shown, at + 5)).toBe(shown)
  expect(shownReport({ text: OPENED, at, kept: 1 }, at + 100 * REPORT_SHOWN_MS)).toBe(OPENED)
  expect(shownReport({ text: OPENED, at, kept: 3 }, at + 100 * REPORT_SHOWN_MS)).toBe(`${OPENED} (2 more since your last message.)`)
  expect(shownReport({ text: OPENED, at, kept: 0 }, at + REPORT_SHOWN_MS)).toBeNull()
  expect(shownReport({ text: OPENED, at: 'soon', kept: 2 }, at)).toBeNull()
})
