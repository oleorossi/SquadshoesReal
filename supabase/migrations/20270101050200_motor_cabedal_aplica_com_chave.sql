-- Aplica o motor de cabedal só com auto_motor_enabled = true.
-- A chave nasce false. Cada função sai antes de INSERT/UPDATE nesse caso.
-- PV-00249 não entra nas escritas.

CREATE OR REPLACE FUNCTION public.cabedal_motor_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT s.auto_motor_enabled FROM public.atelier_settings s WHERE s.id = 1), false);
$$;

REVOKE ALL ON FUNCTION public.cabedal_motor_is_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cabedal_motor_is_enabled() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.cabedal_motor_item_holds (
  sale_order_item_id uuid PRIMARY KEY REFERENCES public.sale_order_items(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('aguardando_material', 'aguardando_cabedal', 'liberado')),
  reason text NOT NULL DEFAULT '',
  departure_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cabedal_motor_item_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cabedal_motor_item_holds FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS cabedal_motor_item_holds_read ON public.cabedal_motor_item_holds;
CREATE POLICY cabedal_motor_item_holds_read ON public.cabedal_motor_item_holds
  FOR SELECT TO authenticated
  USING (public.is_approved_user());
GRANT SELECT ON public.cabedal_motor_item_holds TO authenticated;
GRANT ALL ON public.cabedal_motor_item_holds TO service_role;

CREATE OR REPLACE FUNCTION public.cabedal_motor_corte_released(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cabedal_motor_is_enabled()
     AND EXISTS (
       SELECT 1
         FROM public.cabedal_motor_item_holds h
        WHERE h.sale_order_item_id = p_item_id
          AND h.departure_on IS NOT NULL
          AND h.departure_on <= CURRENT_DATE
     );
$$;

REVOKE ALL ON FUNCTION public.cabedal_motor_corte_released(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cabedal_motor_corte_released(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_cabedal_motor_purchase_orders(p_groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group jsonb;
  v_line jsonb;
  v_items jsonb;
  v_month text;
  v_months text[];
  v_urgent boolean;
  v_mixed boolean;
  v_supplier uuid;
  v_name text;
  v_key text;
  v_po public.purchase_orders;
  v_created int := 0;
  v_numbers text[] := ARRAY[]::text[];
  v_skip uuid;
BEGIN
  IF NOT public.cabedal_motor_is_enabled() THEN
    RETURN jsonb_build_object('applied', false, 'created', 0, 'reason', 'motor desligado');
  END IF;
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Sem permissão para gerar OC' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_skip FROM public.sale_orders WHERE order_number = 'PV-00249';
  FOR v_group IN SELECT value FROM jsonb_array_elements(COALESCE(p_groups, '[]'::jsonb)) LOOP
    v_items := '[]'::jsonb;
    v_months := ARRAY[]::text[];
    v_mixed := false;
    v_urgent := NULL;
    v_supplier := NULLIF(v_group ->> 'supplier_id', '')::uuid;
    v_name := COALESCE(NULLIF(v_group ->> 'supplier_name', ''), 'Sem fornecedor');
    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_group -> 'lines', '[]'::jsonb)) LOOP
      IF v_skip IS NOT NULL AND NULLIF(v_line ->> 'sale_order_id', '')::uuid = v_skip THEN
        CONTINUE;
      END IF;
      IF COALESCE((v_line ->> 'quantity')::numeric, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF v_urgent IS NULL THEN
        v_urgent := COALESCE((v_line ->> 'urgent')::boolean, false);
      ELSIF v_urgent IS DISTINCT FROM COALESCE((v_line ->> 'urgent')::boolean, false) THEN
        v_mixed := true;
      END IF;
      v_month := left(COALESCE(v_line ->> 'need_date', v_line ->> 'buy_by', ''), 7);
      IF v_month <> '' THEN
        v_months := v_months || v_month;
      END IF;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'product_id', v_line ->> 'product_id',
        'quantity', (v_line ->> 'quantity')::numeric,
        'suggested_quantity', (v_line ->> 'quantity')::numeric,
        'unit_price', COALESCE((v_line ->> 'unit_price')::numeric, 0),
        'unit', COALESCE(NULLIF(v_line ->> 'unit', ''), 'un'),
        'current_stock', 0,
        'max_stock', (v_line ->> 'quantity')::numeric
      ));
    END LOOP;
    IF v_mixed OR jsonb_array_length(v_items) = 0 THEN
      CONTINUE;
    END IF;
    IF NOT COALESCE(v_urgent, false) AND (SELECT count(DISTINCT m) FROM unnest(v_months) m) > 1 THEN
      CONTINUE;
    END IF;
    v_key := left('motor:' || COALESCE(v_supplier::text, 'sem') || ':' || COALESCE(v_group ->> 'group_key', 'grupo'), 180);
    v_po := public.create_purchase_order_normalized(
      v_name,
      v_supplier,
      'Motor de cabedal. Comprar até a data de cada linha. Nada é gravado com a chave desligada.',
      v_key,
      v_items
    );
    v_created := v_created + 1;
    v_numbers := v_numbers || COALESCE(v_po.order_number, v_po.id::text);
  END LOOP;
  RETURN jsonb_build_object('applied', true, 'created', v_created, 'orders', to_jsonb(v_numbers));
END;
$$;

REVOKE ALL ON FUNCTION public.create_cabedal_motor_purchase_orders(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cabedal_motor_purchase_orders(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_cabedal_motor_soft_reservations(p_moves jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip uuid;
  v_product uuid;
  v_total numeric;
  v_desired numeric;
  v_left numeric;
  v_share numeric;
  v_seen int;
  v_rows int;
  v_row record;
  v_updated int := 0;
BEGIN
  -- Chave desligada: nenhuma reserva muda.
  IF NOT public.cabedal_motor_is_enabled() THEN
    RETURN jsonb_build_object('applied', false, 'updated', 0, 'reason', 'motor desligado');
  END IF;
  SELECT id INTO v_skip FROM public.sale_orders WHERE order_number = 'PV-00249';

  FOR v_product IN
    SELECT DISTINCT NULLIF(m.value ->> 'product_id', '')::uuid AS product_id
      FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) m
     WHERE NULLIF(m.value ->> 'product_id', '') IS NOT NULL
  LOOP
    SELECT COALESCE(sum(mr.quantity_reserved), 0),
           COALESCE(sum(GREATEST(0, COALESCE((mv.value ->> 'quantity')::numeric, 0))), 0)
      INTO v_total, v_desired
      FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) mv
      JOIN public.sale_order_items soi ON soi.id = NULLIF(mv.value ->> 'sale_order_item_id', '')::uuid
      JOIN public.material_reservations mr
        ON mr.product_id = v_product
       AND mr.status = 'reserved'
       AND (
         mr.metadata ->> 'debit_mode' = 'soft'
         OR (mr.metadata ->> 'debit_mode' IS NULL AND mr.reservation_type = 'soft')
       )
       AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
       AND mr.strap_variant_id IS NULL
       AND (
         mr.sale_order_id = soi.sale_order_id
         OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_item_id = soi.id)
       )
     WHERE NULLIF(mv.value ->> 'product_id', '')::uuid = v_product
       AND soi.sale_order_id IS DISTINCT FROM v_skip
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          JOIN public.production_pointings p ON p.order_id = o.id
         WHERE o.id = mr.order_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.id = mr.order_id AND o.sequence_frozen_at IS NOT NULL
       );
    IF v_total <= 0 OR v_desired <= 0 THEN
      CONTINUE;
    END IF;
    v_left := v_total;
    v_seen := 0;
    SELECT count(*) INTO v_rows
      FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) mv
      JOIN public.sale_order_items soi ON soi.id = NULLIF(mv.value ->> 'sale_order_item_id', '')::uuid
      JOIN public.material_reservations mr
        ON mr.product_id = v_product
       AND mr.status = 'reserved'
       AND (
         mr.metadata ->> 'debit_mode' = 'soft'
         OR (mr.metadata ->> 'debit_mode' IS NULL AND mr.reservation_type = 'soft')
       )
       AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
       AND mr.strap_variant_id IS NULL
       AND (
         mr.sale_order_id = soi.sale_order_id
         OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_item_id = soi.id)
       )
     WHERE NULLIF(mv.value ->> 'product_id', '')::uuid = v_product
       AND soi.sale_order_id IS DISTINCT FROM v_skip
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          JOIN public.production_pointings p ON p.order_id = o.id
         WHERE o.id = mr.order_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.id = mr.order_id AND o.sequence_frozen_at IS NOT NULL
       );
    FOR v_row IN
      SELECT mr.id,
             GREATEST(0, COALESCE((mv.value ->> 'quantity')::numeric, 0)) AS desired
        FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) mv
        JOIN public.sale_order_items soi ON soi.id = NULLIF(mv.value ->> 'sale_order_item_id', '')::uuid
        JOIN public.material_reservations mr
          ON mr.product_id = v_product
         AND mr.status = 'reserved'
         AND (
           mr.metadata ->> 'debit_mode' = 'soft'
           OR (mr.metadata ->> 'debit_mode' IS NULL AND mr.reservation_type = 'soft')
         )
         AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
         AND mr.strap_variant_id IS NULL
         AND (
           mr.sale_order_id = soi.sale_order_id
           OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_item_id = soi.id)
         )
       WHERE NULLIF(mv.value ->> 'product_id', '')::uuid = v_product
         AND soi.sale_order_id IS DISTINCT FROM v_skip
         AND NOT EXISTS (
           SELECT 1 FROM public.orders o
            JOIN public.production_pointings p ON p.order_id = o.id
           WHERE o.id = mr.order_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.orders o
            WHERE o.id = mr.order_id AND o.sequence_frozen_at IS NOT NULL
         )
       ORDER BY 2 DESC, mr.id
    LOOP
      v_seen := v_seen + 1;
      -- A última linha absorve o resto para o total do produto não mudar.
      IF v_seen = v_rows THEN
        v_share := v_left;
      ELSE
        v_share := LEAST(v_left, round(v_total * v_row.desired / v_desired, 4));
      END IF;
      UPDATE public.material_reservations
         SET quantity_reserved = v_share,
             updated_at = now()
       WHERE id = v_row.id;
      v_left := GREATEST(0, v_left - v_share);
      v_updated := v_updated + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('applied', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cabedal_motor_soft_reservations(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_cabedal_motor_soft_reservations(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_cabedal_motor_holds(p_holds jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold jsonb;
  v_skip uuid;
  v_count int := 0;
BEGIN
  IF NOT public.cabedal_motor_is_enabled() THEN
    RETURN jsonb_build_object('applied', false, 'updated', 0, 'reason', 'motor desligado');
  END IF;
  SELECT id INTO v_skip FROM public.sale_orders WHERE order_number = 'PV-00249';
  FOR v_hold IN SELECT value FROM jsonb_array_elements(COALESCE(p_holds, '[]'::jsonb)) LOOP
    IF v_skip IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.sale_order_items soi
       WHERE soi.id = NULLIF(v_hold ->> 'sale_order_item_id', '')::uuid
         AND soi.sale_order_id = v_skip
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.cabedal_motor_item_holds (sale_order_item_id, status, reason, departure_on, updated_at)
    VALUES (
      NULLIF(v_hold ->> 'sale_order_item_id', '')::uuid,
      v_hold ->> 'status',
      COALESCE(v_hold ->> 'reason', ''),
      NULLIF(v_hold ->> 'departure_on', '')::date,
      now()
    )
    ON CONFLICT (sale_order_item_id) DO UPDATE
      SET status = EXCLUDED.status,
          reason = EXCLUDED.reason,
          departure_on = EXCLUDED.departure_on,
          updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  -- Cabedal que já voltou deixa de travar a montagem. O corte, na fila,
  -- libera quando a data de saída chegou (cabedal_motor_corte_released).
  UPDATE public.cabedal_motor_item_holds h
     SET status = 'liberado',
         reason = 'Cabedal recebido no Ateliê. A montagem pode seguir.',
         updated_at = now()
   WHERE h.status = 'aguardando_cabedal'
     AND NOT EXISTS (
       SELECT 1 FROM public.sale_order_items soi
        WHERE soi.id = h.sale_order_item_id
          AND soi.sale_order_id = v_skip
     )
     AND public.atelier_item_block_reason(h.sale_order_item_id) IS NULL;
  RETURN jsonb_build_object('applied', true, 'updated', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cabedal_motor_holds(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_cabedal_motor_holds(jsonb) TO authenticated, service_role;

-- Fila: com a chave desligada o critério do urgente é 0 para todo mundo,
-- então a ordem antiga permanece. A trava nova só entra com a chave ligada.
CREATE OR REPLACE FUNCTION public.list_production_sequence()
RETURNS TABLE (
  order_id uuid,
  sale_order_id uuid,
  sale_order_item_id uuid,
  order_number text,
  color text,
  reference_code text,
  due_date date,
  pinned_position integer,
  close_score numeric,
  sequence_position integer,
  is_pinned boolean,
  is_frozen boolean,
  sequence_frozen_at timestamptz,
  block_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.id AS order_id,
    o.sale_order_id,
    o.sale_order_item_id,
    o.order_number,
    o.color,
    ts.code AS reference_code,
    q.due_date,
    q.pinned_position,
    public.production_sequence_close_score(o.sale_order_id) AS close_score,
    row_number() OVER (
      ORDER BY (q.pinned_position IS NULL), q.pinned_position,
               CASE WHEN o.sequence_frozen_at IS NOT NULL THEN 0 ELSE 1 END,
               COALESCE(q.sequence_frozen_position, 2147483647),
               CASE
                 WHEN NOT public.cabedal_motor_is_enabled() THEN 0
                 WHEN lower(btrim(COALESCE(so.order_type, ''))) = 'urgente' THEN 0
                 ELSE 1
               END,
               public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
               q.due_date NULLS LAST,
               lower(trim(COALESCE(o.color, ''))),
               lower(trim(COALESCE(ts.code, ''))),
               o.created_at, o.id
    )::integer AS sequence_position,
    (q.pinned_position IS NOT NULL) AS is_pinned,
    (o.sequence_frozen_at IS NOT NULL) AS is_frozen,
    o.sequence_frozen_at,
    CASE
      WHEN q.pinned_position IS NOT NULL THEN NULL
      WHEN public.cabedal_motor_is_enabled()
           AND h.status = 'aguardando_material' THEN 'Aguardando material'
      WHEN public.cabedal_motor_is_enabled()
           AND h.status = 'aguardando_cabedal'
           AND NOT public.cabedal_motor_corte_released(o.sale_order_item_id) THEN 'Aguardando cabedal'
      ELSE public.sale_order_item_factory_gate_block_reason(o.sale_order_item_id)
    END AS block_reason
  FROM public.production_queue q
  JOIN public.orders o ON o.id = q.order_id
  LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.cabedal_motor_item_holds h ON h.sale_order_item_id = o.sale_order_item_id
  WHERE o.deleted_at IS NULL
    AND COALESCE(o.status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelled',
      'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
      'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
      'Faturado', 'Rascunho'
    )
    AND public.is_approved_user();
$$;

GRANT EXECUTE ON FUNCTION public.list_production_sequence() TO authenticated, service_role;
