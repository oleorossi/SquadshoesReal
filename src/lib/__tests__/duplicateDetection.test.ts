import { describe, it, expect } from 'vitest';
import { findDuplicate, normalizeForCompare, levenshtein } from '../duplicateDetection';
import type { Product } from '@/types/inventory';

const NAPA_SOFT = 'g-napa-soft';
const TIRA = 'g-tira';

/** Produto mínimo — só os campos que a cascata lê. */
const p = (over: Partial<Product> & { id: string }): Product => ({
  name: '', sku: '', color: '', group_id: null, quantity: 0, active: true,
  ...over,
} as Product);

// Espelha o estoque real citado no spec.
const ESTOQUE: Product[] = [
  p({ id: '1', name: 'NAPA SOFT', color: 'CAPPUCCINO', sku: '2237', group_id: NAPA_SOFT, quantity: 66.06 }),
  p({ id: '2', name: 'NAPA SOFT', color: 'PRETO', sku: '5207', group_id: NAPA_SOFT, quantity: 89.88 }),
  p({ id: '3', name: 'NAPA SOFT', color: 'NUDE', sku: 'NAPA-SOFT-NUDE', group_id: NAPA_SOFT, quantity: 0 }),
  p({ id: '4', name: 'NAPA ONÇA', color: '', sku: '2312312', group_id: NAPA_SOFT, quantity: 3 }),
  p({ id: '5', name: 'Tira Overlock 5mm', color: 'PRETO', sku: 'OVL', group_id: TIRA, quantity: 0 }),
  p({ id: '6', name: 'INATIVO ANTIGO', color: 'VERDE', sku: 'INA-1', group_id: TIRA, active: false }),
];

describe('normalizeForCompare', () => {
  it('ignora acento, caixa, pontuação e espaço repetido', () => {
    expect(normalizeForCompare('Café  Brûlée')).toBe('cafe brulee');
    expect(normalizeForCompare('NAPA-SOFT')).toBe('napa soft');
  });
});

describe('levenshtein', () => {
  it('mede a distância de typos curtos', () => {
    expect(levenshtein('capuccino', 'cappuccino')).toBe(1);
    expect(levenshtein('couro', 'coura')).toBe(1);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
});

describe('findDuplicate — o caso que originou a feature', () => {
  it('sugere CAPPUCCINO ao cadastrar CAPUCCINO no mesmo grupo', () => {
    const hit = findDuplicate(
      { name: 'NAPA SOFT', color: 'CAPUCCINO', sku: 'NOVO-1', group_id: NAPA_SOFT },
      ESTOQUE,
    );
    expect(hit?.reason).toBe('fuzzy_color');
    expect(hit?.product.id).toBe('1');
  });

  it('sugere a cor ZERADA, que a lista esconde por padrão (R1.4)', () => {
    const hit = findDuplicate(
      { name: 'NAPA SOFT', color: 'NUDE', sku: 'NOVO-2', group_id: NAPA_SOFT },
      ESTOQUE,
    );
    expect(hit?.product.id).toBe('3');
  });

  it('enxerga produto INATIVO (R1.5)', () => {
    const hit = findDuplicate(
      { name: 'INATIVO ANTIGO', color: 'VERDE', sku: 'X', group_id: TIRA },
      ESTOQUE,
    );
    expect(hit?.product.id).toBe('6');
  });
});

describe('findDuplicate — alcance por eixo (R2)', () => {
  it('NÃO sugere quando a mesma cor existe em OUTRO grupo (R2.4)', () => {
    // PRETO existe na napa e na tira; isso é normal, não duplicata.
    const hit = findDuplicate(
      { name: 'Tira Overlock 5mm 20mm', color: 'PRETO', sku: 'NOVO-3', group_id: TIRA },
      // remove a própria tira PRETO pra isolar: só o PRETO da napa sobra
      ESTOQUE.filter(x => x.id !== '5'),
    );
    expect(hit?.reason).not.toBe('fuzzy_color');
  });

  it('sugere SKU repetido em qualquer grupo (R2.1)', () => {
    const hit = findDuplicate(
      { name: 'MATERIAL NOVO XYZ', color: 'AZUL', sku: '5207', group_id: TIRA },
      ESTOQUE,
    );
    expect(hit?.reason).toBe('sku');
    expect(hit?.product.id).toBe('2');
  });

  it('sugere o mesmo NOME cadastrado em outro grupo (R2.2)', () => {
    const hit = findDuplicate(
      { name: 'NAPA SOFT', color: 'AZUL', sku: 'NOVO-4', group_id: TIRA },
      ESTOQUE,
    );
    expect(hit?.reason).toBe('cross_group');
  });

  it('sugere typo de NOME mesmo em outro grupo (R2.2)', () => {
    const hit = findDuplicate(
      { name: 'NAPA SOFTE', color: 'AZUL', sku: 'NOVO-5', group_id: TIRA },
      ESTOQUE,
    );
    expect(hit?.reason).toBe('fuzzy');
  });

  it('NÃO acusa nome repetido com cor diferente no mesmo grupo (R2.5)', () => {
    // Grupo que varia por cor repete o nome de propósito.
    const hit = findDuplicate(
      { name: 'NAPA SOFT', color: 'TURQUESA', sku: 'NOVO-6', group_id: NAPA_SOFT },
      ESTOQUE,
    );
    expect(hit).toBeNull();
  });
});

describe('findDuplicate — bordas', () => {
  it('nome vazio não busca nada', () => {
    expect(findDuplicate({ name: '   ', group_id: NAPA_SOFT }, ESTOQUE)).toBeNull();
  });

  it('na edição, o próprio produto não é a própria duplicata', () => {
    const hit = findDuplicate(
      { id: '1', name: 'NAPA SOFT', color: 'CAPPUCCINO', sku: '2237', group_id: NAPA_SOFT },
      ESTOQUE,
    );
    expect(hit).toBeNull();
  });

  it('cor com menos de 4 letras não entra no fuzzy de cor', () => {
    const curto: Product[] = [p({ id: 'a', name: 'X', color: 'RED', group_id: NAPA_SOFT })];
    const hit = findDuplicate({ name: 'Y', color: 'RET', group_id: NAPA_SOFT }, curto);
    expect(hit?.reason).not.toBe('fuzzy_color');
  });
});
