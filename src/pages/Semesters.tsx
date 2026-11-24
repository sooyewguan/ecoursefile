import { CalendarRangeIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { PageHeader, TableCard, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Pager, usePagedList } from '@/components/paged-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { friendlyError } from '../errors.ts'
import { containsFilter } from '../paging.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type Semester = { id: string; code: string; offerings: { count: number }[] }

/** The table's columns: code and the number of offerings. */
const COLUMNS = ['', '']

/** The semesters, newest first, a page at a time, searched by code. */
export function Semesters() {
  const [adding, setAdding] = useState(false)
  const semesters = usePagedList((range, search) => {
    let query = supabase.from('semesters').select('id, code, offerings(count)', { count: 'exact' })
    const filter = containsFilter(['code'], search)
    if (filter) query = query.or(filter)
    return query
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
      .range(range.from, range.to)
      .overrideTypes<Semester[], { merge: false }>()
  })
  const isEmpty = semesters.total === 0 && !semesters.query

  async function add(form: FormData) {
    const { data, error } = await supabase
      .from('semesters')
      .insert({ start_year: Number(form.get('start_year')), number: Number(form.get('number')) })
      .select('code')
      .single()
    semesters.retry()
    if (error) return friendlyError(error, { codes: { [UNIQUE_VIOLATION]: 'That semester already exists.' } })
    toast.success(`Added ${data.code}`)
    return null
  }

  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon />
      Add semester
    </Button>
  )

  return (
    <div className="grid gap-6">
      <PageHeader title="Semesters" action={semesters.total !== null && !isEmpty && addButton} />

      {semesters.total !== null && !isEmpty && (
        <Input
          type="search"
          aria-label="Search semesters"
          placeholder="Search by code"
          className="max-w-sm"
          value={semesters.query}
          onChange={(event) => semesters.setQuery(event.target.value)}
        />
      )}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Semester</TableHead>
              <TableHead className="w-32 px-4 text-right">Offerings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {semesters.failed ? (
              <TableLoadError columns={COLUMNS.length} title="Couldn't load semesters" onRetry={semesters.retry} />
            ) : !semesters.rows ? (
              <TableSkeleton columns={COLUMNS} />
            ) : semesters.rows.length === 0 ? (
              <TableEmpty
                columns={COLUMNS.length}
                icon={CalendarRangeIcon}
                title={isEmpty ? 'No semesters yet' : 'No matching semesters'}
                action={isEmpty ? addButton : undefined}
              />
            ) : (
              semesters.rows.map((semester) => (
                <TableRow key={semester.id} className="relative">
                  <TableCell className="px-4 py-3">
                    <Link
                      to={`/semesters/${semester.id}`}
                      className="font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {semester.code}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{semester.offerings[0]?.count ?? 0}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {semesters.total !== null && <Pager page={semesters.page} total={semesters.total} onPageChange={semesters.setPage} />}
      </TableCard>

      {adding && <AddSemesterDialog onClose={() => setAdding(false)} onSubmit={add} />}
    </div>
  )
}

/** The add dialog, which shows the code the semester will get as its year and number change. */
function AddSemesterDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (form: FormData) => Promise<string | null> }) {
  const [startYear, setStartYear] = useState(String(new Date().getFullYear()))
  const [number, setNumber] = useState('1')
  const year = Number(startYear)
  return (
    <FormDialog title="Add a semester" submitLabel="Add semester" onClose={onClose} onSubmit={onSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="semester-start-year">Start year</Label>
        <Input
          id="semester-start-year"
          name="start_year"
          type="number"
          min={2000}
          max={2999}
          value={startYear}
          onChange={(event) => setStartYear(event.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="semester-number">Semester</Label>
        <NativeSelect id="semester-number" name="number" value={number} onChange={(event) => setNumber(event.target.value)} required>
          <NativeSelectOption value="1">1</NativeSelectOption>
          <NativeSelectOption value="2">2</NativeSelectOption>
          <NativeSelectOption value="3">3 (short semester)</NativeSelectOption>
        </NativeSelect>
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Code: <span className="text-foreground font-medium tabular-nums">{Number.isInteger(year) && year >= 2000 && year <= 2999 ? `${year}/${year + 1}-${number}` : '—'}</span>
      </p>
    </FormDialog>
  )
}
