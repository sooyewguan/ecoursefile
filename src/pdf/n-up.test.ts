// Seam 3: the N-up merge, driven through nUp with generated fixture PDFs and read back the way a
// viewer shows the result.
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { expect, test } from 'vitest'
import { numberedPdf, readPdf, type ShownPage } from './fixtures.ts'
import { nUp, type PagesPerSheet } from './n-up.ts'

/** A4 portrait in points. */
const A4 = { width: 595.28, height: 841.89 }

/** The grid each layout fills, left to right and then top to bottom. */
const GRID: Record<PagesPerSheet, { columns: number; rows: number }> = { 8: { columns: 2, rows: 4 }, 4: { columns: 2, rows: 2 } }

const SLIDE = { width: 960, height: 540 }
const SCRIPT = { width: 595.28, height: 841.89 }

/**
 * Where each source page shows on the sheet: the box around its four corner markers, and whether
 * its text reads upright, keyed by the page number.
 */
function placements(sheet: ShownPage) {
  const byPage = new Map<number, { left: number; right: number; bottom: number; top: number; upright: boolean }>()
  for (const { text, x, y, upright } of sheet.texts) {
    const page = Number(text.replace('Page ', ''))
    const box = byPage.get(page) ?? { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity, upright: true }
    if (!text.startsWith('Page ')) Object.assign(box, { left: Math.min(box.left, x), right: Math.max(box.right, x), bottom: Math.min(box.bottom, y), top: Math.max(box.top, y) })
    box.upright &&= upright
    byPage.set(page, box)
  }
  return byPage
}

/**
 * Checks that the sheet shows the pages in order, each upright, inside its own cell of the grid,
 * and filling at least 80% of the cell's width or height.
 */
function expectGrid(sheet: ShownPage, pages: number[], perSheet: PagesPerSheet) {
  const { columns, rows } = GRID[perSheet]
  const cell = { width: sheet.width / columns, height: sheet.height / rows }
  const shown = placements(sheet)
  expect([...shown.keys()].toSorted((a, b) => a - b)).toEqual(pages)
  pages.forEach((page, index) => {
    const box = shown.get(page)!
    const left = (index % columns) * cell.width
    const top = sheet.height - Math.floor(index / columns) * cell.height
    expect(box.upright, `page ${page} is upright`).toBe(true)
    expect(box.left, `page ${page} left`).toBeGreaterThan(left)
    expect(box.right, `page ${page} right`).toBeLessThan(left + cell.width)
    expect(box.top, `page ${page} top`).toBeLessThan(top)
    expect(box.bottom, `page ${page} bottom`).toBeGreaterThan(top - cell.height)
    expect(Math.max((box.right - box.left) / cell.width, (box.top - box.bottom) / cell.height), `page ${page} fills its cell`).toBeGreaterThan(0.8)
  })
}

test.each([
  { perSheet: 8, count: 1, sheets: 1 },
  { perSheet: 8, count: 8, sheets: 1 },
  { perSheet: 8, count: 9, sheets: 2 },
  { perSheet: 8, count: 37, sheets: 5 },
  { perSheet: 4, count: 1, sheets: 1 },
  { perSheet: 4, count: 4, sheets: 1 },
  { perSheet: 4, count: 5, sheets: 2 },
  { perSheet: 4, count: 37, sheets: 10 },
] as const)('$count pages merged $perSheet-up make $sheets A4 portrait pages', async ({ perSheet, count, sheets }) => {
  const merged = await readPdf(await nUp(await numberedPdf(count), perSheet))

  expect(merged).toHaveLength(sheets)
  for (const sheet of merged) {
    expect(sheet.width).toBeCloseTo(A4.width, 1)
    expect(sheet.height).toBeCloseTo(A4.height, 1)
  }
})

test.each([
  { perSheet: 8, source: SLIDE, label: 'landscape slides' },
  { perSheet: 8, source: SCRIPT, label: 'A4 portrait pages' },
  { perSheet: 4, source: SCRIPT, label: 'A4 portrait pages' },
  { perSheet: 4, source: SLIDE, label: 'landscape slides' },
] as const)('$perSheet-up shows $label in order, in a grid that fits the page', async ({ perSheet, source }) => {
  const count = 2 * perSheet + 3
  const merged = await readPdf(await nUp(await numberedPdf(count, source), perSheet))

  const pages = Array.from({ length: count }, (_, index) => index + 1)
  expect(merged).toHaveLength(3)
  merged.forEach((sheet, index) => expectGrid(sheet, pages.slice(index * perSheet, (index + 1) * perSheet), perSheet))
})

test.each([90, 180, 270])('pages with /Rotate %i show upright and fit their cells, 8-up and 4-up', async (rotate) => {
  for (const source of [SLIDE, SCRIPT]) {
    const fixture = await numberedPdf(5, { ...source, rotate })
    expect((await readPdf(fixture))[0]).toMatchObject(source)

    expectGrid((await readPdf(await nUp(fixture, 8)))[0], [1, 2, 3, 4, 5], 8)
    expectGrid((await readPdf(await nUp(fixture, 4)))[0], [1, 2, 3, 4], 4)
  }
})

test('pages show only their crop box, so media box bleed takes no room', async () => {
  const [sheet] = await readPdf(await nUp(await numberedPdf(4, { ...SLIDE, bleed: 400 }), 4))

  expectGrid(sheet, [1, 2, 3, 4], 4)
})

test('a font that every source page uses is stored once in the merged PDF', async () => {
  const fonts = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes)).context
      .enumerateIndirectObjects()
      .filter(([, object]) => object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Font')).length
  const source = await numberedPdf(16)
  expect(await fonts(source)).toBe(1)

  expect(await fonts(await nUp(source, 8))).toBe(1)
})
