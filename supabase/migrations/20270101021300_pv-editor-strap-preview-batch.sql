-- Editor PV: acelera preview de tiras (agenda hoisted + batch).
-- Causa residual do statement_timeout apos 20270101020200: cada item
-- chamava preview_sale_order_strap_demand_draft e o pre_05500 resolvia
-- resolve_sale_order_main_production_start DENTRO do loop por linha.

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft_pre_05500(p_item jsonb)
 RETURNS TABLE(line_ordinal integer, technical_strap_line_id uuid, strap_variant_id uuid, source_mode text, gross_required_m numeric, recipe_id uuid, base_product_id uuid, finished_product_id uuid, blocking_reasons jsonb, resolved jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line jsonb;
  v_sheet_line jsonb;
  v_sheet_line_count integer;
  v_sourcing jsonb := coalesce(p_item -> 'strap_sourcing', '{}'::jsonb);
  v_selection jsonb;
  v_sale_order_id uuid;
  v_sale_order_item_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_measure_id uuid;
  v_material_context jsonb;
  v_base_group_id uuid;
  v_identity_group_id uuid;
  v_identity_basis text;
  v_item_identity_basis text;
  v_item_identity_group_id uuid;
  v_color_id uuid;
  v_selected_variant_id uuid;
  v_catalog jsonb;
  v_reasons jsonb;
  v_line_id uuid;
  v_source text;
  v_gross numeric;
  v_main_start date;
  v_schedule_revision integer := 0;
  v_schedule_source text;
  v_billing_week text;
  v_year integer;
  v_month integer;
  v_week integer;
  v_first date;
  v_can_financial boolean := public.can_see_strap_financial_values();
  v_idx integer := 0;
  -- Agenda resolvida UMA vez no item (hoist 20270101021300). Por linha
  -- ainda pode sobrescrever via strap_sourcing; o resolver server-side
  -- NUNCA roda dentro do loop.
  v_item_main_start date;
  v_item_schedule_revision integer := 0;
  v_item_schedule_source text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'p_item deve ser objeto JSON';
  END IF;
  IF jsonb_typeof(coalesce(p_item -> 'strap_colors', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array';
  END IF;

  BEGIN v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_reference_id := NULL; END;
  BEGIN v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_material_variant_id := NULL; END;
  BEGIN v_sale_order_id := nullif(p_item ->> 'sale_order_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_sale_order_id := NULL; END;
  BEGIN v_sale_order_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_sale_order_item_id := NULL; END;

  -- Agenda do item (fora do loop). Prefere datas do payload; so cai no
  -- resolver server-side quando nenhuma data veio no JSON.
  v_item_main_start := NULL;
  v_item_schedule_source := NULL;
  v_item_schedule_revision := 0;
  BEGIN
    v_item_main_start := nullif(p_item ->> 'main_production_start', '')::date;
  EXCEPTION WHEN OTHERS THEN v_item_main_start := NULL; END;
  BEGIN
    v_item_schedule_revision := coalesce(
      nullif(p_item ->> 'schedule_revision', '')::integer, 0);
  EXCEPTION WHEN OTHERS THEN v_item_schedule_revision := 0; END;
  IF v_item_main_start IS NULL THEN
    BEGIN
      v_item_main_start := nullif(coalesce(
        p_item ->> 'billing_anchor', p_item ->> 'required_at'
      ), '')::date;
      IF v_item_main_start IS NOT NULL THEN
        v_item_schedule_source := 'draft_billing_anchor';
      END IF;
    EXCEPTION WHEN OTHERS THEN v_item_main_start := NULL; END;
  END IF;
  IF v_item_main_start IS NULL THEN
    v_billing_week := nullif(p_item ->> 'billing_week', '');
    BEGIN
      IF v_billing_week ~ '^\d{4}-W\d{1,2}$' THEN
        v_item_main_start := date_trunc(
          'week', public.parse_iso_billing_week(v_billing_week))::date;
      ELSIF v_billing_week ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
        v_year := split_part(v_billing_week, '-', 1)::integer;
        v_month := split_part(v_billing_week, '-', 2)::integer;
        v_week := substring(split_part(v_billing_week, '-', 3) FROM 2)::integer;
        v_first := make_date(v_year, v_month, 1);
        v_item_main_start := greatest(
          v_first,
          v_first - (extract(isodow FROM v_first)::integer - 1) + ((v_week - 1) * 7)
        );
      ELSIF v_billing_week ~ '^\d{4}-\d{2}-\d{2}$' THEN
        v_item_main_start := date_trunc('week', v_billing_week::date)::date;
      END IF;
      IF v_item_main_start IS NOT NULL THEN
        v_item_schedule_source := 'draft_billing_week_first_day';
      END IF;
    EXCEPTION WHEN OTHERS THEN v_item_main_start := NULL; END;
  END IF;
  IF v_item_main_start IS NULL AND v_sale_order_id IS NOT NULL THEN
    SELECT s.main_production_start, s.schedule_revision, s.resolution_source
      INTO v_item_main_start, v_item_schedule_revision, v_item_schedule_source
      FROM public.resolve_sale_order_main_production_start(
        v_sale_order_id, v_sale_order_item_id
      ) s;
  END IF;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(coalesce(p_item -> 'strap_colors', '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_reasons := '[]'::jsonb;
    v_catalog := '{}'::jsonb;
    v_sheet_line := NULL;
    v_sheet_line_count := 0;
    v_line_id := NULL;
    v_measure_id := NULL;
    v_base_group_id := NULL;
    v_material_context := '{}'::jsonb;
    v_identity_group_id := NULL;
    v_identity_basis := 'reference_base';
    v_item_identity_basis := NULL;
    v_item_identity_group_id := NULL;
    v_color_id := NULL;
    v_selected_variant_id := NULL;
    strap_variant_id := NULL;
    recipe_id := NULL;
    base_product_id := NULL;
    finished_product_id := NULL;

    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'technical_line_missing', 'field', 'technical_strap_line_id',
        'message', 'Linha de tira sem UUID tecnico estavel; corrija a ficha tecnica.'));
    END IF;

    IF v_reference_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_reference_id
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'reference_unresolved', 'field', 'reference_id',
        'message', 'Referencia sem UUID persistido ou inexistente.'));
    ELSIF v_line_id IS NOT NULL THEN
      SELECT count(*), (jsonb_agg(e.value ORDER BY e.ordinality) -> 0)
        INTO v_sheet_line_count, v_sheet_line
        FROM public.technical_sheets ts
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
            THEN ts.strap_colors ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS e(value, ordinality)
       WHERE ts.id = v_reference_id
         AND e.value ->> 'technical_strap_line_id' = v_line_id::text;
      IF v_sheet_line_count <> 1 THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'technical_line_identity_invalid', 'field', 'technical_strap_line_id',
          'message', 'UUID da linha deve existir uma unica vez na ficha tecnica vigente.'));
      END IF;
    END IF;

    v_identity_basis := coalesce(
      nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    IF v_identity_basis NOT IN ('reference_base', 'finished_product_group') THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'identity_basis_invalid', 'field', 'identity_basis',
        'message', 'Linha tecnica possui base de identidade invalida.'));
    END IF;
    IF v_identity_basis = 'finished_product_group' THEN
      BEGIN
        v_identity_group_id := nullif(v_sheet_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_identity_group_id := NULL; END;
      IF v_identity_group_id IS NULL THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'identity_group_missing', 'field', 'identity_group_id',
          'message', 'Tira comprada pronta exige grupo proprio do componente acabado.'));
      END IF;
    END IF;

    -- Campos presentes no item sao snapshot, nunca autoridade. Ausencia legada
    -- e aceita; divergencia explicita e bloqueada para nao trocar a identidade.
    v_item_identity_basis := nullif(v_line ->> 'identity_basis', '');
    IF v_item_identity_basis IS NOT NULL
       AND v_item_identity_basis IS DISTINCT FROM v_identity_basis THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'technical_identity_snapshot_stale', 'field', 'identity_basis',
        'message', 'Identidade congelada no item diverge da linha tecnica vigente.'));
    END IF;
    IF v_line ? 'identity_group_id' THEN
      BEGIN v_item_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_item_identity_group_id := NULL; END;
      IF v_item_identity_group_id IS DISTINCT FROM v_identity_group_id THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'technical_identity_snapshot_stale', 'field', 'identity_group_id',
          'message', 'Grupo congelado no item diverge da linha tecnica vigente.'));
      END IF;
    END IF;

    BEGIN
      v_measure_id := nullif(coalesce(
        v_sheet_line ->> 'measure_id', v_line ->> 'measure_id'
      ), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_measure_id := NULL; END;
    IF v_measure_id IS NULL AND v_line_id IS NOT NULL THEN
      SELECT m.measure_id INTO v_measure_id
        FROM public.technical_strap_line_identity_map m
       WHERE m.technical_strap_line_id = v_line_id AND m.status = 'resolved';
    END IF;
    IF v_measure_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'measure_missing', 'field', 'measure_id',
        'message', 'Linha tecnica sem medida canonica resolvida.'));
    END IF;

    IF v_line_id IS NOT NULL THEN
      v_selection := v_sourcing -> v_line_id::text;
    ELSE
      v_selection := NULL;
    END IF;
    BEGIN v_selected_variant_id := nullif(v_selection ->> 'strap_variant_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_selected_variant_id := NULL; END;
    v_source := v_selection ->> 'source_mode';
    IF v_identity_basis = 'finished_product_group' THEN
      IF v_source = 'internal' THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'internal_production_disabled', 'field', 'source_mode',
          'message', 'Esta tira e comprada pronta e nao pode ser produzida internamente.'));
      ELSIF v_source IS NOT NULL AND v_source <> 'buy_ready' THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'source_mode_invalid', 'field', 'source_mode',
          'message', 'Tira comprada pronta aceita somente Comprar pronta.'));
      END IF;
      -- A origem e propriedade do catalogo, nao uma escolha livre do item.
      v_source := 'buy_ready';
    ELSIF v_source NOT IN ('internal', 'buy_ready') THEN
      v_source := NULL;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'source_mode_required', 'field', 'source_mode',
        'message', 'Escolha Produzir com napa propria ou Comprar tira pronta.'));
    END IF;

    -- Agenda: override por linha (strap_sourcing) ou valor hoisted do item.
    -- Nunca chama o resolver de agenda server-side aqui (ja foi hoisted).
    v_main_start := v_item_main_start;
    v_schedule_revision := v_item_schedule_revision;
    v_schedule_source := v_item_schedule_source;
    BEGIN
      IF nullif(v_selection ->> 'main_production_start', '') IS NOT NULL THEN
        v_main_start := nullif(v_selection ->> 'main_production_start', '')::date;
        v_schedule_source := coalesce(v_schedule_source, 'line_strap_sourcing');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      IF nullif(v_selection ->> 'schedule_revision', '') IS NOT NULL THEN
        v_schedule_revision := nullif(v_selection ->> 'schedule_revision', '')::integer;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    IF v_main_start IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'main_production_start_missing', 'field', 'main_production_start',
        'message', 'Cronograma global ainda nao definiu o inicio produtivo deste item.'));
    END IF;

    IF v_material_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.reference_material_variants rmv
       WHERE rmv.id = v_material_variant_id
         AND rmv.reference_id = v_reference_id
         AND coalesce(rmv.active, true)
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'material_variant_mismatch', 'field', 'material_variant_id',
        'message', 'Variante de material nao pertence a referencia ou esta inativa.'));
    END IF;
    BEGIN
      v_material_context := private.resolve_technical_strap_material(
        v_reference_id, v_material_variant_id, v_line_id,
        nullif(v_line ->> 'base_group_id', '')::uuid, false
      );
      v_base_group_id := (v_material_context ->> 'base_group_id')::uuid;
      IF v_material_context ->> 'material_mode' = 'select_on_order'
         AND v_base_group_id IS NULL THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'material_selection_required', 'field', 'base_group_id',
          'message', 'Selecione o material desta posicao no Pedido de Venda.'));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_base_group_id := NULL;
      v_material_context := '{}'::jsonb;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'material_selection_invalid', 'field', 'base_group_id',
        'message', SQLERRM));
    END;
    IF v_base_group_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'base_group_unresolved', 'field', CASE
          WHEN v_identity_basis = 'finished_product_group'
            THEN 'identity_group_id' ELSE 'material_variant_id' END,
        'message', 'A identidade da tira nao possui grupo canonico resolvido por UUID.'));
    END IF;

    BEGIN v_color_id := nullif(v_line ->> 'color_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    IF v_color_id IS NULL THEN
      BEGIN v_color_id := nullif(v_selection ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    END IF;
    IF v_color_id IS NULL AND v_selected_variant_id IS NOT NULL THEN
      SELECT v.color_id INTO v_color_id
        FROM public.artisanal_strap_variants v
       WHERE v.id = v_selected_variant_id;
    END IF;
    IF v_color_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.canonical_colors c WHERE c.id = v_color_id
    ) THEN
      v_color_id := NULL;
    END IF;
    IF v_color_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'color_id_missing', 'field', 'color_id',
        'message', 'Cor sem UUID canonico persistido; texto/alias nao identifica estoque.'));
    END IF;

    v_gross := public.calculate_strap_line_required_m(
      v_line,
      coalesce(nullif(p_item ->> 'quantity', '')::numeric, 0),
      coalesce(p_item -> 'grade', '{}'::jsonb)
    );
    IF (
      jsonb_typeof(coalesce(p_item -> 'grade', '{}'::jsonb)) = 'object'
      AND EXISTS (
        SELECT 1
          FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
           AND public.pick_consumption_for_size(
             v_line -> 'consumption_per_size',
             g.key
           ) IS NULL
           AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0
      )
    ) OR (
      NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
      )
      AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'consumption_missing', 'field', 'consumption_per_size',
        'message', 'Consumo da tira ausente ou zero para uma numeracao demandada.'));
    END IF;
    IF v_gross <= 0 THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'gross_required_invalid', 'field', 'quantity',
        'message', 'Consumo bruto calculado deve ser maior que zero.'));
    END IF;

    IF v_measure_id IS NOT NULL AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN
      BEGIN
        v_catalog := public.resolve_artisanal_strap_catalog(
          v_measure_id, v_base_group_id, v_color_id, v_source, v_identity_basis
        );
        strap_variant_id := (v_catalog ->> 'variant_id')::uuid;
        recipe_id := nullif(v_catalog ->> 'recipe_id', '')::uuid;
        base_product_id := nullif(v_catalog ->> 'base_product_id', '')::uuid;
        finished_product_id := (v_catalog ->> 'finished_product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'catalog_resolution_blocked', 'field', 'strap_variant_id',
          'message', SQLERRM));
      END;
    END IF;

    IF v_identity_basis = 'reference_base'
       AND v_source IS NOT NULL AND v_selected_variant_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'variant_identity_not_persisted', 'field', 'strap_variant_id',
        'message', 'A escolha de origem deve persistir o UUID exato da variante resolvida.'));
    ELSIF v_selected_variant_id IS NOT NULL
       AND v_selected_variant_id IS DISTINCT FROM strap_variant_id THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'variant_snapshot_stale', 'field', 'strap_variant_id',
        'message', 'Variante escolhida nao corresponde mais a identidade tecnica atual.'));
    END IF;

    line_ordinal := v_idx;
    technical_strap_line_id := v_line_id;
    source_mode := v_source;
    gross_required_m := v_gross;
    blocking_reasons := v_reasons;
    resolved := jsonb_build_object(
      'base_group_id', v_base_group_id,
      'base_group_name', v_material_context -> 'base_group_name',
      'material_mode', v_material_context -> 'material_mode',
      'material_group_id', v_material_context -> 'material_group_id',
      'allowed_material_group_ids', v_material_context -> 'allowed_material_group_ids',
      'identity_basis', v_identity_basis,
      'identity_group_id', CASE WHEN v_identity_basis = 'finished_product_group'
        THEN v_identity_group_id ELSE NULL END,
      'internal_production_enabled', CASE
        WHEN v_identity_basis = 'finished_product_group' THEN false
        ELSE coalesce((v_catalog ->> 'internal_production_enabled')::boolean, true)
      END,
      'color_id', v_color_id,
      'strap_product_name', (
        SELECT p.name FROM public.products p WHERE p.id = finished_product_id),
      'strap_color_name', (
        SELECT c.name FROM public.canonical_colors c WHERE c.id = v_color_id),
      'base_product_name', (
        SELECT p.name FROM public.products p WHERE p.id = base_product_id),
      'measure_name', (
        SELECT m.display_name FROM public.artisanal_strap_measures m WHERE m.id = v_measure_id),
      'cut_band_width_mm', (
        SELECT r.cut_band_width_mm FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'usable_base_width_mm_snapshot', (
        SELECT r.usable_base_width_mm_snapshot
          FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'theoretical_yield_m_per_m', (
        SELECT r.theoretical_yield_m_per_m
          FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'confirmed_yield_m_per_m', v_catalog -> 'confirmed_yield_m_per_m',
      'base_required_m', CASE WHEN v_source = 'internal'
        THEN v_gross / nullif((v_catalog ->> 'confirmed_yield_m_per_m')::numeric, 0)
        ELSE 0 END,
      'purchase_price', CASE WHEN v_can_financial
        THEN v_catalog -> 'purchase_price' ELSE 'null'::jsonb END,
      'purchase_conversion_rate', CASE WHEN v_can_financial THEN
        to_jsonb((SELECT p.conversion_rate FROM public.products p WHERE p.id = finished_product_id))
        ELSE 'null'::jsonb END,
      'purchase_unit_cost_stock', CASE WHEN v_can_financial THEN to_jsonb((
        SELECT p.purchase_price / nullif(p.conversion_rate, 0)
          FROM public.products p WHERE p.id = finished_product_id
      )) ELSE 'null'::jsonb END,
      'internal_unit_cost', CASE WHEN v_can_financial
        THEN v_catalog -> 'internal_unit_cost' ELSE 'null'::jsonb END,
      'can_internal', coalesce((v_catalog ->> 'internal_available')::boolean, false),
      'can_buy_ready', coalesce((v_catalog ->> 'buy_ready_available')::boolean, false),
      'source_mode', v_source,
      'required_at', coalesce(v_selection ->> 'required_at', p_item ->> 'required_at'),
      'main_production_start', v_main_start,
      'schedule_revision', v_schedule_revision,
      'schedule_source', coalesce(v_schedule_source, 'draft_supplied'),
      'catalog', v_catalog
    );
    RETURN NEXT;
  END LOOP;
END;
$function$;


-- Batch do preview de demanda de tiras p/ o editor do PV.
-- Um round-trip no open (itens com tiras) no lugar de N× preview unitário.

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft_batch(
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry jsonb;
  v_key text;
  v_payload jsonb;
  v_lines jsonb;
  v_result jsonb := '{}'::jsonb;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN v_result;
  END IF;

  FOR v_entry IN
    SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object' THEN
      CONTINUE;
    END IF;

    v_key := nullif(btrim(coalesce(v_entry ->> 'item_key', '')), '');
    IF v_key IS NULL THEN
      v_key := nullif(btrim(coalesce(v_entry ->> 'sale_order_item_id', '')), '');
    END IF;
    IF v_key IS NULL THEN
      CONTINUE;
    END IF;
    CONTINUE WHEN v_key = ANY (v_seen);
    v_seen := array_append(v_seen, v_key);

    v_payload := v_entry - 'item_key';

    SELECT coalesce(jsonb_agg(to_jsonb(preview) ORDER BY preview.line_ordinal), '[]'::jsonb)
      INTO v_lines
      FROM public.preview_sale_order_strap_demand_draft(v_payload) preview;

    v_result := v_result || jsonb_build_object(v_key, coalesce(v_lines, '[]'::jsonb));
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_sale_order_strap_demand_draft_batch(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_order_strap_demand_draft_batch(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.preview_sale_order_strap_demand_draft_batch(jsonb) IS
  'Preview de demanda de tiras em lote p/ o editor do PV. '
  'Recebe [{item_key, ...payload do preview unitario}, ...] e devolve '
  'objeto keyed por item_key com array de linhas do preview_sale_order_strap_demand_draft.';
