import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSaleOrderMaterializationCommand,
  SALE_ORDER_MATERIALIZATION_COMMANDS,
} from '@/lib/saleOrderCommand';

const ROOT = resolve(import.meta.dirname, '../..');
const SALE_ORDERS = readFileSync(resolve(ROOT, 'src/pages/SaleOrders.tsx'), 'utf8');
const USE_SALE_ORDERS = readFileSync(resolve(ROOT, 'src/hooks/useSaleOrders.ts'), 'utf8');
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101028800_sale_order_materialization_queue.sql'),
  'utf8',
);
const EDGE = readFileSync(
  resolve(ROOT, 'supabase/functions/process-sale-order-materialization/index.ts'),
  'utf8',
);
const CONFIG = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');

describe('isSaleOrderMaterializationCommand', () => {
  it('marca confirm/promote/cancel e Aprovado→Rascunho', () => {
    expect(SALE_ORDER_MATERIALIZATION_COMMANDS).toEqual(['confirm', 'promote', 'cancel']);
    expect(isSaleOrderMaterializationCommand('confirm')).toBe(true);
    expect(isSaleOrderMaterializationCommand('promote')).toBe(true);
    expect(isSaleOrderMaterializationCommand('cancel')).toBe(true);
    expect(isSaleOrderMaterializationCommand('transition', 'Rascunho', 'Aprovado')).toBe(true);
    expect(isSaleOrderMaterializationCommand('transition', 'Pendente', 'Rascunho')).toBe(false);
    expect(isSaleOrderMaterializationCommand('transition', 'Faturado', 'Em Produção')).toBe(false);
    expect(isSaleOrderMaterializationCommand('billing')).toBe(false);
  });
});

describe('sale order materialization queue (contrato)', () => {
  it('migration cria fase + fila + enqueue/claim/complete/fail', () => {
    expect(MIGRATION).toContain('command_phase');
    expect(MIGRATION).toContain('sale_order_materialization_jobs');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.enqueue_sale_order_materialization');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.retry_sale_order_materialization');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.discard_sale_order_materialization');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.claim_sale_order_materialization_jobs');
    expect(MIGRATION).toContain('process-sale-order-materialization');
    expect(MIGRATION).toContain('sale-order-materialization');
  });

  it('enqueue NÃO chama promote/execute — só grava job + phase', () => {
    const start = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.enqueue_sale_order_materialization');
    const end = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.retry_sale_order_materialization');
    const body = MIGRATION.slice(start, end);
    expect(body).toContain("command_phase = 'processing'");
    expect(body).not.toContain('execute_sale_order_command');
    expect(body).not.toContain('promote_sale_order');
  });

  it('claim é serial (limit 1) e bloqueia se já há processing com lease', () => {
    const start = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.claim_sale_order_materialization_jobs');
    const end = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.complete_sale_order_materialization_job');
    const body = MIGRATION.slice(start, end);
    expect(body).toContain('p_limit NOT BETWEEN 1 AND 5');
    expect(body).toContain("j.status = 'processing'");
    expect(body).toContain('RETURN;');
  });

  it('edge worker chama execute_sale_order_command e completa/falha o job', () => {
    expect(EDGE).toContain('claim_sale_order_materialization_jobs');
    expect(EDGE).toContain('execute_sale_order_command');
    expect(EDGE).toContain('complete_sale_order_materialization_job');
    expect(EDGE).toContain('fail_sale_order_materialization_job');
    expect(EDGE).toContain('Math.min(1');
    expect(CONFIG).toMatch(
      /\[functions\.process-sale-order-materialization\]\s*\nverify_jwt = false/,
    );
  });

  it('hook enfileira pesados e lista carrega command_phase', () => {
    expect(USE_SALE_ORDERS).toContain('enqueueSaleOrderMaterialization');
    expect(USE_SALE_ORDERS).toContain('isSaleOrderMaterializationCommand');
    expect(USE_SALE_ORDERS).toContain("'command_phase'");
    expect(USE_SALE_ORDERS).toContain('useRetrySaleOrderMaterialization');
    expect(USE_SALE_ORDERS).toContain('useDiscardSaleOrderMaterialization');
    expect(USE_SALE_ORDERS).toContain('refetchInterval');
    expect(USE_SALE_ORDERS).toContain("command_phase === 'processing'");
  });

  it('SaleOrders enfileira bulk em paralelo e mostra badge de fase', () => {
    expect(SALE_ORDERS).toContain('Promise.allSettled');
    expect(SALE_ORDERS).toContain('Enfileirando');
    expect(SALE_ORDERS).toContain('Processando →');
    expect(SALE_ORDERS).toContain('Tentar de novo');
    expect(SALE_ORDERS).toContain('Descartar');
    expect(SALE_ORDERS).toContain('pendingDistributeIds');
    expect(SALE_ORDERS).not.toContain('Atualizando ${done}/${ids.length}');
  });
});
