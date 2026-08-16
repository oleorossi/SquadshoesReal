import { describe, it, expect } from 'vitest';
import {
  computeBaseMaterialTotal,
  computePurchaseBaseTotal,
  isBaseMaterialGroup,
  isSuspectUnrolledArtisanal,
  type BaseMaterialInput,
} from './baseMaterialTotal';

/** Linhas reais do PV-00147, preservadas em precisão integral. */
const COGUMELO: BaseMaterialInput[] = [
  {
    componentType: 'Forração Palmilha', groupName: 'NAPA SUDANI',
    productUnit: 'm', totalQuantity: 20.27,
  },
  {
    componentType: 'Tiras', groupName: 'Tira chata 8mm', productUnit: 'm',
    totalQuantity: 169.20,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 169.20 / 60, yieldPerMeter: 60 },
  },
  {
    componentType: 'Tiras', groupName: 'Tira chata 8mm', productUnit: 'm',
    totalQuantity: 126.00,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 126.00 / 60, yieldPerMeter: 60 },
  },
  ...[1, 2, 3].map(() => ({
    componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', productUnit: 'm',
    totalQuantity: 234.72,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 234.72 / 61, yieldPerMeter: 61 },
  })),
];

describe('computeBaseMaterialTotal', () => {
  it('soma tiras convertidas + napa direta sem arredondar cada parcela', () => {
    const r = computeBaseMaterialTotal(COGUMELO)!;
    expect(r.total).toBeCloseTo(36.7336065574, 8);
    expect(r.skipped).toBe(0);
  });

  it('quebra por material, maior primeiro', () => {
    const r = computeBaseMaterialTotal(COGUMELO)!;
    expect(r.parts.map(p => p.name)).toEqual(['NAPA SUDANI', 'NAPA SOFT']);
    expect(r.parts[0].qty).toBeCloseTo(20.27, 2);
    expect(r.parts[1].qty).toBeCloseTo(16.4636065574, 8);
  });

  it('conta o equivalente em napa da tira, nunca os metros de tira', () => {
    // 169,20 m de tira = 2,82 m de napa. Somar os metros de tira daria 169,20.
    const r = computeBaseMaterialTotal([COGUMELO[1]])!;
    expect(r.total).toBeCloseTo(2.82, 2);
  });

  it('ignora o que não é napa (solado em par, linha em kg, rebite em un)', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Solado', groupName: 'SOLADO 01', productUnit: 'par', totalQuantity: 2304 },
      { componentType: 'Químicos', groupName: 'LINHANYL', productUnit: 'kg', totalQuantity: 2.07 },
      { componentType: 'Outros', groupName: 'Rebite', productUnit: 'un', totalQuantity: 2592 },
    ]);
    expect(r).toBeNull();
  });

  it('deixa de fora a linha com largura faltando (entraria ~100× inflada) e avisa', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Cabedal', groupName: 'NAPA X', productUnit: 'm', totalQuantity: 5700, widthMissing: true },
      { componentType: 'Forração', groupName: 'NAPA SOFT', productUnit: 'm', totalQuantity: 12.5 },
    ])!;
    expect(r.total).toBeCloseTo(12.5, 2);
    expect(r.skipped).toBe(1);
  });

  it('três contribuições de 0,0049 permanecem 0,0147', () => {
    const r = computeBaseMaterialTotal([
      ...[1, 2, 3].map(() => ({
        componentType: 'Tiras', groupName: 'TIRA TESTE', productUnit: 'm',
        totalQuantity: 0.294,
        artisanal: { baseName: 'NAPA SOFT', baseQty: 0.0049, yieldPerMeter: 60 },
      })),
    ])!;
    expect(r.total).toBeCloseTo(0.0147, 10);
    expect(r.skipped).toBe(0);
  });

  it('tira pendente sem receita exata continua fora do total e contada em skipped', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Forração Palmilha', groupName: 'NAPA SUDANI', productUnit: 'm', totalQuantity: 13.51 },
      {
        componentType: 'Tiras', groupName: 'TIRA NOVA 12MM', productUnit: 'm',
        totalQuantity: 100,
        artisanal: { baseName: 'NAPA SUDANI', baseQty: 0, yieldPerMeter: 0, pending: true },
      },
    ])!;
    expect(r.total).toBeCloseTo(13.51, 2);
    expect(r.skipped).toBe(1);
  });

  it('deixa de fora consumo não calculado (fachete sem specs)', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Fachete', groupName: 'NAPA SOFT', productUnit: 'm', totalQuantity: 0, warning: 'sem consumo de fachete' },
    ]);
    expect(r).toBeNull();
  });

  it('não soma napa medida em dm² junto com metro', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Cabedal', groupName: 'NAPA SOFT', productUnit: 'dm²', totalQuantity: 5.83 },
    ]);
    expect(r).toBeNull();
  });
});

describe('isBaseMaterialGroup', () => {
  it('reconhece as famílias de napa e couro', () => {
    for (const g of ['NAPA SOFT', 'NAPA SUDANI', 'NAPA PALHA', 'NAPA MADRID', 'COURO LISO']) {
      expect(isBaseMaterialGroup(g)).toBe(true);
    }
  });

  it('não confunde com tira, EVA, solado ou cola', () => {
    for (const g of ['TIRA OVERLOCK 5MM', 'PALMILHA', 'SOLADO 01', 'EMBALAGEM', 'LINHANYL']) {
      expect(isBaseMaterialGroup(g)).toBe(false);
    }
  });

  it('aceita base de receita que não casa com o padrão de nome', () => {
    expect(isBaseMaterialGroup('SINTETICO PREMIUM')).toBe(false);
    expect(isBaseMaterialGroup('SINTETICO PREMIUM', ['SINTETICO PREMIUM'])).toBe(true);
  });
});

describe('computePurchaseBaseTotal', () => {
  /** Linhas reais do PV-00147 (compute_materials_per_pv, 20/07/2026). */
  const PV147 = [
    { groupName: 'NAPA SOFT', unit: 'm', qty: 46.15 },     // OFF WHITE
    { groupName: 'NAPA SOFT', unit: 'm', qty: 13.51 },     // PORCELANA
    { groupName: 'NAPA SOFT', unit: 'm', qty: 16.46 },     // COGUMELO (tiras convertidas)
    { groupName: 'NAPA SOFT', unit: 'm', qty: 18.03 },     // CAPUCCINO
    { groupName: 'NAPA SUDANI', unit: 'm', qty: 13.51 },   // CAPUCCINO
    { groupName: 'NAPA SUDANI', unit: 'm', qty: 33.79 },   // OFF WHITE
    { groupName: 'NAPA SUDANI', unit: 'm', qty: 20.27 },   // COGUMELO
    { groupName: 'NAPA PALHA', unit: 'm', qty: 2.27 },
    { groupName: 'PALMILHA', unit: 'm', qty: 67.87 },      // EVA 3MM — em metro, mas NÃO é napa
    { groupName: 'SOLADO 01', unit: 'par', qty: 2304 },
    { groupName: 'TIRA OVERLOCK 5MM', unit: 'm', qty: 645.12 },
  ];

  it('soma só a napa do pedido (163,99 m)', () => {
    const r = computePurchaseBaseTotal(PV147)!;
    expect(r.total).toBeCloseTo(163.99, 2);
  });

  it('deixa o EVA em metro de fora — está em m, mas não é material base', () => {
    const r = computePurchaseBaseTotal([{ groupName: 'PALMILHA', unit: 'm', qty: 67.87 }]);
    expect(r).toBeNull();
  });

  it('não soma a tira que escapou do rollup como se fosse napa', () => {
    const r = computePurchaseBaseTotal([{ groupName: 'TIRA OVERLOCK 5MM', unit: 'm', qty: 645.12 }]);
    expect(r).toBeNull();
  });

  it('agrupa por família, maior primeiro', () => {
    const r = computePurchaseBaseTotal(PV147)!;
    expect(r.parts.map(p => p.name)).toEqual(['NAPA SOFT', 'NAPA SUDANI', 'NAPA PALHA']);
    expect(r.parts[0].qty).toBeCloseTo(94.15, 2);
    expect(r.parts[1].qty).toBeCloseTo(67.57, 2);
  });
});

describe('isSuspectUnrolledArtisanal', () => {
  // Grupo TIRA OVERLOCK 5MM: 23 produtos com a flag, só o CAPUCCINO sem.
  const counts = new Map([['g-overlock', 23], ['g-strass', 0]]);

  it('acusa o produto sem flag num grupo cujos irmãos são artesanais', () => {
    expect(isSuspectUnrolledArtisanal({ is_artisanal: false, group_id: 'g-overlock' }, counts)).toBe(true);
  });

  it('não acusa quem já tem a flag', () => {
    expect(isSuspectUnrolledArtisanal({ is_artisanal: true, group_id: 'g-overlock' }, counts)).toBe(false);
  });

  it('não acusa grupo comprado pronto (nenhum irmão artesanal)', () => {
    expect(isSuspectUnrolledArtisanal({ is_artisanal: false, group_id: 'g-strass' }, counts)).toBe(false);
  });

  it('produto sem grupo não vira suspeita', () => {
    expect(isSuspectUnrolledArtisanal({ is_artisanal: false, group_id: null }, counts)).toBe(false);
  });
});
