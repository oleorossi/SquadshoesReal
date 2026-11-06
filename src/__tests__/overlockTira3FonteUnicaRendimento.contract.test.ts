import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findDuplicateTechnicalStrapLabel } from '@/lib/technicalStrapLines';

const read = (path: string) => readFileSync(path, 'utf8');
const MIGRATION = read(
  'supabase/migrations/20270101045800_overlock-tira3-fonte-unica-rendimento.sql',
);
const sheetPage = read('src/pages/TechnicalSheets.tsx');
const strapLines = read('src/lib/technicalStrapLines.ts');

describe('overlock TIRA3 fonte única rendimento (458)', () => {
  it('enrich bloqueia sem yield de grupo e não cai na receita', () => {
    expect(MIGRATION).toContain('group_yield_missing');
    expect(MIGRATION).toContain('strap_group_napa_yields');
    expect(MIGRATION).toContain("v_yield := NULL;");
    expect(MIGRATION).toContain('nunca seedar yield da receita');
    // Guard reescreve se o fallback voltar — a string aparece só nessa trava.
    expect(MIGRATION).toMatch(/position\('recipe_yield_fallback' IN v_def\) > 0/);
    expect(MIGRATION).toContain('enrich_consumo_strap_preview_recipe_yield');
  });

  it('sempre_fabrica normaliza grupo/mapa e força fabrica', () => {
    expect(MIGRATION).toContain('normalize_strap_line_sempre_fabrica');
    expect(MIGRATION).toContain("origem_padrao = 'sempre_fabrica'");
    expect(MIGRATION).toContain("'pv_origem', 'fabrica'");
  });

  it('ficha: label único + SP130 canônica 48/120 + writer com group_id', () => {
    expect(MIGRATION).toContain('trg_validate_technical_sheet_strap_colors');
    expect(MIGRATION).toContain('label de tira duplicado');
    expect(MIGRATION).toContain("code = 'SP130'");
    expect(MIGRATION).toMatch(/'consumption',\s*48/);
    expect(MIGRATION).toMatch(/'consumption',\s*120/);
    expect(MIGRATION).toContain('TIRA OVERLOCK 5MM');
    expect(MIGRATION).toContain('group_id, strap_base_group_id');
    expect(MIGRATION).toContain('tg_require_strap_product_group_id');
    expect(MIGRATION).toContain('enqueue_sale_order_strap_demands');
  });

  it('UI: save da ficha bane label duplicado (Q18)', () => {
    expect(strapLines).toContain('findDuplicateTechnicalStrapLabel');
    expect(sheetPage).toContain('findDuplicateTechnicalStrapLabel');
    expect(sheetPage).toContain('Label de tira duplicado');
  });

  it('helper detecta label duplicado case-insensitive', () => {
    expect(
      findDuplicateTechnicalStrapLabel([
        { label: 'TIRA 3' },
        { label: 'tira 3' },
      ]),
    ).toBe('TIRA 3');
    expect(
      findDuplicateTechnicalStrapLabel([
        { label: 'TIRA 1' },
        { label: 'TIRA 2' },
      ]),
    ).toBeNull();
  });
});
