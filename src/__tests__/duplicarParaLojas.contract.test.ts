import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrato: o fluxo de duplicação em /sales usa o wizard
 * DuplicateToStoresDialog (não o dialog inline legado) e o label
 * "Duplicar para lojas".
 */
describe('duplicar para lojas — contrato SaleOrders', () => {
  const saleOrders = readFileSync(join(process.cwd(), 'src/pages/SaleOrders.tsx'), 'utf8');
  const dialog = readFileSync(
    join(process.cwd(), 'src/components/sales/DuplicateToStoresDialog.tsx'),
    'utf8',
  );
  const paintList = readFileSync(
    join(process.cwd(), 'src/components/sales/PaintSelectList.tsx'),
    'utf8',
  );

  it('SaleOrders monta DuplicateToStoresDialog', () => {
    expect(saleOrders).toContain("from '@/components/sales/DuplicateToStoresDialog'");
    expect(saleOrders).toContain('<DuplicateToStoresDialog');
    expect(saleOrders).not.toContain('Duplicar por Grupo Econômico');
    expect(saleOrders).toContain('title="Duplicar para lojas"');
  });

  it('wizard tem 2 passos e CTA N lojas · M itens', () => {
    expect(dialog).toContain('Passo {step} de 2');
    expect(dialog).toContain('Duplicar · {selectedClientIds.length}');
    expect(dialog).toContain('requireSearchToList={!groupId}');
  });

  it('PaintSelectList só marca no arraste e seleciona só visíveis', () => {
    expect(paintList).toContain('Selecionar filtradas');
    expect(paintList).toContain('Arrastar nunca desmarca');
    expect(paintList).toContain('addIds(selectedIds, visibleIds)');
  });

  it('SaleOrderFormPanel reusa paint-select nos itens (Copiar p/ novo PV)', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/components/sale-orders/SaleOrderFormPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('onPaintSelect');
    expect(panel).toContain('paintSelectItem');
    expect(panel).toContain('Paint-select (mesmo contrato do Duplicar para lojas)');
  });
});
