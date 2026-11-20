import { HistoryIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorAlert } from '@/components/notice'
import { TableEmpty, TableSkeleton } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/utils'
import { itemName } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { listReusableFiles, reuseFile, type ReusableFile, type Slot } from '../uploads.ts'

/** Below sm the semester moves into the file cell, so a phone has room for the file name. */
const WIDE = 'hidden sm:table-cell'

/** The table's columns: semester, file and the reuse button. */
const COLUMNS = [`w-32 ${WIDE}`, '', 'w-28']

/**
 * The reuse picker: the files of past offerings of the same course in the slot, the latest semester
 * first. Picking one copies it into the slot as a new file. title names the slot, such as Lab 2 Lab
 * Sheet. The dialog is open while it is mounted.
 */
export function ReuseDialog({
  slot,
  title,
  courseCode,
  onClose,
  onReused,
}: {
  slot: Slot
  title: string
  courseCode: string
  onClose: () => void
  onReused: (file: ReusableFile) => Promise<void>
}) {
  const [files, setFiles] = useState<ReusableFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reusing, setReusing] = useState<string | null>(null)
  const { offeringId, section, item, slot: slotName } = slot

  useEffect(() => {
    listReusableFiles(supabase, { offeringId, section, item, slot: slotName }).then(setFiles, (failure: unknown) => {
      setFiles([])
      setError(failure instanceof Error ? failure.message : String(failure))
    })
  }, [offeringId, section, item, slotName])

  async function reuse(file: ReusableFile) {
    setReusing(file.id)
    setError(null)
    try {
      await reuseFile(supabase, slot, file.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setReusing(null)
      return
    }
    await onReused(file)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="leading-snug">Reuse a file in {title}</DialogTitle>
          <DialogDescription>
            Files in this slot from past semesters of {courseCode}. The file you pick is copied into this course file, so deleting the original later
            leaves your copy.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border">
          <Table aria-label="Files from past semesters">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className={`px-4 ${WIDE}`}>Semester</TableHead>
                <TableHead className="px-4">File</TableHead>
                <TableHead className="px-4">
                  <span className="sr-only">Reuse</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!files ? (
                <TableSkeleton columns={COLUMNS} rows={2} />
              ) : files.length === 0 ? (
                <TableEmpty
                  columns={COLUMNS.length}
                  icon={HistoryIcon}
                  title="Nothing to reuse"
                  description={`No past semester of ${courseCode} has files in this slot.`}
                />
              ) : (
                files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className={`px-4 py-3 align-top ${WIDE}`}>{file.semester_code}</TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <div className="grid gap-0.5">
                        <span className="font-medium wrap-anywhere">{file.name}</span>
                        <span className="text-muted-foreground text-xs">
                          <span className="sm:hidden">{file.semester_code}, </span>
                          {file.item !== null && `${itemName(section, file.item)}, `}
                          {formatSize(file.size)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => void reuse(file)} disabled={reusing !== null}>
                        {reusing === file.id && <Spinner />}
                        Reuse
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
