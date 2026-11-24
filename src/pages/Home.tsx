import {
  ArrowRightIcon,
  ChartColumnIcon,
  CircleCheckBigIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClipboardCheckIcon,
  FolderOpenIcon,
  UploadIcon,
  WrenchIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { openPages } from '@/components/app-shell'
import { EmptyState, LoadError, useDocumentTitle } from '@/components/page'
import { loadOfferings, pickSemester, SemesterSelect, useSemestersWithOfferings } from '@/components/reports'
import { SectionBar, SectionBarLegend } from '@/components/section-bar'
import { OfferingStatusBadge } from '@/components/section-status'
import { FacultyStatTiles, StatTiles } from '@/components/stat-tiles'
import { Time } from '@/components/time'
import { TimetableMissing } from '@/components/timetable-missing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { plural } from '@/lib/utils'
import { repliesToReview, requestsAwaitingReply, type InboxRequest } from '../audit-requests.ts'
import { canOpen } from '../auth.ts'
import { useAuth } from '../auth-provider.tsx'
import { fetchReport, formatPercent, type DepartmentRow, type FacultySummary, type OfferingRow } from '../reports.ts'
import { supabase } from '../supabase.ts'
import { isTimetableMissing, loadTaught } from '../teaching.ts'

type Semester = { id: string; code: string }

/** The user's own course files in the semester, and whether their timetable for it is missing. */
type StaffOverview = { semester: Semester; offerings: OfferingRow[]; timetableMissing: boolean }

/** The faculty in the semester: its summary, its departments and its offerings. */
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

/** The user's own course files in the semester, or null when they teach none in it. */
async function loadStaff(userId: string, semester: Semester): Promise<StaffOverview | null> {
  const [taught, offerings, timetableMissing] = await Promise.all([loadTaught(userId), loadOfferings(semester.id), isTimetableMissing(semester.id, userId)])
  const own = offerings.filter((row) => taught.offeringIds.has(row.offering_id))
  return own.length > 0 ? { semester, offerings: own, timetableMissing } : null
}

async function loadFaculty(semester: Semester): Promise<FacultyOverview> {
  const [[summary], departments, offerings] = await Promise.all([
    fetchReport<FacultySummary>(supabase, 'report_faculty_summary', semester.id),
    fetchReport<DepartmentRow>(supabase, 'report_departments', semester.id),
    loadOfferings(semester.id),
  ])
  return { semester, summary, departments, offerings }
}

/** Where the browser keeps the semester the user last picked on Home. */
const HOME_SEMESTER_KEY = 'ecoursefile.homeSemester'

// localStorage can throw, such as in a private window with storage blocked. Home then opens on the newest semester.
function rememberedSemester() {
  try {
    return localStorage.getItem(HOME_SEMESTER_KEY)
  } catch {
    return null
  }
}

function rememberSemester(semesterId: string) {
  try {
    localStorage.setItem(HOME_SEMESTER_KEY, semesterId)
  } catch {
    // The pick still holds in the address.
  }
}

/**
 * The dashboard. Lecturers first see the audit requests waiting for their reply, and auditors the
 * replies waiting for their review, from every semester. Then management, auditors and the admin see
 * the faculty in one semester, and lecturers their own course files in it. A user who holds both
 * kinds of role sees both. The semester is the one in ?semester=, else the one the user last picked
 * on this browser, else the newest in which they read an offering. A user with one page goes
 * straight to it.
 */
export function Home() {
  const state = useAuth()
  useDocumentTitle('Home')
  const { semesters, reload } = useSemestersWithOfferings()
  const [searchParams, setSearchParams] = useSearchParams()
  if (state.kind !== 'ready') return null
  const pages = openPages(state.roles)
  if (pages.length === 1) return <Navigate to={pages[0].path} replace />

  const list = semesters === 'failed' ? null : semesters
  const semesterId = pickSemester(list, searchParams.get('semester') ?? rememberedSemester())
  /** Undefined while the semesters load, and null when the user reads no offering at all. */
  const semester = list ? (list.find((s) => s.id === semesterId) ?? null) : undefined
  const pick = (id: string) => {
    rememberSemester(id)
    setSearchParams({ semester: id }, { replace: true })
  }

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="grid gap-1">
          <p className="text-muted-foreground text-sm">{new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' }).format(new Date())}</p>
          <h1 className="text-2xl/8 font-semibold tracking-tight">Welcome back, {state.profile.displayName}</h1>
        </div>
        {semester ? (
          <SemesterSelect semesters={list!} value={semester.id} onChange={pick} />
        ) : (
          semester === undefined && semesters !== 'failed' && <Skeleton className="h-[58px] w-full sm:w-56" />
        )}
      </header>
      {state.roles.includes('lecturer') && <AwaitingReplySection userId={state.profile.id} />}
      {state.roles.includes('auditor') && <RepliesToReviewSection userId={state.profile.id} />}
      {semesters === 'failed' ? (
        <SectionCard>
          <LoadError title="Couldn't load the semesters" onRetry={reload} />
        </SectionCard>
      ) : (
        <>
          {/* A new semester remounts each section, so it never shows the last semester's figures while it loads. */}
          {canOpen(state.roles, '/reports') && <FacultySection key={semester?.id} semester={semester} />}
          {state.roles.includes('lecturer') && <StaffSection key={semester?.id} userId={state.profile.id} semester={semester} />}
        </>
      )}
    </div>
  )
}

/** What a loader gives for a semester that is still loading: nothing, ever, so the section keeps its placeholders. */
const loading = () => new Promise<never>(() => {})

/** A dashboard section's heading, with how many it lists or the semester it covers, and a link to the page with the detail. */
function SectionHeading({
  id,
  title,
  count,
  semester,
  link,
}: {
  id: string
  title: string
  count?: number
  semester?: Semester
  link?: { to: string; label: string }
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {count !== undefined && count > 0 && (
        <Badge variant="warning" className="tabular-nums">
          {count}
        </Badge>
      )}
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

/** A failed load, or nothing to show, as a card in place of a section's body. */
function SectionCard({ children }: { children: ReactNode }) {
  return <Card className="py-0">{children}</Card>
}

/** The sent requests on the user's course files, in every semester, until they or a colleague reply. */
function AwaitingReplySection({ userId }: { userId: string }) {
  const load = useCallback(() => requestsAwaitingReply(supabase, userId), [userId])
  return (
    <InboxSection
      id="awaiting-reply-heading"
      title="Audit requests waiting for you"
      empty="No audit request is waiting for your reply."
      loadError="Couldn't load the audit requests"
      load={load}
      detail={(request) => {
        const answered = request.items.filter((item) => item.ticked || item.comment).length
        return {
          line: (
            <>
              Round {request.round_number} from {request.auditor_name} · Sent <Time value={request.sent_at} />
            </>
          ),
          status: `${answered} of ${request.items.length} answered`,
        }
      }}
    />
  )
}

/** The user's replied requests, in every semester, until they close them. */
function RepliesToReviewSection({ userId }: { userId: string }) {
  const load = useCallback(() => repliesToReview(supabase, userId), [userId])
  return (
    <InboxSection
      id="replies-heading"
      title="Replies to review"
      empty="No reply is waiting for your review."
      loadError="Couldn't load the replies"
      load={load}
      detail={(request) => ({
        line: (
          <>
            Round {request.round_number} · Replied by {request.replier_name}, <Time value={request.replied_at!} />
          </>
        ),
        quote: request.reply_message,
        status: plural(request.items.length, 'section'),
      })}
    />
  )
}

/**
 * A list of audit requests that wait on the user, each linked to the request on its course file
 * page, with its course, semester and detail: a line about the request, an optional quote and a
 * short status at its end.
 */
function InboxSection({
  id,
  title,
  empty,
  loadError,
  load,
  detail,
}: {
  id: string
  title: string
  empty: string
  loadError: string
  load: () => Promise<InboxRequest[]>
  detail: (request: InboxRequest) => { line: ReactNode; quote?: string | null; status: string }
}) {
  const { result, retry } = useLoaded(load)
  const rows = result && result !== 'failed' ? result.data : null
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <SectionHeading id={id} title={title} count={rows?.length} />
      {result === 'failed' ? (
        <SectionCard>
          <LoadError title={loadError} onRetry={retry} />
        </SectionCard>
      ) : rows?.length === 0 ? (
        <Card className="py-0">
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-4 text-sm sm:px-6">
            <CircleCheckBigIcon aria-hidden="true" className="text-success size-4 shrink-0" />
            {empty}
          </p>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul aria-labelledby={id} className="divide-y">
            {(rows ?? [null]).map((request, index) => {
              if (!request) {
                return (
                  <li key={index} aria-hidden="true" className="grid gap-2 px-4 py-4 sm:px-6">
                    <Skeleton className="h-5 w-full max-w-64" />
                    <Skeleton className="h-4 w-full max-w-96" />
                  </li>
                )
              }
              const { line, quote, status } = detail(request)
              return (
                <li key={request.id}>
                  <Link
                    to={`/course-files/${request.offering.id}#audit-request-${request.id}`}
                    className="hover:bg-muted/40 grid gap-2 px-4 py-4 transition-colors first:rounded-t-xl last:rounded-b-xl sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-6"
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{request.offering.course.code}</span>
                        <span className="text-muted-foreground text-sm">{request.offering.course.title}</span>
                        <Badge variant="secondary" className="tabular-nums">
                          {request.offering.semester.code}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground text-sm">{line}</span>
                      {quote && <span className="truncate text-sm">“{quote}”</span>}
                    </span>
                    <span className="text-muted-foreground flex items-center gap-2 text-sm tabular-nums sm:justify-end">
                      {status}
                      <ArrowRightIcon aria-hidden="true" className="size-4 max-sm:hidden" />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </section>
  )
}

/** The faculty in the semester. semester is undefined while it loads, and null when there are no offerings. */
function FacultySection({ semester }: { semester: Semester | null | undefined }) {
  const load = useCallback(() => (semester === undefined ? loading() : semester ? loadFaculty(semester) : Promise.resolve(null)), [semester])
  const { result, retry } = useLoaded(load)
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
          <FacultyStatTiles summary={summary ?? null} />
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
        <SectionBarLegend />
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
                  <SectionBar counts={row} />
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
              <Link to={`/reports?semester=${data.semester.id}&tab=offerings&status=not_ready`}>See all</Link>
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
                    <SectionBar counts={row} className="h-1.5" />
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

/** The user's own course files in the semester. semester is undefined while it loads, and null when the user teaches none at all. */
function StaffSection({ userId, semester }: { userId: string; semester: Semester | null | undefined }) {
  const load = useCallback(() => (semester === undefined ? loading() : semester ? loadStaff(userId, semester) : Promise.resolve(null)), [userId, semester])
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
          <EmptyState icon={ClipboardCheckIcon} title={semester ? `You teach no course file in ${semester.code}` : 'No course files yet'} />
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
                        <SectionBar counts={row} />
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
