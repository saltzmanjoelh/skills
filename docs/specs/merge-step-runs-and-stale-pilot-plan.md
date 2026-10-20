# Plan: a skipped run hides no real run, and a session knows when its pilot is stale

Spec: `docs/specs/merge-step-runs-and-stale-pilot.md`. Written
2026-10-14 from a tournament of three plans: simplest thing, most robust
and most extensible. The judge chose the most-extensible plan, scoring it 7.5
of 10, against 6.5 for the most robust and 6 for the simplest. It said no
plan met the spec as written and named the grafts below that close the gaps.

## Chosen approach

The rules of the stale-mod warning live in a new pure module,
`mods/pilot/hooks/loaded.ts`, built like `checkout.ts` and `state.ts`: it
knows nothing of git or the engine and is unit-tested on its own.
`register.tsx` runs git, keeps one new atom, and calls the comparison at
the three moments the spec names. `pane.tsx` draws the warning through one
function that both line builders use. The merge step is a change to the
text of `skills/implement/SKILL.md`, step 9.

## Grafts

1. **From the most-robust plan: any newer run that did real work replaces
   an older one.** The spec's point 2 says an older run stops counting when
   "a run" with a higher `run_number` did real work, which means any newer
   run, not only the next one. With three runs on one head (#40 a real run
   that was cancelled, #41 a label run that skipped every job, #42 a real
   run that passed), a rule that looks only at the next run would never
   replace #40 and would block the merge for good.
2. **From the simplest and most-robust plans: the warning is never cut.**
   The extensible plan sent the whole line through `fitLine`, which cuts
   from the end with an ellipsis, so a narrow terminal would cut the
   warning, against spec point 11. The rest of the line is fitted to the
   width less the warning and its separator, and below the warning's own
   width the line is the warning alone.
3. **From the simplest plan: one true-or-false `stale` value in the view.**
   The extensible plan carried which part changed, to allow a wording per
   case, which the spec does not want: it has one wording.
4. **From the most-robust plan: the session flag survives a reload.** A
   reload records a new hooks commit and resets only the hooks flag. The
   session flag stays as it was until the next comparison, so the warning
   about the session-start files does not flicker off at a reload.

5. **From the most-robust plan, after review: the diff names the commit
   read.** The plan first rejected this to follow spec point 9 word for
   word, but the review of the pull request found that a checkout moving
   away and back between the two reads of `HEAD` slips past the second
   read. The diff now names the commit read, and spec point 9 says so.

## Rejected alternatives

- **Keeping all the logic in `register.tsx`** (the simplest plan). Every
  other piece of the mod's state has its rules in a pure module with unit
  tests, and the comparison's rules (when to compare, which result to keep)
  are exactly the kind that need them.
- **Running `git diff` directly through `$.process.run`** (the simplest
  plan). The spec says the comparison runs through the mod's git helper,
  with its timeout. The helper is split instead (step 3).
- **A queue of comparisons and a load counter** (the most-robust plan).
  The spec accepts that, in a rare overlap, a slower result can land over a
  newer one and stand until the next turn end or poll compares again, so a
  queue is not worth its cost. Three safeguards keep such a result
  short-lived: a result is kept only while its recorded commit is still the
  one it compared, `HEAD` is read a second time, and the diff names the
  commit read (graft 5). The same safeguards stop a reload in the middle of
  a comparison from being overwritten. The one exception, which the spec
  also accepts, is a hot reload landing in the same overlap: the stale
  result then lasts until `HEAD` next moves. The helper's timeout already
  bounds a hanging git.
- **A command line shaped by the fake** (the simplest plan, which used
  `rev-parse --verify` only so the fake could tell the call apart).
- **Routing the fake by the plugin root through `fakeFiles` links** (the
  most-robust plan). The test cannot read `$.plugin.root`: in the testing
  kit the test's own `$` has no `plugin`, so the fake cannot be keyed on it.

## Facts the judge established

- Inside the mod, `$.plugin.root` is the real folder the mod was loaded
  from. The test's own `$` has no `plugin`. With no `fs.stat` handler, a
  stat throws, so git never runs.
- `fakeFiles` (`tests/register.test.ts`, near line 690) answers a stat for
  any path, with `realPath` equal to the path. If the mod runs git in its
  root, the tests near line 831 (git ran only in `/wt`) and near line 2024
  (no calls at all) break.

## Steps, each test first

1. **The pure module.** Write `tests/loaded.test.ts`, then
   `hooks/loaded.ts` and the types in `types/index.d.ts`.
   - `LOADED_PATHS`: `session` is `['agents', '.claude-plugin/plugin.json',
     'hooks/hooks.json']`; `hooks` is `['hooks',
     ':(exclude)hooks/hooks.json']`. Both are relative to the mod's folder,
     where git runs.
   - Types: `LoadedCommit = { commit: string | null; differs: boolean }` and
     `Loaded = { head: string | null; session: LoadedCommit; hooks:
     LoadedCommit }`; `PluginState.pilot.loaded: Loaded | null`.
   - `loadedIn(raw)` reads an older or broken shape as null.
   - `afterLoad(prev, head)`: with no earlier value it records both commits
     at `head`, with `differs: false`. Otherwise it keeps `session` as it
     was and sets `hooks` to `{ commit: head, differs: false }`. A null
     `head` records null, so a failed first read never lets a later reload
     pose as the session start.
   - `dueComparisons(l, head)`: nothing when `head` equals `l.head`;
     otherwise the parts whose commit is not null and is not `head`.
   - `afterComparison(prev, head, found)`: sets `head`; a part whose commit
     equals `head` gets `differs: false`; a part takes its found result
     only if its stored commit is still the one compared.
   - `isStale(l)`: either part `differs`.
2. **The warning on the line and in the pane.** Write the `pane.test.ts`
   cases, then `View.stale`, `STALE_WARNING`, a `withWarning(v, width,
   line)` used by `abovePromptLine` and `secondRow`, and the pane row.
   - The wording is `pilot changed on disk since this session loaded it;
     restart this session to load it`.
   - The warning leads, followed by ` · ` and the rest of the line without
     its `pilot: ` prefix, fitted to the width that remains. When nothing
     else is to be said, or the width is below the warning's own, the line
     is the warning alone. The warning is never cut.
   - `paneTree` draws the warning first, in yellow, in both branches.
   - Tests at several widths, including below the warning's width, and the
     case with pilot not started and nothing watched.
3. **The git helper.** Split `git()` near `register.tsx:1356`: a new
   `gitRun($, dir, args)` returns the run's result (exit code and output),
   or null when it threw or its output was cut off, and `git()` becomes a
   thin layer over it with unchanged behaviour. The existing suite must stay
   green with no other change.
4. **The fakes.** Make `fakeFiles` refuse to stat a path it does not know
   (not among its files, folders or links), as the real file system does,
   and run the whole suite. If that breaks a test that relies on the old
   answer, fall back to answering the mod's own git calls apart from
   `world.calls`, while still recording the folder they ran in. Add a
   narrow `linkedMod(on, dir)` that answers a stat only for a path no other
   fake knows, records the path and the `resolve` flag, and answers
   `realPath: dir`. Give `fakeGitHub` `changed: Record<string, string[]>`
   keyed by `"<a> <b>"` and read in either order (the paths changed between
   two commits, relative to the mod's folder), `diffExit` to force an exit
   code, and `notCheckouts` for folders where every git command exits with
   128. A new `git diff --quiet` branch, before the existing `git diff`
   branch, exits 1 when a changed path matches an included pathspec,
   exactly or as a folder prefix, and is not excluded; otherwise 0. `HEAD`
   in the mod's folder is `world.heads[dir]`.
5. **Recording and comparing.** Write the register tests for the first
   load and the turn end, then the atom `loaded`, `headOf`, `filesDiffer`
   (true only for exit 1), `modCheckoutOf` (`$.fs.stat($.plugin.root, {
   resolve: true })` and its `realPath`, or null), `compareLoaded` and
   `loadHooks`.
   - At the very top of `session.start`, `void loadHooks($)`, not awaited,
     with its rejection caught. It records the load through `afterLoad` and
     then compares.
   - `compareLoaded` reads `HEAD` and does nothing more when the read fails
     or `dueComparisons` lists nothing. Otherwise it runs `filesDiffer` for
     each part that is due, reads `HEAD` again, drops the result if `HEAD`
     moved, and writes through `update(..., prev => afterComparison(...))`.
   - In `turn.complete`, on the session's own turn, `void compareLoaded($)`
     right after `ensureArmed` and before the early return for the usage
     hold, so it runs at every turn end.
   - `view()` gains `stale: isStale(loadedIn(await read($, loaded)))`.
6. **The reload and the move back.** Write the reload tests (a second
   `$.session.start` stands for the hot reload, as the suite already does),
   then whatever `loadHooks` still needs.
7. **The poll.** Write a test in which a watched pull request's poll alone
   raises the warning, then call `void compareLoaded($)` in the poll timer's
   callback in `schedule()`.
8. **The README.** A section "When pilot changed on disk": the two
   commits, the paths each stands for, when the mod compares, when the
   warning clears, that edits nobody committed are not seen, and why the
   cure is a restart rather than a reload. The band and pane sections say
   where the warning appears, and "What it keeps" names the `loaded` atom
   and says it survives a hot reload but not a restart.
9. **The merge step**, in `skills/implement/SKILL.md`, step 9:
   - the runs `--jq` keeps `id`;
   - after the two read commands, four labelled definitions:
     - **When a run is replaced.** An older run stops counting when any
       run of the same `workflow_id`, started by the same `event`, with a
       higher `run_number`, has not completed or did real work. A
       completed run did real work when its conclusion is not `skipped`
       and its jobs, read with `gh api --paginate
       "repos/<repo>/actions/runs/<id>/jobs" --jq '.jobs[].conclusion'`,
       include at least one that ended other than `skipped`. An empty
       jobs list, or a jobs read that fails, means no real work. A run
       that did no real work replaces nothing and counts itself, as
       passed. The jobs are read only for a completed run whose replacing
       of an older run is in question.
     - **When a check passed**, **When a run is unfinished** and **When a
       run failed**, with their meaning unchanged.
   - a worked example: #40 a real run that was cancelled, #41 a label run
     that skipped every job, so #40 still counts and the step reaches **A
     check failed, or a run failed**; the same with #40 failed; #42 a real
     run that passed, which replaces both; and #42 still running, which
     makes the step wait;
   - the yes bullet says "merge after **Read again before merging on a
     yes**".
10. **The gates**, in `CLAUDE.md` order, reporting how the type check ran,
    since the first gate fails on Claude Code 2.1.299 (see
    `pilot-type-gate-watch.md`).

## Test plan, against the spec's Verification

| Verification item | Test |
|---|---|
| The warning appears at a turn end, with nothing watched, after `HEAD` moves and `agents/` changed | Register test: `HEAD` moves from C to D with `agents/spec-reviewer.md` changed; after the turn end the band line is the warning. It also asserts that the stat asked for `resolve: true` and that git ran in the resolved folder. |
| No warning when only files outside the watched paths changed | Register test with only `README.md` and `tests/x.test.ts` changed. |
| A hot reload after a change only to `hooks/register.tsx` clears the warning | Register test: the turn end warns, then a second `$.session.start` clears it. |
| A hot reload after a change to `agents/` or `hooks/hooks.json` keeps it | Two register tests. The `hooks.json` one fails if the exclusion is removed. |
| A move back to the loaded files clears it | Register test: C to D warns, D back to C clears at the next turn end. |
| `git diff` exiting with 128, and a folder that is not a checkout, give no warning | Two register tests, with `diffExit = 128` and with the folder in `notCheckouts`. |
| `HEAD` unchanged runs no `git diff` | Register test: two turn ends with `HEAD` unchanged run no `git diff --quiet`; a move then runs one diff per part that is due. |
| The line and the pane show the wording | Pane tests at several widths, including below the warning's width, and with pilot not started; a register test mounts the pane on a stale session. |
| The merge step | No gate reads `skills/`; the reviewers check step 9 against the spec's points 1 to 6 and the worked example. |
| Beyond the list | Unit tests of `loaded.ts`; the poll-only register test; a comparison whose recorded commit changed under it (a reload mid-comparison) writes nothing for that part. |
