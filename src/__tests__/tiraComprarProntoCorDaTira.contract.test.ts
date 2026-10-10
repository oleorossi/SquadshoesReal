import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Q37: tira "Comprar pronto" com cor escolhida na tira (cores combinadas)
 * usa a cor DA TIRA; as demais seguem a Cor Principal.
 */
describe('tira comprar pronto aceita cor da tira (20270101033000)', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20270101033000_tira-comprar-pronto-cor-da-tira.sql'),
    'utf8',
  );
  const base = readFileSync(
    join(process.cwd(), 'supabase/migrations/20270101031900_pv-sku-acabado-buy-ready-sem-variante.sql'),
    'utf8',
  );

  it('o trecho do writer que forçava a Cor Principal existe na 31900', () => {
    expect(base).toContain("      v_color_mode := 'follow_main';\n      v_line_color_id := v_color_id;\n      v_line_color_name := v_color_name;");
  });

  it('só libera a cor da tira quando color_mode = select_on_order, e exige cor ativa', () => {
    expect(sql).toContain("= 'select_on_order'");
    expect(sql).toContain('c.active');
    expect(sql).toContain("<> 'select_on_order'");
  });

  it('é idempotente e falha alto se o corpo mudou', () => {
    expect(sql).toContain("position('strap_pv_sku_acabado_cor_da_tira_20270101033000' IN v_def) = 0");
    expect(sql).toContain('revise 33000');
  });
});
