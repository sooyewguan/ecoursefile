import { expect, test } from 'vitest'
import { COURSE_IMPORT_TEMPLATE, isExampleRow, MAX_COURSE_IMPORT_ROWS, readCourseImport } from './course-import.ts'

test('a file reads into its rows, numbered as a spreadsheet numbers them, with the spaces around each value gone', () => {
  const csv = '﻿code,title,department,course_type\r\nBITP1113, Programming ,FTMK,Theory\r\n\r\n"BITM2313","Data, Structures",ftmk,"Lab ""A"""\r\n'

  expect(readCourseImport(csv)).toEqual({
    rows: [
      { row: 2, code: 'BITP1113', title: 'Programming', department: 'FTMK', course_type: 'Theory' },
      { row: 4, code: 'BITM2313', title: 'Data, Structures', department: 'ftmk', course_type: 'Lab "A"' },
    ],
  })
})

test('the header names the columns in any order and case, with spaces for underscores, and ignores other columns', () => {
  const csv = 'Course Type Name,Notes,TITLE,Department Code,Code\nTheory,ignored,Programming,FTMK,BITP1113\n'

  expect(readCourseImport(csv)).toEqual({ rows: [{ row: 2, code: 'BITP1113', title: 'Programming', department: 'FTMK', course_type: 'Theory' }] })
})

test('a row without a cell for a column reads it as empty', () => {
  expect(readCourseImport('code,title,department,course_type\nBITP1113,Programming\n')).toEqual({
    rows: [{ row: 2, code: 'BITP1113', title: 'Programming', department: '', course_type: '' }],
  })
})

test.each([
  ['', 'The file is empty.'],
  ['code,title,department\nBITP1113,Programming,FTMK\n', 'The file has no course_type column. Its first row must name the columns code, title, department, course_type.'],
  ['code,title,department,course_type,code\n', 'The file has more than one code column.'],
  ['code,title,department,course_type\n', 'The file has no courses below its header row.'],
  ['code,title,department,course_type\n"BITP1113,Programming,FTMK,Theory\n', 'The file has a quote on row 2 that is never closed.'],
])('a file that cannot be read says why: %j', (csv, problem) => {
  expect(readCourseImport(csv)).toEqual({ problem })
})

test(`a file of more than ${MAX_COURSE_IMPORT_ROWS} courses is refused as a whole`, () => {
  const rows = Array.from({ length: MAX_COURSE_IMPORT_ROWS + 1 }, (_, index) => `C${index},Course,FTMK,Theory`)

  expect(readCourseImport(['code,title,department,course_type', ...rows].join('\n'))).toEqual({
    problem: `The file has ${MAX_COURSE_IMPORT_ROWS + 1} courses, and one file may hold at most ${MAX_COURSE_IMPORT_ROWS}. Split it into smaller files.`,
  })
})

test('the template reads as one example row, which the import knows as the example', () => {
  const read = readCourseImport(COURSE_IMPORT_TEMPLATE)

  expect('rows' in read && read.rows.length).toBe(1)
  expect('rows' in read && read.rows.every(isExampleRow)).toBe(true)
  expect(isExampleRow({ row: 2, code: 'BITP1113', title: 'Programming Technique', department: 'FTMK', course_type: 'Lab' })).toBe(false)
})
