/** What tells two files in one place apart: the name and the size in bytes. */
export type NamedFile = { name: string; size: number }

/**
 * The files of candidates that a place already holds: those with the name and size of a file in
 * held. A place that merges PDFs before it stores them, such as Lecture Notes, holds another size
 * than the picked PDF's, so with merged the name alone decides.
 */
export function alreadyHeld<T extends NamedFile>(candidates: readonly T[], held: readonly NamedFile[], { merged = false } = {}): T[] {
  return candidates.filter((candidate) => held.some((file) => file.name === candidate.name && (merged || file.size === candidate.size)))
}
