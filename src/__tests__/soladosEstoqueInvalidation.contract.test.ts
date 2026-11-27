import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const DIALOG = read('src/components/inventory/SoladoGradeDialog.tsx');
const HOOK = read('src/hooks/useSoleStockMatrix.ts');
const HUB = read('src/pages/SolesHub.tsx');
const ESTOQUE = read('src/components/soles-hub/SolesEstoqueTab.tsx');
const HISTORICO = read('src/components/soles-hub/SolesHistoricoTab.tsx');
const CONSUMOS = read('src/components/soles-hub/SolesConsumosTab.tsx');
const MATRIX = read('src/components/soles-hub/SoleStockMatrix.tsx');

describe('invalidação da matriz de estoque após Editar estoque', () => {
  it('exporta helper que invalida matriz, pedidos, cadastro e histórico', () => {
    expect(HOOK).toContain('export function invalidateSoleStockQueries');
    for (const key of [
      'sole-stock-matrix',
      'sole-stock-orders',
      'products',
      'soles_hub_products',
      'soles_history',
    ]) {
      expect(HOOK, `helper sem ${key}`).toContain(`queryKey: ['${key}']`);
    }
  });

  it('Salvar Grade no modal invalida a matriz na hora (sem depender de F5)', () => {
    expect(DIALOG).toContain("from '@/hooks/useSoleStockMatrix'");
    expect(DIALOG).toContain('invalidateSoleStockQueries(queryClient)');
    const saveIdx = DIALOG.indexOf('adjustProductsStock');
    const invalidateIdx = DIALOG.indexOf('invalidateSoleStockQueries(queryClient)');
    expect(saveIdx).toBeGreaterThan(0);
    expect(invalidateIdx, 'invalidação precisa rodar depois do save').toBeGreaterThan(saveIdx);
  });
});

describe('/solados lê stock_grade / quantity, nunca current_stock', () => {
  it('nenhuma superfície da tela /solados lê current_stock', () => {
    const surfaces = [HUB, ESTOQUE, HISTORICO, CONSUMOS, MATRIX, DIALOG, HOOK];
    for (const src of surfaces) {
      expect(src).not.toMatch(/\bcurrent_stock\b/);
    }
  });

  it('lista, cabeçalho e modal somam stock_grade / quantity', () => {
    expect(HUB).toMatch(/gradeTotal\(selected\.stock_grade\)/);
    expect(HUB).toMatch(/gradeTotal\(sole\.stock_grade\)/);
    expect(HOOK).toContain('sole_stock_matrix');
    expect(ESTOQUE).toContain('SoleStockMatrix');
    expect(DIALOG).toMatch(/product\.quantity/);
    expect(DIALOG).toMatch(/stock_grade/);
  });
});
