import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrato: o fluxo de duplicação em /sales usa DuplicateToStoresDialog
 * multi-lote (quadro + sheet), não o dialog inline legado.
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
  const lib = readFileSync(join(process.cwd(), 'src/lib/duplicateToStores.ts'), 'utf8');

  it('SaleOrders monta DuplicateToStoresDialog', () => {
    expect(saleOrders).toContain("from '@/components/sales/DuplicateToStoresDialog'");
    expect(saleOrders).toContain('<DuplicateToStoresDialog');
    expect(saleOrders).not.toContain('Duplicar por Grupo Econômico');
    expect(saleOrders).toContain('title="Duplicar para lojas"');
  });

  it('multi-lote: quadro + sheet Lojas→Itens + Duplicar tudo', () => {
    expect(dialog).toContain("view === 'board'");
    expect(dialog).toContain("view === 'sheet'");
    expect(dialog).toContain('Duplicar tudo');
    expect(dialog).toContain('Adicionar lote');
    expect(dialog).toContain('createEmptyBatch');
    expect(dialog).toContain('validateDupBatches');
    expect(dialog).toContain('expandBatchesToJobs');
    expect(dialog).toContain('storesTakenByOtherBatches');
    expect(dialog).toContain('removeClientsFromBatches');
    expect(dialog).toContain('Concluir lote');
  });

  it('lote novo começa sem itens; loja em outro lote some da lista', () => {
    expect(lib).toContain('itemIds: []');
    expect(dialog).toContain('takenByOthers.has(c.id)');
    expect(dialog).toContain('ocultas');
  });

  it('passo de itens agrupa referência, amplia modal e mostra foto', () => {
    expect(dialog).toContain('sortDuplicateItemsByReference');
    expect(dialog).toContain('sm:max-w-4xl');
    expect(dialog).toContain('reference_color_variants');
    expect(dialog).toContain('imageUrl:');
    expect(dialog).toContain('listClassName="max-h-[min(55vh,28rem)]"');
  });

  it('aviso âmbar de reserva só no quadro', () => {
    expect(dialog).toContain("view === 'board' && (");
    expect(dialog).toContain('A duplicação reservará insumos novamente');
    // Não no sheet de itens (banner só no bloco board)
    const boardIdx = dialog.indexOf("view === 'board'");
    const amberIdx = dialog.indexOf('A duplicação reservará insumos novamente');
    expect(amberIdx).toBeGreaterThan(boardIdx);
  });

  it('PaintSelectList só marca no arraste e seleciona só visíveis', () => {
    expect(paintList).toContain('Selecionar filtradas');
    expect(paintList).toContain('Arrastar nunca desmarca');
    expect(paintList).toContain('addIds(selectedIds, visibleIds)');
  });

  it('PaintSelectList renderiza miniatura quando imageUrl é passado', () => {
    expect(paintList).toContain('imageUrl');
    expect(paintList).toContain('SignedImage');
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
