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
 * Every row of the report for the semester, read with readAll in the report's order. A semester of
 * about 100 offerings takes one request. A user who may not read reports gets the PostgrestError
 * with code 42501.
 */
export function fetchReport<Row>(client: SupabaseClient, rpc: ReportRpc, semesterId: string): Promise<Row[]> {
  return readAll<Row>((from, to) =>
    REPORT_ORDER[rpc].reduce((page, column) => page.order(column), client.rpc(rpc, { semester_id: semesterId })).range(from, to),
  )
}

/** The most rows the API returns for one request: max_rows in supabase/config.toml. */
const API_MAX_ROWS = 1_000

/**
 * Every row of a query that the API would cut at API_MAX_ROWS. page(from, to) asks for the rows
 * from from to to, in an order in which one page follows on from the last, and readAll asks for
 * the next page until one comes back short.
 */
export async function readAll<Row>(page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + API_MAX_ROWS - 1)
    if (error) throw error
    rows.push(...data!)
    if (data!.length < API_MAX_ROWS) return rows
  }
}

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

/** How many offerings a department or the faculty has, and how many of them are complete and verified. */
type OfferingCounts = { offerings: number; complete_offerings: number; verified_offerings: number }

/** The one row of report_faculty_summary. */
export type FacultySummary = SectionCounts & PooledPercentages & OfferingCounts

/** A row of report_departments. */
export type DepartmentRow = SectionCounts & PooledPercentages & OfferingCounts & { department_id: string; department_code: string; department_name: string }

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
  /** Null for a reader who does not open the Reports page, such as a lecturer. */
  coordinator_email: string | null
  status: OfferingStatus
  percent_complete: number
  missing_sections: number[]
  /**
   * The 19 statuses, in section order, as the course file page shows them, except that a
   * switched-off section that counts and has no file is missing.
   */
  section_statuses: SectionStatus[]
  last_upload_at: string | null
}

/** A row of report_lecturers: one lecturer and their offerings. */
export type LecturerRow = {
  lecturer_id: string
  lecturer_name: string
  /** Null for a reader who does not open the Reports page, such as a lecturer. */
  lecturer_email: string | null
  department_id: string | null
  department_code: string | null
  department_name: string | null
  timetable_missing: boolean
  offerings: {
    offering_id: string
    course_code: string
    course_title: string
    department_id: string
    department_code: string
    department_name: string
    coordinator: boolean
    /** The offering's missing sections linked to this lecturer. */
    missing_sections: number[]
    /** The offering's Needs fix sections linked to this lecturer. */
    needs_fix_sections: number[]
  }[]
}

/** A percentage as the reports show it, such as 82.5%, or a dash when no section counts. */
export function formatPercent(percent: number | null) {
  return percent === null ? '–' : `${percent}%`
}
