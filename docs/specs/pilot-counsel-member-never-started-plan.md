# Plan: the counsel says when a member never started

Date: 2026-10-14

Spec: `docs/specs/pilot-counsel-member-never-started.md`

## Chosen approach

The simplest plan won. One pure function in `counsel.ts` works out which
members never started, given the question, the tally, the unreadable votes
and the agent cards. `counselAnswer` takes that list as a new fourth
parameter, which defaults to an empty list, and only its branch that sends the
question to the person reads it. `serveTally` in `register.tsx` reads the
mod's record of agents once, on that branch only, and passes the list in. No
stored field changes, and the pane, the answer that asks members again, the
answer that decides and the answer that reruns are untouched.

## Grafts from the other plans

- **One conditional line per member** (from the most extensible plan). Each
  member's launch may have failed differently, so each gets its own
  condition and its own quoted sentence. This also removes a singular and
  plural variant of the hardest sentence in the change.
- **Reuse `askedTwiceOf`** (from the most robust plan) to choose the
  candidates, so "asked again and still without a vote" has one definition,
  shared with `stepOf` and the line that opens the ask answer.
- **Refresh the record before the check, only when a candidate exists**
  (from the most robust plan). If the mod missed a member's spawn during a
  hot reload, the card made when that agent stopped has the type `agent`
  until the next read of the engine's list, and the member would be named
  falsely. `refreshAgents($).catch(() => undefined)` corrects the type and
  costs one `$.agent.list()` call on a rare path.
- **Change the expectation of the quoted unreadable votes test** (predicted
  by the most robust plan, resolved as the most extensible plan does). That
  test launches no agents, so "never started" is now the true answer for the
  member it leaves out twice, and the test then also checks that a member
  with an unreadable vote is never named.
- **Move the mock clock in the engine tests** (added by the judge). The mock
  clock is frozen unless a test advances it, so without that every start
  time would equal the launch time and the tests would prove nothing about
  "at or after the launch".

## Rejected alternatives

- **Sharing a `startedSince` helper between `plannedOf` and the new check.**
  It is a one-comparison filter, and the extraction would change
  `progress.ts` and need its own test, outside the spec. A comment names the
  shared rule instead, so the pane and the answer stay in agreement.
- **Validating cards of unknown shape and start times that are not finite
  numbers.** The record is typed and only this mod writes it. The one guard
  kept is for a question whose `launchedAt` is missing or not finite.
- **Putting the instructions right after the "Ask the person:" line.** They
  read better beside the line that says what the question states.
- **Registering all seven agents in the quoted unreadable votes test.** It
  would keep the old expectation but hide a free check of an edge case.

## Steps

1. In `counsel.ts`, export
   `neverStartedOf(q, t, unreadable, cards: readonly AgentCard[]): string[]`.
   It answers an empty list unless `t.outcome` is `ask` and `q.launchedAt` is
   finite. Otherwise it takes `askedTwiceOf(q, t.votes)`, keeps the members
   whose turnout entry has no reason and that have no unreadable entry, and
   of those keeps the members with no card of their type started at or after
   `q.launchedAt`. Also export a cheap `neverStartedCandidatesOf` (the same
   without the cards), so `serveTally` knows whether to refresh.
2. Extend `counselAnswer` with `neverStarted: readonly string[] = []`. In the
   ask branch, members in the list that are without a vote, with no reason
   and no quote, get "- X: never started in this session." under "Without a
   vote:", and two kinds of line go after the numbered options and before
   "In the question, state the tally...": the opening sentence naming them
   all, and one conditional line per member. An empty list leaves the output
   unchanged byte for byte.
3. In `serveTally`, on an ask outcome with a candidate, refresh the record,
   read it once (a failed read names nobody), call `neverStartedOf` with
   `recorded`, and pass the result to `counselAnswer`.
4. Add one sentence to the counsel paragraph of `mods/pilot/README.md`.
5. Unit tests in `counsel.test.ts`, then engine tests in `register.test.ts`,
   then the changed expectation, each written and seen failing first.
6. Run the four gates.

## Wording

After the numbered options:

> Open the question with this sentence: pilot:owners-advocate never started
> in this session, even after being asked again.

Then, for each member named:

> If the Agent tool answered your launch of pilot:owners-advocate with an
> error saying that its agent type was not found, add this sentence after
> the opening sentence: "A session started before pilot:owners-advocate
> joined the counsel cannot launch it, and restarting the session lets the
> counsel decide again." If the Agent tool answered in any other way, add
> nothing for pilot:owners-advocate, so that the question says only that it
> never started.

Under "Without a vote:":

> - pilot:owners-advocate: never started in this session.

## Test plan

In `mods/pilot/tests/counsel.test.ts`:

- `neverStartedOf`: no card gives the member; a card at exactly
  `launchedAt` and a later card with status failed both give nobody; a card
  before `launchedAt` gives the member; an abstainer, a member with an
  unreadable vote, and a member left out but not asked again give nobody; a
  question without `launchedAt`, a round where all seven voted, and a
  decided outcome give nobody.
- `counselAnswer`: with one member, the opening line, the conditional line
  and the "never started in this session" line, and no "no readable vote"
  for it; with two members, both named in order and two conditional lines;
  with an empty list, output equal to the call without the parameter, and a
  name passed for an abstainer changes nothing.
- `askAgainAnswer` never matches "never started" or "restart".

In `mods/pilot/tests/register.test.ts`, with `spawning(on)` and `spawn`, and
the clock advanced between steps:

- Six members spawned, two tallies without the advocate: the first answer
  refuses and names no restart; the second names the advocate as never
  started.
- The advocate spawned only before it was asked again: still named.
- The advocate spawned after it was asked again, with an empty vote: not
  named, and listed as "no readable vote".
- The quoted unreadable votes test: the member left out twice is listed as
  "never started in this session", and the member with an unreadable vote is
  not named as never started.
