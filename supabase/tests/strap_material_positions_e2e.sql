-- Ensaio local deterministico da migration 161, sem consultar dados reais.
-- Executar SOMENTE em banco descartavel: schema/dependencias reais + migration.
-- O harness pode omitir os triggers, por isso instalamos probes dos dois guards
-- reais em tabelas temporarias. Nao substituimos writer/materializador/catalogo.
BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';

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

DO $legacy_five_positions$
DECLARE
  v_template jsonb := (SELECT value -> 2 FROM strap_fixture_state WHERE key = 'technical_lines');
  v_lines jsonb := '[]';
  v_input jsonb;
  v_prepared jsonb;
  v_manifest jsonb;
  v_expected numeric;
  v_row record;
  v_idx integer;
  v_color_ids text[] := ARRAY['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003'];
BEGIN
  INSERT INTO public.canonical_colors (id, name) VALUES ('30000000-0000-4000-8000-000000000003', 'FIXTURE VERMELHO');
  INSERT INTO public.products (id, name, sku, category, group_id, color, unit, purchase_unit, conversion_rate, dimensions_width, dimensions_unit, quantity)
  VALUES ('20000000-0000-4000-8000-000000000006', 'FIXTURE NAPA A VERMELHO', 'FIXTURE-NAPA-A-VERMELHO', 'Cabedal', '10000000-0000-4000-8000-000000000001', 'FIXTURE VERMELHO', 'm', 'm', 1, 1000, 'mm', 1000);
  v_template := v_template - 'material_mode' - 'material_group_id' - 'allowed_material_group_ids';
  FOR v_idx IN 1..5 LOOP
    v_lines := v_lines || jsonb_build_array(v_template || jsonb_build_object(
      'technical_strap_line_id', '90000000-0000-4000-8000-00000000001' || v_idx::text,
      'label', 'LEGADA ' || v_idx::text, 'consumption', 10 + v_idx,
      'consumption_per_size', jsonb_build_object('36', 10 + v_idx),
      'color_id', v_color_ids[(v_idx - 1) % 3 + 1]
    ));
  END LOOP;
  INSERT INTO public.technical_sheets (id, name, code, has_straps, strap_base_group_id, strap_colors, status_ficha)
  VALUES ('80000000-0000-4000-8000-000000000002', 'FIXTURE LEGADA', 'FIXTURE-LEGADA', true, '10000000-0000-4000-8000-000000000001', v_lines, 'publicada');
  v_input := jsonb_build_object('reference_id', '80000000-0000-4000-8000-000000000002', 'color', 'DESCRICAO PRINCIPAL LIVRE NAO CANONICA', 'quantity', 1, 'grade', '{"36":1}'::jsonb, 'strap_colors', v_lines);
  v_prepared := public.prepare_sale_order_item_internal_straps(v_input) -> 'item';
  ASSERT jsonb_array_length(v_prepared -> 'strap_colors') = 5;
  ASSERT (SELECT count(DISTINCT source ->> 'color_id') FROM jsonb_each(v_prepared -> 'strap_sourcing') item(id,source)) = 3;
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_prepared -> 'strap_colors') line WHERE line ->> 'material_mode' <> 'follow_reference');
  FOR v_row IN SELECT * FROM public.preview_sale_order_strap_demand_draft(v_prepared) LOOP
    v_expected := (10 + v_row.line_ordinal)::numeric / 100;
    ASSERT v_row.gross_required_m = v_expected, 'Regressao consumo cm/par legado';
    ASSERT v_row.resolved ->> 'base_group_id' = '10000000-0000-4000-8000-000000000001';
  END LOOP;
  v_manifest := public.get_mobile_strap_offline_manifest(ARRAY['80000000-0000-4000-8000-000000000002'::uuid]);
  ASSERT jsonb_array_length(v_manifest #> '{references,0,lines}') = 5;
  ASSERT jsonb_array_length(v_manifest #> '{references,0,lines,0,allowed_colors}') = 3;
END
$legacy_five_positions$;
SELECT 'regressao legada:5posicoes,3cores,material unico e cor principal livre' AS passed;

DO $committed_history$
DECLARE
  v_prepared jsonb := (SELECT value FROM strap_fixture_state WHERE key = 'prepared');
  v_saved jsonb;
  v_changed jsonb;
  v_preview jsonb;
  v_rejected boolean := false;
BEGIN
  INSERT INTO public.sale_order_items (id, sale_order_id, reference_id, color, strap_colors, strap_sourcing, quantity, grade)
  VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'FIXTURE PRETO', v_prepared -> 'strap_colors', v_prepared -> 'strap_sourcing', 100, '{"36":100}');
  -- Trocar follow por fixed A nao muda nenhum SKU, cor ou receita. Ainda assim
  -- a politica alterou desde o rascunho e a aprovacao deve exigir novo aceite.
  BEGIN
    UPDATE public.technical_sheets SET strap_colors = jsonb_set(strap_colors, '{0}',
      (strap_colors -> 0) || '{"material_mode":"fixed_group","material_group_id":"10000000-0000-4000-8000-000000000001"}'::jsonb)
    WHERE id = '80000000-0000-4000-8000-000000000001';
    PERFORM public.enqueue_sale_order_strap_demands('a0000000-0000-4000-8000-000000000001', 'confirmed', 'c0000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    ASSERT SQLERRM LIKE '%nao congelou exatamente%', 'Bloqueio deve ser stale estrutural, nao agenda ou catalogo: ' || SQLERRM;
    v_rejected := true;
  END;
  ASSERT v_rejected, 'Promocao aceitou politica tecnica diferente com mesmo SKU';
  UPDATE public.sale_orders SET status = 'Aprovado' WHERE id = 'a0000000-0000-4000-8000-000000000001';
  -- A ficha evoluiu: a posicao3 nao admite mais A, a posicao1 pede escolha.
  UPDATE public.technical_sheets SET strap_colors =
    jsonb_set(jsonb_set(strap_colors, '{2,allowed_material_group_ids}', '["10000000-0000-4000-8000-000000000002"]'), '{0}',
      (strap_colors -> 0) || '{"material_mode":"select_on_order","allowed_material_group_ids":["10000000-0000-4000-8000-000000000002"]}'::jsonb)
  WHERE id = '80000000-0000-4000-8000-000000000001';
  v_changed := public.prepare_sale_order_item_internal_straps(v_prepared || '{"id":"b0000000-0000-4000-8000-000000000001"}'::jsonb) -> 'item';
  ASSERT v_changed -> 'strap_colors' = v_prepared -> 'strap_colors', 'Writer reinterpretou snapshot aprovado';
  ASSERT v_changed -> 'strap_sourcing' = v_prepared -> 'strap_sourcing';
  SELECT jsonb_agg(to_jsonb(preview) ORDER BY line_ordinal) INTO v_preview
    FROM public.preview_sale_order_strap_demand_draft('{"sale_order_item_id":"b0000000-0000-4000-8000-000000000001"}'::jsonb) preview;
  ASSERT jsonb_array_length(v_preview) = 3;
  ASSERT v_preview #>> '{2,resolved,base_group_id}' = '10000000-0000-4000-8000-000000000001', 'Preview consultou material atual da ficha para historico';
  ASSERT v_preview #>> '{2,resolved,base_group_name}' = 'FIXTURE NAPA A';
  ASSERT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_preview) line
    CROSS JOIN LATERAL jsonb_array_elements(line -> 'blocking_reasons') reason
    WHERE reason ->> 'code' IN ('material_selection_required', 'material_selection_invalid')
  ), 'Politica viva bloqueou snapshot aprovado antes da primeira demanda';
END
$committed_history$;

SELECT 'historico aprovado sem demanda preserva material, nome e politica congelados' AS passed;

DO $acl_contract$
DECLARE
  v_signature text;
  v_role text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'private.validate_strap_material_policy(jsonb)',
    'private.resolve_technical_strap_material(uuid,uuid,uuid,uuid,boolean)',
    'private.ensure_sale_order_internal_strap_materials(uuid,uuid,uuid,uuid[],jsonb)',
    'private.technical_strap_material_options(uuid,uuid,uuid)',
    'public.prepare_sale_order_item_internal_straps(jsonb)',
    'public.ensure_sale_order_internal_strap_intents(uuid,uuid,uuid,uuid[])',
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      ASSERT NOT has_function_privilege(v_role, v_signature, 'EXECUTE'), 'RPC interna exposta: ' || v_signature || ' para ' || v_role;
    END LOOP;
  END LOOP;
  ASSERT has_function_privilege('authenticated', 'public.get_mobile_strap_offline_manifest(uuid[])', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.get_mobile_strap_offline_manifest(uuid[])', 'EXECUTE');
END
$acl_contract$;
SELECT 'ACLs preservam writers privados e manifesto somente autenticado' AS passed;
ROLLBACK;
