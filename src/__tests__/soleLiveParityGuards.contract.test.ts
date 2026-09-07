import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards de solado precisam ler o CORPO VIVO no banco — não só o arquivo .sql.
 * 18000 criou run_sole_live_parity_guards(); 19000 reforça size-sem-spec e
 * emissão Forração Palmilha/Palmilha. O contrato trava a DEFINIÇÃO VIGENTE (19000).
 */
const ROOT = resolve(__dirname, '../..');
const MIG = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101019000_sole-live-parity-size-sem-spec.sql'),
  'utf8',
);
const DIAG = readFileSync(resolve(ROOT, 'src/pages/SystemDiagnostics.tsx'), 'utf8');

describe('run_sole_live_parity_guards — contrato da migration', () => {
  it('cria a função e trava o gate bom do débito', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.run_sole_live_parity_guards()');
    expect(MIG).toContain('debit_sole_fallback_ficha_com_variante');
    expect(MIG).toContain('v_variant_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+AND');
    expect(MIG).toContain('v_resolved_product_id[[:space:]]+IS[[:space:]]+NULL');
  });

  it('trava COALESCE no by_grade e proíbe atribuição direta', () => {
    expect(MIG).toContain('bygrade_variante_nao_clobber_solado');
    expect(MIG).toContain('COALESCE(v_variant_sole_pid, v_sole_product_id)');
    expect(MIG).toContain("position('v_sole_product_id := v_variant_sole_pid;' in v_bygrade) = 0");
  });

  it('inclui smoke com variante sem pin e cobertura de spec', () => {
    expect(MIG).toContain('runtime_bygrade_variante_sem_pin_solado');
    expect(MIG).toContain('consistency_cobertura_por_numeracao');
    expect(MIG).toContain('list_sole_spec_gaps');
    expect(MIG).toContain('solado_sem_spec_na_faixa_vendida');
  });

  it('trava restore sem crédito escalar cego', () => {
    expect(MIG).toContain('restore_graded_nao_credita_escalar_cego');
    expect(MIG).toContain('nao credita residuo escalar');
  });

  it('reforça size-sem-spec e emissão Forração Palmilha', () => {
    expect(MIG).toContain('runtime_size_sem_spec_forro_palmilha_zero');
    expect(MIG).toContain('runtime_list_sole_spec_gaps_acionavel');
    expect(MIG).toContain('bygrade_emite_forracao_palmilha_e_palmilha');
    expect(MIG).toContain("''component'', ''Forração Palmilha''");
  });
});

describe('SystemDiagnostics executa os guards vivos', () => {
  it('chama run_sole_live_parity_guards e op_restore_consistency_report', () => {
    expect(DIAG).toContain("rpc('run_sole_live_parity_guards')");
    expect(DIAG).toContain("rpc('op_restore_consistency_report')");
    expect(DIAG).toContain('Guards vivos do solado');
    expect(DIAG).toContain('Pendências de estorno com grade');
  });
});
