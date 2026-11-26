// The rules every stored file meets. The browser checks the type and size before an upload. The
// files Edge Function checks the name when it opens an upload session, and the stored item's
// type, size and first bytes at finalize.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export const PDF_TYPE = 'application/pdf'

/** The bytes every PDF file starts with. */
export const PDF_SIGNATURE = new TextEncoder().encode('%PDF-')

/** Why a file may not be stored. The browser and the files function use these as error codes. */
export type UploadProblem = 'not_pdf' | 'too_large'

export const UPLOAD_PROBLEM_MESSAGES: Record<UploadProblem, string> = {
  not_pdf: 'Only PDF files can be uploaded.',
  too_large: 'A file can be at most 20 MB.',
}

/** Why a file of this size and media type may not be stored, or null when it may. */
export function uploadProblem(file: { size: number; type: string }): UploadProblem | null {
  if (file.type !== PDF_TYPE) return 'not_pdf'
  if (file.size > MAX_UPLOAD_BYTES) return 'too_large'
  return null
}

/** Whether the name ends in .pdf, in any case, so the stored file opens as a PDF. */
export function hasPdfName(name: string) {
  return /\.pdf$/i.test(name)
}

/** Whether the bytes start with PDF_SIGNATURE. */
export function hasPdfSignature(start: Uint8Array) {
  return PDF_SIGNATURE.every((byte, index) => start[index] === byte)
}
