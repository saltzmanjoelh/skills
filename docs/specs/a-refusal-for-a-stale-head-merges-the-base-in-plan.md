# Plan: a refusal for a stale head merges the base in

Spec: `docs/specs/a-refusal-for-a-stale-head-merges-the-base-in.md`. Written
2026-10-15. A two-plan tournament, because the change is two sentences of one
skill.

## Plan A: a new step in the list

Add a step to "With the pull request open", between **Conflicting** and **A
check or a workflow run failed at the head**, named **Behind after a refusal**,
which fires when the last merge command refused and the head lacks the base's
tip.

Weakness: the list is decided from the pull request's state on every turn, and
"the last merge command refused" is not part of that state, so a resumed
session cannot evaluate the step's condition. It also adds a step whose action
is word for word another step's.

## Plan B: widen the merge step's refusal sentence and name it in Conflicting

Replace "If the command refuses, say why and wait." with the rule: on a
refusal, fetch the base and run `git merge-base --is-ancestor origin/<base>
<head>`; when the head does not contain the base's tip, do what
**Conflicting** says and go on as **When a turn ends** says; when it does, or
the check fails, say why and wait. Add one sentence to **Conflicting** saying it
also covers that refusal.

Strength: the decision sits where the refusal happens, the action stays in one
step, and the condition is git's, so any project's merge command is covered.

## Verdict

Plan B. Plan A needs state the list does not have and duplicates an action;
Plan B changes two sentences and keeps one place for the action.

## Steps

1. Edit the merge paragraph of step 9 in `skills/implement/SKILL.md`.
2. Edit step 4, **Conflicting**, with the one added sentence.
3. Read both against the spec's Verification; no gate reads `skills/`.
