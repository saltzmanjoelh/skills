# The owner is asked before any change for a case they may never hit

Written 2026-10-21. It changes one skill, `skills/implement/SKILL.md`, and no
code. It follows up the change that added the rule for owner questions
(`foreman-build-lessons.md`), whose review left this as a follow-up because
fixing it would have taken a push past the limit.

## Goal

In `/implement`, a review finding whose claim holds only if the owner works in
a certain way goes to the owner as a question before anything is fixed for it.
The rule makes one exception: "a cheap follow-up is fixed as before". The
cheap kind, as the second half's point 4 defines it, also covers small test
tightening and "a visible problem small enough to fix". So a session can make
a small change to what the code does, or to its tests, for a case the owner
may never hit, such as clearing a parent session, without asking them. That
is the guess the rule exists to prevent.

This change narrows the exception to findings that change nothing a session
or the code does: wording in specs, plans, comments and the README,
rewrapping, and renames. Every other finding that depends on how the owner
works goes to the owner, however small its fix.

## Users and trigger

Every `/implement` session in a review round, and the owner, who is asked the
round's one question. The trigger was the review of the change that added
the rule, which found the gap and could not fix it within its push limit.

## Behavior

- **The rule for owner questions.** Its exception reads: a finding whose
  mechanism the claim checker refuted is dropped as before, and a cheap
  follow-up is fixed as before only when it is wording in specs, plans,
  comments or the README, rewrapping, or a rename, and its fix changes
  nothing a session or the code does. A rename of a configuration key or a
  command-line flag, for example, does change what the code does, so it
  goes to the owner. Every other finding that
  depends on how the owner works, including a cheap follow-up that is small
  test tightening and a visible problem small enough to fix, goes to the
  owner in the round's one question, as the rule already describes.
- **The second half's point 4, the cheap kind.** It gains the same exception
  the speculative kind already has: a finding the rule for owner questions
  sends to the owner is not fixed here as a cheap one. It waits on the
  owner's answer, and then goes on as any other finding or is dropped.
- **The second half's point 4, the counsel kind.** It gains the same
  exception, so that a finding taken out of the cheap kind is not put to the
  counsel instead, where a vote could fix it without asking the owner. This
  holds even for a finding outside the spec, which point 4 otherwise always
  puts to the counsel.
- Nothing else in the skill changes. The owner's answer is recorded, and the
  finding is listed, exactly as the rule for owner questions and the round's
  lists already say.

## Edge cases

- A finding that depends on how the owner works and whose fix renames a
  local name inside code is still fixed without asking, because that rename
  changes nothing the code does.
- Wording in a file that Claude Code loads as instructions, such as a skill,
  was never cheap, so it already goes to the owner and does not change.
- A round in which the only owner-dependent findings are wording, rewrapping
  or renames asks the owner nothing, as before.

## Non-goals

- The earlier change's spec and plan are left as they are. Its plan,
  `foreman-build-lessons-plan.md`, says "a cheap follow-up is fixed as
  before" in its step for the review rule and in its reasoning for that
  step; this spec supersedes both sentences.
- The definition of the cheap kind for findings that do not depend on how
  the owner works does not change. Small test tightening and small visible
  problems stay cheap there.
- The limit rule in point 4, which lists cheap follow-ups as dropped or to
  file when a commit would pass a limit, does not change.
- The spec skill and the plan tournament skill do not change.

## Failure modes

If a session still fixes a small visible problem that depends on how the
owner works without asking, the owner gets code built for a case they may
never hit, and the finding never reaches `## Already decided` with the
owner's answer, so a later round can raise it again.

## Verification

No gate reads `skills/` or `docs/`, so the reviewers verify this by reading.

1. The rule for owner questions in `skills/implement/SKILL.md` lets through
   without asking only cheap follow-ups that are wording in specs, plans,
   comments or the README, rewrapping, or a rename, and names small test
   tightening and a visible problem small enough to fix as going to the
   owner.
2. The cheap kind in the second half's point 4 says that a finding the rule
   for owner questions sends to the owner is not fixed there as a cheap one,
   and the counsel kind says that such a finding is not put to the counsel.
3. No other passage of `skills/implement/SKILL.md` lets an owner-dependent
   finding be fixed without asking, other than the narrowed exception.
4. `foreman-build-lessons.md` and `foreman-build-lessons-plan.md` are
   unchanged.

## Decided by the counsel

- The earlier change that added the rule for owner questions has a plan, docs/specs/foreman-build-lessons-plan.md, which says in two places that "a cheap follow-up is fixed as before" without asking the owner. This change narrows that exception in skills/implement/SKILL.md to wording, rewrapping and renames. Should this change also edit the earlier plan so it matches, or leave the earlier plan as the record of what that change decided and let the new spec state the narrowed rule? The counsel chose: Leave the earlier plan and spec untouched as historical records; the new spec states the narrowed rule and names the earlier plan's sentences it supersedes. 7 of 7 members voted for it.
