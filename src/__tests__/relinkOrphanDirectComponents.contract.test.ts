import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const SQL = read('supabase/migrations/20261028120200_list-and-relink-orphan-direct-components.sql');
const panel = read('src/components/technical-sheets/OrphanDirectComponentsPanel.tsx');
const page = read('src/pages/SystemDiagnostics.tsx');

describe('religamento de componente direto órfão — SQL', () => {
  it('agrupa pelo product_id, não pelo nome gravado', () => {
    const fn = SQL.split('CREATE OR REPLACE FUNCTION public.list_orphan_direct_components')[1] ?? '';
    expect(fn).toContain("(dc ->> 'product_id')::uuid");
    expect(fn).toContain('GROUP BY 1');
    // names é ARRAY porque o mesmo ID aparece com nomes diferentes entre fichas.
    expect(fn).toMatch(/array_agg\(DISTINCT btrim\(COALESCE\(dc ->> 'product_name'/);
  });

  it('só lista o que realmente perdeu o produto', () => {
    const fn = SQL.split('CREATE OR REPLACE FUNCTION public.list_orphan_direct_components')[1] ?? '';
    expect(fn).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.products p/);
  });

  it('recusa religar quando o produto "morto" ainda existe', () => {
    expect(SQL).toContain('ainda existe — isto religa apenas vínculo órfão');
  });

  it('recusa destino inexistente', () => {
    expect(SQL).toContain('Produto destino % não existe');
  });

  it('preserva quantidade e preço da linha — são dados da FICHA, não do produto', () => {
    const fn = SQL.split('CREATE OR REPLACE FUNCTION public.relink_direct_component')[1] ?? '';
    // Faz merge sobre o elemento original (dc || {...}), em vez de reconstruir
    // o objeto do zero, que perderia quantity/unit_price.
    expect(fn).toMatch(/dc\s*\|\|\s*jsonb_build_object\('product_id'/);
    expect(fn).not.toMatch(/jsonb_build_object\(\s*'product_id'[^)]*'quantity'/);
  });

  it('mantém a ordem dos componentes da ficha', () => {
    const fn = SQL.split('CREATE OR REPLACE FUNCTION public.relink_direct_component')[1] ?? '';
    expect(fn).toContain('WITH ORDINALITY');
    expect(fn).toContain('ORDER BY ord');
  });

  it('exige usuário aprovado', () => {
    expect(SQL).toContain('is_approved_user()');
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

  it('explica a consequência de deixar órfão', () => {
    expect(panel).toContain('não são reservados nem debitados');
  });

  it('invalida a lista após religar, pra não mostrar dado velho', () => {
    expect(panel).toContain("queryKey: ['orphan_direct_components'] }");
    expect(panel).toContain('invalidateQueries');
  });

  it('bloqueia o botão até escolher o produto substituto', () => {
    expect(panel).toMatch(/disabled=\{!picked\[o\.dead_product_id\]/);
  });
});
