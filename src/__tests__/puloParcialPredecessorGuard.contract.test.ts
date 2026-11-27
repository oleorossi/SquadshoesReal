import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101066400_pulo_parcial_predecessor_em_andamento.sql'),
  'utf8',
);

describe('pulo parcial não exige predecessor concluído', () => {
  it('redefine o guard de transição manual com a regra de entrega parcial', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()');
    expect(SQL).toContain('AND COALESCE(v_prev_processed, 0) <= 0');
    expect(SQL).toContain("v_prev_status IS DISTINCT FROM 'concluido'");
    expect(SQL).toContain('quantity_processed');
  });

  it('continua bloqueando predecessor zerado e ainda não iniciado', () => {
    expect(SQL).toContain('não pode iniciar porque o setor anterior');
    expect(SQL).toContain('SELECT status, COALESCE(quantity_processed, 0)');
  });
});
