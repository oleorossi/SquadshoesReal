import { buyReadyStrapDescription, buyReadyStrapRequiredM } from '@/lib/buyReadyStrap';

describe('tira Comprar pronto — metros pela grade (D5)', () => {
  it('OB01 do print: 108 cm/par × (12 pares × 35 fichas) = 453,6 m', () => {
    const line = {
      consumption: 108,
      consumption_per_size: { 34: 108, 35: 108, 36: 108, 37: 108, 38: 108, 39: 108, 40: 108 },
    };
    const grade = { 35: 1, 36: 3, 37: 4, 38: 2, 39: 2 };
    expect(buyReadyStrapRequiredM(line, grade, 35)).toBeCloseTo(453.6, 4);
  });

  it('usa o cm da numeração e cai no escalar quando a numeração não tem valor próprio', () => {
    const line = { consumption: 100, consumption_per_size: { 34: 120 } };
    // 34: 120 × 2 + 35: 100 × 1 = 340 cm por ficha × 2 fichas = 6,8 m
    expect(buyReadyStrapRequiredM(line, { 34: 2, 35: 1 }, 2)).toBeCloseTo(6.8, 4);
  });

  it('ignora chaves de metadado da grade e numerações zeradas', () => {
    const line = { consumption: 100 };
    expect(buyReadyStrapRequiredM(line, { _meta: 9, 34: 0, 35: 1 }, 1)).toBeCloseTo(1, 4);
  });

  it('sem grade ou sem fichas → 0', () => {
    expect(buyReadyStrapRequiredM({ consumption: 100 }, null, 3)).toBe(0);
    expect(buyReadyStrapRequiredM({ consumption: 100 }, { 34: 1 }, 0)).toBe(0);
  });

  it('descreve tira · napa · cor e omite o que falta (strass sem napa)', () => {
    expect(buyReadyStrapDescription({
      strapName: 'TIRA OVERLOCK 5 mm', napaName: 'NAPA SOFT', colorName: 'ROSADO',
    })).toBe('TIRA OVERLOCK 5 mm · NAPA SOFT · ROSADO');
    expect(buyReadyStrapDescription({
      strapName: 'TIRA STRASS 6 mm', napaName: null, colorName: 'CRISTAL COM FUNDO BRANCO',
    })).toBe('TIRA STRASS 6 mm · CRISTAL COM FUNDO BRANCO');
  });
});
