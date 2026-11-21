import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'
import { findBannedPhrases } from './copy-rules.ts'

const SRC = import.meta.dirname

/** The app's source files that hold words people read. Tests and fixtures talk to developers. */
function sourceFiles() {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.ts$|fixture/.test(path) && path !== 'copy-rules.ts')
    .map((path) => join(SRC, path))
}

test('no source file uses a banned phrase', () => {
  const violations = sourceFiles().flatMap((file) =>
    findBannedPhrases(readFileSync(file, 'utf8')).map(({ line, text, why }) => `${relative(SRC, file)}:${line} "${text}" ${why}`),
  )
  expect(violations).toEqual([])
})

test('the scan reads every page and component', () => {
  const files = sourceFiles().map((file) => relative(SRC, file))
  expect(files).toContain(join('pages', 'Users.tsx'))
  expect(files).toContain(join('components', 'app-shell.tsx'))
  expect(files).toContain('uploads.ts')
})

test('a banned phrase in a string or in JSX text is found, on its line', () => {
  const source = ['const a = 1', "toast.success('Saved successfully')", '<p>Your department is set by an admin.</p>'].join('\n')
  expect(findBannedPhrases(source)).toEqual([
    { line: 2, text: 'successfully', why: 'Say what happened.' },
    { line: 3, text: 'an admin', why: 'State what is so, not who does it.' },
    { line: 3, text: 'is set by', why: 'State what is so, not who does it.' },
  ])
})

test('comments may use any phrase, and a URL is not a comment', () => {
  const source = [
    '// The admin uploads it to SharePoint.',
    '/* Staff see it',
    '   once the RPC runs. */',
    "const link = 'https://example.com/please'",
  ].join('\n')
  expect(findBannedPhrases(source)).toEqual([{ line: 4, text: 'please', why: 'Plain words do not plead.' }])
})

test('the admin role may be named', () => {
  expect(findBannedPhrases("'Grant the admin role'")).toEqual([])
})
