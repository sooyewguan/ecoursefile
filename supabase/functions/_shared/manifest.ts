// The compile manifest: what the browser needs to compile one course file into one PDF. The files
// Edge Function builds it, and the PDF engine's compile reads it.
import { SECTION_SLOTS, SECTIONS } from './sections.ts'

/** What the cover page shows. lecturers holds every lecturer of the offering, the coordinator first and then by name. */
export type ManifestCover = {
  courseCode: string
  courseTitle: string
  semester: string
  department: string
  coordinator: string
  lecturers: string[]
}

/** One file: its id, its name, and a short-lived URL that gets its bytes without an Authorization header. */
export type ManifestFile = { id: string; name: string; url: string }

/** One section that goes into the PDF, with its files in the order they compile. */
export type ManifestSection = { number: number; title: string; files: ManifestFile[] }

/** The cover, and the sections that go into the PDF in the fixed order. */
export type CompileManifest = { cover: ManifestCover; sections: ManifestSection[] }

/** A file of the offering, or a shared file its course file links, as the files function reads it. */
export type SourceFile = {
  id: string
  section: number
  item: number | null
  slot: string | null
  position: number
  uploaded_at: string
  name: string
  storage_item_id: string
  lecturer_id: string | null
  program_code: { code: string } | null
}

/** The offering as the files function reads it with the service role. MANIFEST_SELECT selects it. */
export type ManifestSource = {
  coordinator_id: string
  sections_on: number[]
  semester: { code: string }
  course: { code: string; title: string; department: { name: string } }
  lecturers: { lecturer_id: string; lecturer_name: string }[]
  files: SourceFile[]
  linked_files: SourceFile[]
}

const FILE_COLUMNS = 'id,section,item,slot,position,uploaded_at,name,storage_item_id,lecturer_id,program_code:program_codes(code)'

/** The PostgREST select of an offering that gives a ManifestSource. */
export const MANIFEST_SELECT = [
  'coordinator_id',
  'sections_on',
  'semester:semesters(code)',
  'course:courses(code,title,department:departments(name))',
  'lecturers:offering_lecturers!offering_lecturers_offering_id_fkey(lecturer_id,lecturer_name)',
  `files(${FILE_COLUMNS})`,
  `linked_files(${FILE_COLUMNS})`,
].join(',')

/** How many download URLs the manifest asks the storage library for at a time. */
const URL_REQUESTS_AT_ONCE = 8

/**
 * The manifest of the offering. Its sections are those of SECTIONS that are on, in their order,
 * except sections that may stay empty (7 to 9) while they have no files. A section that is on but
 * has no files is still listed, so its divider shows the gap. A section's files are its own, by
 * item, then by slot in SECTION_SLOTS order, then in the order staff set, and the shared files the
 * course file links: the lecturer timetables in the order of the cover's lecturers, and the
 * student timetables by program code. downloadUrl gives the URL of each listed file's stored item.
 */
export async function buildManifest(source: ManifestSource, downloadUrl: (storageItemId: string) => Promise<string>): Promise<CompileManifest> {
  const lecturers = source.lecturers.toSorted(
    (a, b) => Number(b.lecturer_id === source.coordinator_id) - Number(a.lecturer_id === source.coordinator_id) || a.lecturer_name.localeCompare(b.lecturer_name),
  )
  const lecturerRank = new Map(lecturers.map((lecturer, index) => [lecturer.lecturer_id, index]))
  const sortKey = (file: SourceFile) => [
    file.item ?? 0,
    SECTION_SLOTS[file.section]?.findIndex((slot) => slot.name === file.slot) ?? 0,
    (file.lecturer_id && lecturerRank.get(file.lecturer_id)) ?? 0,
    file.program_code?.code ?? '',
    file.position,
    file.uploaded_at,
  ]
  const files = [...source.files, ...source.linked_files]
  const sections = SECTIONS.filter((section) => section.kind !== 'switchable' || source.sections_on.includes(section.number))
    .map((section) => ({ section, files: files.filter((file) => file.section === section.number).toSorted((a, b) => compareKeys(sortKey(a), sortKey(b))) }))
    .filter(({ section, files }) => section.kind !== 'may-be-empty' || files.length > 0)

  const listed = sections.flatMap((section) => section.files)
  const urls = await mapAtMost(listed, URL_REQUESTS_AT_ONCE, (file) => downloadUrl(file.storage_item_id))
  const urlOf = new Map(listed.map((file, index) => [file.id, urls[index]]))
  return {
    cover: {
      courseCode: source.course.code,
      courseTitle: source.course.title,
      semester: source.semester.code,
      department: source.course.department.name,
      coordinator: lecturers[0].lecturer_name,
      lecturers: lecturers.map((lecturer) => lecturer.lecturer_name),
    },
    sections: sections.map(({ section, files }) => ({
      number: section.number,
      title: section.title,
      files: files.map((file) => ({ id: file.id, name: file.name, url: urlOf.get(file.id)! })),
    })),
  }
}

function compareKeys(a: (number | string)[], b: (number | string)[]) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] < b[index]) return -1
    if (a[index] > b[index]) return 1
  }
  return 0
}

/** The results of run for each value, in order, with at most limit runs at a time. */
async function mapAtMost<T, R>(values: T[], limit: number, run: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function worker() {
    while (next < values.length) {
      const index = next++
      results[index] = await run(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}
