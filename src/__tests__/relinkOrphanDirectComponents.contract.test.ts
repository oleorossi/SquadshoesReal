import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const SQL_ORIG = read('supabase/migrations/20261028120200_list-and-relink-orphan-direct-components.sql');
const SQL_INACTIVE = read('supabase/migrations/20270101022700_direct-components-inactive-blank-ui.sql');
const panel = read('src/components/technical-sheets/OrphanDirectComponentsPanel.tsx');
const page = read('src/pages/SystemDiagnostics.tsx');
const select = read('src/components/technical-sheets/sheetSelectors.tsx');

describe('religamento de componente direto órfão — SQL original', () => {
  it('agrupa pelo product_id, não pelo nome gravado', () => {
    const fn = SQL_ORIG.split('CREATE OR REPLACE FUNCTION public.list_orphan_direct_components')[1] ?? '';
    expect(fn).toContain("(dc ->> 'product_id')::uuid");
    expect(fn).toContain('GROUP BY 1');
    expect(fn).toMatch(/array_agg\(DISTINCT btrim\(COALESCE\(dc ->> 'product_name'/);
  });

  it('versão original só listava produto apagado', () => {
    const fn = SQL_ORIG.split('CREATE OR REPLACE FUNCTION public.list_orphan_direct_components')[1] ?? '';
    expect(fn).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.products p/);
    expect(fn).not.toContain('inactive');
  });

  it('versão original recusava religar quando o produto morto ainda existe', () => {
    expect(SQL_ORIG).toContain('ainda existe — isto religa apenas vínculo órfão');
  });
});

describe('dc_inactive_blank_ui_20270101022700 — inativo também', () => {
  it('lista deleted e inactive com coluna reason', () => {
    expect(SQL_INACTIVE).toContain('dc_inactive_blank_ui_20270101022700');
    expect(SQL_INACTIVE).toContain("THEN 'deleted'");
    expect(SQL_INACTIVE).toContain("THEN 'inactive'");
    expect(SQL_INACTIVE).toMatch(/reason text/);
    // RETURNS TABLE mudou (coluna reason) — REPLACE sozinho estoura 42P13.
    expect(SQL_INACTIVE).toMatch(
      /DROP FUNCTION IF EXISTS public\.list_orphan_direct_components\(\);\s*CREATE OR REPLACE FUNCTION public\.list_orphan_direct_components/,
    );
  });

  it('relink aceita origem inativa e exige destino ativo', () => {
    expect(SQL_INACTIVE).toContain('ainda está ativo — isto religa apenas vínculo órfão ou inativo');
    expect(SQL_INACTIVE).toContain('não existe ou está inativo');
    expect(SQL_INACTIVE).toMatch(/p\.active IS TRUE/);
  });

  it('DirectComponentSelect inclui o value inativo na query', () => {
    expect(select).toContain('resolveDirectComponentSelection');
    expect(select).toContain('active.eq.true,id.eq.');
    expect(select).toContain('fallbackLabel');
  });
});

describe('painel de religamento — UI', () => {
  it('está plugado na página de diagnósticos', () => {
    expect(page).toContain("import OrphanDirectComponentsPanel from '@/components/technical-sheets/OrphanDirectComponentsPanel'");
    expect(page).toContain('<OrphanDirectComponentsPanel />');
  });

  it('avisa quando o mesmo ID tem nomes conflitantes entre fichas', () => {
    expect(panel).toContain('nomeConflitante');
    expect(panel).toContain('nomes diferentes');
    expect(panel).toContain('confira na bancada');
  });

  it('explica apagado vs inativo', () => {
    expect(panel).toContain('não são reservados nem debitados');
    expect(panel).toContain('somem no seletor da ficha mas o SQL ainda debita');
  });

  it('invalida a lista após religar, pra não mostrar dado velho', () => {
    expect(panel).toContain("queryKey: ['orphan_direct_components'] }");
    expect(panel).toContain('invalidateQueries');
  });

  it('bloqueia o botão até escolher o produto substituto', () => {
    expect(panel).toMatch(/disabled=\{!picked\[o\.dead_product_id\]/);
  });
});
