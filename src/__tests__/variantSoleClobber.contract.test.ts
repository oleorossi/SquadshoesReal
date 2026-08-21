import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Escolher variante de material NÃO pode apagar o solado do consumo.
 *
 * `resolve_sole_for_variant_color` é resolver de OVERRIDE: devolve ZERO linhas
 * quando a variante não tem `sole_material_product_id` (todas as 68 ativas em
 * 20/08/2026). Em plpgsql, `SELECT INTO` sem linhas grava NULL — então a
 * atribuição direta jogava fora o solado que `resolve_sole_color` já havia
 * resolvido. Efeito medido em SR02 + GLOW METALIC, 36 pares:
 *   sem variante → Solado '01', primary_sole, required 36, debit hard
 *   com variante → unresolved, required 0
 * e, de quebra, `v_suppress_cabedal_lining` / `v_is_fachetado` /
 * `v_is_palmilha_pronta` (que leem do solado) paravam de funcionar — a linha
 * fantasma "Forração" voltava a contar a MESMA napa 2× (bug PV-00146).
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATION_PATH =
  'supabase/migrations/20270101006600_variante-nao-apaga-o-solado-do-consumo.sql';
const migration = readFileSync(resolve(ROOT, MIGRATION_PATH), 'utf8');

describe('Variante de material não apaga o solado', () => {
  it('substitui a atribuição direta por COALESCE (pin VENCE, ausência não APAGA)', () => {
    expect(migration).toContain("v_target := 'v_sole_product_id := v_variant_sole_pid;';");
    expect(migration).toContain(
      "'v_sole_product_id := COALESCE(v_variant_sole_pid, v_sole_product_id);'",
    );
  });

  it('falha ALTO se a âncora sumir — patch nunca pode virar no-op silencioso', () => {
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toMatch(/IF position\(v_target IN v_src\) = 0 THEN\s*\n\s*RAISE EXCEPTION/);
    expect(migration).toMatch(/IF v_new = v_src THEN\s*\n\s*RAISE EXCEPTION/);
  });

  it('prova o conserto sobre dado real antes de commitar a transação', () => {
    // A migration roda dentro de BEGIN/COMMIT e compara a linha de Solado
    // com e sem variante — se o clobber sobreviver, ela aborta inteira.
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain('Variante ainda apaga o solado');
    expect(migration).toContain("e->>'component' = 'Solado'");
  });
});

describe('Backfill da cascata é determinístico', () => {
  it('só liga a trava quando existe UM único componente possível (XOR)', () => {
    // Ficha com cabedal E forração fica de fora: ali a escolha é do dono, e é
    // ela que protege material de IDENTIDADE (PALHA do cabedal do DS21/DS19).
    expect(migration).toContain(
      '((n.upper_material IS NOT NULL) <> (n.lining_material IS NOT NULL))',
    );
  });

  it('só alcança ficha cujas TRÊS travas estão desligadas (idempotente)', () => {
    expect(migration).toContain('NOT COALESCE(ts.variant_drives_upper, false)');
    expect(migration).toContain('NOT COALESCE(ts.variant_drives_lining, false)');
    expect(migration).toContain('NOT COALESCE(ts.variant_drives_fachete, false)');
  });

  it('nunca toca variante que já pina um componente', () => {
    for (const col of [
      'v.upper_material_product_id  IS NULL',
      'v.upper_material_group_id  IS NULL',
      'v.lining_material_product_id IS NULL',
      'v.lining_material_group_id IS NULL',
      'v.insole_material_product_id IS NULL',
      'v.insole_material_group_id IS NULL',
    ]) expect(migration).toContain(col);
  });
});

describe('Relatório de consistência ganha o alarme do no-op', () => {
  it('registra o check com a mesma condição do backfill', () => {
    expect(migration).toContain('variante_nao_dirige_componente');
    expect(migration).toContain("''alto''::text");
  });

  it('é idempotente — não duplica o check em re-execução', () => {
    expect(migration).toContain("IF position('variante_nao_dirige_componente' IN v_src) > 0 THEN");
  });
});
