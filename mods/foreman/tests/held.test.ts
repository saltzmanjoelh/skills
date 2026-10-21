import { expect, test } from 'claude-code/testing'
import type { PromptOrigin, ToolCallResult } from 'claude-code'

import type { Listed } from '../hooks/desktop'
import { heldLine, heldNotice, heldSentence, isPersonPrompt, isRemoteRefusal, keyOfTitle, releasedBy, REMOTE_REFUSAL } from '../hooks/held'

// The desktop app's refusal of start_session while the person works over
// Remote Control, word for word.
const REFUSAL = 'The user is working over Remote Control, and for now you can start a session only on a message typed in the desktop app. If they asked for one, tell them so in one line.'

// A session as the desktop app's list gives it, with `over` changing its
// fields.
const listed = (over: Partial<Listed> = {}): Listed => ({ sessionId: 'local_a', isArchived: false, isRunning: true, title: 'ABC-123: short', archivedSure: true, ...over })

test('a title gives the issue key at its start only when a space or a colon follows the key', () => {
  expect(keyOfTitle('ABC-123: x')).toBe('ABC-123')
  expect(keyOfTitle('ABC-123 x')).toBe('ABC-123')
  expect(keyOfTitle('No issue: x')).toBeNull()
  expect(keyOfTitle(undefined)).toBeNull()
  expect(keyOfTitle(7)).toBeNull()
  expect(keyOfTitle('ABC-1234')).toBeNull()
  expect(keyOfTitle('ABC-123-fix: x')).toBeNull()
})

test('only an answer whose text holds the app\'s Remote Control words is the refusal, error or not, and a deny never is', () => {
  expect(REFUSAL).toContain(REMOTE_REFUSAL)
  expect(isRemoteRefusal({ result: REFUSAL, text: REFUSAL })).toBe(true)
  expect(isRemoteRefusal({ isError: true, result: REFUSAL, text: REFUSAL })).toBe(true)
  expect(isRemoteRefusal({ result: { content: [{ type: 'text', text: REFUSAL }] } } as ToolCallResult)).toBe(true)
  const reworded = 'The user is on their phone, so you can start a session only from the desktop app.'
  expect(isRemoteRefusal({ isError: true, result: reworded, text: reworded })).toBe(false)
  expect(isRemoteRefusal({ deny: REFUSAL })).toBe(false)
  expect(isRemoteRefusal({ result: undefined } as ToolCallResult)).toBe(false)
  expect(isRemoteRefusal({ result: 'Started the session local_new1.', text: 'Started the session local_new1.' })).toBe(false)
})

test('the words in the call\'s own title, or in an answer that names a started session, are not the refusal', () => {
  const title = 'ABC-123: keep working over Remote Control'
  const started = `Started session "${title}" (session_id: local_new1, name: example)`
  expect(isRemoteRefusal({ result: started, text: started }, title)).toBe(false)
  const echoed = `Proposed "${title}" as a card.`
  expect(isRemoteRefusal({ result: echoed, text: echoed }, title)).toBe(false)
  expect(isRemoteRefusal({ result: `${REFUSAL} local_x`, text: `${REFUSAL} local_x` })).toBe(false)
  expect(isRemoteRefusal({ isError: true, result: REFUSAL, text: REFUSAL }, title)).toBe(true)
})

test('a list read releases a held key only for an unarchived entry whose title begins with exactly that key, whether or not a turn runs', () => {
  expect(releasedBy(['ABC-123'], [listed()])).toEqual({ held: [], logs: ['Stopped holding ABC-123, because the desktop app\'s list shows a session for it.'] })
  expect(releasedBy(['ABC-123'], [listed({ isRunning: false, title: 'ABC-123 short' })]).held).toEqual([])
  expect(releasedBy(['ABC-123', 'ABC-9'], [listed()])).toEqual({ held: ['ABC-9'], logs: ['Stopped holding ABC-123, because the desktop app\'s list shows a session for it.'] })
  const none = { held: ['ABC-123'], logs: [] }
  expect(releasedBy(['ABC-123'], [listed({ title: 'ABC-1234: short' })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ title: 'Implement ABC-123: short' })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ isArchived: true, archivedSure: false })])).toEqual(none)
  expect(releasedBy(['ABC-123'], [listed({ archivedSure: false })])).toEqual(none)
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

// The wake skill quotes the context line's sentence as a heading, and the
// README quotes all three, so they are pinned word for word.
test('the sentence, the context line and the notification are pinned', () => {
  expect(heldSentence('ABC-123')).toBe('foreman holds ABC-123 and offers it again on the person\'s next message, so do not propose a card for it; tell the person in one line that ABC-123 starts on their next message typed in the desktop app.')
  expect(heldLine(['ABC-123'])).toBe('foreman: the desktop app refused to start ABC-123 over Remote Control, and foreman holds it; start it first, before anything else, as "Starting a session" says.')
  expect(heldLine(['ABC-1', 'ABC-2'])).toBe('foreman: the desktop app refused to start ABC-1 and ABC-2 over Remote Control, and foreman holds them; start them first, before anything else, as "Starting a session" says.')
  expect(heldLine(['ABC-1', 'ABC-2', 'ABC-3'])).toBe('foreman: the desktop app refused to start ABC-1, ABC-2 and ABC-3 over Remote Control, and foreman holds them; start them first, before anything else, as "Starting a session" says.')
  expect(heldNotice('ABC-123')).toBe('ABC-123 waits to start: the desktop app starts sessions over Remote Control only on a message typed in the desktop app, so type one there to start it.')
})
