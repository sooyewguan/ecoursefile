import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'

// AlertDescription is a grid, which puts each child on its own row, so the text goes in one
// paragraph and a link inside it flows with the words around it.

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>
        <p>{children}</p>
      </AlertDescription>
    </Alert>
  )
}

export function SuccessAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="success" role="status">
      <CircleCheckIcon />
      <AlertDescription>
        <p>{children}</p>
      </AlertDescription>
    </Alert>
  )
}

/** The outcome of the last action on a page. */
export type Notice = { tone: 'success' | 'error'; text: string }

export function NoticeAlert({ notice }: { notice: Notice }) {
  return notice.tone === 'success' ? <SuccessAlert>{notice.text}</SuccessAlert> : <ErrorAlert>{notice.text}</ErrorAlert>
}
