# Never name a project in this repository

This repository holds generic skills, agents and mods that any repository can
use, and it is shared with other people. Nothing written here may name the
project, client, product or person that a piece of work came from.

## What counts as a name

- The name of a repository, app, product, company or client, including short
  forms, code names and the names of their domains, bundle identifiers or
  package names.
- The name of a person other than in commit authorship.
- A local path that reveals any of the above, such as a home folder or a
  checkout path.
- An identifier that only makes sense inside one project, such as one of its
  database table names, environment names or service names.
- An issue number or pull request number from any tracker, such as a tracker
  key like `XYZ-123` or a reference like `#42`. These tie the text to one
  team's tracker, they mean nothing to anyone else who uses these skills, and
  a reader cannot follow them. This includes the issues of this repository's
  own maintainers, and it applies to specs, plans, code comments and tests as
  much as to skills.

Names of public tools and platforms that the skills genuinely depend on, such
as Claude Code, git, GitHub or TypeScript, are fine, because they are what the
skills run on rather than where an incident happened.

## Where it applies

Everywhere in this repository: skills, agents, mods, `README.md`, specs and
plans under `docs/specs/`, code comments, test fixtures, commit messages,
branch names and pull request descriptions. A spec still describes the
incident behind a requirement, but in generic terms.

## What to write instead

Describe the role the thing played rather than what it was called. Write "a
web app with a hosted database", "the client's repository" or "a session
working on an unrelated issue" instead of the real name. When an example needs
a concrete name, use an obviously invented placeholder such as `example-app`,
`acme` or `my-project`.

When text needs to point at an earlier piece of work, name it by what it did
or by the spec that describes it, for example "the change that made the mod show
its true state (see `docs/specs/pilot-true-state.md`)", never by its
issue number. When a skill or a test needs an example issue key, use the
obvious placeholder `ABC-123`, which the code and tests already use. When
quoted output needs a pull request number, write `#N`. Invented numbers in a
worked example or a test, such as a made-up sequence of runs `#40`, `#41` and
`#42` or a fake repository `o/r#7`, are fine, because they point at nothing.

## Before you finish

Before committing, reread every line you added or changed and ask whether a
stranger could tell which project it came from. If they could, rewrite it.

Then search the staged changes for issue keys and pull request numbers:

```bash
git diff --cached | grep -nE '[A-Z]{2,}-[0-9]+|(^|[^&/[:alnum:]])#[0-9]+'
```

Every match that points at a real issue or pull request has to go. Only the
placeholder `ABC-123` and invented example numbers may stay. When the work
started in another repository, also search the staged changes for that
repository's name and its obvious variants with `git diff --cached | grep -i`.
Run that search locally only, so the name never lands in a commit or a pull
request.
