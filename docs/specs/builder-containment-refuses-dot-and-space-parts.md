# The builder mod's repository containment checks refuse parts made only of dots and spaces

Date: 2026-11-06.

## Goal

Three checks in the builder mod keep a value that a project or a session
supplies inside the repository. After this change, all three also refuse a
value written with forward slashes that has a part made only of dots and
spaces, other than exactly `.`, so that no such part can be read as `..` on
Windows and climb out of the repository past them.

## Users/Trigger

The change that made these checks refuse Windows-shaped values (see
`docs/specs/builder-containment-refuses-windows-values.md`) left this case out
as a Non-goal and filed it as a follow-up of its own. This is that follow-up.

- `placeOf` in `mods/builder/hooks/register.tsx` checks the Architecture and
  Gotchas document paths that the branch's `CLAUDE.md` names, and the paths
  that a session passes to the counsel tool.
- `specDirOf` in `mods/builder/hooks/review.ts` reads the base branch's
  `Spec directory:` fact.
- `marketplaceRootsOf` in the same file reads the plugin `source` strings of a
  `marketplace.json`.

Today a value such as `docs/.. /x` or `a/... /x` passes all three, because
they refuse only a part that is exactly `..`. Windows strips trailing dots and
spaces from a path part, so it may read `.. ` or `...` as `..`. Nobody is known
to run these mods on Windows, so nothing is broken today, but the gap is in a
security boundary.

## Behavior

A part is a piece of the value between forward slashes. A part is a dot and
space part when it is not empty, is made only of the characters `.` and space,
and is not exactly `.`. So `..`, `.. `, `...`, `. .`, `. `, ` ` and ` ..` are
dot and space parts, and `.`, an empty part, `x.` and `docs ` are not. One
exported function in `mods/builder/hooks/review.ts` tells whether a value has
such a part, and all three checks call it, so the rule is written once.
`isWindowsShaped` keeps its meaning and is not changed.

1. `specDirOf` gives the default spec directory, `docs/specs/`, for a value
   with a dot and space part, as it already does for a value with a `..` part.
2. `marketplaceRootsOf` gives `null` when any plugin's `source` string has a
   dot and space part, as it already does for a source with a `..` part.
3. `placeOf` gives `outside` for a path with a dot and space part, before it
   touches the file system. So `documentPath` leaves such a document out of
   the review package without a message, as it does for every other refused
   document path.
4. When the counsel tool refuses a call, the first refused path decides the
   message, in this order:
   - a Windows-shaped path gets today's message, which says the path is
     written in a Windows form;
   - otherwise, a path that starts with `/`, has a part that is exactly `..`,
     or is a link that resolves outside the checkout gets today's message,
     which says the path leads outside the checkout;
   - otherwise, a path with a dot and space part gets a message of its own:
     `Refused: <path> has a part made only of dots and spaces, which Windows
     may read as ..; name paths without such parts.`
5. A value that has no dot and space part goes through exactly the checks it
   goes through today, and gets exactly today's answer.

## Edge cases

- `./design/specs` and `./mods/a` keep working, because a part that is exactly
  `.` is not a dot and space part.
- `docs//specs` keeps today's answer, because an empty part is not a dot and
  space part.
- A part with a leading space, such as ` ..`, is refused, although Windows
  strips only trailing dots and spaces. Refusing it costs nothing real.
- A part such as `. ` or ` `, which Windows would read as `.` or as nothing, is
  refused too.
- A name that only ends in a dot or a space, such as `x.` or `docs `, is not a
  dot and space part and keeps today's answer.
- `../.. /x` gets the message for leading outside the checkout, and
  `docs\.. /x` gets the Windows-form message, because those reasons come first.
- A counsel path is trimmed before it is checked, so `docs/.. ` is checked as
  `docs/..` and gets the message for leading outside the checkout.
- On macOS and Linux a folder whose name really is made only of dots and
  spaces is no longer accepted by these three checks.

## Non-goals

- Every other path check in the builder and foreman mods stays as it is:
  `isAbsolute` in `mods/builder/hooks/text.ts`, the branch-name checks in
  `mods/builder/hooks/register.tsx` and `mods/builder/hooks/linked.ts`, and
  foreman's `plainName` in `mods/foreman/hooks/desktop.ts`, which refuses dot
  and space parts only on a drive-letter path, as
  `docs/specs/drive-letter-paths-in-links-and-saved-results.md` decided.
- A refused spec directory, marketplace source or document path is not
  reported to the person or the session. Only the counsel tool answers with a
  message, as today.
- A name that only ends in a dot or a space is not refused.
- `placeOf`'s second check, which compares the resolved real path with the
  checkout root followed by `/`, is not changed. The issue's comments took it
  out of this issue.
- No check rewrites a value.
- Nobody runs this on Windows before the merge.

## Failure modes

- A refused spec directory costs extra reviewer runs, because fewer changed
  files count as documentation.
- A refused marketplace source makes every changed file count as a possible
  instruction file, which also costs extra reviewer runs and never skips one.
- A refused document path is left out of the review package without a
  message.
- A refused counsel path refuses the whole counsel call with the message in
  behaviour 4, and the session can call again with a different path.

## Verification

- A unit test of the new function in `mods/builder/tests/review.test.ts`:
  `docs/.. /x`, `a/... /x`, `docs/. ./x`, `docs/. /x`, `docs/ /x`, `docs/ ../x`
  and `../x` have a dot and space part; `docs/specs`, `./design/specs`,
  `docs//specs`, `docs/x./y`, `docs/docs /y`, `docs/a:b` and the empty value
  have none.
- The existing test that pins `isWindowsShaped('docs/.. /x')` as false keeps
  that answer, and its comment no longer says the value is left to a
  follow-up.
- Unit tests of `specDirOf`: `docs/.. /x`, `a/... /x`, `docs/. /x` and
  `docs/ /x` give the default, while `./design/specs` and `design/specs/` give
  what they give today.
- Unit tests of `marketplaceRootsOf`: a source of `./mods/.. /a`, `a/... /x` or
  `./ /a` gives `null`, alone and beside a good source, while `./mods/a` still
  gives `mods/a`.
- Tests in `mods/builder/tests/register.test.ts`: an Architecture document of
  `docs/.. /x.md` is named as none in the package while a plain document
  inside the checkout is still named; a counsel call with a path of
  `docs/.. /x` or `docs/... /x` is refused with the message in behaviour 4 and
  writes no brief; and `../../.env`, `C:\x` and `../.. /x` keep the messages
  behaviour 4 gives them.
- Each test of new behaviour is seen to fail before the change and pass after
  it, and the tests of unchanged behaviour pass on both sides.
- The four gates pass.

## Decided by the counsel

- Which parts of a forward-slash value should the three containment checks (placeOf, specDirOf, marketplaceRootsOf) newly refuse, as parts that Windows may read as ".."? The counsel chose: Every part made only of dots and spaces except exactly "." (and empty parts), so ".. ", "...", ". ", " " and " .." are all refused. 5 of 7 members voted for it.
- When the counsel tool refuses a call because one of its paths has a part made only of dots and spaces (such as "docs/.. /x"), which message should it give? The counsel chose: A message of its own, such as "<path> has a part made only of dots and spaces, which Windows may read as ..; name paths without such parts." 6 of 7 members voted for it.
- A part that is exactly ".." is itself made only of dots, so the new rule also matches it. When a counsel path breaks more than one rule, such as "../.. /x" or "docs\.. /x", which reason decides its refusal message? The counsel chose: Keep today's order and put the new reason last: a Windows-shaped path gets the Windows-form message, then a path that starts with "/" or has an exact ".." part gets "leads outside the checkout", and only a path that breaks neither gets the dot-and-space message. 7 of 7 members voted for it.
- Which path checks should this change cover? The counsel chose: Only the three builder checks the issue names: placeOf, specDirOf and marketplaceRootsOf; every other path check in the builder and foreman mods stays as it is and is listed as a Non-goal. 7 of 7 members voted for it.
- When the new rule refuses a value that only specDirOf, marketplaceRootsOf or documentPath reads (a Spec directory fact, a marketplace plugin source, or an Architecture or Gotchas document path), should anything tell the person or the session that it was refused? The counsel chose: No: keep today's silent fallbacks, as for every other refused value (the default spec directory, null roots, a document left out of the package). 7 of 7 members voted for it.
