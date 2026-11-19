import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { PDF_TYPE, UPLOAD_PROBLEM_MESSAGES, uploadProblem } from '../supabase/functions/_shared/uploads.ts'
import type { PagesPerSheet } from './pdf/n-up.ts'
import { MERGED_SECTIONS } from './sections.ts'

/**
 * Where a file goes: one section of one offering's course file. slot is the name of one of the
 * section's SECTION_SLOTS, for a section that has slots.
 */
export type Slot = { offeringId: string; section: number; slot?: string }

/** A row of the files table. */
export type FileRecord = {
  id: string
  offering_id: string
  section: number
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
 * Uploads a PDF to the slot: merges it when the section is in MERGED_SECTIONS, checks the result,
 * asks for an upload session, sends its chunks to the session URL, and finalizes it. Resolves to
 * the new file record. onProgress gets the fraction sent, from 0 once the bytes are ready.
 */
export async function uploadFile(
  client: SupabaseClient,
  slot: Slot,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FileRecord> {
  const bytes = await storedBytes(slot.section, file)
  const session = await createUploadSession(client, slot, file.name)
  onProgress?.(0)
  await sendChunks(session.uploadUrl, bytes, onProgress)
  return finalizeUpload(client, slot, session.storedName)
}

/**
 * The bytes to store for the file: the file itself, or in a merged section the PDF merged N-up.
 * Only the merged PDF is stored, so the size rule applies to it.
 */
async function storedBytes(section: number, file: File): Promise<Blob> {
  const perSheet = MERGED_SECTIONS[section]
  const bytes = perSheet && file.type === PDF_TYPE ? await merge(file, perSheet) : file
  const problem = uploadProblem(bytes)
  if (problem === 'too_large' && perSheet) {
    throw new FileActionError(problem, `Merged ${perSheet} pages to a page, the file is still larger than 20 MB. Split it into parts and upload each part.`)
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

export function createUploadSession(client: SupabaseClient, slot: Slot, fileName: string) {
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

export async function finalizeUpload(client: SupabaseClient, slot: Slot, storedName: string) {
  const { file } = await callFiles<{ file: FileRecord }>(client, { action: 'finalize-upload', ...slot, storedName })
  return file
}

/** Deletes the file from storage and from the database. */
export async function deleteFile(client: SupabaseClient, fileId: string) {
  await callFiles(client, { action: 'delete-file', fileId })
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
