import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs locally under Azure Functions Core Tools (`npm run dev:api`).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:7071',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change less often than the app, so they get their own cacheable files.
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
          table: ['@tanstack/react-table'],
        },
      },
    },
  },
});
