-- =============================================================================
-- Tira pronta (Strass e similares) na ficha técnica, sem exigir napa-base
-- =============================================================================
-- Sintoma: ao lançar a ficha e selecionar Strass (tira comprada pronta, sem
-- material base), o gatilho tg_validate_technical_strap_identity bloqueia o
-- salvamento.
--
-- Causas:
--   1. TIRA STRASS 15MM tem receitas artesanais aprovadas e nenhuma variante
--      finished_product_group no Hub. Com measure_id, o gatilho recusa o grupo
--      acabado: "Grupo comprado pronto nao pertence ao catalogo ativo desta
--      medida de tira". Se a linha cair em reference_base, o guarda de UUID
--      recusa: "Linha STRASS por UUID explicito exige finished_product_group".
--   2. TIRA STRASS 6MM não tem receita interna. Se a linha ficar artesanal,
--      o gatilho recusa: "Medida da tira sem producao interna cadastrada".
--   3. is_buy_ready_strass_identity é uma lista fixa de UUIDs. A classificação
--      correta já existe no cadastro: strap_origin = comprar_pronto e
--      strap_uses_napa = false.
--
-- Correção:
--   - is_ready_made_strap_group: flag do grupo (ou a lista nominal de Strass).
--   - Tira pronta não pode ser salva como reference_base.
--   - finished_product_group aceita o grupo acabado com SKU linear ativo, mesmo
--     sem variante Hub (caso 15MM).
--   - Funções de Ateliê recusam tira pronta (não geram OC de napa / OS).
--
-- Marcador: tira_pronta_ficha_sem_napa_20270101063000
-- Não grava ficha, pedido nem estoque reais.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_ready_made_strap_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    p_group_id IS NOT NULL
    AND (
      public.is_buy_ready_strass_identity(NULL, p_group_id)
      OR EXISTS (
        SELECT 1
          FROM public.product_groups g
         WHERE g.id = p_group_id
           AND (
             g.strap_origin = 'comprar_pronto'
             OR g.strap_uses_napa IS FALSE
           )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.is_ready_made_strap_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ready_made_strap_group(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_ready_made_strap_group(uuid) IS
  'Tira comprada pronta: strap_origin=comprar_pronto ou strap_uses_napa=false, com fallback da lista nominal de Strass. Não inferir pelo nome.';

CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line jsonb;
  v_basis text;
  v_color_mode text;
  v_group_id uuid;
  v_legacy_group_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_origem text;
  v_mapped_group uuid;
BEGIN
  -- tira_pronta_ficha_sem_napa_20270101063000
  IF NEW.strap_colors IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.strap_colors) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array JSON';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    PERFORM private.validate_strap_material_policy(v_line);
    v_group_id := NULL;
    v_legacy_group_id := NULL;
    v_measure_id := NULL;
    v_strap_type_id := NULL;
    v_origem := NULL;
    v_mapped_group := NULL;
    v_basis := coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base');

    IF v_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui identity_basis invalido';
    END IF;
    v_color_mode := nullif(v_line ->> 'color_mode', '');
    IF v_color_mode IS NOT NULL
       AND v_color_mode NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha tecnica possui color_mode invalido';
    END IF;
    IF v_basis = 'finished_product_group'
       AND v_color_mode = 'follow_main' THEN
      RAISE EXCEPTION 'Tira comprada pronta exige color_mode select_on_order';
    END IF;

    BEGIN
      v_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
      v_strap_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Linha tecnica possui familia ou medida canonica invalida';
    END;

    IF (v_measure_id IS NULL) <> (v_strap_type_id IS NULL) THEN
      RAISE EXCEPTION 'Linha tecnica exige familia e medida canonicas juntas';
    END IF;

    IF v_measure_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_measures measure
        JOIN public.artisanal_strap_types strap_type
          ON strap_type.id = measure.strap_type_id
       WHERE measure.id = v_measure_id
         AND measure.strap_type_id = v_strap_type_id
         AND measure.active
         AND strap_type.active
    ) THEN
      RAISE EXCEPTION 'Linha tecnica possui familia ou medida inativa ou divergente';
    END IF;

    IF v_basis = 'finished_product_group' THEN
      BEGIN
        v_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta possui identity_group_id invalido';
      END;
      IF v_group_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_groups product_group WHERE product_group.id = v_group_id
      ) THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta exige identity_group_id existente';
      END IF;
    END IF;

    IF v_measure_id IS NOT NULL THEN
      SELECT m.origem_padrao INTO v_origem
        FROM public.artisanal_strap_measures m
       WHERE m.id = v_measure_id;
      SELECT map.strap_group_id INTO v_mapped_group
        FROM public.strap_hub_measure_group_map map
       WHERE map.measure_id = v_measure_id;

      IF v_basis = 'reference_base'
         AND (
           v_origem = 'sempre_sku_acabado'
           OR public.is_ready_made_strap_group(v_mapped_group)
         ) THEN
        RAISE EXCEPTION
          'Esta tira é comprada pronta e não usa material base. Selecione o grupo de estoque acabado (Comprar pronto).'
          USING ERRCODE = '23514';
      END IF;

      IF v_basis = 'reference_base' AND NOT (
        EXISTS (
          SELECT 1 FROM public.artisanal_strap_variants variant
           WHERE variant.measure_id = v_measure_id
             AND variant.status = 'active'
             AND variant.identity_basis = 'reference_base'
             AND variant.internal_production_enabled
        ) OR EXISTS (
          SELECT 1 FROM public.artisanal_strap_recipes recipe
           WHERE recipe.measure_id = v_measure_id
             AND recipe.status = 'approved'
             AND recipe.valid_from <= now()
             AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
        )
      ) THEN
        RAISE EXCEPTION 'Medida da tira sem producao interna cadastrada; selecione uma identidade comprada pronta ou cadastre a receita'
          USING ERRCODE = '23514';
      ELSIF v_basis = 'finished_product_group' AND NOT EXISTS (
        SELECT 1 FROM public.artisanal_strap_variants variant
        JOIN public.products product ON product.id = variant.finished_product_id
          AND product.active AND product.unit = 'm'
          AND product.group_id = variant.base_group_id
         WHERE variant.measure_id = v_measure_id
           AND variant.base_group_id = v_group_id
           AND variant.status = 'active'
           AND variant.identity_basis = 'finished_product_group'
      ) THEN
        IF NOT (
          public.is_ready_made_strap_group(v_group_id)
          AND EXISTS (
            SELECT 1 FROM public.products product
             WHERE product.group_id = v_group_id
               AND product.active
               AND product.unit = 'm'
          )
        ) THEN
          RAISE EXCEPTION 'Grupo comprado pronto nao pertence ao catalogo ativo desta medida de tira'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;

    BEGIN
      v_legacy_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_legacy_group_id := NULL;
    END;
    IF public.is_ready_made_strap_group(v_legacy_group_id)
       AND (
         v_basis <> 'finished_product_group'
         OR v_group_id IS DISTINCT FROM v_legacy_group_id
       ) THEN
      RAISE EXCEPTION
        'Esta tira é comprada pronta e não usa material base. Selecione o grupo de estoque acabado (Comprar pronto).';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_validate_technical_strap_identity() IS
  'Valida identidade das tiras da ficha. Tira pronta (comprar_pronto / sem napa) não exige receita nem variante Hub, desde que o grupo acabado tenha SKU linear ativo.';

-- Ateliê: tira pronta não gera OC de napa nem OS.
CREATE OR REPLACE FUNCTION private._assert_atelier_strap_is_artisanal(p_group public.product_groups)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_group.id IS NULL OR NOT coalesce(p_group.is_artisanal_strap, false) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  IF public.is_ready_made_strap_group(p_group.id) THEN
    RAISE EXCEPTION
      'Esta tira é comprada pronta e não gera OS de Ateliê. Compre o SKU acabado pelo estoque ou pela OC.';
  END IF;
END;
$function$;

COMMENT ON FUNCTION private._assert_atelier_strap_is_artisanal(public.product_groups) IS
  'Ateliê só opera tira artesanal (com napa). Tira pronta é recusada.';

DO $patch_atelier$
DECLARE
  v_fn text;
  v_def text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  -- generate_atelier_strap_napa_purchase
  v_fn := 'public.generate_atelier_strap_napa_purchase(uuid,uuid,numeric,uuid)';
  IF to_regprocedure(v_fn) IS NOT NULL THEN
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('tira_pronta_ficha_sem_napa_20270101063000' IN v_def) = 0 THEN
      v_old := $old$  IF v_strap.id IS NULL OR NOT coalesce(v_group.is_artisanal_strap, false) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;$old$;
      v_new := $new$  IF v_strap.id IS NULL THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  -- tira_pronta_ficha_sem_napa_20270101063000
  PERFORM private._assert_atelier_strap_is_artisanal(v_group);$new$;
      v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
      IF v_hits IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'generate_atelier_strap_napa_purchase: ancora inesperada (hits=%)', coalesce(v_hits, 0);
      END IF;
      EXECUTE replace(v_def, v_old, v_new);
    END IF;
  END IF;

  v_fn := 'public.generate_atelier_strap_purchase_and_service(uuid,uuid,numeric,uuid,uuid,numeric)';
  IF to_regprocedure(v_fn) IS NOT NULL THEN
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('tira_pronta_ficha_sem_napa_20270101063000' IN v_def) = 0 THEN
      v_old := $old$  IF v_strap.id IS NULL OR NOT coalesce(v_group.is_artisanal_strap, false) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;$old$;
      v_new := $new$  IF v_strap.id IS NULL THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  -- tira_pronta_ficha_sem_napa_20270101063000
  PERFORM private._assert_atelier_strap_is_artisanal(v_group);$new$;
      v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
      IF v_hits IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'generate_atelier_strap_purchase_and_service: ancora inesperada (hits=%)', coalesce(v_hits, 0);
      END IF;
      EXECUTE replace(v_def, v_old, v_new);
    END IF;
  END IF;

  v_fn := 'public.register_atelier_strap_produced(uuid,uuid,numeric,uuid,numeric)';
  IF to_regprocedure(v_fn) IS NOT NULL THEN
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('tira_pronta_ficha_sem_napa_20270101063000' IN v_def) = 0 THEN
      v_old := $old$  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = v_strap.group_id AND coalesce(g.is_artisanal_strap, false)
  ) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;$old$;
      v_new := $new$  -- tira_pronta_ficha_sem_napa_20270101063000
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  PERFORM private._assert_atelier_strap_is_artisanal((
    SELECT g FROM public.product_groups g WHERE g.id = v_strap.group_id
  ));$new$;
      v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
      IF v_hits IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'register_atelier_strap_produced: ancora inesperada (hits=%)', coalesce(v_hits, 0);
      END IF;
      EXECUTE replace(v_def, v_old, v_new);
    END IF;
  END IF;

  v_fn := 'public.list_atelier_strap_shortages()';
  IF to_regprocedure(v_fn) IS NOT NULL THEN
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF position('tira_pronta_ficha_sem_napa_20270101063000' IN v_def) = 0 THEN
      v_old := $old$JOIN public.product_groups g ON g.id = p.group_id AND coalesce(g.is_artisanal_strap, false)$old$;
      v_new := $new$JOIN public.product_groups g ON g.id = p.group_id AND coalesce(g.is_artisanal_strap, false)
       AND NOT public.is_ready_made_strap_group(g.id) /* tira_pronta_ficha_sem_napa_20270101063000 */$new$;
      v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
      IF coalesce(v_hits, 0) = 0 THEN
        RAISE EXCEPTION 'list_atelier_strap_shortages: ancora is_artisanal_strap nao encontrada';
      END IF;
      EXECUTE replace(v_def, v_old, v_new);
    END IF;
  END IF;
END;
$patch_atelier$;

DO $guard$
DECLARE
  v_def text := pg_get_functiondef('public.tg_validate_technical_strap_identity()'::regprocedure);
BEGIN
  IF position('tira_pronta_ficha_sem_napa_20270101063000' IN v_def) = 0
     OR position('Esta tira é comprada pronta e não usa material base' IN v_def) = 0
     OR position('is_ready_made_strap_group' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guard 63000: tg_validate_technical_strap_identity nao reconhece tira pronta';
  END IF;
  IF to_regprocedure('public.is_ready_made_strap_group(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Guard 63000: is_ready_made_strap_group ausente';
  END IF;
END;
$guard$;
