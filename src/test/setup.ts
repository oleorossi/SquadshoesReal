import "@testing-library/jest-dom";

// Mock env vars que o cliente Supabase precisa para instanciar (testes não
// acessam o backend real). Sem isso, qualquer import indireto de
// @/integrations/supabase/client (ex.: useUserManagement → useIsAdmin) explode
// com "supabaseUrl is required" no CI ao rodar `bun run test`.
// Vite expõe via `import.meta.env`; vitest expõe ambos os caminhos.
process.env.VITE_SUPABASE_URL ??= "http://localhost:54321";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_ANON_KEY ??= "test-anon-key";
if (typeof import.meta !== "undefined" && import.meta.env) {
  import.meta.env.VITE_SUPABASE_URL ??= "http://localhost:54321";
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
  import.meta.env.VITE_SUPABASE_ANON_KEY ??= "test-anon-key";
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
