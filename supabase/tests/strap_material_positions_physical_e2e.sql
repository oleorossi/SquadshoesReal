-- Ensaio operacional da migration 161: materiais A/B/A por posicao.
--
-- SOMENTE banco PostgreSQL descartavel, vazio, sem dados de producao.
-- Pre-requisitos: schema real das tabelas referenciadas, CHECKs/indices, funcoes
-- reais da migration 161 e suas dependencias operacionais ja instaladas.
-- O harness de desenvolvimento usa PGlite com auth.uid/auth.role lendo claims
-- locais, unaccent e SHA256. Nenhuma rotina de dominio e simulada neste teste.
--
-- Fluxo exercitado:
-- writer/materializador -> preview -> enqueue -> worker -> reconciliacao ->
-- inicio fabril -> recebimento/baixa da base -> bind -> settlement do acabado.
-- O claim do job e MANUAL (UPDATE queued -> processing); nao testa scheduler
-- nem disputa concorrente do claim. Todos os efeitos terminam em ROLLBACK.
--
-- Seis triggers centrais REAIS devem estar instalados (preflight abaixo):
-- sincronizacao de reserva, vinculo/enriquecimento do movimento, guards de
-- reserva/movimento e liquidacao da demanda. O teste nao instala mocks deles.
-- Os dois guards alterados pela 161 tambem executam em probes temporarios.
--
-- Limites: nao prova todos os FKs, RLS, triggers laterais, UI autenticada,
-- promocao atomica de PV/OP, terceiros, compra pronta ou concorrencia.
-- Validado em schema enxuto descartavel SEM FKs/RLS globais. Num Supabase
-- completo o usuario sintetico precisa existir primeiro em auth.users para
-- profiles.id respeitar a FK (e os gatilhos de cadastro podem exigir outras
-- fixtures). Nao desabilitar essas protecoes silenciosamente para rodar.
-- A OP e fixture direta; a baixa acabada chama o settlement canonico, nao o
-- gatilho de mudanca de status da OP. Nenhuma leitura de dados vivos e feita.
--
BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';

DO $disposable_preflight$
DECLARE v_trigger record;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.products)
     AND NOT EXISTS (SELECT 1 FROM public.sale_orders)
     AND NOT EXISTS (SELECT 1 FROM public.strap_production_batches)
     AND NOT EXISTS (SELECT 1 FROM public.stock_movements),
    'Este ensaio exige banco descartavel vazio; nao executar com dados reais';
  FOR v_trigger IN SELECT * FROM (VALUES
    ('material_reservations', 'tg_sync_reserved_stock'),
    ('material_reservations', 'trg_settle_strap_finished_demand'),
    ('material_reservations', 'trg_a_attach_strap_finished_movement'),
    ('material_reservations', 'trg_z_guard_strap_engine_reservation'),
    ('stock_movements', 'trg_enrich_strap_finished_stock_movement'),
    ('stock_movements', 'trg_z_guard_canonical_strap_stock_movement')
  ) required(table_name, trigger_name) LOOP
    ASSERT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = ('public.' || v_trigger.table_name)::regclass
        AND t.tgname = v_trigger.trigger_name
        AND NOT t.tgisinternal AND t.tgenabled <> 'D'
    ), 'Trigger real ausente/inativo: ' || v_trigger.trigger_name;
  END LOOP;
END
$disposable_preflight$;

INSERT INTO public.profiles (id, email, approved) VALUES
  ('00000000-0000-4000-8000-000000000001', 'strap-fixture@example.invalid', true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin');
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}', true);

INSERT INTO public.product_groups (id, name, sector, dimensions_width, dimensions_unit, is_artisanal_strap) VALUES
  ('10000000-0000-4000-8000-000000000001', 'FIXTURE NAPA A', 'Cabedal', 1000, 'mm', false),
  ('10000000-0000-4000-8000-000000000002', 'FIXTURE NAPA B', 'Cabedal', 1200, 'mm', false),
  ('10000000-0000-4000-8000-000000000003', 'FIXTURE NAPA SEM RECEITA', 'Cabedal', 900, 'mm', false),
  ('10000000-0000-4000-8000-000000000004', 'FIXTURE GRUPO INELEGIVEL', 'Cabedal', 0, 'mm', false),
  ('10000000-0000-4000-8000-000000000005', 'FIXTURE TIRA ACABADA', 'Componente', 0, 'mm', true);
INSERT INTO public.canonical_colors (id, name) VALUES
  ('30000000-0000-4000-8000-000000000001', 'FIXTURE PRETO'),
  ('30000000-0000-4000-8000-000000000002', 'FIXTURE BRANCO');
INSERT INTO public.products (id, name, sku, category, group_id, color, unit, purchase_unit, conversion_rate, dimensions_width, dimensions_unit, quantity) VALUES
  ('20000000-0000-4000-8000-000000000001', 'FIXTURE NAPA A PRETO', 'FIXTURE-NAPA-A-PRETO', 'Cabedal', '10000000-0000-4000-8000-000000000001', 'FIXTURE PRETO', 'm', 'm', 1, 1000, 'mm', 1000),
  ('20000000-0000-4000-8000-000000000002', 'FIXTURE NAPA B PRETO', 'FIXTURE-NAPA-B-PRETO', 'Cabedal', '10000000-0000-4000-8000-000000000002', 'FIXTURE PRETO', 'm', 'm', 1, 1200, 'mm', 1000),
  ('20000000-0000-4000-8000-000000000003', 'FIXTURE NAPA C PRETO', 'FIXTURE-NAPA-C-PRETO', 'Cabedal', '10000000-0000-4000-8000-000000000003', 'FIXTURE PRETO', 'm', 'm', 1, 900, 'mm', 1000),
  ('20000000-0000-4000-8000-000000000004', 'FIXTURE NAPA A BRANCO', 'FIXTURE-NAPA-A-BRANCO', 'Cabedal', '10000000-0000-4000-8000-000000000001', 'FIXTURE BRANCO', 'm', 'm', 1, 1000, 'mm', 1000),
  ('20000000-0000-4000-8000-000000000005', 'FIXTURE NAPA B BRANCO', 'FIXTURE-NAPA-B-BRANCO', 'Cabedal', '10000000-0000-4000-8000-000000000002', 'FIXTURE BRANCO', 'm', 'm', 1, 1200, 'mm', 1000);
INSERT INTO public.artisanal_strap_types (id, name) VALUES
  ('40000000-0000-4000-8000-000000000001', 'FIXTURE OVERLOCK');
INSERT INTO public.artisanal_strap_measures (id, strap_type_id, display_name, finished_width_mm) VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '5 MM', 5);
INSERT INTO public.base_material_width_profiles (id, base_group_id, version, usable_width_mm, status, valid_from, approved_by, approved_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 1000, 'approved', now() - interval '1 day', auth.uid(), now()),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, 1200, 'approved', now() - interval '1 day', auth.uid(), now()),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 1, 900, 'approved', now() - interval '1 day', auth.uid(), now());
INSERT INTO public.artisanal_strap_recipes (id, measure_id, base_group_id, base_width_profile_id, version, usable_base_width_mm_snapshot, cut_band_width_mm, confirmed_yield_m_per_m, executor_type, transformation_cost_per_m, status, valid_from, approved_by, approved_at) VALUES
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1, 1000, 10, 100, 'factory', 0, 'approved', now() - interval '1 day', auth.uid(), now()),
  ('70000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 1, 1200, 20, 60, 'factory', 0, 'approved', now() - interval '1 day', auth.uid(), now());

CREATE TEMP TABLE strap_fixture_state (key text PRIMARY KEY, value jsonb);
CREATE TEMP TABLE technical_guard_probe (LIKE public.technical_sheets INCLUDING DEFAULTS);
CREATE TRIGGER fixture_technical_guard BEFORE INSERT OR UPDATE ON technical_guard_probe
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_technical_strap_identity();
CREATE TEMP TABLE item_guard_probe (LIKE public.sale_order_items INCLUDING DEFAULTS);
CREATE TRIGGER fixture_item_guard BEFORE INSERT OR UPDATE ON item_guard_probe
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment();

DO $fixture$
DECLARE
  v_template jsonb := '{"identity_basis":"reference_base","strap_type_id":"40000000-0000-4000-8000-000000000001","measure_id":"50000000-0000-4000-8000-000000000001","group_id":"10000000-0000-4000-8000-000000000005","group_name":"FIXTURE TIRA ACABADA","color_mode":"follow_main","consumption":10}';
  v_lines jsonb;
  v_input jsonb;
  v_prepared jsonb;
  v_first jsonb;
  v_second jsonb;
  v_third jsonb;
  v_context jsonb;
  v_row record;
  v_rejected boolean;
  v_count integer;
BEGIN
  v_lines := jsonb_build_array(
    v_template || '{"technical_strap_line_id":"90000000-0000-4000-8000-000000000003","label":"TIRA 1"}'::jsonb,
    v_template || '{"technical_strap_line_id":"90000000-0000-4000-8000-000000000001","label":"TIRA 2","material_mode":"fixed_group","material_group_id":"10000000-0000-4000-8000-000000000002","consumption":20}'::jsonb,
    v_template || '{"technical_strap_line_id":"90000000-0000-4000-8000-000000000002","label":"TIRA 3","material_mode":"select_on_order","allowed_material_group_ids":["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002"],"color_mode":"select_on_order","consumption":30}'::jsonb
  );
  INSERT INTO public.technical_sheets (id, name, code, has_straps, upper_material, upper_material_group_id, upper_material_product_id, strap_base_group_id, strap_colors, status_ficha)
  VALUES ('80000000-0000-4000-8000-000000000001', 'FIXTURE POSICOES', 'FIXTURE-POSICOES', true, 'FIXTURE NAPA A', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', v_lines, 'publicada');
  INSERT INTO technical_guard_probe (name, strap_colors) VALUES ('FIXTURE VALIDA', v_lines);
  INSERT INTO strap_fixture_state VALUES ('technical_lines', v_lines);

  -- Materiais fixo/selecionavel nao herdam o SKU pinado da napa A.
  v_context := private.resolve_technical_strap_material('80000000-0000-4000-8000-000000000001', NULL, '90000000-0000-4000-8000-000000000001', NULL, true);
  ASSERT v_context ->> 'base_group_id' = '10000000-0000-4000-8000-000000000002';
  ASSERT v_context ->> 'pinned_base_product_id' IS NULL;

  -- Politica adulterada no browser deve ser reidratada por UUID e ordem tecnica.
  v_input := jsonb_build_object('reference_id', '80000000-0000-4000-8000-000000000001', 'color', 'FIXTURE PRETO', 'quantity', 100, 'grade', '{"36":100}'::jsonb, 'strap_colors', jsonb_build_array(
    (v_lines -> 2) || '{"base_group_id":"10000000-0000-4000-8000-000000000001","color_id":"30000000-0000-4000-8000-000000000001","color":"FIXTURE PRETO","material_mode":"follow_reference","base_group_name":"FORJADO"}'::jsonb,
    (v_lines -> 1) || '{"material_group_id":"10000000-0000-4000-8000-000000000001","base_group_id":"10000000-0000-4000-8000-000000000001"}'::jsonb,
    v_lines -> 0
  ));
  v_prepared := public.prepare_sale_order_item_internal_straps(v_input) -> 'item';
  INSERT INTO strap_fixture_state VALUES ('prepared', v_prepared), ('input', v_input);
  v_first := v_prepared -> 'strap_colors' -> 0;
  v_second := v_prepared -> 'strap_colors' -> 1;
  v_third := v_prepared -> 'strap_colors' -> 2;
  ASSERT v_first ->> 'technical_strap_line_id' = '90000000-0000-4000-8000-000000000003', 'Nao preservou ordem tecnica';
  ASSERT v_first ->> 'material_mode' = 'follow_reference', 'Legado nao normalizado';
  ASSERT v_second ->> 'base_group_id' = '10000000-0000-4000-8000-000000000002', 'Material fixo seguiu o global';
  ASSERT v_second ->> 'base_group_name' = 'FIXTURE NAPA B', 'Nome efetivo nao canonico';
  ASSERT v_third ->> 'material_mode' = 'select_on_order', 'Browser alterou politica';
  ASSERT v_third ->> 'base_group_name' = 'FIXTURE NAPA A', 'Nome forjado persistiu';
  ASSERT v_prepared #>> '{strap_sourcing,90000000-0000-4000-8000-000000000001,base_product_id}' = '20000000-0000-4000-8000-000000000002', 'Pin global vazou para B';
  ASSERT v_prepared #>> '{strap_sourcing,90000000-0000-4000-8000-000000000001,recipe_id}' = '70000000-0000-4000-8000-000000000002', 'Receita de outro material';
  ASSERT v_prepared #>> '{strap_sourcing,90000000-0000-4000-8000-000000000003,strap_variant_id}' = v_prepared #>> '{strap_sourcing,90000000-0000-4000-8000-000000000002,strap_variant_id}', 'Repeticao exata deveria compartilhar SKU';
  SELECT count(*) INTO v_count FROM public.artisanal_strap_variants;
  ASSERT v_count = 2, 'Deve haver duas variantes para tres posicoes A/B/A';

  INSERT INTO public.sale_orders (id, order_number) VALUES ('a0000000-0000-4000-8000-000000000001', 'FIXTURE-PV');
  INSERT INTO item_guard_probe (id, sale_order_id, reference_id, color, strap_colors, strap_sourcing, quantity, grade)
  VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'FIXTURE PRETO', v_prepared -> 'strap_colors', v_prepared -> 'strap_sourcing', 100, '{"36":100}');

  -- Guard real recusa SKU/receita/base/politica adulterados independentemente do writer.
  FOR v_row IN SELECT * FROM (VALUES
    ('{strap_sourcing,90000000-0000-4000-8000-000000000001,base_product_id}'::text[], '"20000000-0000-4000-8000-000000000001"'::jsonb),
    ('{strap_sourcing,90000000-0000-4000-8000-000000000001,recipe_id}'::text[], '"70000000-0000-4000-8000-000000000001"'::jsonb),
    ('{strap_colors,1,base_group_id}'::text[], '"10000000-0000-4000-8000-000000000001"'::jsonb),
    ('{strap_colors,1,material_mode}'::text[], '"follow_reference"'::jsonb)
  ) mutations(path, value) LOOP
    v_rejected := false;
    BEGIN
      v_context := jsonb_set(v_prepared, v_row.path, v_row.value);
      UPDATE item_guard_probe SET strap_colors = v_context -> 'strap_colors', strap_sourcing = v_context -> 'strap_sourcing';
    EXCEPTION WHEN OTHERS THEN
      v_rejected := true;
    END;
    ASSERT v_rejected, 'Guard aceitou snapshot adulterado: ' || v_row.path::text;
  END LOOP;

  -- Configuracoes invalidas sao bloqueadas no save da ficha, nao apenas na UI.
  FOR v_context IN SELECT value FROM jsonb_array_elements('[
    {"material_mode":"inexistente"},
    {"material_mode":"fixed_group","material_group_id":"10000000-0000-4000-8000-000000000004"},
    {"material_mode":"fixed_group","material_group_id":"10000000-0000-4000-8000-000000000005"},
    {"material_mode":"select_on_order","allowed_material_group_ids":[]},
    {"material_mode":"select_on_order","allowed_material_group_ids":["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000001"]},
    {"identity_basis":"finished_product_group","material_mode":"fixed_group","material_group_id":"10000000-0000-4000-8000-000000000001"}
  ]'::jsonb) LOOP
    v_rejected := false;
    BEGIN
      INSERT INTO technical_guard_probe (name, strap_colors) VALUES ('FIXTURE INVALIDA', jsonb_build_array(v_template || v_context));
    EXCEPTION WHEN SQLSTATE '23514' THEN
      v_rejected := true;
    END;
    ASSERT v_rejected, 'Guard tecnico aceitou politica invalida: ' || v_context::text;
  END LOOP;
END
$fixture$;

SELECT 'writer, materializador e guards reais: A/B/A, pin, receitas, UUIDs, politica adulterada' AS passed;

DO $preview_manifest_atomicity$
DECLARE
  v_prepared jsonb := (SELECT value FROM strap_fixture_state WHERE key = 'prepared');
  v_input jsonb;
  v_bad jsonb;
  v_manifest jsonb;
  v_lines jsonb;
  v_preview jsonb;
  v_row record;
  v_rejected boolean;
  v_variants integer;
  v_products integer;
  v_officials integer;
  v_audits integer;
BEGIN
  SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.line_ordinal) INTO v_preview
    FROM public.preview_sale_order_strap_demand_draft(v_prepared) preview;
  ASSERT jsonb_array_length(v_preview) = 3, 'Preview deduplicou contribuicoes por SKU';
  ASSERT (v_preview #>> '{0,gross_required_m}')::numeric = 10, '10 cm/par x 100 deve ser 10 m';
  ASSERT (v_preview #>> '{1,gross_required_m}')::numeric = 20;
  ASSERT (v_preview #>> '{2,gross_required_m}')::numeric = 30;
  ASSERT (v_preview #>> '{0,resolved,base_required_m}')::numeric = 0.1, 'Napa A deve usar rendimento 100 sem perda';
  ASSERT abs((v_preview #>> '{1,resolved,base_required_m}')::numeric - 20::numeric / 60) < 0.000001, 'Napa B deve usar rendimento 60';
  ASSERT (v_preview #>> '{2,resolved,base_required_m}')::numeric = 0.3, 'Repeticao A tem contribuicao independente';

  v_manifest := public.get_mobile_strap_offline_manifest(ARRAY['80000000-0000-4000-8000-000000000001'::uuid]);
  ASSERT (v_manifest ->> 'version')::integer = 2, 'Cache antigo nao invalidado';
  v_lines := v_manifest #> '{references,0,lines}';
  ASSERT jsonb_array_length(v_lines) = 3, 'Manifesto omitiu posicoes';
  ASSERT v_lines #>> '{1,base_group_name}' = 'FIXTURE NAPA B';
  ASSERT jsonb_array_length(v_lines #> '{2,material_options}') = 2, 'Selecao exige ambas as opcoes';
  ASSERT v_lines #>> '{2,base_group_id}' IS NULL, 'Manifesto nao pode antecipar material da escolha';
  ASSERT v_lines #>> '{2,material_options,0,base_group_id}' = '10000000-0000-4000-8000-000000000001';
  ASSERT v_lines #>> '{2,material_options,1,base_group_name}' = 'FIXTURE NAPA B';
  ASSERT jsonb_array_length(v_lines #> '{2,material_options,1,allowed_colors}') = 2, 'Cores devem ser especificas do material';

  -- Escolha ausente/bypass da allow-list: preview bloqueia e writer recusa.
  FOR v_row IN SELECT * FROM (VALUES
    (NULL::text, 'material_selection_required'),
    ('10000000-0000-4000-8000-000000000003', 'material_selection_invalid')
  ) choices(base_id, expected_code) LOOP
    v_bad := jsonb_set(v_prepared, '{strap_colors,2,base_group_id}', coalesce(to_jsonb(v_row.base_id), 'null'::jsonb));
    SELECT to_jsonb(preview) INTO v_preview
      FROM public.preview_sale_order_strap_demand_draft(v_bad) preview
     WHERE technical_strap_line_id = '90000000-0000-4000-8000-000000000002';
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_preview -> 'blocking_reasons') reason WHERE reason ->> 'code' = v_row.expected_code), 'Preview aceitou material ausente/nao permitido';
    ASSERT v_preview #>> '{resolved,base_group_id}' IS NULL, 'Preview bloqueado fabricou base';
    v_rejected := false;
    BEGIN
      PERFORM public.prepare_sale_order_item_internal_straps(v_bad);
    EXCEPTION WHEN SQLSTATE '23514' THEN
      v_rejected := true;
    END;
    ASSERT v_rejected, 'Writer aceitou selecao de material ausente/fora da ficha';
  END LOOP;

  -- Material valido continua aparecendo mesmo com cor nao selecionada.
  v_bad := jsonb_set(v_prepared, '{strap_colors,2,color_id}', 'null'::jsonb)
    #- '{strap_colors,2,color}' #- '{strap_sourcing,90000000-0000-4000-8000-000000000002}';
  SELECT to_jsonb(preview) INTO v_preview
    FROM public.preview_sale_order_strap_demand_draft(v_bad) preview
   WHERE technical_strap_line_id = '90000000-0000-4000-8000-000000000002';
  ASSERT v_preview #>> '{resolved,base_group_id}' = '10000000-0000-4000-8000-000000000001';
  ASSERT v_preview #>> '{resolved,base_group_name}' = 'FIXTURE NAPA A';

  -- A segunda posicao falha depois de a primeira materializar outra cor.
  -- O sub-bloco transacional reverte TODO produto/variante/auditoria parcial.
  SELECT count(*) INTO v_variants FROM public.artisanal_strap_variants;
  SELECT count(*) INTO v_products FROM public.products;
  SELECT count(*) INTO v_officials FROM public.base_material_color_official_products;
  SELECT count(*) INTO v_audits FROM public.audit_logs;
  v_rejected := false;
  BEGIN
    UPDATE public.technical_sheets SET upper_material_product_id = NULL WHERE id = '80000000-0000-4000-8000-000000000001';
    UPDATE public.artisanal_strap_recipes SET status = 'suspended' WHERE id = '70000000-0000-4000-8000-000000000002';
    v_input := jsonb_set(v_prepared, '{color}', '"FIXTURE BRANCO"'::jsonb);
    PERFORM public.prepare_sale_order_item_internal_straps(v_input);
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%Nao existe conversao aprovada%', 'Falha de fixture inesperada: ' || SQLERRM;
    v_rejected := true;
  END;
  ASSERT v_rejected, 'Writer aceitou receita suspensa na segunda posicao';
  ASSERT (SELECT count(*) FROM public.artisanal_strap_variants) = v_variants;
  ASSERT (SELECT count(*) FROM public.products) = v_products;
  ASSERT (SELECT count(*) FROM public.base_material_color_official_products) = v_officials;
  ASSERT (SELECT count(*) FROM public.audit_logs) = v_audits;
  ASSERT (SELECT sum(quantity) FROM public.products WHERE id::text LIKE '20000000-%') = 5000, 'Writer debitou estoque durante preparo';

  -- Nova escolha B/BRANCO deve materializar SKU exato, sem pin PRETO da ficha.
  v_input := jsonb_set(jsonb_set(jsonb_set(v_prepared, '{strap_colors,2,base_group_id}', '"10000000-0000-4000-8000-000000000002"'), '{strap_colors,2,color_id}', '"30000000-0000-4000-8000-000000000002"'), '{strap_colors,2,color}', '"FIXTURE BRANCO"');
  v_bad := public.prepare_sale_order_item_internal_straps(v_input) -> 'item';
  ASSERT v_bad #>> '{strap_sourcing,90000000-0000-4000-8000-000000000002,base_product_id}' = '20000000-0000-4000-8000-000000000005';
  ASSERT v_bad #>> '{strap_sourcing,90000000-0000-4000-8000-000000000002,recipe_id}' = '70000000-0000-4000-8000-000000000002';
  ASSERT v_bad #>> '{strap_sourcing,90000000-0000-4000-8000-000000000002,color_id}' = '30000000-0000-4000-8000-000000000002';
END
$preview_manifest_atomicity$;

SELECT 'preview, manifesto v2, material/cor independentes e rollback atomico' AS passed;

DO $enqueue_real$
DECLARE
  v_prepared jsonb := (SELECT value FROM strap_fixture_state WHERE key = 'prepared');
  v_job_id uuid;
  v_payload jsonb;
  v_row record;
BEGIN
  INSERT INTO public.sale_orders (id, order_number, delivery_deadline)
  VALUES ('a0000000-0000-4000-8000-000000000002', 'FIXTURE-PV-QUEUE', current_date + 60);
  INSERT INTO public.sale_order_items (id, sale_order_id, reference_id, color, strap_colors, strap_sourcing, quantity, grade)
  VALUES ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', 'FIXTURE PRETO', v_prepared -> 'strap_colors', v_prepared -> 'strap_sourcing', 100, '{"36":100}');
  INSERT INTO public.orders (id, sale_order_id, sale_order_item_id, reference_id, quantity, color, grade, planned_start)
  VALUES ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', 100, 'FIXTURE PRETO', '{"36":100}', current_date + 30);
  v_job_id := public.enqueue_sale_order_strap_demands('a0000000-0000-4000-8000-000000000002', 'confirmed', 'c0000000-0000-4000-8000-000000000002');
  ASSERT v_job_id IS NOT NULL, 'Enfileiramento real nao criou job';
  SELECT payload INTO v_payload FROM public.strap_demand_jobs WHERE id = v_job_id;
  ASSERT jsonb_array_length(v_payload -> 'lines') = 3, 'Fila deduplicou posicoes repetidas';
  ASSERT (SELECT count(DISTINCT line ->> 'strap_variant_id') FROM jsonb_array_elements(v_payload -> 'lines') line) = 2;
  FOR v_row IN SELECT value AS line FROM jsonb_array_elements(v_payload -> 'lines') LOOP
    ASSERT v_row.line ->> 'base_product_id' = v_prepared -> 'strap_sourcing' -> (v_row.line ->> 'technical_strap_line_id') ->> 'base_product_id';
    ASSERT v_row.line ->> 'recipe_id' = v_prepared -> 'strap_sourcing' -> (v_row.line ->> 'technical_strap_line_id') ->> 'recipe_id';
    ASSERT v_row.line #>> '{resolved,base_group_id}' = v_prepared -> 'strap_sourcing' -> (v_row.line ->> 'technical_strap_line_id') ->> 'base_group_id';
    ASSERT jsonb_array_length(v_row.line -> 'blocking_reasons') = 0;
  END LOOP;
  ASSERT public.enqueue_sale_order_strap_demands('a0000000-0000-4000-8000-000000000002', 'confirmed', 'c0000000-0000-4000-8000-000000000002') = v_job_id, 'Replay identico duplicou job';
END
$enqueue_real$;
SELECT 'enfileiramento real preserva 3 contribuicoes A/B/A com 2 variantes, receitas e bases exatas' AS passed;


INSERT INTO public.strap_operational_calendars
(id,name,calendar_type,uses_factory_calendar,open_iso_weekdays,timezone,status)
VALUES('e0000000-0000-4000-8000-000000000001','FIXTURE FABRICA','factory',true,ARRAY[1,2,3,4,5,6,7]::smallint[],'America/Sao_Paulo','active');
INSERT INTO public.strap_executor_capacities
(id,executor_type,capacity_m_per_open_day,calendar_id,version,valid_from,status,created_by)
VALUES('e0000000-0000-4000-8000-000000000002','factory',1000000,'e0000000-0000-4000-8000-000000000001',1,current_date,'active',auth.uid());

DO $worker$
DECLARE v_job uuid; v_result jsonb; v_count integer;
BEGIN
 SELECT id INTO v_job FROM public.strap_demand_jobs WHERE source_id='a0000000-0000-4000-8000-000000000002';
 UPDATE public.strap_demand_jobs SET status='processing',attempts=attempts+1,locked_at=now(),locked_by='fixture-worker' WHERE id=v_job;
 v_result:=public.process_strap_demand_job(v_job,'fixture-worker');
 ASSERT v_result->>'processed'='3', 'WORKER RESULT '||v_result::text;
 ASSERT (SELECT status FROM public.strap_demand_jobs WHERE id=v_job)='completed';
 SELECT count(*) INTO v_count FROM public.sale_order_strap_demands WHERE sale_order_id='a0000000-0000-4000-8000-000000000002' AND is_current;
 ASSERT v_count=3, 'Esperadas 3 demandas A/B/A';
 ASSERT NOT EXISTS(
 SELECT 1 FROM public.sale_order_strap_demands d
 JOIN public.sale_order_items i ON i.id=d.sale_order_item_id
 WHERE d.sale_order_id='a0000000-0000-4000-8000-000000000002' AND d.is_current
 AND (d.base_product_id::text IS DISTINCT FROM i.strap_sourcing->d.technical_strap_line_id::text->>'base_product_id'
 OR d.recipe_id::text IS DISTINCT FROM i.strap_sourcing->d.technical_strap_line_id::text->>'recipe_id'));
END $worker$;
SELECT 'worker_real_completed' AS passed;
DO $physical_receipt$
DECLARE v_batch record; v_item record; v_receipt jsonb; v_replay jsonb; v_key text; v_qty numeric;
BEGIN
 ASSERT (SELECT count(*) FROM public.material_reservations WHERE source='strap_engine_base' AND status='reserved')=3;
 ASSERT abs((SELECT sum(quantity_reserved) FROM public.material_reservations WHERE source='strap_engine_base' AND status='reserved' AND base_product_id='20000000-0000-4000-8000-000000000001') - 0.4)<0.000001;
 ASSERT abs((SELECT sum(quantity_reserved) FROM public.material_reservations WHERE source='strap_engine_base' AND status='reserved' AND base_product_id='20000000-0000-4000-8000-000000000002') - 20::numeric/60)<0.000001;
 FOR v_batch IN SELECT b.id FROM public.strap_production_batches b
   WHERE EXISTS (SELECT 1 FROM public.strap_production_batch_items bi
     JOIN public.strap_production_batch_contributions c ON c.batch_item_id=bi.id
     JOIN public.sale_order_strap_demands d ON d.id=c.sale_order_strap_demand_id
     WHERE bi.batch_id=b.id AND d.sale_order_id='a0000000-0000-4000-8000-000000000002') LOOP
   PERFORM public.start_strap_production_batch(v_batch.id,'Ensaio local de fabricacao por material','f0000000-0000-4000-8000-000000000001');
 END LOOP;
 FOR v_item IN SELECT bi.* FROM public.strap_production_batch_items bi
   WHERE EXISTS (SELECT 1 FROM public.strap_production_batch_contributions c
     JOIN public.sale_order_strap_demands d ON d.id=c.sale_order_strap_demand_id
     WHERE c.batch_item_id=bi.id AND d.sale_order_id='a0000000-0000-4000-8000-000000000002')
   ORDER BY bi.base_product_id LOOP
   v_key:='fixture-receipt:'||v_item.id::text;
   v_receipt:=public.register_strap_production_receipt(v_item.id,NULL,v_item.planned_finished_m,v_item.planned_finished_m,0,v_item.planned_base_m,v_key,0,'FIXTURE',now(),'Somente banco descartavel','f0000000-0000-4000-8000-000000000001',NULL);
   ASSERT v_receipt->>'receipt_id' IS NOT NULL;
   ASSERT abs((v_receipt->>'base_posted_m')::numeric-v_item.planned_base_m)<0.000001;
   SELECT quantity INTO v_qty FROM public.products WHERE id=v_item.base_product_id;
   v_replay:=public.register_strap_production_receipt(v_item.id,NULL,v_item.planned_finished_m,v_item.planned_finished_m,0,v_item.planned_base_m,v_key,0,'FIXTURE',now(),'Somente banco descartavel','f0000000-0000-4000-8000-000000000001',NULL);
   ASSERT v_replay->>'receipt_id'=v_receipt->>'receipt_id';
   ASSERT (SELECT quantity FROM public.products WHERE id=v_item.base_product_id)=v_qty, 'Replay duplicou baixa';
 END LOOP;
 ASSERT (SELECT count(*) FROM public.strap_production_receipts)=2;
 ASSERT (SELECT count(*) FROM public.stock_movements WHERE strap_production_receipt_id IS NOT NULL)=4;
 ASSERT abs((SELECT quantity FROM public.products WHERE id='20000000-0000-4000-8000-000000000001')-999.6)<0.000001;
 ASSERT abs((SELECT quantity FROM public.products WHERE id='20000000-0000-4000-8000-000000000002')-(1000::numeric-20::numeric/60))<0.000001;
 ASSERT (SELECT count(*) FROM public.material_reservations WHERE source='strap_engine_base' AND status='consumed')=3;
 ASSERT NOT EXISTS(SELECT 1 FROM public.material_reservations r JOIN public.sale_order_strap_demands d ON d.id=r.sale_order_strap_demand_id WHERE r.source='strap_engine_base' AND r.status='consumed' AND (r.product_id<>d.base_product_id OR abs(r.quantity_consumed-d.gross_required_m/d.confirmed_yield_snapshot)>0.000001));
 ASSERT (SELECT count(*) FROM public.strap_production_batch_contributions WHERE status='fulfilled')=3;
 ASSERT NOT EXISTS(SELECT 1 FROM public.strap_pending_reconciliations);
END $physical_receipt$;
SELECT 'producao_recebimento_baixa_real_replay_idempotente_PASS' AS passed;
DO $finished_settlement$
DECLARE v_res record; v_result jsonb; v_replay jsonb; v_total numeric:=0;
BEGIN
 PERFORM public.bind_strap_finished_reservations_to_order('d0000000-0000-4000-8000-000000000002');
 ASSERT (SELECT count(*) FROM public.material_reservations WHERE source='strap_engine_finished' AND status='reserved' AND order_id='d0000000-0000-4000-8000-000000000002')=3;
 FOR v_res IN SELECT * FROM public.material_reservations WHERE source='strap_engine_finished' AND status='reserved' AND order_id='d0000000-0000-4000-8000-000000000002' ORDER BY id LOOP
  v_result:=public.settle_canonical_strap_reservation_for_order(v_res.id,'fixture_finalizacao');
  ASSERT (v_result->>'pending')::integer=0;
  ASSERT (v_result->>'debited_qty')::numeric=v_res.quantity_reserved;
  v_total:=v_total+(v_result->>'debited_qty')::numeric;
  v_replay:=public.settle_canonical_strap_reservation_for_order(v_res.id,'fixture_finalizacao');
  ASSERT (v_replay->>'skipped')::boolean;
 END LOOP;
 ASSERT v_total=60, 'Baixa de acabado deve ser 10+20+30m';
 ASSERT (SELECT count(*) FROM public.material_reservations WHERE source='strap_engine_finished' AND status='consumed')=3;
 ASSERT NOT EXISTS(SELECT 1 FROM public.sale_order_strap_demands WHERE is_current AND (status<>'fulfilled' OR fulfilled_m<>gross_required_m));
 ASSERT NOT EXISTS(SELECT 1 FROM public.products WHERE id IN (SELECT finished_product_id FROM public.sale_order_strap_demands) AND quantity<>0);
 ASSERT abs((SELECT quantity FROM public.products WHERE id='20000000-0000-4000-8000-000000000001')-999.6)<0.000001, 'Settlement debitou materia-prima novamente';
 ASSERT abs((SELECT quantity FROM public.products WHERE id='20000000-0000-4000-8000-000000000002')-(1000::numeric-20::numeric/60))<0.000001;
 ASSERT (SELECT count(*) FROM public.stock_movements)=7, 'Esperados4movimentos recebimento+3baixas porUUID';
 ASSERT NOT EXISTS(SELECT 1 FROM public.stock_movements s JOIN public.material_reservations r ON r.id=s.material_reservation_id JOIN public.sale_order_strap_demands d ON d.id=r.sale_order_strap_demand_id WHERE s.order_id='d0000000-0000-4000-8000-000000000002' AND (s.product_id IS DISTINCT FROM d.finished_product_id OR s.strap_variant_id IS DISTINCT FROM d.strap_variant_id OR s.finished_product_id IS DISTINCT FROM d.finished_product_id));
END $finished_settlement$;
SELECT 'settlement_real_3UUIDs_60m_sem_dupla_baixa_PASS' AS passed;
ROLLBACK;
