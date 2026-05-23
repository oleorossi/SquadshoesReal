import { defineConfig } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
