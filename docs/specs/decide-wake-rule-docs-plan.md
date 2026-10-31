# Plan: the texts that state foreman's slot-free wake rule match the code

Date: 2026-10-31. Spec: `docs/specs/decide-wake-rule-docs.md`.

## Chosen approach

Two plans competed, the simplest change and the most robust wording. The most
robust plan won, trimmed, because it states three facts of the code that the
simplest plan left out and that a reader could get wrong:

- Each claim in `queueStep` takes one name out of `freedBy`, whichever slot
  it actually takes, so the rule is a count of freed slots against claims.
- The number in the slot-free sentence is `freeSlots` after the claims. It
  counts every free slot, not only the freed ones, and leaves out each slot a
  claim took, so the parent must not subtract the began session's slot again.
- In one wake the slot-free sentence comes first and the sentence saying
  foreman began a queued session comes after it, and the second comes only
  when the begin message went.

No code, test or stored state changes.

## Grafts

- From the simplest plan: the phrase "the slot left over", the plainest name
  for the freed slot no claim filled.
- From the judge: the README says the parent is woken once, with the number
  of slots free, so that "for each freed slot" is not read as one wake per
  slot; and the wake skill says the began line comes only once the begin
  message went, so the parent is not puzzled by a slot-free line alone.

## Rejected alternatives

- The simplest plan's wake skill paragraph, because it did not give the order
  of the two lines, did not say the number already leaves out the claimed
  slot, and so left the parent free to count that slot twice.
- A sentence in the README about the Release button's path, which the robust
  plan offered as optional, because the spec leaves that path alone.
- A new test, because the existing test of two freed slots with one claimant
  in `mods/foreman/tests/queue.test.ts` already pins the behaviour these texts
  describe, and the spec changes no code.

## Steps

1. Replace the last sentence of the doc comment above `decide` in
   `mods/foreman/hooks/act.ts` with the per-freed-slot rule, the count, and
   what the number counts.
2. Replace the sentence in **Slots, Release and Nudge** of
   `mods/foreman/README.md` with the per-freed-slot rule and the case of two
   freed slots with one claimant, on the paragraph's one unwrapped line.
3. Replace the paragraph after the slot-free steps in
   `mods/foreman/skills/wake/SKILL.md` with the rule, the order of the two
   lines in one wake, the failed-begin case, the instruction not to subtract
   the claimed slot again, and the existing sentence about sessions the list
   leaves out.

## Test plan

- Run every gate; they pass unchanged, which shows the comment changed
  nothing the code does. The report says that no gate reads the README or the
  wake skill.
- The reviewers read each text beside the end of `decide`, `queueStep`,
  `slotOutcome` and the wake line's order in `wake.ts` and `register.tsx`.
