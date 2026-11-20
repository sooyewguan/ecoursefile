import { ChartColumnIcon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TableEmpty, TableSkeleton } from '@/components/page'
import { OfferingStatusBadge } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { ExportFormat } from '../report-export.ts'
import { OFFERING_COLUMNS, type ReportTable } from '../report-tables.ts'
import { fetchReport, formatPercent, type OfferingRow, type ReportRpc } from '../reports.ts'
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

/** Every row of a report RPC for the semester: null while they load, or the error message. */
export function useReport<Row>(rpc: ReportRpc, semesterId: string) {
  const [result, setResult] = useState<{ key: string; rows?: Row[]; error?: string } | null>(null)
  const key = `${rpc} ${semesterId}`
  useEffect(() => {
    let current = true
    fetchReport<Row>(supabase, rpc, semesterId).then(
      (rows) => current && setResult({ key, rows }),
      (error: Error) => current && setResult({ key, error: error.message }),
    )
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

/**
 * Saves the view's rows on screen as an .xlsx or .csv file, named after the view and the semester.
 * It is disabled until the rows and the semester's code have loaded, and while no row shows. The
 * export code loads on the first export, as its own chunk.
 */
export function ExportMenu<Row>({ table, rows, semesterCode }: { table: ReportTable<Row>; rows: Row[] | null; semesterCode: string | null }) {
  const [error, setError] = useState<string | null>(null)
  async function save(format: ExportFormat) {
    setError(null)
    try {
      const { exportReport } = await import('../report-export.ts')
      const file = await exportReport(table, rows!, semesterCode!, format)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(file)
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The file could not be made.')
    }
  }
  return (
    <div className="flex items-center justify-end gap-3">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label={`Export ${table.view.toLowerCase()}`} disabled={!rows?.length || !semesterCode}>
            <DownloadIcon />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void save('xlsx')}>
            <FileSpreadsheetIcon />
            Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void save('csv')}>
            <FileTextIcon />
            CSV (.csv)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Below sm the status and completeness, below md the department and coordinator, and below lg the
 * missing sections and last upload, move into the course cell.
 */
const SMALL = 'hidden sm:table-cell'
const MEDIUM = 'hidden md:table-cell'
const LARGE = 'hidden lg:table-cell'
const OFFERING_SKELETON = ['', MEDIUM, MEDIUM, SMALL, SMALL, LARGE, LARGE]

/**
 * The offering list: each offering with its coordinator, status, completeness, missing sections and
 * last upload. Its headers and values are OFFERING_COLUMNS, which its export writes, with the
 * course's code and title in one cell, and the department's code and name in another.
 */
export function OfferingsTable({ rows, emptyDescription }: { rows: OfferingRow[] | null; emptyDescription: string }) {
  const column = OFFERING_COLUMNS
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-label="Offerings">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4">{column.courseCode.header}</TableHead>
            <TableHead className={cn('px-4', MEDIUM)}>{column.departmentCode.header}</TableHead>
            <TableHead className={cn('px-4', MEDIUM)}>{column.coordinator.header}</TableHead>
            <TableHead className={cn('px-4', SMALL)}>{column.status.header}</TableHead>
            <TableHead className={cn('px-4 text-right', SMALL)}>{column.complete.header}</TableHead>
            <TableHead className={cn('px-4', LARGE)}>{column.missingSections.header}</TableHead>
            <TableHead className={cn('px-4', LARGE)}>{column.lastUpload.header}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!rows ? (
            <TableSkeleton columns={OFFERING_SKELETON} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={7} icon={ChartColumnIcon} title="No offerings" description={emptyDescription} />
          ) : (
            rows.map((row) => (
              <TableRow key={row.offering_id}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <div className="grid gap-0.5">
                    <Link to={`/course-files/${row.offering_id}`} className="font-medium hover:underline">
                      {column.courseCode.value(row)}
                    </Link>
                    <span>{column.courseTitle.value(row)}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
                      <OfferingStatusBadge status={row.status} />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatPercent(column.complete.value(row))} {column.complete.header.toLowerCase()}
                      </span>
                    </div>
                    <span className="text-muted-foreground mt-1 text-xs md:hidden">
                      {column.departmentCode.value(row)} · {column.coordinator.value(row)}
                    </span>
                    <div className="mt-1 grid gap-1 text-xs lg:hidden">
                      <SectionNumbers sections={row.missing_sections} none="Nothing missing" />
                      <span className="text-muted-foreground">
                        {column.lastUpload.header} {formatDate(column.lastUpload.value(row))}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', MEDIUM)}>
                  {column.departmentCode.value(row)} {column.departmentName.value(row)}
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', MEDIUM)}>{column.coordinator.value(row)}</TableCell>
                <TableCell className={cn('px-4 py-3 align-top', SMALL)}>
                  <OfferingStatusBadge status={row.status} />
                </TableCell>
                <TableCell className={cn('px-4 py-3 text-right align-top tabular-nums', SMALL)}>{formatPercent(column.complete.value(row))}</TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', LARGE)}>
                  <SectionNumbers sections={row.missing_sections} none="None" />
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top', LARGE)}>{formatDate(column.lastUpload.value(row))}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
