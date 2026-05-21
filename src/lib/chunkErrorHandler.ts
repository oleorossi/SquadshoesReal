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
 * # Compatibilidade com vite:preloadError
 *
 * Os 3 listeners convivem — todos checam o mesmo flag de sessionStorage,
 * então quem chegar primeiro reloada e os outros viram noop. Não duplica.
 */

const RELOAD_FLAG = 'chunk-error-reload';
const FLAG_TTL_MS = 8000;

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
  if (sessionStorage.getItem(RELOAD_FLAG)) {
    // Já tentamos uma vez recentemente — não loopear.
    console.warn(`[chunk-error] Already reloaded for ${reason}, giving up.`);
    return;
  }
  sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  console.warn(`[chunk-error] Reloading due to: ${reason}`);
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

  // Limpa o flag depois de um carregamento bem-sucedido para liberar
  // recuperações futuras (deploys seguintes).
  setTimeout(() => sessionStorage.removeItem(RELOAD_FLAG), FLAG_TTL_MS);
}
