import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const source = readFileSync(resolve(
  ROOT,
  'src/components/artisanal-straps/ArtisanalStrapEditor.tsx',
), 'utf8');

describe('código de cor do fornecedor no editor de tiras', () => {
  it('carrega e envia o valor explícito junto do produto especializado', () => {
    expect(source).toContain("supplierColorCode: product?.supplier_color_code || ''");
    expect(source).toContain('supplier_color_code: form.supplierColorCode.trim() || null');
    expect(source).toContain('Código da cor no fornecedor');
    expect(source).toContain('disabled={readOnly || !form.supplierId}');
  });

  it('limpa o código quando o fornecedor muda e não promete inferência entre cores', () => {
    expect(source).toContain("supplierColorCode: supplierId === current.supplierId");
    expect(source).toContain('supplierColorCode: value === current.colorId');
    expect(source).toContain(": ''");
    expect(source).toContain('não é copiado para outras cores');
  });
});
