import { expect, test } from 'claude-code/testing'

import { afterSend, emptySends, REASON_MAX, sendOutcomeOf, sendsIn, sendsKey, sendsLine, sendsNewest, type SendsRecord } from '../hooks/sends'

const NOW = Date.parse('2026-10-12T14:55:02Z')
const SINCE = Date.parse('2026-10-12T14:02:00Z')

const fresh = (): SendsRecord => emptySends({ sessionId: 'session-1', parentSessionId: 'parent-1', since: SINCE })

test('a fresh record counts nothing, carries its version, ids and load time, and is kept under sends: and the session id', () => {
  expect(fresh()).toEqual({ version: 1, sessionId: 'session-1', parentSessionId: 'parent-1', since: SINCE, delivered: 0, failed: 0, last: null })
  expect(sendsKey('session-1')).toBe('sends:session-1')
})

test('an answer that says delivered counts as delivered, and every other answer counts as failed with the engine\'s reason or a sentence saying it gave none', () => {
  expect(sendOutcomeOf({ kind: 'answered', answer: { isDelivered: true } }, 10_000)).toEqual({ outcome: 'delivered' })
  expect(sendOutcomeOf({ kind: 'answered', answer: { isDelivered: false, reason: 'the recipient is not running' } }, 10_000))
    .toEqual({ outcome: 'failed', reason: 'the recipient is not running' })
  expect(sendOutcomeOf({ kind: 'answered', answer: { isDelivered: false } }, 10_000)).toEqual({ outcome: 'failed', reason: 'the engine gave no reason' })
  expect(sendOutcomeOf({ kind: 'answered', answer: { isDelivered: false, reason: '  ' } }, 10_000)).toEqual({ outcome: 'failed', reason: 'the engine gave no reason' })
  expect(sendOutcomeOf({ kind: 'answered', answer: undefined }, 10_000)).toEqual({ outcome: 'failed', reason: 'the engine gave no reason' })
})

test('a send that throws counts as failed with the error\'s message, and one that runs past its limit counts as failed with a sentence worded from the limit', () => {
  expect(sendOutcomeOf({ kind: 'threw', error: new Error('the socket closed') }, 10_000)).toEqual({ outcome: 'failed', reason: 'the socket closed' })
  expect(sendOutcomeOf({ kind: 'threw', error: 'a plain string' }, 10_000)).toEqual({ outcome: 'failed', reason: 'a plain string' })
  expect(sendOutcomeOf({ kind: 'threw', error: new Error('') }, 10_000)).toEqual({ outcome: 'failed', reason: 'the send threw with no message' })
  expect(sendOutcomeOf({ kind: 'timed-out' }, 10_000)).toEqual({ outcome: 'failed', reason: 'no answer came within 10 seconds' })
  expect(sendOutcomeOf({ kind: 'timed-out' }, 1_000)).toEqual({ outcome: 'failed', reason: 'no answer came within 1 second' })
})

test('each send raises its own count and becomes the newest, with its time and, when it failed, its reason cleaned to one short line', () => {
  const one = afterSend(fresh(), { outcome: 'delivered' }, NOW - 60_000)
  expect(one).toMatchObject({ delivered: 1, failed: 0, last: { at: NOW - 60_000, outcome: 'delivered' } })

  const two = afterSend(one, { outcome: 'failed', reason: '<b>refused</b>\u001b[31m\nby a hook\tnow' }, NOW)
  expect(two).toMatchObject({ delivered: 1, failed: 1, last: { at: NOW, outcome: 'failed', reason: '<b>refused</b> by a hook now' } })

  const long = afterSend(fresh(), { outcome: 'failed', reason: 'x'.repeat(500) }, NOW)
  expect(long.last?.outcome === 'failed' ? long.last.reason.length : 0).toBe(REASON_MAX)

  // A delivered send after a failed one drops the reason.
  expect(afterSend(two, { outcome: 'delivered' }, NOW + 1).last).toEqual({ at: NOW + 1, outcome: 'delivered' })
  // The record handed in is never changed.
  expect(one).toMatchObject({ delivered: 1, failed: 0 })
})

test('the newest time of a record is its newest send, or its load time before any send', () => {
  expect(sendsNewest(fresh())).toBe(SINCE)
  expect(sendsNewest(afterSend(fresh(), { outcome: 'delivered' }, NOW))).toBe(NOW)
})

test('a stored copy reads back as it was written, and one that is damaged in any part or belongs to another session reads as none', () => {
  const record = afterSend(afterSend(fresh(), { outcome: 'delivered' }, NOW - 1), { outcome: 'failed', reason: 'gone' }, NOW)
  expect(sendsIn(JSON.parse(JSON.stringify(record)), 'session-1')).toEqual(record)
  expect(sendsIn(record, 'session-2')).toBeNull()
  expect(sendsIn(null, 'session-1')).toBeNull()
  expect(sendsIn('garbage', 'session-1')).toBeNull()
  expect(sendsIn([record], 'session-1')).toBeNull()
  expect(sendsIn({ ...record, version: 2 }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, parentSessionId: 7 }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, since: 'today' }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, delivered: -1 }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, failed: 1.5 }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, last: { at: NOW, outcome: 'lost' } }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, last: { at: NOW, outcome: 'failed' } }, 'session-1')).toBeNull()
  expect(sendsIn({ ...record, last: { at: 'now', outcome: 'delivered' } }, 'session-1')).toBeNull()
})

test('the pane\'s line counts both outcomes, names the newest send\'s time once there is one, and warns with the reason only while the newest send failed', () => {
  expect(sendsLine(fresh(), NOW)).toEqual({ text: 'Messages to foreman: 0 delivered, 0 failed', isWarning: false })

  const delivered = afterSend(fresh(), { outcome: 'delivered' }, NOW)
  expect(sendsLine(delivered, NOW)).toEqual({ text: 'Messages to foreman: 1 delivered, 0 failed, last at 14:55:02 UTC', isWarning: false })

  const failed = afterSend(delivered, { outcome: 'failed', reason: 'the recipient is not running' }, NOW + 1_000)
  expect(sendsLine(failed, NOW + 1_000)).toEqual({
    text: 'Messages to foreman: 1 delivered, 1 failed, last at 14:55:03 UTC, which failed: the recipient is not running',
    isWarning: true,
  })

  const again = afterSend(failed, { outcome: 'delivered' }, NOW + 2_000)
  expect(sendsLine(again, NOW + 2_000)).toEqual({ text: 'Messages to foreman: 2 delivered, 1 failed, last at 14:55:04 UTC', isWarning: false })

  // On a later day the date stands before the time.
  expect(sendsLine(again, NOW + 24 * 60 * 60_000).text).toBe('Messages to foreman: 2 delivered, 1 failed, last at 2026-10-12 14:55:04 UTC')
})

test('a reason with markup, an escape sequence and several lines is drawn on one line as plain text', () => {
  const record = afterSend(fresh(), { outcome: 'failed', reason: '<Text color="red">no</Text>\u001b]8;;http://x\u0007link\u001b]8;;\u0007\r\nsecond line' }, NOW)
  const { text } = sendsLine(record, NOW)
  expect(text).toBe('Messages to foreman: 0 delivered, 1 failed, last at 14:55:02 UTC, which failed: <Text color="red">no</Text>link second line')
  expect(text).not.toMatch(/[\u0000-\u001f]/)
})
