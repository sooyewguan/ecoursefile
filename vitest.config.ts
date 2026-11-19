import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        test: {
          name: 'seam1',
          include: ['tests/**/*.test.ts'],
          globalSetup: ['tests/global-setup.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
})
