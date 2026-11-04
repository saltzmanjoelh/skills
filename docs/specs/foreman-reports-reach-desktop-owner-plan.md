# Plan: foreman's reports reach the owner when a notification cannot be raised

Written 2026-11-04 for `docs/specs/foreman-reports-reach-desktop-owner.md`.
Three planners worked blind to each other from three priors: the simplest
change, the most robust one, and the most extensible one. A judge compared
them. The simplest plan won, with four ideas grafted on from the other two.

## Chosen approach

The change goes in `notify` in `mods/foreman/hooks/register.tsx`, with three
small pure helpers placed beside `shownReport` in `mods/foreman/hooks/pane.tsx`.
It adds no new files and no dependencies.

- **The band's state.** The report atom in `$.state` becomes
  `{ text, at, kept? }`. The field `kept` counts the notices kept since the
  person last typed. When it is missing or 0, the band behaves as it does
  today. While `kept` is above 0, `at` is ignored and the band shows the text
  whatever its age.
- **Which notices the band keeps.** The outbox's notify effect gains an
  optional `keep?: true` beside `quiet?: true`. `effectIn` in
  `mods/foreman/hooks/tickets.ts` keeps it only when it is exactly `true`, as
  it does for `quiet`. The effects change as follows:

  | Notice | quiet | keep |
  |---|---|---|
  | Report sentences (`showReports`) | yes | yes, and shown for ten minutes when delivered |
  | Needs-you (`act.ts`) | no | yes |
  | Held after a refused start (`afterStart`) | yes, new | yes |
  | Begin-held (`act.ts`) | yes, new | yes |
  | Begin-failed (`beginOne`) | yes, new | no |
  | List-failed (`act.ts`) | yes, as today | no |
  | Failed checks (`checks.ts`) | yes, as today | no |

- **The new `notify`.** It takes
  `{ quiet?: boolean; band?: { newest: string; count: number; isReport: boolean } }`
  and does these steps in order:
  1. It reads `at` from the clock. When `band` is given, it tells the band
     that the notice arrived, with
     `update($, report, raw => noticeArrived(raw, band, at).value)`, inside a
     catch of its own, before the call, so the band never waits on the call.
  2. It calls `within($, $.ui.notify(...))` inside a try block. Only
     `isSent === true` counts as sent. Any other answer is a failure with
     the key `reason:<reason>`, where a reason that is not a string reads
     `unknown`. A timeout has the key `timed-out` and a throw has the key
     `threw`. When the call failed and the first write did not count the
     notice already, it writes the band again with
     `update($, report, raw => noticeFailed(raw, band, at))`, also inside a
     catch, so a failed state write loses only the band entry.
  3. On a failure whose key the load has not logged yet, it adds the key to
     the set synchronously, before any await, then reads
     `within($, $.session.surfaces())` and logs the reason line:
     "Could not raise notifications (<words>; surfaces attached: <list>), so
     the band keeps each report until your next message." The list is
     `none` when empty and `unknown` when the read fails or times out. The
     words are the reason, "no answer within 30 seconds", or "the call
     failed".
  4. When the notice is not quiet, it logs today's line: "Raised a
     notification: …" when it went, or the matching failure line.

  The reason line is written before the notice's own line, so the notice's
  line stays the newest, and the band is written before the surfaces are
  read, so a hanging read never delays the band.
- **The set of logged reasons** lives at the top level of `register.tsx`,
  whose hooks are registered at the top level too. The engine evaluates the
  module afresh on every load, so each load and each test starts empty.
- **`showReports`** keeps `addLogs`, drops its own write of the band, and calls
  `notify($, sentences.join(' '), { quiet: true, band: { newest: last, count: sentences.length, isReport: true } })`.
- **`carryOut`** passes `band: { newest: text, count: 1, isReport: false }`
  when the effect has `keep`.
- **The person typing.** At the top of the `prompt.submit` hook, before
  `choiceFor` can return early, and whether foreman is on or off:
  `if (isPersonPrompt(e) && !isAppParts(e.text)) await releaseKept($).catch(() => undefined)`.
  `releaseKept` reads the band and writes only when `kept` is above 0, so
  most prompts write nothing. `isAppParts` is needed because the desktop
  app's own notes arrive with the same origin as a typed message.

### The pure helpers in `pane.tsx`

- `keptOf(raw)` returns `kept` when it is a positive whole number, and 0
  otherwise.
- `noticeArrived(raw, band, at)` runs before the call:
  - when something is already kept, it returns
    `{ text: newest, at, kept: keptOf(raw) + count }` and says the notice is
    counted;
  - otherwise, for a report, it returns `{ text: newest, at, kept: 0 }`,
    which is today's behaviour;
  - otherwise it returns `raw` unchanged, so a delivered needs-you or held
    notice never touches the band.
- `noticeFailed(raw, band, at)` runs after a failed call that was not
  counted. It returns `{ text: newest, at, kept: keptOf(raw) + count }`,
  except that when the band already holds a notice that arrived later, that
  one stays the newest and both are counted, so a call that answers last
  never puts an older sentence above a newer one.
- `afterTyped(raw, now)` turns a kept value into `{ text, at: now, kept: 0 }`,
  and returns any other value unchanged.
- `shownReport(raw, now)` shows a kept value whatever its age, followed by
  " (<kept − 1> more since your last message.)" when `kept` is above 1. Any
  other value keeps today's ten-minute rule. The band's `printable` already
  cuts the end of the line, so a narrow band cuts the count first.

After the person types, the band shows the sentence alone for its ten
minutes. The count says "since your last message", which stops being true
once they type, and the spec's edge case that a later notice "starts a new
count from one" reads the same way.

## Grafts

- **Write the band before reading the surfaces** (from the extensible plan),
  so a hanging surfaces read delays only the reason line, never the band.
- **A catch around the band write** (from the robust plan), so the spec's
  failure mode holds: a failed state write loses the band entry and keeps
  the log line.
- **Only `isSent === true` counts as sent** (from the robust plan), so a
  malformed answer falls on the safe side.
- **Read `at` before the call** (from the robust plan), so a delivered report's
  ten minutes start when they start today.
- **The set of logged reasons lives inside `register()`** (from a risk the
  extensible plan named), so each load and each test starts empty.

## Rejected alternatives

- **The robust plan's ordering by arrival time.** It stored the arrival time,
  a release time and a kept flag, and converted a shown delivered report into
  a kept one when a slower failure that arrived earlier finished after it.
  Notifications finish out of order only when a call hangs for the full 30
  seconds, and in that case the simple rule still never loses a kept notice:
  every failure adds to the count. The extra fields made more edge cases on a
  reload and with two copies running, and the plan still admitted an
  undercount of its own. A review found that writing the band only after the
  call answered made a report late, lost on a reload during the call, or
  shown under an older sentence, so the band is now told before the call and
  again on a failure, using the arrival time already stored, with no new
  field.
- **Logging the reason line without waiting for it** (the robust plan). It
  makes the order of log lines a race, so the test that reads the newest line
  after a failed needs-you notice would have to change, and tests would lose
  determinism. Waiting costs at most 30 seconds once per reason per load.
- **A new `notices.ts` module, a single `deliver()` function and a structured
  `View.report`** (the extensible plan). They prepare for an engine route that
  does not exist and for a pane redesign that the spec lists as a non-goal.
  The helpers beside `shownReport` are just as testable.
- **Keeping the count shown after the person types.** "Since your last
  message" would be false.

## Steps

1. In `tests/world.ts`, add `notifyReason` (default `disabled`, which the
   `off` mode answers with) and `surfaces` (default `[]`, or `throws`),
   answered through `on('session.surfaces', …)`, and a helper that returns
   every log line.
2. Write the failing tests below, and see them fail.
3. Add `keep` to `ForemanEffect` and to the report type in
   `mods/foreman/types/index.d.ts`, and parse it in `effectIn`.
4. Add `keptOf`, `noticeArrived`, `noticeFailed` and `afterTyped`, and change `shownReport`, in
   `pane.tsx`.
5. Rewrite `notify`, then change `showReports`, `carryOut`, `beginOne`,
   `afterStart` and the `prompt.submit` hook in `register.tsx`, and the
   needs-you and begin-held effects in `act.ts`.
6. Update the existing expectations listed below.
7. Update the band, reports and held paragraphs of `mods/foreman/README.md`,
   and say there that the engine cannot raise a notification in the desktop
   app.

## Test plan

Each item maps to a bullet of the spec's Verification section.

1. **Kept past ten minutes, released by typing** (`tests/reports.test.ts`).
   With `notify = 'off'` and `notifyReason = 'no-surface'`, an opened report
   is still in the band after 25 minutes. After a composer prompt, it is
   still there at 9 minutes 59 seconds and gone at 10 minutes 1 second.
2. **Other prompts do not release it** (same file). A plugin prompt, a peer
   prompt, an SDK prompt made only of the app's parts, and an SDK prompt with
   a CI event each leave it in the band 15 minutes later.
3. **The count** (same file). Three failed reports show the newest followed by
   "(2 more since your last message.)". A single one shows the sentence
   alone. Two sentences in one failed notification count as two. A delivered
   report while one is kept adds one. After typing, the sentence shows alone.
   Unit tests cover `noticeArrived`, `noticeFailed`, `afterTyped` and `shownReport`, including
   the old `{ text, at }` shape and damaged values.
4. **Which notices are kept.** A failed needs-you notice and a failed held
   notice stay in the band (`tests/acts.test.ts`). A failed begin-held notice
   stays, and failed begin-failed and list-failed notices do not
   (`tests/queued.test.ts`). A failed failed-checks notice does not
   (`tests/unwatched.test.ts`). `tests/act.test.ts` checks the effects' flags,
   and `tests/tickets.test.ts` checks that `keep: true` survives `effectIn`
   and `keep: 'yes'` is dropped.
5. **One log line per notice.** After the reason line has been logged once,
   a failed report adds only its sentence, a failed held notice adds only its
   "Held …" line, and a failed needs-you notice adds one "Could not raise a
   notification (no-surface): …" line.
6. **The reason line.** The first `no-surface` failure with
   `surfaces = ['desktop']` logs one reason line naming `desktop`. A second
   adds none. A hanging call after it, at 31 seconds, adds its own line. No
   surfaces gives `none`, a failed surfaces read gives `unknown` and the
   notice is still kept, and a throw gives "the call failed".
7. **A notification that goes.** The existing ten-minute tests in
   `reports.test.ts` and the "Raised a notification: ABC-1 needs you" test in
   `acts.test.ts` stay, and a delivered needs-you notice is not in the band.

Existing expectations that change:

- `tests/reports.test.ts`, the test of a report whose notification is not
  raised: no "Could not raise a notification (disabled): …" line, the reason
  line instead, and the sentence still in the band.
- `tests/acts.test.ts`, the held test that expects "Raised a notification:"
  with the held notice: that line is now absent, because the notice is quiet.
- `tests/act.test.ts`, the needs-you effect: it gains `keep: true`.
