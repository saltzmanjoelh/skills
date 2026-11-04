# A raised slot count while the desktop app's list fails

Date: 2026-11-04. Issue: a check that the counsel suspected while it scoped
the change that keeps a released slot for foreman's queue (see
`docs/specs/foreman-release-keeps-slot-for-queue.md`).

## Goal

When the person raises the slot count with `/start-foreman <n>` on a running
parent, `applyCommand` in `mods/foreman/hooks/register.tsx` stores the new
count and schedules a read. While an issue waits unclaimed in the queue, that
read can begin the waiting session in the new slot. If the read cannot read
the desktop app's list of sessions, it claims nothing, and `decide` in
`mods/foreman/hooks/act.ts` wakes nobody, because a raised count is never a
freed slot. The question was whether the parent should hear anything until a
read gets the list.

It should not. The raised count is stored in the parent's setting and counted
again on every read, so the first read that gets the list begins the waiting
session in the new slot. Waking the parent in between would break the rule of
`docs/specs/foreman-failed-list-keeps-freed-slot.md`, that a failed list read
never tells the parent to pick a new issue while one waits. This change pins
today's behaviour with tests, so a later change cannot quietly turn the wait
into a wake or a wrong claim, and says it in the README.

## Users and trigger

The person, who raises the count, and the parent session's model, which acts
on every `foreman:` line. The case needs an issue waiting unclaimed in the
queue, a raise of the count, and a list read that fails on the read the raise
schedules, and possibly on more reads after it.

## Behavior

1. **While the list fails, nothing moves and nobody is woken.** The read the
   raise schedules, and every later read whose list fails, begins no waiting
   session, sends the parent's model no prompt, and keeps no slot name in the
   ledger. The only word is the existing quiet notification that the list
   cannot be read, once for the run of failures, and the existing pane log
   line for each failed read.
2. **The first read that gets the list fills the new slot.** It begins the
   first waiting session the list shows unarchived, and reports
   `foreman began <key>, the next issue in the queue, in a free slot.`, with
   no wake.
3. **The README says so.** The queue section of `mods/foreman/README.md`
   gains one sentence: a slot that a raised count adds is filled on the first
   read that reads the desktop app's list.

No code in `mods/foreman/hooks` changes.

## Edge cases

- The list fails for several reads in a row after the raise: each is as
  point 1 says, and only the first read that gets the list begins the
  session.
- The raise adds more slots than issues wait: the first good read begins
  every waiting session the list shows, and the slots left over stay free
  as they do today.

## Non-goals

- The neighbouring case where a read gets the list but the list does not
  show the waiting session surely unarchived. A raised slot then gets
  neither a claim nor the kept sentence. It is left out of this change and
  filed as its own issue, to be checked with its own test.
- Any log line, notification or wake for a raised slot while the list
  fails.
- Any change to how many slots are free, to `decide`'s wake condition, or to
  the text of any wake line.
- Each separate way a list read can fail. The tests use a refused read; the
  existing test that loops over every way already covers how each is
  reported.

## Failure modes

- If the list never comes back, the raised slot stays empty and the waiting
  issue waits. The person has the command's answer and the notification that
  the list cannot be read, and the pane logs each failed read.

## Verification

- A test in `mods/foreman/tests/queued.test.ts`: with one slot, one session
  busy and two waiting, the list fails, the count is raised to three, and
  several reads pass. No session is begun, the parent's model gets no
  prompt, the ledger keeps no slot name, and the only notification is the
  list-failed one. Then the list comes back, and the next read begins both
  waiting sessions with the "in a free slot." report and no prompt.
- The test pins behaviour that already holds, so it passes when written. To
  show it can fail, it is run once against a deliberate break, such as a
  claim that ignores the failed list, and seen to fail, and the break is
  reverted.
- Every gate in the project's `CLAUDE.md` passes for builder and foreman.

## Decided by the counsel

- When the person raises foreman's slot count with /start-foreman <n> on a running parent while an issue waits unclaimed in the queue, and the read that the raise schedules (and possibly several reads after it) cannot read the desktop app's session list, what should this change do? The counsel chose: Change no behaviour. Add tests to mods/foreman/tests/queued.test.ts that pin what happens today: while the list fails, the raised slot claims nothing, the parent's model is not woken, and only the existing quiet list-failed notification goes; the first later read that gets the list begins the waiting session in the new slot with the 'in a free slot.' report. Add one sentence to the README's queue section saying a raised count's new slot is filled on the first read that reads the list. 5 of 7 members voted for it.
- What should this change do about a neighbouring gap: on a read that does get the desktop app's list, but the list does not show the waiting session surely unarchived (it leaves it out, or the waiting entry is a proposal card nobody started), a slot added by raising the count is neither claimed nor announced to the parent with the kept sentence, because decide counts freed slots only from names, and a raised slot has none? The counsel chose: Leave it out of this change, list it under Non-goals, and file it as a follow-up issue so it is checked with its own test. 7 of 7 members voted for it.
