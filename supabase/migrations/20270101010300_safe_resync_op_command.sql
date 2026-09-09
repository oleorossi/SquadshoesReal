-- Resync explícito e transacional de uma OP ativa.
--
-- Ordem load-bearing:
--   1. locks + receipt idempotente;
--   2. restaura saldos escalares/grade a partir do fato efetivamente debitado;
--   3. somente depois remove estado derivado genérico;
--   4. reconstrói via overload canônico protegido de seis argumentos;
--   5. preserva integralmente reservas/movimentos do motor canônico de tiras.
--
-- Não há UPDATE/loop de backfill nesta migration: histórico só muda quando um
-- operador autorizado chama resync_op_atomic para uma OP específica.

BEGIN;

-- O snapshot ativo possui UNIQUE(sale_order_id, sale_order_item_id) e o helper
-- vivo o sobrescreve por UPSERT. Antes de abrir espaço para o novo snapshot,
-- copiamos o payload integral para uma trilha imutável e fechada por RLS.
CREATE TABLE public.sale_order_resync_snapshot_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_snapshot_id uuid NOT NULL,
  sale_order_id uuid NOT NULL,
  sale_order_item_id uuid,
  order_id uuid NOT NULL,
  command_receipt_id uuid NOT NULL
    REFERENCES public.sale_order_command_receipts(id) ON DELETE RESTRICT,
  snapshot_payload jsonb NOT NULL
    CHECK (jsonb_typeof(snapshot_payload) = 'object'),
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid,
  UNIQUE (command_receipt_id, original_snapshot_id)
);

-- Movimentos nunca são apagados nem desassociados da OP. Esta relação liga
-- cada OUT aposentado ao IN compensatório e permite que o próximo resync ignore
-- fatos já compensados sem perder a reconstrução do ledger.
CREATE TABLE public.sale_order_resync_movement_supersessions (
  original_movement_id uuid PRIMARY KEY
    REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reversal_movement_id uuid NOT NULL UNIQUE
    REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  command_receipt_id uuid NOT NULL
    REFERENCES public.sale_order_command_receipts(id) ON DELETE RESTRICT,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid
);

ALTER TABLE public.sale_order_resync_snapshot_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_order_resync_movement_supersessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sale_order_resync_snapshot_history
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_order_resync_movement_supersessions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sale_order_resync_snapshot_history TO service_role;
GRANT ALL ON TABLE public.sale_order_resync_movement_supersessions TO service_role;

-- O idempotency guard do motor canônico não pode interpretar uma reserva de
-- tira preservada como "todo o material genérico já foi reservado".
DO $patch_hybrid_guard$
DECLARE
  v_definition text;
  v_old text := $old$  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;$old$;
  v_new text := $new$  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
       AND strap_variant_id IS NULL
       AND sale_order_strap_demand_id IS NULL
       AND strap_stock_floor_contribution_id IS NULL
       AND strap_batch_item_id IS NULL
       AND service_order_item_id IS NULL
       AND COALESCE(metadata ->> 'kind', '') <> 'strap'
       AND COALESCE(source, '') NOT IN (
         'strap_engine_finished', 'strap_engine_base', 'strap_demand'
       )
  ) INTO v_already_debited;$new$;
BEGIN
  SELECT pg_get_functiondef(
           'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure
         )
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Motor canônico hybrid_debit_stock_for_order(6 args) ausente';
  END IF;

  IF position('sale_order_strap_demand_id IS NULL' IN v_definition) = 0 THEN
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Guard idempotente inesperado no hybrid_debit canônico';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  END IF;
END;
$patch_hybrid_guard$;

-- Helper interno: reverte somente movimentos OUT ainda atribuídos à OP. Para
-- grade, usa previous_grade-new_grade; no legado sem snapshots aceita apenas a
-- reserva sole_grade CONSUMIDA cuja effective_grade fecha exatamente a baixa.
-- Nunca usa a grade pedida da OP como se fosse a grade debitada.
CREATE OR REPLACE FUNCTION public.restore_order_stock_for_safe_resync(
  p_order_id uuid,
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov record;
  v_product record;
  v_box record;
  v_current_grade jsonb;
  v_restored_grade jsonb;
  v_effective_grade jsonb;
  v_key text;
  v_delta numeric;
  v_grade_total numeric;
  v_candidate_count integer;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_scalar_count integer := 0;
  v_grade_count integer := 0;
  v_box_count integer := 0;
  v_movement_ids jsonb := '[]'::jsonb;
  v_reversal_id uuid;
BEGIN
  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Função interna: use resync_op_atomic'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.stock_movements sm
     WHERE sm.order_id = p_order_id
       AND sm.movement_type = 'in'
       AND sm.strap_variant_id IS NULL
       AND sm.sale_order_strap_demand_id IS NULL
       AND sm.strap_stock_floor_contribution_id IS NULL
       AND sm.strap_batch_item_id IS NULL
       AND sm.service_order_item_id IS NULL
       AND (
         COALESCE(
           current_setting(
             'app.sale_order_command_restore_legacy_strap',
             true
           ),
           ''
         ) = '1'
         OR COALESCE(sm.description, '') NOT ILIKE 'Debito Tira%'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_resync_movement_supersessions rms
          WHERE rms.reversal_movement_id = sm.id
       )
  ) THEN
    RAISE EXCEPTION
      'OP % possui entrada/estorno legado sem causalidade; restauração automática recusada',
      p_order_id
      USING ERRCODE = 'PZ106';
  END IF;

  FOR v_mov IN
    SELECT sm.*
      FROM public.stock_movements sm
     WHERE sm.order_id = p_order_id
       AND sm.movement_type = 'out'
       AND sm.strap_variant_id IS NULL
       AND sm.sale_order_strap_demand_id IS NULL
       AND sm.strap_stock_floor_contribution_id IS NULL
       AND sm.strap_batch_item_id IS NULL
       AND sm.service_order_item_id IS NULL
       AND (
         COALESCE(
           current_setting(
             'app.sale_order_command_restore_legacy_strap',
             true
           ),
           ''
         ) = '1'
         OR COALESCE(sm.description, '') NOT ILIKE 'Debito Tira%'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_resync_movement_supersessions rms
          WHERE rms.original_movement_id = sm.id
       )
     ORDER BY sm.product_id, sm.id
  LOOP
    SELECT p.id, p.quantity, p.stock_grade, p.unit
      INTO v_product
      FROM public.products p
     WHERE p.id = v_mov.product_id
     FOR UPDATE;

    IF FOUND THEN
      v_effective_grade := NULL;

      IF v_mov.previous_grade IS NOT NULL
         AND v_mov.new_grade IS NOT NULL THEN
        v_effective_grade := '{}'::jsonb;
        FOR v_key IN
          SELECT jsonb_object_keys(
            COALESCE(v_mov.previous_grade, '{}'::jsonb)
            || COALESCE(v_mov.new_grade, '{}'::jsonb)
          )
        LOOP
          CONTINUE WHEN left(v_key, 1) = '_';
          v_delta := COALESCE((v_mov.previous_grade ->> v_key)::numeric, 0)
                     - COALESCE((v_mov.new_grade ->> v_key)::numeric, 0);
          IF v_delta < 0 THEN
            RAISE EXCEPTION
              'Movimento % aumenta grade no OUT (% = %); resync recusado',
              v_mov.id,
              v_key,
              v_delta;
          END IF;
          IF v_delta > 0 THEN
            v_effective_grade := jsonb_set(
              v_effective_grade,
              ARRAY[v_key],
              to_jsonb(v_delta),
              true
            );
          END IF;
        END LOOP;
      ELSIF EXISTS (
        SELECT 1
          FROM jsonb_each(COALESCE(v_product.stock_grade, '{}'::jsonb)) g(k, v)
         WHERE left(g.k, 1) <> '_'
      ) OR v_mov.description ILIKE '%solado%grade%' THEN
        SELECT count(*)::integer
          INTO v_candidate_count
          FROM public.material_reservations mr
         WHERE mr.order_id = p_order_id
           AND mr.product_id = v_mov.product_id
           AND mr.metadata ->> 'kind' = 'sole_grade'
           AND mr.status IN ('consumed', 'converted')
           AND COALESCE(mr.quantity_consumed, 0) > 0
           AND jsonb_typeof(mr.metadata -> 'effective_grade') = 'object'
           AND abs(
             COALESCE((
               SELECT sum(e.value::numeric)
                 FROM jsonb_each_text(mr.metadata -> 'effective_grade') e
             ), 0) - v_mov.quantity
           ) <= 0.0001;

        IF v_candidate_count <> 1 THEN
          RAISE EXCEPTION
            'Baixa de grade % sem snapshot tem % reservas consumidas compatíveis; resync recusado',
            v_mov.id,
            v_candidate_count;
        END IF;

        SELECT mr.metadata -> 'effective_grade'
          INTO v_effective_grade
          FROM public.material_reservations mr
         WHERE mr.order_id = p_order_id
           AND mr.product_id = v_mov.product_id
           AND mr.metadata ->> 'kind' = 'sole_grade'
           AND mr.status IN ('consumed', 'converted')
           AND COALESCE(mr.quantity_consumed, 0) > 0
           AND jsonb_typeof(mr.metadata -> 'effective_grade') = 'object'
           AND abs(
             COALESCE((
               SELECT sum(e.value::numeric)
                 FROM jsonb_each_text(mr.metadata -> 'effective_grade') e
             ), 0) - v_mov.quantity
           ) <= 0.0001
         ORDER BY mr.created_at, mr.id
         LIMIT 1;
      END IF;

      IF v_effective_grade IS NOT NULL
         AND v_effective_grade <> '{}'::jsonb THEN
        SELECT COALESCE(sum(e.value::numeric), 0)
          INTO v_grade_total
          FROM jsonb_each_text(v_effective_grade) e;
        IF abs(v_grade_total - v_mov.quantity) > 0.0001 THEN
          RAISE EXCEPTION
            'Grade efetivamente debitada (%) não fecha com movimento % (%)',
            v_grade_total,
            v_mov.id,
            v_mov.quantity;
        END IF;

        v_current_grade := COALESCE(v_product.stock_grade, '{}'::jsonb);
        v_restored_grade := v_current_grade;
        FOR v_key, v_delta IN
          SELECT e.key, e.value::numeric
            FROM jsonb_each_text(v_effective_grade) e
           WHERE left(e.key, 1) <> '_'
             AND e.value::numeric > 0
        LOOP
          v_restored_grade := jsonb_set(
            v_restored_grade,
            ARRAY[v_key],
            to_jsonb(COALESCE((v_restored_grade ->> v_key)::numeric, 0) + v_delta),
            true
          );
        END LOOP;

        v_prev_stock := v_product.quantity;
        v_new_stock := v_prev_stock + v_mov.quantity;
        UPDATE public.products
           SET stock_grade = v_restored_grade,
               quantity = v_new_stock,
               updated_at = now()
         WHERE id = v_mov.product_id;

        INSERT INTO public.stock_movements(
          product_id,
          movement_type,
          quantity,
          previous_stock,
          new_stock,
          previous_grade,
          new_grade,
          description,
          movement_reason,
          order_id,
          correlation_id
        ) VALUES (
          v_mov.product_id,
          'in',
          v_mov.quantity,
          v_prev_stock,
          v_new_stock,
          v_current_grade,
          v_restored_grade,
          'Estorno resync seguro — movimento ' || v_mov.id::text,
          'estorno',
          p_order_id,
          v_mov.id
        )
        RETURNING id INTO v_reversal_id;

        INSERT INTO public.sale_order_resync_movement_supersessions(
          original_movement_id,
          reversal_movement_id,
          order_id,
          command_receipt_id,
          superseded_by
        ) VALUES (
          v_mov.id,
          v_reversal_id,
          p_order_id,
          p_receipt_id,
          auth.uid()
        );
        v_grade_count := v_grade_count + 1;
      ELSE
        -- Produto sem grade real: restauração escalar exata.
        IF EXISTS (
          SELECT 1
            FROM jsonb_each(COALESCE(v_product.stock_grade, '{}'::jsonb)) g(k, v)
           WHERE left(g.k, 1) <> '_'
        ) THEN
          RAISE EXCEPTION
            'Produto % tem grade, mas movimento % não identifica buckets debitados',
            v_mov.product_id,
            v_mov.id;
        END IF;

        v_prev_stock := v_product.quantity;
        v_new_stock := v_prev_stock + v_mov.quantity;
        UPDATE public.products
           SET quantity = v_new_stock,
               updated_at = now()
         WHERE id = v_mov.product_id;

        INSERT INTO public.stock_movements(
          product_id,
          movement_type,
          quantity,
          previous_stock,
          new_stock,
          description,
          movement_reason,
          order_id,
          correlation_id
        ) VALUES (
          v_mov.product_id,
          'in',
          v_mov.quantity,
          v_prev_stock,
          v_new_stock,
          'Estorno resync seguro — movimento ' || v_mov.id::text,
          'estorno',
          p_order_id,
          v_mov.id
        )
        RETURNING id INTO v_reversal_id;

        INSERT INTO public.sale_order_resync_movement_supersessions(
          original_movement_id,
          reversal_movement_id,
          order_id,
          command_receipt_id,
          superseded_by
        ) VALUES (
          v_mov.id,
          v_reversal_id,
          p_order_id,
          p_receipt_id,
          auth.uid()
        );
        v_scalar_count := v_scalar_count + 1;
      END IF;
    ELSE
      SELECT bt.id, bt.quantity
        INTO v_box
        FROM public.box_types bt
       WHERE bt.id = v_mov.product_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Produto/embalagem % do movimento % não existe; resync recusado',
          v_mov.product_id,
          v_mov.id;
      END IF;

      v_prev_stock := v_box.quantity;
      v_new_stock := v_prev_stock + v_mov.quantity;
      UPDATE public.box_types
         SET quantity = v_new_stock,
             updated_at = now()
       WHERE id = v_mov.product_id;

      INSERT INTO public.stock_movements(
        product_id,
        movement_type,
        quantity,
        previous_stock,
        new_stock,
        description,
        movement_reason,
        order_id,
        correlation_id
      ) VALUES (
        v_mov.product_id,
        'in',
        v_mov.quantity,
        v_prev_stock,
        v_new_stock,
        'Estorno resync seguro embalagem — movimento ' || v_mov.id::text,
        'estorno',
        p_order_id,
        v_mov.id
      )
      RETURNING id INTO v_reversal_id;

      INSERT INTO public.sale_order_resync_movement_supersessions(
        original_movement_id,
        reversal_movement_id,
        order_id,
        command_receipt_id,
        superseded_by
      ) VALUES (
        v_mov.id,
        v_reversal_id,
        p_order_id,
        p_receipt_id,
        auth.uid()
      );
      v_box_count := v_box_count + 1;
    END IF;

    v_movement_ids := v_movement_ids || jsonb_build_array(v_mov.id);
  END LOOP;

  RETURN jsonb_build_object(
    'scalar_movements_restored', v_scalar_count,
    'grade_movements_restored', v_grade_count,
    'packaging_movements_restored', v_box_count,
    'restored_out_movement_ids', v_movement_ids,
    'receipt_id', p_receipt_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_order_stock_for_safe_resync(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_sale_order_version bigint;
  v_plan jsonb;
  v_request_hash text;
  v_idempotency_key text;
  v_receipt_id uuid;
  v_parent_receipt_setting text;
  v_nested_command boolean := false;
  v_existing record;
  v_restore jsonb;
  v_hybrid jsonb;
  v_sole jsonb;
  v_packaging jsonb;
  v_result jsonb;
  v_postcheck jsonb;
  v_previous_internal text;
  v_previous_stock_sync text;
  v_message text;
  v_sqlstate text;
  v_context text;
  v_committed_plan_id uuid;
  v_committed_source_hash text;
  v_snapshot_archive_count integer := 0;
BEGIN
  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1'
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode ressincronizar OP'
      USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.reference_id, o.quantity, o.color, o.grade,
         o.sale_order_id, o.sale_order_item_id, o.order_number,
         o.status, o.deleted_at
    INTO v_op
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sale-order-command:' || v_op.sale_order_id::text, 0)
  );
  -- Compatibilidade com writers vivos que ainda usam namespaces próprios.
  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('debit_sole:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('stock_debit:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('packaging_debit:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5('debit_strap:' || p_order_id::text), 1, 16))::bit(64)::bigint
  );
  PERFORM pg_advisory_xact_lock(hashtext('reserve:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('reserve_missing:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('try_reserve_materials:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('consume_reservations:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('convert_reservation:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtext('settle_reservations:' || p_order_id::text));

  SELECT o.id, o.reference_id, o.quantity, o.color, o.grade,
         o.sale_order_id, o.sale_order_item_id, o.order_number,
         o.status, o.deleted_at
    INTO v_op
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF v_op.deleted_at IS NOT NULL
     OR lower(COALESCE(v_op.status, '')) NOT IN (
       'reservado', 'em produção', 'em producao'
     ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'OP não ativa',
      'status', v_op.status,
      'order_id', p_order_id
    );
  END IF;
  IF v_op.sale_order_item_id IS NULL THEN
    RAISE EXCEPTION
      'OP % não possui sale_order_item_id estável; resync histórico recusado',
      p_order_id
      USING ERRCODE = 'PZ104';
  END IF;

  SELECT so.order_version
    INTO v_sale_order_version
    FROM public.sale_orders so
   WHERE so.id = v_op.sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV da OP % não encontrado', p_order_id;
  END IF;

  v_plan := public.build_sale_order_material_plan(v_op.sale_order_id);
  v_request_hash := md5(jsonb_build_object(
    'order_id', p_order_id,
    'reference_id', v_op.reference_id,
    'quantity', v_op.quantity,
    'color', v_op.color,
    'grade', v_op.grade,
    'sale_order_item_id', v_op.sale_order_item_id,
    'plan_source_hash', v_plan ->> 'source_hash'
  )::text);
  v_idempotency_key := 'resync:' || p_order_id::text || ':' || v_request_hash;

  v_parent_receipt_setting := current_setting(
    'app.sale_order_command_parent_receipt_id',
    true
  );
  v_nested_command := COALESCE(
    current_setting('app.sale_order_command_internal', true),
    ''
  ) = '1' AND NULLIF(v_parent_receipt_setting, '') IS NOT NULL;

  IF v_nested_command THEN
    BEGIN
      v_receipt_id := v_parent_receipt_setting::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Parent receipt inválido no command boundary'
        USING ERRCODE = 'PZ114';
    END;
    IF NOT EXISTS (
      SELECT 1
        FROM public.sale_order_command_receipts r
       WHERE r.id = v_receipt_id
         AND r.sale_order_id = v_op.sale_order_id
         AND r.status = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'Parent receipt não pertence ao PV/resync atual'
        USING ERRCODE = 'PZ114';
    END IF;
  ELSE
    SELECT id, request_hash, status, response
      INTO v_existing
      FROM public.sale_order_command_receipts
     WHERE sale_order_id = v_op.sale_order_id
       AND command_name = 'resync'
       AND idempotency_key = v_idempotency_key
     FOR UPDATE;

    IF FOUND THEN
      IF v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'Idempotency key de resync reutilizada com payload diferente'
          USING ERRCODE = '23505';
      END IF;
      IF v_existing.status = 'succeeded' THEN
        RETURN COALESCE(v_existing.response, '{}'::jsonb)
          || jsonb_build_object('replayed', true, 'receipt_id', v_existing.id);
      END IF;
    ELSE
      INSERT INTO public.sale_order_command_receipts(
        sale_order_id,
        aggregate_key,
        command_name,
        idempotency_key,
        request_hash,
        expected_order_version,
        order_version_before,
        status,
        actor_id
      ) VALUES (
        v_op.sale_order_id,
        v_op.sale_order_id::text,
        'resync',
        v_idempotency_key,
        v_request_hash,
        v_sale_order_version,
        v_sale_order_version,
        'in_progress',
        auth.uid()
      )
      RETURNING id INTO v_receipt_id;
    END IF;
    v_receipt_id := COALESCE(v_receipt_id, v_existing.id);
  END IF;

  -- Subtransação: qualquer erro desfaz integralmente restauração, teardown e
  -- reconstrução; o handler abaixo grava o receipt FORA dela.
  BEGIN
    v_previous_internal := current_setting('app.sale_order_command_internal', true);
    v_previous_stock_sync := current_setting('app.internal_stock_sync', true);
    PERFORM set_config('app.sale_order_command_internal', '1', true);
    PERFORM set_config('app.internal_stock_sync', '1', true);

    -- Picking/apontamento/consumo real são fatos de chão de fábrica e nunca
    -- são apagados/recriados por resync. O operador deve usar compensação.
    IF EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.order_id = p_order_id
         AND (
           COALESCE(os.quantity_processed, 0) > 0
           OR os.started_at IS NOT NULL
           OR os.completed_at IS NOT NULL
           OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.order_lots ol
       WHERE ol.order_id = p_order_id
         AND (
           ol.started_at IS NOT NULL
           OR ol.completed_at IS NOT NULL
           OR lower(COALESCE(ol.status, '')) NOT IN ('', 'pendente', 'pending')
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.production_consumptions pc
       WHERE pc.order_id = p_order_id
         AND pc.superseded_at IS NULL
         AND COALESCE(pc.actual_quantity, 0) > 0
    ) THEN
      RAISE EXCEPTION
        'OP % possui etapa/lote/consumo físico iniciado; resync destrutivo recusado',
        p_order_id
        USING ERRCODE = 'PZ105';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.material_reservations mr
       WHERE mr.order_id = p_order_id
         AND mr.strap_variant_id IS NULL
         AND mr.sale_order_strap_demand_id IS NULL
         AND mr.strap_stock_floor_contribution_id IS NULL
         AND mr.strap_batch_item_id IS NULL
         AND mr.service_order_item_id IS NULL
         AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
         AND (
           COALESCE(mr.quantity_consumed, 0) > 0
           OR mr.consumed_at IS NOT NULL
           OR lower(COALESCE(mr.status, '')) IN (
             'consumed', 'converted', 'pending_reconciliation'
           )
         )
    ) THEN
      RAISE EXCEPTION
        'OP % possui picking/consumo de reserva; resync exige compensação',
        p_order_id
        USING ERRCODE = 'PZ105';
    END IF;

    -- Um OUT antigo sem revisão comprometida não é "reparado" por
    -- inferência. Para fatos novos, o hash comprometido deve ser idêntico ao
    -- plano atual; mudança posterior exige comando compensatório explícito.
    IF EXISTS (
      SELECT 1
        FROM public.stock_movements sm
       WHERE sm.order_id = p_order_id
         AND sm.movement_type = 'out'
         AND sm.strap_variant_id IS NULL
         AND sm.sale_order_strap_demand_id IS NULL
         AND sm.strap_stock_floor_contribution_id IS NULL
         AND sm.strap_batch_item_id IS NULL
         AND sm.service_order_item_id IS NULL
         AND COALESCE(sm.description, '') NOT ILIKE 'Debito Tira%'
         AND NOT EXISTS (
           SELECT 1
             FROM public.sale_order_resync_movement_supersessions rms
            WHERE rms.original_movement_id = sm.id
         )
    ) THEN
      SELECT mpr.id, mpr.source_hash
        INTO v_committed_plan_id, v_committed_source_hash
        FROM public.sale_order_material_plan_revisions mpr
       WHERE mpr.sale_order_id = v_op.sale_order_id
         AND mpr.status = 'committed'
       ORDER BY mpr.committed_at DESC, mpr.revision_no DESC
       LIMIT 1;

      IF v_committed_plan_id IS NULL THEN
        RAISE EXCEPTION
          'OP % possui baixa anterior ao command boundary e sem plano comprometido; histórico não será auto-reparado',
          p_order_id
          USING ERRCODE = 'PZ107';
      END IF;
      IF v_committed_source_hash IS DISTINCT FROM v_plan ->> 'source_hash' THEN
        RAISE EXCEPTION
          'Plano comprometido da OP % diverge do plano atual; use compensação em vez de resync',
          p_order_id
          USING ERRCODE = 'PZ103';
      END IF;
    END IF;

    -- Primeiro o fato físico volta ao saldo.
    v_restore := public.restore_order_stock_for_safe_resync(
      p_order_id,
      v_receipt_id
    );

    -- Só agora o estado derivado genérico pode ser aposentado. Tiras canônicas
    -- permanecem ligadas à OP e não são recriadas por este caminho.
    UPDATE public.production_consumptions
       SET superseded_at = now(),
           superseded_reason = 'safe_resync_op_command:' || v_receipt_id::text
     WHERE order_id = p_order_id
       AND superseded_at IS NULL;

    UPDATE public.material_reservations mr
       SET status = 'cancelled',
           notes = concat_ws(
             ' | ',
             NULLIF(mr.notes, ''),
             'superseded por resync seguro ' || v_receipt_id::text
           ),
           correlation_id = v_receipt_id,
           updated_at = now()
     WHERE mr.order_id = p_order_id
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
       AND mr.strap_stock_floor_contribution_id IS NULL
       AND mr.strap_batch_item_id IS NULL
       AND mr.service_order_item_id IS NULL
       AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap'
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND mr.consumed_at IS NULL
       AND lower(COALESCE(mr.status, '')) NOT IN (
         'consumed', 'converted', 'pending_reconciliation', 'cancelled'
       )
       AND COALESCE(mr.source, '') NOT IN (
         'strap_engine_finished', 'strap_engine_base', 'strap_demand'
       );

    DELETE FROM public.order_stages
     WHERE order_id = p_order_id;

    INSERT INTO public.sale_order_resync_snapshot_history(
      original_snapshot_id,
      sale_order_id,
      sale_order_item_id,
      order_id,
      command_receipt_id,
      snapshot_payload,
      archived_by
    )
    SELECT tss.id,
           v_op.sale_order_id,
           v_op.sale_order_item_id,
           p_order_id,
           v_receipt_id,
           to_jsonb(tss),
           auth.uid()
      FROM public.technical_sheet_snapshots tss
     WHERE tss.sale_order_id = v_op.sale_order_id
       AND tss.sale_order_item_id = v_op.sale_order_item_id
    ON CONFLICT (command_receipt_id, original_snapshot_id) DO NOTHING;
    GET DIAGNOSTICS v_snapshot_archive_count = ROW_COUNT;

    -- Recalcula a projeção ativa por UPSERT, mantendo o mesmo snapshot_id.
    -- O estado anterior completo já foi arquivado acima; não há DELETE de
    -- snapshot nem quebra das referências históricas.
    PERFORM public.freeze_technical_sheet(
      v_op.reference_id,
      v_op.sale_order_id,
      v_op.sale_order_item_id,
      COALESCE(v_op.color, ''),
      v_op.quantity::numeric,
      NULL,
      NULLIF(COALESCE(v_op.grade, '{}'::jsonb), '{}'::jsonb)
    );
    UPDATE public.technical_sheet_snapshots tss
       SET sheet_id = ts.id,
           sheet_name = ts.name,
           sheet_version = ts.version,
           primary_sole_id = ts.primary_sole_id,
           sole_drives_consumption = ts.sole_drives_consumption,
           color = COALESCE(v_op.color, ''),
           quantity = v_op.quantity,
           outdated_at = NULL
      FROM public.technical_sheets ts
     WHERE tss.sale_order_id = v_op.sale_order_id
       AND tss.sale_order_item_id = v_op.sale_order_item_id
       AND ts.id = v_op.reference_id;

    -- Chamada nomeada com SEIS argumentos: nunca pode resolver para o overload
    -- inseguro legado de cinco argumentos.
    v_hybrid := public.hybrid_debit_stock_for_order(
      p_reference_id => v_op.reference_id,
      p_order_quantity => v_op.quantity::numeric,
      p_color => COALESCE(v_op.color, ''),
      p_order_id => p_order_id,
      p_order_grade => NULLIF(COALESCE(v_op.grade, '{}'::jsonb), '{}'::jsonb),
      p_force_soft => true
    );

    IF NULLIF(COALESCE(v_op.grade, '{}'::jsonb), '{}'::jsonb) IS NOT NULL THEN
      PERFORM public.debit_sole_stock_by_grade(
        p_reference_id => v_op.reference_id,
        p_order_id => p_order_id,
        p_color => COALESCE(v_op.color, ''),
        p_order_grade => v_op.grade,
        p_force_soft => true
      );
      v_sole := jsonb_build_object(
        'rebuilt', true,
        'mode', 'soft',
        'grade', v_op.grade
      );
    END IF;

    BEGIN
      v_packaging := public.debit_packaging_for_order(
        p_sale_order_id => v_op.sale_order_id,
        p_order_id => p_order_id,
        p_reference_id => v_op.reference_id,
        p_order_quantity => v_op.quantity::integer,
        p_packaging_mode => (
          SELECT so.packaging_mode
            FROM public.sale_orders so
           WHERE so.id = v_op.sale_order_id
        ),
        p_force_soft => false
      );
    EXCEPTION WHEN OTHERS THEN
      -- Paridade com promote_sale_order_item: falta de embalagem vira shortage,
      -- mas erro estrutural continua abortando toda a subtransação.
      IF SQLERRM !~* 'estoque insuficiente para embalagem' THEN
        RAISE;
      END IF;
      v_packaging := jsonb_build_object(
        'shortage', true,
        'message', SQLERRM
      );
    END;

    INSERT INTO public.order_stages(
      order_id,
      stage_name,
      stage_order,
      status,
      quantity_total,
      quantity_processed
    )
    SELECT p_order_id,
           route.stage_name,
           CASE
             WHEN public.canonical_stage_order(route.stage_name) = 99
               THEN route.ord::int
             ELSE public.canonical_stage_order(route.stage_name)
           END,
           'pendente',
           v_op.quantity,
           0
      FROM (
        SELECT u.stage_name, u.ord
          FROM unnest(COALESCE(
            (
              SELECT array_agg(s.value ORDER BY s.ord)
                FROM public.technical_sheets ts
                CROSS JOIN LATERAL jsonb_array_elements_text(
                  CASE
                    WHEN jsonb_typeof(ts.production_sectors) = 'array'
                      THEN ts.production_sectors
                    ELSE '[]'::jsonb
                  END
                ) WITH ORDINALITY AS s(value, ord)
               WHERE ts.id = v_op.reference_id
            ),
            ARRAY[
              'Corte Fibra', 'Corte Forração', 'Costura Palmilha',
              'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem',
              'Montagem', 'Solagem', 'Acabamento', 'Expedição'
            ]
          )) WITH ORDINALITY AS u(stage_name, ord)
      ) route;

    -- Diagnóstico apenas: não cria reservas de delta nem toca histórico além
    -- da OP explicitamente solicitada.
    v_postcheck := public.reserve_missing_materials_for_order(
      p_order_id,
      true
    );

    PERFORM set_config(
      'app.sale_order_command_internal',
      COALESCE(v_previous_internal, ''),
      true
    );
    PERFORM set_config(
      'app.internal_stock_sync',
      COALESCE(v_previous_stock_sync, ''),
      true
    );

    v_result := jsonb_build_object(
      'ok', true,
      'replayed', false,
      'receipt_id', v_receipt_id,
      'order_id', p_order_id,
      'order_number', v_op.order_number,
      'restoration', v_restore,
      'hybrid', v_hybrid,
      'sole', v_sole,
      'packaging', v_packaging,
      'archived_snapshot_count', v_snapshot_archive_count,
      'committed_plan_revision_id', v_committed_plan_id,
      'postcheck_dry_run', v_postcheck,
      'resynced_at', now()
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_sqlstate = RETURNED_SQLSTATE,
      v_context = PG_EXCEPTION_CONTEXT;
    v_result := jsonb_build_object(
      'ok', false,
      'replayed', false,
      'receipt_id', v_receipt_id,
      'order_id', p_order_id,
      'error', jsonb_build_object(
        'code', v_sqlstate,
        'message', v_message,
        'context', v_context
      )
    );
  END;

  IF NOT v_nested_command THEN
    UPDATE public.sale_order_command_receipts
       SET status = CASE WHEN COALESCE((v_result ->> 'ok')::boolean, false)
                         THEN 'succeeded' ELSE 'failed' END,
           response = v_result,
           error_code = CASE WHEN COALESCE((v_result ->> 'ok')::boolean, false)
                             THEN NULL ELSE v_result #>> '{error,code}' END,
           error_message = CASE WHEN COALESCE((v_result ->> 'ok')::boolean, false)
                                THEN NULL ELSE v_result #>> '{error,message}' END,
           order_version_after = (
             SELECT order_version
               FROM public.sale_orders
              WHERE id = v_op.sale_order_id
           ),
           completed_at = now()
     WHERE id = v_receipt_id;

    INSERT INTO public.sale_order_command_outbox(
      sale_order_id,
      aggregate_key,
      command_receipt_id,
      event_type,
      aggregate_version,
      idempotency_key,
      payload
    ) VALUES (
      v_op.sale_order_id,
      v_op.sale_order_id::text,
      v_receipt_id,
      CASE WHEN COALESCE((v_result ->> 'ok')::boolean, false)
        THEN 'sale_order.resynced'
        ELSE 'sale_order.command_failed'
      END,
      v_sale_order_version,
      v_idempotency_key,
      v_result
    )
    ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

-- Fecha e remove o endpoint SECURITY DEFINER inseguro. Sem CASCADE: se algum
-- caller SQL realmente depender do overload, a migration aborta em vez de
-- apagar dependência silenciosamente.
REVOKE ALL ON FUNCTION
  public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.hybrid_debit_stock_for_order(
  uuid,
  numeric,
  text,
  uuid,
  jsonb
);

REVOKE ALL ON FUNCTION public.resync_op_atomic(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb, boolean)
  TO authenticated, service_role;

DO $contract$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
       'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Overload inseguro de cinco argumentos sobreviveu';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Motor canônico ainda está executável por anon';
  END IF;

  SELECT pg_get_functiondef('public.resync_op_atomic(uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition NOT ILIKE '%p_force_soft => true%'
     OR v_definition NOT ILIKE '%debit_packaging_for_order%'
     OR v_definition NOT ILIKE '%p_force_soft => false%'
     OR v_definition NOT ILIKE '%restore_order_stock_for_safe_resync%'
     OR v_definition NOT ILIKE '%sale_order_resync_snapshot_history%'
     OR v_definition NOT ILIKE '%freeze_technical_sheet%'
     OR v_definition ILIKE '%DELETE FROM public.technical_sheet_snapshots%'
     OR v_definition ILIKE '%restore_sole_grade_for_order%' THEN
    RAISE EXCEPTION 'resync_op_atomic não satisfaz o caminho seguro canônico';
  END IF;
END;
$contract$;

NOTIFY pgrst, 'reload schema';

COMMIT;
