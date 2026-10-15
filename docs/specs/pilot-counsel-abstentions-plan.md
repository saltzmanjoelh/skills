# Plan: counsel abstentions

Spec: `docs/specs/pilot-counsel.md`, section "Abstentions" (SAL-196).
Written 2026-10-08 from a tournament of three plans: simplest, most robust
and most extensible. The simplest plan won, with grafts from the other two.

## Chosen approach

All counting stays in `mods/pilot/hooks/counsel.ts` as pure functions, and
nothing new is stored: who took part and who abstained are worked out from
each tally's `votes` and `COUNSEL_MEMBERS` whenever they are needed.

- **The vote.** `CounselVote.vote` becomes `number | 'none' | 'abstain'`.
  `null`, which meant a `none` vote, an unreadable vote or a member left out
  all at once, leaves the type, so the type checker finds every place that
  compared a vote with `null`.
- **Reading.** `readVote` trims the text, drops one trailing full stop and
  ignores case. A whole number names an option, and an option that does not
  exist still refuses the tally; `none` and `abstain` are themselves;
  anything else, including empty text, `abstained` and `**2**`, is
  unreadable. `votesOf` runs the member and duplicate checks on every entry,
  then leaves an unreadable entry out of the stored votes, so it is the same
  as a member the session left out. It keeps `newOption` only on a `none`
  vote, so a proposal beside an abstention or an unreadable vote is never
  stored. `proposalsOf` keeps its own check for `none`.
- **Turnout.** A helper `turnoutOf(t)` returns the votes of the members who
  took part (an option or `none`) and the abstainers in `COUNSEL_MEMBERS`
  order, each with its reason for a deliberate abstention or `null` for no
  readable vote. The decision sentence, the ask answer and the pane all use
  it.
- **The rule.** `COUNSEL_NEEDED` is replaced by `COUNSEL_FLOOR = 3` and
  `neededOf(n) = ceil(2n / 3)`. `tally` decides when at least the floor took
  part and an option reaches `neededOf` of them. The rerun condition is
  unchanged, so a round 1 below the floor reruns on a `none` voter's
  proposal. Each round counts only its own votes.
- **Why it did not decide.** `shortfallOf(t)` says one of: no member took
  part, so no member could judge the question; only N took part, fewer than
  the three needed; or no option reached K of the N who took part. The rerun
  and ask answers both open with it.
- **`noOptionCount`** counts only `none` votes, and the tally is stated
  against the number who took part.
- **The decision sentence** is "The counsel chose X, c of N", followed by
  "; a abstained.", "; a and b abstained." or "; a, b and c abstained." with
  names in member order and without the `pilot:` prefix, and is unchanged
  with no abstainers. `decisionLine` carries it, so the spec section, the
  owed store and the review paragraph get the same text, and no reason.
- **The ask answer** states the tally against those who took part, one
  reason line per member who took part, then an "Abstained:" list with each
  abstainer's first reason line or "no readable vote", then the lean.
- **The pane** states the tally against those who took part and adds an
  "Abstained:" line when there are abstainers.
- **The brief** offers `VOTE: <number|none|abstain>` and says what each
  means, in its opening line, its round 2 line and its answer section.

## Grafts

- From the robust plan: the `'none'` string in place of `null`, because
  `null` is the ambiguity this issue removes and the type checker then finds
  every stale comparison; strict reading of the vote words, with tests; a
  test that no reason reaches `decisionLine` or `reviewParagraph`; a
  register-level test that an owed decision line carries the abstainers
  clause; and a note in the pull request that a session leaving out a
  dissenting member now removes it from the count, which the person
  approved.
- From the extensible plan: the single `turnoutOf` helper, so no reader
  counts on its own.

## Rejected

- Storing an `'unreadable'` vote, and a separate `voteKind` helper: no
  reader treats an unreadable vote differently from a member left out.
  `turnoutOf` reads a `null` stored before this change as `none`, which is
  what it meant when it was written, so an earlier tally keeps its count
  and does not show members that voted none as abstainers. The data
  reviewer asked for this on f1c675a.
- Filling left-out members into the stored tally inside `tally()`: it stores
  invented entries and needs its own ordering, while deriving them in
  `turnoutOf` is right whatever a tally holds.
- Deriving every "six" from the roster, checking `memberName` against
  `COUNSEL_MEMBERS`, tests that import the roster instead of writing names
  out, and edits to `skills/spec` and `skills/implement`: adding members is a
  later issue, and a test whose expected value comes from the code under
  test cannot catch a wrong roster or order.
- A mod test over the six agent files: the test runner loads only code files
  and refuses `node:fs`, so a grep and the reviewers check them, as the
  spec now says.

## Steps

1. Tests first, in `mods/pilot/tests/counsel.test.ts`: change the `vote`
   helper to the new type, rewrite the tests that encode the old rule, and
   add one test per item of the spec's Abstentions Verification list. See
   them fail.
2. `types/index.d.ts`: the vote type and its comment, and the comment on
   `counts`.
3. `hooks/counsel.ts`: `readVote`, `votesOf`, `turnoutOf`, `COUNSEL_FLOOR`,
   `neededOf`, `shortfallOf`, `tally`, `noOptionCount`, the decision
   sentence, `counselAnswer` and `briefText`, and the comments that describe
   the old rule.
4. `hooks/pane.tsx`: `counselLines`, with tests in `pane.test.ts` whose
   fixtures get real votes.
5. `hooks/register.tsx`: the `counsel_tally` schema's descriptions only;
   update the tally expectation in `register.test.ts` and add the owed-line
   test.
6. The six reviewer agents' counsel-mode sections and the pilot README.
7. Run the four gates, and the grep over the agent files.

## Test plan

Mapped to the spec's Abstentions Verification list:

1. Reading: `abstain`, `Abstain.`, ` ABSTAIN ` read as abstain; `None.` as
   none; empty, `abstained`, `**2**` and `two, I think` are unreadable and
   left out of the stored votes, as is a member left out; a tally of three
   for one option with three unreadable or missing decides 3 of 3.
2. The count: 3 of 3, 3 of 4 and 2 of 3 decide; 3 of 5 does not; 4 of 6
   decides and 3 of 6 does not.
3. The floor: 2 of 2 with four abstaining asks and says fewer than three
   took part.
4. All abstain: asks, no proposal, says no member could judge it, names all
   six.
5. Proposals: an abstention's and an unreadable vote's `new_option` are not
   stored and cause no rerun; a round 1 below the floor with a `none`
   voter's proposal reruns.
6. Round 2: a round 1 abstainer's round 2 vote counts (3 of 3 decides where
   carrying the abstention over would leave 2); a round 2 below the floor
   asks.
7. The sentence: abstainers in member order whatever the report order, the
   count against those who took part, one and two abstainer forms, unchanged
   with none; no reason in `decisionLine` or `reviewParagraph`; an owed line
   through the tool carries the clause.
8. The ask answer and the pane: abstainers in a separate list with their
   reasons or "no readable vote", the tally against those who took part,
   and no abstainer among the reason lines.
9. The brief offers `abstain`; the agent files are checked by grep.
