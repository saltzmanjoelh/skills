# The `Frontend paths: none` bullet skips only the frontend `git diff`

Date: 2026-11-07. Seeded from an issue in the owner's tracker that the counsel
filed, 4 of 7, in the review of the change that made frontend detection the
default (see `implement-frontend-by-default.md`).

## Goal

Step 7 of `skills/implement/SKILL.md` reads the base branch's `Frontend paths:`
line. Its bullet for the value `none` says "no change is frontend: run no
command below, and open the pull request the plain way, as the paragraph that
begins "Check the diff against the base" says". That paragraph sits below the
bullet and holds the push and `gh pr create`, so, read word for word, the
bullet forbids the very commands it sends the session to. A session that
follows it literally could stall or skip the push. The bullet should skip only
the frontend `git diff`, which step 7 calls the second read.

The retry paragraph further down has the same looseness about a read that was
skipped on purpose. It begins "When either read gives no answer", says "then
run both reads again", and later says "When a read still gives no answer, push
nothing and open no pull request". When a rerun's first read finds `none`, the
second read is skipped, and a literal reader could run it anyway or count it as
a read that gave no answer, then stop and ask the person for nothing.

## Users/Trigger

A session running `/implement` reaches step 7 in a project whose base branch's
`CLAUDE.md` says `Frontend paths: none`, or reaches the retry paragraph after a
read failed and the rerun's first read finds `none`.

## Behavior

Three wording edits in step 7 of `skills/implement/SKILL.md`, and nothing
else:

1. The `none` bullet's first sentence becomes: "When its value is the word
   `none`, in any case and alone on the line apart from spaces, no change is
   frontend: skip the second read, which is the `git diff` command below, and
   open the pull request the plain way, as the paragraph that begins "Check the
   diff against the base" says." The rest of the bullet is unchanged.
2. The retry paragraph begins "When a read that ran gives no answer, run `git
   fetch origin <base>` again, whether or not the first fetch succeeded, and
   then run the reads again, as the paragraphs above say, once, so the read
   that failed is repeated with a fresh `CLAUDE.md`."
3. The retry paragraph's later sentence becomes "When a read that ran still
   gives no answer, push nothing and open no pull request." The rest of the
   paragraph, its question and its options, are unchanged.

## Edge cases

- The first read fails and its rerun finds `none`: the rerun follows the `none`
  bullet, so the second read is skipped and the pull request opens the plain
  way.
- The phrase "does not say `Frontend paths: none`", which the builder mod's
  step texts and `mods/builder/tests/register.test.ts` pin, is not touched.

## Non-goals

- No change to the older specs `implement-frontend-by-default.md` and
  `implement-failed-frontend-check.md`, which describe the wording they shipped
  with.
- No change to `skills/implement/frontend.md`, the "Open the plain way" option,
  or any other passage of the skill.
- No test that reads the skill: the testing kit refuses to read
  `skills/implement/SKILL.md`.

## Failure modes

A rewording that still reads as forbidding the push, or as letting a skipped
read trigger the retry, would pass every gate, because no gate reads `skills/`.
Only the searches and the walk-through below, and the reviewers, catch it.

## Verification

Every gate in the project's `CLAUDE.md` runs and passes. None of them reads
`skills/`, so the report says they did not read this change.

Each search runs against `skills/implement/SKILL.md` only, because the older
specs keep the old phrases.

- These print nothing:
  - `grep -n "run no command below" skills/implement/SKILL.md`
  - `grep -n "When either read gives no answer" skills/implement/SKILL.md`
  - `grep -n "run both reads again" skills/implement/SKILL.md`
  - `grep -n "When a read still gives no answer" skills/implement/SKILL.md`
- These each print one line in step 7 (the phrases may wrap, so each search
  uses a part that sits on one line, and the full sentence is read in the
  diff):
  - `grep -n "skip the second read, which is the" skills/implement/SKILL.md`
  - `grep -n "When a read that ran gives no answer" skills/implement/SKILL.md`
  - `grep -n "run the reads again, as the paragraphs above say" skills/implement/SKILL.md`
  - `grep -n "When a read that ran still gives no answer" skills/implement/SKILL.md`

Walk through the three cases against the edited text:

- **The first read gives `none`.** The bullet tells the session to skip the
  second read and open the pull request as the paragraph that begins "Check the
  diff against the base" says, so it checks the diff, checks for credentials,
  pushes and runs `gh pr create`. No read that ran gave no answer, so the retry
  paragraph does not apply.
- **The first read fails and its rerun gives `none`.** The retry paragraph
  applies, because a read that ran gave no answer. It fetches again and runs
  the reads again as the paragraphs above say, so the rerun's `none` skips the
  second read. No read that ran still gives no answer, so the session opens the
  pull request the plain way.
- **A second read that ran fails twice.** The retry paragraph applies after the
  first failure, and after the rerun a read that ran still gives no answer, so
  the session pushes nothing, opens no pull request and asks the person with
  the three options.

## Decided by the counsel

- How should the `Frontend paths: none` bullet in step 7 of skills/implement/SKILL.md be reworded so that it no longer forbids the push and `gh pr create` that it points to? The counsel chose: Name the command by the name step 7 already gives it: "no change is frontend: skip the second read, the `git diff` command below, and open the pull request the plain way, as the paragraph that begins "Check the diff against the base" says." 6 of 7 members voted for it.
- Should the reworded `Frontend paths: none` bullet in step 7 also say outright that the retry paragraph ("When either read gives no answer...") does not apply when the second read is skipped? The counsel chose: Change the retry paragraph instead, so that it begins "When a read that ran gives no answer", which covers every caller of the paragraph rather than only the `none` bullet. 6 of 7 members voted for it.
- How exactly should the two decided rewordings in step 7 of skills/implement/SKILL.md be punctuated and carried through, given that two members warned that "skip the second read, the `git diff` command below, and open..." can be read as a list of three things? The counsel chose: Write the bullet as "skip the second read, which is the `git diff` command below, and open the pull request the plain way...", and also change the later sentence to "When a read that ran still gives no answer", so both sentences of the retry paragraph match. 7 of 7 members voted for it.
- What is out of scope for this change, given that the retry paragraph also says "then run both reads again", which is loose in the same way once the rerun's first read finds `none`, and that older specs describe the old wording? The counsel chose: Also change "then run both reads again" to "then run the reads again, as the paragraphs above say", so the rerun follows the same rules, including skipping the second read under `none`; leave the older specs as they are, because a spec records the change it shipped with; change nothing else. 7 of 7 members voted for it.
- How should this change be verified, given that no gate reads skills/ and the change is three wording edits to step 7 of skills/implement/SKILL.md? The counsel chose: Run every gate (they must still pass, and say they did not read the skill), and add to the spec's Verification section exact `grep` searches that show the old phrases "run no command below", "When either read gives no answer" and "run both reads again" are gone and the new phrases are present, plus a short walk through the three cases (first read gives `none`; first read fails and its rerun gives `none`; a second read that ran fails twice) saying what step 7 now tells the session to do in each. 7 of 7 members voted for it.
