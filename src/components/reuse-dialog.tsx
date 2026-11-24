import { useState } from 'react'
import { FileLink } from '@/components/file-link'
import { ErrorAlert } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { itemName } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { reuseFile, type ReusableFile, type Slot } from '../uploads.ts'

/** Below sm the semester moves into the file cell, so a phone has room for the file name. */
const WIDE = 'hidden sm:table-cell'

/**
 * The reuse picker: files, the files of past offerings of the same course in the slot, the latest
 * semester first. Each opens in a new tab, and picking one copies it into the slot as a new file.
 * title names the slot, such as Lab 2 Lab Sheet. The dialog is open while it is mounted.
 */
export function ReuseDialog({
  slot,
  title,
  courseCode,
  files,
  onClose,
  onReused,
}: {
  slot: Slot
  title: string
  courseCode: string
  files: ReusableFile[]
  onClose: () => void
  onReused: (file: ReusableFile) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [reusing, setReusing] = useState<string | null>(null)

  async function reuse(file: ReusableFile) {
    setReusing(file.id)
    setError(null)
    try {
      await reuseFile(supabase, slot, file.id)
    } catch (failure) {
      setError(friendlyError(failure))
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
          <DialogDescription>From past semesters of {courseCode}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border">
          <Table aria-label="Files from past semesters">
            <TableHeader>
              <TableRow>
                <TableHead className={`w-32 px-4 ${WIDE}`}>Semester</TableHead>
                <TableHead className="px-4">File</TableHead>
                <TableHead className="w-28 px-4">
                  <span className="sr-only">Reuse</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className={`px-4 py-3 align-top ${WIDE}`}>{file.semester_code}</TableCell>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="grid gap-0.5">
                      <FileLink file={file} reuseInto={slot} />
                      <span className="text-muted-foreground text-xs">
                        <span className="sm:hidden">{file.semester_code}, </span>
                        {file.item !== null && `${itemName(slot.section, file.item)}, `}
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
              ))}
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
