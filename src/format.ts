/** A file size for people, such as 240 KB or 3.5 MB. */
export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A count and its noun, such as 1 file or 3 files. */
export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
