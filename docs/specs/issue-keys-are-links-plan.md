# Plan: issue keys in foreman's and builder's band and pane are links

Date: 2026-10-21. The spec is `docs/specs/issue-keys-are-links.md`.

## Chosen approach

Three plans were drawn up blind, from the simplest thing, the most robust
and the most extensible priors. The judge chose the simplest plan, because it
is the only one whose state is rebuilt from the files at every session start
(including the start that follows a hot reload), it creates the fewest edge
cases on a restart, a reload or two copies running, and it is the smallest.

Each mod gets one new module, `hooks/links.ts`, identical byte for byte in
both mods. It imports nothing and holds pure rules and one reader that is
handed a read function. Each mod keeps the usable address in a module
variable, set where the fact is read, as builder already keeps
`mergePattern`. The address reaches the drawing through one new `View`
field, `issueLink: string | null`. When it is null, every drawing path is
today's code.

## `hooks/links.ts`

Both copies start with a comment saying they are copies and that
`mods/foreman/tests/art.test.ts` holds foreman's to builder's, as `text.ts`
says.

- `ISSUE_KEY = /^[A-Z][A-Z0-9]*-[0-9]+$/`.
- `linkFactIn(text: string): string | null`: the value of the first line
  that starts with `Issue link:`, read with `/^Issue link:[ \t]*(.*)$/m`,
  trimmed, with one leading and one trailing backtick removed; `''` for a
  bare `Issue link:`; null when no line has it.
- `whyUnusable(address: string): string | null`: null when usable,
  otherwise the first failing reason, in the spec's order:
  `it does not begin with https://`, `it has no {key}`,
  `it holds spaces or control characters` (`/[\s\u0000-\u001f\u007f-\u009f]/`).
- `type IssueLink = { address: string | null; ignored: string | null }` and
  `NO_LINK`.
- `issueLinkIn(text: string | null): IssueLink | null`: null when the text is
  null or has no fact line, otherwise the usable address or the reason.
- `linkOf(address: string | null, key: string | null): string | null`: null
  unless the address is not null and the key matches `ISSUE_KEY`; otherwise
  `address.split('{key}').join(key)`.
- `resolved(base, path)`: an absolute path as given, a relative one joined to
  `base`, with `.`, `..` and repeated slashes folded.
- `gitDirOf(dir, dotGit: string): string | null`: the `gitdir: <path>` of the
  first line, resolved against `dir`, or null.
- `mainCheckoutOf(gitDir, commondir: string): string | null`: the folder
  holding `commondir` resolved against `gitDir`, or null for empty text.
- `ignoredLine(mod, reason)`: `` `${mod}: the Issue link fact was ignored because ${reason}` ``.
- `readIssueLink(read: (path: string) => Promise<unknown>, dir: string): Promise<IssueLink>`:
  never throws. Each read is caught, and an answer that is not a string is no
  file. It reads `dir/CLAUDE.md`, then `dir/CLAUDE.local.md`, and stops at the
  first that has the line. Only when neither has it does it read `dir/.git`
  and `gitDir/commondir`, and then `main/CLAUDE.local.md` when a main
  checkout was found and it is not `dir`. A `.git` folder fails to read as
  text, which gives no third place, so no `fs.stat` is needed.

## Builder

- `hooks/pane.tsx`: `Elements` picks `Link` too; `View` gains `issueLink`.
  `barRow(ui, bar, columns, key, address)` works out
  `issueKey = issueOf(bar.title).issueKey` and `link = linkOf(address, issueKey)`.
  - On a picture surface with a link: `[<Link key={`${key}-link`} href={link}>{issueKey}</Link>, <Svg …/>]`.
  - On the terminal with a link, when the fitted row equals
    `fitBar(bar, Infinity)` (so the title was kept) and starts with the key:
    `<Text key={key}><Link href={link}>{issueKey}</Link>{row.slice(issueKey.length)}</Text>`.
  - Otherwise today's element. `bandTree` and `workTree` pass
    `v.issueLink`.
- `hooks/register.tsx`: `let issueAddress: string | null = null` beside
  `mergePattern`. In `session.start`, before the merge pattern line, read the
  fact with `readIssueLink(path => $.fs.read(path), e.cwd)`, keep the
  address, and when it was ignored show `$.ui.toast(ignoredLine('builder', reason))`
  inside a try block. `view()` sets `issueLink`; `elementsOf` takes `Link` in
  both branches.

## Foreman

- `hooks/subs.ts`: `chipParts(row, now): { key: string; rest: string }`,
  where `rest` is the chip's text after the key and its space, and
  `chipText` becomes `` `${key} ${rest}` ``, so the split and the fitting
  agree by construction.
- `hooks/pane.tsx`: `Elements` picks `Link` too; `View` gains `issueLink`.
  `rowLink(row, address)` answers `linkOf(address, row.record.issueKey)` only
  when `keyOf(row) === row.record.issueKey`, so a key cut by `printable` or
  holding an escape sequence that `printable` would clean is not linked.
  - Band: a chip with a link is `<Link key={`link-${file}`}>`, then
    `<Text key={`chip-gap-${file}`}> </Text>`, then today's button with the
    same key, press, tone or dimness, holding `rest`. Fitting still uses
    `chipText`.
  - Pane: a row with a link begins with
    `<Box key={`issue-${file}`} flexDirection="row">` holding the `Link`, a
    space `Text`, and the primary button `open-${file}` labelled
    `` `→ ${pullRequestWords(row)}` ``. Released rows the same.
- `hooks/register.tsx`: module variables `issueAddress` and `ignoredReason`.
  `readLinkFact($, cwd)` reads with `readIssueLink`, sets both, and, when the
  fact was ignored, shows the toast and writes the same line with `addLog`.
  It runs in `session.start` only when the stored parent is on, and in
  `becomeParent` only when the session was not already a parent, from the
  session's working folder, which `session.start` keeps in a module variable
  from `e.cwd` in every session without reading anything. `view()` sets `issueLink` only while the
  session is a parent; `elementsOf` takes `Link`.

## Grafts, and why

1. From the most robust plan: the space after a chip's key is its own `Text`,
   so a desktop's native button cannot trim it.
2. From the most extensible plan: `chipParts` in `subs.ts`, so the chip's
   split and its fitting cannot disagree.
3. From the most extensible plan: the first test confirms that the engine
   accepts a bare `Link` in a `Box` row beside a `Button`, on the terminal and
   on a picture surface, because the types do not promise it. If it is
   refused, each `Link` is wrapped in a keyed `Text`.
4. From both other plans: builder's terminal row nests the `Link` in its
   `Text`, which is the documented use of an inline element, while keeping
   the exact comparison with `fitBar(bar, Infinity)`.
5. From the most robust plan: `.git` and `commondir` are read only when the
   first two places lack the line, and a test checks the exact paths read.
6. From the most robust plan: a builder test that `linkFactIn` and `factIn`
   agree on single-line input.
7. From the most robust plan's alternative: foreman reads the fact only in a
   parent, so the existing test that a non-parent session reads no file stays
   true. The spec was amended to say so.
8. From the most robust plan: a hot-reload test that links come back after
   the reload's `session.start`.

## Rejected alternatives

- A `$.state` record of the address with a told flag, a read time and a
  two-second wait at start (the most robust plan). It adds about six edge
  cases (a cleared or resumed session staying silent, a late read needing its
  own toast path, a saved value needing a shape check, builder's status hook
  firing on its writes, two copies racing) to fix one repeated toast after a
  hot reload, which the spec now names as a known limit.
- A `linkTold` record keyed by session id (the most extensible plan). It
  silences the toast on a resume, which the spec asks for, and it is state
  saved under a session id, which the owner's rules disfavour.
- A `Disk` seam with `fs.stat`, a label-agnostic `projectFact`, and
  `rowHref`/`keyLink` seams. A `.git` folder that fails to read gives the
  spec's answer already, and no requirement asks for the seams.
- Rejecting zero-width, byte-order-mark and bidirectional characters, giving
  bare repositories no third place, and stripping a byte-order mark. They go
  beyond the spec.
- Reusing builder's `factIn`. Its `\s*` runs past the end of the line, so a
  bare `Issue link:` takes the next line or counts as missing.

## Steps

1. Add `CLAUDE.local.md` to `.gitignore`.
2. The engine test of a bare `Link` in a `Box` row (graft 3).
3. Builder's `links.ts` with `tests/links.test.ts`, test first.
4. Copy both to foreman; add the `links.ts` functions to `COPIES` in
   `tests/art.test.ts` and their answers to `tests/builder-drawn.ts`, written
   by running builder's copy with `node --experimental-strip-types` from a
   script in the scratchpad.
5. Foreman: `chipParts`, the pane and band changes, the reads and the toast,
   with their tests first.
6. Builder: the bar row, the read and the toast, with their tests first.
7. The three READMEs.
8. The four gates, then the search for issue keys and project names.

## Test plan

- `tests/links.test.ts` in both mods, identical: one and two `{key}`; each
  unusable value (empty, bare at the end of the file, followed by another
  line, `http://`, `javascript:`, no `{key}`, a space, a tab, an escape);
  each non-key (`abc-123`, `ABC-`, `ABC-12a`, `ABC 123`, a key with an
  escape, null); backticks removed; `readIssueLink` with a map-backed reader
  that records the paths read: a fact in `CLAUDE.md` reads one file, a fact in
  the working folder's `CLAUDE.local.md`, a fact in the main checkout's file
  through an absolute and a relative `gitdir`, an unusable fact that stops the
  search, a rejected read that goes on, a `.git` folder, a missing `.git`, a
  missing `commondir`, a main checkout equal to the working folder, an answer
  that is not a string.
- Builder only: `linkFactIn` agrees with `factIn` on single-line input.
- Foreman's copy held to builder's through `COPIES` and the fixture.
- Foreman register tests, on the terminal and the desktop: with a fact,
  each chip is `link-<file>` with the built address and the key, then the
  space, then `chip-<file>` whose text does not begin with the key and whose
  press still opens the sub session; each pane row is `issue-<file>` with the
  link and `open-<file>` reading `→ #4 open · checks passed`; released rows
  too; a row with no issue, a cut key and a key with an escape have no link;
  without a fact, and with an unusable one, no `Link` anywhere and today's
  texts; a non-parent session reads no file and toasts nothing; one toast and
  the same newest log line after `/start-foreman`, for each reason; none for
  a missing or usable fact; none on a second `/start-foreman`; the toast at
  the start of a stored parent; each of the three places reaches the band.
- Builder register tests, on the terminal and the desktop, band and pane:
  the link and the rest of the row on the terminal, the link above the
  picture whose source still holds the key; no link at a width where
  `fitBar` drops the title, for a title with no key, or without a fact; one
  toast per reason, none for a missing or usable fact; each of the three
  places reaches the band; the links come back after a reload's
  `session.start`.
- The four gates.
