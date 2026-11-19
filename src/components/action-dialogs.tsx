import { useState, type FormEvent, type ReactNode } from 'react'
import { ErrorAlert } from '@/components/notice'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

/** Runs an action and resolves to its error message, or null when it succeeded. */
export type Action<T extends unknown[] = []> = (...args: T) => Promise<string | null>

/**
 * A dialog around a form. Submitting runs the action; the dialog shows the action's error, or
 * closes when the action succeeds. The dialog is open while it is mounted.
 */
export function FormDialog({
  title,
  description,
  submitLabel,
  submitDisabled = false,
  onSubmit,
  onClose,
  children,
}: {
  title: string
  description: ReactNode
  submitLabel: string
  submitDisabled?: boolean
  onSubmit: Action<[FormData]>
  onClose: () => void
  children: ReactNode
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    const error = await onSubmit(new FormData(event.currentTarget))
    setBusy(false)
    if (error) setError(error)
    else onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
        <form onSubmit={submit} aria-label={title} className="grid gap-6">
          <DialogHeader>
            <DialogTitle className="leading-snug">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">{children}</div>
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || submitDisabled}>
              {busy && <Spinner />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A confirmation for one action, with children shown below the description. It shows the action's
 * error, or closes when the action succeeds.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  onConfirm: Action
  onClose: () => void
  children?: ReactNode
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const error = await onConfirm()
    setBusy(false)
    if (error) setError(error)
    else onClose()
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            disabled={busy}
            onClick={(event) => {
              // The action decides when the dialog closes.
              event.preventDefault()
              void confirm()
            }}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
