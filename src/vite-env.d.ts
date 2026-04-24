/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_LAT?: string
  readonly VITE_MOCK_LNG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
