import { CalendarClockIcon, ClipboardCheckIcon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState, LoadError, PageHeader } from '@/components/page'
import { ExportMenu, loadOfferings, pickSemester, ReportLoadError, SemesterSelect, useReport } from '@/components/reports'
import { OfferingStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '../auth-provider.tsx'
import { MY_COMPLETENESS_TABLE, needsFixSections } from '../report-tables.ts'
import { formatPercent, readAll, type OfferingRow } from '../reports.ts'
import { LECTURER_FILE_SECTION, sectionName, SECTIONS_WITH_PAGES } from '../sections.ts'
import { supabase } from '../supabase.ts'

type Semester = { id: string; code: string; start_year: number; number: number }

/** The ids of the offerings the user teaches or coordinates, and their semesters, newest first. */
type Taught = { offeringIds: ReadonlySet<string>; semesters: Semester[] }

/**
 * The completeness of the course files that the user teaches or coordinates, in one semester, with
 * each missing section linked, and their own timetable when it is missing. The semester is in the
 * URL, at ?semester=<id>, and the newest semester in which they teach is the default. A lecturer who
 * is also management sees only their own offerings here.
 */
export function Completeness() {
  const auth = useAuth()
  const userId = auth.kind === 'ready' ? auth.profile.id : null
  const [taught, setTaught] = useState<Taught | 'failed' | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const rows = await readAll<{ offering: { id: string; semester: Semester } }>((from, to) =>
        supabase
          .from('offering_lecturers')
          .select('offering:offerings!offering_lecturers_offering_id_fkey!inner(id, semester:semesters!inner(id, code, start_year, number))')
          .eq('lecturer_id', userId)
          .order('offering_id')
          .range(from, to)
          .overrideTypes<{ offering: { id: string; semester: Semester } }[], { merge: false }>(),
      )
      const semesters = new Map(rows.map(({ offering }) => [offering.semester.id, offering.semester]))
      setTaught({
        offeringIds: new Set(rows.map(({ offering }) => offering.id)),
        semesters: [...semesters.values()].toSorted((a, b) => b.start_year - a.start_year || b.number - a.number),
      })
    } catch {
      setTaught('failed')
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const own = taught === 'failed' ? null : taught
  const semesterParam = searchParams.get('semester')
  const semesterId = pickSemester(own?.semesters ?? null, semesterParam)
  const semester = own?.semesters.find((s) => s.id === semesterId) ?? null

  // A semester in which the user does not teach gives way, so that the URL and the select agree.
  useEffect(() => {
    if (own && semesterParam !== null && semesterParam !== semesterId) setSearchParams(semesterId ? { semester: semesterId } : {}, { replace: true })
  }, [own, semesterParam, semesterId, setSearchParams])

  const loadOwn = useCallback(
    async (semesterId: string) => {
      const [offerings, timetableMissing] = await Promise.all([loadOfferings(semesterId), isTimetableMissing(semesterId, userId!)])
      return { offerings, timetableMissing }
    },
    [userId],
  )
  const report = useReport(semester?.id ?? null, loadOwn)
  const rows = own && report?.data ? report.data.offerings.filter((row) => own.offeringIds.has(row.offering_id)) : null

  return (
    <div className="grid gap-6">
      <PageHeader
        title="My completeness"
        action={
          semester ? (
            <div className="flex w-full items-end gap-3 sm:w-auto">
              <SemesterSelect semesters={own!.semesters} value={semester.id} onChange={(id) => setSearchParams({ semester: id }, { replace: true })} />
              <ExportMenu table={MY_COMPLETENESS_TABLE} rows={rows} semesterCode={semester.code} />
            </div>
          ) : (
            taught === null && <Skeleton className="h-[58px] w-full sm:w-80" />
          )
        }
      />
      {taught === 'failed' ? (
        <Card className="py-0">
          <LoadError title="Couldn't load your course files" onRetry={load} />
        </Card>
      ) : own?.semesters.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={ClipboardCheckIcon} title="No course files yet" />
        </Card>
      ) : report?.failed ? (
        <ReportLoadError onRetry={report.retry} />
      ) : rows?.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={ClipboardCheckIcon} title={`No course files in ${semester!.code}`} />
        </Card>
      ) : (
        <>
          {rows && report!.data!.timetableMissing && <TimetableMissing semesterCode={semester!.code} offeringId={rows[0].offering_id} />}
          <OwnOfferings rows={rows} />
        </>
      )}
    </div>
  )
}

/** Whether the user has no timetable for the semester, which leaves section 4 of each of their course files missing. */
async function isTimetableMissing(semesterId: string, userId: string) {
  const { count, error } = await supabase
    .from('files')
    .select('id', { count: 'exact', head: true })
    .eq('semester_id', semesterId)
    .eq('section', LECTURER_FILE_SECTION.number)
    .eq('lecturer_id', userId)
  if (error) throw error
  return count === 0
}

/** The user's own timetable is missing, with a link to the timetable section of one of their course files, where they upload it. */
function TimetableMissing({ semesterCode, offeringId }: { semesterCode: string; offeringId: string }) {
  return (
    <Alert role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 [&>svg]:translate-y-0 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <CalendarClockIcon />
      <p className="min-w-0 flex-1 basis-60 font-medium">Your timetable for {semesterCode} is missing</p>
      <Button asChild size="sm" variant="outline" className="max-sm:ml-7">
        <Link to={`/course-files/${offeringId}/sections/${LECTURER_FILE_SECTION.number}`}>
          <UploadIcon />
          Upload timetable
        </Link>
      </Button>
    </Alert>
  )
}

/**
 * The user's offerings of the semester: each with its status, completeness, coordinator and last
 * upload, and its missing sections and those to fix by name, each linked to its page in the course file.
 */
function OwnOfferings({ rows }: { rows: OfferingRow[] | null }) {
  const column = MY_COMPLETENESS_TABLE.columns
  return (
    <Card className="gap-0 py-0">
      <ul aria-label="Course files" className="divide-y">
        {!rows
          ? [0, 1].map((key) => (
              <li key={key} aria-hidden="true" className="grid gap-3 px-4 py-4 sm:px-6">
                <Skeleton className="h-5 w-full max-w-64" />
                <Skeleton className="h-4 w-full max-w-80" />
              </li>
            ))
          : rows.map((row) => (
              <li key={row.offering_id} className="grid gap-3 px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="grid min-w-0 gap-0.5">
                    <Link to={`/course-files/${row.offering_id}`} className="font-medium hover:underline">
                      {column.courseCode.value(row)}
                    </Link>
                    <span>{column.courseTitle.value(row)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <OfferingStatusBadge status={row.status} />
                    <span className="text-sm tabular-nums">
                      {formatPercent(column.complete.value(row))} {column.complete.header.toLowerCase()}
                    </span>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  {column.coordinator.header} {column.coordinator.value(row)} ·{' '}
                  {row.last_upload_at ? (
                    <>
                      {column.lastUpload.header} <Time value={row.last_upload_at} dateOnly />
                    </>
                  ) : (
                    'No uploads yet'
                  )}
                </p>
                <SectionLinks offeringId={row.offering_id} label="Missing" sections={row.missing_sections} />
                <SectionLinks offeringId={row.offering_id} label="Needs fix" sections={needsFixSections(row)} />
              </li>
            ))}
      </ul>
    </Card>
  )
}

/** Sections of a course file under a label, such as Missing, each linked to its page. Nothing when there are none. */
function SectionLinks({ offeringId, label, sections }: { offeringId: string; label: string; sections: number[] }) {
  const id = useId()
  if (sections.length === 0) return null
  return (
    <div className="grid gap-2">
      <p id={id} className="text-sm font-medium">
        {label}
      </p>
      <ul aria-labelledby={id} className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <li key={section}>
            {SECTIONS_WITH_PAGES.has(section) ? (
              <Badge asChild variant="outline" className="text-sm font-normal">
                <Link to={`/course-files/${offeringId}/sections/${section}`}>{sectionName(section)}</Link>
              </Badge>
            ) : (
              <Badge variant="outline" className="text-sm font-normal">
                {sectionName(section)}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
