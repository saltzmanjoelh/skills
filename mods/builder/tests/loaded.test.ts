import { expect, test } from 'claude-code/testing'

import { afterComparison, afterLoad, dueComparisons, isStale, LOADED_PATHS, loadBegunAs, loadBegunIn, loadedIn } from '../hooks/loaded'
import type { Loaded } from '../types'

const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const E = 'e'.repeat(40)

// What the mod records when the session starts at `commit` and compares
// nothing yet, with the case's changes on top.
function loaded(commit: string | null, over: Partial<Loaded> = {}): Loaded {
  return { head: null, session: { commit, differs: false }, hooks: { commit, differs: false }, ...over }
}

test('the session-start files are the agents, the manifest and the list of hook modules, and the hooks are the rest of the hooks folder', () => {
  expect(LOADED_PATHS.session).toEqual(['agents', '.claude-plugin/plugin.json', 'hooks/hooks.json'])
  expect(LOADED_PATHS.hooks).toEqual(['hooks', ':(exclude)hooks/hooks.json'])
})

test('a stored value reads back only in the shape the mod writes', () => {
  const good = loaded(C, { head: D, session: { commit: C, differs: true } })
  expect(loadedIn(good)).toEqual(good)
  expect(loadedIn(loaded(null))).toEqual(loaded(null))
  expect(loadedIn(null)).toBeNull()
  expect(loadedIn(undefined)).toBeNull()
  expect(loadedIn(C)).toBeNull()
  expect(loadedIn({ ...good, head: 7 })).toBeNull()
  expect(loadedIn({ ...good, session: null })).toBeNull()
  expect(loadedIn({ ...good, hooks: { commit: 7, differs: false } })).toBeNull()
  expect(loadedIn({ ...good, hooks: { commit: C, differs: 'yes' } })).toBeNull()
  // A value an older build might have kept, with one commit for everything.
  expect(loadedIn({ commit: C })).toBeNull()
  // A pending session part reads back only with no commit and no difference.
  const pending = loaded(null, { session: { commit: null, differs: false, pending: true }, hooks: { commit: D, differs: false } })
  expect(loadedIn(pending)).toEqual(pending)
  expect(loadedIn({ ...good, session: { commit: C, differs: false, pending: true } })).toBeNull()
  expect(loadedIn({ ...good, session: { commit: null, differs: true, pending: true } })).toBeNull()
  expect(loadedIn({ ...good, session: { commit: null, differs: false, pending: false } })).toBeNull()
})

test('the first load of this build began at the session start unless the session folder was already set, and a later load keeps what the first decided', () => {
  expect(loadBegunAs(null, false)).toBe('atStart')
  // The folder is set while nothing was stored: a build that wrote no record
  // set it, so this load is a reload from that build.
  expect(loadBegunAs(null, true)).toBe('fromOlderBuild')
  // A reload of this build that comes while the first load still waits on
  // git finds the folder set, and keeps what the first load decided.
  expect(loadBegunAs('atStart', true)).toBe('atStart')
  expect(loadBegunAs('fromOlderBuild', true)).toBe('fromOlderBuild')
  // A value not in the shape the mod writes counts as nothing stored.
  expect(loadBegunAs(true, true)).toBe('fromOlderBuild')
  expect(loadBegunAs('other', false)).toBe('atStart')
})

test('a load is the first of this build only when it finds no stored value in the shape the mod writes', () => {
  expect(loadBegunIn(null)).toBeNull()
  expect(loadBegunIn(true)).toBeNull()
  expect(loadBegunIn('other')).toBeNull()
  expect(loadBegunIn('atStart')).toBe('atStart')
  expect(loadBegunIn('fromOlderBuild')).toBe('fromOlderBuild')
})

test('a reload while the first load still waits on git records its hooks commit and leaves the session part pending, which never warns and is never compared or cleared', () => {
  const reload = afterLoad(null, D, 'atStart', false)
  expect(reload).toEqual({ head: null, session: { commit: null, differs: false, pending: true }, hooks: { commit: D, differs: false } })
  expect(isStale(reload)).toBe(false)
  expect(dueComparisons(reload, E)).toEqual([{ part: 'hooks', commit: D }])
  const compared = afterComparison(reload, D, [{ part: 'session', commit: D, differs: true }])
  expect(compared.session).toEqual({ commit: null, differs: false, pending: true })
  // A second reload keeps the session part pending.
  expect(afterLoad(compared, E, 'atStart', false).session).toEqual({ commit: null, differs: false, pending: true })
})

test('the first load fills in a pending session part with the head it read, keeps the reload\'s hooks commit, and clears the head so the session commit is compared', () => {
  const reload = afterComparison(afterLoad(null, D, 'atStart', false), D, [])
  const first = afterLoad(reload, C, 'atStart', true)
  expect(first).toEqual({ head: null, session: { commit: C, differs: false }, hooks: { commit: D, differs: false } })
  expect(dueComparisons(first, D)).toEqual([{ part: 'session', commit: C }])
  // A first read that failed fills it in as no commit, which never warns.
  expect(afterLoad(reload, null, 'atStart', true).session).toEqual({ commit: null, differs: false })
  // A first load from an older build fills it in as unknown and differing.
  const older = afterLoad(reload, C, 'fromOlderBuild', true)
  expect(older.session).toEqual({ commit: null, differs: true })
  expect(older.hooks).toEqual({ commit: D, differs: false })
  expect(isStale(older)).toBe(true)
  // A first load that finds a session part already recorded keeps it.
  expect(afterLoad(loaded(E), C, 'atStart', true)).toEqual({ head: null, session: { commit: E, differs: false }, hooks: { commit: C, differs: false } })
})

test('the first load records both commits at the head it read, and differs in neither', () => {
  expect(afterLoad(null, C, 'atStart', true)).toEqual(loaded(C))
})

test('a reload keeps the session commit and its flag, and records a new hooks commit that differs in nothing', () => {
  const before = loaded(C, { head: D, session: { commit: C, differs: true }, hooks: { commit: C, differs: true } })
  expect(afterLoad(before, D, 'atStart', false)).toEqual({ head: D, session: { commit: C, differs: true }, hooks: { commit: D, differs: false } })
})

test('a first read of the head that failed records no commit, so a later reload never stands in for the session start', () => {
  const first = afterLoad(null, null, 'atStart', true)
  expect(first).toEqual(loaded(null))
  expect(isStale(first)).toBe(false)
  const reload = afterLoad(first, D, 'atStart', false)
  expect(reload.session).toEqual({ commit: null, differs: false })
  expect(reload.hooks).toEqual({ commit: D, differs: false })
  expect(isStale(reload)).toBe(false)
  // A reload whose read failed records no hooks commit either.
  expect(afterLoad(loaded(C), null, 'atStart', false).hooks).toEqual({ commit: null, differs: false })
})

test('a reload with no record, from a build that kept none, records the session commit as unknown and differing, and the hooks commit as usual', () => {
  const reload = afterLoad(null, D, 'fromOlderBuild', true)
  expect(reload).toEqual({ head: null, session: { commit: null, differs: true }, hooks: { commit: D, differs: false } })
  expect(isStale(reload)).toBe(true)
  // A read of the head that failed too still leaves the session commit unknown.
  expect(afterLoad(null, null, 'fromOlderBuild', true).session).toEqual({ commit: null, differs: true })
  // A later reload keeps the unknown session commit.
  expect(afterLoad(reload, E, 'fromOlderBuild', false).session).toEqual({ commit: null, differs: true })
})

test('an unknown session commit that differs is never compared and never cleared, since no head can match it', () => {
  const unknown = afterLoad(null, D, 'fromOlderBuild', true)
  expect(dueComparisons(unknown, C)).toEqual([{ part: 'hooks', commit: D }])
  // A move back to the head the reload read clears nothing of the session part.
  const back = afterComparison(unknown, D, [])
  expect(back.session).toEqual({ commit: null, differs: true })
  expect(isStale(back)).toBe(true)
  // Nor does a finding for some other commit.
  const found = afterComparison(unknown, C, [{ part: 'session', commit: C, differs: false }, { part: 'hooks', commit: D, differs: false }])
  expect(found.session).toEqual({ commit: null, differs: true })
})

test('no comparison is needed while the head is the one the last comparison read', () => {
  expect(dueComparisons(loaded(C, { head: D }), D)).toBeNull()
  // Even with every commit at that head, so a move back is recorded only by
  // a comparison at a head that differs from the last one.
  expect(dueComparisons(loaded(D, { head: D }), D)).toBeNull()
})

test('a comparison with no part due is still needed when the head moved, so it records the head, which is how a move back clears the warning', () => {
  const stale = loaded(C, { head: D, session: { commit: C, differs: true } })
  expect(dueComparisons(stale, C)).toEqual([])
})

test('once the head moves, each part whose commit is known and is not the head is compared', () => {
  expect(dueComparisons(loaded(C), D)).toEqual([{ part: 'session', commit: C }, { part: 'hooks', commit: C }])
  expect(dueComparisons(loaded(C, { head: C, hooks: { commit: D, differs: false } }), D)).toEqual([{ part: 'session', commit: C }])
  expect(dueComparisons(loaded(null, { hooks: { commit: C, differs: false } }), D)).toEqual([{ part: 'hooks', commit: C }])
  // At the first comparison after the load the head has not moved from the
  // loaded commits, so nothing is compared, though no head was read yet.
  expect(dueComparisons(loaded(C), C)).toEqual([])
})

test('a comparison records the head it read and what it found for each part', () => {
  const next = afterComparison(loaded(C), D, [{ part: 'session', commit: C, differs: true }, { part: 'hooks', commit: C, differs: false }])
  expect(next).toEqual({ head: D, session: { commit: C, differs: true }, hooks: { commit: C, differs: false } })
  expect(isStale(next)).toBe(true)
})

test('a part whose commit is the head again differs in nothing, which clears the warning', () => {
  const stale = loaded(C, { head: D, session: { commit: C, differs: true }, hooks: { commit: C, differs: true } })
  const back = afterComparison(stale, C, [])
  expect(back).toEqual({ head: C, session: { commit: C, differs: false }, hooks: { commit: C, differs: false } })
  expect(isStale(back)).toBe(false)
})

test('a part whose commit changed while it was compared keeps what it had, so a reload in the middle is not overwritten', () => {
  // The comparison began with the hooks at C, and a reload recorded E meanwhile.
  const reloaded = loaded(C, { hooks: { commit: E, differs: false } })
  const next = afterComparison(reloaded, D, [{ part: 'session', commit: C, differs: true }, { part: 'hooks', commit: C, differs: true }])
  expect(next.session).toEqual({ commit: C, differs: true })
  expect(next.hooks).toEqual({ commit: E, differs: false })
})

test('a comparison keeps the old head while a part with a known commit got no result, and moves to the head once every part is settled', () => {
  // The first load filled in the session commit C while a comparison of the
  // hooks at D against E ran, so C was never compared and the head stays.
  const filled = loaded(C, { head: D, hooks: { commit: D, differs: false } })
  const kept = afterComparison(filled, E, [{ part: 'hooks', commit: D, differs: true }])
  expect(kept).toEqual({ head: D, session: { commit: C, differs: false }, hooks: { commit: D, differs: true } })
  expect(dueComparisons(kept, E)).toEqual([{ part: 'session', commit: C }, { part: 'hooks', commit: D }])
  // Every part settled: one with a result, and one with no commit.
  const noSession = loaded(null, { hooks: { commit: D, differs: false } })
  expect(afterComparison(noSession, E, [{ part: 'hooks', commit: D, differs: true }]).head).toBe(E)
  // Every part settled: one with a result, and one whose commit is the head.
  const atHead = loaded(C, { hooks: { commit: E, differs: false } })
  expect(afterComparison(atHead, E, [{ part: 'session', commit: C, differs: true }]).head).toBe(E)
})

test('the session is stale when either part differs, and not before anything is recorded', () => {
  expect(isStale(null)).toBe(false)
  expect(isStale(loaded(C))).toBe(false)
  expect(isStale(loaded(C, { session: { commit: C, differs: true } }))).toBe(true)
  expect(isStale(loaded(C, { hooks: { commit: C, differs: true } }))).toBe(true)
})
