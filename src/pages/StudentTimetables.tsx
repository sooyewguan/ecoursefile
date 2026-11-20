import { ArrowLeftIcon, FileTextIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, TableEmpty, TableSkeleton } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { SectionVerdict } from '@/components/section-verdict'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatSize } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
import { PROGRAM_CODE_FILE_SECTION, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'

const SECTION = PROGRAM_CODE_FILE_SECTION

type ProgramCode = { id: string; code: string }

/** A ticked program code's student timetable, which the course file links. */
type Timetable = { id: string; program_code_id: string; name: string; size: number; uploaded_at: string }

type Offering = {
  semester: { code: string }
  course: { code: string; title: string }
  /** Every lecturer of the offering, the coordinator included. */
  lecturers: { lecturer_id: string }[]
  /** The program codes with a student timetable in the offering's semester. */
  program_code_choices: ProgramCode[]
  /** The program codes ticked in section 5, with or without a timetable. */
  ticks: { program_code: ProgramCode }[]
  /** The timetables of the ticked codes that have one. */
  linked_files: Timetable[]
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; status: SectionStatus | null }

/** Below md the upload time moves into the timetable cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: tick, program code, timetable and uploaded. */
const COLUMNS = ['', '', '', WIDE]

/**
 * Section 5 of a course file: the program codes whose students take the course. The list holds
 * every code with a student timetable for the semester, which the admin uploads, and the
 * coordinator and lecturers tick the codes that take the course. The course file links the
 * timetable of each ticked code. A ticked code whose timetable the admin deleted stays ticked and
 * Missing until it is unticked or its timetable is uploaded again.
 */
export function StudentTimetables() {
  const offeringId = useParams().offeringId!
  const auth = useAuth()
  const userId = auth.kind === 'ready' ? auth.profile.id : null
  const [data, setData] = useState<PageData | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  /** The program code whose tick is being saved. */
  const [saving, setSaving] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [offering, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select(
          'semester:semesters(code), course:courses(code, title), lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id), program_code_choices(id, code), ticks:offering_program_codes(program_code:program_codes(id, code)), linked_files(id, program_code_id, name, size, uploaded_at)',
        )
        .eq('id', offeringId)
        .eq('linked_files.section', SECTION.number)
        .maybeSingle()
        .overrideTypes<Offering | null, { merge: false }>(),
      supabase.rpc('section_statuses', { offering_id: offeringId }),
    ])
    const error = offering.error ?? statuses.error
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
    const status = (statuses.data as { section: number; status: SectionStatus }[]).find((row) => row.section === SECTION.number)
    setData({ offering: offering.data, status: status?.status ?? null })
  }, [offeringId])

  useEffect(() => {
    void reload()
  }, [reload])

  const backLink = (
    <Button asChild variant="outline">
      <Link to={`/course-files/${offeringId}`}>
        <ArrowLeftIcon />
        Course file
      </Link>
    </Button>
  )

  if (data && !data.offering) {
    return (
      <div className="grid gap-6">
        <PageHeader title={SECTION.title} description="Open a section from its course file." action={backLink} />
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableBody>
              <TableEmpty
                columns={1}
                icon={FileTextIcon}
                title="Section not found"
                description="It does not exist, or you do not have access to its course file."
              />
            </TableBody>
          </Table>
        </Card>
      </div>
    )
  }

  const offering = data?.offering
  const choices = offering?.program_code_choices ?? []
  const ticked = new Set(offering?.ticks.map((tick) => tick.program_code.id))
  /** Ticked codes whose timetable the admin deleted, which the pick list no longer holds. */
  const orphaned = (offering?.ticks ?? []).map((tick) => tick.program_code).filter((code) => !choices.some((choice) => choice.id === code.id))
  const codes = [...choices, ...orphaned].toSorted((a, b) => a.code.localeCompare(b.code))
  /** Whether the user teaches the offering, and so may tick its codes. */
  const canTick = offering?.lecturers.some((lecturer) => lecturer.lecturer_id === userId) ?? false

  /** Ticks or unticks the code, then reports the outcome. */
  async function setTicked(programCode: ProgramCode, isTicked: boolean) {
    setSaving(programCode.id)
    setNotice(null)
    const { error } = await supabase.rpc('tick_program_code', { offering_id: offeringId, program_code_id: programCode.id, ticked: isTicked })
    await reload()
    setNotice(error ? { tone: 'error', text: error.message } : { tone: 'success', text: `${isTicked ? 'Ticked' : 'Unticked'} ${programCode.code}.` })
    setSaving(null)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={SECTION.title}
        description={
          offering ? `Section ${SECTION.number} · ${offering.course.code} ${offering.course.title} · ${offering.semester.code}` : `Section ${SECTION.number}`
        }
        action={backLink}
      />

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {data?.status && <SectionStatusBadge status={data.status} />}
        <span>
          {canTick ? 'Tick' : 'The coordinator and lecturers tick'} each program code whose students take this course, and its student timetable shows
          here. The list holds the codes that have a timetable for {offering?.semester.code ?? 'the semester'}, which the admin uploads. This section is
          Missing until a code is ticked, and while a ticked code has no timetable.
        </span>
      </div>
      <SectionVerdict offeringId={offeringId} section={SECTION.number} sectionTitle={SECTION.title} onRecorded={reload} />
      {notice && <NoticeAlert notice={notice} />}

      <Card className="gap-0 overflow-hidden py-0">
        <Table aria-label="Program codes">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-12 px-4">
                <span className="sr-only">Ticked</span>
              </TableHead>
              <TableHead className="px-4">Program code</TableHead>
              <TableHead className="px-4">Timetable</TableHead>
              <TableHead className={cn('w-48 px-4', WIDE)}>Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!offering ? (
              <TableSkeleton columns={COLUMNS} />
            ) : codes.length === 0 ? (
              <TableEmpty
                columns={COLUMNS.length}
                icon={FileTextIcon}
                title="No student timetables yet"
                description={`The admin uploads a timetable for each program code on the page of semester ${offering.semester.code}. Codes show here once they have one.`}
              />
            ) : (
              codes.map((programCode) => {
                const isTicked = ticked.has(programCode.id)
                const timetable = offering.linked_files.find((file) => file.program_code_id === programCode.id)
                const uploadedAt = timetable && new Date(timetable.uploaded_at).toLocaleString()
                const checkboxId = `program-code-${programCode.id}`
                return (
                  <TableRow key={programCode.id}>
                    <TableCell className="px-4 py-3">
                      {saving === programCode.id ? (
                        <Spinner />
                      ) : (
                        <Checkbox
                          id={checkboxId}
                          checked={isTicked}
                          disabled={!canTick || saving !== null}
                          onCheckedChange={(checked) => void setTicked(programCode, checked === true)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <label htmlFor={checkboxId} className="font-medium wrap-anywhere">
                        {programCode.code}
                      </label>
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      {timetable ? (
                        <div className="grid gap-0.5">
                          <span className="wrap-anywhere">{timetable.name}</span>
                          <span className="text-muted-foreground text-xs">{formatSize(timetable.size)}</span>
                          <span className="text-muted-foreground text-xs md:hidden">{uploadedAt}</span>
                        </div>
                      ) : isTicked ? (
                        <div className="grid justify-items-start gap-1">
                          <SectionStatusBadge status="missing" />
                          <span className="text-muted-foreground text-xs">The admin deleted this timetable. Untick the code, or ask the admin to upload it again.</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className={cn('px-4 py-3', WIDE)}>{uploadedAt}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
