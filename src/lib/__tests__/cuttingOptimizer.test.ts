import { describe, it, expect } from 'vitest';
import {
  optimizeRollCutting,
  planRollCutting,
  planRollsFromStrapRows,
  bandsForMeters,
  METROS_UTEIS_POR_BANDA,
  ROLO_LARGURA_MM,
  MIN_REUSABLE_LEFTOVER_MM,
  type CutBlock,
  type RollCutDemand,
} from '@/lib/cuttingOptimizer';
import { computeStrapRollCut, type ArtisanalStrapCutRow } from '@/lib/strapRollCut';

/**
 * GATE do otimizador de corte do rolo (FFD multi-tira).
 *
 * Empacota várias tiras da mesma cor/base num rolo de 1370 mm via First-Fit-Decreasing.
 * Cada banda rende os 40 m integrais do rolo, sem percentual adicional de perda. A unidade é a
 * LARGURA (mm) consumida na dimensão dos 1370 mm do rolo.
 */

const block = (recipe_id: string, cut_width_mm: number, recipe_name?: string): CutBlock => ({
  recipe_id,
  recipe_name,
  cut_width_mm,
});

describe('constantes e helpers', () => {
  it('metros úteis por banda = comprimento integral de 40 m', () => {
    expect(METROS_UTEIS_POR_BANDA).toBeCloseTo(40, 10);
  });

  it('largura do rolo = 1370 mm', () => {
    expect(ROLO_LARGURA_MM).toBe(1370);
  });

  it('bandsForMeters arredonda pra cima (banda parcial conta inteira)', () => {
    expect(bandsForMeters(0)).toBe(0);
    expect(bandsForMeters(-10)).toBe(0);
    expect(bandsForMeters(40)).toBe(1);
    expect(bandsForMeters(41)).toBe(2);
    expect(bandsForMeters(100)).toBe(3); // ceil(2,5)
    expect(bandsForMeters(500)).toBe(13); // ceil(12,5)
    expect(bandsForMeters(200)).toBe(5);
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
    expect(p.breakdown[0].n_bandas).toBe(1); // ceil(30/40)
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

    // bandas: 25→3 (75mm), 5→13 (65mm), 8→5 (40mm). Total 180mm.
    expect(p.breakdown.find((b) => b.recipe_id === 'chata25')!.n_bandas).toBe(3);
    expect(p.breakdown.find((b) => b.recipe_id === 'over5')!.n_bandas).toBe(13);
    expect(p.breakdown.find((b) => b.recipe_id === 'chata8')!.n_bandas).toBe(5);

    expect(p.total_rolls).toBe(1);
    expect(p.total_used_mm).toBe(180);
    expect(p.rolls[0].leftover_mm).toBe(1370 - 180); // 1190mm
    expect(p.total_leftover_mm).toBe(1190);

    // segmentos por receita (ordem descendente de largura) + sobra no fim.
    const segs = p.rolls[0].segments;
    expect(segs[segs.length - 1].recipe_id).toBeNull(); // sobra por último
    const chata25 = segs.find((s) => s.recipe_id === 'chata25')!;
    expect(chata25.count).toBe(3);
    expect(chata25.width_mm).toBe(75);
    const over5 = segs.find((s) => s.recipe_id === 'over5')!;
    expect(over5.count).toBe(13);
    expect(over5.width_mm).toBe(65);

    // sobra de 1190mm ≥ 50 ⇒ reaproveitável, zero desperdício.
    expect(p.reusable_leftover_mm).toBe(1190);
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

// ─── Ponte PV: planRollsFromStrapRows (agrupa por base+cor) ──────────────────

const strapRow = (o: Partial<ArtisanalStrapCutRow> & { groupName: string; color: string }): ArtisanalStrapCutRow => {
  const largura_mm = o.largura_mm ?? 20;
  const metros_necessarios = o.metros_necessarios ?? 34;
  return {
    key: o.key ?? `${o.groupName}||${o.color}`.toLowerCase(),
    groupName: o.groupName,
    color: o.color,
    largura_mm,
    metros_necessarios,
    cut: computeStrapRollCut({ largura_mm, metros_necessarios }),
    baseName: o.baseName,
  };
};

describe('planRollsFromStrapRows — agrupamento por base+cor', () => {
  it('vazio → nenhum plano', () => {
    expect(planRollsFromStrapRows([])).toHaveLength(0);
  });

  it('tiras da MESMA base+cor co-empacotam num só grupo/plano', () => {
    const rows = [
      strapRow({ groupName: 'Tira chata 25mm', color: 'Caramelo', baseName: 'NAPA SOFT', largura_mm: 25, metros_necessarios: 100 }),
      strapRow({ groupName: 'Tira Overlock 5mm', color: 'Caramelo', baseName: 'NAPA SOFT', largura_mm: 5, metros_necessarios: 500 }),
      strapRow({ groupName: 'Tira chata 8mm', color: 'Caramelo', baseName: 'NAPA SOFT', largura_mm: 8, metros_necessarios: 200 }),
    ];
    const plans = planRollsFromStrapRows(rows);
    expect(plans).toHaveLength(1);
    expect(plans[0].baseName).toBe('NAPA SOFT');
    expect(plans[0].color).toBe('Caramelo');
    expect(plans[0].rows).toHaveLength(3);
    // 3×25=75, 13×5=65, 5×8=40 → 180mm → 1 rolo.
    expect(plans[0].plan.total_used_mm).toBe(180);
    expect(plans[0].plan.total_rolls).toBe(1);
  });

  it('bases diferentes → planos separados', () => {
    const rows = [
      strapRow({ groupName: 'Tira A', color: 'Preto', baseName: 'NAPA SOFT', largura_mm: 20, metros_necessarios: 100 }),
      strapRow({ groupName: 'Tira B', color: 'Preto', baseName: 'COURO LISO', largura_mm: 20, metros_necessarios: 100 }),
    ];
    const plans = planRollsFromStrapRows(rows);
    expect(plans).toHaveLength(2);
    // ordenado por base: COURO LISO antes de NAPA SOFT
    expect(plans.map((p) => p.baseName)).toEqual(['COURO LISO', 'NAPA SOFT']);
  });

  it('mesma base, cores diferentes → planos separados (rolo dedicado por cor)', () => {
    const rows = [
      strapRow({ groupName: 'Tira A', color: 'Caramelo', baseName: 'NAPA SOFT', largura_mm: 20, metros_necessarios: 100 }),
      strapRow({ groupName: 'Tira A', color: 'Preto', baseName: 'NAPA SOFT', largura_mm: 20, metros_necessarios: 100 }),
    ];
    const plans = planRollsFromStrapRows(rows);
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.color)).toEqual(['Caramelo', 'Preto']);
  });

  it('sem baseName → fallback pra groupName (cada tira é seu próprio grupo)', () => {
    const rows = [
      strapRow({ groupName: 'Tira Trançada', color: 'Marrom', largura_mm: 20, metros_necessarios: 100 }),
      strapRow({ groupName: 'Tira Vazada', color: 'Marrom', largura_mm: 20, metros_necessarios: 100 }),
    ];
    const plans = planRollsFromStrapRows(rows);
    expect(plans).toHaveLength(2); // não co-empacotam (bases = nomes distintos)
    expect(plans.map((p) => p.baseName).sort()).toEqual(['Tira Trançada', 'Tira Vazada']);
  });

  it('uma tira que excede 1 rolo gera plano multi-rolo', () => {
    const rows = [
      strapRow({ groupName: 'Tira larga', color: 'Azul', baseName: 'NAPA SOFT', largura_mm: 20, metros_necessarios: 2800 }),
    ];
    const plans = planRollsFromStrapRows(rows);
    expect(plans).toHaveLength(1);
    // ceil(2800/40)=70 bandas × 20mm = 1400mm > 1370 → 2 rolos
    expect(plans[0].plan.total_rolls).toBe(2);
  });

  it('largura ausente (0) vira warning no plano, não quebra o agrupamento', () => {
    const rows = [
      strapRow({ groupName: 'Sem largura', color: 'X', baseName: 'NAPA SOFT', largura_mm: 0, metros_necessarios: 100 }),
    ];
    const plans = planRollsFromStrapRows(rows);
    expect(plans).toHaveLength(1);
    expect(plans[0].plan.total_rolls).toBe(0);
    expect(plans[0].plan.warnings.length).toBeGreaterThan(0);
  });
});
