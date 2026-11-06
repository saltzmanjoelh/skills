# /implement treats user-interface changes as frontend by default

Date: 2026-11-06.

## Goal

`/implement` opens a pull request through `/storypr`, with real screenshots,
only when the project's `CLAUDE.md` names globs under `Frontend paths:` (see
`implement-opens-frontend-prs-with-storypr.md`). A project that never wrote
that line gets plain pull requests even for changes that plainly alter what a
person sees, and nothing tells anyone that the screenshots were skipped. The
owner wants this to be automatic: a change that touches user-interface files
gets the `/storypr` treatment unless the project says otherwise.

## Users/Trigger

A session running `/implement` reaches step 7 in any project. The project's
`CLAUDE.md`, read from the base branch, has no `Frontend paths:` line, has
one with its own globs, or says `Frontend paths: none`. Later, the same
session pushes to, resumes, compacts on, or merges the pull request it
opened.

## Behavior

1. **Three readings of the fact.** Step 7 reads `Frontend paths:` from the
   base branch's `CLAUDE.md`:
   - The value `none`, alone on the line apart from spaces and in any case,
     turns the behaviour off. No change is frontend, as for a missing line
     before this change.
   - A value that names at least one glob is the project's own list, which
     replaces the default entirely, with no exclusions added.
   - A missing line, or one that is empty or holds only commas and spaces,
     means the built-in default list (point 2).
2. **The default list.** It is written once, in step 7 of
   `skills/implement/SKILL.md`, as the exact pathspecs to pass to git:
   - included, each as `':(glob)<glob>'`: `**/*.tsx`, `**/*.jsx`,
     `**/*.vue`, `**/*.svelte`, `**/*.astro`, `**/*.html`, `**/*.css`,
     `**/*.scss`, `**/*.sass`, `**/*.less`, `**/*.storyboard`, `**/*.xib`,
     `**/res/layout/**`, `**/*View.swift`, `**/*Screen.swift`,
     `**/*Screen.kt`, `**/*Screen.dart`, `**/*Page.dart`, `**/*.xaml`,
     `**/*.axaml`;
   - excluded, each as `':(exclude,glob)<glob>'`: `**/*.test.*`,
     `**/*.spec.*`, `**/*.stories.*`, `**/__tests__/**`,
     `**/__snapshots__/**`.

   Step 7 says that the names matched by `View`, `Screen` and `Page` are a
   naming convention, so a project whose views are named otherwise declares
   its own list.
3. **The check.** The change is frontend when
   `git diff --no-renames --name-only origin/<base>...HEAD -- <pathspecs>`
   prints at least one path, where the pathspecs are the project's globs, or
   the default list with its exclusions. Everything step 7 and
   `frontend.md` do for a frontend change stays as it is.
4. **When `frontend.md` is read.** Step 7 reads
   `skills/implement/frontend.md` only when the check finds the change
   frontend. Every later place that today says "when the base branch's
   `CLAUDE.md` names a `Frontend paths:` glob" says instead "when the pull
   request's body has a `## Screenshots` section and the base branch's
   `CLAUDE.md` does not say `Frontend paths: none`": SKILL.md's
   "When a turn ends", "A review round", "Resuming" and "After a compaction",
   and `frontend.md`'s opening line and its section **Screenshots on a
   frontend pull request**. The later-commit check in that section uses "the
   pathspecs of step 7", which now means the project's globs or the default
   list with its exclusions.
5. **The fallback names its source.** When `/storypr` returns a reason
   instead of screenshots and the change was found frontend by the default
   list, the body's `## Screenshots` section and the one sentence told to
   the person also say that the built-in default list matched, and that the
   project can write its own `Frontend paths:` list, or `Frontend paths:
   none`, in its `CLAUDE.md` to change that. That text names no path that
   matched. With the project's own list, the fallback is as before.
6. **The builder mod's merge bullet.** The bullet in
   `mods/builder/hooks/step.ts` applies to a pull request whose body has a
   `## Screenshots` section and whose fetched base branch's `CLAUDE.md` does
   not say `Frontend paths: none`. Its test asserts the words
   `Frontend paths: none`, so a bullet that still says "names at least one
   glob" fails.
7. **The facts tables.** The `Frontend paths:` row in SKILL.md and in
   `README.md` gives the default as the built-in list in step 7, and says
   that `none` turns it off.

## Edge cases

- A line with globs and the word `none` together is a list of globs; only
  `none` alone opts out.
- A project whose own list matches nothing in the change gets a plain pull
  request, as before; the default list is not consulted.
- A pull request opened before this change with a plain body keeps it, and
  one opened with a `## Screenshots` section keeps its rules, unless the
  base branch now says `Frontend paths: none`.
- A project that switches to `Frontend paths: none` while a frontend pull
  request is open stops the screenshot rules for it from the next turn on.
- A change that only touches test, story or snapshot files under the default
  list is not frontend.
- Generated output that the repository commits, such as a coverage report in
  HTML, can make a change frontend under the default list; the fallback's
  text tells the project how to change that.

## Non-goals

- A way to extend the default list rather than replace it, such as a
  `default` keyword; a project copies the list into its own line instead.
- Deciding that a change is frontend from file contents, the plan or the
  session's judgement; only paths decide.
- Any change to `/storypr`.
- Any change to pull requests already open beyond what point 4 says.
- Making the naming-convention globs complete; a missed view is fixed by the
  project's own list.

## Failure modes

- The default list misses a real user-interface file: the pull request
  opens plain, as before this change, and the project can declare its own
  list.
- The default list matches a change with nothing to show, or no app can be
  run: the pull request opens with the fallback section, which now says the
  default list matched and how to change it, and the session tells the
  person and carries on without waiting.
- A condition left on the old wording would apply the screenshot rules in
  some places and not others; the verification below checks every one.

## Verification

The builder mod's test is read by the gates; nothing else in this change
is, so the rest is checked by reading the diff.

- `mods/builder/tests/register.test.ts` asserts that both merge texts'
  frontend bullet contains `Frontend paths: none` and no longer says
  "names at least one glob", and the gates pass.
- `grep -n "names a \`Frontend paths:\` glob\|names at least one glob" skills/implement mods/builder/hooks -r`
  prints nothing.
- Step 7 of SKILL.md holds the default list exactly as point 2 gives it,
  the three readings of point 1, and the reading rule of point 4.
- `frontend.md`'s fallback paragraph has the extra text of point 5, only
  for the default list.
- The facts rows in SKILL.md and README.md match point 7.
- A worked check in a scratch repository: with no `Frontend paths:` line, a
  change to `src/App.tsx` is frontend, a change to `src/App.test.tsx` alone
  is not, and a change to `server/main.go` alone is not, using the exact
  pathspecs of point 2.
- No added line names a project, client, product, person or issue number.

## Decided by the person

- Should a pull request that changes a user interface go through `/storypr`
  only when the project opts in with `Frontend paths:`? No: it should be
  automatic, not opt-in. This overturns the earlier counsel decision in
  `implement-opens-frontend-prs-with-storypr.md` that a missing line means
  no change is frontend.

## Decided by the counsel

- When a project's CLAUDE.md has no `Frontend paths:` line, which built-in list of path globs should /implement use to decide that a change is frontend (and so open its pull request through /storypr with real screenshots)? The counsel chose: Web file types at any depth (`**/*.tsx`, `**/*.jsx`, `**/*.vue`, `**/*.svelte`, `**/*.astro`, `**/*.html`, `**/*.css`, `**/*.scss`, `**/*.sass`, `**/*.less`) plus mobile and desktop files that are views by their type or name (`**/*.storyboard`, `**/*.xib`, `**/res/layout/**`, `**/*View.swift`, `**/*Screen.swift`, `**/*Screen.kt`, `**/*Screen.dart`, `**/*Page.dart`), with test, story and snapshot files excluded by exclude pathspecs (such as `**/*.test.*`, `**/*.spec.*`, `**/*.stories.*`, `**/__tests__/**`, `**/__snapshots__/**`). 7 of 7 members voted for it.
- Where should the built-in default list live, and when should /implement read skills/implement/frontend.md, now that a missing `Frontend paths:` line means the default list rather than "no change is frontend"? The counsel chose: Write the default list once, in SKILL.md's step 7, which does the frontend check itself with the declared or default list, and read frontend.md only when that check finds the change frontend, or when an open pull request's body has a `## Screenshots` section. The other conditions, and the builder mod's merge bullet, become "the body has a `## Screenshots` section and the base branch's CLAUDE.md does not say `Frontend paths: none`". frontend.md refers back to step 7 for the list. 7 of 7 members voted for it.
- What is the scope of this change, and what does it deliberately leave out? The counsel chose: The same scope and non-goals as the first option, but the default list also gains `**/*.xaml` and `**/*.axaml`, so that Windows and cross-platform .NET desktop views count and the list's claim to cover desktop is true. 7 of 7 members voted for it.
- When the default list (not a project's own list) finds a change frontend but /storypr cannot capture real screenshots, for example in a component library or a project with no runnable app, what should the pull request body and the session's one-sentence notice say? The counsel chose: Today's fallback, plus: when the change was found frontend by the built-in default list rather than the project's own `Frontend paths:` line, both the section and the sentence also say so, and that the project can write its own `Frontend paths:` list, or `Frontend paths: none`, in its CLAUDE.md to change that. 7 of 7 members voted for it.
