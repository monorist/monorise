import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Use Vitest's global APIs (describe, test, expect, etc.)
    environment: 'node', // Specify the test environment
    // You might want to add setup files later, e.g., for mocking
    // setupFiles: ['./src/test/setup.ts'],
  },
});
