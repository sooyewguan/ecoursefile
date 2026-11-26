import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import type { CompileManifest } from '../supabase/functions/_shared/manifest.ts'
import { hasPdfName, PDF_TYPE, UPLOAD_PROBLEM_MESSAGES, uploadProblem } from '../supabase/functions/_shared/uploads.ts'
import { friendlyError, UserFacingError } from './errors.ts'
import { cachedFile } from './file-cache.ts'
import type { CourseFileManifest } from './pdf/compile.ts'
import type { PagesPerSheet } from './pdf/n-up.ts'
import { readAll } from './reports.ts'
import { pagesPerSheet } from './sections.ts'

/**
 * Where a file goes: one section of one offering's course file. item is the number of one of its
 * items, for a section that has items. slot is the name of one of the section's SECTION_SLOTS, for
 * a section that has slots.
 */
export type Slot = { offeringId: string; section: number; item?: number; slot?: string }

/**
 * A shared file: the one file of a shared-file section for one semester. In a section shared by
 * semester, such as 1 Academic Calendar, every course file of the semester links it. In a section
 * shared by lecturer, 4 Lecturer Timetable, it is the caller's own, and every course file they
 * teach in the semester links it. In a section shared by program code, 5 Student Timetable, it is
 * the timetable of the program code with programCodeId, which only that section takes, and every
 * course file of the semester that ticks the code links it.
 */
export type SharedSlot = { semesterId: string; section: number; programCodeId?: string }

/** One item of a section with items, such as Lab 2 of Lab Exercises. */
export type Item = { offeringId: string; section: number; item: number }

/**
 * A row of the files table. A course file's file has an offering_id, and a shared file a
 * semester_id, and a lecturer_id when it is that lecturer's timetable, or a program_code_id when it
 * is that program code's student timetable.
 */
export type FileRecord = {
  id: string
  offering_id: string | null
  semester_id: string | null
  lecturer_id: string | null
  program_code_id: string | null
  section: number
  item: number | null
  slot: string | null
  storage_item_id: string
  name: string
  size: number
  position: number
  uploaded_by: string
  uploaded_at: string
}

export type UploadSession = { uploadUrl: string; expiresAt: string; storedName: string }

/**
 * A refused file action. code is not_pdf, too_large or unreadable_pdf when the browser refuses a
 * file, and the files function's error code when it refuses the request, with its HTTP status.
 */
export class FileActionError extends UserFacingError {}

/** Chunks are 5 MiB, a multiple of the 256 KiB that Drive requires. */
const CHUNK_BYTES = 20 * 256 * 1024

/**
 * Uploads a PDF to the slot: merges it when pagesPerSheet says so, checks the result, asks for an
 * upload session, sends its chunks to the session URL, and finalizes it. Resolves to the new file
 * record. onProgress gets the fraction sent, from 0 once the bytes are ready.
 */
export async function uploadFile(
  client: SupabaseClient,
  slot: Slot | SharedSlot,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FileRecord> {
  return uploadBytes(client, slot, file.name, await storedBytes(slot, file), onProgress)
}

/**
 * Replaces a shared file with another PDF, and resolves to the new file record. Each shared file's
 * key holds one file, and the files function opens no upload for a key that has one, so the new file
 * uploads once the old one is deleted. The new file is checked first, as uploadFile and the files
 * function check it, so a file that cannot be stored leaves the old one. Then the old file is deleted and the new one
 * uploads at once. While it uploads, and if the upload fails, the course files that link the key
 * show its section as Missing. An old file that is gone already is skipped, so calling this again
 * after a failed upload only uploads.
 */
export async function replaceSharedFile(
  client: SupabaseClient,
  slot: SharedSlot,
  oldFileId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FileRecord> {
  if (!hasPdfName(file.name)) throw new FileActionError('not_pdf', UPLOAD_PROBLEM_MESSAGES.not_pdf)
  const bytes = await storedBytes(slot, file)
  const deleted = await deleteSharedFile(client, oldFileId).then(
    () => true,
    (error: unknown) => {
      if (error instanceof FileActionError && error.code === 'not_found') return false
      throw error
    },
  )
  try {
    return await uploadBytes(client, slot, file.name, bytes, onProgress)
  } catch (error) {
    if (!deleted) throw error
    const code = error instanceof UserFacingError ? error.code : 'upload_failed'
    throw new FileActionError(code, `The old file is deleted, but ${file.name} did not upload. ${friendlyError(error)} Replace it again to upload it.`)
  }
}

/** Uploads bytes that are ready to store: asks for an upload session, sends its chunks, and finalizes it. */
async function uploadBytes(client: SupabaseClient, slot: Slot | SharedSlot, name: string, bytes: Blob, onProgress?: (fraction: number) => void) {
  const session = await createUploadSession(client, slot, name)
  onProgress?.(0)
  await sendChunks(session.uploadUrl, bytes, onProgress)
  return finalizeUpload(client, slot, session.storedName)
}

/**
 * The bytes to store for the file: the file itself, or in a merged slot the PDF merged N-up. Only
 * the merged PDF is stored, so the size rule applies to it.
 */
async function storedBytes(slot: Slot | SharedSlot, file: File): Promise<Blob> {
  const perSheet = pagesPerSheet(slot)
  const bytes = perSheet && file.type === PDF_TYPE ? await merge(file, perSheet) : file
  const problem = uploadProblem(bytes)
  if (problem === 'too_large' && perSheet) {
    // A merged section takes parts, such as Lecture Notes by chapter. A merged slot takes whole scripts.
    const advice = 'slot' in slot && slot.slot ? 'Scan it at a lower resolution and upload it again.' : 'Split it into parts and upload each part.'
    throw new FileActionError(problem, `${file.name} is still over 20 MB at ${perSheet} pages per sheet. ${advice}`)
  }
  if (problem) throw new FileActionError(problem, UPLOAD_PROBLEM_MESSAGES[problem])
  // The compile reads every stored PDF with the PDF engine, so a PDF the engine cannot read is refused here.
  const { loadPdf, ProtectedPdf } = await import('./pdf/load.ts')
  await loadPdf(new Uint8Array(await bytes.arrayBuffer())).catch((error: unknown) => {
    throw unreadable(file, error instanceof ProtectedPdf)
  })
  return bytes
}

/** The PDF with perSheet of its pages on each page. pdf-lib loads only when a file needs it. */
async function merge(file: File, perSheet: PagesPerSheet) {
  const [{ nUp }, { ProtectedPdf }] = await Promise.all([import('./pdf/n-up.ts'), import('./pdf/load.ts')])
  const merged = await nUp(new Uint8Array(await file.arrayBuffer()), perSheet).catch((error: unknown) => {
    throw unreadable(file, error instanceof ProtectedPdf)
  })
  return new Blob([merged], { type: PDF_TYPE })
}

/** The refusal of a PDF that the PDF engine cannot read, naming the file. */
function unreadable(file: File, isProtected: boolean) {
  return new FileActionError(
    'unreadable_pdf',
    isProtected
      ? `${file.name} is protected by a password or by limits on printing or editing. Upload a copy without protection.`
      : `${file.name} could not be read as a PDF. Export it as a PDF again and retry.`,
  )
}

export function createUploadSession(client: SupabaseClient, slot: Slot | SharedSlot, fileName: string) {
  return callFiles<UploadSession>(client, { action: 'create-upload-session', ...slot, fileName })
}

/**
 * PUTs the bytes to the upload URL in order, without an Authorization header, as Drive requires.
 * Drive answers 308 Resume Incomplete to each chunk before the last.
 */
export async function sendChunks(uploadUrl: string, bytes: Blob, onProgress?: (fraction: number) => void) {
  for (let start = 0; start < bytes.size; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, bytes.size)
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.size}` },
      body: bytes.slice(start, end),
    })
    if (!response.ok && response.status !== 308) throw new FileActionError('upload_failed', 'The upload stopped. Try again.', response.status)
    onProgress?.(end / bytes.size)
  }
}

export async function finalizeUpload(client: SupabaseClient, slot: Slot | SharedSlot, storedName: string) {
  const { file } = await callFiles<{ file: FileRecord }>(client, { action: 'finalize-upload', ...slot, storedName })
  return file
}

/** Deletes the file from storage and from the database. The files function refuses a shared file this way. */
export async function deleteFile(client: SupabaseClient, fileId: string) {
  await callFiles(client, { action: 'delete-file', fileId })
}

/**
 * Deletes a shared file, as deleteFile does, after the user has confirmed it. Its section becomes
 * Missing in every course file that linked it.
 */
export async function deleteSharedFile(client: SupabaseClient, fileId: string) {
  await callFiles(client, { action: 'delete-file', fileId, confirmed: true })
}

/** Deletes the item's files, as deleteFile does, and then the item. */
export async function deleteItem(client: SupabaseClient, item: Item) {
  await callFiles(client, { action: 'delete-item', ...item })
}

/**
 * A file of a past offering that staff may reuse: the code of its semester, the number of its item
 * in a section with items, its name and its size.
 */
export type ReusableFile = { id: string; semester_code: string; item: number | null; name: string; size: number }

/**
 * The files that staff may reuse into the slot: those in the same section and slot of each past
 * offering of the same course, the latest semester first. The slot must be one that isReusable allows.
 */
export async function listReusableFiles(client: SupabaseClient, slot: Slot) {
  const { files } = await callFiles<{ files: ReusableFile[] }>(client, { action: 'list-reusable-files', ...slot })
  return files
}

/** Copies a file that listReusableFiles gives into the slot, as a new file at its end, and resolves to the new file record. */
export async function reuseFile(client: SupabaseClient, slot: Slot, fileId: string) {
  const { file } = await callFiles<{ file: FileRecord }>(client, { action: 'reuse-file', ...slot, fileId })
  return file
}

/**
 * The manifest that the course file's PDF compiles from: its cover, and its sections in order with
 * their files and a short-lived download URL for each, and the item and slot of each file in a
 * section that has them, null otherwise. The files function refuses a user who may not read the
 * course file with forbidden.
 */
export async function compileManifest(client: SupabaseClient, offeringId: string): Promise<CourseFileManifest> {
  const [manifest, places] = await Promise.all([
    callFiles<CompileManifest>(client, { action: 'compile-manifest', offeringId }),
    readAll<{ id: string; item: number | null; slot: string | null }>((from, to) =>
      client.from('files').select('id, item, slot').eq('offering_id', offeringId).order('id').range(from, to),
    ),
  ])
  const placeOf = new Map(places.map((file) => [file.id, file]))
  return {
    ...manifest,
    sections: manifest.sections.map((section) => ({
      ...section,
      files: section.files.map((file) => ({ ...file, item: placeOf.get(file.id)?.item ?? null, slot: placeOf.get(file.id)?.slot ?? null })),
    })),
  }
}

/**
 * The file's name and a short-lived URL that gets its bytes without an Authorization header. The
 * files function gives it to a user who may read the file, and refuses others with not_found. A
 * file of a past offering that the user may only reuse needs the slot it would be reused into.
 */
export function fileUrl(client: SupabaseClient, fileId: string, reuseInto?: Slot) {
  return callFiles<{ name: string; url: string }>(client, { action: 'file-url', fileId, ...reuseInto })
}

/**
 * The file's name and its bytes as a PDF. fileUrl gives the name, and refuses a user who may not
 * read the file, every time. The bytes are those the browser kept from an earlier open, or else
 * those the URL from fileUrl gets.
 */
export async function fetchFile(client: SupabaseClient, fileId: string, reuseInto?: Slot) {
  const { name, url } = await fileUrl(client, fileId, reuseInto)
  const blob = await cachedFile(fileId, async () => {
    const response = await fetch(url)
    if (!response.ok) throw new FileActionError('download_failed', `Couldn't get ${name}. Try again.`, response.status)
    return new Blob([await response.arrayBuffer()], { type: PDF_TYPE })
  })
  return { name, blob }
}

async function callFiles<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('files', { body })
  if (!error) return data
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null
    throw new FileActionError(payload?.code ?? 'internal_error', payload?.message ?? 'The request failed.', response.status)
  }
  throw error
}
