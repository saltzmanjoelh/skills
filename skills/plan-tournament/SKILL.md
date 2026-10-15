---
name: plan-tournament
description: Generate 2-3 independent implementation plans for a spec'd feature from different priors (simplest, most-robust, most-extensible), judge them against the spec and the user's decision heuristics, deliver the winner with the best ideas grafted in. Use before implementing a nontrivial feature, when the user says "tournament" or "plan options".
---

# Plan Tournament

Independent plans compete before any code is written. Cost class:
multi-agent (3-4 subagents).

## Project facts

Read these facts from the project's `CLAUDE.md`. Each is either one
`Label: value` line anywhere in the file or a section under its own heading.
When a fact is missing, or there is no `CLAUDE.md`, use its default.

| Fact | Default |
|---|---|
| `Spec directory:` | `docs/specs/` |
| `Architecture document:` | `docs/architecture.md`, skipped if missing |
| `Gotchas document:` | `docs/gotchas.md`, skipped if missing |

In the text below, a directory fact stands for the directory without its
trailing slash, so that no path contains `//`.

## Precondition: a spec

Tournaments need something to score against. If
`<spec directory>/<feature>.md` does not exist for this feature, run `/spec`
first (a 5 to 10 question interview). Do not run a tournament against a vague
sentence.

## Procedure

1. **Brief the planners.** Each gets the spec, the project's CLAUDE.md, the
   architecture document (its invariants matter most) and the gotchas
   document, leaving out each one that does not exist, and your global
   `~/.claude/CLAUDE.md`. Every planner gets the same brief.
2. **Fan out 3 planners in parallel** (Agent tool), each with a different
   prior it must honor:
   - **Simplest-thing**: smallest change that fully meets the spec. Bias:
     fewest new files, no new dependencies, no new abstractions.
   - **Most-robust**: failure modes and edge cases first. Bias: what
     breaks under concurrency, offline, bad data, partial completion.
   - **Most-extensible**: the spec's obvious next iterations land cheaply.
     Bias: seams and boundaries, WITHOUT speculative generality.
   Each returns: approach summary, files touched, data/migration changes,
   test plan (mapped to the spec's Verification section), risks, and
   what it deliberately does NOT do.
3. **Judge.** A judge agent scores each plan against: the spec (does it
   fully satisfy Behavior + Edge cases + Verification?), the invariants in
   the architecture document when there is one, and the owner's stated preferences in `~/.claude/CLAUDE.md`
   (e.g. infra-shaped problems prefer battle-tested dependencies). The
   judge must name concrete weaknesses, not just rank.
4. **Synthesize.** Take the winner; graft specific superior ideas from the
   runners-up (named, with why). Write the result to
   `<spec directory>/<feature>-plan.md`: chosen approach, grafts, rejected
   alternatives *with reasons* (this is source material for the architecture
   document),
   step sequence, test plan.
5. **Deliver** a readable summary: which prior won and why, what was
   grafted, the first implementation step. Offer to build the plan and then
   run `/verify-loop`.

## Rules

- Planners run blind to each other; only the judge compares.
- A tie or a judge verdict of "none satisfies the spec" goes back to the
  user with the specific gaps. Never paper over it with a merged mediocrity.
