import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const migration = read(
  'supabase/migrations/20270101015400_cores_independentes_por_tira_no_pv.sql',
);
const databaseE2e = read('supabase/tests/independent_strap_colors_e2e.sql');
const technicalLines = read('src/lib/technicalStrapLines.ts');
const saleOrderHook = read('src/hooks/useSaleOrders.ts');
const desktop = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const mobile = read('src/pages/mobile/MobileNewOrder.tsx');
const technicalSheets = read('src/pages/TechnicalSheets.tsx');

describe('cores independentes por linha de tira', () => {
  it('mantém o default legado e separa política de cor da identidade física', () => {
    expect(technicalLines).toContain("export type StrapColorMode = 'follow_main' | 'select_on_order'");
    expect(technicalLines).toContain("if (strapIdentityBasis(line) === 'finished_product_group') return 'select_on_order'");
    expect(technicalLines).toContain("line?.color_mode === 'select_on_order' ? 'select_on_order' : 'follow_main'");
    expect(saleOrderHook).toContain('color_mode?: StrapColorMode | null');
  });

  it('faz desktop e mobile sincronizarem somente follow_main', () => {
    for (const source of [desktop, mobile]) {
      expect(source).toContain("strapColorMode(");
      expect(source).toContain("'select_on_order'");
      expect(source).toContain("'follow_main'");
    }
    expect(desktop).toContain('strapColorsForIdentity(');
    expect(desktop).toContain("onUpdate(index, 'strap_sourcing', setStrapSourcing(");
    expect(mobile).toContain('mobileIndependentStrapColorIssues');
    expect(mobile).toContain('clearIncompatibleMobileStrapSelections');
  });

  it('rotula os seletores e mostra as cores por posição na revisão mobile', () => {
    expect(desktop).toContain('aria-label={`Cor de ${strap.label || `Tira ${sIdx + 1}`}`}');
    expect(technicalSheets).toContain('aria-label={`Política de cor de ${strap.label || `Tira ${idx + 1}`}`}');
    expect(mobile).toContain('mobileIndependentStrapReviewLines(it)');
    expect(mobile).toContain('{strap.position}</span>: {strap.color}');
  });

  it('valida grupo/cor pelo manifesto owner-scoped e bloqueia cold-start offline sem cache', () => {
    expect(mobile).toContain('loadMobileStrapOfflineManifest(ownerId)');
    expect(mobile).toContain('fetchMobileStrapOfflineManifest()');
    expect(mobile).toContain('saveMobileStrapOfflineManifest(ownerId, fresh)');
    expect(mobile).toContain('findMobileStrapManifestReference(');
    expect(mobile).toContain('manifestLine.allowed_colors.some');
    expect(mobile).toContain('}, online);');
    expect(mobile).toContain('Catálogo offline de tiras indisponível');
    expect(mobile).toContain('!ownerScopedStrapManifest');
    expect(mobile).not.toContain('useArtisanalStrapCatalog');
    expect(mobile).toContain('selectableStrapValidationIssues.length > 0');
  });

  it('reidrata color_mode da ficha e materializa cada UUID com a própria cor', () => {
    expect(migration).toContain('independent_strap_colors_20270101015400');
    expect(migration).toContain("- 'identity_basis' - 'identity_group_id' - 'color_mode'");
    expect(migration).toContain("'color_mode', v_color_mode");
    expect(migration).toContain('v_line_color_id := nullif(v_line ->> \'color_id\', \'\')::uuid');
    expect(migration).toContain('v_reference_id, v_material_variant_id, v_line_color_id, ARRAY[v_line_id]');
    expect(migration).toContain("'color_id', v_line_color_id");
    expect(migration).toContain("'ensured', v_ensure_lines");
    expect(migration).toContain('jsonb_agg(item_line.value ORDER BY sheet_line.ordinality)');
    expect(migration).toContain('jsonb_agg(line.value ORDER BY');
  });

  it('reconhece reordenação equivalente sem alterar a sequência de um snapshot comprometido', () => {
    expect(migration).toContain("coalesce(v_current.strap_colors, '[]'::jsonb)");
    expect(migration).toContain("'strap_colors', coalesce(v_current.strap_colors, '[]'::jsonb)");
    expect(migration).toContain('O snapshot comprometido e um fato historico completo');
  });

  it('aceita somente subconjuntos exatos e preserva o pin nas linhas follow_main', () => {
    expect(migration).toContain('cardinality(v_expected_sorted) = 0');
    expect(migration).toContain('count(DISTINCT expected_id)');
    expect(migration).toContain('NOT expected_id = ANY(v_reference_sorted)');
    expect(migration).toContain('= ANY(coalesce(p_expected_line_ids, ARRAY[]::uuid[]))');
    expect(migration).toContain('v_enforce_pinned_product boolean := true');
    expect(migration).toContain('AND v_enforce_pinned_product THEN');
  });

  it('faz o guard validar variante, SKU-base e sourcing pela cor da linha', () => {
    expect(migration).toContain("v_color_mode = 'follow_main'");
    expect(migration).toContain("v_color_mode = 'select_on_order'");
    expect(migration).toContain('av.color_id = v_line_color_id');
    expect(migration).toContain('op.color_id = v_line_color_id');
    expect(migration).toContain("v_patched := replace(v_patched, '= v_expected_color_id', '= v_line_color_id')");
    expect(migration).toContain("IF v_occurrences <> 4 THEN");
    expect(migration).toContain("v_source_mode IS DISTINCT FROM 'internal'");
    expect(migration).toContain("v_color_mode <> 'follow_main'");
  });

  it('mantém preview histórico congelado e aplica a política apenas no ramo prospectivo', () => {
    expect(migration).toContain('Demandas ja');
    expect(migration).toContain('persistidas continuam congeladas');
    expect(migration).toContain("v_line_color_mode = 'select_on_order'");
    expect(migration).toContain("v_line_color_mode = 'follow_main'");
    expect(migration).toContain("v_selected_source IS DISTINCT FROM 'internal'");
    expect(migration).toContain('Rascunhos com UUID tambem passam pela politica autoritativa');
    expect(migration).toContain(
      "OR position('IF NOT v_is_persisted OR v_line_id IS NULL' IN v_definition) > 0",
    );
    expect(migration).toContain("'A tira interna deve usar a cor exigida pela ficha e producao interna.'");
  });

  it('valida a política técnica, trava mudança estrutural e contextualiza falhas por posição', () => {
    expect(migration).toContain("v_color_mode NOT IN ('follow_main', 'select_on_order')");
    expect(migration).toContain("'color_mode', CASE");
    expect(migration).toContain("coalesce(nullif(v_line ->> 'label', ''), 'TIRA')");
    expect(migration).toContain("Modelo % / %, %: selecione a cor no Pedido de Venda");
    expect(migration).toContain("Modelo % / %, %: %");
  });

  it('mantém um cenário transacional real de três cores e cinco demandas por UUID', () => {
    expect(databaseE2e).toContain('BEGIN;');
    expect(databaseE2e).toContain('ROLLBACK;');
    expect(databaseE2e).toContain('public.create_sale_order_command(');
    expect(databaseE2e).toContain('public.process_strap_demand_job(');
    expect(databaseE2e).toContain("hashtextextended('strap-pv-auto-intent', 0)");
    expect(databaseE2e).toContain('v_line_count = 5');
    expect(databaseE2e).toContain('v_technical_line_count = 5');
    expect(databaseE2e).toContain('v_color_count = 3');
    expect(databaseE2e).toContain('v_variant_count = 3');
    expect(databaseE2e).toContain('v_expected_m_by_line');
    expect(databaseE2e).toContain("'consumption_per_size' ->> v_size)::numeric / 100");
    expect(databaseE2e).toContain('Preview não coincide com o oracle independente de cm→m por UUID');
    expect(databaseE2e).toContain('ORDER BY CASE line.ordinality');
    expect(databaseE2e).toContain("Worker permutou cor/base/consumo entre UUIDs ou aplicou perda");
  });

  it('mantém as funções privilegiadas fechadas e não reintroduz perda de corte', () => {
    expect(migration).toContain('IF NOT public.is_approved_user() THEN');
    expect(migration).toContain("RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'");
    expect(databaseE2e).toContain('SET LOCAL ROLE authenticated');
    expect(databaseE2e).toContain('Preview SECURITY DEFINER aceitou authenticated sem profile aprovado');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.ensure_sale_order_internal_strap_intents\(uuid, uuid, uuid, uuid\[\]\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.prepare_sale_order_item_internal_straps\(jsonb\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_validate_sale_order_item_strap_color_alignment\(\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.preview_sale_order_strap_demand_draft\(jsonb\)\s+FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.preview_sale_order_strap_demand_draft\(jsonb\)\s+TO authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_validate_technical_strap_identity\(\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enqueue_sale_order_strap_demands\(uuid, text, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).not.toMatch(/waste_pct|waste_factor|consumption_loss_pct/);
    expect(migration).not.toMatch(/\bI91\b|dc553ff7-db5c-4ee5-83b9-e78469d2c0d7/i);
  });
});
