// The tickets a parent issues and the sub sessions they pair with: the line
// added to a start_session brief, the desktop session id read from its
// answer, the ledger as the store keeps it, which record owns each ticket,
// and which rows show. Every function is pure.

import type { ForemanActs, ForemanEffect, ForemanOutbox, ForemanPairing, ForemanStanding, ForemanTickets } from '../types'
import { byKeyThenFile, keyOf, nameOf, type SubRow } from './subs'
import { byTicket, KEY } from './wake'

// The line builder looks for in a sub session's first prompt.
export const TICKET_LINE = 'foreman-ticket:'

// Why a start_session call with forked context is refused. Builder reads the
// ticket from the first user message of the transcript, which in a forked
// session is the parent's own, so such a sub session would never show.
export const FORK_REFUSAL = 'foreman: start sub sessions with context "fresh", so the sub session finds its ticket in its first prompt and shows in foreman.'

// The marker a title begins with when its work has no issue. Foreman puts the
// ticket it issues in place of the marker, so the wake skill can find the sub
// session by the ticket at the start of its title.
export const NO_ISSUE_MARKER = 'No issue: '

// Why a start_session call is refused for its title. Foreman and its wake
// skill find a sub session by the issue key, or the ticket, at the start of
// its title.
export const TITLE_REFUSAL = 'foreman: start sub sessions with a title that begins with the issue key followed by a space or a colon, such as "ABC-123: short name", or, for work with no issue, with "No issue: short name" and a brief, so that foreman and its wake skill can find the sub session by its title.'

// The log lines for each refusal.
const FORK_LOG = 'Refused a start_session call with forked context, because its sub session could not find its ticket.'
export const TITLE_LOG = 'Refused a start_session call, because its title did not begin with an issue key and a space or a colon, or with "No issue: " on a call with a brief.'

// A title that begins with an issue key followed by a space or a colon. A
// hyphen does not count, so ABC-1-fix is never read as ABC-1.
const KEYED_TITLE = new RegExp(`^${KEY}[ :]`)

// What a start_session call's arguments become: refused when the context is
// fork or the title has the wrong shape, passed unchanged when there is no
// brief to carry the line, or given the ticket line after a blank line at the
// end of the brief, with a "No issue: " title's marker replaced by the ticket.
export type Brief =
  | { kind: 'deny'; text: string; log: string }
  | { kind: 'pass' }
  | { kind: 'add'; prompt: string; ticket: string; title?: string }

// Every check reads its argument's type first, because the hook passes a call
// on unchanged when it throws, which would let a bad title through.
export function briefFor(args: Record<string, unknown>, uuid: string): Brief {
  if (args.context === 'fork') return { kind: 'deny', text: FORK_REFUSAL, log: FORK_LOG }
  const title = typeof args.title === 'string' ? args.title : null
  const brief = typeof args.prompt === 'string' && args.prompt.trim() !== '' ? args.prompt : null
  // A proposal started by its id alone keeps the title it was proposed with,
  // which this check saw when the proposal was made.
  const fromProposal = typeof args.proposal_id === 'string' && args.proposal_id !== '' && (args.title === undefined || args.title === null)
  // A title passes when it begins with an issue key and a space or a colon,
  // or with the marker on a call whose brief gets a ticket to replace it.
  const isKeyed = title !== null && KEYED_TITLE.test(title)
  const isMarked = title !== null && title.startsWith(NO_ISSUE_MARKER)
  if (!fromProposal) {
    if (!isKeyed && !isMarked) return { kind: 'deny', text: TITLE_REFUSAL, log: TITLE_LOG }
    if (isMarked && brief === null) return { kind: 'deny', text: TITLE_REFUSAL, log: TITLE_LOG }
  }
  if (brief === null) return { kind: 'pass' }
  const ticket = `ft-${uuid}`
  const prompt = `${brief.replace(/\s+$/, '')}\n\n${TICKET_LINE} ${ticket}`
  if (title === null || !isMarked) return { kind: 'add', ticket, prompt }
  return { kind: 'add', ticket, prompt, title: `${ticket}: ${title.slice(NO_ISSUE_MARKER.length)}` }
}

// The shape of a desktop session id, such as local_ab-12_c. The turn-end
// notes in hooks/notes.ts read ids with it too, so the two cannot drift.
export const LOCAL_ID = /local_[A-Za-z0-9_-]+/

// The first desktop session id in a start_session answer, or null when it
// names none, as for a proposal card, which starts no session yet.
export function localIdIn(text: string): string | null {
  return LOCAL_ID.exec(typeof text === 'string' ? text : '')?.[0] ?? null
}

// The store key that holds a parent's ledger.
export const ticketsKey = (sessionId: string) => `tickets:${sessionId}`

export const OUTBOX_EMPTY: ForemanOutbox = { logs: [], effects: [], lines: [] }

export const TICKETS_EMPTY: ForemanTickets = { pairings: [], folderMissing: false, outbox: OUTBOX_EMPTY }

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
  if (e?.kind === 'nudge' && typeof e.to === 'string' && typeof e.name === 'string') {
    return { kind: 'nudge', to: e.to, name: e.name }
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

// A pairing for a ticket just issued: active, with no owner yet and no
// action memory.
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
    forks: strings(p.forks),
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
  return { pairings, folderMissing: t.folderMissing === true, outbox: outboxIn(t.outbox) }
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
  // The rows of each ticket, in file name order, so each pairing looks only
  // at its own.
  const rowsByTicket = new Map<string, SubRow[]>()
  for (const r of [...rows].sort((a, b) => byKeyThenFile(null, a.file, null, b.file))) {
    if (r.record.ticket === null) continue
    const list = rowsByTicket.get(r.record.ticket)
    if (list === undefined) rowsByTicket.set(r.record.ticket, [r])
    else list.push(r)
  }
  const pairings = t.pairings.map(p => {
    const mine = rowsByTicket.get(p.ticket)
    if (mine === undefined) return p
    let next = p
    if (next.owner === null) {
      const found = mine.find(r => p.localId === null || r.record.desktopSessionId === p.localId)
      if (found !== undefined) {
        next = { ...next, owner: found.record.sessionId, ownerFile: found.file, localId: p.localId ?? found.record.desktopSessionId ?? null }
      }
    }
    if (next.owner === null) return next
    const own = mine.find(r => r.record.sessionId === next.owner)
    const key = own === undefined || own.record.issueKey === null ? next.issueKey : keyOf(own)
    if (key !== next.issueKey) next = { ...next, issueKey: key }
    const forks = mine.filter(r => r.record.sessionId !== next.owner && !next.forks.includes(r.record.sessionId))
    if (forks.length > 0) {
      const name = own === undefined ? byTicket(p.ticket) : nameOf(own)
      logs.push(...forks.map(() => `Left out a second status file with the ticket of ${name}, as a fork of its session writes.`))
      next = { ...next, forks: [...next.forks, ...forks.map(r => r.record.sessionId)] }
    }
    return next
  })
  return { tickets: { ...t, pairings }, logs }
}

// The rows the band and the pane show: each row that owns a ticket of this
// parent that was not freed, with a released one marked. A row with another
// parent's ticket, or none, is not shown.
export function shownRows(rows: readonly SubRow[], t: ForemanTickets): SubRow[] {
  const byOwner = new Map(t.pairings.flatMap(p => (p.owner === null ? [] : [[p.owner, p] as const])))
  return rows.flatMap(row => {
    const owned = byOwner.get(row.record.sessionId)
    const p = owned !== undefined && ownsTicket(owned, row) ? owned : undefined
    if (p === undefined || p.standing === 'freed') return []
    return [p.standing === 'released' ? { ...row, isReleased: true } : row]
  })
}
