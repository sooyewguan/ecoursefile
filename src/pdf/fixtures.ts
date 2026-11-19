// Generated fixture PDFs, and a reader that reports what a viewer shows, for the PDF engine's
// tests (seam 3) and the upload tests. The app does not use this file.
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Points from each corner of a fixture page to the marker there. */
const INSET = 4

/**
 * A PDF of count pages, width by height points as a viewer shows them. Page n shows "Page n" at
 * its centre and "n" just inside each corner, all upright on screen. rotate sets each page's
 * /Rotate, and the content is drawn turned the other way, as a scanner or a viewer's save does.
 * bleed puts that many points of media box around the crop box on every side.
 */
export async function numberedPdf(count: number, { width = 960, height = 540, rotate = 0, bleed = 0 } = {}) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sideways = rotate % 180 !== 0
  const [w, h] = sideways ? [height, width] : [width, height]
  for (let n = 1; n <= count; n++) {
    const page = pdf.addPage([w, h])
    page.setRotation(degrees(rotate))
    const draw = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 10, font, rotate: degrees(rotate) })
    draw(`Page ${n}`, w / 2, h / 2)
    for (const [x, y] of [[INSET, INSET], [w - INSET, INSET], [INSET, h - INSET], [w - INSET, h - INSET]]) draw(String(n), x, y)
    page.setMediaBox(-bleed, -bleed, w + 2 * bleed, h + 2 * bleed)
    page.setCropBox(0, 0, w, h)
  }
  return pdf.save()
}

/** One page as a viewer shows it: its size, and where each piece of text starts and whether it reads upright. */
export type ShownPage = { width: number; height: number; texts: { text: string; x: number; y: number; upright: boolean }[] }

/** Each page of the PDF as a viewer shows it. pdfjs takes over the bytes it reads, so it gets a copy. */
export async function readPdf(bytes: Uint8Array): Promise<ShownPage[]> {
  const loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  const document = await loading.promise
  const pages: ShownPage[] = []
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number)
    const { width, height } = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const texts = content.items.flatMap((item) => {
      if (!('str' in item) || item.str.trim() === '') return []
      const [a, b, c, d, x, y] = item.transform as number[]
      return [{ text: item.str, x, y, upright: a > 0 && d > 0 && Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6 }]
    })
    pages.push({ width, height, texts })
  }
  await loading.destroy()
  return pages
}
