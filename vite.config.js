import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'
import { collectPosAssets } from './scripts/lib/pos-precache.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let posAssets = new Set()

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        {
            name: 'pos-precache-dependencies',
            apply: 'build',
            generateBundle(_, bundle) {
                posAssets = collectPosAssets(bundle)
            },
        },
        VitePWA({
            injectRegister: null,
            registerType: 'autoUpdate',
            filename: 'pos-sw.js',
            manifestFilename: 'pos-manifest.webmanifest',
            // POS is the only offline application. Keeping the worker scoped to
            // its entry URL prevents its precache from serving stale back-office
            // HTML/chunks after a deployment.
            scope: '/pos.html',
            manifest: {
                name: 'Pharmacy POS',
                short_name: 'POS',
                start_url: '/pos.html',
                scope: '/pos.html',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#0f766e',
                icons: [
                    { src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/pos-icon-512.png', sizes: '512x512', type: 'image/png' },
                ],
            },
            workbox: {
                // Cache only the POS shell and its shared runtime. Back-office
                // page chunks are intentionally absent from the offline cache.
                // Shared chunks change when back-office screens are split.
                // Cache the actual POS graph, including nested imports and CSS.
                globPatterns: ['pos.html', 'assets/**/*'],
                manifestTransforms: [async (entries) => ({
                    manifest: entries.filter(entry => entry.url === 'pos.html' || posAssets.has(entry.url)),
                    warnings: [],
                })],
                navigateFallback: 'pos.html',
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                skipWaiting: true,
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            },
        }),
    ],
    server: {
        watch: {
            ignored: ['**/.claude/**', '**/dist/**', '**/.next/**'],
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
                pos: path.resolve(__dirname, 'pos.html'),
            },
        },
    },
    test: {
        exclude: ['**/node_modules/**', '**/dist/**', 'artifacts/**', 'e2e/**', '**/.claude/**', '**/__tests__/integration/**'],
    },
    resolve: {
        extensions: ['.mjs', '.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
})
