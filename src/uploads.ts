import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { UPLOAD_PROBLEM_MESSAGES, uploadProblem } from '../supabase/functions/_shared/uploads.ts'

/** Where a file goes: one section of one offering's course file. */
export type Slot = { offeringId: string; section: number }

/** A row of the files table. */
export type FileRecord = {
  id: string
  offering_id: string
  section: number
  storage_item_id: string
  name: string
  size: number
  position: number
  uploaded_by: string
  uploaded_at: string
}

export type UploadSession = { uploadUrl: string; expiresAt: string; storedName: string }

/**
 * A refused file action. code is not_pdf or too_large when the browser refuses a file, and the
 * files function's error code when it refuses the request, with its HTTP status.
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
 * Uploads a PDF to the slot: checks it, asks for an upload session, sends its chunks to the
 * session URL, and finalizes it. Resolves to the new file record.
 */
export async function uploadFile(
  client: SupabaseClient,
  slot: Slot,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FileRecord> {
  const problem = uploadProblem(file)
  if (problem) throw new FileActionError(problem, UPLOAD_PROBLEM_MESSAGES[problem])
  const session = await createUploadSession(client, slot, file.name)
  await sendChunks(session.uploadUrl, file, onProgress)
  return finalizeUpload(client, slot, session.storedName)
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
