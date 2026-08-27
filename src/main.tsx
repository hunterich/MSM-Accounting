import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import { queryClient } from './lib/queryClient'
import { bootstrapActiveOrg } from './lib/activeOrg'
import './index.css' // We will migrate styles here momentarily

// Consume the ?org= open-in-new-tab handshake before the router mounts.
bootstrapActiveOrg()

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
