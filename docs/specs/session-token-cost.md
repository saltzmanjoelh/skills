# Builder records the tokens and cost its session spends, and foreman adds them up

Written 2026-10-28. Seeded from an issue in the owner's tracker. The owner
had no way to see what a build cost. A hand count of one past `/implement`
session, read from its transcripts, found 156 subagent transcripts holding
506 model calls, about 119 thousand output tokens, 2.15 million cache-write
tokens and 69 million cache-read tokens. Nothing in either mod showed any of
it, and the foreman parent, which starts many such sessions, could not say
what they had cost together. The issue asked builder to count, foreman to add
up, and the spec to settle which source is the record of truth. The six
questions it left open were put to the counsel.

## Goal

Builder counts the tokens its session spends, in four kinds and split by
model, counting the main thread and every subagent, together with one dollar
total for the session. It shows the totals in its pane, writes them into the
status file it shares with foreman, and publishes them as a state value.
Foreman shows each sub session's total, the sum over every sub session this
parent started, and the parent's own spending, in its pane.

## Users and trigger

The owner, reading builder's pane in any session, and reading foreman's pane
in a parent session that starts `/implement` sub sessions. Builder counts in
every session where it is loaded, ticketed or not, from the moment it loads;
nothing has to be started. Foreman shows the figures only in a parent session.

## Behavior

1. **The record of truth.** The `turn.step` hook is the record of truth for
   tokens. It fires for every model request, the main loop's and each
   subagent's, and its result carries `usage` with `input_tokens`,
   `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
   and `model`. Builder adds each step's usage to its totals. A step whose
   `usage` is null adds nothing. The transcripts are read only by a test (see
   Verification), never while a session runs.
2. **Counting each step once.** A step is known by its turn id and its index.
   Builder remembers, for each turn it has counted, the highest step index it
   has added, and adds a step only when its index is higher than that. A
   repeated event therefore counts once. The remembered turns are bounded:
   only the newest 50 turns are kept, because a repeated event arrives within
   the same turn or just after it.
3. **One write.** The step's key and its addition to the totals go into
   `$.store` in one write, so a restart or reload between the two cannot
   count a step twice or lose it. The store keeps the totals across restarts,
   reloads and a resumed session.
4. **The four kinds and the models.** The totals hold, for each model name a
   step reported, its input tokens, output tokens, cache-read tokens and
   cache-write tokens. The session's token totals are the sums over the
   models.
5. **The dollar total.** Builder reports one dollar figure, the engine's
   `cost.usd` from `$.session.usage()`, read whenever builder measures the
   session. It does not split dollars by model, because the engine exposes no
   price per model, and the mod keeps no price table. The engine's figure
   covers every priced response of the session, including the compaction
   summarizer. Builder keeps its own running dollar total in the store and
   adds only increases in the engine's figure: a reading lower than the last
   one is taken as the engine starting again from zero, as a resumed session
   may, and is added in full. When the engine gives no `cost`, the dollar
   total stays as it was and is marked unknown until a reading arrives.
6. **Builder's pane.** The pane shows a short block with the session's tokens
   in the four kinds and the dollar total, and one line per model with that
   model's four token counts. When no dollar reading has arrived, the pane
   says the cost is unknown rather than showing $0.
7. **The status file.** The record builder writes gains a `usage` field
   holding the totals: tokens per model in the four kinds, and the dollar
   total or null when it is unknown. The field is optional in the type, so a
   reader that predates it keeps working, and the record's version stays 1.
   Only a ticketed session writes a status file, as before.
8. **The state value.** Builder publishes the same totals as a new key,
   `usage`, in its state contract, in every session, ticketed or not. Its
   comment says that foreman reads it.
9. **Foreman's rows.** Each sub session's row in foreman's pane shows that
   session's tokens and dollar total, read from the `usage` field of its
   status file. A row shows only while its file is there, as before. A file
   without the field shows the figures as unknown, never as $0 or zero
   tokens.
10. **Foreman's list of last readings.** Foreman keeps in its stored ledger,
    beside the pairings, a separate list keyed by ticket, holding the last
    usage it read from each sub session's file. The list outlives the
    pairing, so a sub session whose file is gone, because it ended after its
    pull request merged, still counts. Foreman takes the usage only from the
    owner's row of a ticket, the row whose session id and ticket match the
    pairing's owner, never from a fork's file. Each new reading replaces that
    ticket's entry, and foreman keeps the larger of the stored entry and the
    new reading in each count, so an entry never falls. Foreman writes the
    ledger to the store only when an entry changed.
11. **Many sub sessions.** When the list passes 200 entries, foreman folds
    the oldest entries whose pairing is already gone into one stored "earlier
    sub sessions" total, removing each entry and adding it to that total in
    the same ledger write. An entry whose pairing still exists is never
    folded. The sum therefore never falls, and the ledger stays bounded.
12. **The sum.** Foreman's pane shows the sum over every sub session this
    parent started: the entries in the list plus the earlier sub sessions
    total. Sub sessions that foreman does not watch, those listed in
    `unwatched` because they were started while the role was off, are not in
    the sum, because foreman paired no ticket for them.
13. **The parent's own spending.** Foreman reads builder's `usage` state
    value with `$.state.get` in the parent session and shows it as the
    parent's own spending, beside the sum. Foreman names builder in its
    `dependencies`, so builder runs and counts in the parent session too.
    When the value is missing, the pane shows the parent's spending as
    unknown.

## Edge cases

- **A repeated hook event.** It has the same turn id and an index no higher
  than the one already counted, so it adds nothing.
- **A restart or reload mid-session.** The totals and the remembered step
  keys come back from the store, so counting carries on where it stopped.
- **A resumed session whose engine dollar figure starts again from zero.**
  The lower reading is added in full, so the dollar total keeps growing.
- **A damaged stored total in builder.** It reads as none, and builder starts
  counting again from zero rather than failing.
- **A damaged stored list in foreman.** It reads as an empty list with no
  earlier total, and foreman starts collecting again from the files present.
- **A sub session's file disappears.** Its entry stays in the list and the
  sum does not change.
- **A newer read of a file.** It replaces that ticket's entry.
- **A ticket whose entry was already folded comes back.** Its usage would be
  counted a second time, once in the earlier total and once as a new entry.
  This is narrow, because a folded entry's pairing was already gone, and the
  spec accepts it.
- **Spending just before a file is deleted.** Spending between foreman's last
  read of a file and the file's deletion is missed, so the sum can be
  slightly low.
- **The engine gives no `cost`.** Builder's pane and foreman's row say the
  cost is unknown.

## Non-goals

- Budgets and alerts, including a warning when a total passes an amount.
- History across different parent sessions.
- A dollar figure per model. That would become possible only if the engine
  exposed a price per model.
- Reading transcripts while a session runs. Only a test reads them.
- Back-filling sessions, or parts of a session, that ran before builder
  counted.
- Counting calls made while builder is not loaded. This is a known gap: a
  session that starts before builder loads, or runs while builder is
  unloaded, shows totals that leave those calls out.

## Failure modes

- **The store refuses a write.** Builder keeps the totals in memory for the
  rest of the session and tries the write again at the next step, so the
  pane stays right and only a restart before a good write loses the counts.
- **The status file cannot be written.** Builder's existing handling of a
  failed write applies; the totals are still in the store and the state
  value.
- **The ledger grows past what the store holds.** It cannot, because the list
  is bounded at 200 entries plus one folded total.

## Verification

- A test against a transcript fixture with duplicate lines: a main transcript
  and subagent transcripts in which each response is written as several lines
  with the same message id. The test sums the fixture's usage with duplicates
  removed by message id, replays the same responses as step events, some of
  them repeated, and checks that builder's totals equal the transcript sum.
  The test is seen to fail when duplicates are not removed, or when a
  repeated event is counted.
- A test that a repeated step event, and a step event with a lower index for
  the same turn, add nothing.
- A test that the step key and the addition land in one store write.
- A test that a lower engine dollar reading is added in full, and that a
  missing `cost` leaves the dollar total unknown, shown as unknown rather
  than $0.
- A test that a damaged stored total in builder reads as none.
- Foreman tests: a file disappears and the sum is unchanged; a newer read
  replaces the stored entry; a fork's file does not change the entry; a
  damaged stored list reads as none; past 200 entries the oldest finished
  entries fold and the sum is unchanged, and an entry whose pairing still
  exists is not folded; a file without `usage` shows unknown, never $0; a
  missing state value shows the parent's spending as unknown.
- The four gates pass for both mods.
- A hand check: in one real session, the totals in builder's pane match a sum
  taken from that session's transcripts with duplicates removed.

## Decided by the counsel

- Which source should builder treat as the record of truth for the tokens its session spends, counting the main thread and every subagent? The counsel chose: The turn.step hook is the record of truth: builder adds the usage of every step result, the main loop's and its subagents', keyed by turn id and step index so a repeated event counts once, and keeps the sums in $.store so a restart or reload keeps them; the transcripts are used only by a test that checks the hook sums against them. 7 of 7 members voted for it.
- The engine gives only one dollar total for the session, not a dollar figure for each model. How should builder report the dollar cost? The counsel chose: Report one dollar total, the engine's `cost.usd`, read when the session measures; split only the tokens by model. No price table in the mod. 6 of 7 members voted for it.
- How should foreman get the foreman parent session's own spending, so that its pane can show it beside the sub sessions' totals? The counsel chose: Builder counts in every session, and publishes its usage record as a state value declared in its contract; foreman reads that value with $.state.get in the parent session and shows it as the parent's own spending. 7 of 7 members voted for it.
- Builder deletes a sub session's status file when that session ends after its pull request merged. Should foreman's sum over the sub sessions still count a sub session whose file is gone? The counsel chose: Foreman keeps, beside each ticket in its stored ledger, the last usage it read from that sub session's file, so the sum counts every sub session this parent started, including those whose file is gone; a row shows only while its file is there. 7 of 7 members voted for it.
- Foreman forgets a pairing as soon as its sub session's status file leaves the folder, so the last spending it read cannot live inside the pairing. Where should foreman keep the totals of finished sub sessions, and what happens when there are many? The counsel chose: A separate list in the ledger, keyed by ticket, holding each sub session's last read usage, which outlives the pairing; past 200 entries the oldest are folded into one stored 'earlier sub sessions' total, so the sum never falls. 6 of 7 members voted for it.
- What should this change leave out, so the spec can name it under Non-goals? The counsel chose: Leave out all of these: budgets and alerts, history across parent sessions, dollars per model, reading transcripts at run time (only a test reads them), back-filling earlier sessions, and counting calls made while the mod is not loaded, which the spec states as a known gap. 7 of 7 members voted for it.
