-- Fase 6 sequencia-producao: porta de material crítico de Corte (R2.1 / D9 / Q#2).
-- Promote recusa (skip) quando falta saldo livre do material principal de corte.
-- Apontamento no 1º setor vira aviso+confirmar (pin fura).
-- NÃO usa BOM inteiro — só cabedal / forração / palmilha do roteiro (Lookahead).
-- technical_sheets NÃO tem lining_material_group_id nem insole_material_*_id:
-- grupo da forração/palmilha na ficha vem do NOME (lining_material / insole_material).

CREATE OR REPLACE FUNCTION public.sale_order_item_corte_material_gate_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_sheet public.technical_sheets%ROWTYPE;
  v_var_upper_pid uuid;
  v_var_upper_gid uuid;
  v_var_lining_pid uuid;
  v_var_lining_gid uuid;
  v_var_insole_pid uuid;
  v_var_insole_gid uuid;
  v_sector text;
  v_aliases text[];
  v_pin_product uuid;
  v_group_id uuid;
  v_group_name text;
  v_req numeric;
  v_other numeric;
  v_free numeric;
  v_color text;
  v_has_sector boolean;
  v_prod_id uuid;
  v_prod_name text;
  v_prod_qty numeric;
  v_prod_unit text;
  v_prod_group uuid;
  v_conv record;
  v_w numeric;
  v_l numeric;
  v_du text;
  v_area numeric;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_item_id;
  IF NOT FOUND OR v_item.reference_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sheet FROM public.technical_sheets WHERE id = v_item.reference_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_item.material_variant_id IS NOT NULL THEN
    SELECT upper_material_product_id, upper_material_group_id,
           lining_material_product_id, lining_material_group_id,
           insole_material_product_id, insole_material_group_id
      INTO v_var_upper_pid, v_var_upper_gid,
           v_var_lining_pid, v_var_lining_gid,
           v_var_insole_pid, v_var_insole_gid
      FROM public.reference_material_variants
     WHERE id = v_item.material_variant_id;
  END IF;

  v_color := lower(trim(COALESCE(v_item.color, '')));

  FOREACH v_sector IN ARRAY ARRAY['cabedal', 'forracao', 'palmilha']
  LOOP
    IF v_sector = 'cabedal' THEN
      v_aliases := ARRAY['corte cabedal'];
      v_pin_product := COALESCE(v_var_upper_pid, v_sheet.upper_material_product_id);
      v_group_id := COALESCE(v_var_upper_gid, v_sheet.upper_material_group_id);
      v_group_name := v_sheet.upper_material;
      v_req := COALESCE(v_sheet.upper_consumption, 0) * GREATEST(COALESCE(v_item.quantity, 0), 0);
    ELSIF v_sector = 'forracao' THEN
      v_aliases := ARRAY[
        'corte forração', 'corte forracao',
        'palmilha · forração', 'palmilha · forracao',
        'palmilha - forração'
      ];
      v_pin_product := COALESCE(v_var_lining_pid, v_sheet.lining_material_product_id);
      v_group_id := v_var_lining_gid;
      v_group_name := v_sheet.lining_material;
      v_req := COALESCE(v_sheet.lining_consumption, 0) * GREATEST(COALESCE(v_item.quantity, 0), 0);
    ELSE
      v_aliases := ARRAY['corte palmilha'];
      v_pin_product := v_var_insole_pid;
      v_group_id := v_var_insole_gid;
      v_group_name := v_sheet.insole_material;
      v_req := COALESCE(v_sheet.insole_consumption, 0) * GREATEST(COALESCE(v_item.quantity, 0), 0);
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(COALESCE(v_sheet.production_sectors, '[]'::jsonb)) = 'array'
                    THEN v_sheet.production_sectors ELSE '[]'::jsonb END
             ) s
       WHERE lower(trim(s)) = ANY (
         SELECT lower(trim(a)) FROM unnest(v_aliases) a
       )
    ) INTO v_has_sector;

    IF NOT v_has_sector THEN
      CONTINUE;
    END IF;

    IF v_group_id IS NULL AND nullif(trim(COALESCE(v_group_name, '')), '') IS NOT NULL THEN
      SELECT pg.id INTO v_group_id
        FROM public.product_groups pg
       WHERE lower(trim(pg.name)) = lower(trim(v_group_name))
       LIMIT 1;
    END IF;

    IF v_pin_product IS NULL AND v_group_id IS NULL THEN
      RETURN format('cadastro incompleto: material de corte (%s)', v_sector);
    END IF;

    v_prod_id := NULL;
    v_prod_name := NULL;
    v_prod_qty := 0;
    v_prod_unit := NULL;
    v_prod_group := NULL;

    IF v_pin_product IS NOT NULL THEN
      SELECT p.id, p.name, COALESCE(p.quantity, 0), p.unit, p.group_id
        INTO v_prod_id, v_prod_name, v_prod_qty, v_prod_unit, v_prod_group
        FROM public.products p
       WHERE p.id = v_pin_product
         AND COALESCE(p.active, true)
       LIMIT 1;
    END IF;

    IF v_prod_id IS NULL AND v_group_id IS NOT NULL AND v_color <> '' THEN
      SELECT p.id, p.name, COALESCE(p.quantity, 0), p.unit, p.group_id
        INTO v_prod_id, v_prod_name, v_prod_qty, v_prod_unit, v_prod_group
        FROM public.products p
       WHERE COALESCE(p.active, true)
         AND p.group_id = v_group_id
         AND lower(trim(COALESCE(p.color, ''))) = v_color
       LIMIT 1;
    END IF;

    IF v_prod_id IS NULL THEN
      RETURN format(
        'cadastro incompleto: material de corte (%s / cor %s)',
        v_sector, COALESCE(NULLIF(v_item.color, ''), '—')
      );
    END IF;

    IF v_req <= 0 THEN
      v_req := 0.01;
    ELSE
      SELECT * INTO v_conv FROM public.get_material_conversion_info(v_prod_id);
      IF v_conv.conversion_warning IS NOT NULL THEN
        RETURN format('cadastro incompleto: largura da bobina (%s)', v_sector);
      END IF;
      IF COALESCE(v_conv.dm2_per_unit, 0) > 0 AND v_conv.dm2_per_unit <> 1 THEN
        v_req := v_req / v_conv.dm2_per_unit;
      ELSIF lower(trim(COALESCE(v_prod_unit, v_conv.target_unit, ''))) IN ('placa', 'placas', 'chapa') THEN
        SELECT COALESCE(NULLIF(cs.dimensions_width, 0), 0),
               COALESCE(NULLIF(cs.dimensions_length, 0), 0),
               COALESCE(cs.dimensions_unit, 'mm')
          INTO v_w, v_l, v_du
          FROM public.component_sheets cs
         WHERE cs.product_id = v_prod_id
            OR (v_prod_group IS NOT NULL AND cs.group_id = v_prod_group
                AND COALESCE(NULLIF(cs.dimensions_width, 0), 0) > 0
                AND COALESCE(NULLIF(cs.dimensions_length, 0), 0) > 0)
         ORDER BY (cs.product_id = v_prod_id) DESC NULLS LAST, cs.updated_at DESC NULLS LAST
         LIMIT 1;
        v_du := lower(trim(COALESCE(v_du, 'mm')));
        IF v_du = 'cm' THEN
          v_w := v_w * 10; v_l := v_l * 10;
        ELSIF v_du = 'dm' THEN
          v_w := v_w * 100; v_l := v_l * 100;
        ELSIF v_du IN ('m', 'metro', 'mt') THEN
          v_w := v_w * 1000; v_l := v_l * 1000;
        END IF;
        v_area := (COALESCE(v_w, 0) * COALESCE(v_l, 0)) / 10000.0;
        IF COALESCE(v_area, 0) > 0 THEN
          v_req := v_req / v_area;
        END IF;
      END IF;
    END IF;

    SELECT COALESCE(SUM(GREATEST(0,
             COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0)
           )), 0)
      INTO v_other
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
     WHERE mr.product_id = v_prod_id
       AND mr.status IN ('reserved', 'pending_reconciliation')
       AND o.sale_order_id IS DISTINCT FROM v_item.sale_order_id;

    v_free := GREATEST(0, COALESCE(v_prod_qty, 0) - v_other);

    IF v_req > v_free + 0.000000001 THEN
      RETURN format(
        'falta %s no corte %s (precisa %s, livre %s)',
        COALESCE(v_prod_name, 'material'),
        v_sector,
        trim(to_char(v_req, 'FM999999990.999')),
        trim(to_char(v_free, 'FM999999990.999'))
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sale_order_item_corte_material_gate_block_reason(uuid) IS
  'Null = críticos de Corte com saldo livre; texto = motivo (D9 / Lookahead). Sem BOM inteiro. Converte dm²→unidade de estoque.';

GRANT EXECUTE ON FUNCTION public.sale_order_item_corte_material_gate_block_reason(uuid) TO authenticated;

-- ── Porta única: Ateliê primeiro, depois críticos de Corte ─────────────────
CREATE OR REPLACE FUNCTION public.sale_order_item_factory_gate_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reference_id uuid;
  v_prep_status text;
  v_corte text;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN 'item ausente';
  END IF;

  SELECT soi.reference_id INTO v_reference_id
    FROM public.sale_order_items soi
   WHERE soi.id = p_item_id;

  IF NOT FOUND THEN
    RETURN 'item nao encontrado';
  END IF;

  IF v_reference_id IS NULL THEN
    RETURN 'item sem referencia';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.atelier_complex_references a
     WHERE a.reference_id = v_reference_id
       AND COALESCE(a.active, true)
  ) THEN
    SELECT j.pipeline_status INTO v_prep_status
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_item_id = p_item_id
       AND COALESCE(j.pipeline_status, '') <> 'cancelled'
     ORDER BY j.updated_at DESC NULLS LAST
     LIMIT 1;

    IF v_prep_status IS DISTINCT FROM 'received_at_factory' THEN
      RETURN format(
        'cabedal complexo — so libera apos recebimento do cabedal (status atual: %s)',
        COALESCE(v_prep_status, 'sem job')
      );
    END IF;
  END IF;

  v_corte := public.sale_order_item_corte_material_gate_block_reason(p_item_id);
  IF v_corte IS NOT NULL THEN
    RETURN v_corte;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sale_order_item_factory_gate_block_reason(uuid) IS
  'Null = elegivel pra promote/liberacao; texto = motivo (Ateliê D11, depois críticos de Corte D9).';

-- ── Apontamento 1º setor: mesma porta (aviso+confirmar); pin fura ───────────
DO $patch_apontar_gate$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.apontar_producao_setor_impl(uuid, text, integer, uuid, text, boolean, text[])'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'apontar_producao_setor_impl nao encontrada';
  END IF;

  IF pg_catalog.strpos(v_def, 'porta_sequencia') > 0 THEN
    RAISE NOTICE 'apontar já tem porta_sequencia — skip';
    RETURN;
  END IF;

  v_old := $old$IF (COALESCE(p_quantity, 0) > 0 OR v_stage.status = 'pendente')
     AND COALESCE(v_settings.check_material_reserved, true) THEN
    SELECT EXISTS (
      SELECT 1 FROM material_reservations
      WHERE order_id = p_order_id AND status IN ('reserved','consumed','converted')
    ) INTO v_has_reservation;
    IF NOT v_has_reservation THEN
      v_raised := array_append(v_raised, 'material_nao_reservado');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'material_nao_reservado',
        'message', 'Esta OP não tem reserva ativa de material no estoque.');
    END IF;
  END IF;$old$;

  v_new := $new$IF (COALESCE(p_quantity, 0) > 0 OR v_stage.status = 'pendente')
     AND COALESCE(v_settings.check_material_reserved, true) THEN
    IF lower(trim(COALESCE(v_stage.stage_name, ''))) IN (
         'corte cabedal',
         'corte forração', 'corte forracao',
         'corte fibra',
         'corte palmilha',
         'palmilha · fibra', 'palmilha · forração', 'palmilha · forracao',
         'palmilha - fibra', 'palmilha - forração'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.production_queue q
          WHERE q.order_id = p_order_id AND q.pinned_position IS NOT NULL
       )
       AND public.sale_order_item_factory_gate_block_reason(
             (SELECT o.sale_order_item_id FROM public.orders o WHERE o.id = p_order_id)
           ) IS NOT NULL THEN
      v_raised := array_append(v_raised, 'porta_sequencia');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'porta_sequencia',
        'message', public.sale_order_item_factory_gate_block_reason(
          (SELECT o.sale_order_item_id FROM public.orders o WHERE o.id = p_order_id)
        ));
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM material_reservations
        WHERE order_id = p_order_id AND status IN ('reserved','consumed','converted')
      ) INTO v_has_reservation;
      IF NOT v_has_reservation THEN
        v_raised := array_append(v_raised, 'material_nao_reservado');
        v_warnings := v_warnings || jsonb_build_object(
          'code', 'material_nao_reservado',
          'message', 'Esta OP não tem reserva ativa de material no estoque.');
      END IF;
    END IF;
  END IF;$new$;

  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Ancora material_nao_reservado em apontar_producao_setor_impl nao encontrada';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_apontar_gate$;
