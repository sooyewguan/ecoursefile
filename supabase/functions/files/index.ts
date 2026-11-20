// Uploads and deletes the files of course file sections and shared files, deletes items with their
// files, reuses files from past offerings, and gives the manifest that the browser compiles a course
// file's PDF from. The browser asks for an upload session, PUTs the
// file's chunks straight to the session's URL, and then asks to finalize. The SQL functions
// can_upload, can_upload_shared_file and deletable decide who may do what, asked as the caller. The
// add_file, remove_file and reuse_file RPCs write the file records and the activity log with the
// service role, and reusable_files lists the files of past offerings.
import { authFetch, invalid, isRecord, isUuid, Refusal, rest, SERVICE, serveJson } from '../_shared/http.ts'
import { buildManifest, MANIFEST_SELECT, type ManifestSource } from '../_shared/manifest.ts'
import { isReusable, itemName, SECTION_SLOTS, SECTIONS, type SectionSlot, type SharedFile } from '../_shared/sections.ts'
import { storageFromEnv, type StoredItem } from '../_shared/storage.ts'
import {
  hasPdfName,
  hasPdfSignature,
  PDF_SIGNATURE,
  UPLOAD_PROBLEM_MESSAGES,
  uploadProblem,
  type UploadProblem,
} from '../_shared/uploads.ts'

/**
 * Where a file goes. A course file target is one section of one offering's course file, the number
 * of one of its items when the section has items, and one of its slots when it has slots. A shared
 * target is the key of one shared file: a shared-file section of one semester and, for a section
 * shared by lecturer or by program code, the lecturer or the program code.
 */
type Target =
  | { kind: 'course-file'; offeringId: string; section: number; item: number | null; slot: SectionSlot | null }
  | { kind: 'shared'; semesterId: string; section: number; key: SharedKey | null }

type CourseFileTarget = Extract<Target, { kind: 'course-file' }>

/**
 * The part of a shared file's key after its semester and section, in a section shared by lecturer
 * or by program code. by is the section's sharedFile. For a lecturer, id is the lecturer's and name
 * their email. Lecturers upload only their own timetable, so that lecturer is always the caller.
 * For a program code, id is the code's and name the code itself.
 */
type SharedKey = { by: 'lecturer' | 'program_code'; id: string; name: string }

/** The column of the files table that holds each kind of SharedKey. */
const KEY_COLUMNS = { lecturer: 'lecturer_id', program_code: 'program_code_id' } as const

/** A signed-in user. */
type User = { id: string; email: string }

/** One item of a section with items. */
type ItemRef = { offeringId: string; section: number; item: number }

type FilesRequest =
  | { action: 'create-upload-session'; target: Target; fileName: string }
  | { action: 'finalize-upload'; target: Target; storedName: string }
  | { action: 'delete-file'; fileId: string; confirmed: boolean }
  | { action: 'delete-item'; item: ItemRef }
  | { action: 'list-reusable-files'; target: CourseFileTarget }
  | { action: 'reuse-file'; target: CourseFileTarget; fileId: string }
  | { action: 'compile-manifest'; offeringId: string }

/** A stored file's name: the upload time, then the name the uploader's file had. */
const STORED_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_([^/]+)$/

const storage = storageFromEnv()

serveJson(async (body, caller) => {
  const request = await parseRequest(body, caller)
  switch (request.action) {
    case 'create-upload-session':
      return createUploadSession(request.target, request.fileName, caller)
    case 'finalize-upload':
      return finalizeUpload(request.target, request.storedName, caller)
    case 'delete-file':
      return deleteFile(request.fileId, request.confirmed, caller)
    case 'delete-item':
      return deleteItemAndFiles(request.item, caller)
    case 'list-reusable-files':
      return listReusableFiles(request.target, caller)
    case 'reuse-file':
      return reuseFile(request.target, request.fileId, caller)
    case 'compile-manifest':
      return compileManifest(request.offeringId, caller)
  }
})

const TARGET_FIELDS =
  'offeringId, section, an item for a section with items and a slot for a section with slots, or semesterId and a shared-file section, with the programCodeId of a program code for a student timetable'

const REUSE_TARGET_FIELDS =
  'offeringId, section, an item for a section with items and a slot for a section with slots, naming a place that files can be reused into'

async function parseRequest(body: unknown, caller: string): Promise<FilesRequest> {
  const input = isRecord(body) ? body : {}
  switch (input.action) {
    case 'create-upload-session': {
      const target = await parseTarget(input, caller)
      const fileName = typeof input.fileName === 'string' ? safeName(input.fileName) : ''
      if (!target || !fileName) throw invalid(`create-upload-session needs ${TARGET_FIELDS}, and fileName.`)
      return { action: 'create-upload-session', target, fileName }
    }
    case 'finalize-upload': {
      const target = await parseTarget(input, caller)
      const { storedName } = input
      if (!target || typeof storedName !== 'string' || !STORED_NAME.test(storedName)) {
        throw invalid(`finalize-upload needs ${TARGET_FIELDS}, and the storedName of its upload session.`)
      }
      return { action: 'finalize-upload', target, storedName }
    }
    case 'delete-file': {
      const { fileId, confirmed = false } = input
      if (!isUuid(fileId) || typeof confirmed !== 'boolean') throw invalid('delete-file needs fileId, and confirmed: true for a shared file.')
      return { action: 'delete-file', fileId, confirmed }
    }
    case 'delete-item': {
      const { offeringId, section, item } = input
      const itemSection = SECTIONS.find((s) => s.number === section && s.itemTitle)
      if (!isUuid(offeringId) || !itemSection || !isItemNumber(item)) throw invalid('delete-item needs offeringId, a section with items, and item.')
      return { action: 'delete-item', item: { offeringId, section: itemSection.number, item } }
    }
    case 'list-reusable-files': {
      const target = await parseReuseTarget(input, caller)
      if (!target) throw invalid(`list-reusable-files needs ${REUSE_TARGET_FIELDS}.`)
      return { action: 'list-reusable-files', target }
    }
    case 'reuse-file': {
      const target = await parseReuseTarget(input, caller)
      const { fileId } = input
      if (!target || !isUuid(fileId)) throw invalid(`reuse-file needs ${REUSE_TARGET_FIELDS}, and fileId.`)
      return { action: 'reuse-file', target, fileId }
    }
    case 'compile-manifest': {
      const { offeringId } = input
      if (!isUuid(offeringId)) throw invalid('compile-manifest needs offeringId.')
      return { action: 'compile-manifest', offeringId }
    }
    default:
      throw invalid(
        'action must be create-upload-session, finalize-upload, delete-file, delete-item, list-reusable-files, reuse-file or compile-manifest.',
      )
  }
}

/**
 * The target. With semesterId, section is a shared-file section, and there is no offeringId, item or
 * slot. A section shared by lecturer takes the caller as the lecturer, and a section shared by
 * program code takes programCodeId, which only it takes. Otherwise section is one of the 19, item is
 * an item number exactly when the section has items, and slot names one of the section's slots
 * exactly when it has slots.
 */
async function parseTarget(
  { offeringId, semesterId, section, item, slot, programCodeId }: Record<string, unknown>,
  caller: string,
): Promise<Target | null> {
  const definition = SECTIONS.find((s) => s.number === section)
  if (!definition) return null
  if (semesterId !== undefined) {
    if (!isUuid(semesterId) || !definition.sharedFile || offeringId != null || item != null || slot != null) return null
    const key = await sharedKey(definition.sharedFile, programCodeId, caller)
    return key === undefined ? null : { kind: 'shared', semesterId, section: definition.number, key }
  }
  if (!isUuid(offeringId) || programCodeId != null) return null
  if (definition.itemTitle ? !isItemNumber(item) : item != null) return null
  const slots = SECTION_SLOTS[definition.number]
  const named = slots?.find((s) => s.name === slot) ?? null
  if (slots ? !named : slot != null) return null
  return { kind: 'course-file', offeringId, section: definition.number, item: isItemNumber(item) ? item : null, slot: named }
}

/** The target as parseTarget reads it, when it is a place of a course file that files can be reused into. */
async function parseReuseTarget(input: Record<string, unknown>, caller: string): Promise<CourseFileTarget | null> {
  const target = await parseTarget(input, caller)
  return target?.kind === 'course-file' && isReusable({ section: target.section, slot: target.slot?.name }) ? target : null
}

/**
 * The SharedKey of a section shared by sharedFile: null for a semester's file, the caller for a
 * lecturer's, and the program code with this id for a program code's. Undefined when the request
 * names no program code that exists for a program code's file, or names one for another file. The
 * function looks the code up with the service role, so that a caller who may not read program codes,
 * such as root, is refused for the upload and not for the code.
 */
async function sharedKey(sharedFile: SharedFile, programCodeId: unknown, caller: string): Promise<SharedKey | null | undefined> {
  if (sharedFile !== 'program_code' && programCodeId != null) return undefined
  switch (sharedFile) {
    case 'semester':
      return null
    case 'lecturer': {
      const { id, email } = await callerUser(caller)
      return { by: 'lecturer', id, name: email }
    }
    case 'program_code': {
      if (!isUuid(programCodeId)) return undefined
      const [programCode] = await rest<{ code: string }[]>('GET', `/program_codes?id=eq.${programCodeId}&select=code`, undefined, SERVICE)
      return programCode && { by: 'program_code', id: programCodeId, name: programCode.code }
    }
  }
}

/** Whether the value can number an item: a whole number from 1 to the largest smallint. */
function isItemNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 32767
}

async function createUploadSession(target: Target, fileName: string, caller: string) {
  if (!hasPdfName(fileName)) throw new Refusal(422, 'not_pdf', UPLOAD_PROBLEM_MESSAGES.not_pdf)
  const folder = await uploadFolder(target, caller)
  await checkRoom(target, caller)
  const storedName = storedNameOf(fileName)
  const session = await storage.createUploadSession(`${folder}/${storedName}`)
  return { ...session, storedName }
}

/** The name a file is stored under: the time now, then the file's name. STORED_NAME matches it. */
function storedNameOf(fileName: string) {
  return `${new Date().toISOString().replaceAll(':', '-')}_${fileName}`
}

// Finalize looks the stored item up by the path its session wrote to, not by an item id from the
// browser, so a caller can only record or delete stored items in a slot they may upload to. If
// add_file refuses the file, such as for an item deleted, or a one-file slot or a shared file
// filled, since the session opened, the stored item goes too.
async function finalizeUpload(target: Target, storedName: string, caller: string) {
  const folder = await uploadFolder(target, caller)
  const stored = await storage.getItem(`${folder}/${storedName}`)
  if (!stored) throw new Refusal(404, 'not_found', 'The upload was not found. Upload the file again.')
  const problem = await storedItemProblem(stored)
  if (problem) {
    await storage.deleteItem(stored.id)
    throw new Refusal(422, problem, UPLOAD_PROBLEM_MESSAGES[problem])
  }
  const file = await rest('POST', '/rpc/add_file', {
    ...slotKey(target),
    storage_item_id: stored.id,
    name: STORED_NAME.exec(storedName)![1],
    size: stored.size,
    uploaded_by: (await callerUser(caller)).id,
  }, SERVICE).catch(async (error) => {
    await storage.deleteItem(stored.id)
    await checkRoom(target, caller)
    throw error
  })
  return { file }
}

// The picker reads past offerings only through this list, and only for a place that the caller may
// upload to. Each file carries no more than the picker shows. PostgREST orders a function's rows only
// by columns it selects, so position is selected for the order and left out of the answer.
async function listReusableFiles(target: CourseFileTarget, caller: string) {
  await checkUpload(target, caller)
  const files = await rest<{ position: number }[]>(
    'POST',
    '/rpc/reusable_files?select=id,semester_code,item,name,size,position&order=semester_code.desc,item,position',
    placeOf(target),
    SERVICE,
  )
  return { files: files.map(({ position: _, ...file }) => file) }
}

// A reuse passes the gates of an upload: the caller may upload to the place, its item exists, and
// the file goes last in its slot. The file to reuse must be one that the list gives for the place.
// The copy is a new stored item in the target's folder, recorded as a new file. If recording fails,
// such as for an item deleted or a section switched off while the file was copied, the copy goes too.
async function reuseFile(target: CourseFileTarget, fileId: string, caller: string) {
  const folder = await uploadFolder(target, caller)
  await checkRoom(target, caller)
  const [source] = await rest<{ source_offering_id: string; name: string; storage_item_id: string }[]>(
    'POST',
    `/rpc/reusable_files?id=eq.${fileId}&select=source_offering_id,name,storage_item_id`,
    placeOf(target),
    SERVICE,
  )
  const copy = source && (await storage.copyItem(source.storage_item_id, `${folder}/${storedNameOf(source.name)}`))
  if (!copy) throw new Refusal(404, 'not_found', 'This file cannot be reused here. It may have been deleted.')
  const file = await rest('POST', '/rpc/reuse_file', {
    ...slotKey(target),
    source_offering_id: source.source_offering_id,
    storage_item_id: copy.id,
    name: source.name,
    size: copy.size,
    actor_id: (await callerUser(caller)).id,
  }, SERVICE).catch(async (error) => {
    await storage.deleteItem(copy.id)
    await checkRoom(target, caller)
    throw error
  })
  return { file }
}

/** The reusable_files arguments that name the target's place: its offering, section and slot. */
function placeOf({ offeringId, section, slot }: CourseFileTarget) {
  return { offering_id: offeringId, section, slot: slot?.name ?? null }
}

/**
 * The add_file arguments that name the target's slot: a course file's section, item and slot, or a
 * shared file's semester, section, and lecturer or program code.
 */
function slotKey(target: Target) {
  if (target.kind === 'course-file') {
    return { offering_id: target.offeringId, section: target.section, item: target.item, slot: target.slot?.name ?? null }
  }
  const { semesterId, section, key } = target
  return {
    offering_id: null,
    semester_id: semesterId,
    section,
    item: null,
    slot: null,
    lecturer_id: null,
    program_code_id: null,
    ...(key && { [KEY_COLUMNS[key.by]]: key.id }),
  }
}

/**
 * Refuses an upload to an item that does not exist, or to a place that holds one file and has it:
 * a one-file slot, or a shared-file key.
 */
async function checkRoom(target: Target, caller: string) {
  if (target.kind === 'shared') {
    const { semesterId, section, key } = target
    const where = `semester_id=eq.${semesterId}&section=eq.${section}${key ? `&${KEY_COLUMNS[key.by]}=eq.${key.id}` : ''}`
    const files = await rest<unknown[]>('GET', `/files?${where}&select=id`, undefined, caller)
    if (files.length === 0) return
    const holder = !key
      ? `This semester has its ${sectionOf(section).title}.`
      : key.by === 'lecturer'
        ? 'You have a timetable for this semester.'
        : `${key.name} has a student timetable for this semester.`
    throw new Refusal(409, 'slot_full', `${holder} Delete it to upload another.`)
  }
  if (target.item === null) return
  const where = `offering_id=eq.${target.offeringId}&section=eq.${target.section}`
  const items = await rest<unknown[]>('GET', `/items?${where}&number=eq.${target.item}&select=number`, undefined, caller)
  if (items.length === 0) throw new Refusal(404, 'not_found', `${itemName(target.section, target.item)} does not exist. It may have been deleted.`)
  if (!target.slot?.oneFile) return
  const files = await rest<unknown[]>('GET', `/files?${where}&item=eq.${target.item}&slot=eq.${target.slot.name}&select=id`, undefined, caller)
  if (files.length > 0) throw new Refusal(409, 'slot_full', `${target.slot.title} holds one file. Delete it to upload another.`)
}

/** Why the stored item may not stay, or null when it may. Its type comes from its name, so its first bytes must be a PDF's too. */
async function storedItemProblem(item: StoredItem): Promise<UploadProblem | null> {
  const problem = uploadProblem({ size: item.size, type: item.mimeType })
  if (problem) return problem
  return hasPdfSignature(await storage.readStart(item.id, PDF_SIGNATURE.length)) ? null : 'not_pdf'
}

// The stored item goes first. If removing the record then fails, the file is still listed, and
// deleting it again finishes the job. Deleting a shared file leaves its section Missing in every
// course file that links it, so the caller must confirm it.
async function deleteFile(fileId: string, confirmed: boolean, caller: string) {
  const [file] = await rest<{ storage_item_id: string; deletable: boolean; semester_id: string | null; lecturer_id: string | null }[]>(
    'GET',
    `/files?id=eq.${fileId}&select=storage_item_id,deletable,semester_id,lecturer_id`,
    undefined,
    caller,
  )
  if (!file) throw new Refusal(404, 'not_found', 'This file does not exist, or you cannot see it.')
  const shared = file.semester_id !== null
  if (!file.deletable) {
    throw new Refusal(
      403,
      'forbidden',
      file.lecturer_id
        ? 'Only its lecturer may delete a timetable.'
        : shared
          ? 'Only the admin may delete shared files.'
          : 'Only the uploader or the coordinator may delete this file.',
    )
  }
  if (shared && !confirmed) {
    throw new Refusal(
      409,
      'confirmation_required',
      'The course files that link this shared file lose it, and its section becomes Missing in each. Confirm the delete to go ahead.',
    )
  }
  await storage.deleteItem(file.storage_item_id)
  await rest('POST', '/rpc/remove_file', { file_id: fileId, actor_id: (await callerUser(caller)).id }, SERVICE)
  return { fileId }
}

// The item's files go first, each the way delete-file deletes one. If a step fails, the item stays
// with the files that are left, and deleting it again finishes the job.
async function deleteItemAndFiles({ offeringId, section, item }: ItemRef, caller: string) {
  const where = `offering_id=eq.${offeringId}&section=eq.${section}&number=eq.${item}`
  const [found] = await rest<{ deletable: boolean; files: { id: string; storage_item_id: string }[] }[]>(
    'GET',
    `/items?${where}&select=deletable,files(id,storage_item_id)`,
    undefined,
    caller,
  )
  if (!found) throw new Refusal(404, 'not_found', 'This item does not exist, or you cannot see it.')
  if (!found.deletable) throw new Refusal(403, 'forbidden', 'Only the coordinator, or a lecturer who uploaded every file in it, may delete this item.')
  const actorId = (await callerUser(caller)).id
  for (const file of found.files) {
    await storage.deleteItem(file.storage_item_id)
    await rest('POST', '/rpc/remove_file', { file_id: file.id, actor_id: actorId }, SERVICE)
  }
  await rest('DELETE', `/items?${where}`, undefined, SERVICE)
  return { item }
}

// Everyone who reads the course file may compile it. The caller's right is asked once, and the
// course file is then read with the service role, which skips the row checks on each file.
async function compileManifest(offeringId: string, caller: string) {
  const allowed = await rest<boolean>('POST', '/rpc/can_read_offering', { offering_id: offeringId }, caller)
  if (!allowed) throw new Refusal(403, 'forbidden', 'Only those who may read this course file may compile it.')
  const [offering] = await rest<ManifestSource[]>('GET', `/offerings?id=eq.${offeringId}&select=${MANIFEST_SELECT}`, undefined, SERVICE)
  if (!offering) throw new Refusal(404, 'not_found', 'This course file does not exist.')
  return buildManifest(offering, (id) => storage.downloadUrl(id))
}

/**
 * The target's folder in the storage library, once the caller is found to be allowed to upload to
 * it: eCourseFile/<semester>/<course code> <course title>/<NN section>, then /<item name> for an
 * item and /<slot> for a slot. A shared file's folder is eCourseFile/<semester>/_shared/<NN section>,
 * then /<id> <name> of its key for a lecturer's or a program code's file, such as the lecturer's id
 * and email. Finalize finds an upload by its folder, so each lecturer finalizes only their own
 * uploads, and an upload for one program code is never recorded for another. The id keeps two keys
 * apart whose names make the same folder name, such as a/b@x and a-b@x.
 */
async function uploadFolder(target: Target, caller: string) {
  if (target.kind === 'shared') {
    const { semesterId, section, key } = target
    const allowed = await rest<boolean>('POST', '/rpc/can_upload_shared_file', { semester_id: semesterId, section }, caller)
    if (!allowed) {
      throw new Refusal(
        403,
        'forbidden',
        key?.by === 'lecturer' ? 'Only lecturers who teach in this semester may upload their timetable for it.' : 'Only the admin may upload shared files.',
      )
    }
    const [semester] = await rest<{ code: string }[]>('GET', `/semesters?id=eq.${semesterId}&select=code`, undefined, caller)
    return ['eCourseFile', semesterFolder(semester.code), '_shared', sectionFolder(section), ...(key ? [safeName(`${key.id} ${key.name}`)] : [])].join('/')
  }
  await checkUpload(target, caller)
  const [offering] = await rest<{ semester: { code: string }; course: { code: string; title: string } }[]>(
    'GET',
    `/offerings?id=eq.${target.offeringId}&select=semester:semesters(code),course:courses(code,title)`,
    undefined,
    caller,
  )
  return [
    'eCourseFile',
    semesterFolder(offering.semester.code),
    safeName(`${offering.course.code} ${offering.course.title}`),
    sectionFolder(target.section),
    ...(target.item === null ? [] : [itemName(target.section, target.item)]),
    ...(target.slot ? [safeName(target.slot.title)] : []),
  ].join('/')
}

/** Refuses a caller who may not upload to the course file target. */
async function checkUpload(target: CourseFileTarget, caller: string) {
  const allowed = await rest<boolean>('POST', '/rpc/can_upload', { offering_id: target.offeringId, section: target.section }, caller)
  if (!allowed) throw new Refusal(403, 'forbidden', 'Only the coordinator and lecturers of this offering may upload here.')
}

/** A semester's folder name, such as 2026-2027-1 for 2026/2027-1. */
function semesterFolder(code: string) {
  return code.replace('/', '-')
}

/** A section's folder name, such as 02 Teaching Plan. */
function sectionFolder(number: number) {
  const section = sectionOf(number)
  return safeName(`${String(section.number).padStart(2, '0')} ${section.title}`)
}

function sectionOf(number: number) {
  return SECTIONS.find((s) => s.number === number)!
}

/** text as one SharePoint path segment: no characters SharePoint forbids, and no trailing dots or spaces. */
function safeName(text: string) {
  return text
    .replace(/["*:<>?/\\|\u0000-\u001f]/g, '-')
    .trim()
    .replace(/[.\s]+$/, '')
}

async function callerUser(caller: string): Promise<User> {
  const response = await authFetch('GET', '/user', undefined, caller)
  if (!response.ok) throw new Refusal(401, 'unauthorized', 'Sign in again.')
  const { id, email }: User = await response.json()
  return { id, email }
}
