import { describe, it, expect } from 'vitest';
import { compactStrapColors } from '../printLabels';

describe('compactStrapColors — só o que difere da cor do produto', () => {
  it('tira da MESMA cor do produto não aparece (era o caso do PDF de 22/08)', () => {
    expect(compactStrapColors('OFF WHITE', 'TIRA 1:OFF WHITE')).toBe('');
    expect(compactStrapColors('CHAMPAGNE', 'TIRA 4:CHAMPAGNE|TRASEIRA:CHAMPAGNE')).toBe('');
  });

  it('tira em cor diferente APARECE — é distinção real de produção', () => {
    expect(compactStrapColors('OFF WHITE', 'TIRA 1:PRETO')).toBe('PRETO');
  });

  it('não enumera tira por tira: mostra o conjunto distinto', () => {
    expect(compactStrapColors('OFF WHITE', 'TIRA 1:PRETO|TIRA 2:PRETO|TRASEIRA:PRETO')).toBe('PRETO');
  });

  it('mistura: some a igual, fica a diferente', () => {
    expect(compactStrapColors('PRETO', 'TIRA 1:PRETO|TRASEIRA:DOURADO')).toBe('DOURADO');
  });

  it('acima do limite, corta e conta o resto em vez de estourar a largura', () => {
    const label = 'A:VERMELHO|B:AZUL|C:VERDE|D:AMARELO';
    expect(compactStrapColors('PRETO', label)).toBe('VERMELHO · AZUL +2');
    expect(compactStrapColors('PRETO', label, 4)).toBe('VERMELHO · AZUL · VERDE · AMARELO');
  });

  it('compara sem se enganar com caixa e espaço extra', () => {
    expect(compactStrapColors('off  white', 'TIRA 1: OFF WHITE ')).toBe('');
  });

  it('sem tiras, sem cor, entrada vazia — devolve string vazia, não "undefined"', () => {
    expect(compactStrapColors('PRETO')).toBe('');
    expect(compactStrapColors('PRETO', '')).toBe('');
    expect(compactStrapColors('', 'TIRA 1:')).toBe('');
  });

  it('parte sem ":" é tratada como a própria cor', () => {
    expect(compactStrapColors('PRETO', 'DOURADO')).toBe('DOURADO');
  });
});
