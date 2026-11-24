import { ClipboardCheckIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState, LoadError, PageHeader } from '@/components/page'
import { ExportMenu, loadOfferings, pickSemester, ReportLoadError, SemesterSelect, useReport } from '@/components/reports'
import { SectionBar, SectionBarLegend } from '@/components/section-bar'
import { OfferingStatusBadge, SectionStatusChip } from '@/components/section-status'
import { Time } from '@/components/time'
import { TimetableMissing } from '@/components/timetable-missing'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { plural } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import { MY_COMPLETENESS_TABLE, needsFixSections } from '../report-tables.ts'
import { formatPercent, type OfferingRow } from '../reports.ts'
import { SECTIONS_WITH_PAGES, type SectionStatus } from '../sections.ts'
import { isTimetableMissing, loadTaught, type Taught } from '../teaching.ts'

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
      setTaught(await loadTaught(userId))
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

/**
 * The user's offerings of the semester: each with its completeness as a bar of its sections by
 * status, its status, coordinator and last upload, and its missing sections and those to fix by name,
 * each linked to its page in the course file.
 */
function OwnOfferings({ rows }: { rows: OfferingRow[] | null }) {
  const column = MY_COMPLETENESS_TABLE.columns
  return (
    <div className="grid gap-3">
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {rows ? <p className="text-muted-foreground text-sm">{plural(rows.length, 'course file')}</p> : <Skeleton className="h-5 w-24" />}
        <SectionBarLegend />
      </div>
      <Card className="gap-0 py-0">
        <ul aria-label="Course files" className="divide-y">
          {!rows
            ? [0, 1].map((key) => (
                <li key={key} aria-hidden="true" className="grid gap-3 px-4 py-5 sm:px-6">
                  <Skeleton className="h-5 w-full max-w-64" />
                  <Skeleton className="h-2 w-full max-w-80" />
                  <Skeleton className="h-4 w-full max-w-96" />
                </li>
              ))
            : rows.map((row) => (
                <li key={row.offering_id} className="grid gap-4 px-4 py-5 sm:px-6">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_8.5rem] sm:items-center sm:gap-6">
                    <div className="grid min-w-0 gap-0.5">
                      <Link to={`/course-files/${row.offering_id}`} className="w-fit font-medium hover:underline">
                        {column.courseCode.value(row)}
                      </Link>
                      <span className="text-muted-foreground text-sm">{column.courseTitle.value(row)}</span>
                    </div>
                    <div className="col-span-2 grid gap-1.5 sm:col-span-1">
                      <p className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium tabular-nums">
                          {formatPercent(column.complete.value(row))}{' '}
                          <span className="text-muted-foreground font-normal">{column.complete.header.toLowerCase()}</span>
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {row.uploaded_sections} of {row.counted_sections} uploaded
                        </span>
                      </p>
                      <SectionBar counts={row} />
                    </div>
                    <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
                      <OfferingStatusBadge status={row.status} />
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
                  <SectionLinks offeringId={row.offering_id} label="Missing" status="missing" sections={row.missing_sections} />
                  <SectionLinks offeringId={row.offering_id} label="Needs fix" status="needs_fix" sections={needsFixSections(row)} />
                </li>
              ))}
        </ul>
      </Card>
    </div>
  )
}

/** Sections of a course file under a label, such as Missing, each in the look of its status and linked to its page. Nothing when there are none. */
function SectionLinks({ offeringId, label, status, sections }: { offeringId: string; label: string; status: SectionStatus; sections: number[] }) {
  const id = useId()
  if (sections.length === 0) return null
  return (
    <div className="grid gap-2 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3">
      <p id={id} className="text-sm font-medium sm:leading-7">
        {label}
      </p>
      <ul aria-labelledby={id} className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <li key={section}>
            <SectionStatusChip section={section} status={status} to={SECTIONS_WITH_PAGES.has(section) ? `/course-files/${offeringId}/sections/${section}` : undefined} />
          </li>
        ))}
      </ul>
    </div>
  )
}
