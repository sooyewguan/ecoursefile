import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, FileTextIcon, GripVerticalIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ConfirmDialog } from '@/components/action-dialogs'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { SectionStatusBadge } from '@/components/section-status'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FILE_SECTIONS, MERGED_SECTIONS, SECTION_SLOTS, SECTIONS, type SectionStatus } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { deleteFile, uploadFile } from '../uploads.ts'

type Offering = { semester: { code: string }; course: { code: string; title: string } }

type SectionFile = {
  id: string
  slot: string | null
  name: string
  size: number
  uploaded_at: string
  uploader_name: string
  deletable: boolean
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; status: SectionStatus | null; files: SectionFile[]; canUpload: boolean }

/**
 * The file being uploaded, the slot it goes to, its place in the batch, and how much of it has
 * been sent: null while the browser merges it.
 */
type Progress = { slot: string | null; name: string; index: number; count: number; fraction: number | null }

/** Below md the uploader and time move into the file cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: drag handle, file, uploaded by, uploaded at and the row menu. */
const COLUMNS = ['', '', WIDE, WIDE, '']

/**
 * One section of a course file: its files in the order staff set, one list per slot when the
 * section has slots. The offering's coordinator and lecturers upload PDFs here and drag them into
 * order. The uploader or the coordinator deletes.
 */
export function CourseFileSection() {
  const params = useParams()
  const offeringId = params.offeringId!
  const section = SECTIONS.find((s) => String(s.number) === params.section && FILE_SECTIONS.has(s.number))
  const slots = section && SECTION_SLOTS[section.number]
  const perSheet = section && MERGED_SECTIONS[section.number]
  const [data, setData] = useState<PageData | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [deleting, setDeleting] = useState<SectionFile | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  /** The slot that the files picked next go to. */
  const pickingSlot = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!section) return
    const [offering, files, canUpload, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select('semester:semesters(code), course:courses(code, title)')
        .eq('id', offeringId)
        .maybeSingle()
        .overrideTypes<Offering | null, { merge: false }>(),
      supabase
        .from('files')
        .select('id, slot, name, size, uploaded_at, uploader_name, deletable')
        .eq('offering_id', offeringId)
        .eq('section', section.number)
        .order('position')
        .order('uploaded_at')
        .overrideTypes<SectionFile[], { merge: false }>(),
      supabase.rpc('can_upload', { offering_id: offeringId, section: section.number }),
      supabase.rpc('section_statuses', { offering_id: offeringId }),
    ])
    const error = offering.error ?? files.error ?? canUpload.error ?? statuses.error
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
    const status = (statuses.data as { section: number; status: SectionStatus }[]).find((row) => row.section === section.number)
    setData({ offering: offering.data, status: status?.status ?? null, files: files.data ?? [], canUpload: canUpload.data === true })
  }, [offeringId, section])

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

  if (!section || (data && !data.offering)) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Section" description="Open a section from its course file." action={backLink} />
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

  const files = data?.files ?? []
  const canUpload = data?.canUpload ?? false

  function pick(slot: string | null) {
    pickingSlot.current = slot
    picker.current?.click()
  }

  /** Uploads the picked files one after another, then reports what was uploaded and what was refused. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    event.target.value = ''
    if (picked.length === 0) return
    const slot = pickingSlot.current
    const target = { offeringId, section: section!.number, slot: slot ?? undefined }
    setNotice(null)
    const refused: string[] = []
    for (const [index, file] of picked.entries()) {
      setProgress({ slot, name: file.name, index, count: picked.length, fraction: null })
      try {
        await uploadFile(supabase, target, file, (fraction) => setProgress({ slot, name: file.name, index, count: picked.length, fraction }))
      } catch (error) {
        refused.push(`${file.name} was not uploaded. ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setProgress(null)
    await reload()
    const uploaded = picked.length - refused.length
    if (refused.length === 0) setNotice({ tone: 'success', text: `Uploaded ${plural(uploaded, 'file')}.` })
    else setNotice({ tone: 'error', text: `Uploaded ${plural(uploaded, 'file')}. ${refused.join(' ')}` })
  }

  /** Puts one slot's files in a new order, shows it at once, and saves it. */
  async function reorder(reordered: SectionFile[]) {
    const slot = reordered[0].slot
    setData({ ...data!, files: [...files.filter((file) => file.slot !== slot), ...reordered] })
    const { error } = await supabase.rpc('reorder_files', { file_ids: reordered.map((file) => file.id) })
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      await reload()
    }
  }

  const uploadButton = (slot: string | null, label: string) =>
    canUpload && (
      <Button variant={slot ? 'outline' : 'default'} onClick={() => pick(slot)} disabled={progress !== null}>
        {progress?.slot === slot ? <Spinner /> : <UploadIcon />}
        {label}
      </Button>
    )

  const tableFor = (slot: string | null, label: string) => (
    <FileTable
      label={label}
      files={data && files.filter((file) => file.slot === slot)}
      canUpload={canUpload}
      emptyDescription={
        data?.status === 'off'
          ? 'This section is off for this offering.'
          : !canUpload
            ? 'The coordinator and lecturers upload files here.'
            : section.kind === 'may-be-empty'
              ? 'This section may stay empty. Upload PDF files if there are any.'
              : 'Upload one or more PDF files.'
      }
      onReorder={(reordered) => void reorder(reordered)}
      onDelete={setDeleting}
    />
  )

  return (
    <div className="grid gap-6">
      <PageHeader
        title={section.title}
        description={
          data
            ? `Section ${section.number} · ${data.offering!.course.code} ${data.offering!.course.title} · ${data.offering!.semester.code}`
            : `Section ${section.number}`
        }
        action={
          <div className="flex flex-wrap gap-2">
            {backLink}
            {!slots && uploadButton(null, 'Upload PDFs')}
          </div>
        }
      />
      <input ref={picker} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => void upload(event)} />

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {data?.status && <SectionStatusBadge status={data.status} />}
        {canUpload && (
          <span>
            {perSheet
              ? `PDF files, merged ${perSheet} pages to a page in your browser. A merged file can be at most 20 MB.`
              : 'PDF files of up to 20 MB.'}{' '}
            Drag files to set their order in the compiled course file.
          </span>
        )}
      </div>

      {progress && (
        <p role="status" className="text-sm">
          {progress.fraction === null && perSheet
            ? `Merging ${progress.name} ${perSheet} pages to a page (${progress.index + 1} of ${progress.count})`
            : `Uploading ${progress.name} (${progress.index + 1} of ${progress.count}), ${Math.round((progress.fraction ?? 0) * 100)}%`}
        </p>
      )}
      {notice && <NoticeAlert notice={notice} />}

      {slots
        ? slots.map((slot) => (
            <section key={slot.name} aria-label={slot.title} className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{slot.title}</h2>
                {uploadButton(slot.name, 'Upload PDFs')}
              </div>
              {tableFor(slot.name, `${slot.title} files`)}
            </section>
          ))
        : tableFor(null, 'Files')}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description="The file is deleted for good, from SharePoint and from this course file."
          confirmLabel="Delete file"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteFile(supabase, deleting.id)
            } catch (error) {
              return error instanceof Error ? error.message : String(error)
            }
            await reload()
            setNotice({ tone: 'success', text: `Deleted ${deleting.name}.` })
            return null
          }}
        />
      )}
    </div>
  )
}

/**
 * One section's or slot's files in their order, or placeholder rows while they load. Staff who
 * may upload drag rows, or use the row menu, to reorder them. Rows drag only within this table.
 */
function FileTable({
  label,
  files,
  canUpload,
  emptyDescription,
  onReorder,
  onDelete,
}: {
  label: string
  files: SectionFile[] | null
  canUpload: boolean
  emptyDescription: string
  onReorder: (files: SectionFile[]) => void
  onDelete: (file: SectionFile) => void
}) {
  const [dragged, setDragged] = useState<string | null>(null)

  function move(fileId: string, to: number) {
    if (!files) return
    const from = files.findIndex((file) => file.id === fileId)
    if (from === -1 || from === to || to < 0 || to >= files.length) return
    onReorder(files.toSpliced(from, 1).toSpliced(to, 0, files[from]))
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table aria-label={label}>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-10 px-2">
              <span className="sr-only">Order</span>
            </TableHead>
            <TableHead className="px-4">File</TableHead>
            <TableHead className={cn('w-56 px-4', WIDE)}>Uploaded by</TableHead>
            <TableHead className={cn('w-48 px-4', WIDE)}>Uploaded</TableHead>
            <TableHead className="w-14 px-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!files ? (
            <TableSkeleton columns={COLUMNS} />
          ) : files.length === 0 ? (
            <TableEmpty columns={COLUMNS.length} icon={FileTextIcon} title="No files yet" description={emptyDescription} />
          ) : (
            files.map((file, index) => {
              const uploadedAt = new Date(file.uploaded_at).toLocaleString()
              return (
                <TableRow
                  key={file.id}
                  draggable={canUpload}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', file.id)
                    event.dataTransfer.effectAllowed = 'move'
                    setDragged(file.id)
                  }}
                  onDragOver={(event) => {
                    if (dragged) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dragged) move(dragged, index)
                  }}
                  onDragEnd={() => setDragged(null)}
                  className={cn(dragged === file.id && 'opacity-50')}
                >
                  <TableCell className="text-muted-foreground px-2 py-3">
                    {canUpload && <GripVerticalIcon aria-hidden="true" className="mx-auto size-4 cursor-grab" />}
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="grid gap-0.5">
                      <span className="font-medium wrap-anywhere">{file.name}</span>
                      <span className="text-muted-foreground text-xs">{formatSize(file.size)}</span>
                      <span className="text-muted-foreground text-xs md:hidden">
                        {file.uploader_name}, {uploadedAt}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{file.uploader_name}</TableCell>
                  <TableCell className={cn('px-4 py-3', WIDE)}>{uploadedAt}</TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    {(canUpload || file.deletable) && (
                      <RowActions label={`Actions for ${file.name}`}>
                        {canUpload && (
                          <>
                            <DropdownMenuItem disabled={index === 0} onSelect={() => move(file.id, index - 1)}>
                              <ArrowUpIcon />
                              Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={index === files.length - 1} onSelect={() => move(file.id, index + 1)}>
                              <ArrowDownIcon />
                              Move down
                            </DropdownMenuItem>
                          </>
                        )}
                        {canUpload && file.deletable && <DropdownMenuSeparator />}
                        {file.deletable && (
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </RowActions>
                    )}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
