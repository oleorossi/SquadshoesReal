import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const PATCH = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101067200_pg_safeupdate_delete_where_motor_e_resync.sql'),
  'utf8',
);
const MOTOR_AGENDA = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101054800_motor_ordem_unica_agenda.sql'),
  'utf8',
);
const MOTOR_COMPRAS = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101054900_motor_compras.sql'),
  'utf8',
);

describe('pg_safeupdate — DELETE com WHERE no motor e no resync', () => {
  it('o motor original tinha DELETE sem predicado (a causa do erro em produção)', () => {
    expect(MOTOR_AGENDA).toContain('DELETE FROM public.production_motor_forecast;');
    expect(MOTOR_AGENDA).toContain('DELETE FROM public.production_motor_state;');
    expect(MOTOR_COMPRAS).toContain('DELETE FROM public.purchase_order_motor_priority;');
  });

  it('o patch exige WHERE TRUE nos três alvos e guarda o corpo vivo', () => {
    expect(PATCH).toContain('DELETE FROM public.production_motor_forecast WHERE TRUE;');
    expect(PATCH).toContain('DELETE FROM public.production_motor_state WHERE TRUE;');
    expect(PATCH).toContain('DELETE FROM public.purchase_order_motor_priority WHERE TRUE;');
    expect(PATCH).toContain('DELETE FROM _exp_direct WHERE TRUE;');
    expect(PATCH).toContain('recompute_production_schedule_impl_249 ainda tem DELETE sem WHERE');
    expect(PATCH).toContain('refresh_purchase_order_motor_priority ainda tem DELETE sem WHERE');
    expect(PATCH).toContain('resync_op_material_reservations ainda tem DELETE sem WHERE');
  });
});
