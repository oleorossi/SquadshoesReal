import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStrapBaseReadout, EMPTY_VARIANT_CASCADE } from '@/lib/materialVariantColorGroup';

const ROOT = resolve(__dirname, '../..');
const TAB = readFileSync(resolve(ROOT, 'src/components/technical-sheets/MaterialVariantsTab.tsx'), 'utf8');
const SHEETS = readFileSync(resolve(ROOT, 'src/pages/TechnicalSheets.tsx'), 'utf8');
const PV = readFileSync(resolve(ROOT, 'src/components/sale-orders/SaleOrderItemForm.tsx'), 'utf8');

/**
 * Regressões do PR #146, todas pegas na revisão adversarial de 21/08/2026.
 */
describe('A trava da ficha só é gravada quando a tela mostrou a decisão', () => {
  it('cascadeDirty exige o mesmo gate que renderiza o bloco', () => {
    // O bloco de checkboxes vive sob `formData.main_material_group_id`; sem o
    // mesmo gate na gravação, variante salva só com exceção por componente
    // escrevia variant_drives_* que o usuário nunca viu.
    expect(TAB).toContain('const cascadeEditable = !!formData.main_material_group_id;');
    expect(TAB).toMatch(/const cascadeDirty = cascadeEditable && !!sheetMaterials/);
  });

  it('grava as TRÊS travas — fachete deixou de ficar de fora', () => {
    const persist = TAB.slice(TAB.indexOf('const persistCascade'));
    for (const campo of ['variant_drives_upper', 'variant_drives_lining', 'variant_drives_fachete']) {
      expect(persist.slice(0, 900)).toContain(`${campo}: cascade.`);
    }
  });
});

describe('Um único lugar edita variant_drives_*', () => {
  it('a aba Materiais não tem mais checkbox das travas', () => {
    // Só pode restar leitura. `updateField('variant_drives_...')` é o editor.
    expect(SHEETS).not.toMatch(/updateField\(\s*'variant_drives_/);
  });

  it('a aba Materiais aponta para onde a decisão é tomada', () => {
    expect(SHEETS).toContain('Componentes que seguem esta variante');
  });
});

describe('O aviso do PV não acusa no-op falso', () => {
  it('variante que troca só a palmilha deixa de cair no aviso', () => {
    // resolveMaterialVariantColorGroup só olha cabedal/forração, então
    // mainGroupForNewColor sozinho não prova no-op.
    expect(PV).toContain('!hasVariantComponentPin(selectedMaterialVariant)');
  });
});

describe('resolveStrapBaseReadout espelha resolve_strap_base_group_id', () => {
  const sheet = {
    upper_material: '', lining_material: 'NAPA SOFT',
    upper_material_group_id: null, strap_base_group_id: null,
    lining_material_group_id: 'g-soft',
  };

  it('em modelo de tiras, a base segue o forro da variante', () => {
    expect(resolveStrapBaseReadout({
      variant: { lining_material_group_id: 'g-glow' },
      sheet,
      cascade: EMPTY_VARIANT_CASCADE,
    })).toMatchObject({ groupId: 'g-glow', origin: 'variant_lining', divergesFromLining: false });
  });

  it('cai no material principal quando a variante não pina slot', () => {
    expect(resolveStrapBaseReadout({
      variant: { main_material_group_id: 'g-glow' },
      sheet,
      cascade: { ...EMPTY_VARIANT_CASCADE, lining: true },
    })).toMatchObject({ groupId: 'g-glow', origin: 'variant_main', divergesFromLining: false });
  });

  // ⚠ O resolver da tira NÃO checa variant_drives_*; o do forro checa. Com a
  // trava da Forração desmarcada, o modelo sai com DUAS napas.
  it('acusa divergência quando a Forração não segue a variante mas a tira segue', () => {
    expect(resolveStrapBaseReadout({
      variant: { main_material_group_id: 'g-glow' },
      sheet,
      cascade: EMPTY_VARIANT_CASCADE,
    })).toMatchObject({ groupId: 'g-glow', origin: 'variant_main', divergesFromLining: true });
  });

  it('honra a base de tira explícita da ficha antes do forro', () => {
    expect(resolveStrapBaseReadout({
      variant: {},
      sheet: { ...sheet, strap_base_group_id: 'g-base' },
      cascade: EMPTY_VARIANT_CASCADE,
    })).toMatchObject({ groupId: 'g-base', origin: 'sheet' });
  });

  it('sem nenhuma fonte, devolve null em vez de inventar grupo', () => {
    expect(resolveStrapBaseReadout({
      variant: {},
      sheet: { upper_material: '', lining_material: '' },
      cascade: EMPTY_VARIANT_CASCADE,
    })).toBeNull();
  });
});
