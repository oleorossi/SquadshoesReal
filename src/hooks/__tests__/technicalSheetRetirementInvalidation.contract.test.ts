import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../useTechnicalSheets.ts'), 'utf8');

function exportedFunctionSource(name: string, nextName: string): string {
  const start = source.indexOf(`export function ${name}(`);
  const end = source.indexOf(`export function ${nextName}(`, start + 1);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextName} ausente`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('useDeleteSheet · invalidação após aposentadoria', () => {
  const hook = exportedFunctionSource('useDeleteSheet', 'useAddSheetMaterial');

  it('invalida os motores de consumo derivados da ficha', () => {
    for (const queryKey of [
      'materials_per_pv',
      'pv-consumption',
      'consumption-source',
    ]) {
      expect(hook).toContain(`queryKey: ['${queryKey}']`);
    }
  });

  it('invalida demanda, produção e operações de tiras e ordens de serviço', () => {
    for (const queryKey of [
      'artisanal-strap-demands',
      'artisanal-strap-production',
      'artisanal-strap-external-operations',
      'strap-contractor-operations',
      'strap_stock_lines_preview',
      'service_orders',
    ]) {
      expect(hook).toContain(`queryKey: ['${queryKey}']`);
    }
  });
});
