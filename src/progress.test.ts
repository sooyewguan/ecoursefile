import { expect, test } from 'vitest'
import { courseFileProgress } from './progress.ts'
import type { SectionStatus } from './sections.ts'

const row = (status: SectionStatus, counts = true) => ({ status, counts_toward_completeness: counts })

test('counts the sections that count, uploaded ones as those not missing, and Needs fix ones', () => {
  expect(
    courseFileProgress([row('missing'), row('pending_review'), row('verified'), row('needs_fix'), row('needs_fix'), row('off', false), row('empty')]),
  ).toEqual({ counted: 5, uploaded: 4, needsFix: 2 })
})

test('a switched-off section with a Needs fix verdict still counts', () => {
  expect(courseFileProgress([row('needs_fix', true), row('pending_review', false)])).toEqual({ counted: 1, uploaded: 1, needsFix: 1 })
})
