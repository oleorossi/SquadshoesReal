import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatFloorProgressLabel,
  saleOrderShowsFloorProgress,
} from '@/hooks/useSaleOrdersFloorProgress';
import { productionCacheKeysForSurface } from '@/hooks/useProductionTransitions';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function findFloorProgressMigration(): string {
  const name = readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{14}_.+\.sql$/.test(n))
    .sort()
    .reverse()
    .find((n) => n.includes('sale_orders_floor_progress'));
  if (!name) throw new Error('migration sale_orders_floor_progress não encontrada');
  return readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
}

describe('get_sale_orders_floor_progress — contrato SQL', () => {
  const sql = findFloorProgressMigration();

  it('define RPC em lote com assinatura uuid[]', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_sale_orders_floor_progress\(\s*p_sale_order_ids uuid\[]/,
    );
    expect(sql).toMatch(/RETURNS TABLE\(/);
    expect(sql).toContain('sale_order_id uuid');
    expect(sql).toContain('completed integer');
    expect(sql).toContain('in_progress integer');
    expect(sql).toContain('total integer');
    expect(sql).toContain('current_sector text');
    expect(sql).toContain('ops_active integer');
    expect(sql).toContain('ops_done integer');
  });

  it('filtra OPs canceladas e agrega order_stages', () => {
    expect(sql).toContain("'Cancelada'");
    expect(sql).toContain('public.order_stages');
    expect(sql).toMatch(/stage_status = 'concluido'/);
    expect(sql).toMatch(/stage_status = 'em_andamento'/);
  });

  it('gargalo = primeira etapa não concluída por stage_order', () => {
    expect(sql).toMatch(/stage_status IS DISTINCT FROM 'concluido'/);
    expect(sql).toMatch(/ORDER BY s2\.stage_order ASC/);
    expect(sql).toMatch(/LIMIT 1/);
  });

  it('PV sem estágio não retorna linha (progresso nulo)', () => {
    expect(sql).toMatch(/WHERE sa\.total > 0/);
    expect(sql).not.toMatch(/ALTER TABLE public\.sale_orders/);
  });

  it('ACL: approved user / service_role', () => {
    expect(sql).toContain('is_approved_user()');
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_sale_orders_floor_progress\(uuid\[]\)/,
    );
  });
});

describe('formatFloorProgressLabel / gate de status', () => {
  it('só Aprovado e Em Produção mostram progresso', () => {
    expect(saleOrderShowsFloorProgress('Aprovado')).toBe(true);
    expect(saleOrderShowsFloorProgress('Em Produção')).toBe(true);
    expect(saleOrderShowsFloorProgress('Rascunho')).toBe(false);
    expect(saleOrderShowsFloorProgress('Cancelado')).toBe(false);
    expect(saleOrderShowsFloorProgress('Faturado')).toBe(false);
  });

  it('monta n/m · gargalo e omite setor quando concluído', () => {
    expect(formatFloorProgressLabel({
      completed: 3,
      total: 8,
      current_sector: 'Costura Cabedal',
    })).toBe('3/8 · Costura Cabedal');
    expect(formatFloorProgressLabel({
      completed: 8,
      total: 8,
      current_sector: null,
    })).toBe('8/8');
    expect(formatFloorProgressLabel(null)).toBeNull();
    expect(formatFloorProgressLabel({ completed: 0, total: 0, current_sector: null })).toBeNull();
  });
});

describe('UI + invalidação alinhadas ao read model', () => {
  it('SectorProgressDots é shared e usado em Orders + Sales', () => {
    const dots = read('src/components/production/SectorProgressDots.tsx');
    const orders = read('src/pages/Orders.tsx');
    const sales = read('src/pages/SaleOrders.tsx');
    const mobile = read('src/components/sale-orders/SaleOrderMobileCard.tsx');
    expect(dots).toContain('export function SectorProgressDots');
    expect(orders).toContain("from '@/components/production/SectorProgressDots'");
    expect(orders).not.toMatch(/const SectorProgressDots\s*=/);
    expect(sales).toContain('SaleOrderFloorProgressSummary');
    expect(sales).toContain('useSaleOrdersFloorProgress');
    expect(sales).toContain('<TableHead>Setor</TableHead>');
    expect(mobile).toContain('floorProgress');
    expect(mobile).toContain('SaleOrderFloorProgressSummary');
  });

  it('hook chama a RPC em lote (não order_stages por PV)', () => {
    const hook = read('src/hooks/useSaleOrdersFloorProgress.ts');
    expect(hook).toContain("get_sale_orders_floor_progress");
    expect(hook).toContain('p_sale_order_ids');
    expect(hook).not.toContain(".from('order_stages')");
  });

  it('pointing invalida sale_orders_floor_progress sem tocar sale_orders', () => {
    const pointing = productionCacheKeysForSurface('pointing').map((k) => k[0]);
    expect(pointing).toContain('sale_orders_floor_progress');
    expect(pointing).not.toContain('sale_orders');
  });

  it('promote/cancel invalidam floor progress junto com order_stages', () => {
    const saleOrders = read('src/hooks/useSaleOrders.ts');
    expect(saleOrders).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\['order_stages'\]\s*\}\)[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*\['sale_orders_floor_progress'\]\s*\}\)/,
    );
  });
});
