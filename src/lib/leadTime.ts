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

// SectorKey vive em ./sectors (fonte única). Re-exportado aqui pra não quebrar
// os imports existentes `import type { SectorKey } from '@/lib/leadTime'`.
import type { SectorKey } from './sectors';
export type { SectorKey };

interface SheetCapacityRow {
  cutting_capacity_per_day?: number | null;
  sewing_capacity_per_day?: number | null;
  costura_capacity_per_day?: number | null;
  costura_palmilha_capacity_per_day?: number | null;
  costura_cabedal_capacity_per_day?: number | null;
  assembly_capacity_per_day?: number | null;
  finishing_capacity_per_day?: number | null;
  mesa_daily_capacity?: number | null;
  silk_capacity_per_day?: number | null;
  gluing_capacity_per_day?: number | null;
  soling_capacity_per_day?: number | null;
  expedition_capacity_per_day?: number | null;
  lead_time_corte_dias?: number | null;
  lead_time_costura_dias?: number | null;
  lead_time_montagem_dias?: number | null;
  lead_time_acabamento_dias?: number | null;
  lead_time_expedicao_dias?: number | null;
  shoe_category?: string | null;
}

interface CategoryDefaultsRow {
  cutting_capacity_per_day?: number | null;
  sewing_capacity_per_day?: number | null;
  costura_capacity_per_day?: number | null;
  costura_palmilha_capacity_per_day?: number | null;
  costura_cabedal_capacity_per_day?: number | null;
  mesa_daily_capacity?: number | null;
  silk_capacity_per_day?: number | null;
  gluing_capacity_per_day?: number | null;
  assembly_capacity_per_day?: number | null;
  soling_capacity_per_day?: number | null;
  finishing_capacity_per_day?: number | null;
  expedition_capacity_per_day?: number | null;
  lead_time_corte_dias?: number | null;
  lead_time_costura_dias?: number | null;
  lead_time_montagem_dias?: number | null;
  lead_time_acabamento_dias?: number | null;
  lead_time_expedicao_dias?: number | null;
}

// HISTÓRICO IMPORTANTE — nomes de colunas vs. setores atuais:
//
// Antes do PR 1-3 (rename de setores em 20260506120000+), a fábrica tinha:
//   - "Corte" (palmilha) ↔ usava `sewing_capacity_per_day`
//   - "Costura" (forração) ↔ usava `cutting_capacity_per_day`
//
// Depois do rename, "Costura" foi DIVIDIDO em dois setores físicos:
//   - "Corte Palmilha" — herda a coluna legacy `sewing_capacity_per_day`
//   - "Corte Forração" — herda a coluna legacy `cutting_capacity_per_day`
//   - "Costura" (novo, PR 2) — coluna nova `costura_capacity_per_day`
//
// Manter os mapeamentos legados (sewing→palmilha, cutting→forração) evita
// migração destrutiva de dados em fichas técnicas existentes. Os nomes de
// coluna parecem invertidos mas refletem a evolução do schema. Não renomear
// sem migração de dados.
// Exportado para o guard de contrato em sectorCapacity.test.ts: o teste deriva
// deste mapa TODAS as colunas que o motor lê e trava que estão no
// DEFAULT_LEAD_TIME_COLUMNS do fetch. Setor/coluna nova entra na cobertura sozinha.
export const SECTOR_CONFIG: Record<SectorKey, {
  capField: keyof SheetCapacityRow;
  /** Coluna de capacidade alternativa quando a principal não está cadastrada
   *  (ex.: Expedição usa expedition_capacity_per_day, mas cai pra
   *  finishing_capacity_per_day — comportamento legado — quando vazia). */
  fallbackCapField?: keyof SheetCapacityRow;
  ltField: keyof SheetCapacityRow;
  hardFallbackDays: number;
}> = {
  // New sector names (PR 2 — Costura adicionado entre Corte Forração e Mesa)
  // Fix 2026-05-23: corte_palmilha usava lead_time_costura_dias por engano —
  // o resto da família corte (forração + mesa) usa lead_time_corte_dias.
  // Mantinha o nome 'sewing_capacity_per_day' (legado: chamavam corte de
  // palmilha de "costura de palmilha"), mas o lead_time correto é o de corte.
  corte_palmilha: { capField: 'sewing_capacity_per_day',    ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  corte_forracao: { capField: 'cutting_capacity_per_day',   ltField: 'lead_time_corte_dias',      hardFallbackDays: 2 },
  // Costura dividida em dois setores paralelos (migration 20261001120000).
  // Cada um tem capacidade própria, com fallback pra coluna antiga enquanto as
  // fichas não forem recadastradas — a migration já copiou o valor, o fallback
  // cobre ficha nova salva sem preencher os dois campos.
  costura_palmilha: { capField: 'costura_palmilha_capacity_per_day', fallbackCapField: 'costura_capacity_per_day', ltField: 'lead_time_costura_dias', hardFallbackDays: 1 },
  costura_cabedal:  { capField: 'costura_cabedal_capacity_per_day',  fallbackCapField: 'costura_capacity_per_day', ltField: 'lead_time_costura_dias', hardFallbackDays: 1 },
  // Legacy alias — a 'Costura' única de antes da divisão
  costura:        { capField: 'costura_capacity_per_day',   ltField: 'lead_time_costura_dias',    hardFallbackDays: 1 },
  mesa:           { capField: 'mesa_daily_capacity',        ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  silk:           { capField: 'silk_capacity_per_day',      ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  colagem:        { capField: 'gluing_capacity_per_day',    ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
  montagem:       { capField: 'assembly_capacity_per_day',  ltField: 'lead_time_montagem_dias',   hardFallbackDays: 2 },
  solagem:        { capField: 'soling_capacity_per_day',    ltField: 'lead_time_montagem_dias',   hardFallbackDays: 1 },
  acabamento:     { capField: 'finishing_capacity_per_day', ltField: 'lead_time_acabamento_dias', hardFallbackDays: 1 },
  expedicao:      { capField: 'expedition_capacity_per_day', fallbackCapField: 'finishing_capacity_per_day', ltField: 'lead_time_expedicao_dias', hardFallbackDays: 0 },
  // Legacy alias — 'corte' was renamed to corte_palmilha
  corte:          { capField: 'sewing_capacity_per_day',    ltField: 'lead_time_corte_dias',      hardFallbackDays: 1 },
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
  // Coluna de capacidade alternativa na ficha (ex.: Expedição → finishing).
  if (cfg.fallbackCapField) {
    const fromSheetFb = num(sheet?.[cfg.fallbackCapField]);
    if (fromSheetFb > 0) return fromSheetFb;
  }
  const fromCategory = num(categoryDefaults?.[cfg.capField as keyof CategoryDefaultsRow]);
  if (fromCategory > 0) return fromCategory;
  if (cfg.fallbackCapField) {
    return num(categoryDefaults?.[cfg.fallbackCapField as keyof CategoryDefaultsRow]);
  }
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
