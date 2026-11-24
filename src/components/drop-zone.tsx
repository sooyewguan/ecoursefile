import { UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Whether a drag carries files from outside the page, such as PDFs from the desktop. Dragging a row to reorder it carries none. */
export function carriesFiles(event: { dataTransfer: DataTransfer | null }) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Whether files from outside the page are being dragged over it. While enabled, a drop that no
 * DropZone takes goes to onMissed, instead of the browser opening the file in place of the app.
 */
export function useFileDrag(enabled: boolean, onMissed: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  const missed = useRef(onMissed)
  useEffect(() => {
    missed.current = onMissed
  })

  useEffect(() => {
    if (!enabled) return
    // dragenter and dragleave fire for every element the pointer crosses, so a count of them says when it leaves the window.
    let depth = 0
    const enter = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      depth++
      setDragging(true)
    }
    const leave = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (event: globalThis.DragEvent) => {
      if (carriesFiles(event)) event.preventDefault()
    }
    const drop = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      depth = 0
      setDragging(false)
      // A DropZone that took the files has prevented the default already.
      if (event.defaultPrevented) return
      event.preventDefault()
      missed.current(Array.from(event.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [enabled])

  return dragging
}

/**
 * A place that takes PDFs dropped from the desktop, named by label, such as Lab 1 Lab Sheet. While
 * files are dragged over the page, active outlines it, and over itself it says where a drop goes.
 * Dropping gives the files to onDrop. Rows dragged inside it to reorder them pass through.
 */
export function DropZone({
  label,
  active,
  onDrop,
  className,
  children,
}: {
  label: string
  active: boolean
  onDrop: (files: File[]) => void
  className?: string
  children: ReactNode
}) {
  const [depth, setDepth] = useState(0)
  const over = active && depth > 0

  const handle = (event: DragEvent<HTMLElement>, change: (depth: number) => number) => {
    if (!carriesFiles(event)) return false
    event.preventDefault()
    setDepth(change)
    return true
  }

  return (
    <div
      className={cn('relative rounded-xl', className)}
      onDragEnter={(event) => handle(event, (depth) => depth + 1)}
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={(event) => handle(event, (depth) => Math.max(0, depth - 1))}
      onDrop={(event) => {
        if (handle(event, () => 0)) onDrop(Array.from(event.dataTransfer.files))
      }}
    >
      {children}
      {active && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute -inset-1.5 flex items-center justify-center rounded-xl border-2 border-dashed',
            over ? 'border-primary bg-primary/10' : 'border-primary/40',
          )}
        >
          {over && (
            <span className="bg-primary text-primary-foreground flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm">
              <UploadIcon className="size-4" />
              Drop to upload to {label}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
