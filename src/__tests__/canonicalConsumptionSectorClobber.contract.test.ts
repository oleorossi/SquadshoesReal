import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato — setor do relatório não clobba component/source', () => {
  const migration = read(
    'supabase/migrations/20270101016800_consumo-canonico-setor-sem-clobber-component.sql',
  );
  const regressao = read(
    'supabase/migrations/20270101015500_preservar_snapshot_historico_e_setor_consumo.sql',
  );

  it('a mig 15500 tinha o RETURN v_context cru que clobbava a linha', () => {
    expect(regressao).toContain('RETURN v_context;');
    expect(regressao).toContain(
      'line.value || private.resolve_report_consumption_sector_context(',
    );
  });

  it('a mig 16800 marca e remove o clobber de component/source', () => {
    expect(migration).toContain('sector_keys_only_20270101016800');
    expect(migration).toContain('sector_merge_keys_only_20270101016800');
    expect(migration).toContain('Antes: RETURN v_context');
    expect(migration).not.toMatch(/^\s*RETURN v_context;/m);
    // Merge aplica só chaves de setor (não `line || resolve(...)` cru).
    expect(migration).toContain("'consumption_sector', sector.ctx -> 'consumption_sector'");
    expect(migration).toContain("sector.ctx -> 'consumption_sector_source'");
    expect(migration).toMatch(
      /Preflight: batch ainda faz merge cru do contexto de setor/,
    );
  });

  it('o schema TS usa discriminatedUnion e defaults que aceitam null do SQL', () => {
    const source = read('src/lib/canonicalConsumptionReport.ts');
    expect(source).toContain("z.discriminatedUnion('line_kind'");
    expect(source).toContain('finiteNonNegativeOrDefault');
    expect(source).toContain('booleanOrDefault');
    expect(source).toContain('flattenZodIssues');
    expect(source).toContain('coerceCanonicalReport');
  });
});
