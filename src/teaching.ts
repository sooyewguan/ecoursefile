import { readAll } from './reports.ts'
import { LECTURER_FILE_SECTION } from './sections.ts'
import { supabase } from './supabase.ts'

/** A semester in which the user teaches. */
export type TaughtSemester = { id: string; code: string; start_year: number; number: number }

/** The ids of the offerings the user teaches or coordinates, and their semesters, newest first. */
export type Taught = { offeringIds: ReadonlySet<string>; semesters: TaughtSemester[] }

/** The offerings the user teaches or coordinates, in every semester. */
export async function loadTaught(userId: string): Promise<Taught> {
  type Row = { offering: { id: string; semester: TaughtSemester } }
  const rows = await readAll<Row>((from, to) =>
    supabase
      .from('offering_lecturers')
      .select('offering:offerings!offering_lecturers_offering_id_fkey!inner(id, semester:semesters!inner(id, code, start_year, number))')
      .eq('lecturer_id', userId)
      .order('offering_id')
      .range(from, to)
      .overrideTypes<Row[], { merge: false }>(),
  )
  const semesters = new Map(rows.map(({ offering }) => [offering.semester.id, offering.semester]))
  return {
    offeringIds: new Set(rows.map(({ offering }) => offering.id)),
    semesters: [...semesters.values()].toSorted((a, b) => b.start_year - a.start_year || b.number - a.number),
  }
}

/** Whether the user has no timetable for the semester, which leaves section 4 of each of their course files missing. */
export async function isTimetableMissing(semesterId: string, userId: string) {
  const { count, error } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .eq('semester_id', semesterId)
    .eq('section', LECTURER_FILE_SECTION.number)
    .eq('lecturer_id', userId)
  if (error) throw error
  return count === 0
}
