import { FolderOpenIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { EmptyState, LoadError, PageHeader, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Pager, usePagedList } from '@/components/paged-list'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import { containsFilter } from '../paging.ts'
import { supabase } from '../supabase.ts'

/** An offering as report_offerings gives it, with how far its course file has got. */
type Offering = {
  offering_id: string
  course_code: string
  course_title: string
  department_code: string
  department_name: string
  coordinator_id: string
  counted_sections: number
  uploaded_sections: number
  needs_fix_sections: number
}

/** Below md the department moves into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: course, department and progress. */
const COLUMNS = ['', WIDE, 'w-28']

/** How many semesters the picker shows for a search. */
const PICKER_LIMIT = 20

/**
 * The semesters with offerings that the user reads, newest first, whose code has the query. RLS
 * decides which offerings the user reads.
 */
function semestersWithOfferings(query = '') {
  let request = supabase.from('semesters').select('id, code, offerings!inner(id)').limit(1, { referencedTable: 'offerings' })
  const filter = containsFilter(['code'], query)
  if (filter) request = request.or(filter)
  return request.order('start_year', { ascending: false }).order('number', { ascending: false })
}

async function searchSemesters(query: string): Promise<ComboboxOption[]> {
  const { data, error } = await semestersWithOfferings(query).limit(PICKER_LIMIT)
  if (error) throw error
  return data.map((semester) => ({ value: semester.id, label: semester.code }))
}

/**
 * The course files that the user reads in one semester, a page at a time, searched by course code
 * or title, each with how many of its sections are uploaded and how many need a fix, counted as
 * the reports count them. The semester is the one in ?semester=, else the latest the user has.
 */
export function CourseFiles() {
  const [searchParams, setSearchParams] = useSearchParams()
  const semesterId = searchParams.get('semester')
  /** The semester shown: undefined while it loads, and null when the user reads no offering at all. */
  const [semester, setSemester] = useState<ComboboxOption | null | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    const request = semesterId ? supabase.from('semesters').select('id, code').eq('id', semesterId) : semestersWithOfferings().limit(1)
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
  }, [semesterId, setSearchParams, attempt])

  return (
    <div className="grid gap-6">
      <PageHeader title="Course files" />
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

/** The semester's offerings, with the semester picker beside the search, or placeholder rows until the semester is known. */
function OfferingsTable({ semester, picker }: { semester: ComboboxOption | undefined; picker: ReactNode }) {
  const state = useAuth()
  const userId = state.kind === 'ready' ? state.profile.id : null
  const offerings = usePagedList<Offering>((range, search) => {
    // Until the semester is known the table waits, and the page mounts it again with the semester.
    if (!semester) return new Promise<never>(() => {})
    let query = supabase.rpc('report_offerings', { semester_id: semester.value }, { count: 'exact' })
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

      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label={semester ? `Course files of ${semester.label}` : 'Course files'}>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Course</TableHead>
              <TableHead className={cn('w-2/5 px-4', WIDE)}>Department</TableHead>
              <TableHead className="w-28 px-4 text-right">Uploaded</TableHead>
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
                          <Link to={`/course-files/${offering.offering_id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                            {offering.course_code}
                          </Link>
                          {offering.coordinator_id === userId && <Badge variant="secondary">Coordinator</Badge>}
                        </div>
                        <span>{offering.course_title}</span>
                        <span className="text-muted-foreground mt-1 text-xs md:hidden">{department}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{department}</TableCell>
                    <TableCell className="px-4 py-3 text-right align-top">
                      <div className="grid justify-items-end gap-1">
                        <span className="tabular-nums">
                          {offering.uploaded_sections}/{offering.counted_sections}
                        </span>
                        {offering.needs_fix_sections > 0 && (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                            {offering.needs_fix_sections} need{offering.needs_fix_sections === 1 ? 's' : ''} fix
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        {offerings.total !== null && <Pager page={offerings.page} total={offerings.total} onPageChange={offerings.setPage} />}
      </Card>
    </>
  )
}
