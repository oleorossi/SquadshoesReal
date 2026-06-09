import { useQuery } from '@tanstack/react-query';
import {
  fetchConsumptionContext,
  fetchTechnicalSheetsForConsumption,
  computeConsumptionForItems,
  type ConsumptionItem,
  type MaterialConsumptionRow,
} from '@/lib/orderConsumption';

export type ConsumptionComponent =
  | 'Solado'
  | 'Cabedal'
  | 'Forração'
  | 'Palmilha'
  | 'Fachete'
  | 'Tiras'
  | 'Químicos'
  | 'Embalagem'
  | 'Componente Direto'
  | 'BOM'
  | 'Forração (alternativa)'
  | 'Outros';

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
  /** Grade BASE (por 1 ficha fechada) — necessária pro consumo por numeração.
   *  Sem ela, o motor cai no consumo médio escalar (menos preciso). */
  grade?: Record<string, number> | null;
  fichas?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strap_colors?: any[] | null;
}

/** Mapa componentType (canônico) → component (taxonomia da ficha do operador). */
const COMPONENT_TYPE_TO_BULK: Record<string, ConsumptionComponent> = {
  Cabedal: 'Cabedal',
  Forração: 'Forração',
  Fachete: 'Fachete',
  Palmilha: 'Palmilha',
  Solado: 'Solado',
  Tiras: 'Tiras',
  Químicos: 'Químicos',
  Embalagem: 'Embalagem',
  Outros: 'Outros',
};

/**
 * Adapta uma linha do motor canônico (`MaterialConsumptionRow`) para o shape
 * que as fichas do operador consomem (`ConsumptionRow`). A QUANTIDADE
 * (`required`) é o `totalQuantity` cru do motor — paridade exata com o modal.
 *
 * `product_id` é uma chave sintética estável (componentType+grupo+cor+unidade)
 * só pra agregação/React key — as fichas não usam o id real do produto.
 * Disponibilidade não é calculada aqui (a ficha mostra só o consumo previsto).
 */
export const toBulkConsumptionRow = (r: MaterialConsumptionRow): ConsumptionRow => ({
  component: COMPONENT_TYPE_TO_BULK[r.componentType] ?? 'Outros',
  product_id: `${r.componentType}::${r.groupName}::${r.color}::${r.productUnit}`,
  product_name: r.groupName || r.materialName,
  color: r.color,
  consumption_per_unit: 0,
  required: r.totalQuantity,
  available: 0,
  stock_ok: false,
  debit_mode: 'soft',
  unit: r.productUnit,
  category: r.groupName,
  source: r.widthMissing ? 'width_missing' : 'canonical',
});

/**
 * Hook bulk pra fichas de operador: calcula consumo de N OPs (deduplicadas por
 * (ref, cor, qtd)) e retorna mapa pra lookup rápido.
 *
 * RELIGADO (2026-06-02) ao motor CANÔNICO `@/lib/orderConsumption` — o MESMO
 * que alimenta o modal "Consumo de Materiais" do PV. Antes usava o RPC SQL
 * `calculate_order_consumption`, caminho divergente que produzia nomes/
 * quantidades desalinhados na ficha. Agora 1 OP = 1 item e o resultado bate
 * com o modal por construção (ver `src/lib/__tests__/orderConsumption.test.ts`).
 *
 * O RPC SQL continua existindo pra custeio/MRP (agregação de compra) — só a
 * UI da ficha deixou de usá-lo.
 */
export const useBulkOrderConsumption = (inputs: BulkOrderConsumptionInput[]) => {
  // Dedup determinístico por (ref, cor, qtd) — mesmo contrato de bulkConsumptionKey.
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
        .map(i => `${i.reference_id}::${i.color}::${i.quantity}::${JSON.stringify(i.grade ?? null)}`)
        .sort()
        .join('|'),
    ],
    enabled: uniqueInputs.length > 0,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, ConsumptionRow[]>> => {
      const byKey = new Map<string, ConsumptionRow[]>();

      const refIds = [...new Set(uniqueInputs.map(i => i.reference_id).filter(Boolean))];
      // Contexto + fichas técnicas em batch (1 par de fetches pra todas as OPs).
      const [ctx, sheetMap] = await Promise.all([
        fetchConsumptionContext(refIds),
        fetchTechnicalSheetsForConsumption(refIds),
      ]);

      for (const input of uniqueInputs) {
        const key = bulkConsumptionKey(input.reference_id, input.color, input.quantity);
        try {
          const item: ConsumptionItem = {
            reference_id: input.reference_id,
            color: input.color,
            quantity: input.quantity,
            grade: input.grade ?? null,
            fichas: input.fichas ?? null,
            strap_colors: input.strap_colors ?? null,
            technical_sheets: sheetMap.get(input.reference_id) ?? null,
          };
          const rows = computeConsumptionForItems([item], ctx);
          byKey.set(key, rows.map(toBulkConsumptionRow));
        } catch (e) {
          console.warn(`[useBulkOrderConsumption] erro ao calcular ${key}:`, e);
          byKey.set(key, []);
        }
      }
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
 *
 * Roteia a taxonomia canônica do motor (Cabedal/Forração/Palmilha/Solado/
 * Tiras/Químicos/Embalagem/Outros) + fallback por nome do material.
 */
export const filterConsumptionForSector = (
  rows: ConsumptionRow[],
  sector: string,
): ConsumptionRow[] => {
  // ⚠ byName recebe (row, regex) e RETORNA boolean. Antes era currificado
  // (`byName(regex)` devolvia uma função) e os call sites usavam `... || byName(/x/)`
  // sem aplicar a `r` — uma função é sempre truthy, então o filtro era um NO-OP
  // (devolvia TODAS as linhas em todo setor). Com o motor canônico alimentando
  // `component`/`product_name` corretos, o filtro passa a de fato segmentar.
  const byName = (r: ConsumptionRow, regex: RegExp) =>
    regex.test((r.product_name || '').toLowerCase()) ||
    regex.test((r.category || '').toLowerCase());

  switch (sector) {
    case 'Corte Palmilha':
      return rows.filter(r => r.component === 'Palmilha' || byName(r, /palmilha|eva|forma/));
    case 'Corte Forração':
      return rows.filter(r => r.component === 'Forração' || r.component === 'Fachete');
    case 'Corte Cabedal':
      return rows.filter(r => r.component === 'Cabedal' || r.component === 'Fachete');
    case 'Costura':
      return rows.filter(r =>
        r.component === 'Cabedal' ||
        r.component === 'Forração' ||
        byName(r, /linha|fio/),
      );
    case 'Aviamento':
      return rows.filter(r =>
        r.component === 'Tiras' ||
        r.component === 'Outros' ||
        r.component === 'Componente Direto' ||
        r.component === 'BOM' ||
        r.component === 'Forração (alternativa)' ||
        byName(r, /fivela|ilho|tira|presilha|botão|rebite|tacha|elástic|elastic|aviamento/),
      );
    case 'Silk':
      return rows.filter(r => byName(r, /tinta|silk|estampa|emulsão|sublimação/));
    case 'Colagem':
      return rows.filter(r =>
        r.component === 'Solado' || r.component === 'Químicos' || byName(r, /cola|adesivo|cimento|primer/),
      );
    case 'Montagem':
      return rows.filter(r =>
        r.component === 'Solado' ||
        r.component === 'Palmilha' ||
        r.component === 'Químicos' ||
        byName(r, /cola|adesivo/),
      );
    case 'Solagem':
      return rows.filter(r => r.component === 'Solado' || r.component === 'Químicos' || byName(r, /cola|adesivo|primer/));
    case 'Acabamento':
      return rows.filter(r => r.component === 'Embalagem' || byName(r, /caixa|sacola|tag|etiqueta|papel\s+seda/));
    case 'Expedição':
      return rows.filter(r => r.component === 'Embalagem' || byName(r, /caixa|sacola|fita|etiqueta|romaneio/));
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
