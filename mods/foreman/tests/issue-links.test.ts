import { expect, test } from 'claude-code/testing'

import { foreman, MINUTE, PARENT_DIR, SURFACES, mountBoth, record, start, statusFolder, world } from './world'

// An element of a drawn tree as a found element's children give it.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

const ADDRESS = 'https://tracker.example.com/issue/{key}'
const linkTo = (key: string) => `https://tracker.example.com/issue/${key}`
const fact = (value: string) => `# Example project\n\nIssue link: ${value}\nMerge command: example merge\n`

// The text an element of a drawn tree shows: its string children and those of
// its children, in order.
function textOf(part: unknown): string {
  if (typeof part === 'string') return part
  const children = (part as Drawn).children ?? []
  return children.map(textOf).join('')
}

// Two sub sessions: one working at the plan stage with a pull request, and
// one that needs the person.
function twoSubs(folder: ReturnType<typeof statusFolder>) {
  folder.put('a.json', record('ABC-1', 'working', {
    stage: 'plan', stageDone: 3, desktopSessionId: 'local_a', pr: { repo: 'acme/example-app', number: 4, state: 'open', checks: 'passed' },
  }))
  folder.put('b.json', record('ABC-2', 'needs-you', { stage: 'spec', stageDone: 2, desktopSessionId: 'local_b' }))
}

// The parts of the band's row, as drawn.
async function bandParts(ui: Awaited<ReturnType<typeof mountBoth>>): Promise<Drawn[]> {
  await ui.band.redraw()
  return ((await ui.band.find({ key: 'foreman-band' }))?.children ?? []) as Drawn[]
}

// Where the chip button of `file` sits among the band's parts.
const chipAt = (parts: Drawn[], file: string) => parts.findIndex(part => part.type === 'Button' && part.props?.key === `chip-${file}`)

// Checks that the pane row of `file` begins with the link to `key`, then a
// space, then the button that opens the sub session, with `label` on it.
async function expectLinkedRow(ui: Awaited<ReturnType<typeof mountBoth>>, file: string, key: string, label: string) {
  await ui.pane.redraw()
  const row = await ui.pane.find({ key: `issue-${file}` })
  expect(row?.type).toBe('Box')
  const parts = row!.children as Drawn[]
  expect(parts.map(part => part.type)).toEqual(['Link', 'Text', 'Button'])
  expect(parts[0]!.props?.href).toBe(linkTo(key))
  expect(parts[0]!.children).toEqual([key])
  expect(parts[1]!.children).toEqual([' '])
  expect(parts[2]!.props?.key).toBe(`open-${file}`)
  expect((await ui.pane.find({ key: `open-${file}` }))?.text).toBe(label)
}

// What the code before issue links drew for twoSubs with no Issue link fact,
// copied from a run of that code on the base branch rather than from this
// code, so that a change to how a chip or a row is drawn without a fact shows
// as a failure here. Each Button's press handle is left out, since its number
// changes from run to run. The band is the same on both surfaces.
const BAND_BEFORE = {
  type: 'Box', props: { key: 'foreman-band', flexDirection: 'row' },
  children: [
    { type: 'Text', children: ['foreman: 2 of 2 slots busy'] },
    { type: 'Text', children: [' · '] },
    { type: 'Button', props: { key: 'chip-a.json', label: 'ABC-1 plan tournament', plain: true }, children: [{ type: 'Text', children: ['ABC-1 plan tournament'] }] },
    { type: 'Text', children: [' · '] },
    { type: 'Button', props: { key: 'chip-b.json', label: 'ABC-2 needs you', plain: true }, children: [{ type: 'Text', props: { color: 'error' }, children: ['ABC-2 needs you'] }] },
    { type: 'Text', children: [' · next read in 30s'] },
  ],
  part: { plugin: 'foreman' },
}
const PANE_BEFORE = {
  terminal: {
    type: 'Box', props: { key: 'foreman-pane', flexDirection: 'column' },
    children: [
      { type: 'Button', props: { key: 'open-a.json', label: '→ ABC-1 · #4 open · checks passed', variant: 'primary' } },
      { type: 'Text', children: ['Title of ABC-1 · plan tournament · ███░░░░░░░ 3 of 9 · 33%'] },
      { type: 'Text', children: ['working'] },
      { type: 'Box', props: { key: 'actions-a.json', flexDirection: 'row' }, children: [{ type: 'Button', props: { key: 'nudge-a.json', label: 'Nudge' } }, { type: 'Text', children: [' '] }, { type: 'Button', props: { key: 'release-a.json', label: 'Release' } }] },
      { type: 'Text', children: [' '] },
      { type: 'Button', props: { key: 'open-b.json', label: '→ ABC-2 · no pull request yet', variant: 'primary' } },
      { type: 'Text', children: ['Title of ABC-2 · spec · ██░░░░░░░░ 2 of 9 · 22%'] },
      { type: 'Text', props: { color: 'error' }, children: ['needs you'] },
      { type: 'Box', props: { key: 'actions-b.json', flexDirection: 'row' }, children: [{ type: 'Button', props: { key: 'nudge-b.json', label: 'Nudge' } }, { type: 'Text', children: [' '] }, { type: 'Button', props: { key: 'release-b.json', label: 'Release' } }] },
      { type: 'Text', children: [' '] },
      { type: 'Text', props: { bold: true }, children: ['Log'] },
      { type: 'Text', props: { dimColor: true }, children: ['Nothing yet.'] },
    ],
    part: { plugin: 'foreman' },
  },
  desktop: {
    type: 'Box', props: { key: 'foreman-pane', flexDirection: 'column' },
    children: [
      { type: 'Button', props: { key: 'open-a.json', label: '→ ABC-1 · #4 open · checks passed', variant: 'primary' } },
      { type: 'Svg', props: { source: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="34" viewBox="0 0 1600 34"><style>text{font:12px ui-sans-serif,system-ui,-apple-system,sans-serif}.t{fill:#1f1e1d}.m{fill:#73726c}.b{font-weight:600}.e{text-anchor:end}.k{fill:#e8e6dc}.f{fill:#d97757}.ok{fill:#5f8a4c}.bad{fill:#c0453a}.o{fill:none;stroke:#73726c;stroke-width:1.5}@media (prefers-color-scheme: dark){.t{fill:#ecebe8}.m{fill:#a3a29c}.k{fill:#3a3936}.f{fill:#e08a6c}.ok{fill:#7fae6a}.bad{fill:#e06c5f}.o{stroke:#a3a29c}}</style><text x="0" y="14"><tspan class="t b">Title of ABC-1</tspan><tspan class="m"> · </tspan><tspan class="t">plan tournament</tspan></text><text class="m e" x="1600" y="14">3 of 9 · 33%</text><rect class="k" x="0" y="22" width="1600" height="6" rx="3"/><rect class="f" x="0" y="22" width="533" height="6" rx="3"/></svg>', alt: 'Title of ABC-1 · plan tournament · ███░░░░░░░ 3 of 9 · 33%', width: 1600, height: 34 } },
      { type: 'Text', children: ['working'] },
      { type: 'Box', props: { key: 'actions-a.json', flexDirection: 'row' }, children: [{ type: 'Button', props: { key: 'nudge-a.json', label: 'Nudge' } }, { type: 'Text', children: [' '] }, { type: 'Button', props: { key: 'release-a.json', label: 'Release' } }] },
      { type: 'Text', children: [' '] },
      { type: 'Button', props: { key: 'open-b.json', label: '→ ABC-2 · no pull request yet', variant: 'primary' } },
      { type: 'Svg', props: { source: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="34" viewBox="0 0 1600 34"><style>text{font:12px ui-sans-serif,system-ui,-apple-system,sans-serif}.t{fill:#1f1e1d}.m{fill:#73726c}.b{font-weight:600}.e{text-anchor:end}.k{fill:#e8e6dc}.f{fill:#d97757}.ok{fill:#5f8a4c}.bad{fill:#c0453a}.o{fill:none;stroke:#73726c;stroke-width:1.5}@media (prefers-color-scheme: dark){.t{fill:#ecebe8}.m{fill:#a3a29c}.k{fill:#3a3936}.f{fill:#e08a6c}.ok{fill:#7fae6a}.bad{fill:#e06c5f}.o{stroke:#a3a29c}}</style><text x="0" y="14"><tspan class="t b">Title of ABC-2</tspan><tspan class="m"> · </tspan><tspan class="t">spec</tspan></text><text class="m e" x="1600" y="14">2 of 9 · 22%</text><rect class="k" x="0" y="22" width="1600" height="6" rx="3"/><rect class="f" x="0" y="22" width="356" height="6" rx="3"/></svg>', alt: 'Title of ABC-2 · spec · ██░░░░░░░░ 2 of 9 · 22%', width: 1600, height: 34 } },
      { type: 'Text', props: { color: 'error' }, children: ['needs you'] },
      { type: 'Box', props: { key: 'actions-b.json', flexDirection: 'row' }, children: [{ type: 'Button', props: { key: 'nudge-b.json', label: 'Nudge' } }, { type: 'Text', children: [' '] }, { type: 'Button', props: { key: 'release-b.json', label: 'Release' } }] },
      { type: 'Text', children: [' '] },
      { type: 'Text', props: { bold: true, weight: 'semibold' }, children: ['Log'] },
      { type: 'Text', props: { dimColor: true }, children: ['Nothing yet.'] },
    ],
    part: { plugin: 'foreman' },
  },
}

// A drawn tree with each Button's press handle taken out.
function withoutPresses(part: unknown): unknown {
  if (Array.isArray(part)) return part.map(withoutPresses)
  if (part === null || typeof part !== 'object') return part
  return Object.fromEntries(Object.entries(part).filter(([name]) => name !== 'press').map(([name, value]) => [name, withoutPresses(value)]))
}

// A copy of a pane tree whose last row, the log's only line, reads `line`.
function withLogLine(pane: { children: readonly unknown[] }, line: string) {
  const rows = pane.children.slice(0, -1)
  return { ...pane, children: [...rows, { type: 'Text', props: { dimColor: true }, children: [line] }] }
}

for (const surface of SURFACES) {
  test(`on the ${surface}, with a usable fact each chip and each pane row begins with a link to its issue, and the buttons still open the sub session`, async ($, on) => {
    const w = world(on)
    w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact(ADDRESS))
    twoSubs(w.folder)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    await w.clock.settle()

    const parts = await bandParts(ui)
    for (const [file, key, rest] of [['a.json', 'ABC-1', 'plan tournament'], ['b.json', 'ABC-2', 'needs you']] as const) {
      const at = chipAt(parts, file)
      expect(at).toBeGreaterThan(1)
      expect(parts[at - 2]!.type).toBe('Link')
      expect(parts[at - 2]!.props?.href).toBe(linkTo(key))
      expect(parts[at - 2]!.children).toEqual([key])
      expect(parts[at - 1]).toEqual({ type: 'Text', children: [' '] })
      expect(textOf(parts[at])).toBe(rest)
    }
    expect(await ui.band.findAll({ type: 'Link' })).toHaveLength(2)

    await expectLinkedRow(ui, 'a.json', 'ABC-1', '→ #4 open · checks passed')
    await expectLinkedRow(ui, 'b.json', 'ABC-2', '→ no pull request yet')

    await ui.band.press({ key: 'chip-b.json' })
    await ui.pane.press({ key: 'open-a.json' })
    expect(w.desktop.calls.map(c => c.args.session_id)).toEqual(['local_b', 'local_a'])
    expect(w.toasts).toEqual([])
  })

  test(`on the ${surface}, a released row still begins with its link`, async ($, on) => {
    const w = world(on)
    w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact(ADDRESS))
    twoSubs(w.folder)
    const ui = await mountBoth($, on, surface)
    await start($)
    await foreman($)
    await ui.pane.press({ key: 'release-a.json' })
    expect(await ui.pane.find({ key: 'release-a.json' })).toBeUndefined()
    await expectLinkedRow(ui, 'a.json', 'ABC-1', '→ #4 open · checks passed')
    expect(chipAt(await bandParts(ui), 'a.json')).toBe(-1)
  })

  test(`on the ${surface}, a row with no issue, a key cut for length and a key with an escape sequence have no link`, async ($, on) => {
    const w = world(on)
    w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact(ADDRESS))
    const long = `ABC-${'1'.repeat(50)}`
    w.folder.put('b.json', record('ABC-2', 'idle'))
    w.folder.put('e.json', record('ABC-\u001b[31m9', 'idle'))
    w.folder.put('l.json', record(long, 'idle'))
    w.folder.put('n.json', record(null, 'working', { issueTitle: '', stage: 'grounding' }))
    const ui = await mountBoth($, on, surface, 400)
    await start($)
    await foreman($)

    const links = await ui.band.findAll({ type: 'Link' })
    expect(links.map(link => link.props.href)).toEqual([linkTo('ABC-2')])
    expect((await ui.pane.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([linkTo('ABC-2')])
    const cut = `ABC-${'1'.repeat(35)}…`
    const parts = await bandParts(ui)
    expect(textOf(parts[chipAt(parts, 'e.json')])).toBe('ABC-9 idle')
    expect(textOf(parts[chipAt(parts, 'l.json')])).toBe(`${cut} idle`)
    expect(textOf(parts[chipAt(parts, 'n.json')])).toBe('no issue yet grounding')
    for (const [file, label] of [['e.json', '→ ABC-9 · no pull request yet'], ['l.json', `→ ${cut} · no pull request yet`], ['n.json', '→ no issue yet · no pull request yet']] as const) {
      expect(await ui.pane.find({ key: `issue-${file}` })).toBeUndefined()
      expect((await ui.pane.find({ key: `open-${file}` }))?.text).toBe(label)
    }
  })

  for (const [name, text] of [['no fact', null], ['an unusable fact', fact('http://tracker.example.com/issue/{key}')]] as const) {
    test(`on the ${surface}, with ${name} no link is drawn and every chip and row is drawn as before`, async ($, on) => {
      const w = world(on)
      if (text !== null) w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, text)
      twoSubs(w.folder)
      const ui = await mountBoth($, on, surface)
      await start($)
      await foreman($)
      await ui.band.redraw()
      await ui.pane.redraw()
      expect(withoutPresses(await ui.band.drawn())).toEqual(BAND_BEFORE)
      // An unusable fact also writes why it was ignored to the log, which
      // is the only part of the pane that differs from before.
      const pane = text === null ? PANE_BEFORE[surface] : withLogLine(PANE_BEFORE[surface], '12:00:00 foreman: the Issue link fact was ignored because it does not begin with https://')
      expect(withoutPresses(await ui.pane.drawn())).toEqual(pane)
    })
  }
}

test('a session that is not a parent reads no file and shows no toast, whatever its CLAUDE.md says', async ($, on) => {
  const w = world(on)
  w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact('http://tracker.example.com/issue/{key}'))
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.advance(10 * MINUTE)
  expect(await ui.bandText()).toBe('')
  expect(w.folder.reads).toBe(0)
  expect(w.folder.projectReads).toEqual([])
  expect(w.toasts).toEqual([])
})

const REASONS = [
  ['an http address', 'http://tracker.example.com/issue/{key}', 'it does not begin with https://'],
  ['a script address', 'javascript:alert({key})', 'it does not begin with https://'],
  ['an empty value', '', 'it does not begin with https://'],
  ['an address with no placeholder', 'https://tracker.example.com/issue/', 'it has no {key}'],
  ['an address with a space', 'https://tracker.example.com/issue/{key} now', 'it holds spaces or control characters'],
  ['an address with an escape sequence', 'https://tracker.example.com/issue/{key}\u001b[31m', 'it holds spaces or control characters'],
] as const

for (const [name, value, reason] of REASONS) {
  test(`a fact with ${name} shows one toast with its reason after /start-foreman and writes the same line to the log`, async ($, on) => {
    const w = world(on)
    w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact(value))
    const ui = await mountBoth($, on)
    await start($)
    expect(w.toasts).toEqual([])
    await foreman($)
    const line = `foreman: the Issue link fact was ignored because ${reason}`
    expect(w.toasts).toEqual([line])
    expect(await ui.newestLog()).toBe(line)
    // A second /start-foreman in a session that is already the parent reads
    // nothing again and says nothing again.
    const reads = w.folder.projectReads.length
    await foreman($)
    await foreman($, '3')
    expect(w.toasts).toEqual([line])
    expect(w.folder.projectReads).toHaveLength(reads)
  })
}

for (const [name, text] of [['no fact', null], ['a usable fact', fact(ADDRESS)]] as const) {
  test(`with ${name}, /start-foreman shows no toast`, async ($, on) => {
    const w = world(on)
    if (text !== null) w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, text)
    await mountBoth($, on)
    await start($)
    await foreman($)
    expect(w.toasts).toEqual([])
  })
}

test('a session that is a parent again from the store reads the fact at its start and shows its toast', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: null } } })
  w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact('https://tracker.example.com/issue/'))
  const ui = await mountBoth($, on)
  await start($)
  const line = 'foreman: the Issue link fact was ignored because it has no {key}'
  expect(w.toasts).toEqual([line])
  expect(await ui.newestLog()).toBe(line)
})

test('a toast the engine refuses does not stop the parent from starting, the band from drawing or the line from reaching the log', async ($, on) => {
  const w = world(on)
  w.engine.toastThrows = true
  w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact('https://tracker.example.com/issue/'))
  // A sub session that is working, so that no notice about it follows the
  // ignored line into the log.
  w.folder.put('a.json', record('ABC-1', 'working', { stage: 'plan', stageDone: 3, desktopSessionId: 'local_a' }))
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect((w.stored.get('parent:session-1') as { isOn: boolean }).isOn).toBe(true)
  const parts = await bandParts(ui)
  expect(textOf(parts[chipAt(parts, 'a.json')])).toBe('ABC-1 plan tournament')
  expect(await ui.newestLog()).toBe('foreman: the Issue link fact was ignored because it has no {key}')
})

test('a session that is a parent again from the store draws its links from the start', async ($, on) => {
  const w = world(on, { store: { 'parent:session-1': { isOn: true, slots: null } } })
  w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, fact(ADDRESS))
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await w.clock.settle()
  expect((await ui.band.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([linkTo('ABC-1'), linkTo('ABC-2')])
  expect(w.toasts).toEqual([])
})

test('a fact in the working folder\'s CLAUDE.local.md reaches the band', async ($, on) => {
  const w = world(on)
  w.folder.project.set(`${PARENT_DIR}/CLAUDE.md`, '# Example project\n')
  w.folder.project.set(`${PARENT_DIR}/CLAUDE.local.md`, fact(ADDRESS))
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect((await ui.band.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([linkTo('ABC-1'), linkTo('ABC-2')])
  expect(w.folder.projectReads).toEqual([`${PARENT_DIR}/CLAUDE.md`, `${PARENT_DIR}/CLAUDE.local.md`])
})

test('a fact in the main checkout\'s CLAUDE.local.md reaches the band of a parent working in a worktree', async ($, on) => {
  const w = world(on)
  w.folder.project.set(`${PARENT_DIR}/.git`, 'gitdir: /repo/.git/worktrees/parent\n')
  w.folder.project.set('/repo/.git/worktrees/parent/commondir', '../..\n')
  w.folder.project.set('/repo/CLAUDE.local.md', fact(ADDRESS))
  twoSubs(w.folder)
  const ui = await mountBoth($, on)
  await start($)
  await foreman($)
  expect((await ui.band.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([linkTo('ABC-1'), linkTo('ABC-2')])
  expect(w.folder.projectReads).toEqual([
    `${PARENT_DIR}/CLAUDE.md`, `${PARENT_DIR}/CLAUDE.local.md`, `${PARENT_DIR}/.git`, '/repo/.git/worktrees/parent/commondir', '/repo/CLAUDE.local.md',
  ])
})
