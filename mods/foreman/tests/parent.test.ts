import { expect, test } from 'claude-code/testing'

import { parentIn, PARENT_OFF, slotsOf, storeKey } from '../hooks/parent'

test('the parent settings read back what was written, and read as off in any other shape', () => {
  const on = { isOn: true, slots: 3, isPaused: true }
  expect(parentIn(on)).toEqual(on)
  expect(parentIn({ isOn: true, slots: null, isPaused: false })).toEqual({ isOn: true, slots: null, isPaused: false })
  expect(parentIn(undefined)).toEqual(PARENT_OFF)
  expect(parentIn('on')).toEqual(PARENT_OFF)
  expect(parentIn({ isOn: 'yes', slots: 3 })).toEqual({ ...PARENT_OFF, slots: 3 })
  expect(parentIn({ isOn: true, slots: 0 })).toEqual({ isOn: true, slots: null, isPaused: false })
  expect(parentIn({ isOn: true, slots: 2.5 })).toEqual({ isOn: true, slots: null, isPaused: false })
  expect(parentIn({ isOn: true, slots: 21 })).toEqual({ isOn: true, slots: null, isPaused: false })
  expect(storeKey('session-1')).toBe('parent:session-1')
})

test('the slot count is the one /foreman slots set, else the option when it is a whole number from 1 to 20, else two', () => {
  expect(slotsOf({ ...PARENT_OFF, slots: 3 }, 4)).toBe(3)
  expect(slotsOf(PARENT_OFF, 4)).toBe(4)
  expect(slotsOf(PARENT_OFF, undefined)).toBe(2)
  expect(slotsOf(PARENT_OFF, 0)).toBe(2)
  expect(slotsOf(PARENT_OFF, 'four')).toBe(2)
  expect(slotsOf(PARENT_OFF, 2.5)).toBe(2)
})
