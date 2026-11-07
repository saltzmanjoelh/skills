# Plan: the builder mod's containment checks refuse parts made only of dots and spaces

Date: 2026-11-06. Spec: `docs/specs/builder-containment-refuses-dot-and-space-parts.md`.

## Chosen approach

Three planners wrote plans from different starting points: the simplest
change, the most robust change, and the most extensible change. A judge
scored them against the spec and chose the most robust plan, with three ideas
taken from the simplest plan.

One pure exported function, `hasDotAndSpacePart`, goes into
`mods/builder/hooks/review.ts` just below `isWindowsShaped`:

```ts
export function hasDotAndSpacePart(value: string): boolean {
  return value.split('/').some(part => part !== '.' && /^[. ]+$/.test(part))
}
```

The pattern needs at least one character, so an empty part never counts. The
character class holds only a dot and an ordinary space, so a tab or a
non-breaking space does not count, which matches the spec.

Each of the three checks calls it in place of its test for an exact `..`
part. Every part that is exactly `..` is also a dot and space part, so the new
test refuses everything the old one refused, and a value with no dot and
space part gets exactly today's answer, as behaviour 5 requires.

- `specDirOf` moves the test into its first guard, which returns the default
  spec directory, and drops `folders.includes('..')`.
- `marketplaceRootsOf` replaces `folders.includes('..')` inside the loop's
  guard, so one bad source anywhere in the list still gives `null`.
- `placeOf` replaces `path.split('/').includes('..')` in its first line, so
  the refusal happens before the file system is asked.

The order of the counsel tool's messages lives in one small named function,
`outsideRefusal`, placed just above `serveCounsel` in `register.tsx`:

1. A Windows-shaped path gets today's Windows-form message.
2. A path that has a dot and space part, and neither starts with `/` nor has
   an exact `..` part, gets the new message, written exactly as the spec
   gives it.
3. Any other path gets today's "leads outside the checkout" message. That
   covers a path that starts with `/` or has an exact `..` part, and a link
   that resolves outside, which is the only other way `placeOf` returns
   `outside`. The existing test of such a link covers this fallback.

The fallback is "leads outside" rather than the new message, so a reason for
`outside` added later gets today's general answer, never a wrong specific one.

## Grafts

- From the simplest plan: replace the exact `..` test instead of keeping it
  beside the new one. Keeping both would leave clauses that can never decide
  anything, and the unit test of `../x` already pins that the new function
  covers `..`.
- From the simplest plan: add `not.toContain('dots and spaces')` to the
  existing assertions on `../../.env` and `C:\x`, so the tests already in the
  file also guard the order of the messages.
- From the simplest plan: drop a redundant check for an empty part, because
  the pattern already rules it out.
- From the extensible plan: name, in the comment on `outsideRefusal`, the
  existing test that covers the fallback for a link that resolves outside.

## Rejected alternatives

- **A function that returns the reason for a refusal**, with a type of three
  reasons and a switch that turns a reason into a message. It would make a
  later reason cheap to add, but nothing asks for one, and the spec says the
  three checks call the new function itself. It also sends every value
  through rewritten guards, which is the largest change of the three and the
  hardest to prove equal to today's behaviour.
- **Keeping the exact `..` test beside the new one.** It changes the least
  code, but it leaves dead clauses that a maintainer has to reason about.
- **Writing the message order inline in `serveCounsel`.** It works, but it
  repeats the outside test in a ternary that is easy to misread, and the order
  is the part of this change most likely to be written wrong.

## State and its edge cases

The new function keeps no state. `specDirOf` and `marketplaceRootsOf` are
computed fresh for every package, so a restart, a resumed or cleared session,
and two copies running at once behave like a single fresh call.

One stored value meets the new rule. When a counsel question is tallied again,
`serveTally` runs `unwrittenPaths` on the paths that the stored question
recorded. A question recorded before a hot reload of this change can hold a
path such as `docs/.. /x`. After the reload, `placeOf` refuses that path, and
an `unwrittenPaths` that stopped there would drop the "(not written yet)"
notes of every later path from the round-2 brief, which the base still
writes. So `unwrittenPaths` keeps the first refused path for the counsel
tool's message but goes on gathering the paths that are not written yet. The
counsel tool still refuses the call on that first path, so only the tally's
rerun sees the difference.

## Step sequence

1. Add `hasDotAndSpacePart` as a stub that returns `false`, export it, and
   import it into `register.tsx` and both test files. A named import of a
   missing function would stop a whole test file from loading, so the stub
   lets each new assertion be seen to fail on its own.
2. Write every test below and run `claude plugin test .` from `mods/builder`.
   Record that the new-behaviour assertions fail and the unchanged-behaviour
   assertions pass.
3. Write the real body, wire it into the three checks, add `outsideRefusal`,
   update the comments, and run the tests again.
4. Run the four gates in the order `CLAUDE.md` gives.

## Test plan

In `mods/builder/tests/review.test.ts`:

- A unit test of `hasDotAndSpacePart`, after the `isWindowsShaped` test.
  `docs/.. /x`, `a/... /x`, `docs/. ./x`, `docs/. /x`, `docs/ /x`,
  `docs/ ../x` and `../x` give true. `docs/specs`, `./design/specs`,
  `docs//specs`, `docs/x./y`, `docs/docs /y`, `docs/a:b` and the empty value
  give false.
- The `isWindowsShaped` test keeps `docs/.. /x` as false, and its comment says
  that `hasDotAndSpacePart` refuses that value instead of a follow-up.
- `specDirOf` gives the default for `docs/.. /x`, `a/... /x`, `docs/. /x` and
  `docs/ /x`, each written in backticks so that the inner space survives how
  the fact is read. `./design/specs` and `design/specs/` give `design/specs/`.
- `marketplaceRootsOf` gives `null` for a source of `./mods/.. /a`,
  `a/... /x` or `./ /a`, alone and after a good source, while `./mods/a`
  still gives `mods/a`.

In `mods/builder/tests/register.test.ts`:

- An Architecture document of `docs/.. /x.md`, stored as a real file in the
  fake file system, is named as none in the package, while a Gotchas document
  of `docs/arch.md` is still named.
- A counsel call with a path of `docs/.. /x` or `docs/... /x` gets the new
  message exactly, contains neither "leads outside" nor "Windows form", and
  writes no brief.
- `../../.env` and `../.. /x` get "leads outside the checkout", `C:\x` gets
  the Windows-form message, and none of them contains "dots and spaces".
- The trimmed path `docs/.. ` gets "leads outside the checkout".
- The paths `['docs/.. /x', '../y']` get the new message, and
  `['../y', 'docs/.. /x']` get "leads outside", because the first refused
  path decides.
- A path with a dot and space part whose fake file is a link that resolves
  outside the checkout gets the new message, because `placeOf` refuses it
  before it asks the file system.
