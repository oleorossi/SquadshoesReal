/**
 * Chunk error handler — recuperação automática de imports dinâmicos falhos.
 *
 * # Contexto
 *
 * O app usa `lazy(() => import('./pages/X'))` em App.tsx pra code-splitting.
 * Quando o Vite (dev) ou Vercel (prod) servem um novo bundle, os arquivos
 * hasheados antigos somem. Uma aba aberta no bundle anterior tenta importar
 * um chunk que não existe mais — o browser dispara "Importing a module
 * script failed" / "Failed to fetch dynamically imported module".
 *
 * # Por que o `vite:preloadError` em main.tsx não basta
 *
 * `vite:preloadError` só dispara quando o Vite consegue interceptar a falha
 * via `__vitePreload`. Casos não cobertos:
 *   1. Dev mode com HMR quebrado (módulo some sem aviso de preload).
 *   2. Promise rejection direto do `import()` nativo sem passar pelo Vite.
 *   3. Erros que chegam via window.onerror em vez de preload error.
 *
 * # Estratégia
 *
 * Adiciona dois listeners globais:
 *   - `error`: captura runtime errors com message indicando módulo dinâmico.
 *   - `unhandledrejection`: captura Promise rejections de `import()` falho.
 *
 * Em qualquer match, recarrega a página 1x. Flag em sessionStorage evita
 * loop infinito (se persistir, deixa o erro aparecer pro usuário).
 *
 * # Compatibilidade com vite:preloadError e VersionChecker
 *
 * Os 3 listeners e o vite:preloadError de main.tsx compartilham o MESMO
 * orçamento global de recuperação (src/lib/recoveryReload.ts), então quem
 * chegar primeiro reserva o reload e os outros viram noop. O orçamento também
 * é respeitado pelo VersionChecker, evitando reloads encadeados entre os três
 * mecanismos no cenário degradado (CDN servindo HTML velho).
 */

import { tryReserveReload } from './recoveryReload';

function isDynamicImportError(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('importing a module script failed') ||
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('failed to load module script')
  );
}

function tryReload(reason: string): void {
  if (!tryReserveReload()) {
    // Sem orçamento global (já recarregamos demais / em cooldown) — não loopear.
    console.warn(`[chunk-error] Sem orçamento de recuperação para ${reason}, desistindo.`);
    return;
  }
  console.warn(`[chunk-error] Recarregando por: ${reason}`);
  window.location.reload();
}

export function installChunkErrorHandler(): void {
  // Erros síncronos (script tag falhou a carregar, etc.)
  window.addEventListener('error', (event) => {
    const msg = event.message || String(event.error?.message || '');
    if (isDynamicImportError(msg)) {
      event.preventDefault();
      tryReload(`error event: ${msg.slice(0, 80)}`);
    }
  });

  // Promise rejections (caso mais comum — import() é assíncrono)
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = String(reason?.message || reason || '');
    if (isDynamicImportError(msg)) {
      event.preventDefault();
      tryReload(`promise rejection: ${msg.slice(0, 80)}`);
    }
  });

  // O reset do orçamento é por timestamp (EPISODE_RESET_MS em recoveryReload.ts):
  // recuperações futuras (deploys seguintes) reabrem o orçamento sozinhas, sem
  // precisar limpar flag aqui.
}
