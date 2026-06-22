import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

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
    resolve: {
      alias: {
        // even-toolkit marks these as optional peer deps, causing Vite 8
        // (Rolldown) to stub them out. Override to use the real installed
        // packages — even-toolkit's bundled components import all four
        // directly (cva, clsx, tailwind-merge for class names; react-router
        // for navigation), so the stubs break the production build.
        '__vite-optional-peer-dep:react-router:even-toolkit': path.resolve('./node_modules/react-router'),
        '__vite-optional-peer-dep:class-variance-authority:even-toolkit': path.resolve('./node_modules/class-variance-authority'),
        '__vite-optional-peer-dep:clsx:even-toolkit': path.resolve('./node_modules/clsx'),
        '__vite-optional-peer-dep:tailwind-merge:even-toolkit': path.resolve('./node_modules/tailwind-merge'),
      },
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
