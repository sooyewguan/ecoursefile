import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'

export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

export function SuccessAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="success" role="status">
      <CircleCheckIcon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
