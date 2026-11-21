import type { SupabaseClient } from '@supabase/supabase-js'
import type { SectionStatus } from './sections.ts'

// The rows of the report RPCs, as supabase/migrations/20261120070100_reports.sql returns them. The
// README's Reports section defines each count and percentage.

export type ReportRpc = 'report_faculty_summary' | 'report_departments' | 'report_offerings' | 'report_lecturers'

/**
 * The columns that each report RPC sorts its rows by, so that one page follows on from the last.
 * report_lecturers sorts by the lecturers' full names, which it does not return, since
 * lecturer_name starts with any title. Its pages keep the order the RPC gives.
 */
const REPORT_ORDER: Record<ReportRpc, string[]> = {
  report_faculty_summary: [],
  report_departments: ['department_code'],
  report_offerings: ['course_code'],
  report_lecturers: [],
}

/**
 * Every row of the report for the semester. The API returns at most 1,000 rows for one request
 * (max_rows in supabase/config.toml), so this reads the rows a page at a time, in the report's
 * order, until it holds as many as the API counts. A semester of about 100 offerings takes one
 * request. A user who may not read reports gets the PostgrestError with code 42501.
 */
export async function fetchReport<Row>(client: SupabaseClient, rpc: ReportRpc, semesterId: string): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const query = REPORT_ORDER[rpc].reduce(
      (page, column) => page.order(column),
      client.rpc(rpc, { semester_id: semesterId }, { count: 'exact' }),
    )
    const { data, error, count } = await query.range(rows.length, rows.length + REPORT_PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length === 0 || rows.length >= (count ?? 0)) return rows
  }
}

/** The rows fetchReport asks for at once: the API's limit, so that it sends each page whole. */
const REPORT_PAGE_SIZE = 1_000

/** An offering's status in the reports, from the statuses of its sections that count. */
export type OfferingStatus = 'incomplete' | 'needs_fix' | 'pending_review' | 'verified'

export const OFFERING_STATUS_LABELS: Record<OfferingStatus, string> = {
  incomplete: 'Incomplete',
  needs_fix: 'Needs fix',
  pending_review: 'Pending review',
  verified: 'Verified',
}

/** The section counts of an offering, a department or the faculty. */
type SectionCounts = {
  counted_sections: number
  uploaded_sections: number
  verified_sections: number
  needs_fix_sections: number
}

/** The percentages of a department or the faculty. Null when no section counts. */
type PooledPercentages = {
  percent_uploaded: number | null
  percent_verified: number | null
  percent_needs_fix: number | null
}

/** The one row of report_faculty_summary. */
export type FacultySummary = SectionCounts & PooledPercentages & { offerings: number }

/** A row of report_departments. */
export type DepartmentRow = SectionCounts &
  PooledPercentages & { department_id: string; department_code: string; department_name: string; offerings: number }

/** A row of report_offerings: one offering, for the offering list and the heatmap. */
export type OfferingRow = SectionCounts & {
  offering_id: string
  course_code: string
  course_title: string
  department_id: string
  department_code: string
  department_name: string
  coordinator_id: string
  coordinator_name: string
  status: OfferingStatus
  percent_complete: number
  missing_sections: number[]
  /** The 19 statuses, in section order. */
  section_statuses: SectionStatus[]
  last_upload_at: string | null
}

/** A row of report_lecturers: one lecturer and their offerings. */
export type LecturerRow = {
  lecturer_id: string
  lecturer_name: string
  department_id: string | null
  department_code: string | null
  department_name: string | null
  timetable_missing: boolean
  offerings: {
    offering_id: string
    course_code: string
    course_title: string
    coordinator: boolean
    /** The offering's missing sections linked to this lecturer. */
    missing_sections: number[]
  }[]
}

/** A percentage as the reports show it, such as 82.5%, or a dash when no section counts. */
export function formatPercent(percent: number | null) {
  return percent === null ? '–' : `${percent}%`
}
