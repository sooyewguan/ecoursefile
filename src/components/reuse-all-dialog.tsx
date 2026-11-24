import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LoadError } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatSize, plural } from '@/lib/utils'
import { friendlyError } from '../errors.ts'
import { pastSemesters, REUSE_PLACES, reusePlan, type PlacedFile, type ReusableList, type ReuseCopy } from '../reuse.ts'
import { itemName, SECTION_SLOTS, SECTIONS } from '../sections.ts'
import { supabase } from '../supabase.ts'
import { listReusableFiles, reuseFile } from '../uploads.ts'

/** The course file's reusable places with what past offerings hold in each, and the course file's own files and items there. */
type Loaded = { lists: ReusableList[]; files: PlacedFile[]; items: { section: number; number: number }[] }

/** Where the dialog is: loading what can be reused, choosing, copying, or done with what it copied and why any copy failed. */
type Stage =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'choosing'; loaded: Loaded }
  | { kind: 'copying'; step: string; done: number; total: number }
  | { kind: 'done'; semester: string; copied: number; held: number; refused: string[] }

/** The sections with reusable places, in order. */
const REUSE_SECTIONS = SECTIONS.filter((section) => REUSE_PLACES.some((place) => place.section === section.number))

/** Where a copy goes, such as Lab 2 Lab Sheet, or Lecture Notes. */
function placeName({ section, item, slot }: Pick<ReuseCopy, 'section' | 'item' | 'slot'>) {
  const slotTitle = SECTION_SLOTS[section]?.find((s) => s.name === slot)?.title
  return item === null ? SECTIONS.find((s) => s.number === section)!.title : `${itemName(section, item)} ${slotTitle}`
}

/**
 * Reuse all: copies every file of one past offering of the same course that a reusable place of
 * this course file can take, which is its lecture notes, and the lab sheets and answer schemes, and
 * tutorial questions and answer schemes, of its labs and tutorials. Each goes to the same lab or
 * tutorial number, and the course file adds the labs and tutorials it lacks. A file it already has
 * there, by name and size, stays as it is. Sections that the offering has off take nothing.
 * sectionsOn are the switchable sections the offering has on. onCopied runs once the copies are
 * made, so the page can reload. The dialog is open while it is mounted.
 */
export function ReuseAllDialog({
  offeringId,
  courseCode,
  sectionsOn,
  onCopied,
  onClose,
}: {
  offeringId: string
  courseCode: string
  sectionsOn: number[]
  onCopied: () => Promise<void>
  onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [semester, setSemester] = useState<string | null>(null)
  /** The sections the user left out. */
  const [leftOut, setLeftOut] = useState<ReadonlySet<number>>(new Set())
  const [attempt, setAttempt] = useState(0)
  /** The sections that were on when the dialog opened. The page reloads after the copies, with a new list. */
  const [opened] = useState(sectionsOn)

  useEffect(() => {
    let current = true
    const places = REUSE_PLACES.filter((place) => opened.includes(place.section))
    const sections = REUSE_SECTIONS.map((section) => section.number)
    Promise.all([
      Promise.all(
        places.map(async (place) => ({
          place,
          // The list of a slot is the same for every item, so any item number names it.
          files: await listReusableFiles(supabase, { offeringId, section: place.section, item: place.slot ? 1 : undefined, slot: place.slot ?? undefined }),
        })),
      ),
      supabase.from('files').select('section, item, slot, name, size').eq('offering_id', offeringId).in('section', sections).overrideTypes<PlacedFile[], { merge: false }>(),
      supabase.from('items').select('section, number').eq('offering_id', offeringId).in('section', sections).overrideTypes<Loaded['items'], { merge: false }>(),
    ]).then(
      ([lists, files, items]) => {
        if (!current) return
        if (files.error || items.error) return setStage({ kind: 'failed' })
        setSemester(pastSemesters(lists)[0] ?? null)
        setStage({ kind: 'choosing', loaded: { lists, files: files.data, items: items.data } })
      },
      () => current && setStage({ kind: 'failed' }),
    )
    return () => {
      current = false
    }
  }, [offeringId, opened, attempt])

  const loaded = stage.kind === 'choosing' ? stage.loaded : null
  const plan = loaded && semester ? reusePlan(loaded.lists, semester, loaded.files, loaded.items) : null
  /** The plan without the sections the user left out. */
  const chosen = loaded && semester ? reusePlan(loaded.lists.filter((list) => !leftOut.has(list.place.section)), semester, loaded.files, loaded.items) : null
  const toCopy = chosen?.copies.filter((copy) => !copy.held) ?? []

  async function copyAll() {
    if (!chosen || !semester) return
    const total = chosen.newItems.reduce((sum, { count }) => sum + count, 0) + toCopy.length
    let done = 0
    let copied = 0
    const refused: string[] = []
    for (const { section, count } of chosen.newItems) {
      for (let added = 0; added < count; added++) {
        setStage({ kind: 'copying', step: `Adding a ${SECTIONS.find((s) => s.number === section)!.itemTitle}`, done, total })
        const { error } = await supabase.rpc('add_item', { offering_id: offeringId, section })
        if (error) refused.push(friendlyError(error))
        done++
      }
    }
    for (const copy of toCopy) {
      setStage({ kind: 'copying', step: `Copying ${copy.file.name} to ${placeName(copy)}`, done, total })
      try {
        await reuseFile(supabase, { offeringId, section: copy.section, item: copy.item ?? undefined, slot: copy.slot ?? undefined }, copy.file.id)
        copied++
      } catch (error) {
        refused.push(`${copy.file.name} to ${placeName(copy)}: ${friendlyError(error)}`)
      }
      done++
    }
    await onCopied()
    setStage({ kind: 'done', semester, copied, held: chosen.copies.length - toCopy.length, refused })
  }

  const copying = stage.kind === 'copying'
  const semesters = loaded ? pastSemesters(loaded.lists) : []

  return (
    <Dialog open onOpenChange={(open) => !open && !copying && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl" showCloseButton={!copying}>
        <DialogHeader>
          <DialogTitle className="leading-snug">Reuse all from a past semester</DialogTitle>
          <DialogDescription>
            The lecture notes, lab sheets, tutorial questions and answer schemes of a past {courseCode} offering, each copied to the same lab or tutorial.
          </DialogDescription>
        </DialogHeader>

        {stage.kind === 'loading' && (
          <div aria-hidden="true" className="grid gap-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {stage.kind === 'failed' && <LoadError title="Couldn't load the files of past semesters" onRetry={() => (setStage({ kind: 'loading' }), setAttempt((n) => n + 1))} />}
        {loaded && semesters.length === 0 && <p className="text-muted-foreground text-sm">No past semester of {courseCode} has files to reuse.</p>}
        {plan && (
          <div className="grid gap-5">
            {semesters.length > 1 && (
              <div className="grid gap-2 sm:w-56">
                <Label htmlFor="reuse-semester">From</Label>
                <NativeSelect id="reuse-semester" value={semester!} onChange={(event) => setSemester(event.target.value)}>
                  {semesters.map((code) => (
                    <NativeSelectOption key={code} value={code}>
                      {code}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
            {semesters.length === 1 && <p className="text-sm">From {semester}</p>}
            <ul aria-label="What to copy" className="grid gap-4">
              {REUSE_SECTIONS.map((section) => {
                const copies = plan.copies.filter((copy) => copy.section === section.number)
                const id = `reuse-section-${section.number}`
                if (!opened.includes(section.number)) {
                  return (
                    <li key={section.number} className="text-muted-foreground text-sm">
                      {section.title} is off in this course file, so it takes nothing.
                    </li>
                  )
                }
                const held = copies.filter((copy) => copy.held).length
                const items = [...new Set(copies.map((copy) => copy.item).filter((item) => item !== null))]
                return (
                  <li key={section.number} className="grid gap-2">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={copies.length > 0 && !leftOut.has(section.number)}
                        disabled={copies.length === 0}
                        onCheckedChange={(checked) =>
                          setLeftOut((sections) => {
                            const next = new Set(sections)
                            if (checked === true) next.delete(section.number)
                            else next.add(section.number)
                            return next
                          })
                        }
                      />
                      <div className="grid gap-0.5">
                        <Label htmlFor={id} className="font-medium">
                          {section.title}
                        </Label>
                        <span className="text-muted-foreground text-sm">
                          {copies.length === 0
                            ? `Nothing to reuse from ${semester}`
                            : [
                                items.length > 0 && (items.length === 1 ? itemName(section.number, items[0]!) : `${itemName(section.number, items[0]!)} to ${items.at(-1)}`),
                                plural(copies.length, 'file'),
                                held > 0 && `${held} already here`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                      </div>
                    </div>
                    {copies.length > 0 && (
                      <ul className="border-muted ml-7 grid gap-1 border-l pl-3 text-sm">
                        {copies.map((copy) => (
                          <li key={copy.file.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {copy.item !== null && <span className="text-muted-foreground">{placeName(copy)}</span>}
                            <span className="break-all">{copy.file.name}</span>
                            <span className="text-muted-foreground text-xs">{formatSize(copy.file.size)}</span>
                            {copy.held && <Badge variant="secondary">Already here</Badge>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {stage.kind === 'copying' && (
          <div className="grid gap-2" role="status">
            <p className="text-sm break-words">
              {stage.step} ({Math.min(stage.done + 1, stage.total)} of {stage.total})
            </p>
            <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
              <div className="bg-primary h-full rounded-full transition-[width]" style={{ width: `${(stage.done / Math.max(1, stage.total)) * 100}%` }} />
            </div>
          </div>
        )}
        {stage.kind === 'done' && (
          <div className="grid gap-3" role="status">
            <p className="flex items-start gap-2 text-sm">
              {stage.refused.length === 0 ? <CircleCheckIcon className="text-success mt-0.5 size-4 shrink-0" /> : <CircleAlertIcon className="text-destructive mt-0.5 size-4 shrink-0" />}
              <span>
                Copied {plural(stage.copied, 'file')} from {stage.semester}.
                {stage.held > 0 && ` ${plural(stage.held, 'file')} ${stage.held === 1 ? 'was' : 'were'} here already.`}
              </span>
            </p>
            {stage.refused.length > 0 && (
              <ul aria-label="Not copied" className="text-destructive grid gap-1 text-sm">
                {stage.refused.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {stage.kind === 'done' ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={copying}>
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={copying || toCopy.length === 0} onClick={() => void copyAll()}>
                {toCopy.length === 0 ? 'Nothing new to copy' : `Copy ${plural(toCopy.length, 'file')}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
