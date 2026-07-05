import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
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
