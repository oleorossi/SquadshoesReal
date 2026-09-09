import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101015100_corrigir_readiness_modelos_somente_tiras.sql',
), 'utf8');

describe('SQL — readiness de cabedal em referências com tiras', () => {
  it('substitui a flag legada por tiras, rota viva e sinais estruturais', () => {
    expect(migration).toContain('v_legacy_flag constant text');
    expect(migration).toContain('v_live_base_intent constant text');
    expect(migration).toContain('COALESCE(ts.has_straps, false)');
    expect(migration).toContain('ts.strap_colors');
    expect(migration).toContain('ts.production_sectors');
    expect(migration).toContain("'corte cabedal', 'costura cabedal'");
    expect(migration).toContain('ts.components_accessories');
    expect(migration).toContain("position('requires_cutting_cabedal' IN v_definition) > 0");
  });

  it('trata como consumo apenas mapas por numeração com valor positivo', () => {
    expect(migration).toContain('v_positive_per_size constant text');
    expect(migration).toContain('v_no_positive_per_size constant text');
    expect(migration).toContain("replace(upper_size.value, ',', '.')::numeric > 0");
    expect(migration).toContain("replace(upper_size_missing.value, ',', '.')::numeric > 0");
    expect(migration).toContain('esperava 3 checks de mapa nao vazio');
  });

  it('preserva security_invoker e atualiza a guarda permanente de paridade', () => {
    expect(migration).toContain(
      'ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true)',
    );
    expect(migration).toContain("case_name IN (\n       'cabedal_e_tiras_coexistem_no_pv'");
    expect(migration).toContain("'routing_tiras_preserva_cabedal_real'");
    expect(migration).toContain("'readiness_cabedal_tiras_independentes'");
    expect(migration).toContain(
      'readiness usa tiras, roteiro vivo e sinais estruturais; flag legada nao decide cabedal',
    );
  });

  it('executa regressão viva para somente-tiras e para o cenário misto', () => {
    expect(migration).toContain('DO $live_regression$');
    expect(migration).toContain('Regressao somente-tiras: blockers de cabedal persistem');
    expect(migration).toContain('Regressao cabedal+tiras: cadastro completo ficou bloqueado');
    expect(migration).toContain('audit.missing_upper_material OR audit.missing_upper_consumption');
  });
});
