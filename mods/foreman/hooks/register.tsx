import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import { isSvgSurface } from './art'
import { commandOf } from './commands'
import { failureLine, openSession, type DesktopCall } from './desktop'
import { bandTree, PANE, paneTree, type Elements, type View } from './pane'
import type { ForemanParent } from '../types'
import { PARENT_OFF, parentIn, slotsOf, storeKey } from './parent'
import { afterRead, nameOf, nextReadDelay, rowsOf, type FileRead, type SubRow } from './subs'
import { printable } from './text'

type $ = EngineInterface

// The session's values the band and the pane draw from. They survive a hot
// reload, so the last good read of each file and the time of the next read
// do too.
const parent = atom({ plugin: 'foreman', key: 'parent' } as const, PARENT_OFF)
const files = atom({ plugin: 'foreman', key: 'files' } as const, [])
const readAt = atom({ plugin: 'foreman', key: 'readAt' } as const, null)
const nextReadAt = atom({ plugin: 'foreman', key: 'nextReadAt' } as const, null)
const log = atom({ plugin: 'foreman', key: 'log' } as const, [])

// How many lines the log keeps.
export const LOG_KEPT = 20

// How often the band is drawn again while the role is on, so the time until
// the next read and a stale file's age stay true.
const REDRAW_MS = 1_000

// The foreman mod: in a session that ran /foreman, the parent, it reads the
// status files builder writes, one per /implement sub session, shows them in
// a band above the prompt and in a pane, and opens a sub session beside the
// parent when its issue is pressed. In any other session every hook passes
// straight through. The role is kept in `$.store` under the session's id, so
// a resume finds it on again.

// Module variables reset on every hot reload, which drops the timers too.
// `armed` going false is how the next hook knows to arm them again.
let armed = false
let timer: { cancel: () => void } | undefined
let ticker: { cancel: () => void } | undefined
// The read under way, so a second one waits for it rather than racing it.
let reading: Promise<void> | undefined

// The status folder: under CLAUDE_CONFIG_DIR when it is set, else under the
// home folder's `.claude`.
async function statusFolderOf($: $): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const base = typeof config === 'string' && config !== '' ? config : `${(await $.env.get('HOME')) ?? ''}/.claude`
  return `${base.replace(/\/+$/, '')}/foreman/builds`
}

// Adds a line to the log, keeping the newest LOG_KEPT. It is appended inside
// `update`, so two lines written at once both land.
async function addLog($: $, text: string) {
  const at = await $.clock.now()
  await update($, log, lines => [...(Array.isArray(lines) ? lines : []), { at, text }].slice(-LOG_KEPT))
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

// Whether this session is the parent, as $.state holds it.
async function isOn($: $): Promise<boolean> {
  return parentIn(await read($, parent)).isOn
}

// The rows as the last read left them.
async function rowsNow($: $): Promise<SubRow[]> {
  const kept = await read($, files)
  const at = await read($, readAt)
  const list = Array.isArray(kept) ? kept : []
  return rowsOf(list, typeof at === 'number' ? at : await $.clock.now())
}

// Lists the folder and reads each `.json` file in it. A listing that fails
// on a folder that does not exist reads as no files; any other failure keeps
// the last good read and logs why, and answers null.
async function readFolder($: $): Promise<FileRead[] | null> {
  const folder = await statusFolderOf($)
  let entries: Awaited<ReturnType<$['fs']['list']>>
  try {
    entries = await $.fs.list(folder)
  } catch (error) {
    if (!(await $.fs.exists(folder).catch(() => true))) return []
    const why = printable(error instanceof Error ? error.message : String(error), 160)
    await addLog($, `Could not read the status folder: ${why === '' ? 'no reason was given' : why}.`)
    return null
  }
  const wanted = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
  return Promise.all(wanted.map(async entry => {
    let text: string | null
    try {
      const got = await $.fs.read(`${folder}/${entry.name}`)
      text = typeof got === 'string' ? got : null
    } catch {
      text = null
    }
    return { file: entry.name, mtimeMs: entry.mtimeMs, text }
  }))
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
// the last read, and the next read is scheduled either way.
async function readAndSchedule($: $) {
  try {
    if (!(await isOn($))) return
    const found = await readFolder($)
    const now = await $.clock.now()
    if (found !== null) {
      await update($, files, kept => afterRead(Array.isArray(kept) ? kept : [], found))
      await update($, readAt, () => now)
    }
    const delay = nextReadDelay(await rowsNow($))
    schedule($, delay)
    await update($, nextReadAt, () => now + delay)
  } catch {
    // A read that failed for any other reason leaves the next hook to arm
    // the timer again.
    armed = false
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
  const due = await read($, nextReadAt)
  const now = await $.clock.now()
  if (typeof due === 'number' && Number.isFinite(due) && due > now) schedule($, due - now)
  else await readNow($)
}

// The View the band and the pane draw from.
async function view($: $, options: Record<string, unknown>): Promise<View> {
  const settings = parentIn(await read($, parent))
  const due = await read($, nextReadAt)
  const lines = await read($, log)
  return {
    isOn: settings.isOn,
    slots: slotsOf(settings, options.slots),
    isPaused: settings.isPaused,
    rows: settings.isOn ? await rowsNow($) : [],
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
  const row = (await rowsNow($)).find(r => r.file === file)
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

// Nudge and Release only say they were pressed in this step.
async function laterAction($: $, file: string, action: 'Nudge' | 'Release') {
  const row = (await rowsNow($)).find(r => r.file === file)
  if (row === undefined) return
  const doing = action === 'Nudge' ? 'nudging' : 'releasing'
  await addLog($, `${action} pressed for ${nameOf(row)}; ${doing} comes in a later step.`)
}

// What each /foreman command answers once it is done.
async function runCommand($: $, args: string): Promise<string> {
  const command = commandOf(args)
  if (command.kind === 'refused') return command.text
  if (command.kind === 'slots') {
    await writeParent($, p => ({ ...p, slots: command.count }))
    return `This parent now runs ${command.count} sub sessions at once.`
  }
  if (command.kind === 'pause') {
    await writeParent($, p => ({ ...p, isPaused: true }))
    return 'This parent is paused.'
  }
  if (command.kind === 'resume') {
    await writeParent($, p => ({ ...p, isPaused: false }))
    return 'This parent is no longer paused.'
  }
  await writeParent($, p => ({ ...p, isOn: true }))
  // Arming makes the first read of the status folder, so it has to come
  // before the pane opens. Opened first, the pane would draw from no read at
  // all and say that the folder holds no sub sessions until the read landed.
  await ensureArmed($)
  await $.ui.open({ id: PANE, title: 'foreman' }).catch(() => undefined)
  return 'This session is now the parent, and foreman shows its sub sessions above the prompt and in its pane.'
}

export const register: Register = (on, options) => {
  // At the start of a session, and of a resumed one, the store says whether
  // this session is the parent. The role is turned back on from it.
  // Settings stored while the role was off, such as a slot count or a pause
  // set before /foreman, are copied into $.state too, because the next
  // /foreman builds the store's entry from $.state and would otherwise write
  // the defaults over them. The timers are armed only when the role is on.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'foreman',
      description: 'Make this session the parent and show its /implement sub sessions. `/foreman slots <n>` sets how many it runs at once, `/foreman pause` and `/foreman resume` pause and resume it.',
    })
    const raw = await $.store.get(storeKey(await $.session.id()))
    if (raw !== undefined && raw !== null) {
      const stored = parentIn(raw)
      await update($, parent, () => stored)
      if (stored.isOn) await ensureArmed($)
    }
    return next(e)
  })

  // The host already puts the mod's name in front of a command's output.
  // Every /foreman command also arms the timers again when a hot reload has
  // dropped them, as the hooks below do. Arming does nothing while the role
  // is off or the timers are already armed, so a plain /foreman, which armed
  // them in runCommand before opening the pane, changes nothing here.
  on('command.run', { command: 'foreman' }, async ($, e) => {
    const text = await runCommand($, typeof e.args === 'string' ? e.args : '')
    await ensureArmed($).catch(() => undefined)
    return { text }
  })

  // After a hot reload, whichever of these hooks comes first arms the timers
  // again. Each passes the event on unchanged and does not wait for the
  // arming, as builder's do, because arming may read the whole status folder
  // and the person's prompt or the turn's end should not wait for that read.
  on('prompt.submit', ($, e, next) => {
    void ensureArmed($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('turn.complete', ($, e, next) => {
    void ensureArmed($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The pane. Its presses open a sub session or write the log.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const presses = {
      open: (file: string) => {
        void openRow($, file).catch(() => undefined)
      },
      nudge: (file: string) => {
        void laterAction($, file, 'Nudge').catch(() => undefined)
      },
      release: (file: string) => {
        void laterAction($, file, 'Release').catch(() => undefined)
      },
    }
    return paneTree(elementsOf($, e), await view($, options), presses, columnsOf(e.props.bodyColumns))
  })

  // The band gives way to Claude Code's survey, and to the host in a session
  // that is not a parent, which bandTree answers with null.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const v = await view($, options)
    const presses = {
      open: (file: string) => {
        void openRow($, file).catch(() => undefined)
      },
    }
    return bandTree(elementsOf($, e), v, columnsOf(e.props.bodyColumns), presses) ?? next(e)
  })
}
