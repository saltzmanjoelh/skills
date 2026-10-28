// The builder mod's state contract: what $.state holds and the pull request
// snapshot it is built from. Self-contained, as the engine requires.

export type CheckState = 'pending' | 'passed' | 'failed'
// `completedAt` is when the check last completed, as GitHub prints it. A check
// that has not completed, or whose gh output carried no time, has none.
export type Check = { name: string; state: CheckState; completedAt?: string }
// One of the head's GitHub Actions workflow runs that has not completed.
// `attempt` is GitHub's run_attempt, which a rerun raises while the id stays.
export type WorkflowRun = { id: number; attempt: number; name: string }
export type Verdict = 'APPROVE' | 'REQUEST_CHANGES'
export type Verdicts = { sha: string; spec: Verdict; adversarial: Verdict }

export type Snapshot = {
  repo: string
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  head: string
  labels: string[]
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  checks: Check[]
  // The newest verdict review posted at the current head, or null when the
  // head has none yet.
  verdicts: Verdicts | null
  // How many heads drew a verdict review from this login, whichever way the
  // verdicts went. roundInProgress turns it into the round in progress.
  headsReviewed: number
  // Commits pushed since the newest changes-requested verdict review.
  pushesSinceVerdict: number
  // The head's unfinished workflow runs, sorted by id and then attempt. A
  // snapshot an older build stored has none, and every reader takes a
  // missing field as no runs.
  runs?: WorkflowRun[]
  // Set when the runs read failed at this look, so the runs are the ones the
  // stored snapshot had. It is left out of the fingerprint.
  runsCarriedOver?: true
  fingerprint: string
}

// The pull request the session works on. Set only when asked: by the watch
// tool, or by /builder watch.
// `since` is when this watch began, so work begun under an earlier watch of
// the same pull request can tell it is stale.
export type BuilderRun = { repo: string; number: number; cwd: string; login: string; since: number }

// The engine's words for where an agent's loop stands, as `$.agent.list()`
// gives them. A card an older build saved may still hold 'done' or 'aborted';
// every reader goes through isRunning in hooks/state.ts, which reads those as
// not running.
export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

export type AgentCard = {
  id: string
  type: string
  description: string
  // The start of what the agent was asked. An agent the mod first saw in the
  // engine's list, rather than spawning, has none.
  asked?: string
  status: AgentStatus
  startedAt: number
  durationMs?: number
  // The answer's last line when it is an end line, else its first words.
  summary?: string
  // Whether the engine's list named the agent at the last read. A card with
  // no such field counts as listed, as every card did before the list was read.
  isListed?: boolean
  // When the mod saw the agent stop running, if it has.
  endedAt?: number
  // When the engine's list last named the agent.
  lastSeenAt?: number
  // The model the engine answered when the agent was spawned. An agent the
  // mod did not see spawn, or a card an older build saved, has none.
  model?: string
}

// One piece of the session's own background work, as the engine last reported
// it at the end of the session's own turn or of one of its subagents: a shell
// command, a monitor or a workflow. A background subagent is an agent and is
// not kept here.
export type BackgroundTask = { id: string; type: string; status: string; description: string; command?: string }

// A tool call of the session's own while it runs, keyed by the call's
// tool_use_id. `label` is what the line names it by.
export type ForegroundCall = { id: string; tool: string; label: string; startedAt: number }

// `labelled` says the mod put needs-decision on for this question, so it is
// the mod's to take off, on the pull request named here; `unlabelled` says it has.
export type Question = {
  asked: string
  at: number
  answered: boolean
  labelled: boolean
  unlabelled?: boolean
  repo?: string
  number?: number
}

// What made the mod look at the pull request, and whether anything had moved.
// 'after-command' is a look after the session's own push or merge, and
// 'resume' the one look at the end of a usage-limit hold.
export type Wake = { at: number; source: 'poll' | 'turn-end' | 'after-command' | 'ci-monitor' | 'watch' | 'command' | 'review' | 'session-start' | 'resume'; changed: boolean }

export type WaitingOn = 'agents' | 'ci' | 'fix' | 'owner' | 'merge' | 'nothing'

// When the mod's next look at the pull request is due, in milliseconds since
// the epoch, and whether that look was brought forward because the pull
// request's head differs from the head the session was last told.
export type NextLook = { at: number; isNewHead: boolean }

// One member's vote on a counsel question, as the mod read it from the
// member's report: an option's number, or 'none' when no option is right.
// Members are no longer offered 'abstain', but it is still read and stored,
// so that a tally recorded before every member had to vote, and a round sent
// to the person because a member asked again still had no vote, show the
// member's reason. A member whose vote could not be read is not stored, like
// a member the session left out. A tally recorded before abstentions may
// still hold null for none, so every reader of its votes goes through
// turnoutOf in hooks/counsel.ts, which reads that null as none.
export type CounselVote = { member: string; vote: number | 'none' | 'abstain'; reason: string; newOption?: string }

// One follow-up's count on a follow-ups question. `votes` holds the members'
// votes on that follow-up alone, read like any other votes, so turnoutOf in
// hooks/counsel.ts names the members without a vote on it. `counts` holds the
// votes for each of the three options, in their order, and `chosen` is the
// number of the option at least 4 of the 7 members chose, counted from 1. A
// follow-up without `chosen` was not decided, and is dropped.
export type FollowUpCount = { votes: CounselVote[]; counts: number[]; chosen?: number }

// One round's count. `counts` holds the votes for each option, in the
// options' order, from the members who took part; `chosen` is the decided option's number, counted from 1;
// `proposed` holds the new options members proposed this round, de-duplicated.
// A follow-ups question's one round has the outcome 'counted': each follow-up
// was counted on its own, into `followUps` in the follow-ups' order, and the
// tally's own `votes`, `counts` and `proposed` are empty. Every other tally
// has no `followUps`.
export type CounselTally = {
  round: 1 | 2
  votes: CounselVote[]
  counts: number[]
  outcome: 'decided' | 'rerun' | 'ask' | 'counted'
  chosen?: number
  proposed: string[]
  followUps?: FollowUpCount[]
}

// A question the session put to the counsel. `lean` is the session's own
// answer, kept out of the brief. `pr` is the pull request the session named
// with pull_request when the question was put, which was then watched and
// open; a decision on the question is owed to that pull request's next
// review. A question put without pull_request has no `pr`, and its decision
// is recorded in the spec. `askedAgain` names the
// members the mod asked the session to launch again, because they had no
// vote, in the round the question waits on; a rerun empties it. A question
// stored before members were asked again has no such field, which reads as
// nobody asked again. `followUps` holds the follow-ups of a follow-ups
// question, in the order the session gave them, and such a question holds
// the three fixed options in `options`, never has `pr`, has one round only
// and never reruns. An ordinary question, and every question stored before
// follow-ups questions existed, has no `followUps`. `outsideSpec` holds the
// numbers, counted from 1, of the follow-ups outside the spec, which the
// counsel may only file or drop. A question stored before follow-ups could be
// outside the spec has none, and all its follow-ups are in scope.
export type CounselQuestion = {
  id: string
  question: string
  options: string[]
  background: string
  paths: string[]
  lean: string
  folder: string
  round: 1 | 2
  tallies: CounselTally[]
  askedAgain?: string[]
  pr?: { repo: string; number: number }
  // When the mod last told the session to launch members for the round the
  // question waits on: at the counsel call, and at a tally that asks members
  // again or reruns. A question stored before this was kept has none, and
  // plans no members.
  launchedAt?: number
  followUps?: string[]
  outsideSpec?: number[]
}

// The nine stages of /implement, in order. hooks/progress.ts lists them with
// their labels, and a check there fails the type check when the two lists
// differ.
export type StageId = 'grounding' | 'issue' | 'spec' | 'plan' | 'build' | 'verify' | 'pr' | 'review' | 'merge'

// The work the session reports through the progress tool. `stage` is the
// stage last reported and `furthest` the furthest one reported for this
// title, which the bar counts, so going back to an earlier stage never lowers
// the count. `note` is a sub-step shown beside the stage. `since` is when the
// title was first reported, so a pull request watched before then is not this
// work's. `autoOpened` says the pane already opened on its own for this title.
export type Progress = { title: string; stage: StageId; furthest: StageId; note: string; since: number; autoOpened: boolean }

// The newest package call: the pull request's head it packaged for review and
// when, from which the pane works out the reviewers still to be launched.
export type Packaged = { head: string; at: number }

// A usage-limit hold: when it resumes, in milliseconds since the epoch.
export type UsageHold = { until: number }

// One commit the mod's own files were read at, from the git checkout the mod
// was loaded from. `differs` says whether the last comparison found the files
// it stands for different at the checkout's HEAD. A null commit means one of
// two things, and only `differs` tells them apart. When git could not read
// HEAD at the load, `differs` is false and never changes, so a folder that is
// not a checkout never warns. When the session commit is unknown because the
// session reloaded from a build that kept no record, `differs` is true and
// only a restart clears it. `pending` is true only on a session part that a
// reload recorded while the first load of this build still waited on git:
// its commit is null and `differs` false until that load fills it in, and no
// comparison reads it meanwhile.
export type LoadedCommit = { commit: string | null; differs: boolean; pending?: true }

// How the first load of this build in the session began: at the session's
// start, or as a hot reload from an older build, one that kept no record of
// its commits. Every load writes it before it runs git, and it survives a hot
// reload but not a restart.
export type LoadBegun = 'atStart' | 'fromOlderBuild'

// The status file builder writes for the foreman, a mod that runs several
// /implement sessions from one parent session and reads one file per session.
// Builder writes it only in a session whose first prompt holds a line
// `foreman-ticket: <value>`, at `<config>/foreman/builds/<session id>.json`,
// where `<config>` is CLAUDE_CONFIG_DIR when it is set and `$HOME/.claude`
// otherwise. The foreman names builder as a dependency and type-checks its
// reader against these types, so the field names are the ones the two mods
// agreed and must not change without raising `version`. Every time is
// milliseconds since the epoch. The README section "The status file for the
// foreman" describes each field and when the file is written and deleted.

// The stage last reported through the progress tool, one of the nine.
export type BuildStage = StageId

// What the session is doing, as the foreman shows it. When more than one
// holds, the first of these holds: needs-you, working, waiting-on-builder,
// in-cleanup, done, idle. hooks/status.ts lists the rules in that order, and a
// check there fails the type check when the rules and this list differ.
export type BuildState = 'working' | 'waiting-on-builder' | 'idle' | 'needs-you' | 'in-cleanup' | 'done'

export type BuildStatus = {
  // Raised whenever a field changes meaning.
  version: 1
  // The engine's session id, the same as the file's name.
  sessionId: string
  // The value of the first prompt's `foreman-ticket:` line.
  ticket: string
  // The desktop app's session id, from CLAUDE_CODE_HOST_SESSION_ID. It is left
  // out when that variable is unset, as outside the desktop app.
  desktopSessionId?: string
  // The folder the session started in, so the foreman can find the session
  // before it knows the desktop id.
  cwd: string
  // A leading issue key, such as ABC-123, of the title last reported through
  // the progress tool, or null when the title has none or nothing was reported.
  issueKey: string | null
  // The rest of that title, or the empty string before any report.
  issueTitle: string
  // The stage last reported, or null before any report.
  stage: BuildStage | null
  // The stages done out of nine, as the progress bar counts them: 0 before
  // any report, and all nine once the watched pull request merged.
  stageDone: number
  // The watched pull request, or null before a watch has read it. `checks`
  // is the checks' overall state as the band shows it, and `none` when the
  // pull request has no checks. `verdicts` is the newest verdict pair at the
  // current head, with the head's full commit id, or null when the head has
  // none. No review text is ever written.
  pr: {
    repo: string
    number: number
    state: 'OPEN' | 'MERGED' | 'CLOSED'
    checks: 'pending' | 'passed' | 'failed' | 'none'
    verdicts: Verdicts | null
  } | null
  state: BuildState
  // One line that says why the state holds. It names a tool but never copies
  // a tool's input, which can hold commands, paths or secrets.
  reason: string
  // When the state began: the time of the write at which it last changed.
  stateSince: number
  // When the file was written.
  writtenAt: number
  // Present once the cleanup skill has started, whatever the state: how many
  // tool calls have failed since, and the last line of the newest failure's
  // error, cleaned, or the empty string until a call fails.
  cleanup?: { failedCalls: number; lastError: string }
  // Present only while the state is working and the only thing running is
  // background work: the session's own turn is not running, no agent and no
  // tool call of its own is running, and at least one background task is in
  // flight. `since` is when this background-only wait began. It is kept across
  // a short turn of the session's own as long as one of the tasks the wait
  // began with is still in flight, and a wait begins afresh once none is.
  // `tasks` holds the descriptions of at most three tasks, the wait's own
  // first, each cleaned and cut short, or the withheld text in place of one
  // that looks like a secret. A task's command is never written. An older
  // record has no such field.
  backgroundOnly?: { since: number; tasks: string[] }
  // Present whenever at least one background task is in flight, whatever the
  // state: the oldest task by its start time. `description` is cleaned and cut
  // short like those in `backgroundOnly`, or the withheld text in place of one
  // that looks like a secret, or the empty string when the task has none; a
  // task's command is never written. `startedAt` is when builder recorded the
  // task as started, and `hungAt` is when it counts as probably hung, its start
  // plus builder's 15 minutes. The three stay fixed while the same task is the
  // oldest. An older record has no such field.
  oldestBackground?: { description: string; startedAt: number; hungAt: number }
}

// The permission prompts of one loop and one tool that are open: `loop` is
// the empty string for the session's own loop and an agent's id for a
// subagent's, and `count` is how many prompts are open, since each return of
// the tool closes one.
export type OpenPrompt = { loop: string; tool: string; count: number }

// What the status file needs that no other value of the state holds, stamped
// with the session it belongs to, so a memo of another session (after a
// /clear whose end was cut off) reads as none. Read through statusMemoIn in
// hooks/status.ts.
export type StatusMemo = {
  // The session id the memo belongs to.
  sessionId: string
  // The ticket, or null when the first prompt was looked at and holds none.
  ticket: string | null
  // Where the file goes, or null when no safe path could be made from the
  // configuration folder and the session id, in which case nothing is written.
  path: string | null
  // The desktop app's session id, read with the ticket, when it was set.
  desktopSessionId?: string
  // The folder the session started in, read with the ticket.
  cwd: string
  // The state last written and when it began, or null before the first write.
  state: BuildState | null
  stateSince: number
  // When a counsel tally last sent a question to the person, or null when
  // none is waiting on them. An AskUserQuestion call that started after it,
  // once it ends, or a prompt of the person's clears it.
  askedAt: number | null
  // The permission prompts that are open.
  prompts: OpenPrompt[]
  // The cleanup record, or null before the cleanup skill started.
  cleanup: { failedCalls: number; lastError: string } | null
  // The background-only wait the record's `backgroundOnly` reports, or null
  // when none has begun: when it began, and the keys of the tasks in flight
  // then, each a task's id, or its kind and description when it has no id. It
  // is kept while one of those keys is in flight. A memo an older build saved
  // without it, or with a value in another shape, reads as none.
  backgroundWait: { since: number; keys: string[] } | null
  // The load stamp of the module's copy that owns the memo, which orders the
  // copies by when they loaded. Only a copy whose stamp is not below it may
  // take the memo up, and taking it up sets it to that copy's stamp, so a
  // writer left running by the copy from before a hot reload sees it is not
  // the newest and stops, and that copy cannot take the memo back.
  generation: number
}

// The commits the running mod was loaded from: `session` at the session's
// first start, for the files the engine reads only then, and `hooks` at the
// hooks module's last load, for the rest of the hooks folder. `head` is the
// checkout's HEAD that the last comparison read, or null before the first.
// Read through loadedIn in hooks/loaded.ts.
export type Loaded = { head: string | null; session: LoadedCommit; hooks: LoadedCommit }

declare module 'claude-code' {
  interface PluginState {
    builder: {
      run: BuilderRun | null
      pr: Snapshot | null
      agents: AgentCard[]
      questions: Question[]
      wakes: Wake[]
      // The folder the session started in, where gh and git run.
      cwd: string | null
      // Whether the session's own turn is running, so a change is held until it ends.
      busy: boolean
      // The next scheduled look, or null when no look is scheduled (nothing is
      // watched, or the pull request merged or closed).
      nextLook: NextLook | null
      // The session's counsel questions, oldest first. Only the newest 20 are
      // kept; a decision a posted review has not yet listed is kept in the store.
      counsel: CounselQuestion[]
      // The session's background work as last reported. Replaced at each end
      // of the session's own turn, and at each subagent's end that reports a
      // list; a task leaves it early when the transcript draws its notification
      // saying it completed, failed or was killed.
      background: BackgroundTask[]
      // When each background task started, in milliseconds since the epoch,
      // keyed as taskKeyOf in hooks/status.ts keys a task. A Bash call of the
      // session's own that went to the background holds the time the call
      // started; any other task holds the time a turn end first listed it. A
      // start is dropped only when the session's own turn end reports a list
      // without its task, or when a completion notice takes the task off the
      // list. A subagent's end never drops one, even when its list leaves the
      // task out.
      backgroundStarts: Record<string, number>
      // The session's own tool calls in progress, oldest first.
      calls: ForegroundCall[]
      // Whether builder was started this session, by the open_pane tool or the
      // /builder command. It stays true for the rest of the session.
      started: boolean
      // The work the session last reported through the progress tool, or null
      // before the first report. Read through progressIn in hooks/progress.ts.
      progress: Progress | null
      // The newest package call, or null before the first.
      packaged: Packaged | null
      // Whether the pane folds its finished agents under one heading.
      finishedFolded: boolean
      // The agent whose output the agent pane shows, or null when none was chosen.
      outputAgent: string | null
      // When the session last went quiet. It restarts at the end of the
      // session's own turn or of a subagent, at a look that found the watched
      // pull request changed, at a new watch, at the end of a usage-limit
      // hold, when a read of the engine's agent list shows an agent ended, and
      // when the stuck timer fires, whether or not it sends the stuck prompt.
      // Null before any of them. The stuck prompt counts from it. The README
      // section "When the session goes quiet, and when a usage limit runs
      // out" describes each moment.
      quietSince: number | null
      // How long the session may stay quiet before the stuck prompt, in
      // milliseconds. It doubles after each stuck prompt up to a ceiling, and
      // goes back to the first interval on a change, a new watch or the
      // person's prompt. A value that is not a positive finite number reads
      // as the first interval.
      stuckEvery: number
      // The usage-limit hold that is on, or null when none is. A value in
      // another shape reads as no hold.
      usageHold: UsageHold | null
      // The commits the mod was loaded from, or null before the first load
      // recorded them. It survives a hot reload, so the session commit is
      // never rewritten in the session; a restart starts without it.
      loaded: Loaded | null
      // How the first load of this build in the session began, or null before
      // it. Read through loadBegunAs in hooks/loaded.ts.
      loadBegun: LoadBegun | null
      // What the status file for the foreman needs beyond the values above,
      // or null before the first prompt was looked at for a ticket and after
      // a /clear. Read through statusMemoIn in hooks/status.ts.
      statusMemo: StatusMemo | null
    }
  }
}
