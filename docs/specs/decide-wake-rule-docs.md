# The texts that state foreman's slot-free wake rule match the code

Date: 2026-10-31. This is item 4 of the follow-ups from
the review of the change that made foreman begin the person's queued sub
sessions by itself when a slot frees (see
`docs/specs/foreman-starts-queued-issues.md`).

## Goal

The code at the end of `decide` in `mods/foreman/hooks/act.ts` wakes the
parent with the slot-free sentence when this read freed a slot and at least
one freed slot is left that no queued sub session's claim filled, unless no
slot is free once the claims are counted. The doc comment above `decide`
still states the rule from before the queue, that the parent is woken when a
slot freed and nobody is left waiting unclaimed. The foreman README and the
wake skill state the rule more closely, but say the line comes only when no
waiting session can take the freed slot, which leaves out the case where two
slots free and only one waiting session claims one. In that case a single
wake carries both the sentence that foreman began the queued session and the
slot-free sentence for the slot left over. This change makes the three texts
say what the code does.

## Users and trigger

A maintainer who reads `decide` to learn when the parent is woken, a person
who reads the foreman README, and the parent's model, which follows the wake
skill when the slot-free line arrives.

## Behavior

1. The doc comment above `decide` says that when this read freed a slot and a
   freed slot is left that no queued sub session's claim filled, the parent is
   woken with the number of slots free, unless none is free.
2. The README's sentence in **Slots, Release and Nudge** says foreman wakes the
   parent for each freed slot that no session waiting in the queue claims.
3. The wake skill's paragraph after the steps for the slot-free line says that
   the line comes for each freed slot that no waiting session claimed, so it
   can arrive in the same wake as the line saying foreman began a queued
   session, and that the parent follows it for the slots it names.

## Edge cases

- Two slots free and one waiting session claims one: the wake carries the
  sentence that foreman began it and the slot-free sentence for one slot. The
  README and the wake skill name this case.
- A waiting session the app's list leaves out, or a proposal card nobody has
  started: the freed slot still wakes the parent. The wake skill already says
  so, and that sentence stays.

## Non-goals

- No code changes, and the rule itself stays as it is. Item 3 of the same
  issue, in which a sessions list that fails to load lets the parent be told
  to pick a new issue while a queued one waits, changes the rule and is left
  for its own change.
- The spec and plan of the change that added the queue are not edited; they
  record the design as it was planned.
- The comment on `slotFreed` in `mods/foreman/hooks/register.tsx` describes
  the Release button's path, a different rule, and is not touched.
- Items 1, 2 and 5 of the issue are not part of this change.

## Failure modes

None at run time, because no code changes. The risk is wording that is still
wrong, which only the reviewers can catch, since no gate reads the README or
the skill.

## Verification

- The gates pass unchanged, which shows the comment edit changed nothing the
  code does.
- A reviewer reads each of the three texts beside the code at the end of
  `decide` and `queueStep`, and finds that each states the per-freed-slot rule
  and that the README and the wake skill name the case of two freed slots with
  one claimant.

## Decided by the counsel

- Which text should this change rewrite to state the current wake rule, that a read wakes the parent for each slot it freed that no queued sub session's claim filled? The counsel chose: The decide doc comment, and also the README sentence at mods/foreman/README.md line 138 and the wake skill's sentence at mods/foreman/skills/wake/SKILL.md line 172, made to say the wake is per freed slot left unclaimed. 7 of 7 members voted for it.
