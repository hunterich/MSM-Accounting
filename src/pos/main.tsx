/// <reference types="vite-plugin-pwa/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import PosApp from './PosApp';
import { useAuthStore } from '../stores/useAuthStore';
import { bootstrapActiveOrg } from '../lib/activeOrg';
import '../index.css';

// Consume the ?org= open-in-new-tab handshake and pin this tab's active company
// BEFORE React renders — the offline database name is derived from it, so it
// must be resolved before any component touches the DB. (activeOrg also
// self-bootstraps at module-eval; this explicit first call mirrors main.tsx and
// is an idempotent no-op.)
bootstrapActiveOrg();

registerSW({ immediate: true });

const on401 = (e: unknown) => {
  if ((e as { status?: number })?.status === 401) {
    void useAuthStore.getState().logout();
  }
};

const posQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: on401 }),
  mutationCache: new MutationCache({ onError: on401 }),
});

ReactDOM.createRoot(document.getElementById('pos-root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={posQueryClient}>
      <PosApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
