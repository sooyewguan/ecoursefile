import { CalendarRangeIcon, PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FormDialog } from '@/components/action-dialogs'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, TableEmpty, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase, UNIQUE_VIOLATION } from '../supabase.ts'

type Semester = { id: string; code: string; offerings: { count: number }[] }

/** The table's columns: code and the number of offerings. */
const COLUMNS = ['', '']

export function Semesters() {
  const [semesters, setSemesters] = useState<Semester[] | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('semesters')
      .select('id, code, offerings(count)')
      .order('start_year', { ascending: false })
      .order('number', { ascending: false })
    if (error) setNotice({ tone: 'error', text: error.message })
    else setSemesters(data)
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
    if (error?.code === UNIQUE_VIOLATION) return 'That semester already exists.'
    if (error) return error.message
    setNotice({ tone: 'success', text: `Added ${data.code}.` })
    return null
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Semesters"
        description="Open a semester to offer courses in it and assign their lecturers."
        action={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            Add semester
          </Button>
        }
      />
      {notice && <NoticeAlert notice={notice} />}

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Semester</TableHead>
              <TableHead className="w-32 px-4 text-right">Offerings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!semesters ? (
              <TableSkeleton columns={COLUMNS} />
            ) : semesters.length === 0 ? (
              <TableEmpty
                columns={COLUMNS.length}
                icon={CalendarRangeIcon}
                title="No semesters yet"
                description="Add a semester, then offer courses from the catalog in it."
              />
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
          description="The code is the start year, the next year and the semester number, such as 2026/2027-1."
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
