// What foreman does after each read of the status folder, decided without
// the engine: which sub sessions to nudge, which to raise a notification
// for, which slots to free, which waiting sub sessions to begin, and why to
// wake the parent's model. `decide`
// answers the next ledger together with those effects, and
// hooks/register.tsx carries them out. Every function is pure.

import type { LastTurn } from 'builder'
import { REASONS, type Listed } from './desktop'
import { beginHeldLog, beginHeldNotice, releasedBy } from './held'
import { prStateOf, type BuildState, type RecordVerdicts } from './record'
import { folded, withReadings } from './spend'
import type { ForemanActs, ForemanEffect, ForemanPairing, ForemanTickets } from '../types'
import { busyCount, nameOf, type SubRow } from './subs'
import { ANNOUNCED_NONE, capped, isReserved, keptSlotsIn, ownsTicket, queueOf, shownRows, waitingUnclaimed } from './tickets'
import { printable } from './text'
import { byTicket, isWholeKey, isWhoName, whoOf, type Reason } from './wake'

// How long an idle stretch and a cleanup may last before foreman acts, in
// milliseconds, from the `idleMinutes` and `cleanupMinutes` options.
export type Limits = { idleMs: number; cleanupMs: number }

// How old a file may grow before its sub session counts as gone. Builder
// rewrites its file every minute while the session lives.
export const GONE_MS = 5 * 60_000

// How old a file may grow before foreman tells the parent it has frozen,
// whatever the desktop app's list shows. It is twice GONE_MS, so the gone rule
// has had its chance to wake first.
export const FROZEN_MS = 2 * GONE_MS

// How long foreman must have been reading the folder without a long gap
// before a file's age may wake the parent through the frozen rule. It is
// twice builder's one-minute rewrite interval, so every live builder has
// rewritten its file at least once since foreman began watching again. After
// the machine sleeps, foreman's first read can come before the builders'
// rewrites, and every live file then looks as old as the sleep.
export const SETTLE_MS = 2 * 60_000

// The longest gap between two successful folder listings that still counts
// as watching without a break. Reads come at most READ_LATER_MS, two
// minutes, apart, so a gap of more than five minutes means the machine slept,
// the listings failed, or foreman was not running. It is its own value rather
// than GONE_MS, so tuning the gone rule does not change how a sleep is
// noticed. It must stay between two bounds, which a test pins. It must stay
// above READ_LATER_MS, or every quiet read would start a new watch and the
// frozen rule would never run. And it must stay well below FROZEN_MS, because
// a live file can look as old as this gap plus builder's one-minute rewrite
// interval without starting a new watch.
export const READ_GAP_MS = 5 * 60_000

// When foreman began watching the folder without a break, given the previous
// successful listing's time and the start it kept then: this listing starts
// a new watch after a gap longer than READ_GAP_MS, or when there was no
// earlier listing, and otherwise the watch goes on from where it began.
export function watchingFrom(lastReadAt: number | null, since: number | null, now: number): number {
  if (lastReadAt === null || since === null || now - lastReadAt > READ_GAP_MS) return now
  return since
}

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

// The words for a call that did not answer within CALL_TIMEOUT_MS.
export const NO_ANSWER = `the desktop app did not answer within ${CALL_TIMEOUT_MS / 1000} seconds`

// The reasons a failed read of the desktop app's list may show the person.
// Any other text came from somewhere foreman does not control, so it is
// shown as the refused reason instead.
const LIST_FAILURES: ReadonlySet<string> = new Set([REASONS.notConnected, REASONS.listRefused, REASONS.listUnreadable, REASONS.savedOutside, REASONS.savedMissing, REASONS.savedTooLarge, REASONS.savedNotList, NO_ANSWER])

// The notification for reads of the desktop app's list that started failing,
// with the fixed reason `why`.
export const listFailedNotice = (why: string) => `foreman cannot read the desktop app's list of sessions, so it cannot begin a waiting issue or free a finished slot until it can: ${why}.`

// The desktop app's list of sessions for this read: not read because no rule
// needed it, failed, or read. `complete` says the list came back shorter than
// the most foreman asks for, so a session missing from it is surely gone. A
// list without it may have left out a session that was quiet a while.
// `known` holds the desktop session ids the ledger held when the list was
// asked for: a session whose id the ledger learned while the list call was
// out may have started after the list was made, so its absence from the list
// says nothing. Without `known`, every id counts as held then. A failed look
// carries the fixed reason it failed, which the notice for a failed read
// shows, and one without a reason counts as refused. `holders` holds the
// sessions of the desktop app's whole list, read beside the family's only
// while a key is held, which only the release of a hold reads.
export type SessionsLook = { kind: 'unread' } | { kind: 'failed'; reason?: string } | { kind: 'read'; sessions: Listed[]; complete?: boolean; known?: readonly string[]; holders?: readonly Listed[] }

// A list that was read, as the rules look things up in it: its sessions by
// id, whether it is complete, and the ids the ledger held when it was asked
// for, as SessionsLook says. decide builds it once for every rule.
type ListLook = { byId: ReadonlyMap<string, Listed>; complete: boolean; known: ReadonlySet<string> | null }

type Over = 'archived' | 'missing'

// The words for each answer of overIn, which the over rule, the queue and
// endedIn all use.
const OVER_WORDS: Record<Over, string> = { archived: 'is archived', missing: 'is no longer listed' }

// Whether the list shows the session `id` over: archived when its entry says
// so exactly, or missing when it has no entry, the list is complete and the
// ledger held the id when the list was asked for. A pairing with no desktop
// session id is never over. The over rule and the queue both decide by it,
// so the two cannot drift apart.
function overIn(look: ListLook, id: string | null): Over | null {
  if (id === null) return null
  const entry = look.byId.get(id)
  if (entry !== undefined) return entry.isArchived === true ? 'archived' : null
  return look.complete && (look.known === null || look.known.has(id)) ? 'missing' : null
}

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
  // When foreman began watching the folder without a break, as watchingFrom
  // gives it. The frozen rule waits until SETTLE_MS has passed since then.
  watchingSince: number
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

// A stretch that starts afresh with `progress` for `wait`, counted from
// `countFrom`: no nudges, no last nudge and not woken. `turnProgress` marks a
// start from progress seen in a turn of the sub session's own.
const freshStretch = (progress: string, wait: number | null, countFrom: number | null, turnProgress = false): NonNullable<ForemanActs['stretch']> =>
  ({ progress, nudges: 0, lastNudgeAt: null, countFrom, woke: false, wait, turnProgress })

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
  if (entry === undefined) return OVER_WORDS.missing
  if (entry.isArchived) return OVER_WORDS.archived
  if (!entry.isRunning) return 'is no longer running'
  return null
}

// Whether the list shows the session `id` stopped: it has an entry that is
// not archived and not running. A session that the list leaves out is not
// stopped, because a nudge cannot reach it, and the gone and over rules handle
// it instead.
function stoppedIn(byId: ReadonlyMap<string, Listed>, id: string): boolean {
  const entry = byId.get(id)
  return entry !== undefined && !entry.isArchived && !entry.isRunning
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
  // The desktop app's list, or null when it was not read.
  look: ListLook | null
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
    // A stalled record, whose session stopped mid-turn and left its file
    // saying working, goes through the idle rule, counted from the file's
    // last change. A stretch from before the stall is cleared first, so an
    // old idle stretch that already woke the parent cannot silence it. When
    // the gone wake or the frozen wake has already gone for this file, the
    // parent knows of the stall, so the idle rule still nudges but counts its
    // own wake as given rather than waking the parent a second time.
    if (isStalled(s)) {
      const old = s.p.acts.stretch
      if (old !== null && staleStretch(old, s.row.mtimeMs)) setActs(s, { stretch: null })
      idleRule(s, s.row.mtimeMs, null, s.p.acts.goneWokeFor === s.row.mtimeMs)
      return
    }
    const { stretch } = s.p.acts
    if (stretch === null) return
    const progress = progressOf(s.row)
    // A working episode inside an idle stretch keeps the stretch, unless the
    // record made progress or the work lasted a whole threshold. A read in
    // the middle of a stall whose list is missing, failed or shows the
    // session running keeps the stall's own stretch as it is, so only a
    // change to the file ends the stall's count. Such a read neither nudges
    // nor wakes, because the record is not stalled on it, but a nudged turn
    // that changes nothing does not start the count again either, so the
    // second nudge and the wake still come on time. Any other stretch is
    // treated as before.
    if (stretch.wait === null) {
      if (stalledShape(s.p, s.row, s.now) && stallsOwn(stretch, s.row.mtimeMs)) return
      if (stretch.progress !== progress || s.now - s.episode.since >= s.limits.idleMs) setActs(s, { stretch: null })
      return
    }
    // A stretch of a background wait is kept through the short turn that
    // answers a nudge, which is working without the field and whose episode
    // began with the wait. Progress in a turn of the sub session's own starts
    // that stretch afresh for the same wait, counted from this read, because
    // the wait's `since` does not move with progress, and a stretch counted
    // from it would nudge as soon as the turn ended. It also marks the
    // stretch, so the end of this turn restarts it again even when a nudge
    // started the turn (see idleRule).
    if (stretch.progress !== progress) setActs(s, { stretch: freshStretch(progress, stretch.wait, s.now, true) })
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
    if (s.look === null) return
    const ended = endedIn(s.look.byId, desktopOf(s.p, s.row))
    if (ended === null) return
    markFreed(s)
    s.logs.push(`${nameOf(s.row)} is done and its session ${ended}, so its slot is free.`)
  },
}

// Frees the pairing's slot on this read and names it in `freedBy`. The done
// rule and the over rule both free by it, each with its own log line.
function markFreed(s: Step) {
  s.p = { ...s.p, standing: 'freed' }
  s.freed += 1
  s.freedBy.push(whoOf(s.row.record.issueKey, s.p.ticket))
}

const episodeKey = (s: Step) => `${s.episode.state}@${s.episode.since}`
const setActs = (s: Step, change: Partial<ForemanActs>) => {
  s.p = { ...s.p, acts: { ...s.p.acts, ...change } }
}

// Whether the end of the sub session's last turn restarts a background
// stretch of the wait that began at `wait`, read at `now`.
function turnEndRestarts(stretch: NonNullable<ForemanActs['stretch']>, wait: number, turn: LastTurn, now: number): boolean {
  // A stretch never moves back, so an end at or before its current start,
  // the read that last restarted it or else the wait's start, changes
  // nothing, and the same end restarts it only once.
  if (turn.endedAt <= (stretch.countFrom ?? wait)) return false
  // An end after this read, as a damaged file could hold, would put the
  // nudges off for ever.
  if (turn.endedAt > now) return false
  // A turn of the sub session's own restarts the stretch, and so does an
  // answer to a nudge during which foreman saw progress in a turn. An answer
  // to a nudge that made no progress is counted through.
  return !turn.answeredNudge || stretch.turnProgress
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
// does not move with progress, so counting from it would nudge at once. The
// end of the sub session's last turn, from builder's `lastTurn`, restarts a
// background stretch from that end when it is later than the stretch's
// start and no later than this read, and either no nudge started the turn
// or the stretch is marked by progress seen in a turn, so the count runs
// from the end of real work. An answer to a nudge that made no progress is
// counted through, and a stretch never moves back. A background wait's
// nudge and wake say so, and the wake quotes its first
// task when there is one. A record with no desktop session wakes the
// parent at two thresholds instead. A record whose pull request was closed
// without merging has stopped on purpose, so the rule ends any stretch and
// neither nudges nor wakes until the pull request opens again. `told` says
// the parent has already been woken for this stretch by another rule, so at
// either point where the rule would wake the parent it only marks the
// stretch as woken. The nudges still go. The stall passes it, and the
// stretch cannot instead be marked woken when the other wake goes, because
// staleStretch takes a stretch that woke without nudging for one from before
// the stall and starts it afresh.
function idleRule(s: Step, since: number, background: { task: string | null } | null, told = false) {
  if (prStateOf(s.row.record.pr) === 'CLOSED') {
    setActs(s, { stretch: null })
    return
  }
  const progress = progressOf(s.row)
  const wait = background === null ? null : since
  let stretch = s.p.acts.stretch
  if (stretch === null || stretch.wait !== wait) stretch = freshStretch(progress, wait, null)
  else if (stretch.progress !== progress) stretch = freshStretch(progress, wait, wait === null ? null : s.now)
  const turn = s.row.record.lastTurn
  if (wait !== null && turn !== undefined && turnEndRestarts(stretch, wait, turn, s.now)) stretch = freshStretch(progress, wait, turn.endedAt)
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
    if (!told) s.reasons.push(background !== null ? { kind: 'background', who, nudged: false, minutes, task: background.task } : { kind: 'idle', who, nudged: false, minutes })
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
  if (!told) s.reasons.push(background !== null ? { kind: 'background', who, nudged: true, minutes, task: background.task } : { kind: 'idle', who, nudged: true, minutes })
  setActs(s, { stretch: { ...stretch, woke: true } })
}

// Whether a record may be gone: it is not done, its file has not changed
// for GONE_MS, its pull request has not merged, and neither the gone wake nor
// the frozen wake has already gone for this file, since both set goneWokeFor.
// The gone rule asks it, and slotsNeedList asks for the list on every read
// while it holds. The list is also read, less often, for a stale record that
// this rules out, as slotsNeedList says, because the over rule can act on
// such a record.
function mayBeGone(p: ForemanPairing, row: SubRow, now: number): boolean {
  return row.record.state !== 'done'
    && now - row.mtimeMs > GONE_MS
    && p.acts.goneWokeFor !== row.mtimeMs
    && !/^merged$/i.test(row.record.pr?.state ?? '')
}

// Whether a record has the shape of a stall, without reading the list: it
// says working, does not wait only on background work, its file has not
// changed for GONE_MS, and it has a desktop session that the list can show
// running or not. isStalled adds what the list shows, and the list reads ask
// it on their own.
function stalledShape(p: ForemanPairing, row: SubRow, now: number): boolean {
  return row.record.state === 'working'
    && row.record.backgroundOnly === undefined
    && now - row.mtimeMs > GONE_MS
    && desktopOf(p, row) !== null
}

// Whether the record is stalled on this read: it has the shape of a stall and
// the list, read on this read, shows its session stopped. It is the one place
// that decides it, so the working rule and the gone rule cannot disagree.
function isStalled(s: Step): boolean {
  if (s.look === null || !stalledShape(s.p, s.row, s.now)) return false
  return stoppedIn(s.look.byId, desktopOf(s.p, s.row)!)
}

// Whether a stretch has nudged for the stall of a file last changed at
// `mtimeMs`: its last nudge came more than GONE_MS after that change. A
// stall's nudges always do, because a record is stalled only once its file
// is GONE_MS old, so a nudge any earlier came from another stretch.
const stallsOwn = (stretch: NonNullable<ForemanActs['stretch']>, mtimeMs: number) => stretch.lastNudgeAt !== null && stretch.lastNudgeAt - mtimeMs > GONE_MS

// Whether a stored stretch began before the stall of a file last changed at
// `mtimeMs`: it nudged, but not for the stall, as stallsOwn says, or it woke
// without nudging. A stall always has a desktop session, so its own wake
// always follows two nudges.
function staleStretch(stretch: NonNullable<ForemanActs['stretch']>, mtimeMs: number): boolean {
  if (stretch.lastNudgeAt !== null) return !stallsOwn(stretch, mtimeMs)
  return stretch.woke
}

// Whether a record with the shape of a stall needs no more from the list: its
// pull request is closed, so the idle rule neither nudges nor wakes for it, or
// the stall's own stretch has already woken the parent.
function stallHandled(p: ForemanPairing, row: SubRow, now: number): boolean {
  if (!stalledShape(p, row, now)) return false
  if (prStateOf(row.record.pr) === 'CLOSED') return true
  const { stretch } = p.acts
  return stretch !== null && stretch.wait === null && stretch.woke && !staleStretch(stretch, row.mtimeMs)
}

// Gone, in any state but done: the file has not changed for GONE_MS, the list
// does not show the session running, and the pull request has not merged.
// One stretch is one unchanged modification time. A stalled record is left to
// the idle rule, which wakes the parent itself at its third threshold. A
// stall that has nudged and then drops out of a list that is not complete
// gets the gone wake instead, and its stretch is marked as woken, because the
// parent now knows of it and the idle wake, which needs the list to show the
// session, may never come. Without the mark stallsNeedList would ask for the
// list on every read until the file changes. The same holds for a stall whose
// gone wake went before its first nudge and that drops out again: the parent
// already knows of it, so the stretch is marked without a second wake. A
// frozen wake for the same file sets goneWokeFor too, so after it the gone
// rule does not wake either.
function goneRule(s: Step) {
  if (s.look === null || s.p.standing !== 'active' || isStalled(s)) return
  if (endedIn(s.look.byId, desktopOf(s.p, s.row)) === null) return
  const { stretch } = s.p.acts
  const stallNudged = stretch !== null && stretch.wait === null && stalledShape(s.p, s.row, s.now) && stallsOwn(stretch, s.row.mtimeMs)
  const woken = stallNudged ? { stretch: { ...stretch, woke: true } } : {}
  if (!mayBeGone(s.p, s.row, s.now)) {
    if (stallNudged && s.p.acts.goneWokeFor === s.row.mtimeMs) setActs(s, woken)
    return
  }
  s.reasons.push({ kind: 'gone', who: whoOf(s.row.record.issueKey, s.p.ticket), minutes: minutesOf(s.now - s.row.mtimeMs) })
  setActs(s, { goneWokeFor: s.row.mtimeMs, ...woken })
}

// Frozen, in any state, done included: the file has not changed for more
// than FROZEN_MS and its pull request has not merged. Builder rewrites the
// file once a minute while the session runs, so a file this old means
// something stopped, even when the list shows the session running or cannot
// be read at all, and those are the cases no other rule wakes for. One
// stretch is one unchanged modification time, as for the gone rule. The rule
// stays quiet when the parent has already been woken for the stretch: the
// gone wake or an earlier frozen wake set goneWokeFor to the file's
// modification time, or the idle stretch counts idleness, has nudged for this
// stall, as stallsOwn says, and has woken. A stall that has only been nudged
// has not woken the parent, so it does not silence the rule. When the wake
// goes it sets goneWokeFor, and, for a record with the shape of a stall as
// the gone rule checks it, it marks such a nudged stretch as woken, so
// neither the gone rule nor the stall wakes the parent again until the file
// changes. A record that is not a stall, such as an idle one, keeps its
// stretch as it was, so the idle rule's own nudges and wake still come. Its
// idle wake silences this rule only when the stretch's last nudge came more
// than GONE_MS after the file last changed, as stallsOwn judges, so with a
// short idle limit both the idle wake and this one can come. The caller runs
// it last, after the state rule and the gone rule, so a gone wake
// on the same read goes instead of this one, and a pairing that the done rule
// freed on this read is no longer active. It runs only on a read whose
// folder listing succeeded: after a failed listing the kept rows still carry
// their old modification times, so every file would seem to age and the rule
// would wake for each active sub session. It also runs only once foreman has
// watched the folder without a break for SETTLE_MS, so a read just after the
// machine wakes from sleep does not find every live file old. A file rewritten with
// text that does not parse keeps its last good record and that record's old
// modification time, so it gets this wake once, which is fair, since foreman
// cannot read it.
function frozenRule(s: Step) {
  if (s.p.standing !== 'active' || prStateOf(s.row.record.pr) === 'MERGED') return
  if (s.now - s.row.mtimeMs <= FROZEN_MS || s.p.acts.goneWokeFor === s.row.mtimeMs) return
  const { stretch } = s.p.acts
  const nudged = stretch !== null && stretch.wait === null && stallsOwn(stretch, s.row.mtimeMs) ? stretch : null
  if (nudged?.woke === true) return
  const woken = nudged !== null && stalledShape(s.p, s.row, s.now) ? { stretch: { ...nudged, woke: true } } : {}
  s.reasons.push({ kind: 'frozen', who: whoOf(s.row.record.issueKey, s.p.ticket), minutes: minutesOf(s.now - s.row.mtimeMs), state: s.row.record.state })
  setActs(s, { goneWokeFor: s.row.mtimeMs, ...woken })
}

// Over, in any state but done: the list shows the session archived, or
// missing as overIn says, so the sub session will never write done and its
// slot is freed on this read, whatever its file says and whether or not its
// pull request merged. The log line names the state the file says and the
// pull request, or that it has none. It answers whether it freed the slot,
// and the caller then runs no state rule and no gone rule for the pairing,
// so a session that is over gets no last nudge, notification or wake. A done
// record keeps the done rule, which also frees on a session that is not
// running.
function overRule(s: Step): boolean {
  if (s.look === null || s.row.record.state === 'done') return false
  const over = overIn(s.look, desktopOf(s.p, s.row))
  if (over === null) return false
  markFreed(s)
  const { pr, state } = s.row.record
  s.logs.push(`The session of ${nameOf(s.row)} ${OVER_WORDS[over]} while its status file says ${state}, with ${pr === null ? 'no pull request' : `pull request #${pr.number}`}, so its slot is free.`)
  return true
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

// Release's ledger update for `row`: each active pairing that owns the row's
// ticket becomes released. Whether anyone still waits unclaimed is decided on
// the ledger this update writes, and while someone does, the released slots'
// names are added to the end of keptSlots in the same write, so the next read
// decides them like any other freed slot. The names go through the ledger
// reader's own rule, so a name from a damaged ticket is not carried and the
// list keeps only the newest MAX_PAIRINGS names.
export function releasedIn(t: ForemanTickets, row: SubRow, now: number): { tickets: ForemanTickets; released: boolean; waits: boolean } {
  let released = false
  const names: string[] = []
  const pairings = t.pairings.map(p => {
    if (!ownsTicket(p, row) || p.standing !== 'active') return p
    released = true
    names.push(whoOf(p.issueKey, p.ticket))
    return { ...p, standing: 'released' as const }
  })
  const next = { ...t, pairings }
  const waits = released && waitingUnclaimed(next, now, GONE_MS).length > 0
  return { tickets: waits ? { ...next, keptSlots: keptSlotsIn([...next.keptSlots, ...names]) } : next, released, waits }
}

// What a freed slot leads to, given how many slots are free now and, when
// someone still waits unclaimed in the queue, the names of the waiting issues
// a wake line may carry: nothing when no slot is free, the kept sentence when
// someone waits, and otherwise a wake with the number free. A read and
// Release both decide by it. Release calls it only when nobody waits
// unclaimed, so it passes no names: while someone waits, Release carries the
// freed slot's name in keptSlots instead, and the next read decides it like
// any other freed slot.
export type SlotOutcome = { kind: 'none' } | { kind: 'wake'; reason: Reason }

export function slotOutcome(free: number, waiting: string[] | null = null): SlotOutcome {
  if (free <= 0) return { kind: 'none' }
  if (waiting !== null) return { kind: 'wake', reason: { kind: 'slot-kept', whos: waiting } }
  return { kind: 'wake', reason: { kind: 'slot-free', free } }
}

// Whether this read needs the desktop app's list: a slot rule needs it, as
// slotsNeedList says, a stall waits on the idle rule, as stallsNeedList says,
// a key is held, which a session in the list releases, or a sub session waits
// in the queue, which the list shows archived or open.
export function needsList(t: ForemanTickets, rows: readonly SubRow[], now: number): boolean {
  return t.held.length > 0 || queueOf(t).length > 0 || slotsNeedList(t, rows, now) || stallsNeedList(t, rows, now)
}

// What a list that could not be read kept from happening, for the log: a
// stalled sub session nudged when a stall needed the list, else a freed slot
// when a slot rule needed it, else a released hold when a key is held, and
// otherwise a queued issue begun or dropped. needsList asks the same four
// things. The stall comes first, because a stall that is not handled makes
// slotsNeedList hold too.
export function keptByUnreadList(t: ForemanTickets, rows: readonly SubRow[], now: number): string {
  if (stallsNeedList(t, rows, now)) return 'no stalled sub session was nudged'
  if (slotsNeedList(t, rows, now)) return 'no slot was freed'
  if (t.held.length > 0) return 'no held issue was released'
  return 'no queued issue was begun or dropped'
}

// Each row that an active pairing, not waiting in the queue, owns, with that
// pairing.
function activeOwners(t: ForemanTickets, rows: readonly SubRow[]): { p: ForemanPairing; r: SubRow }[] {
  const active = new Map(t.pairings.flatMap(p => (p.owner !== null && p.standing === 'active' && p.queue === null ? [[p.owner, p] as const] : [])))
  return rows.flatMap(r => {
    const p = active.get(r.record.sessionId)
    return p === undefined || !ownsTicket(p, r) ? [] : [{ p, r }]
  })
}

// Whether a stall needs the desktop app's list: some active owned record has
// the shape of a stall that is not yet handled, as stallHandled says, and its
// stretch has nudged for the stall, as stallsOwn says. It asks on every read,
// so the stall's second nudge and its wake land at their thresholds rather
// than on whichever later read fetches the list. Until the first nudge the
// list is read as slotsNeedList says, on every read while mayBeGone holds, so
// a record of that shape that never stalls, such as one missing from a list
// that is not complete or one whose pull request merged and whose session
// runs, is read no more often than any other stale record.
export function stallsNeedList(t: ForemanTickets, rows: readonly SubRow[], now: number): boolean {
  return activeOwners(t, rows).some(({ p, r }) => {
    if (!stalledShape(p, r, now) || stallHandled(p, r, now)) return false
    const { stretch } = p.acts
    return stretch !== null && stallsOwn(stretch, r.mtimeMs)
  })
}

// Whether a slot rule needs the desktop app's list: some active owned record
// that does not wait is done, or mayBeGone holds for it and it is not a
// handled stall, or its file has not changed for GONE_MS and its gone wait of
// list checks, which listCheckedAt starts, has run out. A handled stall is left
// out of the second case because the gone rule never wakes for a stall, so
// goneWokeFor never ends that case for it. The last case covers a record whose
// gone wake or frozen wake went, either of which ends the second case, whose
// pull request merged, or whose stall is handled, because the over rule frees
// its slot once its session is archived, and with no queue nothing else would
// read the list for it. It asks at most once
// every GONE_MS, a failed ask included, so such a record does not make every
// read wait on the list while another sub session works or while the list
// keeps failing, and an archived session still frees its slot within about
// GONE_MS.
export function slotsNeedList(t: ForemanTickets, rows: readonly SubRow[], now: number): boolean {
  return activeOwners(t, rows).some(({ p, r }) => {
    if (r.record.state === 'done' || (mayBeGone(p, r, now) && !stallHandled(p, r, now))) return true
    const checked = p.acts.listCheckedAt
    return now - r.mtimeMs > GONE_MS && (checked === null || now - checked >= GONE_MS)
  })
}

// How many slots are free: the slot count less the busy ones. A slot is busy
// for each row the band shows that is not released and not done, for each
// start that went ahead and has no status file yet, for GONE_MS after it was
// paired or begun, so several starts in one turn see each other, and for each
// waiting sub session claimed for a slot whose begin message has not gone. A
// sub session that waits unclaimed is not busy, unless a kept sentence named
// it no more than GONE_MS ago, as isReserved says: its slot is then kept for
// the parent's begin by hand, so it counts as busy and nothing else takes
// that slot. A reserved pairing has no claim and has a queue, so it is never
// also counted as claimed or as a start with no status file.
export function freeSlots(t: ForemanTickets, rows: readonly SubRow[], now: number, slots: number): number {
  const shown = busyCount(shownRows(rows, t))
  const active = t.pairings.filter(p => p.standing === 'active')
  const unseen = active.filter(p => p.queue === null && p.owner === null && now - p.pairedAt <= GONE_MS).length
  const claimed = active.filter(p => p.queue?.claim != null).length
  const reserved = active.filter(p => isReserved(p, now, GONE_MS)).length
  return slots - shown - unseen - claimed - reserved
}

// Whether a keyed start made now waits in the queue: no slot is free once
// the sub sessions already waiting unclaimed have taken theirs, so a new
// start never goes ahead of one that waits.
export function startWaits(t: ForemanTickets, rows: readonly SubRow[], now: number, slots: number): boolean {
  const owed = waitingUnclaimed(t, now, GONE_MS).length
  return freeSlots(t, rows, now, slots) - owed <= 0
}

// The most issues the top-up line asks the parent to start on one typed turn.
// The desktop app asks the person with a permission card from the eleventh
// start on one turn, so five keeps a turn well below it, with room for issues
// the person names in the same message.
export const TOP_UP_MAX = 5

// How many issues the parent should start now so that foreman keeps one
// waiting sub session per slot: twice the slot count, less the busy slots and
// the sub sessions that wait unclaimed, never below zero and never above
// TOP_UP_MAX. A claimed or reserved waiting sub session is counted once,
// because freeSlots counts it as busy and waitingUnclaimed leaves it out.
export function topUpCount(t: ForemanTickets, rows: readonly SubRow[], now: number, slots: number): number {
  const occupied = slots - freeSlots(t, rows, now, slots) + waitingUnclaimed(t, now, GONE_MS).length
  return Math.min(TOP_UP_MAX, Math.max(0, 2 * slots - occupied))
}

// Whether a waiting sub session's record shows that /implement began in it:
// an issue key, a stage or a pull request. Builder writes a file for a sub
// session that waits too, which shows none of them.
const showsProgress = (row: SubRow) => row.record.issueKey !== null || row.record.stage !== null || row.record.pr !== null

// What the queue leads to on one read, after every pairing's own rules:
// - a waiting sub session whose record shows progress counts as begun;
// - when the list was read, a waiting sub session that it shows over, as
//   overIn says, leaves the queue: an unclaimed one
//   has its issue dropped, as the app can delete an inactive session without
//   archiving it, while a claimed one has its key held, with a notification
//   only when no failed begin was told for it already;
// - a waiting sub session whose slot a kept sentence kept, and which neither
//   of those two ended, gets one log line once the kept slot is more than
//   GONE_MS old, or its stamp is later than the clock, and loses its stamp,
//   so from then on it waits unclaimed like any other;
// - each free slot claims the first waiting sub session that the list shows
//   unarchived, in the queue's order, naming, in order, the sub session whose
//   slot this read freed or an earlier read kept, when there is one. A sub
//   session whose slot is still kept for the parent's begin by hand is never
//   claimed, so the parent's begin is the only one while the slot is kept;
// - a claim whose begin did not go is tried again once its last try is
//   CALL_TIMEOUT_MS old and the list shows its session unarchived.
// A claim and a try add a begin effect and record the try's time.
// It answers the ledger, and takes out of `freedBy` the name of each freed
// slot that a claim filled.
function queueStep(
  t: ForemanTickets,
  q: {
    rows: readonly SubRow[]; byFile: ReadonlyMap<string, SubRow>; now: number; slots: number; look: ListLook | null
    freedBy: string[]; effects: ForemanEffect[]; logs: string[]
  },
): ForemanTickets {
  const { rows, now, look, effects, logs } = q
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
      // Its queue time is left unknown on purpose. Foreman never sent the
      // begin message, so it has no stamp of its own for the end of the
      // wait, and neither builder's start, which comes as soon as the
      // waiting session loads, nor the time of this read measures it.
      logs.push(`${who} began before foreman's begin message, so foreman counts it as busy.`)
      return [{ ...p, queue: null }]
    }
    const over = look === null ? null : overIn(look, p.localId)
    if (over === null) {
      if (p.queue.keptAt === undefined || isReserved(p, now, GONE_MS)) return [p]
      logs.push(`The slot kept for ${who} is no longer kept, because its waiting session showed no progress within five minutes.`)
      const { keptAt: _, ...queue } = p.queue
      return [{ ...p, queue }]
    }
    const dropped = `Dropped ${who} from the queue, because its waiting session ${OVER_WORDS[over]}.`
    if (p.queue.claim === null) {
      logs.push(dropped)
      return []
    }
    const key = p.issueKey !== null && isWholeKey(p.issueKey) ? p.issueKey : null
    if (key === null) {
      logs.push(dropped)
      return []
    }
    logs.push(beginHeldLog(key))
    if (!held.includes(key)) {
      held = [...held, key]
      if (!p.queue.claim.notified) effects.push({ kind: 'notify', text: beginHeldNotice(key) })
    }
    return []
  })
  const isShown = (p: ForemanPairing) => p.localId !== null && look?.byId.get(p.localId)?.surelyUnarchived === true
  let free = freeSlots({ ...t, pairings }, rows, now, q.slots)
  // Each claim goes by the pairing itself rather than by its ticket, so a
  // claim for one pairing never reaches a reserved pairing that shares its
  // ticket in a damaged ledger.
  const claims = new Map<ForemanPairing, string | null>()
  for (const p of queueOf({ ...t, pairings })) {
    if (free <= 0) break
    if (p.queue!.claim !== null || !isShown(p) || isReserved(p, now, GONE_MS)) continue
    claims.set(p, q.freedBy.shift() ?? null)
    free -= 1
  }
  pairings = pairings.map(p => {
    if (p.queue === null || p.standing !== 'active' || p.localId === null) return p
    const claimed = claims.has(p)
    const retried = !claimed && p.queue.claim !== null && isShown(p) && now - p.queue.claim.attemptAt >= CALL_TIMEOUT_MS
    if (!claimed && !retried) return p
    effects.push({ kind: 'begin', to: p.localId, ticket: p.ticket, key: p.issueKey, by: claimed ? claims.get(p)! : null })
    return { ...p, queue: { ...p.queue, claim: { attemptAt: now, notified: p.queue.claim?.notified ?? false } } }
  })
  const next = { ...t, pairings, held }
  return next
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
// milestones come after its other reasons, and foreman reports them itself
// rather than waking the parent with them, since splitReasons in wake.ts sets
// them apart. A list that was read releases each held key that a session in
// it, or in the whole list read beside it as `holders`, shows started.
// An active pairing whose session the list shows over is freed by the over
// rule before its state rules, but after its milestones, so a merge on the
// same read is still reported. The frozen rule runs after the state rule and
// the gone rule, and only on a read whose listing succeeded, as frozenRule
// says.
// When this read freed a slot and a freed slot is left that no claim of
// queueStep filled, the parent is woken with the number of slots free, unless
// none is free once the claims are counted. Each claim counts against one
// freed slot, whichever slot it actually takes. The number counts every free
// slot, not only the freed ones, and leaves out each slot a claim took. While
// a sub session still waits unclaimed, the parent is woken with the kept
// sentence instead, which names the waiting issues and says not to start a
// new one, so foreman never asks for a new issue while one waits. The read
// that wakes the parent with the kept sentence stamps each waiting sub
// session the sentence stands for with its time, so that its slot stays kept
// for the parent's begin by hand for GONE_MS, as isReserved says.
// A read that could not read the desktop app's list cannot claim, so while a
// sub session waits unclaimed it keeps its freed slots in `keptSlots` instead
// of waking the parent for them. The slots kept count as freed by the next
// read that reads the list, or by the next read on which nobody waits
// unclaimed, ahead of that read's own, so the slot-free line can come on a
// later read than the one that freed the slot.
// The spending in each owner's file is taken into the ledger from the
// pairings as the read found them, and the spent list is folded after the
// pairings are decided, so an entry whose pairing this read forgot can fold
// in the same ledger.
// A failed read of the list raises one quiet notification with its fixed
// reason when the ledger's mark says none went since the last read that got
// a list, and sets the mark. A read that got a list clears it, and a read
// that did not ask for the list leaves it as it was.
// A read that asked for the list, whether or not it got one, records its time
// in each active pairing it looked at, which slotsNeedList reads.
export function decide(input: DecideInput): Decision {
  const { rows, now, limits, sessions, folderExists, listed, watchingSince } = input
  const look: ListLook | null = sessions.kind === 'read'
    ? { byId: new Map(sessions.sessions.map(x => [x.sessionId, x])), complete: sessions.complete === true, known: sessions.known === undefined ? null : new Set(sessions.known) }
    : null
  const effects: ForemanEffect[] = []
  const reasons: Reason[] = []
  const logs: string[] = []
  const due: number[] = []
  const kept = input.tickets.keptSlots
  let freed = kept.length
  const freedBy: string[] = [...kept]
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
    const s: Step = { p: { ...p, acts: { ...p.acts, episode } }, episode, row, now, limits, look, effects, reasons, logs, due, freed: 0, freedBy }
    // The milestone sentences follow this pairing's other sentences, so that
    // the slot-free sentence, added after every pairing, stays last.
    const milestones = milestoneRule(s)
    // A read that asked for the list, whether or not it got one, starts a new
    // gone wait of checks once the last one has run out. Stamping only then
    // keeps the ledger unchanged on reads that change nothing else, so they
    // write nothing to the store.
    const checked = s.p.acts.listCheckedAt
    if (sessions.kind !== 'unread' && (checked === null || now - checked >= GONE_MS)) setActs(s, { listCheckedAt: now })
    if (!overRule(s)) {
      STATE_RULES[row.record.state](s)
      goneRule(s)
      if (listed && now - watchingSince >= SETTLE_MS) frozenRule(s)
    }
    reasons.push(...milestones)
    freed += s.freed
    return [s.p]
  })
  let tickets: ForemanTickets = folded(capped({ ...withReadings(input.tickets, rows), pairings, keptSlots: [] }))
  if (!folderExists && !tickets.folderMissing) logs.push('The status folder is missing, so foreman frees no slot until it is back.')
  tickets = { ...tickets, folderMissing: !folderExists }
  if (sessions.kind === 'read' && tickets.held.length > 0) {
    const released = releasedBy(tickets.held, [...sessions.sessions, ...(sessions.holders ?? [])])
    if (released.logs.length > 0) tickets = { ...tickets, held: released.held }
    logs.push(...released.logs)
  }
  if (sessions.kind === 'failed' && !tickets.listFailNotified) {
    const why = sessions.reason !== undefined && LIST_FAILURES.has(sessions.reason) ? sessions.reason : REASONS.listRefused
    // The failure's log line already holds the reason, so the notification
    // is quiet.
    effects.push({ kind: 'notify', text: listFailedNotice(why), quiet: true })
    tickets = { ...tickets, listFailNotified: true }
  }
  if (sessions.kind === 'read') tickets = { ...tickets, listFailNotified: false }
  const freedNow = freedBy.slice(kept.length)
  tickets = queueStep(tickets, { rows, byFile, now, slots: input.slots, look, freedBy, effects, logs })
  const unclaimed = waitingUnclaimed(tickets, now, GONE_MS)
  // A read without the list claims nothing, so while a sub session waits
  // unclaimed every freed slot is kept for it. A name the ledger's reader
  // would drop, from a damaged ticket, is not kept, so its slot still wakes.
  const keeps = look === null && unclaimed.length > 0
  const left = keeps ? freedBy.filter(who => !isWhoName(who)) : freedBy
  if (keeps) {
    for (const who of freedNow.filter(isWhoName)) logs.push(`Kept the slot of ${who} for the queue, because the desktop app's list of sessions could not be read.`)
    tickets = { ...tickets, keptSlots: keptSlotsIn(freedBy) }
  }
  // Each claim took the name of a slot this read freed, or of one an earlier
  // read kept, so a name left over is a freed slot that no waiting sub
  // session could take: one the list does not show surely unarchived, or a
  // proposal card that has not started. The parent is woken for it, so a
  // freed slot is never lost: with the kept sentence while someone still
  // waits unclaimed, and with the slot-free sentence otherwise. The parent
  // begins each issue the kept sentence names, so it names at most as many
  // as there are free slots: the first waiting issues in the queue's order
  // are taken first, and only then are names a wake line may not carry and
  // repeated names dropped. A damaged or repeated entry among those first
  // ones therefore makes the sentence name fewer issues, never more than the
  // slots allow.
  if (freed > 0 && left.length > 0) {
    const free = freeSlots(tickets, rows, now, input.slots)
    const firstInQueue = unclaimed.slice(0, Math.max(free, 0))
    const names = [...new Set(firstInQueue.map(p => whoOf(p.issueKey, p.ticket)).filter(isWhoName))]
    const outcome = slotOutcome(free, unclaimed.length === 0 ? null : names)
    if (outcome.kind === 'wake') reasons.push(outcome.reason)
    // The kept sentence stands for exactly the first waiting sub sessions,
    // even when it cannot name them safely and speaks of the issues waiting
    // in the queue, so each of them is stamped. The stamp goes by the
    // pairing itself rather than by its ticket, so two pairings that share
    // a ticket in a damaged ledger cannot widen it.
    if (outcome.kind === 'wake' && outcome.reason.kind === 'slot-kept') {
      const stamped = new Set(firstInQueue)
      tickets = { ...tickets, pairings: tickets.pairings.map(p => (stamped.has(p) && p.queue !== null ? { ...p, queue: { ...p.queue, keptAt: now } } : p)) }
    }
  }
  return { tickets, effects, reasons, logs, nextDueAt: due.length === 0 ? null : Math.min(...due) }
}
