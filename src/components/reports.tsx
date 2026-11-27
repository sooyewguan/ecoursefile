import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useOverviewPath } from '@/components/course-file-view'
import { LoadError, TableCard, TableSkeleton } from '@/components/page'
import { OfferingStatusBadge } from '@/components/section-status'
import { Time } from '@/components/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { ExportFormat } from '../report-export.ts'
import { needsFixSections, OFFERING_COLUMNS, type ReportTable } from '../report-tables.ts'
import { fetchReport, formatPercent, readAll, type OfferingRow } from '../reports.ts'
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

/**
 * The semesters in which the user reads an offering, newest first, null while they load. RLS decides
 * which offerings they read, so a lecturer gets the semesters they teach in. reload loads them again.
 */
export function useSemestersWithOfferings() {
  const [semesters, setSemesters] = useState<Semester[] | 'failed' | null>(null)
  const load = useCallback(async () => {
    try {
      const rows = await readAll<Semester>((from, to) =>
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
 * The semester that a report page shows: the URL's, when it is one of the semesters, else the
 * first, which is the newest. Null while the semesters load, and when there are none. A page whose
 * URL names another semester replaces it with this one, so that the URL, the select and the data agree.
 */
export function pickSemester(semesters: { id: string }[] | null, param: string | null) {
  if (!semesters) return null
  return semesters.some((semester) => semester.id === param) ? param : (semesters[0]?.id ?? null)
}

/**
 * What load gives for the semester: null while it loads, and while the semester is not known yet,
 * then the data, or failed when it did not load, with retry to load it again. load keeps its
 * identity from one render to the next.
 */
export function useReport<Data>(semesterId: string | null, load: (semesterId: string) => Promise<Data>) {
  const [result, setResult] = useState<{ key: string; data?: Data; failed?: true } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${semesterId} ${attempt}`
  const retry = useCallback(() => setAttempt((count) => count + 1), [])
  useEffect(() => {
    if (!semesterId) return
    let current = true
    load(semesterId).then(
      (data) => current && setResult({ key, data }),
      () => current && setResult({ key, failed: true }),
    )
    return () => {
      current = false
    }
  }, [semesterId, load, key])
  return semesterId && result?.key === key ? { ...result, retry } : null
}

/** The offering list of the semester, for the Offerings and Heatmap tabs and My completeness. */
export function loadOfferings(semesterId: string) {
  return fetchReport<OfferingRow>(supabase, 'report_offerings', semesterId)
}

/** A report view whose rows failed to load. */
export function ReportLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="py-0">
      <LoadError title="Couldn't load this report" onRetry={onRetry} />
    </Card>
  )
}

/**
 * An offering's missing sections and its sections marked Needs fix, each under its label as small
 * badges of their numbers, named in full for screen readers and on hover, and linked to the
 * section's page. None missing when there are neither.
 */
export function SectionNumbers({ offeringId, missing, needsFix }: { offeringId: string; missing: number[]; needsFix: number[] }) {
  if (missing.length === 0 && needsFix.length === 0) return <span className="text-muted-foreground">None missing</span>
  return (
    <div className="grid gap-1">
      <SectionBadges offeringId={offeringId} label="Missing" variant="outline" sections={missing} />
      <SectionBadges offeringId={offeringId} label="Needs fix" variant="secondary" sections={needsFix} />
    </div>
  )
}

function SectionBadges({ offeringId, label, variant, sections }: { offeringId: string; label: string; variant: 'outline' | 'secondary'; sections: number[] }) {
  const coursePath = useOverviewPath()
  if (sections.length === 0) return null
  return (
    <div className="flex items-baseline gap-2">
      <span aria-hidden="true" className="text-muted-foreground w-14 shrink-0 text-xs">
        {label}
      </span>
      <ul aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1">
        {sections.map((section) => {
          const title = SECTIONS.find((s) => s.number === section)!.title
          return (
            <li key={section}>
              <Badge asChild variant={variant} className="tabular-nums hover:underline pointer-coarse:h-7 pointer-coarse:min-w-7">
                <Link to={coursePath(offeringId, section)} title={`${section} ${title}`}>
                  {section}
                  <span className="sr-only"> {title}</span>
                </Link>
              </Badge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Saves the view's rows on screen as an .xlsx or .csv file, named after the view and the semester.
 * It is disabled until the rows and the semester's code have loaded, and while no row shows. The
 * export code loads on the first export, as its own chunk.
 */
export function ExportMenu<Row>({ table, rows, semesterCode }: { table: ReportTable<Row>; rows: Row[] | null; semesterCode: string | null }) {
  async function save(format: ExportFormat) {
    try {
      const { exportReport } = await import('../report-export.ts')
      const file = await exportReport(table, rows!, semesterCode!, format)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(file)
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
    } catch {
      toast.error("Couldn't export. Try again.")
    }
  }
  return (
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
          Excel
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void save('csv')}>
          <FileTextIcon />
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A person's email as a link that starts a message to them. Nothing without one, as for a lecturer, who reads no one's email. */
export function EmailLink({ email }: { email: string | null }) {
  if (!email) return null
  return (
    <a href={`mailto:${email}`} className="text-muted-foreground w-fit text-xs wrap-anywhere hover:underline">
      {email}
    </a>
  )
}

/** A skeleton bar at the end of its cell, for a column of numbers. */
export const NUMBER_SKELETON = '[&>*]:ml-auto'

/**
 * Below sm the status and completeness, below md the coordinator, below lg the department and the
 * missing sections, and below xl the last upload move into the course cell. Every column but the
 * course has a set width, so the columns keep their place when a filter changes the rows.
 */
const SMALL = 'hidden sm:table-cell'
const MEDIUM = 'hidden md:table-cell'
const LARGE = 'hidden lg:table-cell'
const XLARGE = 'hidden xl:table-cell'
const OFFERING_SKELETON = ['', LARGE, MEDIUM, SMALL, cn(SMALL, NUMBER_SKELETON), LARGE, XLARGE]

/**
 * The offering list: each offering with its department, coordinator, status, completeness, missing
 * and Needs fix sections, and last upload. Its headers and values are OFFERING_COLUMNS, which its
 * export writes, with the course's code and title in one cell, the department as its code, named on
 * hover, and the missing and Needs fix sections in one cell.
 */
export function OfferingsTable({ rows }: { rows: OfferingRow[] | null }) {
  const coursePath = useOverviewPath()
  const column = OFFERING_COLUMNS
  return (
    <TableCard>
      <Table aria-label="Offerings">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56 px-4">{column.courseTitle.header}</TableHead>
            <TableHead className={cn('w-28 px-4', LARGE)}>{column.departmentName.header}</TableHead>
            <TableHead className={cn('w-44 px-4', MEDIUM)}>{column.coordinator.header}</TableHead>
            <TableHead className={cn('w-36 px-4', SMALL)}>{column.status.header}</TableHead>
            <TableHead className={cn('w-24 px-4 text-right', SMALL)}>{column.complete.header}</TableHead>
            <TableHead className={cn('w-52 px-4', LARGE)}>Sections</TableHead>
            <TableHead className={cn('w-32 px-4', XLARGE)}>{column.lastUpload.header}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!rows ? (
            <TableSkeleton columns={OFFERING_SKELETON} />
          ) : (
            rows.map((row) => (
              <TableRow key={row.offering_id}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">
                  <div className="grid gap-0.5">
                    <Link to={coursePath(row.offering_id)} className="font-medium hover:underline">
                      {column.courseCode.value(row)}
                    </Link>
                    <span>{column.courseTitle.value(row)}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
                      <OfferingStatusBadge status={row.status} />
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatPercent(column.complete.value(row))} {column.complete.header.toLowerCase()}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs lg:hidden">
                      <span title={column.departmentName.value(row) ?? undefined}>{column.departmentCode.value(row)}</span>
                      <span className="md:hidden"> · {column.coordinator.value(row)}</span>
                    </p>
                    <div className="grid md:hidden">
                      <EmailLink email={column.coordinatorEmail.value(row)} />
                    </div>
                    <div className="mt-1 text-xs lg:hidden">
                      <SectionNumbers offeringId={row.offering_id} missing={row.missing_sections} needsFix={needsFixSections(row)} />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs xl:hidden">
                      {row.last_upload_at ? (
                        <>
                          {column.lastUpload.header} <Time value={row.last_upload_at} dateOnly />
                        </>
                      ) : (
                        'No uploads yet'
                      )}
                    </p>
                  </div>
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', LARGE)}>
                  <span title={column.departmentName.value(row) ?? undefined}>{column.departmentCode.value(row)}</span>
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', MEDIUM)}>
                  <div className="grid gap-0.5">
                    {column.coordinator.value(row)}
                    <EmailLink email={column.coordinatorEmail.value(row)} />
                  </div>
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top', SMALL)}>
                  <OfferingStatusBadge status={row.status} />
                </TableCell>
                <TableCell className={cn('px-4 py-3 text-right align-top tabular-nums', SMALL)}>{formatPercent(column.complete.value(row))}</TableCell>
                <TableCell className={cn('px-4 py-3 align-top whitespace-normal', LARGE)}>
                  <SectionNumbers offeringId={row.offering_id} missing={row.missing_sections} needsFix={needsFixSections(row)} />
                </TableCell>
                <TableCell className={cn('px-4 py-3 align-top', XLARGE)}>
                  {row.last_upload_at ? <Time value={row.last_upload_at} dateOnly /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableCard>
  )
}
