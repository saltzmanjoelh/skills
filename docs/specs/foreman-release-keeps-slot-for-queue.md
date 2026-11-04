# A slot freed by Release while an issue waits is decided by the next read

Date: 2026-11-03. Issue: a follow-up found while checking the change that
holds a kept slot for the parent's begin by hand (see
`docs/specs/foreman-kept-slot-reservation.md`, whose non-goals set this gap
aside).

## Goal

The person's Release button frees a sub session's slot. When another sub
session waits in foreman's queue with no slot claimed for it, `slotFreed` in
`mods/foreman/hooks/register.tsx` only asks for a read of the status folder
and the desktop app's list. That read counts as freed only the slots that
free on it and the names an earlier failed read carried in the ledger's
`keptSlots` field, and a released pairing is neither, because its standing is
`released`. So when the read cannot begin the waiting session, because the
list does not show it surely open or the list cannot be read, the parent gets
neither the slot-free sentence nor the kept sentence, and the slot sits idle
with nobody told. A slot freed by Release must end in a claim or a wake, as
every other freed slot does.

## Users and trigger

The person, who presses Release on a sub session's row in foreman's pane, and
the parent session's model, which acts on every `foreman:` line. The gap needs
another sub session waiting unclaimed in the queue at the moment of the
Release.

## Behavior

1. **Release carries the slot when someone waits.** When the Release marks an
   active pairing released and at least one sub session waits in the queue
   unclaimed, as `waitingUnclaimed` counts them in the same ledger update, the
   released pairing's name, as `whoOf` gives it, is added to the end of
   `keptSlots` in that same ledger write, keeping at most `MAX_PAIRINGS`
   names, the newest. Release then asks for a read, as it does today.
2. **The next read decides it as if it had freed then.** Nothing in `decide`
   changes. The read counts the carried name as a freed slot, so:
   - when the list shows the waiting session surely open, foreman claims the
     slot for it with the released issue's name, and the began sentence says
     `in the slot <key> freed.`;
   - when the list was read but does not let the waiting session take the
     slot, the parent is woken once with the kept sentence;
   - when the list cannot be read and someone still waits unclaimed, the name
     stays carried until a read gets the list, as
     `docs/specs/foreman-failed-list-keeps-freed-slot.md` says for a file
     that leaves;
   - when nobody waits unclaimed any more by that read, the name wakes the
     parent with the slot-free sentence.
3. **Release with nobody waiting is unchanged.** It still puts the slot wake,
   from `slotOutcome`, in the outbox at once and sends it.
4. **The texts say what now happens.** The comments above `slotFreed` and
   above `slotOutcome` in `mods/foreman/hooks/act.ts` say that Release, while
   someone waits unclaimed, carries the slot's name for the next read, which
   decides it. The foreman README's paragraph on Release says that a slot it
   frees while an issue waits is decided by the next read like any other
   freed slot.

## Edge cases

- The release is pressed while the list keeps failing: the name waits in
  `keptSlots`, the log already says the issue was released, and the first
  read that gets the list decides it.
- The ledger is reloaded between the Release and the read: the name is stored
  in the same write as the release, so it survives.
- Two Releases before a read: both names are carried, in order, and the read
  decides each.
- The waiting session's own file shows progress before the read, so it counts
  as begun: nobody waits unclaimed, and the carried name wakes the parent with
  the slot-free sentence, as rule 3 of the earlier failed-list spec says.
- The released pairing's file later leaves the folder: it is not active, so
  that read does not count its slot a second time.
- A pairing whose ticket is damaged gives a name that `isWhoName` rejects:
  the ledger's reader would drop it, so it is not carried, and Release behaves
  as it does today for that pairing.

## Non-goals

- Release when nobody waits unclaimed, which already wakes the parent
  directly.
- Routing every Release through a read, so that `slotOutcome` loses its
  Release caller.
- Raising the slot count with `/start-foreman <n>` while an issue waits and
  the list cannot be read. The counsel that settled this spec's scope
  suspected a similar gap there; it is a different trigger and is filed as
  its own issue.
- Any change to `decide`, to how many slots are free, or to the text of any
  wake line.

## Failure modes

- If the ledger write of the release fails, the release itself did not
  happen, so the slot is not freed and nothing is lost.
- If the list keeps failing, the queue keeps the slot and the parent is not
  told to pick a new issue, which is the decided behavior for every freed
  slot on a failed read.

## Verification

- Tests in `mods/foreman/tests/queued.test.ts`, written first and seen to
  fail:
  - a Release while an issue waits, followed by a read whose list does not
    show the waiting session surely open, wakes the parent with the kept
    sentence;
  - a Release while an issue waits, followed by reads whose list fails,
    leaves the released key in `keptSlots` and wakes nobody, and the first
    read that lists the waiting session begins it in the slot the released
    issue freed.
- The existing Release tests, including the one with a queue whose read can
  claim, still pass.
- Every gate in the project's `CLAUDE.md` passes for builder and foreman.

## Decided by the counsel

- When the person presses Release on a sub session while another sub session waits unclaimed in foreman's queue, how should foreman make sure the freed slot always ends in a claim or a wake to the parent? The counsel chose: Release adds the released issue's name to the ledger's carried freed-slot list (keptSlots) in the same ledger write that marks the pairing released, and then asks for a read. That read decides the slot exactly as if it had freed on that read: a claim takes the name (so the began sentence says 'in the slot <key> freed'), a list that does not show the waiting session surely open wakes the parent with the kept sentence, and a failed list read keeps carrying the name until a read gets the list, as the earlier failed-list spec does for a file that leaves. 7 of 7 members voted for it.
- What is in scope for the fix to a released slot being lost while a sub session waits unclaimed in foreman's queue? The counsel chose: Only the waiting-queue path of Release: the carried name in keptSlots, the comments above slotFreed and slotOutcome corrected to say what now happens, and a README sentence that says a slot freed by Release while an issue waits is decided by the next read like any other freed slot. Release with nobody waiting keeps its direct wake through slotOutcome unchanged, and no other way of freeing or adding a slot is touched. 7 of 7 members voted for it.
