// The parent's settings: whether this session is the parent, its slot count
// and whether it is paused. They are kept in $.state for the drawings and in
// $.store under the session's id, so a resume or a reload finds them again.
// writeParent in hooks/register.tsx writes both, because the engine reads a
// module's state only through atoms declared in the file that uses them.

import type { ForemanParent } from '../types'
import { MAX_SLOTS, MIN_SLOTS } from './commands'

// The settings of a session that never ran /foreman.
export const PARENT_OFF: ForemanParent = { isOn: false, slots: null, isPaused: false }

// The slot count when neither /foreman slots nor the option sets one.
export const DEFAULT_SLOTS = 2

// The store key that holds a session's settings.
export const storeKey = (sessionId: string) => `parent:${sessionId}`

const isSlotCount = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= MIN_SLOTS && raw <= MAX_SLOTS

// Stored settings read tolerantly: each field that is not what the mod writes
// reads as it does for a session that never ran /foreman.
export function parentIn(raw: unknown): ForemanParent {
  if (typeof raw !== 'object' || raw === null) return PARENT_OFF
  const p = raw as Record<string, unknown>
  return { isOn: p.isOn === true, slots: isSlotCount(p.slots) ? p.slots : null, isPaused: p.isPaused === true }
}

// The slot count in force: the one /foreman slots set, else the `slots`
// option when it is a whole number from 1 to 20, else two.
export function slotsOf(settings: ForemanParent, option: unknown): number {
  if (settings.slots !== null) return settings.slots
  return isSlotCount(option) ? option : DEFAULT_SLOTS
}
