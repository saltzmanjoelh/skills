# Follow-ups to the frontend screenshot rules

Date: 2026-11-05.

Seeded from the issue that holds the six follow-ups the counsel filed from
the change that made `/implement` open a frontend pull request through
`/storypr` (see `docs/specs/implement-opens-frontend-prs-with-storypr.md`).

## Goal

The frontend rules of `/implement` have six gaps:

- **Every run pays for them.** About 1,300 words of frontend text sit in
  `skills/implement/SKILL.md`, which every run reads whole, even in a project
  with no `Frontend paths:` fact, where none of it applies.
- **The merge step never mentions screenshots.** The step text the builder
  mod sends for a merge does not point at the rule that brings the screenshot
  section up to date. A session that stopped between a push and the rewrite
  can therefore merge a body whose image links point at old commits.
- **The screenshot list is built wrongly.** It comes from the diff against
  the base, which causes two problems. A screenshot identical to the base's
  copy drops out of the body. A deleted or moved screenshot stays on the
  list, is written back, and its link never resolves.
- **A warning can stay for good.** A `Screenshots not retaken` line is
  settled only by a later change to the file, so a retake whose captures
  match the stored files leaves a wrong warning in the body forever.
- **`/storypr` can return nothing.** Its section for a calling skill returns
  no result when nothing ends up staged, so the caller can stall or link a
  commit that does not exist.

This change closes all six.

## Users/Trigger

A session running `/implement`:

- in any project, which should read the frontend text only when the
  project's base branch names a `Frontend paths:` glob;
- on a frontend pull request, whenever it commits, pushes, resumes, compacts
  or merges;
- calling `/storypr` at step 7.

## Behavior

1. **The frontend text moves to its own file.** Step 7's frontend
   paragraphs (from "**A frontend change.**" up to "## With the pull request
   open") and the section "**Screenshots on a frontend pull request.**" move
   word for word into `skills/implement/frontend.md`, under two headings of
   their own. The only changes are the ones points 3 to 5 make. `SKILL.md`
   keeps three things:
   - the `Frontend paths:` row of its facts table;
   - the rule that a line that is empty, or holds only commas and spaces,
     counts as missing;
   - a short pointer at each place that used the text: step 7, the screenshot
     section's place in "A review round", "When a turn ends", "Resuming" and
     "After a compaction".

   Each pointer says to read `skills/implement/frontend.md` (its section by
   name) when the base branch's `CLAUDE.md` names at least one glob under
   `Frontend paths:`. The pointer at the screenshot section names every
   moment the rule applies, and says to read the file again at that moment:
   - before making a commit;
   - after a push;
   - on resuming;
   - after a compaction;
   - before running the merge command.

   With the fact missing or empty, nothing in `SKILL.md` asks the session to
   read the file.
2. **The merge step points at the rule.** The builder mod's shared merge
   lines (`mergeLines` in `mods/builder/hooks/step.ts`) gain one
   always-present bullet under "Before merging:". It comes before the bullet
   that reads the pull request again. It says what to do on a frontend pull
   request, meaning one whose body has a `## Screenshots` section and whose
   fetched base branch's `CLAUDE.md` names a `Frontend paths:` glob: bring
   the screenshot section up to date first, as `skills/implement/frontend.md`
   says. It also says that a pull request without such a section skips the
   bullet. Both the merge step and the step that asks about merging without
   checks carry it. A test in `mods/builder/tests/register.test.ts` checks
   the rendered text of both.
3. **A `Screenshots:` line records each capture.** Every commit that
   captures screenshots carries, after a blank line and outside the round's
   lists, a line `Screenshots: <path>, <path>` that names every screenshot
   the commit captured, including any whose file came out identical to the
   stored one. That covers the commit `/storypr` makes and every commit that
   retakes them. A retake whose captures all match the stored files changes
   no file, but the commit it rides in still carries the line.
4. **The screenshot list.** The screenshots of a pull request are the union
   of two sources, kept only when the file exists at the head under the
   screenshot directory:
   - the paths named on the `Screenshots:` lines of
     `git log --format=%B origin/<base>..<head>`;
   - the files that
     `git log --no-renames --diff-filter=AM --name-only --format= origin/<base>..<head> -- '<screenshot directory>'`
     prints.

   The second source keeps pull requests opened before this change, and
   screenshots pushed without the line. The rule says so, so that a later
   tidy-up does not drop it as redundant. Existence is checked against
   `git ls-tree -r --name-only <head> -- '<screenshot directory>'`. A name
   from a commit message is kept only when it appears in that listing word
   for word, so message text never reaches a command or chooses a file on
   its own.

   The image link for a listed screenshot still uses the sha that
   `git log -1 --format=%H <head> -- '<path>'` prints. For a screenshot the
   pull request never changed, that is a commit on the base branch, which
   holds the file, so its link resolves.
5. **The settled rule.** A commit that carries a `Screenshots not retaken:`
   line is settled when every screenshot its line names is named on a
   `Screenshots:` line of a later commit of the pull request, or was changed
   by a later commit. A line for screens never captured is still never
   settled.
6. **`/storypr` always returns a result.** Its section for a calling skill
   splits the case where nothing ends up staged by its cause:
   - When every screenshot failed the check for credentials and personal
     details, or none could be kept, it commits nothing, writes no body and
     returns a reason, exactly as when no capture path works.
   - When the captures passed but every file is identical to the stored one,
     it makes the commit with `git commit --allow-empty` so that it carries
     the `Screenshots:` line, and returns its sha as usual.

   In every case, the commit it makes carries the `Screenshots:` line of
   point 3.
7. **Inert lines.** The sentence that calls a commit carrying screenshots
   never inert also covers a commit whose only screenshot record is a
   `Screenshots:` line. That commit is never inert either, because it changes
   the screenshot list.

## Edge cases

- A pull request opened before this change has no `Screenshots:` lines. Its
  list comes from the second source of point 4, so its images stay.
- A screenshot that is moved shows under `--no-renames` as a deletion and an
  addition. The new path is listed, and the old one fails the existence check.
- A screenshot deleted at the head fails the existence check and leaves the
  list, even when a `Screenshots:` line named it.
- A commit message that names a path outside the screenshot directory, or one
  that does not exist, matches nothing in the `git ls-tree` listing and is
  ignored.
- On a mixed capture, where some files changed and others are identical, the
  commit stages the changed files and its `Screenshots:` line names all of
  them.
- A merge commit from the base branch brings in no screenshots of the base,
  because `git log` without `-m` lists no files for a merge.

## Non-goals

- `/storypr`'s standalone use, including its branch-name image links.
- `README.md`.
- Adding `Screenshots:` lines to pull requests that are already open.
- Any change to the builder mod beyond the one merge line.
- Rewording or shortening the moved text beyond what points 3 to 5 change.
- Settling a `Screenshots not retaken` line for screens never captured.
- Reading the screenshot list, or anything else, from the pull request body.

## Failure modes

- The session never reads `frontend.md` on a frontend project. Each pointer
  states the condition and the moments, and the merge step repeats the
  condition at the merge, which is the moment that cannot be repaired later.
- A commit that retakes screenshots forgets its `Screenshots:` line. A
  changed file still reaches the list through the second source of point 4,
  and a retake that changed nothing leaves its warning standing, which a
  person can see.
- `/storypr` finds nothing to keep. The caller gets a reason and opens the
  plain way, as it already does when capture fails.

## Verification

No gate reads `skills/` or `docs/`, so the skill changes are checked by
reading the diff. The mod change is checked by its gates.

- `skills/implement/frontend.md` holds the two moved passages. Leaving aside
  the changes of points 3 to 5, they match the removed lines of `SKILL.md`
  word for word.
- `SKILL.md` keeps the `Frontend paths:` row and the empty-line rule. It
  points at `frontend.md` from step 7, from the screenshot section's place,
  from "When a turn ends", from "Resuming" and from "After a compaction",
  each with the condition. The screenshot pointer names every moment from
  point 1.
- `SKILL.md` is shorter by roughly the moved text, about 1,300 words.
- In `frontend.md`, the list rule uses the union and the existence check of
  point 4, the settled rule is the one of point 5, and the retake rule asks
  for the `Screenshots:` line.
- `skills/storypr/SKILL.md`'s caller section writes the `Screenshots:` line,
  makes an empty commit for identical captures, and returns a reason when
  nothing passed. Its other sections are unchanged.
- The builder mod's merge text and its text for asking to merge without
  checks both carry the screenshot bullet before the bullet that reads the
  pull request again. A test asserts that bullet in both texts, and the four
  gates pass.
- No added line names a project, client, product, person or issue number.

## Decided by the counsel

- How should /implement stop every run from reading the frontend text (step 7's "A frontend change" paragraphs and the section "Screenshots on a frontend pull request", about 1,300 words) when the project has no `Frontend paths:` fact? The counsel chose: Move both passages into a second file beside the skill, skills/implement/frontend.md, and leave in SKILL.md a short pointer at each place: read that file only when the base branch's CLAUDE.md has a Frontend paths: fact that names at least one glob. 6 of 7 members voted for it.
- How should the frontend rules work out which screenshots a pull request has, and when a "Screenshots not retaken" line is settled, so that a screenshot identical to the base copy stays in the body, a deleted or moved screenshot leaves the list, and an out-of-date line clears after a retake whose captures match the stored files? The counsel chose: Record it in commit messages. Every commit that captures screenshots (the commit /storypr makes, and every commit that retakes them) carries a line `Screenshots: <path>, <path>` naming every screenshot it captured, including ones identical to the stored file. The list is every path named on such a line in the pull request's commits that still exists at the head under the screenshot directory. A Screenshots not retaken line is settled when every screenshot it names is named on a Screenshots: line of a later commit or changed by a later commit. A retake whose captures match makes no change to the files but its commit still names them. 5 of 7 members voted for it.
- How should the merge step point the session at the rule that brings a frontend pull request's screenshot section up to date before running the merge command? The counsel chose: Change the builder mod: add one line under "Before merging:" in the shared merge lines (mods/builder/hooks/step.ts, mergeLines), always present, saying that on a frontend pull request (its body has a `## Screenshots` section and the base branch's CLAUDE.md names a Frontend paths: glob) the session first brings the screenshot section up to date as skills/implement/frontend.md says, with a test of the rendered text. 6 of 7 members voted for it.
- What should /storypr's section "When another skill calls it" return when nothing ends up staged for its screenshot commit? The counsel chose: Split the two causes. When every screenshot failed the credential and personal-details check, or none could be kept, commit nothing, write no body, and return a reason, exactly as when no capture path works, so /implement opens the plain way with a Screenshots section saying why. When the captures passed but every file is identical to the stored one, make the commit with git commit --allow-empty so it still carries the Screenshots: line naming them, and return its sha as usual. 7 of 7 members voted for it.
- What is in and out of scope, and in particular should the screenshot list also count files that the pull request's commits added or modified, so that a pull request opened before this change (which has no Screenshots: lines) or a screenshot pushed without the line keeps its images? The counsel chose: The list is every path named on a Screenshots: line, together with every file under the screenshot directory that a commit of the pull request added or modified (git log --no-renames --diff-filter=AM --name-only over origin/<base>..<head>), kept only when it exists at the head. Out of scope: /storypr's standalone use, README.md, adding Screenshots: lines to existing pull requests, any mod change beyond the one merge line, and rewording the moved text. 7 of 7 members voted for it.
