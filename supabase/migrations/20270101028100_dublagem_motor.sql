-- Motor de demanda de dublagem: cor, dm²/m por face, materialize, soft-reserva
-- interna e OCs source_type=dublagem (externa força compra ignorando saldo).

-- ─── Helpers de cor / resolução de SKU ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dublagem_normalize_color(p_color text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(btrim(extensions.unaccent(COALESCE(p_color, ''))));
$$;

CREATE OR REPLACE FUNCTION public.dublagem_massa_box_color(p_pv_color text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.dublagem_normalize_color(p_pv_color) IN ('PRETO', 'BLACK')
      THEN 'PRETO'
    ELSE 'MARFIM'
  END;
$$;

CREATE OR REPLACE FUNCTION public.dublagem_resolve_product_in_group(
  p_group_id uuid,
  p_color text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_norm text := public.dublagem_normalize_color(p_color);
  v_id uuid;
BEGIN
  IF p_group_id IS NULL OR v_norm = '' THEN
    RETURN NULL;
  END IF;

  SELECT p.id INTO v_id
    FROM public.products p
   WHERE p.group_id = p_group_id
     AND COALESCE(p.active, true)
     AND public.dublagem_normalize_color(p.color) = v_norm
   ORDER BY p.updated_at DESC NULLS LAST, p.id
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Fallback: cor no nome do SKU (legado "… - PRETO").
  SELECT p.id INTO v_id
    FROM public.products p
   WHERE p.group_id = p_group_id
     AND COALESCE(p.active, true)
     AND public.dublagem_normalize_color(p.name) LIKE '%' || v_norm || '%'
   ORDER BY p.updated_at DESC NULLS LAST, p.id
   LIMIT 1;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dublagem_dm2_to_linear_m(
  p_dm2 numeric,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_conv record;
BEGIN
  IF COALESCE(p_dm2, 0) <= 0 OR p_product_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT * INTO v_conv FROM public.get_material_conversion_info(p_product_id);
  IF v_conv.dm2_per_unit IS NOT NULL AND v_conv.dm2_per_unit > 0 THEN
    RETURN round(p_dm2 / v_conv.dm2_per_unit, 6);
  END IF;
  -- Sem largura: devolve dm² cru (UI marca width missing; não inventa divisor).
  RETURN p_dm2;
END;
$$;

-- Área de cabedal do item (dm² total) — reusa motor vivo / snapshot válido.
CREATE OR REPLACE FUNCTION public.dublagem_item_upper_dm2(p_sale_order_item_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_cons jsonb;
  v_line jsonb;
  v_total numeric := 0;
  v_component text;
  v_unit text;
  v_req numeric;
  v_conv record;
BEGIN
  SELECT i.id, i.sale_order_id, i.reference_id, i.color, i.quantity, i.grade,
         i.material_variant_id
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.id = p_sale_order_item_id;
  IF NOT FOUND OR v_item.reference_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = v_item.sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
     AND outdated_at IS NULL
   ORDER BY frozen_at DESC NULLS LAST
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_item.grade IS NOT NULL AND v_item.grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_item.reference_id, v_item.grade, COALESCE(v_item.color, ''),
        v_item.material_variant_id);
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cons
        FROM public.calculate_order_consumption(
          v_item.reference_id, v_item.quantity, COALESCE(v_item.color, ''),
          NULL::integer, v_item.material_variant_id) c;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_cons, '[]'::jsonb))
  LOOP
    v_component := lower(COALESCE(v_line ->> 'component', ''));
    IF v_component IN ('cabedal', 'upper', 'corte cabedal')
       OR v_component LIKE '%cabedal%' THEN
      v_req := COALESCE((v_line ->> 'required')::numeric, 0);
      v_unit := lower(COALESCE(v_line ->> 'unit', ''));
      IF v_unit IN ('m', 'metro', 'metros', 'mt')
         AND NULLIF(v_line ->> 'product_id', '') IS NOT NULL THEN
        SELECT * INTO v_conv
          FROM public.get_material_conversion_info((v_line ->> 'product_id')::uuid);
        IF v_conv.dm2_per_unit IS NOT NULL AND v_conv.dm2_per_unit > 0 THEN
          v_total := v_total + (v_req * v_conv.dm2_per_unit);
        ELSE
          v_total := v_total + v_req;
        END IF;
      ELSE
        v_total := v_total + v_req;
      END IF;
    END IF;
  END LOOP;

  -- Fallback: upper_consumption × pares da ficha.
  IF v_total <= 0 THEN
    SELECT COALESCE(ts.upper_consumption, 0) * COALESCE(v_item.quantity, 0)
      INTO v_total
      FROM public.technical_sheets ts
     WHERE ts.id = v_item.reference_id;
  END IF;

  RETURN COALESCE(v_total, 0);
END;
$$;

-- Acabados compostos a excluir do per_pv quando item tem dublagem_mode.
CREATE OR REPLACE FUNCTION public.dublagem_finished_product_ids(p_sale_order_id uuid)
RETURNS TABLE(product_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH items AS (
    SELECT soi.id, soi.reference_id, soi.color, soi.material_variant_id, soi.dublagem_mode
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.dublagem_mode IS NOT NULL
       AND soi.reference_id IS NOT NULL
  ),
  resolved_group AS (
    SELECT i.id,
           COALESCE(
             rmv.upper_material_group_id,
             ts.upper_material_group_id
           ) AS upper_group_id,
           COALESCE(
             rmv.upper_material_product_id,
             ts.upper_material_product_id
           ) AS upper_product_id,
           i.color
      FROM items i
      JOIN public.technical_sheets ts ON ts.id = i.reference_id
      LEFT JOIN public.reference_material_variants rmv
        ON rmv.id = i.material_variant_id
  )
  SELECT DISTINCT p.id
    FROM resolved_group g
    JOIN public.products p ON p.id = g.upper_product_id
   WHERE g.upper_product_id IS NOT NULL
  UNION
  SELECT DISTINCT p.id
    FROM resolved_group g
    JOIN public.products p
      ON p.group_id = g.upper_group_id
     AND COALESCE(p.active, true)
     AND (
       public.dublagem_normalize_color(p.color) = public.dublagem_normalize_color(g.color)
       OR public.dublagem_normalize_color(p.name)
            LIKE '%' || public.dublagem_normalize_color(g.color) || '%'
     )
   WHERE g.upper_group_id IS NOT NULL
     AND g.upper_product_id IS NULL
     AND NULLIF(btrim(g.color), '') IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.dublagem_normalize_color(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dublagem_massa_box_color(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dublagem_resolve_product_in_group(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dublagem_dm2_to_linear_m(numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dublagem_item_upper_dm2(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dublagem_finished_product_ids(uuid) TO authenticated, service_role;

-- ─── Persistência de dublagem_mode no payload do comando ────────────────────
CREATE OR REPLACE FUNCTION public.sync_sale_order_items_dublagem_mode(
  p_sale_order_id uuid,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_mode text;
  v_updated int := 0;
  v_id uuid;
BEGIN
  IF p_sale_order_id IS NULL OR jsonb_typeof(COALESCE(p_items, 'null'::jsonb)) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF NOT (v_item ? 'dublagem_mode') THEN
      CONTINUE;
    END IF;
    v_mode := NULLIF(lower(btrim(COALESCE(v_item->>'dublagem_mode', ''))), '');
    IF v_mode IS NOT NULL AND v_mode NOT IN ('internal', 'external') THEN
      RAISE EXCEPTION 'dublagem_mode inválido: %', v_mode
        USING ERRCODE = '22023';
    END IF;

    v_id := NULLIF(v_item->>'id', '')::uuid;
    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.sale_order_items
       SET dublagem_mode = v_mode
     WHERE id = v_id
       AND sale_order_id = p_sale_order_id;

    IF FOUND THEN
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_sale_order_items_dublagem_mode(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_sale_order_items_dublagem_mode(uuid, jsonb)
  TO authenticated, service_role;

-- ─── Soft-reserva interna ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dublagem_soft_reserve_face(p_demand_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.dublagem_demands%ROWTYPE;
  v_res_id uuid;
  v_qty numeric;
BEGIN
  SELECT * INTO v_d FROM public.dublagem_demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_d.mode <> 'internal' OR v_d.product_id IS NULL OR v_d.linear_m <= 0 THEN
    RETURN NULL;
  END IF;
  IF v_d.status = 'cancelled' THEN
    RETURN NULL;
  END IF;

  v_qty := v_d.linear_m;

  IF v_d.material_reservation_id IS NOT NULL THEN
    UPDATE public.material_reservations
       SET quantity_reserved = v_qty,
           status = CASE
             WHEN status IN ('cancelled', 'consumed') THEN 'reserved'
             ELSE status
           END,
           updated_at = now(),
           notes = 'dublagem:soft:' || v_d.face
     WHERE id = v_d.material_reservation_id
    RETURNING id INTO v_res_id;
    IF v_res_id IS NOT NULL THEN
      UPDATE public.dublagem_demands
         SET status = 'reserved', updated_at = now()
       WHERE id = p_demand_id;
      RETURN v_res_id;
    END IF;
  END IF;

  INSERT INTO public.material_reservations (
    order_id, product_id, quantity_reserved, quantity_consumed,
    status, reservation_type, source, notes, dublagem_demand_id, metadata
  ) VALUES (
    NULL, v_d.product_id, v_qty, 0,
    'reserved', 'soft', 'dublagem',
    'dublagem:soft:' || v_d.face,
    p_demand_id,
    jsonb_build_object(
      'sale_order_id', v_d.sale_order_id,
      'sale_order_item_id', v_d.sale_order_item_id,
      'face', v_d.face
    )
  )
  RETURNING id INTO v_res_id;

  UPDATE public.dublagem_demands
     SET material_reservation_id = v_res_id,
         status = 'reserved',
         updated_at = now()
   WHERE id = p_demand_id;

  RETURN v_res_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dublagem_soft_reserve_face(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dublagem_soft_reserve_face(uuid)
  TO authenticated, service_role;

-- ─── Materialize ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.materialize_dublagem_demands(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  r record;
  v_dm2 numeric;
  v_glue_id uuid;
  v_glue_price numeric;
  v_ext_group uuid;
  v_int_group uuid;
  v_ext_color text;
  v_int_color text;
  v_ext_pid uuid;
  v_int_pid uuid;
  v_ext_m numeric;
  v_int_m numeric;
  v_upserted int := 0;
  v_skipped int := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_demand_id uuid;
BEGIN
  SELECT so.status INTO v_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado', 'status', v_status);
  END IF;

  -- Cancela demandas de itens que perderam o modo.
  UPDATE public.dublagem_demands d
     SET status = 'cancelled', updated_at = now()
   WHERE d.sale_order_id = p_sale_order_id
     AND d.status <> 'cancelled'
     AND NOT EXISTS (
       SELECT 1 FROM public.sale_order_items soi
        WHERE soi.id = d.sale_order_item_id
          AND soi.dublagem_mode IS NOT NULL
     );

  FOR r IN
    SELECT soi.id AS item_id,
           soi.color,
           soi.quantity,
           soi.dublagem_mode,
           soi.material_variant_id,
           soi.reference_id,
           COALESCE(rmv.upper_material_group_id, ts.upper_material_group_id) AS upper_group_id,
           ts.dublagem_glue_id AS sheet_glue_id
      FROM public.sale_order_items soi
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      LEFT JOIN public.reference_material_variants rmv ON rmv.id = soi.material_variant_id
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.dublagem_mode IS NOT NULL
       AND soi.reference_id IS NOT NULL
  LOOP
    -- Camadas do composto (≥2).
    SELECT
      (SELECT l.component_group_id
         FROM public.product_group_layers l
        WHERE l.composite_group_id = r.upper_group_id
          AND l.is_color_source
        ORDER BY l.display_order
        LIMIT 1),
      (SELECT l.component_group_id
         FROM public.product_group_layers l
        WHERE l.composite_group_id = r.upper_group_id
          AND NOT l.is_color_source
        ORDER BY l.display_order
        LIMIT 1)
      INTO v_ext_group, v_int_group;

    IF r.upper_group_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.product_group_layers l
          WHERE l.composite_group_id = r.upper_group_id
       )
       OR (SELECT count(*) FROM public.product_group_layers l
            WHERE l.composite_group_id = r.upper_group_id) < 2 THEN
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'item_id', r.item_id, 'reason', 'cabedal_not_composite'));
      CONTINUE;
    END IF;

    IF v_ext_group IS NULL OR v_int_group IS NULL THEN
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'item_id', r.item_id, 'reason', 'layer_group_missing',
        'hint', 'Vincule Napa (cor) e Massa Box (base) em product_group_layers'));
      CONTINUE;
    END IF;

    v_dm2 := public.dublagem_item_upper_dm2(r.item_id);
    IF v_dm2 <= 0 THEN
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'item_id', r.item_id, 'reason', 'upper_dm2_zero'));
      CONTINUE;
    END IF;

    v_ext_color := r.color;
    v_int_color := public.dublagem_massa_box_color(r.color);
    v_ext_pid := public.dublagem_resolve_product_in_group(v_ext_group, v_ext_color);
    v_int_pid := public.dublagem_resolve_product_in_group(v_int_group, v_int_color);
    v_ext_m := public.dublagem_dm2_to_linear_m(v_dm2, v_ext_pid);
    v_int_m := public.dublagem_dm2_to_linear_m(v_dm2, v_int_pid);

    v_glue_id := r.sheet_glue_id;
    v_glue_price := NULL;
    IF v_glue_id IS NOT NULL THEN
      SELECT g.price_per_m INTO v_glue_price
        FROM public.product_group_dublagem_glues g
       WHERE g.id = v_glue_id AND g.is_active;
    END IF;

    -- Face externa
    INSERT INTO public.dublagem_demands (
      sale_order_id, sale_order_item_id, mode, face,
      component_group_id, product_id, color, dm2, linear_m,
      glue_id, glue_price_per_m, status, updated_at
    ) VALUES (
      p_sale_order_id, r.item_id, r.dublagem_mode, 'external',
      v_ext_group, v_ext_pid, v_ext_color, v_dm2, COALESCE(v_ext_m, 0),
      v_glue_id, v_glue_price, 'open', now()
    )
    ON CONFLICT (sale_order_item_id, face) DO UPDATE SET
      mode = EXCLUDED.mode,
      component_group_id = EXCLUDED.component_group_id,
      product_id = EXCLUDED.product_id,
      color = EXCLUDED.color,
      dm2 = EXCLUDED.dm2,
      linear_m = EXCLUDED.linear_m,
      glue_id = EXCLUDED.glue_id,
      glue_price_per_m = EXCLUDED.glue_price_per_m,
      status = CASE
        WHEN public.dublagem_demands.status = 'cancelled' THEN 'open'
        ELSE public.dublagem_demands.status
      END,
      updated_at = now()
    RETURNING id INTO v_demand_id;
    v_upserted := v_upserted + 1;

    -- Face interna (Massa Box)
    INSERT INTO public.dublagem_demands (
      sale_order_id, sale_order_item_id, mode, face,
      component_group_id, product_id, color, dm2, linear_m,
      glue_id, glue_price_per_m, status, updated_at
    ) VALUES (
      p_sale_order_id, r.item_id, r.dublagem_mode, 'internal',
      v_int_group, v_int_pid, v_int_color, v_dm2, COALESCE(v_int_m, 0),
      v_glue_id, v_glue_price, 'open', now()
    )
    ON CONFLICT (sale_order_item_id, face) DO UPDATE SET
      mode = EXCLUDED.mode,
      component_group_id = EXCLUDED.component_group_id,
      product_id = EXCLUDED.product_id,
      color = EXCLUDED.color,
      dm2 = EXCLUDED.dm2,
      linear_m = EXCLUDED.linear_m,
      glue_id = EXCLUDED.glue_id,
      glue_price_per_m = EXCLUDED.glue_price_per_m,
      status = CASE
        WHEN public.dublagem_demands.status = 'cancelled' THEN 'open'
        ELSE public.dublagem_demands.status
      END,
      updated_at = now();
    v_upserted := v_upserted + 1;

    IF r.dublagem_mode = 'internal' THEN
      PERFORM public.dublagem_soft_reserve_face(d.id)
        FROM public.dublagem_demands d
       WHERE d.sale_order_item_id = r.item_id
         AND d.status <> 'cancelled';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'upserted', v_upserted,
    'skipped', v_skipped,
    'reasons', v_reasons
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_dublagem_demands(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_dublagem_demands(uuid)
  TO authenticated, service_role;

-- ─── OCs das faces (externa: qty=demanda; interna: só shortage) ─────────────
CREATE OR REPLACE FUNCTION public.process_dublagem_purchase_shortages(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_mat record;
  v_demand record;
  v_supplier_id uuid;
  v_idem text;
  v_po_id uuid;
  v_created int := 0;
  v_reused int := 0;
  v_by_supplier jsonb := '{}'::jsonb;
  v_key text;
  v_items jsonb;
  v_entry jsonb;
  v_total numeric;
  v_need numeric;
  v_avail numeric;
  v_price numeric;
  v_unit text;
  v_name text;
BEGIN
  SELECT so.status INTO v_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado');
  END IF;

  PERFORM public.materialize_dublagem_demands(p_sale_order_id);

  FOR v_demand IN
    SELECT d.*
      FROM public.dublagem_demands d
     WHERE d.sale_order_id = p_sale_order_id
       AND d.status IN ('open', 'reserved', 'ordered')
       AND d.product_id IS NOT NULL
       AND d.linear_m > 0
  LOOP
    SELECT p.name, p.unit, COALESCE(p.unit_price, 0),
           GREATEST(
             0,
             COALESCE(p.quantity, 0) - COALESCE((
               SELECT SUM(mr.quantity_reserved - COALESCE(mr.quantity_consumed, 0))
                 FROM public.material_reservations mr
                WHERE mr.product_id = p.id
                  AND mr.status IN ('reserved', 'partially_consumed')
             ), 0)
           )
      INTO v_name, v_unit, v_price, v_avail
      FROM public.products p
     WHERE p.id = v_demand.product_id;

    IF COALESCE(v_price, 0) <= 0 THEN
      CONTINUE;
    END IF;

    IF v_demand.mode = 'external' THEN
      -- Força compra do total, mesmo com saldo (enviar à dubladora).
      v_need := v_demand.linear_m;
    ELSE
      v_need := GREATEST(0, v_demand.linear_m - COALESCE(v_avail, 0));
    END IF;

    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    SELECT p.supplier_id INTO v_supplier_id
      FROM public.products p
     WHERE p.id = v_demand.product_id;

    v_key := CASE
      WHEN v_supplier_id IS NULL THEN 'none'
      ELSE 'supplier:' || v_supplier_id::text
    END;
    v_entry := jsonb_build_object(
      'product_id', v_demand.product_id,
      'product_name', v_name,
      'quantity', v_need,
      'unit_price', v_price,
      'unit', COALESCE(NULLIF(btrim(v_unit), ''), 'm'),
      'color', NULLIF(v_demand.color, ''),
      'current_stock', COALESCE(v_avail, 0),
      'demand_id', v_demand.id,
      'face', v_demand.face,
      'mode', v_demand.mode,
      'supplier_id', v_supplier_id,
      'supplier_name', COALESCE((
        SELECT NULLIF(btrim(s.name), '') FROM public.suppliers s WHERE s.id = v_supplier_id
      ), 'A definir')
    );
    IF v_by_supplier ? v_key THEN
      v_by_supplier := jsonb_set(
        v_by_supplier,
        ARRAY[v_key, 'items'],
        (v_by_supplier -> v_key -> 'items') || jsonb_build_array(v_entry)
      );
    ELSE
      v_by_supplier := v_by_supplier || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'supplier_id', v_supplier_id,
          'supplier_name', v_entry ->> 'supplier_name',
          'items', jsonb_build_array(v_entry)
        )
      );
    END IF;
  END LOOP;

  FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_by_supplier)
  LOOP
    v_supplier_id := NULLIF(v_entry ->> 'supplier_id', '')::uuid;
    v_items := v_entry -> 'items';
    v_idem := 'dublagem:outbox:' || COALESCE(v_supplier_id::text, 'none') || ':' || p_sale_order_id::text;

    SELECT po.id INTO v_po_id
      FROM public.purchase_orders po
     WHERE po.idempotency_key = v_idem
     LIMIT 1;

    IF v_po_id IS NOT NULL THEN
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM((i ->> 'quantity')::numeric * (i ->> 'unit_price')::numeric), 0)
      INTO v_total
      FROM jsonb_array_elements(v_items) i;

    INSERT INTO public.purchase_orders (
      supplier_id, supplier_name, notes, total_value, auto_generated,
      status, approval_status, source_type, source_pv_ids,
      linked_sale_order_ids, idempotency_key
    ) VALUES (
      v_supplier_id,
      COALESCE(v_entry ->> 'supplier_name', 'A definir'),
      'OC dublagem (faces) · PV ' || p_sale_order_id::text,
      v_total,
      true,
      CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
      'pendente_aprovacao',
      'dublagem',
      ARRAY[p_sale_order_id],
      ARRAY[p_sale_order_id],
      v_idem
    ) RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, suggested_quantity,
      unit_price, unit, current_stock, color
    )
    SELECT
      v_po_id,
      (i ->> 'product_id')::uuid,
      (i ->> 'quantity')::numeric,
      (i ->> 'quantity')::numeric,
      (i ->> 'unit_price')::numeric,
      COALESCE(i ->> 'unit', 'm'),
      COALESCE((i ->> 'current_stock')::numeric, 0),
      i ->> 'color'
    FROM jsonb_array_elements(v_items) i;

    UPDATE public.dublagem_demands d
       SET status = 'ordered', updated_at = now()
     WHERE d.sale_order_id = p_sale_order_id
       AND d.id IN (
         SELECT (i ->> 'demand_id')::uuid FROM jsonb_array_elements(v_items) i
       );

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'reused', v_reused
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.process_dublagem_purchase_shortages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_dublagem_purchase_shortages(uuid)
  TO authenticated, service_role;
