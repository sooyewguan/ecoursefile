// Generated fixture PDFs, and a reader that reports what a viewer shows, for the PDF engine's
// tests (seam 3) and the upload tests. The app does not use this file.
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Points from each corner of a fixture page to the marker there. */
const INSET = 4

/**
 * A PDF of count pages, width by height points as a viewer shows them. Page n shows "<label> n" at
 * its centre, "Page n" unless label says otherwise, and "n" just inside each corner, all upright on
 * screen. rotate sets each page's /Rotate, and the content is drawn turned against it, so it still
 * reads upright. bleed puts that many points of media box around the crop box on every side.
 */
export async function numberedPdf(count: number, { width = 960, height = 540, rotate = 0, bleed = 0, label = 'Page' } = {}) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sideways = rotate % 180 !== 0
  const [w, h] = sideways ? [height, width] : [width, height]
  for (let n = 1; n <= count; n++) {
    const page = pdf.addPage([w, h])
    page.setRotation(degrees(rotate))
    const draw = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 10, font, rotate: degrees(rotate) })
    draw(`${label} ${n}`, w / 2, h / 2)
    for (const [x, y] of [[INSET, INSET], [w - INSET, INSET], [INSET, h - INSET], [w - INSET, h - INSET]]) draw(String(n), x, y)
    page.setMediaBox(-bleed, -bleed, w + 2 * bleed, h + 2 * bleed)
    page.setCropBox(0, 0, w, h)
  }
  return pdf.save()
}

/**
 * A PDF of exactly size bytes, 516 or more, with one blank A4 page. The bytes left over fill a
 * stream that no page uses, its byte i being byteAt(i). The numbers in the PDF have a fixed width,
 * so the text around the stream has the same length whatever the size.
 */
export function sizedPdf(size: number, byteAt = (_index: number) => 0) {
  const fixed = (value: number) => String(value).padStart(10, '0')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  const text = (padding: number) => {
    let head = '%PDF-1.7\n'
    const offsets = objects.map((object, index) => {
      const offset = head.length
      head += `${index + 1} 0 obj\n${object}\nendobj\n`
      return offset
    })
    offsets.push(head.length)
    head += `${offsets.length} 0 obj\n<< /Length ${fixed(padding)} >>\nstream\n`
    const end = '\nendstream\nendobj\n'
    const xref = offsets.map((offset) => `${fixed(offset)} 00000 n \n`).join('')
    const tail = `${end}xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${fixed(head.length + padding + end.length)}\n%%EOF\n`
    return { head, tail }
  }
  const empty = text(0)
  const padding = size - empty.head.length - empty.tail.length
  if (padding < 0) throw new RangeError(`A PDF takes at least ${size - padding} bytes.`)
  const { head, tail } = text(padding)
  const encoder = new TextEncoder()
  const bytes = new Uint8Array(size)
  bytes.set(encoder.encode(head))
  for (let index = 0; index < padding; index++) bytes[head.length + index] = byteAt(index)
  bytes.set(encoder.encode(tail), head.length + padding)
  return bytes
}

/**
 * One page as a viewer shows it: its size, and where each piece of text starts, in points from the
 * bottom left corner of the shown page, and whether it reads upright.
 */
export type ShownPage = { width: number; height: number; texts: { text: string; x: number; y: number; upright: boolean }[] }

/** Each page of the PDF as a viewer shows it. pdfjs takes over the bytes it reads, so it gets a copy. */
export async function readPdf(bytes: Uint8Array): Promise<ShownPage[]> {
  const loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  const document = await loading.promise
  const pages: ShownPage[] = []
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    const { width, height } = viewport
    const content = await page.getTextContent()
    const texts = content.items.flatMap((item) => {
      if (!('str' in item) || item.str.trim() === '') return []
      // The viewport turns the page by its /Rotate and shifts its crop box to the origin, with y down.
      const [a, b, c, d, x, y] = Util.transform(viewport.transform, item.transform) as number[]
      return [{ text: item.str, x, y: height - y, upright: a > 0 && d < 0 && Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6 }]
    })
    pages.push({ width, height, texts })
  }
  await loading.destroy()
  return pages
}
