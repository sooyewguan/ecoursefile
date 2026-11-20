// Seeds a semester on the local stack and writes what the report RPCs return for it to
// src/report-fixture.ts, which the unit tests of the report exports read. Run it again after a
// report RPC or its row type changes, on a running stack where `npm test` has seeded its users:
//
//   node scripts/capture-report-fixture.ts
//
// The names, titles and departments hold what users may type: a leading =, +, -, @, tab or
// carriage return, quotes, a comma, a line break and letters outside ASCII. The script prints the
// new lecturers' emails, whose password is report-fixture, so the semester can be checked in the
// app too.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sizedPdf } from '../src/pdf/fixtures.ts'
import { fetchReport } from '../src/reports.ts'
import { uploadFile, type SharedSlot, type Slot } from '../src/uploads.ts'

const PASSWORD = 'report-fixture'
const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(status.API_URL, status.SECRET_KEY, options)
const run = randomUUID().slice(0, 8)

async function signIn(email: string, password: string) {
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY, options)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

/** A new user with the role, signed in. */
async function staff(fullName: string, role: string, departmentId?: string) {
  const email = `report-fixture-${randomUUID()}@seam1.test`
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } })
  if (error) throw error
  await must(service.from('user_roles').insert({ user_id: data.user.id, role }))
  if (departmentId) await must(service.from('profiles').update({ department_id: departmentId }).eq('id', data.user.id))
  return { id: data.user.id, email, client: await signIn(email, PASSWORD) }
}

async function must<T>(request: PromiseLike<{ data: T; error: unknown }>) {
  const { data, error } = await request
  if (error) throw error
  return data as NonNullable<T>
}

/** A semester of the report tests' range, 2800 to 2899, without offerings, so its reports hold only the script's. */
async function emptySemester() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = { start_year: 2800 + Math.floor(Math.random() * 100), number: 1 + Math.floor(Math.random() * 3) }
    const inserted = await service.from('semesters').insert(code).select('id, code').single()
    const semester = inserted.error ? await must(service.from('semesters').select('id, code').match(code).single()) : inserted.data
    const { count } = await service.from('offerings').select('id', { count: 'exact', head: true }).eq('semester_id', semester.id)
    if (count === 0) return semester as { id: string; code: string }
  }
  throw new Error('No report semester is left without offerings. Reset the database with `npx supabase db reset`.')
}

async function department(code: string, name: string) {
  return (await must(service.from('departments').insert({ code: `${code}-${run}`, name }).select('id').single())).id as string
}

async function offering(semesterId: string, departmentId: string, code: string, title: string, coordinatorId: string, lecturerIds: string[], sectionsOn: number[]) {
  const type = await must(service.from('course_types').insert({ name: `Fixture ${randomUUID()}`, sections_on: sectionsOn }).select('id').single())
  const course = await must(
    service.from('courses').insert({ code: `${code}-${run}`, title, department_id: departmentId, course_type_id: type.id }).select('id').single(),
  )
  return must(service.rpc('create_offering', { semester_id: semesterId, course_id: course.id, coordinator_id: coordinatorId, lecturer_ids: lecturerIds })) as Promise<string>
}

function upload(client: SupabaseClient, slot: Slot | SharedSlot) {
  return uploadFile(client, slot, new File([sizedPdf(1024)], 'file.pdf', { type: 'application/pdf' }))
}

/** Sections 2, 6, 17, 18 and 19, which every course file has on and its staff upload. */
function uploadOwnSections(client: SupabaseClient, offeringId: string) {
  return Promise.all([
    ...[2, 6, 17, 18].map((section) => upload(client, { offeringId, section })),
    upload(client, { offeringId, section: 19, slot: 'po_achievement' }),
  ])
}

async function mark(auditor: SupabaseClient, offeringId: string, sections: number[], verdict: 'verified' | 'needs_fix') {
  for (const section of sections) {
    await must(auditor.rpc('record_verdict', { offering_id: offeringId, section, verdict, comment: verdict === 'needs_fix' ? 'Fix it.' : null }))
  }
}

const semester = await emptySemester()
const [admin, auditor, dean] = await Promise.all(['admin', 'auditor', 'dean'].map((role) => signIn(`${role}@seam1.test`, 'seam1-password')))
const ftmk = await department('FTMK', 'Fakulti Teknologi Maklumat dan Komunikasi')
const jkp = await department('JKP', 'Jabatan Kejuruteraan Perisian, "Pusat" Ünïcode')
const aisyah = await staff('Aisyah Rahman', 'lecturer', ftmk)
const chloe = await staff('Chloé Lefèvre', 'lecturer', jkp)
const chen = await staff('陈伟明', 'lecturer')
const hyperlink = await staff('=HYPERLINK("https://example.com","Open")', 'lecturer', ftmk)
const at = await staff('@SUM(1+1)', 'lecturer', jkp)
const dash = await staff('-2+3 Dash', 'lecturer', jkp)
const tab = await staff('\tTabbed Name', 'lecturer')
const carriageReturn = await staff('\rReturned Name', 'lecturer')

// A: all verified. B: incomplete, Teaching Plan needs fix, Chen has no timetable. C: needs fix.
// D: pending review. E: nothing uploaded by its staff.
const a = await offering(semester.id, ftmk, 'BITP1113', 'Pemrograman Komputer', aisyah.id, [chloe.id], [])
const b = await offering(semester.id, ftmk, 'BITI2233', '+Statistik Asas', hyperlink.id, [chen.id], [10])
const c = await offering(semester.id, jkp, 'BITS3343', 'Pengaturcaraan "Java", Lanjutan', chloe.id, [], [10])
const d = await offering(semester.id, jkp, 'BITM3423', 'Sains Data\nGunaan', at.id, [], [])
await offering(semester.id, jkp, 'BITU3973', 'Projek Sarjana Muda', dash.id, [tab.id, carriageReturn.id], [])
const programCode = await must(service.from('program_codes').insert({ code: `1 BITS S1G1 ${run}` }).select('id').single())

await Promise.all([
  uploadOwnSections(aisyah.client, a),
  upload(hyperlink.client, { offeringId: b, section: 2 }),
  uploadOwnSections(chloe.client, c),
  upload(chloe.client, { offeringId: c, section: 10 }),
  uploadOwnSections(at.client, d),
  upload(at.client, { offeringId: d, section: 7 }),
  ...[aisyah, chloe, hyperlink, at].map((lecturer) => upload(lecturer.client, { semesterId: semester.id, section: 4 })),
  upload(admin, { semesterId: semester.id, section: 5, programCodeId: programCode.id }),
])
for (const [client, offeringId] of [[aisyah.client, a], [chloe.client, c], [at.client, d]] as const) {
  await must(client.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCode.id, ticked: true }))
}
await upload(admin, { semesterId: semester.id, section: 1 })
await upload(admin, { semesterId: semester.id, section: 3 })
await mark(auditor, a, [1, 2, 3, 4, 5, 6, 17, 18, 19], 'verified')
await mark(auditor, b, [2], 'needs_fix')
await mark(auditor, c, [1], 'verified')
await mark(auditor, c, [6], 'needs_fix')

const fixture = {
  semesterCode: semester.code,
  facultySummary: await fetchReport(dean, 'report_faculty_summary', semester.id),
  departments: await fetchReport(dean, 'report_departments', semester.id),
  offerings: await fetchReport(dean, 'report_offerings', semester.id),
  lecturers: await fetchReport(dean, 'report_lecturers', semester.id),
  chloeOfferings: await fetchReport(chloe.client, 'report_offerings', semester.id),
}

writeFileSync(
  new URL('../src/report-fixture.ts', import.meta.url),
  `// What the report RPCs returned for a semester that scripts/capture-report-fixture.ts seeded.
// offerings, departments, facultySummary and lecturers are as the dean reads them, and
// chloeOfferings is report_offerings as Chloé Lefèvre reads it: the offerings she teaches.
import type { DepartmentRow, FacultySummary, LecturerRow, OfferingRow } from './reports.ts'

export const REPORT_FIXTURE: {
  semesterCode: string
  facultySummary: FacultySummary[]
  departments: DepartmentRow[]
  offerings: OfferingRow[]
  lecturers: LecturerRow[]
  chloeOfferings: OfferingRow[]
} = ${JSON.stringify(fixture, null, 2)}
`,
)

console.log(`Semester ${semester.code}. Lecturers, with password ${PASSWORD}:`)
for (const [name, user] of Object.entries({ aisyah, chloe, chen, hyperlink, at, dash, tab, carriageReturn })) console.log(`  ${name}: ${user.email}`)
