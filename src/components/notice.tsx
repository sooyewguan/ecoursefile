import { CircleAlertIcon } from 'lucide-react'
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
