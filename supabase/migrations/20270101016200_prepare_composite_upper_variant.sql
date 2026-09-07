-- A variante troca somente a camada externa do Cabedal dublado. A preparação
-- reutiliza ou cadastra a composição física; produtos/cores e sua ficha/custo
-- continuam exigindo cadastro próprio. O frontend grava o grupo retornado no
-- override explícito da variante, sem liberar variant_drives_upper.

CREATE OR REPLACE FUNCTION public.prepare_composite_upper_variant(
  p_sheet_id uuid,
  p_main_group_id uuid
)
RETURNS TABLE (
  group_id uuid,
  group_name text,
  created boolean,
  active_product_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_base_id uuid;
  v_observed_base_id uuid;
  v_new_group_id uuid := pg_catalog.gen_random_uuid();
  v_lock_id uuid;
  v_locked_group_ids uuid[];
  v_base public.product_groups%ROWTYPE;
  v_main public.product_groups%ROWTYPE;
  v_source_id uuid;
  v_source_count integer;
  v_candidate_ids uuid[];
  v_group_id uuid;
  v_group_name text;
  v_created boolean := false;
BEGIN
  -- Mesma autorização do cadastro de fichas, variantes e grupos. DEFINER é
  -- necessário porque layers só concede SELECT ao cliente e os validadores
  -- internos da composição não são RPCs públicas.
  IF auth.uid() IS NULL
     OR NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permission denied: preparar Cabedal composto exige Administração/Gerência.'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL OR p_main_group_id IS NULL THEN
    RAISE EXCEPTION 'Informe a referência e o material principal da variante.'
      USING ERRCODE = '22004';
  END IF;

  -- A edição de camadas toma leaf locks antes do guard composto diferido.
  -- Preserve essa ordem para não criar um ciclo global→leaf / leaf→global.
  SELECT coalesce(pin.group_id, ts.upper_material_group_id)
    INTO v_observed_base_id
    FROM public.technical_sheets ts
    LEFT JOIN public.products pin
      ON pin.id = ts.upper_material_product_id AND pin.active = true
   WHERE ts.id = p_sheet_id AND ts.retired_at IS NULL;
  SELECT pg_catalog.array_agg(DISTINCT ids.id ORDER BY ids.id)
    INTO v_locked_group_ids
    FROM (
      SELECT pg_catalog.unnest(ARRAY[v_observed_base_id, p_main_group_id, v_new_group_id]) AS id
      UNION ALL
      SELECT l.component_group_id FROM public.product_group_layers l
       WHERE l.composite_group_id = v_observed_base_id
    ) ids WHERE ids.id IS NOT NULL;
  FOREACH v_lock_id IN ARRAY v_locked_group_ids LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('group-leaf-reference:' || v_lock_id::text, 0)
    );
  END LOOP;

  -- Reutiliza a trava dos guards e serializa inclusive duas preparações de
  -- uma composição ainda inexistente. Toda leitura anterior é revalidada.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('composite-upper-structure-writes', 0)
  );

  SELECT coalesce(pin.group_id, ts.upper_material_group_id)
    INTO v_base_id
    FROM public.technical_sheets ts
    LEFT JOIN public.products pin
      ON pin.id = ts.upper_material_product_id AND pin.active = true
   WHERE ts.id = p_sheet_id
     AND ts.retired_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referência não encontrada ou aposentada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_base_id IS DISTINCT FROM v_observed_base_id OR EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE l.composite_group_id = v_base_id
       AND l.component_group_id IS NOT NULL
       AND NOT (l.component_group_id = ANY(v_locked_group_ids))
  ) THEN
    RAISE EXCEPTION 'A composição do Cabedal mudou durante a preparação. Atualize a referência e tente novamente.'
      USING ERRCODE = '40001';
  END IF;

  SELECT g.* INTO v_base FROM public.product_groups g WHERE g.id = v_base_id;
  IF NOT FOUND OR v_base.is_family OR EXISTS (
    SELECT 1 FROM public.product_groups child WHERE child.parent_group_id = v_base_id
  ) OR NOT public.is_composite_product_group(v_base_id) THEN
    RAISE EXCEPTION 'O Cabedal da referência precisa ter uma composição cadastrada em grupo-folha.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO v_source_count
    FROM public.product_group_layers l
   WHERE l.composite_group_id = v_base_id AND l.is_color_source = true;
  SELECT l.component_group_id INTO v_source_id
    FROM public.product_group_layers l
   WHERE l.composite_group_id = v_base_id AND l.is_color_source = true;
  IF v_source_count <> 1 OR v_source_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE l.composite_group_id = v_base_id AND NOT l.is_color_source
  ) THEN
    RAISE EXCEPTION 'Cadastre exatamente uma camada externa com grupo de material e fonte de cor no Cabedal.'
      USING ERRCODE = '23514';
  END IF;

  SELECT g.* INTO v_main FROM public.product_groups g WHERE g.id = p_main_group_id;
  IF NOT FOUND OR v_main.is_family OR EXISTS (
    SELECT 1 FROM public.product_groups child WHERE child.parent_group_id = p_main_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_group_layers l WHERE l.composite_group_id = p_main_group_id
  ) THEN
    RAISE EXCEPTION 'O material principal deve ser um grupo-folha simples, sem composição própria.'
      USING ERRCODE = '23514';
  END IF;

  IF v_source_id = p_main_group_id THEN
    v_group_id := v_base_id;
    v_group_name := v_base.name;
  ELSE
    SELECT pg_catalog.array_agg(g.id ORDER BY g.id)
      INTO v_candidate_ids
      FROM public.product_groups g
     WHERE g.is_family = false
       AND NOT EXISTS (
         SELECT 1 FROM public.product_groups child WHERE child.parent_group_id = g.id
       )
       AND (SELECT count(*) FROM public.product_group_layers source
             WHERE source.composite_group_id = g.id AND source.is_color_source) = 1
       AND EXISTS (
         SELECT 1 FROM public.product_group_layers source
          WHERE source.composite_group_id = g.id
            AND source.is_color_source
            AND source.component_group_id = p_main_group_id
       )
       AND public.product_group_upper_structure_is_compatible(v_base_id, g.id);

    IF coalesce(pg_catalog.cardinality(v_candidate_ids), 0) > 1 THEN
      RAISE EXCEPTION 'Há mais de um Cabedal composto compatível para %. Selecione o grupo no override de Cabedal.', v_main.name
        USING ERRCODE = '21000';
    END IF;

    IF coalesce(pg_catalog.cardinality(v_candidate_ids), 0) = 1 THEN
      v_group_id := v_candidate_ids[1];
      SELECT g.name INTO v_group_name FROM public.product_groups g WHERE g.id = v_group_id;
    ELSE
      SELECT pg_catalog.string_agg(
        CASE WHEN l.is_color_source THEN v_main.name ELSE l.component_label END,
        ' + ' ORDER BY l.display_order, l.id
      ) INTO v_group_name
      FROM public.product_group_layers l WHERE l.composite_group_id = v_base_id;

      -- Nome nunca substitui a identidade das camadas. Colisão de nome sem
      -- composição compatível exige correção cadastral, não fusão automática.
      IF EXISTS (
        SELECT 1 FROM public.product_groups g
         WHERE pg_catalog.lower(pg_catalog.btrim(g.name))
           = pg_catalog.lower(pg_catalog.btrim(v_group_name))
      ) THEN
        RAISE EXCEPTION 'O grupo % já existe com outra composição. Revise suas camadas antes de usá-lo.', v_group_name
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.product_groups (id, name, sector, is_family, description)
      VALUES (
        v_new_group_id, v_group_name, 'Cabedal', false,
        'Cabedal composto derivado de ' || v_base.name || '. Cadastre os produtos por cor, dimensões e custo do material acabado.'
      ) RETURNING id INTO v_group_id;

      INSERT INTO public.product_group_layers (
        composite_group_id, component_group_id, component_label, role,
        display_order, is_color_source, notes, created_by
      )
      SELECT v_group_id,
        CASE WHEN l.is_color_source THEN p_main_group_id ELSE l.component_group_id END,
        CASE WHEN l.is_color_source THEN v_main.name ELSE l.component_label END,
        l.role, l.display_order, l.is_color_source, l.notes, auth.uid()
      FROM public.product_group_layers l WHERE l.composite_group_id = v_base_id;
      v_created := true;
    END IF;
  END IF;

  IF NOT public.product_group_upper_structure_is_compatible(v_base_id, v_group_id) THEN
    RAISE EXCEPTION 'A composição derivada não preservou as camadas fixas do Cabedal.'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT v_group_id, v_group_name, v_created,
    (SELECT count(*)::integer FROM public.products p
      WHERE p.group_id = v_group_id AND p.active = true);
END
$function$;

REVOKE ALL ON FUNCTION public.prepare_composite_upper_variant(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_composite_upper_variant(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.prepare_composite_upper_variant(uuid, uuid) IS
  'Prepara grupo/camadas do Cabedal composto trocando só a fonte de cor. Reutiliza composição única; não cria SKU, ficha, preço, saldo ou override de variante.';
