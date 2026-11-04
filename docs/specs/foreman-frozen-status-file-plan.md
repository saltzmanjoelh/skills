# Plan: foreman wakes the parent when a sub session's status file freezes

Date: 2026-11-03. Spec: `docs/specs/foreman-frozen-status-file.md`.

## Chosen approach

The simplest plan won, with three ideas grafted from the other two. One pure
rule, `frozenRule(s)`, goes into `mods/foreman/hooks/act.ts`. In `decide` it
runs right after `goneRule(s)`, inside the existing `if (!overRule(s))`
block, and only on a read whose folder listing worked. Because it runs last
and reads `s.p` as the earlier rules left it, three things follow from the
code that is already there:

- a gone wake on the same read wins, because `goneRule` has just set
  `goneWokeFor`;
- a pairing that the done rule freed on this read is skipped, because
  `markFreed` sets `s.p.standing` to `'freed'` and the rule checks for
  `'active'`;
- a pairing that the over rule freed never reaches the rule.

The rule wakes when the pairing is active, the read's listing worked, the
pull request has not merged, the file is strictly more than `FROZEN_MS` old,
`goneWokeFor` differs from the file's modification time, and the idle
stretch has not woken the parent for this stall (it counts idleness, has
woken, and `stallsOwn` holds). It then pushes
`{ kind: 'frozen', who, minutes, state }` and sets `goneWokeFor` to the
modification time. When the stretch counts idleness and `stallsOwn` holds, it
also sets the stretch's `woke` flag, as `goneRule` does.

The mark is the stored `goneWokeFor` field. No field is added, and no
migration or reader default is needed.

## Grafts

1. **The `told` option on `idleRule`, from the most-extensible plan.** The
   stall branch of `STATE_RULES.working` passes `told` when `goneWokeFor`
   equals the file's modification time. At its two wake points `idleRule`
   then marks the stretch woken without pushing a reason. Both nudges still
   go. This closes the one hole in rule 5: a frozen wake that went while the
   list failed, before any stall nudge, would otherwise be followed by the
   stall's own wake once the list showed the session stopped. A stretch
   cannot simply be marked woken at the frozen wake, because `staleStretch`
   treats a stretch that woke without nudging as one from before the stall
   and starts it afresh. The same flag makes true the README's existing
   claim that an earlier gone wake counts as its stall's wake. The
   background branch does not pass the flag, because the spec lets a
   background wake and a frozen wake both come for one stretch.
2. **The listing guard, from the most-robust plan.** When `$.fs.list`
   fails, `readFolder` answers no files, the kept rows go to `decide` with
   their old modification times, and `listed` is false. Every file would
   then look older on every read, and ten minutes of failed listings would
   wake the parent for every active sub session. The gone and stall rules
   avoid this because they also need the desktop app's list; the frozen rule
   has only the file's age, so it checks `listed`.
3. **The sentence, from the most-robust plan's opening and the
   most-extensible plan's state words:**
   `<who>'s status file has not changed for <n> minutes and still shows the state <state words>.`
   The state words come from `STATE_LOOK[state].words` in `subs.ts`, such as
   "waiting on builder" or "needs you", so the sentence matches the band and
   the pane. Its opening differs from the gone sentence's from the second
   word, so the parent's model cannot match it to the gone heading. The state
   is one of builder's six checked names, not text a sub session wrote, so
   it is not quoted and the line gets no data sentence.

## Rejected alternatives

- **The simplest plan's honouring branch** marked a stretch woken as soon as
  it had nudged after the mark was set. It closed the hole but dropped the
  stall's second nudge, both after a frozen wake and after a gone wake, and
  the spec keeps the stall rule's nudges.
- **Leaving the hole in rule 5 and describing it in the README**, as the
  most-robust plan proposed, fails the spec's Behavior section.
- **A due time at the ten-minute mark.** A frozen file's row is stale, so
  foreman reads at least every two minutes and the wake lands between ten and
  twelve minutes, as the gone wake does today. A due time pushed while the
  rule is silenced or guarded could make reads spin once a second.
- **New helpers (`mergedIn`, `stallStretch`, `wokenForFile`, `stallWoken`)
  and a shared `notUpdated` sentence fragment.** They rewrite parts of the
  gone and stall rules that the spec asks to change only to honour the mark.
  The shared fragment would also make the new sentence open like the gone
  one.
- **Changing `readEvery` to give every read a fresh modification time.** It
  silently changes what 42 test calls mean. A helper that tests opt into is
  used instead.
- **A new ledger field for the mark.** `goneWokeFor` already means "the
  parent has been told about this modification time", and an older foreman
  reading a newer ledger honours it.

## Known interactions

- With the default five-minute idle limit, a stall is nudged at about six
  and eleven minutes. The frozen wake comes at eleven, on the same read as
  the second nudge, and stands as that stretch's wake, so the stall's own
  wake at sixteen does not come. The stall tests change their expected reads
  on purpose to pin this.
- `afterRead` keeps the last good record, with its old modification time,
  for a file that is rewritten with text that does not parse. Such a file
  gets the frozen wake once. A code comment notes it; no code changes.

## Steps

1. Tests first in `mods/foreman/tests/wake.test.ts`: pin the new sentence in
   "every wake sentence is pinned", check it for each state's words, and
   check that `splitReasons` puts it among the wakes. See them fail.
2. Tests first in `mods/foreman/tests/act.test.ts` (listed below). Add a
   helper that gives a row a fresh modification time on each read, and move
   onto it the existing tests that model a live session and now fail. Change
   the expected reads of the stall tests where the frozen wake now comes.
   See the new tests fail.
3. `mods/foreman/hooks/wake.ts`: the `frozen` kind in `Reason` with
   `BuildState` imported as a type, its `REASON_WORDS` entry, and the comment
   above the union.
4. `mods/foreman/hooks/act.ts`: `FROZEN_MS`, `frozenRule` with its comment,
   the call in `decide`, the `told` option on `idleRule` passed from the stall
   branch, and comments on `mayBeGone`, `goneRule`, `slotsNeedList` and
   `decide`.
5. `mods/foreman/types/index.d.ts`: the comment on `goneWokeFor` says the
   frozen wake sets it too.
6. `mods/foreman/skills/wake/SKILL.md`: a section headed
   `## <who>'s status file has not changed for <n> minutes and still shows the state <state>.`
   after the gone section, with spec rule 8's steps, and the new kind in the
   frontmatter description.
7. `mods/foreman/README.md`: a `frozen` row in the rules table, the working
   and gone rows, the list-read paragraph, the paragraph on how often each
   wake comes, and the wake list.
8. Run the four gates.

## Test plan

Each item of the spec's Verification section, with the extra cases the judge
asked for:

- **In each state, at ten minutes, naming the state, not before.** For each
  of `STATES`, a read at `T0 + FROZEN_MS` brings no frozen reason and a read
  one millisecond later brings `{ kind: 'frozen', minutes: 10, state }`. The
  done case reads a list that shows the session running.
- **Once per stretch, and again after a new freeze.** A `waiting-on-builder`
  row read every minute to forty, with its modification time moving at
  fifteen, wakes at eleven and twenty-six only.
- **A merged pull request gets no wake; a closed one gets it once.**
- **A gone wake silences it**, on an earlier read and on the same read (a
  first read at eleven minutes with the session not running gives only the
  gone reason).
- **A stall wake silences it**, with a two-minute idle limit: nudges at six
  and eight, the idle wake at ten, nothing after.
- **A stall only nudged, with a list that cannot be read, still gets it**,
  its stretch counts as woken, `stallsNeedList` turns false, and later reads
  with the session stopped bring no nudge and no wake.
- **After it goes, the gone rule does not wake** for the same stretch.
- **It goes with a list that cannot be read and with one that shows the
  session running.** The existing test of a stopped working file under those
  lists is rewritten to expect the frozen wake at eleven, and a record with
  no desktop session is added.
- **The hole in rule 5 stays closed:** a frozen wake that went before any
  stall nudge, then a list showing the session stopped, brings both nudges
  and no second wake; the same after a gone wake that went first.
- **A failed folder listing brings no frozen wake.**
- **A modification time later than the clock wakes nothing.**
- **A pairing the done rule or the over rule frees on a read gets no frozen
  wake on it.**
- **The mark survives the ledger's round trip** through JSON and
  `ticketsIn`, so a restart does not repeat the wake.
