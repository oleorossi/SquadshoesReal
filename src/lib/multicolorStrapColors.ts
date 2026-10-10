import { normalizeStrapColorKey } from '@/lib/strapSourcing';

/**
 * Tiras com cores combinadas (grill 10/10/2026, Q22–Q25).
 *
 * Num modelo multicolor as tiras `select_on_order` recebem cor no pedido, mas
 * a maioria costuma ser igual à cor principal. Este motor puro decide, por
 * linha elegível:
 *
 * - **Pré-preenchimento (Q24):** tira sem cor recebe a cor principal SE essa
 *   cor existir para aquela tira (lista do catálogo da própria posição — a mesma
 *   que o seletor oferece). Se não existir, a linha fica vazia e o guarda de
 *   save existente nomeia a tira.
 * - **Troca da cor principal (Q25):** tira cuja cor ainda é a cor principal
 *   ANTIGA acompanha a nova (ou fica vazia quando a nova não existe para ela);
 *   tira que o usuário trocou à mão mantém a escolha e entra em `kept`.
 *
 * Elegibilidade (quem é tira interna `select_on_order`, e se o snapshot é
 * editável) fica com o chamador: desktop e mobile têm fontes diferentes de
 * catálogo, mas a regra é uma só.
 */
export interface StrapColorChoice {
  id: string;
  name: string;
}

export interface StrapColorLineLike {
  color?: string | null;
  color_id?: string | null;
}

export interface SyncMulticolorStrapColorsOptions<T extends StrapColorLineLike> {
  /** Linha interna com cor escolhida no pedido e snapshot editável. */
  isEligible: (strap: T, index: number) => boolean;
  /** Cores válidas da posição; `null` = ainda não resolvido (não pré-preenche). */
  allowedColors: (strap: T, index: number) => StrapColorChoice[] | null;
  nextMainColor: string | null | undefined;
  /** UUID canônico da cor principal nova, quando conhecido (alias aprovado). */
  nextMainColorId?: string | null;
  /**
   * Cor principal ANTERIOR. Informe só quando a cor principal mudou; ausente
   * (`undefined`) = apenas pré-preencher linhas vazias.
   */
  previousMainColor?: string | null;
  previousMainColorId?: string | null;
}

export interface SyncMulticolorStrapColorsResult<T> {
  straps: T[];
  /** Índices cujas cores mudaram (o chamador limpa o sourcing dessas linhas). */
  changedIndexes: number[];
  /** Linhas que estavam na cor antiga e acompanharam a nova. */
  followed: number;
  /** Linhas com cor própria que mantiveram a escolha na troca da principal. */
  kept: number;
}

function findMainColor(
  allowed: StrapColorChoice[] | null,
  mainKey: string,
  mainId: string | null | undefined,
): StrapColorChoice | null {
  if (!allowed || !mainKey) return null;
  if (mainId) {
    const byId = allowed.find((color) => color.id === mainId);
    if (byId) return byId;
  }
  return allowed.find((color) => normalizeStrapColorKey(color.name) === mainKey) || null;
}

export function syncMulticolorStrapColors<T extends StrapColorLineLike>(
  straps: T[] | null | undefined,
  options: SyncMulticolorStrapColorsOptions<T>,
): SyncMulticolorStrapColorsResult<T> {
  const source = straps || [];
  const nextKey = normalizeStrapColorKey(options.nextMainColor);
  const mainChanged = options.previousMainColor !== undefined
    && normalizeStrapColorKey(options.previousMainColor) !== nextKey;
  const previousKey = mainChanged ? normalizeStrapColorKey(options.previousMainColor) : '';
  const previousId = mainChanged ? options.previousMainColorId || null : null;

  const changedIndexes: number[] = [];
  let followed = 0;
  let kept = 0;

  const result = source.map((strap, index) => {
    if (!options.isEligible(strap, index)) return strap;
    const hasColor = !!String(strap.color || '').trim() || !!strap.color_id;

    if (hasColor && mainChanged && previousKey) {
      const matchesPrevious = (!!previousId && strap.color_id === previousId)
        || normalizeStrapColorKey(strap.color) === previousKey;
      if (!matchesPrevious) {
        kept += 1;
        return strap;
      }
      followed += 1;
      const target = findMainColor(options.allowedColors(strap, index), nextKey, options.nextMainColorId);
      const nextColor = target?.name || '';
      const nextColorId = target?.id || null;
      if (strap.color === nextColor && (strap.color_id || null) === nextColorId) return strap;
      changedIndexes.push(index);
      return { ...strap, color: nextColor, color_id: nextColorId };
    }

    if (hasColor) return strap;
    const target = findMainColor(options.allowedColors(strap, index), nextKey, options.nextMainColorId);
    if (!target) return strap;
    changedIndexes.push(index);
    return { ...strap, color: target.name, color_id: target.id };
  });

  return {
    straps: changedIndexes.length > 0 ? result : source,
    changedIndexes,
    followed,
    kept,
  };
}

export function keptStrapColorsMessage(kept: number): string | null {
  if (kept <= 0) return null;
  return kept === 1
    ? '1 tira manteve a cor escolhida.'
    : `${kept} tiras mantiveram a cor escolhida.`;
}
