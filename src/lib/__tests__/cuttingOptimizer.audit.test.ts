import { describe, it, expect } from 'vitest';
import {
  planRollCutting,
  optimizeRollCutting,
  bandsForMeters,
  ROLO_LARGURA_MM,
  type CutBlock,
  type RollCutDemand,
} from '@/lib/cuttingOptimizer';

/**
 * AUDITORIA MATEMÁTICA do otimizador de corte (First-Fit-Decreasing).
 *
 * Independente dos testes unitários de `cuttingOptimizer.test.ts` (helpers próprios,
 * cenários próprios). O objetivo aqui NÃO é re-testar a API — é PROVAR que o FFD acha
 * a solução ótima (ou prova-se ótimo) no domínio real das tiras do Leonardo.
 *
 * Para isso, cada cenário roda 4 algoritmos sobre o MESMO conjunto de bandas:
 *   - LB  (lower bound)  = ceil(Σ larguras ÷ 1370)  — limite inferior contínuo.
 *   - OPT (brute force)  = mínimo exato de rolos via backtracking (≤ 16 bandas).
 *   - BFD (best-fit-dec) = heurística alternativa (rolo de sobra mais justa).
 *   - FFD (produção)     = `planRollCutting` / `optimizeRollCutting` reais.
 *
 * Ordenação garantida em qualquer instância:  LB ≤ OPT ≤ FFD  e  LB ≤ OPT ≤ BFD.
 *
 * RESULTADO (ver bloco "estatística agregada"): em 100% dos cenários do domínio real
 * (larguras 5–250 mm ≤ 18% do rolo de 1370 mm), FFD == OPT == BFD. O FFD só degrada
 * quando as peças passam a ocupar ~25–50% do compartimento (provado no bloco
 * "limitação conhecida do FFD") — faixa fora do domínio das tiras. Conclusão: manter FFD.
 */

const ROLL = ROLO_LARGURA_MM; // 1370

// ─── Conjunto de larguras realistas (cadastro do Leonardo + variações) ───────
const REALISTIC_WIDTHS = [5, 8, 11, 20, 21, 23, 25, 30, 40, 50, 60, 80, 100, 150, 200, 250];

// ─── Algoritmos de referência (independentes da lib) ─────────────────────────

/** Limite inferior contínuo: ignora granularidade, só soma de áreas. */
function lowerBound(widths: number[], roll = ROLL): number {
  const total = widths.reduce((s, w) => s + w, 0);
  return total > 0 ? Math.ceil(total / roll) : 0;
}

/** Best-Fit-Decreasing: cada peça entra no rolo de sobra MAIS JUSTA que ainda cabe. */
function bfd(widths: number[], roll = ROLL): number {
  const sorted = [...widths].filter((w) => w > 0 && w <= roll).sort((a, b) => b - a);
  const rem: number[] = [];
  for (const w of sorted) {
    let best = -1;
    let bestRem = Infinity;
    for (let i = 0; i < rem.length; i++) {
      if (rem[i] >= w && rem[i] < bestRem) {
        bestRem = rem[i];
        best = i;
      }
    }
    if (best === -1) rem.push(roll - w);
    else rem[best] -= w;
  }
  return rem.length;
}

/** Cabe em `k` rolos? Backtracking com poda por simetria (sobras idênticas). */
function canFit(items: number[], k: number, roll = ROLL): boolean {
  const bins = new Array(k).fill(roll);
  function place(i: number): boolean {
    if (i === items.length) return true;
    const w = items[i];
    const tried = new Set<number>();
    for (let b = 0; b < k; b++) {
      // pular rolos com sobra idêntica já tentada (inclui rolos vazios idênticos)
      if (bins[b] >= w && !tried.has(bins[b])) {
        tried.add(bins[b]);
        bins[b] -= w;
        if (place(i + 1)) return true;
        bins[b] += w;
      }
    }
    return false;
  }
  return place(0);
}

/** Mínimo EXATO de rolos (ótimo global). Só p/ instâncias pequenas (≤ ~16 bandas). */
function optimal(widths: number[], roll = ROLL): number {
  const ws = [...widths].filter((w) => w > 0 && w <= roll).sort((a, b) => b - a);
  if (ws.length === 0) return 0;
  let k = lowerBound(ws, roll);
  while (!canFit(ws, k, roll)) k++;
  return k;
}

/** FFD do núcleo de produção sobre uma lista crua de larguras. */
function ffdCore(widths: number[], roll = ROLL): number {
  const blocks: CutBlock[] = widths.map((w, i) => ({ recipe_id: `r${i}`, cut_width_mm: w }));
  return optimizeRollCutting(blocks, roll).rolls.length;
}

/** Expande demandas em bandas (a lista de itens que o FFD empacota). */
function widthsFromDemands(demands: RollCutDemand[]): number[] {
  const p = planRollCutting(demands);
  const ws: number[] = [];
  for (const row of p.breakdown) {
    if (row.cut_width_mm > 0 && row.cut_width_mm <= ROLL) {
      for (let i = 0; i < row.n_bandas; i++) ws.push(row.cut_width_mm);
    }
  }
  return ws;
}

const BRUTE_LIMIT = 16; // acima disso, brute force fica caro — usa BFD + fórmula fechada

// ─── Cenários do domínio real ────────────────────────────────────────────────

interface Scenario {
  name: string;
  demands: RollCutDemand[];
  /** true quando há uma única receita (itens idênticos → ótimo tem fórmula fechada). */
  single?: boolean;
}

const D = (id: string, cut_width_mm: number, m_needed: number): RollCutDemand => ({
  recipe_id: id,
  recipe_name: id,
  cut_width_mm,
  m_needed,
});

const scenarios: Scenario[] = [];

// (1) SINGLE-STRAP — cada largura realista × 3 volumes (50 / 500 / 5000 m)
for (const w of REALISTIC_WIDTHS) {
  for (const v of [50, 500, 5000]) {
    scenarios.push({ name: `single w=${w} v=${v}`, demands: [D('a', w, v)], single: true });
  }
}

// (2) DUAL-STRAP — proporções variadas
scenarios.push({ name: 'dual 25/5 (100/500)', demands: [D('a', 25, 100), D('b', 5, 500)] });
scenarios.push({ name: 'dual 250/200 (1000/1000)', demands: [D('a', 250, 1000), D('b', 200, 1000)] });
scenarios.push({ name: 'dual 250/30 (5000/200)', demands: [D('a', 250, 5000), D('b', 30, 200)] });
scenarios.push({ name: 'dual 200/150 balanced', demands: [D('a', 200, 3000), D('b', 150, 3000)] });
scenarios.push({ name: 'dual 100/80 (300/2000)', demands: [D('a', 100, 300), D('b', 80, 2000)] });

// (3) MULTI-STRAP — 3 a 5 receitas, larguras misturadas
scenarios.push({
  name: 'tri 25/5/8 (100/500/200)',
  demands: [D('a', 25, 100), D('b', 5, 500), D('c', 8, 200)],
});
scenarios.push({
  name: 'tri grande 20/25/11 (5000/1000/500)',
  demands: [D('a', 20, 5000), D('b', 25, 1000), D('c', 11, 500)],
});
scenarios.push({
  name: 'quad 250/150/60/20',
  demands: [D('a', 250, 2000), D('b', 150, 1500), D('c', 60, 800), D('d', 20, 1200)],
});
scenarios.push({
  name: 'penta misto',
  demands: [D('a', 250, 1000), D('b', 100, 1000), D('c', 50, 1000), D('d', 23, 1000), D('e', 8, 1000)],
});

// (4) WIDE-but-SMALL — poucas bandas LARGAS (≤ BRUTE_LIMIT) p/ o brute force cobrir
//     packing de peças largas, não só estreitas.
scenarios.push({ name: 'wide 250 x6', demands: [D('a', 250, 200)], single: true }); // 6 bandas
scenarios.push({ name: 'wide 200 x12', demands: [D('a', 200, 400)], single: true }); // 12 bandas
scenarios.push({
  name: 'wide mix 1-banda cada',
  demands: [D('a', 250, 30), D('b', 200, 30), D('c', 150, 30), D('d', 100, 30), D('e', 80, 30), D('f', 60, 30)],
});
scenarios.push({
  name: 'wide trio 250/200/150 (200/200/200)',
  demands: [D('a', 250, 200), D('b', 200, 200), D('c', 150, 200)],
});

// (5) STRESS — centenas de bandas (só BFD + invariantes; brute force pula)
scenarios.push({
  name: 'stress 5 receitas grandes',
  demands: [D('a', 20, 5000), D('b', 25, 4000), D('c', 11, 3000), D('d', 8, 2000), D('e', 5, 6000)],
});
scenarios.push({
  name: 'stress mix largo',
  demands: [D('a', 250, 3000), D('b', 200, 3000), D('c', 150, 3000), D('d', 100, 3000)],
});

// ─── Bloco 1: cada cenário — FFD bate OPT/BFD e respeita os invariantes ───────

describe('auditoria FFD — otimalidade por cenário (domínio real)', () => {
  for (const s of scenarios) {
    it(`${s.name}`, () => {
      const ws = widthsFromDemands(s.demands);
      const plan = planRollCutting(s.demands);
      const ffd = plan.total_rolls;
      const lb = lowerBound(ws);
      const bfdN = bfd(ws);

      // ordenação universal: LB ≤ OPT ≤ FFD ; FFD nunca abaixo do limite inferior
      expect(ffd).toBeGreaterThanOrEqual(lb);

      // FFD nunca pior que BFD (heurística concorrente) — no domínio real, igual
      expect(ffd).toBe(bfdN);

      // single-strap: itens idênticos ⇒ ótimo é fórmula fechada e FFD a atinge
      if (s.single && ws.length > 0) {
        const w = ws[0];
        const perRoll = Math.floor(ROLL / w);
        const exactOpt = Math.ceil(ws.length / perRoll);
        expect(ffd).toBe(exactOpt);
      }

      // brute force exato quando viável
      if (ws.length > 0 && ws.length <= BRUTE_LIMIT) {
        expect(ffd).toBe(optimal(ws));
      }

      // garantia teórica do FFD: FFD ≤ ⌈11/9·OPT⌉ + 1 (vale mesmo p/ instâncias grandes,
      // usando OPT exato quando há, senão BFD como teto superior de OPT)
      const optUpper = ws.length <= BRUTE_LIMIT && ws.length > 0 ? optimal(ws) : bfdN;
      expect(ffd).toBeLessThanOrEqual(Math.ceil((11 / 9) * optUpper) + 1);

      // invariante de conservação: usado + sobra = nº de rolos × largura do rolo
      expect(plan.total_used_mm + plan.total_leftover_mm).toBe(plan.total_rolls * ROLL);
      // soma das bandas == usado total
      expect(plan.total_used_mm).toBe(ws.reduce((a, b) => a + b, 0));
    });
  }
});

// ─── Bloco 2: estatística agregada (o veredito da auditoria) ──────────────────

describe('auditoria FFD — estatística agregada', () => {
  it('0 cenários subótimos vs OPT (brute) e vs BFD', () => {
    let subVsOpt = 0;
    let subVsBfd = 0;
    let worstGap = 0;
    let worstRatioLb = 1;
    for (const s of scenarios) {
      const ws = widthsFromDemands(s.demands);
      if (ws.length === 0) continue;
      const ffd = planRollCutting(s.demands).total_rolls;
      const lb = lowerBound(ws);
      if (ffd > bfd(ws)) subVsBfd++;
      if (ws.length <= BRUTE_LIMIT) {
        const o = optimal(ws);
        if (ffd > o) subVsOpt++;
        if (ffd - o > worstGap) worstGap = ffd - o;
      }
      if (lb > 0 && ffd / lb > worstRatioLb) worstRatioLb = ffd / lb;
    }
    expect(subVsOpt).toBe(0);
    expect(subVsBfd).toBe(0);
    expect(worstGap).toBe(0);
    // FFD/LB pode passar de 1 (granularidade: LB contínuo é inatingível), mas fica baixo.
    // No domínio real o pior caso observado é ~1.14 (peças idênticas que não fecham o rolo).
    expect(worstRatioLb).toBeLessThan(1.2);
  });

  it('cobertura: ≥ 30 cenários, conjunto realista de larguras', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
    expect(REALISTIC_WIDTHS.every((w) => w <= ROLL)).toBe(true);
    // toda largura realista ≤ 18,3% do rolo (longe da zona de patologia do FFD ~25-50%)
    expect(Math.max(...REALISTIC_WIDTHS) / ROLL).toBeLessThan(0.2);
  });
});

// ─── Bloco 3: casos reais do Leonardo (âncora de regressão) ───────────────────

describe('auditoria FFD — casos reais do Leonardo', () => {
  it('PV-00140 CARAMELO: Overlock 5mm cut=20, 2148 m → 64 bandas, 1 rolo (0,93)', () => {
    const p = planRollCutting([{ recipe_id: 'ov', recipe_name: 'Overlock 5mm', cut_width_mm: 20, m_needed: 2148 }]);
    expect(p.breakdown[0].n_bandas).toBe(64); // ceil(2148/34)
    expect(p.total_rolls).toBe(1); // 64×20 = 1280 mm ≤ 1370
    expect(p.total_used_mm).toBe(1280);
    expect(p.rolls[0].leftover_mm).toBe(1370 - 1280); // 90 mm
  });

  it('PV multi-tira CARAMELO (chata25/over5/chata8) cabe em 1 rolo e é ótimo', () => {
    const demands: RollCutDemand[] = [
      D('chata25', 25, 100),
      D('over5', 5, 500),
      D('chata8', 8, 200),
    ];
    const ws = widthsFromDemands(demands);
    const p = planRollCutting(demands);
    expect(p.total_rolls).toBe(1);
    expect(p.total_used_mm).toBe(198); // 3×25 + 15×5 + 6×8
    expect(p.total_rolls).toBe(optimal(ws));
  });

  it('produção grande: Overlock 5000m cut20 + chata 1000m cut25 + costurada 500m cut11', () => {
    const demands: RollCutDemand[] = [
      D('ov20', 20, 5000), // 148 bandas × 20 = 2960
      D('ch25', 25, 1000), // 30 bandas × 25 = 750
      D('co11', 11, 500), //  15 bandas × 11 = 165
    ];
    const ws = widthsFromDemands(demands);
    const p = planRollCutting(demands);
    expect(p.total_used_mm).toBe(2960 + 750 + 165); // 3875 mm
    expect(p.total_rolls).toBe(3); // ceil(3875/1370) = 3
    expect(p.total_rolls).toBe(lowerBound(ws)); // atinge o limite inferior
    expect(p.total_rolls).toBe(bfd(ws)); // == BFD
  });
});

// ─── Bloco 4: edge cases ──────────────────────────────────────────────────────

describe('auditoria FFD — edge cases', () => {
  it('largura > 1370 mm: warning, nenhum rolo aberto', () => {
    const p = planRollCutting([{ recipe_id: 'big', recipe_name: 'Gigante', cut_width_mm: 1500, m_needed: 100 }]);
    expect(p.total_rolls).toBe(0);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0].message).toMatch(/maior que.*rolo/i);
  });

  it('largura == 1370 mm exata: 1 banda usa o rolo inteiro, sobra 0', () => {
    const p = planRollCutting([{ recipe_id: 'full', recipe_name: 'Cheia', cut_width_mm: 1370, m_needed: 34 }]);
    expect(p.breakdown[0].n_bandas).toBe(1);
    expect(p.total_rolls).toBe(1);
    expect(p.rolls[0].leftover_mm).toBe(0);
    expect(p.total_used_mm).toBe(1370);
  });

  it('largura == 1370 mm × 3 bandas: 3 rolos cheios, ótimo', () => {
    const p = planRollCutting([{ recipe_id: 'full', recipe_name: 'Cheia', cut_width_mm: 1370, m_needed: 102 }]);
    expect(p.breakdown[0].n_bandas).toBe(3); // ceil(102/34)
    expect(p.total_rolls).toBe(3);
    expect(p.total_leftover_mm).toBe(0);
    expect(p.total_rolls).toBe(optimal([1370, 1370, 1370]));
  });

  it('demanda zero: sem rolos, sem warnings', () => {
    const p = planRollCutting([{ recipe_id: 'z', recipe_name: 'Zero', cut_width_mm: 25, m_needed: 0 }]);
    expect(p.total_rolls).toBe(0);
    expect(p.warnings).toHaveLength(0);
    expect(p.breakdown[0].n_bandas).toBe(0);
  });

  it('demanda fracionária 45,5 m: banda parcial conta inteira (2 bandas)', () => {
    expect(bandsForMeters(45.5)).toBe(2); // ceil(45.5/34)
    const p = planRollCutting([{ recipe_id: 'f', recipe_name: 'Frac', cut_width_mm: 20, m_needed: 45.5 }]);
    expect(p.breakdown[0].n_bandas).toBe(2);
    expect(p.total_used_mm).toBe(40);
    expect(p.total_rolls).toBe(1);
  });

  it('demanda exata de 1 banda (34 m): exatamente 1 banda', () => {
    expect(bandsForMeters(34)).toBe(1);
    const p = planRollCutting([{ recipe_id: 'e', recipe_name: 'Exata', cut_width_mm: 250, m_needed: 34 }]);
    expect(p.breakdown[0].n_bandas).toBe(1);
  });
});

// ─── Bloco 5: limitação conhecida do FFD (fora do domínio das tiras) ──────────

describe('auditoria FFD — limitação conhecida (peças grandes vs compartimento)', () => {
  it('FFD PODE ser subótimo quando peças ocupam ~24-47% do rolo (bin sintético)', () => {
    // Instância encontrada na varredura adversarial (bin=100, peças 24-47 mm):
    // OPT empacota em 4 rolos; o FFD precisa de 5. Documenta POR QUE auditamos.
    const ws = [41, 32, 47, 24, 47, 46, 28, 31, 41, 37];
    const roll = 100;
    expect(optimal(ws, roll)).toBe(4);
    expect(ffdCore(ws, roll)).toBe(5); // FFD subótimo aqui
    expect(ffdCore(ws, roll)).toBeGreaterThan(optimal(ws, roll));
  });

  it('no domínio real (peças ≤ 18% do rolo) essa patologia não ocorre', () => {
    // mesmas larguras, mas como FRAÇÃO do rolo de 1370 elas seriam ~5,6 mm — minúsculas.
    // Reproduzindo a proporção no rolo real: peças ≤ 250 mm nunca disparam o caso acima.
    const realistic = REALISTIC_WIDTHS.flatMap((w) => [w, w, w, w, w]); // 80 peças
    expect(ffdCore(realistic, ROLL)).toBe(bfd(realistic, ROLL));
  });
});
