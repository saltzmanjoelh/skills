# The counsel decides before the person is asked

Issue: SAL-167. Written 2026-10-07.

## Goal

A session asks the person only when it has to. Before asking, it puts the
question to a counsel made of the pilot mod's six reviewer agents and, since
SAL-286, its owner's advocate. When at least 4 of the 7 choose the same
option (see "The owner's advocate", which replaced the two-thirds rule), the
session goes with that choice and records it where the person can see and overturn it. Otherwise the
question reaches the person with the vote and each member's reason attached.

## Users and trigger

The person running `/spec` or `/implement`, most of all during the spec
interview, where today every question goes straight to them. The trigger is
any question the session would otherwise ask with `AskUserQuestion`, after it
has already tried to answer it from the code, the spec, the issue and its
comments.

## Behavior

1. **The members.** The counsel is always all six reviewers:
   `pilot:spec-reviewer`, `pilot:adversarial-reviewer`,
   `pilot:security-reviewer`, `pilot:maintainability-reviewer`,
   `pilot:performance-reviewer` and `pilot:data-reviewer`, and, since
   SAL-286, the owner's advocate, `pilot:owners-advocate` (see "The owner's
   advocate"). Each reviewer's file gains a section for counsel mode: when its
   prompt names a counsel brief instead of a review package, it reads the
   brief and the files the brief names, judges the question from its own
   angle, and ends with a `VOTE:` line naming one option's number, `none`
   or `abstain` (see "Abstentions", added 2026-10-08), and a `REASON:` line. A member that votes `none` may add a
   `NEW OPTION:` line. Members stay inside the existing reviewer fence: they
   can read and report, nothing else.
2. **The brief.** The session calls a new mod tool, `mcp__pilot__counsel`,
   with the question, two to four options, the background (the issue in a
   few lines, what was tried, what is at stake) and the paths of the spec,
   plan or code the question touches, plus the session's own lean as a
   separate field. The mod writes a brief folder whose `brief.md` holds
   everything except the lean, with the options in the order given and no
   recommendation, and answers with the folder and a question id. The tool
   works whether or not a pull request is being watched, because `/spec`
   runs before there is one.
3. **The vote.** In one message the session launches all seven members,
   each with "Counsel brief: <folder>." It waits for all seven reports.
4. **The tally.** The session calls a second new tool,
   `mcp__pilot__counsel_tally`, with the question id and each member's
   `VOTE`, `REASON` and any `NEW OPTION`, as reported. The mod counts the
   votes, not the session. The counsel decides when at least two thirds of
   the members who took part voted for the same option, and at least three
   members took part; "Abstentions" says who takes part. The tool answers
   with one of three outcomes:
   - **Decided:** the session goes with that option and tells the person,
     naming the option and the count, for example "The counsel chose: a
     90-second poll. 5 of 6 members voted for it." ("The decision sentence"
     below gives the shape it has had since 2026-10-14.)
   - **Rerun:** the first round did not decide and at least one member who
     voted `none` proposed a new option. The mod adds the proposed options to the brief
     (keeping the total at six options at most, the earliest proposals
     first) and marks it round 2, and the session asks all six again. There
     is never a third round: in round 2, a `none` vote or a new option counts
     as a vote for no option.
   - **Ask the person:** the session asks with `AskUserQuestion`, as
     `/implement`'s Questions section says, with the options ordered by
     votes, most first, plus any option proposed in the last round while
     there is room for it among the four. The question states the tally,
     one line of reason per member who took part, the abstainers with their
     reasons as a separate list, and the session's own lean.
5. **The pane.** The pilot pane lists the session's counsel questions,
   newest first: the question, the round, the tally per option, the
   abstainers with their reasons, the outcome, and the session's lean. It keeps the last 20.
   While a question's round 2 is being voted on, the pane also draws round
   1's tally under the `round 2 · voting` line, labelled `Round 1:`, over
   round 1's options only, with the options round 1 added named as new and
   given no count (`pilot-true-state.md`, SAL-185).
6. **The record.** A decision is also written where it took effect. During
   `/spec`, the spec gets a section headed "Decided by the counsel" with one
   line per decision: the question, the option chosen and the count. During
   `/implement`, a decision on a question that named the pull request with
   `pull_request` is listed in the next review the session posts on that
   pull request, in a paragraph of the counsel's decisions since the
   previous review, while that pull request is open. When that pull request
   merged or closed before the decision reached a review, the decision is
   recorded in the spec instead, as the tally's answer, the turn the mod
   starts for the merge or the close, or the watch tool's answer tells the
   session (see `pilot-counsel-record-and-wording.md`). The person overturns
   a decision by telling the session, which then treats their answer as
   final.
7. **What still goes straight to the person.** Questions about the pull
   request's own safeguards never go to the counsel, because the counsel is
   made of the agents that review that pull request. They are: whether to
   merge a head with no checks when checks were expected, what to do when a
   limit on pushes or rounds is hit, and a check that failed for a reason
   outside the code.
8. **The skills.**
   - `/spec`: every interview question goes to the counsel first, and only
     questions it does not decide reach the person. The 5 to 10 questions
     count every question put, whoever answered it.
   - `/implement`: "The person's part is the spec interview and any product
     decision" and the rule "The session never makes a product decision. It
     asks." are rewritten so that the session never makes a product decision
     on its own, puts it to the counsel, and asks the person only when the
     counsel does not decide, or for the questions in point 7. The Questions
     section gains the counsel step between trying to answer and asking.

## Edge cases

- A question only the person can answer, such as what they want or a fact
  about their business: members vote `abstain`, fewer than three take
  part, and the question reaches the person.
- Two options tie at 3 and 3 with all six taking part: no option reaches 4, so the question reaches
  the person, without a rerun unless someone proposed a new option.
- Round 1 decides even though a member proposed a new option: the decision
  stands and the proposal is shown in the pane only.
- A tally for an unknown question id, for a round that was already tallied,
  or with a vote naming an option number that does not exist: the tool
  refuses and says why, and records nothing.
- A brief with fewer than two options or more than four: the tool refuses.
- The person answers a question while members are still voting on another:
  unaffected; each question has its own id.

## Non-goals

- Members do not talk to one another or see each other's votes.
- The mod does not launch the members itself; the session does, as with
  reviews.
- No new agent type, and no change to how the reviewers review a pull
  request. SAL-286 later added one agent, the owner's advocate, which sits
  on the counsel only (see "The owner's advocate").
- The counsel does not replace the review rounds or the merge rules.

## Failure modes

- If the brief cannot be written, the tool says so and the session asks the
  person directly, saying the counsel could not sit.
- If fewer than three members take part, the counsel cannot decide, and
  the question reaches the person with whatever votes came back.

## Verification

- Mod tests: a tally of 4 of 6 for one option decides it; 3 of 6 does not;
  a failed or unreadable member is treated as an abstention (see
  "Abstentions" for its own tests); round 1 with a new option
  and no decision answers rerun with the option added; round 2 never answers
  rerun, and its new options count against; the brief never contains the
  lean; the tool refuses an unknown id, a repeated tally, an out-of-range
  vote and an option count outside two to four; the pane lists counsel
  questions with tally and outcome, newest first, at most 20.
- The six reviewer files each have the counsel-mode section and the
  `VOTE:`, `REASON:` and `NEW OPTION:` lines.
- `skills/spec/SKILL.md` and `skills/implement/SKILL.md` say what point 8
  says, and `/implement` lists the questions in point 7 as going straight to
  the person.
- The pilot README describes the counsel and its two tools.
- The gates are green from `mods/pilot`: the type check, `claude plugin test .`
  and `claude plugin validate .`.

## Abstentions

Issue: SAL-196. Added 2026-10-08. **Every member votes** (SAL-205) replaced
the parts of this section that let a member leave the count.

A member's `VOTE: none` used to mean two things: "none of these options is
right", which is dissent, and "this question is outside what I can judge",
which is not. Both counted against a decision, so the counsel decided least
often on exactly the questions only some of its members can judge, and the
other members had to agree unanimously. A member can now abstain, and an
abstention leaves the count.

### The rule

1. **Three answers.** A member's `VOTE:` line names an option's number,
   `none` or `abstain`. `none` keeps its meaning: none of the options is
   right. `abstain` means the question is outside the member's angle, and
   its `REASON:` line says why in one sentence. The words are read ignoring
   case and a trailing full stop.
2. **Who takes part.** A member takes part when it voted for an option or
   for `none`. A member abstains when it voted `abstain`, and is treated as
   abstaining when the session left it out (it failed or was stopped) or its
   `VOTE:` line was anything else, such as empty or unreadable. Such a
   member is named to the person as having no readable vote, so the person
   can tell it apart from a deliberate abstention.
3. **Deciding.** The counsel decides when at least three members took part
   and at least two thirds of them, rounded up, voted for the same option.
   With six taking part that is 4, with five it is 4, with four it is 3,
   and with three it is 2. With all six taking part the rule is the same as
   before.
4. **Proposals.** Only a `none` vote can carry a `NEW OPTION:` line. A
   proposal written beside an abstention is dropped when the votes are
   read, so it is neither counted nor stored.
5. **Rerun.** Round 1 reruns when it did not decide and a `none` voter's
   proposal fits, whatever stopped it from deciding, including too few
   members taking part. Round 2 is still the last round.
6. **Each round counts on its own.** A member that abstained in round 1 and
   votes in round 2 takes part in round 2, and one that voted in round 1
   and abstains in round 2 does not. Round 2 applies the same floor and the
   same two thirds.
7. **The decision sentence** counted against the members who took part and
   named the abstainers, in the counsel's fixed member order and without
   the `pilot:` prefix: "The counsel chose X, 3 of 4; performance-reviewer
   and data-reviewer abstained." With one abstainer it read "…;
   data-reviewer abstained.", and with none "The counsel chose X, 4 of 6."
   Since abstaining was removed and every counted round has a vote from
   each member, it names no abstainers, and since 2026-10-14 it reads "The
   counsel chose: <option> <n> of <m> members voted for it.", with the
   option exactly as the session wrote it, ending in one full stop, question
   mark, exclamation mark or ellipsis
   (`pilot-counsel-record-and-wording.md`). The same line goes to the
   person, into the spec's "Decided by the counsel" section and into a
   review's decision paragraph. It carries no reasons.
8. **Asking the person.** The answer that tells the session to ask states
   why the counsel did not decide: no option reached two thirds of the
   members who took part, or fewer than three took part, or no member took
   part at all. The tally counts each option and `none` against the members
   who took part. One line of reason follows for each member who took part,
   then a separate list of the abstainers with their reasons, or "no
   readable vote" for a member left out or unreadable.
9. **The pane** shows the same tally, counted against the members who took
   part, and on a separate line the abstainers, each with the first line of
   its reason.
10. **The brief and the agents.** The brief's answer section offers
    `VOTE: <number|none|abstain>` and says what each means. Each of the six
    reviewers' counsel-mode sections says the same, and tells the member to
    abstain rather than vote `none` when the question is outside its angle.

### Edge cases

- **Every member abstains:** nobody took part, there is no proposal, and the
  question goes to the person with every abstainer's reason. The answer
  says that no member could judge the question.
- **Two take part:** even 2 of 2 does not decide, and the question goes to
  the person unless a `none` voter proposed an option, which reruns.
- **Round 2 after abstentions:** round 2 is counted afresh by the rule
  above; a round 2 below the floor answers "ask", never "decided".
- **A round 1 abstainer votes in round 2:** it takes part in round 2 and
  counts toward both the two thirds and the floor.
- **An abstention with a `NEW OPTION:` line:** the proposal is dropped, so
  it causes no rerun.

### Not chosen: choosing members per question

Asking only the members whose angle fits each question would also stop
unrelated members counting against a decision. It was not chosen because
the session would pick who votes, and the session's own lean is exactly
what the counsel is there to check; a session could fill the counsel with
the members likely to agree with it. With abstentions, each member judges
for itself whether the question is within its angle, and the floor keeps a
tiny counsel from deciding.

### Verification

Each of these is a mod test that fails if its rule is removed, except the
check on the reviewer files in the last item:

- A `VOTE: abstain` is read as an abstention, distinct from `none`, and an
  unreadable or empty vote and a left-out member are treated as abstaining.
- Abstentions leave the count: 3 for one option with three abstaining
  decides (3 of 3); 3 of 4 with two abstaining decides; 2 of 3 decides;
  3 of 5 does not; 4 of 6 still decides and 3 of 6 still does not.
- The floor: 2 of 2 with four abstaining answers "ask".
- Every member abstaining answers "ask", says no member could judge it, and
  names all six.
- A proposal beside an abstention is not stored and causes no rerun, and a
  round 1 below the floor with a `none` voter's proposal reruns.
- Round 2 counts its own abstentions: a round 1 abstainer's round 2 vote
  counts, and a round 2 below the floor answers "ask".
- The decision sentence names the abstainers in member order and counts
  against the members who took part, and is unchanged with no abstainers.
- The ask answer and the pane name the abstainers with their reasons,
  separately from the votes.
- The brief offers `abstain`. Each of the six reviewer files' counsel
  sections offers `VOTE: abstain`; no mod test can read those files,
  because the test runner loads only code files and refuses `node:fs`, so
  this is checked by `grep -c 'VOTE: abstain'` over the six files and by
  the reviewers, and the pull request says so.

The pilot README describes abstentions where it describes the counsel's
count.

## Every member votes

Issue: SAL-205. Added 2026-10-08.

In SAL-175 the counsel was asked whether a grep should ignore letter case.
Two members abstained, calling the question outside their angle, the other
four split 2 to 2, and the question reached the person. It was a plain
engineering question that every member could judge: the six members are one
model in six reviewer roles, and none of them lacks the knowledge to answer
it. Abstaining cost a member nothing, so it was the easy way out of a
question, and each abstention made the counsel smaller. The goal is every
member's input on every question. This section replaces the parts of
**Abstentions** that let a member leave the count: rule 2's left-out and
unreadable members, rule 3's floor, and rule 10's instruction to abstain.

### The rule

1. **Two answers.** A member's `VOTE:` line names an option's number or
   `none`. The brief and the six reviewer files no longer offer `abstain`,
   and the reviewer files no longer say "outside your angle" anywhere. Each
   member judges every question as an engineer, and brings its own angle to
   bear where the angle applies.
2. **When only the person can answer.** A member that believes the answer
   depends on what the person wants, or on a fact about their business that
   neither the brief nor the files give, votes `none`, and its `REASON:`
   line names the preference or the fact that only the person can supply. A
   question merely outside the member's angle is not such a case, and the
   brief and the reviewer files say so.
3. **A member without a vote is asked again.** A member has no vote when the
   session leaves it out of the tally (it failed or was stopped), when its
   `VOTE:` line cannot be read, or when it votes `abstain`. The tally then
   refuses the round, names each such member, and tells the session to
   launch exactly those members again with the same brief and to tally the
   round again with every member's vote. The refusal records that those
   members were asked again in this round, and nothing else.
4. **No vote twice sends the question to the person.** When a member that
   was already asked again in this round still has no vote, the round is
   recorded with outcome "ask" and the question goes to the person, whatever
   the other members voted. The ask answer says which members gave no vote
   after being asked twice, then gives the tally and the reasons of the
   members that did vote, as an ask answer does today. No rerun follows,
   even if a `none` voter proposed an option.
5. **Each round asks again on its own.** A member asked again in round 1
   gets its first chance again in round 2.
6. **Deciding.** Every round that is counted has six votes, so the counsel
   decides when at least 4 of the 6 chose the same option. The two-thirds
   rule and its wording stay as they are; with six votes they come to 4.
7. **Old records.** Tallies stored before this change may hold `abstain`
   votes and may have fewer than six votes. They are read and shown as
   before: the pane still counts them against the members who took part and
   lists their abstainers under "Without a vote:", with each reason or "no
   readable vote". A round recorded under rule 4 shows the members without a
   vote the same way. The pane used the label "Abstained:" until 2026-10-14,
   when it took the label the question put to the person uses, so that it
   no longer suggests that abstaining is still allowed.
8. **The tool's own words.** The counsel tool's answer, the tally tool's
   description of its votes and the tally's answers no longer tell the
   session to leave a member out. They say to report every member, and that
   a member without a vote is asked again.

### Edge cases

- **A member abstains, and the other five agree.** The round is refused and
  the abstainer is launched again; five agreeing votes never decide without
  the sixth.
- **Several members have no vote.** All of them are named in one refusal
  and launched again together.
- **A member asked again now votes.** The session tallies with all six
  votes, the five it already had and the new one, and the round is counted
  as any other.
- **A different member fails on the second tally.** It was not asked again
  in this round, so the round is refused once more for that member alone.
  Each member gets exactly one second chance per round.
- **The session tallies again without the member it was told to launch.**
  That member has no vote a second time, so the question goes to the
  person. The session cannot get around the rule by leaving a member out.
- **A refusal for another reason**, such as a member named twice or an
  option that does not exist, records nothing, as today, and does not count
  as asking anyone again.
- **The question goes to the person under rule 4 in round 2,** after a
  round 1 rerun: it is recorded and asked as any round 2 that does not
  decide.

### Not chosen

- **Counting an abstention as `none`.** Abstaining would then cost the
  member's vote, but a member could still refuse to judge, and the question
  would reach the person for that reason.
- **Leaving a member out after asking it twice.** That keeps a way out for a
  member that will not choose.
- **Keeping "outside your angle" but reading angles broadly.** A member
  could still argue that a question is specialised.

### Verification

Each of these is a mod test that fails if its rule is removed, except the
checks on the reviewer files:

- A `VOTE: abstain`, an unreadable vote and a member left out of the tally
  each refuse round 1, name the member, record it as asked again, and record
  no tally.
- A tally after the refusal with all six votes counts as usual: 4 of 6
  decides and 3 of 6 does not.
- A member asked again that still has no vote sends the question to the
  person, with outcome "ask", even when the other five all chose one option
  and even when a `none` voter proposed an option.
- A member asked again in round 1 that has no vote in round 2 is refused and
  asked again, not sent to the person.
- A second member without a vote on the second tally is refused, not sent to
  the person.
- A refusal for a member named twice records no one as asked again.
- A stored tally with `abstain` votes and fewer than six votes is still
  shown in the pane and counted as before.
- The brief offers `VOTE: <number|none>`, does not offer `abstain`, and says
  that a member votes `none` when only the person can answer.
- The counsel tool's answer and the tally tool's vote description no longer
  say to leave a member out.
- `grep -c -i 'abstain\|outside your angle' mods/pilot/agents/*-reviewer.md`
  prints 0 for each of the six reviewer files, and each of them still
  contains `VOTE: <option number or none>`. No mod test can read those
  files, so the pull request says these checks are run by hand.

The pilot README describes the counsel's count and the vote without
abstaining.

## The owner's advocate

Issue: SAL-286. Added 2026-10-14. This section replaces the count of six
members and the two-thirds rule everywhere above. The sections above still
say six where they record what was true when they were written.

Two problems followed from a counsel of six reviewers. Six is even, so a
3 to 3 split could always happen, and a split went to the owner. And no
member spoke for what the owner wants: when the answer depended on the
owner's preferences, members voted `none` and the question went to the
owner, even when the owner's `CLAUDE.md`, the issue's stated reason or an
earlier decision already answered it.

### The rule

1. **A seventh member.** The counsel is the six reviewers and
   `pilot:owners-advocate`, in that order. The advocate judges each option
   by what the owner would choose, using only what the owner has written:
   the global and project `CLAUDE.md`, the issue and its stated reason, the
   spec, and decisions already recorded, such as the "Decided by the
   counsel" and "Decided by the person" sections of specs and the issue's
   comments. It votes `none` only when none of those settle the question,
   and its `REASON:` line then names the preference that is missing.
2. **Read-only.** The advocate's tools are Read, Grep and Glob, and the mod
   holds it to the same read-only fence as the reviewers, including the
   refusal of a reviewer started from a workflow.
3. **Counsel only.** The advocate never takes part in pull request review
   rounds, so it adds no review findings and no follow-ups. The review
   rounds launch, and the pane plans, only the reviewers they did before.
4. **Deciding.** Every round that is counted has seven votes, and the
   counsel decides when at least 4 of the 7 chose the same option, a strict
   majority. The decision sentence reads "The counsel chose: X. 4 of 7
   members voted for it."
   Everything else in "Every member votes" stands: a member without a vote,
   the advocate included, is asked again once in each round, and a second
   time without a vote sends the question to the person.
5. **Old records.** Tallies stored before this change have six or fewer
   votes. They are still shown, and the advocate appears among the members
   without a vote of such a tally, as any member missing from it does.

### Edge cases

- **A 4 to 3 split** decides for the four.
- **Three votes for each of two options and one for `none`** decides
  nothing, as no option reached 4, and the question reaches the person
  unless a `none` voter proposed an option, which reruns in round 1.
- **The six reviewers agree and the advocate has no vote:** the round is
  refused and the advocate is asked again, as any member would be.

### Not chosen

- **Two thirds of seven, which is 5.** It is stricter than the 4 of 6 used
  until now and would leave more questions undecided.

### Verification

Each of these is a mod test that fails if its change is removed:

- 4 of 7 for one option decides it, and 3 of 7 does not.
- A 4 to 3 split decides for the four, and the decision line says 4 of 7.
- The six reviewers voting without the advocate are not counted, and the
  tally asks for the advocate again.
- The counsel members are the reviewers and the advocate, the advocate is
  not a reviewer, and the read-only set holds every counsel member.
- The fence refuses the advocate an edit and lets it read and hand its
  report back, and a workflow cannot start it.
- A counsel question plans all seven members, and a review round still
  plans only the reviewers.

The agent file, the pilot README, `skills/implement/SKILL.md` and
`skills/spec/SKILL.md` say seven members and 4 of 7. No gate reads them, so
the reviewers check them.

## Follow-ups questions

Issue: SAL-288. Added 2026-10-14. The full behaviour, and the reasons for
it, are in `counsel-decides-follow-ups.md`; this section records how a
follow-ups question differs from the questions described above.

An `/implement` session used to decide on its own which of a pull
request's follow-ups to file and which to drop. The counsel now decides
each one, and it decides all of a round's follow-ups in one sitting of
seven members rather than one sitting per follow-up.

### The rule

1. **A different kind of question.** A counsel call with `follow_ups`, a
   list of one to twenty follow-ups, each in one or two sentences, has no
   `options`. The mod gives every follow-up the same three options, in
   this order: fix it in this pull request, file it as an issue, drop it.
   A call with both `options` and `follow_ups`, with an empty list, with
   more than twenty follow-ups, or with `pull_request` is refused and
   writes no brief.
2. **The brief.** It lists the follow-ups, numbered, under the question
   and the background, and asks each member to end its report with one
   `VOTE n:` line and one `REASON n:` line per follow-up, in order. It
   holds no lean and asks for no new option.
3. **Reading a vote.** A vote on a follow-up is one of the words `fix`,
   `file`, `drop` or `none`, or the number of one of the three options,
   read with the same rules for emphasis and remarks as any other vote.
4. **Each follow-up on its own.** An option chosen by at least 4 of the 7
   decides a follow-up. A follow-up that no option wins with 4 of 7 is
   dropped as undecided, and nothing is filed for it.
5. **A member still without a vote.** A member whose report lacks a
   readable vote for any follow-up is asked again once, as for any
   question. When it still lacks one, each follow-up is counted from the
   votes that exist: a follow-up with 4 votes for one option is decided,
   and every other follow-up is dropped as undecided, with its tally and
   the members without a vote. The question does not go to the person.
   This departs from the rule of SAL-205 in "Every member votes" for
   follow-ups questions only, and the owner decided it; every other
   question still goes to the person in that case.
6. **No rerun and nothing owed.** A follow-ups question never reruns, and
   a `NEW OPTION` line on it is ignored. Its decisions are owed to no pull
   request's review and are written into no spec: the session records
   them in the round's review, in its **Follow-ups** section, from the
   tally's answer, which gives each follow-up's decision, count and the
   reason of the first member, in the counsel's order, that voted for the
   chosen option.

### Edge cases

- **A split of 3 for drop, 3 for file and 1 for fix:** no option reached
  4, so the follow-up is dropped as undecided.
- **A member votes on three follow-ups and leaves out the fourth:** it has
  no vote, and is asked again once.
- **A follow-up with 4 votes for one option and a member still without a
  vote:** the follow-up is decided, because a missing vote can only take a
  vote away and cannot undo the four.
- **The counsel cannot sit:** the session asks the person once, with every
  follow-up in the one question.
- **A tally after the mod restarted:** counsel questions are kept only in
  the mod's memory, so the tally is refused as an unknown question, and
  the session puts the follow-ups to the counsel again.

### Not chosen

- **One question per follow-up.** A sitting of seven agents for each
  follow-up costs far more than one sitting for all of them.
- **Sending the question to the person when a member is still without a
  vote**, as SAL-205 does for other questions. One silent member would
  then send every follow-up of the round to the owner, including the ones
  that already have four votes, and the owner chose to count from the
  votes that exist instead.
- **A "Decided by the counsel" paragraph in the next review.** The
  session's **Follow-ups** section already records each decision with its
  count and reason, so a second record would only repeat it.

### Verification

Each of these is a mod test that fails if its change is removed:

- A brief with three follow-ups numbers them, gives the three options, asks
  for one vote and one reason per follow-up, and holds no lean.
- A call with both `options` and `follow_ups`, with an empty list, with
  more than twenty follow-ups, or with `pull_request` is refused and writes
  no brief.
- Seven members over three follow-ups decide each one on its own: one
  filed at 4 of 7, one dropped at 5 of 7, and one split 3, 3 and 1 dropped
  as undecided.
- The answer gives each follow-up's decision, count and the reason of the
  first member in the counsel's order that chose it.
- A member lacking a vote for one follow-up is asked again; when it still
  lacks it, a follow-up at 4 is decided, one below 4 is dropped naming the
  member, and the answer does not ask the person.
- A follow-ups question never reruns, and a `NEW OPTION` on it is ignored.
- A decided follow-ups question owes nothing to any pull request's review.
- The pane lists a follow-ups question with each follow-up's tally and
  decision.

The seven agent files, the pilot README and `skills/implement/SKILL.md`
describe follow-ups questions. No gate reads them, so the reviewers check
them.

## Decided by the counsel

These lines were written before 2026-10-14 and keep the decision sentence's
old shape, "The counsel chose X, n of m.", as the record of what was written
at the time. Decisions recorded since then use the shape rule 7 of
"Abstentions" gives.

- When a member answers VOTE: abstain and also writes a NEW OPTION line, what happens to the proposed option? The counsel chose Ignore the proposal: an abstaining member said it cannot judge the question, so it does not propose options either. Only a VOTE: none can carry a NEW OPTION, as today., 6 of 6.
- When the counsel decides with some members abstaining, how should the one-sentence decision (told to the person, written in the spec's "Decided by the counsel" section and in a review's decision paragraph) state the count? The counsel chose Count against the members who took part and name the abstainers: "The counsel chose X, 3 of 4; performance-reviewer and data-reviewer abstained.", 4 of 6.
- In round 1, when fewer than three members took part (so the floor stops a decision) and a member who voted none proposed a new option, should the counsel rerun with the proposal added, or send the question straight to the person? The counsel chose Rerun as today: any round 1 that does not decide and has a fitting proposal goes to round 2, whatever the reason it did not decide. The new option may bring abstainers back in., 4 of 6.
- Counsel members may no longer abstain (the person's decision for SAL-205). What should each reviewer's counsel-mode section and the brief tell a member to do when it believes the answer depends on what the person wants, or on a fact about their business that neither the brief nor the files give? The counsel chose Vote none, with a REASON saying that only the person can answer and why. Enough none votes keep the counsel from deciding, so the question reaches the person., 5 of 5; performance-reviewer abstained.

## Decided by the person

- The counsel decides when at least two thirds of the members who took part
  chose the same option, provided at least three took part. (Asked directly,
  because the counsel would otherwise vote on its own authority.)
- A member that failed, was stopped or gave an unreadable vote is treated as
  an abstention rather than as a vote against. (Asked directly, for the same
  reason.)
- SAL-205: members may no longer abstain. A member without a vote, whether
  it voted `abstain`, failed, was stopped or gave an unreadable vote, is
  asked again, and a second time without a vote sends the question to the
  person. This replaces the decision above that such a member is treated as
  an abstention. (Asked directly, for the same reason.)
- SAL-286, 2026-10-14: with seven members, the counsel decides when at least
  4 of the 7 vote for the same option, a strict majority, rather than two
  thirds, which would be 5. (Asked directly, because the question is about
  the counsel itself.)
