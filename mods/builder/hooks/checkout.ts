// How the package and review tools find the checkout of the watched pull
// request: the worktree that has the pull request's head branch checked out,
// read from git's list of worktrees, and the sentence a refusal uses to say
// which folder it compared. Every function is pure; hooks/register.tsx runs
// git and passes its output in.

import { printable } from './text'

// The folder the tools work in, the head branch they looked for, and how they
// chose the folder: the worktree that has the branch, the session's folder
// because no worktree has it, or the session's folder because git could not
// list the worktrees.
export type Checkout = { dir: string; branch: string; how: 'worktree' | 'no-worktree' | 'unlisted' }

// The path of the first worktree that has `branch` checked out, read from the
// output of `git worktree list --porcelain -z`, or null when none has it. Each
// field ends with a NUL byte and an empty field ends a record, so a path is
// read whole whatever characters it holds. A field must equal the branch line
// exactly, so `feature` never matches `feature-2`. A detached or bare entry has
// no branch line and never matches, and a prunable one still does, because git
// keeps its branch reserved. An empty branch matches nothing.
export function worktreeWithBranch(listing: string, branch: string): string | null {
  if (branch === '') return null
  const wanted = `branch refs/heads/${branch}`
  let path: string | null = null
  let found = false
  for (const field of listing.split('\0')) {
    if (field === '') {
      if (found && path !== null) return path
      path = null
      found = false
    } else if (field.startsWith('worktree ')) {
      path = field.slice('worktree '.length)
    } else if (field === wanted) {
      found = true
    }
  }
  // A listing cut short of its last empty field still counts its last record.
  return found && path !== null ? path : null
}

// The sentence that names the folder the package tool compared with the pull
// request's head, and how it chose that folder. On a pull request from a fork
// someone outside the repository chose the branch's name, so it is printed
// through printable.
export function checkoutSentence(c: Checkout): string {
  const name = printable(c.branch, 100)
  if (c.how === 'worktree') return `It compared ${c.dir}, the worktree that has ${name} checked out.`
  if (c.how === 'no-worktree') return `It compared ${c.dir}, the session's folder, because no worktree has ${name} checked out.`
  return `It compared ${c.dir}, the session's folder, because git could not list the worktrees.`
}
