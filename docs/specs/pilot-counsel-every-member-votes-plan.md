# Plan: every counsel member votes

Spec: `docs/specs/pilot-counsel.md`, section "Every member votes" (SAL-205).
Written 2026-10-09 from a three-plan tournament: the simplest plan won, with
three ideas taken from the most extensible one.

## Chosen approach

The rule fits into the existing pure functions in `mods/pilot/hooks/counsel.ts`
and one optional field on the stored question.

- **Stored state.** `CounselQuestion` gains `askedAgain?: string[]`: the
  members the mod asked to be launched again in the round the question waits
  on. A question stored without the field reads as nobody asked again.
  `afterTally` empties the list when a rerun moves the question to round 2,
  which gives every member a fresh second chance there (rule 5). A round that
  goes to the person keeps the list, so the ask answer can read it.
- **Reading votes stays one job.** `votesOf` keeps reading the votes and
  refusing malformed input, unchanged except for its comments.
- **A new step decides between asking again and counting.**
  `stepOf(q, votes)` takes the members without a vote, which are
  `turnoutOf({ votes }).abstained` (left out, unreadable or `abstain`). When
  there are some and none of them is in `q.askedAgain`, it returns
  `{ askAgain: members }`. Otherwise it returns `{ tally: tally(q, votes) }`.
  A missing member already asked again therefore sends the round to the
  person, whatever else is missing (rule 4).
- **Counting.** `tally` answers `'ask'`, never a rerun, when any member has no
  vote, which only rule 4 now reaches. Otherwise it counts two thirds of six,
  which is 4, as today. `COUNSEL_FLOOR` and its branches go, and `neededOf`
  stays.
- **Refusal.** `serveTally` calls `stepOf` after `votesOf`. On `askAgain` it
  appends the members to the stored question's `askedAgain` inside `update`,
  merging into the current copy, and answers with `askAgainAnswer(q, members)`.
  That answer names the members, reuses `launchLine(folder, members)` to say
  to launch exactly them again with the same brief, says to tally the round
  again with all six votes, and says that the mod recorded only that these
  members were asked again. It does not end with "Nothing was recorded.",
  because it records something. Every other refusal stays as it is and
  records nothing.
- **The ask answer under rule 4.** `counselAnswer` already has the question.
  When the tally has members without a vote, its first line names only those
  that are also in `q.askedAgain`: "Ask the person: data-reviewer gave no vote
  in round 1 after being asked twice, so the counsel cannot decide." Several
  are joined with `listed`. The list of members without a vote is headed
  "Without a vote:", and the instruction line asks for "the members without a
  vote, with their reasons". The pane keeps "Abstained:" for old records and
  rule 4 rounds, as rule 7 says.
- **Wording.** `decidedSentence` drops its abstainer branch, which a round
  with six votes cannot reach. `shortfallOf` keeps only "no option reached N
  of the M members who took part". The brief's opening line, its round 2 line
  and its answer section stop offering abstain, offer `VOTE: <number|none>`,
  and say to vote none, naming the preference or fact, when only the person
  can answer, and that a question merely outside one's angle is still to be
  judged. `tallyLine` and the `counsel_tally` tool's `votes` and `vote`
  descriptions say to report every member, with an empty vote for one that
  failed or was stopped, and that a member without a vote is asked again.
- **Types.** `BriefFacts` omits `askedAgain`. `CounselVote` keeps `'abstain'`,
  with a comment saying it is read only so that old records and rule 4 rounds
  show the reason.
- **Prose.** The six reviewer files' counsel-mode sections drop "abstain" and
  "outside your angle", offer `VOTE: <option number or none>`, and say the
  same as the brief. `mods/pilot/README.md` lines 34, 38 and 40 describe the
  vote without abstaining, the asking again, the 4 of 6 count and the ask
  answer's list, and say that the pane still shows older abstentions.

## Grafts

- From the extensible plan: name only the missing members that were asked
  again in the rule 4 line, built in `counselAnswer` from the question. The
  simple plan named every missing member as asked twice, which is false when
  a second member misses for the first time in the same tally.
- From the extensible plan: the heading "Without a vote:", which is true for
  every member it lists.
- From the extensible plan: `stepOf` as a separate step, so `votesOf` keeps
  its one job, and `launchLine` with a members argument for the refusal.
- From the robust plan: the phrase "gave no vote in round N after being asked
  twice", which is the spec's own wording.

## Rejected

- **A guard against two tallies of one question at once** (robust plan). The
  race exists for every tally today, a session calls the tool once per round
  after all six reports, and the spec does not ask for it.
- **Tagging `askedAgain` with its round** (robust and extensible plans). It
  protects only against that same race; clearing the list on a rerun is one
  line in the function that already moves the question to round 2.
- **Storing the members asked twice on the tally** (robust plan). It is
  derived from the tally and the question's list.
- **A cause for each member in the refusal** (robust plan). The session wrote
  those votes and does the same thing whatever the cause.
- **A counter and a limit constant for second chances** (extensible plan).
  The spec fixes one second chance per round.
- **Keeping the unreachable abstainer branch in `decidedSentence`** (robust
  plan). It is dead code.

## Known limit

Questions live in the mod's memory, so a restart loses the asked-again record
together with the question. The tally then answers that the question does not
exist, and the session puts it again, as today.

## Steps

1. Tests first, in `mods/pilot/tests/counsel.test.ts` and
   `mods/pilot/tests/register.test.ts`, for every Verification bullet and the
   mixed case below; run them and see them fail.
2. `types/index.d.ts` and `hooks/counsel.ts`: the field, `stepOf`, `tally`,
   `afterTally`, `askAgainAnswer`, `launchLine`, `counselAnswer`,
   `shortfallOf`, `decidedSentence`, `briefText`, `tallyLine`, comments.
3. `hooks/register.tsx`: `serveTally` and the tool schema descriptions.
4. Rewrite or delete the existing tests of the replaced SAL-196 rules (three
   of three decides, the floor, abstentions leaving the count, every member
   abstaining, round 2 counting its own abstentions, the decision sentence
   naming abstainers), and give six votes to the register tests that leave
   members out.
5. The six reviewer files and the README.
6. The gates, then the grep checks on the reviewer files by hand.

## Test plan

Each fails before the change unless it says it is a guard.

1. A `VOTE: abstain`, an unreadable vote and a member left out each refuse
   round 1 through the tool, name the member, leave the pane showing the
   question as voting, and a second tally with the same member still missing
   asks the person, which shows the refusal recorded it. A unit test checks
   `stepOf` for the three forms.
2. After a refusal, a tally with all six votes counts as usual: 4 of 6
   decides with "The counsel chose …, 4 of 6." and 3 of 6 asks.
3. A member asked again that still has no vote sends the question to the
   person even when the other five chose one option, and even when a `none`
   voter proposed an option (no rerun, the brief stays round 1). The answer
   names it as asked twice.
4. **Mixed case:** data was asked again and is still missing, and security is
   missing for the first time. The question goes to the person, the first
   line names data as asked twice and does not name security, and security
   is listed under "Without a vote:".
5. A member asked again in round 1 that has no vote in round 2 is refused and
   asked again, and `afterTally` of a rerun empties `askedAgain`.
6. After a refusal for data, a tally where data votes and performance is
   missing is refused and names only performance.
7. A tally that names a member twice and also leaves a member out is refused
   as "named twice"; a second tally with the same member missing is refused
   and asked again, not sent to the person.
8. Guard: a stored tally with an `abstain` vote and fewer than six votes on a
   question without `askedAgain` still shows in the pane, counted against the
   members who took part, with "Abstained:".
9. The brief in both rounds offers `VOTE: <number|none>`, has no "abstain" in
   any letter case, and says to vote none when only the person can answer.
10. The counsel tool's answer, the rerun answer and the `counsel_tally`
    schema's descriptions no longer say to leave a member out or offer
    abstain, and say that a member without a vote is asked again.
11. By hand: `grep -c -i 'abstain\|outside your angle'` prints 0 for each of
    the six reviewer files, and each contains `VOTE: <option number or none>`.
    No gate reads the reviewer files or the README, and the pull request says
    so.
