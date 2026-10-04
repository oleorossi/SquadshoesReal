import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mig = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101031000_production_sequence_frozen_and_list.sql'),
  'utf8',
);
const migPatch = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101031001_production_sequence_frozen_order_patches.sql'),
  'utf8',
);

describe('production sequence frozen (contract)', () => {
  it('cria sequence_frozen_at e sequence_frozen_position', () => {
    expect(mig).toContain('sequence_frozen_at');
    expect(mig).toContain('sequence_frozen_position');
  });

  it('congela no 1º apontamento de setor-raiz', () => {
    expect(mig).toContain('tg_freeze_production_sequence_on_first_sector');
    expect(mig).toContain('corte cabedal');
    expect(mig).toContain('production_pointings');
  });

  it('list_production_sequence expõe is_frozen', () => {
    expect(mig).toContain('is_frozen boolean');
    expect(mig).toContain('DROP FUNCTION IF EXISTS public.list_production_sequence');
  });

  it('patch companion confirma ordem frozen em recompute + view', () => {
    expect(migPatch).toContain('sequence_frozen_position');
    expect(migPatch).toContain('recompute_production_schedule_impl_249');
    expect(migPatch).toContain('v_production_queue_detail');
  });

  it('hub e rota sequencia existem no frontend', () => {
    const nav = readFileSync(resolve(__dirname, '../data/navigation.ts'), 'utf8');
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    const access = readFileSync(resolve(__dirname, '../hooks/useAccessControl.ts'), 'utf8');
    const hub = readFileSync(resolve(__dirname, '../pages/ProducaoHub.tsx'), 'utf8');
    expect(nav).toContain("'/producao/sequencia'");
    expect(nav).toContain("home: '/producao/sequencia'");
    expect(app).toContain('producao/sequencia');
    expect(access).toContain("'/producao/sequencia': 'producao'");
    expect(hub).toContain("'/producao/sequencia'");
  });

  it('kanban gestão ordena por queue_position da sequência', () => {
    const sort = readFileSync(
      resolve(__dirname, '../components/production/kanban/kanbanSort.ts'),
      'utf8',
    );
    expect(sort).toContain('queue_position');
  });
});
