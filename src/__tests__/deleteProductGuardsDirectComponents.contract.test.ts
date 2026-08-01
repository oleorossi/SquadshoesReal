import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const SQL = read('supabase/migrations/20261028120000_force-delete-product-cleans-direct-components.sql');
const hook = read('src/hooks/useProducts.ts');
const dialog = read('src/components/inventory/ForceDeleteProductDialog.tsx');

// Bug 31/07/2026: direct_components e jsonb dentro de technical_sheets, nao FK.
// Sem contagem propria o DELETE nao falhava e o produto sumia sem aviso,
// deixando a ficha apontando pro nada (25 linhas mortas em 24 fichas).
describe('excluir produto — o vínculo de componente direto não pode passar batido', () => {
  it('conta as fichas que levam o produto como componente direto', () => {
    expect(hook).toContain("supabase.from('technical_sheets')");
    expect(hook).toContain("contains('direct_components', [{ product_id: id }])");
  });

  it('inclui direct_components no hasAny — é ele que dispara a confirmação', () => {
    const hasAny = hook.match(/hasAny:\s*([^,]*(?:,[^,]*)*?)\n\s*\};/)?.[1] ?? '';
    expect(hasAny).toContain('direct_components > 0');
  });

  it('o campo é obrigatório no tipo, pra não voltar a ser esquecido', () => {
    const iface = hook.match(/export interface ProductLinksSummary \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(iface).toMatch(/direct_components:\s*number;/);
    expect(iface).not.toMatch(/direct_components\?:/);
  });

  it('o diálogo mostra o vínculo e desaconselha excluir-para-recriar', () => {
    expect(dialog).toContain('state.links.direct_components > 0');
    expect(dialog).toContain('como componente');
    // O ID novo nao reata o vinculo — este aviso e o que evita repetir o bug.
    expect(dialog).toContain('desative em vez de excluir');
  });
});

describe('force_delete_product limpa o jsonb junto', () => {
  it('remove o produto de direct_components das fichas', () => {
    expect(SQL).toContain('direct_components @> jsonb_build_array(');
    expect(SQL).toContain("dc ->> 'product_id' IS DISTINCT FROM p_product_id::text");
    expect(SQL).toContain('SET direct_components = n.lista');
  });

  it('reporta quantas fichas foram tocadas', () => {
    expect(SQL).toContain("'direct_components_count', v_direct_components_count");
    expect(hook).toContain('s.direct_components_count > 0');
  });

  it('ficha sem componente nenhum vira array vazio, não NULL', () => {
    expect(SQL).toContain("'[]'::jsonb");
  });

  it('mantém as outras 4 limpezas que já existiam', () => {
    for (const t of ['sheet_materials', 'material_reservations', 'purchase_order_items', 'stock_movements']) {
      expect(SQL).toContain(`DELETE FROM public.${t} WHERE product_id = p_product_id`);
    }
  });
});
