import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATELIER_SECTORS,
  atelierBlocksKanbanPointing,
  atelierKanbanBadgeLabel,
} from '@/lib/atelier';

const MIGRATION = 'supabase/migrations/20270101029100_atelier_cabedal_complexo.sql';
const HUB = 'src/pages/TerceirizadosHub.tsx';
const PAGE = 'src/pages/Atelie.tsx';
const NAV = 'src/data/navigation.ts';
const APP = 'src/App.tsx';

describe('Ateliê cabedal complexo — contratos', () => {
  it('migration cria catálogo, jobs, pipeline e anti-rebaixa', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('atelier_complex_references');
    expect(sql).toContain('cabedal_prep_jobs');
    expect(sql).toContain('atelier_confirm_job_debit');
    expect(sql).toContain('atelier_mark_job_sent');
    expect(sql).toContain('atelier_mark_job_received');
    expect(sql).toContain('reapply_atelier_eligibility');
    expect(sql).toContain('tg_block_op_reserve_if_atelier_debited');
    expect(sql).toContain('atelier_reference_has_sector');
    expect(sql).toContain("'out'");
  });

  it('materialize exige catálogo Ateliê e status Aprovado pra entrada nova', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('v_catalog_ok');
    expect(sql).toContain("v_status = 'Em Produção'");
    expect(sql).toContain('fora_do_atelier');
  });

  it('hub remove prep e redireciona /atelie', () => {
    const hub = readFileSync(HUB, 'utf8');
    expect(hub).not.toContain('CabedalPrepPanel');
    expect(hub).toContain("/atelie?view=fila");
    expect(hub).toContain("requestedRaw === 'prep'");
  });

  it('rota e menu Ateliê sob Engenharia', () => {
    expect(readFileSync(NAV, 'utf8')).toContain("path: '/atelie'");
    expect(readFileSync(APP, 'utf8')).toContain('path: "atelie"');
    expect(readFileSync(PAGE, 'utf8')).toContain('Fila operacional');
    expect(readFileSync(PAGE, 'utf8')).toContain('Modelos complexos');
  });

  it('setores e badges kanban canônicos', () => {
    expect(ATELIER_SECTORS).toEqual(['corte_cabedal', 'costura_cabedal', 'aviamento']);
    expect(atelierKanbanBadgeLabel('sent_to_contractor')).toMatch(/prestador/i);
    expect(atelierBlocksKanbanPointing('sent_to_contractor')).toBe(true);
    expect(atelierBlocksKanbanPointing('debited')).toBe(false);
  });
});
