-- napas_da_referencia_por_tira_20270101035700
--
-- Decisão do dono (grill de 11/10/2026): em modelo multicolor, cada tira que
-- escolhe a COR no PV escolhe também a NAPA, entre as napas que a própria
-- referência possui — a napa-base da ficha mais a napa de cada variante de
-- material ativa (OB01: NAPA SOFT + GLOW METALIC). Antes o seletor só mostrava
-- as cores da napa do item, porque a tira "segue a referência".
--
-- Regra AUTOMÁTICA, sem cadastro novo na ficha: vale para toda linha
--   identity_basis = reference_base
--   AND color_mode = select_on_order
--   AND material_mode = follow_reference (ou ausente).
-- "Material fixo" e "Selecionar material no pedido" (lista própria) continuam
-- vencendo — a regra só substitui o "segue a referência".
--
-- Ponto único: private.resolve_technical_strap_material. Todos os chamadores
-- (writer do PV, prévia de estoque, diagnóstico, manifesto do celular, trigger
-- de alinhamento, cadastro de cor) já passam a napa gravada na tira como
-- p_selected_group_id — antes ela era ignorada em follow_reference.
--
-- A napa default continua sendo a do material do item
-- (resolve_strap_base_group_id(ref, variante)); sem escolha, nada muda.

-- ── Napas da referência (fonte única) ──────────────────────────────────────
-- Mesmo resolvedor que decide a napa do item, aplicado à ficha sem variante e a
-- cada variante ativa. Elegibilidade = mesma régua de validate_strap_material_policy.
CREATE OR REPLACE FUNCTION private.reference_strap_napa_group_ids(p_reference_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH raw AS (
    SELECT public.resolve_strap_base_group_id(p_reference_id, NULL) AS group_id,
           0 AS sort_order, ''::text AS tiebreak
    UNION ALL
    SELECT public.resolve_strap_base_group_id(p_reference_id, variant.id),
           1, coalesce(variant.display_order::text, '') || variant.id::text
      FROM public.reference_material_variants variant
     WHERE variant.reference_id = p_reference_id
       AND coalesce(variant.active, true)
  ), firsts AS (
    SELECT DISTINCT ON (raw.group_id) raw.group_id, raw.sort_order, raw.tiebreak
      FROM raw
     WHERE raw.group_id IS NOT NULL
     ORDER BY raw.group_id, raw.sort_order, raw.tiebreak
  )
  SELECT coalesce(array_agg(firsts.group_id ORDER BY firsts.sort_order, firsts.tiebreak), ARRAY[]::uuid[])
    FROM firsts
   WHERE public.strap_base_group_is_eligible(firsts.group_id)
     AND NOT public.is_buy_ready_strass_identity(NULL, firsts.group_id);
$function$;

REVOKE ALL ON FUNCTION private.reference_strap_napa_group_ids(uuid) FROM PUBLIC;

-- Leitura para a tela (desktop). Devolve, por referência, cada napa com a
-- origem (napa-base da ficha e/ou variantes) — a tela precisa saber qual napa é
-- o default de cada variante para a regra de troca de material (Q5).
CREATE OR REPLACE FUNCTION public.list_reference_strap_napas(p_reference_ids uuid[])
 RETURNS TABLE(
   reference_id uuid,
   base_group_id uuid,
   base_group_name text,
   sort_order integer,
   is_sheet_base boolean,
   variant_ids uuid[]
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Somente usuario aprovado pode consultar o cadastro de tiras' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT ref.id,
         napa.group_id,
         g.name,
         napa.ordinality::integer,
         public.resolve_strap_base_group_id(ref.id, NULL) IS NOT DISTINCT FROM napa.group_id,
         coalesce((
           SELECT array_agg(variant.id ORDER BY variant.display_order NULLS LAST, variant.id)
             FROM public.reference_material_variants variant
            WHERE variant.reference_id = ref.id
              AND coalesce(variant.active, true)
              AND public.resolve_strap_base_group_id(ref.id, variant.id) = napa.group_id
         ), ARRAY[]::uuid[])
    FROM (SELECT DISTINCT unnest(coalesce(p_reference_ids, ARRAY[]::uuid[])) AS id) ref
    CROSS JOIN LATERAL unnest(private.reference_strap_napa_group_ids(ref.id))
      WITH ORDINALITY napa(group_id, ordinality)
    JOIN public.product_groups g ON g.id = napa.group_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_reference_strap_napas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_reference_strap_napas(uuid[]) TO authenticated, service_role;

-- ── Resolvedor da napa por posição ─────────────────────────────────────────
-- Corpo vivo de 11/10/2026 + o ramo follow_reference/select_on_order abaixo.
CREATE OR REPLACE FUNCTION private.resolve_technical_strap_material(p_reference_id uuid, p_material_variant_id uuid, p_line_id uuid, p_selected_group_id uuid, p_require_selection boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_line jsonb;
  v_count integer;
  v_policy jsonb;
  v_mode text;
  v_basis text;
  v_base uuid;
  v_name text;
  v_pin uuid;
  v_sheet_name text;
BEGIN
  SELECT count(*)::integer, jsonb_agg(line.value) -> 0 INTO v_count, v_line
    FROM public.technical_sheets sheet
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(sheet.strap_colors) = 'array'
        THEN sheet.strap_colors ELSE '[]'::jsonb END
    ) line(value)
   WHERE sheet.id = p_reference_id
     AND line.value ->> 'technical_strap_line_id' = p_line_id::text;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'UUID da posicao deve pertencer uma unica vez a ficha vigente' USING ERRCODE = '23514';
  END IF;
  IF p_material_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reference_material_variants variant
     WHERE variant.id = p_material_variant_id
       AND variant.reference_id = p_reference_id
       AND coalesce(variant.active, true)
  ) THEN
    RAISE EXCEPTION 'Variante de material nao pertence a referencia ou esta inativa' USING ERRCODE = '23514';
  END IF;
  v_policy := private.validate_strap_material_policy(v_line);
  v_mode := v_policy ->> 'material_mode';
  v_basis := coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base');
  IF v_basis = 'finished_product_group' THEN
    v_base := nullif(v_line ->> 'identity_group_id', '')::uuid;
  ELSIF v_mode = 'follow_reference' THEN
    v_base := public.resolve_strap_base_group_id(p_reference_id, p_material_variant_id);
    -- Um pin de outra origem/cor nunca acompanha uma posicao de material proprio.
    IF coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') = 'follow_main' THEN
      v_pin := public.resolve_strap_pinned_base_product_id(p_reference_id, p_material_variant_id);
    -- napas_da_referencia_por_tira_20270101035700
    -- Tira multicolor (cor no PV): a napa tambem e do PV, entre as napas da
    -- referencia. Sem escolha = napa do material do item (default acima).
    ELSIF p_selected_group_id IS NOT NULL
          AND p_selected_group_id IS DISTINCT FROM v_base THEN
      IF NOT (p_selected_group_id = ANY(private.reference_strap_napa_group_ids(p_reference_id))) THEN
        SELECT coalesce(nullif(sheet.code, ''), nullif(sheet.name, ''), p_reference_id::text)
          INTO v_sheet_name
          FROM public.technical_sheets sheet WHERE sheet.id = p_reference_id;
        SELECT g.name INTO v_name FROM public.product_groups g WHERE g.id = p_selected_group_id;
        RAISE EXCEPTION 'Modelo %, %: a napa % nao e da referencia (napa-base da ficha ou variante ativa); escolha outra napa para a tira',
          v_sheet_name,
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA'),
          coalesce(v_name, p_selected_group_id::text)
          USING ERRCODE = '23514';
      END IF;
      v_base := p_selected_group_id;
    END IF;
  ELSIF v_mode = 'fixed_group' THEN
    v_base := (v_policy ->> 'material_group_id')::uuid;
  ELSE
    IF p_selected_group_id IS NULL THEN
      IF p_require_selection THEN
        RAISE EXCEPTION 'Selecione o material da posicao no Pedido de Venda' USING ERRCODE = '23514';
      END IF;
    ELSIF NOT ((v_policy -> 'allowed_material_group_ids') ? p_selected_group_id::text) THEN
      RAISE EXCEPTION 'Material escolhido nao e permitido para esta posicao da ficha' USING ERRCODE = '23514';
    END IF;
    v_base := p_selected_group_id;
  END IF;
  v_name := NULL;
  IF v_base IS NOT NULL THEN
    SELECT g.name INTO v_name FROM public.product_groups g WHERE g.id = v_base;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo-base da posicao nao existe' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN v_policy || jsonb_build_object(
    'base_group_id', v_base, 'base_group_name', v_name,
    'pinned_base_product_id', v_pin
  );
END;
$function$;

-- ── Opções de napa por posição (diagnóstico + manifesto do celular) ─────────
-- Corpo vivo de 11/10/2026 + a lista automática: default (napa do item)
-- primeiro, depois as demais napas da referência.
CREATE OR REPLACE FUNCTION private.technical_strap_material_options(p_reference_id uuid, p_material_variant_id uuid, p_line_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_line jsonb;
  v_policy jsonb;
  v_context jsonb;
  v_ids jsonb;
  v_id uuid;
  v_name text;
  v_colors jsonb;
  v_pin uuid;
  v_result jsonb := '[]'::jsonb;
  v_count integer;
BEGIN
  SELECT count(*)::integer, jsonb_agg(line.value) -> 0 INTO v_count, v_line
    FROM public.technical_sheets sheet
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(sheet.strap_colors) = 'array'
        THEN sheet.strap_colors ELSE '[]'::jsonb END
    ) line(value)
   WHERE sheet.id = p_reference_id
     AND line.value ->> 'technical_strap_line_id' = p_line_id::text;
  IF v_count <> 1 THEN RETURN '[]'::jsonb; END IF;
  BEGIN
    v_context := private.resolve_technical_strap_material(
      p_reference_id, p_material_variant_id, p_line_id, NULL, false
    );
  EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
  END;
  v_policy := private.validate_strap_material_policy(v_line);
  v_pin := (v_context ->> 'pinned_base_product_id')::uuid;
  v_ids := CASE WHEN v_policy ->> 'material_mode' = 'select_on_order'
    THEN v_policy -> 'allowed_material_group_ids'
    -- napas_da_referencia_por_tira_20270101035700
    WHEN v_policy ->> 'material_mode' = 'follow_reference'
         AND coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base') = 'reference_base'
         AND v_line ->> 'color_mode' = 'select_on_order'
         AND v_context ->> 'base_group_id' IS NOT NULL
      THEN (
        SELECT jsonb_agg(to_jsonb(napa.group_id) ORDER BY napa.group_id IS DISTINCT FROM (v_context ->> 'base_group_id')::uuid, napa.ordinality)
          FROM unnest(
            CASE WHEN (v_context ->> 'base_group_id')::uuid = ANY(private.reference_strap_napa_group_ids(p_reference_id))
              THEN private.reference_strap_napa_group_ids(p_reference_id)
              ELSE array_prepend((v_context ->> 'base_group_id')::uuid, private.reference_strap_napa_group_ids(p_reference_id))
            END
          ) WITH ORDINALITY napa(group_id, ordinality)
      )
    WHEN v_context ->> 'base_group_id' IS NOT NULL
      THEN jsonb_build_array(v_context -> 'base_group_id')
    ELSE '[]'::jsonb END;
  FOR v_id IN SELECT value::uuid FROM jsonb_array_elements_text(v_ids)
  LOOP
    SELECT g.name INTO v_name FROM public.product_groups g WHERE g.id = v_id;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_colors := private.mobile_strap_allowed_colors(
      coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base'),
      v_id, public.try_parse_uuid(v_line ->> 'measure_id'),
      public.try_parse_uuid(v_line ->> 'group_id')
    );
    IF v_pin IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(color.value ORDER BY color.ordinality), '[]'::jsonb)
        INTO v_colors
        FROM jsonb_array_elements(v_colors) WITH ORDINALITY color(value, ordinality)
       WHERE EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.id = v_pin AND p.active AND p.unit = 'm' AND p.group_id = v_id
            AND public.resolve_strap_canonical_color_id(p.color)
                  = public.try_parse_uuid(color.value ->> 'id')
            AND NOT EXISTS (
              SELECT 1 FROM public.base_material_color_official_products official
               WHERE official.base_group_id = v_id AND official.status = 'active'
                 AND official.color_id = public.try_parse_uuid(color.value ->> 'id')
                 AND official.official_product_id <> v_pin
            )
       );
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'base_group_id', v_id, 'base_group_name', v_name, 'allowed_colors', v_colors
    ));
  END LOOP;
  RETURN v_result;
END;
$function$;
