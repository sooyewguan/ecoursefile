import { expect, test } from 'vitest'
import { alreadyHeld } from './duplicates.ts'

const held = [
  { name: 'lab1.pdf', size: 2048 },
  { name: 'notes.pdf', size: 9000 },
]

test('a file with the name and size of one in the place is already held, and any other is not', () => {
  const picked = [
    { name: 'lab1.pdf', size: 2048 },
    { name: 'lab1.pdf', size: 4096 },
    { name: 'lab2.pdf', size: 2048 },
    { name: 'LAB1.pdf', size: 2048 },
  ]

  expect(alreadyHeld(picked, held)).toEqual([{ name: 'lab1.pdf', size: 2048 }])
})

test('where the place merges PDFs before it stores them, the name alone decides', () => {
  const picked = [
    { name: 'notes.pdf', size: 120_000 },
    { name: 'other.pdf', size: 9000 },
  ]

  expect(alreadyHeld(picked, held, { merged: true })).toEqual([{ name: 'notes.pdf', size: 120_000 }])
})

test('an empty place holds nothing', () => {
  expect(alreadyHeld([{ name: 'lab1.pdf', size: 2048 }], [])).toEqual([])
})
