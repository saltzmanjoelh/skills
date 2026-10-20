// The tickets a parent issues and the sub sessions they pair with: the line
// added to a start_session brief, the desktop session id read from its
// answer, the ledger as the store keeps it, which record owns each ticket,
// and which rows show. Every function is pure.

import type { ForemanActs, ForemanEffect, ForemanOutbox, ForemanPairing, ForemanStanding, ForemanTickets } from '../types'
import { byKeyThenFile, keyOf, nameOf, type SubRow } from './subs'
import { byTicket } from './wake'

// The line builder looks for in a sub session's first prompt.
export const TICKET_LINE = 'foreman-ticket:'

// Why a start_session call with forked context is refused. Builder reads the
// ticket from the first user message of the transcript, which in a forked
// session is the parent's own, so such a sub session would never show.
export const FORK_REFUSAL = 'foreman: start sub sessions with context "fresh", so the sub session finds its ticket in its first prompt and shows in foreman.'

// What a start_session call's arguments become: refused when the context is
// fork, passed unchanged when there is no brief to carry the line, or given
// the ticket line after a blank line at the end of the brief.
export type Brief = { kind: 'deny'; text: string } | { kind: 'pass' } | { kind: 'add'; prompt: string; ticket: string }

export function briefFor(args: Record<string, unknown>, uuid: string): Brief {
  if (args.context === 'fork') return { kind: 'deny', text: FORK_REFUSAL }
  if (typeof args.prompt !== 'string' || args.prompt.trim() === '') return { kind: 'pass' }
  const ticket = `ft-${uuid}`
  return { kind: 'add', ticket, prompt: `${args.prompt.replace(/\s+$/, '')}\n\n${TICKET_LINE} ${ticket}` }
}

// The first desktop session id in a start_session answer, or null when it
// names none, as for a proposal card, which starts no session yet.
export function localIdIn(text: string): string | null {
  return /local_[A-Za-z0-9_-]+/.exec(typeof text === 'string' ? text : '')?.[0] ?? null
}

// The store key that holds a parent's ledger.
export const ticketsKey = (sessionId: string) => `tickets:${sessionId}`

export const OUTBOX_EMPTY: ForemanOutbox = { logs: [], effects: [], lines: [] }

export const TICKETS_EMPTY: ForemanTickets = { pairings: [], freedWhilePaused: false, folderMissing: false, outbox: OUTBOX_EMPTY }

// Whether the outbox holds anything to carry out.
export const hasWork = (o: ForemanOutbox) => o.logs.length > 0 || o.effects.length > 0 || o.lines.length > 0

// The outbox with `more` added after what it already holds.
export const addWork = (o: ForemanOutbox, more: ForemanOutbox): ForemanOutbox => (hasWork(more)
  ? { logs: [...o.logs, ...more.logs], effects: [...o.effects, ...more.effects], lines: [...o.lines, ...more.lines] }
  : o)

const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])

function effectIn(raw: unknown): ForemanEffect | null {
  const e = objectOf(raw)
  if (e?.kind === 'notify' && typeof e.text === 'string') return { kind: 'notify', text: e.text }
  if (e?.kind === 'nudge' && typeof e.ticket === 'string' && typeof e.to === 'string' && typeof e.name === 'string') {
    return { kind: 'nudge', ticket: e.ticket, to: e.to, name: e.name }
  }
  return null
}

function outboxIn(raw: unknown): ForemanOutbox {
  const o = objectOf(raw)
  if (o === null) return OUTBOX_EMPTY
  return { logs: strings(o.logs), effects: Array.isArray(o.effects) ? o.effects.flatMap(e => effectIn(e) ?? []) : [], lines: strings(o.lines) }
}

export const ACTS_FRESH: ForemanActs = { episode: null, stretch: null, notifiedFor: null, cleanupWokeFor: null, goneWokeFor: null }

// The most pairings kept. Past it, freed and released pairings go first,
// oldest first; an active pairing is never dropped.
export const MAX_PAIRINGS = 200

// How many other session ids with the same ticket a pairing remembers.
const MAX_FORKS = 10

export function newPairing(ticket: string, localId: string | null, at: number): ForemanPairing {
  return { ticket, localId, pairedAt: at, owner: null, ownerFile: null, issueKey: null, standing: 'active', forks: [], acts: ACTS_FRESH }
}

const STANDINGS: readonly ForemanStanding[] = ['active', 'freed', 'released']
const textOr = <T>(raw: unknown, fallback: T): string | T => (typeof raw === 'string' && raw !== '' ? raw : fallback)
const numberOr = <T>(raw: unknown, fallback: T): number | T => (typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback)
const objectOf = (raw: unknown): Record<string, unknown> | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null)

function actsIn(raw: unknown): ForemanActs {
  const a = objectOf(raw)
  if (a === null) return ACTS_FRESH
  const e = objectOf(a.episode)
  const s = objectOf(a.stretch)
  return {
    episode: e !== null && typeof e.state === 'string' && typeof e.since === 'number' ? { state: e.state, since: e.since } : null,
    stretch: s !== null && typeof s.progress === 'string'
      ? { progress: s.progress, nudges: Math.max(Math.floor(numberOr(s.nudges, 0)), 0), lastNudgeAt: numberOr(s.lastNudgeAt, null), woke: s.woke === true }
      : null,
    notifiedFor: textOr(a.notifiedFor, null),
    cleanupWokeFor: textOr(a.cleanupWokeFor, null),
    goneWokeFor: numberOr(a.goneWokeFor, null),
  }
}

function pairingIn(raw: unknown): ForemanPairing | null {
  const p = objectOf(raw)
  if (p === null || typeof p.ticket !== 'string' || p.ticket === '') return null
  return {
    ticket: p.ticket,
    localId: textOr(p.localId, null),
    pairedAt: numberOr(p.pairedAt, 0),
    owner: textOr(p.owner, null),
    ownerFile: textOr(p.ownerFile, null),
    issueKey: textOr(p.issueKey, null),
    standing: STANDINGS.includes(p.standing as ForemanStanding) ? p.standing as ForemanStanding : 'active',
    forks: Array.isArray(p.forks) ? p.forks.filter((f): f is string => typeof f === 'string').slice(-MAX_FORKS) : [],
    acts: actsIn(p.acts),
  }
}

// A stored ledger read tolerantly: a value in any other shape, such as none
// at all from a parent of the read-only build, reads as empty, and a pairing
// without a ticket is dropped while any other bad field takes its default.
export function ticketsIn(raw: unknown): ForemanTickets {
  const t = objectOf(raw)
  if (t === null) return TICKETS_EMPTY
  const pairings = Array.isArray(t.pairings) ? t.pairings.flatMap(p => pairingIn(p) ?? []) : []
  return { pairings, freedWhilePaused: t.freedWhilePaused === true, folderMissing: t.folderMissing === true, outbox: outboxIn(t.outbox) }
}

// The ledger with the pairings past MAX_PAIRINGS dropped, freed and released
// ones first and the oldest of those first.
export function capped(t: ForemanTickets): ForemanTickets {
  if (t.pairings.length <= MAX_PAIRINGS) return t
  const done = t.pairings.filter(p => p.standing !== 'active').sort((a, b) => a.pairedAt - b.pairedAt)
  const drop = new Set(done.slice(0, t.pairings.length - MAX_PAIRINGS))
  return { ...t, pairings: t.pairings.filter(p => !drop.has(p)) }
}

// Whether `row` is the one that owns pairing `p`.
export const ownsTicket = (p: ForemanPairing, row: SubRow) => p.owner !== null && row.record.sessionId === p.owner && row.record.ticket === p.ticket

// Joins records to pairings. A pairing with no owner yet takes as its owner
// the first row, in file name order, that has its ticket and, when the
// pairing has a local_ id, whose desktop session id is that id. When the
// pairing had no local_ id, it takes the owner's. Each other row with the
// same ticket, as a fork of the sub session writes, is left out, and logged
// the first time it is seen. The owner's issue key is kept up to date for
// the log.
export function joinOwners(t: ForemanTickets, rows: readonly SubRow[]): { tickets: ForemanTickets; logs: string[] } {
  const logs: string[] = []
  const byFile = [...rows].sort((a, b) => byKeyThenFile(null, a.file, null, b.file))
  const pairings = t.pairings.map(p => {
    let next = p
    if (next.owner === null) {
      const found = byFile.find(r => r.record.ticket === p.ticket && (p.localId === null || r.record.desktopSessionId === p.localId))
      if (found !== undefined) {
        next = { ...next, owner: found.record.sessionId, ownerFile: found.file, localId: p.localId ?? found.record.desktopSessionId ?? null }
      }
    }
    if (next.owner === null) return next
    const own = byFile.find(r => ownsTicket(next, r))
    if (own !== undefined && own.record.issueKey !== next.issueKey) next = { ...next, issueKey: own.record.issueKey === null ? null : keyOf(own) }
    const forks = byFile.filter(r => r.record.ticket === p.ticket && r.record.sessionId !== next.owner && !next.forks.includes(r.record.sessionId))
    if (forks.length > 0) {
      const name = own === undefined ? byTicket(p.ticket) : nameOf(own)
      logs.push(...forks.map(() => `Left out a second status file with the ticket of ${name}, as a fork of its session writes.`))
      next = { ...next, forks: [...next.forks, ...forks.map(r => r.record.sessionId)].slice(-MAX_FORKS) }
    }
    return next
  })
  return { tickets: { ...t, pairings }, logs }
}

// The rows the band and the pane show: each row that owns a ticket of this
// parent that was not freed, with a released one marked. A row with another
// parent's ticket, or none, is not shown.
export function shownRows(rows: readonly SubRow[], t: ForemanTickets): SubRow[] {
  return rows.flatMap(row => {
    const p = t.pairings.find(q => ownsTicket(q, row))
    if (p === undefined || p.standing === 'freed') return []
    return [p.standing === 'released' ? { ...row, isReleased: true } : row]
  })
}
