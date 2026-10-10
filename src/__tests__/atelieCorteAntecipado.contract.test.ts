import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { atelierKanbanBadgeLabel, atelierLotColumn } from '@/lib/atelier';
import { isAtelierFactoryReady } from '@/lib/production/productionSequence';

const MIG = 'supabase/migrations/20270101032400_atelie_corte_antecipado_fase1.sql';
const FIX = 'supabase/migrations/20270101033100_atelie_corte_movement_reason.sql';

/**
 * Ateliê v2 (specs/atelie-corte-antecipado.md). Os pontos load-bearing:
 * sem ciclo OP × Ateliê, gate só pelo setor que a ficha tem, débito por ITEM
 * com pendência e OP descontando o que o corte já tirou.
 */
describe('Ateliê v2 — corte antecipado em lote', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('remove o gate que esperava a OP (causa do travamento)', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_atelier_unlock_on_order_stage/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.atelier_cut_gate_released/);
    // Nenhuma função nova volta a depender de OP existir para liberar o Ateliê.
    const bodyAfterDrop = sql.slice(sql.indexOf('DROP FUNCTION IF EXISTS public.atelier_confirm_job_debit'));
    expect(bodyAfterDrop).not.toContain('atelier_cut_gate_released(');
  });

  it('gate de fábrica bloqueia só setor de rua que a ficha sustenta', () => {
    expect(sql).toContain('FUNCTION public.atelier_item_block_reason');
    expect(sql).toMatch(/v_sectors := public\.atelier_reference_street_sectors\(v_ref\)/);
    expect(sql).toMatch(/IF cardinality\(v_sectors\) = 0 THEN\s+RETURN NULL;/);
    expect(sql).toMatch(/sale_order_item_factory_gate_block_reason[\s\S]*atelier_item_block_reason\(p_item_id\)/);
  });

  it('cadastro recusa setor que a ficha não tem', () => {
    expect(sql).toContain('trg_atelier_catalog_validate');
    expect(sql).toMatch(/NOT public\.atelier_sheet_supports_sector\(NEW\.reference_id, NEW\.sector\)/);
  });

  it('corte debita por ITEM a necessidade real e registra pendência', () => {
    expect(sql).toContain('FUNCTION public.atelier_confirm_lot_cut');
    expect(sql).toMatch(/sale_order_material_demand_lines\(v_dem\.sale_order_id\)[\s\S]*l\.sale_order_item_id = v_dem\.sale_order_item_id/);
    expect(sql).toMatch(/v_debit := LEAST\(GREATEST\(COALESCE\(v_prev, 0\), 0\), v_line\.required\)/);
    expect(sql).toMatch(/GREATEST\(v_line\.required - v_debit, 0\)/);
    // Pares nunca viram quantidade de material (bug da v1).
    const cut = sql.slice(sql.indexOf('FUNCTION public.atelier_confirm_lot_cut'));
    expect(cut.slice(0, cut.indexOf('$$;'))).not.toMatch(/v_job\.pairs|\.pairs, 0\), 0\)/);
  });

  it('OP desconta o que o Ateliê já debitou do item e nasce com as etapas feitas', () => {
    expect(sql).toMatch(/v_required - public\.atelier_item_product_debited_qty\(v_soi_id/);
    expect(sql).toContain("'atelier_already_debited'");
    expect(sql).toContain('CREATE TRIGGER trg_zz_atelier_stage_born_done');
    // Nome load-bearing: roda depois do guarda trg_000_ (ordem alfabética).
    expect('trg_zz_atelier_stage_born_done' > 'trg_000_enforce_order_stage_command_boundary').toBe(true);
  });

  it('anti-2× deixou de bloquear o PV inteiro por produto', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.tg_block_op_reserve_if_atelier_debited'));
    expect(fn.slice(0, fn.indexOf('$$;'))).not.toContain('cabedal_prep_product_already_debited');
  });

  it('movimento do corte usa motivo aceito pelo CHECK de stock_movements', () => {
    const fix = readFileSync(FIX, 'utf8');
    expect(fix).toContain("'consumo_op'");
  });

  it('coluna do lote = job mais atrasado; aberto = aguardando corte', () => {
    expect(atelierLotColumn('open', [])).toBe('awaiting_cut');
    expect(atelierLotColumn('cut', ['sent_to_contractor', 'cut'])).toBe('cut');
    expect(atelierLotColumn('cut', ['received_at_factory', 'received_at_factory'])).toBe('received_at_factory');
    expect(atelierLotColumn('cut', ['received_at_factory', 'cancelled'])).toBe('received_at_factory');
  });

  it('sequência e Kanban falam o pipeline novo', () => {
    expect(atelierKanbanBadgeLabel('cut')).toMatch(/cortado/i);
    expect(isAtelierFactoryReady({ isComplexReference: true, pipelineStatus: 'cut' }).ready).toBe(false);
    expect(isAtelierFactoryReady({ isComplexReference: true, pipelineStatus: 'received_at_factory' }).ready).toBe(true);
  });
});
