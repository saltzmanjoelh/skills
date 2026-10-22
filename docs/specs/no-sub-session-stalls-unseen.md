# No sub session stalls without someone being told

Date: 2026-10-22.

## Goal

A parent session ran three `/implement` sub sessions and two of them sat
stuck for 25 and 45 minutes without anyone being told. Four separate things
let that happen:

1. The person's `/start-foreman` reached the parent as pasted text, so the
   command never ran and the foreman role stayed off. The parent's model
   acted as if foreman were on, started the sub sessions without tickets, and
   builder therefore wrote no status files for foreman to read.
2. Builder reports a session as `working` whenever any background task is in
   flight, and foreman never nudges or wakes for a working session, so a
   background test run that hangs reads as healthy work for ever.
3. The parent answers each turn-end note with "Noted.", so when a sub
   session's last note says it is waiting on something and no further note
   ever comes, silence looks the same as steady work.
4. A failed user interface test hung inside the test tool's collection of
   diagnostics, so the background command never exited.

The goal of both mods is that a sub session never sits stuck without someone
being told. This change closes all four gaps, each with its own guard, so
that no single failure can hide a stall again.

## Users and trigger

The person runs a parent session with foreman, which starts `/implement` sub
sessions; each sub session runs builder. The triggers are: a person's prompt
that holds `/start-foreman` as text while the role is off; a `start_session`
call whose brief runs `/implement`; a sub session whose only running work is
background tasks; a turn-end note about a sub session foreman holds no record
of; a ticketed sub session that never writes a status file; and any command a
`/implement` session starts in the background.

## Behavior

### The role cannot silently be off

1. **Pasted command.** Foreman's `prompt.submit` hook looks at every prompt
   from the person (as `isPersonPrompt` decides) while the role is off. When
   the text has a line that begins, after optional white space, with
   `/start-foreman` followed by white space or the end of the line, the hook
   adds one context line saying that the text holds `/start-foreman` but the
   command did not run, so foreman is off in this session; that the model
   should tell the person so in one line and ask them to type
   `/start-foreman` themselves; and that it should start no sub session until
   they have. The line repeats none of the pasted count or words, changes no
   stored state, and never turns the role on. A line counts as beginning with
   the command when it directly follows an opening tag that wraps pasted
   text, such as `<pasted_content …>`, too. A typed `/start-foreman` runs
   through `command.run` and gets no such line. While the role is on, no such
   line is added.
2. **First `/implement` start while off.** Foreman's `tool.call` hook on
   `start_session`, while the role is off, refuses the first call in the
   session whose brief runs `/implement` (the brief holds `/implement` as a
   word). The refusal begins `foreman: ` and says that foreman is off in this
   session, so the sub session would get no ticket and nobody would watch it;
   that the model should tell the person in one line and wait for their
   answer before calling again; that the person can type `/start-foreman` to
   have it watched; and that if the person wants it started without foreman,
   calling `start_session` again starts it. That the refusal was given is
   kept per session in foreman's store, so it survives a reload, and every
   later `/implement` start in that session while the role is off passes.
   The refusal is keyed on the session, not on the call's arguments, so a
   reworded brief is not refused again.
3. **An unwatched start that passes.** Every `/implement` start that passes
   while the role is off gets one context sentence on its answer saying the
   sub session has no ticket and foreman does not watch it. Foreman keeps the
   `local_…` id the answer names in a list of unwatched sub sessions, in its
   store under the session's id.
4. **The wake skill.** `foreman:wake` gains a section for the refusal in
   point 2: tell the person in one line that foreman is off and ask whether
   to type `/start-foreman` or start without foreman, start nothing until
   they answer, and call again only when they say to start without foreman.
   This is a second exception to "a refused call is final for this wake",
   beside the title refusal.

### A start without a ticket is visible while the role is on

5. **The hook failed before the ticket.** When foreman's `start_session` hook
   throws before the call went on, the call still goes on as it came, as
   today, and foreman now also writes a log line and adds a context sentence
   to the answer saying the sub session has no ticket and foreman does not
   watch it. A failure after the call went on adds nothing, because that
   call carried its ticket. Writing the line and the sentence never throws
   out of the fallback.
6. **A ticket that never shows up.** When an active pairing has a desktop
   session id (`localId`) and still has no owner `GONE_MS` (five minutes)
   after it was paired, and this read listed a status folder that exists,
   foreman wakes the parent once. When no status file carries the ticket, the
   sentence is `<who> has written no status file <n> minutes after it
   started, so foreman cannot watch it.` When a file carries the ticket but
   names another desktop session or none, so foreman cannot join it to the
   pairing, the sentence is `<who>'s status file names another desktop
   session or none, so foreman cannot watch it.` The pairing records that it
   woke, in its `acts`, in the same ledger write, so later reads do not wake
   again. A pairing with no `localId`, from a proposal card that may never
   have started, is left out. The pairing takes the issue key from the start's
   title, so the sentence names a key the parent can find. The wake skill's
   section for these sentences finds the session, reads at most its last six
   events, and tells the person in one line whether it seems not to run
   `/implement`, not to have builder loaded, or to run outside the desktop
   app.

### A working episode has a ceiling

7. **Builder's record.** When the session's turn is not running, no agent is
   running, no tool call of its own is running, and at least one background
   task is in flight, builder adds an optional field to the status record,
   `backgroundOnly: { since, tasks }`. The state stays `working`.
   - `since` is when this background-only wait began. Builder keeps it in its
     memo together with the ids of the tasks in the wait, and keeps it across
     a turn of the session's own (such as the answer to a nudge) as long as
     at least one of those task ids is still in flight. When none is, the
     next background-only wait begins afresh.
   - `tasks` holds the descriptions of at most three of the tasks, never their
     commands, each cleaned of control characters, cut to 80 characters, and
     replaced by the withheld text when it looks like a secret before or after
     cleaning, as the cleanup record's error line is.
   - Any other state, or `working` for any other reason, leaves the field
     out. An older record without the field reads as before.
8. **Foreman's rule.** Foreman reads the field tolerantly: a missing or
   malformed field reads as none. A `working` record with the field is put
   through the idle rule, counting from `since`: a nudge after `idleMinutes`,
   a second one `idleMinutes` later, then a wake. Progress in the record ends
   the stretch, as it does for idle. The working rule never ends the stretch
   of a record with the field because the work lasted a threshold.
9. **The nudge and the wake.** The nudge for a background-only wait asks the
   sub session to check that its background work is still making progress and
   to stop it if it hangs, rather than asking what is next. The wake sentence
   is `<who> has waited only on background work for <n> minutes, through two
   nudges; its first task, quoted: "<task>".`, or, for a record with no
   desktop session, `… for <n> minutes and cannot be nudged, because foreman
   knows no desktop session for it; …`, with the quoted text cleaned as all
   record text is and the closing data sentence added. The wake skill's
   section for it reads the sub session's last events and sends one message
   naming the task to check or stop, or tells the person in one line.

### The parent has a fallback when foreman holds no record

10. **Naming the sub sessions.** Foreman's `prompt.submit` hook, for a prompt
    made only of the desktop app's notes and messages, names in its context
    line every sub session whose turn-end note is in the prompt and of which
    foreman holds no record: while the role is on, an id that no pairing
    holds; while the role is off, an id in the list of unwatched sub sessions
    from point 3. The line gives each by its `local_…` id and says, with
    `idleMinutes` as a number, to schedule one check of each for that many
    minutes later instead of replying with a bare "Noted.". Notes about
    sub sessions foreman tracks are handled as today. A prompt with no such
    sub session gets today's Noted line.
11. **The check.** The wake skill says how: one session-scoped one-shot
    `CronCreate` per sub session, keeping at most one pending check per sub
    session, so a newer note replaces the pending check (`CronDelete`, then
    `CronCreate`). When the check fires, the parent reads at most the sub
    session's last six events with `list_events`.
    - If the sub session ended a turn after the note and that turn was not
      its answer to this parent's nudge, it did new work: schedule nothing.
    - If its newest turn is still the one the note reported, it is still
      waiting or idle: send it one nudge with `send_message` naming what it
      said it waits on, and schedule one more check.
    - If its newest turn was its answer to this parent's nudge and it still
      waits, tell the person in one line, and schedule nothing more for that
      sub session until a note shows it did new work.
    - If the session is archived or gone, tell the person in one line.
12. **No standing timer.** The parent does not check sub sessions on a timer
    of its own, whether or not a note arrived. Every stop of a sub session
    ends a turn and so sends a note, and a sub session still inside a turn is
    bounded by its tool calls' own time limits, so a check per note reaches
    every sub session that stopped; a standing timer would add only turns
    spent on sub sessions that are working normally. This answers the
    person's question about sub sessions started while foreman was off: they
    are covered by the per-note check in points 10 and 11, not by a timer.

### `/implement` stops a hung background command

13. `skills/implement/SKILL.md` gains a rule that every command the session
    starts in the background carries its own time limit, longer than the
    command's slowest normal run. On a machine without a `timeout` command it
    uses `perl -e 'alarm <seconds>; exec @ARGV' <command>`. A test runner that
    collects diagnostics after a failure runs with that collection turned off
    when it has a switch for it, keeping the logs it already wrote. A command
    stopped by its limit is reported as a failure, with the limit named, and
    is not rerun silently. The alarm stops only the command it runs, so the
    session says so when a helper the command started may still be running.

## Edge cases

- A prompt that quotes `/start-foreman` inside a sentence, not at the start
  of a line, gets no line. A false match costs one unneeded sentence.
- A session that never ran `/start-foreman` and starts no `/implement` sub
  session sees no change from foreman at all.
- A refusal in point 2 already given before a reload is remembered, so the
  next start after the reload passes.
- A sub session that starts a second background task partway through a wait
  keeps the wait's `since` while any first-wait task is still in flight.
- A background task that the engine reports without an id is told apart from
  others by its kind and description, so tasks without ids cannot keep one
  wait alive for ever.
- A healthy long background task, such as a 20-minute test suite, is nudged
  twice and then reported to the parent. That is accepted: a report stops
  nothing, and telling the parent too often is harmless where staying silent
  is not.
- A sub session that finished cleanly may get one check, which reads its last
  events and schedules nothing.
- A parent restart drops its one-shot checks; the next note schedules a new
  one.
- A pairing from a proposal card stays out of the five-minute check until a
  status file supplies its id.

## Non-goals

- Watching a background task's output. The engine reports no output size or
  path for a background task, so the ceiling counts from when the
  background-only wait began, and the record's progress ends it.
- Turning the role on from pasted text, or from anything but the typed
  command.
- A standing timer in the parent (point 12 says why).
- Taking a sub session that was started without a ticket into foreman after
  the fact.
- Reporting a pairing from a proposal card that never started.
- Any change to a project's own gates; point 13 changes only the generic
  `/implement` skill.
- Killing the helper processes that a timed-out command left running.

## Failure modes

- If foreman's store cannot be written, the refusal in point 2 may be given
  again after a reload; the second call then passes as before.
- If the list of unwatched sub sessions is lost, notes about them get today's
  Noted line until the role is turned on.
- If the model ignores the context line in point 10, the incident's failure
  returns for that note only; points 1, 2 and 8 still apply.
- A secret-shaped task description is written as the withheld text, so the
  wake names no task text for it.

## Verification

- Foreman tests: a person's prompt with a pasted `/start-foreman 3 …` while
  off gets the context line and leaves the role off; the same text while on,
  a typed command, a mention inside a sentence and a plugin's prompt get none.
- Foreman tests: the first `/implement` start while off is refused with the
  `foreman: ` refusal, the second passes with the context sentence and its id
  is kept as unwatched, a non-`/implement` start passes untouched, and the
  remembered refusal survives a reload.
- Foreman tests: a hook that throws before the call went on logs a line and
  adds the sentence; one that throws after it adds nothing.
- Foreman tests of `decide`: a pairing with a `localId` and no file wakes once
  at five minutes and not again; one whose ticket a file carries under
  another desktop session or none wakes once with the second sentence; one
  without a `localId`, or read while the folder is missing, never wakes; a
  `working` record with `backgroundOnly` nudges at `idleMinutes` from `since`,
  again a threshold later, then wakes with the task quoted; progress ends the
  stretch; a `working` record without the field never nudges.
- Foreman tests of the notes context: untracked turn-end ids are named with
  the minutes while on, unwatched ids while off, and tracked ids are not.
- Builder tests: the field appears only for background-only work, keeps
  `since` across a short own turn while a task id remains, resets when none
  remains, carries descriptions and never commands, and withholds a
  secret-shaped description.
- The issue's own checks, by hand in a real parent: paste the command text
  and see the parent report that foreman is off; start a background
  `sleep 100000` as a sub session's only work, end its turn, and see the
  nudge arrive `idleMinutes` later.
- The gates in the project's `CLAUDE.md`. No gate reads `skills/` or the wake
  skill's Markdown, so the reviewers alone check those.

## Decided by the counsel

- When a person's prompt in a session where the foreman role is off holds a line beginning "/start-foreman" as plain text (for example pasted), so the command never ran, what should the foreman mod do? The counsel chose: Add a context line to that prompt telling the model that the command did not run and foreman is off, so it tells the person in one line, asks them to type /start-foreman themselves, and starts no sub session until they have. 7 of 7 members voted for it.
- When the foreman role is off and the parent's model calls start_session with a brief that runs /implement, what should foreman do so that the parent says foreman is off before starting anything, without blocking a person who means to run /implement sub sessions without foreman? The counsel chose: Refuse the first start_session call per session whose brief runs /implement while the role is off, with a refusal saying foreman is off and asking the model to tell the person; a second identical call passes, so a person who wants it without foreman can say so. 6 of 7 members voted for it.
- How should a sub session whose only reason for "working" is one or more background tasks get a ceiling, so a hung background command leads to nudges and then a wake of the parent naming the task? The counsel chose: Builder adds an optional field to the status record when the only thing running is background work: when that wait began and the tasks' descriptions, cleaned and checked for secrets. The state stays "working". Foreman runs its existing idle rule over that wait, counting from when it began: a nudge after idleMinutes, a second one idleMinutes later, then a wake that names the task. Progress in the record ends the stretch as it does for idle. 7 of 7 members voted for it.
- When a turn-end note or message about a sub session reaches the parent's model and foreman holds no record of that sub session (the role was off when it started, or no status file carries its ticket), what should the parent do, and is a standing timer in the parent that checks such sub sessions on its own part of this issue? The counsel chose: After every such note, the parent schedules one check of that sub session for idleMinutes later with a session-scoped one-shot timer (CronCreate). When the check fires it reads the sub session's last few events; if the sub session is still waiting or idle it nudges it once and schedules one more check, and on the next still-waiting check it tells the person in one line. No standing timer: every turn end produces a note, so a check scheduled per note covers every sub session that stopped. Foreman's prompt hook names, in its context line, the sub sessions it holds no record of, so the model does not have to guess. 6 of 7 members voted for it.
- What should the generic /implement skill say so that a background command, such as a failed user interface test run that hangs while collecting diagnostics, reports back instead of hanging for ever? The counsel chose: Add a rule: every command the session starts in the background carries its own time limit, longer than the command's slowest normal run, and a test runner that collects diagnostics after a failure runs with that collection turned off when the runner has a switch for it. The rule names a portable way to set the limit on a machine without a timeout command, and says that a command stopped by its limit is reported as a failure, not rerun silently. 6 of 7 members voted for it.
- While the foreman role is on, which starts without a working ticket should foreman report, so that a start without a ticket is visible within one read? The counsel chose: Both: when the start_session hook fails before it could add the ticket and the call goes on without one, foreman writes a log line and adds a context sentence to the call's answer saying the sub session has no ticket and foreman does not watch it; and when a ticket paired with a started desktop session has no status file carrying it five minutes after the start, foreman wakes the parent once naming that sub session, so the parent checks whether it runs /implement with builder loaded. 7 of 7 members voted for it.
