import { useSyncExternalStore } from 'react'

/** The user's choice. System follows the operating system's light or dark setting. */
export type Theme = 'light' | 'dark' | 'system'

/** The key in localStorage. index.html reads the same key before the first paint, so the page never flashes the wrong theme. */
export const THEME_KEY = 'theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()

// localStorage can throw, such as in a private window with storage blocked. The app then follows the system.
function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

let theme: Theme = typeof window === 'undefined' ? 'system' : readTheme()

/** Whether the page shows dark, given the choice and the system setting. */
function isDark(choice: Theme) {
  return choice === 'dark' || (choice === 'system' && window.matchMedia(DARK_QUERY).matches)
}

/** Puts the .dark class on <html> to match the choice. index.css keys the dark colors off that class. */
function apply() {
  document.documentElement.classList.toggle('dark', isDark(theme))
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  // A change to the system setting matters only while the choice is System.
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (theme === 'system') apply()
  })
  // Another tab changed the choice.
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) {
      theme = readTheme()
      apply()
    }
  })
}

export function setTheme(next: Theme) {
  theme = next
  try {
    if (next === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, next)
  } catch {
    // The choice then lasts until the page reloads.
  }
  apply()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The user's choice and the theme the page shows now. */
export function useTheme() {
  const choice = useSyncExternalStore(subscribe, () => theme)
  const resolved = useSyncExternalStore(subscribe, () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
  return { theme: choice, resolved, setTheme } as const
}
