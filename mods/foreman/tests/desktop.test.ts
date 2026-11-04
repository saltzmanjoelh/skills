import { expect, test } from 'claude-code/testing'
import type { McpToolResult } from 'claude-code'

import { BEGIN_TEXT, everySession, EVENTS_TOOL, failureLine, linkedFamily, LIST_LIMIT, listSessions, openSession, readHeader, REASONS, type DesktopCall, type SavedCopies } from '../hooks/desktop'
import { desktopApp, eventsAnswer, savedNotice } from './world'

const SECRET = 'SECRET-ERROR-TEXT'

const text = (value: string): McpToolResult => ({ content: [{ type: 'text', text: value }], isError: false })
const sessions = (list: unknown) => text(JSON.stringify(list))

// A desktop app that answers from a script and records each call.
function desktop(answers: { list?: () => Promise<McpToolResult>; open?: () => Promise<McpToolResult>; events?: () => Promise<McpToolResult> }) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  const call: DesktopCall = async (server, tool, args = {}) => {
    calls.push({ server, tool, args })
    if (tool === 'list_sessions') return (answers.list ?? (async () => sessions([])))()
    if (tool === 'open_session_in') return (answers.open ?? (async () => text('Opened.')))()
    if (tool === 'list_events') return (answers.events ?? (async () => text('Session "t" (idle) — showing 1 of 2 messages')))()
    throw new Error(`unexpected ${server} ${tool}`)
  }
  return { call, calls }
}

// Claude Code's saved tool results, answered from memory: `files` holds each
// saved copy's text by its path, `sizes` the size a file that cannot be read
// has, and `config` answers the configuration folder. It records each read
// and each size asked for, and how often the folder was asked for.
function copies(files: Record<string, string> = {}, over: { config?: () => Promise<string>; sizes?: Record<string, number> } = {}) {
  const seen = { configs: 0, reads: [] as string[], sizes: [] as string[] }
  const saved: SavedCopies = {
    config: async () => {
      seen.configs += 1
      return (over.config ?? (async () => '/cfg'))()
    },
    read: async path => {
      seen.reads.push(path)
      const found = files[path]
      if (found === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}' ${SECRET}`)
      return found
    },
    size: async path => {
      seen.sizes.push(path)
      const size = over.sizes?.[path]
      if (size === undefined) throw new Error(`ENOENT: no such file or directory, stat '${path}' ${SECRET}`)
      return size
    },
  }
  return { saved, seen }
}

// A reader that holds no saved copy, for the tests that never reach one.
const none = () => copies().saved

test('a record with a desktop session id is opened beside the parent without listing the sessions', async () => {
  const d = desktop({})
  const got = await openSession(d.call, { desktopSessionId: 'local_a', cwd: '/work/a' }, none())
  expect(got).toEqual({ opened: 'local_a' })
  expect(d.calls).toEqual([{ server: 'ccd_window', tool: 'open_session_in', args: { session_id: 'local_a', target: 'split' } }])
})

test('without a desktop session id, the session whose folder matches is opened, a trailing slash included', async () => {
  for (const [cwd, listed] of [['/work/b', '/work/b/'], ['/work/b/', '/work/b']] as const) {
    const d = desktop({ list: async () => sessions([{ sessionId: 'local_x', cwd: '/work/x' }, { sessionId: 'local_b', cwd: listed }]) })
    expect(await openSession(d.call, { cwd }, none())).toEqual({ opened: 'local_b' })
    expect(d.calls.map(c => c.tool)).toEqual(['list_sessions', 'open_session_in'])
    expect(d.calls[0]).toEqual({ server: 'ccd_session_mgmt', tool: 'list_sessions', args: { linked: true, limit: 100 } })
    expect(d.calls[1]!.args).toEqual({ session_id: 'local_b', target: 'split' })
  }
})

test('each way an open can fail answers its own reason and never the tool\'s own error text', async () => {
  const cases: [string, Parameters<typeof openSession>[1], Parameters<typeof desktop>[0]][] = [
    [REASONS.noAddress, { cwd: null }, {}],
    [REASONS.noSessionInFolder, { cwd: '/work/c' }, { list: async () => sessions([{ sessionId: 'local_x', cwd: '/work/x' }]) }],
    [REASONS.notConnected, { cwd: '/work/c' }, { list: async () => { throw new Error(SECRET) } }],
    [REASONS.notConnected, { desktopSessionId: 'local_c', cwd: null }, { open: async () => { throw new Error(SECRET) } }],
    [REASONS.listRefused, { cwd: '/work/c' }, { list: async () => ({ content: [{ type: 'text', text: SECRET }], isError: true }) }],
    [REASONS.listUnreadable, { cwd: '/work/c' }, { list: async () => text(SECRET) }],
    [REASONS.listUnreadable, { cwd: '/work/c' }, { list: async () => sessions({ sessions: [] }) }],
    [REASONS.listUnreadable, { cwd: '/work/c' }, { list: async () => ({ content: [], isError: false }) }],
    [REASONS.openRefused, { desktopSessionId: 'local_c', cwd: null }, { open: async () => ({ content: [{ type: 'text', text: SECRET }], isError: true }) }],
    [REASONS.openRefused, { desktopSessionId: 'local_c', cwd: null }, { open: async () => ({ content: [], isError: true }) }],
  ]
  for (const [reason, record, answers] of cases) {
    const got = await openSession(desktop(answers).call, record, none())
    expect(got).toEqual({ reason })
    expect(JSON.stringify(got)).not.toContain(SECRET)
  }
  expect(new Set(Object.values(REASONS)).size).toBe(Object.values(REASONS).length)
})

test('a failed open is one sentence naming the issue and the reason', () => {
  expect(failureLine('ABC-123', REASONS.openRefused)).toBe(`Could not open ABC-123: ${REASONS.openRefused}.`)
})

test('the list of sessions asks for archived ones too, and reads an entry without flags as running and not archived', async () => {
  const d = desktop({
    list: async () => sessions([
      { sessionId: 'local_a', isArchived: true, isRunning: false },
      { sessionId: 'local_b' },
      { sessionId: 7 },
    ]),
  })
  expect(await listSessions(d.call, none())).toEqual({
    sessions: [
      { sessionId: 'local_a', isArchived: true, isRunning: false, title: null, surelyUnarchived: false },
      { sessionId: 'local_b', isArchived: false, isRunning: true, title: null, surelyUnarchived: false },
    ],
    complete: true,
  })
  expect(d.calls[0]!.args).toEqual({ linked: true, limit: 100, include_archived: true })
})

test('the list keeps each session\'s title, and is sure a session is not archived only when its flag is exactly false', async () => {
  const d = desktop({
    list: async () => sessions([
      { sessionId: 'local_a', title: 'ABC-1: short', isArchived: false, isRunning: false },
      { sessionId: 'local_b', title: 7, isArchived: 'false' },
      { sessionId: 'local_c', title: 'ABC-3 short', isArchived: null },
    ]),
  })
  const got = await listSessions(d.call, none())
  expect('sessions' in got ? got.sessions.map(s => [s.sessionId, s.title, s.surelyUnarchived, s.isArchived]) : got).toEqual([
    ['local_a', 'ABC-1: short', true, false],
    ['local_b', null, false, false],
    ['local_c', 'ABC-3 short', false, false],
  ])
})

test('a list that is refused, not connected or not a list answers its own reason and never the tool\'s error text', async () => {
  const refused = desktop({ list: async () => ({ content: [{ type: 'text', text: SECRET }], isError: true }) })
  expect(await listSessions(refused.call, none())).toEqual({ reason: REASONS.listRefused })
  const gone = desktop({ list: async () => { throw new Error(SECRET) } })
  expect(await listSessions(gone.call, none())).toEqual({ reason: REASONS.notConnected })
  const garbage = desktop({ list: async () => text(SECRET) })
  expect(await listSessions(garbage.call, none())).toEqual({ reason: REASONS.listUnreadable })
})

test('a list is complete only when it came back shorter than the most foreman asks for, counting entries it could not read', async () => {
  const of = async (n: number, entry = (i: number) => ({ sessionId: `local_${i}` })) => {
    const got = await listSessions(desktop({ list: async () => sessions(Array.from({ length: n }, (_, i) => entry(i))) }).call, none())
    return 'complete' in got ? got.complete : got
  }
  expect(await of(LIST_LIMIT - 1)).toBe(true)
  expect(await of(LIST_LIMIT)).toBe(false)
  expect(await of(LIST_LIMIT, i => (i === 0 ? { sessionId: 7 } : { sessionId: `local_${i}` }) as never)).toBe(false)
})

test('the header is read with list_events for the one session, asking for a single event, and is the first line of the first text block', async () => {
  const d = desktop({ events: async () => ({ content: [{ type: 'image', data: '', mimeType: 'image/png' } as never, { type: 'text', text: eventsAnswer('Session "t" (idle) — showing 1 of 1972 messages') }, { type: 'text', text: 'other' }], isError: false }) })
  expect(EVENTS_TOOL).toBe('list_events')
  expect(await readHeader(d.call, 'local_a')).toEqual({ header: 'Session "t" (idle) — showing 1 of 1972 messages' })
  expect(d.calls).toEqual([{ server: 'ccd_session_mgmt', tool: 'list_events', args: { session_id: 'local_a', limit: 1 } }])
})

test('a header read that is refused, not connected or has no text answers its own reason and never the tool\'s error text', async () => {
  const cases: [string, () => Promise<McpToolResult>][] = [
    [REASONS.eventsRefused, async () => ({ content: [{ type: 'text', text: `Session local_a not found. ${SECRET}` }], isError: true })],
    [REASONS.notConnected, async () => { throw new Error(SECRET) }],
    [REASONS.eventsUnreadable, async () => ({ content: [], isError: false })],
    [REASONS.eventsUnreadable, async () => ({ content: [{ type: 'text', text: 7 }], isError: false }) as never],
  ]
  for (const [reason, events] of cases) {
    const got = await readHeader(desktop({ events }).call, 'local_a')
    expect(got).toEqual({ reason })
    expect(JSON.stringify(got)).not.toContain(SECRET)
  }
  expect(new Set(Object.values(REASONS)).size).toBe(Object.values(REASONS).length)
})

test('the linked family asks the list for this session\'s linked sessions, archived ones included, and answers their ids', async () => {
  const d = desktop({ list: async () => sessions([{ sessionId: 'local_a', startedBy: 'local_parent' }, { sessionId: 7 }, null, { sessionId: 'local_b' }]) })
  expect(await linkedFamily(d.call, none())).toEqual({ ids: ['local_a', 'local_b'], complete: true })
  expect(d.calls).toEqual([{ server: 'ccd_session_mgmt', tool: 'list_sessions', args: { linked: true, limit: LIST_LIMIT, include_archived: true } }])
})

test('a linked family as long as the limit is not complete, entries it could not read included', async () => {
  const full = [...Array.from({ length: LIST_LIMIT - 1 }, (_, i) => ({ sessionId: `local_${i}` })), { sessionId: null }]
  const got = await linkedFamily(desktop({ list: async () => sessions(full) }).call, none())
  expect('ids' in got && got.ids.length).toBe(LIST_LIMIT - 1)
  expect('ids' in got && got.complete).toBe(false)
})

test('each way the linked family can fail to be read answers its own reason and never the tool\'s own error text', async () => {
  const cases: [string, () => Promise<McpToolResult>][] = [
    [REASONS.notConnected, async () => { throw new Error(SECRET) }],
    [REASONS.listRefused, async () => ({ content: [{ type: 'text', text: SECRET }], isError: true })],
    [REASONS.listUnreadable, async () => text(SECRET)],
    [REASONS.listUnreadable, async () => sessions({ sessions: [] })],
    [REASONS.listUnreadable, async () => ({ content: [], isError: false })],
  ]
  for (const [reason, list] of cases) {
    const got = await linkedFamily(desktop({ list }).call, none())
    expect(got).toEqual({ reason })
    expect(JSON.stringify(got)).not.toContain(SECRET)
  }
})

test('all three reads of the list ask for the parent\'s linked family alone, and only the open leaves archived sessions out', async () => {
  const d = desktop({ list: async () => sessions([{ sessionId: 'local_b', cwd: '/work/b' }]) })
  await listSessions(d.call, none())
  await linkedFamily(d.call, none())
  await openSession(d.call, { cwd: '/work/b' }, none())
  expect(d.calls.filter(c => c.tool === 'list_sessions').map(c => [c.server, c.args])).toEqual([
    ['ccd_session_mgmt', { linked: true, limit: LIST_LIMIT, include_archived: true }],
    ['ccd_session_mgmt', { linked: true, limit: LIST_LIMIT, include_archived: true }],
    ['ccd_session_mgmt', { linked: true, limit: LIST_LIMIT }],
  ])
})

// The place Claude Code saves a tool answer too large to pass back, under the
// configuration folder `/cfg` that the reader stand-in answers.
const SAVED = '/cfg/projects/-work-parent/session-1/tool-results/toolu_01.txt'

// An answer of the list replaced by the notice for `path`.
const replaced = (path: string) => async () => text(savedNotice(path))

test('the whole list that releases held keys asks for every session, archived ones included, and reads its saved copy when replaced', async () => {
  const d = desktop({ list: async () => sessions([{ sessionId: 'local_h', title: 'ABC-7: by hand', isArchived: false, isRunning: true }]) })
  expect(await everySession(d.call, none())).toEqual({ sessions: [{ sessionId: 'local_h', isArchived: false, isRunning: true, title: 'ABC-7: by hand', surelyUnarchived: true }] })
  expect(d.calls.map(c => [c.server, c.tool, c.args])).toEqual([['ccd_session_mgmt', 'list_sessions', { limit: LIST_LIMIT, include_archived: true }]])
  const c = copies({ [SAVED]: JSON.stringify([{ sessionId: 'local_h', title: 'ABC-7: by hand', isArchived: false }]) })
  expect(await everySession(desktop({ list: replaced(SAVED) }).call, c.saved)).toEqual({ sessions: [{ sessionId: 'local_h', isArchived: false, isRunning: true, title: 'ABC-7: by hand', surelyUnarchived: true }] })
  expect(c.seen.reads).toEqual([SAVED])
  expect(await everySession(desktop({ list: replaced(SAVED) }).call, none())).toEqual({ reason: REASONS.savedMissing })
  expect(await everySession(desktop({ list: async () => text(SECRET) }).call, none())).toEqual({ reason: REASONS.listUnreadable })
})

// What each of the three reads answers for the list answer `list`, with the
// reader `saved`: listSessions, linkedFamily, and an open of the folder
// `/work/b`.
async function allThree(list: () => Promise<McpToolResult>, saved: SavedCopies) {
  return {
    sessions: await listSessions(desktop({ list }).call, saved),
    family: await linkedFamily(desktop({ list }).call, saved),
    open: await openSession(desktop({ list }).call, { cwd: '/work/b' }, saved),
  }
}

test('a list answer that Claude Code replaced with its notice is read from the saved copy by each of the three reads', async () => {
  const copy = JSON.stringify([{ sessionId: 'local_a', cwd: '/work/a', isArchived: true, isRunning: false, title: 'ABC-1: a' }, { sessionId: 'local_b', cwd: '/work/b/' }])
  for (const path of [SAVED, SAVED.replace('.txt', '.json')]) {
    for (const size of ['57,997 characters across 1,441 lines', '57,997 characters']) {
      const c = copies({ [path]: copy })
      const d = desktop({ list: async () => text(savedNotice(path, size)) })
      expect(await listSessions(d.call, c.saved)).toEqual({
        sessions: [
          { sessionId: 'local_a', isArchived: true, isRunning: false, title: 'ABC-1: a', surelyUnarchived: false },
          { sessionId: 'local_b', isArchived: false, isRunning: true, title: null, surelyUnarchived: false },
        ],
        complete: true,
      })
      expect(c.seen.reads).toEqual([path])
      expect(c.seen.sizes).toEqual([])
      const f = copies({ [path]: copy })
      expect(await linkedFamily(desktop({ list: async () => text(savedNotice(path, size)) }).call, f.saved)).toEqual({ ids: ['local_a', 'local_b'], complete: true })
      expect(f.seen.reads).toEqual([path])
      expect(f.seen.sizes).toEqual([])
      const o = copies({ [path]: copy })
      const opened = desktop({ list: async () => text(savedNotice(path, size)) })
      expect(await openSession(opened.call, { cwd: '/work/b' }, o.saved)).toEqual({ opened: 'local_b' })
      expect(opened.calls.map(call => call.tool)).toEqual(['list_sessions', 'open_session_in'])
      expect(opened.calls[1]!.args).toEqual({ session_id: 'local_b', target: 'split' })
      expect(o.seen.reads).toEqual([path])
      expect(o.seen.sizes).toEqual([])
    }
  }
})

test('a saved copy as long as the limit, with one entry foreman cannot read, is not complete', async () => {
  const full = JSON.stringify([...Array.from({ length: LIST_LIMIT - 1 }, (_, i) => ({ sessionId: `local_${i}`, cwd: `/work/${i}` })), { sessionId: 7 }])
  const got = await allThree(replaced(SAVED), copies({ [SAVED]: full }).saved)
  expect('sessions' in got.sessions && [got.sessions.sessions.length, got.sessions.complete]).toEqual([LIST_LIMIT - 1, false])
  expect('ids' in got.family && [got.family.ids.length, got.family.complete]).toEqual([LIST_LIMIT - 1, false])
})

test('text close to the notice but not exact reads as unreadable from all three reads, and no saved copy is looked for', async () => {
  const cut = '[{"sessionId":"local_b","cwd":"/work/b"},{"sessionId":"loc'
  const near: [string, McpToolResult][] = [
    ['other wording', text(savedNotice(SAVED).replace('exceeds maximum allowed tokens', 'exceeds the maximum allowed tokens'))],
    ['no final full stop', text(savedNotice(SAVED).replace(`${SAVED}.\n`, `${SAVED}\n`))],
    ['no newline after the full stop', text(`Error: result (57,997 characters) exceeds maximum allowed tokens. Output has been saved to ${SAVED}.`)],
    ['a closing parenthesis inside the parentheses', text(savedNotice(SAVED, '57,997 characters (about 14,500 tokens)'))],
    ['the notice only in a second text block', { content: [{ type: 'text', text: 'Too large.' }, { type: 'text', text: savedNotice(SAVED) }], isError: false }],
    ['the notice Claude Code gives when it could not save the file', text('Error: result (57,997 characters across 1,441 lines) exceeds maximum allowed tokens. The output could not be saved to a file.\nUse pagination or filtering to reduce the size of the result.')],
    ['a shortened answer of cut JSON', text(`${cut}\n\n[Output truncated: 57,997 characters in all]`)],
  ]
  for (const [name, answer] of near) {
    const c = copies({ [SAVED]: JSON.stringify([{ sessionId: 'local_b', cwd: '/work/b' }]) })
    expect([name, await allThree(async () => answer, c.saved)]).toEqual([name, {
      sessions: { reason: REASONS.listUnreadable },
      family: { reason: REASONS.listUnreadable },
      open: { reason: REASONS.listUnreadable },
    }])
    expect([name, c.seen]).toEqual([name, { configs: 0, reads: [], sizes: [] }])
  }
})

test('a tool error whose text is the notice reads as refused, and no saved copy is looked for', async () => {
  const c = copies({ [SAVED]: JSON.stringify([{ sessionId: 'local_b', cwd: '/work/b' }]) })
  const got = await allThree(async () => ({ content: [{ type: 'text', text: savedNotice(SAVED) }], isError: true }), c.saved)
  expect(got).toEqual({ sessions: { reason: REASONS.listRefused }, family: { reason: REASONS.listRefused }, open: { reason: REASONS.listRefused } })
  expect(c.seen).toEqual({ configs: 0, reads: [], sizes: [] })
})

test('the saved copy is read only from a path in Claude Code\'s saved tool results, under any project\'s or session\'s folder', async () => {
  const copy = JSON.stringify([{ sessionId: 'local_b', cwd: '/work/b' }])
  const accepted = [
    '/cfg/projects/-work-other/session-9/tool-results/toolu_02.txt',
    '/cfg/projects/-work-other-project/session-1/tool-results/mcp-ccd_session_mgmt-list_sessions-1.json',
  ]
  for (const path of accepted) {
    const c = copies({ [path]: copy })
    expect([path, await allThree(replaced(path), c.saved)]).toEqual([path, {
      sessions: { sessions: [{ sessionId: 'local_b', isArchived: false, isRunning: true, title: null, surelyUnarchived: false }], complete: true },
      family: { ids: ['local_b'], complete: true },
      open: { opened: 'local_b' },
    }])
  }
  const refused: [string, string][] = [
    ['a . segment', '/cfg/projects/p/./tool-results/x.txt'],
    ['a .. segment', '/cfg/projects/p/s/tool-results/../x.txt'],
    ['a .. segment in place of the session', '/cfg/projects/p/../tool-results/x.txt'],
    ['a .. file name', '/cfg/projects/p/s/tool-results/..'],
    ['a relative path', 'cfg/projects/p/s/tool-results/x.txt'],
    ['a path outside projects', '/cfg/other/p/s/tool-results/x.txt'],
    ['a path right under the configuration folder', '/cfg/tool-results/x.txt'],
    ['a segment too many', '/cfg/projects/p/s/extra/tool-results/x.txt'],
    ['a segment too many below tool-results', '/cfg/projects/p/s/tool-results/sub/x.txt'],
    ['a segment too few', '/cfg/projects/s/tool-results/x.txt'],
    ['a folder other than tool-results', '/cfg/projects/p/s/results/x.txt'],
    ['an empty segment', '/cfg/projects/p//tool-results/x.txt'],
    ['a trailing slash', '/cfg/projects/p/s/tool-results/x.txt/'],
    ['a lookalike prefix', '/cfg-other/projects/p/s/tool-results/x.txt'],
  ]
  for (const [name, path] of refused) {
    const c = copies({ [path]: copy }, { sizes: { [path]: 10 } })
    expect([name, await allThree(replaced(path), c.saved)]).toEqual([name, {
      sessions: { reason: REASONS.savedOutside },
      family: { reason: REASONS.savedOutside },
      open: { reason: REASONS.savedOutside },
    }])
    expect([name, c.seen.reads, c.seen.sizes]).toEqual([name, [], []])
  }
  // A relative configuration folder would otherwise let a relative path through.
  const relative = copies({ 'cfg/projects/p/s/tool-results/x.txt': copy }, { config: async () => 'cfg' })
  expect(await allThree(replaced('cfg/projects/p/s/tool-results/x.txt'), relative.saved)).toEqual({
    sessions: { reason: REASONS.savedOutside }, family: { reason: REASONS.savedOutside }, open: { reason: REASONS.savedOutside },
  })
  expect([relative.seen.reads, relative.seen.sizes]).toEqual([[], []])
  const noConfig = copies({ [SAVED]: copy }, { config: async () => { throw new Error(SECRET) } })
  expect(await allThree(replaced(SAVED), noConfig.saved)).toEqual({
    sessions: { reason: REASONS.savedOutside }, family: { reason: REASONS.savedOutside }, open: { reason: REASONS.savedOutside },
  })
  expect([noConfig.seen.reads, noConfig.seen.sizes]).toEqual([[], []])
})

test('a saved copy that is missing, too large or not a list of sessions answers its own reason, never the path or the file\'s text', async () => {
  const MIB4 = 4 * 1024 * 1024
  const path = `/cfg/projects/p/${SECRET}/tool-results/toolu_03.txt`
  const cases: [string, string, ReturnType<typeof copies>][] = [
    ['read and size both fail', REASONS.savedMissing, copies()],
    ['the read fails at exactly 4 MiB', REASONS.savedMissing, copies({}, { sizes: { [path]: MIB4 } })],
    ['the read fails at 4 MiB and one byte', REASONS.savedTooLarge, copies({}, { sizes: { [path]: MIB4 + 1 } })],
    ['an object', REASONS.savedNotList, copies({ [path]: JSON.stringify({ sessions: [{ sessionId: 'local_b' }], note: SECRET }) })],
    ['null', REASONS.savedNotList, copies({ [path]: 'null' })],
    ['an empty file', REASONS.savedNotList, copies({ [path]: '' })],
    ['cut JSON', REASONS.savedNotList, copies({ [path]: `[{"sessionId":"local_b","cwd":"/work/b","title":"${SECRET}` })],
    ['an empty array', REASONS.savedNotList, copies({ [path]: '[]' })],
    ['an array of content blocks', REASONS.savedNotList, copies({ [path]: JSON.stringify([{ type: 'text', text: JSON.stringify([{ sessionId: 'local_b', cwd: '/work/b', title: SECRET }]) }]) })],
  ]
  for (const [name, reason, c] of cases) {
    const got = await allThree(replaced(path), c.saved)
    expect([name, got]).toEqual([name, { sessions: { reason }, family: { reason }, open: { reason } }])
    expect(JSON.stringify(got)).not.toContain(SECRET)
    expect(JSON.stringify(got)).not.toContain('tool-results')
  }
  for (const reason of [REASONS.savedOutside, REASONS.savedMissing, REASONS.savedTooLarge, REASONS.savedNotList]) {
    expect(reason).not.toContain('/')
    expect(failureLine('ABC-123', reason)).toBe(`Could not open ABC-123: ${reason}.`)
  }
})

// Whether `promise` settles within a few turns of the event loop's microtask
// queue, which a call that hangs never does.
async function settles<T>(promise: Promise<T>): Promise<{ value: T } | 'hung'> {
  const hung = (async () => {
    for (let i = 0; i < 50; i++) await null
    return 'hung' as const
  })()
  return Promise.race([promise.then(value => ({ value })), hung])
}

// The desktop app of the engine tests, driven without the engine: its
// mcp.call hook is called the way the engine calls it, and a deny is thrown as
// the engine's $.mcp.call throws it.
function engineDesktop() {
  let hook: ((e: { server: string; tool: string; args: Record<string, unknown> }) => unknown) | undefined
  const on = ((name: string, handler: ($: unknown, e: never) => unknown) => {
    if (name === 'mcp.call') hook = e => handler(undefined, e as never)
  }) as unknown as Parameters<typeof desktopApp>[0]
  const d = desktopApp(on)
  const call: DesktopCall = async (server, tool, args = {}) => {
    const got = await hook!({ server, tool, args }) as { value?: McpToolResult; deny?: string }
    if (got.deny !== undefined) throw new Error(got.deny)
    return got.value!
  }
  return { d, call }
}

test('the desktop app of the engine tests answers list_events for each session as the test sets it', async () => {
  const { d, call } = engineDesktop()
  d.events.set('local_idle', { state: 'idle' })
  d.events.set('local_old', { state: 'idle', archived: true, title: 'ABC-1: "quoted" (and more)' })
  d.events.set('local_gone', 'not-connected')
  d.events.set('local_bad', 'garbage')
  d.events.set('local_hang', 'hang')
  d.events.set('local_err', 'error')
  expect(await readHeader(call, 'local_idle')).toEqual({ header: 'Session "example" (idle) — showing 1 of 1972 messages' })
  expect(await readHeader(call, 'local_old')).toEqual({ header: 'Session "ABC-1: "quoted" (and more)" (idle, archived) — showing 1 of 1972 messages' })
  expect(await readHeader(call, 'local_gone')).toEqual({ reason: REASONS.notConnected })
  expect(await readHeader(call, 'local_bad')).toEqual({ header: SECRET })
  expect(await readHeader(call, 'local_err')).toEqual({ reason: REASONS.eventsRefused })
  expect(await readHeader(call, 'local_unknown')).toEqual({ reason: REASONS.eventsRefused })
  expect(await settles(readHeader(call, 'local_hang'))).toBe('hung')
  expect(d.calls.filter(c => c.tool === 'list_events').map(c => c.args.session_id))
    .toEqual(['local_idle', 'local_old', 'local_gone', 'local_bad', 'local_err', 'local_unknown', 'local_hang'])
})

test('the list_events answer of the engine tests holds the paging line, the warning and an empty body below its header', async () => {
  const { d, call } = engineDesktop()
  d.events.set('local_a', { state: 'idle' })
  const got = await call('ccd_session_mgmt', 'list_events', { session_id: 'local_a', limit: 1 })
  const lines = (got.content[0] as { text: string }).text.split('\n')
  expect(lines).toHaveLength(4)
  expect(lines[3]).toBe('(no messages)')
  const unknown = await call('ccd_session_mgmt', 'list_events', { session_id: 'local_b', limit: 1 })
  expect(unknown).toEqual({ content: [{ type: 'text', text: 'Session local_b not found.' }], isError: true })
})

// A sub session that waits under an older brief knows the begin message by the
// text its wait line quoted, so the message keeps that text as its exact start.
const OLD_BEGIN_TEXT = 'foreman begins this session now: first bring your branch up to date with the base branch, with the desktop app\'s sync_with_base_branch tool, and then run the /implement command your brief gives. If you have already begun it, ignore this message.'

test('the begin message starts with its older text and then tells a session whose issue is stale to run /cleanup without waiting, after it comments on and moves an issue the tracker still shows not started', () => {
  expect(BEGIN_TEXT.startsWith(OLD_BEGIN_TEXT)).toBe(true)
  expect(BEGIN_TEXT.slice(OLD_BEGIN_TEXT.length)).toBe(' If /implement stops because your issue is already done on the base branch or already has an open pull request, do not wait for an answer. If the issue is already done but the tracker still shows it not started, first comment on the issue with the evidence and move it to the tracker\'s in-progress state. In every such case, then run /cleanup.')
})
