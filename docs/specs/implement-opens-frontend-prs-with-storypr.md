# /implement opens a frontend pull request with /storypr

Date: 2026-11-04.

## Goal

Step 7 of `/implement` always opens the pull request with a plain
`gh pr create`, so a change that alters a screen, a page or a component
reaches review with a text-only body, and a reviewer has to run the branch to
see what changed. The `/storypr` skill already writes a body that tells the
story of a change with real screenshots of the running app, but `/implement`
never uses it. A project should be able to say which of its paths draw what a
person sees, and `/implement` should then open every change that touches
those paths with real screenshots, keep them true as review fixes land, and
never stall when screenshots cannot be taken.

## Users/Trigger

A session running `/implement` reaches step 7 in a project whose `CLAUDE.md`
holds a `Frontend paths:` fact, and the change's diff against the base
touches one of those paths. Later, the same session pushes a review fix that
touches one of those paths while the pull request is open.

## Behavior

1. **The fact.** `/implement` reads a new project fact, `Frontend paths:`,
   whose value is a comma-separated list of path globs, such as
   `Frontend paths: web/src/**, app/screens/**`. Its default is none. A
   change is frontend when
   `git diff --name-only origin/<base>...HEAD -- ':(glob)<glob>' …`, with one
   pathspec per glob, prints at least one path. A file the change adds,
   modifies, deletes or renames counts, because each of them changes what a
   person can see. With the fact missing or empty, no change is frontend, and
   step 7 runs exactly as it does today.
2. **Opening a frontend pull request.** At step 7, after the checks it
   already runs on the diff, `/implement` runs `/storypr` in its section for
   a calling skill (point 3). On success, `/implement` checks the diff that
   is about to be pushed for credentials, including the new screenshot
   commit, pushes, opens the pull request with
   `gh pr create --base <base> --body-file <the body file>`, and watches it,
   as step 7 does today. Right after the push, and before
   `gh pr create`, it puts the full sha of the screenshot commit into every
   image link of the body file, so each link has the form
   `https://github.com/<owner>/<repo>/blob/<full sha>/<path>?raw=true`. After
   opening, it checks that every image link resolves, as `/storypr`'s step 6
   describes, using the sha as the ref.
3. **The section for a calling skill in `/storypr`.** A new section of
   `skills/storypr/SKILL.md` says what `/storypr` does when another skill
   calls it. It reads the branch and captures real screenshots exactly as
   its steps 1 and 2 say, and checks each one by reading it. It commits the
   screenshots in one commit, staging each file by its path, never with a
   glob. It writes the body, laid out as its step 4 says, to a file in the
   session's scratchpad folder, never to a shared folder such as `/tmp`,
   with the image links holding a placeholder for the commit sha. It then
   returns the body file's path, the commit's sha and the list of screenshot
   paths. It never pushes, never creates or edits a pull request, and never
   asks the person anything. When no real capture path works, it commits
   nothing, writes no body, and returns the reason instead. Its standalone
   behaviour, the steps and conventions a person uses when calling it
   directly, does not change.
4. **When screenshots cannot be taken at opening.** When `/storypr` returns a
   reason, `/implement` opens the pull request the plain way, with a body
   whose `## Screenshots` section says that the change is frontend, that
   screenshots are missing, and the reason. It tells the person the same in
   one sentence in the session, and carries on without waiting for an
   answer.
5. **A later fix that touches a frontend path.** Whenever `/implement`
   commits to an open frontend pull request a change that touches a path
   matching `Frontend paths:` (a fix in a review round's first half, the
   fixes for a blocking verdict, or the cheap follow-ups commit), it first
   retakes the screenshots whose screens the change could alter, retaking
   all of them when it cannot tell, and puts the new screenshots in that
   same commit, staged by path, overwriting the files at their existing
   paths. After the push, it rewrites the body's `## Screenshots` section
   with `gh pr edit <n> --body-file <file>`, linking every image by the full
   sha of the commit that now holds it, and checks the links again. The
   retake adds no commit and no push of its own.
6. **When a retake fails.** When a retake for point 5 cannot capture real
   screenshots, the commit goes ahead without them, and after the push the
   body's `## Screenshots` section gains a line that names the screenshots
   that may now be out of date, the commit that changed their code, and the
   reason the retake failed. The session tells the person the same in one
   sentence and carries on.
7. **README.** The facts table in `README.md` gains a `Frontend paths:` row
   with its default, used by `/implement`.

## Edge cases

- A `Frontend paths:` line that is present but empty, or holds only commas
  and spaces, is treated as missing.
- A glob that matches nothing in the change leaves the change non-frontend;
  a glob that matches a file the change deletes makes it frontend.
- A change that becomes frontend only through a later fix, because the
  opening diff touched no frontend path, keeps its plain body; point 5
  applies only to a pull request that was opened as frontend.
- A frontend pull request whose opening capture failed (point 4) has no
  screenshots to retake, so a later frontend fix only adds the out-of-date
  line of point 6, naming the change's screens as never captured.
- The cheap follow-ups commit that carries new screenshots is never inert,
  because it changes frontend code and adds binary files, so it goes through
  the package tool as any such commit does today.
- When the push of a commit with new screenshots fails, the body is not
  rewritten, and "Commits the pull request lacks" applies as today.

## Non-goals

- The reviewers are not asked to check that a frontend pull request carries
  screenshots. The builder mod's reviewers read only the review package,
  which does not hold the pull request body, and the skills already write
  either screenshots or a note saying why there are none.
- The builder mod does not change. Its package tool keeps counting a PNG as
  a file that is not documentation; a commit that holds only screenshots
  happens only at opening, before any review, so nothing would use a new
  rule.
- `/storypr`'s standalone behaviour, including its branch-name image links,
  does not change.
- Deciding that a change is frontend without the fact, from the plan or the
  session's judgement.
- Removing old screenshots from the repository's history, or deleting
  screenshots of screens the change removed.
- Checking that a sha link still resolves after a squash merge and branch
  deletion; a merge commit keeps the sha reachable from the base, and that
  is the default merge command.
- Changing `/cleanup`, the merge command, or how the merge deletes branches.

## Failure modes

- No capture path works at opening: the pull request opens the plain way
  with a body that says screenshots are missing and why, and the person is
  told; nothing waits on them.
- A retake fails on a later fix: the fix lands, the body names the
  screenshots that may be out of date and why, and the person is told.
- An image link does not resolve after a push: the session fixes the path or
  sha in the body; it never declares the body done while a link fails.

## Verification

No gate reads `skills/`, `docs/` or `README.md`, so the change is checked by
reading it. Each statement below can be checked against the diff.

- `skills/implement/SKILL.md` lists `Frontend paths:` in its facts table with
  the default none, and step 7 says how a change is found to be frontend,
  using the pathspec command of point 1.
- With the fact missing or empty, step 7's text for a non-frontend change is
  the same as before this change.
- Step 7 for a frontend change calls `/storypr`'s section for a calling
  skill, checks for credentials before the push, fills in the full sha after
  the push, opens with `gh pr create --body-file`, checks the links and
  watches.
- Step 7 says what the body and the session say when `/storypr` returns a
  reason, and that the session does not wait for an answer.
- The review-round text of `/implement` says that a commit touching a
  frontend path retakes the screenshots in that same commit, rewrites the
  screenshot section with sha links after the push, and falls back to the
  out-of-date line when the retake fails.
- `skills/storypr/SKILL.md` has a section for a calling skill that stages by
  path, writes the body to the scratchpad folder, does not push, create or
  edit a pull request or ask the person, and returns either the body file,
  the commit sha and the screenshot paths, or a reason with nothing
  committed. Its other sections are unchanged.
- `README.md`'s facts table has the `Frontend paths:` row.
- No added line names a project, client, product, person or issue number.

## Decided by the counsel

- How should /implement decide that a change has a frontend part, so that it opens the pull request through /storypr with real screenshots instead of a plain `gh pr create`? The counsel chose: A new project fact in CLAUDE.md, `Frontend paths:`, listing path globs. A change is frontend when its diff against the base touches a path matching one of them. With the fact missing, no change is frontend, so every project behaves exactly as today until its owner opts in. 6 of 7 members voted for it.
- Once a frontend pull request is open with screenshots, what should /implement do when a later push (a review fix) changes files matching the `Frontend paths:` globs, so that the screenshots in the body may no longer match the code? The counsel chose: Retake the affected screenshots before committing the fix, put the new PNGs in the same fix commit, and after the push rewrite the body's screenshot section. No extra push. If the capture fails, fall back to the next option for that push. 7 of 7 members voted for it.
- How should /implement use /storypr at step 7, given that /storypr today stages screenshots with a glob, commits and pushes them without a credential check, writes the body to /tmp, runs `gh pr create` itself, returns no pull request number, and on a failed capture stops and asks the person? The counsel chose: Add a short section to /storypr for when another skill calls it: it captures the screenshots, checks each one, commits them staged by name, writes the body to a file in the session's scratch folder, and returns, without pushing, creating the pull request, or asking the person; on a failed capture it returns the reason instead. /implement then checks for credentials, pushes, runs `gh pr create --body-file`, and watches, exactly as step 7 does today. 7 of 7 members voted for it.
- What is the scope of this change: should the reviewers check that a frontend pull request carries screenshots, and should the builder mod change how it treats screenshot files? The counsel chose: Only the skills change: skills/implement/SKILL.md (the fact, step 7, the frontend fix rule), skills/storypr/SKILL.md (the section for callers) and README.md's facts table. The reviewers are not asked to check screenshots, and the builder mod is unchanged. Both are non-goals. 6 of 7 members voted for it.
- When /storypr is called by /implement, how should the body's image links name the version of each screenshot, given that /storypr today links `blob/<branch>/<path>?raw=true` and those links stop resolving once the head branch is deleted after the merge? The counsel chose: Link each image by the full sha of the commit that holds it (`blob/<sha>/<path>?raw=true`), which keeps resolving after the merge and after the branch is deleted. /implement fills in the sha after its push, and a later frontend fix rewrites the links to the new commit's sha when it rewrites the screenshot section. 6 of 7 members voted for it.
