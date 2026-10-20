# The counsel says when a member never started

Date: 2026-10-14

This spec covers the first of two problems that were raised together; the
second, how old tallies show the advocate, is dropped (see "Decided by the
counsel").

## Goal

The change described in the section "The owner's advocate" of
`pilot-counsel.md` added `pilot:owners-advocate` as the
seventh counsel member. A session reloads the pilot mod's hooks while it runs,
but it loads agent files only when it starts. So a session that was running
when the advocate joined has a tally that needs the advocate's vote, while the
session cannot launch the advocate: the Agent tool answers "Agent type
'pilot:owners-advocate' not found". The advocate is asked again, still has no
vote, and the question goes to the person. Every counsel question in that
session then goes to the person until the session restarts, and nothing tells
the person why or that a restart fixes it.

This change makes the answer that sends a question to the person say which
members never started, and tells the session to add that a restart fixes it
when the Agent tool answered that the member's type is not found.

## Users and trigger

The person running a session that started before a counsel member existed,
which happens whenever the counsel gains a member while sessions are running.
The trigger is a counsel question in which a member, asked again, still has no
vote and never started.

## Behavior

1. **Which members never started.** When the tally sends a question to the
   person, the mod reads its record of agents once and finds the members that
   never started. A member never started when it was asked again in this
   round, it has no vote in the tally call (left out, or reported with an
   empty vote, and no unreadable text was given for it), and the record holds
   no agent of that member's type whose start time is at or after the
   question's `launchedAt`. The record is the one the mod already keeps from
   its `agent.spawn` hook and the engine's list of agents. `launchedAt` is
   already reset when members are asked again and at a rerun, so the check
   covers the latest launch only. That reset is why only members asked again
   can be named: a member that voted in the first tally and is left out of
   the second was launched before the reset, so its agent would look as if it
   never started.
2. **Only the answer that sends the question to the person says it.** The
   answer that asks members again is unchanged, because a member the session
   simply left out of its launch message looks the same at that point, and
   asking again fixes that. The answer that decides and the answer that reruns
   are unchanged too. The pane is unchanged.
3. **What the answer says.** When at least one member never started, the
   answer that sends the question to the person:
   - names those members in a sentence the session puts at the opening of the
     question, saying they never started in this session even after being
     asked again;
   - tells the session to add, only for a member whose launch the Agent tool
     answered with a "not found" error for its type, that a session started
     before that member joined the counsel cannot launch it, and that
     restarting the session lets the counsel decide again; and otherwise to
     say only that the member never started;
   - gives each such member's line under "Without a vote:" as "never started
     in this session" in place of "no readable vote".
   When no member without a vote is found to have never started, the answer is
   exactly what it is today.
4. **The counsel code stays pure.** `counsel.ts` builds the answer from the
   question, the tally and a list of members that never started, which
   `register.tsx` works out from the record and passes in.

## Edge cases

- A member that abstained or wrote a vote that could not be read did start,
  so it is never listed as never started, even if its card is missing.
- A member whose agent started but failed, or was stopped, has a card since
  `launchedAt`, so it is not listed as never started.
- A question that goes to the person because no option reached a majority,
  with every member voting, has no member without a vote, so nothing changes.
- An agent the mod first sees in the engine's list, not through its spawn
  hook, gets the time it was first seen as its start, which is after the
  launch, so it counts as started.
- The record keeps the newest 100 agents; a counsel round launches at most
  seven, so a member that started is not pushed out before its tally.
- A stale session shows the message on every counsel question until it
  restarts. That is accepted: it is true each time.

## Non-goals

- Making a running session load a new member without a restart, for example
  by registering the agent from the mod's hooks.
- Changing when members are asked again, or skipping the second ask for a
  member that never started.
- Marking members that never started in the pane.
- Changing how old tallies show the advocate (dropped; see "Decided by the counsel").
- Pull request 42's general warning that the pilot mod changed on disk; this
  change neither needs it nor changes it.

## Failure modes

- If the record of agents cannot be read, the mod treats no member as never
  started, and the answer is the one it gives today. The person is told less,
  never something false.
- If the session ignores the condition and always adds the restart sentence,
  the person may be told to restart when a member was refused for another
  reason, such as the mod refusing a reviewer launched from a workflow. The
  answer's wording names the condition plainly to make that unlikely.

## Verification

- A test of the answer that sends the question to the person, given a member
  that never started, checks the opening sentence, the conditional
  instruction about the "not found" error, and the member's "never started in
  this session" line under "Without a vote:".
- A test given no members that never started checks that the answer is
  unchanged.
- A test of the answer that asks members again checks that it never mentions
  members that never started or a restart.
- A test through the engine, in `register.test.ts`, launches six members
  through the spawn hook, tallies twice without the advocate, and checks that
  the answer names the advocate as never started; that an advocate launched
  only before it was asked again is still named; and that an advocate
  launched after it was asked again, with an empty vote, is not named. The
  test moves the mock clock between the steps, because a frozen clock would
  make every start time equal to `launchedAt`.
- A member whose vote could not be read is not named, even when the mod
  holds no agent of its type. The existing engine test of quoted unreadable
  votes checks this; in that test no agent is ever launched, so its
  expectation for the member left out twice changes from "no readable vote"
  to "never started in this session".
- The four gates in `CLAUDE.md` pass.

## Decided by the counsel

- When a counsel member gives no vote, how should the tally's answer tell the person that the member could not be launched because the session started before that member joined the counsel, and that restarting the session fixes it? The counsel chose The mod detects it: for each member without a vote, it checks its own record of agents started since the members were launched, and only for a member of which no agent started does the answer say that the member never started, that a session started before the member joined cannot launch it (the Agent tool answers that the type is not found), and that restarting the session fixes it., 5 of 7.
- Should this change also stop old tallies from listing the owner's advocate as having "no readable vote", by recording on each tally which members sat on the counsel, or should that part of the issue be dropped? The counsel chose Drop it: change nothing about old tallies, and leave the spec's "Old records" rule and the README sentence as they are., 7 of 7.
- Where should the change that tells the person a counsel member never started (and that a restart fixes it) be built: in its own pull request on main, or inside pull request 42 (`merge-step-runs-and-stale-pilot.md`), which warns when the pilot mod changed on disk? The counsel chose Its own pull request from main: the check lives in the counsel's tally answers and uses only the mod's agents record and each question's launch time, which main already has., 7 of 7.
- Which of the counsel's outputs should carry the message that a member never started and that restarting the session fixes it? The counsel chose Only the answer that sends the question to the person, in the member's line under "Without a vote" and in an opening sentence for the question., 6 of 7.
- How should the answer that sends the question to the person word the message for a member that never started, given that the session itself saw what the Agent tool answered when it tried to launch that member? The counsel chose Conditioned on what the session saw: it says the member never started even after being asked again, and tells the session to add that a restart fixes it only if the Agent tool answered that the member's type is not found; otherwise the session says only that the member never started., 7 of 7.
