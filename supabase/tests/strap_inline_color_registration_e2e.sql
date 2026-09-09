-- Cadastro de cor dentro do PV: RPC 149 -> cor canonica 047 -> writer 161.
-- SOMENTE PostgreSQL descartavel, vazio, com schema/CHECKs/indices reais e
-- funcoes reais/dependencias das migrations 047, 149, 161 e 164 instaladas.
-- Nao executa migrations, cria mocks de dominio nem consulta dados reais.
--
-- O cadastro cria um SKU de materia-prima com saldo ZERO. O movimento inicial
-- de quantidade zero e o recibo sao fatos canonicos; replay nao os duplica.
-- O writer do PV materializa a variante acabada depois, usando o tipo/medida,
-- geometria e receita JA existentes. Criar cor nao cria receita/rendimento.
--
-- Preflight exige o trigger real de sincronizacao de cor e os dois guards
-- reais de movimento de estoque. Guards de ficha/item executam em probes.
-- Limites: nao prova UI, todos os FKs/RLS/triggers laterais, concorrencia,
-- scheduler, fabricacao ou baixa fisica; a baixa tem ensaio separado.
-- Executado em schema enxuto PGlite sem FKs/RLS globais. Num Supabase completo,
-- os usuarios sinteticos precisam existir antes em auth.users para a FK de
-- profiles.id (e os triggers de cadastro podem exigir outras fixtures).
-- Nao desabilitar protecoes silenciosamente. auth.uid/role/jwt no harness
-- apenas leem claims locais; as funcoes de dominio e os ACLs da RPC 149 sao reais.
-- A verificacao de papeis exercita o guard da RPC com claims sinteticos;
-- nao substitui um teste ponta a ponta via PostgREST com JWT autenticado.
-- Toda fixture e todo efeito terminam em ROLLBACK.
BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.products)
     AND NOT EXISTS (SELECT 1 FROM public.sale_orders)
     AND NOT EXISTS (SELECT 1 FROM public.stock_movements)
     AND NOT EXISTS (SELECT 1 FROM public.canonical_colors),
    'Este teste exige banco descartavel vazio; nunca executar em producao';
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.products'::regclass
    AND tgname = 'trg_sync_canonical_color_from_product' AND tgenabled <> 'D'
    AND tgfoid = 'public.sync_canonical_color_from_product()'::regprocedure),
    'Trigger real de sincronizacao da cor ausente';
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass
    AND tgname = 'trg_enrich_strap_finished_stock_movement' AND tgenabled <> 'D'
    AND tgfoid = 'public.tg_enrich_strap_finished_stock_movement()'::regprocedure)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass
    AND tgname = 'trg_z_guard_canonical_strap_stock_movement' AND tgenabled <> 'D'
    AND tgfoid = 'public.tg_guard_canonical_strap_stock_movement()'::regprocedure),
    'Triggers reais de movimento de estoque ausentes';
  ASSERT has_function_privilege('authenticated', 'public.create_group_color_variant(uuid,uuid,text,numeric,numeric,uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.create_group_color_variant(uuid,uuid,text,numeric,numeric,uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.create_group_color_variant_core_149(uuid,uuid,text,numeric,numeric,uuid)', 'EXECUTE');
END
$preflight$;

INSERT INTO public.profiles (id, email, approved) VALUES
  ('00000000-0000-4000-8000-000000000001', 'inline-admin@example.invalid', true),
  ('00000000-0000-4000-8000-000000000002', 'inline-commercial@example.invalid', true),
  ('00000000-0000-4000-8000-000000000003', 'inline-manager@example.invalid', true),
  ('00000000-0000-4000-8000-000000000004', 'inline-unapproved@example.invalid', false);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'comercial'),
  ('00000000-0000-4000-8000-000000000003', 'gerente'),
  ('00000000-0000-4000-8000-000000000004', 'admin');
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001","email":"inline-admin@example.invalid"}', true);

INSERT INTO public.product_groups (id, name, sector, shared_specs, consumption_unit, dimensions_width, dimensions_length, dimensions_thickness, dimensions_unit, is_artisanal_strap) VALUES
  ('10000000-0000-4000-8000-000000000001', 'FIXTURE NAPA', 'Cabedal', true, 'dm²', 1000, 2000, 1.2, 'mm', false),
  ('10000000-0000-4000-8000-000000000002', 'FIXTURE ACABADO', 'Componente', false, null, 0, 0, 0, 'mm', true);
INSERT INTO public.products (id, name, sku, category, group_id, color, unit, purchase_unit, conversion_rate, dimensions_width, dimensions_length, dimensions_unit, quantity, current_stock, unit_price) VALUES
  ('20000000-0000-4000-8000-000000000001', 'FIXTURE NAPA PRETO', 'INLINE-NAPA-PRETO', 'Cabedal', '10000000-0000-4000-8000-000000000001', 'PRETO', 'm', 'm', 1, 1000, 2000, 'mm', 17, 17, 12.345678);
INSERT INTO public.component_sheets (product_id, group_id, dimensions_width, dimensions_length, dimensions_thickness, dimensions_unit, yield_per_size, yield_per_sole, notes) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1000, 2000, 1.2, 'mm', '{"36":9}', '{"fixture":8}', 'Engenharia original: nao alterar');
INSERT INTO public.artisanal_strap_types (id, name) VALUES
  ('40000000-0000-4000-8000-000000000001', 'FIXTURE OVERLOCK');
INSERT INTO public.artisanal_strap_measures (id, strap_type_id, display_name, finished_width_mm) VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '5 MM', 5);
INSERT INTO public.base_material_width_profiles (id, base_group_id, version, usable_width_mm, status, valid_from, approved_by, approved_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 1000, 'approved', now() - interval '1 day', auth.uid(), now());
INSERT INTO public.artisanal_strap_recipes (id, measure_id, base_group_id, base_width_profile_id, version, usable_base_width_mm_snapshot, cut_band_width_mm, confirmed_yield_m_per_m, executor_type, transformation_cost_per_m, status, valid_from, approved_by, approved_at) VALUES
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1, 1000, 10, 100, 'factory', 0, 'approved', now() - interval '1 day', auth.uid(), now());

CREATE TEMP TABLE inline_color_state (key text PRIMARY KEY, value jsonb);
INSERT INTO inline_color_state VALUES
  ('original_product', (SELECT to_jsonb(p) FROM public.products p WHERE id = '20000000-0000-4000-8000-000000000001')),
  ('original_component', (SELECT to_jsonb(s) FROM public.component_sheets s WHERE product_id = '20000000-0000-4000-8000-000000000001')),
  ('original_recipe', (SELECT to_jsonb(r) FROM public.artisanal_strap_recipes r WHERE id = '70000000-0000-4000-8000-000000000001'));
CREATE TEMP TABLE inline_technical_probe (LIKE public.technical_sheets INCLUDING DEFAULTS);
CREATE TRIGGER inline_technical_guard BEFORE INSERT OR UPDATE ON inline_technical_probe
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_technical_strap_identity();
CREATE TEMP TABLE inline_item_probe (LIKE public.sale_order_items INCLUDING DEFAULTS);
CREATE TRIGGER inline_item_guard BEFORE INSERT OR UPDATE ON inline_item_probe
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment();

DO $register_color$
DECLARE
  v_actor text;
  v_result jsonb;
  v_replay jsonb;
  v_product_id uuid;
  v_color_id uuid;
  v_rejected boolean;
BEGIN
  -- Comercial puro, administrador nao aprovado e usuario anonimo nao podem
  -- criar SKU. Isso nao impede o Comercial de selecionar cores ja existentes.
  FOREACH v_actor IN ARRAY ARRAY[
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004', ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_actor, true);
    v_rejected := false;
    BEGIN
      PERFORM public.create_group_color_variant(
        '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
        'FIXTURE AZUL', 0, 12.345678, 'a0000000-0000-4000-8000-000000000001');
    EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'Cadastro de SKU permitiu ator sem papel/aprovacao';
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  ASSERT (SELECT count(*) FROM public.products) = 1;
  ASSERT NOT EXISTS (SELECT 1 FROM public.stock_movements);
  ASSERT public.resolve_strap_canonical_color_id('FIXTURE AZUL') IS NULL;

  v_rejected := false;
  BEGIN
    PERFORM public.create_group_color_variant(
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'FIXTURE AZUL', 0, 99, 'a0000000-0000-4000-8000-000000000002');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := SQLERRM LIKE '%UNIT_PRICE_MISMATCH%';
  END;
  ASSERT v_rejected, 'Cadastro aceitou custo inventado em vez do template';

  v_result := public.create_group_color_variant(
    '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'FIXTURE AZUL', 0, 12.345678, 'a0000000-0000-4000-8000-000000000001');
  ASSERT (v_result ->> 'success')::boolean AND NOT (v_result ->> 'replayed')::boolean;
  v_product_id := (v_result ->> 'product_id')::uuid;
  v_color_id := public.resolve_strap_canonical_color_id('FIXTURE AZUL');
  ASSERT v_color_id IS NOT NULL, 'Trigger nao cadastrou cor canonica';
  ASSERT (SELECT count(*) FROM public.canonical_colors WHERE id = v_color_id AND active) = 1;
  ASSERT (SELECT quantity = 0 AND current_stock = 0 AND coalesce(reserved_stock, 0) = 0
    AND unit_price = 12.345678 AND unit = 'm' AND purchase_unit = 'm' AND conversion_rate = 1
    AND group_id = '10000000-0000-4000-8000-000000000001' FROM public.products WHERE id = v_product_id),
    'Cadastro alterou unidade, custo, material ou saldo';
  ASSERT (SELECT dimensions_width = 1000 AND dimensions_length = 2000 AND dimensions_thickness = 1.2
    AND yield_per_size = '{"36":9}' AND yield_per_sole = '{"fixture":8}'
    AND notes = 'Engenharia original: nao alterar'
    FROM public.component_sheets WHERE product_id = v_product_id), 'Ficha nao copiou template/grupo';
  ASSERT (SELECT count(*) FROM public.stock_movements) = 1;
  ASSERT (SELECT quantity = 0 AND previous_stock = 0 AND new_stock = 0
    FROM public.stock_movements WHERE product_id = v_product_id), 'Criacao deve ter ledger zero';
  ASSERT NOT EXISTS (SELECT 1 FROM public.base_material_color_official_products WHERE color_id = v_color_id);
  ASSERT NOT EXISTS (SELECT 1 FROM public.artisanal_strap_variants), 'Cor nao deve inventar variante/receita';

  -- Mesmo request, inclusive normalizacao de cor, reusa SKU/recibo/ficha.
  v_replay := public.create_group_color_variant(
    '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    ' fixture azul ', 0, 12.345678, 'a0000000-0000-4000-8000-000000000001');
  ASSERT (v_replay ->> 'replayed')::boolean AND v_replay ->> 'product_id' = v_product_id::text;
  v_rejected := false;
  BEGIN
    PERFORM public.create_group_color_variant(
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'fixture azul', 0, 12.345678, 'a0000000-0000-4000-8000-000000000003');
  EXCEPTION WHEN unique_violation THEN v_rejected := SQLERRM LIKE '%COLOR_ALREADY_EXISTS%';
  END;
  ASSERT v_rejected, 'Novo request duplicou cor existente';
  v_rejected := false;
  BEGIN
    PERFORM public.create_group_color_variant(
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'FIXTURE AZUL', 1, 12.345678, 'a0000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Replay alterado acrescentou estoque';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
  v_rejected := false;
  BEGIN
    PERFORM public.create_group_color_variant(
      '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'FIXTURE AZUL', 0, 12.345678, 'a0000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Replay de outro ator foi aceito';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  ASSERT (SELECT count(*) FROM public.products) = 2;
  ASSERT (SELECT count(*) FROM public.stock_movements) = 1;
  ASSERT (SELECT count(*) FROM public.stock_command_receipts) = 1;
  ASSERT (SELECT count(*) FROM public.group_color_variant_receipts) = 1;
  INSERT INTO inline_color_state VALUES ('created', v_result || jsonb_build_object('color_id', v_color_id));
END
$register_color$;
SELECT 'PASS: ACL, template, cor canonica, saldo zero, replay e duplicidade' AS passed;

DO $three_positions$
DECLARE
  v_created jsonb := (SELECT value FROM inline_color_state WHERE key = 'created');
  v_line_template jsonb := '{"identity_basis":"reference_base","strap_type_id":"40000000-0000-4000-8000-000000000001","measure_id":"50000000-0000-4000-8000-000000000001","group_id":"10000000-0000-4000-8000-000000000002","group_name":"FIXTURE OVERLOCK 5 MM","color_mode":"select_on_order"}';
  v_lines jsonb;
  v_input jsonb;
  v_prepared jsonb;
  v_manifest jsonb;
  v_preview jsonb;
  v_position integer;
  v_line_id text;
BEGIN
  v_lines := jsonb_build_array(
    v_line_template || '{"technical_strap_line_id":"90000000-0000-4000-8000-000000000003","label":"TIRA 1","consumption":10,"consumption_per_size":{"36":10}}',
    v_line_template || '{"technical_strap_line_id":"90000000-0000-4000-8000-000000000001","label":"TIRA 2","consumption":20,"consumption_per_size":{"36":20}}',
    v_line_template || '{"technical_strap_line_id":"90000000-0000-4000-8000-000000000002","label":"TIRA 3","consumption":30,"consumption_per_size":{"36":30}}'
  );
  INSERT INTO public.technical_sheets (id, name, code, has_straps, upper_material_group_id, strap_base_group_id, strap_colors, status_ficha)
  VALUES ('80000000-0000-4000-8000-000000000001', 'FIXTURE INLINE', 'FIXTURE-INLINE', true,
    '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', v_lines, 'publicada');
  INSERT INTO inline_technical_probe (name, strap_colors) VALUES ('FIXTURE INLINE VALIDA', v_lines);

  -- Cor nova aparece no manifesto ANTES de existir oficial/variante acabada.
  v_manifest := public.get_mobile_strap_offline_manifest(ARRAY['80000000-0000-4000-8000-000000000001'::uuid]);
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_manifest #> '{references,0,lines,0,allowed_colors}') c
    WHERE c ->> 'id' = v_created ->> 'color_id'), 'Manifesto restringiu nova cor a oficiais';
  SELECT jsonb_agg(value || jsonb_build_object('color_id', v_created -> 'color_id', 'color', 'FIXTURE AZUL') ORDER BY ordinality DESC)
    INTO v_input FROM jsonb_array_elements(v_lines) WITH ORDINALITY entries(value, ordinality);
  v_input := jsonb_build_object('reference_id', '80000000-0000-4000-8000-000000000001',
    'color', 'PRETO', 'quantity', 100, 'grade', '{"36":100}'::jsonb, 'billing_week', '2026-W40', 'strap_colors', v_input);

  -- Comercial pode salvar cores existentes. Criacao de SKU continua restrita.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
  v_prepared := public.prepare_sale_order_item_internal_straps(v_input) -> 'item';
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.line_ordinal) INTO v_preview
    FROM public.preview_sale_order_strap_demand_draft(v_prepared) p;
  ASSERT jsonb_array_length(v_prepared -> 'strap_colors') = 3 AND jsonb_array_length(v_preview) = 3;
  FOR v_position IN 0..2 LOOP
    v_line_id := v_lines -> v_position ->> 'technical_strap_line_id';
    ASSERT v_prepared #>> ARRAY['strap_colors', v_position::text, 'technical_strap_line_id'] = v_line_id,
      'Writer perdeu ordem tecnica/UUID por posicao';
    ASSERT v_prepared #>> ARRAY['strap_colors', v_position::text, 'measure_id'] = '50000000-0000-4000-8000-000000000001';
    ASSERT v_prepared #>> ARRAY['strap_colors', v_position::text, 'strap_type_id'] = '40000000-0000-4000-8000-000000000001';
    ASSERT v_prepared #> ARRAY['strap_colors', v_position::text, 'consumption_per_size'] = v_lines -> v_position -> 'consumption_per_size';
    ASSERT v_prepared #>> ARRAY['strap_sourcing', v_line_id, 'base_product_id'] = v_created ->> 'product_id';
    ASSERT v_prepared #>> ARRAY['strap_sourcing', v_line_id, 'recipe_id'] = '70000000-0000-4000-8000-000000000001';
    ASSERT v_prepared #>> ARRAY['strap_sourcing', v_line_id, 'color_id'] = v_created ->> 'color_id';
    ASSERT (v_preview #>> ARRAY[v_position::text, 'gross_required_m'])::numeric = (v_position + 1) * 10,
      'Consumo linear mudou ao cadastrar cor';
    ASSERT (v_preview #>> ARRAY[v_position::text, 'resolved', 'base_required_m'])::numeric = (v_position + 1)::numeric / 10,
      'Rendimento/consumo da napa mudou ou aplicou perda';
    ASSERT v_preview #> ARRAY[v_position::text, 'blocking_reasons'] = '[]'::jsonb;
  END LOOP;
  ASSERT (SELECT count(*) FROM public.artisanal_strap_variants) = 1, 'Mesmo tipo/medida/cor deve compartilhar SKU acabado';
  ASSERT (SELECT count(*) FROM public.base_material_color_official_products
    WHERE color_id = (v_created ->> 'color_id')::uuid AND official_product_id = (v_created ->> 'product_id')::uuid AND status = 'active') = 1;
  ASSERT (SELECT count(*) FROM public.artisanal_strap_recipes) = 1, 'Cadastro de cor inventou receita';
  INSERT INTO public.sale_orders (id, order_number) VALUES ('b0000000-0000-4000-8000-000000000001', 'FIXTURE-INLINE-PV');
  INSERT INTO inline_item_probe (sale_order_id, reference_id, color, quantity, grade, strap_colors, strap_sourcing)
  VALUES ('b0000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'PRETO', 100, '{"36":100}',
    v_prepared -> 'strap_colors', v_prepared -> 'strap_sourcing');
  ASSERT (SELECT to_jsonb(p) FROM public.products p WHERE id = '20000000-0000-4000-8000-000000000001')
    = (SELECT value FROM inline_color_state WHERE key = 'original_product'), 'Template original foi alterado';
  ASSERT (SELECT to_jsonb(s) FROM public.component_sheets s WHERE product_id = '20000000-0000-4000-8000-000000000001')
    = (SELECT value FROM inline_color_state WHERE key = 'original_component'), 'Ficha original foi alterada';
  ASSERT (SELECT to_jsonb(r) FROM public.artisanal_strap_recipes r WHERE id = '70000000-0000-4000-8000-000000000001')
    = (SELECT value FROM inline_color_state WHERE key = 'original_recipe'), 'Receita original foi alterada';
  ASSERT (SELECT count(*) FROM public.stock_movements) = 1, 'Materializacao duplicou movimento inicial';
  ASSERT (SELECT quantity = 0 AND current_stock = 0 FROM public.products WHERE id = (v_created ->> 'product_id')::uuid);
END
$three_positions$;
SELECT 'PASS: manifesto, Comercial, writer/guards/preview reais; 3 posicoes, 10/20/30 m, base 0.1/0.2/0.3 m' AS passed;

-- Regressao do cadastro real: uma napa intrusa nao impede escolher explicitamente
-- um template correto, mas o cadastro generico continua recusando grupo misto.
DO $contextual_color$
DECLARE
  v_ref CONSTANT uuid := '80000000-0000-4000-8000-000000000001';
  v_line CONSTANT uuid := '90000000-0000-4000-8000-000000000003';
  v_type CONSTANT uuid := '40000000-0000-4000-8000-000000000001';
  v_measure CONSTANT uuid := '50000000-0000-4000-8000-000000000001';
  v_group CONSTANT uuid := '10000000-0000-4000-8000-000000000001';
  v_template CONSTANT uuid := '20000000-0000-4000-8000-000000000001';
  v_request CONSTANT uuid := 'c0000000-0000-4000-8000-000000000001';
  v_actor text;
  v_bad jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_rejected boolean;
  v_before_products integer;
  v_before_movements integer;
  v_before_colors integer;
  v_before_receipts integer;
  v_rogue jsonb;
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.create_sale_order_strap_material_color(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.create_sale_order_strap_material_color(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'private.create_group_color_variant_engine(uuid,uuid,text,numeric,numeric,uuid,boolean)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'private.create_group_color_variant_engine(uuid,uuid,text,numeric,numeric,uuid,boolean)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.create_group_color_variant_core_149(uuid,uuid,text,numeric,numeric,uuid)', 'EXECUTE');
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  INSERT INTO public.products (id, name, sku, category, group_id, color, unit, purchase_unit, quantity)
  VALUES ('20000000-0000-4000-8000-000000000009', 'FIXTURE NAPA ONCA', 'INLINE-ROGUE', 'Cabedal', v_group, '', 'm', 'm', 55);
  SELECT to_jsonb(p) INTO v_rogue FROM public.products p WHERE id = '20000000-0000-4000-8000-000000000009';
  SELECT count(*) INTO v_before_products FROM public.products;
  SELECT count(*) INTO v_before_movements FROM public.stock_movements;
  SELECT count(*) INTO v_before_colors FROM public.canonical_colors;
  SELECT count(*) INTO v_before_receipts FROM public.group_color_variant_receipts;

  v_rejected := false;
  BEGIN
    PERFORM public.create_group_color_variant(v_group, v_template, 'FIXTURE VERDE', 0, 12.345678, v_request);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := SQLERRM LIKE '%mistura materiais%';
  END;
  ASSERT v_rejected, 'O refactor relaxou a homogeneidade do cadastro generico';

  FOREACH v_actor IN ARRAY ARRAY[
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004', ''
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_actor, true);
    v_rejected := false;
    BEGIN
      PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 0, v_request);
    EXCEPTION WHEN insufficient_privilege THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'RPC contextual aceitou ator sem papel/aprovacao';
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

  FOR v_bad IN SELECT value FROM jsonb_array_elements('[
    {"reference_id":"80000000-0000-4000-8000-000000000099"},
    {"material_variant_id":"81000000-0000-4000-8000-000000000099"},
    {"line_id":"90000000-0000-4000-8000-000000000099"},
    {"type_id":"40000000-0000-4000-8000-000000000099"},
    {"measure_id":"50000000-0000-4000-8000-000000000099"},
    {"base_group_id":"10000000-0000-4000-8000-000000000002"},
    {"template_id":"20000000-0000-4000-8000-000000000009"}
  ]') LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.create_sale_order_strap_material_color(
        coalesce((v_bad ->> 'reference_id')::uuid, v_ref), (v_bad ->> 'material_variant_id')::uuid,
        coalesce((v_bad ->> 'line_id')::uuid, v_line), coalesce((v_bad ->> 'type_id')::uuid, v_type),
        coalesce((v_bad ->> 'measure_id')::uuid, v_measure), coalesce((v_bad ->> 'base_group_id')::uuid, v_group),
        coalesce((v_bad ->> 'template_id')::uuid, v_template), 'FIXTURE VERDE', 12.345678, v_request);
    EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'RPC contextual aceitou contexto/template adulterado: ' || v_bad::text;
  END LOOP;

  -- Estados tecnicos invalidos sao preparados dentro de savepoints; a recusa
  -- restaura tambem a fixture. Nenhuma engenharia real e criada para o teste.
  FOR v_bad IN SELECT value FROM jsonb_array_elements('[
    {"case":"follow_main"},{"case":"finished_product_group"},{"case":"inactive_measure"},
    {"case":"wrong_material_template"},{"case":"nonlinear_template"},{"case":"missing_recipe"},
    {"case":"wrong_copied_width"}
  ]') LOOP
    v_rejected := false;
    BEGIN
      CASE v_bad ->> 'case'
        WHEN 'follow_main' THEN
          UPDATE public.technical_sheets SET strap_colors = jsonb_set(strap_colors, '{0,color_mode}', '"follow_main"') WHERE id = v_ref;
        WHEN 'finished_product_group' THEN
          UPDATE public.technical_sheets SET strap_colors = jsonb_set(jsonb_set(strap_colors, '{0,identity_basis}', '"finished_product_group"'), '{0,identity_group_id}', to_jsonb(v_group)) WHERE id = v_ref;
        WHEN 'inactive_measure' THEN
          UPDATE public.artisanal_strap_measures SET active = false WHERE id = v_measure;
        WHEN 'wrong_material_template' THEN
          UPDATE public.products SET name = 'FIXTURE NAPA ONCA PRETO' WHERE id = v_template;
        WHEN 'nonlinear_template' THEN
          UPDATE public.products SET unit = 'un', purchase_unit = 'un' WHERE id = v_template;
        WHEN 'missing_recipe' THEN
          UPDATE public.artisanal_strap_recipes SET valid_to = now() - interval '1 second' WHERE measure_id = v_measure;
        WHEN 'wrong_copied_width' THEN
          UPDATE public.product_groups SET dimensions_width = 2000 WHERE id = v_group;
      END CASE;
      PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 12.345678, v_request);
    EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'RPC contextual aceitou estado tecnico invalido: ' || v_bad::text;
    ASSERT (SELECT count(*) FROM public.products) = v_before_products;
    ASSERT (SELECT count(*) FROM public.stock_movements) = v_before_movements;
    ASSERT (SELECT count(*) FROM public.canonical_colors) = v_before_colors;
    ASSERT (SELECT count(*) FROM public.group_color_variant_receipts) = v_before_receipts;
  END LOOP;

  INSERT INTO public.color_aliases (canonical_color_id, alias, status, approved_by, approved_at)
  VALUES (public.resolve_strap_canonical_color_id('PRETO'), 'PRETO ALIAS', 'approved', auth.uid(), now());
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'PRETO ALIAS', 12.345678, v_request);
  EXCEPTION WHEN unique_violation THEN v_rejected := SQLERRM LIKE '%selecione a cor existente%';
  END;
  ASSERT v_rejected, 'Alias aprovado duplicou SKU da mesma cor canonica';
  ASSERT (SELECT count(*) FROM public.products) = v_before_products;
  ASSERT (SELECT count(*) FROM public.canonical_colors) = v_before_colors;
  ASSERT (SELECT count(*) FROM public.stock_movements) = v_before_movements;
  ASSERT (SELECT count(*) FROM public.group_color_variant_receipts) = v_before_receipts;
  ASSERT public.resolve_strap_canonical_color_id('PRETO ALIAS') = public.resolve_strap_canonical_color_id('PRETO');

  v_result := public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 12.345678, v_request);
  ASSERT (v_result ->> 'success')::boolean AND NOT (v_result ->> 'replayed')::boolean;
  ASSERT v_result ->> 'technical_strap_line_id' = v_line::text AND v_result ->> 'type_id' = v_type::text
    AND v_result ->> 'measure_id' = v_measure::text AND v_result ->> 'base_group_id' = v_group::text;
  ASSERT v_result ->> 'color_id' = public.resolve_strap_canonical_color_id('FIXTURE VERDE')::text;
  ASSERT (SELECT quantity = 0 AND current_stock = 0 AND unit = 'm' AND group_id = v_group
    FROM public.products WHERE id = (v_result ->> 'product_id')::uuid);
  ASSERT (SELECT count(*) FROM public.products) = v_before_products + 1;
  ASSERT (SELECT count(*) FROM public.stock_movements) = v_before_movements + 1;
  ASSERT (SELECT quantity = 0 AND previous_stock = 0 AND new_stock = 0
    FROM public.stock_movements WHERE product_id = (v_result ->> 'product_id')::uuid);
  ASSERT (SELECT to_jsonb(p) FROM public.products p WHERE id = '20000000-0000-4000-8000-000000000009') = v_rogue,
    'Cadastro contextual alterou o produto intruso';
  v_replay := public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, ' fixture verde ', 12.345678, v_request);
  ASSERT (v_replay ->> 'replayed')::boolean AND v_replay ->> 'product_id' = v_result ->> 'product_id';
  ASSERT (SELECT count(*) FROM public.products) = v_before_products + 1;
  ASSERT (SELECT count(*) FROM public.stock_movements) = v_before_movements + 1;
  INSERT INTO inline_color_state VALUES ('contextual_created', v_result);

  v_rejected := false;
  BEGIN
    INSERT INTO public.products (name, sku, category, group_id, color, unit, purchase_unit, quantity)
    VALUES ('FIXTURE NAPA FIXTURE VERDE', 'INLINE-DOUBLE-CANONICAL', 'Cabedal', v_group, 'FIXTURE VERDE', 'm', 'm', 0);
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 12.345678, v_request);
  EXCEPTION WHEN unique_violation THEN v_rejected := SQLERRM LIKE '%outro SKU%';
  END;
  ASSERT v_rejected, 'Replay aceitou cor que passou a ter segundo SKU ativo';
  ASSERT (SELECT count(*) FROM public.products) = v_before_products + 1;

  v_rejected := false;
  BEGIN
    -- Outra posicao VALIDA do mesmo material/tipo nao pode receber o recibo.
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, '90000000-0000-4000-8000-000000000001', v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 12.345678, v_request);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Replay permitiu trocar contexto de posicao';
  v_rejected := false;
  BEGIN
    PERFORM public.create_group_color_variant(v_group, v_template, 'FIXTURE VERDE', 0, 12.345678, v_request);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Request contextual foi aceito no envelope generico';
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE AZUL', 12.345678, 'a0000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Request generico foi aceito no envelope contextual';
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'fixture verde', 12.345678, 'c0000000-0000-4000-8000-000000000009');
  EXCEPTION WHEN unique_violation THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Contextual duplicou cor sob novo request';
  v_rejected := false;
  BEGIN
    UPDATE public.technical_sheets SET strap_colors = jsonb_set(strap_colors, '{0,color_mode}', '"follow_main"') WHERE id = v_ref;
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 12.345678, v_request);
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Recibo retornou sucesso sem revalidar ficha modificada';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_order_strap_material_color(v_ref, NULL, v_line, v_type, v_measure, v_group, v_template, 'FIXTURE VERDE', 12.345678, v_request);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Recibo contextual permitiu trocar ator';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
END
$contextual_color$;
SELECT 'PASS: grupo misto, rota generica protegida, contexto exato, ACL, replay contextual e atomicidade' AS passed;

DO $contextual_consumption$
DECLARE
  v_created jsonb := (SELECT value FROM inline_color_state WHERE key = 'contextual_created');
  v_lines jsonb;
  v_prepared jsonb;
  v_preview jsonb;
  v_position integer;
BEGIN
  SELECT jsonb_agg(e.value || jsonb_build_object('color_id', v_created -> 'color_id', 'color', 'FIXTURE VERDE') ORDER BY e.ordinality)
    INTO v_lines FROM public.technical_sheets t, jsonb_array_elements(t.strap_colors) WITH ORDINALITY e(value, ordinality)
   WHERE t.id = '80000000-0000-4000-8000-000000000001';
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
  v_prepared := public.prepare_sale_order_item_internal_straps(jsonb_build_object(
    'reference_id', '80000000-0000-4000-8000-000000000001', 'color', 'PRETO',
    'quantity', 100, 'grade', '{"36":100}'::jsonb, 'billing_week', '2026-W40', 'strap_colors', v_lines)) -> 'item';
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.line_ordinal) INTO v_preview
    FROM public.preview_sale_order_strap_demand_draft(v_prepared) p;
  ASSERT jsonb_array_length(v_preview) = 3;
  FOR v_position IN 0..2 LOOP
    ASSERT v_preview #>> ARRAY[v_position::text, 'base_product_id'] = v_created ->> 'product_id';
    ASSERT v_prepared #>> ARRAY['strap_colors', v_position::text, 'measure_id'] = '50000000-0000-4000-8000-000000000001';
    ASSERT v_prepared #>> ARRAY['strap_colors', v_position::text, 'strap_type_id'] = '40000000-0000-4000-8000-000000000001';
    ASSERT (v_preview #>> ARRAY[v_position::text, 'gross_required_m'])::numeric = (v_position + 1) * 10;
    ASSERT (v_preview #>> ARRAY[v_position::text, 'resolved', 'base_required_m'])::numeric = (v_position + 1)::numeric / 10;
    ASSERT v_preview #> ARRAY[v_position::text, 'blocking_reasons'] = '[]'::jsonb;
  END LOOP;
  ASSERT (SELECT count(*) FROM public.stock_movements) = 2 AND NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE quantity <> 0);
  ASSERT (SELECT count(*) FROM public.artisanal_strap_recipes) = 1;
  ASSERT (SELECT to_jsonb(r) FROM public.artisanal_strap_recipes r WHERE id = '70000000-0000-4000-8000-000000000001')
    = (SELECT value FROM inline_color_state WHERE key = 'original_recipe');
END
$contextual_consumption$;
SELECT 'PASS: cor contextual do grupo misto chega ao writer/preview, sem trocar tipo/medida/rendimento ou debitar estoque' AS passed;
ROLLBACK;
