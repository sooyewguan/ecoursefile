// Seam 3: compile, driven with a manifest of generated fixture PDFs, and read back the way a viewer
// shows the result.
import { PDFDocument, PDFName } from 'pdf-lib'
import { expect, test } from 'vitest'
import { compile, CompileError, type CourseFileManifest } from './compile.ts'
import { numberedPdf, readPdf, undrawablePdf, type ShownPage } from './fixtures.ts'

const COVER = {
  courseCode: 'BITP1113',
  courseTitle: 'Programming Technique',
  semester: '2026/2027-1',
  department: 'Software Engineering',
  coordinator: 'Zainab Ahmad',
  lecturers: ['Zainab Ahmad', 'Aisyah Rahman', 'Bala Subramaniam'],
}

/**
 * A file of a fixture manifest: its name, which each of its pages shows with the page's number, the
 * numberedPdf options, and its item and slot in a section that has them.
 */
type FixtureFile = { name: string; pages: number; rotate?: number; bleed?: number; width?: number; height?: number; item?: number; slot?: string }

/**
 * A manifest with these sections and files, and a fetch that serves each file's PDF. Page n of a
 * file shows "<file name> n".
 */
async function fixture(sections: { number: number; title: string; files: FixtureFile[] }[], cover = COVER) {
  const served = new Map<string, Uint8Array>()
  const manifest: CourseFileManifest = { cover, sections: [] }
  for (const { number, title, files } of sections) {
    const listed = []
    for (const { name, pages, item, slot, ...options } of files) {
      const url = `https://storage.test/${number}/${name}`
      served.set(url, await numberedPdf(pages, { label: name, ...options }))
      listed.push({ id: url, name, url, item, slot })
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

/** A course file with labs, LO/PO slots and a plain section. Lab 2's sheet is a page turned 90 degrees. */
const LABS = [
  { number: 2, title: 'Teaching Plan', files: [{ name: 'plan', pages: 1 }] },
  {
    number: 11,
    title: 'Lab Exercises',
    files: [
      { name: 'lab1-sheet', pages: 2, item: 1, slot: 'lab_sheet' },
      { name: 'lab1-sheet-b', pages: 1, item: 1, slot: 'lab_sheet' },
      { name: 'lab1-scheme', pages: 1, item: 1, slot: 'answer_scheme' },
      { name: 'lab2-sheet', pages: 1, item: 2, slot: 'lab_sheet', rotate: 90 },
    ],
  },
  {
    number: 19,
    title: 'LO/PO Analysis',
    files: [
      { name: 'po', pages: 1, slot: 'po_achievement' },
      { name: 'cqi', pages: 1, slot: 'cqi' },
    ],
  },
]

/** The page's "<file name> n" text, which a fixture file's page shows at its centre, or undefined on a page of the compile's own. */
const markerOf = (page: ShownPage) => textsOf(page).find((text) => /^[a-z0-9-]+ \d+$/.test(text))

/** Every contents line of the pages, each as its texts from left to right, without the heading and page numbers. */
function allContentsLines(pages: ShownPage[]) {
  return pages.flatMap((page) => {
    const lines = new Map<number, ShownPage['texts']>()
    for (const piece of page.texts) {
      if (piece.text === 'Contents' || piece.text.startsWith('Page ')) continue
      lines.set(Math.round(piece.y), [...(lines.get(Math.round(piece.y)) ?? []), piece])
    }
    return [...lines.entries()].toSorted(([a], [b]) => b - a).map(([, pieces]) => pieces.toSorted((a, b) => a.x - b.x).map((piece) => piece.text))
  })
}

test('the first page of each item and slot is labelled with them at its top left, upright, and no other page is', async () => {
  const pages = await compiled(LABS)
  const labels = ['Lab 1, Lab Sheet', 'Lab 1, Answer Scheme', 'Lab 2, Lab Sheet', 'PO Achievement', 'CQI']

  const filePages = pages.filter((page) => markerOf(page))
  expect(filePages.map((page) => [markerOf(page), textsOf(page).filter((text) => labels.includes(text))])).toEqual([
    ['plan 1', []],
    ['lab1-sheet 1', ['Lab 1, Lab Sheet']],
    ['lab1-sheet 2', []],
    ['lab1-sheet-b 1', []],
    ['lab1-scheme 1', ['Lab 1, Answer Scheme']],
    ['lab2-sheet 1', ['Lab 2, Lab Sheet']],
    ['po 1', ['PO Achievement']],
    ['cqi 1', ['CQI']],
  ])
  for (const page of filePages) {
    for (const label of page.texts.filter((piece) => labels.includes(piece.text))) {
      expect(label.upright, `${label.text} upright`).toBe(true)
      expect(label.x, `${label.text} at the left`).toBeLessThan(60)
      expect(label.y, `${label.text} at the top`).toBeGreaterThan(page.height - 60)
    }
  }
})

test('the contents list the items of a section under it, each with the page it starts on', async () => {
  const pages = await compiled(LABS)

  const lines = allContentsLines([pages[1]])
  expect(lines.map((line) => line.slice(0, -1))).toEqual([['2', 'Teaching Plan'], ['11', 'Lab Exercises'], ['Lab 1'], ['Lab 2'], ['19', 'LO/PO Analysis']])
  const pageOf = (name: string) => Number(lines.find((line) => line[0] === name)!.at(-1))
  expect(markerOf(pages[pageOf('Lab 1') - 1])).toBe('lab1-sheet 1')
  expect(markerOf(pages[pageOf('Lab 2') - 1])).toBe('lab2-sheet 1')
  expect(textsOf(pages[pageOf('11') - 1])).toEqual(expect.arrayContaining(['Section 11', 'Lab Exercises']))
})

test('items that fill more than one contents page carry the contents onto the next, and every page number still points at its line', async () => {
  const labs = Array.from({ length: 30 }, (_, index) => ({ name: `lab${index + 1}`, pages: 1, item: index + 1, slot: 'lab_sheet' }))
  const pages = await compiled([
    { number: 2, title: 'Teaching Plan', files: [{ name: 'plan', pages: 1 }] },
    { number: 11, title: 'Lab Exercises', files: labs },
  ])

  expect(markerOf(pages[3])).toBeUndefined()
  expect(textsOf(pages[3])).toContain('Section 2')
  const lines = allContentsLines(pages.slice(1, 3))
  expect(lines).toHaveLength(32)
  for (const [index, lab] of labs.entries()) {
    const line = lines.find((text) => text[0] === `Lab ${index + 1}`)!
    expect(markerOf(pages[Number(line.at(-1)) - 1]), line.join(' ')).toBe(`${lab.name} 1`)
  }
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
