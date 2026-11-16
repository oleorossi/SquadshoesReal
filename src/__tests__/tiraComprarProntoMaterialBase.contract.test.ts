/**
 * PV-00250 (16/11/2026): Comprar pronto de napa (I701 CHAMPAGNE / GLOW METALIC)
 * era recusado na aprovação e no save porque o pré-voo e o writer ainda exigiam
 * SKU, largura e receita de Prestador.
 *
 * Na ficha, "Segue o material da referência" já resolve Forração (modelo sem
 * Cabedal) ou Cabedal (modelo com Cabedal). Material fixo / selecionar no
 * pedido grava o grupo escolhido. Esta migration não reescreve esse resolvedor:
 * só deixa de exigir receita quando a origem é Comprar pronto e o grupo já
 * veio resolvido. Prestador sem receita continua bloqueado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const FILE = '20270101047300_comprar-pronto-segue-material-base.sql';
const MARKER = 'strap_buy_ready_segue_material_base_20270101047300';
const migration = readFileSync(resolve(ROOT, 'supabase/migrations', FILE), 'utf8');

function sqlBlock(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const tail = source.slice(from);
  const to = tail.indexOf(end);
  expect(to, end).toBeGreaterThan(0);
  return tail.slice(0, to);
}

const writer = sqlBlock(migration, 'DO $patch_writer_buy_ready$', 'DO $patch_enqueue_buy_ready$');
const enqueue = sqlBlock(migration, 'DO $patch_enqueue_buy_ready$', 'COMMENT ON FUNCTION');
const filter = sqlBlock(enqueue, 'WHERE NOT (', '$new_agg$');

describe('Comprar pronto segue o material base da ficha (47300)', () => {
  it('não reescreve o resolvedor Forração/Cabedal nem o de política da ficha', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION private.resolve_technical_strap_material');
    expect(migration).toContain('follow_reference');
    expect(migration).toContain('Forração/Cabedal');
  });

  it('o writer manda buy_ready para o ramo que não chama ensure', () => {
    expect(writer).toContain(MARKER);
    expect(writer).toContain("nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'");
    expect(writer).toContain("coalesce(v_existing_source ->> 'source_mode', '') = 'buy_ready'");
    expect(writer).toContain('strap_comprar_pronto_so_registra_20270101045300');
    // Prestador permanece no ELSIF, com a materialização da receita.
    expect(writer).toContain("ELSIF v_sheet_basis = ''reference_base'' THEN");
    expect(writer).toContain('private.ensure_sale_order_internal_strap_materials(');
    expect(writer).toContain('private.resolve_technical_strap_material(');
    expect(writer).toContain("'pv_origem', 'sku_acabado'");
    expect(writer).toContain('Writer perdeu o ramo interno (ensure)');
  });

  it('a mensagem de aprovação usa o nome da ficha quando o código está vazio', () => {
    const inserted = sqlBlock(enqueue, 'v_new text := $new$', '$new$;');
    expect(inserted).toContain(
      "COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS reference_code",
    );
    expect(inserted).not.toContain(
      "COALESCE(NULLIF(btrim(ts.code), ''), '?') AS reference_code",
    );
    // A âncora antiga fica só no texto que será substituído.
    expect(sqlBlock(enqueue, 'v_old text := $old$', '$old$;')).toContain(
      "COALESCE(NULLIF(btrim(ts.code), ''), '?') AS reference_code",
    );
  });

  it('buy_ready com cor canônica e material resolvido não entra na recusa de catálogo', () => {
    expect(filter).toContain("issue.value ->> 'code' = 'material_posicao_sem_catalogo'");
    expect(filter).toContain("nullif(line.value ->> 'pv_origem', '') = 'sku_acabado'");
    expect(filter).toContain("->> 'source_mode'");
    expect(filter).toContain("= 'buy_ready'");
    expect(filter).toContain('public.resolve_strap_canonical_color_id(line.value ->> \'color\')');
    expect(filter).toContain('public.resolve_strap_canonical_color_id(v_item.color)');
    expect(filter).toContain("canonical_color.active");
    expect(filter).toContain("nullif(resolved.value ->> 'base_group_id', '') IS NOT NULL");
    expect(enqueue).toContain('public.diagnose_sale_order_internal_strap_readiness(');
    expect(enqueue).toContain('Tiras sem cadastro completo');
  });

  it('Prestador sem cadastro e Comprar pronto sem cor continuam bloqueando', () => {
    // O filtro só abre material_posicao_sem_catalogo. Sem buy_ready/sku_acabado
    // o NOT não dispara — a lacuna interna segue na lista.
    expect(filter).not.toContain("= 'internal'");
    expect(filter).not.toContain('cor_nao_canonica');
    expect(filter).toContain('follow_main');
    // Sem base_group_id resolvido o EXISTS falha e a linha continua recusada.
    expect(enqueue).toContain('Filtro deixou passar Comprar pronto sem material base resolvido');
    expect(enqueue).toContain('factory_gate_is_atelier_pipeline_deferral');
    expect(enqueue).toContain('assert_sale_order_atelier_returned_for_production');
    expect(enqueue).toContain('idempotency_key inválida');
  });
});
