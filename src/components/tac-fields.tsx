import { useEffect, useId, useRef, useState } from 'react'
import { ErrorAlert } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { sendTac, TacError, toE164, type TacChallenge } from '../phone.ts'

/** How long the user waits before they may ask for another TAC, as Firebase limits sends too. */
const RESEND_SECONDS = 60

/**
 * The phone number, a Send TAC button and the TAC field, inside a form. With fixedPhone the TAC
 * goes to that phone, and the user cannot change it. Otherwise the user types the phone. The form
 * reads the TAC from the field named tac, and calls the challenge's confirm with it.
 */
export function TacFields({
  fixedPhone,
  phoneLabel = 'Phone number',
  challenge,
  onChallenge,
}: {
  fixedPhone?: string | null
  phoneLabel?: string
  challenge: TacChallenge | null
  onChallenge: (challenge: TacChallenge | null) => void
}) {
  const [typed, setTyped] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const recaptcha = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  async function send() {
    const phone = fixedPhone ?? toE164(typed)
    if (!phone) {
      setError('Enter a phone number, such as 012-345 6789, or with its country code, such as +60123456789.')
      return
    }
    setSending(true)
    setError(null)
    try {
      onChallenge(await sendTac(phone, recaptcha.current!))
      setWait(RESEND_SECONDS)
    } catch (failure) {
      if (!(failure instanceof TacError)) console.error(failure)
      setError(failure instanceof TacError ? failure.message : 'The TAC could not be sent. Try again later.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-phone`}>{phoneLabel}</Label>
        <div className="flex gap-2">
          {fixedPhone ? (
            <Input id={`${id}-phone`} value={fixedPhone} readOnly className="bg-muted" />
          ) : (
            <Input
              id={`${id}-phone`}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="012-345 6789"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                // A TAC sent to the number before the change does not prove this one.
                if (challenge) onChallenge(null)
              }}
              required
            />
          )}
          <Button type="button" variant="outline" className="shrink-0" disabled={sending || wait > 0} onClick={() => void send()}>
            {sending && <Spinner />}
            {wait > 0 ? `Send again in ${wait}s` : challenge ? 'Send again' : 'Send TAC'}
          </Button>
        </div>
      </div>
      {challenge && (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-tac`}>TAC</Label>
          <Input id={`${id}-tac`} name="tac" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
          <p className="text-muted-foreground text-sm">We texted a 6-digit TAC to {challenge.phone}.</p>
        </div>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <div ref={recaptcha} className="empty:hidden" />
    </div>
  )
}
