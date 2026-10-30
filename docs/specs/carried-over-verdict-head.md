# A carried-over review is not a verdict head

Written 2026-10-30. A follow-up that the counsel filed from the pull request
that made later review rounds cheaper (see `docs/specs/cheaper-review-rounds.md`).

## The incident

The change that made later review rounds cheaper starts a later package's
`diff.patch` at the verdict head, because both verdict reviewers read every
line up to it. It defined the verdict head as the newest commit with a
verdict review by the session's login, and said that a carried-over review
counts. A review is carried over when the check after approval, or an inert
cheap fix, lets the session copy both verdicts from the approved head to the
cheap-fix head that follows it. Only the adversarial reviewer read that
commit's code, and after an inert fix nobody did.

So when another commit lands after a carried-over head, for example after a
refused merge or a change the person asks for, the next round's
`diff.patch`, its sorting of changed files and its `Since:` line all start
after the cheap-fix commit. The spec reviewer never reads that commit's
code, and the reason the spec gives for starting at the verdict head is
false.

## Goal

The verdict head is always a head that both verdict reviewers actually read,
so a later round's reviewers see every line that the verdict reviewers did
not read together.

## Users and trigger

Every `/implement` session whose pull request gets a commit after a head that
a review was carried over to. The builder mod's package tool picks the
verdict head when it builds a later package.

## Behavior

- **A carried-over review** is a verdict review by the session's login with
  any line of its body beginning with `Both verdicts are carried over from `.
  That covers both openings `skills/implement/SKILL.md` gives the session,
  and an opening that sits under a heading or another line. A phrase quoted
  inside a sentence, a bullet or a quoted line does not begin a line, so it
  does not count.
- **The verdict head** is the newest commit of the pull request that has a
  verdict review by the session's login that was not carried over, other
  than the current head. Carried-over reviews are skipped wherever they sit
  in the list. The sha that a carried-over review names is never read.
- When every earlier verdict review at another head was carried over, there
  is no verdict head, and the package is a first package, as for a pull
  request with no verdict review.
- **Earlier rounds in a later package.** The review at the verdict head is
  repeated in full, and so is every carried-over review after it, because
  those hold the newest **Follow-ups** decisions, among them what the
  counsel filed or dropped from the check after approval. Every other review
  is one line with its head and its two verdicts, as today.
- `package.md` describes the verdict head as the newest head both verdict
  reviewers read, not as the newest head with a verdict review.
- Everything else that starts at the verdict head moves with it: the
  ancestor and merge checks, the reviewed head, the sorting of changed
  files, the `Since:` line, and whether the head is up for the check after
  approval.
- `docs/specs/cheaper-review-rounds.md` changes its definition of the
  verdict head and its rule for which earlier reviews are repeated in full
  to match, and so does the paragraph on the review package in
  `mods/builder/README.md`, which states the same two rules for the mod.

## Edge cases

- **A carried-over review followed by the next cheap-fix commit.** The
  verdict head is the approved head before the carried-over one, so two
  commits follow it and the head is not up for the check; it goes through a
  normal later round that reads both commits.
- **A review at the current head itself**, as when a head is packaged again,
  is still skipped as today, whether or not it was carried over, and is
  repeated as one line.
- **A carried-over review whose opening the session reworded** so that no
  line begins with the phrase counts as a normal review, which is the
  behaviour before this change. The skill's wording is not changed, so the
  session keeps writing the phrase the mod matches.
- **A normal review that a line beginning with the phrase misleads** is
  skipped, so the package starts at an older head and its `diff.patch` is
  larger. That is the safe direction.

## Non-goals

- Changing `skills/implement/SKILL.md`, the reviewer agents' instructions or
  any spec other than `docs/specs/cheaper-review-rounds.md`. What the session
  does and writes does not change.
- Recording a carried-over review in a structured way, such as a marker that
  `post_review` writes into the VERDICTS line, so that recognising one no
  longer depends on the session's wording.
- Reading or following the sha a carried-over review names.
- A real `/implement` run on a pull request whose check after approval
  carried the verdicts over.
- Any other follow-up of the earlier pull request.

## Failure modes

- If the opening is not recognised, the mod behaves as before this change
  for that review: the package starts after the cheap-fix commit. Nothing
  reports it, and no test can catch it, because the tests hold a copy of the
  skill's two openings rather than reading the skill. So the skill, that copy
  and the mod's pattern have to be changed together.
- If a normal review is wrongly recognised, the package starts at an older
  head or falls back to a first package. Reviewers read more, never less.

## Verification

Tests in `mods/builder/tests`, run by `claude plugin test .`:

- In `review.test.ts`, `verdictHeadOf` skips a carried-over review after an
  approved one and returns the approved head, for both openings the skill
  gives; it skips a carried-over review whose opening follows a heading; it
  does not skip a normal review whose bullet quotes the phrase; and it
  returns no verdict head when every review at another head was carried
  over.
- In `review.test.ts`, a later package repeats the review at the verdict head
  and the carried-over review after it in full and the older reviews as one
  line, and its reading line names the verdict head as the newest head both
  verdict reviewers read.
- In `register.test.ts`, the package tool, given an approved review at one
  head, a cheap-fix commit with a carried-over review, and one more commit,
  runs `git diff` and the changed-file listing from the approved head, writes
  that head on its `Since:` line, and does not say the head is up for the
  check after approval.

The gates in the project's `CLAUDE.md` run on the change. No gate reads
`docs/` or the README's wording, so those edits are checked only by the
reviewers.

## Decided by the counsel

- When the newest earlier verdict review was carried over to its head (its body opens "Both verdicts are carried over from <full sha>, ..."), which head should a later review package treat as the verdict head, so that diff.patch, the sorting of changed files and the Since: line start there? The counsel chose: Ignore the named sha: take the newest earlier verdict review that was not carried over, skipping every carried-over review in the list. 6 of 7 members voted for it.
- How should the builder mod recognise that an earlier verdict review was carried over, so that the verdict head skips it? The counsel chose: By any line of the body that begins with "Both verdicts are carried over from ". 5 of 7 members voted for it.
- Once the verdict head skips carried-over reviews, which earlier verdict reviews should a later package's "Earlier rounds" section repeat in full? The counsel chose: The review at the verdict head in full, and every carried-over review after it in full too, because those hold the newest Follow-ups decisions; every other review as one line. 7 of 7 members voted for it.
- What is out of scope for this change, beyond the builder mod's review.ts, its tests and the spec docs/specs/cheaper-review-rounds.md? The counsel chose: Everything else: skills/implement/SKILL.md, the reviewer agents' instructions and the other specs stay as they are, because what the session does and writes does not change; only the mod's choice of verdict head, its package text and the spec's definitions change. 4 of 7 members voted for it.
- How should the tests prove this change, given that a carried-over review is only ever posted in a real session after the check after approval? The counsel chose: Unit tests in mods/builder/tests/review.test.ts for verdictHeadOf (a carried-over review after an approved one is skipped, both wordings, a line after a heading, a quoted phrase inside a bullet that does not match, every other review carried over giving no verdict head) and for the package text and earlier rounds, plus one test in register.test.ts through the package tool asserting that diff.patch and the changed-file listing start at the approved head and that the Since: line names it. 7 of 7 members voted for it.
