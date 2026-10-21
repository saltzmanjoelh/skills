import { expect, test } from 'claude-code/testing'

import { recordIn } from '../hooks/record'
import type { SubRow } from '../hooks/subs'
import { briefFor, capped, FORK_REFUSAL, joinOwners, localIdIn, MAX_PAIRINGS, newPairing, shownRows, ticketsIn, TICKETS_EMPTY, TITLE_REFUSAL } from '../hooks/tickets'
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
