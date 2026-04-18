import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './phone/App'
import { initGlasses } from './glasses/bridge'

const rootEl = document.getElementById('app')
if (!rootEl) throw new Error('Root #app element not found')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Flutter WebView injects this. Only then bring the glasses bridge online.
const isEvenAppWebView =
  typeof window !== 'undefined' &&
  Object.prototype.hasOwnProperty.call(window, 'flutter_inappwebview')

if (isEvenAppWebView) {
  initGlasses().catch((err) => {
    console.error('[wander] glasses bridge init failed:', err)
  })
}
