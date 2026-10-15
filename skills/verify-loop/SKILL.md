---
name: verify-loop
description: Run the project's declared gates (test, lint, typecheck, etc. from its CLAUDE.md) and fix failures in a loop until every gate passes or the loop is genuinely stuck. Use after making changes, when the user says "verify", "make it green", or before any merge/commit of code changes.
---

# Verify Loop

Iterate: write, run the gates, fix, until every gate passes. Cost class:
single-agent loop.

## Project facts

Read these facts from the project's `CLAUDE.md`. Each is either one
`Label: value` line anywhere in the file or a section under its own heading.
When a fact is missing, or there is no `CLAUDE.md`, use its default.

| Fact | Default |
|---|---|
| `## Gates` heading, one bullet per gate | detect from the manifests, confirm once, offer to write it |

## Procedure

1. **Read the gates** from the bullets under the project's `## Gates`
   heading, in order. Gates are declared, never assumed. If there is no such
   section, detect candidates from the manifests, confirm them with the user
   once, and offer to write them into the project's `CLAUDE.md` under a
   `## Gates` heading, one bullet per gate. If nothing is detected and the
   user names no gate, stop and report that the project has no gates: a
   project with nothing to fail has not passed.
2. **Start prerequisites** the gates declare (e.g. a backend suite that
   needs a local DB/service running). Start it first rather than skipping
   that gate.
3. **Run all gates**, even after the first failure. One round-trip should
   surface every failure, not just the first.
4. **Fix and rerun.** Fix all failures, rerun only the gates that failed,
   then one final full pass of every gate once every failed gate passes
   (fixes can break other gates).
5. **Loop cap: 5 rounds.** If the same gate fails 3 times with the same
   class of error, or 5 rounds elapse, stop and write a stuck report.

A gate passes only when it exits successfully and, if it runs tests, ran at
least one. A test gate that ran zero tests has failed, even when it exited 0:
treat it like any other failure, find out why nothing ran, and fix that.

The loop stops when it is green, which means every gate passed in the final
full pass. That is the only meaning of "green" here, and the report never
uses it.

## Rules

- **Never weaken a gate to pass it.** No skipping tests, loosening
  assertions, raising lint thresholds, adding ts-ignore, or deleting
  failing tests. If a test is genuinely wrong, say so explicitly and let
  the user decide. That is a finding, not a fix.
- Fix root causes, not symptoms: a type error patched with a cast is a
  failure deferred.

## Report

The report gives counts, not a verdict.

- List every gate in the order the project declares them. For each, give the
  command and the counts its own output prints in its most recent run: tests
  passed, failed and skipped, or the number of errors. When the tool prints
  no count, give its exit status. Say which round that run belongs to.
  When the loop finished, every gate's most recent run is the final full
  pass.
- For each gate that failed in its most recent run, give the names of the
  failing tests, or the failing checks, and the exact error output, so the
  reader can act without rerunning it.
- A gate that ran zero tests is reported as zero, and it has not passed, even
  when it exited 0.
- Then list every gate that did not run, with the reason.
- Then, when the project's `CLAUDE.md` says anywhere, in plain prose, which
  paths its gates do not read, list the changed files under those paths,
  because no gate checked them. This statement is not one of the facts above
  and has no default: a project that says nothing gets no such list.

Never close the report with a one-word summary. The reader judges from the
counts.

## Stuck report (when the loop ends with a gate still failing)

The report above, then what was tried each round, the current best
hypothesis, and what is needed to proceed (information, a decision, or a
deliberate gate change). An honest stuck report is better than a claimed pass
that did not happen.
