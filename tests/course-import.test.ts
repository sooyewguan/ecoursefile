import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { adminClient, signInAs } from './harness.ts'

const INSUFFICIENT_PRIVILEGE = '42501'
const INVALID_PARAMETER_VALUE = '22023'

/** A row of an import file as the app sends it: its row number in the file, and its cells. */
type FileRow = { row: number; code: string; title: string; department: string; course_type: string }

/** What import_courses did with one row. */
type Imported = { file_row: number; code: string; course_id: string | null; problem: string | null; reason: string | null }

let admin: SupabaseClient
let department: { id: string; code: string }
let courseType: { id: string; name: string }

beforeAll(async () => {
  admin = await signInAs('admin')
  const service = adminClient()
  const added = await service.from('departments').insert({ code: `IMP-${randomUUID()}`, name: 'Import Department' }).select('id, code').single()
  if (added.error) throw added.error
  department = added.data
  const type = await service.from('course_types').insert({ name: `Theory ${randomUUID()}`, sections_on: [10, 12] }).select('id, name').single()
  if (type.error) throw type.error
  courseType = type.data
})

function newCode() {
  return `BITP-${randomUUID()}`
}

/** A valid row for a new course code, with these cells changed. */
function fileRow(row: number, cells: Partial<FileRow> = {}): FileRow {
  return { row, code: newCode(), title: 'Imported Course', department: department.code, course_type: courseType.name, ...cells }
}

async function importCourses(client: SupabaseClient, rows: FileRow[]) {
  return client.rpc('import_courses', { courses: rows })
}

async function importAsAdmin(rows: FileRow[]) {
  const { data, error } = await importCourses(admin, rows)
  if (error) throw error
  return data as Imported[]
}

/** The courses with these codes, as the service role reads them, by code. */
async function coursesWith(codes: string[]) {
  const { data, error } = await adminClient().from('courses').select('id, code, title, department_id, course_type_id').in('code', codes)
  if (error) throw error
  return new Map(data.map((course) => [course.code as string, course]))
}

test('importing adds a course for each row, naming its department by code in any case and its course type by name', async () => {
  const rows = [
    fileRow(2, { title: 'Programming Technique', department: department.code.toLowerCase() }),
    fileRow(3, { code: `  ${newCode()}  `, title: ' Discrete Mathematics ', course_type: courseType.name.toUpperCase() }),
  ]

  const imported = await importAsAdmin(rows)

  const codes = rows.map((row) => row.code.trim())
  const courses = await coursesWith(codes)
  expect(imported).toEqual([
    { file_row: 2, code: codes[0], course_id: courses.get(codes[0])!.id, problem: null, reason: null },
    { file_row: 3, code: codes[1], course_id: courses.get(codes[1])!.id, problem: null, reason: null },
  ])
  expect(courses.get(codes[0])).toMatchObject({ title: 'Programming Technique', department_id: department.id, course_type_id: courseType.id })
  expect(courses.get(codes[1])).toMatchObject({ title: 'Discrete Mathematics', department_id: department.id, course_type_id: courseType.id })
})

test('a rejected row says why, and the other rows are still added', async () => {
  const existing = fileRow(2)
  await importAsAdmin([existing])
  const twin = newCode()
  const rows = [
    fileRow(2, { code: existing.code }),
    fileRow(3, { title: '  ' }),
    fileRow(4, { code: twin }),
    fileRow(6, { code: twin }),
    fileRow(7, { department: 'NO-SUCH-DEPARTMENT' }),
    fileRow(8, { course_type: 'No such course type' }),
    fileRow(9),
  ]

  const imported = await importAsAdmin(rows)

  expect(imported.map(({ file_row, problem, reason }) => ({ file_row, problem, reason }))).toEqual([
    { file_row: 2, problem: 'code_exists', reason: `A course with the code ${existing.code} already exists.` },
    { file_row: 3, problem: 'missing_value', reason: 'The row has no title.' },
    { file_row: 4, problem: 'duplicate_code', reason: 'The code is also on row 6.' },
    { file_row: 6, problem: 'duplicate_code', reason: 'The code is also on row 4.' },
    { file_row: 7, problem: 'unknown_department', reason: 'No department has the code "NO-SUCH-DEPARTMENT".' },
    { file_row: 8, problem: 'unknown_course_type', reason: 'No course type is named "No such course type".' },
    { file_row: 9, problem: null, reason: null },
  ])
  const added = await coursesWith(rows.map((row) => row.code))
  expect([...added.keys()].toSorted()).toEqual([existing.code, rows[6].code].toSorted())
  expect(imported[6].course_id).toBe(added.get(rows[6].code)!.id)
})

test('importing the same rows again adds nothing, and says each code exists', async () => {
  const rows = [fileRow(2), fileRow(3)]
  await importAsAdmin(rows)

  const again = await importAsAdmin(rows)

  expect(again.map((row) => [row.course_id, row.problem])).toEqual([
    [null, 'code_exists'],
    [null, 'code_exists'],
  ])
})

test('a file of more than 500 courses is refused as a whole', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => fileRow(index + 2))

  const { error } = await importCourses(admin, rows)

  expect(error?.code).toBe(INVALID_PARAMETER_VALUE)
  expect((await coursesWith([rows[0].code])).size).toBe(0)
})

test.each(['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const)('the %s user cannot import courses', async (role) => {
  const client = await signInAs(role)
  const row = fileRow(2)

  const { error } = await importCourses(client, [row])

  expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE)
  expect((await coursesWith([row.code])).size).toBe(0)
})
