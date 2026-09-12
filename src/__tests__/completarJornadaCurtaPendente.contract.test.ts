import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101024600_completar-jornada-curta-pendente.sql'),
  'utf8',
);

describe('completar jornada curta na fila (migration 20270101024600)', () => {
  it('redefine apply_manual_punch_completion no mesmo arquivo', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_manual_punch_completion/);
    expect(SQL).toMatch(/\nBEGIN;\n/);
    expect(SQL.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('par completo só bloqueia quando o dia NÃO está na fila de pendências', () => {
    expect(SQL).toContain('jsonb_array_length(v_old_punches) % 2 = 0');
    expect(SQL).toContain('FROM public.v_pending_time_records v');
    expect(SQL).toContain('v.time_record_id = p_time_record_id');
    expect(SQL).toContain('Este dia já possui pares completos de batidas; não há pendência para complementar.');
    expect(SQL).toContain('chr(34)');
  });

  it('preserva RH, folha fechada e duplicata de horário', () => {
    expect(SQL).toContain("user_has_any_role(ARRAY['admin', 'gerente', 'rh'])");
    expect(SQL).toContain('A folha desta data já foi fechada');
    expect(SQL).toContain('A batida % já existe neste dia.');
  });
});
