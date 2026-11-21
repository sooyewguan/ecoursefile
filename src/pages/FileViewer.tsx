import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { reuseSlotOf } from '@/components/file-link'
import { LoadError, NotFound, useDocumentTitle } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '../supabase.ts'
import { FileActionError, fetchFile } from '../uploads.ts'

/** The file once it has come, as a URL of its bytes in this tab, or why it did not. */
type Shown = { name: string; url: string } | 'not-found' | 'failed'

/**
 * One file in a tab of its own, which file links open: its name, a Download button, and the PDF in
 * the browser's viewer. The bytes come through a short-lived URL from the files function, which
 * shows the file only to a user who may read it.
 */
export function FileViewer() {
  const { fileId } = useParams()
  const [searchParams] = useSearchParams()
  const place = searchParams.toString()
  const [shown, setShown] = useState<Shown | null>(null)
  const [attempt, setAttempt] = useState(0)
  const file = typeof shown === 'object' ? shown : null
  useDocumentTitle(shown === 'not-found' ? 'File not found' : (file?.name ?? 'File'))

  useEffect(() => {
    let current = true
    let url: string | null = null
    setShown(null)
    fetchFile(supabase, fileId!, reuseSlotOf(new URLSearchParams(place))).then(
      ({ name, blob }) => {
        if (!current) return
        url = URL.createObjectURL(blob)
        setShown({ name, url })
      },
      (error: unknown) => current && setShown(error instanceof FileActionError && error.code === 'not_found' ? 'not-found' : 'failed'),
    )
    return () => {
      current = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [fileId, place, attempt])

  if (shown === 'not-found') {
    return (
      <main className="mx-auto w-full max-w-xl p-4 md:p-8">
        <NotFound icon={FileTextIcon} title="File not found" backTo="/" backLabel="Home" />
      </main>
    )
  }
  if (shown === 'failed') {
    return (
      <main className="mx-auto w-full max-w-xl p-4 md:p-8">
        <LoadError title="Couldn't open this file" onRetry={() => setAttempt((count) => count + 1)} />
      </main>
    )
  }

  return (
    <main className="flex h-svh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <FileTextIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        {file ? <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</h1> : <Skeleton className="h-5 max-w-56 flex-1" />}
        {file ? (
          <Button asChild variant="outline" size="sm">
            <a href={file.url} download={file.name}>
              <DownloadIcon />
              Download
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <DownloadIcon />
            Download
          </Button>
        )}
      </header>
      {file ? (
        <iframe title={file.name} src={file.url} className="w-full flex-1" />
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      )}
    </main>
  )
}
