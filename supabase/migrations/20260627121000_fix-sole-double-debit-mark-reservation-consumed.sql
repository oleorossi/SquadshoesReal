-- =============================================================================
-- 20260627121000 — FIX SOLE DOUBLE-DEBIT (mark reservation consumed)
-- =============================================================================
--
-- Bug A2 da auditoria geral:
--   1) hybrid_debit_stock_for_order (20260527130000) cria reservation com
--      status='reserved' e source='primary_sole' / type='sole_deferred_to_grade'
--      pro solado, sem decrementar products.quantity (deferred to by_grade).
--   2) debit_sole_stock_by_grade (versão atual em 20260521130000) decrementa
--      products.quantity + stock_grade + cria stock_movement — mas NUNCA
--      atualiza material_reservations. Reservation 'reserved' fica órfã.
--   3) Operador arrasta OP pra Corte Palmilha no Kanban →
--      convert_reservation_to_out (20260620130000) itera TODAS reservations
--      com status='reserved' do order_id e decrementa products.quantity DE NOVO.
--
-- Resultado: solado debitado 2× em toda OP que passa por Corte Palmilha.
-- products.quantity < SUM(stock_grade) — invariante quebrado.
--
-- Fix: ao final do débito por grade, marcar a reservation soft do solado como
-- 'consumed' com quantity_consumed=quantity_reserved. O trigger
-- tg_sync_reserved_stock_on_update já cobre o decremento de reserved_stock.
-- convert_reservation_to_out filtra status='reserved', então não acha mais
-- a reservation e não duplica o débito.

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id     uuid,
  p_color        text,
  p_order_grade  jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id       uuid;
  v_sole_material       text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id   uuid;
  target_product_id    uuid;
  target_name          text;
  v_stock_grade        jsonb;
  v_size               text;
  v_size_qty           numeric;
  v_available          numeric;
  v_new_grade          jsonb;
  v_total_debited      numeric := 0;
  v_prev_total         numeric;
  v_product_group_id   uuid;
  v_effective_grade    jsonb;
  v_conj_key           text;
  v_existing_qty       numeric;
  v_has_conjugations   boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT ts.sole_group_id, ts.sole_material
    INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id, tsc.sole_group_id
    INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
   LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
     WHERE p.active = true AND p.id = v_mapped_sole_product_id
     LIMIT 1
     FOR UPDATE;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1
       FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1
       FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1
       FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = target_product_id;

  SELECT EXISTS (
    SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id
  ) INTO v_has_conjugations;

  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(p_order_grade)
     WHERE value::numeric > 0
       AND left(key, 1) <> '_'
  LOOP
    IF v_size LIKE '%/%' THEN
      v_conj_key := v_size;
    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;
    ELSE
      v_conj_key := v_size;
    END IF;

    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(
      v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty)
    );
  END LOOP;

  v_prev_total := 0;
  FOR v_size IN
    SELECT k FROM jsonb_object_keys(v_stock_grade) AS k
     WHERE left(k, 1) <> '_'
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity    = GREATEST(0, quantity - v_total_debited),
           updated_at  = now()
     WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Débito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor: ' || p_color ELSE '' END,
      p_order_id
    );

    -- FIX A2: marca reservation 'reserved' do solado como 'consumed' pra evitar
    -- que convert_reservation_to_out (no Kanban → Corte Palmilha) debite de novo.
    -- O trigger tg_sync_reserved_stock_on_update vai decrementar reserved_stock
    -- automaticamente por (quantity_reserved - quantity_consumed_anterior).
    UPDATE public.material_reservations
       SET status            = 'consumed',
           quantity_consumed = COALESCE(quantity_reserved, 0),
           updated_at        = now()
     WHERE order_id   = p_order_id
       AND product_id = target_product_id
       AND status     = 'reserved';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) IS
  'Debita solado por grade (stock_grade + quantity + stock_movement). '
  'A partir de 27/jun: marca material_reservations.status=consumed do solado '
  'no final, evitando double-debit no Kanban (convert_reservation_to_out).';
