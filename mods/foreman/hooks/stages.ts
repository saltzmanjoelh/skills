// The nine stages of /implement, with the words builder's band shows for
// each. The list is a copy of STAGES in builder's hooks/progress.ts, because
// a mod cannot import another plugin's files; tests/art.test.ts holds it to
// builder's.

import type { StageId as BuilderStageId } from 'builder'

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

// Builder's state contract names the stages too. This line stops the type
// check when the two lists differ in either direction, so a stage added to
// builder cannot go unnoticed here.
const STAGES_MATCH_BUILDER: [StageId, BuilderStageId] extends [BuilderStageId, StageId] ? true : never = true
void STAGES_MATCH_BUILDER

// Whether a value is one of the nine stage ids.
export const isStage = (raw: unknown): raw is StageId => typeof raw === 'string' && STAGES.some(stage => stage.id === raw)

// The words for the stage `id`.
export const stageLabel = (id: StageId) => STAGES.find(stage => stage.id === id)!.label
