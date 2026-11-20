// How the PDF engine reads a PDF. The compile, the N-up merge and the browser's upload check all
// read PDFs this way, so the browser refuses a PDF that the compile could not read.
import { PDFArray, PDFDocument } from 'pdf-lib'

/** A PDF with a password, even one that only limits printing or editing. pdf-lib cannot read it. */
export class ProtectedPdf extends Error {}

/**
 * The PDF as pdf-lib loads it, once each page has been checked for what the compile needs to stamp
 * the page's number on it: its crop box, its rotation, and contents it can draw on. Rejects a
 * protected PDF with ProtectedPdf, and a PDF that pdf-lib cannot read or draw on with an error.
 */
export async function loadPdf(bytes: Uint8Array) {
  // pdf-lib's own EncryptedPDFError fails instanceof, so the engine checks for encryption itself.
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (pdf.isEncrypted) throw new ProtectedPdf('The PDF is protected by a password.')
  for (const page of pdf.getPages()) {
    page.getCropBox()
    page.getRotation()
    // pdf-lib normalizes a page before it draws on it, and that throws on a /Resources that is not a
    // dictionary. A /Contents that is neither a stream nor an array gets through, and drawing fails.
    page.node.normalize()
    const contents = page.node.Contents()
    if (contents !== undefined && !(contents instanceof PDFArray)) throw new Error('A page has contents that are not a stream or an array.')
  }
  return pdf
}
