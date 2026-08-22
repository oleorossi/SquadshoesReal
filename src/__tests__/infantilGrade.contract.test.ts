import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FICHA = readFileSync(resolve(process.cwd(), 'src/pages/TechnicalSheets.tsx'), 'utf8');
const MOBILE = readFileSync(resolve(process.cwd(), 'src/pages/mobile/MobileNewOrder.tsx'), 'utf8');

describe('grade infantil 21–33', () => {
  it('ficha nova e troca de categoria usam 21-33, não 25-36', () => {
    expect(FICHA).toContain("const CHILD_SIZES = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]");
    expect(FICHA).toContain("v === 'Infantil' ? '21-33'");
    expect(FICHA).toContain('Infantil (21-33)');
    expect(FICHA).not.toContain("v === 'Infantil' ? '25-36'");
  });

  it('PV mobile usa a mesma faixa', () => {
    expect(MOBILE).toContain("const SIZE_RANGE_CHILD = ['21','22','23','24','25','26','27','28','29','30','31','32','33']");
  });
});
