import {
  ArrowRightIcon,
  ChartColumnIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClipboardCheckIcon,
  FolderOpenIcon,
  UploadIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { openPages } from '@/components/app-shell'
import { EmptyState, LoadError, useDocumentTitle } from '@/components/page'
import { loadOfferings } from '@/components/reports'
import { OfferingStatusBadge } from '@/components/section-status'
import { TimetableMissing } from '@/components/timetable-missing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, plural } from '@/lib/utils'
import { canOpen } from '../auth.ts'
import { useAuth } from '../auth-provider.tsx'
import { fetchReport, formatPercent, type DepartmentRow, type FacultySummary, type OfferingRow } from '../reports.ts'
import { supabase } from '../supabase.ts'
import { isTimetableMissing, loadTaught } from '../teaching.ts'

type Semester = { id: string; code: string }

/** The user's own course files in the newest semester in which they teach, and whether their timetable for it is missing. */
type StaffOverview = { semester: Semester; offerings: OfferingRow[]; timetableMissing: boolean }

/** The faculty in the newest semester with offerings: its summary, its departments and its offerings. */
type FacultyOverview = { semester: Semester; summary: FacultySummary; departments: DepartmentRow[]; offerings: OfferingRow[] }

/** What a loader gave: null while it loads, then its data, which is null when there is nothing to show, or failed. */
type Loaded<Data> = { data: Data | null } | 'failed' | null

/** What load gives, with retry to load it again. load keeps its identity from one render to the next. */
function useLoaded<Data>(load: () => Promise<Data | null>) {
  const [loaded, setLoaded] = useState<{ attempt: number; result: Loaded<Data> }>({ attempt: 0, result: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    load().then(
      (data) => current && setLoaded({ attempt, result: { data } }),
      () => current && setLoaded({ attempt, result: 'failed' }),
    )
    return () => {
      current = false
    }
  }, [load, attempt])
  return { result: loaded.attempt === attempt ? loaded.result : null, retry: () => setAttempt((count) => count + 1) }
}

async function loadStaff(userId: string): Promise<StaffOverview | null> {
  const taught = await loadTaught(userId)
  const newest = taught.semesters[0]
  if (!newest) return null
  const [offerings, timetableMissing] = await Promise.all([loadOfferings(newest.id), isTimetableMissing(newest.id, userId)])
  return { semester: { id: newest.id, code: newest.code }, offerings: offerings.filter((row) => taught.offeringIds.has(row.offering_id)), timetableMissing }
}

async function loadFaculty(): Promise<FacultyOverview | null> {
  const { data, error } = await supabase
    .from('semesters')
    .select('id, code, offerings!inner(id)')
    .order('start_year', { ascending: false })
    .order('number', { ascending: false })
    .limit(1)
    .limit(1, { referencedTable: 'offerings' })
  if (error) throw error
  const semester: Semester | undefined = data[0] && { id: data[0].id, code: data[0].code }
  if (!semester) return null
  const [[summary], departments, offerings] = await Promise.all([
    fetchReport<FacultySummary>(supabase, 'report_faculty_summary', semester.id),
    fetchReport<DepartmentRow>(supabase, 'report_departments', semester.id),
    loadOfferings(semester.id),
  ])
  return { semester, summary, departments, offerings }
}

/**
 * The dashboard. Management, auditors and the admin see the faculty in the newest semester with
 * offerings, and lecturers their own course files in the newest semester they teach. A user who
 * holds both kinds of role sees both. A user with one page goes straight to it.
 */
export function Home() {
  const state = useAuth()
  useDocumentTitle('Home')
  if (state.kind !== 'ready') return null
  const pages = openPages(state.roles)
  if (pages.length === 1) return <Navigate to={pages[0].path} replace />

  return (
    <div className="grid gap-10">
      <header className="grid gap-1">
        <p className="text-muted-foreground text-sm">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' }).format(new Date())}</p>
        <h1 className="text-2xl/8 font-semibold tracking-tight">Welcome back, {state.profile.displayName}</h1>
      </header>
      {canOpen(state.roles, '/reports') && <FacultySection />}
      {state.roles.includes('lecturer') && <StaffSection userId={state.profile.id} />}
    </div>
  )
}

/** A dashboard section's heading, with the semester it covers and a link to the page with the detail. */
function SectionHeading({ id, title, semester, link }: { id: string; title: string; semester?: Semester; link?: { to: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {semester && (
        <Badge variant="secondary" className="tabular-nums">
          {semester.code}
        </Badge>
      )}
      {link && (
        <Button asChild variant="link" size="sm" className="ml-auto px-0">
          <Link to={link.to}>
            {link.label}
            <ArrowRightIcon />
          </Link>
        </Button>
      )}
    </div>
  )
}

/** One headline number: what it counts, the number, and a line under it. */
type Stat = { label: string; value: ReactNode; detail?: ReactNode; icon: LucideIcon; tone: string }

function StatTiles({ stats }: { stats: Stat[] | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {(stats ?? Array.from({ length: 4 }, () => null)).map((stat, index) => (
        <Card key={stat?.label ?? index} className="gap-3 px-4 py-4 sm:px-5 sm:py-5">
          {stat ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm font-medium">{stat.label}</p>
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg max-sm:hidden', stat.tone)}>
                  <stat.icon aria-hidden="true" className="size-4" />
                </span>
              </div>
              <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{stat.value}</p>
              {stat.detail && <p className="text-muted-foreground text-xs sm:text-sm">{stat.detail}</p>}
            </>
          ) : (
            <>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-28" />
            </>
          )}
        </Card>
      ))}
    </div>
  )
}

/** The sections that count, as a row of a report gives them. */
type SectionCounts = Pick<OfferingRow, 'counted_sections' | 'uploaded_sections' | 'verified_sections' | 'needs_fix_sections'>

/** The parts of the sections that count, in bar order: Verified, Pending review, Needs fix, and Missing as the rest of the bar. */
const PARTS: { label: string; className: string; count: (row: SectionCounts) => number }[] = [
  { label: 'Verified', className: 'bg-success', count: (row) => row.verified_sections },
  { label: 'Pending review', className: 'bg-info', count: (row) => row.uploaded_sections - row.verified_sections - row.needs_fix_sections },
  { label: 'Needs fix', className: 'bg-warning', count: (row) => row.needs_fix_sections },
  { label: 'Missing', className: 'bg-muted-foreground/20', count: (row) => row.counted_sections - row.uploaded_sections },
]

type Part = { label: string; value: number; className: string }

function sectionParts(row: SectionCounts): Part[] {
  return PARTS.map(({ label, className, count }) => ({ label, className, value: count(row) }))
}

/** A thin bar split into parts by share of the total. A part of zero draws nothing. Its name gives every part's count. */
function SegmentedBar({ parts, className }: { parts: Part[]; className?: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <div
      role="img"
      aria-label={parts.map((part) => `${part.label} ${part.value}`).join(', ') + ` of ${plural(total, 'section')}`}
      className={cn('flex h-2 w-full gap-0.5', className)}
    >
      {total === 0 ? (
        <span className="bg-muted-foreground/20 h-full flex-1 rounded-full" />
      ) : (
        parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.label}
              title={`${part.label}: ${part.value} of ${total}`}
              className={cn('h-full min-w-1 rounded-full', part.className)}
              style={{ flexGrow: part.value, flexBasis: 0 }}
            />
          ))
      )}
    </div>
  )
}

function PartsLegend() {
  return (
    <ul aria-label="Legend" className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {PARTS.map((part) => (
        <li key={part.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-2 rounded-full', part.className)} />
          {part.label}
        </li>
      ))}
    </ul>
  )
}

/** A failed load, or nothing to show, as a card in place of a section's body. */
function SectionCard({ children }: { children: ReactNode }) {
  return <Card className="py-0">{children}</Card>
}

function FacultySection() {
  const { result, retry } = useLoaded(loadFaculty)
  const data = result && result !== 'failed' ? result.data : null
  const summary = data?.summary
  return (
    <section aria-labelledby="faculty-heading" className="grid gap-4">
      <SectionHeading
        id="faculty-heading"
        title="Faculty overview"
        semester={data?.semester}
        link={data ? { to: `/reports?semester=${data.semester.id}`, label: 'Open reports' } : undefined}
      />
      {result === 'failed' ? (
        <SectionCard>
          <LoadError title="Couldn't load the faculty overview" onRetry={retry} />
        </SectionCard>
      ) : result?.data === null ? (
        <SectionCard>
          <EmptyState icon={ChartColumnIcon} title="No offerings yet" />
        </SectionCard>
      ) : (
        <>
          <StatTiles
            stats={
              summary
                ? [
                    { label: 'Offerings', value: summary.offerings, detail: plural(summary.counted_sections, 'section') + ' that count', icon: FolderOpenIcon, tone: 'bg-primary/10 text-primary' },
                    { label: 'Uploaded', value: formatPercent(summary.percent_uploaded), detail: `${summary.uploaded_sections} of ${summary.counted_sections} sections`, icon: UploadIcon, tone: 'bg-info/10 text-info' },
                    { label: 'Verified', value: formatPercent(summary.percent_verified), detail: `${summary.verified_sections} of ${summary.counted_sections} sections`, icon: CircleCheckIcon, tone: 'bg-success/10 text-success' },
                    { label: 'Needs fix', value: formatPercent(summary.percent_needs_fix), detail: `${summary.needs_fix_sections} of ${summary.counted_sections} sections`, icon: WrenchIcon, tone: 'bg-warning/10 text-warning' },
                  ]
                : null
            }
          />
          <div className="grid gap-4 lg:grid-cols-5">
            <DepartmentsCard data={data} />
            <LeastCompleteCard data={data} />
          </div>
        </>
      )}
    </section>
  )
}

function DepartmentsCard({ data }: { data: FacultyOverview | null }) {
  return (
    <Card className="min-w-0 gap-5 lg:col-span-3">
      <CardHeader>
        <CardTitle>By department</CardTitle>
        <CardDescription>Sections that count, by their status</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <PartsLegend />
        <ul aria-label="Departments" className="grid gap-4">
          {!data
            ? [0, 1, 2].map((key) => (
                <li key={key} aria-hidden="true" className="grid gap-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-2 w-full" />
                </li>
              ))
            : data.departments.map((row) => (
                <li key={row.department_id} className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <Link
                      to={`/reports?semester=${data.semester.id}&tab=offerings&department=${row.department_id}`}
                      className="min-w-0 hover:underline sm:truncate"
                      title={row.department_name}
                    >
                      <span className="font-medium">{row.department_code}</span> <span className="text-muted-foreground">{row.department_name}</span>
                    </Link>
                    <span className="shrink-0 tabular-nums">
                      {formatPercent(row.percent_uploaded)} <span className="text-muted-foreground">uploaded</span>
                    </span>
                  </div>
                  <SegmentedBar parts={sectionParts(row)} />
                </li>
              ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** The offerings with the most left to upload, least complete first. */
function LeastCompleteCard({ data }: { data: FacultyOverview | null }) {
  const rows = data?.offerings.filter((row) => row.status === 'incomplete').toSorted((a, b) => a.percent_complete - b.percent_complete).slice(0, 5)
  return (
    <Card className="min-w-0 gap-4 lg:col-span-2">
      <CardHeader>
        <CardTitle>Least complete</CardTitle>
        <CardDescription>Offerings with sections missing</CardDescription>
        {data && (
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/reports?semester=${data.semester.id}&tab=offerings&status=incomplete`}>See all</Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-3 sm:px-3">
        {rows?.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
            <CircleCheckIcon aria-hidden="true" className="text-success size-4" />
            Every offering has its sections uploaded.
          </p>
        ) : (
          <ul aria-label="Least complete offerings" className="grid">
            {(rows ?? [null, null, null]).map((row, index) =>
              row ? (
                <li key={row.offering_id}>
                  <Link to={`/course-files/${row.offering_id}`} className="hover:bg-accent grid grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg px-3 py-2.5 transition-colors">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{row.course_code}</span> <span className="text-muted-foreground">{row.course_title}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{formatPercent(row.percent_complete)}</span>
                    </span>
                    <SegmentedBar parts={sectionParts(row)} className="h-1.5" />
                  </Link>
                </li>
              ) : (
                <li key={index} aria-hidden="true" className="grid gap-2 px-3 py-2.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-1.5 w-full" />
                </li>
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function StaffSection({ userId }: { userId: string }) {
  const load = useCallback(() => loadStaff(userId), [userId])
  const { result, retry } = useLoaded(load)
  const data = result && result !== 'failed' ? result.data : null
  const rows = data?.offerings
  const sum = (count: (row: OfferingRow) => number) => rows?.reduce((total, row) => total + count(row), 0) ?? 0
  const counted = sum((row) => row.counted_sections)
  const uploaded = sum((row) => row.uploaded_sections)
  return (
    <section aria-labelledby="staff-heading" className="grid gap-4">
      <SectionHeading
        id="staff-heading"
        title="Your course files"
        semester={data?.semester}
        link={data ? { to: `/completeness?semester=${data.semester.id}`, label: 'My completeness' } : undefined}
      />
      {result === 'failed' ? (
        <SectionCard>
          <LoadError title="Couldn't load your course files" onRetry={retry} />
        </SectionCard>
      ) : result?.data === null ? (
        <SectionCard>
          <EmptyState icon={ClipboardCheckIcon} title="No course files yet" />
        </SectionCard>
      ) : (
        <>
          {data?.timetableMissing && rows && rows.length > 0 && <TimetableMissing semesterCode={data.semester.code} offeringId={rows[0].offering_id} />}
          <StatTiles
            stats={
              rows
                ? [
                    { label: 'Course files', value: rows.length, detail: `${rows.filter((row) => row.coordinator_id === userId).length} you coordinate`, icon: FolderOpenIcon, tone: 'bg-primary/10 text-primary' },
                    { label: 'Uploaded', value: formatPercent(counted ? Math.round((uploaded / counted) * 1000) / 10 : null), detail: `${uploaded} of ${counted} sections`, icon: UploadIcon, tone: 'bg-info/10 text-info' },
                    { label: 'Missing', value: sum((row) => row.missing_sections.length), detail: 'sections to upload', icon: CircleDashedIcon, tone: 'bg-destructive/10 text-destructive' },
                    { label: 'Needs fix', value: sum((row) => row.needs_fix_sections), detail: 'sections sent back', icon: WrenchIcon, tone: 'bg-warning/10 text-warning' },
                  ]
                : null
            }
          />
          <Card className="gap-0 py-0">
            <ul aria-label="Your course files" className="divide-y">
              {(rows ?? [null, null]).map((row, index) =>
                row ? (
                  <li key={row.offering_id}>
                    <Link
                      to={`/course-files/${row.offering_id}`}
                      className="hover:bg-muted/40 grid gap-3 px-4 py-4 transition-colors first:rounded-t-xl last:rounded-b-xl sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] sm:items-center sm:gap-6 sm:px-6"
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{row.course_code}</span>
                          {row.coordinator_id === userId && <Badge variant="secondary">Coordinator</Badge>}
                        </span>
                        <span className="text-muted-foreground text-sm">{row.course_title}</span>
                      </span>
                      <span className="grid gap-1.5">
                        <span className="flex items-baseline justify-between text-sm">
                          <span className="font-medium tabular-nums">{formatPercent(row.percent_complete)}</span>
                          <span className="text-muted-foreground text-xs">
                            {row.missing_sections.length === 0 ? 'None missing' : `${row.missing_sections.length} missing`}
                          </span>
                        </span>
                        <SegmentedBar parts={sectionParts(row)} />
                      </span>
                      <span className="flex items-center gap-2 sm:justify-end">
                        <OfferingStatusBadge status={row.status} />
                        <ArrowRightIcon aria-hidden="true" className="text-muted-foreground size-4 max-sm:hidden" />
                      </span>
                    </Link>
                  </li>
                ) : (
                  <li key={index} aria-hidden="true" className="grid gap-3 px-4 py-4 sm:px-6">
                    <Skeleton className="h-5 w-full max-w-64" />
                    <Skeleton className="h-2 w-full max-w-80" />
                  </li>
                ),
              )}
            </ul>
          </Card>
        </>
      )}
    </section>
  )
}
