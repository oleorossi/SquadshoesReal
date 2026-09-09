-- Relatório e fichas de produção como projeções do motor operacional.
--
-- Antes desta migration, a tela Consumo de Materiais e as fichas de operador
-- recalculavam toda a demanda em TypeScript (`computeConsumptionForItems`),
-- enquanto reserva, baixa, custeio, MRP e Compras por Pedido usavam
-- `calculate_order_consumption_by_grade`. Testes de paridade reduziam o risco,
-- mas ainda eram duas implementações do mesmo fato.
--
-- Esta RPC batch deriva PV/OP no servidor e devolve o payload do MESMO motor
-- operacional. Embalagem vem exclusivamente de calculate_packaging_consumption
-- (box_types/slots); tiras vêm exclusivamente da preview canônica por UUID.
-- TypeScript fica responsável apenas por validar/adaptar/agrupar para a tela,
-- consultar disponibilidade atual e exibir a grade recebida como metadado.

BEGIN;

CREATE OR REPLACE FUNCTION public.calculate_consumption_report_batch(
  p_sale_order_ids uuid[] DEFAULT NULL,
  p_order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_sale_order_ids uuid[];
  v_order_ids uuid[];
  v_missing text;
  v_scope record;
  v_line jsonb;
  v_cons jsonb;
  v_effective_grade jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_unit text;
  v_product_category text;
  v_product_color text;
  v_product_group_id uuid;
  v_product_group_name text;
  v_packaging record;
  v_preview record;
  v_main_production_start date;
  v_schedule_revision integer;
  v_preview_count integer;
  v_lines jsonb := '[]'::jsonb;
  v_previews jsonb := '[]'::jsonb;
BEGIN
  IF NOT v_is_service AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT id ORDER BY id), ARRAY[]::uuid[])
    INTO v_sale_order_ids
    FROM pg_catalog.unnest(COALESCE(p_sale_order_ids, ARRAY[]::uuid[])) id
   WHERE id IS NOT NULL;
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT id ORDER BY id), ARRAY[]::uuid[])
    INTO v_order_ids
    FROM pg_catalog.unnest(COALESCE(p_order_ids, ARRAY[]::uuid[])) id
   WHERE id IS NOT NULL;

  IF (pg_catalog.cardinality(v_sale_order_ids) > 0)
     = (pg_catalog.cardinality(v_order_ids) > 0) THEN
    RAISE EXCEPTION 'Informe exatamente um escopo: sale_order_ids OU order_ids'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(v_sale_order_ids) > 200
     OR pg_catalog.cardinality(v_order_ids) > 500 THEN
    RAISE EXCEPTION 'Lote de consumo excede o limite seguro (200 PVs ou 500 OPs)'
      USING ERRCODE = '54000';
  END IF;

  IF pg_catalog.cardinality(v_sale_order_ids) > 0 THEN
    SELECT pg_catalog.string_agg(requested.id::text, ', ' ORDER BY requested.id)
      INTO v_missing
      FROM pg_catalog.unnest(v_sale_order_ids) requested(id)
      LEFT JOIN public.sale_orders sale_order ON sale_order.id = requested.id
     WHERE sale_order.id IS NULL;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PV(s) inexistente(s): %', v_missing
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT pg_catalog.string_agg(requested.id::text, ', ' ORDER BY requested.id)
      INTO v_missing
      FROM pg_catalog.unnest(v_order_ids) requested(id)
      LEFT JOIN public.orders production_order
        ON production_order.id = requested.id
       AND production_order.deleted_at IS NULL
     WHERE production_order.id IS NULL;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'OP(s) inexistente(s) ou excluída(s): %', v_missing
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_scope IN
    SELECT
      sale_item.id AS scope_key,
      'sale_order_item'::text AS scope_type,
      sale_item.sale_order_id,
      sale_item.id AS sale_order_item_id,
      sale_item.reference_id,
      COALESCE(sale_item.color, '') AS color,
      COALESCE(sale_item.quantity, 0)::numeric AS quantity,
      sale_item.grade,
      sale_item.material_variant_id,
      sale_order.packaging_mode,
      sale_item.strap_colors,
      sale_item.strap_sourcing
    FROM public.sale_order_items sale_item
    JOIN public.sale_orders sale_order ON sale_order.id = sale_item.sale_order_id
    WHERE sale_item.sale_order_id = ANY(v_sale_order_ids)

    UNION ALL

    SELECT
      production_order.id AS scope_key,
      'production_order'::text AS scope_type,
      production_order.sale_order_id,
      production_order.sale_order_item_id,
      production_order.reference_id,
      COALESCE(production_order.color, '') AS color,
      COALESCE(production_order.quantity, 0)::numeric AS quantity,
      production_order.grade,
      sale_item.material_variant_id,
      sale_order.packaging_mode,
      sale_item.strap_colors,
      sale_item.strap_sourcing
    FROM public.orders production_order
    LEFT JOIN public.sale_order_items sale_item
      ON sale_item.id = production_order.sale_order_item_id
    LEFT JOIN public.sale_orders sale_order
      ON sale_order.id = production_order.sale_order_id
    WHERE production_order.id = ANY(v_order_ids)
      AND production_order.deleted_at IS NULL

    ORDER BY scope_key
  LOOP
    IF v_scope.reference_id IS NULL THEN
      RAISE EXCEPTION '% % não possui referência técnica',
        v_scope.scope_type, v_scope.scope_key
        USING ERRCODE = '22023';
    END IF;
    IF v_scope.quantity <= 0 OR v_scope.quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION '% % possui quantidade inválida: %',
        v_scope.scope_type, v_scope.scope_key, v_scope.quantity
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.technical_sheets sheet
       WHERE sheet.id = v_scope.reference_id
    ) THEN
      RAISE EXCEPTION 'Ficha técnica % não existe', v_scope.reference_id
        USING ERRCODE = 'P0002';
    END IF;
    IF v_scope.sale_order_item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.sale_order_items linked_item
       WHERE linked_item.id = v_scope.sale_order_item_id
         AND linked_item.sale_order_id IS NOT DISTINCT FROM v_scope.sale_order_id
         AND linked_item.reference_id IS NOT DISTINCT FROM v_scope.reference_id
    ) THEN
      RAISE EXCEPTION 'Vínculo OP/PV/item divergente no escopo %', v_scope.scope_key
        USING ERRCODE = '23514';
    END IF;

    -- A mesma normalização usada por op_expected_consumption_lines: grade
    -- absoluta/base vira a quantidade da OP; sem grade utilizável, o wrapper
    -- escalar (que delega ao by_grade) preserva o fallback operacional.
    v_effective_grade := public.resolve_effective_op_grade(
      v_scope.grade,
      v_scope.quantity
    );
    IF v_effective_grade IS NOT NULL THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_scope.reference_id,
        v_effective_grade,
        v_scope.color,
        v_scope.material_variant_id
      );
    ELSE
      v_cons := public.calculate_order_consumption(
        v_scope.reference_id,
        v_scope.quantity,
        v_scope.color,
        NULL::integer,
        v_scope.material_variant_id
      );
    END IF;
    IF pg_catalog.jsonb_typeof(v_cons) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Motor de consumo devolveu payload não-array no escopo %',
        v_scope.scope_key USING ERRCODE = '22023';
    END IF;

    -- Defesa em profundidade: a 116 já remove a ponte legado no próprio motor,
    -- e este helper impede que snapshots/corpos antigos reintroduzam caixa BOM.
    v_cons := public.strip_legacy_packaging_material_lines(v_cons);
    FOR v_line IN SELECT value FROM pg_catalog.jsonb_array_elements(v_cons)
    LOOP
      IF pg_catalog.jsonb_typeof(v_line) IS DISTINCT FROM 'object'
         OR pg_catalog.jsonb_typeof(v_line -> 'required') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Linha inválida do motor no escopo %: %',
          v_scope.scope_key, v_line USING ERRCODE = '22023';
      END IF;
      IF (v_line ->> 'required')::numeric < 0 THEN
        RAISE EXCEPTION 'Motor devolveu consumo negativo no escopo %',
          v_scope.scope_key USING ERRCODE = '22023';
      END IF;

      v_product_id := public.try_parse_uuid(v_line ->> 'product_id');
      IF v_product_id IS NULL AND (v_line ->> 'required')::numeric > 0 THEN
        RAISE EXCEPTION 'Linha positiva sem product_id no escopo %: %',
          v_scope.scope_key, v_line USING ERRCODE = '23502';
      END IF;
      v_product_unit := NULL;
      v_product_name := NULL;
      v_product_category := NULL;
      v_product_color := NULL;
      v_product_group_id := NULL;
      v_product_group_name := NULL;
      IF v_product_id IS NOT NULL THEN
        SELECT
          product.name,
          product.unit,
          product.category,
          product.color,
          product.group_id,
          product_group.name AS group_name
          INTO v_product_name,
               v_product_unit,
               v_product_category,
               v_product_color,
               v_product_group_id,
               v_product_group_name
          FROM public.products product
          LEFT JOIN public.product_groups product_group
            ON product_group.id = product.group_id
         WHERE product.id = v_product_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Produto % retornado pelo motor não existe', v_product_id
            USING ERRCODE = 'P0002';
        END IF;
      END IF;

      v_lines := v_lines || pg_catalog.jsonb_build_array(
        v_line || pg_catalog.jsonb_build_object(
          'scope_key', v_scope.scope_key,
          'scope_type', v_scope.scope_type,
          'sale_order_id', v_scope.sale_order_id,
          'sale_order_item_id', v_scope.sale_order_item_id,
          'reference_id', v_scope.reference_id,
          'quantity', v_scope.quantity,
          'effective_grade', v_effective_grade,
          'line_kind', 'material',
          'component', COALESCE(NULLIF(v_line ->> 'component', ''), 'Material'),
          'product_id', v_product_id,
          'product_name', COALESCE(NULLIF(v_line ->> 'product_name', ''), v_product_name, 'Material não resolvido'),
          'product_unit', COALESCE(v_line ->> 'unit', v_product_unit, 'un'),
          'product_category', COALESCE(v_line ->> 'category', v_product_category),
          'product_color', v_product_color,
          'product_group_id', v_product_group_id,
          'product_group_name', v_product_group_name
        )
      );
    END LOOP;

    -- Caixa/fitilho não são products e não passam por material_reservations.
    -- A identidade e a quantidade vêm do mesmo helper usado por baixa/custeio.
    FOR v_packaging IN
      SELECT *
        FROM public.calculate_packaging_consumption(
          v_scope.reference_id,
          v_scope.quantity,
          v_scope.packaging_mode,
          v_effective_grade
        )
    LOOP
      IF COALESCE(v_packaging.required, 0) < 0
         OR (COALESCE(v_packaging.required, 0) > 0
             AND v_packaging.box_type_id IS NULL) THEN
        RAISE EXCEPTION 'Embalagem inválida no escopo %: tipo %, quantidade %',
          v_scope.scope_key, v_packaging.packaging_type, v_packaging.required
          USING ERRCODE = '23502';
      END IF;
      v_lines := v_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'scope_key', v_scope.scope_key,
          'scope_type', v_scope.scope_type,
          'sale_order_id', v_scope.sale_order_id,
          'sale_order_item_id', v_scope.sale_order_item_id,
          'reference_id', v_scope.reference_id,
          'quantity', v_scope.quantity,
          'effective_grade', v_effective_grade,
          'line_kind', 'packaging',
          'component', 'Embalagem',
          'box_type_id', v_packaging.box_type_id,
          'packaging_type', COALESCE(NULLIF(v_packaging.packaging_type, ''), 'unresolved'),
          'product_name', COALESCE(NULLIF(v_packaging.box_name, ''), 'Embalagem não resolvida'),
          'product_unit', COALESCE(NULLIF(v_packaging.unit, ''), 'un'),
          'required', COALESCE(v_packaging.required, 0),
          'available', COALESCE(v_packaging.available, 0),
          'stock_ok', COALESCE(v_packaging.stock_ok, false),
          'unit_price', COALESCE(v_packaging.unit_price, 0),
          'supplier_id', v_packaging.supplier_id,
          'warning', v_packaging.warning,
          'source', 'packaging_slots',
          'debit_mode', 'hard'
        )
      );
    END LOOP;

    -- A preview usa o contexto do item, mas quantidade/grade do ESCOPO. Assim
    -- uma OP/lote parcial não recebe a metragem integral do item do PV.
    v_preview_count := 0;
    IF v_scope.sale_order_id IS NOT NULL
       AND v_scope.sale_order_item_id IS NOT NULL THEN
      SELECT start.main_production_start, start.schedule_revision
        INTO v_main_production_start, v_schedule_revision
        FROM public.resolve_sale_order_main_production_start(
          v_scope.sale_order_id,
          v_scope.sale_order_item_id
        ) start
       LIMIT 1;

      FOR v_preview IN
        SELECT preview.*
          FROM public.preview_sale_order_strap_demand_draft(
            pg_catalog.jsonb_build_object(
              'sale_order_id', v_scope.sale_order_id,
              'sale_order_item_id', v_scope.sale_order_item_id,
              'reference_id', v_scope.reference_id,
              'material_variant_id', v_scope.material_variant_id,
              'color', v_scope.color,
              'quantity', v_scope.quantity,
              'grade', v_scope.grade,
              'strap_colors', v_scope.strap_colors,
              'strap_sourcing', v_scope.strap_sourcing,
              'main_production_start', v_main_production_start,
              'schedule_revision', v_schedule_revision
            )
          ) preview
         ORDER BY preview.line_ordinal
      LOOP
        v_preview_count := v_preview_count + 1;
        v_previews := v_previews || pg_catalog.jsonb_build_array(
          pg_catalog.to_jsonb(v_preview) || pg_catalog.jsonb_build_object(
            'scope_key', v_scope.scope_key,
            'scope_type', v_scope.scope_type,
            'sale_order_id', v_scope.sale_order_id,
            'sale_order_item_id', v_scope.sale_order_item_id
          )
        );
      END LOOP;
    END IF;

    IF v_preview_count = 0 AND EXISTS (
      SELECT 1 FROM public.technical_sheets sheet
       WHERE sheet.id = v_scope.reference_id
         AND sheet.has_straps = true
    ) THEN
      -- Não deixa uma tira desaparecer só porque a OP não possui vínculo com o
      -- item do PV ou a preview não conseguiu materializar a linha.
      v_lines := v_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'scope_key', v_scope.scope_key,
          'scope_type', v_scope.scope_type,
          'sale_order_id', v_scope.sale_order_id,
          'sale_order_item_id', v_scope.sale_order_item_id,
          'reference_id', v_scope.reference_id,
          'quantity', v_scope.quantity,
          'effective_grade', v_effective_grade,
          'line_kind', 'material',
          'component', 'Tiras',
          'product_id', NULL,
          'product_name', 'Demanda de tira não resolvida',
          'product_unit', 'm',
          'color', '—',
          'required', 0,
          'available', 0,
          'stock_ok', false,
          'source', 'unresolved',
          'debit_mode', 'soft',
          'consumption_warning',
            'A tira permanece bloqueada: a preview canônica não devolveu uma linha para este escopo.'
        )
      );
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'version', 1,
    'engine', 'calculate_order_consumption_by_grade',
    'lines', v_lines,
    'strap_previews', v_previews
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_consumption_report_batch(uuid[],uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_consumption_report_batch(uuid[],uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.calculate_consumption_report_batch(uuid[],uuid[]) IS
  'Projeção batch read-only do motor operacional para relatório e fichas: materiais via calculate_order_consumption*, embalagem via box_types e tiras via preview canônica. TypeScript não recalcula consumo.';

CREATE OR REPLACE FUNCTION public.run_canonical_consumption_report_contract_tests()
RETURNS TABLE(case_name text, ok boolean, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  );

  RETURN QUERY SELECT
    'CR1 mesmo motor de reserva/baixa'::text,
    pg_catalog.strpos(v_definition, 'calculate_order_consumption_by_grade') > 0
      AND pg_catalog.strpos(v_definition, 'resolve_effective_op_grade') > 0
      AND pg_catalog.strpos(v_definition, 'calculate_order_consumption(') > 0,
    'grade usa by_grade; ausência de grade usa o wrapper que delega ao mesmo motor'::text;

  RETURN QUERY SELECT
    'CR2 embalagem canônica fora de products'::text,
    pg_catalog.strpos(v_definition, 'calculate_packaging_consumption') > 0
      AND pg_catalog.strpos(v_definition, 'strip_legacy_packaging_material_lines') > 0
      AND pg_catalog.strpos(v_definition, '''box_type_id''') > 0,
    'caixa BOM é removida e box_types/slots são a única fonte do relatório'::text;

  RETURN QUERY SELECT
    'CR3 tira usa preview canônica por escopo'::text,
    pg_catalog.strpos(v_definition, 'preview_sale_order_strap_demand_draft') > 0
      AND pg_catalog.strpos(v_definition, '''technical_strap_line_id''') = 0
      AND pg_catalog.strpos(v_definition, '''scope_key''') > 0,
    'RPC não reconstrói receita/variante: apenas transporta a preview resolvida'::text;

  RETURN QUERY SELECT
    'CR4 leitura autenticada e fail-closed'::text,
    pg_catalog.strpos(v_definition, 'is_approved_user') > 0
      AND pg_catalog.strpos(v_definition, 'Linha positiva sem product_id') > 0
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure,
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated',
        'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure,
        'EXECUTE'
      ),
    'anon não lê estoque/consumo; payload positivo sem identidade aborta'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_canonical_consumption_report_contract_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_canonical_consumption_report_contract_tests()
  TO service_role;

DO $self_test$
DECLARE
  v_failed text;
  v_rejected_empty boolean := false;
  v_rejected_missing boolean := false;
BEGIN
  SELECT pg_catalog.string_agg(test.case_name || ': ' || test.detail, '; ')
    INTO v_failed
    FROM public.run_canonical_consumption_report_contract_tests() test
   WHERE NOT test.ok;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato do relatório canônico falhou: %', v_failed;
  END IF;

  BEGIN
    PERFORM public.calculate_consumption_report_batch(NULL, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected_empty := true;
  END;
  IF NOT v_rejected_empty THEN
    RAISE EXCEPTION 'RPC aceitou chamada sem escopo';
  END IF;

  BEGIN
    PERFORM public.calculate_consumption_report_batch(
      ARRAY[pg_catalog.gen_random_uuid()], NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_rejected_missing := true;
  END;
  IF NOT v_rejected_missing THEN
    RAISE EXCEPTION 'RPC aceitou PV inexistente';
  END IF;
END;
$self_test$;

COMMIT;
