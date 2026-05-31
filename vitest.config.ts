import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure-function tests across both serverless helpers and the
    // glasses-side reducer. None need a DOM.
    environment: 'node',
    include: [
      'api/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.ts',
    ],
  },
})
