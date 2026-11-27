-- Ressalva no Ateliê: entrada automática da falta + baixa imediata na mesma
-- transação, e DELETE com WHERE nas temporárias de envio (pg-safeupdate).

-- 1) pg-safeupdate exige WHERE em todo DELETE, inclusive em tabelas TEMP.
DO $patch_del$
DECLARE
  rec record;
  v_def text;
  v_new text;
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('atelier_send_split', 'atelier_send_remessa')
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    v_new := v_def;
    v_new := replace(v_new, 'DELETE FROM atelier_split_buffer;', 'DELETE FROM atelier_split_buffer WHERE TRUE;');
    v_new := replace(v_new, 'DELETE FROM atelier_remessa_remain;', 'DELETE FROM atelier_remessa_remain WHERE TRUE;');
    v_new := replace(v_new, 'DELETE FROM atelier_remessa_take;', 'DELETE FROM atelier_remessa_take WHERE TRUE;');
    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;

  IF position('DELETE FROM atelier_split_buffer WHERE TRUE;' IN pg_get_functiondef('public.atelier_send_split(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'atelier_send_split ainda tem DELETE sem WHERE';
  END IF;
  IF position('DELETE FROM atelier_remessa_remain WHERE TRUE;' IN pg_get_functiondef('public.atelier_send_remessa(uuid, text, uuid, jsonb, numeric, boolean)'::regprocedure)) = 0
     OR position('DELETE FROM atelier_remessa_take WHERE TRUE;' IN pg_get_functiondef('public.atelier_send_remessa(uuid, text, uuid, jsonb, numeric, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'atelier_send_remessa ainda tem DELETE sem WHERE';
  END IF;
END;
$patch_del$;

-- 1b) Jobs cortados sem OS (Confirmar corte do lote) precisam nascer a OS no envio.
--     O gatilho de 54200 bloqueava atelier_job_parts em send_split/remessa/shipment.
CREATE OR REPLACE FUNCTION public.tg_atelier_os_only_from_cut()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $tg$
DECLARE
  v_sector text;
BEGIN
  IF current_setting('app.atelier_cut_os', true) = '1'
     OR current_setting('app.atelier_send_os', true) = '1' THEN
    RETURN NEW;
  END IF;
  SELECT j.sector INTO v_sector FROM public.cabedal_prep_jobs j WHERE j.id = NEW.job_id;
  IF public.outsourced_sector_key(v_sector) IN ('costura', 'aviamento')
     AND NEW.pipeline_status = 'sent_to_contractor' THEN
    RAISE EXCEPTION 'A OS de cabedal complexo nasce na aprovação do corte.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$tg$;

DO $patch_send_os$
DECLARE
  rec record;
  v_def text;
  v_new text;
  v_inj text :=
    E'\n  PERFORM set_config(''app.atelier_send_os'', ''1'', true);\n';
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('atelier_send_split', 'atelier_send_remessa', 'atelier_send_shipment')
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    IF position('app.atelier_send_os' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := regexp_replace(
      v_def,
      '(AS \$function\$\s*(?:DECLARE\s[\s\S]*?)?)\nBEGIN\n',
      E'\\1\nBEGIN' || v_inj,
      ''
    );
    IF v_new IS NOT DISTINCT FROM v_def THEN
      RAISE EXCEPTION '% não recebeu app.atelier_send_os', rec.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch_send_os$;


-- 2) Durante a regularização da ressalva, a entrada sintética não pode
--    ratear empenho de outro PV nem disparar OC automática no pulo 0→Q→0.
DO $patch_trig$
DECLARE
  rec record;
  v_def text;
  v_new text;
  v_skip text :=
    E'\n  IF current_setting(''app.atelier_ressalva_settlement'', true) = ''1'' THEN\n'
    || E'    RETURN NEW;\n'
    || E'  END IF;\n';
BEGIN
  FOR rec IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('tg_cover_commitments_on_stock_in', 'auto_create_purchase_order')
  LOOP
    v_def := pg_get_functiondef(rec.oid);
    IF position('app.atelier_ressalva_settlement' IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := regexp_replace(
      v_def,
      '(AS \$function\$\s*(?:DECLARE\s[\s\S]*?)?)\nBEGIN\n',
      E'\\1\nBEGIN' || v_skip,
      ''
    );
    IF v_new IS NOT DISTINCT FROM v_def THEN
      RAISE EXCEPTION '% não recebeu o guarda da ressalva', rec.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END;
$patch_trig$;

-- 3) Regulariza napa/componente pendente: IN da falta e OUT do necessário.
CREATE OR REPLACE FUNCTION public.atelier_settle_open_kit_shortages(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_so_number text;
  v_audit text;
  v_debit record;
  v_line record;
  v_pending numeric;
  v_short numeric;
  v_prev numeric;
  v_in uuid;
  v_out uuid;
  v_ins int := 0;
  v_outs int := 0;
  v_gate text;
  v_released boolean := false;
BEGIN
  PERFORM set_config('app.atelier_ressalva_settlement', '1', true);

  IF p_lot_id IS NULL THEN
    RAISE EXCEPTION 'Informe o lote' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT so.order_number
    INTO v_so_number
    FROM public.cabedal_prep_jobs j
    JOIN public.sale_orders so ON so.id = j.sale_order_id
   WHERE j.lot_id = p_lot_id
     AND so.order_number IS NOT NULL
   ORDER BY j.created_at
   LIMIT 1;

  v_audit := trim(both ' ' FROM concat_ws(' / ', v_lot.lot_number, v_so_number));

  FOR v_debit IN
    SELECT d.id, d.product_id, d.sale_order_id, d.pending_qty, d.reservation_id
      FROM public.cabedal_prep_stock_debits d
     WHERE d.lot_id = p_lot_id
       AND COALESCE(d.pending_qty, 0) > 0.0000001
     ORDER BY d.created_at, d.id
     FOR UPDATE OF d
  LOOP
    v_pending := v_debit.pending_qty;

    SELECT COALESCE(quantity, 0)
      INTO v_prev
      FROM public.products
     WHERE id = v_debit.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto do débito pendente não encontrado' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.stock_movements (
      product_id, atelier_lot_id, lot_number,
      movement_type, quantity, previous_stock, new_stock,
      description, movement_reason, user_id, material_reservation_id
    ) VALUES (
      v_debit.product_id, p_lot_id, v_lot.lot_number,
      'in', v_pending, v_prev, v_prev + v_pending,
      'Entrada automática por ressalva no Ateliê — ' || v_audit,
      'ajuste', auth.uid(), v_debit.reservation_id
    )
    RETURNING id INTO v_in;

    UPDATE public.products
       SET quantity = quantity + v_pending,
           current_stock = quantity + v_pending,
           updated_at = now()
     WHERE id = v_debit.product_id;

    v_prev := v_prev + v_pending;

    INSERT INTO public.stock_movements (
      product_id, atelier_lot_id, lot_number,
      movement_type, quantity, previous_stock, new_stock,
      description, movement_reason, user_id, material_reservation_id
    ) VALUES (
      v_debit.product_id, p_lot_id, v_lot.lot_number,
      'out', v_pending, v_prev, v_prev - v_pending,
      'Baixa automática por ressalva no Ateliê — ' || v_audit,
      'consumo_op', auth.uid(), v_debit.reservation_id
    )
    RETURNING id INTO v_out;

    UPDATE public.products
       SET quantity = quantity - v_pending,
           current_stock = quantity - v_pending,
           updated_at = now()
     WHERE id = v_debit.product_id;

    UPDATE public.cabedal_prep_stock_debits
       SET quantity = COALESCE(quantity, 0) + v_pending,
           pending_qty = pending_qty - v_pending,
           fill_movement_ids = COALESCE(fill_movement_ids, ARRAY[]::uuid[]) || v_in || v_out,
           stock_movement_id = COALESCE(stock_movement_id, v_out)
     WHERE id = v_debit.id
       AND pending_qty >= v_pending - 0.0000001;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A falta do kit mudou durante a ressalva; nada foi zerado sem movimento'
        USING ERRCODE = '40001';
    END IF;

    IF v_debit.reservation_id IS NOT NULL THEN
      UPDATE public.material_reservations
         SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_pending,
             quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_pending),
             status = CASE
               WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_pending)
                    <= COALESCE(quantity_consumed, 0) + v_pending
                 THEN 'consumed'
               ELSE 'partially_consumed'
             END,
             consumed_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('atelier_consumed', true, 'ressalva_fill_movement_id', v_out),
             updated_at = now()
       WHERE id = v_debit.reservation_id;
    END IF;

    v_ins := v_ins + 1;
    v_outs := v_outs + 1;
  END LOOP;

  -- Componentes/tiras ainda sem débito de liberação: entra só a falta e a
  -- confirmação canônica faz a baixa do required.
  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);
  IF v_gate = 'awaiting_components' THEN
    FOR v_line IN
      SELECT r.product_id, r.required, r.available
        FROM public.atelier_lot_release_lines(p_lot_id) r
       WHERE r.available < r.required - 0.0000001
    LOOP
      v_short := v_line.required - GREATEST(COALESCE(v_line.available, 0), 0);
      IF v_short <= 0.0000001 THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(quantity, 0)
        INTO v_prev
        FROM public.products
       WHERE id = v_line.product_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto do componente pendente não encontrado' USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO public.stock_movements (
        product_id, atelier_lot_id, lot_number,
        movement_type, quantity, previous_stock, new_stock,
        description, movement_reason, user_id
      ) VALUES (
        v_line.product_id, p_lot_id, v_lot.lot_number,
        'in', v_short, v_prev, v_prev + v_short,
        'Entrada automática por ressalva no Ateliê — ' || v_audit,
        'ajuste', auth.uid()
      )
      RETURNING id INTO v_in;

      UPDATE public.products
         SET quantity = quantity + v_short,
             current_stock = quantity + v_short,
             updated_at = now()
       WHERE id = v_line.product_id;

      v_ins := v_ins + 1;
    END LOOP;

    v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);
    IF v_gate IS DISTINCT FROM 'awaiting_components' THEN
      PERFORM public.atelier_confirm_lot_release(p_lot_id);
      v_released := true;
    END IF;
  END IF;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);

  IF EXISTS (
    SELECT 1
      FROM public.cabedal_prep_stock_debits d
     WHERE d.lot_id = p_lot_id
       AND COALESCE(d.pending_qty, 0) > 0.0000001
  ) OR v_gate = 'awaiting_components' THEN
    RAISE EXCEPTION 'Não foi possível regularizar o kit do lote %: %',
      v_lot.lot_number,
      public.atelier_kit_pending_message(p_lot_id)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'lot_number', v_lot.lot_number,
    'entries', v_ins,
    'exits', v_outs,
    'release_confirmed', v_released,
    'kit_gate', v_gate,
    'kit_closed', public.atelier_lot_kit_is_closed(p_lot_id)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.atelier_settle_open_kit_shortages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_settle_open_kit_shortages(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_settle_open_kit_shortages(uuid) IS
  'Na ressalva, dá entrada da quantidade que falta e baixa o necessário no mesmo lote, sem estoque negativo. Idempotente quando pending_qty já está zerado.';

CREATE OR REPLACE FUNCTION public.atelier_kit_send_block_message(p_lot_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT 'O kit ainda não fechou: '
    || public.atelier_kit_pending_message(p_lot_id)
    || '. Confirme o envio com ressalva na tela: o sistema dá entrada automática na quantidade que falta e, na mesma operação, baixa o material necessário para o lote.';
$fn$;

REVOKE ALL ON FUNCTION public.atelier_kit_send_block_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_kit_send_block_message(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_confirm_open_kit_send(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_msg text;
  v_closed boolean;
  v_settle jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_lot_id IS NULL THEN
    RAISE EXCEPTION 'Informe o lote' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status IS DISTINCT FROM 'cut' THEN
    RAISE EXCEPTION 'Lote % precisa estar cortado para autorizar o envio com ressalva', v_lot.lot_number
      USING ERRCODE = '22023';
  END IF;

  v_closed := public.atelier_lot_kit_is_closed(p_lot_id);
  IF v_closed THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_closed', true,
      'lot_number', v_lot.lot_number,
      'kit_closed', true,
      'settled', jsonb_build_object('entries', 0, 'exits', 0)
    );
  END IF;

  v_msg := public.atelier_kit_pending_message(p_lot_id);
  v_settle := public.atelier_settle_open_kit_shortages(p_lot_id);
  v_closed := public.atelier_lot_kit_is_closed(p_lot_id);

  UPDATE public.atelier_lots
     SET open_kit_send_at = COALESCE(open_kit_send_at, now()),
         open_kit_send_by = COALESCE(open_kit_send_by, auth.uid()),
         open_kit_send_note = v_msg,
         updated_at = now()
   WHERE id = p_lot_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_closed', false,
    'lot_number', v_lot.lot_number,
    'kit_closed', v_closed,
    'note', v_msg,
    'settled', v_settle,
    'confirmed_at', (SELECT open_kit_send_at FROM public.atelier_lots WHERE id = p_lot_id)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.atelier_confirm_open_kit_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_confirm_open_kit_send(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_confirm_open_kit_send(uuid) IS
  'Confirma a ressalva: entra automaticamente a quantidade que falta, baixa o material do lote na mesma transação e autoriza o envio. A OS nasce no envio normal.';

COMMENT ON FUNCTION public.atelier_kit_allows_send(uuid) IS
  'Libera o envio se o kit fechou ou se o operador confirmou a ressalva (já com entrada e baixa regularizadas).';

COMMENT ON COLUMN public.atelier_lots.open_kit_send_at IS
  'Operador confirmou envio com kit pendente. A falta foi lançada e baixada automaticamente na ressalva.';
