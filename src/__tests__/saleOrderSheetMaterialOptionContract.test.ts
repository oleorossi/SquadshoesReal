import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveMaterialVariantColorGroup,
  resolveSheetCommercialColorGroup,
} from '@/lib/materialVariantColorGroup';

// ════════════════════════════════════════════════════════════════════════
// Contrato: variante ACRESCENTA opção no PV, não SUBSTITUI o material da ficha.
//
// Regra do dono (21/08/2026). O PV oferecia apenas as variantes cadastradas, e
// `availableColors` devolvia lista VAZIA quando existia variante e nenhuma
// estava selecionada — ou seja, cadastrar uma variante apagava o material da
// própria ficha das opções.
//
// Como o efeito era mudo (lista vazia, não erro), 27 das 30 referências com
// variante contornaram cadastrando uma variante que REPETE o material da ficha.
// As 3 que não contornaram — DS19, DS21 e SR02 — ficaram sem conseguir vender
// no material base. Na SR02 (variante única, GLOW METALIC) ainda havia
// auto-seleção da variante única: o material virava GLOW METALIC sozinho.
// ════════════════════════════════════════════════════════════════════════

const FORM_RAW = readFileSync(
  resolve(process.cwd(), 'src/components/sale-orders/SaleOrderItemForm.tsx'),
  'utf8',
);
// Sem os comentários: o código removido é CITADO num comentário que explica por
// que ele saiu, e a citação faria a asserção de ausência passar por presença.
const FORM = FORM_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PANEL = readFileSync(
  resolve(process.cwd(), 'src/components/sale-orders/SaleOrderFormPanel.tsx'),
  'utf8',
);

const SQL_GUARD = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101007000_material-da-ficha-vale-como-escolha-no-pv.sql'),
  'utf8',
);

const NAPA_SOFT = { id: 'grp-napa-soft', name: 'NAPA SOFT' };
const GLOW = { id: 'grp-glow', name: 'GLOW METALIC' };
const GROUPS = [NAPA_SOFT, GLOW];

// SR02 como está no banco: sem cabedal, forro NAPA SOFT, variante única GLOW
// METALIC apontando só o material principal, com variant_drives_lining ligado.
const SR02_SHEET = {
  upper_material_group_id: null,
  upper_material: '',
  lining_material: 'NAPA SOFT',
  has_straps: true,
  variant_drives_upper: false,
  variant_drives_lining: true,
};
const SR02_VARIANT = {
  upper_material_product_id: null,
  upper_material_group_id: null,
  lining_material_product_id: null,
  lining_material_group_id: null,
  main_material_group_id: GLOW.id,
};

describe('material da ficha como opção no PV', () => {
  it('a família da ficha da SR02 é NAPA SOFT', () => {
    expect(resolveSheetCommercialColorGroup({ sheet: SR02_SHEET, groups: GROUPS })).toEqual(NAPA_SOFT);
  });

  it('a variante GLOW METALIC resolve para GLOW — logo NÃO cobre a base', () => {
    const grupoDaVariante = resolveMaterialVariantColorGroup({
      variant: SR02_VARIANT, sheet: SR02_SHEET, products: [], groups: GROUPS,
    });
    expect(grupoDaVariante).toEqual(GLOW);
    // É esta diferença que faz a opção "da ficha" aparecer na SR02.
    expect(grupoDaVariante?.id).not.toBe(NAPA_SOFT.id);
  });

  it('variante que repete o material da ficha COBRE a base (as 27 do contorno)', () => {
    const variantePadrao = { ...SR02_VARIANT, main_material_group_id: NAPA_SOFT.id };
    const grupo = resolveMaterialVariantColorGroup({
      variant: variantePadrao, sheet: SR02_SHEET, products: [], groups: GROUPS,
    });
    // Coberta ⇒ a opção "da ficha" NÃO deve ser oferecida, senão o seletor
    // mostra duas entradas idênticas e uma delas perde o SKU/NCM da variante.
    expect(grupo).toEqual(NAPA_SOFT);
  });

  it('a lista de cores não é mais esvaziada só por existir variante', () => {
    expect(FORM).not.toMatch(/if \(activeMaterialVariants\.length > 0\) return \[\];/);
    // Só quando a base já é vendável por uma variante é que a escolha continua exigida.
    expect(FORM).toMatch(/if \(baseCoveredByVariant\) return \[\];/);
  });

  it('o seletor inclui o material da ficha quando ele não está coberto', () => {
    expect(FORM).toContain('SHEET_MATERIAL_OPTION');
    expect(FORM).toMatch(/\{sheetBaseGroup && !baseCoveredByVariant && \(/);
    // Sentinela porque Radix não aceita SelectItem com value vazio.
    expect(FORM).toMatch(/const SHEET_MATERIAL_OPTION = '__ficha__';/);
  });

  it('não há auto-seleção da variante única', () => {
    expect(FORM).not.toMatch(/activeMaterialVariants\.length === 1 && !item\.material_variant_id/);
  });

  it('a cor deixa de ser travada por "escolha o material primeiro"', () => {
    expect(FORM).not.toContain('Escolha o material primeiro');
    expect(FORM).not.toMatch(/const isLocked =/);
  });

  it('a validação de salvamento aceita "material da ficha" como escolha', () => {
    // Sem isto o usuário escolhia "NAPA SOFT · da ficha" na SR02 e o PV ainda
    // barrava com "Item 9: selecione o grupo de material" — a tela oferecia uma
    // opção que o salvamento não reconhecia.
    expect(PANEL).toContain('sheetMaterialSelectable:');
    expect(PANEL).toContain('onSheetMaterialSelectableChange={handleSheetMaterialSelectable}');
    // O item é quem resolve; o painel só guarda o report (fonte única).
    expect(FORM).toContain('const sheetMaterialSelectable = !!sheetBaseGroup && !baseCoveredByVariant;');
    expect(FORM).toContain('onSheetMaterialSelectableChange?.(index, sheetMaterialSelectable)');
  });

  it('a guarda do BANCO conhece a mesma excecao que o front', () => {
    // Terceira guarda da mesma regra: enforce_sale_order_item_material_variant
    // recusava material_variant_id NULL sempre que a referencia tinha variante
    // ativa — o PV parava em "Selecione a variação de material desta referência
    // antes de salvar o item" mesmo com "NAPA SOFT · da ficha" escolhido.
    expect(SQL_GUARD).toContain('sheet_material_is_selectable');
    expect(SQL_GUARD).toMatch(/IF public\.sheet_material_is_selectable\(NEW\.reference_id\) THEN\s*RETURN NEW;/);
    // A guarda continua valendo quando a base ja e coberta por variante.
    expect(SQL_GUARD).toContain('Selecione a variação de material desta referência antes de salvar o item.');
    // E a migration prova isso na propria aplicacao, nao so em teste.
    expect(SQL_GUARD).toContain('Nenhuma referencia continua exigindo variante — a guarda foi anulada');
  });

  it('a resolucao SQL espelha a precedencia do TS (mesma ordem, mesmos degraus)', () => {
    // resolveMaterialVariantColorGroup: pino cabedal > grupo cabedal >
    // (drives_upper ? principal) > pino forro > grupo forro > (drives_lining ? principal)
    const ordemSql = SQL_GUARD.slice(
      SQL_GUARD.indexOf('material_variant_color_group_id'),
      SQL_GUARD.indexOf('sheet_material_is_selectable'),
    );
    const degraus = [
      'upper_material_product_id', 'upper_material_group_id', 'variant_drives_upper',
      'lining_material_product_id', 'lining_material_group_id', 'variant_drives_lining',
    ];
    const posicoes = degraus.map(d => ordemSql.indexOf(d));
    expect(posicoes.every(pos => pos >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });
});
