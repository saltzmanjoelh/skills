import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptSubmitInput, Register, ResolveInput, ToolCallResult } from 'claude-code'

import { decide, desktopOf, needsList, slotOutcome, type Decision, type Limits, type SessionsLook, type SlotOutcome } from './act'
import { isSvgSurface } from './art'
import { becameParentAnswer, COMMAND, commandOf, slotsAnswer } from './commands'
import { failureLine, listSessions, NUDGE_TEXT, openSession, REASONS, sendMessage, type DesktopCall, type SendResult } from './desktop'
import { keptLine, keptNames, NOTED, NOTES_KEPT, turnEndIds, wantsNoted } from './notes'
import { bandTree, PANE, paneTree, type Elements, type View } from './pane'
import type { ForemanParent, ForemanTickets } from '../types'
import { PARENT_OFF, parentIn, slotsOf, storeKey } from './parent'
import { afterRead, busyCount, nameOf, nextReadDelay, READ_LATER_MS, rowsOf, type FileRead, type SubRow } from './subs'
import { printable } from './text'
import { addWork, briefFor, hasWork, joinOwners, localIdIn, newPairing, OUTBOX_EMPTY, ownsTicket, shownRows, ticketsIn, ticketsKey, TICKETS_EMPTY } from './tickets'
import { wakeLine } from './wake'

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

// How many lines the log keeps.
export const LOG_KEPT = 20

// How often the band is drawn again while the role is on, so the time until
// the next read and a stale file's age stay true.
const REDRAW_MS = 1_000

// How long foreman waits for a desktop tool or a notification before it gives
// up and counts the call as failed, so a call that never answers cannot stop
// the reads.
export const CALL_TIMEOUT_MS = 30_000

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
// The plugin's options, as register received them. Everything reads them
// from here.
let currentOptions: Record<string, unknown> = {}
// The store write of the ledger under way, so writes go in order, and the
// ledger this copy of the module last stored, as JSON, so a read that changed
// nothing writes nothing.
let persisting: Promise<void> = Promise.resolve()
let lastStored: string | undefined

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

// The rows the band and the pane show: those that own a ticket of this
// parent that was not freed.
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
// next read, and only then carries out the decision, without waiting for it,
// so a desktop tool that is slow to answer never holds the reads up. The next
// read comes at the usual delay, or sooner when a nudge or a wake falls due.
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
    const { decision, rows } = await decideNow($, listing.exists, listing.found !== null, now)
    const usual = nextReadDelay(shownRows(rows, decision.tickets))
    const delay = decision.nextDueAt === null ? usual : Math.min(usual, Math.max(decision.nextDueAt - now, SOONEST_READ_MS))
    schedule($, delay)
    await update($, nextReadAt, () => now + delay)
    later($, () => carryOut($))
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
// a rule needs it, and decides what the read leads to, inside the ledger's
// update, so the decision and the ledger it was made on are written together
// and no other writer can claim the same nudge or wake.
async function decideNow($: $, folderExists: boolean, listed: boolean, now: number): Promise<{ decision: Decision; rows: SubRow[] }> {
  const rows = await rowsNow($)
  const before = joinOwners(ticketsIn(await read($, tickets)), rows).tickets
  let sessions: SessionsLook = { kind: 'unread' }
  if (needsList(before, rows, now)) {
    const sessionList = await within($, listSessions(desktopCall($)))
    if (sessionList === TIMED_OUT || 'reason' in sessionList) {
      const why = sessionList === TIMED_OUT ? NO_ANSWER : sessionList.reason
      sessions = { kind: 'failed' }
      await addLog($, `Could not read the desktop app's list of sessions, so no slot was freed: ${why}.`)
    } else {
      sessions = { kind: 'read', sessions: sessionList.sessions }
    }
  }
  const settings = parentIn(await read($, parent))
  const input = { rows, now, limits: limitsOf(currentOptions), sessions, folderExists, listed, slots: slotsOf(settings, currentOptions.slots) }
  let decision: Decision = { tickets: TICKETS_EMPTY, effects: [], reasons: [], logs: [], nextDueAt: null }
  await writeTickets($, t => {
    const joined = joinOwners(t, rows)
    decision = decide({ ...input, tickets: joined.tickets })
    const line = wakeLine(decision.reasons)
    const work = { logs: [...joined.logs, ...decision.logs], effects: decision.effects, lines: line === null ? [] : [line] }
    return { ...decision.tickets, outbox: addWork(decision.tickets.outbox, work) }
  })
  return { decision, rows }
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

// Sends the nudge to one sub session and logs how it went.
async function nudge($: $, to: string, name: string, why: string) {
  const result = await within($, sendMessage(desktopCall($), to, NUDGE_TEXT))
  await addLog($, result === 'sent' ? `Nudged ${name} with "${NUDGE_TEXT}"${why}.` : `Could not nudge ${name}: ${sendFailure(result)}.`)
}

// Raises one native notification and logs how it went.
async function notify($: $, text: string) {
  try {
    const sent = await within($, $.ui.notify(text, { title: 'foreman' }))
    if (sent === TIMED_OUT) await addLog($, `Could not raise a notification, because it did not go within ${CALL_TIMEOUT_MS / 1000} seconds: ${text}`)
    else if (sent.isSent) await addLog($, `Raised a notification: ${text}`)
    else await addLog($, `Could not raise a notification (${sent.reason}): ${text}`)
  } catch {
    await addLog($, `Could not raise a notification: ${text}`)
  }
}

// Carries out what the ledger's outbox holds: its log lines, then its nudges
// and notifications, then the lines that wake the parent, each logged with
// how it went. The outbox is emptied first, in one update, so two callers
// never carry out the same work.
async function carryOut($: $) {
  let work = OUTBOX_EMPTY
  await writeTickets($, t => {
    work = t.outbox
    return hasWork(t.outbox) ? { ...t, outbox: OUTBOX_EMPTY } : t
  })
  if (!hasWork(work)) return
  await addLogs($, work.logs)
  await Promise.all(work.effects.map(effect => (effect.kind === 'nudge'
    ? nudge($, effect.to, effect.name, ', because it has been idle').catch(() => undefined)
    : notify($, effect.text).catch(() => undefined))))
  for (const line of work.lines) await wake($, line)
}

// Wakes the parent's model with one line: appended to the turn that runs, or
// submitted as a prompt when none does. A wake that is refused or fails is
// logged and not tried again, because the ledger already records it.
async function wake($: $, line: string) {
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

// The View the band and the pane draw from.
async function view($: $): Promise<View> {
  const settings = parentIn(await read($, parent))
  const due = await read($, nextReadAt)
  const lines = await read($, log)
  return {
    isOn: settings.isOn,
    slots: slotsOf(settings, currentOptions.slots),
    rows: settings.isOn ? await shownNow($) : [],
    now: await $.clock.now(),
    nextReadAt: typeof due === 'number' && Number.isFinite(due) ? due : null,
    log: Array.isArray(lines) ? lines : [],
  }
}

// The elements the band and the pane draw with on the surface `e` names:
// `Svg` only on a surface that draws images, because the engine's table names
// every element on every surface and draws one the surface lacks as nothing.
function elementsOf($: $, e: ResolveInput): Elements {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  if (!isSvgSurface(e.surface)) return { Box, Text, Button }
  return { Box, Text, Button, Svg: (ui as { Svg: NonNullable<Elements['Svg']> }).Svg }
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
  return slotOutcome(slotsOf(settings, currentOptions.slots) - busyCount(await shownNow($)))
}

// The ledger with a freed slot's outcome applied: the slot wake put in the
// outbox, which carryOut then sends, as a read's wakes are, so a reload
// before it is sent loses nothing.
function withSlotOutcome(t: ForemanTickets, outcome: SlotOutcome): ForemanTickets {
  if (outcome.kind === 'none') return t
  return { ...t, outbox: addWork(t.outbox, { logs: [], effects: [], lines: [wakeLine([outcome.reason])!] }) }
}

// After Release freed a slot: the parent is woken with the number of slots
// free. Nothing happens when no slot is free.
async function slotFreed($: $) {
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
// line, and a "No issue: " title gets the ticket in place of its marker. Once
// the call answered without an error the ticket is paired with the desktop
// session id the answer names, or with none for a proposal card.
// The call is typed as the engine gives an MCP tool's, with the tool's
// arguments spread on it, so briefFor can read `prompt`, `context`, `title`
// and `proposal_id`.
async function startSession<E extends Record<string, unknown>>($: $, e: E, next: (e: E) => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const brief = briefFor(e, crypto.randomUUID())
  if (brief.kind === 'deny') {
    await addLog($, brief.log).catch(() => undefined)
    return { deny: brief.text }
  }
  if (brief.kind === 'pass') return next(e)
  const out = await next({ ...e, prompt: brief.prompt, ...(brief.title === undefined ? {} : { title: brief.title }) })
  try {
    if (out.deny === undefined && out.isError !== true) {
      // Core answers the text the model reads beside the tool's result; a
      // hook beneath may answer the result alone, whose text blocks hold the
      // id then.
      const localId = localIdIn(typeof out.text === 'string' ? out.text : JSON.stringify(out.result ?? ''))
      const at = await $.clock.now()
      await writeTickets($, t => ({ ...t, pairings: [...t.pairings, newPairing(brief.ticket, localId, at)] }))
      await addLog($, localId === null
        ? `Gave ticket ${brief.ticket} to a sub session that has not started yet.`
        : `Paired ticket ${brief.ticket} with ${localId}.`)
    }
  } catch {
    // The call has run; its answer goes back to the model whatever happened
    // to the pairing.
  }
  return out
}

// Whether a prompt is only its text: a slash command, attachments or context
// another hook added each mean there is something more for the model to read.
const isPlain = (e: PromptSubmitInput) => e.command === undefined && (e.attachments?.length ?? 0) === 0 && (e.context?.length ?? 0) === 0

// What foreman does with a prompt while the role is on: keep it from the
// parent's model, with the log line for it, when it is made of turn-end notes
// about sub sessions this parent tracks; let it go on with the Noted line when
// it is made only of the app's notes and messages; or let it go on as it came.
// The text is checked before any state is read, so a prompt the person typed
// never waits on a read, and the ledger is read only for a prompt that may be
// kept.
type Choice = { kind: 'keep'; line: string } | { kind: 'noted' } | { kind: 'pass' }

async function choiceFor($: $, e: PromptSubmitInput): Promise<Choice> {
  if (!isPlain(e) || !wantsNoted(e.text) || !(await isOn($))) return { kind: 'pass' }
  const ids = turnEndIds(e.text)
  const names = ids === null ? null : keptNames(ids, ticketsIn(await read($, tickets)).pairings)
  return names === null ? { kind: 'noted' } : { kind: 'keep', line: keptLine(names) }
}

// What /start-foreman answers once it is done.
async function runCommand($: $, args: string): Promise<string> {
  const command = commandOf(args)
  if (command.kind === 'refused') return command.text
  // Setting the slot count also makes the session the parent, because a
  // count given to a session that is not one is never what the person meant.
  if (command.kind === 'slots') {
    const wasOn = await isOn($)
    await writeParent($, p => ({ ...p, slots: command.count }))
    if (wasOn) return slotsAnswer(command.count)
    await becomeParent($)
    return becameParentAnswer(command.count)
  }
  await becomeParent($)
  return 'This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.'
}

// Turns the role on, reads the status folder and opens the pane.
async function becomeParent($: $) {
  await writeParent($, p => ({ ...p, isOn: true }))
  // Arming makes the first read of the status folder, so it has to come
  // before the pane opens. Opened first, the pane would draw from no read at
  // all and say that the folder holds no sub sessions until the read landed.
  await ensureArmed($)
  await $.ui.open({ id: PANE, title: 'foreman' }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  currentOptions = options
  // At the start of a session, and of a resumed one, the store says whether
  // this session is the parent. The role is turned back on from it.
  // The timers are armed only when the role is on.
  on('session.start', async ($, e, next) => {
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
        return held.pairings.length === 0 && !hasWork(held.outbox) ? storedTickets : held
      })
    }
    if (rawParent !== undefined && rawParent !== null) {
      const storedParent = parentIn(rawParent)
      await update($, parent, () => storedParent)
      if (storedParent.isOn) await ensureArmed($)
    }
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
  // A prompt made only of turn-end notes about sub sessions this parent
  // tracks is dropped, with a line in the log, because the pane already shows
  // them. Any other prompt made only of the app's notes and messages goes on
  // with the Noted line as context, its text unchanged, and every other prompt
  // goes on as it came. The line is written before the drop, and a hook that
  // throws, a failed write included, passes the prompt on as it came, so no
  // prompt is dropped without a line in the log.
  on('prompt.submit', async ($, e, next) => {
    void ensureArmed($).catch(() => undefined)
    const choice = await choiceFor($, e)
    if (choice.kind === 'pass') return next(e)
    if (choice.kind === 'noted') return next({ ...e, context: [NOTED] })
    await addLog($, choice.line)
    return { drop: NOTES_KEPT }
  }).catch(($, e, next) => next(e))
  // Whether a turn of the session's own loop runs decides how a wake goes in,
  // so the end of a turn and the start of one below keep turnRuns. A
  // subagent's turn raises both events too, and is passed over.
  on('turn.complete', async ($, e, next) => {
    void ensureArmed($).catch(() => undefined)
    if (e.agentId === undefined && (await isOn($))) await update($, turnRuns, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && (await isOn($))) await update($, turnRuns, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every start_session call in a parent goes through startSession, which
  // checks its title. In any other session the call passes unchanged. A hook
  // that throws passes the call on as it came.
  on('tool.call', { tool: START_TOOL }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    return startSession($, e, next)
  }).catch(($, e, next) => {
    // Before the call went on, it goes on as it came, without a ticket. Once
    // it went on, a failure is the tool's own, and next hands back its
    // settled answer rather than starting the session again, as builder's
    // own tool.call hook relies on.
    return next(e)
  })

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
    return paneTree(elementsOf($, e), await view($), presses, columnsOf(e.props.bodyColumns))
  })

  // The band gives way to Claude Code's survey, and to the host in a session
  // that is not a parent, which bandTree answers with null.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await view($)
    const presses = {
      open: (file: string) => {
        void openRow($, file).catch(() => undefined)
      },
    }
    return bandTree(elementsOf($, e), v, columnsOf(e.props.bodyColumns), presses) ?? next(e)
  })
}
