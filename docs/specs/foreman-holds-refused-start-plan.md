# Plan: foreman holds a start the app refused over Remote Control

Date: 2026-10-21. Spec: `foreman-holds-refused-start.md`.

## Chosen approach

The most-robust plan won, trimmed. The rules live in pure functions in one
new module, `mods/foreman/hooks/held.ts`, and `register.tsx` only wires them
into the hooks it already has. The held keys are a field of the ledger, so
they are saved and restored with it, and the notification and log lines go
into the ledger's outbox in the same update that adds a hold, so a hot reload
or two callers raise the notification once.

## Grafts

- From the simplest plan: the `pass` branch of `startSession`, a keyed start
  with no brief, goes through the same after-call step as a start with a
  brief, so its refusal is held too. Today it returns `next(e)` unread.
- From the simplest plan: no cap on the held list and no clearing in
  `becomeParent`. A cap would be an expiry, which the spec rules out, and
  foreman has no off command, so clearing on a fresh turn-on is dead code.
- From the most-extensible plan: a prompt whose text is a `<ci-monitor-event`
  is not the person's, although it arrives as an SDK prompt, as builder
  already decides.
- From the most-extensible plan: the comment above `choiceFor`, which says a
  typed prompt never waits on a read, is updated, because the hold check
  reads the ledger.
- From the most-extensible plan: the log line for a failed list read stops
  saying "so no slot was freed" when the read was only for holds.

## Rejected alternatives

- A start made by the mod through `$.mcp.call`: the counsel ruled it out,
  because the app's check is on the turn, and getting around it would defeat
  a safety rule.
- Held entries as `{ key, since }` objects: the time feeds only an expiry,
  which the spec rules out, so it is state nothing reads.
- The context line as a new wake reason in `wake.ts`: it is not a wake line,
  and tying it to wake lines invites it being sent or sorted like one.
- Putting the holding sentence into the answer's text, or answering with a
  `deny`: core sets `text` itself, and a `deny` after the tool ran makes the
  model read that a plugin withheld the result. The sentence goes in the
  answer's `context`, which the engine documents as what the model reads
  after the tool's result.
- Keeping a hold after an accepted proposal card: every later prompt would
  ask for the same start again and make duplicate cards.
- Requiring the list's `isRunning` to be true for a release: the field says
  whether a turn runs, and is false for a started session that is idle.

## Step sequence

1. **`held.ts`** with tests first in `tests/held.test.ts`:
   - `REMOTE_REFUSAL = 'working over Remote Control'`, with a comment quoting
     the app's whole refusal.
   - `keyOfTitle(title: unknown): string | null`, the key at the start of a
     title followed by a space or a colon, using `KEYED_TITLE` from
     `tickets.ts` with a capture group.
   - `isRemoteRefusal(out)`: true when the answer is not a `deny` and its
     text, or the JSON of its result when it has no text, contains the
     phrase, whether or not `isError` is set.
   - `heldSentence(key)`, `heldLine(keys)` and `heldNotice(key)`.
   - `releasedBy(held, sessions)`: the held keys left after a list read,
     dropping a key when an entry has `isArchived === false` and a title for
     which `keyOfTitle` gives exactly that key, with a log line for each.
   - `isPersonPrompt(e)`: true for origin kinds `composer`, `bridge` and
     `sdk`, false when `isMeta` is set or the text is a `<ci-monitor-event`.
2. **The ledger.** `types/index.d.ts` gains `held: string[]` on
   `ForemanTickets`; `TICKETS_EMPTY` gets `held: []`; `ticketsIn` keeps only
   strings of the key shape, without repeats, so an old ledger reads as no
   holds. `session.start`'s restore guard also requires `held` to be empty.
3. **The list.** `Listed` in `desktop.ts` gains `title: string | null` and
   `surelyUnarchived: boolean`, true only when `isArchived === false`; the
   existing flags keep their readings for the slot rules. `needsList` is also
   true while a key is held, and `decide` applies `releasedBy` when the list
   was read, so a release and its log line are written with the ledger. A
   failed list releases nothing.
4. **The start hook.** `startSession` sends both the `add` and `pass` kinds
   through one after-call step. On `isRemoteRefusal` with a key from the
   call's own title: in one `writeTickets` update, add the key if it is new,
   and only then queue the hold's log line and one notify effect; pair no
   ticket; call `later($, () => carryOut($))`; return the answer with
   `heldSentence(key)` added to its `context`. On an accepted answer with a
   key: pair as today, and release the key in the same update with its log
   line. Everything stays inside the existing `try`, so a failure returns the
   app's answer as it came.
5. **The prompt hook.** On the `pass` choice only, while the role is on, keys
   are held and `isPersonPrompt(e)` holds, pass the prompt on with
   `heldLine(held)` added to its `context`. The `.catch` still passes the
   prompt on as it came.
6. **The wake skill and the README.** Step 3 of "Starting a session": a
   refusal with foreman's holding sentence gets no card, the model says the
   one line, and the refusal does not send later starts straight to a card.
   Step 1: a key foreman holds is not skipped for having been named in a
   "start it" line. A new section headed with `heldLine`'s sentence says to
   start each held key first, with the duplicate check, and that a refusal
   over Remote Control leaves it held. The README lists the hold, the context
   line and the notification.

## Wording

- Added after the refusal: `foreman holds ABC-123 and offers it again on the
  person's next message, so do not propose a card for it; tell the person in
  one line that ABC-123 starts on their next message typed in the desktop
  app.`
- The context line: `foreman: the desktop app refused to start ABC-123 over
  Remote Control, and foreman holds it; start it first, before anything
  else, as "Starting a session" says.` With several keys, they are joined
  with commas and "and", and it reads "start them first".
- The notification: `ABC-123 waits to start: the desktop app starts sessions
  over Remote Control only on a message typed in the desktop app, so type one
  there to start it.`
- Log lines: `Held ABC-123, because the desktop app refused to start it over
  Remote Control.`, `Stopped holding ABC-123, because the desktop app
  accepted its start.` and `Stopped holding ABC-123, because the desktop
  app's list shows a session for it.`

## Test plan

Mapped to the spec's Verification section.

- `tests/held.test.ts`: `keyOfTitle` on `ABC-123: x`, `ABC-123 x`,
  `No issue: x`, a missing title and `ABC-1234`; `isRemoteRefusal` on the
  app's exact refusal, a reworded one, a `deny` and a result with no text;
  `releasedBy` for an unarchived exact match whether or not a turn runs, a
  neighbouring key, an archived entry, a missing archived flag and a missing
  title; `isPersonPrompt` for every origin kind, `isMeta` and a
  `<ci-monitor-event`; `heldLine` pinned for one and two keys.
- `tests/acts.test.ts`, through `world.ts`: the exact refusal on a keyed
  title holds the key, adds the sentence as context, raises one notification,
  logs it and pairs no ticket; a reworded refusal leaves the answer, the
  ledger and the notifications unchanged; a second refusal raises no second
  notification; a `No issue: ` title holds nothing; a start without a brief
  is held; an accepted start and an accepted card release the key; a list
  read releases a key and an unreadable list releases nothing; the list is
  read while a key is held.
- `tests/turn-end.test.ts` or `tests/register.test.ts`: prompts of origin
  `sdk`, `composer` and `bridge` carry the line; a plugin prompt, foreman's
  wake among them, and peer, task and schedule prompts do not; with nothing
  held, none does; the app's notes keep their own handling.
- `tests/tickets.test.ts`: an old ledger reads `held: []`, and entries
  without the key shape or repeated are dropped.
- `tests/desktop.test.ts`: the new `title` and `surelyUnarchived` fields.
- `world.ts` gains a `title` on its sessions and records the context the
  start hook and the prompt hook pass on.
- All four gates in `CLAUDE.md`. The wake skill and README are read by
  review alone.
