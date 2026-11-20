import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { PDF_TYPE, UPLOAD_PROBLEM_MESSAGES, uploadProblem } from '../supabase/functions/_shared/uploads.ts'
import type { PagesPerSheet } from './pdf/n-up.ts'
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
export class FileActionError extends Error {
  code: string
  status: number | null
  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** Chunks are 5 MiB, a multiple of the 320 KiB that Graph requires. */
const CHUNK_BYTES = 16 * 320 * 1024

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
  const bytes = await storedBytes(slot, file)
  const session = await createUploadSession(client, slot, file.name)
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
    const advice = 'slot' in slot && slot.slot ? 'Scan the script at a lower resolution and upload it again.' : 'Split it into parts and upload each part.'
    throw new FileActionError(problem, `Merged ${perSheet} pages to a page, the file is still larger than 20 MB. ${advice}`)
  }
  if (problem) throw new FileActionError(problem, UPLOAD_PROBLEM_MESSAGES[problem])
  return bytes
}

/** The PDF with perSheet of its pages on each page. pdf-lib loads only when a file needs it. */
async function merge(file: File, perSheet: PagesPerSheet) {
  const { nUp } = await import('./pdf/n-up.ts')
  const merged = await nUp(new Uint8Array(await file.arrayBuffer()), perSheet).catch(() => {
    throw new FileActionError('unreadable_pdf', 'This PDF could not be read for merging. If it has a password, save a copy without one and upload that.')
  })
  return new Blob([merged], { type: PDF_TYPE })
}

export function createUploadSession(client: SupabaseClient, slot: Slot | SharedSlot, fileName: string) {
  return callFiles<UploadSession>(client, { action: 'create-upload-session', ...slot, fileName })
}

/** PUTs the bytes to the upload URL in order, without an Authorization header, as Graph requires. */
export async function sendChunks(uploadUrl: string, bytes: Blob, onProgress?: (fraction: number) => void) {
  for (let start = 0; start < bytes.size; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, bytes.size)
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.size}` },
      body: bytes.slice(start, end),
    })
    if (!response.ok) throw new FileActionError('upload_failed', `The upload stopped with HTTP ${response.status}.`, response.status)
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
