/**
 * Anotação de disponibilidade + tiras artesanais sobre as linhas do motor
 * canônico de consumo (`@/lib/orderConsumption`). FONTE ÚNICA da tela de consumo
 * (`SummaryConsumptionPanel`, que atende 1 PV e o Consolidado) — extraída do
 * antigo modal por-PV em 2026-07-22
 * (`specs/consumo-consolidado-padronizacao.md`) pra os dois nunca mais divergirem.
 *
 * O motor (`computeConsumptionForItems`) só calcula o CONSUMO previsto. Aqui
 * anotamos, no momento da consulta:
 *  - `available` (não-solado): soma do estoque LÍQUIDO (`quantity − reserved_stock`)
 *    dos produtos do grupo que casam na cor;
 *  - `soleSizeStock` (solado): `stock_grade` do produto-solado resolvido, número a
 *    número;
 *  - `artisanal`: equivalente em napa-base se a tira for cortada do rolo
 *    (Materiais Artesanais → `artisanal_recipes`);
 *  - `artisanalStrapRows`: bloco de corte do rolo (grupo+cor, metros somados).
 *
 * Multi-PV: como o motor já agrega linhas idênticas (grupo+cor+unidade), a
 * demanda chega SOMADA e o estoque (global) é avaliado UMA vez por linha — sem
 * dupla contagem entre PVs.
 */
import { supabase } from '@/integrations/supabase/client';
import type { MaterialConsumptionRow, ConsumptionContext } from '@/lib/orderConsumption';
import {
  aggregateArtisanalStrapCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  type ArtisanalStrapAggInput,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';
import { resolveStrapYield, type StrapBaseRecipe } from '@/lib/strapYieldResolution';

/** Linha do modal/tela = consumo canônico + disponibilidade anotada localmente. */
export type ConsumptionRow = MaterialConsumptionRow & {
  /** Disponibilidade em estoque no momento da consulta (não-solado): soma do
   *  estoque dos produtos do grupo que casam na cor. Verde se cobre o consumo. */
  available?: number;
  /** Solado: estoque por numeração (stock_grade do produto-solado resolvido). */
  soleSizeStock?: Record<string, number>;
  /** Equivalente em material-base SE produzido artesanalmente (tira cortada do
   *  rolo). `baseName` = napa da FICHA da referência (materialFamily). `pending` =
   *  família conhecida mas SEM receita/rendimento cadastrado pra essa base (e sem
   *  como derivar). `derivedFrom` = rendimento HERDADO de outra base da mesma
   *  tira (`strapYieldResolution.ts`) — a linha ENTRA no total do material base. */
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number; pending?: boolean; derivedFrom?: string };
};

export const COMPONENT_ORDER = ['Cabedal', 'Forração', 'Fachete', 'Palmilha', 'Forração Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'] as const;

/** Normalização de texto (lowercase + sem acento) — match de cor/nome do estoque. */
export const normTxt = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const LINEAR = new Set(['m', 'metro', 'metros', 'mt']);

/**
 * Anota disponibilidade + tiras artesanais nas linhas do motor. Ordena as linhas
 * (COMPONENT_ORDER → grupo → aplicação → cor) e devolve o bloco de corte do rolo.
 * Puro sobre `ctx` (produtos/grupos já carregados) + duas queries próprias
 * (receitas artesanais + flag `is_artisanal_strap`), ambas defensivas.
 */
export async function annotateConsumptionAvailability(
  rows: MaterialConsumptionRow[],
  ctx: ConsumptionContext,
): Promise<{ rows: ConsumptionRow[]; artisanalStrapRows: ArtisanalStrapCutRow[] }> {
  const out = rows as ConsumptionRow[];

  // Receitas artesanais (Materiais Artesanais): ligam um produto artesanal (tira)
  // a um material-base (napa) com yield_per_meter. Query DEFENSIVA em cut_width_mm.
  let recipesData: any[] | null = null;
  {
    const withWidth = await supabase
      .from('artisanal_recipes')
      .select('artisanal_product_name, base_product_name, yield_per_meter, cut_width_mm' as any)
      .eq('active', true);
    if (!withWidth.error) {
      recipesData = withWidth.data as any[];
    } else {
      const fallback = await supabase
        .from('artisanal_recipes')
        .select('artisanal_product_name, base_product_name, yield_per_meter')
        .eq('active', true);
      recipesData = (fallback.data as any[]) || null;
    }
  }

  // ── Disponibilidade em estoque (no momento da consulta) ──────────────
  const colorMatchesProduct = (p: any, color: string): boolean => {
    if (!color || color === '—') return true;
    const c = normTxt(color);
    const pName = normTxt(p.name); const pColor = normTxt(p.color);
    if (pColor === c || pName === c) return true;
    const after = pName.includes(':') ? normTxt(pName.split(':').pop() || '') : pName.includes('-') ? normTxt(pName.split('-').pop() || '') : '';
    if (after && after === c) return true;
    if (pColor.length > 3 && c.length > 3 && (c.includes(pColor) || pColor.includes(c))) return true;
    return false;
  };
  /** Estoque LÍQUIDO do produto (nunca negativo). */
  const netStock = (p: { quantity?: number | null; reserved_stock?: number | null } | undefined): number =>
    Math.max(0, (Number(p?.quantity) || 0) - (Number(p?.reserved_stock) || 0));

  /**
   * Disponibilidade da linha. Quando o motor sabe de QUAIS produtos a linha veio
   * (`productIds`: componentes diretos, BOM, itens-padrão do solado), mede o
   * estoque SÓ deles. Só cai no match por grupo+cor quando a linha é derivada de
   * grupo (cabedal/forro/palmilha), onde o produto exato depende da cor.
   *
   * Sem isso, uma linha sem cor (`'—'`) fazia `colorMatchesProduct` devolver true
   * pra QUALQUER produto do grupo e somava o grupo inteiro: no PV-00147 a Fivela
   * 12mm (estoque 1, reservado 1728 → disponível 0) aparecia com "em estoque
   * 4.241" e check VERDE, que era o estoque do Binóculo 10mm Strass, vizinho de
   * grupo em COMPONENTES DIVERSOS. O modal afirmava cobertura de um material que
   * está zerado.
   */
  const rowAvailable = (groupName: string, color: string, productIds?: string[]): number => {
    if (productIds && productIds.length > 0) {
      const wanted = new Set(productIds);
      return (ctx.allProducts || [])
        .filter((p) => wanted.has(p.id))
        .reduce((s: number, p) => s + netStock(p), 0);
    }
    const group = (ctx.productGroups || []).find((g: any) => normTxt(g.name) === normTxt(groupName));
    return (ctx.allProducts || []).filter((p: any) => {
      const ok = group ? p.group_id === group.id : normTxt(p.name) === normTxt(groupName);
      if (!ok) return false;
      return colorMatchesProduct(p, color);
    }).reduce((s: number, p: any) => s + netStock(p), 0);
  };
  const extractStockGrade = (prod: any): Record<string, number> => {
    const res: Record<string, number> = {};
    const g = prod?.stock_grade;
    if (g && typeof g === 'object') {
      for (const [k, v] of Object.entries(g)) {
        if (k.startsWith('_')) continue; // pula meta (_size_to, _size_from)
        const n = Number(v);
        if (Number.isFinite(n)) res[k] = n;
      }
    }
    return res;
  };
  const soleStockById = (productId: string): Record<string, number> => {
    const prod = (ctx.allProducts || []).find((p: any) => p.id === productId);
    return extractStockGrade(prod);
  };
  const soleStockGrade = (groupName: string, color: string): Record<string, number> => {
    const prod = (ctx.allProducts || []).find((p: any) => normTxt(p.name) === normTxt(groupName) && colorMatchesProduct(p, color))
      || (ctx.allProducts || []).find((p: any) => normTxt(p.name) === normTxt(groupName));
    return extractStockGrade(prod);
  };

  // Mapa nome-do-produto-artesanal (normalizado) → { base, yield }.
  const recipeMap = new Map<string, { base: string; yieldPerMeter: number }>();
  // TODAS as receitas por tira (normalizada): a base de uma tira é a napa da
  // ficha da referência (materialFamily), não a base fixa da receita. O
  // resolvedor (`resolveStrapYield`) acha a receita exata da base ou HERDA o
  // rendimento de outra base da mesma tira.
  const recipesByStrapNorm = new Map<string, StrapBaseRecipe[]>();
  for (const r of (recipesData || []) as any[]) {
    const y = Number(r.yield_per_meter) || 0;
    if (y > 0 && r.artisanal_product_name) {
      const norm = normTxt(r.artisanal_product_name);
      if (!recipeMap.has(norm)) {
        recipeMap.set(norm, { base: r.base_product_name, yieldPerMeter: y });
      }
      if (r.base_product_name) {
        if (!recipesByStrapNorm.has(norm)) recipesByStrapNorm.set(norm, []);
        recipesByStrapNorm.get(norm)!.push({ baseName: r.base_product_name, yieldPerMeter: y });
      }
    }
  }

  // ── Tiras artesanais (corte do rolo): detecção + largura de corte ───────
  const recipeOutputNorms = new Set<string>();
  const recipeWidth = new Map<string, number>();
  const recipeBaseByNorm = new Map<string, string>();
  for (const r of (recipesData || []) as any[]) {
    const norm = normTxt(r.artisanal_product_name || '');
    if (!norm) continue;
    recipeOutputNorms.add(norm);
    const w = Number(r.cut_width_mm) || 0;
    if (w > (recipeWidth.get(norm) || 0)) recipeWidth.set(norm, w);
    const base = (r.base_product_name || '').toString().trim();
    if (base && !recipeBaseByNorm.has(norm)) recipeBaseByNorm.set(norm, base);
  }
  const groupWidthByNorm = new Map<string, number>();
  const groupNameByNorm = new Map<string, string>();
  const groupIdByNorm = new Map<string, string>();
  for (const g of (ctx.productGroups || []) as any[]) {
    const norm = normTxt(g.name);
    if (!norm) continue;
    if (!groupNameByNorm.has(norm)) groupNameByNorm.set(norm, g.name);
    if (g.id && !groupIdByNorm.has(norm)) groupIdByNorm.set(norm, String(g.id));
    const w = normalizeWidthToMm(g.dimensions_width, g.dimensions_unit);
    if (w > (groupWidthByNorm.get(norm) || 0)) groupWidthByNorm.set(norm, w);
  }
  // Flag `is_artisanal_strap` no grupo — sinal secundário (recipe vence). Defensiva.
  const groupArtisanalFlag = new Map<string, boolean>();
  {
    const { data: flagged, error: flagErr } = await supabase
      .from('product_groups')
      .select('name, is_artisanal_strap' as any);
    if (!flagErr && Array.isArray(flagged)) {
      for (const g of flagged as any[]) {
        if ((g as any)?.is_artisanal_strap) groupArtisanalFlag.set(normTxt(g.name), true);
      }
    }
  }
  const strapWidthForNorm = (norm: string) =>
    recipeWidth.get(norm) || groupWidthByNorm.get(norm) || 0;

  for (const row of out) {
    if (row.componentType === 'Solado') {
      row.soleSizeStock = row.soleProductId
        ? soleStockById(row.soleProductId)
        : soleStockGrade(row.groupName, row.color);
    } else {
      row.available = rowAvailable(row.groupName, row.color, row.productIds);
    }
    // Equivalente em material-base se feita artesanalmente. GATE por componentType
    // 'Tiras' — a conversão artesanal só vale pra linha de TIRA (sem isso, uma napa
    // consumida DIRETO cujo grupo casasse com um artisanal_product_name virava
    // "tira cortada de X" — bug PV-00148). Base = napa da FICHA (`materialFamily`).
    if (row.componentType === 'Tiras'
        && LINEAR.has((row.productUnit || '').toLowerCase())
        && row.totalQuantity > 0) {
      const nameNorm = normTxt(row.groupName);
      const matNorm = normTxt(row.materialName);
      // GATE 2: a tira precisa ser ARTESANAL (cortada do rolo) pra virar napa.
      // Tira COMPRADA PRONTA (strass, elástico, fivela, cadarço…) não sai de napa
      // — mesmo que a ficha da referência aponte uma napa em `materialFamily`, ela
      // NÃO consome napa. Sem este gate, a strass ganhava uma napa-base e caía em
      // "pendente de cadastro" (7 TIRA STRASS 6MM no PV-00147/00148) pedindo um
      // rendimento que nunca vai existir. Mesma detecção do bloco de corte do rolo
      // (recipe > flag de grupo > heurístico de nome), pros dois nunca divergirem.
      const isArtisanal = isArtisanalStrap({
        recipeFlag: recipeOutputNorms.has(nameNorm),
        groupFlag: groupArtisanalFlag.get(nameNorm),
        name: `${row.groupName} ${row.materialName || ''}`,
      });
      const legacy = recipeMap.get(nameNorm) || recipeMap.get(matNorm);
      const baseName = (row.materialFamily || '').trim() || legacy?.base || '';
      if (isArtisanal && baseName) {
        // Receitas desta tira (por grupo E por aplicação — mesmo alcance do
        // lookup legado). O resolvedor usa a exata da base ou herda de outra.
        const candidates = [
          ...(recipesByStrapNorm.get(nameNorm) || []),
          ...(nameNorm !== matNorm ? recipesByStrapNorm.get(matNorm) || [] : []),
        ];
        const resolved = resolveStrapYield({
          baseName,
          recipes: candidates,
          // Largura do rolo da base = dimensions_width do grupo da napa.
          rollWidthMm: (b) => groupWidthByNorm.get(normTxt(b)) || 0,
        });
        row.artisanal = resolved
          ? {
              baseName,
              baseQty: row.totalQuantity / resolved.yieldPerMeter,
              yieldPerMeter: resolved.yieldPerMeter,
              ...(resolved.derivedFrom ? { derivedFrom: resolved.derivedFrom } : {}),
            }
          : { baseName, baseQty: 0, yieldPerMeter: 0, pending: true };
      }
    }
  }

  const sortedRows = [...out].sort((a, b) => {
    const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number]) - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
    if (typeDiff !== 0) return typeDiff;
    const groupDiff = a.groupName.localeCompare(b.groupName, 'pt-BR');
    if (groupDiff !== 0) return groupDiff;
    const materialDiff = a.materialName.localeCompare(b.materialName, 'pt-BR');
    if (materialDiff !== 0) return materialDiff;
    return a.color.localeCompare(b.color, 'pt-BR');
  });

  // Linhas do bloco vermelho: uma por (grupo+cor) de tira artesanal. As linhas
  // 'Tiras' já vêm agregadas por grupo+cor em METROS (motor canônico).
  const artisanalInputs: ArtisanalStrapAggInput[] = [];
  for (const row of sortedRows) {
    if (row.componentType !== 'Tiras' || !(row.totalQuantity > 0)) continue;
    const norm = normTxt(row.groupName);
    const detected = isArtisanalStrap({
      recipeFlag: recipeOutputNorms.has(norm),
      groupFlag: groupArtisanalFlag.get(norm),
      name: `${row.groupName} ${row.materialName || ''}`,
    });
    if (!detected) continue;
    artisanalInputs.push({
      groupKey: groupIdByNorm.get(norm) || norm,
      groupName: groupNameByNorm.get(norm) || row.groupName,
      color: (row.color || '—').toString().trim() || '—',
      metros: row.totalQuantity,
      largura_mm: strapWidthForNorm(norm),
      baseName: recipeBaseByNorm.get(norm) || undefined,
    });
  }
  const artisanalStrapRows: ArtisanalStrapCutRow[] = aggregateArtisanalStrapCut(artisanalInputs);

  return { rows: sortedRows, artisanalStrapRows };
}
