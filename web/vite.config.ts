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
    proxy: { '/api': 'http://localhost:5080' },
  },
})
