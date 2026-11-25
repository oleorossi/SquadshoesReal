/**
 * Prazos do motor — a fonte única dos números que o motor de produção usa.
 * Espelha get_motor_config / update_motor_settings
 * (supabase/migrations/20270101054700_motor_prazos_config.sql).
 * Faixas e padrões aqui têm de bater com a validação do banco.
 */

export interface MotorSettings {
  default_prep_business_days: number | null;
  effective_default_prep_business_days: number;
  costura_offset_days: number;
  aviamento_offset_days: number;
  ready_before_billing_days: number;
  default_oc_lead_days: number;
  oc_urgency_window_business_days: number;
  weekly_purchase_cap_brl: number | null;
  purchase_horizon_business_days: number;
  buffer_business_days: number;
  motor_cabedal_gate_sector: string;
  auto_motor_enabled: boolean;
  urgent_release_without_material: boolean;
  updated_at: string | null;
}

export interface MotorReferenceRow {
  id: string;
  reference_id: string;
  reference_code: string | null;
  sector: string;
  prep_business_days: number | null;
  effective_prep_business_days: number | null;
  default_execution_mode: string | null;
  default_contractor_id: string | null;
  default_contractor_name: string | null;
  contractor_capacity_pairs_per_day: number | null;
}

export interface MotorContractorRow {
  contractor_id: string;
  name: string;
  sector: string;
  capacity_pairs_per_day: number | null;
  active: boolean;
}

export interface MotorSectorRow {
  sector: string;
  flow_order: number | null;
  enabled: boolean | null;
  daily_capacity_pairs: number | null;
}

export interface MotorConfig {
  settings: MotorSettings;
  references: MotorReferenceRow[];
  contractors: MotorContractorRow[];
  sectors: MotorSectorRow[];
  lead_time_categories: Array<Record<string, number | string | null>>;
}

export type MotorSettingKey =
  | 'default_prep_business_days'
  | 'costura_offset_days'
  | 'aviamento_offset_days'
  | 'ready_before_billing_days'
  | 'default_oc_lead_days'
  | 'oc_urgency_window_business_days'
  | 'weekly_purchase_cap_brl'
  | 'purchase_horizon_business_days'
  | 'buffer_business_days';

export interface MotorFieldSpec {
  key: MotorSettingKey;
  group: 'prestador' | 'agenda' | 'compras';
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Vazio é permitido (vira NULL no banco). */
  nullable: boolean;
  /** Padrão de fábrica — o mesmo comportamento de antes desta tela. */
  defaultValue: number | null;
  emptyMeaning?: string;
  /** Onde o motor usa este número (texto mostrado ao lado do campo). */
  usedFor: string;
}

export const MOTOR_FIELDS: MotorFieldSpec[] = [
  {
    key: 'default_prep_business_days',
    group: 'prestador',
    label: 'Prazo padrão do prestador',
    unit: 'dias úteis',
    min: 1,
    max: 60,
    nullable: true,
    defaultValue: null,
    emptyMeaning: 'vazio = usa Costura/Aviamento',
    usedFor:
      'Referência complexa sem prazo próprio: envio ao prestador = pronto − este prazo; a volta prevista libera a Montagem.',
  },
  {
    key: 'costura_offset_days',
    group: 'prestador',
    label: 'Costura (prestador)',
    unit: 'dias úteis',
    min: 0,
    max: 60,
    nullable: false,
    defaultValue: 5,
    usedFor: 'Prazo da costura do cabedal na rua quando não há prazo da referência nem prazo padrão.',
  },
  {
    key: 'aviamento_offset_days',
    group: 'prestador',
    label: 'Aviamento (prestador)',
    unit: 'dias úteis',
    min: 0,
    max: 60,
    nullable: false,
    defaultValue: 5,
    usedFor: 'Prazo do aviamento na rua quando não há prazo da referência nem prazo padrão.',
  },
  {
    key: 'ready_before_billing_days',
    group: 'agenda',
    label: 'Pronto antes do faturamento',
    unit: 'dias',
    min: 0,
    max: 60,
    nullable: false,
    defaultValue: 7,
    usedFor:
      'Cabedal do prestador (e material das OCs do PV) tem de estar na fábrica até a semana de faturamento − estes dias.',
  },
  {
    key: 'purchase_horizon_business_days',
    group: 'compras',
    label: 'Horizonte de compra',
    unit: 'dias úteis',
    min: 1,
    max: 60,
    nullable: false,
    defaultValue: 10,
    usedFor: 'Quanto à frente a sugestão de compra do motor olha.',
  },
  {
    key: 'buffer_business_days',
    group: 'compras',
    label: 'Folga de material',
    unit: 'dias úteis',
    min: 0,
    max: 30,
    nullable: false,
    defaultValue: 2,
    usedFor: 'Folga somada ao lead do fornecedor na sugestão de compra.',
  },
  {
    key: 'default_oc_lead_days',
    group: 'compras',
    label: 'Lead padrão de OC',
    unit: 'dias',
    min: 1,
    max: 120,
    nullable: false,
    defaultValue: 10,
    usedFor:
      'Fornecedor/produto sem lead cadastrado: comprar até = precisa na fábrica − este lead; OC em rascunho chega hoje + este lead.',
  },
  {
    key: 'oc_urgency_window_business_days',
    group: 'compras',
    label: 'Janela de urgência da OC',
    unit: 'dias úteis',
    min: 0,
    max: 30,
    nullable: false,
    defaultValue: 2,
    usedFor: 'OC em rascunho com comprar-até dentro desta janela vai para o topo como "Urgente".',
  },
  {
    key: 'weekly_purchase_cap_brl',
    group: 'compras',
    label: 'Teto semanal de compra',
    unit: 'R$',
    min: 1,
    max: 100_000_000,
    nullable: true,
    defaultValue: null,
    emptyMeaning: 'vazio = sem teto',
    usedFor: 'Soma das OCs em rascunho por semana de compra; o que passar do teto ganha o selo "Passa do teto".',
  },
];

export const MOTOR_GATE_SECTOR_DEFAULT = 'Montagem';

export const MOTOR_GATE_USED_FOR =
  'Setor que espera o cabedal do prestador: o item complexo só entra na agenda deste setor (e dos seguintes) a partir da volta prevista; os simples preenchem antes.';

/** Valida o texto digitado. Devolve o número (ou null) ou a mensagem de erro. */
export function parseMotorField(
  spec: MotorFieldSpec,
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = raw.trim().replace(',', '.');
  if (text === '') {
    if (spec.nullable) return { ok: true, value: null };
    return { ok: false, error: `${spec.label}: obrigatório (${spec.min} a ${spec.max} ${spec.unit})` };
  }
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: `${spec.label}: número inválido` };
  const value = spec.key === 'weekly_purchase_cap_brl' ? Math.round(n * 100) / 100 : Math.round(n);
  if (value < spec.min || value > spec.max) {
    return { ok: false, error: `${spec.label}: use de ${spec.min} a ${spec.max} ${spec.unit}` };
  }
  return { ok: true, value };
}

/** Prazo da referência no Ateliê: 1–60 dias úteis ou vazio (usa o padrão). */
export function parseReferencePrepDays(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'Prazo do prestador: número inteiro de dias úteis' };
  if (n < 1 || n > 60) return { ok: false, error: 'Prazo do prestador: use de 1 a 60 dias úteis (vazio = padrão)' };
  return { ok: true, value: n };
}

/** De onde vem o prazo efetivo de uma referência (mesma cascata do banco). */
export function prepSourceLabel(row: { prep_business_days?: number | null }, settings: Pick<MotorSettings, 'default_prep_business_days'>): string {
  if (row.prep_business_days != null) return 'prazo da referência';
  if (settings.default_prep_business_days != null) return 'prazo padrão do prestador';
  return 'Costura/Aviamento';
}

export function normalizeMotorConfig(raw: unknown): MotorConfig {
  const r = (raw ?? {}) as Partial<MotorConfig> & { settings?: Partial<MotorSettings> };
  const s: Partial<MotorSettings> = r.settings ?? {};
  const num = (v: unknown, d: number) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  const numOrNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    settings: {
      default_prep_business_days: numOrNull(s.default_prep_business_days),
      effective_default_prep_business_days: num(s.effective_default_prep_business_days, 5),
      costura_offset_days: num(s.costura_offset_days, 5),
      aviamento_offset_days: num(s.aviamento_offset_days, 5),
      ready_before_billing_days: num(s.ready_before_billing_days, 7),
      default_oc_lead_days: num(s.default_oc_lead_days, 10),
      oc_urgency_window_business_days: num(s.oc_urgency_window_business_days, 2),
      weekly_purchase_cap_brl: numOrNull(s.weekly_purchase_cap_brl),
      purchase_horizon_business_days: num(s.purchase_horizon_business_days, 10),
      buffer_business_days: num(s.buffer_business_days, 2),
      motor_cabedal_gate_sector: s.motor_cabedal_gate_sector || MOTOR_GATE_SECTOR_DEFAULT,
      auto_motor_enabled: Boolean(s.auto_motor_enabled),
      urgent_release_without_material: Boolean(s.urgent_release_without_material),
      updated_at: s.updated_at ?? null,
    },
    references: Array.isArray(r.references) ? r.references : [],
    contractors: Array.isArray(r.contractors) ? r.contractors : [],
    sectors: Array.isArray(r.sectors) ? r.sectors : [],
    lead_time_categories: Array.isArray(r.lead_time_categories) ? r.lead_time_categories : [],
  };
}
