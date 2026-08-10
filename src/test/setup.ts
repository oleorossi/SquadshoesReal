import "@testing-library/jest-dom";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup do DOM entre testes. Sem isso, render() acumula múltiplas
// instâncias renderizadas no document.body — getByText falha com "found
// multiple elements" no segundo teste em diante (ex.: SecurityIntegration
// test 2 onde dois "Acesso Restrito" coexistiam do teste anterior).
afterEach(() => cleanup());


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

// jsdom não implementa ResizeObserver, e os primitives do radix que medem o
// próprio nó (checkbox, popover, select) chamam direto no efeito de layout —
// sem isto, qualquer teste que renderize um formulário do app quebra com
// "ResizeObserver is not defined" antes de chegar na primeira asserção.
// Mesmo espírito do matchMedia abaixo: preencher lacuna do ambiente, não simular
// comportamento (nada no app depende das medidas em teste).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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
