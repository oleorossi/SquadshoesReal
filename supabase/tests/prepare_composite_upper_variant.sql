-- Integração transacional: executar como postgres num banco com as migrations
-- aplicadas e pelo menos um perfil aprovado admin/gerente. Todos os grupos,
-- fichas e variantes de teste são descartados pelo ROLLBACK final.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_admin uuid;
  v_other uuid;
  v_source uuid := pg_catalog.gen_random_uuid();
  v_main uuid := pg_catalog.gen_random_uuid();
  v_fixed uuid := pg_catalog.gen_random_uuid();
  v_base uuid := pg_catalog.gen_random_uuid();
  v_duplicate uuid := pg_catalog.gen_random_uuid();
  v_sheet uuid := pg_catalog.gen_random_uuid();
  v_pure_sheet uuid := pg_catalog.gen_random_uuid();
  v_family uuid := pg_catalog.gen_random_uuid();
  v_tag text := 'TESTE DUBLAGEM ' || pg_catalog.gen_random_uuid()::text;
  v_first record;
  v_second record;
  v_variant_count bigint;
  v_product_count bigint;
  v_component_count bigint;
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon', 'public.prepare_composite_upper_variant(uuid,uuid)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.prepare_composite_upper_variant(uuid,uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ACL da RPC não corresponde a authenticated sem anon.';
  END IF;

  SELECT ur.user_id INTO v_admin
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id AND p.approved
  WHERE ur.role::text IN ('admin', 'gerente') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Teste exige um perfil aprovado admin/gerente; não foi executado.';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM * FROM public.prepare_composite_upper_variant(v_sheet, v_main);
    RAISE EXCEPTION 'RPC aceitou chamada sem usuário.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', pg_catalog.gen_random_uuid()::text, true);
  BEGIN
    PERFORM * FROM public.prepare_composite_upper_variant(v_sheet, v_main);
    RAISE EXCEPTION 'RPC aceitou usuário inexistente/não aprovado.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Usa um perfil já existente para verificar o limite de papel, quando o
  -- banco possui alguém fora da gerência. O gate sem aprovação é obrigatório.
  SELECT p.id INTO v_other FROM public.profiles p
  WHERE p.approved AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role::text IN ('admin', 'gerente')
  ) ORDER BY p.id LIMIT 1;
  IF v_other IS NOT NULL THEN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
    BEGIN
      PERFORM * FROM public.prepare_composite_upper_variant(v_sheet, v_main);
      RAISE EXCEPTION 'RPC aceitou usuário aprovado sem papel técnico.';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', v_admin
  )::text, true);

  INSERT INTO public.product_groups (id, name, sector) VALUES
    (v_source, v_tag || ' NAPA', 'Cabedal'),
    (v_main, v_tag || ' GLOW', 'Cabedal'),
    (v_fixed, v_tag || ' MASSABOX', 'Cabedal'),
    (v_base, v_tag || ' ORIGINAL', 'Cabedal');
  INSERT INTO public.product_groups (id, name, sector, is_family)
  VALUES (v_family, v_tag || ' FAMÍLIA', 'Cabedal', true);

  -- Duas camadas fixas idênticas exercitam multiconjunto, não apenas conjunto.
  INSERT INTO public.product_group_layers (
    composite_group_id, component_group_id, component_label, role,
    display_order, is_color_source
  ) VALUES
    (v_base, v_source, '', 'Material externo', 0, true),
    (v_base, v_fixed, '', 'Base da dublagem', 1, false),
    (v_base, v_fixed, '', 'Base da dublagem', 2, false),
    (v_base, NULL, 'REFORÇO LIVRE', 'Reforço interno', 3, false);

  INSERT INTO public.technical_sheets (
    id, name, upper_material_group_id, variant_drives_upper
  ) VALUES (v_sheet, v_tag, v_base, false),
           (v_pure_sheet, v_tag || ' PURA', v_source, false);

  SELECT count(*) INTO v_product_count FROM public.products;
  SELECT count(*) INTO v_component_count FROM public.component_sheets;
  SELECT count(*) INTO v_variant_count FROM public.reference_material_variants;

  SELECT * INTO v_first FROM public.prepare_composite_upper_variant(v_sheet, v_main);
  IF NOT v_first.created OR v_first.active_product_count <> 0
     OR NOT public.product_group_upper_structure_is_compatible(v_base, v_first.group_id)
     OR (SELECT count(*) FROM public.product_group_layers l
         WHERE l.composite_group_id = v_first.group_id) <> 4
     OR NOT EXISTS (
       SELECT 1 FROM public.product_group_layers l
       WHERE l.composite_group_id = v_first.group_id AND l.is_color_source
         AND l.component_group_id = v_main AND l.display_order = 0
         AND l.role = 'Material externo'
     ) OR (SELECT count(*) FROM public.product_group_layers l
           WHERE l.composite_group_id = v_first.group_id
             AND l.component_group_id = v_fixed AND NOT l.is_color_source) <> 2 THEN
    RAISE EXCEPTION 'Derivação não preservou a composição exata do Cabedal.';
  END IF;
  IF (SELECT count(*) FROM public.products) <> v_product_count
     OR (SELECT count(*) FROM public.component_sheets) <> v_component_count
     OR (SELECT count(*) FROM public.reference_material_variants) <> v_variant_count
     OR EXISTS (
       SELECT 1 FROM public.product_groups g WHERE g.id = v_first.group_id
       AND (coalesce(g.dimensions_width, 0) <> 0
         OR coalesce(g.dimensions_length, 0) <> 0
         OR coalesce(g.package_price, 0) <> 0
         OR g.auto_component_sheet OR g.shared_specs)
     ) THEN
    RAISE EXCEPTION 'Preparação inventou produtos, fichas, medidas, custo ou alterou variantes.';
  END IF;

  SELECT * INTO v_second FROM public.prepare_composite_upper_variant(v_sheet, v_main);
  IF v_second.created OR v_second.group_id <> v_first.group_id THEN
    RAISE EXCEPTION 'Repetição da preparação não foi idempotente.';
  END IF;

  SELECT * INTO v_second FROM public.prepare_composite_upper_variant(v_sheet, v_source);
  IF v_second.created OR v_second.group_id <> v_base THEN
    RAISE EXCEPTION 'Fonte original deveria reutilizar o próprio Cabedal.';
  END IF;

  BEGIN
    PERFORM * FROM public.prepare_composite_upper_variant(v_pure_sheet, v_main);
    RAISE EXCEPTION 'RPC aceitou Cabedal base sem composição.';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.prepare_composite_upper_variant(v_sheet, v_base);
    RAISE EXCEPTION 'RPC aceitou composto como material externo simples.';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.prepare_composite_upper_variant(v_sheet, v_family);
    RAISE EXCEPTION 'RPC aceitou família como material externo.';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  -- A guarda existente deve continuar impedindo o override Glow puro.
  BEGIN
    INSERT INTO public.reference_material_variants (
      reference_id, material_name, sku, active, display_order, main_material_group_id, upper_material_group_id
    ) VALUES (v_sheet, v_tag || ' INVÁLIDA', 'TESTE-INVALIDA-' || v_sheet::text, true, 0, v_main, v_main);
    RAISE EXCEPTION 'Guarda permitiu variante remover as camadas fixas.';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    IF pg_catalog.strpos(SQLERRM, 'incompatível') = 0 THEN RAISE; END IF;
  END;
  INSERT INTO public.reference_material_variants (
    reference_id, material_name, sku, active, display_order, main_material_group_id, upper_material_group_id
  ) VALUES (v_sheet, v_tag || ' VÁLIDA', 'TESTE-VALIDA-' || v_sheet::text, true, 0, v_main, v_first.group_id);

  -- Segundo grupo fisicamente equivalente não pode ser escolhido por UUID,
  -- nome, estoque ou ordem de consulta.
  INSERT INTO public.product_groups (id, name, sector)
  VALUES (v_duplicate, v_tag || ' DUPLICADO', 'Cabedal');
  INSERT INTO public.product_group_layers (
    composite_group_id, component_group_id, component_label, role,
    display_order, is_color_source
  ) SELECT v_duplicate, l.component_group_id, l.component_label, l.role,
      l.display_order, l.is_color_source
    FROM public.product_group_layers l WHERE l.composite_group_id = v_first.group_id;
  BEGIN
    PERFORM * FROM public.prepare_composite_upper_variant(v_sheet, v_main);
    RAISE EXCEPTION 'RPC escolheu arbitrariamente uma composição ambígua.';
  EXCEPTION WHEN SQLSTATE '21000' THEN NULL;
  END;

  RAISE NOTICE 'prepare_composite_upper_variant: contratos transacionais aprovados.';
END
$test$;

-- Exercita também o guard diferido antes de descartar todas as fixtures.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: prepare_composite_upper_variant (fixtures descartadas por ROLLBACK)' AS result;
ROLLBACK;
