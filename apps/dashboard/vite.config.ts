import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Explicit imports are still used; globals only exist so
    // @testing-library/react can register its afterEach cleanup.
    globals: true,
  },
});
