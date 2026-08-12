import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261231121500_sop-e-gestao-diaria-dos-setores.sql'),
  'utf8',
);

describe('contrato S&OP e gestão diária', () => {
  it('persiste planos versionados e impede alterar plano aprovado', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.sop_plans');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.sop_plan_items');
    expect(migration).toContain("status = 'aprovado'");
    expect(migration).toContain('Plano aprovado não pode ser alterado');
  });

  it('mantém S&OP fora da fila operacional e usa a rota real da ficha', () => {
    expect(migration).toContain('jsonb_array_elements_text(COALESCE(ts.production_sectors');
    expect(migration).not.toContain('INSERT INTO public.production_queue');
    expect(migration).not.toContain('recompute_production_schedule');
  });

  it('calcula gestão diária pela agenda e pelo ledger de apontamentos', () => {
    expect(migration).toContain('public.production_schedule');
    expect(migration).toContain('public.production_pointings');
    expect(migration).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    expect(migration).toContain('get_sector_daily_management');
  });
});
