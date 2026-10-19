/**
 * Prestador: rendimento no grupo + aba Tiras do Ateliê.
 * specs/tira-material-de-estoque.md R3 / R17 / R18.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STRAP_NAPA_MISSING_YIELD_REASON,
  strapNapaBlockReason,
  type CanonicalStrapDemandPreview,
} from '@/lib/canonicalStrapDemandPreview';

const read = (path: string) => readFileSync(path, 'utf8');

describe('rendimento canônico no grupo da tira', () => {
  it('GroupEditDialog hospeda origem + rendimento via StrapGroupConfigPanel', () => {
    const edit = read('src/components/groups/GroupEditDialog.tsx');
    expect(edit).toContain("from '@/components/groups/StrapGroupConfigPanel'");
    expect(edit).toContain('<StrapGroupConfigPanel');
    expect(edit).toContain('strap_origin');
    expect(edit).toContain('strap_labor_cost_per_m');
    // Não manda mais o rendimento só pro Hub.
    expect(edit).not.toMatch(/Cadastre rendimento no Hub de Tiras/u);
  });

  it('painel grava rendimento com set_strap_group_napa_yield', () => {
    const panel = read('src/components/groups/StrapGroupConfigPanel.tsx');
    const hook = read('src/hooks/useStrapGroupYields.ts');
    expect(hook).toContain("rpc('set_strap_group_napa_yield'");
    expect(panel).toContain('useSetStrapGroupNapaYield');
    expect(panel).toContain('m/m');
    expect(panel).toContain('prestador');
  });

  it('migration do preview prefere strap_group_napa_yields', () => {
    const mig = read('supabase/migrations/20270101043900_strap-yield-prefers-group.sql');
    expect(mig).toContain('strap_group_napa_yields');
    expect(mig).toContain('group_yield_preferred');
    expect(mig).toContain('enrich_consumo_strap_preview_recipe_yield');
    expect(mig).toContain('recipe_yield_fallback');
  });

  it('bloqueio de napa exige rendimento, não recipeId do Hub', () => {
    expect(STRAP_NAPA_MISSING_YIELD_REASON).toMatch(/grupo da tira/i);
    const withYieldNoRecipe: Pick<
      CanonicalStrapDemandPreview,
      'sourceMode' | 'recipeId' | 'confirmedYieldMPerM' | 'blockingReasons' | 'snapshotWarning' | 'softBlockingReasons'
    > = {
      sourceMode: 'internal',
      recipeId: null,
      confirmedYieldMPerM: 70,
      blockingReasons: [],
      softBlockingReasons: [],
    };
    expect(strapNapaBlockReason(withYieldNoRecipe)).toBeNull();

    const noYield = { ...withYieldNoRecipe, confirmedYieldMPerM: null };
    expect(strapNapaBlockReason(noYield)).toContain('grupo da tira');
  });
});

describe('Ateliê — aba Tiras', () => {
  it('Atelie expõe view=tiras com AtelierStrapsView', () => {
    const page = read('src/pages/Atelie.tsx');
    expect(page).toContain("'tiras'");
    expect(page).toContain('AtelierStrapsView');
    expect(page).toContain('value="tiras"');
  });

  it('hook e view chamam as RPCs vivas do Ateliê de tira', () => {
    const hook = read('src/hooks/useAtelierStraps.ts');
    const view = read('src/components/atelier/AtelierStrapsView.tsx');
    for (const rpc of [
      'list_atelier_strap_shortages',
      'generate_atelier_strap_purchase_and_service',
      'register_atelier_strap_received',
      'register_atelier_strap_produced',
      'list_atelier_strap_jobs',
      'set_strap_group_napa_yield',
    ]) {
      expect(hook).toContain(rpc);
    }
    expect(view).toContain('Gerar OC da napa e OS');
    expect(view).toContain('Recebido');
    expect(view).toContain('Produzido');
    expect(view).toContain('Salvar rendimento');
  });
});
