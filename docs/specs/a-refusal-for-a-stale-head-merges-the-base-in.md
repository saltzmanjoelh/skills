# A refusal for a stale head merges the base in

Issue: SAL-238. Written 2026-10-15.

## Goal

When a project's merge command refuses a pull request because its head does
not contain the base branch's tip, a session running `/implement` merges the
base in and pushes, instead of waiting for a change that will not come.

## Why

Two pull requests merged into one project's base branch within two hours.
Each was green against the base it was built on, but one added a test that did
not hold against the other's change, and the base stayed red for three days.
Nothing had tested the tree that merging produced.

That project's merge command now refuses any head that does not contain the
base's tip, because a head that does, merged with a merge commit, lands exactly
the tree its checks already tested. The skill's merge step says "If the command
refuses, say why and wait." Waiting cannot clear this refusal: only a new head
can. With several sessions working at once, every merge leaves the other ready
pull requests behind, and each would sit until its stuck prompt fired and a
person stepped in.

The skill already handles the same shape for a conflict: it merges the base in
(never rebases), reruns the gates the merge could move, and pushes. A stale
head needs exactly that.

## Users and trigger

A session running `/implement` reaches **Both verdicts approve at this head**,
runs the project's merge command, and the command refuses.

## Behavior

1. **The session checks the head itself.** On a refusal, it fetches the base
   and asks whether the head contains the base's tip:
   `git fetch origin <base>` and then
   `git merge-base --is-ancestor origin/<base> <head>`, whose exit status 0
   means the head contains the tip, 1 means it does not, and anything else
   means git could not answer. It decides from git,
   not from the wording of the refusal, so the rule holds for any project's
   merge command.
2. **A stale head is handled like a conflict.** When the head does not contain
   the base's tip, the session does what **Conflicting** says: merge the base
   in (never rebase), rerun the gates the merge could move, push, and go on as
   **When a turn ends** says.
3. **Any other refusal still waits.** When the head does contain the base's
   tip, or the fetch or the check fails, the session says why the command
   refused and waits, as before.
4. **The Conflicting step names the case.** Its text says the list never
   chooses it for a head that is merely behind, and that the merge step sends
   such a head there after a refusal, so nobody reads the list as routing a
   stale head on its own. A session resumed after a refusal reaches the merge
   step again, is refused again, and takes the same path.

## Edge cases

- The fetch fails: the session cannot tell, so it says why the command refused
  and waits. It never merges the base in on a guess.
- The base moves again before the new head is merged: the next refusal goes
  through the same rule, and **Over a limit** bounds how many times.
- A command that refuses for a stale head and a second reason at once: after
  the base is merged in, the next run of the command names the second reason,
  which then waits.

## Non-goals

- Keeping the verdicts across a head that only merged the base in. The new
  head goes through the review list as any other head does.
- Changing how a conflict is handled.
- Naming any project's refusal words in the skill.

## Failure modes

- If the session read the refusal's wording instead of asking git, a project
  whose command words it differently would wait for ever. The check in
  behaviour 1 is git's.
- If a failed check counted as "behind", a session could merge the base in for
  a refusal that had nothing to do with it. Behaviour 3 makes a failed check a
  wait.

## Verification

- `skills/implement/SKILL.md`'s merge step no longer ends a refusal with "say
  why and wait" unconditionally; it names the git check and sends a stale head
  to **Conflicting**.
- The **Conflicting** step says that the merge step, not the list, sends a
  stale head to it.
- The merge step lists its cases in order, the failed check first, and names
  the exit status of each, so that status 1 is never read as a failure.
- No gate reads `skills/`, so the reviewers check this text against the spec.

## Decided by the counsel

- The counsel decided this in the issue's own spec, 5 of 7: teach the skill,
  as a second pull request in the issue, rather than a sentence in one
  project's own instructions or a follow-up.
