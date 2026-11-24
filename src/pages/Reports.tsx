import { ChartColumnIcon, SearchIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState, LoadError, PageHeader, TableSkeleton } from '@/components/page'
import {
  ExportMenu,
  loadOfferings,
  NUMBER_SKELETON,
  OfferingsTable,
  pickSemester,
  ReportLoadError,
  SectionNumbers,
  SemesterSelect,
  useReport,
} from '@/components/reports'
import { SectionStatusLegend, SectionStatusSquare } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn, plural } from '@/lib/utils'
import {
  filterLecturers,
  filterOfferings,
  HEATMAP_TABLE,
  LECTURERS_TABLE,
  lecturerOfferings,
  OFFERINGS_TABLE,
  SUMMARY_TABLE,
  summaryRows,
} from '../report-tables.ts'
import {
  fetchReport,
  formatPercent,
  OFFERING_STATUS_LABELS,
  readAll,
  type DepartmentRow,
  type FacultySummary,
  type LecturerRow,
  type OfferingStatus,
} from '../reports.ts'
import { SECTIONS, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'

/** A semester of the Reports page, with the code that names its exported files. */
type ReportSemester = { id: string; code: string }

/** The values the page keeps in its URL: ?semester=<id>&tab=<tab>&department=<id>&status=<status>&search=<text>. */
type Param = 'semester' | 'tab' | 'department' | 'status' | 'search'

/** Changes to the URL's values: a value sets its param, and null or an empty string drops it. */
type Patch = Partial<Record<Param, string | null>>

/** The URL with patch applied. A new semester also drops the department, which belongs to the old semester's offerings. */
function patched(current: URLSearchParams, patch: Patch) {
  const next = new URLSearchParams(current)
  if (patch.semester !== undefined && patch.semester !== current.get('semester')) next.delete('department')
  for (const [param, value] of Object.entries(patch)) {
    if (value) next.set(param, value)
    else next.delete(param)
  }
  return next
}

/** The filters that the URL holds for the views, so that they last across tabs, and how a view changes them. */
type ReportUrl = {
  department: string | null
  status: OfferingStatus | null
  search: string
  set: (patch: Patch) => void
  /** The link to this page with patch applied, such as the offering list of a department. */
  href: (patch: Patch) => string
}

/** What each tab's view gets: the semester, null while the semesters load, and the URL's filters. */
type ViewProps = { semester: ReportSemester | null; url: ReportUrl }

const TABS = [
  { value: 'summary', label: 'Summary', View: SummaryView },
  { value: 'offerings', label: 'Offerings', View: OfferingsView },
  { value: 'heatmap', label: 'Heatmap', View: HeatmapView },
  { value: 'lecturers', label: 'Lecturers', View: LecturersView },
] as const

function isStatus(value: string | null): value is OfferingStatus {
  return value !== null && Object.hasOwn(OFFERING_STATUS_LABELS, value)
}

/** The semesters in which the user reads an offering, newest first. RLS decides which offerings they read. */
function useReportSemesters() {
  const [semesters, setSemesters] = useState<ReportSemester[] | 'failed' | null>(null)
  const load = useCallback(async () => {
    try {
      const rows = await readAll<ReportSemester>((from, to) =>
        supabase
          .from('semesters')
          .select('id, code, offerings!inner(id)')
          .order('start_year', { ascending: false })
          .order('number', { ascending: false })
          .order('id')
          .limit(1, { referencedTable: 'offerings' })
          .range(from, to),
      )
      setSemesters(rows.map(({ id, code }) => ({ id, code })))
    } catch {
      setSemesters('failed')
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  return { semesters, reload: load }
}

/**
 * The completeness of one semester's course files, for management, auditors and the admin. The
 * semester, the tab and the filters are in the URL, and the newest semester with offerings is the
 * default. A URL value that the page cannot show gives way to what it shows, so that the URL and
 * the controls agree.
 */
export function Reports() {
  const { semesters, reload } = useReportSemesters()
  const [searchParams, setSearchParams] = useSearchParams()
  const list = semesters === 'failed' ? null : semesters
  const semesterParam = searchParams.get('semester')
  const semesterId = pickSemester(list, semesterParam)
  const semester = semesterId ? list!.find((s) => s.id === semesterId)! : null
  const tabParam = searchParams.get('tab')
  const tab = TABS.find((t) => t.value === tabParam) ?? TABS[0]
  const statusParam = searchParams.get('status')
  const status = isStatus(statusParam) ? statusParam : null

  const set = (patch: Patch) => setSearchParams((current) => patched(current, patch), { replace: true })
  const url: ReportUrl = {
    department: searchParams.get('department'),
    status,
    search: searchParams.get('search') ?? '',
    set,
    href: (patch) => `?${patched(searchParams, patch)}`,
  }

  useEffect(() => {
    const patch: Patch = {}
    if (list && semesterParam !== null && semesterParam !== semesterId) patch.semester = semesterId
    if (tabParam !== null && tabParam !== tab.value) patch.tab = null
    if (statusParam !== null && statusParam !== status) patch.status = null
    if (Object.keys(patch).length > 0) setSearchParams((current) => patched(current, patch), { replace: true })
  }, [list, semesterParam, semesterId, tabParam, tab.value, statusParam, status, setSearchParams])

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        action={
          list ? (
            semesterId && <SemesterSelect semesters={list} value={semesterId} onChange={(id) => set({ semester: id })} />
          ) : (
            semesters === null && <Skeleton className="h-[58px] w-full sm:w-56" />
          )
        }
      />
      {semesters === 'failed' ? (
        <Card className="py-0">
          <LoadError title="Couldn't load the semesters" onRetry={reload} />
        </Card>
      ) : list?.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={ChartColumnIcon} title="No reports yet" />
        </Card>
      ) : (
        <Tabs value={tab.value} onValueChange={(value) => set({ tab: value })} className="min-w-0 gap-6">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map(({ value, label, View }) => (
            <TabsContent key={value} value={value} className="grid min-w-0 gap-4">
              <h2 className="sr-only">{label}</h2>
              <View semester={semester} url={url} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

/**
 * A tab's row of controls: its filters or legend at the start, then the count of what shows and the
 * Export menu at the end. On a phone the count and Export share their own row.
 */
function Toolbar({ start, count, children }: { start?: ReactNode; count?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      {start}
      <div className="flex items-center justify-end gap-3 max-sm:w-full sm:ml-auto">
        {count && (
          <p role="status" className="text-muted-foreground text-sm max-sm:mr-auto">
            {count}
          </p>
        )}
        {children}
      </div>
    </div>
  )
}

/** What each tab shows for a semester without offerings, in place of its controls. */
function NoOfferings({ semester }: { semester: ReportSemester }) {
  return (
    <Card className="py-0">
      <EmptyState icon={ChartColumnIcon} title={`No offerings in ${semester.code}`} />
    </Card>
  )
}

/** Each share of the summary as its count of sections and its percentage of the sections that count. */
const SHARES = [
  [SUMMARY_TABLE.columns.uploaded, SUMMARY_TABLE.columns.uploadedPercent],
  [SUMMARY_TABLE.columns.verified, SUMMARY_TABLE.columns.verifiedPercent],
  [SUMMARY_TABLE.columns.needsFix, SUMMARY_TABLE.columns.needsFixPercent],
] as const

/** The faculty summary and the department breakdown, which load and fail together. */
async function loadSummary(semesterId: string) {
  const [[faculty], departments] = await Promise.all([
    fetchReport<FacultySummary>(supabase, 'report_faculty_summary', semesterId),
    fetchReport<DepartmentRow>(supabase, 'report_departments', semesterId),
  ])
  return { faculty, departments }
}

/** The faculty summary as four figures, and the department breakdown below it. Its one export holds both. */
function SummaryView({ semester, url }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadSummary)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  const data = report?.data ?? null
  if (semester && data?.faculty.offerings === 0) return <NoOfferings semester={semester} />
  return (
    <>
      <Toolbar>
        <ExportMenu table={SUMMARY_TABLE} rows={data && summaryRows(data.faculty, data.departments)} semesterCode={semester?.code ?? null} />
      </Toolbar>
      <SummaryTiles summary={data?.faculty ?? null} />
      <section aria-labelledby="departments-heading" className="mt-2 grid gap-3">
        <h3 id="departments-heading" className="text-lg font-semibold tracking-tight">
          Departments
        </h3>
        <DepartmentsTable rows={data?.departments ?? null} url={url} />
      </section>
    </>
  )
}

function SummaryTiles({ summary }: { summary: FacultySummary | null }) {
  const column = SUMMARY_TABLE.columns
  const tiles = [
    { label: column.offerings.header, value: summary && column.offerings.value(summary), detail: undefined },
    ...SHARES.map(([count, percent]) => ({
      label: percent.header,
      value: summary && formatPercent(percent.value(summary)),
      detail: summary ? `${count.value(summary)} of ${column.sections.value(summary)} sections` : null,
    })),
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="gap-1 py-4 sm:gap-2 sm:py-6">
          <CardHeader className="px-4 sm:px-6">
            <CardDescription>{tile.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums sm:text-3xl">{tile.value ?? <Skeleton className="h-8 w-20 sm:h-9 sm:w-24" />}</CardTitle>
          </CardHeader>
          {tile.detail !== undefined && (
            <CardContent className="text-muted-foreground px-4 text-sm sm:px-6">{tile.detail ?? <Skeleton className="h-5 w-28" />}</CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}

/** Below sm a department's offerings and percentages move into its cell. */
const WIDE = 'hidden sm:table-cell'

/** The department breakdown. Each department links to its offerings. */
function DepartmentsTable({ rows, url }: { rows: DepartmentRow[] | null; url: ReportUrl }) {
  const column = SUMMARY_TABLE.columns
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-labelledby="departments-heading">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4">{column.departmentName.header}</TableHead>
            <TableHead className={cn('w-28 px-4 text-right', WIDE)}>{column.offerings.header}</TableHead>
            {SHARES.map(([, percent]) => (
              <TableHead key={percent.header} className={cn('w-28 px-4 text-right', WIDE)}>
                {percent.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!rows ? (
            <TableSkeleton columns={['', ...Array.from({ length: 4 }, () => cn(WIDE, NUMBER_SKELETON))]} />
          ) : (
            rows.map((row) => (
              <TableRow key={row.department_id}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <Link to={url.href({ tab: 'offerings', department: row.department_id, status: null })} className="hover:underline">
                    <span className="font-medium">{column.departmentCode.value(row)}</span> {column.departmentName.value(row)}
                  </Link>
                  <div className="text-muted-foreground mt-1 grid gap-0.5 text-xs sm:hidden">
                    <span>{plural(row.offerings, 'offering')}</span>
                    <span className="tabular-nums">{SHARES.map(([, percent]) => `${percent.header} ${formatPercent(percent.value(row))}`).join(' · ')}</span>
                  </div>
                </TableCell>
                <TableCell className={cn('px-4 py-3 text-right align-top tabular-nums', WIDE)}>{column.offerings.value(row)}</TableCell>
                {SHARES.map(([count, percent]) => (
                  <TableCell key={percent.header} className={cn('px-4 py-3 text-right align-top tabular-nums', WIDE)}>
                    {formatPercent(percent.value(row))}
                    <span className="text-muted-foreground block text-xs">
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
  )
}

/** The offering list, filtered by department and status. A department that has no offering in the semester gives way. */
function OfferingsView({ semester, url }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadOfferings)
  const rows = report?.data ?? null
  const departments = [...new Map((rows ?? []).map((row) => [row.department_id, row])).values()].toSorted((a, b) =>
    a.department_code.localeCompare(b.department_code),
  )
  const department = departments.some((row) => row.department_id === url.department) ? url.department : null
  const staleDepartment = rows !== null && url.department !== null && department === null
  useEffect(() => {
    if (staleDepartment) url.set({ department: null })
  })

  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  if (semester && rows?.length === 0) return <NoOfferings semester={semester} />
  const shown = rows && filterOfferings(rows, { departmentId: department, status: url.status })
  const filtered = department !== null || url.status !== null
  return (
    <>
      <Toolbar
        start={
          <div className="grid gap-4 max-sm:w-full sm:flex sm:items-end">
            <div className="grid gap-2 sm:w-64">
              <Label htmlFor="offerings-department">Department</Label>
              <NativeSelect id="offerings-department" value={department ?? ''} onChange={(event) => url.set({ department: event.target.value })}>
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
              <NativeSelect id="offerings-status" value={url.status ?? ''} onChange={(event) => url.set({ status: event.target.value })}>
                <NativeSelectOption value="">All statuses</NativeSelectOption>
                {(Object.entries(OFFERING_STATUS_LABELS) as [OfferingStatus, string][]).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        }
        count={rows ? (filtered ? `${shown!.length} of ${plural(rows.length, 'offering')}` : plural(rows.length, 'offering')) : undefined}
      >
        <ExportMenu table={OFFERINGS_TABLE} rows={shown} semesterCode={semester?.code ?? null} />
      </Toolbar>
      {shown?.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={ChartColumnIcon}
            title="No matching offerings"
            action={
              <Button variant="outline" onClick={() => url.set({ department: null, status: null })}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <OfferingsTable rows={shown} />
      )}
    </>
  )
}

/** The heatmap's section columns, from lg. Below lg each offering's sections show as a strip in its course cell. */
const SECTION_COLUMN = 'hidden lg:table-cell'

/** One row for each offering and one column for each section, with the section's status as a colored square with a mark. */
function HeatmapView({ semester }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadOfferings)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  const rows = report?.data ?? null
  if (semester && rows?.length === 0) return <NoOfferings semester={semester} />
  const column = HEATMAP_TABLE.columns
  return (
    <>
      <Toolbar start={<SectionStatusLegend className="self-center" />} count={rows ? plural(rows.length, 'offering') : undefined}>
        <ExportMenu table={HEATMAP_TABLE} rows={rows} semesterCode={semester?.code ?? null} />
      </Toolbar>
      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Section heatmap">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">{column.courseTitle.header}</TableHead>
              {SECTIONS.map((section) => (
                <TableHead
                  key={section.number}
                  title={`${section.number} ${section.title}`}
                  className={cn('w-9 px-0 text-center tabular-nums last:pr-3 last:w-12', SECTION_COLUMN)}
                >
                  {section.number}
                  <span className="sr-only"> {section.title}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows ? (
              <TableSkeleton columns={['', ...SECTIONS.map(() => cn('px-0 last:pr-3 [&>*]:mx-auto [&>*]:size-6', SECTION_COLUMN))]} />
            ) : (
              rows.map((row) => (
                <TableRow key={row.offering_id}>
                  <TableHead scope="row" className="h-auto px-4 py-2 font-normal whitespace-normal">
                    <Link to={`/course-files/${row.offering_id}`} className="font-medium hover:underline">
                      {column.courseCode.value(row)}
                    </Link>
                    <p className="text-muted-foreground text-xs">{column.courseTitle.value(row)}</p>
                    <SectionStrip statuses={row.section_statuses} className="mt-2 lg:hidden" />
                  </TableHead>
                  {row.section_statuses.map((status, index) => (
                    <TableCell key={index} className={cn('px-0 py-2 text-center last:pr-3', SECTION_COLUMN)}>
                      <SectionStatusSquare section={index + 1} status={status} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}

/** An offering's 19 section statuses as numbered squares, ten to a row on a phone, where the heatmap's columns do not fit. */
function SectionStrip({ statuses, className }: { statuses: SectionStatus[]; className?: string }) {
  return (
    <ol aria-label="Sections" className={cn('grid max-w-xl grid-cols-10 gap-x-1 gap-y-2 sm:grid-cols-[repeat(19,minmax(0,1fr))]', className)}>
      {statuses.map((status, index) => (
        <li key={index} className="grid justify-items-center gap-1">
          <span aria-hidden="true" className="text-muted-foreground text-[10px] leading-none tabular-nums">
            {index + 1}
          </span>
          <SectionStatusSquare section={index + 1} status={status} />
        </li>
      ))}
    </ol>
  )
}

function loadLecturers(semesterId: string) {
  return fetchReport<LecturerRow>(supabase, 'report_lecturers', semesterId)
}

/**
 * The lecturer view: each lecturer, in the report's order, with their offerings and the missing
 * sections linked to them. The search keeps the lecturers whose name holds it.
 */
function LecturersView({ semester, url }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadLecturers)
  // The box keeps its own text, so typing never waits for the URL to change.
  const [search, setSearch] = useState(url.search)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  const rows = report?.data ?? null
  if (semester && rows?.length === 0) return <NoOfferings semester={semester} />
  const shown = rows && filterLecturers(rows, search)
  const searching = search.trim() !== ''
  const searchFor = (text: string) => {
    setSearch(text)
    url.set({ search: text })
  }
  return (
    <>
      <Toolbar
        start={
          <Input
            type="search"
            aria-label="Search lecturers"
            placeholder="Search lecturers"
            value={search}
            onChange={(event) => searchFor(event.target.value)}
            className="max-sm:w-full sm:w-64"
          />
        }
        count={rows ? (searching ? `${shown!.length} of ${plural(rows.length, 'lecturer')}` : plural(rows.length, 'lecturer')) : undefined}
      >
        <ExportMenu table={LECTURERS_TABLE} rows={shown?.flatMap(lecturerOfferings) ?? null} semesterCode={semester?.code ?? null} />
      </Toolbar>
      {shown?.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={SearchIcon}
            title="No matching lecturers"
            action={
              <Button variant="outline" onClick={() => searchFor('')}>
                Clear search
              </Button>
            }
          />
        </Card>
      ) : (
        <LecturersTable lecturers={shown} />
      )}
    </>
  )
}

/** Below sm each lecturer's courses move into the lecturer's cell. */
function LecturersTable({ lecturers }: { lecturers: LecturerRow[] | null }) {
  const column = LECTURERS_TABLE.columns
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-label="Lecturers">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4 sm:w-2/5">{column.lecturer.header}</TableHead>
            <TableHead className={cn('px-4', WIDE)}>Courses</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!lecturers ? (
            <TableSkeleton columns={['', WIDE]} />
          ) : (
            lecturers.map((lecturer) => {
              const taught = lecturerOfferings(lecturer)
              const [first] = taught
              return (
                <TableRow key={lecturer.lecturer_id}>
                  <TableCell className="px-4 py-3 align-top whitespace-normal">
                    <div className="grid gap-1">
                      <span className="font-medium">{column.lecturer.value(first)}</span>
                      {column.departmentCode.value(first) && (
                        <span className="text-muted-foreground text-xs">
                          {column.departmentCode.value(first)} {column.departmentName.value(first)}
                        </span>
                      )}
                      {lecturer.timetable_missing && (
                        <Badge variant="destructive">
                          {column.timetable.header} {column.timetable.value(first)?.toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    <LecturerCourses taught={taught} className="mt-3 sm:hidden" />
                  </TableCell>
                  <TableCell className={cn('px-4 py-3 align-top whitespace-normal', WIDE)}>
                    <LecturerCourses taught={taught} />
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

function LecturerCourses({ taught, className }: { taught: ReturnType<typeof lecturerOfferings>; className?: string }) {
  const column = LECTURERS_TABLE.columns
  return (
    <ul className={cn('grid gap-3 sm:gap-2', className)}>
      {taught.map((row) => (
        <li key={row.offering.offering_id} className="grid gap-1 md:flex md:items-baseline md:gap-3">
          <span className="flex flex-wrap items-center gap-2 md:w-64 md:shrink-0">
            <Link to={`/course-files/${row.offering.offering_id}`} title={column.courseTitle.value(row) ?? undefined} className="font-medium hover:underline">
              {column.courseCode.value(row)}
            </Link>
            {row.offering.coordinator && <Badge variant="secondary">{column.role.value(row)}</Badge>}
          </span>
          <div className="min-w-0 flex-1">
            <SectionNumbers sections={row.offering.missing_sections} labelled />
          </div>
        </li>
      ))}
    </ul>
  )
}
