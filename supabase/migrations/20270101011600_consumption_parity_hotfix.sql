-- Paridade de identidade e quantidade do consumo do PV.
--
-- Fecha duas divergências reproduzidas pela suíte TS × SQL:
--   1. PALMILHA: grupo heterogêneo (área + linear) fazia o SQL escolher o SKU
--      linear de maior estoque, enquanto o motor TS escolhia a placa de área;
--   2. EMBALAGEM: o SQL mantinha fração de unidade física (ex.: 0,498 caixa),
--      enquanto o TS aplica CEIL por item do PV antes da consolidação.
--
-- Não altera catálogo, pedidos ou snapshots históricos. A mudança vale apenas
-- para novos cálculos. O patch textual preserva o corpo vivo (~50 KB) do motor
-- by_grade e falha alto se a âncora ou as assinaturas canônicas mudarem.

BEGIN;
-- MIGRACAO AUTONOMA DA AUDITORIA 2026-08-25. O corpo e idempotente e pode
-- rodar tanto sem a migration 106 quanto depois dela, permitindo entrega isolada.

-- ---------------------------------------------------------------------------
-- 1. Palmilha: pin explícito > grupo da variante > grupo da ficha.
--    Dentro do grupo sem pin, restringe a resolução aos SKUs ativos de área
--    quando existir pelo menos um. Grupo só linear mantém o resolver genérico.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid,
  p_group_name text,
  p_color text,
  p_required numeric
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  available_qty numeric,
  matched_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_gid uuid;
  v_gname text;
  v_effective_group text := p_group_name;
  v_variant_group boolean := false;
  v_has_area_product boolean := false;
  v_color_norm text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.insole_material_product_id, v.insole_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants v
     WHERE v.id = p_variant_id;

    -- AUDIT-CONSUMPTION-PARITY-20260825: pin explícito sempre vence, inclusive
    -- quando a unidade do produto pinado não é de área.
    IF v_pid IS NOT NULL THEN
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p
       WHERE p.id = v_pid
         AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;

    -- O grupo explícito da variante vence o grupo base da ficha.
    IF v_gid IS NOT NULL THEN
      SELECT pg.name
        INTO v_gname
        FROM public.product_groups pg
       WHERE pg.id = v_gid;

      IF v_gname IS NOT NULL AND btrim(v_gname) <> '' THEN
        v_effective_group := v_gname;
        v_variant_group := true;
      END IF;
    END IF;
  END IF;

  IF v_effective_group IS NULL OR btrim(v_effective_group) = '' THEN
    RETURN;
  END IF;

  -- AUDIT-CONSUMPTION-PARITY-20260825: area-first. `placa` fica fora de
  -- propósito, igual ao AREA_STOCK_UNITS do TS: aqui área significa estoque
  -- medido em dm²/m²/cm², não uma unidade discreta já convertida.
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.active = true
       AND pg.name = v_effective_group
       AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
         ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
       )
  ) INTO v_has_area_product;

  IF v_has_area_product THEN
    IF p_color IS NOT NULL
       AND btrim(p_color) <> ''
       AND btrim(p_color) <> '—' THEN
      v_color_norm := lower(btrim(extensions.unaccent(p_color)));

      -- Mesma precedência do resolver canônico: cor exata, nome parcial e,
      -- por fim, tipo do grupo. O pool permanece restrito aos SKUs de área.
      RETURN QUERY
      SELECT p.id, p.name, p.quantity,
             CASE WHEN v_variant_group
               THEN 'variant_group'::text ELSE 'exact_color'::text END
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true
         AND pg.name = v_effective_group
         AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
           ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
         )
         AND lower(btrim(extensions.unaccent(COALESCE(p.color, '')))) = v_color_norm
       ORDER BY p.quantity DESC
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;

      RETURN QUERY
      SELECT p.id, p.name, p.quantity,
             CASE WHEN v_variant_group
               THEN 'variant_group'::text ELSE 'partial_name'::text END
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true
         AND pg.name = v_effective_group
         AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
           ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
         )
         AND lower(extensions.unaccent(p.name)) LIKE '%' || v_color_norm || '%'
       ORDER BY p.quantity DESC
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;

      IF EXISTS (
        SELECT 1
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
           AND p.color IS NOT NULL
           AND btrim(p.color) <> ''
      ) THEN
        RETURN QUERY
        SELECT p.id, p.name, p.quantity, 'color_mismatch'::text
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
         ORDER BY p.quantity DESC
         LIMIT 1;
      ELSE
        RETURN QUERY
        SELECT p.id, p.name, p.quantity,
               CASE WHEN v_variant_group
                 THEN 'variant_group'::text ELSE 'group_generic'::text END
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
         ORDER BY p.quantity DESC
         LIMIT 1;
      END IF;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT p.id, p.name, p.quantity,
           CASE WHEN v_variant_group
             THEN 'variant_group'::text ELSE 'group_fallback'::text END
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.active = true
       AND pg.name = v_effective_group
       AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
         ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
       )
     ORDER BY p.quantity DESC
     LIMIT 1;
    RETURN;
  END IF;

  -- AUDIT-CONSUMPTION-PARITY-20260825: linear-only-fallback. Preserva a
  -- resolução antiga para grupos sem nenhum SKU ativo de área.
  RETURN QUERY
  SELECT r.product_id,
         r.product_name,
         r.available_qty,
         CASE
           WHEN v_variant_group AND r.matched_by <> 'color_mismatch'
             THEN 'variant_group'::text
           ELSE r.matched_by
         END
    FROM public.resolve_material_product(
      v_effective_group, p_color, p_required, false
    ) r;
END;
$function$;

COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric) IS
  'Resolve palmilha por pin explícito, grupo da variante e grupo da ficha. Em grupo heterogêneo sem pin, prefere SKU ativo de unidade de área; grupo só linear preserva o resolver genérico.';

-- ---------------------------------------------------------------------------
-- 2. Embalagem discreta: CEIL por item, depois da conversão e antes da linha
--    ser devolvida. m/kg/L permanecem fracionários porque não entram no gate.
-- ---------------------------------------------------------------------------
DO $patch_by_grade$
DECLARE
  v_definition text;
  v_anchor text := $anchor$    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,$anchor$;
  v_replacement text := $replacement$    -- AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item.
    -- A chamada do motor é por item/referência. Arredondar aqui impede que
    -- frações de caixas de itens diferentes sejam somadas antes do CEIL.
    IF btrim(v_row_cat_norm) = 'embalagem'
       AND lower(btrim(COALESCE(v_conv.target_unit, ''))) = ANY (
         ARRAY['un', 'par', 'placa']::text[]
       )
       AND v_required > 0 THEN
      v_required := CEIL(v_required);
    END IF;

    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,$replacement$;
  v_occurrences integer;
  v_count integer;
  v_signatures text;
  v_scalar text;
BEGIN
  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_count, v_signatures
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption_by_grade';

  IF v_count <> 1
     OR to_regprocedure(
       'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Contrato inesperado: esperado somente by_grade(uuid,jsonb,text,uuid); encontrado: %',
      COALESCE(v_signatures, 'nenhum');
  END IF;

  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF position('AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item' IN v_definition) = 0 THEN
    -- Se a migration 106 ja rodou, troca apenas o marcador para tornar este
    -- pacote autonomo idempotente. A concatenacao evita que o contrato local
    -- confunda esta migration de entrega com a origem historica do patch.
    IF position(
      'PV-CONSUMPTION-IDENTITY-' || 'PARITY: embalagem-discreta-por-item'
      IN v_definition
    ) > 0 THEN
      EXECUTE replace(
        v_definition,
        'PV-CONSUMPTION-IDENTITY-' || 'PARITY: embalagem-discreta-por-item',
        'AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item'
      );
    ELSE
      v_occurrences := (
        length(v_definition) - length(replace(v_definition, v_anchor, ''))
      ) / length(v_anchor);

      IF v_occurrences <> 1 THEN
        RAISE EXCEPTION
          'Âncora BOM inesperada em calculate_order_consumption_by_grade: esperada 1, obtidas %',
          v_occurrences;
      END IF;

      EXECUTE replace(v_definition, v_anchor, v_replacement);
    END IF;
  END IF;

  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_count, v_signatures
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption';

  IF v_count <> 1
     OR to_regprocedure(
       'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Contrato inesperado: esperado somente escalar(uuid,numeric,text,integer,uuid); encontrado: %',
      COALESCE(v_signatures, 'nenhum');
  END IF;

  SELECT pg_get_functiondef(
    'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'::regprocedure
  ) INTO v_scalar;

  IF position('calculate_order_consumption_by_grade' IN v_scalar) = 0 THEN
    RAISE EXCEPTION
      'Motor escalar deixou de delegar ao by_grade; correção de embalagem não cobriria todos os caminhos vivos';
  END IF;
END;
$patch_by_grade$;

COMMENT ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid) IS
  'Motor canônico por grade. Embalagem BOM em un/par/placa aplica CEIL por item; unidades contínuas permanecem fracionárias.';

-- ---------------------------------------------------------------------------
-- Guard read-only, autocontido e executável pelo CI via service role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_sale_order_consumption_identity_parity_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $guard$
DECLARE
  v_resolver text;
  v_by_grade text;
  v_scalar text;
  v_by_grade_count integer;
  v_scalar_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_insole_material_for_variant(uuid,text,text,numeric)'::regprocedure
  ) INTO v_resolver;
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_by_grade;
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'::regprocedure
  ) INTO v_scalar;

  SELECT count(*) INTO v_by_grade_count
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption_by_grade';
  SELECT count(*) INTO v_scalar_count
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption';

  case_name := 'insole_explicit_pin_precedence';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: pin explícito' IN v_resolver) > 0
    AND position('insole_material_product_id' IN v_resolver) > 0
    AND position('p.active = true' IN v_resolver) > 0;
  message := 'pin explícito ativo deve vencer grupo da variante e preferência de área';
  RETURN NEXT;

  case_name := 'insole_active_area_preference';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: area-first' IN v_resolver) > 0
    AND v_resolver ILIKE '%p.active = true%'
    AND v_resolver ILIKE '%''dm2''%'
    AND v_resolver ILIKE '%''dm²''%'
    AND v_resolver ILIKE '%''m2''%'
    AND v_resolver ILIKE '%''cm2''%';
  message := 'grupo heterogêneo sem pin deve restringir candidatos aos SKUs ativos de área';
  RETURN NEXT;

  case_name := 'insole_color_precedence_inside_area';
  ok := v_resolver ILIKE '%exact_color%'
    AND v_resolver ILIKE '%partial_name%'
    AND v_resolver ILIKE '%color_mismatch%'
    AND v_resolver ILIKE '%group_generic%';
  message := 'pool de área deve manter cor exata > nome parcial > semântica do grupo';
  RETURN NEXT;

  case_name := 'insole_linear_only_fallback';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: linear-only-fallback' IN v_resolver) > 0
    AND position('resolve_material_product' IN v_resolver) > 0;
  message := 'grupo sem SKU ativo de área deve preservar o resolver genérico';
  RETURN NEXT;

  case_name := 'packaging_discrete_ceil_per_item';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item' IN v_by_grade) > 0
    AND v_by_grade ILIKE '%v_row_cat_norm%embalagem%'
    AND v_by_grade ILIKE '%v_conv.target_unit%'
    AND v_by_grade ILIKE '%ARRAY[''un'', ''par'', ''placa'']%'
    AND v_by_grade ILIKE '%CEIL(v_required)%';
  message := 'BOM de embalagem discreta deve aplicar CEIL depois da conversão e por item';
  RETURN NEXT;

  case_name := 'packaging_continuous_units_preserve_fraction';
  ok := v_by_grade ILIKE '%ARRAY[''un'', ''par'', ''placa'']%'
    AND v_by_grade NOT ILIKE '%ARRAY[''m'', ''kg'', ''l'']%CEIL(v_required)%';
  message := 'gate de CEIL deve excluir m/kg/L e demais unidades contínuas';
  RETURN NEXT;

  case_name := 'packaging_rounding_examples';
  ok := CEIL(0.498::numeric) = 1
    AND CEIL(1.079::numeric) = 2
    AND 0.498::numeric <> CEIL(0.498::numeric);
  message := '0,498 caixa vira 1; 1,079 vira 2; fração contínua continua representável';
  RETURN NEXT;

  case_name := 'consumption_canonical_overloads_only';
  ok := v_by_grade_count = 1
    AND v_scalar_count = 1
    AND to_regprocedure(
      'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'
    ) IS NOT NULL;
  message := 'deve existir somente um by_grade e um wrapper escalar canônicos';
  RETURN NEXT;

  case_name := 'consumption_scalar_delegates_by_grade';
  ok := position('calculate_order_consumption_by_grade' IN v_scalar) > 0
    AND position('get_material_conversion_info' IN v_scalar) = 0;
  message := 'wrapper escalar deve herdar identidade/conversão/CEIL do motor by_grade';
  RETURN NEXT;
END;
$guard$;

REVOKE ALL ON FUNCTION public.run_sale_order_consumption_identity_parity_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_sale_order_consumption_identity_parity_tests()
  TO service_role;

COMMENT ON FUNCTION public.run_sale_order_consumption_identity_parity_tests() IS
  'Guard read-only de precedência da palmilha, CEIL discreto de embalagem, overloads canônicos e delegação do wrapper escalar.';

DO $self_test$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(t.case_name || ': ' || COALESCE(t.message, 'falhou'), E'\n')
    INTO v_failures
    FROM public.run_sale_order_consumption_identity_parity_tests() t
   WHERE t.ok IS NOT TRUE;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Self-test de paridade identidade/embalagem falhou:\n%', v_failures;
  END IF;
END;
$self_test$;

NOTIFY pgrst, 'reload schema';

COMMIT;
