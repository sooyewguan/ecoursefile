import type { SectionStatus } from './sections.ts'

// The rows of the report RPCs, as supabase/migrations/20261120070100_reports.sql returns them. The
// README's Reports section defines each count and percentage.

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
