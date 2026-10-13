import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Built into the ASP.NET Core wwwroot so IIS serves API + UI from one site.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../src/OtPortal.Api/wwwroot',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true, // F5 opens this exact URL
    proxy: { '/api': 'http://localhost:5080' },
  },
})
