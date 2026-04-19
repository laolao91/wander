import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure-function tests for serverless helpers — no DOM needed.
    environment: 'node',
    include: ['api/__tests__/**/*.test.ts'],
  },
})
