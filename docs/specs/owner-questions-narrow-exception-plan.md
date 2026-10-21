# Plan: the owner is asked before any change for a case they may never hit

Written 2026-10-21 for `owner-questions-narrow-exception.md`.

## Chosen approach

Two planners competed, one aiming for the smallest change and one for the
most robust. The most robust plan won. It edits three passages of
`skills/implement/SKILL.md` and nothing else, keeps no state, and changes no
data.

1. **The rule for owner questions.** The sentence "A finding whose mechanism
   the claim checker refuted is dropped as before, and a cheap follow-up is
   fixed as before." becomes three sentences:

   > A finding whose mechanism the claim checker refuted is dropped as
   > before. A cheap follow-up is fixed as before only when it is wording in
   > specs, plans, comments or the README, rewrapping, or a rename, and its
   > fix changes nothing a session or the code does. Every other such
   > finding of the round goes to the owner in one question, however small
   > its fix, including a cheap follow-up that is small test tightening and
   > a visible problem small enough to fix.

   The rest of the paragraph is unchanged apart from rewrapping.
2. **The cheap kind in the second half's point 4.** This sentence is added at
   the end of the bullet:

   > A finding the rule for owner questions sends to the owner is not fixed
   > here as a cheap one, however small its fix: it waits on the owner's
   > answer, and then goes on as any other finding or is dropped, as that
   > rule says.
3. **The counsel kind in the same point.** This sentence is added at the end
   of the bullet:

   > A finding the rule for owner questions sends to the owner is not put to
   > the counsel, even when it is outside the spec: it waits on the owner's
   > answer, and then goes on as any other finding or is dropped, as that
   > rule says.

## Grafts

- **From the judge:** the rule requires both the list and the test "its fix
  changes nothing a session or the code does". The winning plan gave the
  list only as the reason the test holds, which still let a session read
  "it is a rename, so it changes nothing". With both required, a rename of a
  configuration key or a command-line flag goes to the owner.
- **From the judge:** the counsel kind's exception is its own sentence at the
  end of the bullet, so that "every other follow-up" stays joined to its
  "whether" clause, and it says "even when it is outside the spec", which
  also covers the opening of point 4, where a finding outside the spec is
  always for the counsel.
- **From the smallest plan:** the rule repeats the cheap kind's list word for
  word, so that a reviewer can match it to the spec directly.

## Rejected alternatives

- **The smallest plan's cheap-kind sentence**, which began "Neither applies
  to a finding…". "Neither" points back at the two sentences before it, and
  the reader has to work out what it covers.
- **Leaving the counsel kind alone**, on the ground that the rule already
  says such a finding is "neither fixed nor sent to the counsel". Point 4
  sorts every follow-up into exactly three kinds, and the counsel kind is
  "every other follow-up", so a session reading point 4 from the top would
  put an owner-dependent test tightening to the counsel, whose vote could
  fix it without asking the owner. The spec was amended to bring this edit
  into scope.
- **Editing the earlier change's plan**, which the counsel decided against,
  7 of 7.

## State and its edge cases

The change keeps no state. A restart, a resumed or cleared session, a hot
reload and two copies running at once behave as before, because the owner's
answer is still recorded in the `Dropped:` lists, `## Already decided` and
the spec. A session in the middle of a round when the skill changes may
already have fixed a small test tightening under the old text; that is an
early fix, not broken state, and needs nothing.

## Steps

1. Make the three edits in `skills/implement/SKILL.md`, wrapped at 76
   columns or less like the text around them.
2. Run the four gates. None of them reads `skills/` or `docs/`, so the report
   says that the gates did not read this change.

## Test plan

No gate reads this change, so each item of the spec's Verification is
checked by reading and grep.

1. Read the rule for owner questions. `grep -n "is fixed as before"
   skills/implement/SKILL.md` finds one hit, in the rule, carrying the list
   and the test, and the rule names small test tightening and a visible
   problem small enough to fix as going to the owner.
2. `grep -n "not fixed here as a cheap one"` and `grep -n "is not put to the
   counsel"` each find one hit, in the cheap kind and the counsel kind.
3. `grep -n "owner questions" skills/implement/SKILL.md` and a read of every
   hit, together with every passage that fixes a finding (`grep -nE "Fix
   it|Fix every|fixed in this pull request|fixed together"`), show that no
   path fixes an owner-dependent finding without asking, other than the
   narrowed exception.
4. `git diff --stat origin/main -- docs/specs/foreman-build-lessons.md
   docs/specs/foreman-build-lessons-plan.md` prints nothing.

Before committing, the staged diff is searched for issue keys and pull
request numbers, as `.claude/rules/no-project-names.md` asks.

## Not done

- The limit rule in point 4 does not change. When the owner confirms a case
  and the fix is small test tightening, a commit past the limit drops the
  fix while the owner's answer goes to `To file:`; this gap was there before
  and is left as it is.
- The earlier change's spec and plan are not edited.
