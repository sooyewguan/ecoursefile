import { FieldError, type ActionError } from '@/components/form-errors'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_PASSWORD_LENGTH } from '../auth.ts'
import { friendlyError } from '../errors.ts'

/** The rule under every new password field. */
export function PasswordHint({ id }: { id: string }) {
  return (
    <p id={id} className="text-muted-foreground text-sm">
      At least {MIN_PASSWORD_LENGTH} characters
    </p>
  )
}

/** A new password, named password, and its confirmation, named confirm, each with its error under it. */
export function NewPasswordFields() {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="password-hint"
          required
        />
        <PasswordHint id="password-hint" />
        <FieldError name="password" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        <FieldError name="confirm" />
      </div>
    </>
  )
}

/** The confirmation's error when it differs from the new password, or null when they match. */
export function confirmationError(form: FormData): ActionError | null {
  return String(form.get('password')) === String(form.get('confirm')) ? null : { field: 'confirm', message: "Passwords don't match." }
}

/** Why Supabase Auth refused a new password, under the password field when the password itself is the reason. */
export function newPasswordError(error: { code?: string }): ActionError {
  const message = friendlyError(error)
  return error.code === 'weak_password' || error.code === 'same_password' ? { field: 'password', message } : message
}
