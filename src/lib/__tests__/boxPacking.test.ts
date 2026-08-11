import { describe, it, expect } from 'vitest';
import {
  normalizeGrade,
  gradeTotal,
  splitFicha,
  packSaleOrderItem,
  packingApplies,
  boxWeightKg,
  DEFAULT_PAIR_WEIGHT_KG,
  type GradeInput,
  packSaleOrderItemBySize,
  singleSizeMisfits,
  singleSizePackingFits,
} from '../boxPacking';

/**
 * Curva real do PV-00151 (as 3 cores são idênticas), como vem do banco:
 * numerações zeradas incluídas de propósito — é assim que o jsonb chega.
 */
const PV151_GRADE: GradeInput = {
  '23': 0, '24': 0, '25': 0, '26': 0, '27': 0,
  '28': 2, '29': 2, '30': 2, '31': 2, '32': 3, '33': 2, '34': 2,
};
const PV151_CAPACITY = 12;
const PV151_FICHAS = 12;

const asMap = (entries: { size: string; qty: number }[]) =>
  Object.fromEntries(entries.map((e) => [e.size, e.qty]));

describe('normalizeGrade', () => {
  it('descarta numerações zeradas e ordena', () => {
    expect(normalizeGrade(PV151_GRADE).map((g) => g.size)).toEqual([
      '28', '29', '30', '31', '32', '33', '34',
    ]);
  });

  it('ordena NUMERICAMENTE, não lexicalmente', () => {
    // Lexical colocaria '10' antes de '9' e a sobra sairia da numeração errada.
    expect(normalizeGrade({ '9': 1, '10': 1, '8': 1 }).map((g) => g.size))
      .toEqual(['8', '9', '10']);
  });

  it('aceita lista além do mapa do banco', () => {
    expect(normalizeGrade([{ size: '30', qty: 2 }, { size: '28', qty: 1 }]))
      .toEqual([{ size: '28', qty: 1 }, { size: '30', qty: 2 }]);
  });

  it('grade vazia/nula vira lista vazia', () => {
    expect(normalizeGrade(null)).toEqual([]);
    expect(normalizeGrade({})).toEqual([]);
    expect(normalizeGrade({ '30': 0 })).toEqual([]);
  });
});

describe('splitFicha — a sobra sai do MENOR para o maior', () => {
  it('PV-00151: sobra 28:2 + 29:1, colmeia fecha 12', () => {
    const { colmeia, sobra } = splitFicha(PV151_GRADE, PV151_CAPACITY);

    expect(asMap(sobra)).toEqual({ '28': 2, '29': 1 });
    expect(asMap(colmeia)).toEqual({ '29': 1, '30': 2, '31': 2, '32': 3, '33': 2, '34': 2 });
    expect(colmeia.reduce((s, g) => s + g.qty, 0)).toBe(12);
    expect(sobra.reduce((s, g) => s + g.qty, 0)).toBe(3);
  });

  it('parte uma numeração ao meio quando precisa (o nº 29 do PV-00151)', () => {
    const { colmeia, sobra } = splitFicha(PV151_GRADE, PV151_CAPACITY);
    expect(sobra.find((g) => g.size === '29')?.qty).toBe(1);
    expect(colmeia.find((g) => g.size === '29')?.qty).toBe(1);
  });

  it('NÃO tira do maior — trava a inversão da regra', () => {
    const { sobra } = splitFicha(PV151_GRADE, PV151_CAPACITY);
    // A leitura errada ("sai a numeração de contagem ímpar") daria 32:3.
    expect(asMap(sobra)).not.toEqual({ '32': 3 });
    expect(sobra.some((g) => g.size === '34')).toBe(false);
  });

  it('cabe tudo → sem sobra, colmeia parcial', () => {
    const { colmeia, sobra } = splitFicha({ '30': 2, '31': 2 }, 12);
    expect(sobra).toEqual([]);
    expect(colmeia.reduce((s, g) => s + g.qty, 0)).toBe(4);
  });

  it('capacidade inválida estoura em vez de assumir default', () => {
    expect(() => splitFicha(PV151_GRADE, 0)).toThrow(/Capacidade/);
    expect(() => splitFicha(PV151_GRADE, -1)).toThrow(/Capacidade/);
    expect(() => splitFicha(PV151_GRADE, Number.NaN)).toThrow(/Capacidade/);
  });
});

describe('packSaleOrderItem — PV-00151, o caso que o dono descreveu', () => {
  const boxes = packSaleOrderItem({
    grade: PV151_GRADE,
    fichas: PV151_FICHAS,
    capacity: PV151_CAPACITY,
  });

  it('gera 12 colmeias + 3 caixas de numeração única', () => {
    expect(boxes.filter((b) => b.kind === 'grade')).toHaveLength(12);
    expect(boxes.filter((b) => b.kind === 'single')).toHaveLength(3);
    expect(boxes).toHaveLength(15);
  });

  it('as caixas de sobra são 2 do nº 28 e 1 do nº 29, cheias', () => {
    const singles = boxes.filter((b) => b.kind === 'single');
    expect(singles.map((b) => b.size)).toEqual(['28', '28', '29']);
    expect(singles.every((b) => b.pairs === 12)).toBe(true);
    expect(singles.every((b) => b.partial === false)).toBe(true);
  });

  it('cada caixa de sobra tem UMA numeração só', () => {
    for (const box of boxes.filter((b) => b.kind === 'single')) {
      expect(box.contents).toHaveLength(1);
      expect(box.contents[0].size).toBe(box.size);
      expect(box.contents[0].qty).toBe(box.pairs);
    }
  });

  it('nenhum par fica fora de caixa', () => {
    const packed = boxes.reduce((s, b) => s + b.pairs, 0);
    expect(packed).toBe(PV151_FICHAS * gradeTotal(PV151_GRADE));
    expect(packed).toBe(180);
  });

  it('o PV inteiro (3 cores) fecha 45 volumes e 540 pares', () => {
    const doPedido = ['OFF WHITE', 'ROSADO', 'PRETO'].flatMap(() =>
      packSaleOrderItem({ grade: PV151_GRADE, fichas: PV151_FICHAS, capacity: PV151_CAPACITY }),
    );
    expect(doPedido).toHaveLength(45);
    expect(doPedido.reduce((s, b) => s + b.pairs, 0)).toBe(540);
  });
});

describe('packSaleOrderItem — invariantes gerais', () => {
  const CURVAS: { nome: string; grade: GradeInput; capacity: number; fichas: number }[] = [
    { nome: 'PV-00151', grade: PV151_GRADE, capacity: 12, fichas: 12 },
    { nome: 'ficha 18', grade: { '34': 3, '35': 3, '36': 3, '37': 3, '38': 3, '39': 3 }, capacity: 12, fichas: 5 },
    { nome: 'ficha 12 exata', grade: { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 }, capacity: 12, fichas: 7 },
    { nome: 'menor que a caixa', grade: { '38': 4 }, capacity: 12, fichas: 3 },
    { nome: 'numeração única', grade: { '40': 20 }, capacity: 12, fichas: 1 },
    { nome: 'curva irregular', grade: { '28': 1, '29': 4, '30': 2, '31': 5, '32': 2 }, capacity: 10, fichas: 9 },
  ];

  for (const { nome, grade, capacity, fichas } of CURVAS) {
    describe(nome, () => {
      const boxes = packSaleOrderItem({ grade, fichas, capacity });

      it('conserva o total de pares', () => {
        expect(boxes.reduce((s, b) => s + b.pairs, 0)).toBe(fichas * gradeTotal(grade));
      });

      it('nenhuma caixa passa da capacidade', () => {
        expect(boxes.every((b) => b.pairs <= capacity)).toBe(true);
      });

      it('nenhuma caixa fica vazia', () => {
        expect(boxes.every((b) => b.pairs > 0)).toBe(true);
      });

      it('pairs sempre bate com o conteúdo', () => {
        for (const b of boxes) {
          expect(b.contents.reduce((s, g) => s + g.qty, 0)).toBe(b.pairs);
        }
      });

      it('flag partial é coerente com a capacidade', () => {
        for (const b of boxes) expect(b.partial).toBe(b.pairs < capacity);
      });

      it('caixa de sobra nunca mistura numeração', () => {
        for (const b of boxes.filter((x) => x.kind === 'single')) {
          expect(b.contents).toHaveLength(1);
        }
      });
    });
  }

  it('caixa parcial de sobra continua sendo 1 volume', () => {
    // 2 fichas × sobra 3 = 6 pares → 1 caixa com 6 (não some, não vira 6 volumes).
    const boxes = packSaleOrderItem({ grade: PV151_GRADE, fichas: 2, capacity: 12 });
    const singles = boxes.filter((b) => b.kind === 'single');
    expect(singles.reduce((s, b) => s + b.pairs, 0)).toBe(6);
    expect(singles.every((b) => b.partial)).toBe(true);
    expect(singles.length).toBe(2); // 28:4 e 29:2 — uma caixa por numeração
  });

  it('grade que NÃO é ficha declina, pra não fabricar caixa quase vazia', () => {
    // PV-2026-00097: fichas=1 com a grade somando o pedido inteiro (24 pares,
    // caixa de 12). Aplicar a regra daria 1 colmeia + 3 caixas de 4 pares em
    // vez de 2 caixas cheias — por isso ela declina e o chamador usa CEIL.
    const grade00097 = { '25': 4, '26': 4, '27': 4, '28': 4, '29': 2, '30': 2, '31': 2, '32': 2 };
    expect(gradeTotal(grade00097)).toBe(24);
    expect(packingApplies(grade00097, 12)).toBe(false);
    expect(packSaleOrderItem({ grade: grade00097, fichas: 1, capacity: 12 })).toEqual([]);

    // PV-2026-00013: 120 pares numa única "ficha".
    expect(packingApplies({ '34': 10, '35': 20, '36': 30, '37': 30, '38': 20, '39': 10 }, 12)).toBe(false);
  });

  it('a fronteira da guarda é 2× a capacidade', () => {
    expect(packingApplies({ '38': 23 }, 12)).toBe(true);   // 23 < 24
    expect(packingApplies({ '38': 24 }, 12)).toBe(false);  // 24 não é < 24
    expect(packingApplies(PV151_GRADE, 12)).toBe(true);    // 15 < 24
    expect(packingApplies({ '38': 18 }, 12)).toBe(true);   // ficha de 18
  });

  it('sem fichas ou sem grade não gera caixa', () => {
    expect(packSaleOrderItem({ grade: PV151_GRADE, fichas: 0, capacity: 12 })).toEqual([]);
    expect(packSaleOrderItem({ grade: {}, fichas: 12, capacity: 12 })).toEqual([]);
    expect(packSaleOrderItem({ grade: null, fichas: 12, capacity: 12 })).toEqual([]);
  });

  it('as colmeias de um item não compartilham o mesmo array de conteúdo', () => {
    const boxes = packSaleOrderItem({ grade: PV151_GRADE, fichas: 3, capacity: 12 });
    const [a, b] = boxes.filter((x) => x.kind === 'grade');
    a.contents[0].qty = 999;
    expect(b.contents[0].qty).not.toBe(999);
  });
});

describe('boxWeightKg', () => {
  const box = packSaleOrderItem({ grade: PV151_GRADE, fichas: 12, capacity: 12 })
    .find((b) => b.kind === 'single')!;

  it('usa o peso da ficha técnica quando existe', () => {
    expect(boxWeightKg(box, { pairWeightKg: 0.3, boxTareKg: 0.1 })).toBeCloseTo(12 * 0.3 + 0.1, 6);
  });

  it('cai no default de 238 g só quando a ficha não tem peso', () => {
    expect(boxWeightKg(box, { pairWeightKg: null, boxTareKg: 0.1 }))
      .toBeCloseTo(12 * DEFAULT_PAIR_WEIGHT_KG + 0.1, 6);
    expect(boxWeightKg(box, { pairWeightKg: 0, boxTareKg: 0.1 }))
      .toBeCloseTo(12 * DEFAULT_PAIR_WEIGHT_KG + 0.1, 6);
  });

  it('PV-00151 fecha 133,02 kg brutos no default', () => {
    const todas = ['OFF WHITE', 'ROSADO', 'PRETO'].flatMap(() =>
      packSaleOrderItem({ grade: PV151_GRADE, fichas: 12, capacity: 12 }),
    );
    const bruto = todas.reduce((s, b) => s + boxWeightKg(b, { boxTareKg: 0.1 }), 0);
    expect(bruto).toBeCloseTo(540 * DEFAULT_PAIR_WEIGHT_KG + 45 * 0.1, 6);
    expect(bruto).toBeCloseTo(133.02, 2);
  });
});

/**
 * Modo NUMERAÇÃO ÚNICA (11/08/2026) — caixa fechada com um número só.
 *
 * A garantia que sustenta a decisão do dono ("não muda a quantidade de volumes")
 * é a última asserção: mesma contagem de caixas do modo grade. Se ela cair, NF-e
 * e débito de embalagem passam a divergir da carga física.
 */
describe('packSaleOrderItemBySize — caixa fechada por numeração', () => {
  // Curva real do PV-00151, com fichas múltiplo de 12: fecha redondo.
  const grade = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 }; // 12/ficha
  const fichas = 12;
  const capacity = 12;

  const caixas = () => packSaleOrderItemBySize({ grade, fichas, capacity });

  it('toda caixa leva UMA numeração só', () => {
    for (const box of caixas()) {
      expect(box.kind).toBe('single');
      expect(box.contents).toHaveLength(1);
      expect(box.contents[0].size).toBe(box.size);
    }
  });

  it('nenhum par fica fora de caixa', () => {
    const total = Object.values(grade).reduce((s, q) => s + q, 0) * fichas;
    expect(caixas().reduce((s, b) => s + b.pairs, 0)).toBe(total);
  });

  it('nenhuma caixa passa da capacidade, e nenhuma viaja pela metade', () => {
    for (const box of caixas()) {
      expect(box.pairs).toBeLessThanOrEqual(capacity);
      expect(box.partial).toBe(false);
    }
  });

  it('MESMA contagem de caixas do modo grade — é o que mantém a NF intacta', () => {
    const modoGrade = packSaleOrderItem({ grade, fichas, capacity });
    expect(caixas()).toHaveLength(modoGrade.length);
  });

  it('a numeração mais pedida rende mais caixas (nº 37: 3×12 = 36 pares = 3 caixas)', () => {
    const doTrinta7 = caixas().filter(b => b.size === '37');
    expect(doTrinta7).toHaveLength(3);
  });

  it('declina quando NÃO fecha redondo, em vez de inventar caixa parcial', () => {
    // PV-00144 real: 65 fichas não é múltiplo de 12.
    expect(packSaleOrderItemBySize({ grade, fichas: 65, capacity })).toEqual([]);
  });
});

describe('singleSizeMisfits — o aviso do PV', () => {
  const grade = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };

  it('aprova quando cada numeração fecha caixa cheia', () => {
    expect(singleSizeMisfits({ grade, fichas: 12, capacity: 12 })).toEqual([]);
    expect(singleSizePackingFits({ grade, fichas: 12, capacity: 12 })).toBe(true);
  });

  it('acusa o PV-00144 com os números que a mensagem precisa mostrar', () => {
    const faltas = singleSizeMisfits({ grade, fichas: 65, capacity: 12 });
    expect(faltas.map(f => f.size)).toEqual(['34', '35', '36', '37', '38', '39', '40']);
    // nº 37: 3 × 65 = 195 pares, 16 caixas cheias e 3 sobrando.
    const n37 = faltas.find(f => f.size === '37')!;
    expect(n37.pairs).toBe(195);
    expect(n37.remainder).toBe(3);
  });

  it('acusa só a numeração problemática quando as outras fecham', () => {
    // 36 fichas: o nº 35 (2×36=72) fecha; um nº com 1 par (36) não.
    const faltas = singleSizeMisfits({ grade: { '35': 2, '36': 1 }, fichas: 36, capacity: 24 });
    expect(faltas.map(f => f.size)).toEqual(['36']);
  });

  it('capacidade inválida não vira falso positivo', () => {
    expect(singleSizeMisfits({ grade, fichas: 12, capacity: 0 })).toEqual([]);
  });
});
