import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The actions under test are plain store logic (zustand + immer); the
    // hooks aren't rendered, so no DOM is needed.
    environment: 'node',
  },
});
