import { useQuery } from '@tanstack/react-query';
import {
  fetchConsumptionContext,
  fetchTechnicalSheetsForConsumption,
  computeConsumptionForItems,
  type ConsumptionItem,
  type MaterialConsumptionRow,
} from '@/lib/orderConsumption';
import { formatUnitLabel } from '@/lib/unitLabels';

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
  matched_by?: string;
  unit?: string;
  category?: string;
  /** Família de napa (materialFamily do motor): a base de uma tira segue a napa
   *  da ficha da referência. Mantém tiras de napas diferentes separadas ao
   *  agregar OPs de referências distintas numa mesma ficha. */
  materialFamily?: string | null;
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
  product_id: `${r.componentType}::${r.groupName}::${r.color}::${r.productUnit}::${(r.materialFamily || '').trim()}`,
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
  materialFamily: r.materialFamily || null,
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
  // Dedup determinístico pelo MESMO contrato de bulkConsumptionKey (inclui
  // grade + tiras — antes era só ref::COR::qtd e a 2ª OP "igual" era dropada).
  const uniqueInputs = Array.from(
    new Map(
      inputs
        .filter(i => i.reference_id && i.quantity > 0)
        .map(i => [
          bulkConsumptionKey(i.reference_id, i.color, i.quantity, i.grade, i.strap_colors as any, i.material_variant_id),
          i,
        ]),
    ).values(),
  );

  return useQuery({
    queryKey: [
      'bulk-order-consumption',
      uniqueInputs
        .map(i => bulkConsumptionKey(i.reference_id, i.color, i.quantity, i.grade, i.strap_colors as any, i.material_variant_id))
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
        const key = bulkConsumptionKey(input.reference_id, input.color, input.quantity, input.grade, input.strap_colors as any, input.material_variant_id);
        try {
          const item: ConsumptionItem = {
            reference_id: input.reference_id,
            color: input.color,
            quantity: input.quantity,
            grade: input.grade ?? null,
            fichas: input.fichas ?? null,
            strap_colors: input.strap_colors ?? null,
            material_variant_id: input.material_variant_id ?? null,
            technical_sheets: sheetMap.get(input.reference_id) ?? null,
          };
          const rows = computeConsumptionForItems([item], ctx);
          // Linhas SÓ de aviso (ex.: fachete sem specs, qtd 0) existem pro modal
          // do PV alertar o cadastro — não vão pra ficha do operador, senão
          // imprimiriam "0,00" sem quantidade real. Linha com consumo real E
          // aviso (ex.: fallback_average de tamanho sem spec — F2-02) CONTINUA
          // passando: a quantidade é válida, o warning é só contexto do modal.
          byKey.set(key, rows.filter(r => !(r.warning && !(r.totalQuantity > 0))).map(toBulkConsumptionRow));
        } catch (e) {
          console.warn(`[useBulkOrderConsumption] erro ao calcular ${key}:`, e);
          byKey.set(key, []);
        }
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
): string => `${reference_id}::${(color || '').toUpperCase()}::${quantity}::${consumptionVariantSig(grade, straps)}::${materialVariantId || ''}`;

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

  switch (sector) {
    case 'Corte Fibra':
      // \beva\b: só a palavra isolada (placa EVA) — /forma/ removido (não há
      // match legítimo e capturava 'plataforma').
      return rows.filter(r =>
        r.component === 'Palmilha' ||
        (unclassified(r) && byName(r, /palmilha|\beva\b|placa\s+de\s+fibra/)),
      );
    // 'Forração Palmilha' (forro que cobre a placa) é CORTADO no Corte
    // Forração — é napa de forro, não placa do Corte Fibra.
    case 'Corte Forração':
      return rows.filter(r =>
        r.component === 'Forração' ||
        r.component === 'Forração Palmilha' ||
        r.component === 'Fachete',
      );
    case 'Corte Cabedal':
      return rows.filter(r => r.component === 'Cabedal' || r.component === 'Fachete');
    case 'Costura':
    // Setores de FICHA (2026-06-12): a camada de impressão divide 'Costura'
    // em 'Costura Palmilha' e 'Costura Cabedal' — ambos derivam do mesmo
    // setor único do fluxo, então roteiam os mesmos materiais.
    case 'Costura Palmilha':
    case 'Costura Cabedal':
      return rows.filter(r =>
        r.component === 'Cabedal' ||
        r.component === 'Forração' ||
        byName(r, /linha|fio/),
      );
    case 'Aviamento':
      // Aviamento VÊ cabedal + forro (regra da ficha: tema showMaterials='both'
      // no SilkMontageWorkSheet). 'Forração Palmilha' fica de fora — é corte
      // do setor Corte Forração, não material manuseado no Aviamento.
      return rows.filter(r =>
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
  // Auditoria visual 11/06/2026: normaliza grafia ('metro' → 'm') na exibição.
  const unit = formatUnitLabel(r.unit, r.component === 'Solado' ? 'par' : 'un');
  const qty = r.required >= 10
    ? r.required.toFixed(1)
    : r.required.toFixed(2);
  return `${r.product_name} · ${qty} ${unit}`;
};
