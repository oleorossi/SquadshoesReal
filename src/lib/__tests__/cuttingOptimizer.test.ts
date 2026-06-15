import { describe, it, expect } from 'vitest';
import {
  optimizeRollCutting,
  planRollCutting,
  bandsForMeters,
  METROS_UTEIS_POR_BANDA,
  ROLO_LARGURA_MM,
  MIN_REUSABLE_LEFTOVER_MM,
  type CutBlock,
  type RollCutDemand,
} from '@/lib/cuttingOptimizer';

/**
 * GATE do otimizador de corte do rolo (FFD multi-tira).
 *
 * Empacota várias tiras da mesma cor/base num rolo de 1370 mm via First-Fit-Decreasing.
 * Cada banda rende 34 m úteis (40 m × 0,85). A unidade de saída do empacotamento é a
 * LARGURA (mm) consumida na dimensão dos 1370 mm do rolo.
 */

const block = (recipe_id: string, cut_width_mm: number, recipe_name?: string): CutBlock => ({
  recipe_id,
  recipe_name,
  cut_width_mm,
});

describe('constantes e helpers', () => {
  it('metros úteis por banda = 34', () => {
    expect(METROS_UTEIS_POR_BANDA).toBeCloseTo(34, 10);
  });

  it('largura do rolo = 1370 mm', () => {
    expect(ROLO_LARGURA_MM).toBe(1370);
  });

  it('bandsForMeters arredonda pra cima (banda parcial conta inteira)', () => {
    expect(bandsForMeters(0)).toBe(0);
    expect(bandsForMeters(-10)).toBe(0);
    expect(bandsForMeters(34)).toBe(1);
    expect(bandsForMeters(35)).toBe(2);
    expect(bandsForMeters(100)).toBe(3); // ceil(2.94)
    expect(bandsForMeters(500)).toBe(15); // ceil(14.7)
    expect(bandsForMeters(200)).toBe(6); // ceil(5.88)
  });
});

describe('optimizeRollCutting — núcleo FFD', () => {
  it('caso vazio: 0 rolos, 0 sobras, nada inviável', () => {
    const r = optimizeRollCutting([]);
    expect(r.rolls).toHaveLength(0);
    expect(r.total_leftover_mm).toBe(0);
    expect(r.unplaceable).toHaveLength(0);
  });

  it('um bloco só: 1 rolo, 1 bloco, sobra = rolo − largura', () => {
    const r = optimizeRollCutting([block('a', 200)]);
    expect(r.rolls).toHaveLength(1);
    expect(r.rolls[0].blocks).toHaveLength(1);
    expect(r.rolls[0].used_mm).toBe(200);
    expect(r.rolls[0].leftover_mm).toBe(1370 - 200);
    expect(r.total_leftover_mm).toBe(1170);
  });

  it('multi-bloco que cabe num rolo: 1 rolo, sobra certinha', () => {
    const r = optimizeRollCutting([block('a', 300), block('b', 400), block('c', 200)]);
    expect(r.rolls).toHaveLength(1);
    expect(r.rolls[0].used_mm).toBe(900);
    expect(r.rolls[0].leftover_mm).toBe(1370 - 900);
    // ordenado decrescente: 400, 300, 200
    expect(r.rolls[0].blocks.map((b) => b.cut_width_mm)).toEqual([400, 300, 200]);
  });

  it('demanda que exige 2 rolos: primeiro cheio, último com sobra', () => {
    // 3 blocos de 685 mm: 685+685 = 1370 (cheio) | 685 (sobra 685).
    const r = optimizeRollCutting([block('a', 685), block('b', 685), block('c', 685)]);
    expect(r.rolls).toHaveLength(2);
    expect(r.rolls[0].used_mm).toBe(1370);
    expect(r.rolls[0].leftover_mm).toBe(0); // primeiro CHEIO
    expect(r.rolls[1].used_mm).toBe(685);
    expect(r.rolls[1].leftover_mm).toBe(685); // último com sobra
    expect(r.total_leftover_mm).toBe(685);
  });

  it('bloco maior que o rolo (cut_width > 1370): inviável, não entra em rolo', () => {
    const r = optimizeRollCutting([block('big', 1500), block('ok', 300)]);
    expect(r.unplaceable).toHaveLength(1);
    expect(r.unplaceable[0].recipe_id).toBe('big');
    expect(r.rolls).toHaveLength(1); // só o bloco de 300 foi empacotado
    expect(r.rolls[0].used_mm).toBe(300);
  });

  it('blocos de largura ≤ 0 são ignorados', () => {
    const r = optimizeRollCutting([block('z', 0), block('n', -5), block('a', 100)]);
    expect(r.rolls).toHaveLength(1);
    expect(r.rolls[0].blocks).toHaveLength(1);
    expect(r.rolls[0].used_mm).toBe(100);
  });

  it('respeita largura de rolo customizada', () => {
    const r = optimizeRollCutting([block('a', 60), block('b', 60)], 100);
    expect(r.rolls).toHaveLength(2); // 60+60 > 100 ⇒ 2 rolos
    expect(r.rolls[0].leftover_mm).toBe(40);
  });
});

describe('planRollCutting — wrapper de alto nível', () => {
  it('caso vazio: plano zerado', () => {
    const p = planRollCutting([]);
    expect(p.total_rolls).toBe(0);
    expect(p.total_used_mm).toBe(0);
    expect(p.total_leftover_mm).toBe(0);
    expect(p.last_roll_leftover_mm).toBe(0);
    expect(p.warnings).toHaveLength(0);
    expect(p.breakdown).toHaveLength(0);
  });

  it('uma receita, 1 banda: 1 rolo + sobra + breakdown', () => {
    const p = planRollCutting([
      { recipe_id: 'a', recipe_name: 'Tira chata 25mm', cut_width_mm: 25, m_needed: 30 },
    ]);
    expect(p.total_rolls).toBe(1);
    expect(p.breakdown[0].n_bandas).toBe(1); // ceil(30/34)
    expect(p.breakdown[0].total_width_mm).toBe(25);
    expect(p.rolls[0].used_mm).toBe(25);
    expect(p.rolls[0].leftover_mm).toBe(1370 - 25);
    // segmentos: 1 receita + 1 sobra
    expect(p.rolls[0].segments.map((s) => s.recipe_id)).toEqual(['a', null]);
    expect(p.rolls[0].segments[1].width_mm).toBe(1345);
  });

  it('caso real do Leonardo — CARAMELO com 3 tipos cabe em 1 rolo', () => {
    const demands: RollCutDemand[] = [
      { recipe_id: 'chata25', recipe_name: 'Tira chata 25mm', cut_width_mm: 25, m_needed: 100 },
      { recipe_id: 'over5', recipe_name: 'Tira Overlock 5mm', cut_width_mm: 5, m_needed: 500 },
      { recipe_id: 'chata8', recipe_name: 'Tira chata 8mm', cut_width_mm: 8, m_needed: 200 },
    ];
    const p = planRollCutting(demands);

    // bandas: 25→3 (75mm), 5→15 (75mm), 8→6 (48mm). Total 198mm.
    expect(p.breakdown.find((b) => b.recipe_id === 'chata25')!.n_bandas).toBe(3);
    expect(p.breakdown.find((b) => b.recipe_id === 'over5')!.n_bandas).toBe(15);
    expect(p.breakdown.find((b) => b.recipe_id === 'chata8')!.n_bandas).toBe(6);

    expect(p.total_rolls).toBe(1);
    expect(p.total_used_mm).toBe(198);
    expect(p.rolls[0].leftover_mm).toBe(1370 - 198); // 1172mm
    expect(p.total_leftover_mm).toBe(1172);

    // segmentos por receita (ordem descendente de largura) + sobra no fim.
    const segs = p.rolls[0].segments;
    expect(segs[segs.length - 1].recipe_id).toBeNull(); // sobra por último
    const chata25 = segs.find((s) => s.recipe_id === 'chata25')!;
    expect(chata25.count).toBe(3);
    expect(chata25.width_mm).toBe(75);
    const over5 = segs.find((s) => s.recipe_id === 'over5')!;
    expect(over5.count).toBe(15);
    expect(over5.width_mm).toBe(75);

    // sobra de 1172mm ≥ 50 ⇒ reaproveitável, zero desperdício.
    expect(p.reusable_leftover_mm).toBe(1172);
    expect(p.waste_leftover_mm).toBe(0);
  });

  it('demanda que exige 2 rolos: primeiro cheio, último com sobra', () => {
    const demands: RollCutDemand[] = [
      { recipe_id: 'a', recipe_name: 'A', cut_width_mm: 685, m_needed: 68 }, // 2 bandas
      { recipe_id: 'b', recipe_name: 'B', cut_width_mm: 685, m_needed: 34 }, // 1 banda
    ];
    const p = planRollCutting(demands);
    expect(p.total_rolls).toBe(2);
    expect(p.rolls[0].leftover_mm).toBe(0); // cheio
    expect(p.rolls[1].leftover_mm).toBe(685); // sobra
    expect(p.last_roll_leftover_mm).toBe(685);
    expect(p.last_roll_leftover_pct).toBeCloseTo((685 / 1370) * 100, 6);
  });

  it('tira maior que o rolo: warning explícito, nenhum rolo', () => {
    const p = planRollCutting([
      { recipe_id: 'huge', recipe_name: 'Tira gigante', cut_width_mm: 1500, m_needed: 100 },
    ]);
    expect(p.total_rolls).toBe(0);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0].recipe_id).toBe('huge');
    expect(p.warnings[0].message).toMatch(/maior que.*rolo/i);
  });

  it('largura não cadastrada (0/null): warning, sem empacotar', () => {
    const p = planRollCutting([
      { recipe_id: 'x', recipe_name: 'Sem largura', cut_width_mm: null, m_needed: 100 },
    ]);
    expect(p.total_rolls).toBe(0);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0].message).toMatch(/não cadastrada/i);
    // mesmo sem largura, o breakdown registra a demanda (3 bandas).
    expect(p.breakdown[0].n_bandas).toBe(3);
    expect(p.breakdown[0].cut_width_mm).toBe(0);
  });

  it('sobra abaixo do mínimo conta como desperdício, não reaproveitável', () => {
    // 2 tiras de 670 mm = 1340 mm num rolo de 1370 ⇒ sobra 30 mm (< 50).
    const p = planRollCutting([
      { recipe_id: 'a', recipe_name: 'A', cut_width_mm: 670, m_needed: 34 },
      { recipe_id: 'b', recipe_name: 'B', cut_width_mm: 670, m_needed: 34 },
    ]);
    expect(p.total_rolls).toBe(1);
    expect(p.rolls[0].leftover_mm).toBe(30);
    expect(p.reusable_leftover_mm).toBe(0);
    expect(p.waste_leftover_mm).toBe(30);
    expect(MIN_REUSABLE_LEFTOVER_MM).toBe(50);
  });

  it('min_reusable_mm configurável reclassifica a sobra', () => {
    const p = planRollCutting(
      [
        { recipe_id: 'a', recipe_name: 'A', cut_width_mm: 670, m_needed: 34 },
        { recipe_id: 'b', recipe_name: 'B', cut_width_mm: 670, m_needed: 34 },
      ],
      { min_reusable_mm: 10 },
    );
    expect(p.reusable_leftover_mm).toBe(30); // 30 ≥ 10 agora
    expect(p.waste_leftover_mm).toBe(0);
  });

  it('largura em cm é normalizada pra mm', () => {
    const p = planRollCutting([
      { recipe_id: 'a', recipe_name: 'A', cut_width_mm: 2.5, cut_width_unit: 'cm', m_needed: 34 },
    ]);
    expect(p.breakdown[0].cut_width_mm).toBe(25); // 2,5 cm → 25 mm
    expect(p.rolls[0].used_mm).toBe(25);
  });

  it('receita sem demanda (0 m) não abre rolo nem avisa', () => {
    const p = planRollCutting([
      { recipe_id: 'a', recipe_name: 'A', cut_width_mm: 25, m_needed: 0 },
    ]);
    expect(p.total_rolls).toBe(0);
    expect(p.warnings).toHaveLength(0);
    expect(p.breakdown[0].n_bandas).toBe(0);
  });
});
