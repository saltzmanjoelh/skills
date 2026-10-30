// What foreman does after each read of the status folder, decided without
// the engine: which sub sessions to nudge, which to raise a notification
// for, which slots to free, which waiting sub sessions to begin, and why to
// wake the parent's model. `decide`
// answers the next ledger together with those effects, and
// hooks/register.tsx carries them out. Every function is pure.

import type { Listed } from './desktop'
import { beginHeldLog, beginHeldNotice, releasedBy } from './held'
import { prStateOf, type BuildState, type RecordVerdicts } from './record'
import { folded, withReadings } from './spend'
import type { ForemanActs, ForemanEffect, ForemanPairing, ForemanTickets } from '../types'
import { busyCount, nameOf, type SubRow } from './subs'
import { ANNOUNCED_NONE, capped, ownsTicket, queueOf, shownRows, waitingUnclaimed } from './tickets'
import { printable } from './text'
import { byTicket, isWholeKey, whoOf, type Reason } from './wake'

// How long an idle stretch and a cleanup may last before foreman acts, in
// milliseconds, from the `idleMinutes` and `cleanupMinutes` options.
export type Limits = { idleMs: number; cleanupMs: number }

// How old a file may grow before its sub session counts as gone. Builder
// rewrites its file every minute while the session lives.
export const GONE_MS = 5 * 60_000

// How many failed calls in cleanup wake the parent before the threshold.
export const CLEANUP_FAILED_CALLS = 3

// How long a pairing may wait for a status file with its ticket before it is
// forgotten, as one from a proposal card that never started or a sub session
// that never ran /implement would wait for ever. No row or slot depends on
// it, so forgetting it changes nothing a person sees.
export const UNOWNED_FOR_MS = 24 * 60 * 60_000

// How long foreman waits for a desktop tool or a notification before it gives
// up and counts the call as failed, so a call that never answers cannot stop
// the reads. A begin message that did not go is tried again only once its
// last try is this old, so a try still waiting on its answer is not doubled.
export const CALL_TIMEOUT_MS = 30_000

// The desktop app's list of sessions for this read: not read because no rule
// needed it, failed, or read. `complete` says the list came back shorter than
// the most foreman asks for, so a session missing from it is surely gone. A
// list without it may have left out a session that was quiet a while.
// `known` holds the desktop session ids the ledger held when the list was
// asked for: a session whose id the ledger learned while the list call was
// out may have started after the list was made, so its absence from the list
// says nothing. Without `known`, every id counts as held then.
export type SessionsLook = { kind: 'unread' } | { kind: 'failed' } | { kind: 'read'; sessions: Listed[]; complete?: boolean; known?: readonly string[] }

export type DecideInput = {
  tickets: ForemanTickets
  // The rows of this read, joined to the ledger by joinOwners.
  rows: SubRow[]
  now: number
  limits: Limits
  sessions: SessionsLook
  // Whether the listing found the status folder, and whether this read's
  // listing succeeded. A record leaves only when a listing of a folder that
  // exists succeeded and no longer holds its file, so without both nothing
  // is freed or forgotten for a file that seems to have left.
  folderExists: boolean
  listed: boolean
  slots: number
}

export type Decision = {
  tickets: ForemanTickets
  effects: ForemanEffect[]
  reasons: Reason[]
  logs: string[]
  // The earliest time a rule falls due, a nudge, a wake or a cleanup
  // threshold, which brings the next read forward; null when none waits.
  nextDueAt: number | null
}

const minutesOf = (ms: number) => Math.max(Math.floor(ms / 60_000), 0)

// The record's progress, as text: an idle stretch ends when it changes.
const progressOf = (row: SubRow) => {
  const { issueKey, stage, stageDone, pr } = row.record
  return JSON.stringify([issueKey, stage, stageDone, pr?.number ?? null, pr?.state ?? null])
}

// The episode the record is in now: its state and when that began, from the
// record's stateSince, or from the read that first saw the state when the
// record has none.
function episodeOf(prev: ForemanActs['episode'], row: SubRow, now: number): { state: string; since: number } {
  const { state, stateSince } = row.record
  if (stateSince !== null) return { state, since: stateSince }
  return prev !== null && prev.state === state ? prev : { state, since: now }
}

// The desktop session to nudge, or to look up in the list: the one
// start_session named, else the one the record names. The Nudge button uses
// it too.
export const desktopOf = (p: ForemanPairing, row: SubRow) => p.localId ?? row.record.desktopSessionId ?? null

// Whether the list shows the session gone: archived, not running, or not
// listed.
function endedIn(byId: ReadonlyMap<string, Listed>, id: string | null): string | null {
  const entry = id === null ? undefined : byId.get(id)
  if (entry === undefined) return 'is no longer listed'
  if (entry.isArchived) return 'is archived'
  if (!entry.isRunning) return 'is no longer running'
  return null
}

// What one rule may change and add while it looks at one pairing.
type Step = {
  p: ForemanPairing
  // The owner record's current episode, which decide works out before any
  // rule runs.
  episode: { state: string; since: number }
  row: SubRow
  now: number
  limits: Limits
  // The desktop app's sessions by id, or null when the list was not read.
  sessionsById: ReadonlyMap<string, Listed> | null
  effects: ForemanEffect[]
  reasons: Reason[]
  logs: string[]
  due: number[]
  freed: number
  // The names of the sub sessions whose slots this read freed, in order, so
  // a waiting sub session begun in one can say whose it was.
  freedBy: string[]
}

// The rule for each state. It is typed over every state, so a state added to
// builder's record fails the type check until it has a rule here.
const STATE_RULES: Record<BuildState, (s: Step) => void> = {
  'working': s => {
    // A record that waits only on background work goes through the idle
    // rule, counted from when that wait began.
    const wait = s.row.record.backgroundOnly
    if (wait !== undefined) {
      idleRule(s, wait.since, { task: wait.tasks[0] ?? null })
      return
    }
    const { stretch } = s.p.acts
    if (stretch === null) return
    const progress = progressOf(s.row)
    // A working episode inside an idle stretch keeps the stretch, unless the
    // record made progress or the work lasted a whole threshold.
    if (stretch.wait === null) {
      if (stretch.progress !== progress || s.now - s.episode.since >= s.limits.idleMs) setActs(s, { stretch: null })
      return
    }
    // A stretch of a background wait is kept through the short turn that
    // answers a nudge, which is working without the field and whose episode
    // began with the wait. Progress in a turn of the sub session's own starts
    // that stretch afresh for the same wait, counted from this read, because
    // the wait's `since` does not move with progress, and a stretch counted
    // from it would nudge as soon as the turn ended.
    if (stretch.progress !== progress) {
      setActs(s, { stretch: { progress, nudges: 0, lastNudgeAt: null, countFrom: s.now, woke: false, wait: stretch.wait } })
    }
  },
  'waiting-on-builder': s => setActs(s, { stretch: null }),
  'idle': s => idleRule(s, s.episode.since, null),
  'needs-you': s => {
    setActs(s, { stretch: null })
    const key = episodeKey(s)
    if (s.p.acts.notifiedFor === key) return
    const reason = printable(s.row.record.reason, 120)
    s.effects.push({ kind: 'notify', text: reason === '' ? `${nameOf(s.row)} needs you.` : `${nameOf(s.row)} needs you: ${reason}` })
    setActs(s, { notifiedFor: key })
  },
  'in-cleanup': s => {
    setActs(s, { stretch: null })
    const key = episodeKey(s)
    if (s.p.acts.cleanupWokeFor === key) return
    const since = s.episode.since
    const cleanup = s.row.record.cleanup ?? { failedCalls: 0, lastError: '' }
    if (s.now - since >= s.limits.cleanupMs || cleanup.failedCalls >= CLEANUP_FAILED_CALLS) {
      s.reasons.push({ kind: 'cleanup', who: whoOf(s.row.record.issueKey, s.p.ticket), minutes: minutesOf(s.now - since), ...cleanup })
      setActs(s, { cleanupWokeFor: key })
    } else {
      s.due.push(since + s.limits.cleanupMs)
    }
  },
  'done': s => {
    setActs(s, { stretch: null })
    if (s.sessionsById === null) return
    const ended = endedIn(s.sessionsById, desktopOf(s.p, s.row))
    if (ended === null) return
    s.p = { ...s.p, standing: 'freed' }
    s.freed += 1
    s.freedBy.push(whoOf(s.row.record.issueKey, s.p.ticket))
    s.logs.push(`${nameOf(s.row)} is done and its session ${ended}, so its slot is free.`)
  },
}

const episodeKey = (s: Step) => `${s.episode.state}@${s.episode.since}`
const setActs = (s: Step, change: Partial<ForemanActs>) => {
  s.p = { ...s.p, acts: { ...s.p.acts, ...change } }
}

// Idle, and a working record that waits only on background work: a nudge
// once the wait has lasted the threshold since `since`, a second one
// threshold after the first, and the wake one threshold after that, counted
// over a stretch without progress, and never from before the pairing time, so
// a sub session that sat idle while it waited in the queue counts from its
// begin. `background` is null for an idle record
// and holds the background wait's first task, or null, otherwise. The
// stretch keeps which wait it counts, null for idleness and the background
// wait's `since` otherwise, and a stretch of another wait starts afresh, so a
// stretch that already woke for one wait cannot silence the next. Progress
// inside the same wait also starts the stretch afresh, and the working rule
// does the same for progress it sees in a turn of the sub session's own, so
// that stretch counts from its read too. An idle stretch then
// counts from the idle episode's start, as it always has. A background
// stretch counts from that read instead, because a background wait's `since`
// does not move with progress, so counting from it would nudge at once. A
// background wait's nudge and wake say so, and the wake quotes its first
// task when there is one. A record with no desktop session wakes the
// parent at two thresholds instead. A record whose pull request was closed
// without merging has stopped on purpose, so the rule ends any stretch and
// neither nudges nor wakes until the pull request opens again.
function idleRule(s: Step, since: number, background: { task: string | null } | null) {
  if (prStateOf(s.row.record.pr) === 'CLOSED') {
    setActs(s, { stretch: null })
    return
  }
  const progress = progressOf(s.row)
  const wait = background === null ? null : since
  let stretch = s.p.acts.stretch
  if (stretch === null || stretch.wait !== wait) stretch = { progress, nudges: 0, lastNudgeAt: null, countFrom: null, woke: false, wait }
  else if (stretch.progress !== progress) stretch = { progress, nudges: 0, lastNudgeAt: null, countFrom: wait === null ? null : s.now, woke: false, wait }
  setActs(s, { stretch })
  if (stretch.woke) return
  const from = Math.max(since, s.p.pairedAt, stretch.countFrom ?? since, stretch.lastNudgeAt ?? since)
  const to = desktopOf(s.p, s.row)
  const who = whoOf(s.row.record.issueKey, s.p.ticket)
  const minutes = minutesOf(s.now - since)
  if (to === null) {
    const due = from + 2 * s.limits.idleMs
    if (s.now < due) {
      s.due.push(due)
      return
    }
    s.reasons.push(background !== null ? { kind: 'background', who, nudged: false, minutes, task: background.task } : { kind: 'idle', who, nudged: false, minutes })
    setActs(s, { stretch: { ...stretch, woke: true } })
    return
  }
  const due = from + s.limits.idleMs
  if (s.now < due) {
    s.due.push(due)
    return
  }
  if (stretch.nudges < 2) {
    s.effects.push(background !== null ? { kind: 'nudge', to, name: nameOf(s.row), about: 'background' } : { kind: 'nudge', to, name: nameOf(s.row) })
    setActs(s, { stretch: { ...stretch, nudges: stretch.nudges + 1, lastNudgeAt: s.now } })
    s.due.push(s.now + s.limits.idleMs)
    return
  }
  s.reasons.push(background !== null ? { kind: 'background', who, nudged: true, minutes, task: background.task } : { kind: 'idle', who, nudged: true, minutes })
  setActs(s, { stretch: { ...stretch, woke: true } })
}

// Whether a record may be gone, before the desktop app's list is asked: it
// is not done, its file has not changed for GONE_MS, its pull request has
// not merged, and the gone wake has not already gone for this file. The gone
// rule and needsList both ask it, so the list is read only when the rule
// could act on it.
function mayBeGone(p: ForemanPairing, row: SubRow, now: number): boolean {
  return row.record.state !== 'done'
    && now - row.mtimeMs > GONE_MS
    && p.acts.goneWokeFor !== row.mtimeMs
    && !/^merged$/i.test(row.record.pr?.state ?? '')
}

// Gone, in any state but done: the file has not changed for GONE_MS, the list
// does not show the session running, and the pull request has not merged.
// One stretch is one unchanged modification time.
function goneRule(s: Step) {
  if (s.sessionsById === null || !mayBeGone(s.p, s.row, s.now)) return
  if (endedIn(s.sessionsById, desktopOf(s.p, s.row)) === null) return
  s.reasons.push({ kind: 'gone', who: whoOf(s.row.record.issueKey, s.p.ticket), minutes: minutesOf(s.now - s.row.mtimeMs) })
  setActs(s, { goneWokeFor: s.row.mtimeMs })
}

// A started sub session that foreman cannot watch: an active pairing with a
// desktop session id that still has no owner GONE_MS after it was paired
// wakes the parent once, with the mismatch sentence when some file carries
// its ticket but names another desktop session or none. A pairing with no
// desktop session id, from a proposal card that may never have started, is
// left out. The caller runs it on every read whose listing succeeded,
// including one that found the status folder missing, which holds no status
// file, as on first use before builder has written one, and never on a read
// whose listing failed, which may have missed files.
function unseenRule(p: ForemanPairing, rows: readonly SubRow[], now: number, reasons: Reason[], due: number[]): ForemanPairing {
  if (p.standing !== 'active' || p.localId === null || p.acts.unseenWoke) return p
  const at = p.pairedAt + GONE_MS
  if (now < at) {
    due.push(at)
    return p
  }
  const mismatch = rows.some(r => r.record.ticket === p.ticket)
  reasons.push({ kind: 'unseen', who: whoOf(p.issueKey, p.ticket), minutes: minutesOf(now - p.pairedAt), mismatch })
  return { ...p, acts: { ...p.acts, unseenWoke: true } }
}

const bothApprove = (v: RecordVerdicts) => v.spec === 'APPROVE' && v.adversarial === 'APPROVE'

// Whether a pair at a new head is the approval of the last announced pair
// carried over after a commit of cheap fixes: both approve, and both approved
// in the pair the parent was last told about. Such a pair is neither
// announced nor recorded.
const isCarriedOverApproval = (pair: RecordVerdicts, announced: RecordVerdicts | null) => announced !== null && bothApprove(pair) && bothApprove(announced)

// The pull request milestones the parent has not been told about, in the
// order opened, verdicts, then merged or closed, with the memory of what was
// told brought up to date. A pairing stored before foreman kept this memory
// has none yet, so it takes this read as already told and answers none. A
// record with no pull request changes nothing. A new number is a new pull
// request, so its verdicts and state are judged afresh. A verdict pair at a
// new head wakes, except one in which both approve after an announced pair in
// which both approved, which is the same review carried over to a new head
// and is not recorded. A state foreman cannot read changes nothing, and a
// pull request that opens again wakes nothing but is remembered as open, so a
// second close wakes again. A merge is also announced when the pairing's file
// leaves the folder, which mergedOnLeaving decides.
function milestoneRule(s: Step): Reason[] {
  const { pr } = s.row.record
  const announced = s.p.acts.announced
  if (announced === null) {
    const baseline = pr === null ? ANNOUNCED_NONE : { number: pr.number, state: prStateOf(pr), verdicts: pr.verdicts }
    setActs(s, { announced: baseline })
    return []
  }
  if (pr === null) return []
  const who = whoOf(s.row.record.issueKey, s.p.ticket)
  const { number } = pr
  const reasons: Reason[] = []
  let next = announced
  if (number !== next.number) {
    reasons.push({ kind: 'opened', who, number })
    next = { number, state: null, verdicts: null }
  }
  const pair = pr.verdicts
  if (pair !== null && pair.sha !== next.verdicts?.sha && !isCarriedOverApproval(pair, next.verdicts)) {
    reasons.push({ kind: 'verdicts', who, number, ...pair })
    next = { ...next, verdicts: pair }
  }
  const state = prStateOf(pr)
  if (state !== null && state !== next.state) {
    if (state === 'MERGED') reasons.push({ kind: 'merged', who, number })
    if (state === 'CLOSED') reasons.push({ kind: 'closed', who, number })
    next = { ...next, state }
  }
  if (next !== announced) setActs(s, { announced: next })
  return reasons
}

// The merge of a pairing whose file left the status folder, or none. Builder
// deletes a status file only when its session ends after the watched pull
// request merged, which can happen between two reads, so a file that leaves
// while its pull request was last told open means the pull request merged.
function mergedOnLeaving(p: ForemanPairing): Reason[] {
  const told = p.acts.announced
  if (told === null || told.number === null || told.state !== 'OPEN') return []
  return [{ kind: 'merged', who: whoOf(p.issueKey, p.ticket), number: told.number }]
}

// What a freed slot leads to, given how many slots are free now: nothing
// when none is, and otherwise a wake with the number free. A read and Release
// both decide by it.
export type SlotOutcome = { kind: 'none' } | { kind: 'wake'; reason: Reason }

export function slotOutcome(free: number): SlotOutcome {
  if (free <= 0) return { kind: 'none' }
  return { kind: 'wake', reason: { kind: 'slot-free', free } }
}

// Whether this read needs the desktop app's list: a slot rule needs it, as
// slotsNeedList says, a key is held, which a session in the list releases, or
// a sub session waits in the queue, which the list shows archived or open.
export function needsList(t: ForemanTickets, rows: readonly SubRow[], now: number): boolean {
  return t.held.length > 0 || queueOf(t).length > 0 || slotsNeedList(t, rows, now)
}

// What a list that could not be read kept from happening, for the log: a
// freed slot when a slot rule needed the list, else a released hold when a
// key is held, and otherwise a queued issue begun or dropped. needsList asks
// the same three things.
export function keptByUnreadList(t: ForemanTickets, rows: readonly SubRow[], now: number): string {
  if (slotsNeedList(t, rows, now)) return 'no slot was freed'
  if (t.held.length > 0) return 'no held issue was released'
  return 'no queued issue was begun or dropped'
}

// Whether a slot rule needs the desktop app's list: some active owned record
// that does not wait is done, or may be gone, as mayBeGone says.
export function slotsNeedList(t: ForemanTickets, rows: readonly SubRow[], now: number): boolean {
  const active = new Map(t.pairings.flatMap(p => (p.owner !== null && p.standing === 'active' && p.queue === null ? [[p.owner, p] as const] : [])))
  return rows.some(r => {
    const p = active.get(r.record.sessionId)
    return p !== undefined && ownsTicket(p, r) && (r.record.state === 'done' || mayBeGone(p, r, now))
  })
}

// How many slots are free: the slot count less the busy ones. A slot is busy
// for each row the band shows that is not released and not done, for each
// start that went ahead and has no status file yet, for GONE_MS after it was
// paired or begun, so several starts in one turn see each other, and for each
// waiting sub session claimed for a slot whose begin message has not gone. A
// sub session that waits unclaimed is not busy.
export function freeSlots(t: ForemanTickets, rows: readonly SubRow[], now: number, slots: number): number {
  const shown = busyCount(shownRows(rows, t))
  const active = t.pairings.filter(p => p.standing === 'active')
  const unseen = active.filter(p => p.queue === null && p.owner === null && now - p.pairedAt <= GONE_MS).length
  const claimed = active.filter(p => p.queue?.claim != null).length
  return slots - shown - unseen - claimed
}

// Whether a keyed start made now waits in the queue: no slot is free once
// the sub sessions already waiting unclaimed have taken theirs, so a new
// start never goes ahead of one that waits.
export function startWaits(t: ForemanTickets, rows: readonly SubRow[], now: number, slots: number): boolean {
  const owed = waitingUnclaimed(t, now, GONE_MS).length
  return freeSlots(t, rows, now, slots) - owed <= 0
}

// Whether a waiting sub session's record shows that /implement began in it:
// an issue key, a stage or a pull request. Builder writes a file for a sub
// session that waits too, which shows none of them.
const showsProgress = (row: SubRow) => row.record.issueKey !== null || row.record.stage !== null || row.record.pr !== null

// What the queue leads to on one read, after every pairing's own rules:
// - a waiting sub session whose record shows progress counts as begun;
// - when the list was read, a waiting sub session that it shows archived, or
//   that is missing from a complete list asked for once the ledger held its
//   desktop session id, leaves the queue: an unclaimed one
//   has its issue dropped, as the app can delete an inactive session without
//   archiving it, while a claimed one has its key held, with a notification
//   only when no failed begin was told for it already;
// - each free slot claims the first waiting sub session that the list shows
//   unarchived, in the queue's order, naming the sub session whose slot this
//   read freed, in order, when there is one;
// - a claim whose begin did not go is tried again once its last try is
//   CALL_TIMEOUT_MS old and the list shows its session unarchived.
// A claim and a try add a begin effect and record the try's time.
// It answers the ledger and whether anyone is left waiting unclaimed.
function queueStep(
  t: ForemanTickets,
  q: {
    rows: readonly SubRow[]; byFile: ReadonlyMap<string, SubRow>; now: number; slots: number; byId: ReadonlyMap<string, Listed> | null; complete: boolean; known: ReadonlySet<string> | null
    freedBy: string[]; effects: ForemanEffect[]; logs: string[]
  },
): { tickets: ForemanTickets; waits: boolean } {
  const { rows, now, byId, effects, logs } = q
  const ownerRow = (p: ForemanPairing) => {
    const row = p.ownerFile === null ? undefined : q.byFile.get(p.ownerFile)
    return row !== undefined && ownsTicket(p, row) ? row : undefined
  }
  let held = t.held
  let pairings = t.pairings.flatMap(p => {
    if (p.queue === null || p.standing !== 'active') return [p]
    const row = ownerRow(p)
    const who = whoOf(p.issueKey, p.ticket)
    if (row !== undefined && showsProgress(row)) {
      logs.push(`${who} began before foreman's begin message, so foreman counts it as busy.`)
      return [{ ...p, queue: null }]
    }
    const entry = byId === null || p.localId === null ? undefined : byId.get(p.localId)
    const isArchived = entry?.isArchived === true
    const isGone = byId !== null && p.localId !== null && entry === undefined && q.complete && (q.known === null || q.known.has(p.localId))
    if (!isArchived && !isGone) return [p]
    if (p.queue.claim === null) {
      logs.push(`Dropped ${who} from the queue, because its waiting session is ${isArchived ? 'archived' : 'no longer listed'}.`)
      return []
    }
    const key = p.issueKey !== null && isWholeKey(p.issueKey) ? p.issueKey : null
    if (key === null) {
      logs.push(`Dropped ${who} from the queue, because its waiting session is ${isArchived ? 'archived' : 'no longer listed'}.`)
      return []
    }
    logs.push(beginHeldLog(key))
    if (!held.includes(key)) {
      held = [...held, key]
      if (!p.queue.claim.notified) effects.push({ kind: 'notify', text: beginHeldNotice(key) })
    }
    return []
  })
  const isShown = (p: ForemanPairing) => p.localId !== null && byId?.get(p.localId)?.surelyUnarchived === true
  let free = freeSlots({ ...t, pairings }, rows, now, q.slots)
  const claims = new Map<string, string | null>()
  for (const p of queueOf({ ...t, pairings })) {
    if (free <= 0) break
    if (p.queue!.claim !== null || !isShown(p)) continue
    claims.set(p.ticket, q.freedBy.shift() ?? null)
    free -= 1
  }
  pairings = pairings.map(p => {
    if (p.queue === null || p.standing !== 'active' || p.localId === null) return p
    const claimed = claims.has(p.ticket)
    const retried = !claimed && p.queue.claim !== null && isShown(p) && now - p.queue.claim.attemptAt >= CALL_TIMEOUT_MS
    if (!claimed && !retried) return p
    effects.push({ kind: 'begin', to: p.localId, ticket: p.ticket, key: p.issueKey, by: claimed ? claims.get(p.ticket)! : null })
    return { ...p, queue: { ...p.queue, claim: { attemptAt: now, notified: p.queue.claim?.notified ?? false } } }
  })
  const next = { ...t, pairings, held }
  return { tickets: next, waits: waitingUnclaimed(next, now, GONE_MS).length > 0 }
}

// Decides everything one read leads to. A pairing whose owner's file left the
// folder is forgotten, freeing its slot when it was active and announcing a
// merge when its pull request was last told open, and a pairing
// that no status file has carried for a day is forgotten and logged; neither
// happens unless this read listed a folder that exists. On any read whose
// listing succeeded, even one that found the folder missing, a pairing with
// no owner may wake the parent once, as unseenRule says. A released or
// freed pairing gets no action, and neither does one that waits in the queue,
// which queueStep decides for. An active pairing's pull request
// milestones wake the parent after its other reasons. A list
// that was read releases each held key that a session in it shows started.
// When a slot freed and nobody is left waiting unclaimed, the parent is woken
// with the number of slots free, unless none is free.
// The spending in each owner's file is taken into the ledger from the
// pairings as the read found them, and the spent list is folded after the
// pairings are decided, so an entry whose pairing this read forgot can fold
// in the same ledger.
export function decide(input: DecideInput): Decision {
  const { rows, now, limits, sessions, folderExists, listed } = input
  const byId = sessions.kind === 'read' ? new Map(sessions.sessions.map(x => [x.sessionId, x])) : null
  const effects: ForemanEffect[] = []
  const reasons: Reason[] = []
  const logs: string[] = []
  const due: number[] = []
  let freed = 0
  const freedBy: string[] = []
  const byFile = new Map(rows.map(r => [r.file, r]))
  const pairings = input.tickets.pairings.flatMap(p => {
    // A waiting sub session needs no file of its own, so it is forgotten
    // only when it has no desktop session either, as from a proposal card.
    const waits = p.queue !== null
    if (p.owner === null || p.ownerFile === null) {
      if (!listed) return [p]
      if (folderExists && now - p.pairedAt > UNOWNED_FOR_MS && !(waits && p.localId !== null)) {
        logs.push(`Forgot ticket ${p.ticket}, because no status file carried it for a day.`)
        return []
      }
      return [waits ? p : unseenRule(p, rows, now, reasons, due)]
    }
    const row = byFile.get(p.ownerFile)
    if (row === undefined) {
      if (!folderExists || !listed || waits) return [p]
      if (p.standing === 'active') {
        freed += 1
        freedBy.push(whoOf(p.issueKey, p.ticket))
        logs.push(`The slot of ${p.issueKey ?? byTicket(p.ticket)} is free, because its file left the status folder.`)
        // The merge comes before the slot-free sentence, which is added
        // after every pairing.
        reasons.push(...mergedOnLeaving(p))
      }
      return []
    }
    if (!ownsTicket(p, row) || p.standing !== 'active' || waits) return [p]
    const episode = episodeOf(p.acts.episode, row, now)
    const s: Step = { p: { ...p, acts: { ...p.acts, episode } }, episode, row, now, limits, sessionsById: byId, effects, reasons, logs, due, freed: 0, freedBy }
    // The milestone sentences follow this pairing's other sentences, so that
    // the slot-free sentence, added after every pairing, stays last.
    const milestones = milestoneRule(s)
    STATE_RULES[row.record.state](s)
    goneRule(s)
    reasons.push(...milestones)
    freed += s.freed
    return [s.p]
  })
  let tickets: ForemanTickets = folded(capped({ ...withReadings(input.tickets, rows), pairings }))
  if (!folderExists && !tickets.folderMissing) logs.push('The status folder is missing, so foreman frees no slot until it is back.')
  tickets = { ...tickets, folderMissing: !folderExists }
  if (sessions.kind === 'read' && tickets.held.length > 0) {
    const released = releasedBy(tickets.held, sessions.sessions)
    if (released.logs.length > 0) tickets = { ...tickets, held: released.held }
    logs.push(...released.logs)
  }
  const complete = sessions.kind === 'read' && sessions.complete === true
  const known = sessions.kind === 'read' && sessions.known !== undefined ? new Set(sessions.known) : null
  const queued = queueStep(tickets, { rows, byFile, now, slots: input.slots, byId, complete, known, freedBy, effects, logs })
  tickets = queued.tickets
  if (freed > 0 && !queued.waits) {
    const outcome = slotOutcome(freeSlots(tickets, rows, now, input.slots))
    if (outcome.kind === 'wake') reasons.push(outcome.reason)
  }
  return { tickets, effects, reasons, logs, nextDueAt: due.length === 0 ? null : Math.min(...due) }
}
