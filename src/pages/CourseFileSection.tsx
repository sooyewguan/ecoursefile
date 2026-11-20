import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, FileTextIcon, GripVerticalIcon, HistoryIcon, LayersIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ConfirmDialog } from '@/components/action-dialogs'
import { NoticeAlert, type Notice } from '@/components/notice'
import { PageHeader, RowActions, TableEmpty, TableSkeleton } from '@/components/page'
import { ReuseDialog } from '@/components/reuse-dialog'
import { SectionStatusBadge } from '@/components/section-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatSize } from '@/lib/utils'
import {
  isReusable,
  itemName,
  pagesPerSheet,
  SECTION_SLOTS,
  SECTIONS,
  SECTIONS_WITH_PAGES,
  type SectionSlot,
  type SectionStatus,
} from '../sections.ts'
import { supabase } from '../supabase.ts'
import { deleteFile, deleteItem, uploadFile } from '../uploads.ts'

/** An item of a section with items, such as Lab 2. */
type SectionItem = { number: number; deletable: boolean }

type SectionFile = {
  id: string
  item: number | null
  slot: string | null
  name: string
  size: number
  uploaded_at: string
  uploader_name: string
  deletable: boolean
}

/** The offering, and the shared files of the section that its course file links. */
type Offering = {
  semester: { code: string }
  course: { code: string; title: string }
  linked_files: Omit<SectionFile, 'deletable'>[]
}

/** The page's data. An offering of null means it does not exist or the user may not read it. */
type PageData = { offering: Offering | null; status: SectionStatus | null; items: SectionItem[]; files: SectionFile[]; canUpload: boolean }

/** One list of files: the section's, or one slot's, of one item in a section with items. */
type Place = { item: number | null; slot: string | null }

/** A place that staff reuse a file into, and its name, such as Lab 2 Lab Sheet. */
type ReuseTarget = Place & { title: string }

/**
 * The file being uploaded, where it goes, its place in the batch, and how much of it has been
 * sent: null while the browser merges it.
 */
type Progress = Place & { name: string; index: number; count: number; fraction: number | null }

/** Below md the uploader and time move into the file cell, so a phone needs no sideways scroll. */
const WIDE = 'hidden md:table-cell'

/** The table's columns: drag handle, file, uploaded by, uploaded at and the row menu. */
const COLUMNS = ['', '', WIDE, WIDE, '']

/**
 * One section of a course file: its files in the order staff set, one list per slot when the
 * section has slots, and its numbered items in sections 11 to 16, each with the section's slots.
 * The offering's coordinator and lecturers add items, upload PDFs and drag them into order. The
 * uploader or the coordinator deletes a file, and staff who may delete every file in an item
 * delete the item. In a reusable place, such as Lecture Notes, staff also copy in a file from a past
 * offering of the same course. A section of a shared file, such as Academic Calendar, lists the file
 * that the course file links.
 */
export function CourseFileSection() {
  const params = useParams()
  const offeringId = params.offeringId!
  const section = SECTIONS.find((s) => String(s.number) === params.section && SECTIONS_WITH_PAGES.has(s.number))
  const slots = section && SECTION_SLOTS[section.number]
  const perSheet = section && pagesPerSheet({ section: section.number })
  /** How many pages the browser puts on each page of an answer script, in a section with script slots. */
  const scriptsPerSheet = slots?.find((slot) => slot.perSheet)?.perSheet
  const [data, setData] = useState<PageData | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<SectionFile | null>(null)
  const [deletingItem, setDeletingItem] = useState<SectionItem | null>(null)
  const [reusingInto, setReusingInto] = useState<ReuseTarget | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  /** Where the files picked next go. */
  const picking = useRef<Place>({ item: null, slot: null })

  const reload = useCallback(async () => {
    if (!section) return
    const [offering, items, files, canUpload, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select('semester:semesters(code), course:courses(code, title), linked_files(id, item, slot, name, size, uploaded_at, uploader_name)')
        .eq('id', offeringId)
        .eq('linked_files.section', section.number)
        .maybeSingle()
        .overrideTypes<Offering | null, { merge: false }>(),
      supabase
        .from('items')
        .select('number, deletable')
        .eq('offering_id', offeringId)
        .eq('section', section.number)
        .order('number')
        .overrideTypes<SectionItem[], { merge: false }>(),
      supabase
        .from('files')
        .select('id, item, slot, name, size, uploaded_at, uploader_name, deletable')
        .eq('offering_id', offeringId)
        .eq('section', section.number)
        .order('position')
        .order('uploaded_at')
        .overrideTypes<SectionFile[], { merge: false }>(),
      supabase.rpc('can_upload', { offering_id: offeringId, section: section.number }),
      supabase.rpc('section_statuses', { offering_id: offeringId }),
    ])
    const error = offering.error ?? items.error ?? files.error ?? canUpload.error ?? statuses.error
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      return
    }
    const status = (statuses.data as { section: number; status: SectionStatus }[]).find((row) => row.section === section.number)
    // The admin deletes a shared file on the semester page, which first lists the offerings that link it.
    const linkedFiles = (offering.data?.linked_files ?? []).map((file) => ({ ...file, deletable: false }))
    setData({
      offering: offering.data,
      status: status?.status ?? null,
      items: items.data ?? [],
      files: [...linkedFiles, ...(files.data ?? [])],
      canUpload: canUpload.data === true,
    })
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
  const filesIn = (place: Place) => files.filter((file) => file.item === place.item && file.slot === place.slot)
  const nextItem = (data?.items.at(-1)?.number ?? 0) + 1
  const progressPerSheet = progress && pagesPerSheet({ section: section.number, slot: progress.slot })

  function pick(place: Place, oneFile: boolean) {
    picking.current = place
    if (!picker.current) return
    picker.current.multiple = !oneFile
    picker.current.click()
  }

  /** Uploads the picked files one after another, then reports what was uploaded and what was refused. */
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    event.target.value = ''
    if (picked.length === 0) return
    const place = picking.current
    const target = { offeringId, section: section!.number, item: place.item ?? undefined, slot: place.slot ?? undefined }
    setNotice(null)
    const refused: string[] = []
    for (const [index, file] of picked.entries()) {
      setProgress({ ...place, name: file.name, index, count: picked.length, fraction: null })
      try {
        await uploadFile(supabase, target, file, (fraction) => setProgress({ ...place, name: file.name, index, count: picked.length, fraction }))
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

  /** Puts one list's files in a new order, shows it at once, and saves it. */
  async function reorder(reordered: SectionFile[]) {
    const { item, slot } = reordered[0]
    setData({ ...data!, files: [...files.filter((file) => file.item !== item || file.slot !== slot), ...reordered] })
    const { error } = await supabase.rpc('reorder_files', { file_ids: reordered.map((file) => file.id) })
    if (error) {
      setNotice({ tone: 'error', text: error.message })
      await reload()
    }
  }

  async function addItem() {
    setAdding(true)
    setNotice(null)
    const { data: added, error } = await supabase.rpc('add_item', { offering_id: offeringId, section: section!.number })
    if (error) setNotice({ tone: 'error', text: error.message })
    else {
      await reload()
      setNotice({ tone: 'success', text: `Added ${itemName(section!.number, added)}.` })
    }
    setAdding(false)
  }

  const uploadButton = (place: Place, oneFile = false) =>
    canUpload && (
      <Button variant={place.slot ? 'outline' : 'default'} onClick={() => pick(place, oneFile)} disabled={progress !== null}>
        {progress?.item === place.item && progress.slot === place.slot ? <Spinner /> : <UploadIcon />}
        {oneFile ? 'Upload PDF' : 'Upload PDFs'}
      </Button>
    )

  /** Opens the reuse picker for a reusable place. title names the place. */
  const reuseButton = (place: Place, title: string) =>
    canUpload &&
    isReusable({ section: section.number, slot: place.slot }) && (
      <Button variant="outline" onClick={() => setReusingInto({ ...place, title })} disabled={progress !== null}>
        <HistoryIcon />
        Reuse from past
      </Button>
    )

  const tableFor = (place: Place, label: string, oneFile = false) => (
    <FileTable
      label={label}
      files={data && filesIn(place)}
      canUpload={canUpload}
      compact={place.slot !== null}
      emptyDescription={
        data?.status === 'off'
          ? 'This section is off for this offering.'
          : section.sharedFile
            ? `The admin uploads the ${section.title} of each semester, and every course file of the semester links it.`
            : !canUpload
              ? 'The coordinator and lecturers upload files here.'
              : section.kind === 'may-be-empty'
                ? 'This section may stay empty. Upload PDF files if there are any.'
                : oneFile
                  ? 'Upload one PDF file.'
                  : 'Upload one or more PDF files.'
      }
      onReorder={(reordered) => void reorder(reordered)}
      onDelete={setDeleting}
    />
  )

  /** One slot's heading, upload button and files. A slot that holds one file takes no upload while it has it. */
  const slotList = (item: number | null, slot: SectionSlot) => {
    const place = { item, slot: slot.name }
    const title = item === null ? slot.title : `${itemName(section.number, item)} ${slot.title}`
    const Heading = item === null ? 'h2' : 'h3'
    return (
      <section key={slot.name} aria-label={title} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Heading className={cn('font-semibold tracking-tight', item === null && 'text-lg')}>{slot.title}</Heading>
            {slot.oneFile && <Badge variant="secondary">One file</Badge>}
            {slot.perSheet && <Badge variant="secondary">{slot.perSheet} pages to a page</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {reuseButton(place, title)}
            {!(slot.oneFile && filesIn(place).length > 0) && uploadButton(place, slot.oneFile)}
          </div>
        </div>
        {tableFor(place, `${title} files`, slot.oneFile)}
      </section>
    )
  }

  const itemList = !data ? (
    tableFor({ item: null, slot: null }, 'Files')
  ) : data.items.length === 0 ? (
    <Card className="py-0">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayersIcon />
          </EmptyMedia>
          <EmptyTitle>No items yet</EmptyTitle>
          <EmptyDescription>
            {data.status === 'off'
              ? 'This section is off for this offering.'
              : canUpload
                ? `Add ${itemName(section.number, 1)} to upload its files.`
                : 'The coordinator and lecturers add items here.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Card>
  ) : (
    data.items.map((item) => {
      const name = itemName(section.number, item.number)
      return (
        <section key={item.number} aria-label={name} className="bg-muted/30 grid gap-6 rounded-xl border p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
            {item.deletable && (
              <Button variant="outline" size="sm" onClick={() => setDeletingItem(item)}>
                <Trash2Icon />
                Delete {name}
              </Button>
            )}
          </div>
          {slots!.map((slot) => slotList(item.number, slot))}
        </section>
      )
    })
  )

  const deletingItemName = deletingItem && itemName(section.number, deletingItem.number)
  const deletingItemFiles = deletingItem ? files.filter((file) => file.item === deletingItem.number).length : 0

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
            {section.itemTitle
              ? canUpload && (
                  <Button onClick={() => void addItem()} disabled={adding}>
                    {adding ? <Spinner /> : <PlusIcon />}
                    Add {itemName(section.number, nextItem)}
                  </Button>
                )
              : !slots && (
                  <>
                    {reuseButton({ item: null, slot: null }, section.title)}
                    {uploadButton({ item: null, slot: null })}
                  </>
                )}
          </div>
        }
      />
      <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {data?.status && <SectionStatusBadge status={data.status} />}
        {canUpload && (
          <span>
            {perSheet
              ? `PDF files, merged ${perSheet} pages to a page in your browser. A merged file can be at most 20 MB.`
              : scriptsPerSheet
                ? `PDF files of up to 20 MB. Your browser merges answer scripts ${scriptsPerSheet} pages to a page first, and the limit applies to the merged file.`
                : 'PDF files of up to 20 MB.'}{' '}
            Drag files to set their order in the compiled course file.
          </span>
        )}
      </div>

      {progress && (
        <p role="status" className="text-sm">
          {progress.fraction === null && progressPerSheet
            ? `Merging ${progress.name} ${progressPerSheet} pages to a page (${progress.index + 1} of ${progress.count})`
            : `Uploading ${progress.name} (${progress.index + 1} of ${progress.count}), ${Math.round((progress.fraction ?? 0) * 100)}%`}
        </p>
      )}
      {notice && <NoticeAlert notice={notice} />}

      {section.itemTitle ? itemList : slots ? slots.map((slot) => slotList(null, slot)) : tableFor({ item: null, slot: null }, 'Files')}

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

      {reusingInto && data?.offering && (
        <ReuseDialog
          slot={{ offeringId, section: section.number, item: reusingInto.item ?? undefined, slot: reusingInto.slot ?? undefined }}
          title={reusingInto.title}
          courseCode={data.offering.course.code}
          onClose={() => setReusingInto(null)}
          onReused={async (file) => {
            await reload()
            setNotice({ tone: 'success', text: `Copied ${file.name} from ${file.semester_code}.` })
          }}
        />
      )}

      {deletingItem && (
        <ConfirmDialog
          title={`Delete ${deletingItemName}?`}
          description={
            deletingItemFiles === 0
              ? `${deletingItemName} has no files. It is removed from this course file.`
              : `${deletingItemName} and its ${deletingItemFiles === 1 ? 'file' : plural(deletingItemFiles, 'file')} are deleted for good, from SharePoint and from this course file.`
          }
          confirmLabel={`Delete ${deletingItemName}`}
          destructive
          onClose={() => setDeletingItem(null)}
          onConfirm={async () => {
            try {
              await deleteItem(supabase, { offeringId, section: section.number, item: deletingItem.number })
            } catch (error) {
              return error instanceof Error ? error.message : String(error)
            }
            await reload()
            setNotice({ tone: 'success', text: `Deleted ${deletingItemName}.` })
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
 * A compact table, one of several slots on the page, says it is empty in one line.
 */
function FileTable({
  label,
  files,
  canUpload,
  compact,
  emptyDescription,
  onReorder,
  onDelete,
}: {
  label: string
  files: SectionFile[] | null
  canUpload: boolean
  compact: boolean
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
          ) : files.length === 0 && compact ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={COLUMNS.length} className="text-muted-foreground px-4 py-3 whitespace-normal">
                No files yet. {emptyDescription}
              </TableCell>
            </TableRow>
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
