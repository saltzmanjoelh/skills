---
name: storypr
description: Open or update a pull request whose description tells the narrative story of the feature(s) on the branch, illustrated with real in-app screenshots. Use when the user wants to create/open a "story PR", add screenshots to a PR, or make a PR that tells the story of the feature rather than a dry changelog.
---

# storypr: story-driven PR with screenshots

A repeatable runbook for opening (or updating) a PR whose body **reads like a
story** of what the branch does and **shows it** with **real screenshots of
the running app**.

> **Hard rule: real screenshots only.** Every image must be a capture of the
> actual UI running real code. SVG mockups, design-token renders, hand-drawn
> approximations, or any image not produced by running the real app are **not
> acceptable**, not even as a fallback. If you cannot capture a real
> screenshot in the current environment, **stop and tell the user** instead of
> substituting a mockup.

> The one thing that makes or breaks this: **PNGs must be committed and pushed
> to the branch BEFORE the PR body references them.** Get the order wrong and
> every image 404s, and you redo the PR. See step 3 and step 6.

## Project facts

Read these facts from the project's `CLAUDE.md`. Each is either one
`Label: value` line anywhere in the file or a section under its own heading.
When a fact is missing, or there is no `CLAUDE.md`, use its default.

| Fact | Default |
|---|---|
| `Base branch:` | `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` |
| `Screenshot directory:` | `docs/screenshots/` |

In the text below, a directory fact stands for the directory without its
trailing slash, so that no path contains `//`.

## Steps

### 1. Figure out the story from the branch
Diff the branch against `<base branch>` and read the commits to understand the
*feature(s)*, not just the file churn.

Fetch the base first. A stale local copy of the base can hide commits the
branch carries, or show the base's own newer commits as if the branch had
made them. The three-dot diffs compare against the point where the branch
left the base, so they show only the branch's own changes.

```bash
git fetch origin <base branch>
git log --oneline origin/<base branch>..HEAD
git diff --stat origin/<base branch>...HEAD
git diff origin/<base branch>...HEAD          # skim the meaningful hunks
```

Distill it to: **what changed, why it matters, what the user now sees.** That
framing drives both the narrative and which screens are worth screenshotting.

### 2. Capture real screenshots of the running app
Use the highest-fidelity **real-capture** path that works in the current
environment. Every path below runs the actual app/components and produces real
pixels, and none of them draws the UI by hand.

**How to capture depends on the project, so discover its path first.** Read the
project's CLAUDE.md, docs/, and scripts for an existing screenshot/E2E
automation or a documented way to run the app. Use what the project already
has before inventing anything.

**Path A (preferred): a true app capture.** Run the app the way this project
runs (its dev server, simulator/emulator, device build, or E2E harness) and
capture the actual screen: via the project's own screenshot automation if it
has one (seed its demo data, run it, collect the PNGs), the platform's
screenshot command, or a headless-browser capture of a web app. These are the
gold standard: actual captures of the shipped UI.

**Path B (acceptable): the real screen components rendered to pixels.** When
the full app can't run here, render the **actual screen components** (not
reconstructions) in whatever headless harness the stack supports (e.g. a
web/component build of the real UI under a headless browser), mocking only
the data layer so screens render deterministically, then screenshot to PNG.
This runs the real UI code, so it is a real screenshot of the real
components, not a mockup.

**Not acceptable (do not do this):** authoring SVG/HTML mockups, rendering
design tokens into an approximation of the screen, or any image that isn't a
capture of the real running UI. If neither Path A nor Path B is achievable
here (no device, and the browser/Chromium can't be installed), **stop and
report that**, and ask the user to run the capture on a machine with a
simulator, or to grant whatever the capture path needs. A mockup is never the
answer.

**Verify what you captured.** Inspect each PNG by reading it (the Read tool
renders images visually) and confirm it is the real screen before trusting it.

**Say which path you used in the PR:** Path A = captures of the running app;
Path B = renders of the real screen components (data layer mocked). Never imply
a render is a device capture, and never present anything hand-authored.

### 3. Commit + push the PNGs to the branch FIRST
This is the ordering pitfall. The PR body will link images by raw branch URL, so
the files must already exist on the branch before the body is written.

```bash
git add <screenshot directory>/*.png
git commit -m "Add screenshots for <feature>"
git push
```

Do this **before** writing or posting the PR body. A clean PR pushes images
first; a PR that needs a second pass posted the body first and had to be edited
after the 404s showed up.

### 4. Write the narrative PR body
Structure, in order:

1. **What & why**: a few short paragraphs telling the story: the problem, what
   the branch does, what the user now experiences. Narrative, not a changelog.
2. **Screenshots**: a 2-column markdown table so shots sit side by side, each
   an `<img>` with a raw branch URL and `width="300"`:

   ```markdown
   ## Screenshots

   | Estimate list | Estimate detail |
   | --- | --- |
   | <img src="https://github.com/<owner>/<repo>/blob/<branch>/<screenshot directory>/estimate-list.png?raw=true" width="300"> | <img src="https://github.com/<owner>/<repo>/blob/<branch>/<screenshot directory>/estimate-detail.png?raw=true" width="300"> |
   ```

   Note near the table which capture path was used (running-app capture, or
   real-component render with the data layer mocked).
3. **Gates / tests**: the gate report as the `## Report` section of
   `/verify-loop` describes it, with one exception: never paste a gate's raw
   error output into the description, because it is published and can hold a
   connection string, a token or a home-folder path. Give each failing gate's
   failing test or check names instead. No one-word verdict.

End with the standard Claude Code footer (see Conventions).

### 5. Create or update the PR
Create a new PR, or update the existing one's body if a PR already exists.

```bash
gh pr create --base <base branch> --title "<title>" --body-file /tmp/pr-body.md
# or, if it already exists:
gh pr edit --body-file /tmp/pr-body.md
```

### 6. VERIFY every image URL resolves, before declaring done
Each `blob/<branch>/<path>?raw=true` URL must resolve.

For a **public** repo, an anonymous request returns HTTP 200:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://github.com/<owner>/<repo>/blob/<branch>/<screenshot directory>/estimate-list.png?raw=true"
```

For a **private** repo, that anonymous check returns 404 even when the image is
fine. Verify presence through the authenticated API instead:

```bash
gh api "repos/<owner>/<repo>/contents/<screenshot directory>/estimate-list.png?ref=<branch>" \
  --jq '.path'
```

If a file is genuinely missing, the PNG wasn't pushed (revisit step 3) or the
path/branch in the URL is wrong. Only call it done once every image resolves.

## Conventions
- **Image folder:** commit PNGs to `<screenshot directory>`.
- **Layout:** 2-column markdown table, `<img ... width="300">` per cell, so
  screens sit side by side.
- **Raw URL format:**
  `https://github.com/<owner>/<repo>/blob/<branch>/<path-to-png>?raw=true`
  (use the actual branch name, not the base branch).
- **Real screenshots only:** never substitute an SVG/HTML mockup or a
  design-token render for a real capture. If no real-capture path works in the
  current environment, stop and report. Don't ship a mockup.
- **Order is load-bearing:** capture the PNGs, commit and push them to the
  branch, write and post the body, then check that every image link resolves.
  Never post the body before the images are on the branch.
- **Footer:** end the PR body with the standard Claude Code footer.
