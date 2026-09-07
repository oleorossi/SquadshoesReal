import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101019200_os_rateio_multi_prestador.sql'),
  'utf8',
);

describe('rateio multi-prestador de OS — contrato SQL', () => {
  it('troca a unicidade OP×setor por OP×setor×prestador', () => {
    expect(SQL).toContain('DROP INDEX IF EXISTS public.uq_os_per_op_sector');
    expect(SQL).toMatch(/CREATE UNIQUE INDEX uq_os_per_op_sector_contractor[\s\S]*order_id, target_sector, contractor_id/);
  });

  it('permite vários prestadores ativos por atividade na ficha', () => {
    expect(SQL).toContain('DROP INDEX IF EXISTS public.uq_reference_terceirizacoes_active_ref_sector');
    expect(SQL).toMatch(/CREATE UNIQUE INDEX uq_reference_terceirizacoes_active_ref_sector_contractor[\s\S]*contractor_id/);
  });

  it('limita a soma das OS ativas à quantidade da OP', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.tg_cap_os_allocation_per_op_sector');
    expect(SQL).toContain('Rateio excede a OP');
    expect(SQL).toContain('trg_cap_os_allocation_per_op_sector');
  });

  it('expõe saldo restante, alocações e prestadores na prévia do PV', () => {
    expect(SQL).toContain('allocated_quantity integer');
    expect(SQL).toContain('remaining_quantity integer');
    expect(SQL).toContain('existing_allocations jsonb');
    expect(SQL).toContain('available_contractors jsonb');
  });

  it('publica ledger por prestador/data/valor', () => {
    expect(SQL).toContain('CREATE OR REPLACE VIEW public.v_pv_outsourcing_ledger');
    expect(SQL).toContain('first_dispatched_at');
    expect(SQL).toContain('unit_price');
    expect(SQL).toContain('total_value');
  });
});
