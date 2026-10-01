import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import { queryClient } from './lib/queryClient'
import { bootstrapActiveOrg } from './lib/activeOrg'
import { unregisterLegacyRootPosWorker } from './lib/pwaScope'
import './index.css' // We will migrate styles here momentarily

// Consume the ?org= open-in-new-tab handshake before the router mounts.
bootstrapActiveOrg()

// A tab left open across a deployment can still reference an old hashed lazy
// chunk. Vite emits this event before the import rejects; refresh once to load
// the new HTML/module graph, then let the page boundary show a stable error if
// the refreshed deployment is genuinely incomplete.
const CHUNK_RELOAD_KEY = 'msm:last-chunk-reload'
window.addEventListener('vite:preloadError', (event) => {
    const lastReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
    if (Date.now() - lastReload < 60_000) return
    event.preventDefault()
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
    window.location.reload()
})

// Remove the legacy root-scoped POS worker. If it controls this tab, one reload
// is required before the back-office app is fully outside its cache.
void unregisterLegacyRootPosWorker()
    .then(({ removed, wasControllingPage }) => {
        if (removed && wasControllingPage) window.location.reload()
    })
    .catch((error) => console.warn('[PWA] Failed to remove legacy POS worker', error))

const googleClientId = import.meta.env?.VITE_GOOGLE_CLIENT_ID

const appTree = (
    <QueryClientProvider client={queryClient}>
        <App />
        <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        {googleClientId ? (
            <GoogleOAuthProvider clientId={googleClientId}>
                {appTree}
            </GoogleOAuthProvider>
        ) : (
            appTree
        )}
    </React.StrictMode>,
)
