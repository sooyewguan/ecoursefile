// The rules every stored file meets. The browser checks them before an upload, and the files
// Edge Function checks the stored item again at finalize.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export const PDF_TYPE = 'application/pdf'

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
