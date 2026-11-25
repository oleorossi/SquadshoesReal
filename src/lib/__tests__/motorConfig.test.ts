import { describe, expect, it } from 'vitest';
import {
  MOTOR_FIELDS,
  normalizeMotorConfig,
  parseMotorField,
  parseReferencePrepDays,
  prepSourceLabel,
} from '@/lib/motorConfig';
import { sortByMotorPriority, type PurchaseOrderMotorPriority } from '@/lib/purchaseOrderMotorPriority';

const spec = (key: string) => MOTOR_FIELDS.find((f) => f.key === key)!;

describe('motorConfig', () => {
  it('padrões repetem o comportamento anterior', () => {
    expect(spec('default_oc_lead_days').defaultValue).toBe(10);
    expect(spec('ready_before_billing_days').defaultValue).toBe(7);
    expect(spec('costura_offset_days').defaultValue).toBe(5);
    expect(spec('weekly_purchase_cap_brl').defaultValue).toBeNull();
    expect(spec('default_prep_business_days').defaultValue).toBeNull();
  });

  it('valida faixas iguais às do banco', () => {
    expect(parseMotorField(spec('default_prep_business_days'), '')).toEqual({ ok: true, value: null });
    expect(parseMotorField(spec('default_prep_business_days'), '0').ok).toBe(false);
    expect(parseMotorField(spec('default_prep_business_days'), '61').ok).toBe(false);
    expect(parseMotorField(spec('default_oc_lead_days'), '').ok).toBe(false);
    expect(parseMotorField(spec('default_oc_lead_days'), '15')).toEqual({ ok: true, value: 15 });
    expect(parseMotorField(spec('weekly_purchase_cap_brl'), '25000,50')).toEqual({ ok: true, value: 25000.5 });
    expect(parseMotorField(spec('weekly_purchase_cap_brl'), 'abc').ok).toBe(false);
  });

  it('prazo da referência: 1–60 inteiro ou vazio', () => {
    expect(parseReferencePrepDays('')).toEqual({ ok: true, value: null });
    expect(parseReferencePrepDays('8')).toEqual({ ok: true, value: 8 });
    expect(parseReferencePrepDays('0').ok).toBe(false);
    expect(parseReferencePrepDays('7.5').ok).toBe(false);
  });

  it('origem do prazo segue a cascata do banco', () => {
    expect(prepSourceLabel({ prep_business_days: 8 }, { default_prep_business_days: 6 })).toBe('prazo da referência');
    expect(prepSourceLabel({ prep_business_days: null }, { default_prep_business_days: 6 })).toBe('prazo padrão do prestador');
    expect(prepSourceLabel({ prep_business_days: null }, { default_prep_business_days: null })).toBe('Costura/Aviamento');
  });

  it('normaliza resposta vazia com padrões', () => {
    const c = normalizeMotorConfig(null);
    expect(c.settings.default_oc_lead_days).toBe(10);
    expect(c.settings.motor_cabedal_gate_sector).toBe('Montagem');
    expect(c.settings.auto_motor_enabled).toBe(false);
    expect(c.references).toEqual([]);
  });
});

describe('sortByMotorPriority', () => {
  const p = (id: string, rank: number, urgency: PurchaseOrderMotorPriority['urgency']): PurchaseOrderMotorPriority => ({
    purchase_order_id: id, motor_rank: rank, urgency, material_need_date: null, purchase_by_date: null,
    send_to_contractor_date: null, lead_days: null, billing_anchor: null, is_urgent_pv: false,
    purchase_week: null, week_cumulative_brl: null, over_weekly_cap: false, reason: null,
  });

  it('priorizadas sobem (atrasada → urgente → normal, depois rank) e o resto mantém a ordem', () => {
    const orders = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const prio = new Map([
      ['d', p('d', 3, 'normal')],
      ['b', p('b', 2, 'urgente')],
      ['e', p('e', 1, 'atrasada')],
    ]);
    expect(sortByMotorPriority(orders, prio).map((o) => o.id)).toEqual(['e', 'b', 'd', 'a', 'c']);
  });

  it('sem prioridade devolve a mesma lista', () => {
    const orders = [{ id: 'a' }];
    expect(sortByMotorPriority(orders, undefined)).toBe(orders);
  });
});
