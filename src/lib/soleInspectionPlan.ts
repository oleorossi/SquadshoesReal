/**
 * Helpers do plano de inspeção por família de solado.
 *
 * Limites vêm do fornecedor/lab (IBTeC / ISO 20871/17707/…). O software só
 * organiza — nunca pré-preenche tolerâncias. Gate de liberação de lote fica
 * para decisão futura quando houver plano preenchido.
 */
export interface SoleInspectionPlan {
  /** Dureza Shore A (ou nota livre em unit). */
  shore_min?: number | null;
  shore_max?: number | null;
  shore_unit?: string | null;
  /** Abrasão — tipicamente mm³ (ISO 20871). */
  abrasion_max?: number | null;
  abrasion_unit?: string | null;
  /** Flexão — ciclos (ISO 17707). */
  flexion_min_cycles?: number | null;
  /** Rasgamento (ISO 20872). */
  tear_min?: number | null;
  tear_unit?: string | null;
  /** Coeficiente de atrito (ISO 24267). */
  friction_min?: number | null;
  /** Delaminação (ISO 20875). */
  delamination_min?: number | null;
  delamination_unit?: string | null;
  /** Estabilidade dimensional / encolhimento (ISO 20873). */
  dimensional_max_pct?: number | null;
  /** Texto livre: norma aprovada, lab, data. */
  notes?: string | null;
  /** Bloquear liberação de lote sem ensaio? Default false até o dono ligar. */
  block_lot_without_test?: boolean | null;
}

export const EMPTY_SOLE_INSPECTION_PLAN: SoleInspectionPlan = {
  shore_min: null,
  shore_max: null,
  shore_unit: null,
  abrasion_max: null,
  abrasion_unit: null,
  flexion_min_cycles: null,
  tear_min: null,
  tear_unit: null,
  friction_min: null,
  delamination_min: null,
  delamination_unit: null,
  dimensional_max_pct: null,
  notes: null,
  block_lot_without_test: false,
};

export function parseSoleInspectionPlan(raw: unknown): SoleInspectionPlan {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  };
  return {
    shore_min: num(src.shore_min),
    shore_max: num(src.shore_max),
    shore_unit: str(src.shore_unit),
    abrasion_max: num(src.abrasion_max),
    abrasion_unit: str(src.abrasion_unit),
    flexion_min_cycles: num(src.flexion_min_cycles),
    tear_min: num(src.tear_min),
    tear_unit: str(src.tear_unit),
    friction_min: num(src.friction_min),
    delamination_min: num(src.delamination_min),
    delamination_unit: str(src.delamination_unit),
    dimensional_max_pct: num(src.dimensional_max_pct),
    notes: str(src.notes),
    block_lot_without_test: Boolean(src.block_lot_without_test),
  };
}

/** Remove chaves vazias pra não poluir o jsonb com nulls. */
export function serializeSoleInspectionPlan(plan: SoleInspectionPlan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: keyof SoleInspectionPlan, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'boolean' && value === false && key === 'block_lot_without_test') return;
    out[key] = value;
  };
  put('shore_min', plan.shore_min);
  put('shore_max', plan.shore_max);
  put('shore_unit', plan.shore_unit);
  put('abrasion_max', plan.abrasion_max);
  put('abrasion_unit', plan.abrasion_unit);
  put('flexion_min_cycles', plan.flexion_min_cycles);
  put('tear_min', plan.tear_min);
  put('tear_unit', plan.tear_unit);
  put('friction_min', plan.friction_min);
  put('delamination_min', plan.delamination_min);
  put('delamination_unit', plan.delamination_unit);
  put('dimensional_max_pct', plan.dimensional_max_pct);
  put('notes', plan.notes);
  put('block_lot_without_test', plan.block_lot_without_test || null);
  return out;
}

export function soleInspectionPlanIsEmpty(plan: SoleInspectionPlan): boolean {
  return Object.keys(serializeSoleInspectionPlan(plan)).length === 0;
}
