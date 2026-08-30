import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

const panel = read('src/components/sale-orders/SaleOrderFormPanel.tsx');
const productForm = read('src/components/inventory/ProductFormDialog.tsx');
const itemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');

describe('cadastrar cor no PV não dispara o save do pedido', () => {
  it('o form do PV ignora submit que não nasceu nele (dialog portaled)', () => {
    const handler = panel.split('const handlePreSubmit')[1]?.split('const isNewOrder')[0] || '';
    expect(handler).toContain('e.target !== e.currentTarget');
    expect(handler).toContain('e.preventDefault()');
    expect(handler).toMatch(/cadastrando justamente essa cor/);
  });

  it('Novo Material para o submit no portal — não vaza pro form pai', () => {
    const handler = productForm.split('const handleSubmit = async (e: React.FormEvent)')[1]
      ?.slice(0, 400) || '';
    expect(handler).toContain('e.preventDefault()');
    expect(handler).toContain('e.stopPropagation()');
  });

  it('o PV abre o cadastro de cor com grupo e cor já decididos — não pede variante de novo', () => {
    expect(itemForm).toContain('defaultGroupId={colorProductGroupId}');
    expect(itemForm).toContain('defaultColor={colorProductColor}');
    expect(itemForm).toContain("onUpdate(index, 'color', createdColor)");
    expect(productForm).toContain('suggestSkuForColor');
    expect(productForm).toContain('defaultOpen={!defaultColor}');
  });
});
