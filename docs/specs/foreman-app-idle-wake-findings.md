# Foreman and the desktop app's idle wake: findings

Date: 2026-11-04. Measured against the Claude desktop app 4.16336.0 and the
Claude Code 2.1.317 that it bundles.

## Goal

Answer, with a real test, whether the desktop app's own idle wake could start
the next issue for a foreman parent once foreman's queue of waiting sub
sessions has run dry, and build foreman's use of that wake only if it works.
It does not work, so this spec records the answer and changes no code.

The app wakes a parent with a turn of its own, which ends with a
`<side-sessions-event>` element, when a session the parent started ends a turn
and none of them is still working. Unlike foreman's own `foreman: ` lines, on
which the app refuses every `start_session`, this wake can allow starts. The
hope was that it could be a backstop for the queue: when the queue is empty
and every sub session is idle, foreman would send no line of its own, and the
parent would start the next issue on the app's wake.

## Users/Trigger

A foreman parent whose owner has been away long enough for the queue of
waiting sub sessions to empty. That is the only case the backstop was for.

## Behavior

Nothing changes. Foreman keeps rewriting the app's wake to its log line and
answering it with "Noted." itself (see `foreman-quiet-parent.md`), and keeps
waking the parent with its slot-free line when a slot frees with an empty
queue, or with the dry-queue report that the waiting-queue change adds.

What was found, question by question:

1. **Does the app's wake reach a foreman parent?** Yes, and foreman hides it,
   but the app counts it all the same. This was watched in a live foreman
   parent. After the owner typed, two sub sessions started, and in the next
   seven minutes the parent ran ten turns. Every one was the app's wake, which
   foreman rewrote and answered itself. The parent's saved record then showed
   ten wakes since the owner's last message. Every later wake was held, and the
   app's log shows each hold as "side-session wake held … at the wake cap,
   stopped until a person writes", at the moment a sub session ended a turn.
   From the app's code:
   - The app adds one to the count for every wake it delivers, whatever the
     turn does with it, and holds every wake once the count reaches ten.
   - Only a message whose origin is the person's own resets the count. A mod's
     prompt has the origin kind "plugin", never "human", so no foreman line
     resets it.
   - The app wakes the parent only after a sub session ends a turn while none
     is working. Sub sessions that are idle and have already reported cause no
     wake, so "every sub session idle" on its own never brings one.
   - Sub sessions that wait on the person do not stop the wake, but the app
     allows no starts on it while any of them waits.
2. **Does a start on the wake turn go through in auto mode?** Read from the
   app's code only; it was not observed in a live session. It goes through
   without a click when all of these hold:
   - every turn since the person last typed was the app's own wake;
   - the start is in the same project;
   - the parent is not in a Remote Control lineage;
   - the always-ask policy on the start tools was in place before the turn,
     which in auto mode counts as approval;
   - fewer than ten sessions were started this way since the person typed, and
     fewer than five of them are still working.

   A turn begun by a mod's prompt, such as a `foreman: ` line, breaks the
   first condition: the app marks every later wake as not continued, and
   refuses starts on it until the person types. With Remote Control on, the
   app wakes the parent but never allows starts on the wake.

**Why the backstop cannot work.** The queue runs dry exactly when the owner has
been away a long time. By then the routine turn ends of sub sessions have
spent the ten wakes, and any `foreman: ` line since the owner typed has broken
the chain, so the app refuses the start. The window in which it could fire,
with no foreman line and fewer than ten wakes since the owner typed, lasts
minutes, not the hours the backstop was meant to cover.

## Edge cases

- A sub session that ends turns every few seconds spends the ten wakes within
  minutes, as in the parent watched here.
- A parent whose last turn was cut short gets no wake while it is idle.
- A wake that comes while the parent's own turn runs is not lost: the app
  tries again when that turn ends, as long as the note is still queued.

## Non-goals

- Changing foreman's rewrite of the app's wake. Answering the wake itself costs
  nothing, because the app counts the wake when it delivers it, not when a
  model reads it.
- Sending foreman's prompts in a way that would count as the person's, or
  starting sessions on a turn the owner typed for some other purpose. Both
  would slip around the app's rule that a person stands behind each chain of
  starts.
- Telling the owner that the queue ran dry and that their next message starts
  more. The change that keeps foreman's queue of waiting sub sessions topped
  up already adds that report.
- A live test of the second answer.

## Failure modes

None in code, since nothing changes. The risk is in the record: these limits
belong to the app and may change in a later version. Before anyone builds on
the app's wake, they should test again against the version they run.

## Verification

- The live parent's saved record held ten wakes and two starts since the
  owner's last message. By the time this was written, the app's log held 29
  lines from that day reading "side-session wake held … at the wake cap",
  every one for that parent; the count is a snapshot and grows while the cap
  holds.
- The parent's transcript showed each of its ten turns as foreman's rewritten
  log line, answered by foreman.
- The code reading covers where the app adds to the wake count, the one place
  that resets it and the check on the person's origin there, the origin a
  mod's prompt carries, the rule that marks a turn as a wake, and the check
  that allows or refuses a start on that turn.

## Decided by the counsel

- The real test that the issue asked for shows that the desktop app's idle wake cannot start the next issue once foreman's queue has run dry. The issue says to build the feature only if the path works. What should this session deliver for the issue? The counsel chose: Write the test's answer as a findings spec under docs/specs, open a pull request with only that spec, merge it through the normal review, close the issue as answered with the path found not to work, and build no foreman code. 7 of 7 members voted for it.
- The issue asked two questions. The first, whether the app's idle wake reaches a foreman parent, was answered by watching a live parent: the app delivered ten wakes, foreman answered each itself, and the cap then held every later wake. The second, whether a start on a wake turn goes through in auto mode, was answered from the app's code only. Before the findings spec is written and the issue closed, does that second answer need a live start test? The counsel chose: No live test: record the second answer as read from the app's code, name the app and Claude Code versions, and say plainly in the spec that it was not observed in a live session. 7 of 7 members voted for it.
