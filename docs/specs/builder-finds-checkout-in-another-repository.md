# The builder mod finds a checkout in another repository

Date: 2026-10-29

## Goal

The package and review tools find the checkout of the watched pull request
by running `git worktree list --porcelain -z` from the session's folder and
using the worktree that has the pull request's head branch checked out (see
`docs/specs/pilot-finds-pr-checkout.md`). That list holds only the worktrees
of the session folder's own repository.

A session started in a worktree of a back-end repository and opened its pull
request in a separate front-end repository. The watch tool worked, because it
takes `repo` and every `gh` call passes `--repo`. The package tool refused:
"The checkout is at <x> but the pull request's head is <y>; push or
pull first. It compared <the session's folder>, the session's folder, because
no worktree has <the head branch> checked out." The head branch was checked
out in a worktree of the front-end repository, which the back-end
repository's list could never show.

After this change, a session can name a checkout of the pull request's
repository when it starts the watch, and the package and review tools then
find the head branch's worktree among that checkout's worktrees.

## Behavior

- The watch tool takes an optional `checkout`, an absolute path inside a
  checkout of the pull request's repository.
- When `checkout` is given, the watch tool asks gh for that folder's
  repository before it watches anything. It refuses, and keeps what was
  watched before, when the path is not absolute, when gh cannot name the
  folder's repository, or when `repo` is given and names another repository.
  GitHub names are compared without regard to case. Without `repo`, it
  watches the checkout's repository.
- The watched run stores `checkout` only when it was given.
- The package and review tools list the worktrees from the stored `checkout`
  when there is one, else from the session's folder as before. When no
  worktree has the head branch, or git cannot list them, they use the folder
  they listed from.
- A refusal that fell back to a given checkout names it as "the checkout
  given to the watch tool" rather than as "the session's folder".
- When the package tool refuses after falling back to the session's folder,
  with no checkout given, it asks gh for that folder's repository. When gh
  names a repository other than the watched one, the refusal adds: "The
  session's folder is a checkout of <that repository>, not of <the watched
  one>, so call the watch tool again with checkout set to a folder inside a
  checkout of <the watched one>."

## Why a given checkout rather than a search

The other way would be to notice that the session folder's repository is not
the watched one and then look for a checkout of the watched one. Git knows
nothing about unrelated repositories, so that look would have to search the
disk, for example the session folder's neighbours, and any such search is a
guess that can find a stale clone or nothing. The session that opened the
pull request knows where it did so. The mismatch check is kept, but only to
tell the session what to do when it forgot.

## A session in the right repository

A session that never gives `checkout` stores the same run as before and lists
the worktrees from the same folder. Every answer is the same. The one
difference is one `gh repo view` call in the refusal that falls back to the
session's folder, and gh then names the watched repository, so no sentence is
added.

## Non-goals

- The counsel tool still uses the session's folder.
- `gh` calls keep running from the session's folder, because they pass
  `--repo`.
- `/builder watch <n>` takes no checkout.

## Verification

Tests in `mods/builder/tests/register.test.ts`, each seen failing first:

- A session in `/api`, a checkout of `o/api`, watches `o/r#7` with
  `checkout: '/web'`. The package is written under the git folder of
  `/web-wt`, the worktree of `/web` on the head branch. The worktrees are
  listed from `/web`, and `git rev-parse HEAD` runs in `/web-wt`.
- The same session's review tool stages `review.md` under `/web-wt`'s git
  folder.
- Given only `checkout`, the watch tool watches the checkout's repository.
- Given `checkout: '/api'` and `repo: 'o/r'`, the watch tool refuses and
  reads no pull request.
- With no checkout given, the refusal names the session's folder and adds the
  sentence about calling the watch tool with `checkout`.
- When no worktree of the given checkout has the head branch, the refusal
  names it as the checkout given to the watch tool.

Tests in `mods/builder/tests/checkout.test.ts` cover the new sentences. All
the existing tests pass unchanged.
