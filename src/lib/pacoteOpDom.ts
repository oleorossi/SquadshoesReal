/**
 * Ponte DOM do Pacote da OP: a ficha Palmilha A4 já está medida/paginada na
 * tela (PaginatedSheet) e o PDF nasce dessa mesma árvore — nada é refeito.
 * Estas funções só contam e recortam as folhas `.pagi-page` do maço Palmilha.
 */

/** Marca do maço Palmilha dentro da área de impressão. */
export const PACOTE_PALMILHA_ATTR = 'data-op-package';
export const PACOTE_PALMILHA_VALUE = 'palmilha';
export const PACOTE_PALMILHA_SELECTOR = `[${PACOTE_PALMILHA_ATTR}="${PACOTE_PALMILHA_VALUE}"]`;

function paginas(raiz: ParentNode): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>('.pagi-page'));
}

/** Folhas A4 da Palmilha hoje na tela (0 quando o maço não existe). */
export function contarFolhasPalmilha(doc: ParentNode | null | undefined): number {
  if (!doc) return 0;
  const maco = doc.querySelector<HTMLElement>(PACOTE_PALMILHA_SELECTOR);
  return maco ? paginas(maco).length : 0;
}

/**
 * HTML do maço Palmilha só com as folhas pedidas (1-based, ordem original).
 * Mantém os wrappers (`.page-break` > ficha) para o CSS de impressão valer igual.
 * String vazia quando não há maço ou nenhuma folha foi escolhida.
 */
export function clonarPalmilhaHtml(
  doc: ParentNode | null | undefined,
  folhas: readonly number[],
): string {
  if (!doc || folhas.length === 0) return '';
  const maco = doc.querySelector<HTMLElement>(PACOTE_PALMILHA_SELECTOR);
  if (!maco) return '';
  const copia = maco.cloneNode(true) as HTMLElement;
  const escolhidas = new Set(folhas);
  paginas(copia).forEach((pagina, i) => {
    if (!escolhidas.has(i + 1)) pagina.remove();
  });
  if (paginas(copia).length === 0) return '';
  copia.removeAttribute(PACOTE_PALMILHA_ATTR);
  return copia.outerHTML;
}
