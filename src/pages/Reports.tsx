import { ChartColumnIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { LoadError, PageHeader, TableEmpty, TableSkeleton } from '@/components/page'
import { ExportMenu, OfferingsTable, ReportLoadError, SectionNumbers, SemesterSelect, useReport } from '@/components/reports'
import { SectionStatusLegend, SectionStatusSquare } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  DEPARTMENTS_TABLE,
  FACULTY_SUMMARY_TABLE,
  filterOfferings,
  HEATMAP_TABLE,
  LECTURERS_TABLE,
  lecturerOfferings,
  OFFERINGS_TABLE,
} from '../report-tables.ts'
import {
  formatPercent,
  OFFERING_STATUS_LABELS,
  type DepartmentRow,
  type FacultySummary,
  type LecturerRow,
  type OfferingRow,
  type OfferingStatus,
} from '../reports.ts'
import { SECTIONS } from '../sections.ts'
import { supabase } from '../supabase.ts'

const TABS = [
  { value: 'summary', label: 'Summary' },
  { value: 'offerings', label: 'Offerings' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'lecturers', label: 'Lecturers' },
] as const

type Tab = (typeof TABS)[number]['value']

/** The semesters in which the user reads an offering, newest first. RLS decides which offerings they read. */
function useReportSemesters() {
  const [semesters, setSemesters] = useState<{ list: { id: string; code: string }[] } | 'failed' | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('semesters')
      .select('id, code, offerings!inner(id)')
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
      .limit(1, { referencedTable: 'offerings' })
    setSemesters(error ? 'failed' : { list: data.map(({ id, code }) => ({ id, code })) })
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return { semesters, reload: load }
}

/**
 * The completeness of one semester's course files, for management, auditors and the admin. The
 * semester and the view are in the URL, at ?semester=<id>&tab=<view>, and the newest semester with
 * offerings is the default.
 */
export function Reports() {
  const { semesters, reload } = useReportSemesters()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = TABS.find((t) => t.value === searchParams.get('tab'))?.value ?? 'summary'
  const list = semesters && semesters !== 'failed' ? semesters.list : null
  const semesterId = searchParams.get('semester') ?? list?.[0]?.id ?? null
  const semester = semesterId ? { id: semesterId, code: list?.find((s) => s.id === semesterId)?.code ?? null } : null

  const navigate = (next: { semester?: string; tab?: Tab }) =>
    setSearchParams({ semester: next.semester ?? semesterId ?? '', tab: next.tab ?? tab }, { replace: true })

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        description="How complete each course file of a semester is, by department, offering, section and lecturer."
        action={list && list.length > 0 && semesterId && <SemesterSelect semesters={list} value={semesterId} onChange={(semester) => navigate({ semester })} />}
      />
      {semesters === 'failed' && (
        <Card className="py-0">
          <LoadError title="Couldn't load the semesters" onRetry={reload} />
        </Card>
      )}
      {list?.length === 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableBody>
              <TableEmpty
                columns={1}
                icon={ChartColumnIcon}
                title="No course files yet"
                description="Reports appear once the admin offers courses in a semester."
              />
            </TableBody>
          </Table>
        </Card>
      )}
      {semester && (
        <Tabs value={tab} onValueChange={(value) => navigate({ tab: value as Tab })} className="min-w-0 gap-6">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="summary" className="grid gap-6">
            <FacultySummaryView semester={semester} />
            <DepartmentsView semester={semester} />
          </TabsContent>
          <TabsContent value="offerings">
            <OfferingsView semester={semester} />
          </TabsContent>
          <TabsContent value="heatmap">
            <HeatmapView semester={semester} />
          </TabsContent>
          <TabsContent value="lecturers">
            <LecturersView semester={semester} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

/** A semester of the Reports page. Its code names the exported files, and is null until the semesters load. */
type ReportSemester = { id: string; code: string | null }

/** A heading over a view, with the view's Export menu at its end. */
function ViewHeading({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </div>
  )
}

/**
 * The columns that the faculty summary and the department breakdown show together: each count of
 * sections with its percentage of the sections that count.
 */
const SHARES = [
  [FACULTY_SUMMARY_TABLE.columns.uploaded, FACULTY_SUMMARY_TABLE.columns.uploadedPercent],
  [FACULTY_SUMMARY_TABLE.columns.verified, FACULTY_SUMMARY_TABLE.columns.verifiedPercent],
  [FACULTY_SUMMARY_TABLE.columns.needsFix, FACULTY_SUMMARY_TABLE.columns.needsFixPercent],
] as const

/** The faculty summary as four figures: the offerings, then each of SHARES. */
function FacultySummaryView({ semester }: { semester: ReportSemester }) {
  const report = useReport<FacultySummary>('report_faculty_summary', semester.id)
  const summary = report?.rows?.[0]
  const column = FACULTY_SUMMARY_TABLE.columns
  const tiles = [
    { label: column.offerings.header, value: summary && column.offerings.value(summary), detail: summary && 'Course files in the semester' },
    ...SHARES.map(([count, percent]) => ({
      label: count.header,
      value: summary && formatPercent(percent.value(summary)),
      detail: summary && `${count.value(summary)} of ${column.sections.value(summary)} sections`,
    })),
  ]
  return (
    <section aria-labelledby="faculty-summary-heading" className="grid gap-3">
      <ViewHeading id="faculty-summary-heading" title={FACULTY_SUMMARY_TABLE.view}>
        <ExportMenu table={FACULTY_SUMMARY_TABLE} rows={report?.rows ?? null} semesterCode={semester.code} />
      </ViewHeading>
      {report?.failed ? (
        <ReportLoadError onRetry={report.retry} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Card key={tile.label} className="gap-2">
              <CardHeader>
                <CardDescription>{tile.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{tile.value ?? <Skeleton className="h-9 w-24" />}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">{tile.detail ?? <Skeleton className="h-5 w-32" />}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

/** Below sm the counts behind each percentage are left out. */
const SMALL = 'hidden sm:block'

/**
 * The department breakdown. Its headers and values are DEPARTMENTS_TABLE's, with the department's
 * code and name in one cell, and each percentage over its count and the sections that count. On a
 * phone the table scrolls sideways inside its card, with the department pinned.
 */
function DepartmentsView({ semester }: { semester: ReportSemester }) {
  const report = useReport<DepartmentRow>('report_departments', semester.id)
  const column = DEPARTMENTS_TABLE.columns
  return (
    <section aria-labelledby="departments-heading" className="grid gap-3">
      <ViewHeading id="departments-heading" title={DEPARTMENTS_TABLE.view}>
        <ExportMenu table={DEPARTMENTS_TABLE} rows={report?.rows ?? null} semesterCode={semester.code} />
      </ViewHeading>
      {report?.failed ? (
        <ReportLoadError onRetry={report.retry} />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table aria-labelledby="departments-heading">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="max-sm:bg-muted px-4 max-sm:sticky max-sm:left-0 max-sm:z-10">{column.departmentCode.header}</TableHead>
                <TableHead className="px-4 text-right">{column.offerings.header}</TableHead>
                {SHARES.map(([count]) => (
                  <TableHead key={count.header} className="px-4 text-right">
                    {count.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!report ? (
                <TableSkeleton columns={['', '', '', '', '']} />
              ) : (
                report.rows!.map((row) => (
                  <TableRow key={row.department_id}>
                    <TableCell className="max-sm:bg-card px-4 py-3 whitespace-normal max-sm:sticky max-sm:left-0 max-sm:z-10">
                      <div className="min-w-32">
                        <span className="font-medium">{column.departmentCode.value(row)}</span> {column.departmentName.value(row)}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">{column.offerings.value(row)}</TableCell>
                    {SHARES.map(([count, percent]) => (
                      <TableCell key={count.header} className="px-4 py-3 text-right tabular-nums">
                        {formatPercent(percent.value(row))}
                        <span className={cn('text-muted-foreground text-xs', SMALL)}>
                          {count.value(row)} of {column.sections.value(row)}
                        </span>
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  )
}

function OfferingsView({ semester }: { semester: ReportSemester }) {
  const report = useReport<OfferingRow>('report_offerings', semester.id)
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState<OfferingStatus | ''>('')
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  const rows = report?.rows ?? null
  const departments = [...new Map((rows ?? []).map((row) => [row.department_id, row])).values()].toSorted((a, b) =>
    a.department_code.localeCompare(b.department_code),
  )
  const shown = rows && filterOfferings(rows, { departmentId: department || null, status: status || null })

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:flex sm:items-end">
        <div className="grid gap-2 sm:w-64">
          <Label htmlFor="offerings-department">Department</Label>
          <NativeSelect id="offerings-department" value={department} onChange={(event) => setDepartment(event.target.value)}>
            <NativeSelectOption value="">All departments</NativeSelectOption>
            {departments.map((row) => (
              <NativeSelectOption key={row.department_id} value={row.department_id}>
                {row.department_code} {row.department_name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2 sm:w-48">
          <Label htmlFor="offerings-status">Status</Label>
          <NativeSelect id="offerings-status" value={status} onChange={(event) => setStatus(event.target.value as OfferingStatus | '')}>
            <NativeSelectOption value="">All statuses</NativeSelectOption>
            {(Object.entries(OFFERING_STATUS_LABELS) as [OfferingStatus, string][]).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center justify-between gap-3 sm:ml-auto">
          {rows && (
            <p role="status" className="text-muted-foreground text-sm">
              {shown!.length} of {rows.length} offerings
            </p>
          )}
          <ExportMenu table={OFFERINGS_TABLE} rows={shown} semesterCode={semester.code} />
        </div>
      </div>
      <OfferingsTable rows={shown} emptyDescription="No offering of the semester matches these filters." />
    </div>
  )
}

function HeatmapView({ semester }: { semester: ReportSemester }) {
  const report = useReport<OfferingRow>('report_offerings', semester.id)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  const column = HEATMAP_TABLE.columns
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionStatusLegend />
        <ExportMenu table={HEATMAP_TABLE} rows={report?.rows ?? null} semesterCode={semester.code} />
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Section heatmap" className="w-auto">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="bg-muted sticky left-0 z-10 px-4">{column.courseCode.header}</TableHead>
              {SECTIONS.map((section) => (
                <TableHead key={section.number} title={`${section.number} ${section.title}`} className="w-8 px-1 text-center tabular-nums">
                  {section.number}
                  <span className="sr-only"> {section.title}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!report ? (
              <TableSkeleton columns={['', ...SECTIONS.map(() => '')]} />
            ) : report.rows!.length === 0 ? (
              <TableEmpty columns={20} icon={ChartColumnIcon} title="No offerings" description="The semester has no offerings." />
            ) : (
              report.rows!.map((row) => (
                <TableRow key={row.offering_id}>
                  <TableHead scope="row" className="bg-card sticky left-0 z-10 px-4 font-normal">
                    <Link
                      to={`/course-files/${row.offering_id}`}
                      title={column.courseTitle.value(row) ?? undefined}
                      className="block w-max max-w-28 font-medium whitespace-normal hover:underline"
                    >
                      {column.courseCode.value(row)}
                    </Link>
                  </TableHead>
                  {row.section_statuses.map((status, index) => (
                    <TableCell key={index} className="px-1 py-1.5 text-center">
                      <SectionStatusSquare section={index + 1} status={status} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

/**
 * The lecturer view, by lecturer. Its rows are lecturerOfferings, one for each offering of each
 * lecturer, and the screen shows LECTURERS_TABLE's headers and values for them, grouped by lecturer.
 */
function LecturersView({ semester }: { semester: ReportSemester }) {
  const report = useReport<LecturerRow>('report_lecturers', semester.id)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  const column = LECTURERS_TABLE.columns
  const lecturers = report?.rows?.map(lecturerOfferings)
  return (
    <div className="grid gap-4">
      <ExportMenu table={LECTURERS_TABLE} rows={lecturers?.flat() ?? null} semesterCode={semester.code} />
      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Lecturers">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">{column.lecturer.header}</TableHead>
              <TableHead className="px-4 whitespace-normal">Offerings and their missing sections</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!lecturers ? (
              <TableSkeleton columns={['', '']} />
            ) : lecturers.length === 0 ? (
              <TableEmpty columns={2} icon={ChartColumnIcon} title="No lecturers" description="The semester has no offerings." />
            ) : (
              lecturers.map((taught) => {
                const [first] = taught
                return (
                  <TableRow key={first.lecturer.lecturer_id}>
                    <TableCell className="px-4 py-3 align-top whitespace-normal">
                      <div className="grid gap-1">
                        <span className="font-medium">{column.lecturer.value(first)}</span>
                        {column.departmentCode.value(first) && (
                          <span className="text-muted-foreground text-xs">
                            {column.departmentCode.value(first)} {column.departmentName.value(first)}
                          </span>
                        )}
                        {first.lecturer.timetable_missing && (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                            {column.timetable.header} {column.timetable.value(first)?.toLowerCase()}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 align-top whitespace-normal">
                      <ul className="grid gap-2">
                        {taught.map((row) => (
                          <li key={row.offering.offering_id} className="grid gap-1 sm:flex sm:items-center sm:gap-3">
                            <span className="flex flex-wrap items-center gap-2 sm:w-48 sm:shrink-0">
                              <Link
                                to={`/course-files/${row.offering.offering_id}`}
                                title={column.courseTitle.value(row) ?? undefined}
                                className="font-medium hover:underline"
                              >
                                {column.courseCode.value(row)}
                              </Link>
                              {row.offering.coordinator && <Badge variant="secondary">{column.role.value(row)}</Badge>}
                            </span>
                            <SectionNumbers sections={row.offering.missing_sections} none="Nothing missing" />
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
