import { ChartColumnIcon, SearchIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState, LoadError, PageHeader, TableCard, TableSkeleton } from '@/components/page'
import {
  EmailLink,
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
import { SectionBar, SectionBarLegend } from '@/components/section-bar'
import { SectionStatusLegend, SectionStatusSquare } from '@/components/section-status'
import { FacultyStatTiles, offeringsDetail } from '@/components/stat-tiles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn, plural } from '@/lib/utils'
import {
  departmentsOf,
  filterLecturers,
  filterOfferings,
  HEATMAP_TABLE,
  LECTURERS_TABLE,
  lecturerOfferings,
  OFFERINGS_TABLE,
  STATUS_FILTER_LABELS,
  SUMMARY_TABLE,
  summaryRows,
  type Department,
  type StatusFilter,
} from '../report-tables.ts'
import { fetchReport, formatPercent, readAll, type DepartmentRow, type FacultySummary, type LecturerRow, type OfferingRow } from '../reports.ts'
import { sectionName, SECTIONS, type SectionStatus } from '../sections.ts'
import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

/** A semester of the Reports page, with the code that names its exported files. */
type ReportSemester = { id: string; code: string }

/**
 * The values the page keeps in its URL: ?semester=<id>&tab=<tab>&department=<id>&status=<status>&search=<text>.
 * department is all for every department, where the user's own department is the default.
 */
type Param = 'semester' | 'tab' | 'department' | 'status' | 'search'

/** Changes to the URL's values: a value sets its param, and null or an empty string drops it. */
type Patch = Partial<Record<Param, string | null>>

/** The department param that asks for every department, for an HoD, whose own department is the default. */
const ALL_DEPARTMENTS = 'all'

/** The URL with patch applied. */
function patched(current: URLSearchParams, patch: Patch) {
  const next = new URLSearchParams(current)
  for (const [param, value] of Object.entries(patch)) {
    if (value) next.set(param, value)
    else next.delete(param)
  }
  return next
}

/** The filters that the URL holds for the views, so that they last across tabs, and how a view changes them. */
type ReportUrl = {
  /** The department the URL asks for, else the HoD's own, or null for every department. */
  department: string | null
  /** Whether the URL names the department, or every department, rather than leaving the default. */
  departmentChosen: boolean
  /** The department param that asks for every department. */
  allDepartments: string | null
  status: StatusFilter | null
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

function isStatus(value: string | null): value is StatusFilter {
  return value !== null && Object.hasOwn(STATUS_FILTER_LABELS, value)
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
  const auth = useAuth()
  const ownDepartment = auth.kind === 'ready' && auth.roles.includes('hod') ? auth.profile.departmentId : null
  const list = semesters === 'failed' ? null : semesters
  const semesterParam = searchParams.get('semester')
  const semesterId = pickSemester(list, semesterParam)
  const semester = semesterId ? list!.find((s) => s.id === semesterId)! : null
  const tabParam = searchParams.get('tab')
  const tab = TABS.find((t) => t.value === tabParam) ?? TABS[0]
  const statusParam = searchParams.get('status')
  const status = isStatus(statusParam) ? statusParam : null

  const set = (patch: Patch) => setSearchParams((current) => patched(current, patch), { replace: true })
  const departmentParam = searchParams.get('department')
  const url: ReportUrl = {
    department: departmentParam === ALL_DEPARTMENTS ? null : (departmentParam ?? ownDepartment),
    departmentChosen: departmentParam !== null,
    allDepartments: ownDepartment ? ALL_DEPARTMENTS : null,
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
      <FacultyStatTiles summary={data?.faculty ?? null} />
      <section aria-labelledby="departments-heading" className="mt-2 grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h3 id="departments-heading" className="text-lg font-semibold tracking-tight">
            Departments
          </h3>
          <SectionBarLegend />
        </div>
        <DepartmentsTable rows={data?.departments ?? null} url={url} />
      </section>
    </>
  )
}

/** Below sm a department's offerings and percentages move into its cell, under its bar. */
const WIDE = 'hidden sm:table-cell'

/** The department breakdown, each department with the bar of its sections by status. Each department links to its offerings. */
function DepartmentsTable({ rows, url }: { rows: DepartmentRow[] | null; url: ReportUrl }) {
  const column = SUMMARY_TABLE.columns
  return (
    <TableCard>
      <Table aria-labelledby="departments-heading">
        <TableHeader>
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
                  <div className="grid gap-2.5">
                    <Link to={url.href({ tab: 'offerings', department: row.department_id, status: null })} className="hover:underline">
                      <span className="font-medium">{column.departmentCode.value(row)}</span>{' '}
                      <span className="text-muted-foreground">{column.departmentName.value(row)}</span>
                    </Link>
                    <SectionBar counts={row} />
                    <div className="text-muted-foreground grid gap-0.5 text-xs sm:hidden">
                      <span>
                        {plural(row.offerings, 'offering')} · {offeringsDetail(row)}
                      </span>
                      <span className="tabular-nums">{SHARES.map(([, percent]) => `${percent.header} ${formatPercent(percent.value(row))}`).join(' · ')}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn('px-4 py-3 text-right align-top tabular-nums', WIDE)}>
                  {column.offerings.value(row)}
                  <span className="text-muted-foreground block text-xs">{column.completeOfferings.value(row)} complete</span>
                  <span className="text-muted-foreground block text-xs">{column.verifiedOfferings.value(row)} verified</span>
                </TableCell>
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
    </TableCard>
  )
}

/**
 * The department a view shows: the one the URL asks for, or the HoD's own, when the view's
 * departments hold it, else every department, as null. A department in the URL that they lack gives
 * way to the default, in the URL too.
 */
function useShownDepartment(departments: Department[] | null, url: ReportUrl) {
  const department = departments?.some((row) => row.department_id === url.department) ? url.department : null
  const stale = departments !== null && url.departmentChosen && url.department !== null && department === null
  useEffect(() => {
    if (stale) url.set({ department: null })
  })
  return department
}

function DepartmentSelect({ id, departments, value, url }: { id: string; departments: Department[]; value: string | null; url: ReportUrl }) {
  return (
    <div className="grid gap-2 sm:w-64">
      <Label htmlFor={id}>Department</Label>
      <NativeSelect id={id} value={value ?? url.allDepartments ?? ''} onChange={(event) => url.set({ department: event.target.value })}>
        <NativeSelectOption value={url.allDepartments ?? ''}>All departments</NativeSelectOption>
        {departments.map((row) => (
          <NativeSelectOption key={row.department_id} value={row.department_id}>
            {row.department_code} {row.department_name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

/**
 * The department and status filters that the offering list and the heatmap share through the URL:
 * the rows they keep, their controls, and the count of what shows.
 */
function useOfferingFilters(view: string, rows: OfferingRow[] | null, url: ReportUrl) {
  const departments = rows && departmentsOf(rows)
  const department = useShownDepartment(departments, url)
  const shown = rows && filterOfferings(rows, { departmentId: department, status: url.status })
  const filtered = department !== null || url.status !== null
  const controls = (
    <div className="grid gap-4 max-sm:w-full sm:flex sm:items-end">
      <DepartmentSelect id={`${view}-department`} departments={departments ?? []} value={department} url={url} />
      <div className="grid gap-2 sm:w-48">
        <Label htmlFor={`${view}-status`}>Status</Label>
        <NativeSelect id={`${view}-status`} value={url.status ?? ''} onChange={(event) => url.set({ status: event.target.value })}>
          <NativeSelectOption value="">All statuses</NativeSelectOption>
          {(Object.entries(STATUS_FILTER_LABELS) as [StatusFilter, string][]).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
  const count = rows ? (filtered ? `${shown!.length} of ${plural(rows.length, 'offering')}` : plural(rows.length, 'offering')) : undefined
  return { shown, controls, count }
}

/** What the offering list and the heatmap show when their filters keep no offering. */
function NoMatchingOfferings({ url }: { url: ReportUrl }) {
  return (
    <Card className="py-0">
      <EmptyState
        icon={ChartColumnIcon}
        title="No matching offerings"
        action={
          <Button variant="outline" onClick={() => url.set({ department: url.allDepartments, status: null })}>
            Clear filters
          </Button>
        }
      />
    </Card>
  )
}

/** The offering list, filtered by department and status. A department that has no offering in the semester gives way. */
function OfferingsView({ semester, url }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadOfferings)
  const rows = report?.data ?? null
  const { shown, controls, count } = useOfferingFilters('offerings', rows, url)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  if (semester && rows?.length === 0) return <NoOfferings semester={semester} />
  return (
    <>
      <Toolbar start={controls} count={count}>
        <ExportMenu table={OFFERINGS_TABLE} rows={shown} semesterCode={semester?.code ?? null} />
      </Toolbar>
      {shown?.length === 0 ? <NoMatchingOfferings url={url} /> : <OfferingsTable rows={shown} />}
    </>
  )
}

/** The heatmap's section columns, from lg. Below lg each offering's sections show as a strip in its course cell. */
const SECTION_COLUMN = 'hidden lg:table-cell'

function sectionPage(offeringId: string, section: number) {
  return `/course-files/${offeringId}/sections/${section}`
}

/**
 * One row for each offering that the offering list's filters keep, and one column for each section,
 * with the section's status as a colored square with a mark that opens the section. The last row
 * counts the missing sections of each column.
 */
function HeatmapView({ semester, url }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadOfferings)
  const rows = report?.data ?? null
  const { shown, controls, count } = useOfferingFilters('heatmap', rows, url)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  if (semester && rows?.length === 0) return <NoOfferings semester={semester} />
  const column = HEATMAP_TABLE.columns
  const missing = SECTIONS.map((_, index) => shown?.filter((row) => row.section_statuses[index] === 'missing').length ?? 0)
  return (
    <>
      <Toolbar start={controls} count={count}>
        <ExportMenu table={HEATMAP_TABLE} rows={shown} semesterCode={semester?.code ?? null} />
      </Toolbar>
      {shown?.length === 0 ? (
        <NoMatchingOfferings url={url} />
      ) : (
        <>
          <SectionStatusLegend />
          <TableCard>
            <Table aria-label="Section heatmap">
              <TableHeader>
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
                {!shown ? (
                  <TableSkeleton columns={['', ...SECTIONS.map(() => cn('px-0 last:pr-3 [&>*]:mx-auto [&>*]:size-6', SECTION_COLUMN))]} />
                ) : (
                  shown.map((row) => (
                    <TableRow key={row.offering_id}>
                      <TableHead scope="row" className="h-auto px-4 py-2 font-normal whitespace-normal">
                        <Link to={`/course-files/${row.offering_id}`} className="font-medium hover:underline">
                          {column.courseCode.value(row)}
                        </Link>
                        <p className="text-muted-foreground text-xs">{column.courseTitle.value(row)}</p>
                        <SectionStrip offeringId={row.offering_id} statuses={row.section_statuses} className="mt-2 lg:hidden" />
                      </TableHead>
                      {row.section_statuses.map((status, index) => (
                        <TableCell key={index} className={cn('px-0 py-2 text-center last:pr-3', SECTION_COLUMN)}>
                          <SectionStatusSquare section={index + 1} status={status} to={sectionPage(row.offering_id, index + 1)} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
              {shown && (
                <TableFooter>
                  <TableRow>
                    <TableHead scope="row" className="h-auto px-4 py-2 whitespace-normal">
                      Missing
                      <MissingStrip missing={missing} className="mt-2 lg:hidden" />
                    </TableHead>
                    {missing.map((total, index) => (
                      <TableCell
                        key={index}
                        title={`${sectionName(index + 1)}: ${total} missing`}
                        className={cn('px-0 py-2 text-center tabular-nums last:pr-3', total === 0 && 'text-muted-foreground font-normal', SECTION_COLUMN)}
                      >
                        {total}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </TableCard>
        </>
      )}
    </>
  )
}

/** How many of the heatmap's offerings miss each section, numbered as each offering's strip is, where the heatmap's columns do not fit. */
function MissingStrip({ missing, className }: { missing: number[]; className?: string }) {
  return (
    <ol aria-label="Missing by section" className={cn('grid max-w-xl grid-cols-10 gap-x-1 gap-y-2 sm:grid-cols-[repeat(19,minmax(0,1fr))]', className)}>
      {missing.map((total, index) => (
        <li key={index} title={`${sectionName(index + 1)}: ${total} missing`} className="grid justify-items-center gap-1">
          <span aria-hidden="true" className="text-muted-foreground text-[10px] leading-none font-normal tabular-nums">
            {index + 1}
          </span>
          <span aria-hidden="true" className={cn('text-sm tabular-nums', total === 0 && 'text-muted-foreground font-normal')}>
            {total}
          </span>
          <span className="sr-only">
            {sectionName(index + 1)}: {total} missing
          </span>
        </li>
      ))}
    </ol>
  )
}

/** An offering's 19 section statuses as numbered squares that open the sections, ten to a row on a phone, where the heatmap's columns do not fit. */
function SectionStrip({ offeringId, statuses, className }: { offeringId: string; statuses: SectionStatus[]; className?: string }) {
  return (
    <ol aria-label="Sections" className={cn('grid max-w-xl grid-cols-10 gap-x-1 gap-y-2 sm:grid-cols-[repeat(19,minmax(0,1fr))]', className)}>
      {statuses.map((status, index) => (
        <li key={index} className="grid justify-items-center gap-1">
          <span aria-hidden="true" className="text-muted-foreground text-[10px] leading-none tabular-nums">
            {index + 1}
          </span>
          <SectionStatusSquare section={index + 1} status={status} to={sectionPage(offeringId, index + 1)} />
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
 * and Needs fix sections linked to them. The department keeps the lecturers who teach an offering
 * of it, with only those offerings, and the search the lecturers whose name holds it.
 */
function LecturersView({ semester, url }: ViewProps) {
  const report = useReport(semester?.id ?? null, loadLecturers)
  // The box keeps its own text, so typing never waits for the URL to change.
  const [search, setSearch] = useState(url.search)
  const rows = report?.data ?? null
  const departments = rows && departmentsOf(rows.flatMap((row) => row.offerings))
  const department = useShownDepartment(departments, url)
  if (report?.failed) return <ReportLoadError onRetry={report.retry} />
  if (semester && rows?.length === 0) return <NoOfferings semester={semester} />
  const shown = rows && filterLecturers(rows, { search, departmentId: department })
  const filtered = search.trim() !== '' || department !== null
  const searchFor = (text: string) => {
    setSearch(text)
    url.set({ search: text })
  }
  return (
    <>
      <Toolbar
        start={
          <div className="grid gap-4 max-sm:w-full sm:flex sm:items-end">
            <DepartmentSelect id="lecturers-department" departments={departments ?? []} value={department} url={url} />
            <Input
              type="search"
              aria-label="Search lecturers"
              placeholder="Search lecturers"
              value={search}
              onChange={(event) => searchFor(event.target.value)}
              className="sm:w-64"
            />
          </div>
        }
        count={rows ? (filtered ? `${shown!.length} of ${plural(rows.length, 'lecturer')}` : plural(rows.length, 'lecturer')) : undefined}
      >
        <ExportMenu table={LECTURERS_TABLE} rows={shown?.flatMap(lecturerOfferings) ?? null} semesterCode={semester?.code ?? null} />
      </Toolbar>
      {shown?.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={SearchIcon}
            title="No matching lecturers"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  url.set({ search: null, department: url.allDepartments })
                }}
              >
                Clear filters
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
    <TableCard>
      <Table aria-label="Lecturers">
        <TableHeader>
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
                      <EmailLink email={column.email.value(first)} />
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
    </TableCard>
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
            <SectionNumbers offeringId={row.offering.offering_id} missing={row.offering.missing_sections} needsFix={row.offering.needs_fix_sections} />
          </div>
        </li>
      ))}
    </ul>
  )
}
