import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ConsumptionComponent =
  | 'Solado'
  | 'Cabedal'
  | 'Forração'
  | 'Palmilha'
  | 'Fachete'
  | 'Componente Direto'
  | 'BOM'
  | 'Forração (alternativa)';

export interface ConsumptionRow {
  component: ConsumptionComponent;
  product_id: string;
  product_name: string;
  color?: string | null;
  consumption_per_unit: number;
  required: number;
  available: number;
  stock_ok: boolean;
  debit_mode: 'hard' | 'soft';
  source?: string;
  matched_by?: string;
  unit?: string;
  category?: string;
}

export interface BulkOrderConsumptionInput {
  reference_id: string;
  quantity: number;
  color: string | null;
  size?: number | null;
}

/**
 * Hook bulk pra fichas de operador: busca consumo de N OPs em paralelo
 * (deduplicadas por (ref, cor, qtd)). Retorna mapa pra lookup rápido.
 *
 * Diferente de `useOrderConsumption` (single, com validation completa),
 * este hook é otimizado pra **renderizar** consumo previsto em fichas
 * impressas — formato simples, sem validation, com dedup automática.
 *
 * Padrão de manufacturing traveler de mercado (Craftybase, ERPNext, Tulip):
 * mostrar "vai consumir X dm² de couro" pra cada ficha.
 */
export const useBulkOrderConsumption = (inputs: BulkOrderConsumptionInput[]) => {
  // Dedup determinístico
  const uniqueInputs = Array.from(
    new Map(
      inputs
        .filter(i => i.reference_id && i.quantity > 0)
        .map(i => [
          `${i.reference_id}::${(i.color || '').toUpperCase()}::${i.quantity}`,
          i,
        ]),
    ).values(),
  );

  return useQuery({
    queryKey: [
      'bulk-order-consumption',
      uniqueInputs
        .map(i => `${i.reference_id}::${i.color}::${i.quantity}`)
        .sort()
        .join('|'),
    ],
    enabled: uniqueInputs.length > 0,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, ConsumptionRow[]>> => {
      const byKey = new Map<string, ConsumptionRow[]>();
      await Promise.all(
        uniqueInputs.map(async input => {
          const key = bulkConsumptionKey(
            input.reference_id,
            input.color,
            input.quantity,
          );
          try {
            const { data, error } = await supabase.rpc(
              'calculate_order_consumption',
              {
                p_reference_id: input.reference_id,
                p_order_quantity: input.quantity,
                p_color: input.color ?? '',
                p_size: input.size ?? null,
                p_material_variant_id: null,
              },
            );
            if (error) {
              console.warn(
                `[useBulkOrderConsumption] RPC error for ${key}: ${error.message}`,
              );
              byKey.set(key, []);
              return;
            }
            byKey.set(key, ((data as unknown) as ConsumptionRow[]) ?? []);
          } catch (e) {
            console.warn(`[useBulkOrderConsumption] exception for ${key}:`, e);
            byKey.set(key, []);
          }
        }),
      );
      return byKey;
    },
  });
};

export const bulkConsumptionKey = (
  reference_id: string,
  color: string | null | undefined,
  quantity: number,
): string => `${reference_id}::${(color || '').toUpperCase()}::${quantity}`;

/**
 * Filtra componentes relevantes a um setor. Padrão de mercado: cada
 * estação só vê o que ela consome ou processa — não polui a ficha.
 */
export const filterConsumptionForSector = (
  rows: ConsumptionRow[],
  sector: string,
): ConsumptionRow[] => {
  const byName = (regex: RegExp) => (r: ConsumptionRow) =>
    regex.test((r.product_name || '').toLowerCase()) ||
    regex.test((r.category || '').toLowerCase());

  switch (sector) {
    case 'Corte Palmilha':
      return rows.filter(r => r.component === 'Palmilha' || byName(/palmilha|eva|forma/));
    case 'Corte Forração':
      return rows.filter(r => r.component === 'Forração' || r.component === 'Fachete');
    case 'Corte Cabedal':
      return rows.filter(r => r.component === 'Cabedal' || r.component === 'Fachete');
    case 'Costura':
      return rows.filter(r =>
        r.component === 'Cabedal' ||
        r.component === 'Forração' ||
        byName(/linha|fio/),
      );
    case 'Aviamento':
      return rows.filter(r =>
        r.component === 'Componente Direto' ||
        r.component === 'BOM' ||
        r.component === 'Forração (alternativa)' ||
        byName(/fivela|ilhos|tira|presilha|botão|rebite|tachas/),
      );
    case 'Silk':
      return rows.filter(r => byName(/tinta|silk|estampa|emulsão|sublimação/));
    case 'Colagem':
      return rows.filter(r =>
        r.component === 'Solado' || byName(/cola|adesivo|cimento|primer/),
      );
    case 'Montagem':
      return rows.filter(r =>
        r.component === 'Solado' ||
        r.component === 'Palmilha' ||
        byName(/cola|adesivo/),
      );
    case 'Solagem':
      return rows.filter(r => r.component === 'Solado' || byName(/cola|adesivo|primer/));
    case 'Acabamento':
      return rows.filter(r => byName(/caixa|sacola|tag|etiqueta|papel\s+seda/));
    case 'Expedição':
      return rows.filter(r => byName(/caixa|sacola|fita|etiqueta|romaneio/));
    default:
      return rows;
  }
};

/**
 * Agrega consumo de N OPs num único quadro de exibição.
 * Soma `required` por produto; mantém maior `consumption_per_unit` (todas
 * são iguais por design — produto idêntico).
 */
export const aggregateConsumption = (
  rowsByKey: Map<string, ConsumptionRow[]>,
  keys: string[],
): ConsumptionRow[] => {
  const byProduct = new Map<string, ConsumptionRow>();
  for (const key of keys) {
    const rows = rowsByKey.get(key) || [];
    for (const r of rows) {
      const existing = byProduct.get(r.product_id);
      if (!existing) {
        byProduct.set(r.product_id, { ...r });
      } else {
        existing.required += r.required;
        existing.available = Math.max(existing.available, r.available);
        existing.stock_ok = existing.available >= existing.required;
      }
    }
  }
  return Array.from(byProduct.values());
};

/**
 * Formata uma linha de consumo pra exibição compacta.
 * Ex: "EVA 3MM · 0.456 m" / "Solado Saltinho Bloco · 12 pares"
 */
export const formatConsumptionLine = (r: ConsumptionRow): string => {
  const unit = r.unit || (r.component === 'Solado' ? 'par' : 'un');
  const qty = r.required >= 10
    ? r.required.toFixed(1)
    : r.required.toFixed(2);
  return `${r.product_name} · ${qty} ${unit}`;
};
