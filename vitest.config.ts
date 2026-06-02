import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // zod 3.25 reexporta o namespace `z` (export { z } onde z = import * as z).
    // O transform SSR do Vite não materializa esse re-export → `import { z }`
    // vira undefined nos testes (z.object explode no load). Inlinar zod faz o
    // Vite processar os arquivos do zod no mesmo pipeline e resolve o namespace.
    server: {
      deps: {
        inline: ["zod"],
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
