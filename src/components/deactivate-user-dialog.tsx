import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ConfirmDialog } from '@/components/action-dialogs'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { plural } from '../format.ts'
import { supabase } from '../supabase.ts'

/** An offering the user coordinates or teaches, as the dialog lists it. */
type TaughtOffering = {
  id: string
  coordinator_id: string
  semester: { id: string; code: string; start_year: number; number: number }
  course: { code: string; title: string }
}

/**
 * How many of the newest semesters with offerings the dialog looks in. Semesters have no dates, so
 * the running semester cannot be told from the next one set up early, and the two newest hold both.
 */
const SEMESTERS = 2

/** The user's offerings in the newest semesters with offerings, newest semester first, then by course code. */
async function loadTaught(userId: string): Promise<TaughtOffering[]> {
  const semesters = await supabase
    .from('semesters')
    .select('id, offerings!inner()')
    .order('start_year', { ascending: false })
    .order('number', { ascending: false })
    .limit(SEMESTERS)
  if (semesters.error) throw semesters.error
  const { data, error } = await supabase
    .from('offerings')
    .select('id, coordinator_id, semester:semesters(id, code, start_year, number), course:courses(code, title), taught:offering_lecturers!offering_lecturers_offering_id_fkey!inner()')
    .eq('taught.lecturer_id', userId)
    .in(
      'semester_id',
      semesters.data.map((semester) => semester.id),
    )
    .overrideTypes<TaughtOffering[], { merge: false }>()
  if (error) throw error
  return data.toSorted(
    (a, b) =>
      b.semester.start_year - a.semester.start_year || b.semester.number - a.semester.number || a.course.code.localeCompare(b.course.code),
  )
}

/**
 * Confirms a deactivation. It lists the course files the user coordinates or teaches in the newest
 * semesters, each linked to its semester's page, since those course files lose them.
 */
export function DeactivateUserDialog({
  user,
  onConfirm,
  onClose,
}: {
  user: { id: string; display_name: string }
  onConfirm: () => Promise<string | null>
  onClose: () => void
}) {
  const [taught, setTaught] = useState<TaughtOffering[] | 'failed' | null>(null)

  useEffect(() => {
    let current = true
    loadTaught(user.id).then(
      (rows) => current && setTaught(rows),
      () => current && setTaught('failed'),
    )
    return () => {
      current = false
    }
  }, [user.id])

  return (
    <ConfirmDialog
      title={`Deactivate ${user.display_name}?`}
      description="They can't sign in, and any session they have open loses access at once. You can reactivate them later."
      confirmLabel="Deactivate"
      destructive
      onClose={onClose}
      onConfirm={onConfirm}
    >
      {taught === null ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner />
          Checking their course files
        </p>
      ) : taught === 'failed' ? (
        <p className="text-muted-foreground text-sm">Couldn't check which course files they teach.</p>
      ) : taught.length === 0 ? (
        <p className="text-muted-foreground text-sm">They teach no course file in the two newest semesters.</p>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm">
            They teach {plural(taught.length, 'course file')} in the two newest semesters. Assign someone else on each semester's page.
          </p>
          <ul aria-label="Course files they teach" className="max-h-48 overflow-y-auto rounded-md border text-sm">
            {taught.map((offering) => (
              <li key={offering.id} className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-b-0">
                <Link to={`/semesters/${offering.semester.id}`} className="min-w-0 hover:underline">
                  <span className="font-medium">{offering.course.code}</span> {offering.course.title}
                  <span className="text-muted-foreground block text-xs">{offering.semester.code}</span>
                </Link>
                <Badge variant="outline" className="shrink-0">
                  {offering.coordinator_id === user.id ? 'Coordinator' : 'Lecturer'}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ConfirmDialog>
  )
}
