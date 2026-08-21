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
});
