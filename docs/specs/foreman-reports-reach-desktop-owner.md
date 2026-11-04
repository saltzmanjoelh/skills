# Foreman's reports reach the owner when a notification cannot be raised

Written 2026-11-04. Seeded from an issue in the owner's tracker. The rules of
`docs/specs/foreman-reports-and-checks-itself.md` stay in force except where
this spec changes them. The questions the issue left open were put to the
counsel.

## Goal

On 2026-11-04 every native notification that a foreman parent raised in the
desktop app failed. Each failure logged "Could not raise a notification
(no-surface): …". The failures covered pull requests opened, verdicts,
merges, and issues held after the app refused their start. The owner saw none
of them as a notification, and the band dropped each report after ten
minutes, so foreman's reports were effectively silent. Each failed report
also took two lines of the pane's twenty-line log: the report itself, and the
failure line repeating it.

The cause is the engine, not foreman. The engine's types for `$.ui.notify`
say that it raises a notification by writing a terminal's own notification
sequence (iTerm2, kitty, Ghostty or the bell), and that it answers
`no-surface` when there is "no terminal (a `-p` run, the SDK, the desktop)".
The desktop app has no terminal, so `$.ui.notify` fails there every time, and
the engine gives a mod no other way to raise a native notification in it.
Claude Code's `PushNotification` tool is no substitute: called from a desktop
session it answered "Mobile push not sent (Remote Control inactive)", so it
reaches only a phone, and only while Remote Control is connected. A desktop
session also showed `$.session.surfaces()` empty, through the builder pane's
own answer that it waits because no surface is attached.

So foreman cannot make the desktop app raise a notification. This change
makes sure a report it could not deliver still reaches the owner, by keeping
it in the band until the owner next types, and it logs one line per report.

## Users/Trigger

The owner, running foreman in a parent session in the desktop app, away from
it while sub sessions open pull requests, get verdicts, merge, or need them.
It applies whenever `$.ui.notify` does not send a notification, for any
reason, in any host. In a terminal whose notification channel works, nothing
changes.

## Behavior

1. **Which notices the band keeps.** The band keeps a notice whose
   notification failed when it is one of these: a report sentence that
   `showReports` raises (a pull request opened, its verdict pair, merged,
   closed, and foreman began a queued issue), a sub session that needs the
   person, an issue held because the desktop app refused its start, and an
   issue held because foreman could not begin its waiting session. It does
   not keep the failures of foreman's own work: the begin message that could
   not be sent, the session list that cannot be read, and the checks foreman
   could not make. Those stay in the log alone, as today.
2. **What failed means.** A notification failed when `$.ui.notify` answers
   `isSent: false` with any reason, when it does not answer within foreman's
   call time limit, or when it throws.
3. **How long the band keeps it.** A kept notice stays in the band, however
   old it is, until the person next sends a message they typed in the parent,
   as `isPersonPrompt` in `hooks/held.ts` tells one. From that message the
   band shows it for ten more minutes (`REPORT_SHOWN_MS`) and then drops it,
   as it drops a report today. A prompt that a mod, a peer session, the app's
   wake or a CI event sends does not count.
4. **Several kept notices.** The band shows only the newest. When more than
   one notice was kept since the person last typed, it follows the newest
   with the count of the others, as in "ABC-1 merged. (2 more since your last
   message.)". A single kept notice reads as the sentence alone, exactly as a
   report reads today. A narrow band cuts the end of the line as it does
   today, so the count is cut before the sentence.
5. **A notice that arrives while others are kept.** It becomes the newest
   and adds one to the count, whether its own notification went or not, and
   whether or not it is one the band keeps on failure, as long as it is a
   report sentence or one of the notices in point 1. So the count never
   loses a kept notice to a later one that was delivered.
6. **One log line per notice.** A failed notification whose text another log
   line already holds writes no line of its own. That covers the report
   sentences, which `showReports` logs, and the held, begin-held and
   begin-failed notices, which already have their own lines; these three are
   raised as quiet notifications from now on. A notice whose text is in no
   other line, which is the sub session that needs the person, keeps its
   single line: "Raised a notification: …" when it went, and "Could not
   raise a notification (<reason>): …" when it did not.
7. **The reason, once per load.** The first failure for each reason since
   the mod loaded writes one line, naming the reason and the surfaces
   `$.session.surfaces()` gives at that moment, and saying that the band
   keeps reports until the person types: "Could not raise notifications
   (no-surface; surfaces attached: desktop), so the band keeps each report
   until your next message." With no surface attached it says "none". A call
   that timed out and a call that threw each count as a reason of their own,
   so one never hides the other. The record of which reasons were logged is
   kept in memory for the load only, so a reload logs the reason again.
8. **Successful notifications.** A notification that went changes nothing
   from today: a report still shows in the band for ten minutes, and the
   notices outside `showReports` still do not appear in the band.

## Edge cases

- Several report sentences raised together in one notification that fails
  count as that many kept notices, and the band shows the newest of them.
- The person types while nothing is kept: nothing changes.
- The person types while a kept notice shows: its ten minutes start then,
  and a notice that arrives after that message starts a new count from one.
- A restart of the parent drops the band's report and its count, as today,
  because they live in `$.state` and not in the ledger. The pane's log, which
  survives a restart, still holds every report sentence.
- Foreman off: the band shows no report, as today. A kept notice is shown
  again if foreman is turned on before the person types.
- A failure reason the engine adds later, outside today's closed set of
  `disabled`, `no-channel`, `no-surface` and `refused`, is logged once like
  any other and keeps the notice in the band.

## Non-goals

- Raising a native notification in the desktop app. The engine has no route
  for it, so this change does not try. A later engine route would make the
  band's fallback unnecessary there, and that is for its own issue.
- Any other channel: no phone push through `PushNotification`, no unread
  mark in the desktop app's sidebar, and no wake of the parent's model.
- Keeping the band's kept notice across a restart of the parent.
- Any change to the engine, to the owner's notification settings, or to the
  desktop app's own notification permission.
- The pane's wider redesign that another issue asks for. This change only
  removes the duplicate log line, which that issue also asks for.
- Changing the begin-failed, list-failed and failed-checks notices beyond
  their log lines; they still raise a notification as before.

## Failure modes

- `$.session.surfaces()` rejects or times out when the reason line is
  written: the line says the surfaces are unknown, and the notice is still
  kept.
- The band's state cannot be written: the notice is lost from the band, as a
  report is today when that write fails, and the log still holds it.
- The prompt hook fails to clear the count: the kept notice stays up longer
  than meant, which is the safe side; it never hides a notice early.

## Verification

Each point is checked by a test in `mods/foreman/tests`, through the same
fake engine the existing tests use:

- A report whose notification fails with `no-surface` is still in the band
  after ten minutes and more, and is gone ten minutes after the person's
  next typed message, and not before.
- A prompt from a mod, a peer session or the app's wake does not clear it.
- Three failed reports show the newest followed by "(2 more since your last
  message.)", and a single one shows the sentence alone.
- A failed needs-you notice and a failed held notice are kept in the band; a
  failed begin-failed, list-failed and failed-checks notice are not.
- A failed report adds exactly one log line, its sentence; a failed held
  notice adds only its "Held …" line; a failed needs-you notice adds one
  "Could not raise a notification (no-surface): …" line.
- The first `no-surface` failure of a load adds one reason line naming the
  surfaces, a second adds none, and a timed-out call after it adds its own.
- A notification that goes leaves today's behaviour: ten minutes in the
  band, "Raised a notification: …" for the needs-you notice.

The gates cannot run the desktop app. In a real desktop parent the first
failed report after this change logs the reason line with the surfaces
attached, which records what no test here can.

## Decided by the counsel

- The engine's $.ui.notify can never raise a notification in the desktop app (it only writes a terminal's notification sequence, and its types list "the desktop" under no-surface). When a notification fails, how should foreman make sure the report still reaches the owner? The counsel chose: Keep the failed report in the band past its usual ten minutes, until the person next types a message in the parent; then it stays ten more minutes and expires as today. When several reports were kept, the band shows the newest and how many came since the person last typed. 7 of 7 members voted for it.
- Today a report sentence is logged once, and then the failed notification that carries it logs a second line repeating the text ("Could not raise a notification (no-surface): ..."). The held, begin-held and begin-failed notices also have a log line of their own beside the notification's line. How should foreman log a notification that fails, so each report gives one line? The counsel chose: A failed notification whose text another log line already holds writes no line of its own. Once per load, the first failure for each reason writes one line naming the reason and the surfaces attached, and saying that the band keeps reports until the person types. A notification whose text is in no other line, such as a sub session that needs the person, keeps its single line. 7 of 7 members voted for it.
- When a notification fails, which ones should the band keep until the person next types? The counsel chose: The report sentences and the notices that ask something of the person (a sub session that needs them, an issue held until their next message), but not the failures of foreman's own reads and checks. 4 of 7 members voted for it.
- What does this change deliberately leave out? The counsel chose: Leave out keeping the band's kept report across a restart (it stays in $.state, which a restart drops, as today), any other channel such as a phone push or the desktop sidebar's unread mark, and any change to the engine. Note in the spec that the engine has no notification route in the desktop app. 7 of 7 members voted for it.
- When the band keeps more than one report since the person last typed, how should its line read? The counsel chose: The newest first, then the count: "ABC-1 merged. (2 more since your last message.)" 5 of 7 members voted for it.
