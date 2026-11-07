# Plan: the linked-checkout update on Windows, and failed cleanup calls from tool.call

Date: 2026-11-06. Spec: `docs/specs/linked-checkout-on-windows-and-failed-calls-from-tool-call.md`.

## Chosen approach

The simplest-thing plan won the tournament, scoring 8 of 10 against 6.5 and 6
for the other two. It changes only the files that already do this work. It
adds no new module, no new dependency and no new state.

- `linked.ts` finds the configuration folder with the existing `configDirOf`.
  It replaces `test`, `realpath` and `find` with `$.fs.stat(path, { resolve:
  true })` and `$.fs.list(folder)`, and its private path helpers learn the
  drive-letter form through the `DRIVE` pattern, which `links.ts` now exports.
- The existing `tool.call` hook in `register.tsx` keeps the result it gets
  back. When the result is an error, the hook counts it with `afterFailedCall`.
  The `classic.PostToolUseFailure` handler is deleted.

## Grafts from the runners-up

1. **Explicit comparison at each site, from both runners-up.** The winner
   rewrote each path to the first earlier spelling that compared equal, so
   that the plain `===` comparisons could stay. That leaves an unwritten rule
   that every path must be rewritten before it is compared, and the spec says
   the folding happens only at the comparison. So a private
   `samePath(a, b)` is used at every comparison in `updateAll` instead, and
   the main checkouts are deduplicated by the comparison key, keeping the
   first spelling as written.
2. **The git lookup cache is keyed by the comparison key**, from both
   runners-up, so `c:\x` and `C:/x` share one `rev-parse` call.
3. **Unix paths in the register-level test of which variable wins**, from the
   most-extensible plan. The test kit rewrites drive paths in file-system
   events (see `withDrivePaths` in `register.test.ts`), so a `USERPROFILE` of
   `C:\u` would never reach the fake. Drive paths are tested in
   `linked.test.ts`, where no kit rewrites them.
4. **A test with two links that spell one main checkout two ways**, from the
   most-robust plan. It expects one `gh repo view` and one fast-forward.
5. **Tests that builder's own tool and the `Agent` branch count, and that the
   reviewer fence's refusal does not**, from the most-robust and
   most-extensible plans. A `set_stuck` call whose result has `result` and no
   `text` shows that behaviour 6's "builder's own tools count" holds.
6. **The right reason for the guard on the count**, from the most-robust
   plan. The hook's outer `.catch` calls `next(e)` again, and `next` is
   replay-safe there, so the tool does not run twice. The guard matters
   because a rejection would skip `noteTask` and `armCommandLooks`. The code
   comment says so.
7. **Honest sentences for an empty value and for `CLAUDE_CONFIG_DIR=/`**, from
   the most-robust plan. `configDirOf` treats an empty value as unset, and `/`
   trims to nothing, so the sentences say "unset or empty", and a
   `CLAUDE_CONFIG_DIR` that names no folder is not called "not absolute".
8. **A note that an error result's `text` may be wrapped**, from both
   runners-up. The last line kept as the last error may differ from the
   classic `error` field. That only changes wording that foreman reads as free
   text.

## Rejected alternatives, with reasons

- **A new `paths.ts` module with a private form switch, a four-case
  `ConfigFolder` type, `findLinks` split into three functions, and the hook's
  body moved into `callThrough`** (most-extensible). Each piece is justified
  only by changes the spec lists as Non-goals, such as network paths and
  junctions, and together they make the diff much larger than the spec needs.
- **A time limit on every `$.fs` call** (most-robust). This adds `clock` to
  the io type and a timer that can outlive a hot reload. The spec does not ask
  for it, and nothing shows that a `$.fs` call can hang.
- **A fallback to `$.fs.exists` when a folder's `stat` rejects without
  ENOENT, checks that `realPath` is absolute, and filters on entry names**
  (most-robust). The engine's types already say what these calls answer, and
  the spec names only `stat` and `list`.
- **Fakes that refuse every unscripted path** (most-robust). They would also
  refuse the plugin-root `stat` in `modCheckoutOf` and change the behaviour of
  existing register tests. Unscripted paths are passed on with `next(e)`.
- **Changing builder's `links.ts` only** (most-robust). The builder and
  foreman copies are byte-for-byte identical, and the file's header says to
  change them together, so both get the `export`.

## Steps

1. **`links.ts`, both copies.** Change `const DRIVE` to `export const DRIVE`
   in `mods/builder/hooks/links.ts` and `mods/foreman/hooks/links.ts`, with
   the same comment change, so that `cmp` still finds them identical.
2. **Tests first, in `mods/builder/tests/linked.test.ts`.**
   - `ioFrom` gains an `fs` fake with `stat` and `list`, answered from the
     script under `stat <path>` and `list <path>` keys and recorded in their
     own list. An unscripted path is recorded as unexpected and rejects with
     an `ENOENT` message. A stat answer is a value or a rejection message.
   - `folder()` and `link()` script fs keys instead of `test` and `realpath`
     commands. The input becomes `{ configDir, home, userProfile, … }`.
   - Every test asserts that no call ran `test`, `realpath` or `find`.
   - New tests: the sentences for all three variables unset or empty, for a
     relative `CLAUDE_CONFIG_DIR` (naming its value), for `CLAUDE_CONFIG_DIR=/`,
     and for a relative `HOME` with no `USERPROFILE`, each with no process or
     fs call; mixed separators and mixed drive-letter case matched and moved,
     with git run on the path as written; two spellings of one main checkout
     looked up and moved once; `C:/a` against `C:/A` not matched; a link to a
     file running git in its parent; the macOS `/private` case.
   - Ported tests: a broken link by `ENOENT` rejection and by no `realPath`; a
     `stat` rejecting with `EACCES` reported as could not be resolved; a
     `list` rejection replacing the cut-off `find` test; a folder that is
     itself a link, listed through it.
   - Run them and see them fail.
3. **`linked.ts`.**
   - `LinkedIo` gains `fs: Pick<EngineInterface['fs'], 'stat' | 'list'>`.
     `LinkedInput` replaces `home` with `configDir`, `home` and `userProfile`.
   - Private helpers beside `parentOf`: `trimmed(path)`, `parentOf(path)`,
     `comparedForm(path)` and `samePath(a, b)`, plus `isMissing(error)` (a
     `code` of `ENOENT`, or `ENOENT` in the message) and `messageOf(error)`.
     For a path that starts with `/`, `trimmed` and `parentOf` behave exactly
     as today and `comparedForm` is the trimmed path. For a drive path they
     split on both separators, never return a bare `C:`, and keep the path as
     written; only `comparedForm` upper-cases the drive letter and joins with
     `/`.
   - `findLinks` uses `stat` and `list` as the spec's behaviour 3 says, with
     the git cache keyed by `comparedForm`.
   - `updateAll` checks the configuration folder first, builds the three
     folders from it, deduplicates the main checkouts by `comparedForm`, and
     uses `samePath` at each comparison. `notLinkedLine` names the folder.
   - The header comments that mention `~/.claude` and the commands are
     reworded.
4. **Tests first, in `mods/builder/tests/register.test.ts`.**
   - `linkedScript` registers `fs.stat` and `fs.list` fakes that answer its
     own paths and call `next(e)` for every other path, and drops its `test`,
     `realpath` and `find` entries.
   - Which variable wins, with Unix paths: `CLAUDE_CONFIG_DIR=/c` with
     `HOME=/h` searches `/c/skills`; `HOME=/h` alone searches
     `/h/.claude/skills`; `USERPROFILE=/u` with `HOME` unset searches
     `/u/.claude/skills`; none set gives the sentence and runs nothing.
   - The cleanup-record test near line 12063 is rewritten to drive calls
     through the `tool.call` hook with an answering hook beneath it: an error
     before the cleanup skill does not count; after it, the session's own
     error, a subagent's error, an `Agent` call's error and a `set_stuck`
     result with no `text` each count; a `{ deny }` and the reviewer fence's
     refusal do not; a successful result does not; a secret in the text is
     withheld; a failed memo write leaves the call's result unchanged; and a
     `classic.PostToolUseFailure` fired during cleanup leaves the count as it
     was.
   - Run them and see them fail.
5. **`register.tsx`.**
   - `linkedFor` reads `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` and
     passes them.
   - In the `tool.call` hook, each of the three branches keeps its result in
     `ran` and its own side effects. Then, inside the existing `try`, when
     `ran.isError === true` the hook runs `changeMemo($, memo =>
     afterFailedCall(memo, ran.text ?? ran.result)).catch(() => undefined)`
     and returns `ran`. The comment gives the reason for the guard.
   - The `classic.PostToolUseFailure` handler and its comment are deleted.
6. **Comments and documents.**
   - The comment on `afterFailedCall` in `status.ts` names `tool.call`.
   - `mods/builder/README.md`, around line 262, says two fields are fed by
     classic hooks and the failed-call count comes from `tool.call`.
   - `docs/specs/builder-status-file-on-windows.md`: behaviour 6 names the new
     source, and the Non-goals drop the two follow-ups, keeping the other two
     classic handlers with the reasons in the new spec's behaviour 7.
   - `docs/specs/builder-updates-linked-checkout.md` and
     `docs/specs/merged-updates-linked-checkout.md`: the lines that place the
     links under `~/.claude` name Claude Code's configuration folder instead.
     Their "Decided by the counsel" lines are left as recorded.
7. **Verify.** The four gates for builder and then foreman.

## Test plan, against the spec's Verification section

| Verification item | Tests |
|---|---|
| No `test`, `realpath` or `find` command | The assertion in every `linked.test.ts` test, and one test that states it alone. |
| The sentences of behaviour 2, and the order of the variables | The unit tests of each sentence in `linked.test.ts`, and the register tests of which variable wins. |
| Mixed separators and drive-letter case matched; `C:/a` against `C:/A` not | The drive tests in `linked.test.ts`, including two spellings of one checkout. |
| Broken links and a failed `stat` | The ported broken-link tests, the `EACCES` test and the `list` rejection test. |
| The count from `tool.call`, the classic handler gone | The rewritten cleanup-record test in `register.test.ts`. Its positive counts fail if an error result stops raising the count. |
| The four gates | Step 7. |

## State

The change adds no state. The comparison helpers are pure, and the git cache
lives only for one update. The count still lives in the status memo through
`changeMemo`, with the same behaviour as the classic handler on a restart, a
cleared or resumed session, a hot reload and two copies running at once: a
failed call before the ticket is known is not counted, and two loaded copies
of builder each count a failure.

## Risks

- How the real engine shapes an `ENOENT` rejection is not documented. The
  check reads both the `code` and the message. If neither says `ENOENT`, a
  missing folder is reported as failed, which leaves the checkout unmoved.
- Records written before the change keep their old sentences, such as "HOME
  is not set", until they are pruned after 90 days, because the update never
  runs twice for one pull request.
