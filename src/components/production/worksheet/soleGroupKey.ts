/**
 * Chave de agrupamento por SOLADO pros maços de impressão dos setores
 * agrupados (Corte Forração / Costura Palmilha / Costura Cabedal / Silk e
 * o pré-merge do Corte Cabedal) — `buildColorGroupedSheets('sole')` em
 * `PrintWorkSheetsPage.tsx`.
 *
 * BUG (2026-06-12, dono: "Corte de forração tá duplicado no relatório /
 * vários setores estão repetindo na hora de gerar o arquivo"): a chave usava
 * `sole_product_id` — mas o PRODUTO de solado é um SKU POR COR ("Solado
 * Tratorado - Preto" ≠ "Solado Tratorado - Caramelo"), enquanto o título
 * impresso do grupo é o nome BASE sem o sufixo de cor (getBaseName). Um PV
 * com 3 cores de cabedal resolve (via sole_color_conjugations /
 * technical_sheet_sole_colors) 3 produtos do MESMO solado → o maço imprimia
 * 3 grupos consecutivos todos intitulados "SOLADO TRATORADO" (sub-header +
 * cards + CompletionFooter cada), parecendo o setor inteiro duplicado.
 *
 * FIX: agrupa pelo GRUPO do produto (`products.group_id` = o MODELO do
 * solado — mesma identidade do título impresso). Fallbacks, na ordem:
 *   1. `grp::<groupId>`  — produto resolvido com grupo (caso comum);
 *   2. `pid::<productId>` — produto resolvido SEM grupo (avulso);
 *   3. `txt::<sheetId>`  — sem produto, mas a ficha tem sole_material
 *      textual. POR FICHA de propósito: fichas distintas com o mesmo label
 *      textual ("01") NÃO se fundem (decisão de 2026-05-19 — SP117/SP119);
 *   4. `none`            — sem qualquer solado ("Sem Solado").
 */
export interface SoleKeyInput {
  productId?: string | null;
  groupId?: string | null;
}

export function soleGroupKey(
  resolved: SoleKeyInput | null | undefined,
  fallbackSoleText: string | null | undefined,
  sheetId: string | null | undefined,
): string {
  if (resolved?.groupId) return `grp::${resolved.groupId}`;
  if (resolved?.productId) return `pid::${resolved.productId}`;
  return fallbackSoleText ? `txt::${sheetId ?? ''}` : 'none';
}
