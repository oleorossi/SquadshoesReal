import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DUBLAGEM_PO_SOURCE } from '@/lib/dublagemDemand';
import { isDublagemPurchaseOrder } from '@/lib/perPvPurchasing';

const SCHEMA = 'supabase/migrations/20270101028000_dublagem_schema.sql';
const MOTOR = 'supabase/migrations/20270101028100_dublagem_motor.sql';
const EXCLUDE = 'supabase/migrations/20270101028200_dublagem_exclude_from_per_pv.sql';
const COSTING = 'supabase/migrations/20270101028300_dublagem_costing_glue.sql';
const OUTBOX = 'supabase/functions/process-sale-order-outbox/index.ts';

describe('dublagem — contratos SQL/UI', () => {
  it('schema cria glues, demands, mode e source_type', () => {
    const sql = readFileSync(SCHEMA, 'utf8');
    expect(sql).toContain('product_group_dublagem_glues');
    expect(sql).toContain('dublagem_demands');
    expect(sql).toContain('dublagem_mode');
    expect(sql).toContain('dublagem_glue_id');
    expect(sql).toContain("'dublagem'");
    expect(sql).toContain('dublagem_demand_id');
  });

  it('motor materializa 2 faces, soft-reserva interna e OC dublagem', () => {
    const sql = readFileSync(MOTOR, 'utf8');
    expect(sql).toContain('materialize_dublagem_demands');
    expect(sql).toContain('dublagem_massa_box_color');
    expect(sql).toContain('process_dublagem_purchase_shortages');
    expect(sql).toContain('dublagem_soft_reserve_face');
    expect(sql).toContain("mode = 'external'");
    expect(sql).toContain('dublagem_finished_product_ids');
  });

  it('exclusão do acabado no per_pv', () => {
    const sql = readFileSync(EXCLUDE, 'utf8');
    expect(sql).toContain('dublagem_finished_product_ids');
    expect(sql).toContain('process_sale_order_purchase_shortages');
  });

  it('custeio soma cola sem estoque', () => {
    const sql = readFileSync(COSTING, 'utf8');
    expect(sql).toContain('dublagem_glue_cost_for_item');
    expect(sql).toContain('dublagem_glue');
    expect(sql).toContain('calculate_order_cost_item');
  });

  it('outbox chama dublagem ANTES do per_pv', () => {
    const src = readFileSync(OUTBOX, 'utf8');
    const dub = src.indexOf('process_dublagem_purchase_shortages');
    const perPv = src.indexOf('process_sale_order_purchase_shortages');
    expect(dub).toBeGreaterThan(-1);
    expect(perPv).toBeGreaterThan(dub);
  });

  it('constantes canônicas', () => {
    expect(DUBLAGEM_PO_SOURCE).toBe('dublagem');
    expect(isDublagemPurchaseOrder({ source_type: 'dublagem' })).toBe(true);
  });

  it('UI de colas e toggle existem', () => {
    const tab = readFileSync('src/components/groups/GroupCompositionTab.tsx', 'utf8');
    expect(tab).toContain('Colas de dublagem');
    expect(tab).toContain('product_group_dublagem_glues');
    const pv = readFileSync('src/components/sale-orders/SaleOrderItemDublagemControls.tsx', 'utf8');
    expect(pv).toContain('Interna');
    expect(pv).toContain('Externa');
    const form = readFileSync('src/components/sale-orders/SaleOrderItemForm.tsx', 'utf8');
    expect(form).toContain("from './SaleOrderItemDublagemControls'");
    expect(form).toContain('<SaleOrderItemDublagemControls');
    expect(form).toContain('dublagem_mode');
  });
});
