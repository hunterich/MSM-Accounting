import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            injectRegister: null,
            registerType: 'autoUpdate',
            filename: 'pos-sw.js',
            manifestFilename: 'pos-manifest.webmanifest',
            manifest: {
                name: 'Pharmacy POS',
                short_name: 'POS',
                start_url: '/pos.html',
                scope: '/',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#0f766e',
                icons: [
                    { src: '/pos-icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/pos-icon-512.png', sizes: '512x512', type: 'image/png' },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                globIgnores: ['**/main-*.js'],
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
        exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/.claude/**', '**/__tests__/integration/**'],
    },
    resolve: {
        extensions: ['.mjs', '.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
})
