import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATELIER_PIPELINE_LABEL,
  ATELIER_STREET_SECTORS,
  atelierBlocksKanbanPointing,
  atelierKanbanBadgeLabel,
} from '@/lib/atelier';
import { isAtelierFactoryReady } from '@/lib/production/productionSequence';

const MIGRATION = 'supabase/migrations/20270101031700_atelier_unificar_antecipacao.sql';
const APP = 'src/App.tsx';
const NAV = 'src/data/navigation.ts';
const PAGE = 'src/pages/Atelie.tsx';
const ACCESS = 'src/hooks/useAccessControl.ts';

describe('Ateliê unificar Antecipação — contratos', () => {
  it('migration traz awaiting_cut, settings, unlock e sync sem corte rua', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('awaiting_cut');
    expect(sql).toContain('atelier_settings');
    expect(sql).toContain('atelier_unlock_jobs_after_cut');
    expect(sql).toContain('trg_atelier_unlock_on_order_stage');
    expect(sql).toContain('atelier_compute_job_targets');
    expect(sql).toContain('atelier_update_settings');
    expect(sql).toContain("sector IN ('Costura Cabedal', 'Aviamento')");
    expect(sql).toContain('DISABLE TRIGGER tg_sector_settings_recompute');
    // Sync não acrescenta corte_cabedal aos setores de rua
    expect(sql).toMatch(/Corte Cabedal é interno[\s\S]*costura_cabedal/);
    expect(sql).not.toMatch(
      /v_sectors := array_append\(v_sectors, 'corte_cabedal'\)/,
    );
  });

  it('rota Antecipação redireciona ao Ateliê e some do menu Produção', () => {
    const app = readFileSync(APP, 'utf8');
    expect(app).toContain('path: "producao/antecipacao"');
    expect(app).toContain('Navigate to="/atelie"');
    expect(app).not.toMatch(/lazy\(\(\) => import\("\.\/pages\/ProducaoAntecipacao"\)\)/);

    const nav = readFileSync(NAV, 'utf8');
    expect(nav).not.toContain("path: '/producao/antecipacao'");
    expect(nav).toContain("path: '/atelie'");

    expect(readFileSync(ACCESS, 'utf8')).toContain(
      "'/producao/antecipacao': 'produtos'",
    );
  });

  // Ateliê v2 (20270101032400): o corte saiu da OP e virou fila de LOTE —
  // "Corte Cabedal da OP destrava Costura/Aviamento" deixou de existir.
  it('UI Ateliê tem fila por lote, aguardando corte e agenda', () => {
    const page = readFileSync(PAGE, 'utf8');
    expect(page).toContain('Aguardando corte');
    expect(page).toContain('AgendaSettings');
    expect(page).toContain('useAtelierLots');
    expect(page).toContain('Confirmar corte');
    expect(page).not.toContain('destrava Costura/Aviamento');
  });

  it('helpers: street sectors, badge e factory gate de awaiting_cut', () => {
    expect(ATELIER_STREET_SECTORS).toEqual(['costura_cabedal', 'aviamento']);
    expect(ATELIER_PIPELINE_LABEL.awaiting_cut).toMatch(/corte/i);
    expect(atelierKanbanBadgeLabel('awaiting_cut')).toMatch(/aguardando corte/i);
    expect(atelierBlocksKanbanPointing('awaiting_cut')).toBe(false);
    expect(atelierBlocksKanbanPointing('sent_to_contractor')).toBe(true);

    expect(
      isAtelierFactoryReady({
        isComplexReference: true,
        pipelineStatus: 'awaiting_cut',
      }).ready,
    ).toBe(false);
    expect(
      isAtelierFactoryReady({
        isComplexReference: true,
        pipelineStatus: 'awaiting_cut',
      }).blockReason,
    ).toMatch(/corte/i);
  });
});
