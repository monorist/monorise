import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep plain store/service tests in Node. Hook-rendering suites opt into
    // happy-dom with a per-file environment annotation.
    environment: 'node',
  },
});
