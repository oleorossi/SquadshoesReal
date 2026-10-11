import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PV novo DS20 PRETO (11/10/2026): o grupo acabado tinha o SKU legado e o SKU
 * da variante reference_base (produção interna) na mesma cor → "mais de um
 * SKU ativo". E a tela reusava o client_request_id depois do recibo failed,
 * trocando o erro real por "Replay idempotente divergente".
 */
const ROOT = resolve(__dirname, '../..');
const MARKER = 'strap_buy_ready_ignora_reference_base_20270101035300';

describe('tira pronta ignora SKU de produção interna — 35300', () => {
  const sql = readFileSync(
    resolve(ROOT, 'supabase/migrations/20270101035300_tira-pronta-ignora-sku-producao-interna.sql'),
    'utf8',
  );

  it('patcha via pg_get_functiondef, sem redefinir o corpo inteiro', () => {
    expect(sql).toContain('pg_get_functiondef(v_fn)');
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_sale_order_item_internal_straps/);
  });

  it('filtra reference_base na contagem E na escolha do SKU, e exige os 2 pontos', () => {
    expect(sql).toContain(MARKER);
    expect(sql).toContain("rb.identity_basis = ''reference_base''");
    expect(sql).toContain(') > 1 THEN');
    expect(sql).toContain('FOR SHARE OF p;');
    expect(sql).toContain('<> 2 THEN');
  });
});

describe('SaleOrderForm — CREATE descarta a chave após recibo failed', () => {
  const src = readFileSync(resolve(ROOT, 'src/pages/SaleOrderForm.tsx'), 'utf8');

  it('createOrder.mutate tem onError que zera clientRequestIdRef só em SaleOrderCommandExecutionError', () => {
    const start = src.indexOf('createOrder.mutate(');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1500);
    expect(block).toMatch(
      /onError:[\s\S]*instanceof SaleOrderCommandExecutionError[\s\S]*clientRequestIdRef\.current = null/,
    );
  });
});
