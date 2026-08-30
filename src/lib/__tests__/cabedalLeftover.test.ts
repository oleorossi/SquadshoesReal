import { describe, expect, it } from 'vitest';
import {
  CABEDAL_LEFTOVER_DUPLICATE_SKU,
  CABEDAL_LEFTOVER_NEEDS_PIN,
  CABEDAL_LEFTOVER_SAME_SKU,
  cabedalFamilyKey,
  isLeftoverCabedalExtra,
  isSameNapaFamily,
  leftoverRequiresPin,
  listLeftoverCabedalLabels,
  leftoverCabedalDisplayName,
  leftoverLabelsFromSheet,
  validateCabedalLeftovers,
} from '@/lib/cabedalLeftover';

const PRINCIPAL = {
  upper_material: 'NAPA CONHAQUE 1.0',
  upper_material_product_id: 'p-napa-10',
};

describe('cabedalLeftover — família de espessura', () => {
  it('trata NAPA CONHAQUE 1.0 e 1.2 como a mesma família, grupos diferentes', () => {
    expect(cabedalFamilyKey('NAPA CONHAQUE 1.0')).toBe('napa conhaque');
    expect(cabedalFamilyKey('NAPA CONHAQUE 1.2')).toBe('napa conhaque');
    expect(isSameNapaFamily('NAPA CONHAQUE 1.0', 'NAPA CONHAQUE 1.2')).toBe(true);
    expect(leftoverRequiresPin(
      { material: 'NAPA CONHAQUE 1.2', mandatory: true },
      PRINCIPAL,
    )).toBe(false);
  });

  it('marca extra da mesma família como sobra mesmo sem a flag leftover', () => {
    expect(isLeftoverCabedalExtra(
      { material: 'NAPA CONHAQUE 1.2', mandatory: true, consumption: 0.04 },
      PRINCIPAL,
    )).toBe(true);
  });

  it('não trata elástico como sobra de napa', () => {
    expect(isLeftoverCabedalExtra(
      { material: 'ELASTICO TRASEIRO 6MM', mandatory: true },
      PRINCIPAL,
    )).toBe(false);
  });
});

describe('cabedalLeftover — pin e duplicata', () => {
  it('permite NAPA CONHAQUE 1.2 ao lado da 1.0 sem pin (grupos distintos)', () => {
    expect(validateCabedalLeftovers([
      { material: 'NAPA CONHAQUE 1.2', mandatory: true, consumption: 0.04 },
    ], PRINCIPAL)).toEqual([]);
  });

  it('exige pin quando a sobra é do mesmo grupo do Material 1', () => {
    const issues = validateCabedalLeftovers([
      { material: 'NAPA CONHAQUE 1.0', mandatory: true, leftover: true, consumption: 0.04 },
    ], PRINCIPAL);
    expect(issues).toEqual([{ message: CABEDAL_LEFTOVER_NEEDS_PIN, extraIndex: 0 }]);
  });

  it('recusa sobra pinada no mesmo SKU do principal', () => {
    const issues = validateCabedalLeftovers([
      {
        material: 'NAPA CONHAQUE 1.2',
        mandatory: true,
        leftover: true,
        product_id: 'p-napa-10',
      },
    ], PRINCIPAL);
    expect(issues).toEqual([{ message: CABEDAL_LEFTOVER_SAME_SKU, extraIndex: 0 }]);
  });

  it('permite mesmo grupo com SKU pinado diferente', () => {
    expect(validateCabedalLeftovers([
      {
        material: 'NAPA CONHAQUE 1.0',
        mandatory: true,
        leftover: true,
        product_id: 'p-napa-12',
        product_name: 'NAPA CONHAQUE 1.2',
      },
    ], PRINCIPAL)).toEqual([]);
  });

  it('recusa duas sobras pinadas no mesmo SKU', () => {
    const issues = validateCabedalLeftovers([
      { material: 'NAPA CONHAQUE 1.2', mandatory: true, product_id: 'p-napa-12' },
      { material: 'NAPA CONHAQUE 1.2', mandatory: true, product_id: 'p-napa-12' },
    ], PRINCIPAL);
    expect(issues).toEqual([{ message: CABEDAL_LEFTOVER_DUPLICATE_SKU, extraIndex: 1 }]);
  });
});

describe('cabedalLeftover — rótulos da ficha', () => {
  it('lista a sobra 1.2 para a ficha de Costura/Corte Cabedal', () => {
    expect(listLeftoverCabedalLabels([
      { material: 'NAPA CONHAQUE 1.2', mandatory: true, leftover: true },
      { material: 'ELASTICO TRASEIRO 6MM', mandatory: true },
    ], PRINCIPAL)).toEqual(['NAPA CONHAQUE 1.2']);
  });

  it('prefixa Sobra no nome de exibição', () => {
    expect(leftoverCabedalDisplayName({
      material: 'NAPA CONHAQUE 1.2',
      product_name: 'NAPA CONHAQUE 1.2',
    })).toBe('Sobra · NAPA CONHAQUE 1.2');
  });

  it('não duplica o prefixo Sobra se o rótulo já tem', () => {
    expect(leftoverCabedalDisplayName({
      material: 'NAPA CONHAQUE 1.2',
      label: 'Sobra · NAPA CONHAQUE 1.2',
    })).toBe('Sobra · NAPA CONHAQUE 1.2');
  });

  it('lê a ficha técnica sem any — extras + material 1', () => {
    expect(leftoverLabelsFromSheet({
      upper_material: 'NAPA CONHAQUE 1.0',
      upper_material_product_id: 'p-napa-10',
      components_accessories: [
        { material: 'NAPA CONHAQUE 1.2', mandatory: true, leftover: true },
      ],
    })).toEqual(['NAPA CONHAQUE 1.2']);
  });
});
