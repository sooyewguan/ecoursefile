// Seam 3: compile, driven with a manifest of generated fixture PDFs, and read back the way a viewer
// shows the result.
import { PDFDocument, PDFName } from 'pdf-lib'
import { expect, test } from 'vitest'
import { compile, CompileError, type CompileManifest } from './compile.ts'
import { numberedPdf, readPdf, undrawablePdf, type ShownPage } from './fixtures.ts'

const COVER = {
  courseCode: 'BITP1113',
  courseTitle: 'Programming Technique',
  semester: '2026/2027-1',
  department: 'Software Engineering',
  coordinator: 'Zainab Ahmad',
  lecturers: ['Zainab Ahmad', 'Aisyah Rahman', 'Bala Subramaniam'],
}

/** A file of a fixture manifest: its name, which each of its pages shows with the page's number, and the numberedPdf options. */
type FixtureFile = { name: string; pages: number; rotate?: number; bleed?: number; width?: number; height?: number }

/**
 * A manifest with these sections and files, and a fetch that serves each file's PDF. Page n of a
 * file shows "<file name> n".
 */
async function fixture(sections: { number: number; title: string; files: FixtureFile[] }[], cover = COVER) {
  const served = new Map<string, Uint8Array>()
  const manifest: CompileManifest = { cover, sections: [] }
  for (const { number, title, files } of sections) {
    const listed = []
    for (const { name, pages, ...options } of files) {
      const url = `https://storage.test/${number}/${name}`
      served.set(url, await numberedPdf(pages, { label: name, ...options }))
      listed.push({ id: url, name, url })
    }
    manifest.sections.push({ number, title, files: listed })
  }
  return { manifest, fetchBytes: async (url: string) => served.get(url)! }
}

const SECTIONS = [
  { number: 2, title: 'Teaching Plan', files: [{ name: 'plan-b', pages: 2 }, { name: 'plan-a', pages: 1 }] },
  { number: 6, title: 'Attendance Record', files: [] },
  { number: 11, title: 'Lab Exercises', files: [{ name: 'lab-sheet', pages: 3 }] },
]

/** Forty one-page sections, more than one contents page lists. */
const MANY_SECTIONS = Array.from({ length: 40 }, (_, index) => ({ number: index + 1, title: `Part ${index + 1}`, files: [{ name: `file-${index + 1}`, pages: 1 }] }))

async function compiled(sections: Parameters<typeof fixture>[0], cover = COVER) {
  const { manifest, fetchBytes } = await fixture(sections, cover)
  return readPdf(await compile(manifest, fetchBytes))
}

const textsOf = (page: ShownPage) => page.texts.map((piece) => piece.text)

/** The contents lines of the pages, each as its texts from left to right. */
function contentsLines(pages: ShownPage[]) {
  return pages.flatMap((page) => {
    const lines = new Map<number, ShownPage['texts']>()
    for (const piece of page.texts) lines.set(Math.round(piece.y), [...(lines.get(Math.round(piece.y)) ?? []), piece])
    return [...lines.entries()]
      .toSorted(([a], [b]) => b - a)
      .map(([, pieces]) => pieces.toSorted((a, b) => a.x - b.x).map((piece) => piece.text))
      .filter((line) => line.length === 3)
  })
}

test('the PDF is a cover, the contents, then a divider before each section followed by its files in order', async () => {
  const pages = await compiled(SECTIONS)

  expect(pages.map((page) => textsOf(page).find((text) => !text.startsWith('Page ')))).toEqual([
    'Course File',
    'Contents',
    'Section 2',
    'plan-b 1',
    'plan-b 2',
    'plan-a 1',
    'Section 6',
    'Section 11',
    'lab-sheet 1',
    'lab-sheet 2',
    'lab-sheet 3',
  ])
  expect(textsOf(pages[2])).toEqual(expect.arrayContaining(['Section 2', 'Teaching Plan']))
  expect(textsOf(pages[6])).toEqual(expect.arrayContaining(['Section 6', 'Attendance Record', 'No files in this section.']))
  expect(textsOf(pages[2])).not.toContain('No files in this section.')
})

test.each([
  { label: 'the sections', sections: SECTIONS, contentsPages: 1 },
  { label: 'more sections than one contents page lists', sections: MANY_SECTIONS, contentsPages: 2 },
])('the contents list $label with the page each divider falls on', async ({ sections, contentsPages }) => {
  const pages = await compiled(sections)

  const lines = contentsLines(pages.slice(1, 1 + contentsPages))
  expect(lines.map(([number, title]) => [Number(number), title])).toEqual(sections.map((section) => [section.number, section.title]))
  for (const [number, title, pageNumber] of lines) {
    expect(textsOf(pages[Number(pageNumber) - 1]), `divider of section ${number}`).toEqual(expect.arrayContaining([`Section ${number}`, title]))
  }
  expect(textsOf(pages[1 + contentsPages])).toContain(`Section ${sections[0].number}`)
})

test('every page carries its number, upright and centred at the bottom, on rotated, cropped and landscape pages too', async () => {
  const pages = await compiled([
    { number: 2, title: 'Teaching Plan', files: [{ name: 'upright', pages: 1, width: 595, height: 842 }] },
    ...[90, 180, 270].map((rotate) => ({ number: 2 + rotate / 90, title: `Turned ${rotate}`, files: [{ name: `turned-${rotate}`, pages: 2, rotate }] })),
    { number: 6, title: 'Cropped', files: [{ name: 'bleed', pages: 1, bleed: 200 }] },
  ])

  expect(pages).toHaveLength(2 + 5 + 8)
  pages.forEach((page, index) => {
    const stamps = page.texts.filter((piece) => /^Page \d+ of \d+$/.test(piece.text))
    expect(stamps.map((stamp) => stamp.text), `page ${index + 1}`).toEqual([`Page ${index + 1} of ${pages.length}`])
    const [stamp] = stamps
    expect(stamp.upright, `page ${index + 1} upright`).toBe(true)
    expect(stamp.y, `page ${index + 1} bottom`).toBeGreaterThan(0)
    expect(stamp.y, `page ${index + 1} bottom`).toBeLessThan(40)
    expect(stamp.x, `page ${index + 1} centred`).toBeGreaterThan(page.width / 2 - 60)
    expect(stamp.x, `page ${index + 1} centred`).toBeLessThan(page.width / 2)
  })
  // The turned pages and the cropped page show as 960 by 540 landscape slides.
  expect(pages.filter((page) => Math.round(page.width) === 960 && Math.round(page.height) === 540)).toHaveLength(7)
})

test('the cover shows the course code and title, semester, department, coordinator and every lecturer', async () => {
  const [cover] = await compiled(SECTIONS, { ...COVER, lecturers: [...COVER.lecturers, 'Tan 陈明'] })

  expect(textsOf(cover)).toEqual(
    expect.arrayContaining([
      'BITP1113',
      'Programming Technique',
      'Semester',
      '2026/2027-1',
      'Department',
      'Software Engineering',
      'Coordinator',
      'Zainab Ahmad',
      'Lecturers',
      'Aisyah Rahman',
      'Bala Subramaniam',
      'Tan ??',
    ]),
  )
})

const encode = (text: string) => new TextEncoder().encode(text)

/** A PDF whose page has neither a media box nor a crop box, so it has no size. */
async function sizelessPdf() {
  const pdf = await PDFDocument.load(await numberedPdf(1))
  for (const box of ['MediaBox', 'CropBox']) pdf.getPage(0).node.delete(PDFName.of(box))
  return pdf.save()
}

test.each([
  { problem: 'cannot be fetched', get: () => Promise.reject(new TypeError('Failed to fetch')) },
  { problem: 'is not a PDF', get: async () => encode('not a pdf') },
  { problem: 'is only a PDF header', get: async () => encode('%PDF-1.4\n%%EOF\n') },
  { problem: 'is a PDF header then garbage', get: async () => encode('%PDF-1.7 not really') },
  { problem: 'has a page without a size', get: sizelessPdf },
  { problem: 'has a page whose /Resources is an array', get: () => undrawablePdf('Resources') },
  { problem: 'has a page whose /Contents is a number', get: () => undrawablePdf('Contents') },
])('a file that $problem stops the compile with a CompileError naming it and its section', async ({ get }) => {
  const { manifest, fetchBytes } = await fixture(SECTIONS)

  const error = await compile(manifest, (url) => (url.endsWith('/11/lab-sheet') ? get() : fetchBytes(url))).catch((error: unknown) => error)

  expect(error).toBeInstanceOf(CompileError)
  expect(error).toMatchObject({ file: { name: 'lab-sheet' }, section: { number: 11 }, message: expect.stringContaining('lab-sheet') })
})
