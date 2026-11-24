import { expect, test } from 'vitest'
import { pastSemesters, REUSE_PLACES, reusePlan, type ReusableList } from './reuse.ts'

const file = (id: string, semester_code: string, item: number | null, name: string, size = 1000) => ({ id, semester_code, item, name, size })

/** What list-reusable-files gives for each reusable place of a course whose past offerings ran in two semesters. */
const LISTS: ReusableList[] = [
  { place: { section: 10, slot: null }, files: [file('n2', '2026/2027-1', null, 'notes-ch1.pdf'), file('n1', '2025/2026-2', null, 'old-notes.pdf')] },
  {
    place: { section: 11, slot: 'lab_sheet' },
    files: [file('l1', '2026/2027-1', 1, 'lab1-sheet.pdf'), file('l3', '2026/2027-1', 3, 'lab3-sheet.pdf'), file('l0', '2025/2026-2', 1, 'old-lab.pdf')],
  },
  { place: { section: 11, slot: 'answer_scheme' }, files: [file('a1', '2026/2027-1', 1, 'lab1-scheme.pdf')] },
  { place: { section: 12, slot: 'question' }, files: [] },
]

test('the reusable places are Lecture Notes, and the lab sheet, lab answer scheme, tutorial question and tutorial answer scheme of each item', () => {
  expect(REUSE_PLACES).toEqual([
    { section: 10, slot: null },
    { section: 11, slot: 'lab_sheet' },
    { section: 11, slot: 'answer_scheme' },
    { section: 12, slot: 'question' },
    { section: 12, slot: 'answer_scheme' },
  ])
})

test('the past semesters are those with a file to reuse, the latest first', () => {
  expect(pastSemesters(LISTS)).toEqual(['2026/2027-1', '2025/2026-2'])
})

test("reusing all from one semester copies each of its offering's files to the same item and slot, in section, item and slot order", () => {
  const { copies } = reusePlan(LISTS, '2026/2027-1', [], [])

  expect(copies.map(({ section, item, slot, file }) => [section, item, slot, file.name])).toEqual([
    [10, null, null, 'notes-ch1.pdf'],
    [11, 1, 'lab_sheet', 'lab1-sheet.pdf'],
    [11, 1, 'answer_scheme', 'lab1-scheme.pdf'],
    [11, 3, 'lab_sheet', 'lab3-sheet.pdf'],
  ])
  expect(copies.every((copy) => !copy.held)).toBe(true)
})

test('a section adds the items up to the highest item number that a copy needs, after the items it has', () => {
  expect(reusePlan(LISTS, '2026/2027-1', [], []).newItems).toEqual([{ section: 11, count: 3 }])
  expect(reusePlan(LISTS, '2026/2027-1', [], [{ section: 11, number: 1 }]).newItems).toEqual([{ section: 11, count: 2 }])
  expect(reusePlan(LISTS, '2026/2027-1', [], [{ section: 11, number: 4 }]).newItems).toEqual([])
  expect(reusePlan(LISTS, '2025/2026-2', [], []).newItems).toEqual([{ section: 11, count: 1 }])
})

test('a file the course file already has in that place, by name and size, is held, and needs no new item', () => {
  const own = [
    { section: 11, item: 3, slot: 'lab_sheet', name: 'lab3-sheet.pdf', size: 1000 },
    { section: 11, item: 1, slot: 'answer_scheme', name: 'lab1-sheet.pdf', size: 1000 },
    { section: 10, item: null, slot: null, name: 'notes-ch1.pdf', size: 999 },
  ]

  const { copies, newItems } = reusePlan(LISTS, '2026/2027-1', own, [{ section: 11, number: 1 }])

  expect(copies.filter((copy) => copy.held).map((copy) => copy.file.name)).toEqual(['lab3-sheet.pdf'])
  expect(newItems).toEqual([])
})
