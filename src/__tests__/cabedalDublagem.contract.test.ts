import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const selector = read('src/components/technical-sheets/sheetSelectors.tsx');
const materialVariants = read('src/components/technical-sheets/MaterialVariantsTab.tsx');
const technicalSheets = read('src/pages/TechnicalSheets.tsx');
const technicalSheetsHook = read('src/hooks/useTechnicalSheets.ts');
const groupColorsTab = read('src/components/groups/GroupColorsTab.tsx');
const groupColorProducts = read('src/lib/groupColorProducts.ts');
const migration = read('supabase/migrations/20270101005400_cabedal_dublagem_groups_and_composition.sql');

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `${startMarker} deve existir`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} deve existir depois de ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Cabedal dublado — contrato frontend e persistência', () => {
  it('oferece somente grupos-folha, com breadcrumb, busca comercial e cores reais', () => {
    expect(selector).toContain('const parentIds = useMemo(');
    expect(selector).toContain('.filter(group => !parentIds.has(group.id))');
    expect(selector).toContain('.filter(group => (groupIndex[group.id]?.count || 0) > 0)');
    expect(selector).toContain('const path = getGroupPath(groups, group.id);');
    expect(selector).toContain("path.map(node => node.name).join(' › ')");
    expect(selector).toContain('<CommandGroup');
    expect(selector).toContain('onSelect={() => chooseGroup(group)}');
    expect(selector).toContain("normalizeForSearch([p.name, p.sku, p.color].filter(Boolean).join(' '))");
    expect(selector).toContain("p.color.split(',').forEach");
    expect(selector).toContain('summary.colors.slice(0, 5).map');
    expect(selector).toContain('selectedSummary.colors.slice(0, 4).map');
    expect(selector).toContain('Escolha um grupo dentro da família');

    const chooseGroup = section(selector, 'const chooseGroup =', '\n\n  return (');
    expect(chooseGroup).toContain('onChange(group.name);');
    expect(chooseGroup).toContain('onGroupSelect?.(group);');

    expect(materialVariants).toContain('const parentGroupIds = useMemo(');
    expect(materialVariants).toContain('.filter(group => !parentGroupIds.has(group.id))');
    expect(materialVariants).toContain('.filter(group => activeProductGroupIds.has(group.id))');
    expect(materialVariants).toContain('const path = getGroupPath(groups, group.id);');
    expect(materialVariants).toContain("path.map(node => node.name).join(' › ')");
  });

  it('trata o consumo do Cabedal como dm²/par e persiste a identidade UUID da folha', () => {
    const materialOne = section(
      technicalSheets,
      'label="Material 1 (Principal)"',
      'Corte a fio (cabedal sem costura)',
    );

    expect(materialOne).toContain('onGroupSelect={(group) => applyUpperMaterialGroup(group.name, group.id)}');
    expect(materialOne).toContain('POR PAR (dm²/par, não por pé)');
    expect(materialOne).toContain("'dm²'");
    expect(materialOne).toContain('área consumida pelo par (2 pés)');
    expect(technicalSheets).toContain('upper_material_group_id: nextGroupId');
    expect(technicalSheets).toContain('payload.upper_material_group_id = upperMaterialGroup.id;');
    expect(technicalSheets).toContain('group.parent_group_id === upperMaterialGroup.id');
    expect(technicalSheetsHook).toContain('upper_material_group_id?: string | null;');
  });

  it('faz a criação de cores da aba do grupo exclusivamente pelo helper protegido', () => {
    expect(groupColorsTab).toContain(
      "import { createGroupColorProducts } from '@/lib/groupColorProducts';",
    );
    const createColors = section(groupColorsTab, 'const criar = async () => {', '\n\n  const fundir = async () => {');
    expect(createColors).toContain('const results = await createGroupColorProducts(');
    expect(createColors).toContain("result.status === 'created'");
    expect(createColors).toContain("result.status === 'error'");
    expect(createColors).toContain("queryKey: ['products_for_colors']");
    expect(createColors).toContain("queryKey: ['product_groups_colors']");
    expect(createColors).not.toContain("supabase.from('products')");
    expect(createColors).not.toContain('.insert(');
  });

  it('cria a primeira cor com unidade de estoque explícita e dimensões do grupo', () => {
    expect(groupColorProducts).toContain(
      ".select('is_artisanal_strap, sector, consumption_unit, dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit')",
    );
    expect(groupColorProducts).toContain("const explicitStockUnit = String(spec.stockUnit || '').trim();");
    expect(groupColorProducts).toContain('if (!last && !explicitStockUnit)');
    expect(groupColorProducts).toContain('Informe a unidade de estoque da primeira cor');
    expect(groupColorProducts).toContain('const defaultUnit = String(last?.unit || explicitStockUnit).trim();');
    expect(groupColorsTab).toContain('stockUnit: products.length === 0 ? firstStockUnit : undefined');
    expect(groupColorsTab).toContain('Unidade de estoque da primeira cor');
    expect(groupColorProducts).toContain('const purchaseUnit = last?.purchase_unit || defaultUnit;');
    expect(groupColorProducts).toContain('const productionUnit = last?.production_unit || defaultUnit;');
    expect(groupColorProducts).toContain('const purchaseOrderUnit = last?.purchase_order_unit || defaultUnit;');
    expect(groupColorProducts).toContain('const consumptionUnit = last?.consumption_unit || defaultUnit;');

    const productData = section(
      groupColorProducts,
      'const productData = sanitizeUuidFields({',
      '\n\n  let { error }',
    );
    expect(productData).toContain("category: (last?.category || group?.sector || '').trim()");
    expect(productData).toContain('unit: defaultUnit');
    expect(productData).toContain('purchase_unit: purchaseUnit');
    expect(productData).toContain('production_unit: productionUnit');
    expect(productData).toContain('purchase_order_unit: purchaseOrderUnit');
    expect(productData).toContain('consumption_unit: consumptionUnit');
    expect(productData).toContain("conversion_rate: Number(last?.conversion_rate) > 0 ? Number(last?.conversion_rate) : 1");
    expect(productData).toContain('dimensions_length: last?.dimensions_length ?? group?.dimensions_length ?? null');
    expect(productData).toContain('dimensions_width: last?.dimensions_width ?? group?.dimensions_width ?? null');
    expect(productData).toContain('dimensions_thickness: last?.dimensions_thickness ?? group?.dimensions_thickness ?? null');
    expect(productData).toContain('dimensions_unit: last?.dimensions_unit ?? group?.dimensions_unit ?? null');

    expect(groupColorProducts).toContain("error: 'Família de tira artesanal só pode ser criada pelo Hub de Tiras.'");
    expect(groupColorProducts).toContain("(p.color || '').trim().toLowerCase() === color.toLowerCase()");
    expect(groupColorProducts).toContain("(error as any).code === '23505'");
  });

  it('a migration 05400 tipa o Cabedal, modela DUBLAGEM em folhas e trava unidades/dimensões', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.technical_sheets[\s\S]*ADD COLUMN IF NOT EXISTS upper_material_group_id uuid/,
    );
    expect(migration).toContain('technical_sheets_upper_material_group_id_fkey');
    expect(migration).toContain('Selecione um grupo-folha de cabedal; % é uma família.');
    expect(migration).toContain("'DUBLAGEM'");
    expect(migration).toContain("'DUBLAGEM DIVERSOS'");
    expect(migration).toContain("'NAPA SOFT COM PU 600'");
    expect(migration).toContain("'NAPA SOFT COM CACHARREL/EVA'");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.product_group_layers');
    expect(migration).toContain('CHECK (composite_group_id <> component_group_id)');
    expect(migration).toContain('Não participa de consumo, reserva, custo ou débito de estoque.');
    expect(migration).toContain('NAPA SOFT COM PU 600 exige NAPA SOFT + PU 600.');
    expect(migration).toContain("'group-leaf-reference:' || NEW.parent_group_id::text");
    expect(migration).toContain('Os itens ainda chamados apenas "DUBLAGEM" permanecem em DIVERSOS.');
    expect(migration).not.toMatch(/SET group_id = v_soft_pu600_id,[\s\S]{0,200}lower\(btrim\(p\.name\)\) = 'dublagem'/);
    expect(migration).toContain("p.unit IS DISTINCT FROM 'm'");
    expect(migration).toContain("p.consumption_unit IS DISTINCT FROM 'm'");
    expect(migration).toContain('p.conversion_rate IS DISTINCT FROM 1');
    expect(migration).toContain('cs.dimensions_width IS DISTINCT FROM 1370');
    expect(migration).toContain("cs.dimensions_unit IS DISTINCT FROM 'mm'");
  });
});
