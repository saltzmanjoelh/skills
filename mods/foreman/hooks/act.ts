// What foreman does after each read of the status folder, decided without
// the engine: which sub sessions to nudge, which to raise a notification
// for, which slots to free, and why to wake the parent's model. `decide`
// answers the next ledger together with those effects, and
// hooks/register.tsx carries them out. Every function is pure.

import type { Listed } from './desktop'
import type { BuildState } from './record'
import type { ForemanActs, ForemanEffect, ForemanPairing, ForemanTickets } from '../types'
import { busyCount, nameOf, type SubRow } from './subs'
import { capped, ownsTicket, shownRows } from './tickets'
import { printable } from './text'
import { byTicket, whoOf, type Reason } from './wake'

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

// The desktop app's list of sessions for this read: not read because no rule
// needed it, failed, or read.
export type SessionsLook = { kind: 'unread' } | { kind: 'failed' } | { kind: 'read'; sessions: Listed[] }

// What to do outside the ledger. A nudge goes to a desktop session id and
// names the sub session for the log; a notification carries its text.
export type Effect = ForemanEffect

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
  isPaused: boolean
  slots: number
}

export type Decision = {
  tickets: ForemanTickets
  effects: Effect[]
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
function endedIn(sessions: Listed[], id: string | null): string | null {
  const entry = id === null ? undefined : sessions.find(s => s.sessionId === id)
  if (entry === undefined) return 'is no longer listed'
  if (entry.isArchived) return 'is archived'
  if (!entry.isRunning) return 'is no longer running'
  return null
}

// What one rule may change and add while it looks at one pairing.
type Step = {
  p: ForemanPairing
  row: SubRow
  now: number
  limits: Limits
  sessions: SessionsLook
  effects: Effect[]
  reasons: Reason[]
  logs: string[]
  due: number[]
  freed: number
}

// The rule for each state. It is typed over every state, so a state added to
// builder's record fails the type check until it has a rule here.
const STATE_RULES: Record<BuildState, (s: Step) => void> = {
  'working': s => {
    // A working episode inside an idle stretch keeps the stretch, unless the
    // record made progress or the work lasted a whole threshold.
    const { stretch, episode } = s.p.acts
    if (stretch === null) return
    if (stretch.progress !== progressOf(s.row) || s.now - episode!.since >= s.limits.idleMs) setActs(s, { stretch: null })
  },
  'waiting-on-builder': s => setActs(s, { stretch: null }),
  'idle': idleRule,
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
    const since = s.p.acts.episode!.since
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
    if (s.sessions.kind !== 'read') return
    const ended = endedIn(s.sessions.sessions, desktopOf(s.p, s.row))
    if (ended === null) return
    s.p = { ...s.p, standing: 'freed' }
    s.freed += 1
    s.logs.push(`${nameOf(s.row)} is done and its session ${ended}, so its slot is free.`)
  },
}

const episodeKey = (s: Step) => `${s.p.acts.episode!.state}@${s.p.acts.episode!.since}`
const setActs = (s: Step, change: Partial<ForemanActs>) => {
  s.p = { ...s.p, acts: { ...s.p.acts, ...change } }
}

// Idle: a nudge once the idle episode has lasted the threshold, a second one
// threshold after the first, and the wake one threshold after that, counted
// over a stretch without progress. A record with no desktop session wakes the
// parent at two thresholds instead.
function idleRule(s: Step) {
  const progress = progressOf(s.row)
  let stretch = s.p.acts.stretch
  if (stretch === null || stretch.progress !== progress) stretch = { progress, nudges: 0, lastNudgeAt: null, woke: false }
  setActs(s, { stretch })
  if (stretch.woke) return
  const since = s.p.acts.episode!.since
  const to = desktopOf(s.p, s.row)
  const who = whoOf(s.row.record.issueKey, s.p.ticket)
  if (to === null) {
    const due = since + 2 * s.limits.idleMs
    if (s.now < due) {
      s.due.push(due)
      return
    }
    s.reasons.push({ kind: 'idle', who, nudged: false, minutes: minutesOf(s.now - since) })
    setActs(s, { stretch: { ...stretch, woke: true } })
    return
  }
  const due = Math.max(since, stretch.lastNudgeAt ?? since) + s.limits.idleMs
  if (s.now < due) {
    s.due.push(due)
    return
  }
  if (stretch.nudges < 2) {
    s.effects.push({ kind: 'nudge', ticket: s.p.ticket, to, name: nameOf(s.row) })
    setActs(s, { stretch: { ...stretch, nudges: stretch.nudges + 1, lastNudgeAt: s.now } })
    s.due.push(s.now + s.limits.idleMs)
    return
  }
  s.reasons.push({ kind: 'idle', who, nudged: true, minutes: minutesOf(s.now - since) })
  setActs(s, { stretch: { ...stretch, woke: true } })
}

// Gone, in any state but done: the file has not changed for GONE_MS, the list
// does not show the session running, and the pull request has not merged.
// One stretch is one unchanged modification time.
function goneRule(s: Step) {
  if (s.row.record.state === 'done' || s.sessions.kind !== 'read') return
  if (s.now - s.row.mtimeMs <= GONE_MS || s.p.acts.goneWokeFor === s.row.mtimeMs) return
  if (/^merged$/i.test(s.row.record.pr?.state ?? '')) return
  if (endedIn(s.sessions.sessions, desktopOf(s.p, s.row)) === null) return
  s.reasons.push({ kind: 'gone', who: whoOf(s.row.record.issueKey, s.p.ticket), minutes: minutesOf(s.now - s.row.mtimeMs) })
  setActs(s, { goneWokeFor: s.row.mtimeMs })
}

// The line the log gets when a slot frees while the parent is paused.
export const PAUSED_SLOT_LOG = 'A slot is free, and foreman will say so when it is resumed.'

// What a freed slot leads to, given how many slots are free now: nothing
// when none is, the pause remembered while paused, and otherwise a wake with
// the number free. A read, Release and /foreman resume all decide by it.
export type SlotOutcome = { kind: 'none' } | { kind: 'remember' } | { kind: 'wake'; reason: Reason }

export function slotOutcome(free: number, isPaused: boolean): SlotOutcome {
  if (free <= 0) return { kind: 'none' }
  return isPaused ? { kind: 'remember' } : { kind: 'wake', reason: { kind: 'slot-free', free } }
}

// Whether this read needs the desktop app's list: some active owned record is
// done, or its file is older than GONE_MS.
export function needsList(t: ForemanTickets, rows: readonly SubRow[], now: number): boolean {
  return t.pairings.some(p => p.standing === 'active' && rows.some(r => ownsTicket(p, r) && (r.record.state === 'done' || now - r.mtimeMs > GONE_MS)))
}

// Decides everything one read leads to. A pairing whose owner's file left the
// folder is forgotten, freeing its slot when it was active. A released or
// freed pairing gets no action. When a slot freed, the parent is woken with
// the number of slots free, unless none is free or the parent is paused, in
// which case the pause is remembered.
export function decide(input: DecideInput): Decision {
  const { rows, now, limits, sessions, folderExists, listed } = input
  const effects: Effect[] = []
  const reasons: Reason[] = []
  const logs: string[] = []
  const due: number[] = []
  let freed = 0
  const byFile = new Map(rows.map(r => [r.file, r]))
  const pairings = input.tickets.pairings.flatMap(p => {
    if (p.owner === null || p.ownerFile === null) {
      if (now - p.pairedAt <= UNOWNED_FOR_MS) return [p]
      logs.push(`Forgot ticket ${p.ticket}, because no status file carried it for a day.`)
      return []
    }
    const row = byFile.get(p.ownerFile)
    if (row === undefined) {
      if (!folderExists || !listed) return [p]
      if (p.standing === 'active') {
        freed += 1
        logs.push(`The slot of ${p.issueKey ?? byTicket(p.ticket)} is free, because its file left the status folder.`)
      }
      return []
    }
    if (!ownsTicket(p, row) || p.standing !== 'active') return [p]
    const episode = episodeOf(p.acts.episode, row, now)
    const s: Step = { p: { ...p, acts: { ...p.acts, episode } }, row, now, limits, sessions, effects, reasons, logs, due, freed: 0 }
    STATE_RULES[row.record.state](s)
    goneRule(s)
    freed += s.freed
    return [s.p]
  })
  let tickets: ForemanTickets = capped({ ...input.tickets, pairings })
  if (!folderExists && !tickets.folderMissing) logs.push('The status folder is missing, so foreman frees no slot until it is back.')
  tickets = { ...tickets, folderMissing: !folderExists }
  if (freed > 0) {
    const outcome = slotOutcome(input.slots - busyCount(shownRows(rows, tickets)), input.isPaused)
    if (outcome.kind === 'remember') {
      tickets = { ...tickets, freedWhilePaused: true }
      logs.push(PAUSED_SLOT_LOG)
    } else if (outcome.kind === 'wake') {
      reasons.push(outcome.reason)
    }
  }
  return { tickets, effects, reasons, logs, nextDueAt: due.length === 0 ? null : Math.min(...due) }
}
