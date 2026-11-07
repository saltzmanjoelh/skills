# The builder mod pins the frontend file and section it names

Written 2026-11-06. Seeded from an issue in the owner's tracker that the
counsel filed, 6 of 7, as a follow-up to the change that moved the frontend
rules of /implement into their own file (see
`docs/specs/frontend-screenshot-rules-follow-ups.md`).

## Goal

The merge bullet in `mergeLines` in `mods/builder/hooks/step.ts` tells a
session to read `skills/implement/frontend.md` and its section "Screenshots on
a frontend pull request". It names both in plain text, and nothing pins
either name, unlike every other skill section the step texts name. If the file
or the heading were renamed, every gate would still pass and the merge step
would send sessions to a section that no longer exists. Pin both names the way
the other skill sections are pinned, make a hand-written mention of the file
fail a test, and warn whoever edits the skill file that the mod names it.

## Users/Trigger

Whoever changes the merge bullet, the step texts, or the file
`skills/implement/frontend.md` and its headings. The bullet itself is read by
every session that reaches a merge step of the builder mod.

## Behavior

- `mods/builder/hooks/step.ts` gains, beside `SKILL_SECTIONS` and
  `CLEANUP_SECTIONS`:
  - an exported constant for the file's path, `skills/implement/frontend.md`;
  - an exported list `FRONTEND_SECTIONS` holding
    `Screenshots on a frontend pull request`, with a comment, like the others
    have, saying that a change to that heading or to the file's name has to be
    made here too, and the other way round;
  - a helper, typed to that list, that renders a reference as
    `"<section>" in `skills/implement/frontend.md``, with the path in
    backticks.
- The merge bullet names the file and the section only through that helper.
  The sentence is reworded around the quoted form, and keeps its meaning: on a
  frontend pull request, first read that section of that file, in the
  /implement skill's folder, again, and bring the screenshot section up to
  date as it says. The rest of the bullet is unchanged.
- A new test in `mods/builder/tests/step.test.ts`, beside the other pinning
  tests, goes over the text of every step and:
  - extracts every name in the helper's form, requires at least one, and
    requires each to be in `FRONTEND_SECTIONS`;
  - requires that every occurrence of `frontend.md` in each step text lies
    inside a match of the helper's form, so a mention written any other way,
    such as the bold form used today, fails the test.
- `skills/implement/frontend.md` gains one sentence in its opening paragraph,
  written as a note for whoever edits the file: the builder mod's merge step
  names this file and its section "Screenshots on a frontend pull request" by
  these names, so renaming either means changing `FRONTEND_SECTIONS` and the
  path beside it in `mods/builder/hooks/step.ts` too.

## Edge cases

- The existing test for sections of /implement extracts `"<name>" in
  /implement`. The new form puts `` `skills/`` after `" in `, so that test does
  not see the frontend section, and the bullet's later words "in the
  /implement skill's folder" do not follow a closing quote, so they do not
  match either.
- The test in `mods/builder/tests/register.test.ts` that reads the rendered
  merge bullet looks for the substring `` `skills/implement/frontend.md` ``
  with its backticks, for `` `## Screenshots` ``, for
  ``does not say `Frontend paths: none` `` and for the closing sentence. The
  helper keeps the backticks, and the reworded sentence keeps the other three,
  so that test passes unchanged.
- No test can read `skills/`, so a heading renamed inside `frontend.md` still
  passes every gate. The sentence in `frontend.md` is the guard for that case,
  and only the reviewers check it.

## Non-goals

- No pin for the `## Screenshots` heading that step 7 writes into a pull
  request body, or for the phrase `Frontend paths: none`, which the same
  bullet also names in plain text. A follow-up issue is filed in the tracker
  asking whether those should be pinned too.
- No notes about pins in `skills/implement/SKILL.md` or
  `skills/cleanup/SKILL.md`.
- No check that every entry of `FRONTEND_SECTIONS` is named by some step text.
- No change to `SKILL_SECTIONS`, `CLEANUP_SECTIONS`, `SKILL_POINTS`, their
  helpers or their tests.
- No change to what the merge bullet tells a session to do, and no change to
  any other step text.

## Failure modes

The only failures are red tests, a gate that fails to compile, and a skill
sentence that a reviewer judges wrong. A step text that names an unpinned
frontend section, or mentions `frontend.md` outside the helper's form, fails
the new test.

## Verification

- With the merge bullet still written in today's bold form, the new test
  fails, because the mention of `frontend.md` is not inside a match of the
  helper's form.
- With the entry in `FRONTEND_SECTIONS` temporarily renamed, while the
  bullet still renders the old name in the helper's form, the new test fails.
  The entry is then restored.
- With the change in place, the new test passes, the test in
  `register.test.ts` passes unchanged, and every gate in the project's
  `CLAUDE.md` passes. The gates do not read `skills/implement/frontend.md`, so
  its sentence is checked only by the reviewers.

## Decided by the counsel

- How should the builder mod pin the name of skills/implement/frontend.md and its section "Screenshots on a frontend pull request", which the merge bullet in mergeLines (mods/builder/hooks/step.ts) names as plain text today? The counsel chose: A new exported list FRONTEND_SECTIONS in step.ts holding 'Screenshots on a frontend pull request', with a constant for the file path and a helper that renders both, and a new test in step.test.ts that every mention of frontend.md in any step text names the pinned file and only pinned sections. 7 of 7 members voted for it.
- In what form should the new helper write the frontend.md reference in the merge bullet, so that the new pinning test can pull the section name out of the step text? The counsel chose: Switch to a quoted form like the other pins: the helper renders `"Screenshots on a frontend pull request" in skills/implement/frontend.md`, the sentence is reworded around it, and the test extracts names with a regex for that form; the register.test.ts substring check still holds. 6 of 7 members voted for it.
- Since no gate can read skills/, should the change also put a note in the skill files, so that whoever renames frontend.md or its heading learns that the builder mod pins the name? The counsel chose: Also add one sentence to skills/implement/frontend.md, near its top, saying that the builder mod's merge step names this file and its section "Screenshots on a frontend pull request", so renaming either means changing FRONTEND_SECTIONS in mods/builder/hooks/step.ts too. 5 of 7 members voted for it.
- How strict should the new pinning test in mods/builder/tests/step.test.ts be about mentions of frontend.md in the step texts? The counsel chose: Stricter: the same, and also require that every occurrence of `frontend.md` in every step text is part of a match of the helper's form, so a mention in any other form fails the test. 7 of 7 members voted for it.
- What is out of scope for this change, given that the same merge bullet also names other skill phrases in plain text, such as the `## Screenshots` body heading and the `Frontend paths: none` wording? The counsel chose: Leave them out of this change, and file a follow-up issue in the tracker asking whether those phrases should be pinned too. 6 of 7 members voted for it.
