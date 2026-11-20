// How the PDF engine reads a PDF. The compile, the N-up merge and the browser's upload check all
// read PDFs this way, so the browser refuses a PDF that the compile could not read.
import { PDFDocument } from 'pdf-lib'

/** A PDF with a password, even one that only limits printing or editing. pdf-lib cannot read it. */
export class ProtectedPdf extends Error {}

/**
 * The PDF as pdf-lib loads it, once the crop box and rotation of each page, which the compile
 * reads to stamp the page's number, have been read. Rejects a protected PDF with ProtectedPdf, and
 * a PDF that pdf-lib cannot read with pdf-lib's error.
 */
export async function loadPdf(bytes: Uint8Array) {
  // pdf-lib's own EncryptedPDFError fails instanceof, so the engine checks for encryption itself.
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (pdf.isEncrypted) throw new ProtectedPdf('The PDF is protected by a password.')
  for (const page of pdf.getPages()) {
    page.getCropBox()
    page.getRotation()
  }
  return pdf
}
