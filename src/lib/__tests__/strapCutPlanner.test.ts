import { describe, expect, it } from 'vitest';
import {
  napaFromConfirmedYield,
  planStrapCutHeight,
  simulateStrapFromHeight,
  strapCutRollBreakdownLabel,
} from '@/lib/strapCutPlanner';

describe('planStrapCutHeight', () => {
  it('caso da imagem: 793,8 m · rolo 40 · banda 20 → 400 mm / 1 rolo', () => {
    const plan = planStrapCutHeight({
      strapNeededM: 793.8,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
    });
    expect(plan.valid).toBe(true);
    expect(plan.bandsNeeded).toBe(20); // ceil(793.8/40)
    expect(plan.heightMm).toBe(400);
    expect(plan.rolls).toBe(1);
    expect(plan.multiRoll).toBe(false);
    expect(plan.heightOnLastRollMm).toBe(400);
    expect(plan.strapProducedM).toBe(800);
    expect(plan.strapSurplusM).toBeCloseTo(6.2, 5);
  });

  it('divide em vários rolos quando a altura passa da largura útil', () => {
    // 100 bandas × 20 mm = 2000 mm > 1370 → ceil(100/68) = 2 rolos
    // 100 % 68 = 32 → 640 mm no último
    const plan = planStrapCutHeight({
      strapNeededM: 4000, // ceil(4000/40) = 100 bandas
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
    });
    expect(plan.valid).toBe(true);
    expect(plan.bandsNeeded).toBe(100);
    expect(plan.heightMm).toBe(2000);
    expect(plan.bandsPerRoll).toBe(68);
    expect(plan.rolls).toBe(2);
    expect(plan.multiRoll).toBe(true);
    expect(plan.heightOnLastRollMm).toBe(640);
    expect(strapCutRollBreakdownLabel(plan)).toBe('1 rolo completo + 640 mm no próximo');
  });

  it('múltiplo exato de bandas por rolo → último “cheio” (altura no último = 0)', () => {
    // 68 bandas × 20 = 1360 mm ≤ 1370 → 1 rolo, remainder = 68%68 = 0
    const plan = planStrapCutHeight({
      strapNeededM: 68 * 40,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
    });
    expect(plan.valid).toBe(true);
    expect(plan.bandsNeeded).toBe(68);
    expect(plan.rolls).toBe(1);
    expect(plan.heightOnLastRollMm).toBe(0);
    expect(plan.multiRoll).toBe(false);
  });

  it('recusa banda maior que a largura útil', () => {
    const plan = planStrapCutHeight({
      strapNeededM: 100,
      rollLengthM: 40,
      bandMm: 1400,
      usableWidthMm: 1370,
    });
    expect(plan.valid).toBe(false);
    expect(plan.error).toMatch(/maior que a largura/i);
  });

  it('recusa entradas inválidas', () => {
    expect(planStrapCutHeight({
      strapNeededM: 0,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
    }).valid).toBe(false);
    expect(planStrapCutHeight({
      strapNeededM: 100,
      rollLengthM: 0,
      bandMm: 20,
      usableWidthMm: 1370,
    }).valid).toBe(false);
  });
});

describe('simulateStrapFromHeight', () => {
  it('300 mm · banda 20 · rolo 40 → 15 bandas · 600 m de tira', () => {
    const sim = simulateStrapFromHeight({
      heightMm: 300,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
      strapNeededM: 793.8,
    });
    expect(sim.valid).toBe(true);
    expect(sim.bandsInHeight).toBe(15);
    expect(sim.strapPerRollM).toBe(600);
    expect(sim.coversInOneRoll).toBe(false);
    expect(sim.rollsToCover).toBe(2); // ceil(793.8/600)
    expect(sim.exceedsUsableWidth).toBe(false);
  });

  it('400 mm cobre 793,8 m em 1 rolo', () => {
    const sim = simulateStrapFromHeight({
      heightMm: 400,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
      strapNeededM: 793.8,
    });
    expect(sim.valid).toBe(true);
    expect(sim.strapPerRollM).toBe(800);
    expect(sim.coversInOneRoll).toBe(true);
    expect(sim.rollsToCover).toBe(1);
  });

  it('altura sem banda completa falha', () => {
    const sim = simulateStrapFromHeight({
      heightMm: 15,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
      strapNeededM: 100,
    });
    expect(sim.valid).toBe(false);
  });

  it('marca quando a altura passa da largura útil', () => {
    const sim = simulateStrapFromHeight({
      heightMm: 1500,
      rollLengthM: 40,
      bandMm: 20,
      usableWidthMm: 1370,
      strapNeededM: 100,
    });
    expect(sim.valid).toBe(true);
    expect(sim.exceedsUsableWidth).toBe(true);
  });
});

describe('napaFromConfirmedYield', () => {
  it('espelha tira ÷ rendimento (793,8 / 70 ≈ 11,34)', () => {
    const napa = napaFromConfirmedYield(793.8, 70);
    expect(napa).toBeCloseTo(11.34, 5);
  });

  it('null sem yield ou sem necessidade', () => {
    expect(napaFromConfirmedYield(793.8, 0)).toBeNull();
    expect(napaFromConfirmedYield(0, 70)).toBeNull();
    expect(napaFromConfirmedYield(793.8, null)).toBeNull();
  });
});
