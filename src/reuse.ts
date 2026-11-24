import { alreadyHeld, type NamedFile } from './duplicates.ts'
import { isReusable, SECTION_SLOTS, SECTIONS } from './sections.ts'
import type { ReusableFile } from './uploads.ts'

/**
 * A place of a course file that files of past offerings can be reused into: Lecture Notes, or a
 * reusable slot, such as Lab Sheet, of every item of a section with items.
 */
export type ReusePlace = { section: number; slot: string | null }

/** Every reusable place of a course file, in section and slot order. */
export const REUSE_PLACES: readonly ReusePlace[] = SECTIONS.flatMap(({ number }) =>
  (SECTION_SLOTS[number]?.map((slot) => slot.name) ?? [null]).filter((slot) => isReusable({ section: number, slot })).map((slot) => ({ section: number, slot })),
)

/** The files of past offerings that one reusable place can take, as list-reusable-files gives them. */
export type ReusableList = { place: ReusePlace; files: ReusableFile[] }

/** A file of the course file: where it is, and what tells it apart. */
export type PlacedFile = NamedFile & { section: number; item: number | null; slot: string | null }

/**
 * One file of a past offering to copy into the course file, at the same section, item number and
 * slot. held is true when the course file already has a file of its name and size there.
 */
export type ReuseCopy = { section: number; item: number | null; slot: string | null; file: ReusableFile; held: boolean }

/**
 * What Reuse all copies from the offering of semesterCode: every file it has in a listed place, in
 * section, item and slot order, and how many items each section with items must add first, since
 * a new item takes the number after the section's highest. items holds the course file's items.
 */
export function reusePlan(lists: readonly ReusableList[], semesterCode: string, files: readonly PlacedFile[], items: readonly { section: number; number: number }[]) {
  const copies: ReuseCopy[] = lists
    .flatMap(({ place, files: listed }) =>
      listed
        .filter((file) => file.semester_code === semesterCode)
        .map((file) => {
          const held = files.filter((own) => own.section === place.section && own.item === file.item && own.slot === place.slot)
          return { ...place, item: file.item, file, held: alreadyHeld([file], held).length > 0 }
        }),
    )
    .toSorted((a, b) => a.section - b.section || (a.item ?? 0) - (b.item ?? 0) || slotIndex(a) - slotIndex(b))
  const newItems = SECTIONS.filter((section) => section.itemTitle).flatMap(({ number }) => {
    const highest = Math.max(0, ...items.filter((item) => item.section === number).map((item) => item.number))
    const needed = Math.max(0, ...copies.filter((copy) => copy.section === number && !copy.held).map((copy) => copy.item ?? 0))
    return needed > highest ? [{ section: number, count: needed - highest }] : []
  })
  return { copies, newItems }
}

function slotIndex({ section, slot }: ReusePlace) {
  return SECTION_SLOTS[section]?.findIndex((s) => s.name === slot) ?? 0
}

/** The semesters of the past offerings that the lists hold files of, the latest first. */
export function pastSemesters(lists: readonly ReusableList[]) {
  return [...new Set(lists.flatMap((list) => list.files.map((file) => file.semester_code)))].toSorted().toReversed()
}
