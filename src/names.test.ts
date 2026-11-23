import { expect, test } from 'vitest'
import { initialsOf } from './names.ts'

test.each([
  ['Aisyah binti Rahman', 'AR'],
  ['Ahmad Bin Abdullah', 'AA'],
  ['Kumar a/l Raman', 'KR'],
  ['Siti Nur Aisyah', 'SN'],
  ['  Zoë   ng ', 'ZN'],
  ['Root', 'R'],
])('the initials of %j are %s', (name, initials) => {
  expect(initialsOf(name)).toBe(initials)
})
