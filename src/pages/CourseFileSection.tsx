import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, FileTextIcon, GripVerticalIcon, HistoryIcon, LayersIcon, PlusIcon, PowerIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/action-dialogs'
import { FileLink, FileMenuItems } from '@/components/file-link'
import { EmptyState, LoadError, NotFound, PageActions, PageHeader, RowActions, TableCard, TableEmpty, TableSkeleton } from '@/components/page'
import { ReuseDialog } from '@/components/reuse-dialog'
import { SectionPager } from '@/components/section-pager'
import { useSectionSwitch } from '@/components/section-switch'
import { SectionVerdict } from '@/components/section-verdict'
import { Time } from '@/components/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatSize, plural } from '@/lib/utils'
import { useAuth } from '../auth-provider.tsx'
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
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'
import { deleteFile, deleteItem, listReusableFiles, uploadFile, type ReusableFile } from '../uploads.ts'

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
  semester_id: string
  semester: { code: string }
  course: { code: string; title: string }
  linked_files: Omit<SectionFile, 'deletable'>[]
  /** The switchable sections that are on. */
  sections_on: number[]
  /** The reason for each switchable section whose setting differs from the course type, by section number. */
  section_reasons: Record<string, string>
  /** Every lecturer of the offering, the coordinator included. */
  lecturers: { lecturer_id: string }[]
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

/**
 * One section of a course file: its files in the order staff set, one list per slot when the
 * section has slots, and its numbered items in sections 11 to 16, each with the section's slots,
 * then its review and links to the sections either side. Each file opens in a new tab. The
 * offering's coordinator and lecturers add items, upload PDFs and drag them into order, and switch
 * a switched-off section back on. The uploader or the coordinator deletes a file, and staff who may
 * delete every file in an item delete the item. In a reusable place, such as Lecture Notes, staff
 * also copy in a file from a past offering of the same course. A section of a shared file, such as
 * Academic Calendar, lists the file that the course file links.
 */
export function CourseFileSection() {
  const params = useParams()
  const offeringId = params.offeringId!
  const section = SECTIONS.find((s) => String(s.number) === params.section && SECTIONS_WITH_PAGES.has(s.number))
  const slots = section && SECTION_SLOTS[section.number]
  const perSheet = section && pagesPerSheet({ section: section.number })
  const [data, setData] = useState<PageData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<SectionFile | null>(null)
  const [deletingItem, setDeletingItem] = useState<SectionItem | null>(null)
  const [reusingInto, setReusingInto] = useState<ReuseTarget | null>(null)
  /** The files of past offerings that staff may reuse, by slot name, or under null in a section without slots. */
  const [reusable, setReusable] = useState<ReadonlyMap<string | null, ReusableFile[]>>(new Map())
  const auth = useAuth()
  const picker = useRef<HTMLInputElement>(null)
  /** Where the files picked next go. */
  const picking = useRef<Place>({ item: null, slot: null })

  const reload = useCallback(async () => {
    if (!section) return
    const [offering, items, files, canUpload, statuses] = await Promise.all([
      supabase
        .from('offerings')
        .select(
          'semester_id, semester:semesters(code), course:courses(code, title), sections_on, section_reasons, lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id), linked_files(id, item, slot, name, size, uploaded_at, uploader_name)',
        )
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
    const failed = Boolean(offering.error ?? items.error ?? files.error ?? canUpload.error ?? statuses.error)
    setLoadFailed(failed)
    if (failed) return
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

  const canUpload = data?.canUpload ?? false
  const firstItem = data?.items[0]?.number

  // Reuse from past shows only where there is something to reuse. The list of a slot is the same for
  // every item, so the first item's stands for all.
  useEffect(() => {
    if (!section || !canUpload || (section.itemTitle && firstItem === undefined)) return
    const slotNames = (SECTION_SLOTS[section.number]?.map((slot) => slot.name) ?? [null]).filter((slot) => isReusable({ section: section.number, slot }))
    let current = true
    Promise.all(
      slotNames.map(async (slot) => [slot, await listReusableFiles(supabase, { offeringId, section: section.number, item: firstItem, slot: slot ?? undefined })] as const),
    ).then(
      (lists) => current && setReusable(new Map(lists)),
      () => {},
    )
    return () => {
      current = false
    }
  }, [offeringId, section, canUpload, firstItem])

  const { request: requestSwitch, switching, dialog: switchDialog } = useSectionSwitch(offeringId, reload)

  const backLink = (
    <Button asChild variant="outline">
      <Link to={`/course-files/${offeringId}`}>
        <ArrowLeftIcon />
        Course file
      </Link>
    </Button>
  )

  if (!section || (data && !data.offering)) {
    return <NotFound icon={FileTextIcon} title="Section not found" backTo="/course-files" backLabel="All course files" />
  }

  if (loadFailed) {
    return (
      <div className="grid gap-6">
        <PageHeader title={section.title} action={backLink} />
        <Card className="py-0">
          <LoadError title="Couldn't load this section" onRetry={reload} />
        </Card>
      </div>
    )
  }

  const files = data?.files ?? []
  /** Whether the offering has this switchable section off. Its status may be a verdict instead of Off. */
  const isOff = section.kind === 'switchable' && data?.offering?.sections_on.includes(section.number) === false
  const userId = auth.kind === 'ready' ? auth.profile.id : null
  const isStaff = data?.offering?.lecturers.some((lecturer) => lecturer.lecturer_id === userId) ?? false
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
    /** Why each refused file was refused, naming the file. */
    const refused: string[] = []
    for (const [index, file] of picked.entries()) {
      setProgress({ ...place, name: file.name, index, count: picked.length, fraction: null })
      try {
        await uploadFile(supabase, target, file, (fraction) => setProgress({ ...place, name: file.name, index, count: picked.length, fraction }))
      } catch (error) {
        const reason = friendlyError(error)
        refused.push(reason.includes(file.name) ? reason : `${file.name}: ${reason}`)
      }
    }
    setProgress(null)
    await reload()
    const uploaded = picked.length - refused.length
    if (refused.length === 0) toast.success(picked.length === 1 ? `Uploaded ${picked[0].name}` : `Uploaded ${plural(uploaded, 'file')}`)
    else if (picked.length === 1) toast.error(refused[0])
    else {
      toast.error(uploaded === 0 ? `Couldn't upload ${plural(picked.length, 'file')}` : `Uploaded ${uploaded} of ${plural(picked.length, 'file')}`, {
        description: (
          <ul className="grid gap-1">
            {refused.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ),
        duration: 10_000,
      })
    }
  }

  /** Puts one list's files in a new order, shows it at once, and saves it. */
  async function reorder(reordered: SectionFile[]) {
    const { item, slot } = reordered[0]
    setData({ ...data!, files: [...files.filter((file) => file.item !== item || file.slot !== slot), ...reordered] })
    const { error } = await supabase.rpc('reorder_files', { file_ids: reordered.map((file) => file.id) })
    if (error) {
      toast.error(friendlyError(error))
      await reload()
    }
  }

  async function addItem() {
    setAdding(true)
    const { data: added, error } = await supabase.rpc('add_item', { offering_id: offeringId, section: section!.number })
    if (error) toast.error(friendlyError(error))
    else {
      await reload()
      toast.success(`Added ${itemName(section!.number, added)}`)
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

  /** Opens the reuse picker for a place with files to reuse. title names the place. */
  const reuseButton = (place: Place, title: string) =>
    canUpload &&
    (reusable.get(place.slot)?.length ?? 0) > 0 && (
      <Button variant="outline" onClick={() => setReusingInto({ ...place, title })} disabled={progress !== null}>
        <HistoryIcon />
        Reuse from past
      </Button>
    )

  /** What a place takes, such as "PDF · max 20 MB · 8 pages per sheet", for staff who upload to it. */
  const uploadRule = (oneFile: boolean) =>
    [section.kind === 'may-be-empty' && 'Optional', oneFile ? 'One PDF' : 'PDF', 'max 20 MB', perSheet && `${perSheet} pages per sheet`]
      .filter(Boolean)
      .join(' · ')

  const tableFor = (place: Place, label: string, oneFile = false) => (
    <FileTable
      label={label}
      files={data && filesIn(place)}
      canUpload={canUpload}
      compact={place.slot !== null}
      empty={
        section.sharedFile
            ? { title: `Not uploaded for ${data?.offering?.semester.code ?? 'this semester'} yet` }
            : { title: 'No files yet', description: canUpload ? uploadRule(oneFile) : undefined }
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
            {slot.perSheet && <Badge variant="secondary">{slot.perSheet} pages per sheet</Badge>}
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

  const addItemButton = canUpload && (
    <Button onClick={() => void addItem()} disabled={adding}>
      {adding ? <Spinner /> : <PlusIcon />}
      Add {itemName(section.number, nextItem)}
    </Button>
  )

  const itemList = !data ? (
    tableFor({ item: null, slot: null }, 'Files')
  ) : data.items.length === 0 ? (
    <Card className="py-0">
      <EmptyState icon={LayersIcon} title="No items yet" action={addItemButton} />
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
        parent={data?.offering && { title: `${data.offering.course.code} ${data.offering.course.title}`, to: `/course-files/${offeringId}` }}
        areaTo={data?.offering && `/course-files?semester=${data.offering.semester_id}`}
        description={
          data
            ? `Section ${section.number} · ${data.offering!.course.code} ${data.offering!.course.title} · ${data.offering!.semester.code}`
            : `Section ${section.number}`
        }
        action={
          <PageActions>
            {backLink}
            {section.itemTitle
              ? addItemButton
              : !slots && (
                  <>
                    {reuseButton({ item: null, slot: null }, section.title)}
                    {uploadButton({ item: null, slot: null })}
                  </>
                )}
          </PageActions>
        }
      />
      <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void upload(event)} />

      {progress && (
        <p role="status" className="text-sm">
          {progress.fraction === null && progressPerSheet
            ? `Merging ${progress.name} at ${progressPerSheet} pages per sheet (${progress.index + 1} of ${progress.count})`
            : `Uploading ${progress.name} (${progress.index + 1} of ${progress.count}), ${Math.round((progress.fraction ?? 0) * 100)}%`}
        </p>
      )}
      {isOff && (
        <Card className="py-0">
          <EmptyState
            icon={PowerIcon}
            title={`${section.title} is off`}
            action={
              isStaff && (
                <Button
                  variant="outline"
                  disabled={switching !== null}
                  onClick={() =>
                    void requestSwitch({ section: section.number, title: section.title, isOn: true, reason: data?.offering?.section_reasons[section.number] })
                  }
                >
                  {switching ? <Spinner /> : <PowerIcon />}
                  Switch on
                </Button>
              )
            }
          />
        </Card>
      )}
      {/* A switched-off section shows the files and items it still has. */}
      {!(isOff && files.length === 0 && data?.items.length === 0) &&
        (section.itemTitle ? itemList : slots ? slots.map((slot) => slotList(null, slot)) : tableFor({ item: null, slot: null }, 'Files'))}

      <SectionVerdict offeringId={offeringId} section={section.number} sectionTitle={section.title} status={data?.status ?? null} onRecorded={reload} />
      <SectionPager offeringId={offeringId} section={section.number} />

      {deleting && (
        <ConfirmDialog
          title="Delete file?"
          description={`${deleting.name} will be permanently deleted.`}
          confirmLabel="Delete"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteFile(supabase, deleting.id)
            } catch (error) {
              return friendlyError(error)
            }
            await reload()
            toast.success(`Deleted ${deleting.name}`)
            return null
          }}
        />
      )}

      {reusingInto && data?.offering && (
        <ReuseDialog
          slot={{ offeringId, section: section.number, item: reusingInto.item ?? undefined, slot: reusingInto.slot ?? undefined }}
          title={reusingInto.title}
          courseCode={data.offering.course.code}
          files={reusable.get(reusingInto.slot) ?? []}
          onClose={() => setReusingInto(null)}
          onReused={async (file) => {
            await reload()
            toast.success(`Copied ${file.name} from ${file.semester_code}`)
          }}
        />
      )}

      {deletingItem && (
        <ConfirmDialog
          title={`Delete ${deletingItemName}?`}
          description={
            deletingItemFiles > 0
              ? `${deletingItemName} and its ${deletingItemFiles === 1 ? 'file' : plural(deletingItemFiles, 'file')} will be permanently deleted.`
              : undefined
          }
          confirmLabel="Delete"
          destructive
          onClose={() => setDeletingItem(null)}
          onConfirm={async () => {
            try {
              await deleteItem(supabase, { offeringId, section: section.number, item: deletingItem.number })
            } catch (error) {
              return friendlyError(error)
            }
            await reload()
            toast.success(`Deleted ${deletingItemName}`)
            return null
          }}
        />
      )}
      {switchDialog}
    </div>
  )
}

/**
 * One section's or slot's files in their order, or placeholder rows while they load. Each file's
 * name opens it in a new tab. Staff who may upload reorder two or more files with the row menu, or
 * by dragging rows on a wider screen. Rows drag only within this table. A compact table, one of
 * several slots on the page, says it is empty in one line.
 */
function FileTable({
  label,
  files,
  canUpload,
  compact,
  empty,
  onReorder,
  onDelete,
}: {
  label: string
  files: SectionFile[] | null
  canUpload: boolean
  compact: boolean
  /** What the table says while it has no files. */
  empty: { title: string; description?: string }
  onReorder: (files: SectionFile[]) => void
  onDelete: (file: SectionFile) => void
}) {
  const [dragged, setDragged] = useState<string | null>(null)
  const reorderable = canUpload && (files?.length ?? 0) > 1
  /** The table's columns: the drag handle while rows reorder, file, uploaded by, uploaded at and the row menu. */
  const columns = [...(reorderable ? [WIDE] : []), '', WIDE, WIDE, '']

  function move(fileId: string, to: number) {
    if (!files) return
    const from = files.findIndex((file) => file.id === fileId)
    if (from === -1 || from === to || to < 0 || to >= files.length) return
    onReorder(files.toSpliced(from, 1).toSpliced(to, 0, files[from]))
  }

  return (
    <TableCard>
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            {reorderable && (
              <TableHead className={cn('w-10 px-2', WIDE)}>
                <span className="sr-only">Order</span>
              </TableHead>
            )}
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
            <TableSkeleton columns={columns} />
          ) : files.length === 0 && compact ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="text-muted-foreground px-4 py-3 whitespace-normal">
                {empty.title}
                {empty.description && <span className="text-xs"> · {empty.description}</span>}
              </TableCell>
            </TableRow>
          ) : files.length === 0 ? (
            <TableEmpty columns={columns.length} icon={FileTextIcon} title={empty.title} description={empty.description} />
          ) : (
            files.map((file, index) => {
              const uploadedAt = <Time value={file.uploaded_at} />
              return (
                <TableRow
                  key={file.id}
                  draggable={reorderable}
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
                  {reorderable && (
                    <TableCell className={cn('text-muted-foreground px-2 py-3', WIDE)}>
                      <GripVerticalIcon aria-hidden="true" className="mx-auto size-4 cursor-grab" />
                    </TableCell>
                  )}
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="grid gap-0.5">
                      <FileLink file={file} />
                      <span className="text-muted-foreground text-xs">{formatSize(file.size)}</span>
                      <span className="text-muted-foreground text-xs md:hidden">
                        {file.uploader_name} · {uploadedAt}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={cn('px-4 py-3 whitespace-normal', WIDE)}>{file.uploader_name}</TableCell>
                  <TableCell className={cn('px-4 py-3', WIDE)}>{uploadedAt}</TableCell>
                  <TableCell className="px-4 py-2 text-right">
                    <RowActions label={`Actions for ${file.name}`}>
                      <FileMenuItems file={file} />
                      {reorderable && (
                        <>
                          <DropdownMenuSeparator />
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
                      {file.deletable && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file)}>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowActions>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </TableCard>
  )
}
