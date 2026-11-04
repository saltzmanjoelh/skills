# Plan: a slot freed by Release while an issue waits is decided by the next read

Date: 2026-11-03. Spec: `docs/specs/foreman-release-keeps-slot-for-queue.md`.

## Chosen approach

Two planners worked blind, one with the simplest prior and one with the most
robust prior, and they reached the same core change. The judge chose the
simplest plan and grafted three details from the robust one.

`releaseRow` in `mods/foreman/hooks/register.tsx` decides the carry inside
the ledger update that releases the pairing. Its updater resets its flags at
the top, because the store's update may run it again when another write got
in first. It marks each active pairing that owns the row's ticket as
released, collecting each one's name from `whoOf`. On the ledger after the
release, it asks `waitingUnclaimed` whether any sub session waits in the
queue unclaimed. When one does, it appends the collected names that
`isWhoName` accepts to `keptSlots`, keeping the newest `MAX_PAIRINGS`. It
passes that verdict to `slotFreed($, waits)`, which no longer reads the
ledger a second time. When someone waits, `slotFreed` asks for a read, as
before. Otherwise it keeps its direct wake through `slotOutcome`.

Nothing in `decide` changes: it already counts the names in `keptSlots` as
slots freed on that read, so the claim, the kept sentence, the carry over a
failed list read and the slot-free sentence once nobody waits all come from
code that exists.

The comments above `slotFreed` and above `slotOutcome` in
`mods/foreman/hooks/act.ts` say what now happens, and the README's Release
paragraph gains one sentence.

## Grafts from the robust plan

- **The verdict comes from the write.** Both plans had this, but the robust
  plan showed why it matters: a second read of the ledger could find nobody
  waiting after a read had already claimed with the carried name, and would
  then add a slot-free wake as well, handling the slot twice.
- **`'released' as const` in the updater**, because the pairings now pass
  through a local value before they are returned, and TypeScript would
  otherwise widen the standing to `string`.
- **T2 checks the ledger right after the press**, before any read: the
  carried name and the released standing are both stored, which proves the
  spec's edge case that they survive a reload together.
- **A comment on a read already under way.** The robust plan established
  from `decideNow` that a read decides on the live ledger inside the store's
  update, so a read in flight either decides the carried name or leaves it
  stored. `readNow` joins a read already running, so the name can wait for
  the next scheduled read, which is always armed, at most two minutes later.
  The comment in `slotFreed` says this, so nobody adds a second read for it.

## Rejected alternatives

- **Re-reading after a joined read when `keptSlots` is non-empty** (the
  robust plan's optional fix). While the list keeps failing, `keptSlots` stays
  non-empty by design, so the re-read would only fail again, and put in
  `readNow` generally it would loop. The delay it removes is bounded by the
  next scheduled read.
- **A test that hangs the list call to prove a read in flight keeps the
  name.** The code reading settles it, and the fake clock's handling of a
  hanging call is uncertain.
- **Checking the waiting pairing's `keptAt` stamp in T1.** The kept-slot
  reservation spec already tests that stamp.
- **Deciding the outcome in `slotFreed` by reading the list there, or waking
  the parent at once with the kept sentence.** The counsel rejected both
  while settling the spec, 7 of 7, because they duplicate `decide` or can
  wake the parent for a session foreman then begins itself.

## Steps

1. Write T1 and T2 in `mods/foreman/tests/queued.test.ts` and see both fail.
2. Change `releaseRow` and `slotFreed` in `register.tsx`, adding `isWhoName`
   to the import from `./wake` and `MAX_PAIRINGS` to the import from
   `./tickets`, and rewrite the comment above `slotFreed`.
3. Rewrite the last sentence of the comment above `slotOutcome` in `act.ts`.
4. Add the README sentence after "does not count as busy, and foreman takes
   no action on it." in the Release paragraph.
5. Run the gates.

## Test plan

- **T1, for the spec's first Verification item.** With `queueOfTwo`, list
  the two waiting sessions without `isArchived`, so that neither is surely
  unarchived nor over: `queueStep` neither claims nor drops them. After one
  minute with no prompt, press Release on `a.json`. Expect no begin, exactly
  one prompt, the kept sentence for ABC-2 as `REASON_WORDS['slot-kept']`
  gives it, and an empty `keptSlots`. After three more minutes, still that
  one prompt, because the read's stamp holds the slot for five minutes.
- **T2, for the second item.** With `queueOfTwo` and the list failing, press
  Release on `a.json`. Right away, `keptSlots` is `['ABC-1']` and the
  pairing's standing is `released`. After two minutes, no prompt, no begin,
  the same `keptSlots`, and the pane shows the release's log line. Then with
  the list read, after one minute, `local_new2` is begun, no prompt is sent,
  the notices are the list-failed notice and `foreman began ABC-2, the next
  issue in the queue, in the slot ABC-1 freed.`, and `keptSlots` is empty.
- **The existing tests still pass**, including "a begin that fails raises one
  notification and is tried again", whose read now claims with the name
  ABC-1 but whose send fails, so its sentences do not change, and the
  Release tests in `acts.test.ts`, which have no queue.
- **The gates**: the mod load, the type check, `claude plugin test .` and
  `claude plugin validate .`, for builder and then foreman. No gate reads the
  README sentence.
