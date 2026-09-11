import { describe, expect, it } from 'vitest';
import {
  clientOrderLineSkuKey,
  defaultPatternForKey,
  isClientLabelPatternKey,
  normalizeClientLabelPattern,
  patternLabel,
} from '@/lib/clientLabelPattern';

describe('clientLabelPattern', () => {
  it('default Objetiva usa prefixo PU/SO e motto DEUS É FIEL', () => {
    const pattern = defaultPatternForKey('objetiva');
    expect(pattern.key).toBe('objetiva');
    expect(pattern.branding.materialPrefix).toBe('PU/SO');
    expect(pattern.branding.motto).toBe('DEUS É FIEL');
    expect(pattern.geometry.columns).toBe(1);
  });

  it('default Baby Nalin usa geometria 2 colunas L42PRO', () => {
    const pattern = defaultPatternForKey('baby_nalin');
    expect(pattern.key).toBe('baby_nalin');
    expect(pattern.geometry.columns).toBe(2);
    expect(pattern.geometry.labelWidthMm).toBe(50);
  });

  it('normalizeClientLabelPattern sempre devolve contrato v1', () => {
    const fromNull = normalizeClientLabelPattern(null);
    expect(fromNull.key).toBe('baby_nalin');
    expect(fromNull.version).toBe(1);

    const objetiva = normalizeClientLabelPattern({ key: 'objetiva', geometry: {}, branding: {} });
    expect(objetiva.key).toBe('objetiva');
    expect(objetiva.branding.materialPrefix).toBe('PU/SO');

    const patched = normalizeClientLabelPattern({
      key: 'objetiva',
      geometry: { labelWidthMm: 40, columns: 2 },
      branding: { motto: 'CUSTOM', materialPrefix: 'PVC' },
    });
    expect(patched.geometry.labelWidthMm).toBe(40);
    expect(patched.geometry.columns).toBe(2);
    expect(patched.branding.motto).toBe('CUSTOM');
    expect(patched.branding.materialPrefix).toBe('PVC');
  });

  it('isClientLabelPatternKey e patternLabel cobrem os layouts', () => {
    expect(isClientLabelPatternKey('baby_nalin')).toBe(true);
    expect(isClientLabelPatternKey('objetiva')).toBe(true);
    expect(isClientLabelPatternKey('outro')).toBe(false);
    expect(patternLabel('baby_nalin')).toBe('Nalin');
    expect(patternLabel('objetiva')).toBe('Objetiva');
  });

  it('clientOrderLineSkuKey inclui ref/cor/tamanho/código', () => {
    expect(
      clientOrderLineSkuKey({
        tamanho: '33',
        cor: 'PRETO',
        referencia: '112334',
        codProduto: '112334',
        codigoBarra: '112334',
        quantidade: 1,
      }),
    ).toContain('112334');
  });
});
