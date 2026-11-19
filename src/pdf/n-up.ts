// The PDF engine's N-up merge, a pure function over bytes that runs in the browser and in Node.
import { degrees, PDFDocument, rgb, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib'

/** How many source pages go on each merged page: 8 for lecture notes, 4 for answer scripts. */
export type PagesPerSheet = 4 | 8

/** A4 portrait in PDF points, the size of every merged page. */
const SHEET = { width: 595.28, height: 841.89 }

/** The grid of each layout, filled left to right and then top to bottom. */
const GRIDS: Record<PagesPerSheet, { columns: number; rows: number }> = {
  8: { columns: 2, rows: 4 },
  4: { columns: 2, rows: 2 },
}

/** The space kept clear around each page in its cell, about 5 mm. */
const PADDING = 14
const FRAME = rgb(0.75, 0.75, 0.75)

/**
 * Places perSheet pages of the source PDF on each A4 page, in their order, in a grid of equal
 * cells. Each page is scaled to fit its cell and shown the way a viewer shows it, with its crop box
 * and rotation. All pages are embedded in one call, so the resources they share, such as fonts,
 * are copied once.
 */
export async function nUp(source: Uint8Array, perSheet: PagesPerSheet): Promise<Uint8Array<ArrayBuffer>> {
  const input = await PDFDocument.load(source)
  const output = await PDFDocument.create()
  const pages = input.getPages()
  const embedded = await output.embedPages(pages, pages.map(cropBox))
  const { columns, rows } = GRIDS[perSheet]
  const cellWidth = SHEET.width / columns
  const cellHeight = SHEET.height / rows

  for (let first = 0; first < embedded.length; first += perSheet) {
    const sheet = output.addPage([SHEET.width, SHEET.height])
    for (let index = first; index < Math.min(first + perSheet, embedded.length); index++) {
      const column = (index - first) % columns
      const row = Math.floor((index - first) / columns)
      place(sheet, embedded[index], pages[index].getRotation().angle, {
        x: column * cellWidth + PADDING,
        y: SHEET.height - (row + 1) * cellHeight + PADDING,
        width: cellWidth - 2 * PADDING,
        height: cellHeight - 2 * PADDING,
      })
    }
  }
  // save builds a new Uint8Array over its own ArrayBuffer. pdf-lib's types predate typed array generics.
  return (await output.save()) as Uint8Array<ArrayBuffer>
}

/** Draws the page as large as fits in the area, centred, turned by its /Rotate, with a thin frame. */
function place(sheet: PDFPage, page: PDFEmbeddedPage, rotate: number, area: { x: number; y: number; width: number; height: number }) {
  const turn = (((rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270
  const [shownWidth, shownHeight] = turn === 90 || turn === 270 ? [page.height, page.width] : [page.width, page.height]
  const scale = Math.min(area.width / shownWidth, area.height / shownHeight)
  const width = shownWidth * scale
  const height = shownHeight * scale
  const x = area.x + (area.width - width) / 2
  const y = area.y + (area.height - height) / 2
  // /Rotate turns a page clockwise on screen. Turning it the same way about the corner it is drawn
  // from moves it off that corner, so the corner moves by the turned size.
  const corner = { 0: { x, y }, 90: { x, y: y + height }, 180: { x: x + width, y: y + height }, 270: { x: x + width, y } }[turn]
  sheet.drawPage(page, { ...corner, xScale: scale, yScale: scale, rotate: degrees(-turn) })
  sheet.drawRectangle({ x, y, width, height, borderColor: FRAME, borderWidth: 0.5 })
}

/** The part of the page a viewer shows. */
function cropBox(page: PDFPage) {
  const { x, y, width, height } = page.getCropBox()
  return { left: x, bottom: y, right: x + width, top: y + height }
}
