/** Words that join a given name to a parent's name, such as "bin" and "a/l", and are not initials. */
const NAME_LINKS = new Set(['bin', 'binti', 'bt', 'bte', 'a/l', 'a/p', 's/o', 'd/o'])

/** The first letters of the first two words of a name, skipping words such as "binti": "Aisyah binti Rahman" is "AR". */
export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter((word) => word && !NAME_LINKS.has(word.toLowerCase()))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}
