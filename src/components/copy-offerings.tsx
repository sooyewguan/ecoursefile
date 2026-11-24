import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FormDialog } from '@/components/action-dialogs'
import { BulkResults, type BulkResult } from '@/components/bulk-results'
import { Combobox, type ComboboxOption } from '@/components/combobox'
import { FieldError } from '@/components/form-errors'
import { Label } from '@/components/ui/label'
import { plural } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { containsFilter } from '../paging.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

/** A semester as the copy names it: its id, code, start year and number, which order semesters. */
export type SemesterRef = { id: string; code: string; start_year: number; number: number }

/** What copy_offerings did with one offering of the source semester. */
export type CopiedOffering = {
  course_id: string
  course_code: string
  course_title: string
  /** The new offering, or null when it was skipped. */
  offering_id: string | null
  skipped: 'already_offered' | 'coordinator_unavailable' | null
  coordinator_name: string
  /** The staff left off because they are deactivated or no longer lecturers. */
  left_off: string[]
}

/** A copy that ran: the code of the semester it copied from, and what it did with each offering. */
export type CopyOutcome = { source: string; offerings: CopiedOffering[] }

/** How many options the semester picker shows for a search. */
const PICKER_LIMIT = 20

type SemesterRow = { id: string; code: string; offerings: { count: number }[] }

function semesterOption(row: SemesterRow): ComboboxOption {
  return { value: row.id, label: row.code, detail: plural(row.offerings[0]?.count ?? 0, 'offering') }
}

/**
 * Copies the offerings of a semester the admin picks into this one, all or none. It starts with the
 * latest earlier semester that has offerings. onCopied gets what the copy did.
 */
export function CopyOfferingsDialog({
  semester,
  onClose,
  onCopied,
}: {
  semester: SemesterRef
  onClose: () => void
  onCopied: (outcome: CopyOutcome) => void
}) {
  const [source, setSource] = useState<ComboboxOption | null>(null)

  useEffect(() => {
    let current = true
    const { start_year: year, number } = semester
    void supabase
      .from('semesters')
      .select('id, code, offerings(count)')
      .or(`start_year.lt.${year},and(start_year.eq.${year},number.lt.${number})`)
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
      .limit(10)
      .overrideTypes<SemesterRow[], { merge: false }>()
      .then(({ data }) => {
        const latest = data?.find((row) => (row.offerings[0]?.count ?? 0) > 0)
        if (current && latest) setSource((chosen) => chosen ?? semesterOption(latest))
      })
    return () => {
      current = false
    }
  }, [semester])

  /** The other semesters whose code has the query, newest first, with how many offerings each has. */
  async function searchSemesters(query: string) {
    let request = supabase.from('semesters').select('id, code, offerings(count)').neq('id', semester.id)
    const filter = containsFilter(['code'], query)
    if (filter) request = request.or(filter)
    const { data, error } = await request
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
      .limit(PICKER_LIMIT)
      .overrideTypes<SemesterRow[], { merge: false }>()
    if (error) throw error
    return data.map(semesterOption)
  }

  return (
    <FormDialog
      title="Copy offerings from another semester"
      description={`Each course of that semester that ${semester.code} does not offer yet is offered here with the same coordinator and lecturers. Deactivated staff are left off.`}
      submitLabel="Copy offerings"
      onClose={onClose}
      onSubmit={async () => {
        if (!source) return { field: 'source_semester_id', message: 'Choose a semester.' }
        const { data, error } = await supabase.rpc('copy_offerings', { source_semester_id: source.value, target_semester_id: semester.id })
        if (error) return friendlyError(error, { codes: { [UNIQUE_VIOLATION]: `A course was offered in ${semester.code} while copying, so nothing was copied. Copy again.` } })
        const offerings = data as CopiedOffering[]
        if (offerings.length === 0) return { field: 'source_semester_id', message: `${source.label} has no offerings to copy.` }
        onCopied({ source: source.label, offerings })
        return null
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="copy-source">Copy from</Label>
        <Combobox
          id="copy-source"
          name="source_semester_id"
          value={source}
          onChange={setSource}
          search={searchSemesters}
          placeholder="Choose a semester"
          searchPlaceholder="Search semesters"
        />
        <FieldError name="source_semester_id" />
      </div>
    </FormDialog>
  )
}

/** The order of the results: what needs the admin first, then what was added, then what was already here. */
function rank(offering: CopiedOffering) {
  if (offering.skipped === 'coordinator_unavailable') return 0
  if (offering.skipped === 'already_offered') return 3
  return offering.left_off.length > 0 ? 1 : 2
}

function result(offering: CopiedOffering): BulkResult {
  const name = (
    <div className="grid gap-0.5">
      {offering.offering_id ? (
        <Link to={`/course-files/${offering.offering_id}`} className="font-medium hover:underline">
          {offering.course_code}
        </Link>
      ) : (
        <span className="font-medium">{offering.course_code}</span>
      )}
      <span>{offering.course_title}</span>
    </div>
  )
  const leftOff = offering.left_off.join(', ')
  switch (offering.skipped) {
    case 'already_offered':
      return { key: offering.course_id, name, outcome: { label: 'Skipped', variant: 'outline' }, note: 'Already offered in this semester.' }
    case 'coordinator_unavailable':
      return {
        key: offering.course_id,
        name,
        outcome: { label: 'Skipped', variant: 'warning' },
        note: `Its coordinator, ${offering.coordinator_name}, is deactivated or no longer a lecturer. Add it with another coordinator.`,
      }
    default:
      return {
        key: offering.course_id,
        name,
        outcome: { label: 'Added', variant: 'success' },
        note: leftOff && `Left off, as deactivated or no longer a lecturer: ${leftOff}.`,
      }
  }
}

/** What the last copy did with each offering of its source semester. */
export function CopyResults({ outcome, onDismiss }: { outcome: CopyOutcome; onDismiss: () => void }) {
  const added = outcome.offerings.filter((offering) => offering.offering_id !== null).length
  const skipped = outcome.offerings.length - added
  return (
    <BulkResults
      title={`Copied from ${outcome.source}`}
      summary={`${plural(added, 'offering')} added, ${skipped} skipped.`}
      nameHeading="Course"
      results={outcome.offerings.toSorted((a, b) => rank(a) - rank(b) || a.course_code.localeCompare(b.course_code)).map(result)}
      onDismiss={onDismiss}
    />
  )
}
