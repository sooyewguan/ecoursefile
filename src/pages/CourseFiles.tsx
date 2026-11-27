import { FolderOpenIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { useCourseFileView } from '@/components/course-file-view'
import { EmptyState, LoadError, PageHeader, TableCard, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Pager, usePagedList } from '@/components/paged-list'
import { SectionBar } from '@/components/section-bar'
import { OfferingStatusBadge } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import type { CourseFileView } from '../course-file-views.ts'
import { containsFilter } from '../paging.ts'
import { formatPercent, type OfferingRow } from '../reports.ts'
import { supabase } from '../supabase.ts'

/** An offering as report_offerings gives it, with how far its course file has got. */
type Offering = Pick<
  OfferingRow,
  | 'offering_id'
  | 'course_code'
  | 'course_title'
  | 'department_code'
  | 'department_name'
  | 'coordinator_id'
  | 'status'
  | 'percent_complete'
  | 'missing_sections'
  | 'counted_sections'
  | 'uploaded_sections'
  | 'verified_sections'
  | 'needs_fix_sections'
>

/** Below md the department, and below sm the status, move into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'
const STATUS = 'hidden sm:table-cell'

/** The table's columns: course, department, status and progress. */
const COLUMNS = ['', WIDE, STATUS, '']

/** How many semesters the picker shows for a search. */
const PICKER_LIMIT = 20

/** Each view's page title, and what the user does there. */
const HEADINGS: Record<CourseFileView, { title: string; description?: string }> = {
  lecturer: { title: 'My course files', description: 'The course files you teach or coordinate. Open one to upload its files and answer audit requests.' },
  auditor: { title: 'Audit course files', description: 'Every course file. Open one to check its files, mark its sections and send audit requests.' },
  reader: { title: 'Course files' },
}

/**
 * The semesters with offerings that the user reads, newest first, whose code has the query. RLS
 * decides which offerings the user reads. With a lecturerId, only the offerings that lecturer
 * teaches or coordinates count.
 */
function semestersWithOfferings(lecturerId: string | null, query = '') {
  let request = lecturerId
    ? supabase
        .from('semesters')
        .select('id, code, offerings!inner(id, offering_lecturers!offering_lecturers_offering_id_fkey!inner(lecturer_id))')
        .eq('offerings.offering_lecturers.lecturer_id', lecturerId)
    : supabase.from('semesters').select('id, code, offerings!inner(id)')
  request = request.limit(1, { referencedTable: 'offerings' })
  const filter = containsFilter(['code'], query)
  if (filter) request = request.or(filter)
  return request.order('start_year', { ascending: false }).order('number', { ascending: false })
}

/** The ids of the offerings of the semester that the lecturer teaches or coordinates. */
async function taughtOfferingIds(lecturerId: string, semesterId: string) {
  const { data, error } = await supabase
    .from('offering_lecturers')
    .select('offering_id, offering:offerings!offering_lecturers_offering_id_fkey!inner(semester_id)')
    .eq('lecturer_id', lecturerId)
    .eq('offering.semester_id', semesterId)
  if (error) throw error
  return data.map((row) => row.offering_id as string)
}

/**
 * The view's course files in one semester, a page at a time, searched by course code or title,
 * each with how many of its sections are uploaded and how many need a fix, counted as the reports
 * count them. The lecturer view lists the course files the user teaches or coordinates, and the
 * other views every course file the user reads. The semester is the one in ?semester=, else the
 * latest the view has.
 */
export function CourseFiles() {
  const { view } = useCourseFileView()
  const state = useAuth()
  /** The lecturer whose course files the lecturer view lists, or null in another view. */
  const lecturerId = view === 'lecturer' && state.kind === 'ready' ? state.profile.id : null
  const [searchParams, setSearchParams] = useSearchParams()
  const semesterId = searchParams.get('semester')
  /** The semester shown: undefined while it loads, and null when the user reads no offering at all. */
  const [semester, setSemester] = useState<ComboboxOption | null | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    const request = semesterId ? supabase.from('semesters').select('id, code').eq('id', semesterId) : semestersWithOfferings(lecturerId).limit(1)
    request.then(({ data, error }) => {
      if (!current) return
      setLoadFailed(error !== null)
      if (error) return
      // A semester in the address that the user cannot see gives way to their latest.
      if (semesterId && data.length === 0) setSearchParams({}, { replace: true })
      else setSemester(data[0] ? { value: data[0].id, label: data[0].code } : null)
    })
    return () => {
      current = false
    }
  }, [semesterId, setSearchParams, attempt, lecturerId])

  async function searchSemesters(query: string): Promise<ComboboxOption[]> {
    const { data, error } = await semestersWithOfferings(lecturerId, query).limit(PICKER_LIMIT)
    if (error) throw error
    return data.map((semester) => ({ value: semester.id, label: semester.code }))
  }

  return (
    <div className="grid gap-6">
      <PageHeader {...HEADINGS[view]} />
      {loadFailed ? (
        <Card className="py-0">
          <LoadError title="Couldn't load course files" onRetry={() => setAttempt((count) => count + 1)} />
        </Card>
      ) : semester === null ? (
        <Card className="py-0">
          <EmptyState icon={FolderOpenIcon} title="No course files yet" />
        </Card>
      ) : (
        <OfferingsTable
          key={semester?.value ?? ''}
          semester={semester}
          lecturerId={lecturerId}
          picker={
            <div className="grid w-full gap-2 sm:w-56">
              <Label htmlFor="course-files-semester">Semester</Label>
              {semester ? (
                <Combobox
                  id="course-files-semester"
                  value={semester}
                  onChange={(picked) => {
                    setSemester(picked)
                    setSearchParams({ semester: picked.value }, { replace: true })
                  }}
                  search={searchSemesters}
                  placeholder="Choose a semester"
                  searchPlaceholder="Search semesters"
                />
              ) : (
                <Skeleton className="h-9 w-full" />
              )}
            </div>
          }
        />
      )}
    </div>
  )
}

/**
 * The semester's offerings, or only those the lecturer teaches or coordinates when there is a
 * lecturerId, with the semester picker beside the search, or placeholder rows until the semester is
 * known.
 */
function OfferingsTable({ semester, lecturerId, picker }: { semester: ComboboxOption | undefined; lecturerId: string | null; picker: ReactNode }) {
  const { path } = useCourseFileView()
  const offerings = usePagedList<Offering>(async (range, search) => {
    // Until the semester is known the table waits, and the page mounts it again with the semester.
    if (!semester) return new Promise<never>(() => {})
    let query = supabase.rpc('report_offerings', { semester_id: semester.value }, { count: 'exact' })
    if (lecturerId) query = query.in('offering_id', await taughtOfferingIds(lecturerId, semester.value))
    const filter = containsFilter(['course_code', 'course_title'], search)
    if (filter) query = query.or(filter)
    return query.order('course_code').range(range.from, range.to)
  })

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        {picker}
        <Input
          type="search"
          aria-label="Search course files"
          placeholder="Search by course code or title"
          className="w-full sm:max-w-sm"
          value={offerings.query}
          onChange={(event) => offerings.setQuery(event.target.value)}
        />
      </div>

      <TableCard>
        <Table aria-label={semester ? `Course files of ${semester.label}` : 'Course files'}>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Course</TableHead>
              <TableHead className={cn('w-1/3 px-4', WIDE)}>Department</TableHead>
              <TableHead className={cn('w-36 px-4', STATUS)}>Status</TableHead>
              <TableHead className="w-32 px-4 sm:w-48 lg:w-56">Complete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offerings.failed ? (
              <TableLoadError columns={COLUMNS.length} title="Couldn't load course files" onRetry={offerings.retry} />
            ) : !offerings.rows ? (
              <TableSkeleton columns={COLUMNS} />
            ) : offerings.rows.length === 0 ? (
              <TableEmpty columns={COLUMNS.length} icon={FolderOpenIcon} title={offerings.query ? 'No matching course files' : 'No course files yet'} />
            ) : (
              offerings.rows.map((offering) => {
                const department = `${offering.department_code} ${offering.department_name}`
                return (
                  <TableRow key={offering.offering_id} className="relative">
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="grid gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={path(offering.offering_id)} className="font-medium after:absolute after:inset-0 hover:underline">
                            {offering.course_code}
                          </Link>
                          {lecturerId && offering.coordinator_id === lecturerId && <Badge variant="secondary">Coordinator</Badge>}
                        </div>
                        <span className="text-muted-foreground text-sm">{offering.course_title}</span>
                        <span className="text-muted-foreground mt-1 text-xs md:hidden">{department}</span>
                        <div className="mt-1.5 sm:hidden">
                          <OfferingStatusBadge status={offering.status} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{department}</TableCell>
                    <TableCell className={cn('px-4 py-3', STATUS)}>
                      <OfferingStatusBadge status={offering.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 align-top sm:align-middle">
                      <div className="grid gap-1.5">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                          <span className="font-medium tabular-nums">{formatPercent(offering.percent_complete)}</span>
                          <span className="text-muted-foreground text-xs">
                            {offering.missing_sections.length === 0 ? 'None missing' : `${offering.missing_sections.length} missing`}
                          </span>
                        </span>
                        <SectionBar counts={offering} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        {offerings.total !== null && <Pager page={offerings.page} total={offerings.total} onPageChange={offerings.setPage} />}
      </TableCard>
    </>
  )
}
