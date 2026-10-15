// Whether the running mod still matches the files on disk: the commits it was
// loaded from, when they are compared with the checkout's HEAD, and when the
// session is told to restart. Every function is pure; hooks/register.tsx runs
// git in the mod's folder and passes its answers in.

import type { LoadBegun, Loaded, LoadedCommit } from '../types'

// The two parts of the mod a commit is recorded for. The session part is what
// the engine reads only when a session starts, and the hooks part is what a
// hot reload of the hooks module reads again.
export type LoadedPart = 'session' | 'hooks'

// The paths each part stands for, as git pathspecs relative to the mod's
// folder, where git runs. The list of hook modules, hooks/hooks.json, counts
// with the session part, because nothing shows that a hot reload reads it
// again.
export const LOADED_PATHS: Record<LoadedPart, readonly string[]> = {
  session: ['agents', '.claude-plugin/plugin.json', 'hooks/hooks.json'],
  hooks: ['hooks', ':(exclude)hooks/hooks.json'],
}

const PARTS: readonly LoadedPart[] = ['session', 'hooks']

// A part that is due to be compared, and the commit it is compared from.
export type Comparison = { part: LoadedPart; commit: string }

// What a comparison found for a part: whether its files differ between the
// commit and HEAD.
export type Found = Comparison & { differs: boolean }

function commitIn(raw: unknown): LoadedCommit | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (c.commit !== null && typeof c.commit !== 'string') return null
  if (typeof c.differs !== 'boolean') return null
  if (c.pending === undefined) return { commit: c.commit, differs: c.differs }
  if (c.pending !== true || c.commit !== null || c.differs) return null
  return PENDING
}

// The session part a reload records while the first load of this build still
// waits on git, which that load fills in.
const PENDING: LoadedCommit = { commit: null, differs: false, pending: true }

// A stored value, or null when it is missing or not in the shape the mod
// writes.
export function loadedIn(raw: unknown): Loaded | null {
  if (typeof raw !== 'object' || raw === null) return null
  const l = raw as Record<string, unknown>
  if (l.head !== null && typeof l.head !== 'string') return null
  const session = commitIn(l.session)
  const hooks = commitIn(l.hooks)
  if (session === null || hooks === null) return null
  return { head: l.head, session, hooks }
}

// A stored value of how the first load of this build began, or null when it
// is missing or not in the shape the mod writes. A load that finds null is
// the first of this build.
export function loadBegunIn(stored: unknown): LoadBegun | null {
  return stored === 'atStart' || stored === 'fromOlderBuild' ? stored : null
}

// How the first load of this build began, given the stored value and whether
// the session's folder was already set when this load began. A stored value
// in the shape the mod writes is kept, so a reload that comes while the first
// load still waits on git decides as that load did. Without one, this load is
// the first of this build: a reload from an older build when the folder is
// already set, since every build sets it at session start, and the session's
// start otherwise.
export function loadBegunAs(stored: unknown, cwdSet: boolean): LoadBegun {
  return loadBegunIn(stored) ?? (cwdSet ? 'fromOlderBuild' : 'atStart')
}

// What a load of the hooks module records, given the HEAD it read, or null
// when git could not say, how the first load of this build began, and whether
// this load is that first load. The first load records both commits. A later
// load, a hot reload, keeps the session commit and its flag as they were, so
// a warning about the session-start files stays on until the next
// comparison, and records a new hooks commit, which matches the hooks just
// loaded. A failed first read records no commit at all, so a later reload
// never stands in for the session start. The head of the last comparison is
// kept, so a move of HEAD that no comparison has seen is still compared.
//
// A reload that finds no record because the first load still waits on git
// records its hooks commit and leaves the session part pending, since only
// the first load read HEAD when the session-start files were read. When the
// first load finishes it fills in the session part and keeps the reload's
// hooks commit, which matches the hooks now running. It clears the head of
// the last comparison, so the session commit it records is compared at once.
//
// A load that finds no record when this build began as a reload from an older
// build, which kept none, cannot know the commit the session started at. Its
// session commit is recorded as unknown and differing, which warns at once:
// no comparison can clear it, since no HEAD can match an unknown commit, so
// only a restart does. A reload of the session would otherwise record the
// reload's HEAD as the session commit and never warn about agents that
// changed since the session started.
export function afterLoad(prev: Loaded | null, head: string | null, begun: LoadBegun, first: boolean): Loaded {
  const hooks = { commit: head, differs: false }
  const session = begun === 'fromOlderBuild' ? { commit: null, differs: true } : { commit: head, differs: false }
  if (prev === null) return { head: null, session: first ? session : PENDING, hooks }
  if (first && prev.session.pending === true) return { head: null, session, hooks: prev.hooks }
  return { head: prev.head, session: prev.session, hooks }
}

// The comparison against `head`, the HEAD just read: null while it is the
// head the last comparison read, since no comparison is needed then, else
// each part whose commit is known and is not `head`. A pending session part
// has no commit, so it is never compared. That list can be empty,
// and a comparison with no part due still records the head, which is how a
// move back to the loaded commit clears the warning.
export function dueComparisons(l: Loaded, head: string): Comparison[] | null {
  if (head === l.head) return null
  return PARTS.flatMap(part => {
    const commit = l[part].commit
    return commit === null || commit === head ? [] : [{ part, commit }]
  })
}

// The record after a comparison against `head`. A part whose commit is `head`
// differs in nothing. A part takes what was found for it only while its
// commit is still the one compared, so a reload that recorded a new commit in
// the middle of a comparison is not overwritten by it. The record moves to
// `head` only when every part is settled at it: its commit is null, so it is
// never compared, or is `head`, or has a result here. A part whose commit
// changed in the middle got no result, so the old head is kept, and the next
// comparison against `head` still compares that part instead of finding the
// head already read and stopping.
export function afterComparison(prev: Loaded, head: string, found: readonly Found[]): Loaded {
  const next = (part: LoadedPart): LoadedCommit => {
    const was = prev[part]
    if (was.commit === head) return { commit: was.commit, differs: false }
    const result = found.find(f => f.part === part && f.commit === was.commit)
    return result === undefined ? was : { commit: was.commit, differs: result.differs }
  }
  const settled = PARTS.every(part => {
    const commit = prev[part].commit
    return commit === null || commit === head || found.some(f => f.part === part && f.commit === commit)
  })
  return { head: settled ? head : prev.head, session: next('session'), hooks: next('hooks') }
}

// Whether the session should be told to restart: the files of either part
// differ at HEAD.
export function isStale(l: Loaded | null): boolean {
  return l !== null && (l.session.differs || l.hooks.differs)
}
