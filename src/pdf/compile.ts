// The PDF engine's compile, a pure function over bytes that runs in the browser and in Node. It
// builds one course file's PDF from its compile manifest.
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CompileManifest, ManifestCover, ManifestFile, ManifestSection } from '../../supabase/functions/_shared/manifest.ts'

export type { CompileManifest }

/** Gets the bytes at a file's download URL. The browser passes a wrapper of fetch. */
export type FetchBytes = (url: string) => Promise<Uint8Array>

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
/** How many sections each contents page lists. The 19 sections fit on one. */
const CONTENTS_PER_PAGE = 28
const CONTENTS_LINE = 22
const MUTED = rgb(0.4, 0.4, 0.4)

type Fonts = { regular: PDFFont; bold: PDFFont }

/**
 * The course file as one PDF: a cover page, the table of contents, and for each section of the
 * manifest a divider page followed by the pages of its files in order. Every page has its number
 * at the bottom, "Page n of N". The contents give the page of each divider.
 *
 * Files are fetched and copied one at a time, so the browser holds one source file besides the PDF
 * it builds. A file that cannot be fetched or read stops the compile with a CompileError naming it.
 */
export async function compile(manifest: CompileManifest, fetchBytes: FetchBytes): Promise<Uint8Array<ArrayBuffer>> {
  const output = await PDFDocument.create()
  output.setTitle(`${manifest.cover.courseCode} ${manifest.cover.courseTitle} ${manifest.cover.semester}`)
  const fonts = { regular: await output.embedFont(StandardFonts.Helvetica), bold: await output.embedFont(StandardFonts.HelveticaBold) }
  const addSheet = () => output.addPage([SHEET.width, SHEET.height])

  drawCover(addSheet(), manifest.cover, fonts)
  const contentsPages = Array.from({ length: Math.max(1, Math.ceil(manifest.sections.length / CONTENTS_PER_PAGE)) }, addSheet)
  const dividerPages: number[] = []
  for (const section of manifest.sections) {
    dividerPages.push(output.getPageCount() + 1)
    drawDivider(addSheet(), section, fonts)
    for (const file of section.files) {
      const source = await load(file, section, fetchBytes)
      for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page)
    }
  }
  drawContents(contentsPages, manifest.sections, dividerPages, fonts)
  stampPageNumbers(output.getPages(), fonts.regular)
  // save builds a new Uint8Array over its own ArrayBuffer. pdf-lib's types predate typed array generics.
  return (await output.save()) as Uint8Array<ArrayBuffer>
}

async function load(file: ManifestFile, section: ManifestSection, fetchBytes: FetchBytes) {
  const bytes = await fetchBytes(file.url).catch((error: unknown) => {
    throw new CompileError(file, section, new FetchFailed(String(error), { cause: error }))
  })
  return PDFDocument.load(bytes).catch((error: unknown) => {
    throw new CompileError(file, section, error)
  })
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

/** Each contents line gives a section's number and title, and the page of its divider at the right. */
function drawContents(pages: PDFPage[], sections: ManifestSection[], dividerPages: number[], fonts: Fonts) {
  const size = 12
  pages[0].drawText('Contents', { x: MARGIN, y: SHEET.height - MARGIN - 24, size: 22, font: fonts.bold })
  sections.forEach((section, index) => {
    const page = pages[Math.floor(index / CONTENTS_PER_PAGE)]
    const y = SHEET.height - MARGIN - 72 - (index % CONTENTS_PER_PAGE) * CONTENTS_LINE
    const number = String(dividerPages[index])
    page.drawText(String(section.number), { x: MARGIN, y, size, font: fonts.regular, color: MUTED })
    page.drawText(printable(section.title, fonts.regular), { x: MARGIN + 32, y, size, font: fonts.regular })
    page.drawText(number, { x: SHEET.width - MARGIN - fonts.regular.widthOfTextAtSize(number, size), y, size, font: fonts.regular })
  })
}

/**
 * Writes "Page n of N" centred at the bottom of each page as a viewer shows it: inside its crop
 * box, and turned with its /Rotate so that it reads upright.
 */
function stampPageNumbers(pages: PDFPage[], font: PDFFont) {
  const size = 9
  const fromBottom = 20
  pages.forEach((page, index) => {
    const text = `Page ${index + 1} of ${pages.length}`
    const turn = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270
    const box = page.getCropBox()
    const shownWidth = turn === 90 || turn === 270 ? box.height : box.width
    // Where the text starts on the page as shown, then the same point in the page's own coordinates.
    const x = (shownWidth - font.widthOfTextAtSize(text, size)) / 2
    const y = fromBottom
    const start = {
      0: { x, y },
      90: { x: box.width - y, y: x },
      180: { x: box.width - x, y: box.height - y },
      270: { x: y, y: box.height - x },
    }[turn]
    page.drawText(text, { x: box.x + start.x, y: box.y + start.y, size, font, color: MUTED, rotate: degrees(turn) })
  })
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
