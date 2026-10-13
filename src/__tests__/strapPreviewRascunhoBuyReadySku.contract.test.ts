/**
 * Preview PROSPECTIVO da tira (PV em Rascunho/Pendente) × writer do PV.
 *
 * Bug (PV-00236, Rascunho, 13/10/2026 — 6 itens / 2.220 pares): o bloco
 * "Tiras · comprar pronto" do Consumo de Materiais saía com 1.915,20 m e
 * QUATRO avisos vermelhos nas 7 linhas ao mesmo tempo:
 *   catalog_resolution_blocked ("Compra pronta bloqueada: buy_ready_not_enabled")
 *   variant_identity_not_persisted
 *   reference_base_intent_mismatch
 *   frozen_source_snapshot_stale
 * e o `finished_product_id` congelado em `strap_sourcing` voltava NULL.
 *
 * É a MESMA divergência writer × guarda que a 39600 e a 40200 fecharam, agora
 * na TERCEIRA camada — a da LEITURA, não a da escrita.
 * `public.preview_sale_order_strap_demand_draft` desvia PV não comprometido
 * para `private.preview_sale_order_strap_demand_draft_pre_20270101015500` e
 * retorna ali mesmo; esse helper legado aplica o contrato PRÉ-31900
 * (reference_base ⇒ exige internal + receita + produto-base, e compara o
 * congelado com a VARIANTE do Hub).
 *
 * Por isso o furo só aparecia em RASCUNHO: no PV comprometido a própria
 * `preview_sale_order_strap_demand_draft` já descarta os códigos derivados do
 * catálogo quando `private.resolve_committed_strap_identity` devolve
 * valid=true — e ela já honra o contrato da 31900.
 *
 * ⚠ Este arquivo aponta para a migration que define o helper prospectivo AGORA
 * (40800). Contrato lendo arquivo superado passa verde enquanto a função viva
 * perde uma guarda — a prova do corpo VIVO está nas asserções pós-EXECUTE da
 * própria 40800, que falham alto na aplicação.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FILE = '20270101040800_preview-rascunho-strap-aceita-sku-acabado.sql';
const MARKER = 'strap_preview_rascunho_sku_acabado_sem_variante_20270101040800';
const migration = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

function latestMigrationMentioning(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit = '';
  for (const file of files) {
    if (readFileSync(resolve(MIGRATIONS, file), 'utf8').includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('Preview prospectivo da tira — buy_ready do PV identifica por SKU acabado', () => {
  it('é a migration canônica do marcador e patcha o corpo VIVO', () => {
    expect(latestMigrationMentioning(MARKER)).toBe(FILE);
    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain(
      "'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'",
    );
  });

  it('casa com o texto exato dos QUATRO trechos antes de substituir', () => {
    // Se o corpo vivo mudar, a migration tem que FALHAR na aplicação em vez de
    // substituir nada — por isso ela confere hits=1 em cada um.
    expect(migration).toContain(
      '    EXCEPTION WHEN OTHERS THEN\n'
      + '      v_selected_variant_id := NULL;\n'
      + '      v_selected_recipe_id := NULL;\n'
      + '      v_selected_base_product_id := NULL;\n'
      + '    END;',
    );
    expect(migration).toContain(
      "      IF v_selected_source IS DISTINCT FROM 'internal'\n"
      + '         OR v_selected_recipe_id IS NULL\n'
      + '         OR v_selected_base_product_id IS NULL',
    );
    expect(migration).toContain(
      '    IF v_selected_variant_id IS NULL\n'
      + '       OR strap_variant_id IS DISTINCT FROM v_selected_variant_id\n'
      + '       OR recipe_id IS DISTINCT FROM v_selected_recipe_id\n'
      + '       OR base_product_id IS DISTINCT FROM v_selected_base_product_id THEN',
    );
    expect(migration).toContain(
      "      IF v_line_color_mode = 'follow_main'\n"
      + '         AND v_pinned_base_product_id IS NOT NULL',
    );
    for (const alvo of [
      'Parse dos IDs congelados nao encontrado (hits=%); corpo mudou, revise 40800',
      'Ramo reference_base nao encontrado (hits=%); corpo mudou, revise 40800',
      'Guarda de napa pinada nao encontrada (hits=%); corpo mudou, revise 40800',
      'Guarda de frescor do congelado nao encontrada (hits=%); corpo mudou, revise 40800',
    ]) {
      expect(migration).toContain(alvo);
    }
  });

  it('o ramo novo só vale para a forma EXATA que o writer da 31900 produz', () => {
    // buy_ready + variante NULA + SKU acabado presente. Qualquer outra forma cai
    // no ramo original, que segue estrito.
    const guarda = "      IF v_selected_source = 'buy_ready'\n"
      + '         AND v_selected_variant_id IS NULL\n'
      + '         AND public.try_parse_uuid(\n'
      + "               v_selection ->> 'finished_product_id') IS NOT NULL THEN";
    expect(migration).toContain(guarda);
    expect(migration).toContain('      ELSIF v_selected_source IS DISTINCT FROM');
    expect(migration).toContain('    ELSIF v_selected_variant_id IS NULL');
  });

  it('devolve o SKU acabado congelado e descarta só os 2 códigos do motor-base', () => {
    expect(migration).toContain(
      '      finished_product_id := public.try_parse_uuid(\n'
      + "        v_selection ->> 'finished_product_id');",
    );
    expect(migration).toContain(
      "         WHERE coalesce(reason.value ->> 'code', '') NOT IN (\n"
      + "           'catalog_resolution_blocked',\n"
      + "           'variant_identity_not_persisted'\n"
      + '         )',
    );
  });

  it('NÃO afrouxa: tira comprada pronta não carrega receita nem napa-base', () => {
    expect(migration).toContain('        IF v_selected_recipe_id IS NOT NULL\n'
      + '           OR v_selected_base_product_id IS NOT NULL');
    expect(migration).toContain(
      "'A tira comprada pronta deve usar a cor exigida pela ficha e nao pode carregar receita nem napa-base.'",
    );
  });

  it('o SKU acabado congelado é validado com o MESMO teste da leitura comprometida', () => {
    // resolve_committed_strap_identity exige ativo + unidade linear; rascunho e
    // PV comprometido não podem divergir na mesma linha.
    expect(migration).toContain(
      '            WHERE product.id = public.try_parse_uuid(\n'
      + "                    v_selection ->> 'finished_product_id')\n"
      + '              AND product.active\n'
      + "              AND product.unit = 'm'",
    );
    expect(migration).toContain(
      "'O SKU acabado congelado da tira pronta nao existe mais, esta inativo ou nao e vendido por metro; salve novamente o pedido antes de confirmar.'",
    );
  });

  it('a invariante de napa pinada passa a valer só para produção interna', () => {
    expect(migration).toContain(
      "      IF v_line_color_mode = 'follow_main'\n"
      + "         AND v_selected_source = 'internal'\n"
      + '         AND v_pinned_base_product_id IS NOT NULL',
    );
  });

  it('exige o ramo da 31900 vivo em resolve_committed_strap_identity', () => {
    // Sem ele, relaxar o caminho prospectivo deixaria rascunho e PV comprometido
    // com contratos DIFERENTES para a mesma linha.
    expect(migration).toContain('private.resolve_committed_strap_identity(uuid,uuid,jsonb)');
    expect(migration).toContain('aplique a 31900 antes da 40800');
    // Conferido pelo 'reason' do ramo, NAO pelo marcador literal da 31900: o
    // contrato pvSkuAcabadoBuyReadySemVariante trata o ultimo arquivo que cita um
    // marcador como quem define aquele corpo, e esta migration patcha OUTRA
    // funcao. Citar o marcador aqui roubaria a posse dele (e quebra aquele teste).
    expect(migration).not.toContain('strap_pv_sku_acabado_sem_variante_20270101031900');
    expect(migration).toContain(
      "$r31900$'reason', 'SKU acabado congelado da tira pronta nao existe mais'$r31900$",
    );
  });

  it('confere que os ramos ORIGINAIS de identidade sobreviveram ao replace', () => {
    for (const ramo of [
      'A tira interna deve usar a cor exigida pela ficha e producao interna.',
      'A napa congelada diverge do SKU fisico pinado no cabedal.',
      'A tira de grupo acabado deve permanecer buy_ready.',
      'A base de identidade da tira e invalida.',
    ]) {
      expect(migration).toContain(ramo);
    }
    expect(migration).toContain(
      'Helper perdeu um dos ramos originais de identidade; revise 40800',
    );
    expect(migration).toContain('Helper nao ficou com o contrato novo; revise 40800');
  });
});
