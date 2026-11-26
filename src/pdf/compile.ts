// The PDF engine's compile, a pure function over bytes that runs in the browser and in Node. It
// builds one course file's PDF from its compile manifest.
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import type { CompileManifest, ManifestCover, ManifestFile, ManifestSection } from '../../supabase/functions/_shared/manifest.ts'
import { itemName, SECTION_SLOTS } from '../../supabase/functions/_shared/sections.ts'
import { loadPdf } from './load.ts'

/** A file to compile, with the number of its item and the name of its slot in a section that has them. */
export type CompileFile = ManifestFile & { item?: number | null; slot?: string | null }

/** A section to compile, with its files in order. */
export type CompileSection = Omit<ManifestSection, 'files'> & { files: CompileFile[] }

/** The manifest, with the item and slot of each file in a section that has them. */
export type CourseFileManifest = Omit<CompileManifest, 'sections'> & { sections: CompileSection[] }

/** Gets a file's bytes. The browser passes a wrapper of fetch over the file's download URL. */
export type FetchBytes = (file: CompileFile) => Promise<Uint8Array>

/** A file of the manifest that could not be fetched or read as a PDF. */
export class CompileError extends Error {
  file: ManifestFile
  section: ManifestSection
  constructor(file: ManifestFile, section: ManifestSection, cause: unknown) {
    super(`${file.name} in section ${section.number} ${section.title} could not be ${cause instanceof FetchFailed ? 'downloaded' : 'read as a PDF'}.`, { cause })
    this.file = file
    this.section = section
  }
}

class FetchFailed extends Error {}

/** A4 portrait in PDF points, the size of the cover, contents and divider pages. */
const SHEET = { width: 595.28, height: 841.89 }
const MARGIN = 72
/** How many lines each contents page lists: sections, and the items under them. The 19 sections fit on one. */
const CONTENTS_PER_PAGE = 28
const CONTENTS_LINE = 22
const MUTED = rgb(0.4, 0.4, 0.4)

type Fonts = { regular: PDFFont; bold: PDFFont }

/** A line of the contents: a section, or one of its items, such as Lab 2, under it. */
type ContentsLine = { section: CompileSection; item: number | null }

/** The contents: each section, and under a section with items each of its items that has files, in order. */
function contentsLines(sections: CompileSection[]): ContentsLine[] {
  return sections.flatMap((section) => [
    { section, item: null },
    ...[...new Set(section.files.flatMap((file) => (file.item == null ? [] : [file.item])))].map((item) => ({ section, item })),
  ])
}

/** The label of a file's item and slot, such as Lab 1, Answer Scheme, or PO Achievement. Null outside items and slots. */
function placeLabel(section: number, { item, slot }: CompileFile) {
  const slotTitle = SECTION_SLOTS[section]?.find((s) => s.name === slot)?.title
  const parts = [item == null ? undefined : itemName(section, item), slotTitle].filter((part) => part !== undefined)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * The course file as one PDF: a cover page, the table of contents, and for each section of the
 * manifest a divider page followed by the pages of its files in order. Every page has its number
 * at the bottom, "Page n of N". The contents give the page of each divider, and under a section
 * with items the page each item starts on. The first page of each item and slot is labelled at its
 * top, such as "Lab 1, Answer Scheme".
 *
 * Files are fetched and copied one at a time, so the browser holds one source file besides the PDF
 * it builds. A file that cannot be fetched or read stops the compile with a CompileError naming it.
 */
export async function compile(manifest: CourseFileManifest, fetchBytes: FetchBytes): Promise<Uint8Array<ArrayBuffer>> {
  const output = await PDFDocument.create()
  output.setTitle(`${manifest.cover.courseCode} ${manifest.cover.courseTitle} ${manifest.cover.semester}`)
  const fonts = { regular: await output.embedFont(StandardFonts.Helvetica), bold: await output.embedFont(StandardFonts.HelveticaBold) }
  const addSheet = () => output.addPage([SHEET.width, SHEET.height])

  drawCover(addSheet(), manifest.cover, fonts)
  const lines = contentsLines(manifest.sections)
  const contentsPages = Array.from({ length: Math.max(1, Math.ceil(lines.length / CONTENTS_PER_PAGE)) }, addSheet)
  /** The page each contents line starts on, in the order of the lines. */
  const startPages: number[] = []
  for (const section of manifest.sections) {
    startPages.push(output.getPageCount() + 1)
    drawDivider(addSheet(), section, fonts)
    let previous: CompileFile | undefined
    for (const file of section.files) {
      const label = placeLabel(section.number, file)
      const startsItem = file.item != null && file.item !== previous?.item
      const startsPlace = label !== null && (startsItem || file.slot !== previous?.slot)
      if (startsItem) startPages.push(output.getPageCount() + 1)
      for (const [index, page] of (await copyPages(output, file, section, fetchBytes)).entries()) {
        output.addPage(page)
        if (index === 0 && startsPlace) drawLabel(page, label, fonts.bold)
      }
      previous = file
    }
  }
  drawContents(contentsPages, lines, startPages, fonts)
  stampPageNumbers(output.getPages(), fonts.regular)
  // save builds a new Uint8Array over its own ArrayBuffer. pdf-lib's types predate typed array generics.
  return (await output.save()) as Uint8Array<ArrayBuffer>
}

/** The file's pages, copied into the output. Any failure to fetch the file or to read or copy its pages is a CompileError naming it. */
async function copyPages(output: PDFDocument, file: CompileFile, section: CompileSection, fetchBytes: FetchBytes) {
  const bytes = await fetchBytes(file).catch((error: unknown) => {
    throw new CompileError(file, section, new FetchFailed(String(error), { cause: error }))
  })
  try {
    const source = await loadPdf(bytes)
    return await output.copyPages(source, source.getPageIndices())
  } catch (error) {
    throw new CompileError(file, section, error)
  }
}

function drawCover(page: PDFPage, cover: ManifestCover, fonts: Fonts) {
  const width = SHEET.width - 2 * MARGIN
  let y = SHEET.height - MARGIN
  const lines = (text: string, font: PDFFont, size: number, color = rgb(0, 0, 0)) => {
    for (const line of wrap(printable(text, font), font, size, width)) {
      y -= size * 1.25
      page.drawText(line, { x: MARGIN, y, size, font, color })
    }
  }

  lines('Course File', fonts.regular, 12, MUTED)
  y -= 12
  lines(cover.courseCode, fonts.bold, 26)
  lines(cover.courseTitle, fonts.bold, 20)
  const fields: [string, string[]][] = [
    ['Semester', [cover.semester]],
    ['Department', [cover.department]],
    ['Coordinator', [cover.coordinator]],
    ['Lecturers', cover.lecturers],
  ]
  for (const [label, values] of fields) {
    y -= 24
    lines(label, fonts.regular, 10, MUTED)
    for (const value of values) lines(value, fonts.regular, 13)
  }
}

function drawDivider(page: PDFPage, section: ManifestSection, fonts: Fonts) {
  const width = SHEET.width - 2 * MARGIN
  let y = SHEET.height / 2 + 40
  page.drawText(`Section ${section.number}`, { x: MARGIN, y, size: 14, font: fonts.regular, color: MUTED })
  for (const line of wrap(printable(section.title, fonts.bold), fonts.bold, 30, width)) {
    y -= 38
    page.drawText(line, { x: MARGIN, y, size: 30, font: fonts.bold })
  }
  if (section.files.length === 0) page.drawText('No files in this section.', { x: MARGIN, y: y - 32, size: 12, font: fonts.regular, color: MUTED })
}

/**
 * Each contents line gives a section's number and title and the page of its divider at the right,
 * or, under a section with items, an item's name and the page it starts on.
 */
function drawContents(pages: PDFPage[], lines: ContentsLine[], startPages: number[], fonts: Fonts) {
  const size = 12
  pages[0].drawText('Contents', { x: MARGIN, y: SHEET.height - MARGIN - 24, size: 22, font: fonts.bold })
  lines.forEach(({ section, item }, index) => {
    const page = pages[Math.floor(index / CONTENTS_PER_PAGE)]
    const y = SHEET.height - MARGIN - 72 - (index % CONTENTS_PER_PAGE) * CONTENTS_LINE
    const number = String(startPages[index])
    if (item === null) {
      page.drawText(String(section.number), { x: MARGIN, y, size, font: fonts.regular, color: MUTED })
      page.drawText(printable(section.title, fonts.regular), { x: MARGIN + 32, y, size, font: fonts.regular })
    } else {
      page.drawText(itemName(section.number, item), { x: MARGIN + 48, y, size, font: fonts.regular })
    }
    page.drawText(number, { x: SHEET.width - MARGIN - fonts.regular.widthOfTextAtSize(number, size), y, size, font: fonts.regular })
  })
}

/** Writes "Page n of N" centred at the bottom of each page as a viewer shows it. */
function stampPageNumbers(pages: PDFPage[], font: PDFFont) {
  const size = 9
  pages.forEach((page, index) => {
    const text = `Page ${index + 1} of ${pages.length}`
    drawShown(page, text, { x: (shownSize(page).width - font.widthOfTextAtSize(text, size)) / 2, y: 20, size, font, color: MUTED })
  })
}

/** Writes the label of an item and slot at the top left of its first page as a viewer shows it, on white so that it reads on a scan. */
function drawLabel(page: PDFPage, label: string, font: PDFFont) {
  const size = 10
  drawShown(page, printable(label, font), { x: 24, y: shownSize(page).height - 24 - size, size, font, color: rgb(0, 0, 0), background: true })
}

/** The page's size as a viewer shows it: its crop box, turned by its /Rotate. */
function shownSize(page: PDFPage) {
  const box = page.getCropBox()
  return page.getRotation().angle % 180 === 0 ? { width: box.width, height: box.height } : { width: box.height, height: box.width }
}

/**
 * Writes text that starts at x and y on the page as a viewer shows it, from its bottom left: inside
 * its crop box, and turned with its /Rotate so that it reads upright. background puts a white box
 * behind the text.
 */
function drawShown(
  page: PDFPage,
  text: string,
  { x, y, size, font, color, background = false }: { x: number; y: number; size: number; font: PDFFont; color: RGB; background?: boolean },
) {
  const turn = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270
  const box = page.getCropBox()
  // A point of the page as shown, in the page's own coordinates.
  const at = (x: number, y: number) =>
    ({
      0: { x, y },
      90: { x: box.width - y, y: x },
      180: { x: box.width - x, y: box.height - y },
      270: { x: y, y: box.height - x },
    })[turn]
  const rotate = degrees(turn)
  if (background) {
    const pad = 4
    const corner = at(x - pad, y - pad - size * 0.25)
    const width = font.widthOfTextAtSize(text, size) + 2 * pad
    page.drawRectangle({ x: box.x + corner.x, y: box.y + corner.y, width, height: size * 1.25 + 2 * pad, color: rgb(1, 1, 1), rotate })
  }
  const start = at(x, y)
  page.drawText(text, { x: box.x + start.x, y: box.y + start.y, size, font, color, rotate })
}

/** The text with each character that the font cannot encode, such as one outside Windows-1252, as "?". */
function printable(text: string, font: PDFFont) {
  const supported = new Set(font.getCharacterSet())
  return Array.from(text, (character) => (supported.has(character.codePointAt(0)!) ? character : '?')).join('')
}

/** The text in lines no wider than width, broken between words, and inside a word too long for a line. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const fits = (line: string) => font.widthOfTextAtSize(line, size) <= width
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word
    if (fits(joined)) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const character of word) {
      if (line && !fits(line + character)) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  return line ? [...lines, line] : lines
}
