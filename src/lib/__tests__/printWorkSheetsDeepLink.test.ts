import { describe, expect, it } from 'vitest';
import { caixaPrintPath, fardoPrintPath, parsePrintFormatParam } from '../printWorkSheetsDeepLink';

describe('parsePrintFormatParam', () => {
  it('reconhece fardo e aliases', () => {
    expect(parsePrintFormatParam('fardo')).toBe('fardo');
    expect(parsePrintFormatParam('Fardo')).toBe('fardo');
    expect(parsePrintFormatParam('cartao-fisico')).toBe('fardo');
    expect(parsePrintFormatParam('montador')).toBe('montador');
    expect(parsePrintFormatParam('caixa')).toBe('caixa');
    expect(parsePrintFormatParam('a4')).toBeNull();
    expect(parsePrintFormatParam(null)).toBeNull();
    expect(parsePrintFormatParam('')).toBeNull();
  });
});

describe('fardoPrintPath', () => {
  it('abre a prévia já no formato Fardo, setor Palmilha', () => {
    const path = fardoPrintPath(['aaa', 'bbb']);
    expect(path).toContain('/imprimir-fichas?');
    expect(path).toContain('orderIds=aaa,bbb');
    expect(path).toContain('format=fardo');
    expect(path).toContain(`sectors=${encodeURIComponent('Palmilha')}`);
  });
});

describe('caixaPrintPath', () => {
  it('abre a prévia já no formato Caixa, setor Palmilha', () => {
    const path = caixaPrintPath(['aaa', 'bbb']);
    expect(path).toContain('/imprimir-fichas?');
    expect(path).toContain('orderIds=aaa,bbb');
    expect(path).toContain('format=caixa');
    expect(path).toContain(`sectors=${encodeURIComponent('Palmilha')}`);
  });
});
