import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATELIER_EXECUTION_MODE_LABEL,
  ATELIER_INTERNAL_OK_STEPS,
  ATELIER_PIPELINE_LABEL,
  ATELIER_STREET_OK_STEPS,
  atelierEffectiveMode,
  atelierJobReleasesFactory,
  atelierNextInternalOk,
  atelierNextStreetOk,
} from '@/lib/atelier';

const MIG = 'supabase/migrations/20270101042500_atelier_interno_prestador_kit.sql';
const MIG_PERSIST = 'supabase/migrations/20270101042600_atelier_execution_mode_persist.sql';

describe('Ateliê — interno × prestador + kit da ficha', () => {
  const sql = readFileSync(MIG, 'utf8');
  const persist = readFileSync(MIG_PERSIST, 'utf8');

  it('migration define modo, statuses internos e kit_product_ids', () => {
    expect(sql).toContain('execution_mode');
    expect(sql).toContain("'internal'");
    expect(sql).toContain("'contractor'");
    expect(sql).toContain("'in_progress'");
    expect(sql).toContain("'done'");
    expect(sql).toContain('kit_product_ids');
    expect(sql).toContain('atelier_execution_mode');
    expect(sql).toContain('FUNCTION public.atelier_set_job_execution_mode');
    expect(sql).toContain('FUNCTION public.atelier_mark_job_internal_start');
    expect(sql).toContain('FUNCTION public.atelier_mark_job_internal_done');
    expect(sql).toContain('FUNCTION public.atelier_sheet_kit_candidates');
  });

  it('gate libera em done (interno) ou received (prestador)', () => {
    const gate = sql.slice(sql.indexOf('FUNCTION public.atelier_item_block_reason'));
    expect(gate).toMatch(/execution_mode = 'internal'/);
    expect(gate).toMatch(/'done'/);
    expect(gate).toMatch(/received_at_factory/);
  });

  it('envio ao prestador recusa job interno', () => {
    const sent = sql.slice(sql.indexOf('FUNCTION public.atelier_mark_job_sent'));
    expect(sent).toMatch(/execution_mode = 'internal'/);
    expect(sent).toMatch(/Em realização|interno/i);
  });

  it('kit filtra por product_id quando preenchido', () => {
    expect(sql).toContain('atelier_lot_kit_filter_products');
    expect(sql).toMatch(/kit_product_ids IS NOT NULL AND cardinality\(kit_product_ids\) > 0/);
  });

  it('persistência do modo no save do PV', () => {
    expect(persist).toContain('sync_sale_order_items_atelier_execution_mode');
  });

  it('TS: pipelines e OKs distintos por modo', () => {
    expect(ATELIER_STREET_OK_STEPS).toEqual([
      'sent_to_contractor',
      'realized',
      'received_at_factory',
    ]);
    expect(ATELIER_INTERNAL_OK_STEPS).toEqual(['in_progress', 'done']);
    expect(ATELIER_PIPELINE_LABEL.in_progress).toMatch(/realização/i);
    expect(ATELIER_PIPELINE_LABEL.done).toMatch(/concluído/i);
    expect(ATELIER_EXECUTION_MODE_LABEL.internal).toBe('Interno');
    expect(atelierNextStreetOk('cut')).toBe('sent_to_contractor');
    expect(atelierNextInternalOk('cut')).toBe('in_progress');
    expect(atelierNextInternalOk('in_progress')).toBe('done');
    expect(atelierNextStreetOk('in_progress')).toBeNull();
    expect(atelierEffectiveMode(null)).toBe('contractor');
    expect(atelierEffectiveMode('internal')).toBe('internal');
    expect(atelierJobReleasesFactory('internal', 'done')).toBe(true);
    expect(atelierJobReleasesFactory('internal', 'received_at_factory')).toBe(false);
    expect(atelierJobReleasesFactory('contractor', 'received_at_factory')).toBe(true);
  });

  it('UI: relatório tem abas Interno/Prestador; ficha usa kit por produto; PV tem modo', () => {
    const rel = readFileSync('src/components/atelier/AtelierRelatorioView.tsx', 'utf8');
    expect(rel).toMatch(/Interno/);
    expect(rel).toMatch(/Prestador/);
    expect(rel).toMatch(/OK · Em realização/);
    expect(rel).toMatch(/OK · Concluído/);
    expect(rel).toMatch(/OK · Enviado ao prestador/);
    expect(rel).toContain('InternalJobOk');
    expect(rel).toContain('ContractorJobOk');

    const ficha = readFileSync('src/components/technical-sheets/AtelierReferencePanel.tsx', 'utf8');
    expect(ficha).toContain('useAtelierSheetKitCandidates');
    expect(ficha).toContain('kitProductIds');
    expect(ficha).toContain('kit_product_ids');

    const pv = readFileSync('src/components/sale-orders/ItemAtelierModeSection.tsx', 'utf8');
    expect(pv).toContain('AtelierExecutionMode');
    expect(pv).toContain('ATELIER_EXECUTION_MODE_LABEL');
    expect(pv).toContain("'internal'");
    expect(pv).toContain("'contractor'");

    const form = readFileSync('src/components/sale-orders/SaleOrderItemForm.tsx', 'utf8');
    expect(form).toContain('ItemAtelierModeSection');
    expect(form).toContain('atelier_execution_mode');
  });
});
