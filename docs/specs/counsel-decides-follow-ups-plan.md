# Plan: the counsel decides each follow-up

Spec: `counsel-decides-follow-ups.md` (SAL-288). Written 2026-10-14 from a
plan tournament of three planners, simplest, most robust and most
extensible, judged against the spec.

## Chosen approach

The most robust plan won. A follow-ups question is its own kind of counsel
question, and the ordinary path (`briefRefusal`, `votesOf`, `stepOf`,
`tally`, `counselAnswer` and the rerun) does not change. `serveCounsel`
branches when the input has `follow_ups`, and `serveTally` branches when
the stored question has `followUps`, each to new pure functions in
`hooks/counsel.ts`. Every refusal comes before an id is taken or anything
is written. A follow-ups question has one round, never reruns, never owes
anything to a pull request or a spec, and never sends the session to ask
the person.

### Data

- `CounselQuestion.followUps?: string[]`. A follow-ups question stores the
  three fixed options in `options`, so code that reads options still works.
- `CounselTally.outcome` gains `'counted'`, which means each follow-up was
  counted on its own. Because the pane's table of outcome words is typed
  over every outcome, the type check forces the pane to handle it.
- `CounselTally.followUps?: FollowUpCount[]`, where `FollowUpCount` is
  `{ votes: CounselVote[]; counts: number[]; chosen?: number }`: the
  ordinary votes for that one follow-up, so `turnoutOf` and
  `abstainerReason` give the members without a vote for free. On a
  `'counted'` tally the top-level `votes`, `counts` and `proposed` are
  empty.
- Questions already kept have no `followUps` and read as before. Counsel
  questions live only in memory, so nothing needs migrating, and nothing
  new goes into the store.

### Reading votes

`readVote` gains an optional list of words. After emphasis is removed, a
tidied vote equal to one of the words, ignoring case, reads as its option
number, with the same remark rules as a number, so `**fix**` and `file.`
are read and `fix (or file)` is not. The default empty list leaves every
ordinary vote read exactly as before. The words are `fix`, `file` and
`drop`. `abstain` on a follow-up counts as no vote.

### The tool inputs

- `counsel` gains `follow_ups`, an array of 1 to 20 strings, and `options`
  leaves `required`; an ordinary call without options is still refused by
  `briefRefusal`. `followUpsRefusal` refuses `options` given with
  `follow_ups`, an empty list, more than twenty, a blank entry, two entries
  that say the same thing, and any `pull_request`.
- `counsel_tally`'s vote entry keeps its fields, now with only `member`
  required, and gains `follow_ups`: a list of
  `{ number, vote, reason }`, keyed by the follow-up's number and not by its
  position, so a skipped line cannot move later votes onto the wrong
  follow-up. A number outside 1 to n, or one given twice, refuses the
  tally. An entry with a top-level `vote` on a follow-ups question is
  refused, and so is `follow_ups` on an ordinary question; nothing is
  recorded either way.

### Counting

- `followUpVotesOf` reads the tally input into, for each follow-up, a list
  of ordinary `CounselVote`s, and the unreadable texts with their member and
  follow-up number, so they can be quoted.
- `followUpStepOf`: a member without a readable vote for any follow-up is
  missing. Missing members not yet asked again are asked again, all
  together. Otherwise the round is counted, even when a member asked again
  is still missing.
- `followUpTally` counts each follow-up against a fixed threshold of 4,
  `neededOf(COUNSEL_MEMBERS.length)`, never `neededOf` of the members who
  took part, which would fall to 3 with five votes.
- `followUpOutcomes(q, t)` gives each follow-up's text, decision or none,
  counts, the members without a vote, and the counsel's reason: the first
  non-empty reason, in the counsel's order, from a member that voted for
  the chosen option, withheld when `secretIn` finds a secret in it. Both
  the tally's answer and the pane use it, so they cannot disagree.

### Answers and the pane

- `briefText` branches for follow-ups: the question, the background, the
  files, the follow-ups numbered, the three options once, and the answer
  section asking for `VOTE n: <fix|file|drop|none>` and `REASON n:` per
  follow-up, with no `NEW OPTION` and no round 2 text. The lean stays out by
  type.
- `followUpAskAgainAnswer` names, for each member asked again, the
  follow-ups it lacks, quoting unreadable votes through `quoteVote`.
- `followUpAnswer` gives one sentence per follow-up: its decision with the
  count of 7 and the reason, or that the counsel did not decide, so it is
  dropped, with its tally and the members without a vote. It then says
  where each goes in the round's **Follow-ups** section, that nothing is
  owed to a review or a spec, and not to ask the person.
- The pane lists a follow-ups question with a head line and one line per
  follow-up with its tally and decision, and the members without a vote.

### Agents and documents

- The seven counsel members' agent files each gain one sentence in their
  counsel section: when the brief numbers follow-ups, end with one
  `VOTE n:` and `REASON n:` pair per follow-up, in order, with the words the
  brief gives, and no `NEW OPTION`.
- `skills/implement/SKILL.md`: second half point 4 puts every follow-up not
  fixed as cheap, not speculative and not yet decided to the counsel in one
  call without `pull_request`, in an approving round, and lists them under
  `Undecided:` in a round that requests changes; a fix decision joins the
  cheap-fix commit, whose message also holds the decisions; the limit rule
  files a fix decision. Point 6 adds `Undecided:` and the form of a decided
  item. The **Merged** step says what `To file:` now holds. The Questions
  section makes the follow-ups call the exception to "every call passes
  `pull_request`", says what to do when the counsel cannot sit, and that a
  tally refused after a restart means putting the follow-ups again.
- `docs/specs/pilot-counsel.md` gains a section on follow-ups questions,
  `mods/pilot/README.md` a paragraph in The counsel and its tool rows.

## Grafts

- From the most extensible plan: the optional word list on `readVote`, in
  place of a second matcher that would repeat the emphasis rules.
- From the most extensible and simplest plans: each follow-up's votes stored
  as ordinary `CounselVote`s, so `turnoutOf` gives the members without a
  vote, in place of a separate `without` list.
- From the simplest plan: one function, `followUpOutcomes`, shared by the
  answer and the pane.

## Rejected

- **Recording a follow-ups tally as `'decided'` with no chosen option**
  (simplest plan): every reader of `'decided'` would misbehave unless it
  checked for follow-ups first, and `decisionLine` would print an empty
  option.
- **Votes matched by position** (simplest and most extensible plans): one
  skipped line while copying moves every later vote to the wrong follow-up
  without anyone noticing.
- **A general seam for questions about many items with a table of kinds**
  (most extensible plan): it serves SAL-290, which the spec leaves out, and
  nothing needs it yet.
- **Folding follow-up text onto one line** (most robust plan): a fake vote
  line in the brief does not change what a member writes in its own
  report, and ordinary questions are not folded.

## Steps

1. Types: `followUps` on the question, `'counted'` and `followUps` on the
   tally, `FollowUpCount`.
2. Tests first in `tests/counsel.test.ts` for the refusal, the brief, the
   word reading, the per-follow-up count, the ask again, the answer and the
   reason order; see them fail.
3. `hooks/counsel.ts`: the word list on `readVote`, then the new
   functions.
4. `hooks/register.tsx`: the branches in `serveCounsel` and `serveTally`,
   and both schemas, with tests in `tests/register.test.ts`.
5. `hooks/pane.tsx` with its test in `tests/pane.test.ts`.
6. The seven agent files.
7. `skills/implement/SKILL.md`, `docs/specs/pilot-counsel.md` and the
   README.

## Test plan

Mapped to the spec's Verification section:

- `counsel.test`: a follow-ups brief numbers three follow-ups, gives the
  three options, asks for one vote and reason per follow-up, has no
  `NEW OPTION`, and holds no lean.
- `counsel.test` and `register.test`: a call with options and follow-ups,
  an empty list, twenty-one follow-ups, two that say the same thing, or
  `pull_request` is refused and writes no brief; twenty are accepted.
- `counsel.test`: seven members over three follow-ups decide each on its
  own, file at 4 of 7, drop at 5 of 7, and a 3, 3 and 1 split dropped as
  undecided.
- `counsel.test`: the answer gives each decision, count and the reason of
  the first member in the counsel's order that chose it, with the input
  order shuffled.
- `counsel.test` and `register.test`: a member lacking one follow-up's vote
  is asked again; still lacking it, a follow-up at 4 is decided, one below 4
  is dropped naming the member, 3 of 6 does not decide, and the answer does
  not ask the person.
- `counsel.test`: a follow-ups question never reruns, a `NEW OPTION` on it
  is ignored, and a tally for round 2 is refused.
- `register.test`: with a pull request watched, a follow-ups tally owes
  nothing, and the next review has no "Decided by the counsel" paragraph.
- `pane.test`: the pane lists a follow-ups question with each follow-up's
  tally and decision.
- Beside these: the words are read with emphasis and remarks and an
  ordinary question does not read them; a number out of range or repeated
  refuses the tally; ordinary votes on a follow-ups question and follow-up
  votes on an ordinary one are refused; a reason that looks like a secret
  is withheld; a stored question without `followUps` tallies as before.
