# Plan: foreman and the desktop app's idle wake, findings

Date: 2026-11-04. Spec: `foreman-app-idle-wake-findings.md`.

## Tournament

Two planners ran blind, one with the prior of the simplest change and one with
the prior of the most robust change. Both reached the same plan, so there was
nothing for a judge to choose between, and no judge ran.

## Chosen approach

The pull request holds only the spec. No foreman file changes, not even a
comment beside foreman's rewrite of the app's wake or a sentence in the
foreman README pointing at the spec.

## Grafts

- From the robust plan: describe the waiting-queue change by what it does
  rather than by its spec's file name, because that spec lives on a branch that
  may not have merged when this one does, and a file name would then point at
  nothing.
- From both plans: say in the spec's Verification section that the count of
  held wakes in the app's log is a snapshot from the day it was written.

## Rejected alternatives

- A pointer to the spec in `mods/foreman/hooks/notes.ts`, in
  `mods/foreman/hooks/register.tsx` or in the foreman README. Those are the
  lines a parallel change is rewriting, so the pointer would conflict at
  merge. It would also break the counsel's decision that the pull request
  holds only the spec, and it would pin a finding about one app version in
  code, where it goes stale unseen.

## Steps

1. Commit this plan alone.
2. Reword the spec's reference to the waiting-queue change, and rewrap the
   Verification line about the log count, in one commit.
3. Check that the diff against the base holds only the spec and this plan,
   search it for issue keys, pull request numbers, local paths and project
   names, push, and open the pull request.

## Test plan

No gate reads `docs/specs`, so the gates say nothing about this change, and
the report says so. The reviewers check the spec against the evidence: the
parent's saved record and the app's log for the first answer, and the app's
code for the second, which the spec marks as read from code and not observed.
