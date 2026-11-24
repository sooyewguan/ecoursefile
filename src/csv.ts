// CSV files the app builds in the browser, by RFC 4180: comma-separated, a field in double quotes
// when it holds a comma, quote or line break, a quote inside doubled, and CRLF after each row. A
// UTF-8 byte order mark comes first, so that Excel reads names outside ASCII correctly.

/**
 * A spreadsheet runs a cell that starts with one of these as a formula when it opens a .csv file.
 * Names, titles and emails are typed by users, so such a text starts with ' in the file, which
 * makes the spreadsheet show it as text.
 */
const FORMULA_START = /^[=+\-@\t\r]/

/** CSV text of rows whose fields are already CSV fields. */
export function csvFile(lines: string[][]) {
  return `﻿${lines.map((fields) => fields.join(',')).join('\r\n')}\r\n`
}

/** Text as one CSV field, kept from running as a formula. */
export function csvTextField(text: string) {
  return csvQuoted(FORMULA_START.test(text) ? `'${text}` : text)
}

/** A value as one CSV field, in quotes when it needs them. A number or a date is written as it is. */
export function csvQuoted(text: string) {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
