import { expect, test } from 'claude-code/testing'
import type { PromptOrigin, ToolCallResult } from 'claude-code'

import type { Listed } from '../hooks/desktop'
import { AUTOMATED_REFUSAL, beginFailedNotice, beginHeldLog, beginHeldNotice, heldLine, heldLog, heldNotice, heldSentence, isHeldRefusal, isPersonPrompt, keyOfTitle, releasedBy, REMOTE_REFUSAL } from '../hooks/held'

// The desktop app's two refusals of start_session that foreman holds a key
// for: the one it gives while its Remote Control setting is on, word for word,
// and the opening of the one it gives on a turn that no person typed.
const REFUSAL = 'The user is working over Remote Control, and for now you can start a session only on a message typed in the desktop app. If they asked for one, tell them so in one line.'
const AUTOMATED = 'Start sessions only on the user\'s own words to you here; this turn runs an automated event, another session\'s message, or the task another session gave you. Propose the session instead.'

// A session as the desktop app's list gives it, with `over` changing its
// fields.
const listed = (over: Partial<Listed> = {}): Listed => ({ sessionId: 'local_a', isArchived: false, isRunning: true, title: 'ABC-123: short', surelyUnarchived: true, ...over })

test('a title gives the issue key at its start only when a space or a colon follows the key', () => {
  expect(keyOfTitle('ABC-123: x')).toBe('ABC-123')
  expect(keyOfTitle('ABC-123 x')).toBe('ABC-123')
  expect(keyOfTitle('No issue: x')).toBeNull()
  expect(keyOfTitle(undefined)).toBeNull()
  expect(keyOfTitle(7)).toBeNull()
  expect(keyOfTitle('ABC-1234')).toBeNull()
  expect(keyOfTitle('ABC-123-fix: x')).toBeNull()
})

test('only an answer whose text holds the words of one of the app\'s two refusals is held, error or not, and a deny never is', () => {
  expect(REFUSAL).toContain(REMOTE_REFUSAL)
  expect(isHeldRefusal({ result: REFUSAL, text: REFUSAL })).toBe(true)
  expect(isHeldRefusal({ isError: true, result: REFUSAL, text: REFUSAL })).toBe(true)
  expect(isHeldRefusal({ result: { content: [{ type: 'text', text: REFUSAL }] } } as ToolCallResult)).toBe(true)
  const reworded = 'The user is on their phone, so you can start a session only from the desktop app.'
  expect(isHeldRefusal({ isError: true, result: reworded, text: reworded })).toBe(false)
  expect(isHeldRefusal({ deny: REFUSAL })).toBe(false)
  expect(isHeldRefusal({ result: undefined } as ToolCallResult)).toBe(false)
  expect(isHeldRefusal({ result: 'Started the session local_new1.', text: 'Started the session local_new1.' })).toBe(false)
  expect(AUTOMATED).toContain(AUTOMATED_REFUSAL)
  expect(isHeldRefusal({ isError: true, result: AUTOMATED, text: AUTOMATED })).toBe(true)
  expect(isHeldRefusal({ result: { content: [{ type: 'text', text: AUTOMATED }] } } as ToolCallResult)).toBe(true)
})

test('a refusal written with curly apostrophes is held too', () => {
  const curly = AUTOMATED.replace(/'/g, '\u2019')
  expect(isHeldRefusal({ isError: true, result: curly, text: curly })).toBe(true)
  const title = `ABC-123: ${AUTOMATED_REFUSAL.replace(/'/g, '\u2019')}`
  const echoed = `Proposed "${title}" as a card.`
  expect(isHeldRefusal({ result: echoed, text: echoed }, title)).toBe(false)
})

test('the words in the call\'s own title, or in an answer that names a started session, are not the refusal', () => {
  const title = 'ABC-123: keep working over Remote Control'
  const started = `Started session "${title}" (session_id: local_new1, name: example)`
  expect(isHeldRefusal({ result: started, text: started }, title)).toBe(false)
  const echoed = `Proposed "${title}" as a card.`
  expect(isHeldRefusal({ result: echoed, text: echoed }, title)).toBe(false)
  expect(isHeldRefusal({ result: `${REFUSAL} local_x`, text: `${REFUSAL} local_x` })).toBe(false)
  expect(isHeldRefusal({ isError: true, result: REFUSAL, text: REFUSAL }, title)).toBe(true)
})

test('a list read releases a held key only for an unarchived entry whose title begins with exactly that key, whether or not a turn runs', () => {
  expect(releasedBy(['ABC-123'], [listed()])).toEqual({ held: [], logs: ['Stopped holding ABC-123, because the desktop app\'s list shows a session for it.'] })
  expect(releasedBy(['ABC-123'], [listed({ isRunning: false, title: 'ABC-123 short' })]).held).toEqual([])
  expect(releasedBy(['ABC-123', 'ABC-9'], [listed()])).toEqual({ held: ['ABC-9'], logs: ['Stopped holding ABC-123, because the desktop app\'s list shows a session for it.'] })
  const none = { held: ['ABC-123'], logs: [] }
  expect(releasedBy(['ABC-123'], [listed({ title: 'ABC-1234: short' })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ title: 'Implement ABC-123: short' })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ isArchived: true, surelyUnarchived: false })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ surelyUnarchived: false })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ title: null })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [])).toEqual(none)
})

test('a prompt is the person\'s only when it was typed at a terminal, came through the bridge or came from the SDK, and is not the app\'s CI event', () => {
  const kinds: [PromptOrigin, boolean][] = [
    [{ kind: 'composer' }, true],
    [{ kind: 'bridge' }, true],
    [{ kind: 'sdk' }, true],
    [{ kind: 'plugin', name: 'foreman' }, false],
    [{ kind: 'plugin', name: 'foreman', asUser: true }, false],
    [{ kind: 'peer' }, false],
    [{ kind: 'peer-send-message' }, false],
    [{ kind: 'task-notification' }, false],
    [{ kind: 'scheduled-trigger' }, false],
    [{ kind: 'unclassified' }, false],
    [{ kind: 'channel', server: 'x' }, false],
    [{ kind: 'auto-continuation' }, false],
  ]
  for (const [origin, want] of kinds) expect([origin.kind, isPersonPrompt({ text: 'go on', origin })]).toEqual([origin.kind, want])
  expect(isPersonPrompt({ text: 'go on', origin: { kind: 'composer' }, isMeta: true })).toBe(false)
  expect(isPersonPrompt({ text: '<ci-monitor-event kind="failure">checks failed</ci-monitor-event>', origin: { kind: 'sdk' } })).toBe(false)
})

// The wake skill quotes the context line's sentence as a heading and the
// sentence, and the README quotes all four, so they are pinned word for word.
test('the sentence, the context line, the notification and the log line are pinned', () => {
  expect(heldSentence('ABC-123')).toBe('foreman holds ABC-123 and offers it again on the person\'s next message, so do not propose a card for it; tell the person in one line that the desktop app refused to start ABC-123 and that it starts on their next message.')
  expect(heldLine(['ABC-123'])).toBe('foreman: ABC-123 did not start, and foreman holds it; start it first, before anything else, as "Starting a session" says.')
  expect(heldLine(['ABC-1', 'ABC-2'])).toBe('foreman: ABC-1 and ABC-2 did not start, and foreman holds them; start them first, before anything else, as "Starting a session" says.')
  expect(heldLine(['ABC-1', 'ABC-2', 'ABC-3'])).toBe('foreman: ABC-1, ABC-2 and ABC-3 did not start, and foreman holds them; start them first, before anything else, as "Starting a session" says.')
  expect(heldNotice('ABC-123')).toBe('ABC-123 waits to start: the desktop app refused to start it, and it starts on your next message.')
  expect(heldLog('ABC-123')).toBe('Held ABC-123, because the desktop app refused to start it.')
})

// The hold covers a refusal on a turn no person typed as much as the Remote
// Control one, so no text may claim to know where the person is.
test('no hold text says where the person is', () => {
  const texts = [heldSentence('ABC-1'), heldLine(['ABC-1']), heldLine(['ABC-1', 'ABC-2']), heldNotice('ABC-1'), heldLog('ABC-1'),
    beginHeldNotice('ABC-1'), beginHeldLog('ABC-1'), beginFailedNotice('ABC-1')]
  for (const text of texts) expect([text, /remote|away|typed/i.test(text)]).toEqual([text, false])
})
