import { ArrowLeftIcon, FolderOpenIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ErrorAlert } from '@/components/notice'
import { PageHeader, TableEmpty, TableSkeleton } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SECTION_STATUS_LABELS, SECTIONS, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'

type Offering = {
  semester: { code: string }
  course: { code: string; title: string; department: { code: string; name: string } }
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; statuses: { section: number; status: SectionStatus }[] }

const STATUS_STYLES: Record<SectionStatus, string> = {
  missing: 'border-destructive/30 bg-destructive/10 text-destructive',
  empty: 'text-muted-foreground',
  off: 'text-muted-foreground border-dashed',
}

/** The table's columns: number, section and status. */
const COLUMNS = ['', '', '']

/** One offering's course file: its 19 sections in the fixed order, each with its status. */
export function CourseFile() {
  const { offeringId } = useParams()
  const [data, setData] = useState<PageData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      supabase
        .from('offerings')
        .select('semester:semesters(code), course:courses(code, title, department:departments(code, name))')
        .eq('id', offeringId!)
        .maybeSingle()
        .overrideTypes<Offering | null, { merge: false }>(),
      supabase.rpc('section_statuses', { offering_id: offeringId }),
    ]).then(([offering, statuses]) => {
      if (offering.error || statuses.error) setError((offering.error ?? statuses.error)!.message)
      else setData({ offering: offering.data, statuses: statuses.data })
    })
  }, [offeringId])

  const backLink = (
    <Button asChild variant="outline">
      <Link to="/course-files">
        <ArrowLeftIcon />
        All course files
      </Link>
    </Button>
  )

  if (error) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Course file" description="This course file could not be loaded." action={backLink} />
        <ErrorAlert>{error}</ErrorAlert>
      </div>
    )
  }

  if (data && !data.offering) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Course file" description="Course files you can open are listed on the Course files page." action={backLink} />
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableBody>
              <TableEmpty
                columns={1}
                icon={FolderOpenIcon}
                title="Course file not found"
                description="It does not exist, or you do not have access to it."
              />
            </TableBody>
          </Table>
        </Card>
      </div>
    )
  }

  const offering = data?.offering
  const sectionTitle = new Map<number, string>(SECTIONS.map((section) => [section.number, section.title]))

  return (
    <div className="grid gap-6">
      {offering ? (
        <PageHeader
          title={`${offering.course.code} ${offering.course.title}`}
          description={`${offering.semester.code} · ${offering.course.department.code} ${offering.course.department.name}`}
          action={backLink}
        />
      ) : (
        <div aria-hidden="true" className="grid gap-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-5 w-56 max-w-full" />
        </div>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Sections">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-12 px-4 text-right">#</TableHead>
              <TableHead className="px-4">Section</TableHead>
              <TableHead className="w-32 px-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              <TableSkeleton columns={COLUMNS} rows={19} />
            ) : (
              data.statuses.map(({ section, status }) => (
                <TableRow key={section}>
                  <TableCell className="text-muted-foreground px-4 py-3 text-right tabular-nums">{section}</TableCell>
                  <TableCell className="px-4 py-3 font-medium whitespace-normal">{sectionTitle.get(section)}</TableCell>
                  <TableCell className="px-4 py-3">
                    <Badge variant="outline" className={STATUS_STYLES[status]}>
                      {SECTION_STATUS_LABELS[status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
