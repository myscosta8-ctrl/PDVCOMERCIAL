import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => ({
  base: '/PDVCOMERCIAL/',
  plugins: [react()],
  // Modo de demonstração: dados fictícios, sem banco (apenas para conferir telas)
  resolve: mode === 'demo'
    ? { alias: [{ find: /^\.\/cliente\.js$/, replacement: fileURLToPath(new URL('./src/lib/demo.js', import.meta.url)) }] }
    : {},
}))
