/**
 * Escopo do catálogo de fichas técnicas (Engenharia).
 *
 * Hub `/fichas-tecnicas` = só `publicada`.
 * `/engenharia/fichas-rascunho` = tudo ainda não publicado
 * (`rascunho` | `em_revisao` | `validada`), sem `arquivada`.
 */

export const FICHAS_RASCUNHO_PATH = '/engenharia/fichas-rascunho';

export type TechnicalSheetCatalogScope = 'published' | 'drafts';

export function normalizeStatusFicha(status: string | null | undefined): string {
  return String(status || 'rascunho').trim().toLowerCase();
}

export function isPublishedCatalogFicha(status: string | null | undefined): boolean {
  return normalizeStatusFicha(status) === 'publicada';
}

/** Entra na área "Fichas em rascunho" (não publicada e não arquivada). */
export function isDraftCatalogFicha(status: string | null | undefined): boolean {
  const s = normalizeStatusFicha(status);
  return s !== 'publicada' && s !== 'arquivada';
}

export function matchesCatalogScope(
  status: string | null | undefined,
  scope: TechnicalSheetCatalogScope,
): boolean {
  return scope === 'drafts' ? isDraftCatalogFicha(status) : isPublishedCatalogFicha(status);
}

/** Erro do portão `tg_block_publish_with_draft_materials`. */
export function isPublishBlockedByDraftMaterials(message: string | null | undefined): boolean {
  const m = String(message || '').toLowerCase();
  return m.includes('sem vínculo com o estoque')
    || m.includes('linhas-rascunho')
    || (m.includes('não é possível publicar') && m.includes('material'));
}
