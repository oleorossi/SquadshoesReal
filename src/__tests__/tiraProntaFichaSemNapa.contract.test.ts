import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read('supabase/migrations/20270101063000_tira_pronta_ficha_sem_napa.sql');
const policy = read('src/lib/technicalStrapSourcePolicy.ts');
const inventory = read('src/lib/strapInventorySelection.ts');
const sheets = read('src/pages/TechnicalSheets.tsx');
const hook = read('src/hooks/useTechnicalSheets.ts');
const editor = read('src/components/technical-sheets/TechnicalStrapSourceEditor.tsx');

describe('Tira pronta na ficha técnica — sem exigir napa-base', () => {
  it('classifica tira pronta por flag do grupo, não pelo nome Strass', () => {
    expect(migration).toContain('tira_pronta_ficha_sem_napa_20270101063000');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.is_ready_made_strap_group(p_group_id uuid)');
    expect(migration).toContain("g.strap_origin = 'comprar_pronto'");
    expect(migration).toContain('g.strap_uses_napa IS FALSE');
    expect(migration).toContain('is_buy_ready_strass_identity(NULL, p_group_id)');
    expect(inventory).toContain('strap_uses_napa?: boolean | null');
    expect(inventory).toContain("group.strap_origin === 'comprar_pronto' || group.strap_uses_napa === false");
  });

  it('o gatilho da ficha recusa origem artesanal em tira pronta e aceita grupo acabado sem variante Hub', () => {
    expect(migration).toContain('Esta tira é comprada pronta e não usa material base');
    expect(migration).toContain("v_origem = 'sempre_sku_acabado'");
    expect(migration).toContain('public.is_ready_made_strap_group(v_mapped_group)');
    expect(migration).toContain('public.is_ready_made_strap_group(v_group_id)');
    expect(migration).toContain("product.unit = 'm'");
    expect(migration).not.toMatch(
      /IF public\.is_buy_ready_strass_identity\(NULL, v_legacy_group_id\)\s+AND \(\s+v_basis <> 'finished_product_group'/,
    );
  });

  it('Ateliê recusa tira pronta e a política do Hub ignora receita residual em sempre_sku_acabado', () => {
    expect(migration).toContain('_assert_atelier_strap_is_artisanal');
    expect(migration).toContain('não gera OS de Ateliê');
    expect(policy).toContain("measure.origem_padrao === 'sempre_sku_acabado'");
    expect(policy).toContain('? false');
    expect(policy).toContain('groupNorm.includes(typeNorm)');
    expect(inventory).toContain('strapInventoryGroupWidthMm');
  });

  it('a ficha começa com uma tira, remove linhas vazias e explica o bloqueio', () => {
    expect(sheets).toContain("{ label: 'TIRA 1', color: '' }");
    expect(sheets).not.toContain("{ label: 'TIRA 3', color: '' }");
    expect(sheets).toContain('Removemos as linhas de tira vazias');
    expect(sheets).toContain('Tira pronta (ex.: Strass) não usa napa');
    expect(hook).toContain('formatTechnicalSheetStrapSaveError');
    expect(editor).toContain('sem napa e sem OS de Ateliê');
  });
});
