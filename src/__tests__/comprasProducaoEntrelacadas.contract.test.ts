import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101026500_purchase_dispatch_setup_and_pv_labels.sql',
), 'utf8');
const PLANNING = readFileSync(resolve(ROOT, 'src/pages/PurchasePlanning.tsx'), 'utf8');
const PANEL = readFileSync(resolve(
  ROOT,
  'src/components/financial/PurchaseDispatchQueuePanel.tsx',
), 'utf8');
const KANBAN = readFileSync(resolve(ROOT, 'src/pages/ProducaoKanbanGestao.tsx'), 'utf8');
const SORT = readFileSync(resolve(
  ROOT,
  'src/components/production/kanban/kanbanSort.ts',
), 'utf8');

describe('compras↔produção dispatch slice', () => {
  it('migration grava labels PV+pedido cliente e datas com setup', () => {
    expect(MIGRATION).toContain('source_pv_labels');
    expect(MIGRATION).toContain('client_order_number');
    expect(MIGRATION).toContain('setup_days_for_sale_orders');
    expect(MIGRATION).toContain('compute_po_need_and_purchase_dates');
    expect(MIGRATION).toContain('dispatch_hold');
    expect(MIGRATION).toContain('exported_at');
    expect(MIGRATION).toContain('v_purchase_dispatch_queue');
    expect(MIGRATION).toContain('export_xml_layout');
    expect(MIGRATION).toContain('set_purchase_order_dispatch_hold');
    expect(MIGRATION).toContain('advance_purchase_order_dispatch');
    expect(MIGRATION).toContain('mark_purchase_order_exported');
  });

  it('hub de planejamento expõe a fila de envio como entrada', () => {
    expect(PLANNING).toContain("'fila-envio'");
    expect(PLANNING).toContain('PurchaseDispatchQueuePanel');
    expect(PANEL).toContain('pvLabelText');
    expect(PANEL).toContain('Adiantar');
    expect(PANEL).toContain('Segurar');
    expect(PANEL).toContain('Exportar');
  });

  it('Kanban tem toggle atraso/setup com default atraso', () => {
    expect(SORT).toContain("return 'atraso'");
    expect(SORT).toContain("mode === 'setup'");
    expect(KANBAN).toContain('sortKanbanColumnCards');
    expect(KANBAN).toContain("setSortModePersist('atraso')");
    expect(KANBAN).toContain("setSortModePersist('setup')");
  });
});
