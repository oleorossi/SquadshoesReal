// Contrato tipado do jsonb retornado pelos RPCs da Engine de Capacidade &
// Produtividade por Modelo (specs/produtividade-por-modelo.md).
// Espelha get_model_productivity / save_model_productivity_snapshot
// (migrations 20260719120100 / 20260719120200).

/** Cadeia de minutos por setor (R5 + R16 do spec):
 *  'bom' = valor específico do modelo (manual/cronoanálise/capacidade da própria
 *  ficha); 'ultima_referencia' = último valor preenchido pelo dono em OUTRA
 *  referência; 'default' = padrão da categoria; 'faltando' = nenhuma camada. */
export type MinutesSource = 'bom' | 'ultima_referencia' | 'default' | 'faltando';

export interface SectorProductivity {
  sector_key: string;
  label: string;
  minutes_per_pair: number | null;
  minutes_source: MinutesSource;
  /** Nome da ficha de origem quando minutes_source = 'ultima_referencia'. */
  source_sheet_name: string | null;
  /** time_source agregadas das linhas do BOM usadas (manual/cronoanalise/capacidade/default). */
  time_sources: string[];
  headcount: number | null;
  hourly_rate: number;
  pairs_per_day: number | null;
  mo_per_pair: number | null;
  is_bottleneck: boolean;
}

export interface ModelCosts {
  /** Método custo-minuto: Σ(min/par × custo-hora ÷ 60) — mesma fórmula do
   *  calculate_order_cost_item (≡ order_costs.labor_cost ÷ qty). */
  mo_per_pair: number | null;
  /** overhead_monthly_total ÷ monthly_production_target da cost_policy ativa. */
  overhead_per_pair: number | null;
  total_cost_minute_method: number | null;
  /** Custo diário da equipe dos setores do modelo (headcount × taxa × jornada). */
  team_day_cost: number;
  /** team_day_cost + overhead mensal ÷ dias úteis. */
  day_cost: number;
  /** Método gargalo: day_cost ÷ pares/dia — revela o custo da ociosidade. */
  bottleneck_cost_per_pair: number | null;
}

export interface ModelProductivity {
  sheet_id: string;
  name: string;
  shoe_category: string | null;
  /** true quando NENHUM setor resolveu tempo — fora do ranking e sem snapshot. */
  incomplete: boolean;
  warnings: string[];
  sectors: SectorProductivity[];
  bottleneck_sector: string | null;
  pairs_per_day: number | null;
  /** pares/dia ÷ melhor do conjunto comparado × 100 (melhor = 100). */
  productivity_index: number | null;
  costs: ModelCosts;
}

export interface CapacityEngineParams {
  journey_minutes: number;
  efficiency_pct: number;
  working_days_per_month: number;
  overhead_monthly_total: number | null;
  monthly_production_target: number | null;
}

export interface ModelProductivityResult {
  params: CapacityEngineParams;
  models: ModelProductivity[];
  missing_sheet_ids: string[];
}

/** Linha editável de capacity_parameters (singleton). */
export interface CapacityParameters {
  journey_minutes: number;
  efficiency_pct: number;
  working_days_per_month: number;
}

export interface SectorHeadcountRow {
  sector: string;
  flow_order: number;
  headcount: number | null;
}

/** Linha de model_productivity_snapshots (banco de custos por referência —
 *  FREEZE: corrigir a ficha depois não altera snapshots antigos). */
export interface ProductivitySnapshot {
  id: string;
  technical_sheet_id: string;
  sheet_name: string;
  pairs_per_day: number | null;
  bottleneck_sector: string | null;
  mo_per_pair: number | null;
  overhead_per_pair: number | null;
  total_cost_minute: number | null;
  bottleneck_cost_per_pair: number | null;
  params: CapacityEngineParams;
  sectors: SectorProductivity[];
  created_at: string;
}

/** Linha de capacity_consistency_report() (/diagnostics). */
export interface CapacityConsistencyRow {
  categoria: string;
  severidade: 'alta' | 'media' | 'info';
  referencia: string;
  detalhe: string;
}
