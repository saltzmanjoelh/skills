# Plan: foreman's pane, three follow-ups to the glance redraw

Spec: `docs/specs/foreman-pane-glance-follow-ups.md`.

## Chosen approach

Two plans competed: the smallest change, and the most robust one. Both made
the same code change and differed only in their tests. The judge chose the
robust plan, because it explains why the guard reads whether the ledger was
read rather than whether the sub sessions' sum is missing, it checks the
terminal's one-line tile as well as the desktop's figure, and it keeps the
stage-width test independent of the constants it guards.

### Code, all in `mods/foreman/hooks/pane.tsx`

1. In `tilesOf`, the total becomes
   `v.isLedgerRead ? plusKnown(subs, own) : null`, with a comment saying why.
   The guard is `isLedgerRead`, not `subsSpent === null`, because `spentSum`
   also returns null for a ledger that reads fine but has no spent entries,
   and in that case the spec keeps the parent's own spend as the figure.
   `usdWords(null)` already reads `cost unknown`, so the figure reads
   `Spent cost unknown` and the small print is unchanged. The comment above
   `tilesOf` gains a sentence saying so.
2. `CARD_FRAME_COLUMNS = 4` becomes three constants: `CARD_PADDING_X = 1`,
   the card's side padding on each side; `ROUND_BORDER_COLUMNS = 1`, the
   columns a round border takes on each side; and
   `CARD_FRAME_COLUMNS = 2 * (CARD_PADDING_X + ROUND_BORDER_COLUMNS)`. The
   card's `paddingX` reads `CARD_PADDING_X` on a surface that draws images.

### Tests

- `builderUsage`, the helper that answers foreman's reads of builder's usage
  value, moves from `tests/register.test.ts` to `tests/world.ts` and is
  exported, so `tests/glance.test.ts` can use it instead of a copy.
- New, written first, in `tests/glance.test.ts`, for each surface: with the
  ledger unreadable and the parent's own spend at $1.75, the Spent tile's
  figure is `Spent cost unknown`. On the desktop the figure and the small
  print are checked by their keys, `tile-spent-figure` and
  `tile-spent-small`; on the terminal the whole line is checked. Before the
  fix the figure reads `Spent $1.75`. The existing test passes either way,
  because it sets no own spend, so its total was already unknown.
- New: with the ledger readable and empty, and the parent's own spend at
  $1.75, the figure is `Spent $1.75`. It passes before and after the fix,
  and fails if someone changes the guard to `subsSpent === null`.
- Changed: the stage-width test reads the drawn card's `paddingX` and checks
  that the card's `borderStyle` is `round`, then expects the width to be
  `(200 - 2 * paddingX - 2) * 8`, where the 2 is the round border's two
  columns. It does not import the constants, because a test that imports
  them would agree with any change to them. Checked by hand once: with the
  padding changed in the card's props alone, the test fails.
- Changed: the band hand-back test also checks that the host's line is in
  the band once foreman hands it back.

## Grafts from the smallest plan

- Reuse the existing `builderUsage` helper rather than inline a copy.
- Check `borderStyle` alongside the padding in the stage-width test.
- Check the desktop figure and small print by their own keys.

## Rejected alternatives

- Guarding on `subsSpent === null`: it would turn the figure unknown for a
  readable ledger with no spending, which the spec keeps as the parent's own
  spend.
- Changing `plusKnown`: the spec leaves how a readable ledger's unknown part
  is totalled as it is.
- Measuring the border at draw time: the engine gives no such measure, and
  the round border's width is fixed.
- Putting the new tile tests in `tests/register.test.ts`: the existing
  unreadable-ledger test lives in `tests/glance.test.ts`.

## State

None. Each draw works the figure out again from the latest read, so a
restart, a cleared session, a hot reload or two copies behave as today.

## Steps

1. Move `builderUsage` to `tests/world.ts`, then write the new tile tests
   and see the unreadable-ledger one fail.
2. Change `tilesOf` and see them pass.
3. Change the stage-width and band tests, then name the card's frame
   constants.
4. Run the four gates for both mods.
