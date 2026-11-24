import { createContext, useContext, useEffect, useState } from 'react'

// shadcn/ui's ThemeProvider for Vite (ui.shadcn.com/docs/dark-mode/vite). index.html applies the
// saved theme before the first paint with the same storage key.

type Theme = 'dark' | 'light' | 'system'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeProviderContext = createContext<ThemeProviderState>({ theme: 'system', setTheme: () => null })

// localStorage can throw, such as with site data blocked. The app then follows the system.
function readTheme(storageKey: string): Theme | null {
  try {
    return localStorage.getItem(storageKey) as Theme | null
  } catch {
    return null
  }
}

export function ThemeProvider({ children, defaultTheme = 'system', storageKey = 'vite-ui-theme', ...props }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => readTheme(storageKey) || defaultTheme)

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.classList.add(systemTheme)
      return
    }
    root.classList.add(theme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      try {
        localStorage.setItem(storageKey, theme)
      } catch {
        // The choice then lasts until the page reloads.
      }
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeProviderContext)
