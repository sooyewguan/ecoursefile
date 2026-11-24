// The CSV course import. The browser reads the file into rows here, and import_courses checks each
// row against the catalog and adds the valid ones.
import { readCsv } from './csv.ts'

/** The columns of an import file, in the template's order. department is a department's code, and course_type a course type's name. */
const COLUMNS = ['code', 'title', 'department', 'course_type'] as const

type Column = (typeof COLUMNS)[number]

/** Other headers that name a column. */
const ALIASES: Record<string, Column> = { department_code: 'department', course_type_name: 'course_type' }

/** The most courses one file may hold. import_courses refuses a longer file too. */
export const MAX_COURSE_IMPORT_ROWS = 500

/** The template's example row, which shows how a row looks. */
const EXAMPLE: Record<Column, string> = { code: 'BITP1113', title: 'Programming Technique', department: 'FTMK', course_type: 'Theory' }

/**
 * The file the admin downloads to fill in: the header row and the example row, after a byte order
 * mark so that a spreadsheet opens it as UTF-8.
 */
export const COURSE_IMPORT_TEMPLATE = `﻿${COLUMNS.join(',')}\r\n${COLUMNS.map((column) => EXAMPLE[column]).join(',')}\r\n`

/** A row of the file below its header that has a value: its number as a spreadsheet shows it, and its cells without the spaces around them. */
export type CourseRow = { row: number } & Record<Column, string>

/** What the import did with one row: added the course, or rejected the row with the reason. */
export type ImportedCourse = { row: number; code: string } & ({ status: 'added'; courseId: string } | { status: 'rejected'; reason: string })

/**
 * Reads an import file into its rows, or the reason the whole file cannot be read. The first row
 * that is not blank names the columns, in any order and case, with spaces or underscores, and
 * columns besides COLUMNS are ignored.
 */
export function readCourseImport(csv: string): { problem: string } | { rows: CourseRow[] } {
  const records = readCsv(csv)
  if ('unclosedQuoteRow' in records) return { problem: `The file has a quote on row ${records.unclosedQuoteRow} that is never closed.` }
  const filled = records.flatMap((fields, index) => (fields.some((field) => field.trim() !== '') ? [{ row: index + 1, fields }] : []))
  if (filled.length === 0) return { problem: 'The file is empty.' }

  const [header, ...body] = filled
  const names = header.fields.map((field) => {
    const key = field.trim().toLowerCase().replace(/[\s-]+/g, '_')
    return ALIASES[key] ?? key
  })
  for (const column of COLUMNS) {
    if (names.indexOf(column) !== names.lastIndexOf(column)) return { problem: `The file has more than one ${column} column.` }
  }
  const missing = COLUMNS.filter((column) => !names.includes(column))
  if (missing.length > 0) {
    return { problem: `The file has no ${missing.join(' or ')} column. Its first row must name the columns ${COLUMNS.join(', ')}.` }
  }
  if (body.length === 0) return { problem: 'The file has no courses below its header row.' }
  if (body.length > MAX_COURSE_IMPORT_ROWS) {
    return { problem: `The file has ${body.length} courses, and one file may hold at most ${MAX_COURSE_IMPORT_ROWS}. Split it into smaller files.` }
  }
  return {
    rows: body.map(({ row, fields }) => ({
      row,
      ...(Object.fromEntries(COLUMNS.map((column) => [column, (fields[names.indexOf(column)] ?? '').trim()])) as Record<Column, string>),
    })),
  }
}

/** Whether the row is the template's example, left in the file. The import rejects it rather than add a course nobody meant. */
export function isExampleRow(row: CourseRow) {
  return COLUMNS.every((column) => row[column] === EXAMPLE[column])
}
