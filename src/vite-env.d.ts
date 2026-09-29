/// <reference types="vite/client" />

declare module 'react-dom' {
  export interface Root {
    render(children: import('react').ReactNode): void;
    unmount(): void;
  }
  export function createPortal(
    children: import('react').ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): import('react').ReactPortal;
}

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
