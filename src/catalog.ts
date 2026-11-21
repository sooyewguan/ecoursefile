// The departments and course types that admin lists show and that their pickers search. A request
// returns at most 1,000 rows, so lists and pickers search on the server.
import type { ComboboxOption } from '@/components/combobox'
import { containsFilter } from './paging.ts'
import { supabase } from './supabase.ts'

export type Department = { id: string; code: string; name: string }

export type CourseType = { id: string; name: string }

/** How many options a picker lists for one search. */
const PICKER_SIZE = 50

/** The query, narrowed to the rows where any of the columns contains the search text. */
export function matching<Query extends { or(filters: string): Query }>(query: Query, columns: readonly string[], search: string) {
  const filter = containsFilter(columns, search)
  return filter ? query.or(filter) : query
}

/** A department as the app names it: its code, then its name. */
export function departmentLabel(department: Department) {
  return `${department.code} ${department.name}`
}

export function departmentOption(department: Department): ComboboxOption {
  return { value: department.id, label: departmentLabel(department) }
}

/** The first departments, by code, whose code or name contains the query. */
export async function searchDepartments(query: string) {
  const { data, error } = await matching(supabase.from('departments').select('id, code, name'), ['code', 'name'], query)
    .order('code')
    .limit(PICKER_SIZE)
  if (error) throw error
  return data.map(departmentOption)
}

export function courseTypeOption(courseType: CourseType): ComboboxOption {
  return { value: courseType.id, label: courseType.name }
}

/** The first course types, by name, whose name contains the query. */
export async function searchCourseTypes(query: string) {
  const { data, error } = await matching(supabase.from('course_types').select('id, name'), ['name'], query).order('name').limit(PICKER_SIZE)
  if (error) throw error
  return data.map(courseTypeOption)
}
