import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register, ResolveInput, ToolCallResult } from 'claude-code'

import { checkOutcome, clampedDue, endsOf, isClaimed, soonestDue, withNote, withoutPaired, type CheckDone } from './checks'
import { CALL_TIMEOUT_MS, decide, desktopOf, freeSlots, GONE_MS, keptByUnreadList, needsList, slotOutcome, startWaits, type Decision, type Limits, type SessionsLook, type SlotOutcome } from './act'
import { isSvgSurface } from './art'
import { becameParentAnswer, COMMAND, commandOf, PASSED_ON, PASTED_LINE, pastedCommandIn, slotsAnswer, type Command } from './commands'
import { BACKGROUND_NUDGE_TEXT, BEGIN_TEXT, failureLine, listSessions, NUDGE_TEXT, openSession, readHeader, REASONS, sendMessage, type DesktopCall, type SendResult } from './desktop'
import { acceptedLog, beginFailedNotice, heldLine, heldLog, heldNotice, heldSentence, isHeldRefusal, isPersonPrompt, keyOfTitle } from './held'
import { ignoredLine, readIssueLink } from './links'
import { isAppParts, isStatusChanged, keptLine, keptNames, NOTED, NOTED_REPLY, NOTED_WHILE_OFF, notesIn } from './notes'
import { bandTree, PANE, paneTree, shownReport, type Elements, type View } from './pane'
import type { ForemanCheck, ForemanEffect, ForemanParent, ForemanTickets } from '../types'
import { PARENT_OFF, parentIn, slotsOf, storeKey } from './parent'
import { usageIn } from './record'
import { spendOf, spentSum } from './spend'
import { afterRead, nameOf, nextReadDelay, READ_LATER_MS, rowsOf, type FileRead, type SubRow } from './subs'
import { printable } from './text'
import {
  addWork, briefFor, carriesTicket, fallbackOf, hasWork, isOffRefused, joinOwners, localIdIn, newPairing, nextPlace, NO_TICKET_SENTENCE, OFF_LOG, OFF_REFUSAL, OUTBOX_EMPTY, ownsTicket,
  runsImplement, shownRows, ticketsIn, ticketsKey, TICKETS_EMPTY, waitingBrief, waitingUnclaimed, WAITING_SENTENCE, withOffRefusal, withUnwatched,
} from './tickets'
import { REASON_WORDS, splitReasons, wakeLine, whoOf } from './wake'

type $ = EngineInterface

// The session's values the band and the pane draw from. They survive a hot
// reload, so the last good read of each file and the time of the next read
// do too.
const parent = atom({ plugin: 'foreman', key: 'parent' } as const, PARENT_OFF)
const files = atom({ plugin: 'foreman', key: 'files' } as const, [])
const readAt = atom({ plugin: 'foreman', key: 'readAt' } as const, null)
const nextReadAt = atom({ plugin: 'foreman', key: 'nextReadAt' } as const, null)
const log = atom({ plugin: 'foreman', key: 'log' } as const, [])
const tickets = atom({ plugin: 'foreman', key: 'tickets' } as const, TICKETS_EMPTY)
const turnRuns = atom({ plugin: 'foreman', key: 'turnRuns' } as const, false)
const quietLine = atom({ plugin: 'foreman', key: 'quietLine' } as const, null)
// The newest report sentence foreman showed and when, for the band. It is
// never stored in the ledger, so a restart drops it.
const report = atom({ plugin: 'foreman', key: 'report' } as const, null)

// The spending builder publishes for the session it runs in, which ownSpend
// reads. Builder writes it; foreman only reads it.
const builderUsage = atom({ plugin: 'builder', key: 'usage' } as const, null)

// How many lines the log keeps.
export const LOG_KEPT = 20

// How often the band is drawn again while the role is on, so the time until
// the next read and a stale file's age stay true.
const REDRAW_MS = 1_000

// The words for a call that did not answer in time.
const NO_ANSWER = `the desktop app did not answer within ${CALL_TIMEOUT_MS / 1000} seconds`

// The soonest the next read may come, when a nudge or a wake falls due.
const SOONEST_READ_MS = 1_000

// The desktop app's start_session tool, as a tool.call hook names it.
const START_TOOL = 'mcp__ccd_session__start_session'

// The thresholds when the options do not set them, in minutes.
const IDLE_MINUTES = 5
const CLEANUP_MINUTES = 15

// The foreman mod: in a session that ran /start-foreman, the parent, it adds a
// ticket to every start_session brief, reads the status files builder
// writes, one per /implement sub session, shows the ones whose ticket it
// issued in a band above the prompt and in a pane, and acts on them: it
// nudges an idle sub session, raises a notification for one that needs the
// person, frees a slot when one finishes, and wakes the parent's model with
// one line when there is a decision to make. In any other session every hook
// passes straight through. The role and the tickets are kept in `$.store`
// under the session's id, so a resume finds them again.

// Module variables reset on every hot reload, which drops the timers too.
// `armed` going false is how the next hook knows to arm them again.
let armed = false
let timer: { cancel: () => void } | undefined
let ticker: { cancel: () => void } | undefined
// The read under way, so a second one waits for it rather than racing it.
let reading: Promise<void> | undefined
// The last pass of checks of sub sessions foreman holds no record of, so the
// next one waits for it and two never overlap.
let checking: Promise<void> = Promise.resolve()
// The timer that makes those checks while the role is off.
let checkTimer: { cancel: () => void } | undefined
// The plugin's options, as register received them. Everything reads them
// from here.
let currentOptions: Record<string, unknown> = {}
// The store write of the ledger under way, so writes go in order, and the
// ledger this copy of the module last stored, as JSON, so a read that changed
// nothing writes nothing.
let persisting: Promise<void> = Promise.resolve()
let lastStored: string | undefined
// The session's working folder, kept at every session start without reading
// anything, so that a session that becomes a parent later can read its
// project's facts from there. Null until a session start names it.
let workingFolder: string | null = null
// The project's usable issue address, as the last read of the fact in a
// parent found it, or null when the project names none or names one that
// cannot be used.
let issueAddress: string | null = null

// The status folder: under CLAUDE_CONFIG_DIR when it is set, else under the
// home folder's `.claude`.
async function statusFolderOf($: $): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const base = typeof config === 'string' && config !== '' ? config : `${(await $.env.get('HOME')) ?? ''}/.claude`
  return `${base.replace(/\/+$/, '')}/foreman/builds`
}

// Adds a line to the log, keeping the newest LOG_KEPT. A line the same as the
// newest one is counted on that one rather than added, so a failure that
// repeats at every read does not push the rest of the log out. It is
// appended inside `update`, so two lines written at once both land.
async function addLog($: $, text: string) {
  await addLogs($, [text])
}

// Adds several lines to the log in one update, each as addLog would.
async function addLogs($: $, texts: readonly string[]) {
  if (texts.length === 0) return
  const at = await $.clock.now()
  await update($, log, lines => {
    let kept = Array.isArray(lines) ? lines : []
    for (const text of texts) {
      const last = kept.at(-1)
      kept = last !== undefined && last.text === text
        ? [...kept.slice(0, -1), { at, text, times: (last.times ?? 1) + 1 }]
        : [...kept, { at, text }].slice(-LOG_KEPT)
    }
    return kept
  })
}

// Reads the Issue link fact from the session's working folder, keeps what it
// found, and, when the fact was ignored, says why once with a toast and the
// same line in the log. Only a parent reads it, so a session that is not one
// reads no file. Nothing here throws, so the read can never stop a session
// from starting or becoming the parent; a failure leaves the keys plain.
async function readLinkFact($: $, dir: string | null) {
  if (dir === null) return
  const found = await readIssueLink(path => $.fs.read(path), dir)
  issueAddress = found.address
  if (found.ignored === null) return
  const line = ignoredLine('foreman', found.ignored)
  // The toast and the line are only a courtesy, since the keys are plain
  // either way. Each has its own try, so a refused toast still leaves the
  // line in the log.
  try {
    $.ui.toast(line)
  } catch {
    // The log line below still says why.
  }
  try {
    await addLog($, line)
  } catch {
    // The toast above already said why.
  }
}

// Changes the parent's settings in $.state and then writes the result to the
// store under this session's id. The change is applied inside `update`, which
// may run it again when another write got in first, so it must not have side
// effects. Answers the settings as written.
async function writeParent($: $, change: (settings: ForemanParent) => ForemanParent): Promise<ForemanParent> {
  let written = PARENT_OFF
  await update($, parent, raw => {
    written = change(parentIn(raw))
    return written
  })
  await $.store.set(storeKey(await $.session.id()), written)
  return written
}

// Changes the ledger in $.state and then writes it to the store under this
// session's id, and answers the ledger written. The change is applied inside
// `update`, which may run it again when another write got in first, so it
// must not have side effects; a caller that needs what the change decided
// keeps it from the last run, as `writeParent` does.
async function writeTickets($: $, change: (t: ForemanTickets) => ForemanTickets): Promise<ForemanTickets> {
  let written = TICKETS_EMPTY
  let unchanged = false
  await update($, tickets, raw => {
    const held = ticketsIn(raw)
    written = change(held)
    unchanged = written === held
    return written
  })
  if (!unchanged) await persistTickets($)
  return written
}

// Writes the ledger $.state holds to the store under this session's id, after
// any write already under way, so the last write to land always carries the
// newest ledger, and logs a write that fails. A ledger the same as the one
// last stored is not written again.
async function persistTickets($: $) {
  const next = persisting.then(async () => {
    const value = ticketsIn(await read($, tickets))
    const text = JSON.stringify(value)
    if (text === lastStored) return
    await $.store.set(ticketsKey(await $.session.id()), value)
    lastStored = text
  })
  persisting = next.catch(() => undefined)
  await next.catch(async error => {
    await addLog($, `Could not save the tickets: ${reasonOf(error)}.`)
  })
}

// An error as the log gives its reason: its message, cleaned and cut, or
// words saying that it gave none.
function reasonOf(error: unknown): string {
  const why = printable(error instanceof Error ? error.message : String(error), 160)
  return why === '' ? 'no reason was given' : why
}

// The thresholds in force, from the options when they are positive numbers.
function limitsOf(options: Record<string, unknown>): Limits {
  const minutes = (raw: unknown, fallback: number) => (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback)
  return { idleMs: minutes(options.idleMinutes, IDLE_MINUTES) * 60_000, cleanupMs: minutes(options.cleanupMinutes, CLEANUP_MINUTES) * 60_000 }
}

// Whether this session is the parent, as $.state holds it.
async function isOn($: $): Promise<boolean> {
  return parentIn(await read($, parent)).isOn
}

// The rows as the last read left them, every file in the folder.
async function rowsNow($: $): Promise<SubRow[]> {
  const kept = await read($, files)
  const at = await read($, readAt)
  const list = Array.isArray(kept) ? kept : []
  return rowsOf(list, typeof at === 'number' ? at : await $.clock.now())
}

// The rows that the open, nudge and release buttons act on, and that the
// count of busy slots reads when a slot is freed. They are the rows that own
// a ticket of this parent that was not freed. Each button looks up the row
// that was pressed in this result, and the band's chips are open buttons
// too. Neither the band nor the pane reads this result: `view` works out
// their rows on its own. These rows must stay the same as the rows the band
// and the pane show, because a button pressed on a row that either shows
// does nothing when this result lacks that row.
async function shownNow($: $): Promise<SubRow[]> {
  return shownRows(await rowsNow($), ticketsIn(await read($, tickets)))
}

// Lists the folder and reads each `.json` file in it. A listing that fails
// on a folder that does not exist reads as no files, with `exists` false;
// any other failure keeps the last good read and logs why, and answers null
// files.
async function readFolder($: $): Promise<{ found: FileRead[] | null; exists: boolean }> {
  const folder = await statusFolderOf($)
  let entries: Awaited<ReturnType<$['fs']['list']>>
  try {
    entries = await $.fs.list(folder)
  } catch (error) {
    if (!(await $.fs.exists(folder).catch(() => true))) return { found: [], exists: false }
    await addLog($, `Could not read the status folder: ${reasonOf(error)}.`)
    return { found: null, exists: true }
  }
  const wanted = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
  const found = await Promise.all(wanted.map(async entry => {
    let text: string | null
    try {
      const got = await $.fs.read(`${folder}/${entry.name}`)
      text = typeof got === 'string' ? got : null
    } catch {
      text = null
    }
    return { file: entry.name, mtimeMs: entry.mtimeMs, text }
  }))
  return { found, exists: true }
}

// Reads the folder, keeps what the read leaves in place, and schedules the
// next read. A read already under way is waited for instead.
function readNow($: $): Promise<void> {
  reading ??= readAndSchedule($).finally(() => {
    reading = undefined
  })
  return reading
}

// One read: the role is checked first, because a read the timer started may
// find it turned off. A listing that failed keeps the files and the time of
// the last read. Then foreman decides what the read leads to, schedules the
// next read, and only then carries out the decision and, when a check fell
// due, makes the checks, without waiting for them, so a desktop tool that is
// slow to answer never holds the reads up. The next read comes at the usual
// delay, or sooner when a nudge, a wake or a check falls due.
async function readAndSchedule($: $) {
  try {
    if (!(await isOn($))) return
    const listing = await readFolder($)
    const now = await $.clock.now()
    if (listing.found !== null) {
      const found = listing.found
      await update($, files, kept => afterRead(Array.isArray(kept) ? kept : [], found))
      await update($, readAt, () => now)
    }
    const { decision, rows, written } = await decideNow($, listing.exists, listing.found !== null, now)
    const usual = nextReadDelay(shownRows(rows, decision.tickets))
    const checkDue = soonestDue(written.checks)
    const dues = [decision.nextDueAt, checkDue].filter((at): at is number => at !== null)
    const delay = dues.length === 0 ? usual : Math.min(usual, Math.max(Math.min(...dues) - now, SOONEST_READ_MS))
    schedule($, delay)
    await update($, nextReadAt, () => now + delay)
    later($, async () => {
      await carryOut($)
      if (checkDue !== null && checkDue <= now) await checkNow($)
    })
  } catch {
    // A read that failed partway still schedules the next one, after the
    // slow interval, so a parent left alone keeps refreshing. Only when that
    // fails too is the timer left for the next hook to arm again.
    try {
      schedule($, READ_LATER_MS)
      const now = await $.clock.now()
      await update($, nextReadAt, () => now + READ_LATER_MS)
    } catch {
      armed = false
    }
  }
}

// Runs `work` from a timer of its own rather than from the hook that asked
// for it, without waiting for it. The engine refuses a prompt submitted from
// inside a command's hook, which would wait on the turn the hook holds, and
// the first read runs inside /start-foreman's hook.
function later($: $, work: () => Promise<unknown>) {
  $.clock.after(0, () => {
    void work().catch(() => undefined)
  })
}

// Joins the rows to the ledger, reads the desktop app's list of sessions when
// a rule, a held key or the queue needs it, and decides what the read leads
// to, inside the ledger's update, so the decision and the ledger it was made
// on are written together and no other writer can claim the same nudge, wake
// or begin. A check of a sub session that a pairing now holds is dropped in
// the same update, since the pairing's own watch takes over, and a due time
// that lies too far ahead is pulled in, so it stays where it was put rather
// than being pushed on at every read. The ledger written comes back with the
// decision, so the caller schedules the checks without reading it again. A
// list that could not be read is logged with what it kept from happening: a
// freed slot when a slot rule needed it, else a released hold when a key is
// held, and otherwise a queued issue begun or dropped.
async function decideNow($: $, folderExists: boolean, listed: boolean, now: number): Promise<{ decision: Decision; rows: SubRow[]; written: ForemanTickets }> {
  const rows = await rowsNow($)
  const before = joinOwners(ticketsIn(await read($, tickets)), rows).tickets
  let sessions: SessionsLook = { kind: 'unread' }
  if (needsList(before, rows, now)) {
    const sessionList = await within($, listSessions(desktopCall($)))
    if (sessionList === TIMED_OUT || 'reason' in sessionList) {
      const why = sessionList === TIMED_OUT ? NO_ANSWER : sessionList.reason
      sessions = { kind: 'failed' }
      await addLog($, `Could not read the desktop app's list of sessions, so ${keptByUnreadList(before, rows, now)}: ${why}.`)
    } else {
      const known = before.pairings.flatMap(p => (p.localId === null ? [] : [p.localId]))
      sessions = { kind: 'read', sessions: sessionList.sessions, complete: sessionList.complete, known }
    }
  }
  const settings = parentIn(await read($, parent))
  const input = { rows, now, limits: limitsOf(currentOptions), sessions, folderExists, listed, slots: slotsOf(settings, currentOptions.slots) }
  let decision: Decision = { tickets: TICKETS_EMPTY, effects: [], reasons: [], logs: [], nextDueAt: null }
  const written = await writeTickets($, t => {
    const joined = joinOwners(t, rows)
    decision = decide({ ...input, tickets: joined.tickets })
    const { wakes, reports } = splitReasons(decision.reasons)
    const line = wakeLine(wakes)
    const work = { logs: [...joined.logs, ...decision.logs], effects: decision.effects, lines: line === null ? [] : [line], reports }
    const checks = clampedDue(withoutPaired(decision.tickets.checks, decision.tickets.pairings), now, input.limits.idleMs)
    return { ...decision.tickets, checks, outbox: addWork(decision.tickets.outbox, work) }
  })
  return { decision, rows, written }
}

// What `within` answers when the call did not answer in time.
const TIMED_OUT = Symbol('timed out')

// The call's answer, or TIMED_OUT when it has not answered within
// CALL_TIMEOUT_MS. A call that rejects rejects here too.
function within<T>($: $, call: Promise<T>): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const deadline = $.clock.after(CALL_TIMEOUT_MS, () => resolve(TIMED_OUT))
    call.then(value => {
      deadline.cancel()
      resolve(value)
    }, error => {
      deadline.cancel()
      reject(error)
    })
  })
}

// The words for a message that did not go.
function sendFailure(result: SendResult | typeof TIMED_OUT): string {
  if (result === TIMED_OUT) return NO_ANSWER
  return result === 'not-connected' ? REASONS.notConnected : REASONS.sendRefused
}

// Sends the nudge `text` to one sub session and logs how it went.
async function nudge($: $, to: string, name: string, why: string, text = NUDGE_TEXT) {
  const result = await within($, sendMessage(desktopCall($), to, text))
  await addLog($, result === 'sent' ? `Nudged ${name} with "${text}"${why}.` : `Could not nudge ${name}: ${sendFailure(result)}.`)
}

// Raises one native notification and logs how it went. A `quiet` one, whose
// text the log already holds, logs only a failure to raise it.
async function notify($: $, text: string, { quiet = false } = {}) {
  try {
    const sent = await within($, $.ui.notify(text, { title: 'foreman' }))
    if (sent === TIMED_OUT) await addLog($, `Could not raise a notification, because it did not go within ${CALL_TIMEOUT_MS / 1000} seconds: ${text}`)
    else if (sent.isSent) {
      if (!quiet) await addLog($, `Raised a notification: ${text}`)
    }
    else await addLog($, `Could not raise a notification (${sent.reason}): ${text}`)
  } catch {
    await addLog($, `Could not raise a notification: ${text}`)
  }
}

// Sends one waiting sub session its begin message and records how it went,
// in one ledger update. A begin that went takes the pairing out of the queue
// and sets its pairing time to now, so it counts as busy and is watched like
// any other from here, and answers the began sentence as a report. A begin
// that did not go keeps the claim, records the time of this try, and raises
// the notification only when this update is the one that first marked the
// failure as told, so two tries at once raise one. It answers null then, and
// also when the pairing no longer waits, as when its record showed it began.
async function beginOne($: $, effect: Extract<ForemanEffect, { kind: 'begin' }>): Promise<string | null> {
  const result = await within($, sendMessage(desktopCall($), effect.to, BEGIN_TEXT)).catch((): SendResult => 'not-connected')
  const now = await $.clock.now()
  const who = whoOf(effect.key, effect.ticket)
  const waits = (p: ForemanTickets['pairings'][number]) => p.ticket === effect.ticket && p.localId === effect.to && p.queue !== null
  if (result === 'sent') {
    let began = false
    await writeTickets($, t => {
      began = t.pairings.some(waits)
      return began ? { ...t, pairings: t.pairings.map(p => (waits(p) ? { ...p, queue: null, pairedAt: now } : p)) } : t
    })
    await addLog($, `Began ${who} with foreman's begin message.`)
    return began ? REASON_WORDS.began({ kind: 'began', who, by: effect.by }) : null
  }
  let tells = false
  await writeTickets($, t => {
    tells = false
    return {
      ...t,
      pairings: t.pairings.map(p => {
        if (!waits(p)) return p
        tells = p.queue!.claim?.notified !== true
        return { ...p, queue: { ...p.queue!, claim: { attemptAt: now, notified: true } } }
      }),
    }
  })
  await addLog($, `Could not begin ${who}: ${sendFailure(result)}.`)
  if (tells) await notify($, beginFailedNotice(who))
  return null
}

// Carries out what the ledger's outbox holds: its log lines, then its nudges,
// notifications and begin messages, then its report sentences together with
// the began sentence of each begin that went, which foreman shows itself,
// and last the lines that wake the parent, each logged with how it went. A
// nudge for a sub session that waits only on background work asks about that
// work, and its log line says so. The outbox is emptied first, in one update,
// so two callers never carry out the same work.
async function carryOut($: $) {
  let work = OUTBOX_EMPTY
  await writeTickets($, t => {
    work = t.outbox
    return hasWork(t.outbox) ? { ...t, outbox: OUTBOX_EMPTY } : t
  })
  if (!hasWork(work)) return
  await addLogs($, work.logs)
  const done = await Promise.all(work.effects.map(async (effect): Promise<string | null> => {
    if (effect.kind === 'notify') await notify($, effect.text, { quiet: effect.quiet === true }).catch(() => undefined)
    else if (effect.kind === 'begin') return beginOne($, effect).catch(() => null)
    else {
      await (effect.about === 'background'
        ? nudge($, effect.to, effect.name, ', because it has waited only on background work', BACKGROUND_NUDGE_TEXT)
        : nudge($, effect.to, effect.name, ', because it has been idle')).catch(() => undefined)
    }
    return null
  }))
  const began = done.flatMap(sentence => (sentence === null ? [] : [sentence]))
  await showReports($, [...work.reports, ...began]).catch(() => undefined)
  for (const line of work.lines) await wake($, line)
}

// Shows report sentences without waking the parent's model: each as a line
// in the log, the newest in the band from now, and all of them joined in one
// notification, which logs only a failure to raise it, since the log already
// holds the sentences.
async function showReports($: $, sentences: readonly string[]) {
  if (sentences.length === 0) return
  await addLogs($, sentences)
  const at = await $.clock.now()
  await update($, report, () => ({ text: sentences.at(-1)!, at }))
  await notify($, sentences.join(' '), { quiet: true })
}

// Wakes the parent's model with one line: appended to the turn that runs, or
// submitted as a prompt when none does. A wake that is refused or fails is
// logged and not tried again, because the ledger already records it.
async function wake($: $, line: string) {
  if (wordsPending !== null && (await within($, wordsPending)) === TIMED_OUT) {
    await addLog($, `Stopped waiting for the words after /start-foreman to be sent, after ${CALL_TIMEOUT_MS / 1000} seconds.`)
  }
  try {
    if (await read($, turnRuns)) {
      const appended = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: line }] } })
      if (appended.deny !== undefined) return await addLog($, `Could not wake the parent (${printable(appended.deny, 120)}): ${line}`)
    } else {
      const submitted = await $.prompt.submit({ text: line })
      if (submitted.drop !== undefined) return await addLog($, `Could not wake the parent (${printable(submitted.drop, 120)}): ${line}`)
    }
    await addLog($, `Woke the parent: ${line}`)
  } catch (error) {
    await addLog($, `Could not wake the parent (${reasonOf(error)}): ${line}`)
  }
}

// Makes the checks that fell due, after the pass under way, if any, so two
// passes never overlap.
function checkNow($: $): Promise<void> {
  checking = checking.then(() => runDueChecks($)).catch(() => undefined)
  return checking
}

// One pass over the checks of sub sessions foreman holds no record of. First,
// in one ledger update, it drops the records a pairing now holds, pulls in a
// due time that lies too far ahead, and claims every record that fell due by
// moving its due time an idle period on, so a second pass, here or in a copy
// of the module after a hot reload, finds nothing due. Then it reads each
// claimed sub session's events header, and nudges it when checkOutcome says
// so. Last, in a second update, endsOf decides which records the outcomes end
// and the log lines, the notification and the wake they leave, and those go
// into the outbox in that same update, so a reload cannot lose them, and are
// then carried out. The pass ends by arming the timer for the next check while
// the role is off, and by carrying out any work still left in the outbox then.
async function runDueChecks($: $) {
  try {
    const now = await $.clock.now()
    const { idleMs } = limitsOf(currentOptions)
    let claims: ForemanCheck[] = []
    await writeTickets($, t => {
      const kept = clampedDue(withoutPaired(t.checks, t.pairings), now, idleMs)
      claims = kept.filter(c => c.dueAt <= now).map(c => ({ ...c, dueAt: now + idleMs }))
      if (kept === t.checks && claims.length === 0) return t
      return { ...t, checks: kept.map(c => claims.find(claim => claim.id === c.id) ?? c) }
    })
    if (claims.length === 0) return
    const done = await Promise.all(claims.map(claim => checkOne($, claim)))
    let queued = false
    await writeTickets($, t => {
      const ended = endsOf(done, t.checks)
      queued = ended.checks !== t.checks
      return queued ? { ...t, checks: ended.checks, outbox: addWork(t.outbox, ended.work) } : t
    })
    if (queued) await carryOut($)
  } finally {
    await ensureOffRoleWork($).catch(() => undefined)
  }
}

// The check of one claimed record: its sub session's events header read
// within CALL_TIMEOUT_MS, a read that did not answer in time counting as a
// failed one, and what checkOutcome makes of it. A nudge first marks the
// record nudged, only while it still holds its claim, so the note of the turn
// the nudge starts finds the mark even when it comes before the send answers,
// and then sends the nudge text. The same update marks the nudge as still
// being sent, so a hot reload before the send leaves a record that the next
// pass nudges again rather than one it wakes the parent about, and the mark is
// cleared once the nudge went, only while the record still holds its claim.
// A record that a note overtook is not nudged. A nudge that went, or one left
// out, leaves the record as it stands, and one that did not go is a failed
// check, which endsOf honours even when a note overtook the record during the
// send.
async function checkOne($: $, claim: ForemanCheck): Promise<CheckDone> {
  const look = await within($, readHeader(desktopCall($), claim.id)).catch(() => ({ reason: REASONS.notConnected }))
  const outcome = checkOutcome(claim, look === TIMED_OUT ? { reason: NO_ANSWER } : look)
  if (outcome.kind !== 'nudge') return { claim, outcome }
  let marked = false
  await writeTickets($, t => {
    marked = t.checks.some(c => isClaimed(c, claim))
    return marked ? { ...t, checks: t.checks.map(c => (isClaimed(c, claim) ? { ...c, nudged: true, answered: false, sending: true } : c)) } : t
  })
  if (!marked) return { claim, outcome: { kind: 'later' } }
  const sent = await within($, sendMessage(desktopCall($), claim.id, NUDGE_TEXT)).catch((): SendResult => 'not-connected')
  if (sent !== 'sent') return { claim, outcome: { kind: 'nudge-failed', reason: sendFailure(sent) } }
  await writeTickets($, t => (t.checks.some(c => isClaimed(c, claim) && c.sending)
    ? { ...t, checks: t.checks.map(c => (isClaimed(c, claim) ? { ...c, sending: false } : c)) }
    : t))
  await addLog($, `Nudged the sub session ${claim.id} with "${NUDGE_TEXT}", because it has been idle.`)
  return { claim, outcome: { kind: 'later' } }
}

// Does what the role being off leaves to the hooks, from one read of the role
// and one parse of the ledger. It arms the timer for the checks at the soonest
// due time of the records, replacing any timer already armed, or none when no
// record is left, and carries out work left in the outbox, as when a check
// queued it and a hot reload dropped the call that would have carried it out.
// While the role is on it cancels the timer and carries out nothing, because
// the read loop makes the checks then and ensureArmed carries out the outbox.
// It reads the role every time, so every hook that calls it hands the checks
// to whichever of the two applies, and the first hook after a hot reload arms
// the timer again and carries out the work left behind.
async function ensureOffRoleWork($: $) {
  if (await isOn($)) {
    checkTimer?.cancel()
    checkTimer = undefined
    return
  }
  const t = ticketsIn(await read($, tickets))
  const now = await $.clock.now()
  const due = soonestDue(clampedDue(t.checks, now, limitsOf(currentOptions).idleMs))
  checkTimer?.cancel()
  checkTimer = due === null
    ? undefined
    : $.clock.after(Math.max(due - now, 0), () => {
      checkTimer = undefined
      void checkNow($).catch(() => undefined)
    })
  if (hasWork(t.outbox)) later($, () => carryOut($))
}

// Arms the timer for the next read `delay` from now, replacing any timer
// already armed.
function schedule($: $, delay: number) {
  timer?.cancel()
  timer = $.clock.after(delay, () => {
    void readNow($).catch(() => undefined)
  })
}

// Arms the read timer and the redraw ticker when the role is on and they are
// not armed, as after a hot reload dropped them: from the saved time of the
// next read, reading at once when that time has passed or none was saved.
async function ensureArmed($: $) {
  if (armed || !(await isOn($))) return
  armed = true
  ticker ??= $.clock.every(REDRAW_MS, () => $.ui.invalidate('ui.render'))
  // Work a read decided before a reload dropped the timer that would have
  // carried it out is carried out now.
  if (hasWork(ticketsIn(await read($, tickets)).outbox)) later($, () => carryOut($))
  const due = await read($, nextReadAt)
  const now = await $.clock.now()
  if (typeof due === 'number' && Number.isFinite(due) && due > now) schedule($, due - now)
  else await readNow($)
}

// What this session spent, from the `usage` value builder publishes in its
// state, because builder counts in every session where it runs. Only
// `sessionId`, `models` and `usd` are read. The spending is unknown when there
// is no value, when foreman cannot read it, and when it is stamped with
// another session id, as builder's value still is after a /clear until builder
// counts its first step.
// Builder's contract types the value, but a build of builder that stored it in
// another shape may have left one behind, so it is still parsed with usageIn.
async function ownSpend($: $) {
  const usage = await read($, builderUsage)
  if (typeof usage !== 'object' || usage === null) return null
  if (usage.sessionId !== (await $.session.id())) return null
  return spendOf(usageIn(usage))
}

// The View the band and the pane draw from. The ledger is read and parsed
// once per draw, for both the rows and the sum. The spending figures are
// worked out only when `withSpending` is set, which only the pane sets,
// because the band never shows them and is drawn every second and again
// after each change to builder's usage value, which reading that value while
// drawing subscribes the drawing to. They are also worked out only in a
// parent, because only the parent's pane shows them.
async function view($: $, withSpending: boolean): Promise<View> {
  const settings = parentIn(await read($, parent))
  const due = await read($, nextReadAt)
  const lines = await read($, log)
  const ledger = settings.isOn ? ticketsIn(await read($, tickets)) : null
  const isSpendingShown = withSpending && ledger !== null
  const now = await $.clock.now()
  return {
    isOn: settings.isOn,
    slots: slotsOf(settings, currentOptions.slots),
    rows: ledger === null ? [] : shownRows(await rowsNow($), ledger),
    now,
    nextReadAt: typeof due === 'number' && Number.isFinite(due) ? due : null,
    log: Array.isArray(lines) ? lines : [],
    issueLink: settings.isOn ? issueAddress : null,
    subsSpent: isSpendingShown ? spentSum(ledger) : null,
    ownSpent: isSpendingShown ? await ownSpend($) : null,
    report: settings.isOn ? shownReport(await read($, report), now) : null,
  }
}

// The elements the band and the pane draw with on the surface `e` names:
// `Svg` only on a surface that draws images, because the engine's table names
// every element on every surface and draws one the surface lacks as nothing.
function elementsOf($: $, e: ResolveInput): Elements {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Link } = ui
  if (!isSvgSurface(e.surface)) return { Box, Text, Button, Link }
  return { Box, Text, Button, Link, Svg: (ui as { Svg: NonNullable<Elements['Svg']> }).Svg }
}

// The columns the engine gives a band or a pane, when they are a number.
function columnsOf(columns: unknown): number | undefined {
  return typeof columns === 'number' && Number.isFinite(columns) ? columns : undefined
}

// The desktop app's tools, called through the engine.
const desktopCall = ($: $): DesktopCall => (server, tool, args) => $.mcp.call(server, tool, args)

// Opens the sub session whose file is `file` beside the parent, and says
// what happened: a line in the log when it opened, and a toast with the same
// line in the log when it did not.
async function openRow($: $, file: string) {
  const row = (await shownNow($)).find(r => r.file === file)
  if (row === undefined) return
  const result = await openSession(desktopCall($), row.record)
  if ('opened' in result) {
    await addLog($, `Opened ${nameOf(row)} beside this session.`)
    return
  }
  const line = failureLine(nameOf(row), result.reason)
  $.ui.toast(line)
  await addLog($, line)
}

// The Nudge button: the same message the idle rule sends, at once, to the
// row's desktop session. It does not count toward the idle rule's nudges.
async function nudgeRow($: $, file: string) {
  const row = (await shownNow($)).find(r => r.file === file && r.isReleased !== true)
  if (row === undefined) return
  const p = ticketsIn(await read($, tickets)).pairings.find(q => ownsTicket(q, row))
  const to = p === undefined ? null : desktopOf(p, row)
  if (to === null) return addLog($, `Could not nudge ${nameOf(row)}: foreman knows no desktop session for it.`)
  await nudge($, to, nameOf(row), ', because Nudge was pressed')
}

// What a freed slot leads to now, from the slots free.
async function slotOutcomeNow($: $) {
  const settings = parentIn(await read($, parent))
  return slotOutcome(freeSlots(ticketsIn(await read($, tickets)), await rowsNow($), await $.clock.now(), slotsOf(settings, currentOptions.slots)))
}

// The ledger with a freed slot's outcome applied: the slot wake put in the
// outbox, which carryOut then sends, as a read's wakes are, so a reload
// before it is sent loses nothing.
function withSlotOutcome(t: ForemanTickets, outcome: SlotOutcome): ForemanTickets {
  if (outcome.kind === 'none') return t
  return { ...t, outbox: addWork(t.outbox, { logs: [], effects: [], lines: [wakeLine([outcome.reason])!] }) }
}

// After Release freed a slot: a read begins the first waiting sub session
// when one waits unclaimed, and otherwise the parent is woken with the number
// of slots free. Nothing happens when no slot is free.
async function slotFreed($: $) {
  if (waitingUnclaimed(ticketsIn(await read($, tickets)), await $.clock.now(), GONE_MS).length > 0) {
    later($, () => readNow($))
    return
  }
  const outcome = await slotOutcomeNow($)
  await writeTickets($, t => withSlotOutcome(t, outcome))
  later($, () => carryOut($))
}

// The Release button: the row's ticket is released, which frees its slot
// without archiving the session or touching its status file. The row stays
// in the pane, dimmed, until its file leaves the folder.
async function releaseRow($: $, file: string) {
  const row = (await shownNow($)).find(r => r.file === file && r.isReleased !== true)
  if (row === undefined) return
  let released = false
  await writeTickets($, t => {
    released = false
    return {
      ...t,
      pairings: t.pairings.map(p => {
        if (!ownsTicket(p, row) || p.standing !== 'active') return p
        released = true
        return { ...p, standing: 'released' }
      }),
    }
  })
  if (!released) return
  await addLog($, `Released ${nameOf(row)}; its session and its status file are left as they are.`)
  await slotFreed($)
}

// The tool.call hook on start_session, in a parent: a forked start and a
// title of the wrong shape are refused, a call with a brief gets the ticket
// line, and a "No issue: " title gets the ticket in place of its marker. A
// call with no brief goes on unchanged. A call with a ticket reserves its
// pairing before it goes on, and a keyed one decides in the same ledger update
// whether it waits, as startWaits says, so several starts in one turn see each
// other and exactly as many go ahead as there are free slots. A start that
// waits goes on with the wait line first in its brief and takes the next place
// in the queue. A call that throws beneath the hook takes its reservation
// back out. Every call that went on has its answer read by afterStart.
// The call is typed as the engine gives an MCP tool's, with the tool's
// arguments spread on it, so briefFor can read `prompt`, `context`, `title`
// and `proposal_id`.
async function startSession<E extends Record<string, unknown>>($: $, e: E, next: (e: E) => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const brief = briefFor(e, crypto.randomUUID(), await $.session.id())
  if (brief.kind === 'deny') {
    await addLog($, brief.log).catch(() => undefined)
    return { deny: brief.text }
  }
  const key = keyOfTitle(e.title)
  const ticket = brief.kind === 'add' ? brief.ticket : null
  let waits = false
  if (ticket !== null) {
    const now = await $.clock.now()
    const rows = await rowsNow($)
    const slots = slotsOf(parentIn(await read($, parent)), currentOptions.slots)
    await writeTickets($, t => {
      waits = key !== null && startWaits(t, rows, now, slots)
      return { ...t, pairings: [...t.pairings, newPairing(ticket, null, now, key, waits ? { place: nextPlace(t), claim: null } : null)] }
    })
  }
  let sent: E = e
  if (brief.kind === 'add') {
    const prompt = waits ? waitingBrief(key!, brief.prompt) : brief.prompt
    sent = { ...e, prompt, ...(brief.title === undefined ? {} : { title: brief.title }) }
  }
  let out: ToolCallResult
  try {
    out = await next(sent)
  } catch (error) {
    if (ticket !== null) await writeTickets($, t => withoutPairing(t, ticket)).catch(() => undefined)
    throw error
  }
  try {
    return await afterStart($, key, sent.title, ticket, waits, out)
  } catch {
    // The call has run; its answer goes back to the model as it came,
    // whatever happened to the pairing or the hold.
    return out
  }
}

// The ledger without the pairing of `ticket`, as a start that did not go on
// leaves it.
const withoutPairing = (t: ForemanTickets, ticket: string): ForemanTickets => (t.pairings.some(p => p.ticket === ticket)
  ? { ...t, pairings: t.pairings.filter(p => p.ticket !== ticket) }
  : t)

// Whether start_session's answer is a start that went on: neither refused
// nor an error.
const wentOn = (out: ToolCallResult): out is Extract<ToolCallResult, { result: unknown }> => out.deny === undefined && out.isError !== true

// The desktop session id start_session's answer names, or null. Core answers
// the text the model reads beside the tool's result; a hook beneath may
// answer the result alone, whose text blocks hold the id then.
const localIdOf = (out: Extract<ToolCallResult, { result: unknown }>) => localIdIn(typeof out.text === 'string' ? out.text : JSON.stringify(out.result ?? ''))

// The tool.call hook on start_session while the role is off. A call whose
// brief does not run /implement goes on untouched. The first one that does,
// in this session, is refused, so the parent's model tells the person that
// foreman is off before anything starts; whether this session was already
// refused is decided inside the ledger's update, so two calls at once give
// exactly one refusal, and a store write that fails, which persistTickets
// logs, still refuses. Every later one goes on as it came, and an answer that
// is not a deny or an error gets the sentence that says foreman does not
// watch the sub session, whose id joins the unwatched list. Each step after
// the call has its own try, so a failure there returns the answer as it came.
async function offStart<E extends Record<string, unknown>>($: $, e: E, next: (e: E) => Promise<ToolCallResult>): Promise<ToolCallResult> {
  if (!runsImplement(e)) return next(e)
  const id = await $.session.id()
  let refuses = false
  await writeTickets($, t => {
    refuses = !isOffRefused(t, id)
    return refuses ? withOffRefusal(t, id) : t
  })
  if (refuses) {
    await addLog($, OFF_LOG).catch(() => undefined)
    return { deny: OFF_REFUSAL }
  }
  const out = await next(e)
  if (!wentOn(out)) return out
  let answer: ToolCallResult = out
  try {
    answer = withNoTicket(out)
  } catch {
    // The answer goes back as it came.
  }
  try {
    const localId = localIdOf(out)
    if (localId !== null) await writeTickets($, t => withUnwatched(t, localId))
  } catch {
    // A sub session that is not listed gets today's Noted line for its notes.
  }
  return answer
}

// The answer with the sentence that says the sub session has no ticket added
// to its context.
const withNoTicket = (out: Extract<ToolCallResult, { result: unknown }>): ToolCallResult => ({ ...out, context: [...(out.context ?? []), NO_TICKET_SENTENCE] })

// What foreman does with start_session's answer, for a call whose title
// began with `key`, or null, that went on with `title`, which the app repeats
// in its answers, that carried `ticket`, or null, and that `waits` in the
// queue or not. Either refusal that isHeldRefusal knows takes the start's
// reservation out and holds the key, in one update with its log line and one
// notification, raised only when the key is newly held, and the answer goes
// back with the holding sentence as context. Any other answer that is not a
// deny and not an error is accepted: its reservation takes the desktop session
// id it names, or none for a proposal card, or is added again when it is gone,
// so a hot reload in between loses nothing, and its key is released. A start
// that waits gets the sentence that says its issue is queued. Every other
// answer takes the reservation out and goes back as it came.
async function afterStart($: $, key: string | null, title: unknown, ticket: string | null, waits: boolean, out: ToolCallResult): Promise<ToolCallResult> {
  const unreserved = (t: ForemanTickets) => (ticket === null ? t : withoutPairing(t, ticket))
  if (out.deny === undefined && isHeldRefusal(out, title)) {
    if (key === null) {
      await writeTickets($, unreserved)
      return out
    }
    await writeTickets($, raw => {
      const t = unreserved(raw)
      return t.held.includes(key)
        ? t
        : { ...t, held: [...t.held, key], outbox: addWork(t.outbox, { logs: [heldLog(key)], effects: [{ kind: 'notify', text: heldNotice(key) }], lines: [] }) }
    })
    later($, () => carryOut($))
    return { ...out, context: [...(out.context ?? []), heldSentence(key)] }
  }
  if (!wentOn(out)) {
    await writeTickets($, unreserved)
    return out
  }
  const localId = localIdOf(out)
  const at = await $.clock.now()
  await writeTickets($, t => {
    const paired = ticket === null ? t : withAnswer(t, ticket, localId, at, key, waits)
    if (key === null || !paired.held.includes(key)) return paired
    return { ...paired, held: paired.held.filter(k => k !== key), outbox: addWork(paired.outbox, { logs: [acceptedLog(key)], effects: [], lines: [] }) }
  })
  later($, () => carryOut($))
  if (ticket !== null) {
    await addLog($, localId === null
      ? `Gave ticket ${ticket} to a sub session that has not started yet.`
      : `Paired ticket ${ticket} with ${localId}.`)
  }
  return waits && key !== null ? { ...out, context: [...(out.context ?? []), WAITING_SENTENCE(key)] } : out
}

// The ledger with the reservation of `ticket` given the desktop session id
// the start's answer named, or with the pairing added again, at the back of
// the queue when it waits, when the reservation is gone.
function withAnswer(t: ForemanTickets, ticket: string, localId: string | null, at: number, key: string | null, waits: boolean): ForemanTickets {
  if (t.pairings.some(p => p.ticket === ticket)) return { ...t, pairings: t.pairings.map(p => (p.ticket === ticket ? { ...p, localId } : p)) }
  return { ...t, pairings: [...t.pairings, newPairing(ticket, localId, at, key, waits ? { place: nextPlace(t), claim: null } : null)] }
}

// Whether a prompt is only its text: a slash command, attachments or context
// another hook added each mean there is something more for the model to read.
const isPlain = (e: PromptSubmitInput) => e.command === undefined && (e.attachments?.length ?? 0) === 0 && (e.context?.length ?? 0) === 0

// What foreman does with a prompt made only of the app's notes and messages,
// and the ids of the sub sessions foreman holds no record of whose turn-end
// notes it holds, which foreman then checks by itself: while the role is on,
// each one whose id no pairing holds, whatever its standing, and while it is
// off, each one in the unwatched list. A prompt made only of turn-end notes,
// each about a sub session foreman checks or, while the role is on, one this
// parent tracks, is kept from the parent's model by rewriting it to the log
// line for it, which names a checked one by its bare id. While the role is
// on, any other such prompt goes on with the Noted line. While it is off, one
// that holds a note about a sub session foreman checks goes on with the Noted
// line without the sentences about foreman's reports, and every other prompt
// goes on as it came, which withPasted or withHeld may give a line.
// The text is checked before any state is read, so a prompt the person typed
// waits here on no read, and the ledger is read only for a prompt that holds
// a turn-end note. A prompt the person typed that goes on does wait for
// reads of the role and the ledger, to learn whether foreman is off or any key
// is held.
type Choice = { kind: 'keep'; line: string; checks: string[] } | { kind: 'noted'; context: string; checks: string[] } | { kind: 'pass' }

async function choiceFor($: $, e: PromptSubmitInput): Promise<Choice> {
  if (!isPlain(e)) return { kind: 'pass' }
  const notes = notesIn(e.text)
  if (!notes.wantsNoted) return { kind: 'pass' }
  const on = await isOn($)
  if (notes.allTurnEnds.length === 0) return on ? { kind: 'noted', context: NOTED, checks: [] } : { kind: 'pass' }
  const { pairings, unwatched } = ticketsIn(await read($, tickets))
  const isChecked = (id: string) => (on ? !pairings.some(p => p.localId === id) : unwatched.includes(id))
  const checks = [...new Set(notes.allTurnEnds.filter(isChecked))]
  if (notes.turnEnds !== null) {
    const tracked = notes.turnEnds.filter(id => !isChecked(id))
    // Every note is about a checked sub session, so the prompt is kept and its
    // line names only those.
    if (tracked.length === 0) return { kind: 'keep', line: keptLine([...checks].sort()), checks }
    // While the role is on, the prompt is kept when every other note is about
    // a sub session foreman tracks, and its line names those too.
    if (on) {
      const names = keptNames(tracked, pairings)
      if (names !== null) return { kind: 'keep', line: keptLine([...names, ...checks].sort()), checks }
    }
    // While the role is off, a note about a sub session foreman does not check
    // reaches the parent's model, so the prompt is not kept.
  }
  if (on) return { kind: 'noted', context: NOTED, checks }
  return checks.length === 0 ? { kind: 'pass' } : { kind: 'noted', context: NOTED_WHILE_OFF, checks }
}

// Records a turn-end note, read now, about each of the sub sessions `ids`
// names, in one ledger update, so each one's check falls due an idle period
// from now.
async function noteChecks($: $, ids: readonly string[]) {
  if (ids.length === 0) return
  const now = await $.clock.now()
  const { idleMs } = limitsOf(currentOptions)
  await writeTickets($, t => ({ ...t, checks: ids.reduce((checks, id) => withNote(checks, id, now, idleMs), t.checks) }))
}

// The prompt with the pasted line added to its context, when it is the
// person's own, holds no slash command, is not made only of the app's parts,
// holds /start-foreman as text at the start of a line, and the role is off,
// or else as it came. The text is checked before the role is read, so most
// prompts read nothing here, and nothing is written.
async function withPasted($: $, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (e.command !== undefined || !isPersonPrompt(e) || isAppParts(e.text) || !pastedCommandIn(e.text)) return e
  if (await isOn($)) return e
  return { ...e, context: [...(e.context ?? []), PASTED_LINE] }
}

// The prompt with the held line added to its context, when it is the
// person's own, the role is on and some key is held, or else as it came.
// Whose prompt it is is checked first, so a plugin's prompt, foreman's own
// wake among them, reads no state here.
async function withHeld($: $, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (!isPersonPrompt(e) || !(await isOn($))) return e
  const held = ticketsIn(await read($, tickets)).held
  return held.length === 0 ? e : { ...e, context: [...(e.context ?? []), heldLine(held)] }
}

// Whether foreman answers the first step of a turn of the session's own loop
// itself: only when a rewritten note left its line as the marker, and the
// conversation ends with that line as a user message that no other user
// message comes right before, so the line is the turn's only prompt. The
// marker is read first, so a turn with no marker set writes nothing. A set
// marker is then read and cleared in one swap before the conversation is
// read, so a marker that a new note sets in between is not wiped. Any failure
// means the model answers.
async function answersAlone($: $): Promise<boolean> {
  try {
    if ((await read($, quietLine)) === null) return false
    const held = { line: null as string | null }
    await update($, quietLine, line => {
      held.line = line
      return null
    })
    if (held.line === null) return false
    const messages = await $.session.messages()
    if (!Array.isArray(messages)) return false
    const last = messages.at(-1)
    return last?.role === 'user' && last.text === held.line && messages.at(-2)?.role !== 'user'
  } catch {
    return false
  }
}

// While the words typed after /start-foreman wait to be sent, the promise
// that settles once they have been, or null when no words wait. A wake waits
// for it, so the model reads the person's words before any line of foreman's
// own, such as a free slot that the first read finds. A wake waits at most
// CALL_TIMEOUT_MS, so a timer that never runs or a submit that never answers
// cannot silence every later wake.
let wordsPending: Promise<void> | null = null

// What /start-foreman answers once it is done. When the person typed words
// after the command and the count, they go to the parent's model as the
// person's own prompt, after the role is on. They are submitted from a timer,
// because the engine refuses a prompt submitted from inside the command's
// hook. Wakes are held back from before the role turns on, because turning it
// on makes the first read, which may find a wake to send.
async function runCommand($: $, args: string): Promise<string> {
  const command = commandOf(args)
  if (command.kind === 'refused') return command.text
  const prompt = command.prompt
  if (prompt === null) return applyCommand($, command)
  let release = () => {}
  const pending = new Promise<void>(resolve => {
    release = resolve
  })
  wordsPending = pending
  const done = () => {
    release()
    if (wordsPending === pending) wordsPending = null
  }
  try {
    const answer = await applyCommand($, command)
    later($, () => passOn($, prompt).finally(done))
    return `${answer} ${PASSED_ON}`
  } catch (error) {
    done()
    throw error
  }
}

// Submits the words the person typed after /start-foreman as their own
// prompt, only when the role is on, so that the model reads them as the
// parent. A refusal is logged, so the person can see why nothing answered.
async function passOn($: $, prompt: string) {
  try {
    if (!(await isOn($))) return await addLog($, 'Did not pass on the words after /start-foreman, because the session did not become the parent.')
    const submitted = await $.prompt.submit({ text: prompt, asUser: true })
    if (submitted.drop !== undefined) await addLog($, `Could not pass on the words after /start-foreman (${printable(submitted.drop, 120)}).`)
  } catch (error) {
    await addLog($, `Could not pass on the words after /start-foreman (${reasonOf(error)}).`)
  }
}

async function applyCommand($: $, command: Exclude<Command, { kind: 'refused' }>): Promise<string> {
  // Setting the slot count also makes the session the parent, because a
  // count given to a session that is not one is never what the person meant.
  if (command.kind === 'slots') {
    const wasOn = await isOn($)
    await writeParent($, p => ({ ...p, slots: command.count }))
    // A read begins waiting sub sessions in any slots the new count frees.
    if (wasOn) {
      later($, () => readNow($))
      return slotsAnswer(command.count)
    }
    await becomeParent($)
    return becameParentAnswer(command.count)
  }
  await becomeParent($)
  return 'This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.'
}

// Turns the role on, reads the Issue link fact when the session was not
// already the parent, reads the status folder, hands the checks to the read
// loop and opens the pane.
async function becomeParent($: $) {
  const wasOn = await isOn($)
  await writeParent($, p => ({ ...p, isOn: true }))
  if (!wasOn) await readLinkFact($, workingFolder)
  // Arming makes the first read of the status folder, so it has to come
  // before the pane opens. Opened first, the pane would draw from no read at
  // all and say that the folder holds no sub sessions until the read landed.
  await ensureArmed($)
  await ensureOffRoleWork($).catch(() => undefined)
  await $.ui.open({ id: PANE, title: 'foreman' }).catch(() => undefined)
}

// What the start_session hook answers when it failed, as fallbackOf decides.
// When the call had gone on, next hands back its settled answer rather than
// starting the session again, as builder's own tool.call hook relies on.
// Nothing here may throw, and on a re-entry every $ call rejects.
async function startFallback<E extends Record<string, unknown>>(
  $: $,
  e: E,
  next: ((e: E) => Promise<ToolCallResult>) & { readonly called: boolean; readonly error: { readonly kind: 'throw' | 'timeout' | 're-entry' } },
): Promise<ToolCallResult> {
  const out = await next(e)
  try {
    const { log, sentence } = fallbackOf(next.called, next.error.kind, carriesTicket(e), wentOn(out))
    if (log !== null) await addLog($, log).catch(() => undefined)
    return sentence && wentOn(out) ? withNoTicket(out) : out
  } catch {
    return out
  }
}

export const register: Register = (on, options) => {
  currentOptions = options
  // At the start of a session, and of a resumed one, the store says whether
  // this session is the parent. The role is turned back on from it.
  // The timers are armed only when the role is on, and only then is the
  // Issue link fact read, before the first read draws the band.
  on('session.start', async ($, e, next) => {
    workingFolder = e.cwd
    const id = await $.session.id()
    const rawParent = await $.store.get(storeKey(id))
    const rawTickets = await $.store.get(ticketsKey(id))
    // The stored ledger is taken only while $.state holds none of its own,
    // because a start comes again after a hot reload, when $.state keeps a
    // ledger that may be newer than the stored one.
    if (rawTickets !== undefined && rawTickets !== null) {
      const storedTickets = ticketsIn(rawTickets)
      await update($, tickets, heldRaw => {
        const held = ticketsIn(heldRaw)
        const isEmpty = held.pairings.length === 0 && !hasWork(held.outbox) && held.held.length === 0 && held.offRefusedFor === null && held.unwatched.length === 0
          && held.spent.length === 0 && held.earlier === null && held.keptSlots.length === 0 && held.checks.length === 0
        return isEmpty ? storedTickets : held
      })
    }
    if (rawParent !== undefined && rawParent !== null) {
      const storedParent = parentIn(rawParent)
      await update($, parent, () => storedParent)
      if (storedParent.isOn) {
        await readLinkFact($, workingFolder)
        await ensureArmed($)
      }
    }
    void ensureOffRoleWork($).catch(() => undefined)
    return next(e)
  })

  // /start-foreman is a skill in the person's skills folder, so that the
  // desktop app lists it before a session starts. This hook answers it
  // without calling next, so the skill's own text, which says that the mod is
  // not loaded, never reaches the model while the mod runs.
  // The host already puts the mod's name in front of a command's output.
  // Every /start-foreman also arms the timers again when a hot reload has
  // dropped them, as the hooks below do. Arming does nothing while the role
  // is off or the timers are already armed, so a plain /start-foreman, which
  // armed them in runCommand before opening the pane, changes nothing here.
  on('command.run', { command: COMMAND }, async ($, e) => {
    const text = await runCommand($, typeof e.args === 'string' ? e.args : '')
    await ensureArmed($).catch(() => undefined)
    return { text }
  })

  // After a hot reload, whichever of these hooks comes first arms the timers
  // again. Neither waits for the arming, as builder's do not, because arming
  // may read the whole status folder and the person's prompt or the turn's end
  // should not wait for that read.
  // A prompt made only of turn-end notes about sub sessions this parent tracks
  // or foreman checks goes on with its text replaced by its line in the log,
  // because the pane already shows the tracked ones and foreman checks the
  // others by itself, and the marker holds that line so that the turn.step
  // hook below answers its turn without the model. The host draws a dropped
  // prompt as a warning, which is why the prompt is not dropped. Any other
  // prompt made only of the app's notes and messages goes on with a Noted line
  // as context, as choiceFor says, its text unchanged, and every other prompt
  // goes on as it came, except that the person's own prompt carries the held
  // line as context while a key whose start the app refused is held. A note
  // about a sub session foreman checks is recorded in the ledger before the
  // prompt goes on, so its check falls due an idle period after the note. The
  // marker is set before the line is written, and a hook that throws, a failed
  // write included, passes the prompt on as it came, so no prompt is rewritten
  // without a line in the log or without its marker, and no line in the log
  // speaks of a note that went on unchanged. A marker left by a failed log
  // write is cleared by the next first step, whose last message is then not
  // the line.
  on('prompt.submit', async ($, e, next) => {
    void ensureArmed($).catch(() => undefined)
    const choice = await choiceFor($, e)
    if (choice.kind === 'pass') {
      void ensureOffRoleWork($).catch(() => undefined)
      return next(await withHeld($, await withPasted($, e)))
    }
    await noteChecks($, choice.checks)
    void ensureOffRoleWork($).catch(() => undefined)
    if (choice.kind === 'noted') return next({ ...e, context: [choice.context] })
    await update($, quietLine, () => choice.line)
    await addLog($, choice.line)
    return next({ ...e, text: choice.line })
  }).catch(($, e, next) => next(e))
  // Builder's message that a sub session's status file changed is taken here,
  // so it never reaches the transcript or the model, and starts a read of the
  // folder at once without waiting for it. readNow reuses a read already
  // under way, and readAndSchedule checks that the role is on before it lists
  // the folder, so a message that arrives while foreman is off is taken and
  // nothing is read. The origin's plugin is only the sender's claim, so it is
  // never looked at. Every other delivery, and one met by a hook that throws,
  // passes on as it came.
  on('session.receive', async ($, e, next) => {
    if (e.origin.kind !== 'peer' || !isStatusChanged(e.text)) return next(e)
    void readNow($).catch(() => undefined)
    return { consumed: 'a builder status file changed, so foreman reads its folder' }
  }).catch(($, e, next) => next(e))
  // Whether a turn of the session's own loop runs decides how a wake goes in,
  // so the end of a turn and the start of one below keep turnRuns, whatever
  // the role, because a check that falls due while the role is off can wake
  // the parent too. A subagent's turn raises both events too, and is passed
  // over.
  on('turn.complete', async ($, e, next) => {
    void ensureArmed($).catch(() => undefined)
    void ensureOffRoleWork($).catch(() => undefined)
    if (e.agentId === undefined) await update($, turnRuns, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, turnRuns, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The turn of a prompt that the prompt.submit hook rewrote is answered here
  // with "Noted.", so the model is not asked. Only the first step of a
  // turn of the session's own loop is looked at, and a later step or a
  // subagent's leaves the marker for that first step. answersAlone decides
  // before anything is yielded, because the engine keeps a chunk once it is
  // yielded, and a failure after it would let the model's answer follow
  // foreman's. The role is not checked, since a marker set while it is off,
  // for notes about sub sessions foreman checks, is answered the same way.
  // Unlike the hooks around it, this one has no .catch on purpose: a
  // hook that throws before it yields anything is skipped, so the model
  // answers, while a .catch that called next after a yield would add the
  // model's answer after foreman's.
  on('turn.step', async function* ($, e, next) {
    if (e.index !== 0 || e.agentId !== undefined) return yield* next(e)
    if (!(await answersAlone($))) return yield* next(e)
    yield { kind: 'text', index: 0, text: NOTED_REPLY }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: NOTED_REPLY, toolUses: [], stopReason: 'end_turn', usage: null }
  })

  // Every start_session call in a parent goes through startSession, which
  // checks its title. In any other session it goes through offStart, which
  // refuses the first /implement start once and passes every other call. A
  // hook that throws passes the call on as it came.
  on('tool.call', { tool: START_TOOL }, async ($, e, next) => {
    if (!(await isOn($))) return offStart($, e, next)
    return startSession($, e, next)
  }).catch(startFallback)

  // The pane. Its presses open, nudge or release a sub session.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const presses = {
      open: (file: string) => {
        void openRow($, file).catch(() => undefined)
      },
      nudge: (file: string) => {
        void nudgeRow($, file).catch(() => undefined)
      },
      release: (file: string) => {
        void releaseRow($, file).catch(() => undefined)
      },
    }
    return paneTree(elementsOf($, e), await view($, true), presses, columnsOf(e.props.bodyColumns))
  })

  // The band gives way to Claude Code's survey, and to the host in a session
  // that is not a parent, which bandTree answers with null.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await view($, false)
    const presses = {
      open: (file: string) => {
        void openRow($, file).catch(() => undefined)
      },
    }
    return bandTree(elementsOf($, e), v, columnsOf(e.props.bodyColumns), presses) ?? next(e)
  })
}
