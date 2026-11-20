import { CircleCheckIcon, CircleXIcon, PlayIcon } from 'lucide-react'
import { useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { ErrorAlert, SuccessAlert } from '@/components/notice'
import { PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '../supabase.ts'
import { sendChunks } from '../uploads.ts'

type Step = { name: string; ok: boolean; note: string }

/** What the person must do to sign in to Microsoft, with user sign-in. */
type SignInPrompt = { userCode: string; verificationUri: string }

/** Larger than one 5 MiB chunk, so the upload takes two chunks, and the last one is not a multiple of 320 KiB. */
const TEST_FILE_BYTES = 6 * 1024 * 1024 + 1234

/**
 * Runs the onedrive-check function against the OneDrive in its secrets. The function makes the
 * Graph calls, and this page sends the file from the browser, as a real upload does.
 */
export function OneDriveCheck() {
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [prompt, setPrompt] = useState<SignInPrompt | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = (more: Step[]) => setSteps((current) => [...current, ...more])

  async function run() {
    setSteps([])
    setError(null)
    setRunning(true)
    try {
      const begin = await call<{ signIn: 'app' } | ({ signIn: 'user'; deviceCode: string; interval: number } & SignInPrompt)>({
        action: 'begin',
      })
      let graphToken: string | undefined
      if (begin.signIn === 'user') {
        setPrompt(begin)
        graphToken = await waitForSignIn(begin.deviceCode, begin.interval)
        setPrompt(null)
        add([{ name: 'Sign in to Microsoft', ok: true, note: 'signed in' }])
      }

      const start = await call<{ steps: Step[]; runId: string; uploadUrl?: string }>({ action: 'start', graphToken })
      add(start.steps)
      if (!start.uploadUrl) return

      const bytes = testPdf(TEST_FILE_BYTES)
      try {
        await sendChunks(start.uploadUrl, new Blob([bytes], { type: 'application/pdf' }))
        add([{ name: 'Send the file from this browser in 5 MiB chunks', ok: true, note: `${bytes.length} bytes from ${location.origin}` }])
      } catch (sendError) {
        // A CORS refusal reaches the page only as a failed fetch.
        add([{ name: 'Send the file from this browser in 5 MiB chunks', ok: false, note: String(sendError) }])
        const cleanUp = await call<{ steps: Step[] }>({ action: 'clean-up', graphToken, runId: start.runId })
        add(cleanUp.steps)
        return
      }

      const finish = await call<{ steps: Step[] }>({ action: 'finish', graphToken, runId: start.runId, size: bytes.length })
      add(finish.steps)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setPrompt(null)
      setRunning(false)
    }
  }

  const failed = steps.some((step) => !step.ok)
  const done = !running && steps.length > 0

  return (
    <div className="grid gap-6">
      <PageHeader
        title="OneDrive check"
        description="Uploads a test file to the OneDrive in the onedrive-check secrets, checks it, and deletes it."
        action={
          <Button onClick={run} disabled={running}>
            {running ? <Spinner /> : <PlayIcon />}
            Run check
          </Button>
        }
      />
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {done && !error && (failed ? <ErrorAlert>The OneDrive failed the check.</ErrorAlert> : <SuccessAlert>The OneDrive passed every step.</SuccessAlert>)}

      {prompt && (
        <Card className="gap-2 px-6">
          <p className="text-sm">
            Open{' '}
            <a href={prompt.verificationUri} target="_blank" rel="noreferrer" className="underline">
              {prompt.verificationUri}
            </a>{' '}
            and enter this code, then sign in with the Microsoft account whose OneDrive you want to check.
          </p>
          <p className="font-mono text-2xl font-semibold tracking-widest">{prompt.userCode}</p>
        </Card>
      )}

      {steps.length > 0 && (
        <Card className="px-6">
          <ol className="grid gap-3">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                {step.ok ? (
                  <CircleCheckIcon className="text-success mt-0.5 size-4 shrink-0" aria-label="Passed" />
                ) : (
                  <CircleXIcon className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Failed" />
                )}
                <div className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium">{step.name}</span>
                  <span className="text-muted-foreground text-sm break-words">{step.note}</span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}

/** Asks the function every interval seconds whether the person has signed in, and returns the Graph token. */
async function waitForSignIn(deviceCode: string, interval: number) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000))
    const answer = await call<{ graphToken?: string; pending?: boolean }>({ action: 'token', deviceCode })
    if (answer.graphToken) return answer.graphToken
  }
}

/** Random bytes that start with the PDF signature, which is all that the checks read. */
function testPdf(size: number) {
  const bytes = new Uint8Array(size)
  for (let start = 0; start < size; start += 65_536) crypto.getRandomValues(bytes.subarray(start, start + 65_536))
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
  return bytes
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('onedrive-check', { body })
  if (!error) return data
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? `The onedrive-check function answered ${response.status}.`)
  }
  throw error
}
