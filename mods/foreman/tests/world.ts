// The world the engine tests of foreman run in: the clock, the store, the
// status folder, the desktop app's tools and what the engine answers beneath
// the mod. tests/register.test.ts and tests/acts.test.ts share it.

import { mock } from 'claude-code/testing'
import type { McpToolResult, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { newPairing, ticketsIn, ticketsKey } from '../hooks/tickets'

export const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)
export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOME = '/home/me'
export const FOLDER = `${HOME}/.claude/foreman/builds`
export const SECRET = 'SECRET-ERROR-TEXT'
export const SURFACES = ['terminal', 'desktop'] as const

// A status record as builder writes it, with `over` changing its fields. Its
// ticket is `ft-<issue key>`, which the test folder pairs with the parent.
export const record = (issueKey: string | null, state: string, over: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: `s-${issueKey}`, ticket: `ft-${issueKey}`, cwd: `/work/${issueKey}`, issueKey, issueTitle: `Title of ${issueKey}`,
  stage: null, stageDone: 0, pr: null, state, reason: '', stateSince: T0, writtenAt: T0, ...over,
})

// The status folder, answered from memory: each file's text and modification
// time, whether the folder exists, and a refusal every listing meets when
// `listFails` is set. It counts the listings and the reads. A file put in it
// also pairs its record's ticket with the parent in `stored`, as though the
// parent had started that sub session, unless `pair` is false.
export function statusFolder(on: On, at = FOLDER, stored = new Map<string, unknown>()) {
  const w = {
    files: new Map<string, { text: string; mtimeMs: number }>(),
    exists: true,
    listFails: null as string | null,
    lists: 0,
    reads: 0,
    put(name: string, text: string, mtimeMs = T0, pair = true) {
      w.files.set(name, { text, mtimeMs })
      let ticket: unknown
      try {
        ticket = (JSON.parse(text) as { ticket?: unknown }).ticket
      } catch {
        ticket = undefined
      }
      if (!pair || typeof ticket !== 'string') return
      const ledger = ticketsIn(stored.get(ticketsKey('session-1')))
      if (ledger.pairings.some(p => p.ticket === ticket)) return
      stored.set(ticketsKey('session-1'), { ...ledger, pairings: [...ledger.pairings, newPairing(ticket, null, T0)] })
    },
  }
  on('fs.list', ($, e) => {
    w.lists += 1
    if (w.listFails !== null) return { deny: w.listFails }
    if (!w.exists || e.path !== at) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: [...w.files].map(([name, f]) => ({ name, kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })) }
  })
  on('fs.exists', ($, e) => ({ value: w.exists && e.path === at }))
  on('fs.read', ($, e) => {
    w.reads += 1
    const f = e.path.startsWith(`${at}/`) ? w.files.get(e.path.slice(at.length + 1)) : undefined
    return f === undefined ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: f.text }
  })
  return w
}

// The desktop app's tools, answered from a script, recording each call.
// `list`, `send` and `open` say how list_sessions, send_message and
// open_session_in answer: normally, with an error that has text or none,
// with text that is not a list, not at all, as a server that is not
// connected does, or never, for a call that hangs.
export function desktopApp(on: On) {
  const d = {
    calls: [] as { server: string; tool: string; args: Record<string, unknown> }[],
    sessions: [] as { sessionId: string; cwd: string; isArchived?: boolean; isRunning?: boolean }[],
    list: 'ok' as 'ok' | 'error' | 'garbage' | 'not-connected' | 'hang',
    send: 'ok' as 'ok' | 'error' | 'not-connected' | 'hang',
    open: 'ok' as 'ok' | 'error' | 'error-empty' | 'not-connected',
    // The messages send_message delivered, as [session id, text].
    sent: [] as [string, string][],
  }
  const answer = (result: McpToolResult) => ({ value: result })
  on('mcp.call', ($, e) => {
    d.calls.push({ server: e.server, tool: e.tool, args: e.args })
    const how = e.tool === 'list_sessions' ? d.list : e.tool === 'send_message' ? d.send : d.open
    if (how === 'hang') return new Promise<never>(() => {})
    if (how === 'ok' && e.tool === 'send_message') {
      d.sent.push([String(e.args.session_id), String(e.args.message)])
      return answer({ content: [{ type: 'text', text: 'delivered (delivery: delivered; message_id: m1)' }], isError: false })
    }
    if (how === 'not-connected') return { deny: `${SECRET}: server ${e.server} is not connected` }
    if (how === 'error') return answer({ content: [{ type: 'text', text: SECRET }], isError: true })
    if (how === 'error-empty') return answer({ content: [], isError: true })
    if (how === 'garbage') return answer({ content: [{ type: 'text', text: SECRET }], isError: false })
    if (e.tool === 'list_sessions') return answer({ content: [{ type: 'text', text: JSON.stringify(d.sessions) }], isError: false })
    return answer({ content: [{ type: 'text', text: 'Opened in split view.' }], isError: false })
  })
  return d
}

// What the engine answers beneath the mod in a session. It records the
// toasts, the panes opened, the notifications, the prompts submitted, the
// rows appended and the start_session calls. `notify` and `submit` say how a
// notification and a prompt fare, and `startAnswer` is the text start_session
// answers, with `startFails` making it answer an error.
export function engine(on: On) {
  const toasts: string[] = []
  const panes: string[] = []
  const answers = {
    notices: [] as string[],
    prompts: [] as string[],
    appended: [] as string[],
    started: [] as Record<string, unknown>[],
    notify: 'sent' as 'sent' | 'off' | 'throws' | 'hang',
    submit: 'ok' as 'ok' | 'dropped',
    startAnswer: 'Started the session local_new1 (name: example).',
    startFails: false,
    // The session id the engine answers.
    sessionId: 'session-1',
  }
  on('ui.notify', ($, e) => {
    if (answers.notify === 'throws') throw new Error('no channel')
    if (answers.notify === 'hang') return new Promise<never>(() => {})
    answers.notices.push(e.text)
    return { value: answers.notify === 'sent' ? { isSent: true, channel: 'terminal' } : { isSent: false, reason: 'disabled' } } as never
  })
  on('prompt.submit', ($, e) => {
    if (answers.submit === 'dropped') return { drop: 'a Stop stands' }
    answers.prompts.push(e.text)
    return { text: e.text }
  })
  on('session.append', ($, a, next) => {
    answers.appended.push(a.message.content.map(b => (b as { text?: string }).text ?? '').join(''))
    return next(a)
  })
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, ($, call) => {
    answers.started.push({ ...call })
    return { result: { content: [{ type: 'text', text: answers.startAnswer }], isError: answers.startFails }, text: answers.startAnswer, ...(answers.startFails ? { isError: true } : {}) } as never
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: answers.sessionId }))
  on('command.run', () => ({ text: '' }))
  on('ui.open', ($, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } as never }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { toasts, panes, answers }
}

// The usual world: the clock at T0, a store in memory that the test can read,
// empty unless one is given, HOME set, the folder, the desktop app and the
// engine. `store.writes` counts the store writes by key, and a key in
// `store.refused` has its writes refused.
export function world(on: On, options: { store?: Record<string, unknown>; env?: Record<string, string>; at?: string } = {}) {
  const clock = mock.clock(on, { now: T0 })
  const stored = new Map<string, unknown>(Object.entries(options.store ?? {}))
  on('store.get', ($, e) => ({ value: stored.get(e.key) }))
  const store = { writes: new Map<string, number>(), refused: new Set<string>() }
  on('store.set', ($, e) => {
    store.writes.set(e.key, (store.writes.get(e.key) ?? 0) + 1)
    if (store.refused.has(e.key)) return { deny: 'the store is full' }
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  mock.env(on, options.env ?? { HOME })
  const folder = statusFolder(on, options.at, stored)
  const desktop = desktopApp(on)
  const { toasts, panes, answers } = engine(on)
  return { clock, folder, desktop, toasts, panes, stored, store, engine: answers }
}

// Stands in for what the mod left in $.state before a reload, as builder's
// tests do: the test answers the mod's reads of these keys until the mod
// writes one. A test's first call on `$` starts the module afresh, so seeding
// these and then raising an event runs the path a reload takes.
export function leftInState(on: On, seeded: Record<string, unknown>) {
  const left = new Map(Object.entries(seeded))
  on('state.get', ($, e, next) => {
    if (e.plugin !== 'foreman' || !left.has(e.key)) return next(e)
    return { value: { value: left.get(e.key), version: 0 } } as never
  })
  on('state.set', ($, e, next) => {
    if (e.plugin === 'foreman') left.delete(e.key)
    return next(e)
  })
}

// Mounts the band and the pane on a surface. The host draws its own line when
// the mod passes the band on. Called after the test's other hooks, since it
// is the first call on `$`. Each read draws again, so a relative time is read
// as of now.
export async function mountBoth($: Engine, on: On, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 200) {
  on('ui.render', ($, e) => ($.ui.resolve(e) as unknown as { Text: (props: object) => never }).Text({ children: 'host line' }))
  const band = await $.ui.mount({ plugin: 'foreman', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns } as never })
  const pane = await $.ui.mount({ plugin: 'foreman', surface, component: 'Pane', requestId: 'foreman', props: { bodyColumns } as never })
  return {
    band,
    pane,
    bandText: async () => {
      await band.redraw()
      return (await band.find({ key: 'foreman-band' }))?.text ?? ''
    },
    paneText: async () => {
      await pane.redraw()
      return (await pane.find({ key: 'foreman-pane' }))?.text ?? ''
    },
    newestLog: async () => {
      await pane.redraw()
      return (await pane.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d / })).at(-1)?.text.slice(9) ?? ''
    },
  }
}

export const start = ($: Engine) => $.session.start({ cwd: '/work/parent', surface: null, isInteractive: true })
export const foreman = ($: Engine, args = '') => $.command.run({ command: 'foreman', args } as never) as Promise<{ text: string }>
