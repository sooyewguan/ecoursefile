import { useState } from 'react'
import { toast } from 'sonner'
import { FormDialog } from '@/components/action-dialogs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'

/**
 * A switch the user asked for: the section, its title, the state to switch it to, and the reason
 * it has now. A section with a reason differs from its course type, so the switch takes it back
 * and clears the reason. A section without one needs a reason to differ.
 */
export type SwitchRequest = { section: number; title: string; isOn: boolean; reason: string | undefined }

/**
 * Switches sections 10 to 16 of an offering on or off. request switches at once when the section
 * goes back to its course type's setting, and otherwise opens dialog, which asks why. switching is
 * the section being switched at once. onSwitched runs after each switch, so the page can reload.
 */
export function useSectionSwitch(offeringId: string, onSwitched: () => Promise<void>) {
  const [asking, setAsking] = useState<SwitchRequest | null>(null)
  const [switching, setSwitching] = useState<number | null>(null)

  async function run(target: SwitchRequest, reason?: string) {
    const { error } = await supabase.rpc('switch_section', { offering_id: offeringId, section: target.section, is_on: target.isOn, reason })
    await onSwitched()
    if (error) return friendlyError(error)
    toast.success(`Switched ${target.title} ${target.isOn ? 'on' : 'off'}`)
    return null
  }

  async function request(target: SwitchRequest) {
    if (!target.reason) return setAsking(target)
    setSwitching(target.section)
    const failure = await run(target)
    if (failure) toast.error(failure)
    setSwitching(null)
  }

  const dialog = asking && (
    <FormDialog
      title={`Switch ${asking.title} ${asking.isOn ? 'on' : 'off'}`}
      submitLabel={`Switch ${asking.isOn ? 'on' : 'off'}`}
      onClose={() => setAsking(null)}
      onSubmit={(form) => run(asking, String(form.get('reason')))}
    >
      <div className="grid gap-2">
        <Label htmlFor="switch-reason">Reason</Label>
        <Input id="switch-reason" name="reason" autoComplete="off" required />
      </div>
    </FormDialog>
  )

  return { request, switching, dialog }
}
