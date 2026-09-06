-- Regressao apos migration166: identidade I703, cores e guardas de catalogo.
-- Em pre-deploy, executar BEGIN + migration166 + corpo deste teste + ROLLBACK.
-- Executar com privilegio administrativo de teste; sempre termina com ROLLBACK.
-- Nenhuma ficha/produto real recebe UPDATE; probes negativos usam tabela TEMP.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

CREATE TEMP TABLE i703_strass_test_results (test text, result jsonb) ON COMMIT DROP;
-- Isola a guarda da ficha sem editar referencias de clientes para testar erros.
CREATE TEMP TABLE i703_strass_identity_fixture (strap_colors jsonb) ON COMMIT DROP;
CREATE TRIGGER validate_identity BEFORE INSERT OR UPDATE ON i703_strass_identity_fixture
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_technical_strap_identity();

DO $test$
DECLARE
  v_sheet_id constant uuid := '2aa04423-4050-4d7d-970e-b879bad536ca';
  v_line_id constant text := '122d67e3-f9ca-402d-9f1a-e125b3102d2a';
  v_variant_id constant uuid := 'd47a0d81-169c-4738-97cc-5881b6cac6ad';
  v_measure_id constant uuid := '00f07325-347b-4e65-90e6-fed33f70eacc';
  v_group_id constant uuid := 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
  v_before jsonb;
  v_new_line jsonb;
  v_resolved jsonb;
  v_catalog jsonb;
  v_color_id uuid;
  v_product_id uuid;
  v_count integer;
  v_error text;
  v_recipe_measure record;
  v_colors jsonb;
  v_wrong_group_id uuid;
BEGIN
  SELECT to_jsonb(s) INTO STRICT v_before FROM public.technical_sheets s
    WHERE s.id = v_sheet_id FOR SHARE;
  -- UUIDs aqui pertencem a fixture real auditada, nunca ao runtime/migration.
  -- Se a ficha for substituida ou renomeada, o teste exige revisao explicita.
  IF upper(coalesce(nullif(v_before->>'code', ''), v_before->>'name', '')) <> 'I703' THEN
    RAISE EXCEPTION 'UUID da fixture nao corresponde mais a I703';
  END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_before->'strap_colors') l
    WHERE l->>'technical_strap_line_id' = v_line_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'I703 deve possuir a linha tecnica exata uma unica vez'; END IF;
  SELECT l INTO STRICT v_new_line FROM jsonb_array_elements(v_before->'strap_colors') l
    WHERE l->>'technical_strap_line_id' = v_line_id;
  IF v_new_line->>'measure_id' IS DISTINCT FROM v_measure_id::text
     OR (v_new_line->>'consumption')::numeric IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'Precondicao: medida/consumo da I703 mudou; revisar fixture';
  END IF;
  IF v_new_line->>'identity_basis' IS DISTINCT FROM 'finished_product_group'
     OR v_new_line->>'identity_group_id' IS DISTINCT FROM v_group_id::text
     OR v_new_line->>'color_mode' IS DISTINCT FROM 'select_on_order'
     OR (v_new_line->>'internal_production_enabled')::boolean IS DISTINCT FROM false
     OR v_new_line->>'color_id' IS NOT NULL
     OR v_new_line->>'base_group_id' IS NOT NULL
     OR v_new_line->>'base_group_name' IS NOT NULL THEN
    RAISE EXCEPTION 'Migration166 nao corrigiu a identidade da I703';
  END IF;

  IF v_new_line->>'id' IS DISTINCT FROM v_line_id
     OR v_new_line->>'label' IS DISTINCT FROM 'TIRA 2'
     OR v_new_line->'consumption_per_size' IS DISTINCT FROM (
       SELECT jsonb_object_agg(size::text, 50) FROM generate_series(23, 36) size
     )
     OR (v_before->'strap_colors'->0->>'consumption')::numeric IS DISTINCT FROM 44 THEN
    RAISE EXCEPTION 'UUID, rotulo ou geometria original da I703 nao foram preservados';
  END IF;

  v_resolved := private.resolve_technical_strap_material(
    v_sheet_id, v_variant_id, v_line_id::uuid, NULL, false);
  IF v_resolved->>'base_group_id' IS DISTINCT FROM v_group_id::text
     OR v_resolved->>'pinned_base_product_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Tira comprada pronta ainda herda o cabedal: %', v_resolved;
  END IF;
  INSERT INTO i703_strass_test_results VALUES ('grupo_corrigido_sem_heranca', v_resolved);

  FOR v_color_id, v_product_id IN
    SELECT color_id, finished_product_id FROM public.artisanal_strap_variants
      WHERE measure_id = v_measure_id AND base_group_id = v_group_id
        AND identity_basis = 'finished_product_group' AND status = 'active'
  LOOP
    v_catalog := public.resolve_artisanal_strap_catalog(
      v_measure_id, v_group_id, v_color_id, 'buy_ready', 'finished_product_group');
    IF v_catalog->>'finished_product_id' IS DISTINCT FROM v_product_id::text
       OR v_catalog->>'source_mode' IS DISTINCT FROM 'buy_ready'
       OR v_catalog->>'recipe_id' IS NOT NULL
       OR v_catalog->>'base_product_id' IS NOT NULL
       OR v_catalog->>'confirmed_yield_m_per_m' IS NOT NULL THEN
      RAISE EXCEPTION 'Catalogo comprado pronto contaminado por base/rendimento: %', v_catalog;
    END IF;
    INSERT INTO i703_strass_test_results VALUES ('variante_comercial_valida', v_catalog);
  END LOOP;

  v_error := NULL;
  BEGIN
    PERFORM public.resolve_artisanal_strap_catalog(v_measure_id, v_group_id,
      public.resolve_strap_canonical_color_id('COBRE'), 'buy_ready', 'finished_product_group');
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Variante exata ativa nao encontrada' THEN
    RAISE EXCEPTION 'COBRE do cabedal nao pode substituir a cor STRASS: %', v_error;
  END IF;
  INSERT INTO i703_strass_test_results VALUES ('cobre_nao_cadastrado_recusado', to_jsonb(v_error));

  v_error := NULL;
  BEGIN
    PERFORM public.resolve_artisanal_strap_catalog(v_measure_id, v_group_id,
      public.resolve_strap_canonical_color_id('CRISTAL COM FUNDO BRANCO'), 'internal', 'finished_product_group');
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Origem interna bloqueada: internal_production_disabled' THEN
    RAISE EXCEPTION 'STRASS comprado pronto nao pode produzir napa: %', v_error;
  END IF;
  INSERT INTO i703_strass_test_results VALUES ('producao_interna_recusada', to_jsonb(v_error));

  v_error := NULL;
  BEGIN
    INSERT INTO i703_strass_identity_fixture VALUES (jsonb_build_array(v_new_line
      || jsonb_build_object('identity_basis', 'reference_base', 'identity_group_id', NULL,
                           'color_mode', 'follow_main')));
  EXCEPTION WHEN check_violation THEN v_error := SQLERRM;
  END;
  IF v_error IS NULL OR position('sem producao interna cadastrada' IN v_error) = 0 THEN
    RAISE EXCEPTION 'Guarda deve recusar medida comprada pronta como interna: %', v_error;
  END IF;
  INSERT INTO i703_strass_test_results VALUES ('guarda_medida_interna_inexistente', to_jsonb(v_error));

  v_error := NULL;
  BEGIN
    INSERT INTO i703_strass_identity_fixture VALUES (jsonb_build_array(v_new_line
      || jsonb_build_object('identity_group_id',
        (v_before->'strap_colors'->0->>'identity_group_id')::uuid)));
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS NULL THEN RAISE EXCEPTION 'Grupo ausente deve ser recusado'; END IF;

  SELECT upper_material_group_id INTO STRICT v_wrong_group_id
    FROM public.reference_material_variants WHERE id = v_variant_id;
  v_error := NULL;
  BEGIN
    INSERT INTO i703_strass_identity_fixture VALUES (jsonb_build_array(v_new_line
      || jsonb_build_object('identity_group_id', v_wrong_group_id)));
  EXCEPTION WHEN check_violation THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Grupo comprado pronto nao pertence ao catalogo ativo desta medida de tira' THEN
    RAISE EXCEPTION 'Guarda deve recusar grupo Glow como produto STRASS: %', v_error;
  END IF;
  INSERT INTO i703_strass_test_results VALUES ('guarda_grupo_de_outra_medida', to_jsonb(v_error));

  -- Uma receita aprovada basta para cadastrar a primeira variante de uma
  -- medida interna. Nao exigir uma variante que o proprio PV materializara.
  SELECT m.id, m.strap_type_id INTO STRICT v_recipe_measure
    FROM public.artisanal_strap_measures m
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id AND t.active
   WHERE m.active AND EXISTS (
     SELECT 1 FROM public.artisanal_strap_recipes r WHERE r.measure_id = m.id
       AND r.status = 'approved' AND r.valid_from <= now()
       AND (r.valid_to IS NULL OR r.valid_to > now())
   ) AND NOT EXISTS (
     SELECT 1 FROM public.artisanal_strap_variants v WHERE v.measure_id = m.id
       AND v.status = 'active' AND v.identity_basis = 'reference_base'
       AND v.internal_production_enabled
   ) ORDER BY m.id LIMIT 1;
  INSERT INTO i703_strass_identity_fixture VALUES (jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'technical_strap_line_id', gen_random_uuid(),
      'measure_id', v_recipe_measure.id, 'strap_type_id', v_recipe_measure.strap_type_id,
      'identity_basis', 'reference_base', 'color_mode', 'follow_main', 'consumption', 50)));
  INSERT INTO i703_strass_test_results VALUES ('medida_com_receita_sem_variante_aceita', to_jsonb(v_recipe_measure));

  INSERT INTO i703_strass_identity_fixture VALUES (jsonb_build_array(v_new_line));
  INSERT INTO i703_strass_identity_fixture VALUES (jsonb_build_array(v_before->'strap_colors'->0));
  INSERT INTO i703_strass_identity_fixture VALUES ('[{"label":"Linha legada sem medida","consumption":50}]'::jsonb);
  INSERT INTO i703_strass_test_results VALUES ('guarda_aceita_overlock_pronta_e_legada', 'true'::jsonb);

  v_colors := private.mobile_strap_allowed_colors(
    'finished_product_group', v_group_id, v_measure_id, v_group_id);
  IF jsonb_array_length(v_colors) <> 2 THEN
    RAISE EXCEPTION 'Revisar fixture de cores comerciais mobile: %', v_colors;
  END IF;
  IF private.mobile_strap_allowed_colors('reference_base',
      v_wrong_group_id, v_measure_id, NULL) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Medida STRASS6mm nao pode oferecer cores de producao interna';
  END IF;
  INSERT INTO i703_strass_test_results VALUES ('mobile_somente_cores_comerciais_salvaveis', v_colors);

  INSERT INTO i703_strass_test_results VALUES ('PASS', jsonb_build_object(
    'consumo_cm_por_par_preservado', v_new_line->'consumption',
    'produto_estoque_receita_intocados', true,
    'probes_temporarios_revertidos_no_rollback', true));
END;
$test$;

SELECT * FROM i703_strass_test_results;
ROLLBACK;
