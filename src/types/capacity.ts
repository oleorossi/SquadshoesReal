// Contrato tipado do jsonb retornado pelos RPCs da Engine de Capacidade &
// Produtividade por Modelo (specs/produtividade-por-modelo.md).
// Espelha get_model_productivity / save_model_productivity_snapshot
// (migrations 20260719120100 / 20260719120200).

/** Cadeia de minutos por setor (R5 + R16 do spec):
 *  'bom' = valor específico do modelo (manual/cronoanálise/capacidade da própria
 *  ficha); 'ultima_referencia' = último valor preenchido pelo dono em OUTRA
 *  referência; 'default' = padrão da categoria; 'faltando' = nenhuma camada. */
export type MinutesSource = 'bom' | 'ultima_referencia' | 'medido' | 'default' | 'faltando';

/** De onde veio a equipe do setor (R6): ajuste manual > contagem do RH > vazio. */
export type TeamSource = 'rh' | 'manual' | 'nao_informado';

/** Cobertura da medição de produtividade no setor (R26). */
export type CoberturaMedicao = 'total' | 'parcial' | 'nenhum' | 'sem_pessoas';

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
  team_source: TeamSource;
  /** Contagem viva de funcionários ativos do setor no RH (R2). */
  rh_headcount: number;
  /** Setor sem equipe informada: fica FORA do gargalo em vez de zerar o modelo (R7). */
  nao_dimensionado: boolean;
  /** Capacidade observada (medida/lançada) — não sofre o fator de eficiência (R28). */
  capacidade_medida: boolean;
  cobertura_medicao: CoberturaMedicao | null;
  pessoas_medidas: number | null;
  pessoas_total: number | null;
  hourly_rate: number;
  pairs_per_day: number | null;
  mo_per_pair: number | null;
  is_bottleneck: boolean;
}

export interface ModelCosts {
  /** Método custo-minuto: Σ(min/par × custo-hora ÷ 60) — mesma fórmula do
   *  calculate_order_cost_item (≡ order_costs.labor_cost ÷ qty). */
  mo_per_pair: number | null;
  /** Parcela vinda de operações fora do roteiro, somada para manter o
   *  invariante com o custeio (R13). */
  mo_orphan_per_pair: number;
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
  /** Calculou com o que dá, mas há setor sem equipe informada (R7). */
  partial: boolean;
  /** Setores não dimensionados que ficaram fora do cálculo (R7/R16). */
  undimensioned: string[];
  /** Só tem tempo padrão da categoria — não entra no ranking comparativo (R12). */
  somente_padrao: boolean;
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

/** Linha do painel único de Equipe (R1/R6/R17): valor efetivo + origem + o que
 *  o RH tem, para o botão "adotar do RH". */
export interface SectorTeamRow {
  sector: string;
  flow_order: number;
  /** Ajuste manual salvo (null = segue o RH). */
  override: number | null;
  /** Valor em uso pelo cálculo. */
  valor: number | null;
  origem: TeamSource;
  rh_count: number;
}

/** Uma pessoa dentro da capacidade medida do setor (R19/R23/R27). */
export interface SectorMemberProductivity {
  employee_id: string;
  nome: string;
  fracao: number;
  jornada_min: number;
  pares_dia: number | null;
  fonte: 'informado' | 'chamada' | 'chamada_historico' | 'estimado_media' | 'nao_medido';
  dias_medidos: number;
}

/** Retorno de sector_measured_capacity (R20/R24/R26). */
export interface SectorMeasuredCapacity {
  sector: string;
  pessoas_total: number;
  pessoas_medidas: number;
  cobertura: CoberturaMedicao;
  media_medidos: number | null;
  pairs_per_day: number | null;
  /** Σ(jornadas) ÷ Σ(pares) — média harmônica ponderada, não a aritmética (R24). */
  min_person_per_pair: number | null;
  jornada_total_min: number;
  membros: SectorMemberProductivity[];
}

/** Linha de capacity_planning_comparison (R10). */
export interface PlanningComparisonRow {
  setor: string;
  capacidade_atual: number;
  capacidade_nova: number | null;
  fonte_nova: 'medido' | 'teorico' | 'sem_dado';
  variacao_pct: number | null;
  detalhe: string;
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

/** Retorno de set_model_sector_capacity (edição de capacidade na tela):
 *  pares/dia digitado → min/par gravado no BOM da ficha (time_source manual). */
export interface SetCapacityResult {
  action: 'updated' | 'inserted';
  sector: string;
  pairs_per_day: number;
  headcount: number;
  journey_minutes: number;
  minutes_per_pair: number;
  hourly_rate: number;
  mo_per_pair: number;
}

/** Linha de capacity_consistency_report() (/diagnostics). */
export interface CapacityConsistencyRow {
  categoria: string;
  severidade: 'alta' | 'media' | 'info';
  referencia: string;
  detalhe: string;
}
