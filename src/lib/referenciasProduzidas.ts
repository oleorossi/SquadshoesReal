// ─────────────────────────────────────────────────────────────────────────────
// "Referências produzidas no período" (Ficha de Montadores → aba Relatórios).
//
// Deriva DAS OPs o que passou pelo setor no intervalo — sem digitação extra na
// chamada do dia (decisão de produto 2026-07-26):
//   · fonte primária = production_pointings (ledger de apontamentos parciais,
//     1 linha por baixa com quantity + created_at);
//   · fallback       = order_stages concluídas no intervalo SEM nenhum pointing
//     (OPs antigas, pré-ledger) — nunca soma as duas fontes pro mesmo stage.
// Join: order_id → orders (color, reference_id) → technical_sheets (code, name).
//
// Lógica PURA (sem Supabase) pra ser testável; as queries moram em
// src/hooks/useReferenciasProduzidas.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeSector } from '@/lib/sectors';

export interface PointingInput {
  order_id: string;
  order_stage_id: string | null;
  stage_name: string | null;
  quantity: number | null;
  created_at: string | null;
}

export interface StageInput {
  id: string;
  order_id: string;
  stage_name: string | null;
  completed_at: string | null;
  quantity_processed: number | null;
  quantity_total: number | null;
}

export interface OrderInfo {
  id: string;
  order_number: string | null;
  color: string | null;
  reference_id: string | null;
  code: string | null;
  name: string | null;
}

export interface ReferenciaProduzidaRow {
  key: string;                 // `${reference_id ?? 'sem-ref'}|${cor normalizada}`
  code: string;
  name: string;
  color: string;
  pares: number;
  opsCount: number;
  ops: string[];               // order_numbers distintos (tooltip/print)
  fonte: 'apontamento' | 'estagio' | 'misto';
}

/** Mapeia o id de setor da Ficha de Montadores → SectorKey canônico
 *  (a Ficha usa 'aviamento'; o enum canônico é 'mesa'). */
export const FICHA_SETOR_TO_SECTOR_KEY: Record<string, string> = {
  corte_palmilha: 'corte_palmilha',
  corte_forracao: 'corte_forracao',
  aviamento:      'mesa',
  costura:        'costura',
  silk:           'silk',
  colagem:        'colagem',
  montagem:       'montagem',
  solagem:        'solagem',
  acabamento:     'acabamento',
  expedicao:      'expedicao',
};

/** Dia-fábrica (America/Sao_Paulo) de um timestamptz — espelha o br_today()
 *  do banco. 'sv-SE' formata como YYYY-MM-DD. */
export function toFactoryDay(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(d);
}

const normColor = (c: string | null | undefined) => String(c ?? '').trim();

export function aggregateReferenciasProduzidas(args: {
  pointings: PointingInput[];
  fallbackStages: StageInput[];
  /** stage ids que têm ALGUM pointing (qualquer data) — dedup do fallback. */
  stageIdsComPointing: Set<string>;
  orders: Map<string, OrderInfo>;
  /** SectorKey canônico do setor ativo (já convertido via FICHA_SETOR_TO_SECTOR_KEY). */
  sectorKey: string;
  from: string;
  to: string;
}): ReferenciaProduzidaRow[] {
  const { pointings, fallbackStages, stageIdsComPointing, orders, sectorKey, from, to } = args;
  if (!from || !to || from > to) return [];

  interface Grupo { pares: number; ops: Set<string>; fontes: Set<'apontamento' | 'estagio'>; info: OrderInfo | null; color: string; }
  const grupos = new Map<string, Grupo>();

  const add = (orderId: string, pares: number, fonte: 'apontamento' | 'estagio') => {
    const info = orders.get(orderId) ?? null;
    const color = normColor(info?.color);
    const key = `${info?.reference_id ?? 'sem-ref'}|${color.toLowerCase()}`;
    let g = grupos.get(key);
    if (!g) { g = { pares: 0, ops: new Set(), fontes: new Set(), info, color }; grupos.set(key, g); }
    g.pares += pares;
    if (info?.order_number) g.ops.add(info.order_number);
    g.fontes.add(fonte);
    if (!g.info && info) { g.info = info; g.color = color; }
  };

  // 1) ledger — soma quantity (estornos negativos somam negativo)
  for (const p of pointings) {
    if (normalizeSector(String(p.stage_name ?? '')) !== sectorKey) continue;
    if (!p.created_at) continue;
    const dia = toFactoryDay(p.created_at);
    if (!dia || dia < from || dia > to) continue;
    add(p.order_id, Number(p.quantity) || 0, 'apontamento');
  }

  // 2) fallback — só stages concluídos no intervalo SEM nenhum pointing
  for (const s of fallbackStages) {
    if (stageIdsComPointing.has(s.id)) continue;
    if (normalizeSector(String(s.stage_name ?? '')) !== sectorKey) continue;
    if (!s.completed_at) continue;
    const dia = toFactoryDay(s.completed_at);
    if (!dia || dia < from || dia > to) continue;
    const proc = Number(s.quantity_processed) || 0;
    add(s.order_id, proc > 0 ? proc : Number(s.quantity_total) || 0, 'estagio');
  }

  const rows: ReferenciaProduzidaRow[] = [];
  for (const [key, g] of grupos) {
    const pares = Math.max(0, g.pares); // estorno além do apontado não vira negativo
    if (pares <= 0) continue;
    rows.push({
      key,
      code: g.info?.code || '—',
      name: g.info?.reference_id ? (g.info?.name || '—') : '(sem referência)',
      color: g.color || '—',
      pares,
      opsCount: g.ops.size,
      ops: Array.from(g.ops).sort(),
      fonte: g.fontes.size > 1 ? 'misto' : (g.fontes.has('estagio') ? 'estagio' : 'apontamento'),
    });
  }
  return rows.sort((a, b) => b.pares - a.pares);
}
