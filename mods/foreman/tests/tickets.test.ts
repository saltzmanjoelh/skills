import { expect, test } from 'claude-code/testing'

import { recordIn } from '../hooks/record'
import type { SubRow } from '../hooks/subs'
import { briefFor, FORK_REFUSAL, joinOwners, localIdIn, newPairing, shownRows, ticketsIn, TICKETS_EMPTY } from '../hooks/tickets'
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
  expect(briefFor({ prompt: 'Do ABC-1.\n\n', context: 'fresh' }, 'u-1')).toEqual({ kind: 'add', ticket: 'ft-u-1', prompt: 'Do ABC-1.\n\nforeman-ticket: ft-u-1' })
  expect(briefFor({ proposal_id: 'p' }, 'u-1')).toEqual({ kind: 'pass' })
  expect(briefFor({ prompt: '   ' }, 'u-1')).toEqual({ kind: 'pass' })
  expect(briefFor({ context: 'fork' }, 'u-1')).toEqual({ kind: 'deny', text: FORK_REFUSAL })
  expect(briefFor({ prompt: 'Do it.', context: 'fork' }, 'u-1')).toEqual({ kind: 'deny', text: FORK_REFUSAL })
})

test('the first local_ id in a result is the session it started, and a result without one names none', () => {
  expect(localIdIn('Started "x" as local_ab-12_c (name: x).')).toBe('local_ab-12_c')
  expect(localIdIn('A proposal card is shown.')).toBeNull()
})

test('a stored ledger in any other shape reads as empty, and a pairing with a bad field keeps its default', () => {
  expect(ticketsIn(undefined)).toEqual(TICKETS_EMPTY)
  expect(ticketsIn('garbage')).toEqual(TICKETS_EMPTY)
  const read = ticketsIn({ pairings: [{ ticket: 'ft-a', standing: 'odd', localId: 7 }, { ticket: 3 }, null], freedWhilePaused: true })
  expect(read.freedWhilePaused).toBe(true)
  expect(read.pairings).toHaveLength(1)
  expect(read.pairings[0]!.standing).toBe('active')
  expect(read.pairings[0]!.localId).toBeNull()
  expect(read.pairings[0]!.acts.stretch).toBeNull()
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
