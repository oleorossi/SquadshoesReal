import { describe, expect, it } from 'vitest';
import { parseWidthMm, widthLeafName } from '@/lib/createWidthLeafGroup';

describe('createWidthLeafGroup helpers', () => {
  it('normaliza mm e monta o nome curto canônico', () => {
    expect(parseWidthMm('20')).toBe(20);
    expect(parseWidthMm('20,4')).toBe(20);
    expect(parseWidthMm(25.2)).toBe(25);
    expect(parseWidthMm(0)).toBeNull();
    expect(parseWidthMm('')).toBeNull();
    expect(widthLeafName(20)).toBe('20MM');
    expect(widthLeafName(25)).toBe('25MM');
  });
});
