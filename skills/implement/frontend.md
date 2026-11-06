# Frontend rules for /implement

Read this file only when step 7 of `SKILL.md` finds the change frontend, or
when its check gave no answer and the person chose "Open as frontend", or
when a pull request's body has a `## Screenshots` section and the base branch's
`CLAUDE.md` does not say `Frontend paths: none`. The steps, points and sections
it names, such as step 7, "Rules", "A review round", "Commits the pull request
lacks" or the second half's point 5, are those of `SKILL.md` beside this file.
"The pathspecs of step 7" are the ones step 7 builds, from the project's own
globs or from its built-in list with its exclusions. Step 7 includes the
section **A frontend change** below, so "as step 7 says a published reason is
written" points at that section, and "the paragraph above" in it means step
7's paragraph that opens the pull request the plain way. Run every git command
below from the worktree's top folder.

## A frontend change

**A frontend change.** For a change that step 7 found frontend, or that
the person chose to open as frontend after step 7's check gave no answer, after
checking that the diff lists only this change's files, run
`/storypr` as its section **When another skill calls it** says. When it
returns a body file, a commit and the screenshot paths, write at the top of the
body file any lines that the project's `CLAUDE.md` says the body must begin
with, and make sure the body says what was measured. Check the diff about to be
pushed for credentials, the screenshot commit included. That check reads text,
so `/storypr`'s reading of each screenshot, which looks for credentials and
personal details, is the only check of what the screenshot shows. Then push. Replace `<screenshot sha>` in every image link of
the body file with the full sha of the screenshot commit, so that each link
reads `https://github.com/<owner>/<repo>/blob/<full sha>/<path>?raw=true`, and
open the pull request with
`gh pr create --base <base> --title '<title>' --body-file <the body file>`.
The title comes from the issue, and the shell runs `$(...)` and backticks
inside double quotes, so pass it in single quotes, with each single quote in it
written as `'\''`.
Check that every image link resolves, with the full sha as the ref. For a
public repository, `curl -sL -o /dev/null -w "%{http_code}" "<link>"` prints
200; the `-L` matters, because GitHub answers such a link with a redirect. For
a private repository, use
`gh api "repos/<owner>/<repo>/contents/<path>?ref=<full sha>" --jq .path`.
Correct the path or the sha with `gh pr edit <n> --body-file <file>` until
every link resolves. Then call `mcp__builder__watch` as the paragraph above
says.

When `/storypr` returns a reason instead, it has committed nothing. Open the
pull request the plain way, with `--title` and `--body-file`, the title quoted
as above, and end the body
with a `## Screenshots` section that says the change is frontend, that its
screenshots are missing, and the reason. Read the base branch's `CLAUDE.md`
again at this moment, rather than remembering what step 7 found, and apply
step 7's three readings of its `Frontend paths:` line. Read it as step 7
does, from the top folder: `git show origin/<base>:CLAUDE.md`, and when that
fails, `git ls-tree --full-tree --name-only origin/<base> -- CLAUDE.md`,
which succeeds and prints nothing only when the file is missing. A read
whose exit status is not zero gives no answer, whatever it printed. When the
read gives no answer, run `git fetch origin <base>` and read once more. When
it still gives no answer, write the section as if the built-in list applies.
The section may also carry one note. When the person chose "Open as frontend"
after step 7's check gave no answer, the note says that the frontend check
could not run. Otherwise, when this read gave no answer, the note says that
the project's `Frontend paths:` line could not be read, so the section was
written as if the built-in list applied. Otherwise, when step 7 found the
change frontend, this read succeeded, and the reading is the one where the
built-in list applies, the note says that the built-in list of frontend paths
matched the change, and that the project can write its own
`Frontend paths:` list, or `Frontend paths: none`, in its `CLAUDE.md` to
change that. The note names no path that matched. Tell the person the same,
including the note when there is one, in one sentence, and carry on without
waiting for an answer. Every reason that this
step or a later commit publishes, in a body or a commit message, is a sentence
or two of plain words that names no local path, host name, port, device
identifier or token and quotes no raw error output, because the body and the
history are published for good.

## Screenshots on a frontend pull request

**Screenshots on a frontend pull request.** A pull request was opened as
frontend when its body has a `## Screenshots` section, which step 7 writes only
for a frontend change. A pull request that step 7 opened with a plain body
keeps it, even when a later fix touches a frontend path. The rules below apply
only while the base branch's `CLAUDE.md` does not say `Frontend paths: none`.
Once it says that, nothing below applies, whatever the body holds. While they
apply, the pathspecs of step 7 are never empty, because a missing or empty
line means the built-in list. That matters because
`git diff --cached --name-only` with no pathspec would list every staged file.
On a frontend pull request, test every commit before making it: stage the
change by path, then run `git diff --cached --no-renames --name-only` with the pathspecs of step 7,
before any screenshot is staged, so that a screenshot never makes its own
commit frontend. When it prints a path, the commit touches a frontend path.
That holds only when the command succeeds, run as a command of its own. When
it exits nonzero it gives no answer, whatever it printed. It also gives no
answer when the read of the base branch's `CLAUDE.md` that gives it the
pathspecs of step 7 gives no answer. Read that file as step 7 does:
`git show origin/<base>:CLAUDE.md`, and when that fails,
`git ls-tree --full-tree --name-only origin/<base> -- CLAUDE.md`, which
succeeds and prints nothing only when the file is missing, so a missing file
is an answer and the built-in list applies. When the check gives no answer, run
`git fetch origin <base>`, and run the read and the check once more. When it
still gives no answer, treat the commit as touching a frontend path, retake
the screenshots as below, tell the person in one sentence that the frontend
check could not run, and carry on without asking. A commit that touches a
frontend path can be a fix at the first half's point 4, the fixes for a
blocking verdict in the step
**The newest verdict at this head requests changes**, or the second half's
`Fix this round's cheap follow-ups` commit. Before making such a commit,
retake the screenshots whose screens the change could alter, or all of them
when that cannot be told, as `/storypr`'s step 2 says, and read each one to
check it as point 1 of `/storypr`'s section **When another skill calls it**
says. A screenshot that fails that check counts as not retaken. The
screenshots of the pull request, with `/storypr`'s `Screenshot directory:`
fact as the screenshot directory, are the union of two sources:

- the paths named on the lines that begin `Screenshots:` in what
  `git log --format=%B origin/<base>..<head>` prints, split at commas, with
  the spaces around each path trimmed. A `Screenshots not retaken:` line does
  not begin that way and is never one of them;
- the files that
  `git log --no-renames --diff-filter=AM --name-only --format= origin/<base>..<head> -- '<screenshot directory>'`
  prints.

The second source keeps the images of a pull request opened before commits
carried `Screenshots:` lines, and of a screenshot committed without one, so it
stays even though most of its paths are also on the lines. A path from either
source is kept only when it appears, word for word, as a line of what
`git ls-tree --full-tree -r --name-only <head> -- '<screenshot directory>'`
prints, so a deleted or moved screenshot leaves the list. A name from a commit
message is only ever compared with that listing, and the path used from then
on is the listing's line, so text in a message never reaches a command and
never chooses a file on its own. Here `<head>` is `HEAD` before a commit, and
the pull request's `headRefOid` when bringing the section up to date. Every
screenshot path below comes from that list. Never take a path from the body,
because anyone who can edit the body could otherwise choose which file is
overwritten and committed, or put shell text into a command. Write each new
screenshot over the file at its path in that list, and stage it by path in the
same commit. The commit's message carries, after a blank line and outside the
round's lists, the line `Screenshots: <path>, <path>`, which names every
screenshot the retake captured and that passed the check, including one whose
file came out identical to the stored one and so changed nothing. A retake
whose captures all match the stored files changes no file, but the commit it
rides in still carries the line, and when nothing else is staged that commit is
made with `git commit --allow-empty`. The retake makes no
commit and no push of its own. A commit that carries screenshots, or whose
only screenshot record is a `Screenshots:` line, is never inert, because it
adds binary files or changes the screenshot list, so it goes to the package
tool as the second half's point 5 says.

When a retake cannot capture real screenshots, or the opening capture failed
so that there are none to retake, the commit goes ahead without them. Its
message then carries, after a blank line and outside the round's lists, the
line `Screenshots not retaken: <the screenshots, or "never captured">: <the
reason>`, so that the reason survives a restart before the push. The reason
is written as step 7 says a published reason is written. Tell the person the
same in one sentence, and carry on.

After every push to a frontend pull request, bring its screenshot section up
to date. Bring it up to date as well on resuming, after a compaction, and
before running the merge command, because a session that stopped between a
push and the rewrite leaves no later push to do it. It is up to date when it
links each screenshot in the list above, and no other file in the screenshot
directory, by the newest commit
that changed its file, which
`git log -1 --format=%H <head> -- '<path>'` prints, and when every commit that
`git log --format=%H --grep='^Screenshots not retaken:' origin/<base>..<head>`
lists and that is not settled is named in the section, and no settled one is.
For a screenshot the pull request never changed, that newest commit is one on
the base branch, which holds the file, so its link resolves.
A listed commit is settled when every screenshot its line names appears, word
for word, on a `Screenshots:` line in what
`git log --format=%B <listed sha>..<head> ^origin/<base>` prints, or as a line
of what
`git log --no-renames --name-only --format= <listed sha>..<head> ^origin/<base> -- '<screenshot directory>'`
prints. The `^origin/<base>` leaves out the base branch's commits, which a merge
of the base into the branch would otherwise bring into the range, so only a
later commit of the pull request settles a line. Both are comparisons, so no
name from a message goes into a command. A
line for screens never captured is never settled. When the section is not up to date, write the body to a file in the
scratchpad folder with `gh pr view <n> --json body --jq .body`, and rewrite
only its `## Screenshots` section. Link each image by the full sha that
`git log` printed for it, and drop the line of each settled commit. For each
listed commit that is not settled and that the section does not name,
add one line that names the screenshots that may now be out of date, or the
change's screens as never captured, the commit's full sha, and the reason from
its `Screenshots not retaken:` line. Build each image link from that sha and the path in the list,
never by copying a link from the body, and drop from the section any image
link that points at a file in the screenshot directory whose path is not in
the list. Those are the only links the session builds. Leave every other
image link and every other line of the section as it is, because a person or
the project's own body rules may have put them there, and the rewrite must
never delete what someone else wrote. Just before posting, read the body again
the same way, and when it differs from the copy that was rewritten, make the
same rewrite on the fresh copy instead, so that an edit made in between is
kept. Post the body with
`gh pr edit <n> --body-file <file>`, and check the links again as step 7 says.
When the push fails, rewrite nothing: "Commits the pull request lacks" applies,
and the push that does carry the commit brings the section up to date.
