import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101052200_motor_ignora_pv_apagado.sql',
), 'utf8');

describe('motor ignora PV apagado', () => {
  it('a sequência do PCP exige deleted_at nulo no pedido', () => {
    expect(migration).toContain('list_production_sequence()');
    expect(migration).toContain('so.deleted_at IS NULL');
    expect(migration).toContain('so.id IS NULL OR so.deleted_at IS NULL');
  });
});
