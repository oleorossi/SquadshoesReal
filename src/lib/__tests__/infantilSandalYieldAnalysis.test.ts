import { describe, expect, it } from 'vitest';
import {
  I701_REFERENCE_GRADE,
  analyzeInfantilSandalYield,
  classifyYieldBucket,
} from '@/lib/infantilSandalYieldAnalysis';

describe('classifyYieldBucket', () => {
  it('marca traseiro por rótulo e não confunde com frente', () => {
    expect(classifyYieldBucket({
      source: 'accessory', label: 'Elástico Traseiro 6mm', material: 'ELASTICO 6MM',
    })).toBe('traseiro');
    expect(classifyYieldBucket({
      source: 'strap', label: 'Tira Frente', material: 'NAPA',
    })).toBe('tira_frente');
  });

  it('tira sem rótulo explícito cai em frente', () => {
    expect(classifyYieldBucket({
      source: 'strap', label: 'Tira 1', material: 'NAPA SOFT',
    })).toBe('tira_frente');
  });
});

describe('analyzeInfantilSandalYield — ordem traseiro → frente · 25–34', () => {
  it('calcula rendimento do traseiro e das tiras da frente na grade I701 (480 pares)', () => {
    const report = analyzeInfantilSandalYield({
      grade: I701_REFERENCE_GRADE,
      accessories: [{
        source: 'accessory',
        label: 'Elástico Traseiro 6mm',
        material: 'ELASTICO 6MM',
        unit: 'm',
        consumption: 0.12,
        consumption_per_size: {
          '25': 0.10, '26': 0.10, '27': 0.11, '28': 0.11, '29': 0.12,
          '30': 0.12, '31': 0.13, '32': 0.13, '33': 0.14, '34': 0.14,
        },
      }],
      straps: [{
        source: 'strap',
        label: 'Tira Frente',
        group_name: 'NAPA SOFT',
        unit: 'cm',
        consumption: 28,
        consumption_per_size: {
          '25': 24, '26': 24, '27': 26, '28': 26, '29': 28,
          '30': 28, '31': 30, '32': 30, '33': 32, '34': 32,
        },
      }],
    });

    expect(report.totalPairs).toBe(480);
    expect(report.traseiro).toHaveLength(1);
    expect(report.tirasFrente).toHaveLength(1);
    expect(report.traseiro[0].label).toMatch(/Traseiro/i);

    // 40*(0.10+0.10+0.11+0.11+0.13+0.13+0.14+0.14) + 80*(0.12+0.12)
    // = 40*0.96 + 80*0.24 = 38.4 + 19.2 = 57.6 m
    expect(report.traseiroTotals.totalConsumption).toBeCloseTo(57.6, 6);
    expect(report.traseiro[0].pairsPerMaterialUnit).toBeCloseTo(480 / 57.6, 6);

    // Frente: 40*(24+24+26+26+30+30+32+32) + 80*(28+28)
    // = 40*224 + 80*56 = 8960 + 4480 = 13440 cm = 134.4 m
    expect(report.tirasFrenteTotals.totalCm).toBeCloseTo(13440, 6);
    expect(report.tirasFrenteTotals.totalM).toBeCloseTo(134.4, 6);
    expect(report.tirasFrenteTotals.avgCmPerPair).toBeCloseTo(28, 6);
    expect(report.alerts).toEqual([]);
  });

  it('alerta quando falta traseiro ou mapa por tamanho', () => {
    const report = analyzeInfantilSandalYield({
      straps: [{ source: 'strap', label: 'Tira', consumption: 20 }],
    });
    expect(report.alerts).toContain('sem_itens_traseiro');
    expect(report.alerts.some((a) => a.startsWith('tira_frente_so_escalar:'))).toBe(true);
  });
});
