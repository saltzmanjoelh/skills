# Plan: foreman starts the person's queued issues by itself

Date: 2026-10-30. Spec: `docs/specs/foreman-starts-queued-issues.md`.

## Chosen approach

Three planners wrote blind, from the priors of the simplest thing, the most
robust and the most extensible, and a judge scored them against the spec. The
most robust plan won, trimmed of three extras, with grafts from the other two.

The queue lives inside the existing pairings of foreman's ledger, so the rules
that join a pairing to its status file, keep it across reloads and cap how
many are kept still apply. A keyed start reserves its pairing before the call
goes on, in the same ledger update that decides whether it waits. Begins are
decided on every read, not only when a slot frees: while a slot is free and a
waiting session can be begun, the read claims the head of the queue. This one
rule covers a freed slot, a release, a raised slot count, a restart, and a
slot that frees when a pairing with no status file stops counting as busy.

## State

Each pairing gains `queue: { place, claim } | null`, where a claim is
`{ attemptAt, notified }`. The outbox gains a `begin` effect holding the
target's `local_` id, the ticket and the key. No module variable decides
anything about the queue. The begin text is a constant and is never stored.

A ledger stored before this change reads every pairing as not waiting. A
damaged `queue` that is still an object reads as waiting at the back with no
claim, because its brief really carried the wait line. A damaged claim reads
as no claim. A `begin` effect is kept only when its target is a whole
`local_` id and its key has the shape of an issue key.

## Steps

1. **Texts, in `held.ts`, `tickets.ts`, `desktop.ts` and `wake.ts`.**
   - `AUTOMATED_REFUSAL`, and `isHeldRefusal`, which matches it or the Remote
     Control refusal after turning curly apostrophes into straight ones.
   - The four hold texts reworded so none says where the person is, and the
     held line worded as "did not start", which is also true for a key held
     after a failed begin.
   - `WAIT_LINE(key)`, which does not begin with `foreman: ` or `/`, quotes
     `BEGIN_TEXT` exactly, says to run `/implement <key>` only once that
     message arrives, and to reply only that it waits until then.
   - `BEGIN_TEXT`, a constant with no issue text and no `foreman: ` prefix,
     which says to bring the branch up to date with the base branch first, to
     run the `/implement` command the brief names, and to ignore the message
     if the session has already begun.
   - The `began` reason, with the spec's sentence and an "in a free slot"
     form when no session freed it.
   - A context sentence on a waiting start's answer, so the parent does not
     tell the person that a waiting issue started.
2. **Ledger, in `tickets.ts` and `types/index.d.ts`.** The fields and readers
   above, `waitingBrief`, `nextPlace`, the queue order, and `shownRows` hiding
   waiting pairings.
3. **Pure queue rules, in `act.ts`.** `freeSlots`, which counts shown busy
   rows, pairings without a status file paired or begun within `GONE_MS`, and
   claimed sessions whose begin is unsent. Then a queue step inside `decide`,
   after the per-pairing rules and before the slot outcome:
   - a waiting session whose record shows an issue key, a stage or a pull
     request is marked begun, with a log line;
   - an unclaimed waiting session the list shows archived is dropped;
   - a claimed one that is archived, or missing from a list shorter than its
     limit, is dropped and its key held, with no notification when a begin
     failure was already notified for it;
   - free slots claim the head of the queue, each claim naming the session
     whose slot it fills when this read freed one;
   - an unsent claim is retried when the list shows the target surely
     unarchived and its last attempt is at least the call timeout old;
   - today's slot outcome runs only when a slot freed and nobody waits.
   Waiting pairings are exempt from the one-day forget rule, the file-left
   rule, the state, gone, milestone and unseen rules. The idle and unseen
   rules count from the pairing time, which a begin resets. `needsList` is
   true while anyone waits. `listSessions` also answers whether the list was
   complete.
4. **Hooks, in `register.tsx`.** `startSession` reserves and decides in one
   `writeTickets`, sends `waitingBrief` for a waiting start, and removes the
   reservation when `next` throws. `afterStart` holds the key and removes the
   reservation on a held refusal, sets the id on an accepted answer or adds
   the pairing again when the reservation is gone, and otherwise removes it.
   `carryOut` sends each `begin` effect with `sendMessage` before any wake
   line. On success it clears `queue`, resets the pairing time, and adds the
   began sentence to the wake. On failure it sets `notified` inside the
   ledger update and raises the notification only when that update changed it
   from false. `slotFreed` and `applyCommand` schedule a read.
5. **Wake skill and README.** Start every queued issue on the person's typed
   turn, one call at a time, in their order; a waiting session listed by the
   app counts as working on its issue; the began line is said in one line with
   no call; "When the parent speaks" gains its bullet; every hold text and
   heading loses Remote Control. The README gains a queue section and renames
   its hold section.

## Grafts

- From the simplest plan: the began sentence is added only after the send
  succeeds, so nothing has to be found and removed from a line, and the parent
  never reports a begin that did not happen. A begin that succeeds on a retry
  wakes the parent alone.
- From the simplest plan: a small claim, with only the attempt time and the
  notified flag; the pairing time, reset at the begin, serves as the floor for
  the idle and unseen rules.
- From the extensible plan: the notified flag flips inside the ledger update
  that records the failure, so two calls at once raise one notification.
- From the extensible plan: every queue rule is a pure function in `act.ts`,
  tested without the fake app.

## Rejected alternatives

- **Adopting an id by title** for a waiting pairing with no id. It can bind
  the wrong session; the one-day forget rule is enough.
- **Re-reading the store before every send.** The store has no
  compare-and-set, so it only narrows a window that the begin text's "ignore
  it if you have already begun" sentence already makes harmless.
- **Sending a begin only after the store write succeeds.** It changes the
  contract of `persistTickets` for little gain.
- **The simplest plan's drop of a session that is "archived or not listed".**
  A reservation is not listed while its call runs, and an idle session can
  fall off the end of the list, so both would be dropped wrongly.
- **Begins only when a slot frees**, as the simplest plan had. A slot freed by
  the five-minute expiry, or left free across a restart, would never begin
  anyone.
- **A begin message built from the key**, as the extensible plan had. The
  spec requires a constant.
- **A new `queue.ts` module.** The seams it offers are for features the spec
  leaves out.

## Test plan

- `tests/held.test.ts`: both refusals are held, including a curly apostrophe;
  the four texts are pinned; no hold text contains "Remote", "remote" or
  "away".
- `tests/tickets.test.ts`: `WAIT_LINE`, `BEGIN_TEXT` and `waitingBrief` pinned
  word for word, including a brief that begins with `/implement`; ledgers with
  no `queue`, a damaged one, a damaged claim and a `begin` effect read as the
  State section says.
- `tests/wake.test.ts`: the began sentence in both forms.
- New `tests/queue.test.ts`, pure `decide` tests: a waiting session with an
  idle, keyless record past three idle thresholds gets no nudge and no wake; a
  waiting session with no file gets no unseen wake and is not forgotten after
  a day; `freeSlots` counts reservations and claims; progress in the record
  marks a session begun; a target missing from a full list is not dropped; an
  archived claimed target is held without a second notification.
- New `tests/queued.test.ts`, engine tests with the fake app: with one slot,
  three keyed starts in turn give one plain brief and two that begin with the
  wait line at places 1 and 2; two starts at once with one slot give one that
  goes ahead; a merge sends `BEGIN_TEXT` to the first waiting session and the
  wake reads the merge sentence followed by the began sentence; an empty queue
  wakes as today; raising the slot count begins waiting sessions; a failed
  begin raises one notification, is retried after the call timeout, is not
  retried while the list fails, and once the target is archived its key is
  held and the next session begins; a restart keeps the queue and retries an
  unsent claim. `tests/world.ts` gains a list of start answers, per-target send
  results and titles on listed sessions.
- `tests/acts.test.ts`: the existing hold tests take the new texts, and one is
  copied for the automated refusal.
- Every gate in the project's `CLAUDE.md`. No gate reads the README or the
  wake skill, so the report says they were checked only by review.
- The real desktop run: a queue of two small issues with one slot. The report
  says plainly whether the second sub session began after the first one's
  merge with no message from the person.
