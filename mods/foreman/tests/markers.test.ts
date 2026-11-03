import { expect, test } from 'claude-code/testing'

import { afterConsumed, emptyMarkers, markersIn, markersKey, markersLine, markersNewest, MARKERS_KEPT_MS } from '../hooks/markers'

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0)
const MINUTE = 60_000

test('a fresh record counts nothing, and each consumed marker raises the count, keeps the first time and moves the newest', () => {
  const fresh = emptyMarkers('session-1', T0)
  expect(fresh).toEqual({ version: 1, sessionId: 'session-1', since: T0, consumed: 0, first: null, last: null })
  const once = afterConsumed(fresh, T0 + 5 * MINUTE)
  expect(once).toEqual({ ...fresh, consumed: 1, first: T0 + 5 * MINUTE, last: T0 + 5 * MINUTE })
  const twice = afterConsumed(once, T0 + 7 * MINUTE)
  expect(twice).toEqual({ ...fresh, consumed: 2, first: T0 + 5 * MINUTE, last: T0 + 7 * MINUTE })
  expect(fresh.consumed).toBe(0)
})

test('the line says none yet before the first marker, and then the count and the newest time, both after the load time', () => {
  const fresh = emptyMarkers('session-1', T0)
  expect(markersLine(fresh, T0)).toBe('Status messages consumed since 12:00:00 UTC: none yet')
  const twice = afterConsumed(afterConsumed(fresh, T0 + MINUTE), T0 + 55 * MINUTE)
  expect(markersLine(twice, T0 + 60 * MINUTE)).toBe('Status messages consumed since 12:00:00 UTC: 2, last at 12:55:00 UTC')
})

test('the line puts the date in front of a time on another day than now', () => {
  const once = afterConsumed(emptyMarkers('session-1', T0), T0 + MINUTE)
  expect(markersLine(once, T0 + 24 * 60 * MINUTE)).toBe('Status messages consumed since 2026-10-20 12:00:00 UTC: 1, last at 2026-10-20 12:01:00 UTC')
})

test('the key is the parent session id after the prefix', () => {
  expect(markersKey('session-1')).toBe('markers:session-1')
  expect(MARKERS_KEPT_MS).toBe(14 * 24 * 60 * MINUTE)
})

test('a stored copy is read back whole, and its newest time is the newest marker, or the load time before any', () => {
  const fresh = emptyMarkers('session-1', T0)
  const once = afterConsumed(fresh, T0 + MINUTE)
  expect(markersIn(JSON.parse(JSON.stringify(once)), 'session-1')).toEqual(once)
  expect(markersNewest(fresh)).toBe(T0)
  expect(markersNewest(once)).toBe(T0 + MINUTE)
})

test('a stored copy of another session, of another version or with a damaged field reads as none', () => {
  const once = afterConsumed(emptyMarkers('session-1', T0), T0 + MINUTE)
  expect(markersIn(once, 'session-2')).toBeNull()
  for (const damaged of [
    null,
    'markers',
    [],
    { ...once, version: 2 },
    { ...once, since: 'today' },
    { ...once, consumed: -1 },
    { ...once, consumed: 1.5 },
    { ...once, first: 'then' },
    { ...once, last: Number.NaN },
    { ...once, consumed: 0 },
    { ...once, first: null },
  ]) expect(markersIn(damaged, 'session-1')).toBeNull()
})
