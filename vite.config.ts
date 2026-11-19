import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // supabase/config.toml points auth redirects at this port.
  server: { port: 5173, strictPort: true },
})
