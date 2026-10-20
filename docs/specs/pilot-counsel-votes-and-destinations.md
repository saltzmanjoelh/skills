# The counsel reads votes forgivingly and sends decisions where the session says

Written 2026-10-14.

## Goal

Two faults in the pilot mod's counsel can send a question to the person for no
reason, or file its decision in the wrong place.

- **Votes that mean an option but are not a bare number.** `readVote` in
  `mods/pilot/hooks/counsel.ts` accepts only `none`, `abstain` or a bare whole
  number. A member that writes `VOTE: 2 (a 5-minute poll)`, `VOTE: option 2`,
  `VOTE: **2**` or `VOTE: none .` has no vote. Under the rule "Every member
  votes" in `pilot-counsel.md`, such a member is launched again, and a second
  unreadable vote sends the question to the person whatever the other five
  voted. Nothing tells the session or the person what the member actually
  wrote.
- **Decisions sent to an unrelated pull request.** `counselPullRequest` in
  `mods/pilot/hooks/register.tsx` owes a decision to the watched pull request
  whenever it is open, whatever the session is doing. A session that runs
  `/spec` for its next issue while its earlier pull request is still open has
  the interview's decisions listed in that pull request's next review, and they
  never reach the new spec.

## Users and trigger

The session running `/spec` or `/implement`, when it tallies a counsel round
with `mcp__pilot__counsel_tally` or puts a question with
`mcp__pilot__counsel`. The person sees the result only when a question reaches
them, and in the reviews on their pull requests.

## Behavior

### Reading a vote

1. **The text is tidied first.** The text after `VOTE:` is trimmed, one
   trailing full stop is removed, and it is trimmed again, so `none .`,
   `abstain .` and `2 .` read as `none`, `abstain` and `2`. Letter case is
   ignored, as today.
2. **Markdown emphasis is removed** when it wraps the whole vote or the option
   number: one or two `*` or `_` on each side, the same on both. So `**2**`,
   `*none*` and `**option 2**` read as `2`, `none` and `2`.
3. **An option number may be written in two ways:** the number alone, or the
   word `option` followed by the number (`option 2`).
4. **After the number, only three things are allowed:** nothing; trailing
   punctuation alone (any of `. , ; : ! ?`, after optional spaces); or one
   remark in round brackets, optionally followed by trailing punctuation.
   The remark's content is not read, except that a remark whose first word is
   `or` or `and` makes the vote unreadable. So `2 (a 5-minute poll)` reads as
   2, and `2 (or 3)` and `2 (and 3)` cannot be read.
5. **Everything else cannot be read,** for example `2 or 3`, `2, 3`, `2/3`,
   `not 2`, `two`, `option two`, `2 - the poll is cheaper`, `2 (a) (b)` and
   `2 (a) then 3`. An option number that does not exist is refused, as today.
6. **A known limit.** A remark in brackets that hedges in other words, such as
   `2 (though 3 is close)`, reads as 2. Catching that would mean reading the
   remark's meaning. The brief already tells members to put their reasons on
   the `REASON:` line, which is where such a hedge belongs.

### Showing a vote that cannot be read

7. **The text is quoted, never stored.** When a vote cannot be read, the tally
   keeps its text for the answer it is writing and nothing else. The recorded
   tally, the counsel state and the pane are unchanged, and the pane still says
   "no readable vote".
8. **How the text is quoted.** Its first line, trimmed, inside double
   quotation marks, cut to at most 80 characters with an ellipsis when it was
   longer. When `secretIn` finds what looks like a secret in the text, the
   quote is replaced by the words "its text was withheld because it looks like
   a secret". One function does this for both answers below.
9. **The refusal that launches members again** (`askAgainAnswer`) lists each
   member whose vote could not be read with its quoted text, and says once
   what a readable vote looks like: an option's number, alone or as
   `option N`, optionally followed by one remark in brackets, or `none`. A
   member left out of the tally, or whose vote was empty, is named as today,
   with no quote.
10. **The answer that asks the person** lists a member whose vote could not be
    read in this tally call under "Without a vote:" with its quoted text in
    place of "no readable vote". A member left out or with an empty vote keeps
    "no readable vote", and an abstaining member keeps its reason.

### Where a decision goes

11. **The spec, unless the session names a pull request.** The counsel tool
    gains an optional field, `pull_request`, a whole number. Without it, a
    decision is recorded in the spec, whatever is watched: the tally's answer
    says to write the line under "Decided by the counsel", and nothing is owed
    to any pull request.
12. **A named pull request must be the watched, open one.** With
    `pull_request`, the number must equal the watched pull request's number,
    and that pull request's last known state must be open. Then the decision is
    owed to it, as decisions are today.
13. **A mismatch is refused.** When the number is not the watched pull
    request, the watched pull request is merged or closed, or nothing is
    watched, the tool writes no brief, records nothing, and answers with what
    is watched and its last known state (or that nothing is watched). It says
    to call again without `pull_request` to record the decision in the spec,
    and, when the watched pull request is open, that calling again with its
    number is the other choice. A value that is not a positive whole number,
    `null` included, is refused the same way, and no refusal repeats the value
    it was given.
14. **Settled when the question is put,** as today. A pull request that merges,
    or a watch that moves, while the counsel sits does not change where a
    decision already put is owed.
15. **The skills.** `/implement`'s Questions section passes `pull_request`
    with its pull request's number while that pull request is open and
    watched, and not before it is opened. `/spec` passes nothing, so its
    decisions always go to the spec. The tool's description and the pilot
    README say the same.

## Edge cases

- `**2** (a 5-minute poll)` and `option 2.` read as 2. `(2)` cannot be read,
  because the number must come first.
- `2 ( or 3 )` cannot be read: the remark is trimmed before its first word is
  read, and `Or` and `AND` count too.
- `2 (or-so)` reads as 2, because its first word is `or-so`, not `or`. The
  first word is the leading run of letters, digits, apostrophes and hyphens,
  so `2 (or, 3)` and `2 (and/or 3)` cannot be read.
- Emphasis is removed once: `***2***` and `*__2__*` cannot be read.
- A vote with a line break inside it, such as `2` followed by a new line and
  more text, cannot be read.
- A vote of `7 (a remark)` when there are four options is refused as an
  option that does not exist, as `7` is today.
- An unreadable vote whose text is several lines long is quoted by its first
  line only.
- A member unreadable in the first tally and readable in the second is counted
  as usual, and no quote appears anywhere.
- A member that was unreadable twice: the answer that asks the person quotes
  the text from the second tally call, the one that sent the question to them.
- `pull_request` given as `"12"` (text) or `12.5` is refused as not a whole
  number. Passing `0` or a negative number is refused the same way.
- A session that watches pull request 12, open, and passes `pull_request: 12`
  for a `/spec` question gets the old behaviour. That is a misuse the skills
  avoid, and the decision still reaches a review that the person reads.

## Non-goals

- Reading number words (`two`) or the meaning of a remark.
- Showing an unreadable vote's text in the pane, or storing it anywhere.
- Changing the brief's `VOTE: <number|none>` line, the count, the rerun rule
  or how many times a member is asked again.
- Tying a decision to a pull request automatically from what the session is
  doing.

## Failure modes

- A remark that hedges in words still reads as a firm vote (Behavior 6). The
  record says what the member chose; its `REASON:` shows the hedge.
- `/implement` forgetting `pull_request` after its pull request opens sends a
  decision to the spec instead of the review. The tally's answer says so, so
  the session sees it, and the decision is not lost.
- A secret in an unreadable vote is never echoed; the answer says it was
  withheld.

## Verification

Each item is a mod test in `mods/pilot/tests/counsel.test.ts` or
`mods/pilot/tests/register.test.ts` that fails if its rule is removed.

- One table test of `readVote` lists every accepted form with the option it
  reads (`2`, `2.`, `2 .`, `option 2`, `Option 2`, `**2**`, `*2*`,
  `__2__`, `**option 2**`, `2 (a 5-minute poll)`, `2 (a 5-minute poll).`,
  `2:`, `2 (though 3 is close)`, `none .`, `abstain .`, `**none**`) and every
  rejected form (`2 or 3`, `2, 3`, `2/3`, `not 2`, `two`, `option two`,
  `2 - the poll is cheaper`, `2 (or 3)`, `2 ( Or 3 )`, `2 (and 3)`,
  `2 (a) (b)`, `(2)`, `**2*`). The old test that held `**2**` unreadable is
  changed to this.
- The refusal quotes an unreadable vote's text, cut to 80 characters with an
  ellipsis, and withholds text in which `secretIn` finds a secret.
- The answer that asks the person, for a member unreadable twice, quotes the
  second call's text in place of "no readable vote", and a member left out
  still has "no readable vote".
- The recorded tally after an unreadable vote holds no text from it.
- With an open pull request watched and no `pull_request`, a decision is
  recorded in the spec and nothing is owed (the `/spec` case of decisions
  sent to an unrelated pull request).
- With `pull_request` naming the watched open pull request, the decision is
  owed to it and listed in its next review, as before.
- `pull_request` naming another number, a merged or closed pull request, or
  nothing watched is refused, writes no brief and records nothing; so is
  `pull_request` that is not a positive whole number.
- The counsel tool's input schema lists `pull_request`.

The skills and the README are checked by their reviewers, because no gate
reads them.

## Decided by the counsel

- When a counsel member's VOTE: line is not a bare number, none or abstain (for example "2 (a 5-minute poll)", "option 2", "**2**" or "2 ."), how should the mod treat it? The counsel chose Both: read the forms in the first option forgivingly, and have the refusal quote the text of any vote that is still unreadable., 4 of 6.
- The counsel decided that the mod reads plainly meant votes forgivingly and quotes any vote that is still unreadable, and every member said a hedged vote such as "2 or 3" must stay unreadable. Exactly which text may follow the option number for the vote to be read as that option? The counsel chose The same closed list as the first option, but a parenthetical remark that starts with "or" or "and" makes the vote unreadable, so "2 (or 3)" is unreadable while "2 (a 5-minute poll)" still reads as 2., 5 of 6.
- How should a session tell the counsel tool that a question belongs to a spec interview, so that its decision is recorded in the spec rather than owed to a pull request that happens to be watched and open? The counsel chose Reverse the default: a decision is owed to a pull request only when the session names that pull request's number in the call, and it must be the one watched and open. Without a number it is recorded in the spec. The /implement skill's Questions section passes the number while its pull request is open., 4 of 6.
- The counsel decided that a decision is owed to a pull request only when the session names that pull request's number in the counsel call, and that it must be the one watched and open. When a session names a number that is not the watched, open pull request (a different number, a pull request that has merged or closed, or nothing watched at all), what should the counsel tool do? The counsel chose Refuse the call: write no brief, record nothing, and answer with which pull request is watched and its last known state, so the session can call again with the right number or with none., 6 of 6.
- The counsel decided that the tally's refusal quotes the text of a vote that is still unreadable when it asks for the member to be launched again. When that member's vote is unreadable a second time and the question goes to the person, where else should the quoted text appear? The counsel chose Also in the answer that asks the person: the member is listed with its quoted text in place of "no readable vote". The text is taken from that tally call and not stored, so the pane keeps saying "no readable vote"., 6 of 6.
