# Foreman's pane: three follow-ups to the glance redraw

Date: 2026-11-05.

## Goal

The change that redrew foreman's pane at a glance (see
`docs/specs/foreman-pane-at-a-glance.md`) left three follow-ups, which its
review filed rather than fixed because each lay outside its spec.

- When the ledger cannot be read, the Spent tile's large figure shows only
  what the parent session itself spent. That looks like a real total but is
  too low, and only the small print under it says that the sub sessions'
  cost is unknown. The earlier spec's failure modes already say the tiles
  show unknown when the ledger cannot be read.
- A card's stage drawing is narrowed by a hand-written four columns for the
  card's border and side padding. Nothing ties that number to the padding and
  border the card sets, so a later change to either would draw the stage bar
  at the wrong width, and the test that guards the width repeats the same
  hand-written four.
- The test that an unreadable ledger hands the band back to the host checks
  only that foreman's band is gone. A later change that drew an empty box in
  place of the host's line would pass it.

## Users and trigger

The person running a parent session, looking at foreman's pane or band. The
first item shows when the ledger read fails while the pane is drawn in a
parent. The second affects every card drawn on a surface that draws images.
The third changes only a test.

## Behavior

1. When the ledger cannot be read, the Spent tile's figure reads
   `Spent cost unknown`. Its small print is unchanged: it still reads
   `sub sessions cost unknown · this session <own spend>`, so the person
   still sees what the parent session spent on its own line. When the ledger
   can be read, the tile is unchanged, including the case where no sub
   session has spent anything yet, whose total is the parent's own spend.
2. The card's side padding and border width are named once, as constants in
   `mods/foreman/hooks/pane.tsx`. The card's `paddingX` uses the padding
   constant, and the columns the stage drawing leaves out are computed from
   the padding and the border, rather than written as a separate number.
   What the card draws does not change: the padding stays one column on each
   side and the round border one column on each side, so the drawing stays
   four columns narrower than the pane.
3. The stage-width test reads the card's padding from the drawn card and
   derives the expected width from it and the border, so a change to the
   padding that the stage width does not follow fails the test.
4. The band test for an unreadable ledger also checks that the host's line is
   drawn in the band once foreman hands it back, as the test for a session
   that never ran `/start-foreman` already does.

## Edge cases

- The ledger reads but no sub session has spent anything: the sub sessions'
  sum is empty, and the tile's figure stays the parent's own spend, as today.
- The ledger reads and the parent's own spend is unknown: the figure is the
  sub sessions' sum, as today. This change touches only the unreadable
  ledger.
- On the terminal, where no card has a border or padding, the stage bar
  takes the full width, as today.

## Non-goals

- How the total treats an unknown part when the ledger can be read. The
  existing rule that adds the known parts stays as it is.
- The Working and Merged tiles, which already read unknown when the ledger
  cannot be read.
- Any change to the card's look, its padding or its border.
- Measuring the border from the engine at draw time. The border's width is a
  constant of the round border style, written next to the padding.

## Failure modes

- If the ledger cannot be read, no tile shows a dollar figure that leaves
  out the sub sessions; each tile's figure reads unknown.

## Verification

Tests in `mods/foreman/tests/`, run by `claude plugin test .`:

- With the ledger unreadable, the Spent tile's figure is `Spent cost unknown`
  and its small print still names the parent's own spend. The existing test
  only checks that the tile's text contains `unknown`, which the small print
  alone satisfies, so the new assertion checks the figure itself.
- With the ledger readable and no sub session spending, the Spent tile's
  figure is the parent's own spend.
- On the desktop, the stage drawing's width is the pane's columns minus twice
  the card's drawn `paddingX` and the border's two columns, times the pixels
  per column.
- With the ledger unreadable, the band is foreman-free and shows the host's
  line.
