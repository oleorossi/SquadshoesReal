export function escapeHtml(value: unknown): string {
  const str = value == null ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sandbox padrão dos iframes de impressão (auditoria 2026-07-28 · T6).
 *
 * Todo print do sistema monta HTML por concatenação com dado vindo do banco e
 * injeta em `srcdoc`/`document.write`. Sem sandbox, um `<script>`, um `onerror`
 * ou um `javascript:` gravado num nome de produto/observação vira XSS
 * persistente que roda com a origem do app.
 *
 * SEM `allow-scripts` — é o que neutraliza o payload. `allow-same-origin` é
 * necessário pro pai ler `contentDocument` (medir páginas, esperar imagens) e
 * chamar `print()`; `allow-modals` libera o diálogo de impressão.
 *
 * ⚠ NUNCA adicionar `allow-scripts` junto de `allow-same-origin`: a combinação
 * permite que o conteúdo remova o próprio atributo sandbox — o mesmo que não
 * ter sandbox nenhum.
 */
export const PRINT_IFRAME_SANDBOX = 'allow-same-origin allow-modals';

/** Aplica o sandbox de impressão. Chamar ANTES de setar `srcdoc`/escrever. */
export function applyPrintSandbox(iframe: HTMLIFrameElement): void {
  iframe.setAttribute('sandbox', PRINT_IFRAME_SANDBOX);
}

/**
 * URL segura pra atributo `src`/`href` de HTML impresso: só deixa passar
 * http(s), data:image e blob. Protocolo estranho (`javascript:`, `vbscript:`)
 * vira string vazia em vez de virar execução.
 */
export function safeUrlAttr(url: unknown): string {
  const raw = url == null ? '' : String(url).trim();
  if (!raw) return '';
  if (/^(https?:|blob:)/i.test(raw)) return escapeHtml(raw);
  if (/^data:image\//i.test(raw)) return escapeHtml(raw);
  // Caminho relativo (sem esquema) é seguro; qualquer esquema fora da lista não.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  return escapeHtml(raw);
}
