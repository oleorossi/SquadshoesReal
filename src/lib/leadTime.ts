/**
 * Centraliza o cálculo de lead time de cada setor produtivo.
 *
 * Política única: o lead time é DERIVADO da capacidade diária do setor.
 *
 *   lead_time_dias = max(1, ceil(quantidade / capacidade_diaria))
 *
 * A capacidade é lida em ordem de prioridade:
 *   1. technical_sheets.<setor>_capacity_per_day  (override por referência)
 *   2. default_lead_times.<setor>_capacity_per_day (fallback por categoria)
 *   3. constante hard-coded por categoria (último recurso)
 *
 * Sequência de setores (nova):
 *   Corte Palmilha → Corte Forração → Mesa → Silk → Colagem
 *   → Montagem → Solagem → Acabamento → Expedição
 *
 * Mapeamento de colunas (nome da coluna → setor):
 *   sewing_capacity_per_day   → Corte Palmilha (corte_palmilha)
 *   cutting_capacity_per_day  → Corte Forração (corte_forracao)
 *   mesa_daily_capacity       → Mesa
 *   silk_capacity_per_day     → Silk
 *   gluing_capacity_per_day   → Colagem
 *   assembly_capacity_per_day → Montagem
 *   soling_capacity_per_day   → Solagem
 *   finishing_capacity_per_day→ Acabamento
 *
 * Compatibilidade retroativa: as chaves legacy 'corte' e 'costura' continuam
 * funcionando mapeadas para as colunas originais.
 */

export type SectorKey =
  | 'corte_palmilha' | 'corte_forracao' | 'costura' | 'mesa' | 'silk'
  | 'colagem' | 'montagem' | 'solagem' | 'acabamento' | 'expedicao'
  // legacy — pre-rename, kept for backward compat with sectorCapacity.ts callers
  | 'corte';

interface SheetCapacityRow {
  cutting_capacity_per_day?: number | null;
  sewing_capacity_per_day?: number | null;
  costura_capacity_per_day?: number | null;
  assembly_capacity_per_day?: number | null;
  finishing_capacity_per_day?: number | null;
  mesa_daily_capacity?: number | null;
  silk_capacity_per_day?: number | null;
  gluing_capacity_per_day?: number | null;
  soling_capacity_per_day?: number | null;
  lead_time_corte_dias?: number | null;
  lead_time_costura_dias?: number | null;
  lead_time_montagem_dias?: number | null;
  lead_time_acabamento_dias?: number | null;
  shoe_category?: string | null;
}

interface CategoryDefaultsRow {
  cutting_capacity_per_day?: number | null;
  sewing_capacity_per_day?: number | null;
  costura_capacity_per_day?: number | null;
  mesa_daily_capacity?: number | null;
  silk_capacity_per_day?: number | null;
  gluing_capacity_per_day?: number | null;
  assembly_capacity_per_day?: number | null;
  soling_capacity_per_day?: number | null;
  finishing_capacity_per_day?: number | null;
  lead_time_corte_dias?: number | null;
  lead_time_costura_dias?: number | null;
  lead_time_montagem_dias?: number | null;
  lead_time_acabamento_dias?: number | null;
}

const SECTOR_CONFIG: Record<SectorKey, {
  capField: keyof SheetCapacityRow;
  ltField: keyof SheetCapacityRow;
  hardFallbackDays: number;
}> = {
  // New sector names (PR 2 — Costura adicionado entre Corte Forração e Mesa)
  corte_palmilha: { capField: 'sewing_capacity_per_day',    ltField: 'lead_time_costura_dias',    hardFallbackDays: 1 },
  corte_forracao: { capField: 'cutting_capacity_per_day',   ltField: 'lead_time_corte_dias',      hardFallbackDays: 2 },
  costura:        { capField: 'costura_capacity_per_day',   ltField: 'lead_time_costura_dias',    hardFallbackDays: 1 },
  mesa:           { capField: 'mesa_daily_capacity',        ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  silk:           { capField: 'silk_capacity_per_day',      ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  colagem:        { capField: 'gluing_capacity_per_day',    ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  montagem:       { capField: 'assembly_capacity_per_day',  ltField: 'lead_time_montagem_dias',   hardFallbackDays: 2 },
  solagem:        { capField: 'soling_capacity_per_day',    ltField: 'lead_time_montagem_dias',   hardFallbackDays: 1 },
  acabamento:     { capField: 'finishing_capacity_per_day', ltField: 'lead_time_acabamento_dias', hardFallbackDays: 1 },
  expedicao:      { capField: 'finishing_capacity_per_day', ltField: 'lead_time_acabamento_dias', hardFallbackDays: 0 },
  // Legacy alias — 'corte' was renamed to corte_palmilha
  corte:          { capField: 'sewing_capacity_per_day',    ltField: 'lead_time_costura_dias',    hardFallbackDays: 1 },
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve a capacidade efetiva (pares/dia) para um setor, considerando
 * override da ficha → fallback da categoria.
 * Retorna 0 quando não há capacidade configurada em nenhum nível.
 */
export function getEffectiveCapacityPerDay(
  sector: SectorKey,
  sheet: SheetCapacityRow | null | undefined,
  categoryDefaults?: CategoryDefaultsRow | null,
): number {
  const cfg = SECTOR_CONFIG[sector];
  const fromSheet = num(sheet?.[cfg.capField]);
  if (fromSheet > 0) return fromSheet;
  const fromCategory = num(categoryDefaults?.[cfg.capField as keyof CategoryDefaultsRow]);
  return fromCategory;
}

/**
 * Calcula o lead time (dias úteis) para um setor processar `quantity` pares
 * desta referência. Resultado mínimo = 1 dia (exceto expedicao que pode ser 0).
 */
export function computeSectorLeadTimeDays(
  sector: SectorKey,
  quantity: number,
  sheet: SheetCapacityRow | null | undefined,
  categoryDefaults?: CategoryDefaultsRow | null,
): number {
  const cfg = SECTOR_CONFIG[sector];
  const qty = Math.max(0, num(quantity));
  const minimum = sector === 'expedicao' ? 0 : 1;

  const cap = getEffectiveCapacityPerDay(sector, sheet, categoryDefaults);
  if (cap > 0) {
    if (qty <= 0) return minimum;
    return Math.max(minimum, Math.ceil(qty / cap));
  }

  const legacySheet = num(sheet?.[cfg.ltField]);
  if (legacySheet > 0) return legacySheet;

  const legacyCategory = num(categoryDefaults?.[cfg.ltField as keyof CategoryDefaultsRow]);
  if (legacyCategory > 0) return legacyCategory;

  return cfg.hardFallbackDays;
}

/**
 * Conveniência: calcula lead times de todos os setores para um pedido.
 */
export function computeAllSectorLeadTimes(
  quantity: number,
  sheet: SheetCapacityRow | null | undefined,
  categoryDefaults?: CategoryDefaultsRow | null,
): Record<SectorKey, number> {
  const keys: SectorKey[] = ['corte_palmilha','corte_forracao','costura','mesa','silk','colagem','montagem','solagem','acabamento','expedicao','corte'];
  return Object.fromEntries(
    keys.map(k => [k, computeSectorLeadTimeDays(k, quantity, sheet, categoryDefaults)])
  ) as Record<SectorKey, number>;
}
