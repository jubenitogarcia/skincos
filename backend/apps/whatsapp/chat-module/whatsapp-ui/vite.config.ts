import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    server: {
        port: 5175,
        proxy: {
            '/api': {
                target: process.env.WHATSAPP_API_URL || 'http://localhost:3001',
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/api/, '')
            }
        }
    },
    plugins: [react()]
});
