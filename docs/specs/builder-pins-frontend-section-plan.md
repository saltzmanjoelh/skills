# Plan: the builder mod pins the frontend file and section it names

Written 2026-11-06 for `docs/specs/builder-pins-frontend-section.md`, from a
plan tournament with three planners: the simplest change, the most robust
change and the most extensible change. The judge chose the most robust plan,
and three ideas from the other two are grafted onto it.

## Chosen approach

`mods/builder/hooks/step.ts` gains, after `SKILL_POINTS`, an exported constant
`FRONTEND_FILE` holding `skills/implement/frontend.md`, an exported list
`FRONTEND_SECTIONS` holding `Screenshots on a frontend pull request`, and a
helper `seeFrontend`, typed to that list, that renders
`"<section>" in `skills/implement/frontend.md`` with the path in backticks. A
comment beside them says, as the comments on the other lists do, that a change
to the file's name or to one of its headings has to be made here too, and the
other way round.

The merge bullet in `mergeLines` stays a single-quoted string. The part that
names the file and the section becomes `first read the section ' +
seeFrontend('Screenshots on a frontend pull request') + ', in the /implement
skill\'s folder, again, and bring the screenshot section up to date as that
section says`. Everything else in the bullet is unchanged, and it does not
copy the words "step 7" from the skill, because the existing test of
`SKILL_POINTS` forbids "step N" in a step text.

A new test in `mods/builder/tests/step.test.ts`, beside the test of the
/cleanup pins, goes over every step text. It collects every match of the
hand-written regex ``/"([^"\n]+)" in `skills\/implement\/frontend\.md`/g``.
Inside the loop, it replaces every match with a null character and requires
that what is left holds no `frontend.md`. After the loop, it requires at least
one match, requires each name to be in `FRONTEND_SECTIONS`, and requires
`FRONTEND_FILE` to equal `skills/implement/frontend.md`.

`skills/implement/frontend.md` gains one sentence at the end of its opening
paragraph: a note for whoever edits the file that the builder mod's merge step
names this file and its own section "Screenshots on a frontend pull request"
by these names, so renaming either means changing `FRONTEND_FILE` and
`FRONTEND_SECTIONS` in `mods/builder/hooks/step.ts` too.

The change keeps no state. It adds constants, a pure helper, a test and a
sentence, so a restart, a resumed or cleared session, a hot reload and two
copies running at once all behave as they do today.

## Grafts

- From the simplest plan: to run the spec's check with the entry in
  `FRONTEND_SECTIONS` renamed, cast the helper's argument in the bullet
  `as never` for that run only. The helper is typed to the list, so without
  the cast the old name stops at a type error, and the test would never be
  seen failing for the reason the spec names.
- From the extensible plan: the note in `frontend.md` names `FRONTEND_FILE`
  as well as `FRONTEND_SECTIONS`, so whoever renames the file knows which
  constant holds its path.
- From the extensible plan: the bullet says "first read the section", which
  reads naturally before the quoted name.

## Why these details of the chosen plan

- Keeping the single-quoted string and joining the helper in with `+` leaves
  every existing `\'` escape and backtick of the bullet as it is. Turning the
  bullet into a template literal would mean escaping each inner backtick,
  which is easy to get wrong and makes the diff larger.
- "As that section says" cannot be read as pointing at the file, where "as it
  says" could.
- The note says "its own section" because the same opening paragraph says the
  sections it names belong to `SKILL.md`, and without "own" a reader could
  take this section for one of those.
- Each match is replaced with a null character rather than with nothing, so
  the text on either side of a match cannot join into a false `frontend.md`.
- The capture `[^"\n]+` cannot run across lines, and a quote that pairs wrongly
  captures a name that is not pinned, so the test fails rather than passing.
- The leftover check runs inside the loop, before the count of matches, so
  that against today's bold bullet the test fails on the leftover mention, as
  the spec's Verification says, and not on finding no match.
- The regex is written out by hand and tied to the constant by an equality
  assertion, so a rename of `FRONTEND_FILE` alone fails the test, and a stale
  hand-written old path in a step text is still caught.

## Rejected alternatives

- The simplest plan turned the bullet into a template literal. It was
  rejected for the escaping risk and the larger diff described above. Its
  empty-string replacement and its wording "as it says" were also weaker.
- The extensible plan built the test's regex from `FRONTEND_FILE`. That adds
  escaping code the spec does not ask for, and after a rename of the file the
  test would look only for the new path, so a stale hand-written mention of
  the old path would pass. That weakens the strict check the counsel chose
  7 of 7.

## Step sequence

1. Add `FRONTEND_FILE`, `FRONTEND_SECTIONS`, their comment and `seeFrontend`
   to `step.ts`, leaving the bullet in its bold form. The constants must exist
   before the test imports them, because an import of a missing export makes
   the whole test file fail to load, which proves nothing.
2. Add the test and run `claude plugin test .` from `mods/builder`. It fails
   on the leftover `frontend.md`.
3. Reword the bullet to use the helper. The new test passes, and the test in
   `register.test.ts` that reads the rendered bullet passes unchanged.
4. Rename the entry in `FRONTEND_SECTIONS` for one run, with the bullet's
   argument cast `as never`. The new test fails on the name that is not
   pinned. Restore both.
5. Add the sentence to `skills/implement/frontend.md`.
6. Run every gate in the project's `CLAUDE.md`, then the search for issue
   keys and pull request numbers on the staged diff.

## Test plan

| Spec Verification item | How it is shown |
|---|---|
| With the bullet in today's bold form, the new test fails | Step 2 |
| With the entry renamed and the bullet rendering the old name, the new test fails | Step 4 |
| With the change in place, the new test and the register test pass, and every gate passes | Steps 3 and 6 |

No gate reads `skills/implement/frontend.md`, so its new sentence is checked
only by the reviewers, and the report on the change says so.
