import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * One choice: the value a form submits, the label people read, and an optional second line, such as
 * an email. A disabled option shows but cannot be picked, and its detail says why.
 */
export type ComboboxOption = { value: string; label: string; detail?: string; disabled?: boolean }

/**
 * A choice among more options than a select can hold, such as a department or a lecturer. Opening
 * it shows a search box, and search finds the options on the server as the user types. With a
 * name, the chosen value submits with its form, as a select's would, and a FieldError on that name
 * marks and focuses the button.
 */
export function Combobox({
  id,
  name,
  value,
  onChange,
  search,
  placeholder,
  searchPlaceholder = 'Search',
  disabled = false,
}: {
  id: string
  name?: string
  /** The chosen option, or null for none. */
  value: ComboboxOption | null
  onChange: (option: ComboboxOption) => void
  /** The first options that match the query. A blank query asks for the first options of all. */
  search: (query: string) => Promise<ComboboxOption[]>
  placeholder: string
  searchPlaceholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** The options found for a query, or that the search for it failed. */
  const [found, setFound] = useState<{ query: string; options?: ComboboxOption[]; failed?: true } | null>(null)
  /** The option that Enter picks. cmdk keeps a stale one when the options change under it, so each search resets it. */
  const [highlighted, setHighlighted] = useState('')
  const find = useEffectEvent(search)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    // Typing waits for a pause before it searches.
    const timer = setTimeout(
      () =>
        find(query).then(
          (options) => {
            if (!current) return
            setFound({ query, options })
            setHighlighted(options.find((option) => !option.disabled)?.value ?? '')
          },
          () => current && setFound({ query, failed: true }),
        ),
      query ? 200 : 0,
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [open, query])

  const searching = found?.query !== query
  // The last options stay while the next search runs, so the list does not flicker.
  const options = found?.options ?? null

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full min-w-0 justify-between px-3 font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value?.label ?? placeholder}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      {name && <input ref={input} type="hidden" name={name} value={value?.value ?? ''} data-control={id} />}
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command shouldFilter={false} value={highlighted} onValueChange={setHighlighted}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={searchPlaceholder} />
          <CommandList aria-busy={searching}>
            {!searching && found?.failed ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Couldn't search. Try again.</p>
            ) : options === null ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <>
                {!searching && <CommandEmpty>No matches</CommandEmpty>}
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      // A disabled option keeps its detail legible, since the detail says why it is disabled.
                      className="data-[disabled=true]:opacity-100"
                      onSelect={() => {
                        onChange(option)
                        setOpen(false)
                        setQuery('')
                        // A select fires input when the user picks, which clears the form's error on it.
                        input.current?.dispatchEvent(new Event('input', { bubbles: true }))
                      }}
                    >
                      <CheckIcon className={cn(option.value === value?.value ? 'opacity-100' : 'opacity-0')} />
                      <span className="grid min-w-0">
                        <span className={cn('truncate', option.disabled && 'text-muted-foreground')}>{option.label}</span>
                        {option.detail && <span className="text-muted-foreground truncate text-xs">{option.detail}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
