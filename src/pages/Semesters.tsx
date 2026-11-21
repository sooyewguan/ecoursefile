import { CalendarRangeIcon, PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { PageHeader, TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { friendlyError } from '../errors.ts'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type Semester = { id: string; code: string; offerings: { count: number }[] }

/** The table's columns: code and the number of offerings. */
const COLUMNS = ['', '']

export function Semesters() {
  const [semesters, setSemesters] = useState<Semester[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('semesters')
      .select('id, code, offerings(count)')
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
    setLoadFailed(error !== null)
    if (data) setSemesters(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function add(form: FormData) {
    const { data, error } = await supabase
      .from('semesters')
      .insert({ start_year: Number(form.get('start_year')), number: Number(form.get('number')) })
      .select('code')
      .single()
    await reload()
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
      <PageHeader title="Semesters" action={addButton} />

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Semester</TableHead>
              <TableHead className="w-32 px-4 text-right">Offerings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadFailed ? (
              <TableLoadError columns={COLUMNS.length} title="Couldn't load semesters" onRetry={reload} />
            ) : !semesters ? (
              <TableSkeleton columns={COLUMNS} />
            ) : semesters.length === 0 ? (
              <TableEmpty columns={COLUMNS.length} icon={CalendarRangeIcon} title="No semesters yet" action={addButton} />
            ) : (
              semesters.map((semester) => (
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
      </Card>

      {adding && (
        <FormDialog
          title="Add a semester"
          submitLabel="Add semester"
          onClose={() => setAdding(false)}
          onSubmit={add}
        >
          <div className="grid gap-2">
            <Label htmlFor="semester-start-year">Start year</Label>
            <Input
              id="semester-start-year"
              name="start_year"
              type="number"
              min={2000}
              max={2999}
              defaultValue={new Date().getFullYear()}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="semester-number">Semester</Label>
            <NativeSelect id="semester-number" name="number" defaultValue="1" required>
              <NativeSelectOption value="1">1</NativeSelectOption>
              <NativeSelectOption value="2">2</NativeSelectOption>
              <NativeSelectOption value="3">3 (short semester)</NativeSelectOption>
            </NativeSelect>
          </div>
        </FormDialog>
      )}
    </div>
  )
}
