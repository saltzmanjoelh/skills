# Plan: the builder mod updates the linked checkout after a merge

Written 2026-11-03 for `docs/specs/builder-updates-linked-checkout.md`, from a
tournament of three blind plans (the simplest thing, the most robust, and the
most extensible) and a judge who checked their claims against the code.

## Chosen approach

The simplest plan won. It meets every Behavior, Edge case and Verification
item of the spec with the least state and the fewest moving parts. Its gaps
were in its description, not its design, and the grafts below close them.

One new module, `mods/builder/hooks/linked.ts`, holds the whole procedure, the
claim and the store record. Its outcome is a list of finished, already cleaned
sentences. They travel on the snapshot as an optional field `linked`, beside
`unpushed`, and the Merged step prints them. The module imports only types
from the engine, so a scratch script can load it with `tsx` and run it against
real repositories.

- `updateLinkedCheckout(io, { home, repo, base, merge }): Promise<string[]>`
  runs steps 1 to 7 of the spec through `io.process.run`, each command an
  argument vector with a time limit (20 seconds, 120 seconds for a fetch and
  for the fast-forward), and never throws: its own error becomes a left-alone
  sentence. Each outcome is built by one small pure function, so the tests
  can name each outcome.
- `linkedCheckout($, key, input)` is the entry that claims and records (see
  "State").
- Pure helpers, exported for tests: matching a remote's address against the
  repository, choosing the source remote, and `quoted`, which cleans a
  message from git or gh.
- Links are found with commands rather than `$.fs`: `test -L` on each of the
  three folders, `find <folder>/ -mindepth 1 -maxdepth 1 -type l -print0`
  for the links inside, then `test -e`, `realpath` and `git rev-parse` for
  each. This keeps the whole procedure behind one `process.run`, which the
  scratch script needs, and avoids a second `fs.stat` handler in the register
  tests, whose testing kit takes one handler per event.
- The main checkout is found exactly as the skill finds it, as the parent of
  the shared git folder. A target outside any git repository (exit 128 with
  "not a git repository") is skipped; any other failure of that lookup is a
  failed lookup.

## Grafts from the runners-up

1. **The merge commit comes from `PR_FIELDS`** (most robust). `mergeCommit`
   is added to the fields of the read that reports the pull request merged,
   so the base and the merge commit come from one consistent read, no extra
   network call is made, and the existing fakes' hold and failure settings,
   which key on that read, are not used up twice. The spec's sentence was
   changed to say so in the same pull request. The fingerprint is unchanged.
2. **The store is read first, and `relisted` only reads it** (most robust
   and most extensible). A record means no gh and no git. `relisted` runs
   from the stuck prompt and the resume path, which are not looks, so it
   never starts the update.
3. **`HOME` is read in `register.tsx`** with the literal `$.env.get('HOME')`
   and passed in (most extensible), so the module needs only `process`.
   When `HOME` is unset, no git runs and the outcome is left alone.
4. **`LC_ALL=C` and `GIT_TERMINAL_PROMPT=0`** go in each git command's
   environment (most robust): spotting the `index.lock` failure depends on
   the language git prints in, and a fetch that asks for credentials would
   otherwise wait until its time limit. The commands themselves are
   unchanged.
5. **Redaction order and global patterns** (most robust). `SECRET_SHAPES` in
   `review.ts` is exported, `quoted` builds global copies of its patterns
   plus one for `scheme://user:pass@`, removes secrets, cuts to 300
   characters, and removes secrets again, so half a token at the cut cannot
   survive. A private key is removed from its header line onward.
6. **A register test that holds two looks at once** (most robust) and
   checks the fast-forward runs once. It is the only test of the "same
   moment" case through the real look.
7. **The README's store paragraph** names the new key and its 90-day prune
   (most robust and most extensible).
8. **The short skill section tells the session to call
   `mcp__builder__watch` once more** when the step says the merge commit
   could not be read yet, and only then (most robust, narrowed by the
   judge, since an update that did not finish is never retried).

## Rejected alternatives

- **A structured outcome type exported through `types/index.d.ts`** (most
  extensible). It serves the pane, the status file and foreman, which the
  spec's Non-goals exclude, and it widens the contract foreman's type check
  reads.
- **Finding the main checkout by comparing `--absolute-git-dir` with the
  common folder** (most robust). It may be more correct for a separate git
  folder, but it changes the procedure, which the Non-goals forbid.
- **A `phase` record written before each fast-forward, a cap of 200 links,
  and an outcome for a failed start write held only in memory** (most
  robust). Each adds state or code the spec does not ask for.
- **Running again when the stored merge commit differs from the one read
  now** (most extensible). A merged pull request's merge commit never
  changes, so the branch is dead code.
- **A scratch script run with Node's own type stripping** (most extensible).
  The hooks import each other without file extensions, which it cannot
  resolve; `tsx` can.
- **A claim held in a session atom so that it survives a hot reload.** It
  would close the hot-reload window only within one session, at the cost of
  a new atom and a wait. The spec already reports that window as an update
  that started and did not finish.

## State

- **The store record**, `linked-checkout:<owner>/<name>#<number>`, holds
  `{ merge, at, lines? }`. The record without `lines` is written before the
  first git command; `lines` is added when the update ends. Records older
  than 90 days are pruned with the state labels.
- **A module map** from that key to the running promise is the claim. It is
  read and set in one synchronous block, with no await between, because
  `$.store` has no compare-and-set. The entry is removed once the record with
  `lines` is written. A second look while the update runs awaits the same
  promise and gets the real outcome.

Inside the claimed promise: a record with `lines` returns them; a record
without them returns "left alone: the update started and did not finish";
otherwise the started record is written, the update runs, and the lines are
written.

A merged pull request with no merge commit yet records nothing and claims
nothing; the step says the merge commit could not be read yet.

Edge cases this state creates:

- **A restart, or a hot reload, during the update.** The map is lost; the
  record has no `lines`, so the step reports the update as started and not
  finished, and nothing retries it. After a hot reload, the old code may
  still write its lines, and later renderings through `relisted` show them.
- **A resumed or cleared session.** The key names the pull request, not the
  session, so nothing runs again.
- **Two sessions merging different pull requests into one checkout.** Both
  run; git serializes them. A held lock on the remote-tracking branch gives
  the "fetch error, merge commit present" sentence, `index.lock` gets the one
  retry, and a fast-forward that finds `HEAD` already past its merge commit
  passes the confirmation.
- **Two processes on the same pull request.** The store is not atomic across
  processes, so both could run. The second finds the merge commit already in
  the checkout and reports it updated, so this is harmless and not locked.

## Step sequence

1. Tests first: `tests/linked.test.ts` with a hand-built `io` whose
   `process.run` answers from a script of argument vectors and records every
   call. See them fail.
2. Write `hooks/linked.ts` until they pass.
3. Export `SECRET_SHAPES` from `review.ts`.
4. Add `mergeCommit` to `PR_FIELDS` and `linked?: string[]` to `Snapshot`
   in `types/index.d.ts`, outside the fingerprint.
5. In `step.ts`, the Merged step gains `linked: string[] | null`, checked by
   `linkedIn`, and `mergedText` opens with the outcome sentences and "report
   it as the section 'Updating the linked checkout' says", in place of
   "First update the linked checkout". The section name stays in the list.
6. In `register.tsx`, `fetchSnapshot` calls `linkedCheckout` for the Merged
   step, `relisted` reads the record only, and the prune covers the new key.
   Update the register and step tests that expected the old text.
7. Shrink the skill section, keeping its heading, and update the README.
8. Run the scratch script against real throwaway repositories.
9. Run the four gates.

## Test plan, mapped to the spec's Verification

- **Every outcome reaches the Merged step's text** (`tests/linked.test.ts`
  and `tests/step.test.ts`): updated from a matched ssh remote, updated from
  the https address, already updated with the refresh fetch, not linked, no
  links found, only worktrees linked, nothing to update, and left alone for
  another branch, tracked changes, a missing merge commit, a failed object
  check, a fast-forward that refuses, and a lock that clears on the retry
  (updated) and one that does not.
- **A second look runs no git** (`tests/register.test.ts`): two looks held
  at once run the fast-forward once; a later look and `relisted` run none; a
  seeded record without lines reads as left alone because the update did not
  finish; a merged pull request without a merge commit writes no record.
- **The step no longer tells the session to run the update**
  (`tests/step.test.ts`, the test of the Merged text inverted).
- **A token is removed** from the stored record and the prompt, including a
  token cut in half at the limit and credentials in an address.
- **The scratch script** (`npx -y tsx`, in the session's scratchpad) builds a
  bare origin, a main checkout, partial clones with `blob:none` and
  `tree:0`, a worktree, and links under a scratch `HOME/.claude`, with `gh`
  answered by the script and every other command run for real, and walks the
  cases of `docs/specs/linked-checkout-any-machine.md`.
- **The skill** no longer holds the procedure and names every outcome.
- **The four gates** pass. No gate reads the skill, the specs or the README.

## Risk to check while building

The update runs inside the look, so a slow fetch holds that look, and every
look waiting on the same promise, for up to a few minutes. Check that a look
that returns late, after newer looks were stored, is still delivered
correctly by the logic that drops overtaken looks.
