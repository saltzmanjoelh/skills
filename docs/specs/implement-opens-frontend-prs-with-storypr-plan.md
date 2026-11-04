# Plan: /implement opens a frontend pull request with /storypr

Date: 2026-11-04. Spec: `implement-opens-frontend-prs-with-storypr.md`.

## Chosen approach

The simplest of three plans won. It is the only one that stays inside the
spec, and it adds the fewest words to `skills/implement/SKILL.md`, which
every run of `/implement` reads (about 800 words after the grafts, against
about 10,300 today). It keeps no new state. The pull request body and git
hold everything:

- A pull request was opened as frontend when its body has a
  `## Screenshots` section, which the plain body never writes.
- The screenshots to retake are the paths that the body's image links name.
- The sha each link should carry is the newest commit on the pull request
  that changed that file, which `git log -1 --format=%H <head> -- <path>`
  prints.
- The reason a retake failed is a line in the fix commit's message, so it
  outlives a restart before the push.

The edits are:

1. A `Frontend paths:` row in the facts tables of `skills/implement/SKILL.md`
   and `README.md`, with the default `none; no change is frontend`.
2. In step 7 of `/implement`, one lead sentence before the existing
   paragraph, which stays word for word, and one new paragraph after it for
   a frontend change.
3. In "A review round" of `/implement`, after the Retag paragraph and before
   "A streak of 3", a rule in three short paragraphs: when it applies and
   the retake, what happens after a push, and a failed retake.
4. In "When a turn ends", one sentence that sends the session to that rule
   after any push to a frontend pull request.
5. A new last section of `/storypr`, `## When another skill calls it`.

## Grafts from the runners-up

- **`--no-renames` in both frontend tests** (from the most robust plan). A
  test in a throwaway repository showed that `git diff --name-only` with a
  pathspec reports a rename only under its new path, so a file moved out of
  a frontend path was missed. The spec now names the flag.
- **The lead sentence before step 7's existing paragraph** (from the robust
  and extensible plans). That paragraph tells the session to push and open,
  so the session must learn first that a frontend change opens another way.
- **The sentence in "When a turn ends"** (from the robust plan). The builder
  mod sends the session there after every push, including the push of a
  blocking fix, and never to the review-round paragraph, so without it the
  body could be left with old links.
- **The `Screenshots not retaken: <paths>: <reason>` line in the commit
  message** (from the extensible plan), after a blank line and outside the
  round's lists. The package's list reader skips a line that does not begin
  with `- ` inside a list and matches only the labels it knows, so the line
  cannot be read as a list item or a fix line.
- **The test on a later commit** (from the extensible plan):
  `git diff --cached --no-renames --name-only -- <pathspecs>` on the staged
  change, run before any screenshot is staged, so that a screenshot never
  makes its own commit frontend.
- **The required leading lines** (from the extensible and robust plans). The
  frontend paragraph writes at the top of the body file any lines that the
  project's `CLAUDE.md` says the body must begin with, as step 7 already
  does for a plain body.
- **`--title` on `gh pr create`** (from the robust plan). Without a prompt,
  `gh pr create` refuses to run unless it gets a title.
- **Redirects in the link check** (from the robust plan). An anonymous
  request for a `blob/<sha>/<path>?raw=true` link is answered with a
  redirect, so the check uses `curl -sL`, or `gh api` with the sha as the
  ref for a private repository. This goes in `/implement`, because
  `/storypr`'s standalone steps do not change.

## Rejected alternatives, with reasons

- **One new `## Frontend changes` section with pointers from five places**
  (the extensible plan). It is tidy, but it costs more words and one more
  jump for the reader than two insertions.
- **A second "retake" mode in `/storypr`** (the extensible and robust
  plans). The spec gives `/storypr`'s caller section one contract. A retake
  is done by `/implement` following `/storypr`'s step 2.
- **Reading the fact from the base branch** (the robust plan). It is a
  product decision the spec does not make, and it would stop a pull request
  that first adds the fact from taking screenshots of itself.
- **A fixed marker sentence, a refusing placeholder, and a read-back of each
  body edit** (the robust plan). The `## Screenshots` heading, the link shas
  and `git log` already rebuild the state, and the extra machinery has
  failure cases of its own. The robust plan's other idea here, running the
  up-to-date check on resuming, after a compaction and before the merge, was
  rejected at first and then adopted in review: the state can be rebuilt, but
  without those runs nothing rebuilds it when a session stops between a push
  and the rewrite.
- **Replacing a link that keeps failing with a sentence** (the robust plan).
  The spec's failure mode says to fix the path or the sha.
- **A `strings` pass over each PNG, a pixel check for personal data, a
  demo-data rule and capture time limits** (the robust plan). The spec asks
  only that the existing credential check include the screenshot commit.
  The pull request says plainly that this check reads text, so `/storypr`'s
  reading of each screenshot is the only check of what it shows.
- **A guard against opening a second pull request** (the robust plan). The
  plain step 7 has the same window between its push and `gh pr create`, so
  it is outside this change.
- **A screenshot folder for each branch** (raised and set aside by the
  extensible plan). The spec overwrites files at their paths.

## Step sequence

1. Add the facts row to `skills/implement/SKILL.md` and `README.md`.
2. Add the lead sentence and the frontend paragraph to step 7.
3. Add the screenshot rule to "A review round" and the sentence to "When a
   turn ends".
4. Add `## When another skill calls it` to the end of `skills/storypr/SKILL.md`.
5. Commit in coherent steps, staged by path, after the name check.

## Test plan, one entry for each Verification bullet

No gate reads `skills/`, `docs/` or `README.md`, so each entry is checked
by reading the diff, and the report says so.

1. The facts row in `skills/implement/SKILL.md` has the default none, and
   step 7's frontend paragraph holds the pathspec command with
   `--no-renames`.
2. `git diff` of step 7 shows the existing paragraph with no removed or
   changed line.
3. The frontend paragraph, read in order, calls `/storypr`'s caller section,
   checks for credentials including the screenshot commit before the push,
   fills in the full sha after the push, opens with `gh pr create
   --body-file`, checks the links and watches.
4. The frontend paragraph says what the body and the session say when
   `/storypr` returns a reason, and that the session does not wait.
5. The review-round rule says the retake goes in the same commit, the
   section is rewritten with sha links after the push, and a failed retake
   leaves an out-of-date line.
6. `git diff` of `skills/storypr/SKILL.md` shows only lines added at the
   end, and the new section stages by path, writes to the scratchpad, never
   pushes, creates or edits a pull request or asks the person, and returns
   the three values or a reason with nothing committed.
7. The README row matches the skill's row.
8. The name check on the staged diff prints nothing, and every added line
   is reread for names.
