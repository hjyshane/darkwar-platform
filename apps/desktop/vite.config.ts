import { defineConfig } from 'vite';

// Fixed port, matched by tauri.conf.json's devUrl: Tauri will not go looking
// for a dev server on a port it was not told about.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
