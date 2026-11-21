import { FolderOpenIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, LoadError, PageHeader, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import { supabase } from '../supabase.ts'

type Semester = { id: string; code: string; start_year: number; number: number }

type Offering = {
  id: string
  coordinator_id: string
  semester: Semester
  course: { code: string; title: string; department: { code: string; name: string } }
}

/** One semester's offerings, sorted by course code. */
type SemesterGroup = { semester: Semester; offerings: Offering[] }

/** Below md the department moves into the course cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: course and department. */
const COLUMNS = ['', WIDE]

/** The offerings the signed-in user may read, grouped by semester, newest first. RLS decides which. */
export function CourseFiles() {
  const state = useAuth()
  const [groups, setGroups] = useState<SemesterGroup[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('offerings')
      .select(
        'id, coordinator_id, semester:semesters(id, code, start_year, number), course:courses(code, title, department:departments(code, name))',
      )
      .overrideTypes<Offering[], { merge: false }>()
    setLoadFailed(error !== null)
    if (data) setGroups(groupBySemester(data))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (state.kind !== 'ready') return null

  return (
    <div className="grid gap-6">
      <PageHeader title="Course files" />

      {loadFailed ? (
        <Card className="py-0">
          <LoadError title="Couldn't load course files" onRetry={load} />
        </Card>
      ) : !groups ? (
        <OfferingsTable title="Loading" offerings={null} userId={state.profile.id} />
      ) : groups.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={FolderOpenIcon} title="No course files yet" />
        </Card>
      ) : (
        groups.map((group) => (
          <OfferingsTable
            key={group.semester.id}
            title={group.semester.code}
            offerings={group.offerings}
            userId={state.profile.id}
          />
        ))
      )}
    </div>
  )
}

function groupBySemester(offerings: Offering[]): SemesterGroup[] {
  const groups = new Map<string, SemesterGroup>()
  for (const offering of offerings) {
    const group = groups.get(offering.semester.id) ?? { semester: offering.semester, offerings: [] }
    group.offerings.push(offering)
    groups.set(offering.semester.id, group)
  }
  return [...groups.values()]
    .toSorted((a, b) => b.semester.start_year - a.semester.start_year || b.semester.number - a.semester.number)
    .map((group) => ({ ...group, offerings: group.offerings.toSorted((a, b) => a.course.code.localeCompare(b.course.code)) }))
}

/** One semester's offerings, or placeholder rows while they load. */
function OfferingsTable({ title, offerings, userId }: { title: string; offerings: Offering[] | null; userId: string }) {
  return (
    <section aria-label={offerings ? `Semester ${title}` : 'Loading course files'} className="grid gap-3">
      {offerings && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Course</TableHead>
              <TableHead className={cn('w-2/5 px-4', WIDE)}>Department</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!offerings ? (
              <TableSkeleton columns={COLUMNS} />
            ) : (
              offerings.map((offering) => {
                const department = `${offering.course.department.code} ${offering.course.department.name}`
                return (
                  <TableRow key={offering.id} className="relative">
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="grid gap-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/course-files/${offering.id}`}
                            className="font-medium after:absolute after:inset-0 hover:underline"
                          >
                            {offering.course.code}
                          </Link>
                          {offering.coordinator_id === userId && <Badge variant="secondary">Coordinator</Badge>}
                        </div>
                        <span>{offering.course.title}</span>
                        <span className="text-muted-foreground mt-1 text-xs md:hidden">{department}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{department}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}
