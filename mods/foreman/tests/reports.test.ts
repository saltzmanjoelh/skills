import { expect, test } from 'claude-code/testing'

import { BEGIN_TEXT } from '../hooks/desktop'
import { afterTyped, keptOf, noticeArrived, noticeFailed, REPORT_SHOWN_MS, shownReport } from '../hooks/pane'
import { failedNoticeLog, LOG_KEPT } from '../hooks/register'
import { ticketsIn, ticketsKey } from '../hooks/tickets'
import type { Engine } from 'claude-code/testing'

import { EVENT, foreman, leftInState, MINUTE, mountBoth, record, SECOND, start, T0, world } from './world'

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

test('two milestones in one read whose notification fails leave one marked line holding both', async ($, on) => {
  const w = world(on)
  w.engine.notify = 'off'
  const a = working('ABC-1')
  const b = working('ABC-2')
  w.folder.put('a.json', a)
  w.folder.put('b.json', b)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a, 'b.json': b })
  await minutesPass(w, 1, { 'a.json': working('ABC-1', { pr: pr(7, 'OPEN') }), 'b.json': working('ABC-2', { pr: pr(8, 'OPEN') }) })
  const lines = await ui.logLines()
  expect(lines.filter(line => line.includes('opened pull request'))).toEqual(['ABC-1 opened pull request #7. ABC-2 opened pull request #8. (notification not raised: disabled)'])
  expect(lines.at(-1)).toBe('ABC-1 opened pull request #7. ABC-2 opened pull request #8. (notification not raised: disabled)')
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
  // The report leaves one line, marked, after the line that says once why
  // notifications fail, so the newest line is the report's.
  expect(lines.filter(line => line.includes('ABC-1 opened pull request #7.'))).toEqual(['ABC-1 opened pull request #7. (notification not raised: disabled)'])
  expect(lines.slice(-2)).toEqual([
    'Could not raise notifications (disabled; surfaces attached: none), so the band keeps each report until your next message.',
    'ABC-1 opened pull request #7. (notification not raised: disabled)',
  ])
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

test('a failed report adds one marked log line, and the first failure of a load adds one line naming the reason and the surfaces before it', async ($, on) => {
  const { w, ui } = await openedUnseen($, on)
  const first = await ui.logLines()
  expect(first.filter(line => line.startsWith('Could not raise'))).toEqual([reasonLine('no-surface', 'desktop')])
  expect(first.slice(-2)).toEqual([reasonLine('no-surface', 'desktop'), `${OPENED} (notification not raised: no-surface)`])
  expect(first).not.toContain(OPENED)
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  expect((await ui.logLines()).slice(first.length)).toEqual([`${VERDICTS} (notification not raised: no-surface)`])
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

test('a message the person types while foreman is off still lets go of a kept notice, which shows for ten minutes once foreman is on again', async ($, on) => {
  const w = world(on)
  leftInState(on, { report: { text: OPENED, at: T0 - 30 * MINUTE, kept: 1 } })
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  await typed($)
  await w.clock.settle()
  await foreman($)
  await w.clock.settle()
  expect(await ui.bandText()).toContain(OPENED)
  await w.clock.advance(10 * MINUTE + SECOND)
  await w.clock.settle()
  expect(await ui.bandText()).not.toContain(OPENED)
})

test('a typed message writes the band only when it has a notice to release, and never twice for the same one', async ($, on) => {
  const w = world(on)
  // Seeds a kept notice as leftInState does, and counts the band's writes in
  // the same hook, because a test may register only one state.set hook.
  let seeded = true
  const bandWrites: unknown[] = []
  on('state.get', ($, e, next) => (seeded && e.plugin === 'foreman' && e.key === 'report'
    ? { value: { value: { text: OPENED, at: T0 - 30 * MINUTE, kept: 1 }, version: 0 } } as never
    : next(e)))
  on('state.set', ($, e, next) => {
    if (e.plugin === 'foreman' && e.key === 'report') {
      seeded = false
      bandWrites.push(e.value)
    }
    return next(e)
  })
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  await typed($)
  await w.clock.settle()
  expect(bandWrites).toHaveLength(1)
  await typed($)
  await w.clock.settle()
  expect(bandWrites).toHaveLength(1)
  expect(await ui.bandText()).toContain(OPENED)
})

test('a typed message writes nothing while the band holds no notice', async ($, on) => {
  const w = world(on)
  const bandWrites: unknown[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'foreman' && e.key === 'report') bandWrites.push(e.value)
    return next(e)
  })
  await mountBoth($, on)
  await start($)
  await foreman($)
  await w.clock.settle()
  await typed($)
  await w.clock.settle()
  expect(bandWrites).toEqual([])
})

// Moves the clock a second at a time until foreman next reads the status
// folder, so a test can look at the band before a call that hangs runs out
// of time.
async function untilRead(w: ReturnType<typeof world>) {
  const lists = w.folder.lists
  for (let i = 0; i < 300 && w.folder.lists === lists; i++) {
    await w.clock.advance(SECOND)
    await w.clock.settle()
  }
  expect(w.folder.lists).toBeGreaterThan(lists)
}

test('a report reaches the band while its notification has not answered, and stays kept once the call runs out of time', async ($, on) => {
  const w = world(on)
  w.engine.notify = 'hang'
  const before = working('ABC-1')
  w.folder.put('a.json', before)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': before })
  const opened = working('ABC-1', { pr: pr(7, 'OPEN') })
  w.folder.put('a.json', opened)
  await untilRead(w)
  expect(await ui.bandText()).toContain(OPENED)
  await w.clock.advance(31 * SECOND)
  await w.clock.settle()
  expect(await ui.bandText()).toContain(OPENED)
  // The sub session keeps writing its file, so no other notice arrives, and
  // the opened report is still the one the band keeps, alone, past its ten
  // minutes.
  await minutesPass(w, 11, { 'a.json': opened })
  const band = await ui.bandText()
  expect(band).toContain(OPENED)
  expect(band).not.toContain('more since')
})

test('a surfaces read that never answers holds up only the reason line, which names the surfaces as unknown', async ($, on) => {
  const w = world(on)
  w.engine.notify = 'off'
  w.engine.notifyReason = 'no-surface'
  w.engine.surfaces = 'hang'
  const before = working('ABC-1')
  w.folder.put('a.json', before)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': before })
  const opened = working('ABC-1', { pr: pr(7, 'OPEN') })
  w.folder.put('a.json', opened)
  await untilRead(w)
  expect(await ui.bandText()).toContain(OPENED)
  expect((await ui.logLines()).filter(line => line.startsWith('Could not raise'))).toEqual([])
  await w.clock.advance(31 * SECOND)
  await w.clock.settle()
  expect((await ui.logLines()).filter(line => line.startsWith('Could not raise'))).toEqual([reasonLine('no-surface', 'unknown')])
  expect(await ui.bandText()).toContain(OPENED)
})

test('a band write that is refused loses the report from the band only, and the log still holds its sentence, marked as not raised, and the reason line', async ($, on) => {
  const w = world(on)
  on('state.set', ($, e, next) => (e.plugin === 'foreman' && e.key === 'report' ? { deny: 'refused' } as never : next(e)))
  w.engine.notify = 'off'
  w.engine.notifyReason = 'no-surface'
  const before = working('ABC-1')
  w.folder.put('a.json', before)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': before })
  await minutesPass(w, 1, { 'a.json': working('ABC-1', { pr: pr(7, 'OPEN') }) })
  expect(await ui.bandText()).not.toContain(OPENED)
  const lines = await ui.logLines()
  expect(lines).toContain(`${OPENED} (notification not raised: no-surface)`)
  expect(lines).toContain(reasonLine('no-surface', 'none'))
})

test('an answer whose isSent is not exactly true counts as a failure, and a reason that is not text reads as unknown', async ($, on) => {
  const { w, ui } = await openedUnseen($, on, [])
  w.engine.notify = 'malformed'
  const verdicts = working('ABC-1', { pr: pr(7, 'OPEN', PAIR) })
  await minutesPass(w, 1, { 'a.json': verdicts })
  const reasons = (await ui.logLines()).filter(line => line.startsWith('Could not raise'))
  expect(reasons).toEqual([reasonLine('no-surface', 'none'), reasonLine('unknown', 'none')])
  expect(await ui.bandText()).toContain(`${VERDICTS} (1 more since your last message.)`)
})

test('the band\'s value: a failure or a kept value adds to the count, typing releases it, and old or damaged values read as not kept', () => {
  const at = T0
  const report = { newest: OPENED, count: 1, isReport: true }
  expect(keptOf(null)).toBe(0)
  expect(keptOf({ text: OPENED, at })).toBe(0)
  expect(keptOf({ text: OPENED, at, kept: -1 })).toBe(0)
  expect(keptOf({ text: OPENED, at, kept: 1.5 })).toBe(0)
  expect(keptOf({ text: OPENED, at, kept: 2 })).toBe(2)
  expect(noticeArrived(null, report, at)).toEqual({ value: { text: OPENED, at, kept: 0 }, counted: false })
  expect(noticeFailed({ text: OPENED, at, kept: 0 }, report, at)).toEqual({ text: OPENED, at, kept: 1 })
  expect(noticeFailed(null, { newest: MERGED, count: 2, isReport: true }, at)).toEqual({ text: MERGED, at, kept: 2 })
  expect(noticeArrived({ text: OPENED, at, kept: 1 }, { newest: MERGED, count: 1, isReport: true }, at + 1)).toEqual({ value: { text: MERGED, at: at + 1, kept: 2 }, counted: true })
  const needs = { newest: 'ABC-1 needs you.', count: 1, isReport: false }
  const shown = { text: OPENED, at }
  expect(noticeArrived(shown, needs, at + 1)).toEqual({ value: shown, counted: false })
  expect(noticeFailed(shown, needs, at + 1)).toEqual({ text: 'ABC-1 needs you.', at: at + 1, kept: 1 })
  // A call that answers after a later notice reached the band leaves the
  // later one as the newest. When the later one is counted already, this
  // one joins the count. When it is not, it stays out of the count until its
  // own notification fails, which then adds it once, with all its sentences.
  expect(noticeFailed({ text: MERGED, at: at + 5, kept: 2 }, report, at)).toEqual({ text: MERGED, at: at + 5, kept: 3 })
  const earlierFailed = noticeFailed({ text: MERGED, at: at + 5, kept: 0 }, report, at)
  expect(earlierFailed).toEqual({ text: MERGED, at: at + 5, kept: 1, newestOut: true })
  expect(shownReport(earlierFailed, at + 100 * REPORT_SHOWN_MS)).toBe(`${MERGED} (1 more since your last message.)`)
  const bothFailed = noticeFailed(earlierFailed, { newest: MERGED, count: 1, isReport: true }, at + 5)
  expect(bothFailed).toEqual({ text: MERGED, at: at + 5, kept: 2 })
  expect(shownReport(bothFailed, at + 100 * REPORT_SHOWN_MS)).toBe(`${MERGED} (1 more since your last message.)`)
  const threeSentences = noticeFailed(earlierFailed, { newest: MERGED, count: 3, isReport: true }, at + 5)
  expect(shownReport(threeSentences, at)).toBe(`${MERGED} (3 more since your last message.)`)
  // A notice that arrives after one marked newestOut is counted, and the one
  // it replaces leaves the band, so its own failure later still adds it once.
  const third = noticeArrived(earlierFailed, { newest: VERDICTS, count: 1, isReport: true }, at + 6)
  expect(third).toEqual({ value: { text: VERDICTS, at: at + 6, kept: 2 }, counted: true })
  expect(noticeFailed(third.value, { newest: MERGED, count: 1, isReport: true }, at + 5)).toEqual({ text: VERDICTS, at: at + 6, kept: 3 })
  expect(afterTyped({ text: OPENED, at, kept: 3 }, at + 5)).toEqual({ text: OPENED, at: at + 5, kept: 0, released: true })
  // A notice whose call was still waiting when the person typed, and failed
  // after, is kept alone: the released one is not a later notice, so it is
  // neither counted again nor kept past its ten minutes.
  const released = afterTyped({ text: MERGED, at: at + 1, kept: 1 }, at + 9)
  expect(noticeFailed(released, report, at)).toEqual({ text: OPENED, at, kept: 1 })
  // Typing marks a notice that is not kept as seen too, without moving its
  // time, so a call that was still waiting and fails after it does not count
  // the seen one again. A value already released is left as it was.
  const seen = afterTyped({ text: MERGED, at: at + 1, kept: 0 }, at + 9)
  expect(seen).toEqual({ text: MERGED, at: at + 1, released: true })
  expect(noticeFailed(seen, report, at)).toEqual({ text: OPENED, at, kept: 1 })
  expect(afterTyped(seen, at + 20)).toBe(seen)
  expect(afterTyped(null, at + 5)).toBeNull()
  expect(shownReport({ text: OPENED, at, kept: 1 }, at + 100 * REPORT_SHOWN_MS)).toBe(OPENED)
  expect(shownReport({ text: OPENED, at, kept: 3 }, at + 100 * REPORT_SHOWN_MS)).toBe(`${OPENED} (2 more since your last message.)`)
  expect(shownReport({ text: OPENED, at, kept: 0 }, at + REPORT_SHOWN_MS)).toBeNull()
  expect(shownReport({ text: OPENED, at: 'soon', kept: 2 }, at)).toBeNull()
})

test('a failed report whose line was merged with the same line before it lowers that line\'s count by one, then adds the reason line when it is the first and one marked line', () => {
  const earlier = { at: T0 - MINUTE, text: 'Opened ABC-1 beside this session.' }
  // The same sentence was logged at T0 - 30 seconds, and again by this report
  // at T0, which merged it onto the older line as (3 times).
  const lines = [earlier, { at: T0, text: OPENED, times: 3 }]
  const marked = `${OPENED} (notification not raised: no-surface)`
  const reason = reasonLine('no-surface', 'none')
  const first = failedNoticeLog(lines, { texts: [OPENED], at: T0 }, [reason, marked], T0 + SECOND)
  expect(first).toEqual([earlier, { at: T0, text: OPENED, times: 2 }, { at: T0 + SECOND, text: reason }, { at: T0 + SECOND, text: marked }])
  // A count of two drops to a line with no count, and a later failure for a
  // reason already logged adds only the marked line.
  const second = failedNoticeLog([earlier, { at: T0, text: OPENED, times: 2 }], { texts: [OPENED], at: T0 }, [marked], T0 + SECOND)
  expect(second).toEqual([earlier, { at: T0, text: OPENED }, { at: T0 + SECOND, text: marked }])
  // A line the report wrote that was already pushed out of the kept lines is
  // skipped, and the older lines stay as they were.
  const full = Array.from({ length: LOG_KEPT }, (_, i) => ({ at: T0 + i, text: `line ${i}` }))
  expect(failedNoticeLog(full, { texts: [OPENED], at: T0 - MINUTE }, [marked], T0 + MINUTE)).toEqual([...full.slice(1), { at: T0 + MINUTE, text: marked }])
})
