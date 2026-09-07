import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KANBAN_ENGINE_CACHE_KEYS,
  ORDER_STAGES_CACHE_KEYS,
  PRODUCTION_FULL_EXTRA_CACHE_KEYS,
  productionCacheKeysForSurface,
} from '@/hooks/useProductionTransitions';

const HOOKS = resolve(__dirname, '..');
const readHook = (name: string) => readFileSync(resolve(HOOKS, name), 'utf8');

const TRANSITIONS = readHook('useProductionTransitions.ts');
const ORDER_STAGES = readHook('useOrderStages.ts');

function rootKeys(list: readonly (readonly string[])[]): string[] {
  return list.map((k) => k[0]);
}

describe('invalidateProductionCaches · blast radius por superfície (P1.2)', () => {
  it('pointing cobre orders/etapas/setor/quadro e NÃO toca PV/ondas/capacidade', () => {
    const pointing = rootKeys(productionCacheKeysForSurface('pointing'));
    for (const required of [
      'orders',
      'order_stages',
      'production_pointings',
      'live_pairs_rate',
      'v_sector_workload_active',
      'sale_orders_for_corte',
      'orders-material-gate',
    ]) {
      expect(pointing).toContain(required);
    }
    for (const forbidden of [
      'sale_orders',
      'waves',
      'wave-detail',
      'cap_stages_v4',
      'cap_orders_v4',
      'order-flow-audit',
      'post-op-analysis-v2',
      'finishing-packages',
      'mrp_suggestions',
      'purchase_orders',
    ]) {
      expect(pointing).not.toContain(forbidden);
    }
  });

  it('kanban só invalida views do motor dinâmico', () => {
    expect(rootKeys(productionCacheKeysForSurface('kanban'))).toEqual(
      rootKeys(KANBAN_ENGINE_CACHE_KEYS),
    );
    expect(rootKeys(KANBAN_ENGINE_CACHE_KEYS)).toEqual([
      'sector_settings',
      'production_schedule_grid',
      'production_schedule_ops',
      'production_queue_detail',
      'production_overloads',
      'production_engine_runs',
    ]);
  });

  it('full = pointing ∪ kanban ∪ extras (sem buraco vs lista legada)', () => {
    const full = rootKeys(productionCacheKeysForSurface('full'));
    for (const key of [
      ...rootKeys(ORDER_STAGES_CACHE_KEYS),
      ...rootKeys(KANBAN_ENGINE_CACHE_KEYS),
      ...rootKeys(PRODUCTION_FULL_EXTRA_CACHE_KEYS),
    ]) {
      expect(full).toContain(key);
    }
    // Contrato legado: PV/ondas/capacidade só no full
    for (const extra of rootKeys(PRODUCTION_FULL_EXTRA_CACHE_KEYS)) {
      expect(rootKeys(ORDER_STAGES_CACHE_KEYS)).not.toContain(extra);
      expect(rootKeys(KANBAN_ENGINE_CACHE_KEYS)).not.toContain(extra);
    }
  });

  it('apontamento e realtime usam invalidateAfterPointing (não a lista full)', () => {
    expect(ORDER_STAGES).toContain('invalidateAfterPointing(qc)');
    expect(ORDER_STAGES).toMatch(/useApontarProducao[\s\S]*invalidateAfterPointing\(qc\)/);
    expect(ORDER_STAGES).toMatch(/useRealtimeOrderStages[\s\S]*invalidateAfterPointing\(qc\)/);
    // Debounce base permanece 400ms; rajada pode subir pra 600
    expect(ORDER_STAGES).toContain('REALTIME_DEBOUNCE_MS = 400');
    expect(ORDER_STAGES).toContain('REALTIME_BURST_DEBOUNCE_MS = 600');
  });

  it('finalizeSectorTask também passa por invalidateAfterPointing', () => {
    expect(TRANSITIONS).toContain('invalidateAfterPointing(queryClient)');
    expect(TRANSITIONS).toContain('export function invalidateOrderStagesCaches');
    expect(TRANSITIONS).toContain('export function invalidateKanbanEngineCaches');
  });

  it('delete de etapa e aposentadoria de ficha continuam no full', () => {
    expect(ORDER_STAGES).toMatch(
      /export function useDeleteOrderStage[\s\S]*invalidateProductionCaches\(qc\)/,
    );
    const sheets = readHook('useTechnicalSheets.ts');
    expect(sheets).toContain('invalidateProductionCaches(qc)');
  });
});
