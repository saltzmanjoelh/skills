// Holding a start the desktop app refused because the person works over
// Remote Control: which refusal counts, which key a start is for, the words
// the model and the person read, which list entries release a hold, and which
// prompts are the person's. register.tsx wires these into its hooks. Every
// function is pure.
//
// The skill at skills/wake/SKILL.md uses heldLine's sentence as a heading and
// quotes heldSentence, and the README quotes all three texts, so they are
// pinned by tests/held.test.ts. Change them together.

import type { PromptSubmitInput, ToolCallResult } from 'claude-code'

import type { Listed } from './desktop'
import { listOf } from './text'
import { KEYED_TITLE, LOCAL_ID } from './tickets'

// The words foreman recognises the refusal by. The desktop app refuses
// start_session with: "The user is working over Remote Control, and for now
// you can start a session only on a message typed in the desktop app. If they
// asked for one, tell them so in one line." A refusal in other words holds
// nothing, so the parent falls back to its card and its one line.
export const REMOTE_REFUSAL = 'working over Remote Control'

// The issue key at the start of a title, when a space or a colon follows it,
// or null for any other title, a "No issue: " one included.
export function keyOfTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null
  return KEYED_TITLE.exec(title)?.[1] ?? null
}

// Whether a start_session answer is the app's Remote Control refusal: not a
// deny, naming no started session, with the words in its text, or in its
// result when it has no text, whether or not it is marked as an error. The
// app repeats the call's `title` in its answers, so the words count only
// outside that title, and a title of the person's own that holds them never
// makes an accepted start look refused.
export function isRemoteRefusal(out: ToolCallResult, title?: unknown): boolean {
  if (out.deny !== undefined) return false
  const text = typeof out.text === 'string' ? out.text : JSON.stringify(out.result ?? '')
  if (LOCAL_ID.test(text)) return false
  const rest = typeof title === 'string' && title !== '' ? text.split(title).join('') : text
  return rest.includes(REMOTE_REFUSAL)
}

// The sentence added after the refusal, as context the model reads with it.
export const heldSentence = (key: string) => `foreman holds ${key} and offers it again on the person's next message, so do not propose a card for it; tell the person in one line that ${key} starts on their next message typed in the desktop app.`

// The context line added to each of the person's prompts while keys are held.
export function heldLine(keys: readonly string[]): string {
  const them = keys.length === 1 ? 'it' : 'them'
  return `foreman: the desktop app refused to start ${listOf(keys)} over Remote Control, and foreman holds ${them}; start ${them} first, before anything else, as "Starting a session" says.`
}

// The notification raised once when a key is newly held.
export const heldNotice = (key: string) => `${key} waits to start: the desktop app starts sessions over Remote Control only on a message typed in the desktop app, so type one there to start it.`

// The log line for each hold and each release.
export const heldLog = (key: string) => `Held ${key}, because the desktop app refused to start it over Remote Control.`
export const acceptedLog = (key: string) => `Stopped holding ${key}, because the desktop app accepted its start.`
const listedLog = (key: string) => `Stopped holding ${key}, because the desktop app's list shows a session for it.`

// The held keys left after a read of the desktop app's list, with a log line
// for each key released. A key is released by an entry whose archived flag
// was exactly false and whose title begins with exactly that key, followed by
// a space or a colon. Whether a turn runs in it does not matter, because a
// started session is idle between turns.
export function releasedBy(held: readonly string[], sessions: readonly Listed[]): { held: string[]; logs: string[] } {
  const shown = new Set(sessions.flatMap(s => (s.surelyUnarchived ? [keyOfTitle(s.title)] : [])))
  const logs: string[] = []
  const kept = held.filter(key => {
    if (!shown.has(key)) return true
    logs.push(listedLog(key))
    return false
  })
  return { held: kept, logs }
}

// Whether a prompt is the person's own: typed at a terminal, sent through the
// Remote Control bridge, or arrived from the SDK, which is how a prompt typed
// in the desktop app arrives, unless it is the app's CI event, as builder
// decides. A prompt the person does not see as typed, a plugin's prompt,
// foreman's wake lines among them, and every other origin are not.
export function isPersonPrompt(e: Pick<PromptSubmitInput, 'text' | 'origin' | 'isMeta'>): boolean {
  if (e.isMeta === true) return false
  if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') return true
  return e.origin.kind === 'sdk' && !/<ci-monitor-event\b/.test(e.text)
}
