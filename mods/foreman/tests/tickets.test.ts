import { expect, test } from 'claude-code/testing'

import { recordIn } from '../hooks/record'
import type { SubRow } from '../hooks/subs'
import {
  carriesTicket, fallbackOf, noTicketLog,
  briefFor, capped, FORK_REFUSAL, isOffRefused, joinOwners, localIdIn, MAX_PAIRINGS, newPairing, nextPlace, NO_TICKET_SENTENCE, OFF_REFUSAL, queueOf, runsImplement, shownRows, ticketsIn,
  TICKETS_EMPTY, TITLE_REFUSAL, WAIT_LINE, waitingBrief, WAITING_SENTENCE, withOffRefusal, withUnwatched,
} from '../hooks/tickets'
import { BEGIN_TEXT } from '../hooks/desktop'
import type { ForemanTickets } from '../types'

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)

// A row for a record with `over` changing its fields.
function row(file: string, over: Record<string, unknown> = {}): SubRow {
  const record = recordIn(JSON.stringify({
    sessionId: `s-${file}`, ticket: 'ft-a', cwd: '/w', issueKey: 'ABC-1', issueTitle: 't', stage: null, stageDone: 0,
    pr: null, state: 'working', reason: '', stateSince: T0, writtenAt: T0, ...over,
  }))!
  return { file, record, mtimeMs: T0, isStale: false }
}

const withPairings = (...pairings: ForemanTickets['pairings']): ForemanTickets => ({ ...TICKETS_EMPTY, pairings })

test('the ticket line is added after a blank line, a call with no brief passes, and a fork is refused first', () => {
  expect(briefFor({ prompt: 'Do ABC-1.\n\n', context: 'fresh', title: 'ABC-1: x' }, 'u-1')).toEqual({ kind: 'add', ticket: 'ft-u-1', prompt: 'Do ABC-1.\n\nforeman-ticket: ft-u-1' })
  expect(briefFor({ proposal_id: 'p' }, 'u-1')).toEqual({ kind: 'pass' })
  expect(briefFor({ prompt: '   ', title: 'ABC-1: x' }, 'u-1')).toEqual({ kind: 'pass' })
  expect(briefFor({ context: 'fork' }, 'u-1')).toMatchObject({ kind: 'deny', text: FORK_REFUSAL })
  expect(briefFor({ prompt: 'Do it.', context: 'fork', title: 'Implement ABC-1' }, 'u-1')).toMatchObject({ kind: 'deny', text: FORK_REFUSAL })
})

// What briefFor answers for a call with a brief and the title given.
const titled = (title: unknown) => briefFor({ prompt: 'Do it.', context: 'fresh', title }, 'u-1')

test('a title passes only when it begins with an issue key and a space or a colon', () => {
  for (const good of ['ABC-123: x', 'ABC-123 x', 'A1-2:', 'ABC-7 ']) {
    expect(titled(good)).toEqual({ kind: 'add', ticket: 'ft-u-1', prompt: 'Do it.\n\nforeman-ticket: ft-u-1' })
  }
  const bad = ['Implement ABC-123: x', 'ABC-123', 'abc-123: x', 'ABC-123-fix: x', ' ABC-1: x', 'ABC-: x', '1BC-2: x', 'ABC-1\tx', 'ABC-\uFF11: x', '', 'no issue: x', 'No issue:x']
  for (const title of [...bad, undefined, null, 7, [], {}]) expect(titled(title)).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
})

test('the "No issue: " marker is replaced by the ticket on a call with a brief, and refused on one without', () => {
  expect(titled('No issue: ABC-12 cleanup')).toEqual({ kind: 'add', ticket: 'ft-u-1', prompt: 'Do it.\n\nforeman-ticket: ft-u-1', title: 'ft-u-1: ABC-12 cleanup' })
  expect(briefFor({ title: 'No issue: tidy' }, 'u-1')).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
  expect(briefFor({ prompt: '  ', title: 'No issue: tidy' }, 'u-1')).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
})

test('only a proposal started by its id with no title skips the check', () => {
  expect(briefFor({ proposal_id: 'p', title: null }, 'u-1')).toEqual({ kind: 'pass' })
  expect(briefFor({ proposal_id: 'p', title: 'Implement ABC-1' }, 'u-1')).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
  expect(briefFor({ proposal_id: 'p', title: '' }, 'u-1')).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
  expect(briefFor({ proposal_id: '' }, 'u-1')).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
  expect(briefFor({ title: 'Implement ABC-1', initiation: 'offer' }, 'u-1')).toMatchObject({ kind: 'deny', text: TITLE_REFUSAL })
})

test('briefFor never throws, and never lets a title of the wrong shape go on, whatever the arguments hold', () => {
  const odd: unknown[] = [undefined, null, 0, '', '  ', [], {}, Symbol('s'), 'x']
  const keyed = /^[A-Z][A-Z0-9]*-[0-9]+[ :]/
  for (const title of [...odd, 'ABC-1: x', 'No issue: x']) {
    for (const prompt of odd) {
      for (const proposal_id of odd) {
        for (const context of [...odd, 'fork', 'fresh']) {
          const args = { title, prompt, proposal_id, context }
          const out = briefFor(args, 'u-1')
          if (out.kind === 'deny') continue
          const outTitle = out.kind === 'add' && out.title !== undefined ? out.title : title
          const fromProposal = typeof proposal_id === 'string' && proposal_id !== '' && (title === undefined || title === null)
          expect(fromProposal || (typeof outTitle === 'string' && (keyed.test(outTitle) || outTitle.startsWith('ft-u-1: ')))).toBe(true)
        }
      }
    }
  }
})

test('the first local_ id in a result is the session it started, and a result without one names none', () => {
  expect(localIdIn('Started "x" as local_ab-12_c (name: x).')).toBe('local_ab-12_c')
  expect(localIdIn('A proposal card is shown.')).toBeNull()
})

test('a stored ledger in any other shape reads as empty, and a pairing with a bad field keeps its default', () => {
  expect(ticketsIn(undefined)).toEqual(TICKETS_EMPTY)
  expect(ticketsIn('garbage')).toEqual(TICKETS_EMPTY)
  const read = ticketsIn({ pairings: [{ ticket: 'ft-a', standing: 'odd', localId: 7 }, { ticket: 3 }, null], freedWhilePaused: true })
  expect(read).not.toHaveProperty('freedWhilePaused')
  expect(read.pairings).toHaveLength(1)
  expect(read.pairings[0]!.standing).toBe('active')
  expect(read.pairings[0]!.localId).toBeNull()
  expect(read.pairings[0]!.acts.stretch).toBeNull()
  const outbox = ticketsIn({ outbox: { logs: ['a', 3], effects: [{ kind: 'notify', text: 'n' }, { kind: 'nudge', to: 'x' }], lines: 'no' } }).outbox
  expect(outbox).toEqual({ logs: ['a'], effects: [{ kind: 'notify', text: 'n' }], lines: [] })
})

test('a new pairing has announced nothing, with the number, the state and the verdicts all null', () => {
  expect(newPairing('ft-a', null, 1).acts.announced).toEqual({ number: null, state: null, verdicts: null })
})

test('a stored pairing without acts, or with acts that have no announced field, reads with no milestone memory', () => {
  const stored = (acts: unknown) => ticketsIn({ pairings: [{ ticket: 'ft-a', acts }] }).pairings[0]!.acts.announced
  expect(ticketsIn({ pairings: [{ ticket: 'ft-a' }] }).pairings[0]!.acts.announced).toBeNull()
  expect(stored({ episode: null })).toBeNull()
  expect(stored({ announced: null })).toBeNull()
})

test('a stored milestone memory reads back only when every field is sound, and as none otherwise', () => {
  const stored = (announced: unknown) => ticketsIn({ pairings: [{ ticket: 'ft-a', acts: { announced } }] }).pairings[0]!.acts.announced
  const good = { number: 7, state: 'MERGED', verdicts: { sha: 'abc1234', spec: 'APPROVE', adversarial: 'REQUEST_CHANGES' } }
  expect(stored(good)).toEqual(good)
  expect(stored({ number: null, state: null, verdicts: null })).toEqual({ number: null, state: null, verdicts: null })
  expect(stored({ ...good, state: 'OPEN', verdicts: null })).toEqual({ ...good, state: 'OPEN', verdicts: null })
  for (const bad of [
    'yes', [], { ...good, number: 0 }, { ...good, number: 2.5 }, { ...good, number: '7' }, { ...good, state: 'open' }, { ...good, state: 'unknown' },
    { ...good, verdicts: { sha: 'abc', spec: 'APPROVE', adversarial: 'APPROVE' } }, { ...good, verdicts: 'APPROVE' },
    { state: 'OPEN', verdicts: null }, { number: 7, verdicts: null }, { number: 7, state: 'OPEN' },
  ]) expect(stored(bad)).toBeNull()
})

test('an old ledger holds no keys, and a held entry that is not an issue key or comes again is dropped', () => {
  expect(ticketsIn({ pairings: [], folderMissing: false }).held).toEqual([])
  expect(ticketsIn({ held: 'ABC-1' }).held).toEqual([])
  expect(ticketsIn({ held: ['ABC-1', 'ABC-1', 'abc-2', 'ABC-3: x', 7, null, 'ABC-4'] }).held).toEqual(['ABC-1', 'ABC-4'])
})

test('the record whose desktop session is the one start_session named owns the ticket, even when another sorts first', () => {
  const p = newPairing('ft-a', 'local_b', T0)
  const out = joinOwners(withPairings(p), [row('a.json', { desktopSessionId: 'local_a' }), row('b.json', { desktopSessionId: 'local_b' })])
  expect(out.tickets.pairings[0]!.owner).toBe('s-b.json')
  expect(out.tickets.pairings[0]!.ownerFile).toBe('b.json')
  expect(out.logs).toEqual(['Left out a second status file with the ticket of ABC-1, as a fork of its session writes.'])
})

test('without a local_ id, the record whose file sorts first owns the ticket and its desktop id is kept', () => {
  const out = joinOwners(withPairings(newPairing('ft-a', null, T0)), [row('b.json', { desktopSessionId: 'local_b' }), row('a.json', { desktopSessionId: 'local_a' })])
  expect(out.tickets.pairings[0]!.owner).toBe('s-a.json')
  expect(out.tickets.pairings[0]!.localId).toBe('local_a')
})

test('a fork is logged once, and not again on the next read', () => {
  const rows = [row('a.json', { desktopSessionId: 'local_a' }), row('b.json', { desktopSessionId: 'local_b' })]
  const first = joinOwners(withPairings(newPairing('ft-a', 'local_a', T0)), rows)
  expect(first.logs).toHaveLength(1)
  const second = joinOwners(first.tickets, rows)
  expect(second.logs).toEqual([])
  expect(second.tickets.pairings[0]!.forks).toEqual(['s-b.json'])
})

test('only the rows that own a ticket of this parent show, a released one marked, and a freed one not at all', () => {
  const rows = [row('a.json'), row('b.json', { ticket: 'ft-other' }), row('c.json', { ticket: null }), row('d.json', { ticket: 'ft-d' }), row('e.json', { ticket: 'ft-e' })]
  const joined = joinOwners(withPairings(newPairing('ft-a', null, T0), newPairing('ft-d', null, T0), newPairing('ft-e', null, T0)), rows).tickets
  joined.pairings[1]!.standing = 'released'
  joined.pairings[2]!.standing = 'freed'
  const shown = shownRows(rows, joined)
  expect(shown.map(r => [r.file, r.isReleased === true])).toEqual([['a.json', false], ['d.json', true]])
})

test('past the most pairings kept, the oldest freed and released ones go first and an active one never goes', () => {
  const active = Array.from({ length: MAX_PAIRINGS - 2 }, (_, i) => newPairing(`ft-active-${i}`, null, T0 - 5000 - i))
  const done = [
    { ...newPairing('ft-released-new', null, T0 + 1000), standing: 'released' as const },
    { ...newPairing('ft-freed-old', null, T0 - 1000), standing: 'freed' as const },
    { ...newPairing('ft-freed-middle', null, T0), standing: 'freed' as const },
  ]
  const kept = capped(withPairings(...done, ...active, newPairing('ft-active-last', null, T0 - 9000)))
  expect(kept.pairings).toHaveLength(MAX_PAIRINGS)
  expect(kept.pairings.filter(p => p.standing !== 'active').map(p => p.ticket)).toEqual(['ft-released-new'])
  expect(kept.pairings.filter(p => p.standing === 'active')).toHaveLength(MAX_PAIRINGS - 1)
  const under = withPairings(...done)
  expect(capped(under)).toBe(under)
})

test('a ticket carried by many fork files settles after one read, logging each fork once', () => {
  const rows = [row('a.json', { desktopSessionId: 'local_a' }), ...Array.from({ length: 12 }, (_, i) => row(`f${i}.json`, { desktopSessionId: `local_f${i}` }))]
  const first = joinOwners(withPairings(newPairing('ft-a', 'local_a', T0)), rows)
  expect(first.logs).toHaveLength(12)
  const second = joinOwners(first.tickets, rows)
  expect(second.logs).toEqual([])
  expect(second.tickets).toEqual(first.tickets)
})

test('an old ledger reads with no refusal given and no unwatched sub sessions', () => {
  const old = ticketsIn({ pairings: [], folderMissing: false, outbox: { logs: [], effects: [], lines: [] }, held: [] })
  expect(old.offRefusedFor).toBeNull()
  expect(old.unwatched).toEqual([])
  expect(TICKETS_EMPTY.offRefusedFor).toBeNull()
  expect(TICKETS_EMPTY.unwatched).toEqual([])
})

test('old acts read with no unseen wake given and a stretch without a wait as an idle one', () => {
  const acts = ticketsIn({ pairings: [{ ticket: 'ft-a', acts: { stretch: { progress: 'p', nudges: 1, lastNudgeAt: 5, woke: false } } }] }).pairings[0]!.acts
  expect(acts.unseenWoke).toBe(false)
  expect(acts.stretch).toEqual({ progress: 'p', nudges: 1, lastNudgeAt: 5, countFrom: null, woke: false, wait: null })
  const stored = (raw: Record<string, unknown>) => ticketsIn({ pairings: [{ ticket: 'ft-a', acts: raw }] }).pairings[0]!.acts
  expect(stored({ unseenWoke: true }).unseenWoke).toBe(true)
  expect(stored({ unseenWoke: 'yes' }).unseenWoke).toBe(false)
  expect(stored({ stretch: { progress: 'p', nudges: 0, lastNudgeAt: null, woke: false, wait: 1500 } }).stretch?.wait).toBe(1500)
  expect(stored({ stretch: { progress: 'p', nudges: 0, lastNudgeAt: null, countFrom: 1700, woke: false, wait: 1500 } }).stretch?.countFrom).toBe(1700)
  expect(stored({ stretch: { progress: 'p', nudges: 0, lastNudgeAt: null, woke: false, wait: 'then' } }).stretch?.wait).toBeNull()
  expect(newPairing('ft-a', null, 1).acts.unseenWoke).toBe(false)
})

test('a stored nudge keeps its kind only when it is exactly background', () => {
  const effects = (about: unknown) => ticketsIn({ outbox: { effects: [{ kind: 'nudge', to: 'local_a', name: 'ABC-1', about }] } }).outbox.effects
  expect(effects('background')).toEqual([{ kind: 'nudge', to: 'local_a', name: 'ABC-1', about: 'background' }])
  for (const other of [undefined, null, 'idle', 'Background', 7]) {
    expect(effects(other)).toEqual([{ kind: 'nudge', to: 'local_a', name: 'ABC-1' }])
    expect(effects(other)[0]).not.toHaveProperty('about')
  }
})

test('the refusal is read as the session id it was given for, and counts only for that session', () => {
  expect(ticketsIn({ offRefusedFor: 'session-1' }).offRefusedFor).toBe('session-1')
  for (const bad of ['', 7, true, null, ['session-1']]) expect(ticketsIn({ offRefusedFor: bad }).offRefusedFor).toBeNull()
  const refused = withOffRefusal(TICKETS_EMPTY, 'session-1')
  expect(isOffRefused(refused, 'session-1')).toBe(true)
  expect(isOffRefused(refused, 'session-2')).toBe(false)
  expect(isOffRefused(TICKETS_EMPTY, 'session-1')).toBe(false)
  expect(ticketsIn(JSON.parse(JSON.stringify(refused))).offRefusedFor).toBe('session-1')
})

test('the unwatched list keeps only whole local_ ids, each once, the newest 50', () => {
  expect(ticketsIn({ unwatched: 'local_a' }).unwatched).toEqual([])
  expect(ticketsIn({ unwatched: ['local_a', 'local_a', 'local_b', 'Local_c', 'local_', 'x local_d', 'local_e f', 'local_g!', 7, null, 'local_h-1_x'] }).unwatched)
    .toEqual(['local_a', 'local_b', 'local_h-1_x'])
  const many = Array.from({ length: 60 }, (_, i) => `local_${i}`)
  expect(ticketsIn({ unwatched: many }).unwatched).toEqual(many.slice(10))
  let t = TICKETS_EMPTY
  for (const id of many) t = withUnwatched(t, id)
  expect(t.unwatched).toEqual(many.slice(10))
  const once = withUnwatched(TICKETS_EMPTY, 'local_a')
  expect(withUnwatched(once, 'local_a')).toBe(once)
  expect(withUnwatched(once, 'not an id')).toBe(once)
  expect(withUnwatched(once, 'local_b').unwatched).toEqual(['local_a', 'local_b'])
})

test('a brief runs /implement only when it holds /implement as a word', () => {
  for (const prompt of ['/implement ABC-1', 'Run /implement ABC-1 please.', 'Run `/implement` on it', '(/implement)', 'line one\n/implement', '/implement']) {
    expect(runsImplement({ prompt })).toBe(true)
  }
  for (const prompt of ['/implementation ABC-1', 'see skills/implement/SKILL.md', 'path/implement ABC-1', '../implement', '/implement-other', '/implemented', 'implement ABC-1', '']) {
    expect(runsImplement({ prompt })).toBe(false)
  }
  for (const prompt of [undefined, null, 7, ['/implement']]) expect(runsImplement({ prompt })).toBe(false)
  expect(runsImplement({ title: '/implement ABC-1' })).toBe(false)
})

test('the off refusal begins as foreman\'s lines do and says how to go on, and the no-ticket sentence says nobody watches', () => {
  expect(OFF_REFUSAL.startsWith('foreman: ')).toBe(true)
  for (const words of ['foreman is off in this session', 'no ticket', '/start-foreman', 'start_session again']) expect(OFF_REFUSAL).toContain(words)
  expect(NO_TICKET_SENTENCE).toContain('no ticket')
  expect(NO_TICKET_SENTENCE).toContain('foreman does not watch it')
})

test('a new pairing takes the issue key it is given, and a record with no key leaves it in place', () => {
  expect(newPairing('ft-a', 'local_a', T0).issueKey).toBeNull()
  const p = newPairing('ft-a', 'local_a', T0, 'ABC-9')
  expect(p.issueKey).toBe('ABC-9')
  const none = joinOwners(withPairings(p), [row('a.json', { desktopSessionId: 'local_a', issueKey: null })])
  expect(none.tickets.pairings[0]!.owner).toBe('s-a.json')
  expect(none.tickets.pairings[0]!.issueKey).toBe('ABC-9')
  const keyed = joinOwners(withPairings(p), [row('a.json', { desktopSessionId: 'local_a', issueKey: 'ABC-10' })])
  expect(keyed.tickets.pairings[0]!.issueKey).toBe('ABC-10')
})

test('a call carries a ticket line only when its prompt holds one at the start of a line', () => {
  expect(carriesTicket({ prompt: 'Run /implement ABC-123.\n\nforeman-ticket: ft-a' })).toBe(true)
  expect(carriesTicket({ prompt: 'Run /implement ABC-123.' })).toBe(false)
  expect(carriesTicket({ prompt: 'Mentions foreman-ticket: in a sentence.' })).toBe(false)
  expect(carriesTicket({})).toBe(false)
})

// The fallback cannot be reached with a call that went on and answered, so
// the decision it makes is checked here on its own.
test('the start_session fallback adds nothing to a call that went on, or to one that carries its ticket', () => {
  expect(fallbackOf(true, 'timeout', false, true)).toEqual({ log: null, sentence: false })
  expect(fallbackOf(true, 'throw', false, false)).toEqual({ log: null, sentence: false })
  expect(fallbackOf(false, 're-entry', true, true)).toEqual({ log: null, sentence: false })
})

test('the start_session fallback logs a call that went on without a ticket, and adds the sentence only when it started a sub session', () => {
  expect(fallbackOf(false, 'throw', false, true)).toEqual({ log: noTicketLog('throw'), sentence: true })
  expect(fallbackOf(false, 're-entry', false, true)).toEqual({ log: noTicketLog('re-entry'), sentence: true })
  expect(fallbackOf(false, 'timeout', false, false)).toEqual({ log: noTicketLog('timeout', false), sentence: false })
})

test('the spent list and the earlier total read back when sound, and a damaged list reads as empty with no earlier total', () => {
  const counts = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  const spent = [{ ticket: 'ft-a', counts, usd: 1.5 }, { ticket: 'ft-b', counts, usd: null }]
  const sound = ticketsIn({ spent, earlier: { counts, usd: 2 } })
  expect(sound.spent).toEqual(spent)
  expect(sound.earlier).toEqual({ counts, usd: 2 })
  for (const damaged of [undefined, null, 'lots', 7, { ft: 'a' }]) {
    const t = ticketsIn({ spent: damaged, earlier: damaged })
    expect(t.spent).toEqual([])
    expect(t.earlier).toBeNull()
  }
  // An entry that does not parse is dropped, and the rest are kept.
  const mixed = ticketsIn({ spent: [spent[0], null, { ticket: '', counts, usd: 1 }, { ticket: 'ft-c', counts: { ...counts, input: -1 }, usd: 1 }, { ticket: 'ft-d', counts, usd: 'one' }, { ticket: 'ft-e' }, spent[1]] })
  expect(mixed.spent).toEqual(spent)
  for (const bad of [{ counts }, { counts, usd: -1 }, { counts: { ...counts, output: 2.5 }, usd: 1 }, { usd: 1 }]) expect(ticketsIn({ earlier: bad }).earlier).toBeNull()
  // A ledger from before foreman kept spending reads with none.
  const old = ticketsIn({ pairings: [], folderMissing: false })
  expect(old.spent).toEqual([])
  expect(old.earlier).toBeNull()
  expect(TICKETS_EMPTY.spent).toEqual([])
  expect(TICKETS_EMPTY.earlier).toBeNull()
})

// The wait line and the begin message are the whole of what a waiting sub
// session is told, so both are pinned word for word.
test('the begin message is a fixed text that names no issue and does not begin as foreman\'s wake lines do', () => {
  expect(BEGIN_TEXT).toBe('foreman begins this session now: first bring your branch up to date with the base branch, with the desktop app\'s sync_with_base_branch tool, and then run the /implement command your brief gives. If you have already begun it, ignore this message.')
  expect(BEGIN_TEXT.startsWith('foreman: ')).toBe(false)
})

test('the wait line says to run /implement only once the begin message arrives, quotes that message, and does not begin with a slash', () => {
  expect(WAIT_LINE('ABC-2')).toBe(`Wait for foreman before you begin: run /implement ABC-2 only once foreman's begin message arrives, which reads exactly "${BEGIN_TEXT}" Until then, reply only that you wait, and make no change to any file, branch or issue.`)
  expect(WAIT_LINE('ABC-2').startsWith('/')).toBe(false)
  expect(WAIT_LINE('ABC-2').startsWith('foreman: ')).toBe(false)
})

test('a waiting brief puts the wait line first, before a brief that begins with /implement and before its ticket line', () => {
  const brief = briefFor({ prompt: '/implement ABC-2', context: 'fresh', title: 'ABC-2: x' }, 'u-1')
  if (brief.kind !== 'add') throw new Error('the brief should get a ticket')
  expect(waitingBrief('ABC-2', brief.prompt)).toBe(`${WAIT_LINE('ABC-2')}\n\n/implement ABC-2\n\nforeman-ticket: ft-u-1`)
  expect(carriesTicket({ prompt: waitingBrief('ABC-2', brief.prompt) })).toBe(true)
})

test('the sentence on a waiting start\'s answer says the issue is queued, not started', () => {
  expect(WAITING_SENTENCE('ABC-2')).toBe('ABC-2 waits in foreman\'s queue: its sub session begins by itself once a slot frees, so tell the person that ABC-2 is queued, not that it started.')
})

// A pairing waiting in the queue at `place`, with `claim` or none.
const waiting = (ticket: string, place: number, claim: { attemptAt: number; notified: boolean } | null = null, localId: string | null = `local_${ticket}`) => newPairing(ticket, localId, T0, null, { place, claim })

test('a ledger stored before the queue reads every pairing as not waiting', () => {
  expect(newPairing('ft-a', null, T0).queue).toBeNull()
  expect(ticketsIn({ pairings: [{ ticket: 'ft-a' }] }).pairings[0]!.queue).toBeNull()
  expect(ticketsIn({ pairings: [{ ticket: 'ft-a', queue: null }] }).pairings[0]!.queue).toBeNull()
  for (const bad of ['yes', 7, true, []]) expect(ticketsIn({ pairings: [{ ticket: 'ft-a', queue: bad }] }).pairings[0]!.queue).toBeNull()
})

test('a sound stored queue reads back, a damaged claim reads as none, and a damaged place reads as the back of the queue', () => {
  const read = (queue: unknown) => ticketsIn({ pairings: [{ ticket: 'ft-a', queue }] }).pairings[0]!.queue
  expect(read({ place: 2, claim: null })).toEqual({ place: 2, claim: null })
  expect(read({ place: 2, claim: { attemptAt: T0, notified: true } })).toEqual({ place: 2, claim: { attemptAt: T0, notified: true } })
  expect(read({ place: 2, claim: { attemptAt: T0, notified: 'yes' } })).toEqual({ place: 2, claim: { attemptAt: T0, notified: false } })
  for (const claim of ['now', 7, { notified: true }, { attemptAt: 'then' }]) expect(read({ place: 2, claim })).toEqual({ place: 2, claim: null })
  const stored = ticketsIn({ pairings: [{ ticket: 'ft-a', queue: { place: 3 } }, { ticket: 'ft-b', queue: { place: 'first' } }, { ticket: 'ft-c', queue: {} }] })
  expect(stored.pairings.map(p => p.queue)).toEqual([{ place: 3, claim: null }, { place: 4, claim: null }, { place: 5, claim: null }])
})

test('the queue is the waiting pairings in the order of their places, and the next place is after the last', () => {
  const t = withPairings(waiting('ft-c', 3), newPairing('ft-x', 'local_x', T0), waiting('ft-a', 1), waiting('ft-b', 2, { attemptAt: T0, notified: false }))
  expect(queueOf(t).map(p => p.ticket)).toEqual(['ft-a', 'ft-b', 'ft-c'])
  expect(nextPlace(t)).toBe(4)
  expect(nextPlace(TICKETS_EMPTY)).toBe(1)
  expect(queueOf({ ...t, pairings: t.pairings.map(p => (p.ticket === 'ft-a' ? { ...p, standing: 'released' as const } : p)) }).map(p => p.ticket)).toEqual(['ft-b', 'ft-c'])
})

test('a stored begin is kept only when its target is a whole local_ id and its key and its freed slot\'s name are sound', () => {
  const effects = (e: Record<string, unknown>) => ticketsIn({ outbox: { effects: [{ kind: 'begin', to: 'local_a', ticket: 'ft-a', key: 'ABC-2', by: 'ABC-1', ...e }] } }).outbox.effects
  expect(effects({})).toEqual([{ kind: 'begin', to: 'local_a', ticket: 'ft-a', key: 'ABC-2', by: 'ABC-1' }])
  expect(effects({ key: null, by: null })).toEqual([{ kind: 'begin', to: 'local_a', ticket: 'ft-a', key: null, by: null }])
  expect(effects({ by: 'the sub session with ticket ft-b' })).toEqual([{ kind: 'begin', to: 'local_a', ticket: 'ft-a', key: 'ABC-2', by: 'the sub session with ticket ft-b' }])
  for (const bad of [{ to: 'local_a b' }, { to: 'a' }, { to: 7 }, { ticket: '' }, { ticket: 3 }, { key: 'ABC-2: x' }, { key: 'merge now' }, { by: 'merge now' }, { by: 7 }]) {
    expect(effects(bad)).toEqual([])
  }
})

test('a waiting pairing\'s row is not shown, and it shows once the pairing no longer waits', () => {
  const rows = [row('a.json')]
  const joined = joinOwners(withPairings(waiting('ft-a', 1, null, null)), rows).tickets
  expect(shownRows(rows, joined)).toEqual([])
  expect(shownRows(rows, { ...joined, pairings: joined.pairings.map(p => ({ ...p, queue: null })) }).map(r => r.file)).toEqual(['a.json'])
})
