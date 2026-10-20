# Plan: the counsel decides before the person is asked

Spec: `docs/specs/pilot-counsel.md`. Written 2026-10-07.

## Chosen approach

The plan written for extensibility won, trimmed of its generality and with
five ideas taken from the other two plans. All of the counsel's rules live in
one new pure module, `mods/pilot/hooks/counsel.ts`, with its own test file.
`register.tsx` only checks input, writes the brief, keeps the questions in an
atom and the decisions owed to a review in `$.store`, and serves the two
tools. Each tool's answer says what the session does next (what to launch,
what to tell the person, what to record), so the skills can say "follow what
the tool answers" instead of restating the rules.

- **State.** A new atom, `counsel`, holds the newest 20 questions for the
  pane. Like the mod's other session state (`questions`, `agents`, `wakes`),
  the questions live in an atom, not in `$.store`: a restart in the middle of
  a vote costs one re-ask, which does not justify a stored record. A decision
  made while a pull request is watched is different, because a restart, or
  another session posting the next review on that pull request, must not lose
  it. Each such decision is kept in `$.store` under its own key,
  `counsel-owed:<repo>#<number>:<session id>:<question id>`, holding its line
  and when it was made. It is one key per decision, not one list per pull
  request, because the store has no atomic update, so two sessions reading and
  writing back a shared list would erase each other's decisions. A session
  start prunes each key ninety days after its decision was made, since it cannot tell a closed pull request from one still waiting for a review.
- **The brief folder.** `<git dir>/pilot/counsel/<session id>/<id>/brief.md`, found from
  the `cwd` atom (the session folder) so it works with no pull request
  watched, as during `/spec`. It sits beside the review packages, is never
  committed and goes away with the worktree. One helper, `gitDirOf`, finds
  the git folder for both the briefs and the review packages. The session id
  in the path keeps two sessions in one checkout apart, and a new question
  takes the first id whose folder holds no brief, so a restarted session
  never writes over an earlier brief.
- **The lean stays out of the brief by type.** `briefText` takes the
  question without its `lean` field (`Omit<CounselQuestion, 'lean' | ...>`),
  so the compiler refuses a brief that could contain it.
- **The review paragraph is written by the mod.** A question put while a
  pull request is watched and its last known state is open records that pull
  request, and its decision is stored under that pull request's keys. The
  pull request is settled when the question is put, not when it is tallied,
  so a watch that moves on while the counsel sits does not move the decision,
  and a question put after the watched pull request merged or closed, such as
  one in the `/spec` interview for the next issue, is recorded in the spec. When `post_review` posts, the mod
  lists every key under the pull request (the prefix ends with a colon, so #1
  does not take #12's keys), appends a paragraph of their lines after the
  secret check runs on the session's own body, and deletes only the keys it
  listed, and only after gh says the post succeeded. A decision line that
  looks like it holds a secret is replaced by a sentence saying one was left
  out. Questions decided during `/spec`, with nothing watched, are already
  recorded in the spec and so never appear in a review.

## Grafted from the other plans

- **The tally input carries the round number** (most-robust plan). It is the
  only way to refuse a round-1 tally sent again after a rerun, which the
  spec's "a round that was already tallied" edge case needs.
- **New options come only from members who voted `none`, are
  de-duplicated against each other and the existing options, and existing
  options keep their numbers** (most-robust plan). Renumbering would change
  what a member's `VOTE:` line means.
- **The round-2 brief shows no round-1 votes or reasons** (most-robust plan),
  because the spec's non-goals say members never see each other's votes.
- **Brief paths go through the existing `documentPath` guard** (most-robust
  plan), so a member is never sent outside the checkout. `documentPath`
  answers null for a missing file too, so the tool checks containment
  separately and lists a path inside the checkout that does not exist yet as
  "not written yet": during `/spec` the spec often is not.
- **Refusals record nothing, and the brief is written before the record**
  (simplest plan). A failed write answers "the counsel could not sit; ask the
  person directly", which is the spec's first failure mode.

## Rejected alternatives, with reasons

- **`$.store` persistence of the questions themselves, with a promise queue**
  (most robust). A question in the middle of a vote costs one re-ask after a
  restart, so only the decisions owed to a review are stored, and one key per
  decision needs no queue.
- **A `DECIDING_SHARE` fraction with `Math.ceil`, and rebuilding `REVIEWERS`
  from a new members list** (most extensible). The spec fixes six members
  and four votes; a constant `COUNSEL_NEEDED = 4` says so plainly, and the
  existing `REVIEWERS` set is the member list.
- **Splitting `packageDir`** (most extensible). It changes code the counsel
  does not need to change.
- **The session writing the review paragraph from skill prose** (simplest).
  Nothing would record which decisions were already reported, so the
  paragraph would be forgotten or repeated.
- **Rules split between `state.ts` and `review.ts`** (simplest). Those files
  describe other jobs, and the counsel's rules are bigger than `state.ts`.
- **A `stage` field on each question** (most robust). Recording the watched
  pull request, and storing the decision under it until a review lists it,
  gives the same answer without a new state on the question.

## Shapes

- `CounselVote = { member: string; vote: number | null; reason: string; newOption?: string }`,
  where `null` is a vote for no option.
- `CounselTally = { round: 1 | 2; votes: CounselVote[]; counts: number[]; outcome: 'decided' | 'rerun' | 'ask'; chosen?: number; proposed: string[] }`.
- `CounselQuestion = { id; question; options: string[]; background; paths: string[]; lean; folder; round: 1 | 2; tallies: CounselTally[]; pr?: { repo; number } }`.
- The tally tool takes `id`, `round` and `votes: [{ member, vote, reason, new_option? }]`,
  where `vote` is the text after `VOTE:` as reported; a member that failed is
  left out.

## Steps

1. Write `tests/counsel.test.ts` and the new cases in `tests/register.test.ts`
   and `tests/pane.test.ts`, and see each fail.
2. Add the types, then `hooks/counsel.ts`.
3. Wire the two tools, the atom, the brief helper and the review paragraph
   in `register.tsx`; draw the counsel lines in the pane, including when
   nothing is watched.
4. Add the "Counsel mode" section to the six reviewer files.
5. Change `skills/spec/SKILL.md`, `skills/implement/SKILL.md` and the pilot
   README.
6. Run the gates from `mods/pilot`: `npx -y -p typescript@5.6.3 tsc -p . --noEmit`,
   `claude plugin test .` and `claude plugin validate .`.

## Tests

Each maps to a bullet of the spec's Verification section.

- `counsel.test.ts`:
  - 4 of 6 for one option decides it, and 3 of 6 does not.
  - A 3-and-3 tie with no proposal answers ask.
  - Two missing members and one unreadable vote count against.
  - Round 1 with no decision and a proposal from a `none` voter answers
    rerun. The options keep their numbers, the list grows to six at most,
    the earliest proposals come first, and duplicates are dropped.
  - Round 1 that decides keeps its proposals as shown only.
  - Round 2 never answers rerun, and a new option there counts against.
  - The round-1 and round-2 briefs never contain the lean, and the round-2
    brief has no round-1 reasons.
  - The ask order is by votes, most first, at most four, with the last
    round's proposals added while there is room.
  - Refusals:
    - fewer than two options or more than four;
    - an unknown member or a member named twice;
    - more than six votes;
    - a vote naming option 0 or one past the last;
    - a round that is not the one the question waits on.
- `register.test.ts`:
  - With nothing watched, the counsel tool writes
    `/repo/.git/pilot/counsel/<session id>/<id>/brief.md` and answers with the id and
    folder.
  - A failed git lookup answers "could not sit" and records nothing.
  - The tally refuses an unknown id and a repeated round, recording nothing.
  - A rerun rewrites `brief.md` as round 2.
  - A subagent is refused both tools.
  - A decision tallied while a pull request is watched appears once in the
    next posted review and not in the one after it.
  - A question put after the watched pull request merged is answered with
    the spec instruction and stores nothing owed.
  - A question put while #7 is watched and tallied after the watch moves to
    #8 is owed to #7.
- `pane.test.ts`: the counsel lines with nothing watched show 20 of 22
  questions, newest first, with the tally per option, the outcome and the
  lean.
- Reviewer files, skills and README: checked by `grep` during verification
  for `## Counsel mode`, `VOTE:`, `REASON:`, `NEW OPTION:` and the skill
  sentences, because the tests run inside the engine against faked files.
