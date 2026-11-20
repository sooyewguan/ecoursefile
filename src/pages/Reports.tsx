import { ChartColumnIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ErrorAlert } from '@/components/notice'
import { PageHeader, TableEmpty, TableSkeleton } from '@/components/page'
import { OfferingsTable, SectionNumbers, SemesterSelect, useReport } from '@/components/reports'
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
  const [semesters, setSemesters] = useState<{ list: { id: string; code: string }[] } | { error: string } | null>(null)
  useEffect(() => {
    void supabase
      .from('semesters')
      .select('id, code, offerings!inner(id)')
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
      .limit(1, { referencedTable: 'offerings' })
      .then(({ data, error }) => setSemesters(error ? { error: error.message } : { list: data.map(({ id, code }) => ({ id, code })) }))
  }, [])
  return semesters
}

/**
 * The completeness of one semester's course files, for management, auditors and the admin. The
 * semester and the view are in the URL, at ?semester=<id>&tab=<view>, and the newest semester with
 * offerings is the default.
 */
export function Reports() {
  const semesters = useReportSemesters()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = TABS.find((t) => t.value === searchParams.get('tab'))?.value ?? 'summary'
  const list = semesters && 'list' in semesters ? semesters.list : null
  const semesterId = searchParams.get('semester') ?? list?.[0]?.id ?? null

  const navigate = (next: { semester?: string; tab?: Tab }) =>
    setSearchParams({ semester: next.semester ?? semesterId ?? '', tab: next.tab ?? tab }, { replace: true })

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        description="How complete each course file of a semester is, by department, offering, section and lecturer."
        action={list && list.length > 0 && semesterId && <SemesterSelect semesters={list} value={semesterId} onChange={(semester) => navigate({ semester })} />}
      />
      {semesters && 'error' in semesters && <ErrorAlert>{semesters.error}</ErrorAlert>}
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
      {semesterId && (
        <Tabs value={tab} onValueChange={(value) => navigate({ tab: value as Tab })} className="min-w-0 gap-6">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="summary" className="grid gap-6">
            <FacultySummaryView semesterId={semesterId} />
            <DepartmentsView semesterId={semesterId} />
          </TabsContent>
          <TabsContent value="offerings">
            <OfferingsView semesterId={semesterId} />
          </TabsContent>
          <TabsContent value="heatmap">
            <HeatmapView semesterId={semesterId} />
          </TabsContent>
          <TabsContent value="lecturers">
            <LecturersView semesterId={semesterId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function FacultySummaryView({ semesterId }: { semesterId: string }) {
  const report = useReport<FacultySummary>('report_faculty_summary', semesterId)
  if (report?.error) return <ErrorAlert>{report.error}</ErrorAlert>
  const summary = report?.rows?.[0]
  const share = (count: number | undefined) => (summary ? `${count} of ${summary.counted_sections} sections` : undefined)
  const tiles = [
    { label: 'Offerings', value: summary?.offerings, detail: summary && 'Course files in the semester' },
    { label: 'Sections uploaded', value: summary && formatPercent(summary.percent_uploaded), detail: share(summary?.uploaded_sections) },
    { label: 'Verified', value: summary && formatPercent(summary.percent_verified), detail: share(summary?.verified_sections) },
    { label: 'Needs fix', value: summary && formatPercent(summary.percent_needs_fix), detail: share(summary?.needs_fix_sections) },
  ]
  return (
    <section aria-label="Faculty summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="gap-2">
          <CardHeader>
            <CardDescription>{tile.label}</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{tile.value ?? <Skeleton className="h-9 w-24" />}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">{tile.detail ?? <Skeleton className="h-5 w-32" />}</CardContent>
        </Card>
      ))}
    </section>
  )
}

/** Below sm the counts behind each percentage are left out. */
const SMALL = 'hidden sm:block'

function DepartmentsView({ semesterId }: { semesterId: string }) {
  const report = useReport<DepartmentRow>('report_departments', semesterId)
  if (report?.error) return <ErrorAlert>{report.error}</ErrorAlert>
  const percentCell = (percent: number | null, count: number, row: DepartmentRow) => (
    <TableCell className="px-4 py-3 text-right tabular-nums">
      {formatPercent(percent)}
      <span className={cn('text-muted-foreground text-xs', SMALL)}>
        {count} of {row.counted_sections}
      </span>
    </TableCell>
  )
  return (
    <section aria-labelledby="departments-heading" className="grid gap-3">
      <h2 id="departments-heading" className="text-lg font-semibold tracking-tight">
        Departments
      </h2>
      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-labelledby="departments-heading">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Department</TableHead>
              <TableHead className="px-4 text-right">Offerings</TableHead>
              <TableHead className="px-4 text-right">Uploaded</TableHead>
              <TableHead className="px-4 text-right">Verified</TableHead>
              <TableHead className="px-4 text-right">Needs fix</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!report ? (
              <TableSkeleton columns={['', '', '', '', '']} />
            ) : (
              report.rows!.map((row) => (
                <TableRow key={row.department_id}>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <span className="font-medium">{row.department_code}</span> {row.department_name}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{row.offerings}</TableCell>
                  {percentCell(row.percent_uploaded, row.uploaded_sections, row)}
                  {percentCell(row.percent_verified, row.verified_sections, row)}
                  {percentCell(row.percent_needs_fix, row.needs_fix_sections, row)}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}

function OfferingsView({ semesterId }: { semesterId: string }) {
  const report = useReport<OfferingRow>('report_offerings', semesterId)
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState<OfferingStatus | ''>('')
  if (report?.error) return <ErrorAlert>{report.error}</ErrorAlert>
  const rows = report?.rows ?? null
  const departments = [...new Map((rows ?? []).map((row) => [row.department_id, row])).values()].toSorted((a, b) =>
    a.department_code.localeCompare(b.department_code),
  )
  const shown = rows?.filter((row) => (!department || row.department_id === department) && (!status || row.status === status)) ?? null

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
        {rows && (
          <p role="status" className="text-muted-foreground text-sm sm:ml-auto sm:pb-2">
            {shown!.length} of {rows.length} offerings
          </p>
        )}
      </div>
      <OfferingsTable rows={shown} emptyDescription="No offering of the semester matches these filters." />
    </div>
  )
}

function HeatmapView({ semesterId }: { semesterId: string }) {
  const report = useReport<OfferingRow>('report_offerings', semesterId)
  if (report?.error) return <ErrorAlert>{report.error}</ErrorAlert>
  return (
    <div className="grid gap-4">
      <SectionStatusLegend />
      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Section heatmap" className="w-auto">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="bg-muted sticky left-0 z-10 px-4">Course</TableHead>
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
                    <Link to={`/course-files/${row.offering_id}`} title={row.course_title} className="font-medium hover:underline">
                      {row.course_code}
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

function LecturersView({ semesterId }: { semesterId: string }) {
  const report = useReport<LecturerRow>('report_lecturers', semesterId)
  if (report?.error) return <ErrorAlert>{report.error}</ErrorAlert>
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-label="Lecturers">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4">Lecturer</TableHead>
            <TableHead className="px-4 whitespace-normal">Offerings and their missing sections</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!report ? (
            <TableSkeleton columns={['', '']} />
          ) : report.rows!.length === 0 ? (
            <TableEmpty columns={2} icon={ChartColumnIcon} title="No lecturers" description="The semester has no offerings." />
          ) : (
            report.rows!.map((row) => (
              <TableRow key={row.lecturer_id}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <div className="grid gap-1">
                    <span className="font-medium">{row.lecturer_name}</span>
                    {row.department_code && (
                      <span className="text-muted-foreground text-xs">
                        {row.department_code} {row.department_name}
                      </span>
                    )}
                    {row.timetable_missing && (
                      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                        No timetable
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <ul className="grid gap-2">
                    {row.offerings.map((offering) => (
                      <li key={offering.offering_id} className="grid gap-1 sm:flex sm:items-center sm:gap-3">
                        <span className="flex flex-wrap items-center gap-2 sm:w-48 sm:shrink-0">
                          <Link to={`/course-files/${offering.offering_id}`} title={offering.course_title} className="font-medium wrap-anywhere hover:underline">
                            {offering.course_code}
                          </Link>
                          {offering.coordinator && <Badge variant="secondary">Coordinator</Badge>}
                        </span>
                        <SectionNumbers sections={offering.missing_sections} none="Nothing missing" />
                      </li>
                    ))}
                  </ul>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

