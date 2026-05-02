import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In production the app and its /api/* serverless functions are served
// from the same Vercel origin, so relative `fetch('/api/poi')` just
// works. In dev (`npm run dev` + the EvenHub simulator) there are no
// local functions, so we proxy /api/* to the deployed Vercel URL.
// Override with VITE_DEV_API_PROXY if testing against a preview branch.
const DEFAULT_DEV_API_PROXY = 'https://wander-six-phi.vercel.app'

export default defineConfig(({ mode }) => {
  const apiProxyTarget =
    process.env.VITE_DEV_API_PROXY ?? DEFAULT_DEV_API_PROXY
  const isDev = mode !== 'production'
  return {
    plugins: [react(), tailwindcss()],
    // Inject package.json version at build time so the phone UI can show it
    // without importing package.json at runtime.
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? ''),
    },
    server: {
      host: true,
      port: 5173,
      proxy: isDev
        ? {
            '/api': {
              target: apiProxyTarget,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  }
})
