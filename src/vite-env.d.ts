/// <reference types="vite/client" />

declare module 'react-dom/client' {
  export * from 'react-dom';
  import { Root } from 'react-dom';
  export function createRoot(container: Element | DocumentFragment, options?: { identifierPrefix?: string }): Root;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
