import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeProductColorsForGroup } from '@/lib/materialVariantColorGroup';

const FORM = readFileSync(
  resolve(process.cwd(), 'src/components/sale-orders/SaleOrderItemForm.tsx'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MOBILE = readFileSync(
  resolve(process.cwd(), 'src/pages/mobile/MobileNewOrder.tsx'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('PV so oferece cores cadastradas no estoque', () => {
  it('nao cai na paleta livre da ficha (technical_sheets.colors)', () => {
    expect(FORM).not.toMatch(/selectedRef\?\.colors/);
    expect(FORM).not.toMatch(/selectedRef\.colors/);
    expect(FORM).not.toMatch(/\.colors \|\| ''\)\s*\n\s*\.split\(','\)/);
  });

  it('nao usa o CSV legado do grupo nem a cartela colors', () => {
    expect(FORM).not.toMatch(/productGroups[^\n]*\.colors\.split/);
    expect(FORM).not.toMatch(/from\('colors'\)/);
    expect(FORM).not.toContain('useColors()');
  });

  it('a lista de cores do item vem so de products.color ativos do grupo', () => {
    expect(FORM).toContain('activeProductColorsForGroup(allProducts, effectiveGroupId)');
    expect(FORM).toContain('activeProductColorsForGroup(allProducts, mainGroupForNewColor.id)');
    expect(FORM).toMatch(/if \(baseCoveredByVariant\) return \[\];/);
  });

  it('sem grupo efetivo a lista fica vazia — nunca inventa cor', () => {
    const availableBlock = FORM.slice(
      FORM.indexOf('const availableColors'),
      FORM.indexOf('const variantCabedalColor'),
    );
    expect(availableBlock).toMatch(/return \[\];\s*\}, \[item\.material_variant_id/);
    expect(availableBlock).not.toContain('split');
  });

  it('o cadastro de cor nova abre o formulario do estoque, nao seleciona paleta', () => {
    expect(FORM).toContain('Cadastrar "');
    expect(FORM).toContain('no estoque');
    expect(FORM).toContain('ProductFormDialog');
    expect(FORM).toContain("queryKey: ['products_for_colors']");
  });

  it('o PV mobile tambem deriva so do SKU ativo do grupo efetivo', () => {
    expect(MOBILE).toContain('activeProductColorsForGroup(materialProducts, group.id)');
    expect(MOBILE).not.toMatch(/reference\.colors/);
    expect(MOBILE).not.toMatch(/selectedRef\?\.colors/);
  });

  it('activeProductColorsForGroup ignora inativo, outro grupo e cor vazia', () => {
    expect(activeProductColorsForGroup([
      { id: '1', group_id: 'napa', color: ' preto ', active: true },
      { id: '2', group_id: 'napa', color: 'PALETA DA FICHA', active: false },
      { id: '3', group_id: 'napa', color: null, active: true },
      { id: '4', group_id: 'outra', color: 'OURO LIGHT', active: true },
    ], 'napa')).toEqual(['PRETO']);
  });
});
