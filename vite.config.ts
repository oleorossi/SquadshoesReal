import { defineConfig } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// Single stable version for the entire server session.
// Reused for both version.json and VITE_APP_VERSION — no drift possible.
const BUILD_VERSION = process.env.VITE_APP_VERSION || `0.0.0-${Date.now()}`;
const VERSION_JSON = JSON.stringify({ version: BUILD_VERSION });

const versionJsonPlugin = (): Plugin => ({
  name: "squad-version-json",
  configureServer(server: ViteDevServer) {
    server.middlewares.use("/version.json", (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.end(VERSION_JSON);
    });
  },
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: VERSION_JSON,
    });
  },
});
 
  export default defineConfig(({ mode }) => {
    return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    versionJsonPlugin(),
    // PWA — habilita instalação no iPhone/iPad ("Add to Home Screen"),
    // service worker pra cache offline e mutation queue do fluxo mobile
    // de vendas (/m). Desktop e demais rotas continuam normais — só /m
    // é otimizado pra UX standalone-app.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // ⚠ SERVICE WORKER DESLIGADO (selfDestroying).
      //
      // O SW de precache (Workbox) prendia usuários em bundles obsoletos: ele
      // servia o index.html precacheado (cache-first em NavigationRoute), que
      // apontava pros chunks hasheados do build antigo. Após um deploy novo na
      // Vercel, esses chunks `immutable` somem (404) — e o import() dinâmico de
      // uma rota lazy ainda-não-visitada quebrava com "Importing a module
      // script failed". O reload de recuperação (chunkErrorHandler.ts) não
      // resolvia, pois o próprio SW re-servia o index.html velho.
      //
      // `selfDestroying: true` gera um SW mínimo que, no activate, se
      // DESREGISTRA, limpa TODOS os caches e recarrega as abas abertas. Com o
      // `registerType: 'autoUpdate'` acima, usuários que ainda têm o SW de
      // precache antigo recebem este destruidor automaticamente na próxima
      // visita e são libertados — sem depender do unregister em main.tsx.
      //
      // Mantém o manifest (metadados/ícones do app) sem nenhum SW de cache.
      // Pra REATIVAR a PWA offline de /m no futuro: scope restrito a '/m' +
      // remover esta flag (ver histórico do CLAUDE.md sobre o cache-trap).
      selfDestroying: true,
      // Coexistência com public/sw.js legado: usa filename próprio pra não
      // sobrescrever. O sw.js legado se auto-destrói em users antigos;
      // novos users instalam squad-vendas-sw.js direto.
      filename: 'squad-vendas-sw.js',
      strategies: 'generateSW',
      // start_url e scope abrem o app direto em /m quando instalado
      manifest: {
        name: 'Squad Vendas',
        short_name: 'Squad Vendas',
        description: 'Pedidos de venda Squad Shoes — funciona offline em campo',
        start_url: '/m',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#D9264E', // squad red
        background_color: '#FAFAF7', // paper cream
        lang: 'pt-BR',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // App é grande (1MB+ gzip) — só precache o shell mínimo
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Cache strategies por tipo de recurso
        runtimeCaching: [
          {
            // Supabase REST: stale-while-revalidate (mostra cached, busca novo em bg)
            urlPattern: /^https:\/\/ssvxfoybzmjlypnipqzn\.supabase\.co\/rest\/v1\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 }, // 1h
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Imagens de produtos: cache longo
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 }, // 30d
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Fonts: cache muito longo (raramente mudam)
            urlPattern: /\.(?:woff|woff2|ttf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
        // Navigation fallback pra SPA — qualquer URL não-cacheada serve index.html
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/rest/],
      },
      devOptions: {
        // Habilita SW em dev pra testar (precisa ser HTTPS ou localhost)
        enabled: false, // ativar só quando testando PWA local
        type: 'module',
      },
    }),
  ].filter(Boolean),
   define: {
     'import.meta.env.VITE_APP_VERSION': JSON.stringify(BUILD_VERSION),
   },
   resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'ui-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],
          'supabase-vendor': ['@supabase/supabase-js'],
          // Recharts (~60KB gzip) usado em 14 pages — chunk próprio evita
          // duplicação entre os bundles de cada page lazy.
          'recharts-vendor': ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
   },
 };
 });
