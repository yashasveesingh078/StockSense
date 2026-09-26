import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Sends every /api request to the backend, so there are no CORS problems
    proxy: { '/api': 'http://localhost:4000' },
  },
});