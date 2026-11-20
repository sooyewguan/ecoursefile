import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ErrorAlert } from '@/components/notice'
import { PageHeader } from '@/components/page'
import { ExportMenu, OfferingsTable, SemesterSelect, useReport } from '@/components/reports'
import { useAuth } from '../auth-provider.tsx'
import { MY_COMPLETENESS_TABLE } from '../report-tables.ts'
import type { OfferingRow } from '../reports.ts'
import { supabase } from '../supabase.ts'

type Semester = { id: string; code: string; start_year: number; number: number }

/** The ids of the offerings the user teaches or coordinates, and their semesters, newest first. */
type Taught = { offeringIds: ReadonlySet<string>; semesters: Semester[] }

/**
 * The completeness of the course files that the user teaches or coordinates, in one semester. The
 * semester is in the URL, at ?semester=<id>, and the newest semester in which they teach is the
 * default. A lecturer who is also management sees only their own offerings here.
 */
export function Completeness() {
  const auth = useAuth()
  const userId = auth.kind === 'ready' ? auth.profile.id : null
  const [taught, setTaught] = useState<Taught | { error: string } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (!userId) return
    void supabase
      .from('offering_lecturers')
      .select('offering:offerings!offering_lecturers_offering_id_fkey!inner(id, semester:semesters!inner(id, code, start_year, number))')
      .eq('lecturer_id', userId)
      .overrideTypes<{ offering: { id: string; semester: Semester } }[], { merge: false }>()
      .then(({ data, error }) => {
        if (error) return setTaught({ error: error.message })
        const semesters = new Map(data.map(({ offering }) => [offering.semester.id, offering.semester]))
        setTaught({
          offeringIds: new Set(data.map(({ offering }) => offering.id)),
          semesters: [...semesters.values()].toSorted((a, b) => b.start_year - a.start_year || b.number - a.number),
        })
      })
  }, [userId])

  const own = taught && 'semesters' in taught ? taught : null
  const semesterId = searchParams.get('semester') ?? own?.semesters[0]?.id ?? null

  return (
    <div className="grid gap-6">
      <PageHeader
        title="My completeness"
        description="What is missing from the course files you teach or coordinate."
        action={
          own &&
          semesterId &&
          own.semesters.length > 0 && (
            <SemesterSelect semesters={own.semesters} value={semesterId} onChange={(semester) => setSearchParams({ semester }, { replace: true })} />
          )
        }
      />
      {taught && 'error' in taught && <ErrorAlert>{taught.error}</ErrorAlert>}
      {own?.semesters.length === 0 && (
        <OfferingsTable rows={[]} emptyDescription="Your course files appear here once the admin assigns you to an offering." />
      )}
      {own && semesterId && (
        <OwnOfferings
          semesterId={semesterId}
          semesterCode={own.semesters.find((semester) => semester.id === semesterId)?.code ?? null}
          offeringIds={own.offeringIds}
        />
      )}
    </div>
  )
}

function OwnOfferings({ semesterId, semesterCode, offeringIds }: { semesterId: string; semesterCode: string | null; offeringIds: ReadonlySet<string> }) {
  const report = useReport<OfferingRow>('report_offerings', semesterId)
  if (report?.error) return <ErrorAlert>{report.error}</ErrorAlert>
  const rows = report?.rows?.filter((row) => offeringIds.has(row.offering_id)) ?? null
  return (
    <div className="grid gap-4">
      <ExportMenu table={MY_COMPLETENESS_TABLE} rows={rows} semesterCode={semesterCode} />
      <OfferingsTable rows={rows} emptyDescription="You teach no offering in this semester." />
    </div>
  )
}
