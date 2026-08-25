import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const migration = read('supabase/migrations/20270101011000_atomic_per_pv_purchase_orders.sql');
const hook = read('src/hooks/usePerPvPurchasing.ts');
const dialog = read('src/components/purchase/GeneratePurchaseOrdersDialog.tsx');
const saleOrders = read('src/pages/SaleOrders.tsx');

describe('Compras por Pedido — geração atômica e idempotente', () => {
  it('faz pre-flight completo antes da primeira escrita e persiste grade', () => {
    const preflight = migration.indexOf('PRE-FLIGHT COMPLETO');
    const firstWrite = migration.indexOf('INSERT INTO public.purchase_orders(');
    expect(preflight).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(preflight);
    expect(migration).toContain('v_unit_price <= 0');
    expect(migration).toContain('Grade de "%" soma %, mas a quantidade da OC é %');
    expect(migration).toMatch(/INSERT INTO public\.purchase_order_items\([\s\S]*?grade[\s\S]*?v_item -> 'grade'/);
  });

  it('uma RPC substitui o loop de INSERTs do cliente', () => {
    expect(hook).toContain("rpc('create_per_pv_purchase_orders_atomic'");
    expect(hook).toContain('grade: item.grade ?? null');
    expect(hook).toContain('it.unit_price <= 0');
    expect(hook).not.toContain(".from('purchase_orders')\n          .insert");
    expect(hook).not.toContain(".from('purchase_order_items').insert");
  });

  it('usa recibo durável por request UUID, hash do payload e índice único permanente', () => {
    expect(migration).toContain('CREATE TABLE public.per_pv_purchase_order_requests');
    expect(migration).toContain('request_hash text NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX ux_purchase_orders_perpv_request_key');
    expect(migration).toContain("'replayed', true");
    expect(dialog).toContain('useRef<string | null>(null)');
    expect(dialog).toContain('requestIdRef.current ||= crypto.randomUUID()');
  });

  it('neta solado por stock_grade e guarda contra OCs/ROPs abertas no cliente e servidor', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.compute_per_pv_purchase_needs');
    expect(migration).toContain('p.stock_grade ->> mg.size_key');
    expect(migration).toContain('shortage_grade');
    expect(migration).toContain("po.source_type IS DISTINCT FROM 'strap_demand'");
    expect(migration).toContain('p_allow_existing_open');
    expect(hook).toContain("rpc('compute_per_pv_purchase_needs'");
    expect(dialog).toContain('overrideOpenPurchases');
  });

  it('alinha o gate visual às roles autorizadas pela RPC/RLS', () => {
    expect(saleOrders).toContain("const canBuy = isAdmin || roles.includes('gerente')");
    expect(migration).toContain("user_has_any_role(ARRAY['admin', 'gerente'])");
    expect(migration).toContain("FROM PUBLIC, anon");
  });
});
