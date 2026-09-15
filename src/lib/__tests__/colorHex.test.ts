import { describe, expect, it } from 'vitest';
import { resolveColorHex } from '@/lib/colorHex';

describe('resolveColorHex', () => {
  it('resolve cores comerciais da fábrica', () => {
    expect(resolveColorHex('ROSADO')).toBe('#e8b8b0');
    expect(resolveColorHex('PRETO')).toBe('#1a1a1a');
    expect(resolveColorHex('OFF WHITE')).toBe('#f5f0e8');
  });

  it('normaliza acento e cai no neutro quando desconhecida', () => {
    expect(resolveColorHex('Café')).toBe('#3d2418');
    expect(resolveColorHex('COR INVENTADA')).toBe('#9aa3ae');
    expect(resolveColorHex(null)).toBe('#9aa3ae');
  });
});
