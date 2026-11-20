import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, expect, test } from 'vitest'
import { adminClient, createDepartment, signInAs } from './harness.ts'

const RLS_VIOLATION = '42501'
const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'

/** Every role that reads the catalog. Of these, only the admin writes to it. */
const READERS = ['admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const

let admin: SupabaseClient
let departmentId: string

beforeAll(async () => {
  admin = await signInAs('admin')
  departmentId = await createDepartment()
})

/** A value no earlier run has used, so the tests rerun without a database reset. */
function unique(label: string) {
  return `${label}-${crypto.randomUUID()}`
}

/** Adds a course type with the service role, as a test arrangement. */
async function createCourseType() {
  const { data, error } = await adminClient()
    .from('course_types')
    .insert({ name: unique('Type'), sections_on: [10, 12] })
    .select('id, name, sections_on')
    .single()
  if (error) throw error
  return data
}

/** Adds a course of a new course type with the service role, as a test arrangement. */
async function createCourse() {
  const type = await createCourseType()
  const { data, error } = await adminClient()
    .from('courses')
    .insert({ code: unique('BITP'), title: 'Seam1 Course', department_id: departmentId, course_type_id: type.id })
    .select('id, code, title, department_id, course_type_id')
    .single()
  if (error) throw error
  return data
}

/** Adds a program code with the service role, as a test arrangement. */
async function createProgramCode() {
  const { data, error } = await adminClient().from('program_codes').insert({ code: unique('1 BITS S1G1') }).select('id, code').single()
  if (error) throw error
  return data
}

test('admin creates, edits and reads course types with defaults for sections 10 to 16', async () => {
  const name = unique('Theory')

  const created = await admin.from('course_types').insert({ name, sections_on: [10, 12, 13, 14, 15, 16] }).select('id').single()
  expect(created.error).toBeNull()
  const id = created.data!.id

  const edited = await admin.from('course_types').update({ name: `${name} with labs`, sections_on: [10, 11, 16] }).eq('id', id)
  expect(edited.error).toBeNull()

  const { data } = await admin.from('course_types').select('id, name, sections_on').eq('id', id)
  expect(data).toEqual([{ id, name: `${name} with labs`, sections_on: [10, 11, 16] }])
})

test('a course type can switch every section from 10 to 16 off', async () => {
  const { data, error } = await admin.from('course_types').insert({ name: unique('Project'), sections_on: [] }).select('sections_on').single()

  expect(error).toBeNull()
  expect(data).toEqual({ sections_on: [] })
})

test.each([1, 9, 17, 19])('section %i has no course type default', async (section) => {
  const type = await createCourseType()

  const created = await admin.from('course_types').insert({ name: unique('Refused'), sections_on: [10, section] })
  const edited = await admin.from('course_types').update({ sections_on: [section] }).eq('id', type.id)

  expect(created.error?.code).toBe(CHECK_VIOLATION)
  expect(edited.error?.code).toBe(CHECK_VIOLATION)
  expect((await admin.from('course_types').select('sections_on').eq('id', type.id)).data).toEqual([{ sections_on: [10, 12] }])
})

test('course type names are unique', async () => {
  const type = await createCourseType()

  const { error } = await admin.from('course_types').insert({ name: type.name, sections_on: [] })

  expect(error?.code).toBe(UNIQUE_VIOLATION)
})

test('admin creates, edits and reads courses', async () => {
  const [type, otherType] = [await createCourseType(), await createCourseType()]
  const otherDepartmentId = await createDepartment()
  const code = unique('BITP')

  const created = await admin
    .from('courses')
    .insert({ code, title: 'Software Testing', department_id: departmentId, course_type_id: type.id })
    .select('id')
    .single()
  expect(created.error).toBeNull()
  const id = created.data!.id

  const edited = await admin
    .from('courses')
    .update({ code: `${code}-2`, title: 'Software Quality', department_id: otherDepartmentId, course_type_id: otherType.id })
    .eq('id', id)
  expect(edited.error).toBeNull()

  const { data } = await admin.from('courses').select('id, code, title, department_id, course_type_id').eq('id', id)
  expect(data).toEqual([
    {
      id,
      code: `${code}-2`,
      title: 'Software Quality',
      department_id: otherDepartmentId,
      course_type_id: otherType.id,
    },
  ])
})

test('course codes are unique when a course is created or edited', async () => {
  const [course, other] = [await createCourse(), await createCourse()]

  const created = await admin
    .from('courses')
    .insert({ code: course.code, title: 'Duplicate', department_id: departmentId, course_type_id: course.course_type_id })
  const edited = await admin.from('courses').update({ code: course.code }).eq('id', other.id)

  expect(created.error?.code).toBe(UNIQUE_VIOLATION)
  expect(edited.error?.code).toBe(UNIQUE_VIOLATION)
  expect((await admin.from('courses').select('code').eq('id', other.id)).data).toEqual([{ code: other.code }])
})

test('a department that has courses cannot be deleted', async () => {
  const course = await createCourse()

  const { error } = await admin.from('departments').delete().eq('id', course.department_id)

  expect(error).not.toBeNull()
  expect((await admin.from('departments').select('id').eq('id', course.department_id)).data).toEqual([
    { id: course.department_id },
  ])
})

test('admin creates, edits and reads program codes', async () => {
  const code = unique('1 BITS S1G1')

  const created = await admin.from('program_codes').insert({ code }).select('id').single()
  expect(created.error).toBeNull()
  const id = created.data!.id

  expect((await admin.from('program_codes').update({ code: `${code}-2` }).eq('id', id)).error).toBeNull()

  const { data } = await admin.from('program_codes').select('id, code').eq('id', id)
  expect(data).toEqual([{ id, code: `${code}-2` }])
})

test('program codes are unique when a code is created or edited', async () => {
  const [programCode, other] = [await createProgramCode(), await createProgramCode()]

  const created = await admin.from('program_codes').insert({ code: programCode.code })
  const edited = await admin.from('program_codes').update({ code: programCode.code }).eq('id', other.id)

  expect(created.error?.code).toBe(UNIQUE_VIOLATION)
  expect(edited.error?.code).toBe(UNIQUE_VIOLATION)
  expect((await admin.from('program_codes').select('code').eq('id', other.id)).data).toEqual([{ code: other.code }])
})

test.each(['lecturer', 'auditor', 'hod', 'dean', 'deputy_dean', 'root'] as const)(
  'the %s user cannot add or edit course types, courses or program codes',
  async (role) => {
    const client = await signInAs(role)
    const [course, programCode] = [await createCourse(), await createProgramCode()]

    const inserts = await Promise.all([
      client.from('course_types').insert({ name: unique('Refused'), sections_on: [] }),
      client
        .from('courses')
        .insert({ code: unique('BITP'), title: 'Refused', department_id: departmentId, course_type_id: course.course_type_id }),
      client.from('program_codes').insert({ code: unique('Refused') }),
    ])
    expect(inserts.map((result) => result.error?.code)).toEqual([RLS_VIOLATION, RLS_VIOLATION, RLS_VIOLATION])

    await client.from('course_types').update({ name: unique('Renamed'), sections_on: [] }).eq('id', course.course_type_id)
    await client.from('courses').update({ code: unique('Renamed'), title: 'Renamed' }).eq('id', course.id)
    await client.from('program_codes').update({ code: unique('Renamed') }).eq('id', programCode.id)

    const service = adminClient()
    expect((await service.from('course_types').select('sections_on').eq('id', course.course_type_id)).data).toEqual([
      { sections_on: [10, 12] },
    ])
    expect((await service.from('courses').select('code, title').eq('id', course.id)).data).toEqual([
      { code: course.code, title: course.title },
    ])
    expect((await service.from('program_codes').select('code').eq('id', programCode.id)).data).toEqual([
      { code: programCode.code },
    ])
  },
)

test.each(READERS)('the %s user reads course types, courses and program codes', async (role) => {
  const client = await signInAs(role)
  const [course, programCode] = [await createCourse(), await createProgramCode()]

  expect((await client.from('course_types').select('id').eq('id', course.course_type_id)).data).toEqual([
    { id: course.course_type_id },
  ])
  expect((await client.from('courses').select('id').eq('id', course.id)).data).toEqual([{ id: course.id }])
  expect((await client.from('program_codes').select('id').eq('id', programCode.id)).data).toEqual([{ id: programCode.id }])
})

test('root reads no course types, courses or program codes', async () => {
  const root = await signInAs('root')
  await Promise.all([createCourse(), createProgramCode()])

  for (const table of ['course_types', 'courses', 'program_codes']) {
    const { data, error } = await root.from(table).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  }
})
