import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const drawer = read('src/components/sale-orders/StrapCatalogResolutionDrawer.tsx');
const itemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const formPanel = read('src/components/sale-orders/SaleOrderFormPanel.tsx');
const hooks = read('src/hooks/useArtisanalStraps.ts');
const migration = read(
  'supabase/migrations/20270101006200_strass_buy_ready_without_reference_base.sql',
);

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} deve existir na migration`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `marcador inicial ausente: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `marcador final ausente: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('STRASS comprada pronta — correção de contexto sem napa-base', () => {
  it('deriva no drawer quando a referência realmente exige napa e envia NULL para compra pronta', () => {
    expect(drawer).toContain('identity_basis?:');
    expect(drawer).toContain('identity_group_id?:');
    expect(drawer).toMatch(
      /const requiresReferenceBase\s*=\s*useMemo\([\s\S]*?lines\.(?:some|every)\(/,
    );
    expect(drawer).toMatch(
      /lines\.some\(\(line\)\s*=>\s*strapIdentityBasis\(line\)\s*===\s*'reference_base'\s*\)/,
    );
    expect(drawer).toMatch(
      /requiresReferenceBase\s*\?\s*\([\s\S]*?Napa-base da referência/,
    );
    expect(drawer).toMatch(
      /if \(requiresReferenceBase\s*&&\s*\(!isUuid\(baseGroupId\)/,
    );
    expect(drawer).toContain(
      'p_base_group_id: requiresReferenceBase ? baseGroupId : null',
    );
  });

  it('explica a compra pronta sem napa e leva o cadastro comercial incompleto ao catálogo', () => {
    expect(drawer).toContain('Compra pronta');
    expect(drawer).toMatch(/n[aã]o usa(?:m)? napa-base/i);
    expect(drawer).toMatch(/SKU acabado[\s\S]*cor escolhida/i);
    expect(drawer).toContain('Grupo acabado ausente');
    expect(drawer).toContain('/fichas-tecnicas?ref=${encodeURIComponent(referenceId)}&tab=range-aviamento');
    expect(drawer).toContain('missingFinishedGroupLines.length > 0');

    expect(itemForm).toMatch(
      /const buyReadyCatalogIncomplete = usesFinishedGroup[\s\S]*!resolvedLine\.strapVariantId \|\| !resolvedLine\.canBuyReady/,
    );
    expect(itemForm).toContain('Cadastro da compra pronta incompleto');
    expect(itemForm).toContain('Revisar variante no Hub de Tiras');
    expect(itemForm).toContain('Abrir diagnóstico no Hub de Tiras');
    const ctaSetup = sourceSection(
      itemForm,
      'const buyReadyCatalogIncomplete = usesFinishedGroup',
      'return (',
    );
    expect(ctaSetup).toContain('/tiras-artesanais?tab=diagnostico');
    expect(ctaSetup).toContain('const hasBuyReadyVariant = isUuid(resolvedLine?.strapVariantId)');
    expect(ctaSetup).toContain('mode=review');
    expect(ctaSetup).toContain('variantId=${encodeURIComponent(resolvedLine.strapVariantId)}');
    expect(ctaSetup).not.toContain('mode=create');
    expect(ctaSetup).not.toContain("mode: 'create'");
    expect(itemForm).toContain('strapCatalog?.capabilities.manage_strap_catalog === true');
    expect(itemForm).toContain('Solicite ao administrador completar o cadastro comercial.');
  });

  it('tipa explicitamente a ausência de base no contrato do hook', () => {
    expect(hooks).toMatch(/p_base_group_id:\s*string\s*\|\s*null;/);
  });

  it('faz o servidor derivar a necessidade de base das linhas bloqueadas da ficha', () => {
    const rpc = sqlFunction('resolve_technical_strap_context_from_sale_order');

    expect(rpc).toContain('v_requires_reference_base');
    expect(rpc).toMatch(
      /jsonb_array_elements\(v_lines\)[\s\S]*identity_basis[\s\S]*reference_base/,
    );
    expect(rpc).toMatch(
      /IF v_requires_reference_base THEN[\s\S]*p_base_group_id IS NULL/,
    );
    expect(rpc).toMatch(
      /IF v_requires_reference_base THEN[\s\S]*v_effective_base_group_id\s*:=\s*p_base_group_id;[\s\S]*ELSE[\s\S]*v_effective_base_group_id\s*:=\s*NULL;/,
    );
    expect(rpc).toContain('SET strap_base_group_id = v_effective_base_group_id');
    expect(rpc).toContain("'requires_reference_base', v_requires_reference_base");
    expect(rpc).toContain("'requested_base_ignored'");
  });

  it('limpa a base indevida somente em fichas não vazias compostas por grupos acabados', () => {
    expect(migration).toMatch(
      /UPDATE public\.technical_sheets(?:\s+AS)?\s+ts[\s\S]*SET strap_base_group_id\s*=\s*NULL/,
    );
    expect(migration).toMatch(/jsonb_typeof\(ts\.strap_colors\)\s*=\s*'array'/);
    expect(migration).toMatch(
      /jsonb_array_length\([\s\S]{0,180}ts\.strap_colors[\s\S]{0,180}\)\s*>\s*0/,
    );
    expect(migration).toMatch(
      /NOT EXISTS \([\s\S]*jsonb_array_elements\([\s\S]{0,220}ts\.strap_colors[\s\S]{0,220}\)[\s\S]*identity_basis[\s\S]*IS DISTINCT FROM 'finished_product_group'/,
    );
  });

  it('não grava diretamente variante, preço ou fatos operacionais no writer estrutural', () => {
    const structuralRpc = sqlFunction('resolve_technical_strap_context_from_sale_order');

    expect(structuralRpc).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.artisanal_strap_variants\b/i,
    );
    expect(structuralRpc).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.products\b/i,
    );
    expect(structuralRpc).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:purchase_orders|purchase_order_items|purchase_requisitions|supplier_materials)\b/i,
    );
    expect(structuralRpc).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:sale_order_items|orders)\b/i,
    );
    expect(structuralRpc).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:material_reservations|stock_movements|sale_order_strap_demands)\b/i,
    );
    expect(migration).toContain('DISABLE TRIGGER trg_mark_so_costs_dirty_from_sheet');
    expect(migration).toContain('ENABLE TRIGGER trg_mark_so_costs_dirty_from_sheet');
  });

  it('sincroniza item novo por UUID e usa o ordinal só para cor legada', () => {
    expect(itemForm).toContain('const straps = referenceStrapDefinitions');
    expect(itemForm).toContain('lines={referenceStrapDefinitions}');
    expect(itemForm).toContain('const currentByLineId = new Map(');
    expect(itemForm).toContain('strapColors.map((resolved, ordinal) => ({');
    expect(itemForm).toContain('const currentById = lineId ? currentByLineId.get(lineId) : null');
    expect(itemForm).toContain('const ordinalLegacy = currentStraps[ordinal]');
    expect(itemForm).toContain(
      '|| (!technicalStrapLineId(ordinalLegacy) ? ordinalLegacy : null)',
    );
    expect(itemForm).toMatch(
      /\.\.\.resolved,[\s\S]*color:\s*current\?\.color\s*\|\|\s*''[\s\S]*color_id:\s*isUuid\(current\?\.color_id\)\s*\?\s*current\.color_id\s*:\s*null/,
    );
    expect(itemForm).toContain("onUpdate(index, 'strap_colors', resolvedWithItemColors)");
  });

  it('mantém snapshot persistido imutável e usa a ficha atual somente na apresentação', () => {
    expect(itemForm).toContain('const strapPresentationDefinitions = useMemo(() => {');
    expect(itemForm).toContain('strapColors: strapPresentationDefinitions');
    expect(itemForm).toContain('const straps = strapPresentationDefinitions');
    expect(itemForm).toContain('const preserveCommittedStrapSnapshot = !!item.id');
    expect(itemForm).toContain("saleOrderStatus === 'Aprovado' || saleOrderStatus === 'Em Produção'");
    expect(formPanel).toContain('saleOrderStatus={form.status}');
    expect(itemForm).toContain('const persistedLegacySnapshot = preserveCommittedStrapSnapshot');
    expect(itemForm).toContain("strap.color || 'Cor histórica não informada'");
    expect(itemForm).toContain('histórico');
    expect(itemForm).toContain('Snapshot histórico preservado:');
    expect(itemForm).toContain('Este pedido já está comprometido. Corrija a ficha para os próximos pedidos');
    expect(itemForm).toContain('Abrir ficha técnica');
    expect(hooks).toContain('Snapshots de pedidos já comprometidos foram preservados.');
    expect(itemForm).toMatch(
      /Auto-select the only available material group[\s\S]*?useEffect\(\(\) => \{[\s\S]*?if \(preserveCommittedStrapSnapshot\) return;/,
    );
    expect(itemForm).toMatch(
      /Auto-preenche a Cor Principal[\s\S]*?useEffect\(\(\) => \{[\s\S]*?if \(preserveCommittedStrapSnapshot && hasStrapsEffective\) return;/,
    );

    expect(itemForm).toMatch(
      /onResolved=\{\(strapColors\) => \{[\s\S]*?if \(preserveCommittedStrapSnapshot\) \{[\s\S]*?invalidateResolvedStrapCaches\(\);[\s\S]*?return;[\s\S]*?const currentStraps/,
    );
    expect(itemForm).toMatch(
      /if \(preserveCommittedStrapSnapshot && !mainColorChanged\) \{[\s\S]*?return;/,
    );
  });
});
