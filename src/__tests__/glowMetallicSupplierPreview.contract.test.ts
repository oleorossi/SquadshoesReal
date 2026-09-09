import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const AVAILABILITY = readFileSync(resolve(ROOT, 'src/lib/materialAvailability.ts'), 'utf8');
const DIALOG = readFileSync(
  resolve(ROOT, 'src/components/sale-orders/MaterialPurchaseConfirmDialog.tsx'),
  'utf8',
);

describe('prévia de materiais herda fornecedor do grupo', () => {
  it('enrichMaterialShortages resolve group_suppliers quando o SKU não tem supplier_id', () => {
    expect(AVAILABILITY).toContain("from '@/lib/groupSupplierResolution'");
    expect(AVAILABILITY).toContain('resolveGroupSuppliers(groupIds)');
    expect(AVAILABILITY).toContain('resolveMaterialShortageSupplier');
    // Não pode voltar a olhar só products.supplier_id — foi o furo do GLOW METALIC/Soares.
    expect(AVAILABILITY).not.toMatch(
      /supplier_name:\s*supplier\?\.name\s*\|\|\s*\(product\.is_artisanal/,
    );
  });

  it('o diálogo agrupa por nome do grupo quando o id não casou', () => {
    expect(DIALOG).toContain('purchaseSupplierGroupKey');
    expect(DIALOG).toContain('group.key === NO_SUPPLIER');
    // Agrupar só por supplierId reintroduz o falso "sem fornecedor".
    expect(DIALOG).not.toContain('const key = line.supplierId || NO_SUPPLIER');
  });

  it('preserva a cor do SKU pra distinguir Champagne/Cobre com o mesmo nome', () => {
    expect(AVAILABILITY).toContain('product.color');
    expect(AVAILABILITY).toContain('displayColor');
  });
});
