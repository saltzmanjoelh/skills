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
      expect(await ui.band.findAll({ type: 'Link' })).toHaveLength(0)
      expect(await ui.pane.findAll({ type: 'Link' })).toHaveLength(0)
      const parts = await bandParts(ui)
      expect(textOf(parts[chipAt(parts, 'a.json')])).toBe('ABC-1 plan tournament')
      expect(parts[chipAt(parts, 'a.json') - 1]).toEqual({ type: 'Text', children: [' · '] })
      expect(await ui.pane.find({ key: 'issue-a.json' })).toBeUndefined()
      expect((await ui.pane.find({ key: 'open-a.json' }))?.text).toBe('→ ABC-1 · #4 open · checks passed')
      expect((await ui.pane.find({ key: 'open-b.json' }))?.text).toBe('→ ABC-2 · no pull request yet')
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
