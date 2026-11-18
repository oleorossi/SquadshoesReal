-- Entrada de estoque com débito pendente de corte do Ateliê quebrava a FK
-- stock_movements.lot_id → lot_tracking: apply_atelier_inbound e
-- atelier_confirm_lot_release gravavam atelier_lots.id nessa coluna.
-- O lote do Ateliê passa a morar em stock_movements.atelier_lot_id.
-- lot_id fica NULL.
--
-- Na mesma quinzena, pendência de corte já confirmado (e, depois, demanda
-- Ateliê ainda sem corte) vem antes do resto no rateio. A entrada quita o
-- corte ANTES de reallocate_product_commitments transformar o saldo livre
-- em empenho de outro PV. Reserva aberta 0 não impede essa quitação.

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS atelier_lot_id uuid;

COMMENT ON COLUMN public.stock_movements.atelier_lot_id IS
  'Lote do Ateliê (atelier_lots). Não é lot_tracking: lot_id continua sendo lote de material.';

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_atelier_lot_id_fkey'
  ) THEN
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_atelier_lot_id_fkey
      FOREIGN KEY (atelier_lot_id) REFERENCES public.atelier_lots(id)
      ON DELETE SET NULL;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_stock_movements_atelier_lot_id
  ON public.stock_movements (atelier_lot_id)
  WHERE atelier_lot_id IS NOT NULL;

-- 0 = corte do Ateliê já confirmado com pendência deste produto.
-- 1 = demanda do Ateliê ainda aguardando corte.
-- 2 = resto.
-- Só desempata DENTRO da quinzena. Não fura quinzena anterior.
CREATE OR REPLACE FUNCTION public.atelier_inbound_cover_tier(
  p_sale_order_id uuid,
  p_product_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_sale_order_id IS NULL THEN 2
    WHEN EXISTS (
      SELECT 1
        FROM public.cabedal_prep_stock_debits d
        JOIN public.atelier_lots l ON l.id = d.lot_id
       WHERE d.sale_order_id = p_sale_order_id
         AND (p_product_id IS NULL OR d.product_id = p_product_id)
         AND d.sector = 'corte_atelier'
         AND d.pending_qty > 0.0000001
         AND l.status = 'cut'
    ) THEN 0
    WHEN EXISTS (
      SELECT 1
        FROM public.cabedal_prep_demands dem
        JOIN public.cabedal_prep_jobs j ON j.demand_id = dem.id
       WHERE dem.sale_order_id = p_sale_order_id
         AND dem.status <> 'cancelled'
         AND j.pipeline_status = 'awaiting_cut'
    ) THEN 1
    ELSE 2
  END;
$$;

REVOKE ALL ON FUNCTION public.atelier_inbound_cover_tier(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_inbound_cover_tier(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_atelier_inbound(
  p_product_id uuid,
  p_movement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phys numeric;
  v_name text;
  v_need record;
  v_donor record;
  v_take numeric;
  v_free numeric;
  v_open numeric;
  v_held numeric;
  v_qty numeric;
  v_consume numeric;
  v_prev numeric;
  v_mov uuid;
  v_res uuid;
  v_lot uuid;
  v_filled int := 0;
  v_stolen int := 0;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_null');
  END IF;
  IF public.product_requires_strap_engine_write(p_product_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'strap_product');
  END IF;

  SELECT COALESCE(p.quantity, 0), p.name
    INTO v_phys, v_name
    FROM public.products p
   WHERE p.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_not_found');
  END IF;

  FOR v_need IN
    SELECT d.id,
           d.sale_order_id,
           d.lot_id,
           d.pending_qty,
           so.order_number,
           public.billing_fortnight_start(public.resolve_billing_week_for_order(d.sale_order_id)) AS fortnight,
           public.commitment_cover_priority(d.sale_order_id) AS prio
      FROM public.cabedal_prep_stock_debits d
      LEFT JOIN public.sale_orders so ON so.id = d.sale_order_id
     WHERE d.product_id = p_product_id
       AND d.sector = 'corte_atelier'
       AND d.pending_qty > 0.0000001
       AND d.lot_id IS NOT NULL
     ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(d.sale_order_id)) NULLS LAST,
              public.commitment_cover_priority(d.sale_order_id),
              d.created_at,
              d.id
     FOR UPDATE OF d
  LOOP
    SELECT mr.id,
           GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0)
      INTO v_res, v_open
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = v_need.sale_order_id
       AND mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep', 'component')
       AND mr.strap_variant_id IS NULL
     ORDER BY mr.created_at
     LIMIT 1
     FOR UPDATE;

    SELECT v_phys - COALESCE(sum(GREATEST(
             COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0
           )), 0)
      INTO v_free
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed');
    v_free := GREATEST(COALESCE(v_free, 0), 0) + COALESCE(v_open, 0);

    IF COALESCE(v_open, 0) + v_free < v_need.pending_qty THEN
      FOR v_donor IN
        SELECT mr.id,
               mr.sale_order_id,
               so.order_number,
               GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0) AS open_qty,
               public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) AS fortnight,
               public.commitment_cover_priority(mr.sale_order_id) AS prio
          FROM public.material_reservations mr
          LEFT JOIN public.sale_orders so ON so.id = mr.sale_order_id
         WHERE mr.product_id = p_product_id
           AND mr.id IS DISTINCT FROM v_res
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component')
           AND mr.sale_order_id IS DISTINCT FROM v_need.sale_order_id
           AND GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0) > 0
           AND public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id))
               >= COALESCE(v_need.fortnight, '0001-01-01'::date)
           AND public.atelier_inbound_cover_tier(mr.sale_order_id, p_product_id) > 0
           AND NOT EXISTS (
             SELECT 1
               FROM public.cabedal_prep_stock_debits stuck
              WHERE stuck.sale_order_id = mr.sale_order_id
                AND stuck.product_id = p_product_id
                AND stuck.sector = 'corte_atelier'
                AND stuck.pending_qty > 0.0000001
           )
         ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) DESC,
                  public.atelier_inbound_cover_tier(mr.sale_order_id, p_product_id) DESC,
                  public.commitment_cover_priority(mr.sale_order_id) DESC,
                  mr.created_at DESC
         FOR UPDATE OF mr
      LOOP
        EXIT WHEN COALESCE(v_open, 0) + v_free >= v_need.pending_qty;
        v_take := LEAST(
          v_donor.open_qty,
          v_need.pending_qty - COALESCE(v_open, 0) - v_free
        );
        IF v_take <= 0 THEN
          CONTINUE;
        END IF;
        UPDATE public.material_reservations
           SET quantity_reserved = quantity_reserved - v_take,
               quantity_short = COALESCE(quantity_short, 0) + v_take,
               updated_at = now()
         WHERE id = v_donor.id;
        IF v_res IS NOT NULL THEN
          UPDATE public.material_reservations
             SET quantity_reserved = quantity_reserved + v_take,
                 quantity_short = GREATEST(COALESCE(quantity_short, 0) - v_take, 0),
                 updated_at = now()
           WHERE id = v_res;
          v_open := COALESCE(v_open, 0) + v_take;
        END IF;
        INSERT INTO public.reservation_reallocations (
          product_id, product_name, from_sale_order_id, to_sale_order_id,
          from_order_number, to_order_number, quantity, reason, stock_movement_id
        ) VALUES (
          p_product_id, v_name, v_donor.sale_order_id, v_need.sale_order_id,
          v_donor.order_number, v_need.order_number, v_take,
          'Ateliê parado na mesma quinzena ou quinzena anterior tomou empenho de PV com prazo pior',
          p_movement_id
        );
        v_stolen := v_stolen + 1;
      END LOOP;
    END IF;

    SELECT COALESCE(sum(GREATEST(
             COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0
           )), 0)
      INTO v_held
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND mr.id IS DISTINCT FROM v_res;

    SELECT COALESCE(quantity, 0) INTO v_prev
      FROM public.products WHERE id = p_product_id FOR UPDATE;
    -- Reserva aberta zero não bloqueia a quitação do corte. Entra o físico
    -- que não está empenhado nos outros PVs (o empenho deste PV, se houver,
    -- também entra porque ficou de fora de v_held).
    v_qty := LEAST(
      v_need.pending_qty,
      GREATEST(COALESCE(v_prev, 0) - COALESCE(v_held, 0), 0)
    );

    -- Sem saldo que caiba, a falta permanece. Não zera pending_qty.
    IF v_qty <= 0.0000001 THEN
      CONTINUE;
    END IF;

    UPDATE public.products
       SET quantity = quantity - v_qty, updated_at = now()
     WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
      product_id, order_id, lot_id, atelier_lot_id, movement_type, quantity,
      previous_stock, new_stock, description, movement_reason
    ) VALUES (
      p_product_id, NULL, NULL, v_need.lot_id, 'out', v_qty,
      v_prev, v_prev - v_qty,
      'Ateliê · corte completado pela entrada · lote ' || v_need.lot_id::text,
      'consumo_op'
    )
    RETURNING id INTO v_mov;

    UPDATE public.cabedal_prep_stock_debits
       SET quantity = COALESCE(quantity, 0) + v_qty,
           pending_qty = pending_qty - v_qty,
           fill_movement_ids = fill_movement_ids || v_mov
     WHERE id = v_need.id
       AND pending_qty >= v_qty - 0.0000001;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falta do corte mudou durante a entrada; nada foi zerado sem movimento';
    END IF;

    v_consume := LEAST(COALESCE(v_open, 0), v_qty);
    IF v_res IS NOT NULL AND v_consume > 0 THEN
      UPDATE public.material_reservations
         SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_consume,
             quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_consume),
             status = CASE
               WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_consume)
                    <= COALESCE(quantity_consumed, 0) + v_consume
                 THEN 'consumed'
               ELSE 'partially_consumed'
             END,
             consumed_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb)
               || jsonb_build_object('atelier_consumed', true, 'cut_fill_movement_id', v_mov),
             updated_at = now()
       WHERE id = v_res;
    END IF;

    v_phys := v_prev - v_qty;
    v_filled := v_filled + 1;
    v_lot := v_need.lot_id;

    IF public.atelier_lot_kit_is_closed(v_lot)
       AND EXISTS (
         SELECT 1
           FROM public.cabedal_prep_jobs j
          WHERE j.lot_id = v_lot
            AND COALESCE(j.execution_mode, 'contractor') <> 'internal'
            AND j.pipeline_status = 'cut'
       ) THEN
      PERFORM public.atelier_confirm_lot_release(v_lot);
      UPDATE public.atelier_lots
         SET dispatch_signal = 'Kit pronto. Escolha o prestador e envie — o envio não foi feito sozinho.',
             updated_at = now()
       WHERE id = v_lot;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'filled', v_filled, 'reallocations', v_stolen, 'product_id', p_product_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_atelier_inbound(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_atelier_inbound(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_release(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_line record;
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_lines int := 0;
  v_pending int := 0;
  v_skipped int := 0;
  v_gate text;
  v_already boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('atelier-release:' || p_lot_id::text, 0));

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status <> 'cut' THEN
    RAISE EXCEPTION 'Lote % precisa estar cortado', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);
  IF v_gate = 'awaiting_components' THEN
    RAISE EXCEPTION 'Ainda falta estoque de componentes/tiras no lote %', v_lot.lot_number
      USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT * FROM public.atelier_lot_release_lines(p_lot_id)
  LOOP
    -- Idempotência: débito liberacao_atelier deste lote+item+produto já existe.
    -- Ignora ANTES de alterar o estoque. Segunda chamada (envio ou entrada) não duplica.
    SELECT EXISTS (
      SELECT 1
        FROM public.cabedal_prep_stock_debits s
       WHERE s.lot_id = p_lot_id
         AND s.sale_order_item_id = v_line.sale_order_item_id
         AND s.product_id = v_line.product_id
         AND s.sector = 'liberacao_atelier'
       FOR UPDATE
    ) INTO v_already;
    IF v_already THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT quantity INTO v_prev FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    v_debit := LEAST(GREATEST(COALESCE(v_prev, 0), 0), v_line.required);
    v_mov := NULL;

    IF v_debit > 0 THEN
      UPDATE public.products
         SET quantity = quantity - v_debit, updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.stock_movements (
        product_id, order_id, lot_id, atelier_lot_id, movement_type, quantity,
        previous_stock, new_stock, description, movement_reason
      ) VALUES (
        v_line.product_id, NULL, NULL, p_lot_id, 'out', v_debit,
        v_prev, v_prev - v_debit,
        'Ateliê · liberação ' || v_lot.lot_number || ' · ' || v_line.component,
        'consumo_op'
      )
      RETURNING id INTO v_mov;

      SELECT mr.id INTO v_res_id
        FROM public.material_reservations mr
       WHERE mr.sale_order_id = v_line.sale_order_id
         AND mr.product_id = v_line.product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
       ORDER BY mr.created_at
       LIMIT 1
       FOR UPDATE;

      IF v_res_id IS NOT NULL THEN
        UPDATE public.material_reservations
           SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debit,
               quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit),
               status = CASE
                 WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit)
                      <= COALESCE(quantity_consumed, 0) + v_debit
                   THEN 'consumed'
                 ELSE 'partially_consumed'
               END,
               consumed_at = now(),
               metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('atelier_consumed', true),
               updated_at = now()
         WHERE id = v_res_id;
      END IF;
    ELSE
      v_res_id := NULL;
    END IF;

    INSERT INTO public.cabedal_prep_stock_debits (
      sale_order_id, sale_order_item_id, product_id, quantity,
      required_qty, pending_qty, component,
      stock_movement_id, sector, lot_id, reservation_id
    )
    SELECT
      v_line.sale_order_id, v_line.sale_order_item_id, v_line.product_id, v_debit,
      v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
      v_mov, 'liberacao_atelier', p_lot_id, v_res_id
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.cabedal_prep_stock_debits s
        WHERE s.lot_id = p_lot_id
          AND s.sale_order_item_id = v_line.sale_order_item_id
          AND s.product_id = v_line.product_id
          AND s.sector = 'liberacao_atelier'
     );
    IF NOT FOUND THEN
      IF v_mov IS NOT NULL THEN
        RAISE EXCEPTION 'Liberação do lote % disputou o mesmo item; a transação foi desfeita para não debitar duas vezes',
          v_lot.lot_number
          USING ERRCODE = '40001';
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_lines := v_lines + 1;
    IF v_line.required - v_debit > 0 THEN
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'lines', v_lines, 'pending_lines', v_pending,
    'skipped_already_debited', v_skipped, 'kit_gate', v_gate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_confirm_lot_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_release(uuid) TO authenticated, service_role;

-- Dentro da quinzena: corte confirmado, depois demanda Ateliê, depois o resto.
-- A quinzena continua na frente do tier (NULLS LAST na cobertura, NULLS FIRST no corte).
DO $patch_reallocate$
DECLARE
  v_def text;
  v_asc int;
  v_desc int;
  v_tiers int;
BEGIN
  SELECT pg_get_functiondef('public.reallocate_product_commitments(uuid, uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reallocate_product_commitments(uuid, uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'atelier_inbound_cover_tier') > 0 THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_asc
    FROM regexp_matches(
      v_def,
      'material_reservation_cover_priority\(mr\.sale_order_id, mr\.order_id\) ASC',
      'g'
    );
  SELECT count(*) INTO v_desc
    FROM regexp_matches(
      v_def,
      'material_reservation_cover_priority\(mr\.sale_order_id, mr\.order_id\) DESC',
      'g'
    );
  IF v_asc <> 2 OR v_desc <> 2 THEN
    RAISE EXCEPTION 'reallocate: esperava 2 ORDER BY ASC e 2 DESC, achei % / %', v_asc, v_desc;
  END IF;
  v_def := regexp_replace(
    v_def,
    'ORDER BY public\.material_reservation_cover_priority\(mr\.sale_order_id, mr\.order_id\) ASC,\s+mr\.created_at ASC, mr\.id ASC',
    'ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) NULLS LAST, public.atelier_inbound_cover_tier(mr.sale_order_id, mr.product_id) ASC, public.material_reservation_cover_priority(mr.sale_order_id, mr.order_id) ASC, mr.created_at ASC, mr.id ASC',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    'ORDER BY public\.material_reservation_cover_priority\(mr\.sale_order_id, mr\.order_id\) DESC,\s+mr\.created_at DESC, mr\.id DESC',
    'ORDER BY public.billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) DESC NULLS FIRST, public.atelier_inbound_cover_tier(mr.sale_order_id, mr.product_id) DESC, public.material_reservation_cover_priority(mr.sale_order_id, mr.order_id) DESC, mr.created_at DESC, mr.id DESC',
    'g'
  );
  SELECT count(*) INTO v_tiers
    FROM regexp_matches(v_def, 'atelier_inbound_cover_tier\(mr\.sale_order_id, mr\.product_id\)', 'g');
  IF v_tiers <> 4 THEN
    RAISE EXCEPTION 'reallocate: a prioridade do Ateliê não entrou nos 4 ORDER BY (achei %)', v_tiers;
  END IF;
  EXECUTE v_def;
END
$patch_reallocate$;

CREATE OR REPLACE FUNCTION public.tg_cover_commitments_on_stock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'in'
     AND NEW.product_id IS NOT NULL
     AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM public.cover_open_material_commitments(NEW.product_id, NEW.quantity, NEW.id);
    -- Corte confirmado quita antes do rateio. A entrada livre não pode virar
    -- empenho de outro PV da mesma quinzena enquanto houver pending de corte.
    PERFORM public.apply_atelier_inbound(NEW.product_id, NEW.id);
    BEGIN
      PERFORM public.reallocate_product_commitments(NEW.product_id, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_cover_commitments_on_stock_in] realocação falhou para %: %',
        NEW.product_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Guarda somente leitura. Não grava estoque, PV nem lote.
CREATE OR REPLACE FUNCTION public.run_atelier_stock_lot_guards()
RETURNS TABLE (case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apply text;
  v_release text;
  v_trigger text;
  v_realloc text;
  v_tier text;
  v_del text;
  v_ref text;
BEGIN
  v_apply := pg_get_functiondef('public.apply_atelier_inbound(uuid, uuid)'::regprocedure);
  v_release := pg_get_functiondef('public.atelier_confirm_lot_release(uuid)'::regprocedure);
  v_trigger := pg_get_functiondef('public.tg_cover_commitments_on_stock_in()'::regprocedure);
  v_realloc := pg_get_functiondef('public.reallocate_product_commitments(uuid, uuid)'::regprocedure);
  v_tier := pg_get_functiondef('public.atelier_inbound_cover_tier(uuid, uuid)'::regprocedure);

  case_name := 'coluna_atelier_lot_id';
  ok := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'stock_movements'
       AND column_name = 'atelier_lot_id'
       AND is_nullable = 'YES'
       AND udt_name = 'uuid'
  );
  message := 'stock_movements.atelier_lot_id uuid NULL';
  RETURN NEXT;

  SELECT c.confdeltype::text, rel.relname
    INTO v_del, v_ref
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.confrelid
   WHERE c.conname = 'stock_movements_atelier_lot_id_fkey';
  case_name := 'fk_on_delete_set_null';
  ok := v_del = 'n' AND v_ref = 'atelier_lots';
  message := COALESCE(v_ref, '?') || ' del=' || COALESCE(v_del, '?');
  RETURN NEXT;

  case_name := 'indice_atelier_lot_id';
  ok := EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_stock_movements_atelier_lot_id'
       AND indexdef ILIKE '%atelier_lot_id%'
  );
  message := 'idx_stock_movements_atelier_lot_id';
  RETURN NEXT;

  case_name := 'entrada_grava_atelier_lot_id';
  ok := strpos(v_apply, 'atelier_lot_id') > 0
    AND strpos(v_apply, 'NULL, NULL, v_need.lot_id') > 0
    AND strpos(v_apply, 'Ateliê · corte completado pela entrada') > 0;
  message := 'INSERT da entrada usa atelier_lot_id e deixa lot_id NULL';
  RETURN NEXT;

  case_name := 'entrada_nao_grava_lot_tracking';
  ok := strpos(replace(v_apply, 'NULL, NULL, v_need.lot_id', ''), 'NULL, v_need.lot_id') = 0;
  message := 'apply_atelier_inbound não põe atelier_lots.id em lot_id';
  RETURN NEXT;

  case_name := 'entrada_quita_sem_reserva_aberta';
  ok := strpos(v_apply, 'LEAST(v_qty, COALESCE(v_open, 0))') = 0
    AND strpos(v_apply, 'Reserva aberta zero não bloqueia') > 0
    AND strpos(v_apply, 'v_held') > 0;
  message := 'pending do corte quita com físico livre mesmo se a reserva aberta é 0';
  RETURN NEXT;

  case_name := 'entrada_movimento_antes_de_zerar_pending';
  ok := strpos(v_apply, 'INSERT INTO public.stock_movements') > 0
    AND strpos(v_apply, 'INSERT INTO public.stock_movements')
        < strpos(v_apply, 'pending_qty = pending_qty - v_qty')
    AND strpos(v_apply, 'Não zera pending_qty') > 0;
  message := 'saída Ateliê · corte completado pela entrada antes de baixar pending';
  RETURN NEXT;

  case_name := 'liberacao_grava_atelier_lot_id';
  ok := strpos(v_release, 'atelier_lot_id') > 0
    AND strpos(v_release, 'NULL, NULL, p_lot_id') > 0
    AND strpos(v_release, 'Ateliê · liberação') > 0
    AND strpos(v_release, 'v_debit > 0') > 0;
  message := 'liberação com débito de kit grava atelier_lot_id';
  RETURN NEXT;

  case_name := 'liberacao_nao_grava_lot_tracking';
  ok := strpos(replace(v_release, 'NULL, NULL, p_lot_id', ''), 'NULL, p_lot_id') = 0
    AND strpos(v_release, 's.sector = ''liberacao_atelier''') > 0
    AND strpos(v_release, 's.sector = ''liberacao_atelier''')
        < strpos(v_release, 'UPDATE public.products');
  message := 'atelier_confirm_lot_release não põe p_lot_id em lot_id e continua idempotente';
  RETURN NEXT;

  case_name := 'gatilho_entrada_quita_corte_antes_do_rateio';
  ok := strpos(v_trigger, 'apply_atelier_inbound') > 0
    AND strpos(v_trigger, 'reallocate_product_commitments') > strpos(v_trigger, 'apply_atelier_inbound');
  message := 'tg_cover_commitments_on_stock_in chama o corte antes do rateio';
  RETURN NEXT;

  case_name := 'rateio_prioriza_corte_na_quinzena';
  ok := strpos(v_realloc, 'billing_fortnight_start') > 0
    AND strpos(v_realloc, 'atelier_inbound_cover_tier') > 0
    AND strpos(v_tier, 'corte_atelier') > 0
    AND strpos(v_tier, 'awaiting_cut') > 0
    AND strpos(v_tier, 'THEN 0') > 0
    AND strpos(v_tier, 'THEN 1') > 0
    AND strpos(v_tier, 'ELSE 2') > 0;
  message := 'na mesma quinzena: corte confirmado, depois demanda Ateliê, depois o resto';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_atelier_stock_lot_guards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_atelier_stock_lot_guards() TO authenticated, service_role;
