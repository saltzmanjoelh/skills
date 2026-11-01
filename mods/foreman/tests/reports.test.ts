import { expect, test } from 'claude-code/testing'

import { BEGIN_TEXT } from '../hooks/desktop'
import { REPORT_SHOWN_MS } from '../hooks/pane'
import { ticketsIn, ticketsKey } from '../hooks/tickets'
import { foreman, MINUTE, mountBoth, record, SECOND, start, T0, world } from './world'

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
// file that shows ABC-1's pull request open.
async function twoWorking($: Parameters<typeof mountBoth>[0], on: Parameters<typeof world>[0]) {
  const w = world(on)
  const a = working('ABC-1')
  const b = working('ABC-2')
  w.folder.put('a.json', a)
  w.folder.put('b.json', b)
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

test('a report whose notification is not raised is still in the log and the band, and the log says the notification failed', async ($, on) => {
  const w = world(on)
  w.engine.notify = 'off'
  const a = working('ABC-1')
  w.folder.put('a.json', a)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  await minutesPass(w, 1, { 'a.json': a })
  await minutesPass(w, 1, { 'a.json': working('ABC-1', { pr: pr(7, 'OPEN') }) })
  const pane = await ui.paneText()
  expect(pane).toContain('ABC-1 opened pull request #7.')
  expect(pane).toContain('Could not raise a notification (disabled): ABC-1 opened pull request #7.')
  expect(await ui.bandText()).toContain('ABC-1 opened pull request #7.')
  expect(w.engine.prompts).toEqual([])
})
