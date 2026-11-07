# Plan: the builder mod's containment checks refuse Windows-shaped values

Date: 2026-11-06. Spec: `docs/specs/builder-containment-refuses-windows-values.md`.

## Chosen approach

The plan of the simplest-thing planner won. It adds one exported function to
`mods/builder/hooks/review.ts` and puts it in front of each of the three
existing refusals, which otherwise stay word for word as they are. A new
clause in front of a check can only turn an answer into a refusal, so every
value that is not Windows-shaped keeps exactly today's answer.

The function sits just above `DEFAULT_SPEC_DIR`:

```ts
// Whether a value is written in a Windows form: it holds a backslash
// anywhere, or it starts with a letter from A to Z, in either case, followed
// by a colon, such as `C:x` or `C:\x`. On Windows either form can lead out of
// the repository past a check that splits only on forward slashes, so the
// containment checks refuse such a value whole and never rewrite it. A colon
// later in the value, as in `docs/a:b.md`, does not count.
export function isWindowsShaped(value: string): boolean {
  return value.includes('\\') || /^[A-Za-z]:/.test(value)
}
```

It does not reuse `isAbsolute` in `text.ts` or `DRIVE` in `links.ts`, because
both require a slash after the colon and so miss `C:x`.

- `specDirOf`: the first guard becomes
  `if (value === null || value.startsWith('/') || isWindowsShaped(value)) return DEFAULT_SPEC_DIR`,
  and its comment names a value written in a Windows form among the values
  that give the default.
- `marketplaceRootsOf`: the guard in the loop becomes
  `if (source.startsWith('/') || isWindowsShaped(source) || folders.includes('..')) return null`,
  and its comment names a source written in a Windows form among the reasons
  for null.
- `placeOf` in `mods/builder/hooks/register.tsx`: the first line becomes
  `if (isWindowsShaped(path) || path.startsWith('/') || path.split('/').includes('..')) return 'outside'`,
  so a Windows-shaped path is outside before the file system is asked. The
  function is added to the existing import from `./review`.
- The counsel message: `serveCounsel` keeps calling `unwrittenPaths`
  unchanged, and picks its message by testing the refused path:

  ```ts
  if (outside !== null) return isWindowsShaped(outside)
    ? `Refused: ${outside} is written in a Windows form; name paths relative to the checkout, written with forward slashes.`
    : `Refused: ${outside} leads outside the checkout; name paths inside it, relative to it.`
  ```

  This test is exact. `placeOf` refuses every Windows-shaped path at its first
  line, and `unwrittenPaths` returns the first outside path as it was given,
  so a refused path is Windows-shaped exactly when it was refused for that
  reason. The second message is today's, unchanged.

The signatures of `placeOf` and `unwrittenPaths` do not change, and the other
caller of `unwrittenPaths`, the rerun in `serveTally`, needs no change.

## State and its edge cases

The change adds no state. Every decision is made from the value alone, so a
restart, a resumed or cleared session and two copies running at once behave
as before. One existing edge case meets the new rule: a counsel question
recorded before a hot reload can hold a path such as `docs\x`, which the old
code accepted as not written yet. If that question reruns, `unwrittenPaths`
stops at that path, and the round-2 brief loses the "(not written yet)" note
for that path and the ones after it. The brief is still written. A
forward-slash path that later becomes a link outside the checkout behaves the
same way today, so nothing is migrated.

## Grafts from the other plans

1. The function lands first as a stub that returns `false`, and the tests run
   against it before the real body is written. Taken from the most-extensible
   plan, because a named import of a function that does not exist yet would
   stop the whole test file from loading. Then the new assertions could not
   be seen to fail one by one, and the unchanged rows could not be seen to
   pass before the change.
2. A marketplace with a good source next to a bad one gives `null`. Taken from
   the most-robust and most-extensible plans, because it proves that one
   Windows-shaped source refuses the whole answer.
3. A counsel call with the paths `../x` and then `C:\y` gets today's message.
   Taken from the most-robust plan, because it pins that the first refused
   path decides the message, which the test at the call site relies on.
4. The cases `1:x`, `ab:x` and `Z:` in the unit test of the function. Taken
   from the other two plans, because they close both sides of the drive-letter
   rule.
5. A counsel path committed as a link that leads outside the checkout keeps
   today's message. Taken from the most-extensible plan, because it guards the
   refusal by resolved real path, which the follow-up issue will touch.
6. Every backslash in a test is written doubled, never with `String.raw`, with
   one assertion that checks the escaping. Taken from the most-robust plan,
   because `\x` and `\u` inside a template are read as escapes.
7. A test pins that `docs/.. /x` is still accepted, with a comment naming the
   Non-goal, so the follow-up changes that answer on purpose. Taken from the
   most-extensible plan.

## Rejected alternatives

- **A `windows` field in the result of `unwrittenPaths`**, from the
  most-robust plan. It is exact, but it moves the same test one function
  inward and changes a return type for no gain.
- **One `pathRefusal` function that replaces the three copies of today's
  forward-slash rule and returns a reason, with the message text moved into
  `counsel.ts`**, from the most-extensible plan. The judge checked that it
  gives today's answer for every other value, but it rewrites code that
  serves every value, so a reviewer must redo that proof. The checks would
  also call the Windows-shaped function only indirectly, and the change is
  the largest of the three. It prepares for a follow-up that this spec does
  not schedule, and that follow-up can add the same seam when it comes.
- **Reusing `isAbsolute` or `DRIVE`**, because both miss `C:x`, and the spec
  keeps `isAbsolute` unchanged.

## Steps

1. Add `isWindowsShaped` to `review.ts` as a stub that returns `false`, and
   import it in `register.tsx` and `review.test.ts`.
2. Write the tests below. Run `claude plugin test .` from `mods/builder`, and
   see each new assertion fail while the unchanged rows pass.
3. Give the function its real body, add the three guards and the counsel
   message, and update the comments.
4. Run the tests again and see them all pass.
5. Run the four gates from `CLAUDE.md` in order, for `mods/builder` and then
   `mods/foreman`: the mod load, `tsc`, `claude plugin test .` and
   `claude plugin validate .`.

## Test plan

`mods/builder/tests/review.test.ts`:

- A unit test of `isWindowsShaped`. It is true for `..\specs`,
  `docs\..\..\x`, `docs/..\..\x`, `docs\specs`, `.\mods\a`, `mods/..\..\a`,
  `C:\specs`, `C:specs`, `C:a`, `c:/specs`, `c:x`, `a:notes.md`, `Z:`,
  `\\server\specs` and `\specs`. It is false for `design/specs/`,
  `./design/specs`, `docs/a:b`, `docs/a:b.md`, `/c/x`, `../specs`,
  `/etc/specs`, `./mods/a`, `docs/.. /x`, `1:x`, `ab:x` and the empty string.
  One assertion checks that `'\\\\server\\x'` starts with two backslashes.
- `specDirOf` gives `DEFAULT_SPEC_DIR` for `..\specs`, `docs\..\..\x`,
  `docs/..\..\x`, `docs\specs`, `C:\specs`, `C:specs`, `c:/specs`,
  `\\server\specs` and `\specs`; `design/specs/` and `./design/specs` still
  give `design/specs/`, and `docs/a:b` gives `docs/a:b/`.
- `marketplaceRootsOf` gives `null` for a source of `..\a`, `.\mods\a`,
  `mods/..\..\a`, `C:\a`, `C:a`, `\\server\a` or `\a`, both alone and after the
  good source `./mods/a`; `./mods/a` alone still gives `mods/a`.

`mods/builder/tests/register.test.ts`:

- An Architecture document of `..\..\.env` and a Gotchas document of `C:\x`
  are named as none in the package. The fake file system holds files at the
  literal paths `/repo/..\..\.env` and `/repo/C:\x`, so that the test fails
  before the change.
- An Architecture document of `docs/arch.md` is named while a Gotchas document
  of `docs\arch.md` is not, with files at both literal paths.
- A counsel call with a path of `..\..\.env`, `C:\x` or `\\server\x` is refused
  with a message that says the path is written in a Windows form and asks for
  forward slashes, does not say that it leads outside, and writes no brief.
- The existing test of `../../.env` asserts today's exact message and that it
  does not mention Windows. A call with the paths `../x` and then `C:\y` gets
  today's message. A path committed as a link to a file outside the checkout
  gets today's message.

## What the plan does not do

It does not refuse forward-slash parts made only of dots and spaces, change
the real-path comparison in `placeOf`, rewrite backslashes, change
`isAbsolute`, `DRIVE` or foreman, add a message when a document is left out of
the package, or migrate stored counsel questions. The first two go in the one
follow-up issue that the spec names.
