import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20261231122200_melhorar-lancamento-ficha-montadores.sql'),
  'utf8',
);
const PAGE = readFileSync(resolve(ROOT, 'src/pages/FichaMontadoresPage.tsx'), 'utf8');

describe('contrato do lançamento da Ficha de Montadores', () => {
  it('separa a chamada por dia, pessoa e setor', () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX ficha_montadores_chamada_dia_montador_setor_uniq\s+ON public\.ficha_montadores \(dia, montador_id, setor\)/,
    );
  });

  it('protege o lifecycle da folha também contra escrita REST direta', () => {
    expect(SQL).toContain('pg_trigger_depth() <= 1');
    expect(SQL).toMatch(
      /CREATE TRIGGER trg_ficha_montadores_lock_closed\s+BEFORE INSERT OR UPDATE OR DELETE/,
    );
    expect(SQL).toContain("to_jsonb(NEW) - ARRAY['payroll_run_id', 'pago_em']");
  });

  it('serializa ficha, escrita direta e aprovação com o mesmo mutex', () => {
    const locks = SQL.match(/pg_advisory_xact_lock/g) ?? [];
    expect(locks.length).toBeGreaterThanOrEqual(3);
    expect(SQL).toContain("'ficha_montadores|' || NEW.employee_id::text");
    expect(SQL).toContain("'ficha_montadores|' || v_lock_id::text");
    expect(SQL).toContain("r.status IN ('aprovado', 'pago')");
  });

  it('recusa last-write-wins e mantém o frontend no mesmo contrato', () => {
    expect(SQL).toContain("v_item->>'expected_id'");
    expect(SQL).toContain("v_item->>'expected_atualizado_em'");
    expect(SQL).toContain("ERRCODE = 'serialization_failure'");
    expect(PAGE).toContain('expected_id: existing?.id ?? null');
    expect(PAGE).toContain('expected_atualizado_em: existing?.atualizado_em ?? null');
  });

  it('congela a taxa por categoria e valida depois de capturar o snapshot', () => {
    expect(SQL).toContain('v_existing_medio <= 0 AND v_total_medio > 0');
    expect(SQL).toContain('v_existing_dificil <= 0 AND v_total_dificil > 0');
    expect('trg_ficha_montadores_rate_snapshot' < 'trg_ficha_montadores_require_rate').toBe(true);
    expect(SQL).toContain('CREATE TRIGGER trg_ficha_montadores_rate_snapshot');
    expect(SQL).toContain('CREATE TRIGGER trg_ficha_montadores_require_rate');
  });

  it('mantém a RPC como invoker e fora do alcance anônimo', () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.save_ficha_montadores_batch[\s\S]*?SECURITY INVOKER/,
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION public.save_ficha_montadores_batch(text, jsonb) FROM anon',
    );
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.save_ficha_montadores_batch(text, jsonb) TO authenticated',
    );
  });
});
