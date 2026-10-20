// The rules of the progress the band and the pane show: the nine stages of
// /implement, how a stage report changes the recorded work, the bar's
// numbers, the agents the pane lists as planned, and the short names of
// models. Nothing here draws; hooks/art.ts and hooks/pane.tsx do. Every
// function is pure, so the tests can check each rule without the engine.

import type { AgentCard, CounselQuestion, Packaged, Progress, StageId as StoredStageId } from '../types'
import { COUNSEL_MEMBERS } from './counsel'
import type { Snapshot } from './github'
import { isRunning } from './state'
import { printable } from './text'

// The nine stages, in the order /implement goes through them, with the words
// the band shows for each.
export const STAGES = [
  { id: 'grounding', label: 'grounding' },
  { id: 'issue', label: 'checking the issue' },
  { id: 'spec', label: 'spec' },
  { id: 'plan', label: 'plan tournament' },
  { id: 'build', label: 'build' },
  { id: 'verify', label: 'verify' },
  { id: 'pr', label: 'pull request open' },
  { id: 'review', label: 'review rounds' },
  { id: 'merge', label: 'merge' },
] as const

export type StageId = (typeof STAGES)[number]['id']

// The state contract in types/index.d.ts spells the stages out again, because
// that file must stand alone. This line stops the type check when the two
// lists differ in either direction.
const STAGES_MATCH_THE_STATE: [StageId, StoredStageId] extends [StoredStageId, StageId] ? true : never = true
void STAGES_MATCH_THE_STATE

// How long a title and a note may be once cleaned.
export const TITLE_CHARS = 60
export const NOTE_CHARS = 40

const indexOf = (id: StageId) => STAGES.findIndex(stage => stage.id === id)
const isStage = (raw: unknown): raw is StageId => typeof raw === 'string' && STAGES.some(stage => stage.id === raw)

// The words the band shows for the stage `id`.
export const stageLabel = (id: StageId) => STAGES[indexOf(id)]!.label

// The stage ids as a sentence lists them, for a refused report.
const STAGE_LIST = `${STAGES.slice(0, -1).map(stage => stage.id).join(', ')} and ${STAGES.at(-1)!.id}`

// A stored progress value, or null when it is missing or any field is not
// what the mod writes: a stage outside the nine, a time that is not a finite
// number, or a furthest stage behind the stage shown.
export function progressIn(raw: unknown): Progress | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (typeof p.title !== 'string' || typeof p.note !== 'string') return null
  if (!isStage(p.stage) || !isStage(p.furthest)) return null
  if (indexOf(p.furthest) < indexOf(p.stage)) return null
  if (typeof p.since !== 'number' || !Number.isFinite(p.since)) return null
  if (typeof p.autoOpened !== 'boolean') return null
  return { title: p.title, stage: p.stage, furthest: p.furthest, note: p.note, since: p.since, autoOpened: p.autoOpened }
}

export type ReportInput = { title?: unknown; stage?: unknown; note?: unknown }

// Why a stage that is not one of the nine is refused, naming the nine.
function refusalOf(stage: unknown): string {
  const said = typeof stage === 'string' ? printable(stage, 40) : String(stage)
  return `${said === '' ? 'an empty stage' : said} is not a stage of /implement; the stages are ${STAGE_LIST}.`
}

// A stage report read from the tool's input: its stage, one of the nine, and
// its title and note cleaned as other text a model supplies is; or why it is
// refused. A report is refused only for its stage, and a refused report
// records nothing.
export type Report = { title: string; stage: StageId; note: string }

export function reportOf(input: ReportInput): Report | { refusal: string } {
  if (!isStage(input.stage)) return { refusal: refusalOf(input.stage) }
  return {
    title: printable(typeof input.title === 'string' ? input.title : '', TITLE_CHARS),
    stage: input.stage,
    note: printable(typeof input.note === 'string' ? input.note : '', NOTE_CHARS),
  }
}

// The work after a report at `now`. A title that differs from the recorded
// one starts new work: its own stage, from now, not yet opened, so the pane
// opens on its own again. The same title keeps when the work began and moves the
// furthest stage only forward. A report without a note clears the note the
// last one left.
export function afterReport(prev: Progress | null, report: Report, now: number): Progress {
  const { title, stage, note } = report
  if (prev === null || prev.title !== title) {
    return { title, stage, furthest: stage, note, since: now, autoOpened: false }
  }
  const furthest = indexOf(stage) > indexOf(prev.furthest) ? stage : prev.furthest
  return { ...prev, stage, furthest, note }
}

// The progress tool's answer for a recorded report: the stage reported and
// the stages before the furthest one reached, out of nine.
export const reportAnswer = (p: Progress) => `${p.stage} (${indexOf(p.furthest)} of ${STAGES.length})`

// The bar's numbers: the title, what the label says, the stages done out of
// nine, and that as a whole percentage.
export type Bar = { title: string; label: string; done: number; total: number; percent: number }

// The bar for the recorded work and the watched pull request, or null when
// there is nothing to show. `watchSince` is when the watch of that pull
// request began. The count is the number of stages before the furthest one
// reported. A pull request merged under this work, meaning watched at or after
// the work's first report, fills the bar and reads merged; a closed one keeps
// the count and reads closed. A merged or closed pull request draws a bar even
// when no stage was reported.
export function barOf(progress: Progress | null, pr: Snapshot | null, watchSince: number | null): Bar | null {
  const ended = endedOf(progress, pr, watchSince)
  if (progress === null && ended === null) return null
  const total = STAGES.length
  const done = barDone(progress, ended)
  return { title: progress?.title ?? '', label: barLabel(progress, ended), done, total, percent: Math.round((done / total) * 100) }
}

// How the recorded work ended, or null while it has not: the state of the
// watched pull request once it has merged or closed under this work, meaning
// watched at or after the work's first report, or under any watch when no
// stage was reported. The bar reads merged or closed exactly when this is not
// null, and the usage-limit hold asks the same question.
export function endedOf(progress: Progress | null, pr: Snapshot | null, watchSince: number | null): 'MERGED' | 'CLOSED' | null {
  const isThisWork = progress === null || (watchSince !== null && watchSince >= progress.since)
  return pr !== null && pr.state !== 'OPEN' && isThisWork ? pr.state : null
}

// How many stages the bar counts as done: all of them once the pull request
// under this work has merged, none when no stage was reported, and otherwise
// the stages before the furthest one reported. `ended` is the ended pull
// request's state, or null.
function barDone(progress: Progress | null, ended: string | null): number {
  if (ended === 'MERGED') return STAGES.length
  if (progress === null) return 0
  return indexOf(progress.furthest)
}

// What the bar's label says: merged or closed once the pull request under this
// work has ended, and otherwise the stage reported last, with its note when
// there is one. `ended` is the ended pull request's state, or null. barOf asks
// only when there is a report or an ended pull request, so the empty label for
// neither is never drawn.
function barLabel(progress: Progress | null, ended: string | null): string {
  if (ended === 'MERGED') return 'merged'
  if (ended === 'CLOSED') return 'closed'
  if (progress === null) return ''
  const stage = stageLabel(progress.stage)
  return progress.note === '' ? stage : `${stage} · ${progress.note}`
}

// The reviewers a review round launches first, after the package call, and
// the two whose verdicts decide, launched once the first four have finished.
// Together they are the six reviewers of REVIEWERS in hooks/state.ts. The
// order here is the order the pane lists planned agents in.
export const FOCUSED_REVIEWERS: readonly string[] = [
  'builder:security-reviewer',
  'builder:maintainability-reviewer',
  'builder:performance-reviewer',
  'builder:data-reviewer',
]
export const VERDICT_REVIEWERS: readonly string[] = ['builder:spec-reviewer', 'builder:adversarial-reviewer']
const PLANNED_ORDER = [...FOCUSED_REVIEWERS, ...VERDICT_REVIEWERS]

// What the planned agents are worked out from: the watched pull request (null
// when none is watched), the newest package call, the agents and the counsel
// questions, as the mod's state holds them.
export type PlannedInput = {
  pr: Snapshot | null
  packaged: Packaged | null
  agents: readonly AgentCard[]
  counsel: readonly CounselQuestion[]
}

const isFiniteTime = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t)

// The agent types the pane lists as planned: types the mod expects the session
// to launch next and that have not started since the cause. Worked out each
// time the pane is drawn and never stored, so a planned type goes when its
// cause goes.
//
// - After a package call at the watched head, while the pull request is open,
//   the four focused reviewers are planned. Once all four have started since
//   that call and none of them runs, the two verdict reviewers are planned.
// - A counsel question with no tally for the round it waits on plans the
//   members it last told the session to launch: those asked again when there
//   are any, else all seven.
//
// Each type is listed once, in a fixed order: the focused reviewers, then the
// verdict reviewers, then any other type in the order it was found.
export function plannedOf(input: PlannedInput): string[] {
  const startedSince = (type: string, at: number) => input.agents.filter(card => card.type === type && card.startedAt >= at)
  const planned = new Set<string>()
  const plan = (types: readonly string[], at: number) => {
    for (const type of types) if (startedSince(type, at).length === 0) planned.add(type)
  }

  const { pr, packaged } = input
  const isPackageSound = typeof packaged === 'object' && packaged !== null && typeof packaged.head === 'string' && isFiniteTime(packaged.at)
  if (pr !== null && pr.state === 'OPEN' && isPackageSound && packaged.head === pr.head) {
    plan(FOCUSED_REVIEWERS, packaged.at)
    const focusedSince = FOCUSED_REVIEWERS.map(type => startedSince(type, packaged.at))
    const focusedHaveFinished = focusedSince.every(cards => cards.length > 0 && !cards.some(isRunning))
    if (focusedHaveFinished) plan(VERDICT_REVIEWERS, packaged.at)
  }

  for (const q of input.counsel) {
    if (!isFiniteTime(q.launchedAt)) continue
    if (q.tallies.some(t => t.round === q.round)) continue
    const asked = q.askedAgain ?? []
    plan(asked.length > 0 ? asked : COUNSEL_MEMBERS, q.launchedAt)
  }

  const known = PLANNED_ORDER.filter(type => planned.has(type))
  const others = [...planned].filter(type => !PLANNED_ORDER.includes(type))
  return [...known, ...others]
}

const MODEL_FAMILIES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' }

// A model id as an agent row names it: `claude-opus-5-5` as Opus 5.5,
// `claude-sonnet-4-20250514` as Sonnet 4, a bare `haiku` as Haiku. Any other
// id is shown cleaned and cut short, and no id at all as a hyphen.
export function modelLabel(id: unknown): string {
  if (typeof id !== 'string' || id.trim() === '') return '-'
  const known = /^(?:claude-)?([a-z]+)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:-\d{8})?(?:\[1m\])?$/i.exec(id.trim())
  const family = known === null ? undefined : MODEL_FAMILIES[known[1]!.toLowerCase()]
  if (known !== null && family !== undefined) {
    const [, , major, minor] = known
    if (major === undefined) return family
    return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`
  }
  const shown = printable(id, 24)
  return shown === '' ? '-' : shown
}
