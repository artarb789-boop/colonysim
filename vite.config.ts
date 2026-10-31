import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// На GitHub Pages игра лежит в /colonysim/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/colonysim/' : '/',
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Колония',
        short_name: 'Колония',
        description: 'Симулятор колонии',
        lang: 'ru',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#14171A',
        theme_color: '#14171A',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
