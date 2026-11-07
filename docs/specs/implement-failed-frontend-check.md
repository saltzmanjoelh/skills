# /implement treats a failed frontend check as no answer

Date: 2026-11-06.

## Goal

Step 7 of `skills/implement/SKILL.md` decides whether a change is frontend
from what two git commands print: `git show origin/<base>:CLAUDE.md`, for the
`Frontend paths:` line, and `git diff --no-renames --name-only
origin/<base>...HEAD -- <pathspecs>`, which finds the change frontend when it
prints a path. It never looks at their exit status. A failed command prints
nothing on standard output, so a session whose base branch was never fetched,
or whose project wrote a malformed glob, reads the failure as "not frontend"
and opens a user-interface change as a plain pull request, with no screenshots
and no notice that the check never ran. A failed read of `CLAUDE.md` likewise
reads as "no `CLAUDE.md`" and falls through to the built-in list. The same
weakness sits in two places in `skills/implement/frontend.md` that decide the
same question later. This change makes a failed command give no answer instead
of an empty one, everywhere the skill decides whether something is frontend.

The issue came from the review of the change that made frontend detection the
default (see `implement-frontend-by-default.md`), where the counsel decided to
file it.

## Users/Trigger

A session running `/implement` reaches step 7 and opens the pull request.
Later, on a pull request opened as frontend, the same session makes a commit,
or opens the pull request the plain way because `/storypr` returned a reason
instead of screenshots. The base branch may never have been fetched since the
worktree was made, may have moved on, or the project's own `Frontend paths:`
list may hold a glob that git refuses.

## Behavior

1. **Fetch first.** Step 7 begins with `git fetch origin <base>`, before
   either read, so that a base branch that is readable but hours old does not
   give a silently wrong `Frontend paths:` line. A failed fetch at this point
   is not itself a stop: the reads go ahead, and only a failed read counts.
   Step 7 says why the fetch is there, so that a later reader does not delete
   it as redundant.
2. **A nonzero exit is no answer.** In step 7, a read whose exit status is not
   zero gives no answer, whatever it printed. Its empty output never means "no
   `CLAUDE.md`", "no `Frontend paths:` line" or "not frontend".
3. **A missing file is still an answer.** A base branch that has no
   `CLAUDE.md` still counts as having no `Frontend paths:` line, as today.
   Because `git show` exits nonzero both when the file is missing and when the
   base reference cannot be read, step 7 tells the two apart with a command
   that succeeds when the file is merely missing, such as
   `git ls-tree --full-tree --name-only origin/<base> -- CLAUDE.md`, which exits
   zero and prints nothing when the file is absent. Only a successful command that
   shows the file is missing counts as "no `CLAUDE.md`".
4. **One more try.** When a read in step 7 gives no answer, the session runs
   `git fetch origin <base>` again and repeats that read once.
5. **Then ask, and open nothing.** When the read still gives no answer, the
   session opens no pull request and pushes nothing. It asks the person with
   `AskUserQuestion`, in the form **Questions** gives, saying which command
   failed and what git printed on its standard error, with these options: wait
   while they fix the cause and then run step 7 again, which is the one
   recommended; open the pull request as frontend through `/storypr`; or open
   it the plain way, which the question says skips the frontend check. No
   pull request exists yet, so no `needs-decision` label is put on anything.
   When the person picks one of the two ways of opening, the session follows
   it as step 7 would for that answer; when they say the cause is fixed, it
   runs step 7 again from its fetch.
6. **The per-commit check takes the side that loses nothing.** On a pull
   request opened as frontend, the `git diff --cached --no-renames
   --name-only` check that `frontend.md` runs before every commit gives no
   answer when it exits nonzero. The session fetches the base and runs it
   once more. When it still fails, the session treats the commit as touching
   a frontend path and retakes the screenshots as that section says, tells
   the person in one sentence that the check could not run, and carries on
   without asking.
7. **The `/storypr` fallback takes the side that loses nothing.** When
   `/storypr` returns a reason and `frontend.md` reads the base branch's
   `CLAUDE.md` again to choose the `## Screenshots` note, a read that gives no
   answer after one more fetch and try is treated as if the built-in list
   applies, and the section also says that the project's `Frontend paths:`
   line could not be read. The session tells the person the same in one
   sentence and carries on without asking. That sentence in the body follows
   the rule for published reasons: plain words, no raw error output, no local
   path.
8. **A failed read does not say `none`.** Where step 7 defines when the base
   branch's `CLAUDE.md` "says `Frontend paths: none`", it adds that a read
   that gives no answer does not say it. Every condition that uses the phrase,
   in `SKILL.md` and in `frontend.md`, therefore keeps the screenshot rules on
   when its read fails.

## Edge cases

- The base has no `CLAUDE.md` at all: point 3 makes this an answer, so the
  built-in list applies as today and nobody is asked.
- The session is offline: the first fetch fails silently, and the reads still
  succeed from the local copy of the base, so step 7 goes on as today with
  that copy. Only when a read also fails does the second fetch fail too, and
  the person is asked.
- A project glob with unknown pathspec magic, such as `:(glbo)web/**`, makes
  `git diff` exit 128 and print `Invalid pathspec magic`. A fetch cannot fix
  it, so the person is asked and sees git's message. A glob with an unclosed
  `[` does not make git fail, and is not covered.
- A malformed project glob on a frontend pull request fails the per-commit
  check on every commit, so every such commit retakes the screenshots and the
  person is told each time, until the project fixes its line.
- The session's shell is in a subfolder of the worktree: `git diff` and
  `git ls-tree` read their pathspecs relative to the current folder, so
  `git ls-tree --name-only origin/<base> -- CLAUDE.md` exits zero and prints
  nothing although the file exists, and the step 7 diff exits zero and prints
  nothing although a frontend file changed. Neither is a failure, so the exit
  status cannot catch it. Step 7 therefore runs its commands from the
  worktree's top folder, as `frontend.md` already does, and its `git ls-tree`
  passes `--full-tree`. This was measured on 2026-11-06 during planning.
- The person answers "open it the plain way": the body says nothing about
  screenshots, as for any plain pull request, because the person chose it
  knowing the check did not run.

## Non-goals

- The merge-fact read of `CLAUDE.md` in "The project's facts", which already
  says what applies when the file cannot be read, and which the builder
  mod's merge step fetches and reads again. It is offered as a follow-up.
- The `git log` and `git ls-tree` reads in `frontend.md` that build the
  screenshot list and settle `Screenshots not retaken:` lines. A failure there
  can drop a screenshot from the list. It decides something other than
  whether a change is frontend, and is offered as a follow-up.
- A general rule for every command in the skill whose empty output is read as
  an answer. The counsel chose to name the places that decide frontend
  status instead.
- The builder mod's code. Its merge step already fetches the base, and none
  of this changes its step texts.
- Telling a malformed glob apart from a missing reference before fetching.
  Both get the same fetch and retry, because the retry is cheap and git's
  message, which the person sees, already names the cause.

## Failure modes

- If the step 7 wording leaves the exit status implicit, a session still
  reads an empty failed diff as "not frontend", which is the defect itself.
- If "no `CLAUDE.md`" is still read from `git show`'s exit status, every
  failed read of the file looks like a missing file, or every missing file
  looks like a failure and stops the session for a question. Point 3 avoids
  both.
- If the per-commit check or the fallback asks the person instead, an
  unattended review round stalls on every commit; the counsel chose the side
  that loses nothing there for that reason.

## Verification

No gate reads `skills/` or `docs/`, so every point is checked by reading the
diff. A reviewer confirms that:

- step 7 starts with the fetch and says why;
- step 7 says a nonzero exit gives no answer, for both reads, and that the
  missing-file case is decided by a command that succeeds when the file is
  absent;
- step 7 retries once after a fetch and then asks with the three options,
  opening and pushing nothing;
- `frontend.md`'s per-commit check and its `/storypr` fallback each say what
  a failed read means, retry once after a fetch, and then take the side that
  loses nothing and tell the person in one sentence;
- the definition of "says `Frontend paths: none`" says a failed read does not
  say it.

The git behaviour this relies on was measured on 2026-11-06 in a scratch
repository: `git show <ref>:CLAUDE.md` exits 128 both for a missing file and a
missing reference; `git ls-tree --name-only <ref> -- CLAUDE.md` exits 0 with no
output for a missing file and 128 for a missing reference; `git diff
--name-only` exits 128 for a missing reference and for unknown pathspec magic,
and 0 for a glob with an unclosed `[`; `git fetch origin <base>` exits 128 when
the remote cannot be reached.

## Decided by the counsel

- Which commands should the new rule, that a nonzero exit status is "no answer" rather than an empty answer, cover? The counsel chose: Those two, plus the two places in skills/implement/frontend.md that also decide whether something is frontend: the fresh read of the base branch's CLAUDE.md in the /storypr fallback, and the per-commit `git diff --cached --no-renames --name-only` check that decides whether to retake screenshots. 6 of 7 members voted for it.
- In step 7, when either read still fails after fetching the base and trying once more, what should the session do instead of opening the pull request? The counsel chose: Ask the person with AskUserQuestion, giving git's error, with options such as: open it as a frontend pull request through /storypr, open it the plain way, or wait while they fix the cause and then run step 7 again. 7 of 7 members voted for it.
- When one of the two reads in skills/implement/frontend.md still fails after fetching the base and trying once more, what should the session do? The counsel chose: Take the side that loses nothing, without asking. For the per-commit `git diff --cached` check, treat the commit as touching a frontend path and retake the screenshots. For the /storypr fallback's fresh read of CLAUDE.md, write the section as if the built-in list applies but say that the project's line could not be read. Tell the person in one sentence either way, and carry on. 7 of 7 members voted for it.
- Should step 7 fetch the base before its first read, rather than only after a read fails? The counsel chose: Always run `git fetch origin <base>` at the start of step 7, before both reads, and still treat a nonzero exit as no answer, with one more fetch and retry after a failure. A failed fetch at the start is not itself a stop: the reads go ahead, and only a failed read counts. 7 of 7 members voted for it.
- What happens to the other reads of the base branch that also act on output from a command that may have failed: the "does not say `Frontend paths: none`" conditions, the merge-fact read of CLAUDE.md, and the git log and ls-tree reads that build the screenshot list? The counsel chose: The "does not say `Frontend paths: none`" conditions are in scope through one sentence where step 7 defines that phrase: a read that failed does not say it, so the screenshot rules keep applying. The merge-fact read and the screenshot-list reads stay out of scope as follow-ups. 7 of 7 members voted for it.
