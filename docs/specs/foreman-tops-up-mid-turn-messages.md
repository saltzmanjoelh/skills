# Foreman tops up its queue on a message typed while the parent's turn runs

Date: 2026-11-05.

This is a follow-up to `docs/specs/foreman-keeps-queue-topped-up.md`, which
the counsel filed when that change merged.

## Goal

Foreman keeps one waiting sub session per slot by adding a context line, the
top-up line, to each prompt the owner types in a parent session while its
queue is short. Today a prompt typed while the parent's turn is already
running gets no top-up line. An owner who types during a long parent turn
therefore sees the queue stay empty until they type again while the parent is
idle, and a slot that frees in the meantime waits for them.

The earlier spec left this case out because two top-up lines on one turn
could ask for more starts than the desktop app allows without a permission
card. Reading the installed desktop app's code (version 4.23118.0) showed
that this reason does not hold:

- The app decides whether `start_session` may run from a flag on the running
  turn, and any message the owner types switches that flag on, including one
  that joins a turn already running. Once Claude Code has taken the typed
  message, a start later in that turn is allowed, even on a turn that began
  from a mod's prompt.
- The app's count of ten starts before it shows a permission card counts the
  starts since the owner's last typed message, and each typed message resets
  it. It is not a count per turn.

So each typed message can carry its own top-up line, capped at 5 as before,
without bringing up the permission card.

## Users/Trigger

- The owner, who types a message into a foreman parent session while the
  parent's turn is running.
- The parent's model, which reads the top-up line and starts issues, following
  the wake skill.
- Foreman's prompt hook, which adds the line.

## Behavior

1. **A line on every typed prompt.** Foreman adds the top-up line to every
   prompt the owner types in a parent while foreman is on and the queue is
   short of the target, whether or not a turn is running. A prompt typed while
   a turn runs is one that carries that turn's id. The other rules for the
   line stay as they are: no line at the target, none on a prompt foreman or
   another plugin submitted, and none on a typed `/start-foreman`, whose
   replaced skill text gives the count instead. The held line is unchanged.
2. **A fresh count each time.** The count on every line is worked out afresh
   from foreman's ledger, as the gap to twice the slot count, capped at 5.
   Foreman writes each start's reservation into the ledger before the start
   goes through, so a count taken mid-turn already leaves out every start the
   parent has made on that turn so far, and its number is what is still to
   start.
3. **One wording for every line.** The line says to start that many issues
   now, counting every start the parent makes from here on, the issues the
   person names first and then the next ones the project's `Next issue:` fact
   picks, and that this number replaces any earlier top-up line's number on
   this turn. On a prompt that starts a turn, "from here on" covers the same
   starts as "on this turn" did. The text that replaces the start-foreman
   skill keeps sharing the same sentence.
4. **The wake skill.** The wake skill's top-up section is headed with the new
   line for one issue, says that the newest top-up line on a turn replaces any
   earlier one, and counts held keys and the person's named issues as starts
   made from the line on. Its sentence saying that a prompt typed mid-turn
   gets no line goes.
5. **The earlier spec.** Behavior 2 of
   `docs/specs/foreman-keeps-queue-topped-up.md` is edited to state the
   current rule, with a pointer to this spec. Its plan is left as it is, as
   the record of how that change was built. The comment above the prompt
   hook's code and the mod's README say the current rule too.

## Edge cases

- **Two typed messages in one long turn.** Each carries a line with a fresh
  count. If the parent has started some issues in between, the second count
  is smaller; if the queue has filled, the second message carries no line.
- **The parent adds two lines' counts together instead of replacing.**
  Foreman's slot check on every start puts any start beyond the free slots in
  the waiting queue, so the extra sessions wait and none runs beyond the
  slots.
- **A start made in the moment before Claude Code takes the typed message.**
  The app still refuses it on a turn a mod's prompt began. The model reads
  the line only after Claude Code has taken the message, so this should not
  happen, and foreman's existing hold covers it if it does.
- **A message the app queues until the turn ends.** It starts a new turn of
  its own and gets a line as it does today.

## Non-goals

- (a) No record in foreman of which turns had a line; the count is recomputed
  from the ledger each time.
- (b) No hook that stops the parent from adding two lines' counts together;
  the wake skill states the replace rule, and the slot check keeps extra
  starts waiting.
- (c) No change for a message the app queues until the turn ends.
- (d) No change to the target of twice the slot count or to the cap of 5.
- (e) No change to the held line.
- (f) No special handling of the short gap between the owner pressing send and
  Claude Code taking the message; the existing hold covers a start refused
  then.

## Failure modes

- **The app refuses a start made after a mid-turn message.** This would mean
  the reading of the app's code was wrong or a later app version changed it.
  Foreman's existing hold keeps the key and starts it on the owner's next
  message, and the owner is told once, as for any refused start.
- **The parent misreads the wording.** It starts too few, and the next typed
  message tops up again, or too many, and the extras wait in the queue.
- **The count fails.** The line is left out and the held line kept, as today.

## Verification

- Tests in `mods/foreman/tests`, using the fake app in `tests/world.ts`, show:
  a prompt that carries a turn id now carries the top-up line, where before
  this change it carried none; its count is taken from the ledger and is
  smaller after a start has been recorded; it is capped at 5; it uses the new
  shared wording; it is still absent at the target, on a plugin's prompt and
  on a typed `/start-foreman`; and the `/start-foreman` text uses the same
  sentence. No test can read the wake skill, so a search of the skill for the
  one-issue sentence checks that its heading uses it too.
- The gates in the project's `CLAUDE.md` pass.
- Not verified by the gates: that the real desktop app accepts a start made
  on a turn after a mid-turn typed message. The live check is that the owner
  types into a real parent session while its turn runs, with the queue short,
  and the parent starts the issues the line names on that same turn. The
  report says plainly whether this was seen. It does not hold the merge.

## Decided by the counsel

- When the owner types a message into a foreman parent session while the parent's turn is already running, should foreman add its top-up line to that message, and if so, how should the parent treat several top-up lines on one turn? The counsel chose: Add the top-up line to every typed message, mid-turn ones included, with the count worked out afresh from foreman's ledger each time (still capped at 5); the wake skill says the newest top-up line on a turn replaces any earlier one, so its count is the number still to start now. 5 of 7 members voted for it.
- Now that a turn can carry more than one top-up line, how should the line's wording change? The counsel chose: One wording for every top-up line: "start N now, counting every start you make from here on" (the person's named issues first, then the Next issue: fact), plus a sentence that this number replaces any earlier top-up line's number on this turn; the /start-foreman text keeps sharing the same sentence. 7 of 7 members voted for it.
- The earlier spec docs/specs/foreman-keeps-queue-topped-up.md (Behavior 2) and its plan still say a prompt typed mid-turn gets no top-up line, for a reason the app's code shows to be wrong. What should this change do with those two files? The counsel chose: Edit the earlier spec's Behavior 2 so it states the current rule (a line on every typed prompt, the newest replacing earlier ones) with a pointer to the new spec, and leave the plan untouched as the record of how that change was built. 7 of 7 members voted for it.
- What does this change deliberately leave out of scope? The counsel chose: Leave all of (a) to (f) out of scope, as listed. 7 of 7 members voted for it.
- How will we know this change works, and must a live check in the desktop app pass before the pull request merges? The counsel chose: Tests in mods/foreman/tests prove the hook (a mid-turn prompt now carries the line, with a count that reflects starts already recorded, capped at 5, and the shared new wording), the gates must pass, and the live check (the owner types mid-turn with a short queue and the parent starts the issues on that turn) is described in the spec and reported plainly as seen or not seen, without holding the merge. 7 of 7 members voted for it.
