import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { sdkMulticoreWorkerHelpers } from '@namada/vite-esbuild-plugin'
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill'
import inject from '@rollup/plugin-inject'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  define: {
    // Ensure global is defined in production preview builds
    global: 'globalThis',
  },
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  server: {
    headers: {
      // Enable cross-origin isolation for SharedArrayBuffer
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      plugins: [
        sdkMulticoreWorkerHelpers(),
        NodeGlobalsPolyfillPlugin({
          buffer: true,
        }),
      ],
    },
  },
  worker: {
    // Ensure workers use ESM format to support code-splitting in production builds
    format: 'es',
  },
  build: {
    rollupOptions: {
      plugins: [
        // Provide Buffer global at runtime in preview/production
        inject({
          Buffer: ['buffer', 'Buffer'],
        }),
      ],
    },
  },
})
