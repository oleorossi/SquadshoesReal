import { useQuery } from '@tanstack/react-query';
import {
  adaptCanonicalConsumptionLines,
  applyCanonicalStrapsForPresentation,
  canonicalStrapPreviews,
  fetchCanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';
import type { MaterialConsumptionRow } from '@/lib/orderConsumption';
import { formatUnitLabel } from '@/lib/unitLabels';
import { matchesConsumptionSector } from '@/lib/consumptionSector';

export type ConsumptionComponent =
  | 'Solado'
  | 'Cabedal'
  | 'Forração'
  | 'Palmilha'
  | 'Forração Palmilha'
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
  consumption_sector?: string | null;
  consumption_sector_source?: string | null;
  material_source?: string | null;
  matched_by?: string;
  unit?: string;
  category?: string;
  /** Família de napa (materialFamily do motor): a base de uma tira segue a napa
   *  da ficha da referência. Mantém tiras de napas diferentes separadas ao
   *  agregar OPs de referências distintas numa mesma ficha. */
  materialFamily?: string | null;
}

export interface BulkOrderConsumptionInput {
  /** UUID da OP. O servidor deriva referência, grade, variante e embalagem;
   *  campos abaixo permanecem só para a chave/lookup da ficha. */
  order_id: string;
  reference_id: string;
  quantity: number;
  color: string | null;
  size?: number | null;
  /** Grade BASE (por 1 ficha fechada) — necessária pro consumo por numeração.
   *  Sem ela, o motor cai no consumo médio escalar (menos preciso). */
  grade?: Record<string, number> | null;
  fichas?: number | null;
  strap_colors?: Array<{ label?: string; color?: string }> | null;
  /** Variante de material do item do PV (via orders.sale_order_item_id).
   *  Troca a origem dos materiais no motor — ver ConsumptionItem. */
  material_variant_id?: string | null;
}

/** Mapa componentType (canônico) → component (taxonomia da ficha do operador). */
const COMPONENT_TYPE_TO_BULK: Record<string, ConsumptionComponent> = {
  Cabedal: 'Cabedal',
  Forração: 'Forração',
  'Forração Palmilha': 'Forração Palmilha',
  Fachete: 'Fachete',
  Palmilha: 'Palmilha',
  Solado: 'Solado',
  Tiras: 'Tiras',
  Químicos: 'Químicos',
  Embalagem: 'Embalagem',
  Outros: 'Outros',
  'Componente Direto': 'Componente Direto',
  BOM: 'BOM',
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
  // Família entra na chave sintética: tiras de napas diferentes (NAPA SOFT ×
  // NAPA MADRID, por ficha da referência) não colapsam ao agregar OPs.
  product_id: r.productIds?.[0]
    || r.boxTypeIds?.[0]
    || `${r.componentType}::${r.groupName}::${r.color}::${r.productUnit}::${(r.materialFamily || '').trim()}`,
  product_name: ['direct_components', 'sheet_materials', 'component_color', 'component_color_default'].includes(r.consumptionMaterialSource || '')
    ? r.materialName || r.groupName
    : r.groupName || r.materialName,
  color: r.color,
  consumption_per_unit: 0,
  required: r.totalQuantity,
  available: 0,
  stock_ok: false,
  debit_mode: 'soft',
  unit: r.productUnit,
  category: r.groupName,
  source: r.widthMissing ? 'width_missing' : 'canonical',
  consumption_sector: r.consumptionSector || null,
  consumption_sector_source: r.consumptionSectorSource || null,
  material_source: r.consumptionMaterialSource || null,
  materialFamily: r.materialFamily || null,
});

/**
 * Hook bulk pra fichas de operador: projeta N OPs pelo mesmo motor SQL de
 * reserva/baixa e retorna mapa pra lookup rápido.
 *
 * Desde a migration 123 não existe cálculo de consumo neste hook: a RPC batch
 * deriva cada OP no servidor, chama `calculate_order_consumption_by_grade`,
 * embalagem de box_types e preview canônica de tiras. TS apenas adapta o shape.
 */
export const useBulkOrderConsumption = (inputs: BulkOrderConsumptionInput[]) => {
  const hasConsumptionCandidates = inputs.some(i => i.reference_id && i.quantity > 0);
  // A identidade da OP entra na chave: duas OPs visualmente iguais ainda podem
  // ter sourcing/revisão canônica de tira distintos no servidor.
  const uniqueInputs = Array.from(
    new Map(
      inputs
        .filter(i => i.order_id && i.reference_id && i.quantity > 0)
        .map(i => [
          bulkConsumptionKey(i.reference_id, i.color, i.quantity, i.grade, i.strap_colors, i.material_variant_id, i.order_id),
          i,
        ]),
    ).values(),
  );

  return useQuery({
    queryKey: [
      'bulk-order-consumption',
      uniqueInputs
        .map(i => bulkConsumptionKey(i.reference_id, i.color, i.quantity, i.grade, i.strap_colors, i.material_variant_id, i.order_id))
        .sort()
        .join('|'),
    ],
    // Se houver candidato sem UUID, mantém a query habilitada para que o
    // queryFn falhe alto. Desabilitar pelo array já filtrado esconderia o erro
    // justamente quando TODAS as OPs viessem sem identidade.
    enabled: hasConsumptionCandidates,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, ConsumptionRow[]>> => {
      const byKey = new Map<string, ConsumptionRow[]>();
      if (inputs.some(i => i.reference_id && i.quantity > 0 && !i.order_id)) {
        throw new Error('Há OP sem identidade UUID; consumo da ficha não foi calculado.');
      }
      const report = await fetchCanonicalConsumptionReport({
        orderIds: uniqueInputs.map((input) => input.order_id),
      });

      for (const input of uniqueInputs) {
        const key = bulkConsumptionKey(input.reference_id, input.color, input.quantity, input.grade, input.strap_colors, input.material_variant_id, input.order_id);
        const scope = new Set([input.order_id]);
        const baseRows = adaptCanonicalConsumptionLines(report.lines, scope);
        const previews = canonicalStrapPreviews(report, scope).map(({ preview }) => preview);
        const rows = applyCanonicalStrapsForPresentation(baseRows, previews);
        // Linhas só de aviso permanecem no relatório de planejamento, mas não
        // imprimem "0,00" na ficha fabril. Erro de RPC/schema rejeita o lote
        // inteiro acima; não há fallback para o motor TS antigo.
        byKey.set(
          key,
          rows
            .filter((row) => !(row.warning && !(row.totalQuantity > 0)))
            .map(toBulkConsumptionRow),
        );
      }
      return byKey;
    },
  });
};

/** Assinatura estável de grade + tiras pra chave de consumo. Duas OPs com a
 *  mesma ref+cor+qtd mas grade OU tiras diferentes têm consumo DIFERENTE
 *  (numeração do solado, cores das tiras) — sem isso a 2ª OP reusava o
 *  resultado da 1ª (a ficha imprimia consumo de tiras/numeração da outra). */
const consumptionVariantSig = (
  grade?: Record<string, number> | null,
  straps?: Array<{ label?: string; color?: string }> | null,
): string => {
  const g = grade
    ? Object.entries(grade)
        .filter(([k, v]) => !k.startsWith('_') && (Number(v) || 0) > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
    : '';
  const s = (straps || [])
    .map(t => `${(t.label || '').toUpperCase()}:${(t.color || '').toUpperCase()}`)
    .join('|');
  return `${g}#${s}`;
};

export const bulkConsumptionKey = (
  reference_id: string,
  color: string | null | undefined,
  quantity: number,
  grade?: Record<string, number> | null,
  straps?: Array<{ label?: string; color?: string }> | null,
  materialVariantId?: string | null,
  orderId?: string | null,
): string => `${reference_id}::${(color || '').toUpperCase()}::${quantity}::${consumptionVariantSig(grade, straps)}::${materialVariantId || ''}::${orderId || ''}`;

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

  // Linha não classificada pelo motor — único caso onde o fallback por NOME
  // pode rotear. Aplicar byName em linha JÁ classificada cruzava setores:
  // o cabedal 'Suede EVA + Cacharrel' casava /eva/ e os metros de suede
  // saíam impressos na ficha de Corte de Placa de Fibra.
  const unclassified = (r: ConsumptionRow) => !r.component || r.component === 'Outros';

  // Setor explícito/congelado vence a taxonomia. O fallback permanece apenas
  // para snapshots legados, sem deslocar cabedal/forro de seus quadros de contexto.
  const filter = (fallback: (row: ConsumptionRow) => boolean) => rows.filter((row) => (
    row.consumption_sector_source !== 'ambiguous' && (row.consumption_sector?.trim()
      ? matchesConsumptionSector(row.consumption_sector, sector)
      : fallback(row))
  ));

  switch (sector) {
    case 'Corte Fibra':
      // \beva\b: só a palavra isolada (placa EVA) — /forma/ removido (não há
      // match legítimo e capturava 'plataforma').
      return filter(r =>
        r.component === 'Palmilha' ||
        (unclassified(r) && byName(r, /palmilha|\beva\b|placa\s+de\s+fibra/)),
      );
    // 'Forração Palmilha' (forro que cobre a placa) é CORTADO no Corte
    // Forração — é napa de forro, não placa do Corte Fibra.
    case 'Corte Forração':
      return filter(r =>
        r.component === 'Forração' ||
        r.component === 'Forração Palmilha' ||
        r.component === 'Fachete',
      );
    case 'Corte Cabedal':
      return filter(r => r.component === 'Cabedal' || r.component === 'Fachete');
    case 'Costura':
    // Setores de FICHA (2026-06-12): a camada de impressão divide 'Costura'
    // em 'Costura Palmilha' e 'Costura Cabedal' — ambos derivam do mesmo
    // setor único do fluxo, então roteiam os mesmos materiais.
    case 'Costura Palmilha':
    case 'Costura Cabedal':
      return filter(r =>
        r.component === 'Cabedal' ||
        r.component === 'Forração' ||
        byName(r, /linha|fio/),
      );
    case 'Aviamento':
      // Aviamento VÊ cabedal + forro (regra da ficha: tema showMaterials='both'
      // no SilkMontageWorkSheet). 'Forração Palmilha' fica de fora — é corte
      // do setor Corte Forração, não material manuseado no Aviamento.
      return filter(r =>
        r.component === 'Cabedal' ||
        r.component === 'Forração' ||
        r.component === 'Tiras' ||
        // Linha/fio de costura cai em 'Outros' (classifyBomMaterial não tem
        // regra pra linha) mas é material da COSTURA — sem a exclusão, o
        // LINHANYL saía em kg na ficha de Aviamento de todas as refs.
        (r.component === 'Outros' && !byName(r, /linha|fio/)) ||
        r.component === 'Componente Direto' ||
        r.component === 'BOM' ||
        r.component === 'Forração (alternativa)' ||
        byName(r, /fivela|ilho|tira|presilha|botão|rebite|tacha|elástic|elastic|aviamento/),
      );
    case 'Silk':
      return filter(r => byName(r, /tinta|silk|estampa|emulsão|sublimação/));
    case 'Colagem':
      return filter(r =>
        r.component === 'Solado' || r.component === 'Químicos' || byName(r, /cola|adesivo|cimento|primer/),
      );
    case 'Montagem':
      return filter(r =>
        r.component === 'Solado' ||
        r.component === 'Palmilha' ||
        r.component === 'Químicos' ||
        byName(r, /cola|adesivo/),
      );
    case 'Solagem':
      return filter(r => r.component === 'Solado' || r.component === 'Químicos' || byName(r, /cola|adesivo|primer/));
    case 'Acabamento':
      return filter(r => r.component === 'Embalagem' || byName(r, /caixa|sacola|tag|etiqueta|papel\s+seda/));
    case 'Expedição':
      return filter(r => r.component === 'Embalagem' || byName(r, /caixa|sacola|fita|etiqueta|romaneio/));
    default:
      return filter(() => true);
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
      const productKey = [r.product_id, r.component, r.color || '', r.unit || '',
        r.materialFamily || '', r.consumption_sector || '', r.consumption_sector_source || '',
        r.material_source || ''].join('::');
      const existing = byProduct.get(productKey);
      if (!existing) {
        byProduct.set(productKey, { ...r });
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
  // Auditoria visual 11/06/2026: normaliza grafia ('metro' → 'm') na exibição.
  const unit = formatUnitLabel(r.unit, r.component === 'Solado' ? 'par' : 'un');
  const qty = r.required >= 10
    ? r.required.toFixed(1)
    : r.required.toFixed(2);
  return `${r.product_name} · ${qty} ${unit}`;
};
