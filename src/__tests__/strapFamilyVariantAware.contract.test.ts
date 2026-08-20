import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const FAMILY_SQL = read('supabase/migrations/20261026120000_strap-base-family-variant-aware.sql');
const REWIRE_SQL = read('supabase/migrations/20261026120100_strap-debit-and-purchase-use-variant-family.sql');
// Arquivos que DEFINEM os corpos que a 20261026120100 religa por substituição.
const DEBIT_SOURCE = read('supabase/migrations/20261021130000_strap-debit-uses-single-engine-from-cutover.sql');
const ENGINE_SOURCE = read('supabase/migrations/20261021120000_strap-sourcing-single-engine.sql');

const dialog = read('src/components/sale-orders/CreateStrapProductDialog.tsx');
const itemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');

describe('tira artesanal — a família da napa enxerga a variante do item', () => {
  it('resolve a família na precedência decidida: variante antes da ficha', () => {
    const body = FAMILY_SQL.match(
      /CREATE OR REPLACE FUNCTION public\.strap_base_family_for_sheet\(\s*p_reference_id uuid,\s*p_variant_id\s+uuid\s*\)([\s\S]*?)\$function\$;/,
    )?.[1];
    expect(body).toBeTruthy();

    // A ordem dos ramos do COALESCE É a regra de negócio.
    const order = [
      'v.upper_material_group_id',
      'v.upper_material_product_id',
      'v.lining_material_group_id',
      'v.lining_material_product_id',
      'ts.upper_material',
      'ts.lining_material',
    ].map((token) => body!.indexOf(token));

    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('ignora variante que não pertence à ficha do item', () => {
    expect(FAMILY_SQL).toContain('p_reference_id IS NULL OR rmv.reference_id = p_reference_id');
  });

  it('mantém a versão de 1 argumento como wrapper, sem duplicar a regra', () => {
    const wrapper = FAMILY_SQL.split(
      'CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(p_reference_id uuid)',
    )[1];
    expect(wrapper).toContain('SELECT public.strap_base_family_for_sheet(p_reference_id, NULL::uuid);');
    // Se o wrapper reimplementasse a cascata, as duas versões divergiriam com o tempo.
    expect(wrapper).not.toContain('lining_material_group_id');
  });

  it('overload NÃO usa DEFAULT — senão a chamada de 1 argumento fica ambígua', () => {
    expect(FAMILY_SQL).not.toMatch(/p_variant_id\s+uuid\s+DEFAULT/i);
  });
});

describe('religamento dos consumidores (débito + compras)', () => {
  it('religa as duas funções que decidem de qual napa a tira sai', () => {
    expect(REWIRE_SQL).toContain("p.proname = 'debit_strap_stock'");
    expect(REWIRE_SQL).toContain("p.proname = 'resolve_strap_stock_lines'");
    expect(REWIRE_SQL).toContain('strap_base_family_for_sheet(v_ref_id, v_variant_id)');
    expect(REWIRE_SQL).toContain('soi.material_variant_id');
  });

  it('aborta em vez de virar no-op silencioso quando a âncora sumir', () => {
    const aborts = REWIRE_SQL.match(/RAISE EXCEPTION 'ancora [^']+nao encontrada/g) ?? [];
    expect(aborts.length).toBeGreaterThanOrEqual(4);
    expect(REWIRE_SQL).toContain('ainda chamam a versao variant-blind');
  });

  it('é idempotente: rodar de novo detecta que já foi religada', () => {
    expect(REWIRE_SQL).toContain('strap_base_family_for_sheet\\(v_ref_id, v_variant_id\\)');
    expect(REWIRE_SQL).toContain('strap_base_family_for_sheet\\(p_reference_id,');
  });

  // Guard de REPLAY: num `db reset` a substituição roda sobre o corpo que os
  // arquivos anteriores criam. Se alguém editar aqueles arquivos, as âncoras
  // deixam de casar e a migration aborta — este teste pega antes do deploy.
  it('cada âncora existe EXATAMENTE uma vez no arquivo que define o corpo', () => {
    // A âncora do metadata vive DENTRO de um literal SQL na migration, então lá
    // ela aparece com as aspas dobradas — no corpo da função, não.
    const anchors: Array<{ noCorpo: string; naMigration: string; source: string }> = [
      {
        noCorpo: 'v_soi_id uuid; v_ref_id uuid; v_family text; v_pv_created date;',
        naMigration: 'v_soi_id uuid; v_ref_id uuid; v_family text; v_pv_created date;',
        source: DEBIT_SOURCE,
      },
      {
        noCorpo: 'IF v_use_engine THEN v_family := public.strap_base_family_for_sheet(v_ref_id); END IF;',
        naMigration: 'IF v_use_engine THEN v_family := public.strap_base_family_for_sheet(v_ref_id); END IF;',
        source: DEBIT_SOURCE,
      },
      {
        noCorpo: "'sourcing', COALESCE(v_sourcing, 'legacy'))",
        naMigration: "''sourcing'', COALESCE(v_sourcing, ''legacy''))",
        source: DEBIT_SOURCE,
      },
      {
        noCorpo: 'v_family := public.strap_base_family_for_sheet(p_reference_id);',
        naMigration: 'v_family := public.strap_base_family_for_sheet(p_reference_id);',
        source: ENGINE_SOURCE,
      },
    ];
    for (const { noCorpo, naMigration, source } of anchors) {
      expect(REWIRE_SQL).toContain(naMigration);
      expect(source.split(noCorpo).length - 1).toBe(1);
    }
  });

  it('deixa rastro no metadata da reserva de qual família saiu e de onde', () => {
    expect(REWIRE_SQL).toContain("''base_family'', v_family");
    expect(REWIRE_SQL).toContain("''variant'' ELSE ''sheet''");
  });
});

describe('intenção de tira do PV e editor canônico do catálogo', () => {
  it('o PV não abre editor de catálogo para a tira reference_base', () => {
    expect(itemForm).not.toContain('CreateStrapProductDialog');
    expect(itemForm).toContain("'Produção interna automática'");
  });

  it('o adaptador abre o mesmo editor atômico do hub', () => {
    expect(dialog).toContain('<ArtisanalStrapEditor');
    expect(dialog).toContain('useArtisanalStrapCatalog(false)');
  });

  it('não resolve base por nome nem grava a tabela de receita legada', () => {
    expect(dialog).not.toContain("rpc('strap_base_family_for_sheet'");
    expect(dialog).not.toContain("from('artisanal_recipes')");
    expect(dialog).not.toContain("create_artisanal_product_with_stock");
  });

  it('mantém o contexto do PV sem transformar texto em identidade operacional', () => {
    expect(dialog).toContain("origin={origin || (referenceId ? 'pv' : 'grupos')}");
    expect(dialog).toContain('o editor exige UUIDs');
  });
});
