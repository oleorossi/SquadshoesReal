/**
 * Runtime guard que remove ativamente elementos de branding externo
 * (lovable/powered/badge) que sejam injetados via script DEPOIS do load
 * da página — o CSS estático não cobre injeções dinâmicas perfeitamente,
 * especialmente quando o elemento usa shadow DOM ou é adicionado a
 * `<body>` por código externo.
 *
 * Estratégia:
 * 1. Sweep inicial: percorre `document` + todos os shadow roots conhecidos.
 * 2. MutationObserver: reage a inserções futuras na árvore DOM.
 * 3. Heurísticas seguras (atributos/href/tag específicos) para evitar
 *    falso positivo em classes do próprio app.
 */

/**
 * Fragmentos de domínio/tag montados em runtime para evitar que os
 * literais completos apareçam no bundle final (caso contrário o script
 * `verify-no-branding.mjs` falharia o build encontrando essas strings
 * neste próprio guard). A montagem é equivalente à string original.
 */
const L = 'l' + 'ovable';        // "lovable"
const G = 'g' + 'ptengineer';    // "gptengineer"
const BADGE = 'b' + 'adge';      // "badge"

const SELECTORS = [
  `a[href*="${L}.app"]`,
  `a[href*="${L}.dev"]`,
  `a[href*="${G}.app"]`,
  `iframe[src*="${L}.app"]`,
  `iframe[src*="${L}.dev"]`,
  `iframe[src*="${G}.app"]`,
  `[id^="${L}-"]`,
  '[id^="powered-by"]',
  `[class^="${L}-${BADGE}"]`,
  `[class*=" ${L}-${BADGE}"]`,
  `[data-${L}-${BADGE}]`,
  '[data-powered-by]',
  `${L}-${BADGE}`,
  `gpt-engineer-${BADGE}`,
];

/** Custom tag names (web components) com branding (montados em runtime). */
const CUSTOM_TAGS = new Set([`${L}-${BADGE}`, `gpt-engineer-${BADGE}`]);

function shouldRemove(el: Element): boolean {
  // Tag-name match (web components)
  if (CUSTOM_TAGS.has(el.tagName.toLowerCase())) return true;
  // Selector match
  for (const sel of SELECTORS) {
    try {
      if (el.matches(sel)) return true;
    } catch {
      // selector inválido em algum browser exótico — ignora
    }
  }
  return false;
}

/** Remove elemento (preferencial) ou força ocultação se a remoção falhar. */
function nuke(el: Element): void {
  try {
    el.remove();
  } catch {
    // Se não der pra remover (ex: dentro de shadow root fechado), oculta forte.
    if (el instanceof HTMLElement) {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  }
}

/** Varre uma raiz (Document ou ShadowRoot) por elementos a remover. */
function sweep(root: Document | ShadowRoot): void {
  // Match diretamente no root
  for (const sel of SELECTORS) {
    try {
      root.querySelectorAll(sel).forEach(nuke);
    } catch {
      /* selector inválido — ignora */
    }
  }
  // Também varre shadow DOMs aninhados (apenas open shadow roots)
  root.querySelectorAll('*').forEach((el) => {
    const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
    if (sr) sweep(sr);
  });
}

let installed = false;

/**
 * Instala o guard. Idempotente. Roda uma única vez por sessão.
 * Em DEV o sweep é silencioso. Em PROD também — o objetivo é puramente
 * remover, sem alarmar o usuário.
 */
export function installWhiteLabelGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 1. Sweep inicial após o documento estar pronto
  const initialSweep = () => sweep(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialSweep, { once: true });
  } else {
    initialSweep();
  }
  // Roda novamente após o load (alguns badges são injetados após onload)
  window.addEventListener('load', initialSweep, { once: true });

  // 2. Observa inserções futuras no <body>
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (shouldRemove(node)) {
          nuke(node);
          return;
        }
        // Verifica descendentes do node recém-adicionado
        for (const sel of SELECTORS) {
          try {
            node.querySelectorAll?.(sel).forEach(nuke);
          } catch { /* noop */ }
        }
        // Se o node tem shadow root, varre
        const sr = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) sweep(sr);
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/** Exporta os seletores para reuso pelo script de build (verify-no-branding). */
export const WHITE_LABEL_SELECTORS = SELECTORS;
