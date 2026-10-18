import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATELIER_PIPELINE_LABEL,
  ATELIER_QUEUE_COLUMNS,
  atelierLotColumn,
  atelierNextStreetOk,
} from '@/lib/atelier';

const MIG = 'supabase/migrations/20270101042400_atelier_street_realized_conferido.sql';

describe('Ateliê — realizado e conferido (rua)', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('adiciona status realized e RPC de OK', () => {
    expect(sql).toContain("'realized'");
    expect(sql).toContain('FUNCTION public.atelier_mark_job_realized');
    expect(sql).toMatch(/pipeline_status = 'realized'/);
  });

  it('receber só depois de realizado', () => {
    const received = sql.slice(sql.indexOf('FUNCTION public.atelier_mark_job_received'));
    expect(received).toMatch(/pipeline_status = 'realized'/);
    expect(received).toMatch(/recebido e conferido|Realizado|realizar/i);
  });

  it('UI e labels cobrem a trilha de 3 OKs', () => {
    expect(ATELIER_QUEUE_COLUMNS).toContain('realized');
    expect(ATELIER_PIPELINE_LABEL.sent_to_contractor).toMatch(/enviado/i);
    expect(ATELIER_PIPELINE_LABEL.realized).toMatch(/realizado/i);
    expect(ATELIER_PIPELINE_LABEL.received_at_factory).toMatch(/conferido/i);
    expect(atelierNextStreetOk('sent_to_contractor')).toBe('realized');
    expect(atelierLotColumn('cut', ['realized', 'sent_to_contractor'])).toBe('sent_to_contractor');
  });

  it('relatório operacional existe com filtros', () => {
    const page = readFileSync('src/pages/Atelie.tsx', 'utf8');
    expect(page).toContain('AtelierRelatorioView');
    const rel = readFileSync('src/components/atelier/AtelierRelatorioView.tsx', 'utf8');
    expect(rel).toContain('OK · Realizado');
    // Label densificado no cartão: "OK · Conferido" (status completo fica no pipeline)
    expect(rel).toContain('OK · Conferido');
    expect(rel).toContain('matchesAtelierReportFilters');
  });
});
