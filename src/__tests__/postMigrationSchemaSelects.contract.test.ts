import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contratos pós-migração: o schema canônico NÃO tem products.code/ean nem
 * orders.delivery_date/reference. Telas que ainda pedirem essas colunas
 * quebram com "column … does not exist" no destino (cknbzfqvqwqdhajspazn).
 */
describe('post-migration schema-safe selects', () => {
  const picking = readFileSync(resolve(__dirname, '../pages/Picking.tsx'), 'utf8');
  const operations = readFileSync(
    resolve(__dirname, '../components/technical-sheets/OperationsTab.tsx'),
    'utf8',
  );

  it('Picking usa sku (não code/ean) ao listar produtos', () => {
    expect(picking).toContain(".select('id, name, sku, unit')");
    expect(picking).not.toMatch(/from\('products'\)[\s\S]{0,200}code, ean/);
  });

  it('OperationsTab filtra OPs por reference_id e ordena por due_date', () => {
    expect(operations).toContain(".select('id, order_number, quantity, status, due_date')");
    expect(operations).toContain(".eq('reference_id', sheetId)");
    expect(operations).toContain(".order('due_date', { ascending: true })");
    expect(operations).not.toContain('delivery_date');
    expect(operations).not.toContain('reference.eq.');
  });
});
