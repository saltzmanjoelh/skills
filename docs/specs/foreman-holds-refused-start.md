# Foreman holds a start the app refused over Remote Control

Date: 2026-10-21.

## Goal

When a slot frees while the person is working over Remote Control, the
desktop app refuses the parent's `start_session`, and today the slot stays
empty with nothing to bring it back. Foreman should hold the issue the parent
picked, tell the person once, and have the parent start it on the person's
next message, so the slot is filled as soon as the person types in the
desktop app.

The issue preferred a start without the person typing at all. That is not
possible by design. Reading the installed desktop app showed that its start
check looks at the session's current turn, not at who makes the call, and
refuses while the person's last message came from a remote client, so that
the app only starts sessions a person can see and approve. A call from the
mod would meet the same check, and a mod that found a way around it would be
defeating that safety rule.

## Users and trigger

A parent session that ran `/start-foreman`, whose person follows it from a
phone or the web over Remote Control. A sub session finishes, foreman wakes
the parent with its slot-free line, the parent's model picks the next issue
by the wake skill, and the app refuses the start with its Remote Control
refusal, which reads: "The user is working over Remote Control, and for now
you can start a session only on a message typed in the desktop app. If they
asked for one, tell them so in one line."

## Behavior

1. **Holding.** Foreman's existing `tool.call` hook on `start_session` sees
   the app's answer. When the answer is a refusal whose text contains the
   app's words `working over Remote Control`, and the call's title begins
   with an issue key followed by a space or a colon, foreman adds that key to
   a list of held keys in its ledger, which survives reloads. The phrase lives
   in one named constant, with a comment quoting the app's whole refusal.
2. **Telling the model.** The same hook adds one sentence to that refusal,
   saying that foreman holds the key and offers it again on the person's next
   message, that the model should not propose a card for it, and that it
   should tell the person in one line that the issue starts on their next
   message typed in the desktop app.
3. **Telling the person.** When a key is newly held, foreman raises one
   native notification through its existing notify path, naming the key and
   saying that a message typed in the desktop app starts it. A key that is
   already held and is refused again raises no second notification. The
   foreman log records each hold.
4. **Offering it again.** While any key is held and foreman is on, the
   `prompt.submit` hook adds one context line to every prompt from the
   person, naming the held keys and telling the model to start them first, by
   the wake skill's "Starting a session", before anything else. A prompt from
   the person is one whose origin is the person's own: typed in the desktop
   app (which reaches the session as an SDK prompt), at a terminal, or
   through the Remote Control bridge. Prompts that a plugin submitted,
   foreman's own wake lines among them, and messages from other sessions,
   background tasks and schedules get no line. The line is built only from
   the held keys, each of which has the shape of an issue key, so no text from
   a status file or a message reaches it.
5. **Starting it.** The model starts each held key as "Starting a session"
   says, with its duplicate check first. On a message typed in the desktop
   app the app allows the start. On a message from the phone the app refuses
   again, and the key stays held with no new notification.
6. **Releasing.** A key stops being held on any sign that it started: a
   `start_session` call for that key that the app accepts, seen by the start
   hook; a read of the desktop app's list of sessions that shows a session
   whose `isRunning` is exactly true, which is not archived, and whose title
   begins with that exact key followed by a space or a colon; or the person
   turning foreman off. Foreman reads the list for this only while a key is
   held, as part of its periodic read, and logs each release.
7. **The wake skill.** Its "Starting a session" step 3 says that a refusal to
   which foreman added its holding sentence goes to no card, and the model
   says the one line instead. A new section, headed with the context line's
   sentence, says what to do with it.

## Edge cases

- Two slots free and both starts are refused: both keys are held, the person
  gets one notification for each, and the context line names both.
- The person's next message comes from the phone: the start is refused again
  and the key stays held, without a second notification.
- The person starts the held issue by hand: the duplicate check skips it, no
  start reaches the hook, and the next periodic read finds the running
  session in the list and releases the key.
- A neighbouring key, such as `ABC-1234` for a held `ABC-123`: it does not
  release the hold, because the title must have a space or a colon right
  after the key.
- A list entry whose running flag is missing or not a boolean, or which is
  archived, releases nothing. A list that cannot be read releases nothing.
- The app rewords its refusal: foreman no longer recognises it and holds
  nothing, and the parent falls back to today's card and one line.
- A freed slot picks the held key again: the start is refused again, and the
  key is already held, so nothing new is raised.

## Non-goals

- No start made by the mod itself, through `$.mcp.call` or otherwise.
- No hold for any other refusal by the app, such as an unattended session, a
  disabled feature, the limit of starts since the person's last message, or a
  session in another folder.
- No hold for a `No issue: ` start, which has no key to release it by.
- No attempt to tell a message typed at the desk from one sent from the
  phone, because a mod cannot see the difference.
- No new row for a held key in the pane or the band; the log, the
  notification and the context line are the only places it shows.
- No timer that retries a held start, and no expiry that drops one.
- No change to the builder mod or to how slots are counted.

## Failure modes

- A notification that cannot be raised is logged, as notifications are today,
  and the hold stands.
- A failure in the start hook after the call ran leaves the app's answer as
  it came, as the hook does today, so the model still reads the refusal.
- A failure in the prompt hook passes the prompt on as it came, without the
  context line.

## Verification

Tests in `mods/foreman/tests`, through the fake desktop app in
`tests/world.ts`:

- The app's exact Remote Control refusal on a keyed title holds the key, adds
  the sentence to the refusal, raises one notification and logs it; a
  refusal in other words holds nothing and changes nothing.
- A second refusal for a held key raises no second notification.
- A `No issue: ` title refused over Remote Control holds nothing.
- While a key is held, a prompt from the person (SDK, terminal or bridge)
  carries the context line naming it, and a plugin's prompt, foreman's wake
  among them, does not; with nothing held, no prompt gets the line.
- An accepted start for the key releases it; a list read with a running,
  unarchived session titled with the key releases it; a neighbouring key, an
  archived entry, an entry with a doubtful running flag and an unreadable
  list release nothing; turning foreman off releases every key.
- The context line's sentence is pinned by a test and quoted in the wake
  skill, as the other wake sentences are.

All four gates in `CLAUDE.md` pass. They do not read the wake skill's text,
so its change is checked by review alone.

## Decided by the counsel

- When the desktop app refuses foreman's start_session because the person is working over Remote Control, should foreman also try to start the session itself through $.mcp.call, or only hold the start and make it on the person's next message? The counsel chose: Hold only: foreman never calls start_session itself; it holds the picked issue, tells the person once, and the parent's model starts it on the person's next message, where the app's normal checks and approval apply. 7 of 7 members voted for it.
- While foreman holds an issue whose start the app refused over Remote Control, how should the held start reach the parent's model when the person next writes? The counsel chose: Context on every message from the person: while anything is held, foreman's prompt.submit hook adds one context line to each prompt from the person, naming the held issue keys and telling the model to start them first by the wake skill's Starting a session; a start refused again over Remote Control simply stays held. 7 of 7 members voted for it.
- When should foreman stop holding an issue whose start the app refused over Remote Control? The counsel chose: On any sign it started: a start_session call for that key that the app accepts (seen by foreman's start hook), or a read of the desktop app's list of sessions that shows a running session whose title begins with that key, or the person turning foreman off. 7 of 7 members voted for it.
- Which refusals of start_session should make foreman hold the issue, and how should foreman tell the model and the person? The counsel chose: Only the Remote Control refusal, recognised by the app's own words "working over Remote Control" in the refusal; foreman's start hook adds one sentence to that refusal telling the model foreman holds the issue (so it skips the card and says one line), and raises one native notification per newly held key. 7 of 7 members voted for it.
- What should this change deliberately leave out? The counsel chose: Narrow: hold only starts whose title begins with an issue key (not "No issue:" starts); show the hold only in foreman's log, the notification and the context line, not as a new row in the pane or band; no timer that retries; no attempt to tell a desk message from a phone message; no start made by the mod itself. 7 of 7 members voted for it.
