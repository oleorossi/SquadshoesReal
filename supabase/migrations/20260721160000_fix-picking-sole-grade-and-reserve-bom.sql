-- ============================================================================
-- FIXES (auditoria 2026-06-09, itens C6 + M4 + C4-reserva):
--
-- C6 — commit_picking_for_sale_order (20260517160000) foi escrita quando solado
--   era debitado HARD na criação da OP. Desde 20260524330000 o débito é SOFT:
--   a reserva fica status='reserved' com metadata.kind='sole_grade'. O picking
--   debitava products.quantity FLAT sem tocar stock_grade → trigger
--   check_grade_quantity_coherence aborta → picking inteiro do PV falhava.
--   Fix: branch por kind espelhando convert_reservation_to_out (20260703160000):
--   sole_grade debita por tamanho via metadata.effective_grade;
--   sole_pending_grade órfão é cancelado; resto segue linear.
--
-- M4 — convert_reservation_to_out, ramo linear: debitava quantity_reserved sem
--   validar disponível; products.quantity clampava em 0 (GREATEST) mas o
--   stock_movements registrava a saída CHEIA → no cancelamento o restore
--   creditava mais do que saiu (estoque fantasma). Fix: débito físico =
--   LEAST(reservado, disponível) e o ledger registra o valor REALMENTE
--   debitado.
--
-- C4-reserva — try_reserve_materials: loop de BOM (sheet_materials) reservava
--   material de área em dm² cru (o patch A3/20260703200000 só converteu o loop
--   de spec). Patch cirúrgico idempotente: converte v_demand pela largura da
--   ficha (get_material_conversion_info) igual aos demais caminhos. Se o
--   padrão-base não for encontrado (função divergente), emite WARNING e não
--   aplica — nunca quebra o deploy.
-- ============================================================================

-- ── C6: commit_picking_for_sale_order com branch por tipo de reserva ────────
CREATE OR REPLACE FUNCTION public.commit_picking_for_sale_order(
  p_sale_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res RECORD;
  v_cur_qty numeric;
  v_picked integer := 0;
  v_skipped integer := 0;
  v_insufficient text[] := '{}';
  v_picked_items jsonb := '[]'::jsonb;
  v_so_exists boolean;
  v_kind text;
  v_effective_grade jsonb;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_total_debited numeric;
  v_prev_total numeric;
  v_grade_ok boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Lock no PV pra evitar race
  SELECT true INTO v_so_exists
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de Venda não encontrado: %', p_sale_order_id;
  END IF;

  FOR v_res IN
    SELECT mr.id,
           mr.order_id,
           mr.product_id,
           mr.quantity_reserved,
           mr.metadata,
           p.name AS product_name,
           o.order_number AS op_number
      FROM public.material_reservations mr
      JOIN public.orders   o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
     WHERE o.sale_order_id = p_sale_order_id
       AND mr.status = 'reserved'
     ORDER BY mr.product_id, mr.id
       FOR UPDATE OF mr
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

    -- ===== sole_grade: débito por TAMANHO (stock_grade + quantity juntos) =====
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        -- sem grade resolvida: não dá pra debitar por tamanho — cancela (não vaza)
        UPDATE public.material_reservations
           SET status = 'cancelled', updated_at = now(),
               notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at picking: sole_grade sem effective_grade]'
         WHERE id = v_res.id;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity INTO v_stock_grade, v_cur_qty
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

      -- valida TODOS os tamanhos antes de debitar qualquer um
      v_grade_ok := true;
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        IF v_available < v_size_qty THEN
          v_insufficient := v_insufficient ||
            format('%s tam %s: disponível %s · necessário %s',
                   v_res.product_name, v_size, v_available::text, v_size_qty::text);
          v_grade_ok := false;
        END IF;
      END LOOP;
      IF NOT v_grade_ok THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      v_new_grade := v_stock_grade;
      v_total_debited := 0;
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
        v_total_debited := v_total_debited + v_size_qty;
      END LOOP;

      IF v_total_debited > 0 THEN
        UPDATE public.products
           SET stock_grade = v_new_grade,
               quantity = GREATEST(0, quantity - v_total_debited),
               updated_at = now()
         WHERE id = v_res.product_id;
        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id, user_id
        ) VALUES (
          v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
          'Picking em massa (PV) — Solado por grade — ' || COALESCE(v_res.op_number, ''),
          v_res.order_id, auth.uid()
        );
      END IF;

      UPDATE public.material_reservations
         SET status            = 'consumed',
             quantity_consumed = quantity_reserved,
             consumed_at       = now(),
             reservation_type  = 'hard',
             updated_at        = now()
       WHERE id = v_res.id;

      v_picked := v_picked + 1;
      v_picked_items := v_picked_items || jsonb_build_object(
        'product_id', v_res.product_id,
        'product_name', v_res.product_name,
        'quantity', v_total_debited,
        'op', v_res.op_number
      );
      CONTINUE;
    END IF;

    -- ===== sole_pending_grade órfão: cancela (não debita plano) =====
    IF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at picking: orphan sole_pending_grade]'
       WHERE id = v_res.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- ===== strap / component / default: débito linear (comportamento original) =====
    SELECT quantity INTO v_cur_qty
      FROM public.products
     WHERE id = v_res.product_id
       FOR UPDATE;

    IF v_cur_qty < v_res.quantity_reserved THEN
      v_insufficient := v_insufficient ||
        format('%s: disponível %s · necessário %s',
               v_res.product_name,
               v_cur_qty::text,
               v_res.quantity_reserved::text);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity   = quantity - v_res.quantity_reserved,
           updated_at = now()
     WHERE id = v_res.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, order_id, user_id
    ) VALUES (
      v_res.product_id,
      'out',
      v_res.quantity_reserved,
      v_cur_qty,
      v_cur_qty - v_res.quantity_reserved,
      'Picking realizado em massa (PV) — ' || COALESCE(v_res.op_number, ''),
      v_res.order_id,
      auth.uid()
    );

    UPDATE public.material_reservations
       SET status            = 'consumed',
           quantity_consumed = quantity_reserved,
           consumed_at       = now(),
           reservation_type  = 'hard',
           updated_at        = now()
     WHERE id = v_res.id;

    v_picked := v_picked + 1;
    v_picked_items := v_picked_items || jsonb_build_object(
      'product_id', v_res.product_id,
      'product_name', v_res.product_name,
      'quantity', v_res.quantity_reserved,
      'op', v_res.op_number
    );
  END LOOP;

  IF v_picked > 0 THEN
    UPDATE public.sale_orders
       SET picking_individually_done_at = now(),
           updated_at = now()
     WHERE id = p_sale_order_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'picked_count',  v_picked,
    'skipped_count', v_skipped,
    'insufficient',  v_insufficient,
    'picked_items',  v_picked_items,
    'marked_done',   v_picked > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_picking_for_sale_order(uuid) TO authenticated;

COMMENT ON FUNCTION public.commit_picking_for_sale_order(uuid) IS
  'Debita em massa as reservas soft de um PV (sole_grade por tamanho via '
  'effective_grade; sole_pending_grade cancelado; resto linear) e marca '
  'picking_individually_done_at.';

-- ── M4: convert_reservation_to_out — ramo linear com ledger consistente ─────
-- Reaplica a função do C2-fix (20260703160000) mudando APENAS o ramo linear:
-- débito físico = LEAST(reservado, disponível) e stock_movements registra o
-- valor realmente debitado (antes registrava a saída cheia enquanto quantity
-- clampava em 0 → restore creditava mais do que saiu).
CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(p_order_id uuid, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res RECORD;
  v_kind text;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_stock_grade jsonb;
  v_new_grade jsonb;
  v_total_debited numeric;
  v_prev_total numeric;
  v_prev_qty numeric;
  v_target_name text;
  v_effective_grade jsonb;
  v_debit numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('convert_reservation:' || p_order_id::text));

  FOR v_res IN
    SELECT * FROM public.material_reservations
     WHERE order_id = p_order_id
       AND (p_product_id IS NULL OR product_id = p_product_id)
       AND status = 'reserved'
     ORDER BY (CASE WHEN (metadata->>'kind') = 'sole_grade' THEN 0 ELSE 1 END), created_at, id
     FOR UPDATE
  LOOP
    v_kind := COALESCE(v_res.metadata ->> 'kind', 'component');

    -- ===== sole_grade: débito por TAMANHO =====
    IF v_kind = 'sole_grade' THEN
      v_effective_grade := v_res.metadata -> 'effective_grade';
      IF v_effective_grade IS NULL OR jsonb_typeof(v_effective_grade) <> 'object' THEN
        UPDATE public.material_reservations SET status = 'cancelled', updated_at = now() WHERE id = v_res.id;
        CONTINUE;
      END IF;

      SELECT stock_grade, quantity, name INTO v_stock_grade, v_prev_qty, v_target_name
        FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

      v_prev_total := 0;
      FOR v_size IN SELECT k FROM jsonb_object_keys(v_stock_grade) AS k WHERE left(k, 1) <> '_'
      LOOP v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0); END LOOP;

      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        IF v_available < v_size_qty THEN
          RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
            v_target_name, v_size, v_available, v_size_qty;
        END IF;
      END LOOP;

      v_new_grade := v_stock_grade;
      v_total_debited := 0;
      FOR v_size, v_size_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
      LOOP
        v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
        v_total_debited := v_total_debited + v_size_qty;
      END LOOP;

      IF v_total_debited > 0 THEN
        UPDATE public.products
           SET stock_grade = v_new_grade, quantity = GREATEST(0, quantity - v_total_debited), updated_at = now()
         WHERE id = v_res.product_id;
        INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
                'Conversão Solado por grade (' || COALESCE(v_target_name, '') || ')', p_order_id);
      END IF;
      UPDATE public.material_reservations
         SET status = 'converted', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
       WHERE id = v_res.id;

    -- ===== sole_pending_grade órfão: cancela (não debita plano) =====
    ELSIF v_kind = 'sole_pending_grade' THEN
      UPDATE public.material_reservations
         SET status = 'cancelled', updated_at = now(),
             notes = COALESCE(NULLIF(notes, ''), '') || ' [cancelled at convert: orphan sole_pending_grade]'
       WHERE id = v_res.id;

    -- ===== strap / component / default: débito linear =====
    ELSE
      SELECT quantity, name INTO v_prev_qty, v_target_name FROM public.products WHERE id = v_res.product_id FOR UPDATE;
      -- M4: débito físico limitado ao disponível; ledger registra o REAL
      v_debit := LEAST(COALESCE(v_res.quantity_reserved, 0), GREATEST(0, COALESCE(v_prev_qty, 0)));
      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = quantity - v_debit, updated_at = now()
         WHERE id = v_res.product_id;
        INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
        VALUES (v_res.product_id, 'out', v_debit, v_prev_qty, v_prev_qty - v_debit,
                'Conversão ' || COALESCE(v_res.metadata ->> 'component', 'Material') || ' (' || COALESCE(v_target_name, '') || ')', p_order_id);
      END IF;
      UPDATE public.material_reservations
         SET status = 'converted', quantity_consumed = COALESCE(quantity_reserved, 0), updated_at = now()
       WHERE id = v_res.id;
    END IF;
  END LOOP;
END;
$function$;

-- ── C4-reserva: patch cirúrgico do loop BOM em try_reserve_materials ────────
DO $patch$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc
   WHERE proname = 'try_reserve_materials' AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE WARNING 'try_reserve_materials não encontrada — fix C4-reserva NÃO aplicado';
    RETURN;
  END IF;
  IF v_src LIKE '%conv-bom-c4%' THEN
    RETURN; -- já aplicado (idempotente)
  END IF;
  IF position('v_demand := mat.quantity_per_unit * p_order_quantity;' IN v_src) = 0 THEN
    RAISE WARNING 'try_reserve_materials: padrão do loop BOM não encontrado — fix C4-reserva NÃO aplicado (verificar manualmente)';
    RETURN;
  END IF;

  v_new := replace(v_src,
    'v_demand := mat.quantity_per_unit * p_order_quantity;',
    'v_demand := mat.quantity_per_unit * p_order_quantity;
    -- conv-bom-c4 (auditoria 2026-06-09): material de área em dm²/par →
    -- unidade física do produto pela largura da ficha de componente.
    SELECT * INTO v_conv4 FROM public.get_material_conversion_info(v_target_id);
    IF COALESCE(v_conv4.dm2_per_unit, 1) > 0 AND COALESCE(v_conv4.dm2_per_unit, 1) <> 1 THEN
      v_demand := (v_demand / v_conv4.dm2_per_unit) * (1 + COALESCE(v_conv4.waste_pct, 0) / 100);
    END IF;');

  EXECUTE v_new;
  RAISE NOTICE 'try_reserve_materials: fix C4-reserva aplicado';
END
$patch$;
