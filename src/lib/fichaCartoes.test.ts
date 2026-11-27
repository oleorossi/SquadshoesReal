import { describe, expect, it } from 'vitest';
import {
  chunkCartaoMontadorPages,
  CARTAO_MONTADOR_PER_PAGE,
  formatFichaCounter,
  isFichaCartaoCodigo,
  planFichaCartoes,
} from './fichaCartoes';

describe('planFichaCartoes', () => {
  it('quebra um pedido exato em fichas cheias de 12, sem sobra', () => {
    const grade = { '35': 10, '36': 30, '37': 40, '38': 20, '39': 20 };
    const plan = planFichaCartoes(120, grade);
    expect(plan).toHaveLength(10);
    expect(plan.every((c) => !c.is_sobra && c.pares === 12 && c.ficha_size === 12)).toBe(true);
    expect(plan[0].total_fichas).toBe(10);
    expect(plan[0].ficha_index).toBe(1);
    expect(plan[9].ficha_index).toBe(10);
    expect(plan[0].grade).toEqual({ '35': 1, '36': 3, '37': 4, '38': 2, '39': 2 });
  });

  it('respeita corrugado 15 quando a grade fecha em 15', () => {
    const plan = planFichaCartoes(75, { '35': 15, '36': 15, '37': 15, '38': 15, '39': 15 });
    expect(plan).toHaveLength(5);
    expect(plan[0].ficha_size).toBe(15);
    expect(plan.every((c) => c.pares === 15 && !c.is_sobra)).toBe(true);
  });

  it('emite 1 cartão da sobra quando o total não fecha o corrugado', () => {
    const plan = planFichaCartoes(125, { '35': 11, '36': 30, '37': 40, '38': 24, '39': 20 });
    expect(plan).toHaveLength(11);
    const full = plan.filter((c) => !c.is_sobra);
    const sobra = plan.filter((c) => c.is_sobra);
    expect(full).toHaveLength(10);
    expect(sobra).toHaveLength(1);
    expect(full[0].pares).toBe(12);
    expect(sobra[0]).toMatchObject({
      ficha_index: 11,
      total_fichas: 11,
      ficha_size: 12,
      pares: 5,
      is_sobra: true,
      grade: {},
    });
    expect(full.reduce((s, c) => s + c.pares, 0) + sobra[0].pares).toBe(125);
  });

  it('curva-base de 12 com total múltiplo não gera sobra', () => {
    const plan = planFichaCartoes(36, { '35': 1, '36': 2, '37': 3, '38': 3, '39': 2, '40': 1 });
    expect(plan).toHaveLength(3);
    expect(plan.every((c) => !c.is_sobra && c.pares === 12)).toBe(true);
  });

  it('total zero ou negativo não gera cartão', () => {
    expect(planFichaCartoes(0, { '35': 12 })).toEqual([]);
    expect(planFichaCartoes(-12, { '35': 12 })).toEqual([]);
  });
});

describe('formatFichaCounter / codigo', () => {
  it('formata 01/75 e 001/120', () => {
    expect(formatFichaCounter(1, 75)).toBe('01/75');
    expect(formatFichaCounter(75, 75)).toBe('75/75');
    expect(formatFichaCounter(3, 120)).toBe('003/120');
  });

  it('reconhece o padrão PM-000001', () => {
    expect(isFichaCartaoCodigo('PM-000001')).toBe(true);
    expect(isFichaCartaoCodigo('PM-1234567')).toBe(true);
    expect(isFichaCartaoCodigo('FC-000001')).toBe(false);
    expect(isFichaCartaoCodigo('pm-000001')).toBe(false);
  });
});

describe('paginação 15/folha', () => {
  it('fatia em páginas de 15 e deixa a sobra na última folha', () => {
    const items = planFichaCartoes(125, { '35': 125 });
    // 125 = 10 cheias de 12 + sobra 5 → 11 cartões (1 folha)
    expect(items).toHaveLength(11);
    const pages = chunkCartaoMontadorPages(items);
    expect(CARTAO_MONTADOR_PER_PAGE).toBe(15);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(11);

    const many = Array.from({ length: 42 }, (_, i) => i);
    const manyPages = chunkCartaoMontadorPages(many);
    expect(manyPages).toHaveLength(3);
    expect(manyPages[0]).toHaveLength(15);
    expect(manyPages[1]).toHaveLength(15);
    expect(manyPages[2]).toHaveLength(12);
  });
});
