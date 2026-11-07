# Plan: a counsel rerun leaves refused paths out of the round-2 brief

Date: 2026-11-06. Spec: `docs/specs/counsel-rerun-leaves-out-refused-paths.md`.

## Chosen approach

The plan of the simplest-thing prior won. The judge found that it meets the
spec with the least code, and that its only gaps were in testing, which the
grafts below fill. No plan stores anything new: each rerun works out the
refused paths again from the stored question and the rule that is loaded at
that moment, so a restart, a resumed or cleared session, a hot reload and two
copies running at once add no edge case beyond the race on tallying one
question that exists today.

1. A pure `containmentRefusal(path)` in `mods/builder/hooks/counsel.ts` returns
   `{ reason, message }`. Each branch builds the message from one local reason
   string, so the two cannot disagree. It imports `isWindowsShaped` and
   `hasDotAndSpacePart` from `./review`, which `counsel.ts` already imports
   from, so no import cycle appears. `outsideRefusal` in `register.tsx` is
   deleted.
2. `unwrittenPaths` in `register.tsx` returns `{ unwritten, refused }`, where
   `refused` holds every refused path in the order the question named them.
   `serveCounsel` refuses with `containmentRefusal(refused[0]!).message`, which is
   byte for byte today's message.
3. `briefText(q, unwritten, refused = [])` passes `refused` to
   `backgroundLines`. That function leaves the refused paths out of the files
   list, writes `None named.` only when the question named no paths, writes
   `None left; every path the question named is listed under Paths left out.`
   when every path is refused, and then adds `## Paths left out` with one
   `- <path>: <reason>` line per refused path. `followUpsBriefText` is not
   touched and gets the default.
4. A pure `leftOutSentence(paths)` in `counsel.ts`, built with `listed()` from
   `./text`, gives the tally's sentence, or an empty string for no paths.
5. In `serveTally`'s rerun branch, the code passes `refused` to `briefText`
   and sets `note` to `leftOutSentence(refused)` only after the write
   succeeds. The catch branch still sets its own note, so a failed write
   gives only the could-not-be-rewritten sentence.

## Grafts

- From the robust and extensible plans: `leftOutSentence` lives in
  `counsel.ts` with unit tests, because answer text there is pure and tested,
  as `counselAnswer` is.
- From the robust plan: a register test for a failed write on a rerun with a
  refused path, because the edge case depends on the order in which `note` is
  set.
- From the extensible plan's alternative: a new sibling register test for a
  rerun with all good paths that expects no new section and no new sentence,
  because the spec says the existing rerun test passes unchanged.
- From the robust and extensible plans: unit tests of the order in
  `containmentRefusal`, including that the dots-and-spaces reason is never used for a
  path that starts with `/` or has an exact `..` part.
- From the judge: the unchanged-text unit test compares against a fixed
  expected string, because comparing the default with an explicit empty list
  can never fail.

## Rejected alternatives

- Filtering paths by their form when the session folder is unknown, by
  pulling a pure check out of `placeOf`. It changes a path check that
  `documentPath` also uses, which the Non-goals rule out, and paths are only
  stored when the folder was known.
- Removing repeated refused paths from the new section, and ignoring
  left-out entries that are not among the question's paths. The counsel tool
  does accept a path named twice, but the section lists it twice just as the
  files list always has, so only the tally's sentence names each path once.
  The second guards against a caller that does not exist.
- Returning a kind of refusal and keeping `outsideRefusal` with its own
  templates. That classifies a path twice and risks wording the reason twice,
  against behaviour 2.
- Passing the left-out list through `followUpsBriefText` and carrying a
  `{ path, reason }` type into the brief. No caller needs either, and the
  follow-ups brief is out of scope.
- Editing the existing test "a rerun rewrites the brief as round two with the
  proposed option added", because the spec says it passes unchanged.

## Step sequence

1. Add the optional `refused` parameter to `briefText` and `backgroundLines`
   with no behaviour behind it, and export stubs of `containmentRefusal` and
   `leftOutSentence`, so the new tests type-check and fail as tests.
2. Write the tests below and run `claude plugin test .` from `mods/builder`
   to see each new one fail.
3. Implement `containmentRefusal`, `leftOutSentence` and the brief's filtering and
   section in `counsel.ts`.
4. Change `unwrittenPaths`, `serveCounsel` and `serveTally` in
   `register.tsx`, delete `outsideRefusal`, and update their comments.
5. Run the tests again, then the four gates.

## Test plan

- The register test "a rerun of a question stored with a dot and space part
  keeps the notes of the paths after that part" changes to expect
  `docs/.. /x.md` absent from the files list and listed under
  `## Paths left out` with the dots-and-spaces reason, the
  `(not written yet)` note on `docs/specs/poll.md` kept, no rename advice, and
  the tally's answer naming the path. That path is also not written yet, so
  the test covers that edge case too.
- A new register test puts a question with `docs/arch.md`, then makes that
  path a link outside the checkout before the tally, and expects it under
  `## Paths left out` with `leads outside the checkout` and not in the files
  list.
- A new register test where every stored path is refused expects the
  `None left; …` line and no `None named.`.
- A new register test with two refused paths and a good path between them
  expects both refused paths listed in order, the good path kept, and the
  answer naming both.
- A new register test for a rerun with all good paths expects no
  `Paths left out` in the brief and an answer that starts with `Rerun:`.
- A new register test for a failed write on a rerun with a refused path
  expects only the could-not-be-rewritten sentence and no `Paths left out`.
- Unit tests in `mods/builder/tests/counsel.test.ts`: a brief with no refused
  path matches a fixed expected files block for a first round, a rerun and a
  follow-ups question; a brief with refused paths of all three kinds has the
  section with each reason and no rename advice; a brief whose paths are all
  refused says none are left while one with no paths says none named;
  `containmentRefusal` keeps today's order and each message holds its reason;
  `leftOutSentence` is empty for no paths and names one or two paths.
- The existing counsel refusal tests and "a rerun rewrites the brief as round
  two with the proposed option added" pass unchanged.
- The four gates pass.
