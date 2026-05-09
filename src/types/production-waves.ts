/**
 * Valores do enum `production_stage_enum` no banco.
 *
 * Nota importante sobre Aviamento ↔ Mesa:
 *   O DB usa o valor `mesa` para o setor que a UI chama de "Aviamento".
 *   Não há valor `aviamento` no enum — "Aviamento" é APENAS um label de
 *   exibição. Ao inserir/atualizar `production_wave_stages.stage`, sempre
 *   use `'mesa'` (não `'aviamento'`).
 */
/**
 * Valores do enum `production_stage_enum` no banco.
 *
 * Nota: o DB usa `mesa` para o setor que a UI chama de "Aviamento".
 * O enum `costura` foi reaproveitado em 20260521120000 — antes mapeava pra
 * Corte Forração legacy, agora é o setor Costura propriamente dito (entre
 * Corte Forração e Aviamento).
 */
export type ProductionStage =
  | 'corte_palmilha' | 'corte_forracao' | 'costura' | 'mesa' | 'silk' | 'colagem'
  | 'montagem' | 'solagem' | 'acabamento' | 'expedicao'
  // Legacy values kept for backward compatibility with existing DB rows
  | 'corte' | 'palmilha';
export type WaveStatus = 'draft' | 'planning' | 'running' | 'finished' | 'cancelled';
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export const STAGE_ORDER: ProductionStage[] = [
  'corte_palmilha', 'corte_forracao', 'costura', 'mesa', 'silk', 'colagem',
  'montagem', 'solagem', 'acabamento', 'expedicao',
];

export const STAGE_LABEL: Record<string, string> = {
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
  costura: 'Costura',
  mesa: 'Aviamento',
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabamento',
  expedicao: 'Expedição',
  // Legacy labels (DB rows antigas)
  corte: 'Corte Palmilha',
  palmilha: 'Corte Palmilha',
};

/**
 * Canonical mapping: DB enum value → display name.
 * Used as single source of truth across the frontend.
 */
export const SECTOR_ENUM_TO_DISPLAY: Record<string, string> = {
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
  costura: 'Costura',
  mesa: 'Aviamento',
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabamento',
  expedicao: 'Expedição',
  // Legacy
  corte: 'Corte Palmilha',
  palmilha: 'Corte Palmilha',
};

/**
 * Reverse mapping: display name (UI) → canonical DB enum value.
 * Mirrors the DB function `sector_display_to_enum()`.
 */
export const DISPLAY_TO_SECTOR_ENUM: Record<string, ProductionStage> = {
  'corte palmilha': 'corte_palmilha',
  'corte forração': 'corte_forracao',
  'corte forracao': 'corte_forracao',
  'costura': 'costura',
  'aviamento': 'mesa',     // "Aviamento" é label; enum no DB é mesa
  'mesa': 'mesa',
  'silk': 'silk',
  'colagem': 'colagem',
  'montagem': 'montagem',
  'solagem': 'solagem',
  'acabamento': 'acabamento',
  'expedição': 'expedicao',
  'expedicao': 'expedicao',
  // Legacy
  'corte': 'corte_palmilha',
  'palmilha': 'corte_palmilha',
  'forração': 'corte_forracao',
  'forracao': 'corte_forracao',
  'forro': 'corte_forracao',
  'serigrafia': 'silk',
  'silkscreen': 'silk',
};

/**
 * Resolves a display name to its canonical DB enum, or null if unknown.
 * Frontend mirror of the DB function `sector_display_to_enum()`.
 */
export function resolveDisplayToEnum(displayName: string): ProductionStage | null {
  return DISPLAY_TO_SECTOR_ENUM[displayName.toLowerCase().trim()] ?? null;
}

/**
 * Normalizes a legacy enum value to its canonical form.
 * e.g. 'corte' → 'corte_palmilha', 'costura' → 'corte_forracao'
 */
export function normalizeStageEnum(stage: string): ProductionStage {
  const LEGACY_MAP: Record<string, ProductionStage> = {
    corte: 'corte_palmilha',
    palmilha: 'corte_palmilha',
    aviamento: 'mesa', // 'aviamento' é label de UI, enum no DB é mesa
  };
  return LEGACY_MAP[stage] ?? (stage as ProductionStage);
}

export type PickupWindow = 'tuesday' | 'friday';

export const PICKUP_WINDOW_LABEL: Record<PickupWindow, string> = {
  tuesday: 'Pickup Terça',
  friday:  'Pickup Sexta',
};

export const PICKUP_WINDOW_SHORT: Record<PickupWindow, string> = {
  tuesday: 'Ter',
  friday:  'Sex',
};

export type ProductionWave = {
  id: string;
  code: string;
  week_start: string;
  week_end: string;
  status: WaveStatus;
  current_stage: ProductionStage | null;
  total_pairs: number;
  total_items: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  earliest_deadline: string | null;
  purchase_deadline: string | null;
  material_ready_date: string | null;
  pickup_tuesday_date: string | null;
  pickup_friday_date: string | null;
};

export type WavePickupSummary = {
  pickup_window: PickupWindow;
  pickup_date: string | null;
  total_items: number;
  total_pairs: number;
  block_count: number;
  sale_order_count: number;
};

export type WaveStage = {
  stage: ProductionStage;
  status: StageStatus;
  progress_pct: number;
  started_at: string | null;
  finished_at: string | null;
};

export type WaveItem = {
  item_id: string;
  reference_id: string;
  reference_name: string;
  sole_product_id: string | null;
  sole_name: string | null;
  color: string;
  total_quantity: number;
  grade: Record<string, number>;
  block_key?: string | null;
  block_sequence?: number | null;
  pickup_window?: PickupWindow | null;
};

export type WaveDetail = {
  wave_id: string;
  code: string;
  week_start: string;
  week_end: string;
  wave_status: WaveStatus;
  current_stage: ProductionStage | null;
  total_pairs: number;
  total_items: number;
  stages: WaveStage[];
  items: WaveItem[];
};

export type SectorBoardRow = {
  stage: ProductionStage;
  ord: number;
  active_wave: {
    wave_id: string;
    code: string;
    week_start: string;
    week_end: string;
    progress_pct: number;
    total_pairs: number;
    started_at: string | null;
  } | null;
  next_wave: {
    wave_id: string;
    code: string;
    week_start: string;
  } | null;
  completed_count: number;
};

export type FinishingPackage = {
  id: string;
  wave_id: string;
  sale_order_id: string | null;
  store_name: string | null;
  reference_id: string | null;
  color: string | null;
  quantity: number;
  grade: Record<string, number>;
  status: 'pending' | 'packed' | 'shipped';
  packed_at: string | null;
  shipped_at: string | null;
};

export type WaveOrder = {
  wave_id: string;
  sale_order_id: string | null;
  order_number: string | null;
  delivery_deadline: string | null;
  order_status: string | null;
  client_name: string | null;
  client_fantasy: string | null;
  source_count: number;
  total_pairs: number;
};

export const WAVE_STATUS_LABEL: Record<WaveStatus, string> = {
  draft: 'Rascunho',
  planning: 'Planejada',
  running: 'Em produção',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
};
