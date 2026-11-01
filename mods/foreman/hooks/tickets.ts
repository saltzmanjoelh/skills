// The tickets a parent issues and the sub sessions they pair with: the line
// added to a start_session brief, the desktop session id read from its
// answer, the ledger as the store keeps it, which record owns each ticket,
// and which rows show. Every function is pure.

import type { ForemanActs, ForemanEffect, ForemanOutbox, ForemanPairing, ForemanSpend, ForemanSpent, ForemanStanding, ForemanTickets } from '../types'
import { BEGIN_TEXT } from './desktop'
import { countsIn, isDollars, isPullRequestNumber, isPullRequestState, verdictsIn } from './record'
import { byKeyThenFile, keyOf, nameOf, type SubRow } from './subs'
import { byTicket, isTicket, isWholeKey, isWhoName, KEY, TICKET_PREFIX } from './wake'

// The line builder looks for in a sub session's first prompt.
export const TICKET_LINE = 'foreman-ticket:'

// The line after the ticket line that names the parent's session id, so the
// sub session's builder knows where to send its message that its status file
// changed. Builder reads it from the same first prompt as the ticket line.
export const PARENT_LINE = 'foreman-parent:'

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

// Why the first start_session call in a session that runs /implement is
// refused while the role is off. Without the role, the sub session gets no
// ticket, so builder writes no status file for foreman to read and nobody
// watches it. The refusal is given once per session, so a second call starts
// the sub session as the person chose.
export const OFF_REFUSAL = 'foreman: foreman is off in this session, so this sub session would get no ticket and nobody would watch it.'
  + ' Tell the person so in one line and wait for their answer before you call start_session again.'
  + ' The person can type /start-foreman to have it watched; if they want it started without foreman, calling start_session again starts it.'

// The sentence added to the answer of a start that went on without a ticket.
export const NO_TICKET_SENTENCE = 'This sub session has no ticket from foreman, so foreman does not watch it.'

// Why a start_session call went on without a ticket, for each way foreman's
// hook can fail before the call went on: it threw, ran out of time, or did
// not run because the call reached it again from beneath it. It is typed over
// every kind, so a kind the engine adds fails the type check until it has
// words here.
const NO_TICKET_WHY: Record<'throw' | 'timeout' | 're-entry', string> = {
  'throw': 'foreman\'s start_session hook threw an error before the call went on',
  'timeout': 'foreman\'s start_session hook ran out of time before the call went on',
  're-entry': 'the call reached foreman\'s start_session hook again from beneath it, which did not run',
}

// The log line for a start_session call that went on without a ticket,
// because foreman's hook failed before it could add one, worded by how it
// failed and by whether the call started a sub session.
export function noTicketLog(kind: keyof typeof NO_TICKET_WHY, started = true): string {
  return started
    ? `Started a sub session without a ticket, because ${NO_TICKET_WHY[kind]}, so foreman does not watch it.`
    : `A start_session call went on without a ticket and started no sub session, because ${NO_TICKET_WHY[kind]}.`
}

// What the start_session hook's fallback does once the hook failed: the log
// line to write, or null, and whether the answer gets the sentence that says
// foreman does not watch the sub session. A call that went on before the hook
// failed carried its ticket, and a call that reached the hook again from
// beneath it may carry the ticket the outer run added and pairs, so neither
// gets anything. Any other call went on without a ticket, so the log says why,
// and the sentence goes only on an answer that started a sub session.
export function fallbackOf(called: boolean, kind: keyof typeof NO_TICKET_WHY, carries: boolean, started: boolean): { log: string | null; sentence: boolean } {
  if (called || carries) return { log: null, sentence: false }
  return { log: noTicketLog(kind, started), sentence: started }
}

// Whether a start_session call's brief already holds a ticket line at the
// start of a line, as one that reached foreman's hook again from beneath it
// may, after the outer run of the hook added it.
export function carriesTicket(args: Record<string, unknown>): boolean {
  return typeof args.prompt === 'string' && new RegExp(`^[ \\t]*${TICKET_LINE}`, 'm').test(args.prompt)
}

// The log line for the off refusal.
export const OFF_LOG = 'Refused the first start_session call in this session whose brief runs /implement, because foreman is off.'

// The log lines for each refusal.
const FORK_LOG = 'Refused a start_session call with forked context, because its sub session could not find its ticket.'
export const TITLE_LOG = 'Refused a start_session call, because its title did not begin with an issue key and a space or a colon, or with "No issue: " on a call with a brief.'

// A title that begins with an issue key followed by a space or a colon, with
// the key as its first group. A hyphen does not count, so ABC-1-fix is never
// read as ABC-1. The hold in hooks/held.ts reads keys with it too.
export const KEYED_TITLE = new RegExp(`^(${KEY})[ :]`)

// What a start_session call's arguments become: refused when the context is
// fork or the title has the wrong shape, passed unchanged when there is no
// brief to carry the line, or given the ticket line after a blank line at the
// end of the brief and the parent line right after it, with a "No issue: "
// title's marker replaced by the ticket.
export type Brief =
  | { kind: 'deny'; text: string; log: string }
  | { kind: 'pass' }
  | { kind: 'add'; prompt: string; ticket: string; title?: string }

// Every check reads its argument's type first, because the hook passes a call
// on unchanged when it throws, which would let a bad title through.
export function briefFor(args: Record<string, unknown>, uuid: string, parentId: string): Brief {
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
  const ticket = `${TICKET_PREFIX}${uuid}`
  const prompt = `${brief.replace(/\s+$/, '')}\n\n${TICKET_LINE} ${ticket}\n${PARENT_LINE} ${parentId}`
  if (title === null || !isMarked) return { kind: 'add', ticket, prompt }
  return { kind: 'add', ticket, prompt, title: `${ticket}: ${title.slice(NO_ISSUE_MARKER.length)}` }
}

// The line put first in the brief of a start that waits, before the parent's
// own text, so that a brief which begins with /implement is never run as a
// command before the session reads it. It quotes the begin message exactly,
// so the sub session knows that message when it arrives. It does not begin
// with a slash or with "foreman: ".
export const WAIT_LINE = (key: string) => `Wait for foreman before you begin: run /implement ${key} only once foreman's begin message arrives, which reads exactly "${BEGIN_TEXT}" Until then, reply only that you wait, and make no change to any file, branch or issue.`

// The brief a waiting start goes on with: the wait line, a blank line, and
// the prompt briefFor made, which already ends with the ticket line and the
// parent line.
export const waitingBrief = (key: string, prompt: string) => `${WAIT_LINE(key)}\n\n${prompt}`

// The sentence added to the answer of a start that waits, so the parent does
// not tell the person that the issue started.
export const WAITING_SENTENCE = (key: string) => `${key} waits in foreman's queue: its sub session begins by itself once a slot frees, so tell the person that ${key} is queued, not that it started.`

// The shape of a desktop session id, such as local_ab-12_c. The turn-end
// notes in hooks/notes.ts read ids with it too, so the two cannot drift.
export const LOCAL_ID = /local_[A-Za-z0-9_-]+/

// The first desktop session id in a start_session answer, or null when it
// names none, as for a proposal card, which starts no session yet.
export function localIdIn(text: string): string | null {
  return LOCAL_ID.exec(typeof text === 'string' ? text : '')?.[0] ?? null
}

// Whether a start_session call's brief runs /implement: it holds `/implement`
// as a word, so neither /implementation nor a path that ends in
// /implement counts.
export function runsImplement(args: Record<string, unknown>): boolean {
  return typeof args.prompt === 'string' && /(?<![\w./-])\/implement(?![\w/-])/.test(args.prompt)
}

// The store key that holds a parent's ledger.
export const ticketsKey = (sessionId: string) => `tickets:${sessionId}`

export const OUTBOX_EMPTY: ForemanOutbox = { logs: [], effects: [], lines: [] }

export const TICKETS_EMPTY: ForemanTickets = { pairings: [], folderMissing: false, outbox: OUTBOX_EMPTY, held: [], offRefusedFor: null, unwatched: [], spent: [], earlier: null, keptSlots: [] }

// Whether the outbox holds anything to carry out.
export const hasWork = (o: ForemanOutbox) => o.logs.length > 0 || o.effects.length > 0 || o.lines.length > 0

// The outbox with `more` added after what it already holds.
export const addWork = (o: ForemanOutbox, more: ForemanOutbox): ForemanOutbox => (hasWork(more)
  ? { logs: [...o.logs, ...more.logs], effects: [...o.effects, ...more.effects], lines: [...o.lines, ...more.lines] }
  : o)

const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])

// Whether `raw` is null or a whole issue key.
const isKeyOrNull = (raw: unknown): raw is string | null => raw === null || (typeof raw === 'string' && isWholeKey(raw))

function effectIn(raw: unknown): ForemanEffect | null {
  const e = objectOf(raw)
  if (e?.kind === 'notify' && typeof e.text === 'string') return { kind: 'notify', text: e.text }
  // A begin goes only to a whole desktop session id for a whole ticket, and
  // the names it puts in the wake line are an issue key or a name whoOf gives.
  if (e?.kind === 'begin') {
    const { to, ticket, key, by } = e
    if (typeof to !== 'string' || !WHOLE_LOCAL_ID.test(to) || typeof ticket !== 'string' || !isTicket(ticket) || !isKeyOrNull(key)) return null
    return by === null || (typeof by === 'string' && isWhoName(by)) ? { kind: 'begin', to, ticket, key, by } : null
  }
  if (e?.kind === 'nudge' && typeof e.to === 'string' && typeof e.name === 'string') {
    // A nudge stored before a reload keeps its kind, so it is still sent with
    // the background text.
    return e.about === 'background' ? { kind: 'nudge', to: e.to, name: e.name, about: 'background' } : { kind: 'nudge', to: e.to, name: e.name }
  }
  return null
}

function outboxIn(raw: unknown): ForemanOutbox {
  const o = objectOf(raw)
  if (o === null) return OUTBOX_EMPTY
  return { logs: strings(o.logs), effects: Array.isArray(o.effects) ? o.effects.flatMap(e => effectIn(e) ?? []) : [], lines: strings(o.lines) }
}

// The milestone memory of a pairing that has announced nothing: no pull
// request, no state and no verdict pair.
export const ANNOUNCED_NONE: NonNullable<ForemanActs['announced']> = { number: null, state: null, verdicts: null }

// The acts of a pairing made now, which has announced nothing yet.
export const ACTS_FRESH: ForemanActs = {
  episode: null, stretch: null, notifiedFor: null, cleanupWokeFor: null, goneWokeFor: null, unseenWoke: false, announced: ANNOUNCED_NONE,
}

// The most pairings kept. Past it, freed and released pairings go first,
// oldest first; an active pairing is never dropped.
export const MAX_PAIRINGS = 200

// A pairing for a ticket just issued: active, with no owner yet and no
// action memory. `issueKey` is the key the start's title began with, if any,
// so a wake about a sub session that never wrote a status file names
// something the parent can find. An owner record's key replaces it.
// `queue` is where it waits, or null for a start that went ahead.
export function newPairing(ticket: string, localId: string | null, at: number, issueKey: string | null = null, queue: ForemanPairing['queue'] = null): ForemanPairing {
  return { ticket, localId, pairedAt: at, owner: null, ownerFile: null, issueKey, standing: 'active', forks: [], acts: ACTS_FRESH, queue }
}

const STANDINGS: readonly ForemanStanding[] = ['active', 'freed', 'released']
const textOr = <T>(raw: unknown, fallback: T): string | T => (typeof raw === 'string' && raw !== '' ? raw : fallback)
const numberOr = <T>(raw: unknown, fallback: T): number | T => (typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback)
const objectOf = (raw: unknown): Record<string, unknown> | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null)

// A stored milestone memory, or null, which stands for none, unless every
// field is sound: a positive whole number or null, one of the three states or
// null, and a verdict pair that verdictsIn keeps or null. A damaged memory
// is taken as none, so that the next read becomes the baseline rather than a
// cause to announce everything again.
function announcedIn(raw: unknown): ForemanActs['announced'] {
  const a = objectOf(raw)
  if (a === null) return null
  const { number, state } = a
  if (number !== null && !isPullRequestNumber(number)) return null
  if (state !== null && !isPullRequestState(state)) return null
  if (a.verdicts === null) return { number, state, verdicts: null }
  const verdicts = verdictsIn(a.verdicts)
  if (verdicts === null) return null
  return { number, state, verdicts }
}

// Stored acts read tolerantly. A pairing stored before foreman kept a
// milestone memory has none, and reads with none, which is not the same as a
// memory that has announced nothing. A stretch stored before stretches kept
// their wait reads as an idle one, one stored before stretches kept
// `turnProgress` reads as unmarked, and acts stored before the unseen wake
// read as not having given it.
function actsIn(raw: unknown): ForemanActs {
  const a = objectOf(raw)
  if (a === null) return { ...ACTS_FRESH, announced: null }
  const e = objectOf(a.episode)
  const s = objectOf(a.stretch)
  return {
    episode: e !== null && typeof e.state === 'string' && typeof e.since === 'number' ? { state: e.state, since: e.since } : null,
    stretch: s !== null && typeof s.progress === 'string'
      ? {
        progress: s.progress, nudges: Math.max(Math.floor(numberOr(s.nudges, 0)), 0), lastNudgeAt: numberOr(s.lastNudgeAt, null), woke: s.woke === true,
        countFrom: numberOr(s.countFrom, null), wait: numberOr(s.wait, null), turnProgress: s.turnProgress === true,
      }
      : null,
    notifiedFor: textOr(a.notifiedFor, null),
    cleanupWokeFor: textOr(a.cleanupWokeFor, null),
    goneWokeFor: numberOr(a.goneWokeFor, null),
    unseenWoke: a.unseenWoke === true,
    announced: announcedIn(a.announced),
  }
}

// A stored place in the queue read tolerantly. A queue that is still an
// object is kept as waiting, because the start's brief really carried the
// wait line, and a place in it that is not a number reads as NaN, which
// ticketsIn moves to the back of the queue. A claim without an attempt time
// reads as none, so the session is claimed afresh, which the begin message's
// last sentence makes harmless.
function queueIn(raw: unknown): ForemanPairing['queue'] {
  const q = objectOf(raw)
  if (q === null) return null
  const c = objectOf(q.claim)
  const attemptAt = numberOr(c?.attemptAt, null)
  return { place: numberOr(q.place, Number.NaN), claim: attemptAt === null ? null : { attemptAt, notified: c?.notified === true } }
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
    queue: queueIn(p.queue),
  }
}

// The pairings that wait in the queue, in its order: by place, then by when
// they were paired, then by ticket. Only an active pairing waits.
export function queueOf(t: ForemanTickets): ForemanPairing[] {
  return t.pairings
    .filter(p => p.queue !== null && p.standing === 'active')
    .sort((a, b) => a.queue!.place - b.queue!.place || a.pairedAt - b.pairedAt || (a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0))
}

// The sub sessions that wait in the queue and are not yet claimed for a
// slot, in the queue's order. Each of them is owed a slot before any new
// start goes ahead. One with no desktop session id is owed one only for
// `goneMs` after it was paired, while its start call may still be out: a
// start answered with a proposal card the person never starts would
// otherwise hold back a slot, and the slot wake, until it is forgotten a day
// later. Once its session starts, its status file gives it the id, and it is
// owed its slot again at its place.
export const waitingUnclaimed = (t: ForemanTickets, now: number, goneMs: number) =>
  queueOf(t).filter(p => p.queue!.claim === null && (p.localId !== null || now - p.pairedAt <= goneMs))

// The place a start that waits now takes: one after the last place in the
// queue, or 1 when nobody waits.
export const nextPlace = (t: ForemanTickets) => Math.max(0, ...queueOf(t).map(p => p.queue!.place)) + 1

// The pairings with each damaged place moved to the back of the queue, in
// the order they were stored.
function withPlaces(pairings: ForemanPairing[]): ForemanPairing[] {
  let last = Math.max(0, ...pairings.flatMap(p => (p.queue !== null && Number.isFinite(p.queue.place) ? [p.queue.place] : [])))
  return pairings.map(p => (p.queue === null || Number.isFinite(p.queue.place) ? p : { ...p, queue: { ...p.queue, place: (last += 1) } }))
}

// The held keys read tolerantly: only strings of the issue-key shape, each
// once, so a ledger from before holds existed reads as holding none.
const heldIn = (raw: unknown): string[] => [...new Set(strings(raw).filter(isWholeKey))]

// The most unwatched sub sessions kept, the newest ones.
export const MAX_UNWATCHED = 50

// A whole desktop session id with nothing around it, which is all an
// unwatched entry and a begin message's target may be.
const WHOLE_LOCAL_ID = new RegExp(`^${LOCAL_ID.source}$`)

// The unwatched ids read tolerantly: only whole desktop session ids, each
// once, the newest MAX_UNWATCHED, so a ledger from before the list existed
// reads as holding none.
const unwatchedIn = (raw: unknown): string[] => [...new Set(strings(raw).filter(id => WHOLE_LOCAL_ID.test(id)))].slice(-MAX_UNWATCHED)

// The kept slots read tolerantly: only names a wake line may carry, the
// newest MAX_PAIRINGS, so a ledger from before slots were kept reads as
// keeping none. A name may repeat, because two sub sessions can carry the
// same issue key and each freed a slot of its own.
const keptSlotsIn = (raw: unknown): string[] => strings(raw).filter(isWhoName).slice(-MAX_PAIRINGS)

// Stored spending, or null unless its counts are sound and its dollars are a
// dollar figure or null.
function spendIn(raw: unknown): ForemanSpend | null {
  const s = objectOf(raw)
  if (s === null) return null
  const counts = countsIn(s.counts)
  if (counts === null || (s.usd !== null && !isDollars(s.usd))) return null
  return { counts, usd: s.usd }
}

// The stored spent list read tolerantly: a value that is not a list reads as
// empty, and an entry without a ticket or with unsound spending is dropped.
const spentIn = (raw: unknown): ForemanSpent[] => (Array.isArray(raw)
  ? raw.flatMap(e => {
    const ticket = textOr(objectOf(e)?.ticket, null)
    const spend = spendIn(e)
    return ticket === null || spend === null ? [] : [{ ticket, ...spend }]
  })
  : [])

// A stored ledger read tolerantly: a value in any other shape, such as none
// at all from a parent of the read-only build, reads as empty, and a pairing
// without a ticket is dropped while any other bad field takes its default.
// A ledger from before the role-off facts were kept reads with no refusal
// given and no unwatched sub sessions, and one from before foreman kept
// spending reads with none, and one from before slots were kept keeps none.
export function ticketsIn(raw: unknown): ForemanTickets {
  const t = objectOf(raw)
  if (t === null) return TICKETS_EMPTY
  const pairings = withPlaces(Array.isArray(t.pairings) ? t.pairings.flatMap(p => pairingIn(p) ?? []) : [])
  return {
    pairings,
    folderMissing: t.folderMissing === true,
    outbox: outboxIn(t.outbox),
    held: heldIn(t.held),
    offRefusedFor: textOr(t.offRefusedFor, null),
    unwatched: unwatchedIn(t.unwatched),
    spent: spentIn(t.spent),
    earlier: spendIn(t.earlier),
    keptSlots: keptSlotsIn(t.keptSlots),
  }
}

// The ledger with the off refusal recorded as given in session `sessionId`.
export const withOffRefusal = (t: ForemanTickets, sessionId: string): ForemanTickets => ({ ...t, offRefusedFor: sessionId })

// Whether the off refusal was already given in session `sessionId`. One
// given before a /clear, under another session id, does not count.
export const isOffRefused = (t: ForemanTickets, sessionId: string) => t.offRefusedFor === sessionId

// The ledger with desktop session `id` added to the unwatched list, the
// oldest dropped past MAX_UNWATCHED. An id already listed, or one that is not
// a whole desktop session id, leaves the ledger as it was.
export function withUnwatched(t: ForemanTickets, id: string): ForemanTickets {
  if (!WHOLE_LOCAL_ID.test(id) || t.unwatched.includes(id)) return t
  return { ...t, unwatched: [...t.unwatched, id].slice(-MAX_UNWATCHED) }
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
// parent that was not freed and does not wait in the queue, with a released
// one marked. A row with another parent's ticket, or none, is not shown.
export function shownRows(rows: readonly SubRow[], t: ForemanTickets): SubRow[] {
  const byOwner = new Map(t.pairings.flatMap(p => (p.owner === null ? [] : [[p.owner, p] as const])))
  return rows.flatMap(row => {
    const owned = byOwner.get(row.record.sessionId)
    const p = owned !== undefined && ownsTicket(owned, row) ? owned : undefined
    if (p === undefined || p.standing === 'freed' || p.queue !== null) return []
    return [p.standing === 'released' ? { ...row, isReleased: true } : row]
  })
}
