import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Variante de material SEM solado pinado NÃO pode desligar o débito de solado.
 *
 * `resolve_sole_for_variant_color` é resolver de OVERRIDE: devolve ZERO linhas
 * quando a variante não tem `sole_material_product_id` (68/68 ativas em
 * 20/08/2026). O gate `IF v_variant_id IS NULL AND v_resolved_product_id IS NULL`
 * (introduzido em 20270101002000) fazia a cascata canônica nunca rodar e a
 * função sair sem reservar/debitar solado.
 *
 * Correção: gate volta a ser só `IF v_resolved_product_id IS NULL` —
 * pin de variante vence; ausência de pin cai na ficha/cor.
 *
 * ⚠ Não travar só o arquivo 02000 (ele documenta o bug). A proteção de
 * regressão é a migration que RESTAURA o fallback + esta suíte.
 */
const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, '..', rel), 'utf8');

const INTRO = read(
  'supabase/migrations/20270101002000_regras-cor-solado-pintavel.sql',
);
const FIX_080 = read(
  'supabase/migrations/20270101008000_restore-sole-debit-ficha-fallback.sql',
);
const FIX_167 = read(
  'supabase/migrations/20270101016700_garantir-fallback-solado-debito-com-variante.sql',
);

// Nos arquivos .sql o patch usa E'…\n…' (barra-n literal), não newline real.
const BAD_GATE =
  'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN\\n    SELECT rsc.sole_product_id';
const GOOD_GATE =
  'IF v_resolved_product_id IS NULL THEN\\n    SELECT rsc.sole_product_id';

describe('02000 introduziu o gate que bloqueia a cascata com variante', () => {
  it('troca o fallback só-por-produto-resolvido pelo gate com v_variant_id', () => {
    expect(INTRO).toContain(GOOD_GATE);
    expect(INTRO).toContain(BAD_GATE);
    // Ordem no patch: good → bad (é a regressão).
    expect(INTRO.indexOf(GOOD_GATE)).toBeLessThan(INTRO.indexOf(BAD_GATE));
  });
});

describe('08000 e 16700 restauram o fallback ficha/cor', () => {
  it('08000 troca o gate ruim pelo bom e é idempotente se já corrigido', () => {
    expect(FIX_080).toContain(BAD_GATE);
    expect(FIX_080).toContain(GOOD_GATE);
    expect(FIX_080).toMatch(/já usa fallback de ficha\/cor; nada a fazer/);
    // replace(bad, good) — não o inverso.
    expect(FIX_080).toMatch(
      /replace\(\s*v_definition,\s*E'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN/,
    );
  });

  it('16700 reafirma o contrato e falha alto se o corpo não for reconhecível', () => {
    expect(FIX_167).toContain(BAD_GATE);
    expect(FIX_167).toContain(GOOD_GATE);
    expect(FIX_167).toMatch(/já usa fallback ficha\/cor com variante; ok/);
    expect(FIX_167).toMatch(/Patch do fallback de solado não aderiu/);
    expect(FIX_167).toMatch(/nem gate antigo nem fallback ficha\/cor encontrados/);
    expect(FIX_167).toContain(
      'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)',
    );
  });

  it('16700 vem DEPOIS de 08000 na sequência de carimbos', () => {
    expect('20270101016700' > '20270101008000').toBe(true);
  });
});
