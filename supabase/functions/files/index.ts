// Uploads and deletes the files of course file sections, and deletes items with their files. The
// browser asks for an upload session, PUTs the file's chunks straight to the session's URL, and
// then asks to finalize. The SQL functions can_upload and deletable decide who may do what, asked
// as the caller. The add_file and remove_file RPCs write the file records and the activity log
// with the service role.
import { authFetch, invalid, isRecord, isUuid, Refusal, rest, SERVICE, serveJson } from '../_shared/http.ts'
import { itemName, SECTION_SLOTS, SECTIONS, type SectionSlot } from '../_shared/sections.ts'
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
 * Where a file goes: one section of one offering's course file, the number of one of its items
 * when the section has items, and one of its slots when it has slots.
 */
type Target = { offeringId: string; section: number; item: number | null; slot: SectionSlot | null }

/** One item of a section with items. */
type ItemRef = { offeringId: string; section: number; item: number }

type FilesRequest =
  | { action: 'create-upload-session'; target: Target; fileName: string }
  | { action: 'finalize-upload'; target: Target; storedName: string }
  | { action: 'delete-file'; fileId: string }
  | { action: 'delete-item'; item: ItemRef }

/** A stored file's name: the upload time, then the name the uploader's file had. */
const STORED_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_([^/]+)$/

const storage = storageFromEnv()

serveJson(async (body, caller) => {
  const request = parseRequest(body)
  switch (request.action) {
    case 'create-upload-session':
      return createUploadSession(request.target, request.fileName, caller)
    case 'finalize-upload':
      return finalizeUpload(request.target, request.storedName, caller)
    case 'delete-file':
      return deleteFile(request.fileId, caller)
    case 'delete-item':
      return deleteItemAndFiles(request.item, caller)
  }
})

const TARGET_FIELDS = 'offeringId, section, an item for a section with items, a slot for a section with slots'

function parseRequest(body: unknown): FilesRequest {
  const input = isRecord(body) ? body : {}
  switch (input.action) {
    case 'create-upload-session': {
      const target = parseTarget(input)
      const fileName = typeof input.fileName === 'string' ? safeName(input.fileName) : ''
      if (!target || !fileName) throw invalid(`create-upload-session needs ${TARGET_FIELDS}, and fileName.`)
      return { action: 'create-upload-session', target, fileName }
    }
    case 'finalize-upload': {
      const target = parseTarget(input)
      const { storedName } = input
      if (!target || typeof storedName !== 'string' || !STORED_NAME.test(storedName)) {
        throw invalid(`finalize-upload needs ${TARGET_FIELDS}, and the storedName of its upload session.`)
      }
      return { action: 'finalize-upload', target, storedName }
    }
    case 'delete-file': {
      if (!isUuid(input.fileId)) throw invalid('delete-file needs fileId.')
      return { action: 'delete-file', fileId: input.fileId }
    }
    case 'delete-item': {
      const { offeringId, section, item } = input
      const itemSection = SECTIONS.find((s) => s.number === section && s.itemTitle)
      if (!isUuid(offeringId) || !itemSection || !isItemNumber(item)) throw invalid('delete-item needs offeringId, a section with items, and item.')
      return { action: 'delete-item', item: { offeringId, section: itemSection.number, item } }
    }
    default:
      throw invalid('action must be create-upload-session, finalize-upload, delete-file or delete-item.')
  }
}

/**
 * The target, when section is one of the 19, item is an item number exactly when the section has
 * items, and slot names one of the section's slots exactly when it has slots.
 */
function parseTarget({ offeringId, section, item, slot }: Record<string, unknown>): Target | null {
  const definition = SECTIONS.find((s) => s.number === section)
  if (!isUuid(offeringId) || !definition) return null
  if (definition.itemTitle ? !isItemNumber(item) : item != null) return null
  const slots = SECTION_SLOTS[definition.number]
  const named = slots?.find((s) => s.name === slot) ?? null
  if (slots ? !named : slot != null) return null
  return { offeringId, section: definition.number, item: isItemNumber(item) ? item : null, slot: named }
}

/** Whether the value can number an item: a whole number from 1 to the largest smallint. */
function isItemNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 32767
}

async function createUploadSession(target: Target, fileName: string, caller: string) {
  if (!hasPdfName(fileName)) throw new Refusal(422, 'not_pdf', UPLOAD_PROBLEM_MESSAGES.not_pdf)
  const folder = await uploadFolder(target, caller)
  await checkRoom(target, caller)
  const storedName = `${new Date().toISOString().replaceAll(':', '-')}_${fileName}`
  const session = await storage.createUploadSession(`${folder}/${storedName}`)
  return { ...session, storedName }
}

// Finalize looks the stored item up by the path its session wrote to, not by an item id from the
// browser, so a caller can only record or delete stored items in a slot they may upload to. If
// add_file refuses the file, such as for an item deleted or a one-file slot filled since the
// session opened, the stored item goes too.
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
    offering_id: target.offeringId,
    section: target.section,
    item: target.item,
    slot: target.slot?.name ?? null,
    storage_item_id: stored.id,
    name: STORED_NAME.exec(storedName)![1],
    size: stored.size,
    uploaded_by: await callerId(caller),
  }, SERVICE).catch(async (error) => {
    await storage.deleteItem(stored.id)
    await checkRoom(target, caller)
    throw error
  })
  return { file }
}

/** Refuses an upload to an item that does not exist, or to a one-file slot that has its file. */
async function checkRoom(target: Target, caller: string) {
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
// deleting it again finishes the job.
async function deleteFile(fileId: string, caller: string) {
  const [file] = await rest<{ storage_item_id: string; deletable: boolean }[]>(
    'GET',
    `/files?id=eq.${fileId}&select=storage_item_id,deletable`,
    undefined,
    caller,
  )
  if (!file) throw new Refusal(404, 'not_found', 'This file does not exist, or you cannot see it.')
  if (!file.deletable) throw new Refusal(403, 'forbidden', 'Only the uploader or the coordinator may delete this file.')
  await storage.deleteItem(file.storage_item_id)
  await rest('POST', '/rpc/remove_file', { file_id: fileId, actor_id: await callerId(caller) }, SERVICE)
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
  const actorId = await callerId(caller)
  for (const file of found.files) {
    await storage.deleteItem(file.storage_item_id)
    await rest('POST', '/rpc/remove_file', { file_id: file.id, actor_id: actorId }, SERVICE)
  }
  await rest('DELETE', `/items?${where}`, undefined, SERVICE)
  return { item }
}

/**
 * The target's folder in the storage library, once the caller is found to be allowed to upload to
 * it: eCourseFile/<semester>/<course code> <course title>/<NN section>, then /<item name> for an
 * item and /<slot> for a slot.
 */
async function uploadFolder(target: Target, caller: string) {
  const allowed = await rest<boolean>('POST', '/rpc/can_upload', { offering_id: target.offeringId, section: target.section }, caller)
  if (!allowed) throw new Refusal(403, 'forbidden', 'Only the coordinator and lecturers of this offering may upload here.')
  const [offering] = await rest<{ semester: { code: string }; course: { code: string; title: string } }[]>(
    'GET',
    `/offerings?id=eq.${target.offeringId}&select=semester:semesters(code),course:courses(code,title)`,
    undefined,
    caller,
  )
  const section = SECTIONS.find((s) => s.number === target.section)!
  return [
    'eCourseFile',
    offering.semester.code.replace('/', '-'),
    safeName(`${offering.course.code} ${offering.course.title}`),
    safeName(`${String(section.number).padStart(2, '0')} ${section.title}`),
    ...(target.item === null ? [] : [itemName(target.section, target.item)]),
    ...(target.slot ? [safeName(target.slot.title)] : []),
  ].join('/')
}

/** text as one SharePoint path segment: no characters SharePoint forbids, and no trailing dots or spaces. */
function safeName(text: string) {
  return text
    .replace(/["*:<>?/\\|\u0000-\u001f]/g, '-')
    .trim()
    .replace(/[.\s]+$/, '')
}

async function callerId(caller: string) {
  const response = await authFetch('GET', '/user', undefined, caller)
  if (!response.ok) throw new Refusal(401, 'unauthorized', 'Sign in again.')
  const user: { id: string } = await response.json()
  return user.id
}
