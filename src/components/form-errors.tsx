import { createContext, useContext, useEffect, type ReactNode, type RefObject } from 'react'
import { ErrorAlert } from '@/components/notice'

/** Why a form's action failed: a message for the whole form, or for one of its fields, by the field's name. */
export type ActionError = string | { field: string; message: string }

const FormErrorContext = createContext<ActionError | null>(null)

const messageId = (field: string) => `${field}-error`

/**
 * Shows a form's last error. A field's error shows where FieldError is placed for that field, and
 * the field is marked invalid and focused. Any other error shows after the children.
 */
export function FormErrors({ form, error, children }: { form: RefObject<HTMLFormElement | null>; error: ActionError | null; children: ReactNode }) {
  useEffect(() => {
    if (!error || typeof error === 'string') return
    const field = form.current?.elements.namedItem(error.field)
    if (!(field instanceof HTMLElement)) return
    const describedBy = field.getAttribute('aria-describedby')
    field.setAttribute('aria-invalid', 'true')
    field.setAttribute('aria-describedby', [describedBy, messageId(error.field)].filter(Boolean).join(' '))
    field.focus()
    return () => {
      field.removeAttribute('aria-invalid')
      if (describedBy) field.setAttribute('aria-describedby', describedBy)
      else field.removeAttribute('aria-describedby')
    }
  }, [form, error])

  return (
    <FormErrorContext value={error}>
      {children}
      {typeof error === 'string' && <ErrorAlert>{error}</ErrorAlert>}
    </FormErrorContext>
  )
}

/** The message under a field, while the form's last error belongs to the field with this name. */
export function FieldError({ name }: { name: string }) {
  const error = useContext(FormErrorContext)
  if (!error || typeof error === 'string' || error.field !== name) return null
  return (
    <p id={messageId(name)} className="text-destructive text-sm">
      {error.message}
    </p>
  )
}

/** Whether an input event came from the field that the error belongs to, so the error can clear. */
export function editsErrorField(error: ActionError | null, target: EventTarget) {
  return typeof error === 'object' && error !== null && 'name' in target && target.name === error.field
}
