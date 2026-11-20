import { ChartColumnIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TableEmpty, TableSkeleton } from '@/components/page'
import { OfferingStatusBadge } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { OfferingRow } from '../reports.ts'
import { SECTIONS } from '../sections.ts'
import { supabase } from '../supabase.ts'

type Semester = { id: string; code: string }

export function SemesterSelect({ semesters, value, onChange }: { semesters: Semester[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid w-full gap-2 sm:w-56">
      <Label htmlFor="report-semester">Semester</Label>
      <NativeSelect id="report-semester" value={value} onChange={(event) => onChange(event.target.value)}>
        {semesters.map((semester) => (
          <NativeSelectOption key={semester.id} value={semester.id}>
            {semester.code}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

type ReportRpc = 'report_faculty_summary' | 'report_departments' | 'report_offerings' | 'report_lecturers'

/** The rows of a report RPC for the semester: null while they load, or the error message. */
export function useReport<Row>(rpc: ReportRpc, semesterId: string) {
  const [result, setResult] = useState<{ key: string; rows?: Row[]; error?: string } | null>(null)
  const key = `${rpc} ${semesterId}`
  useEffect(() => {
    let current = true
    void supabase.rpc(rpc, { semester_id: semesterId }).then(({ data, error }) => {
      if (current) setResult(error ? { key, error: error.message } : { key, rows: data as Row[] })
    })
    return () => {
      current = false
    }
  }, [rpc, semesterId, key])
  return result?.key === key ? result : null
}

/** Section numbers as small badges, each named in full for screen readers and on hover. */
export function SectionNumbers({ sections, none }: { sections: number[]; none: string }) {
  if (sections.length === 0) return <span className="text-muted-foreground text-sm">{none}</span>
  return (
    <ul className="flex flex-wrap gap-1">
      {sections.map((section) => {
        const title = SECTIONS.find((s) => s.number === section)!.title
        return (
          <li key={section}>
            <Badge variant="outline" title={`${section} ${title}`} className="tabular-nums">
              {section}
              <span className="sr-only"> {title}</span>
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}

export function formatDate(timestamp: string | null) {
  return timestamp ? new Date(timestamp).toLocaleDateString() : 'Never'
}

/** Below md the department and coordinator, and below lg the missing sections and last upload, move into the course cell. */
const MEDIUM = 'hidden md:table-cell'
const LARGE = 'hidden lg:table-cell'
const OFFERING_COLUMNS = ['', MEDIUM, MEDIUM, '', '', LARGE, LARGE]

/** The offering list: each offering with its coordinator, status, completeness, missing sections and last upload. */
export function OfferingsTable({ rows, emptyDescription }: { rows: OfferingRow[] | null; emptyDescription: string }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-label="Offerings">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4">Course</TableHead>
            <TableHead className={cn('px-4', MEDIUM)}>Department</TableHead>
            <TableHead className={cn('px-4', MEDIUM)}>Coordinator</TableHead>
            <TableHead className="px-4">Status</TableHead>
            <TableHead className="px-4 text-right">Complete</TableHead>
            <TableHead className={cn('px-4', LARGE)}>Missing sections</TableHead>
            <TableHead className={cn('px-4', LARGE)}>Last upload</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!rows ? (
            <TableSkeleton columns={OFFERING_COLUMNS} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={7} icon={ChartColumnIcon} title="No offerings" description={emptyDescription} />
          ) : (
            rows.map((row) => (
              <TableRow key={row.offering_id}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <div className="grid gap-0.5">
                    <Link to={`/course-files/${row.offering_id}`} className="font-medium wrap-anywhere hover:underline">
                      {row.course_code}
                    </Link>
                    <span>{row.course_title}</span>
                    <span className="text-muted-foreground mt-1 text-xs md:hidden">
                      {row.department_code} · {row.coordinator_name}
                    </span>
                    <div className="mt-1 grid gap-1 text-xs lg:hidden">
                      <SectionNumbers sections={row.missing_sections} none="Nothing missing" />
                      <span className="text-muted-foreground">Last upload {formatDate(row.last_upload_at)}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', MEDIUM)}>
                  {row.department_code} {row.department_name}
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', MEDIUM)}>{row.coordinator_name}</TableCell>
                <TableCell className="px-4 py-3 align-top">
                  <OfferingStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="px-4 py-3 text-right align-top tabular-nums">{row.percent_complete}%</TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', LARGE)}>
                  <SectionNumbers sections={row.missing_sections} none="None" />
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top', LARGE)}>{formatDate(row.last_upload_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
