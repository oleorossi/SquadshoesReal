-- Command boundary transacional de Pedido de Venda.
--
-- Um único entrypoint executa update/confirm/promote/resync/cancel com versão
-- otimista e receipt idempotente. A promoção parcial antiga permanece somente
-- como implementação interna opt-in; o default é all_or_nothing.

BEGIN;

-- Preserva o motor parcial vivo para rollback configurável, mas remove sua
-- identidade de endpoint público antes de publicar os wrappers canônicos.
DO $rename_partial_engine$
BEGIN
  IF to_regprocedure(
       'public.promote_sale_order_to_production(uuid,text)'
     ) IS NOT NULL
     AND to_regprocedure(
       'public.promote_sale_order_partial_internal(uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.promote_sale_order_to_production(uuid, text)
      RENAME TO promote_sale_order_partial_internal;
  END IF;
END;
$rename_partial_engine$;

REVOKE ALL ON FUNCTION public.promote_sale_order_partial_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promote_sale_order_atomic_internal(
  p_sale_order_id uuid,
  p_target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_item public.sale_order_items%ROWTYPE;
  v_op public.orders%ROWTYPE;
  v_active_count integer;
  v_op_status text;
  v_notes text;
  v_deadline date;
  v_is_ahead boolean;
  v_pkg_mode text;
  v_res jsonb;
  v_resync jsonb;
  v_scaled_grade jsonb;
  v_expected_grade jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_created_order_ids jsonb := '[]'::jsonb;
  v_all_order_ids jsonb := '[]'::jsonb;
  v_shortages jsonb := '[]'::jsonb;
  v_sole_shortfall_ids jsonb := '[]'::jsonb;
  v_created integer := 0;
  v_reused integer := 0;
  v_promoted integer := 0;
  v_total_item_count integer;
  v_reference_item_count integer;
  v_complete_count integer;
  v_already_target boolean;
BEGIN
  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Função interna: use execute_sale_order_command'
      USING ERRCODE = '42501';
  END IF;
  IF p_target_status NOT IN ('Aprovado', 'Em Produção') THEN
    RAISE EXCEPTION 'Status alvo de promoção inválido: %', p_target_status
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  v_already_target := v_so.status = p_target_status;
  v_pkg_mode := COALESCE(v_so.packaging_mode, 'individual_amarrado');
  IF p_target_status = 'Em Produção' THEN
    v_op_status := 'Em Produção';
    v_notes := 'Gerada automaticamente - Em Produção';
    v_deadline := v_so.delivery_deadline;
    v_is_ahead := v_deadline IS NOT NULL AND (v_deadline - CURRENT_DATE) > 14;
  ELSE
    v_op_status := 'Reservado';
    v_notes := 'Gerada automaticamente - Aprovação PV';
    v_deadline := NULL;
    v_is_ahead := false;
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE soi.reference_id IS NOT NULL)::integer
    INTO v_total_item_count, v_reference_item_count
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id;
  IF v_total_item_count = 0 THEN
    RAISE EXCEPTION 'PV não possui itens materializáveis'
      USING ERRCODE = 'PZ108';
  END IF;
  IF v_reference_item_count <> v_total_item_count THEN
    RAISE EXCEPTION
      'Promoção recusada: % de % itens não possuem referência técnica',
      v_total_item_count - v_reference_item_count,
      v_total_item_count
      USING ERRCODE = 'PZ108';
  END IF;

  FOR v_item IN
    SELECT soi.*
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
     ORDER BY soi.id
     FOR UPDATE
  LOOP
    -- Espelha literalmente o motor vivo de criação: sale_order_items.grade é
    -- a grade de uma ficha e orders.grade é a grade física (grade × fichas).
    -- Não usar scale_grade_to_total aqui: Hamilton pode produzir uma grade
    -- diferente daquela já gravada por promote_sale_order_item.
    SELECT COALESCE(
             jsonb_object_agg(
               g.key,
               (
                 COALESCE(NULLIF(g.value, '')::numeric, 0)
                 * GREATEST(COALESCE(v_item.fichas, 1), 1)
               )::integer
             ),
             '{}'::jsonb
           )
      INTO v_scaled_grade
      FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
     WHERE COALESCE(NULLIF(g.value, '')::numeric, 0)
           * GREATEST(COALESCE(v_item.fichas, 1), 1) > 0;
    v_expected_grade := CASE
      WHEN v_scaled_grade = '{}'::jsonb
        THEN COALESCE(v_item.grade, '{}'::jsonb)
      ELSE v_scaled_grade
    END;

    SELECT count(*)::integer
      INTO v_active_count
      FROM public.orders o
     WHERE o.sale_order_item_id = v_item.id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
         'Concluído', 'Concluido', 'Concluída'
       );
    IF v_active_count > 1 THEN
      RAISE EXCEPTION 'Item % possui % OPs ativas; promoção recusada',
        v_item.id,
        v_active_count
        USING ERRCODE = 'PZ108';
    END IF;

    IF v_active_count = 0 THEN
      v_res := public.promote_sale_order_item(
        v_item.id,
        v_op_status,
        v_notes,
        v_deadline,
        v_is_ahead,
        v_pkg_mode
      );
      IF COALESCE((v_res ->> 'skipped')::boolean, false) THEN
        RAISE EXCEPTION 'Item % foi ignorado pelo motor: %',
          v_item.id,
          COALESCE(v_res ->> 'reason', 'motivo desconhecido');
      END IF;

      SELECT * INTO v_op
        FROM public.orders o
       WHERE o.id = (v_res ->> 'order_id')::uuid
       FOR UPDATE;

      IF COALESCE(v_op.grade, '{}'::jsonb) IS DISTINCT FROM v_expected_grade THEN
        RAISE EXCEPTION
          'OP nova % divergiu da grade canônica do item %',
          v_op.id,
          v_item.id
          USING ERRCODE = 'PZ109';
      END IF;

      -- O helper vivo de 202611 ainda carrega fallback pré-Corte Fibra. Para
      -- ficha sem rota explícita, normaliza a OP nova dentro da mesma transação.
      IF NOT EXISTS (
        SELECT 1
          FROM public.technical_sheets ts
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(ts.production_sectors) = 'array'
              THEN ts.production_sectors ELSE '[]'::jsonb END
          ) s(stage_name)
         WHERE ts.id = v_item.reference_id
           AND NULLIF(btrim(s.stage_name), '') IS NOT NULL
      ) THEN
        DELETE FROM public.order_stages WHERE order_id = v_op.id;
        INSERT INTO public.order_stages(
          order_id,
          stage_name,
          stage_order,
          status,
          quantity_total,
          quantity_processed
        )
        SELECT v_op.id,
               route.stage_name,
               public.canonical_stage_order(route.stage_name),
               'pendente',
               v_op.quantity,
               0
          FROM unnest(ARRAY[
            'Corte Fibra', 'Corte Forração', 'Costura Palmilha',
            'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem',
            'Solagem', 'Acabamento', 'Expedição'
          ]) AS route(stage_name);
      END IF;

      v_created := v_created + 1;
      v_created_order_ids := v_created_order_ids
        || jsonb_build_array(v_op.id);
      v_shortages := v_shortages
        || COALESCE(v_res -> 'shortages', '[]'::jsonb);
      IF COALESCE((v_res ->> 'sole_shortfall')::boolean, false) THEN
        v_sole_shortfall_ids := v_sole_shortfall_ids
          || jsonb_build_array(v_op.id);
      END IF;
    ELSE
      SELECT * INTO v_op
        FROM public.orders o
       WHERE o.sale_order_item_id = v_item.id
         AND o.deleted_at IS NULL
         AND o.status NOT IN (
           'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
           'Concluído', 'Concluido', 'Concluída'
         )
       ORDER BY o.created_at, o.id
       LIMIT 1
       FOR UPDATE;

      IF v_op.reference_id IS DISTINCT FROM v_item.reference_id
         OR v_op.quantity IS DISTINCT FROM v_item.quantity
         OR COALESCE(v_op.color, '') IS DISTINCT FROM COALESCE(v_item.color, '')
         OR COALESCE(v_op.grade, '{}'::jsonb) IS DISTINCT FROM v_expected_grade THEN
        RAISE EXCEPTION
          'OP % diverge do item %; execute resync explícito antes de promover',
          v_op.id,
          v_item.id
          USING ERRCODE = 'PZ109';
      END IF;

      IF v_op.status IN ('Rascunho', 'Pendente') THEN
        IF EXISTS (
          SELECT 1 FROM public.material_reservations mr WHERE mr.order_id = v_op.id
        ) OR EXISTS (
          SELECT 1 FROM public.stock_movements sm WHERE sm.order_id = v_op.id
        ) OR EXISTS (
          SELECT 1 FROM public.order_stages os WHERE os.order_id = v_op.id
        ) OR EXISTS (
          SELECT 1
            FROM public.technical_sheet_snapshots tss
           WHERE tss.sale_order_id = p_sale_order_id
             AND tss.sale_order_item_id = v_item.id
        ) THEN
          RAISE EXCEPTION
            'OP rascunho % possui estado derivado parcial; resync explícito obrigatório',
            v_op.id
            USING ERRCODE = 'PZ110';
        END IF;

        UPDATE public.orders
           SET reference_id = v_item.reference_id,
               quantity = v_item.quantity,
               color = COALESCE(v_item.color, ''),
               grade = v_expected_grade,
               item_observation = v_item.observation,
               planned_delivery = v_deadline,
               status = 'Reservado',
               updated_at = now()
         WHERE id = v_op.id;

        v_resync := public.resync_op_atomic(v_op.id);
        IF NOT COALESCE((v_resync ->> 'ok')::boolean, false) THEN
          RAISE EXCEPTION 'Falha ao materializar OP %: %',
            v_op.id,
            COALESCE(v_resync #>> '{error,message}', 'resync recusado');
        END IF;
        SELECT * INTO v_op
          FROM public.orders o
         WHERE o.id = v_op.id
         FOR UPDATE;
      ELSE
        IF NOT EXISTS (
          SELECT 1
            FROM public.technical_sheet_snapshots tss
           WHERE tss.sale_order_id = p_sale_order_id
             AND tss.sale_order_item_id = v_item.id
        ) OR NOT EXISTS (
          SELECT 1 FROM public.order_stages os WHERE os.order_id = v_op.id
        ) THEN
          RAISE EXCEPTION
            'OP % possui derivação incompleta; resync explícito obrigatório',
            v_op.id
            USING ERRCODE = 'PZ110';
        END IF;
        IF EXISTS (
          SELECT 1
            FROM public.technical_sheet_snapshots tss
           WHERE tss.sale_order_id = p_sale_order_id
             AND tss.sale_order_item_id = v_item.id
             AND tss.outdated_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION
            'Snapshot da OP % está desatualizado; resync explícito obrigatório',
            v_op.id
            USING ERRCODE = 'PZ111';
        END IF;
      END IF;
      v_reused := v_reused + 1;
    END IF;

    IF p_target_status = 'Em Produção' AND v_op.status <> 'Em Produção' THEN
      UPDATE public.orders
         SET status = 'Em Produção',
             updated_at = now()
       WHERE id = v_op.id
         AND status IN ('Reservado', 'Aprovado');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OP % mudou de status durante a promoção', v_op.id
          USING ERRCODE = '40001';
      END IF;
      v_promoted := v_promoted + 1;
    END IF;

    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now(),
           resolved_by = auth.uid()
     WHERE sale_order_item_id = v_item.id
       AND resolved_at IS NULL;

    v_all_order_ids := v_all_order_ids || jsonb_build_array(v_op.id);
    v_ops := v_ops || jsonb_build_array(jsonb_build_object(
      'op_id', v_op.id,
      'order_id', v_op.id,
      'item_id', v_item.id,
      'reference_id', v_item.reference_id,
      'created', v_active_count = 0,
      'status', CASE WHEN p_target_status = 'Em Produção'
        THEN 'Em Produção' ELSE v_op.status END
    ));
  END LOOP;

  -- Revalida o resultado agregado antes de publicar o status do PV.
  SELECT count(*)::integer
    INTO v_complete_count
    FROM public.sale_order_items soi
    JOIN public.orders o
      ON o.sale_order_item_id = soi.id
     AND o.deleted_at IS NULL
     AND o.status NOT IN (
       'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
       'Concluído', 'Concluido', 'Concluída'
     )
   WHERE soi.sale_order_id = p_sale_order_id
     AND soi.reference_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.technical_sheet_snapshots tss
        WHERE tss.sale_order_id = p_sale_order_id
          AND tss.sale_order_item_id = soi.id
     )
     AND EXISTS (
       SELECT 1 FROM public.order_stages os WHERE os.order_id = o.id
     );
  IF v_complete_count <> v_reference_item_count THEN
    RAISE EXCEPTION 'Promoção incompleta: % de % itens materializados',
      v_complete_count,
      v_reference_item_count;
  END IF;

  PERFORM set_config('app.promote_sale_order_to_production', '1', true);
  IF v_so.status IS DISTINCT FROM p_target_status THEN
    UPDATE public.sale_orders
       SET status = p_target_status,
           updated_at = now()
     WHERE id = p_sale_order_id
       AND status = v_so.status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV mudou simultaneamente; recarregue antes de promover'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'target_status', p_target_status,
    'status', p_target_status,
    'ops_criadas', v_created,
    'order_ids', v_created_order_ids,
    'all_order_ids', v_all_order_ids,
    'itens_falha', '[]'::jsonb,
    'shortages', v_shortages,
    'sole_shortfall_order_ids', v_sole_shortfall_ids,
    'created_ops', v_created,
    'reused_ops', v_reused,
    'promoted_ops', v_promoted,
    'already_promoted', v_already_target AND v_created = 0,
    'ops', v_ops,
    'atomicity_mode', 'all_or_nothing'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_sale_order_atomic_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- O writer vivo de update+cancel foi criado quando o nome público apontava
-- para o motor parcial. Depois do rename acima, uma sessão nova resolveria o
-- mesmo texto para o wrapper público e abriria recursão no command boundary.
-- Fixa a dependência no motor atômico interno, ainda na mesma transação.
DO $patch_update_cancel_promotion$
DECLARE
  v_definition text;
  v_old text := 'v_promotion_result := public.promote_sale_order_to_production(';
  v_new text := 'v_promotion_result := public.promote_sale_order_atomic_internal(';
BEGIN
  SELECT pg_get_functiondef(
    'public.update_sale_order_with_atomic_op_cancel(uuid,jsonb,jsonb,uuid[],uuid[])'::regprocedure
  ) INTO v_definition;
  IF position(v_new IN v_definition) = 0 THEN
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Writer update_sale_order_with_atomic_op_cancel tem promoção inesperada';
    END IF;
    EXECUTE replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_update_cancel_promotion$;

CREATE OR REPLACE FUNCTION public.cancel_sale_order_atomic_internal(
  p_sale_order_id uuid,
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_restore jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_previous_status text;
  v_previous_restore_legacy_strap text;
BEGIN
  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Função interna: use execute_sale_order_command'
      USING ERRCODE = '42501';
  END IF;

  SELECT so.status
    INTO v_previous_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  IF v_previous_status NOT IN (
    'Rascunho', 'Pendente', 'Aprovado', 'Em Produção',
    'Faturado', 'Cancelado'
  ) THEN
    RAISE EXCEPTION
      'Status % não permite transição para Cancelado', v_previous_status
      USING ERRCODE = 'PZ110';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = p_sale_order_id
       AND nfe.status IN ('autorizada', 'processando', 'cancelando')
  ) THEN
    RAISE EXCEPTION
      'PV possui NF-e ativa; cancele a NF-e antes de cancelar o pedido'
      USING ERRCODE = 'PZ112';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND o.status IN (
         'Finalizado', 'FINALIZADO', 'Concluído', 'Concluido', 'Concluída'
       )
  ) THEN
    RAISE EXCEPTION
      'PV possui OP concluída/finalizada; cancelamento automático recusado'
      USING ERRCODE = 'PZ105';
  END IF;

  -- Trava todos os namespaces físicos antes das rows de OP. Resync e cancel
  -- usam a mesma ordem para não formar ciclo com hybrid/sole/caixa/tira ou
  -- picking/finalização concorrentes.
  FOR v_op IN
    SELECT o.id
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN ('Cancelada', 'Cancelado')
     ORDER BY o.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('debit_sole:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('stock_debit:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('packaging_debit:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(
      ('x' || substr(md5('debit_strap:' || v_op.id::text), 1, 16))::bit(64)::bigint
    );
    PERFORM pg_advisory_xact_lock(hashtext('reserve:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('reserve_missing:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('try_reserve_materials:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('consume_reservations:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('convert_reservation:' || v_op.id::text));
    PERFORM pg_advisory_xact_lock(hashtext('settle_reservations:' || v_op.id::text));
  END LOOP;

  FOR v_op IN
    SELECT o.id, o.order_number, o.status
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
         'Concluído', 'Concluido', 'Concluída'
       )
     ORDER BY o.id
     FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.order_id = v_op.id
         AND (
           COALESCE(os.quantity_processed, 0) > 0
           OR os.started_at IS NOT NULL
           OR os.completed_at IS NOT NULL
           OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.order_lots ol
       WHERE ol.order_id = v_op.id
         AND (
           ol.started_at IS NOT NULL
           OR ol.completed_at IS NOT NULL
           OR lower(COALESCE(ol.status, '')) NOT IN ('', 'pendente', 'pending')
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.material_reservations mr
       WHERE mr.order_id = v_op.id
         AND (
           COALESCE(mr.quantity_consumed, 0) > 0
           OR mr.consumed_at IS NOT NULL
           OR lower(COALESCE(mr.status, '')) IN (
             'consumed', 'converted', 'pending_reconciliation'
           )
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.production_consumptions pc
       WHERE pc.order_id = v_op.id
         AND pc.superseded_at IS NULL
         AND COALESCE(pc.actual_quantity, 0) > 0
    ) THEN
      RAISE EXCEPTION
        'OP % possui fato físico; cancelamento automático recusado',
        v_op.id
        USING ERRCODE = 'PZ105';
    END IF;

    -- Restitui apenas OUT reversível com movimento IN causal. O helper recusa
    -- grade/estorno ambíguos; nenhum movimento é apagado ou desassociado.
    -- Resync preserva a tira já materializada porque não a recria; cancel, ao
    -- contrário, estorna também a baixa dura legada de tira. O sinal é local à
    -- transação e o helper continua fechado a callers externos.
    v_previous_restore_legacy_strap := current_setting(
      'app.sale_order_command_restore_legacy_strap',
      true
    );
    PERFORM set_config(
      'app.sale_order_command_restore_legacy_strap',
      '1',
      true
    );
    v_restore := public.restore_order_stock_for_safe_resync(
      v_op.id,
      p_receipt_id
    );
    PERFORM set_config(
      'app.sale_order_command_restore_legacy_strap',
      COALESCE(v_previous_restore_legacy_strap, ''),
      true
    );
    PERFORM public.release_order_reservations(v_op.id);

    UPDATE public.orders
       SET status = 'Cancelada',
           updated_at = now()
     WHERE id = v_op.id;

    v_ops := v_ops || jsonb_build_array(jsonb_build_object(
      'order_id', v_op.id,
      'order_number', v_op.order_number,
      'status_before', v_op.status,
      'restoration', v_restore
    ));
  END LOOP;

  -- A compensação aposenta somente o ponteiro vigente. A revisão (inclusive
  -- committed) permanece imutável e reconstruível para auditoria.
  UPDATE public.sale_order_material_plan_revisions
     SET is_current = false
   WHERE sale_order_id = p_sale_order_id
     AND is_current;

  UPDATE public.sale_orders
     SET status = 'Cancelado',
         updated_at = now()
   WHERE id = p_sale_order_id
     AND status IS DISTINCT FROM 'Cancelado';

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'status_before', v_previous_status,
    'status', 'Cancelado',
    'cancelled_ops', v_ops
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale_order_atomic_internal(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Command boundary: uma transação, versão otimista e receipt idempotente.
-- Falhas de negócio são envelopes `ok=false`: lançar a exceção para o cliente
-- desfaria também o receipt e a outbox que tornam a falha observável.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_sale_order_command(
  p_sale_order_id uuid,
  p_command text,
  p_expected_order_version bigint,
  p_idempotency_key text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_override_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_so public.sale_orders%ROWTYPE;
  v_receipt public.sale_order_command_receipts%ROWTYPE;
  v_receipt_id uuid;
  v_request_hash text;
  v_preflight jsonb;
  v_post_write_preflight jsonb;
  v_result jsonb;
  v_promotion_result jsonb;
  v_response jsonb;
  v_plan_revision_id uuid;
  v_current_plan_revision_id uuid;
  v_config public.sale_order_command_config%ROWTYPE;
  v_header jsonb;
  v_items jsonb;
  v_billing_patch jsonb;
  v_factoring_patch jsonb;
  v_teardown_op_ids uuid[] := '{}'::uuid[];
  v_cancel_op_ids uuid[] := '{}'::uuid[];
  v_order_id uuid;
  v_outsource_contractor_id uuid;
  v_outsource_sector text;
  v_box_grouping text;
  v_external_nfe_number text;
  v_target_status text;
  v_factoring_config_id uuid;
  v_manual_billing_override boolean;
  v_version_after bigint;
  v_previous_internal text;
  v_previous_override_source_version text;
  v_previous_parent_receipt_id text;
  v_error_state text;
  v_error_message text;
  v_error_detail text;
  v_event_type text;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'p_sale_order_id é obrigatório' USING ERRCODE = '22004';
  END IF;
  IF v_command NOT IN (
    'update', 'confirm', 'promote', 'resync', 'cancel', 'transition',
    'billing', 'factoring'
  ) THEN
    RAISE EXCEPTION 'Comando de PV não suportado: %', p_command
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_order_version IS NULL THEN
    RAISE EXCEPTION 'expected_order_version é obrigatório para PV existente'
      USING ERRCODE = '22004';
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'idempotency_key é obrigatório (máximo 200 caracteres)'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'payload do comando deve ser objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR (
          (v_command = 'resync'
           AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']))
          OR
          (v_command = 'factoring'
           AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']))
          OR
          (v_command NOT IN ('resync', 'factoring')
           AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']))
       )
     ) THEN
    RAISE EXCEPTION 'Papel sem permissão para executar o comando %', v_command
      USING ERRCODE = '42501';
  END IF;
  IF v_command = 'factoring'
     AND NOT public.can_execute_sale_order_finance_command() THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /financeiro para factoring'
      USING ERRCODE = '42501';
  ELSIF v_command <> 'factoring'
        AND NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /sales para o comando %',
      v_command
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'command', v_command,
    'expected_order_version', p_expected_order_version,
    'payload', COALESCE(p_payload, '{}'::jsonb),
    'override_id', p_override_id
  )::text);

  SELECT * INTO v_receipt
    FROM public.sale_order_command_receipts r
   WHERE r.command_name = v_command
     AND r.aggregate_key = p_sale_order_id::text
     AND r.idempotency_key = btrim(p_idempotency_key)
   FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION
        'Replay idempotente divergente para comando % do PV %',
        v_command,
        p_sale_order_id
        USING ERRCODE = '22000';
    END IF;
    IF v_receipt.status IN ('succeeded', 'failed') THEN
      RETURN COALESCE(v_receipt.response, '{}'::jsonb) || jsonb_build_object(
        'receipt_id', v_receipt.id,
        'idempotent_replay', true
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'command', v_command,
      'sale_order_id', p_sale_order_id,
      'receipt_id', v_receipt.id,
      'error', jsonb_build_object(
        'code', 'command_in_progress',
        'message', 'Comando idempotente ainda está em processamento.'
      )
    );
  END IF;

  INSERT INTO public.sale_order_command_receipts(
    sale_order_id,
    aggregate_key,
    command_name,
    idempotency_key,
    request_hash,
    expected_order_version,
    order_version_before,
    actor_id
  ) VALUES (
    p_sale_order_id,
    p_sale_order_id::text,
    v_command,
    btrim(p_idempotency_key),
    v_request_hash,
    p_expected_order_version,
    v_so.order_version,
    auth.uid()
  )
  RETURNING id INTO v_receipt_id;

  BEGIN
    v_preflight := public.preflight_sale_order_command(
      p_sale_order_id,
      v_command,
      p_expected_order_version,
      CASE WHEN v_command = 'update' THEN NULL ELSE p_override_id END,
      COALESCE(p_payload, '{}'::jsonb)
    );

    IF v_command = 'update'
       AND p_override_id IS NOT NULL
       AND v_so.status NOT IN ('Aprovado', 'Em Produção') THEN
      RAISE EXCEPTION
        'Override de readiness em update só se aplica a PV ativo'
        USING ERRCODE = 'PZ107';
    END IF;
    IF NOT COALESCE((v_preflight ->> 'ready')::boolean, false) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PZ107',
        MESSAGE = 'Readiness gate recusou o comando de pedido de venda';
    END IF;

    SELECT * INTO v_config
      FROM public.sale_order_command_config
     WHERE config_key = 'default';

    v_previous_internal := current_setting('app.sale_order_command_internal', true);
    v_previous_override_source_version := current_setting(
      'app.sale_order_command_override_source_version',
      true
    );
    v_previous_parent_receipt_id := current_setting(
      'app.sale_order_command_parent_receipt_id',
      true
    );
    PERFORM set_config('app.sale_order_command_internal', '1', true);
    PERFORM set_config(
      'app.sale_order_command_parent_receipt_id',
      v_receipt_id::text,
      true
    );
    IF v_command = 'update' AND p_override_id IS NOT NULL THEN
      -- Carry-forward vale somente nesta execução: o override continua ligado
      -- à versão que o administrador justificou e não é regravado na versão
      -- nova. O preflight pós-write ainda valida PV/comando/revogação.
      PERFORM set_config(
        'app.sale_order_command_override_source_version',
        v_so.order_version::text,
        true
      );
    END IF;

    -- Revalidação TOCTOU dentro da subtransação: o preflight já emitiu o
    -- blocker, mas uma NF pode ter sido criada por outro fluxo entre a leitura
    -- inicial e a mutação do cabeçalho.
    IF v_command IN ('update', 'cancel', 'billing', 'factoring')
       AND EXISTS (
         SELECT 1
           FROM public.nfe_emitidas nfe
          WHERE nfe.sale_order_id = p_sale_order_id
            AND nfe.status IN ('autorizada', 'processando', 'cancelando')
       ) THEN
      RAISE EXCEPTION
        'PV possui NF-e ativa; cancele a NF-e antes de alterar/cancelar o pedido'
        USING ERRCODE = 'PZ112';
    END IF;

    CASE v_command
      WHEN 'update' THEN
        v_header := p_payload -> 'header';
        v_items := p_payload -> 'items';
        IF jsonb_typeof(v_header) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_items) = 0 THEN
          RAISE EXCEPTION
            'update exige payload.header objeto e payload.items array não vazio'
            USING ERRCODE = '22023';
        END IF;

        -- Estes campos têm commands próprios porque carregam política de
        -- faturamento/factoring e, no segundo caso, autorização financeira.
        -- O writer legado usa jsonb_populate_record e aceitaria silenciosamente
        -- qualquer uma destas chaves; recusar aqui impede contrabando por
        -- `update` e mantém receipt/outbox com o tipo causal correto.
        IF EXISTS (
          SELECT 1
            FROM jsonb_object_keys(v_header) AS header_key(key)
           WHERE header_key.key IN (
             'billing_status',
             'delivery_month',
             'delivery_week',
             'billing_week',
             'delivery_deadline',
             'manual_billing_override',
             'original_min_billing_date',
             'manual_override_reason',
             'is_factoring',
             'factoring_config_id'
           )
        ) THEN
          RAISE EXCEPTION
            'update não aceita campos de billing/factoring; use o command dedicado'
            USING ERRCODE = 'PZ118';
        END IF;

        -- Ação update não pode contrabandear uma transição de status e pular o
        -- readiness gate. Campos de terceirização continuam no mesmo header.
        v_header := v_header || jsonb_build_object('status', v_so.status);

        IF p_payload ? 'teardown_op_ids' THEN
          IF jsonb_typeof(p_payload -> 'teardown_op_ids') <> 'array' THEN
            RAISE EXCEPTION 'teardown_op_ids deve ser array de UUIDs'
              USING ERRCODE = '22023';
          END IF;
          SELECT COALESCE(array_agg(x.value::uuid ORDER BY x.ordinality), '{}'::uuid[])
            INTO v_teardown_op_ids
            FROM jsonb_array_elements_text(p_payload -> 'teardown_op_ids')
              WITH ORDINALITY AS x(value, ordinality);
        END IF;
        IF p_payload ? 'cancel_op_ids' THEN
          IF jsonb_typeof(p_payload -> 'cancel_op_ids') <> 'array' THEN
            RAISE EXCEPTION 'cancel_op_ids deve ser array de UUIDs'
              USING ERRCODE = '22023';
          END IF;
          SELECT COALESCE(array_agg(x.value::uuid ORDER BY x.ordinality), '{}'::uuid[])
            INTO v_cancel_op_ids
            FROM jsonb_array_elements_text(p_payload -> 'cancel_op_ids')
              WITH ORDINALITY AS x(value, ordinality);
        END IF;

        IF cardinality(v_cancel_op_ids) > 0 THEN
          v_result := public.update_sale_order_with_atomic_op_cancel(
            p_sale_order_id,
            v_header,
            v_items,
            v_cancel_op_ids,
            v_teardown_op_ids
          );
        ELSE
          v_result := public.update_sale_order_with_teardown(
            p_sale_order_id,
            v_header,
            v_items,
            v_teardown_op_ids
          );
        END IF;

        -- Os wrappers vivos ainda não fazem round-trip de todos os campos do
        -- cabeçalho. Completa-os dentro da MESMA subtransação; chave ausente
        -- preserva o valor atual e contractor NULL sempre limpa o setor.
        IF v_header ? 'box_grouping'
           OR v_header ? 'external_nfe_number'
           OR v_header ? 'outsource_to_contractor_id'
           OR v_header ? 'outsource_to_sector' THEN
          SELECT so.box_grouping,
                 so.external_nfe_number,
                 so.outsource_to_contractor_id,
                 so.outsource_to_sector
            INTO v_box_grouping,
                 v_external_nfe_number,
                 v_outsource_contractor_id,
                 v_outsource_sector
            FROM public.sale_orders so
           WHERE so.id = p_sale_order_id
           FOR UPDATE;

          IF v_header ? 'box_grouping' THEN
            v_box_grouping := NULLIF(btrim(v_header ->> 'box_grouping'), '');
            IF v_box_grouping IS NULL
               OR v_box_grouping NOT IN ('grade', 'numeracao_unica') THEN
              RAISE EXCEPTION 'box_grouping inválido: %', v_box_grouping
                USING ERRCODE = '22023';
            END IF;
          END IF;
          IF v_header ? 'external_nfe_number' THEN
            v_external_nfe_number := NULLIF(
              btrim(v_header ->> 'external_nfe_number'),
              ''
            );
          END IF;
          IF v_header ? 'outsource_to_contractor_id' THEN
            v_outsource_contractor_id := NULLIF(
              btrim(v_header ->> 'outsource_to_contractor_id'),
              ''
            )::uuid;
          END IF;
          IF v_header ? 'outsource_to_sector' THEN
            v_outsource_sector := NULLIF(
              btrim(v_header ->> 'outsource_to_sector'),
              ''
            );
          END IF;
          IF v_outsource_contractor_id IS NULL THEN
            v_outsource_sector := NULL;
          END IF;

          IF v_so.status = 'Cancelado' AND v_target_status = 'Rascunho' THEN
            -- Fecha também ponteiros legados que possam ter sobrevivido a um
            -- cancelamento anterior ao command boundary; não altera o estado
            -- nem o conteúdo da revisão histórica comprometida.
            UPDATE public.sale_order_material_plan_revisions
               SET is_current = false
             WHERE sale_order_id = p_sale_order_id
               AND is_current;
          END IF;
          UPDATE public.sale_orders
             SET box_grouping = v_box_grouping,
                 external_nfe_number = v_external_nfe_number,
                 outsource_to_contractor_id = v_outsource_contractor_id,
                 outsource_to_sector = v_outsource_sector,
                 updated_at = now()
           WHERE id = p_sale_order_id;
        END IF;

        -- Billing/factoring opcionais pertencem ao MESMO intent de edição.
        -- Permanecem fora de header para o writer legado não poder aplicá-los
        -- sem allow-list, estado e RBAC próprios.
        IF p_payload ? 'billing_patch' THEN
          v_billing_patch := p_payload -> 'billing_patch';
          IF jsonb_typeof(v_billing_patch) IS DISTINCT FROM 'object'
             OR v_billing_patch = '{}'::jsonb
             OR EXISTS (
               SELECT 1
                 FROM jsonb_object_keys(v_billing_patch) AS payload_key(key)
                WHERE payload_key.key NOT IN (
                  'delivery_month', 'delivery_week', 'billing_week',
                  'delivery_deadline', 'manual_billing_override',
                  'original_min_billing_date', 'manual_override_reason'
                )
             ) THEN
            RAISE EXCEPTION 'billing_patch contém campo ausente/não permitido'
              USING ERRCODE = '22023';
          END IF;
          IF v_so.status NOT IN (
            'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'
          ) THEN
            RAISE EXCEPTION
              'billing_patch recusado após faturamento/fechamento do PV'
              USING ERRCODE = 'PZ119';
          END IF;

          v_manual_billing_override := NULL;
          IF v_billing_patch ? 'manual_billing_override' THEN
            BEGIN
              v_manual_billing_override := (
                v_billing_patch ->> 'manual_billing_override'
              )::boolean;
            EXCEPTION WHEN invalid_text_representation THEN
              RAISE EXCEPTION 'manual_billing_override deve ser boolean'
                USING ERRCODE = '22023';
            END;
            IF v_manual_billing_override IS NULL THEN
              RAISE EXCEPTION 'manual_billing_override não pode ser NULL'
                USING ERRCODE = '22023';
            END IF;
            IF v_manual_billing_override
               AND length(btrim(COALESCE(
                 v_billing_patch ->> 'manual_override_reason',
                 ''
               ))) < 10 THEN
              RAISE EXCEPTION
                'Override manual de faturamento exige motivo (10+ caracteres)'
                USING ERRCODE = '22023';
            END IF;
          END IF;

          UPDATE public.sale_orders so
             SET delivery_month = CASE WHEN v_billing_patch ? 'delivery_month'
                   THEN NULLIF(btrim(v_billing_patch ->> 'delivery_month'), '')
                   ELSE so.delivery_month END,
                 delivery_week = CASE WHEN v_billing_patch ? 'delivery_week'
                   THEN NULLIF(btrim(v_billing_patch ->> 'delivery_week'), '')
                   ELSE so.delivery_week END,
                 billing_week = CASE WHEN v_billing_patch ? 'billing_week'
                   THEN NULLIF(btrim(v_billing_patch ->> 'billing_week'), '')
                   ELSE so.billing_week END,
                 delivery_deadline = CASE
                   WHEN v_billing_patch ? 'delivery_deadline'
                     THEN NULLIF(
                       btrim(v_billing_patch ->> 'delivery_deadline'),
                       ''
                     )::date
                   ELSE so.delivery_deadline END,
                 manual_billing_override = CASE
                   WHEN v_billing_patch ? 'manual_billing_override'
                     THEN v_manual_billing_override
                   ELSE so.manual_billing_override END,
                 original_min_billing_date = CASE
                   WHEN v_billing_patch ? 'original_min_billing_date'
                     THEN NULLIF(
                       btrim(v_billing_patch ->> 'original_min_billing_date'),
                       ''
                     )::date
                   ELSE so.original_min_billing_date END,
                 manual_override_reason = CASE
                   WHEN v_billing_patch ? 'manual_override_reason'
                     THEN NULLIF(
                       btrim(v_billing_patch ->> 'manual_override_reason'),
                       ''
                     )
                   ELSE so.manual_override_reason END,
                 updated_at = now()
           WHERE so.id = p_sale_order_id;
          v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
            'billing_result', v_billing_patch
          );
        END IF;

        IF p_payload ? 'factoring_patch' THEN
          v_factoring_patch := p_payload -> 'factoring_patch';
          IF jsonb_typeof(v_factoring_patch) IS DISTINCT FROM 'object'
             OR NOT (v_factoring_patch ? 'factoring_config_id')
             OR EXISTS (
               SELECT 1
                 FROM jsonb_object_keys(v_factoring_patch) AS payload_key(key)
                WHERE payload_key.key <> 'factoring_config_id'
             ) THEN
            RAISE EXCEPTION 'factoring_patch aceita somente factoring_config_id'
              USING ERRCODE = '22023';
          END IF;
          v_factoring_config_id := NULLIF(
            btrim(COALESCE(
              v_factoring_patch ->> 'factoring_config_id',
              ''
            )),
            ''
          )::uuid;
          IF v_factoring_config_id IS DISTINCT FROM v_so.factoring_config_id THEN
            IF v_so.status NOT IN ('Rascunho', 'Pendente') THEN
              RAISE EXCEPTION
                'factoring_patch recusado após aprovação/fato financeiro do PV'
                USING ERRCODE = 'PZ119';
            END IF;
            IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
               AND (
                 NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
                 OR NOT public.can_execute_sale_order_finance_command()
               ) THEN
              RAISE EXCEPTION
                'factoring_patch exige Administração/Gerência e can_edit em /financeiro'
                USING ERRCODE = '42501';
            END IF;
            IF v_factoring_config_id IS NOT NULL AND NOT EXISTS (
              SELECT 1
                FROM public.factoring_config fc
               WHERE fc.id = v_factoring_config_id
                 AND fc.active
            ) THEN
              RAISE EXCEPTION 'Configuração de factoring inexistente/inativa'
                USING ERRCODE = 'PZ107';
            END IF;
            UPDATE public.sale_orders
               SET factoring_config_id = v_factoring_config_id,
                   is_factoring = (v_factoring_config_id IS NOT NULL),
                   updated_at = now()
             WHERE id = p_sale_order_id;
            v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
              'factoring_result', jsonb_build_object(
                'factoring_config_id', v_factoring_config_id,
                'is_factoring', v_factoring_config_id IS NOT NULL
              )
            );
          END IF;
        END IF;

        IF v_so.status IN ('Aprovado', 'Em Produção') THEN
          SELECT so.order_version
            INTO v_version_after
            FROM public.sale_orders so
           WHERE so.id = p_sale_order_id;
          v_post_write_preflight := public.preflight_sale_order_command(
            p_sale_order_id,
            CASE WHEN v_so.status = 'Em Produção'
              THEN 'promote' ELSE 'confirm' END,
            v_version_after,
            p_override_id,
            '{}'::jsonb
          );
          IF NOT COALESCE(
            (v_post_write_preflight ->> 'ready')::boolean,
            false
          ) THEN
            RAISE EXCEPTION USING
              ERRCODE = 'PZ107',
              MESSAGE = 'Readiness pós-update recusou a rematerialização do PV ativo';
          END IF;

          -- Atualização de PV ativo cria uma nova proposta material; se já há
          -- revisão comprometida divergente, persist_* recusa com PZ103 e
          -- exige compensação em vez de reescrever o fato.
          v_plan_revision_id := public.persist_sale_order_material_plan_revision(
            p_sale_order_id,
            CASE WHEN v_so.status = 'Em Produção'
              THEN 'promotion' ELSE 'confirmation' END
          );
        END IF;

        IF cardinality(v_cancel_op_ids) = 0
           AND v_so.status IN ('Aprovado', 'Em Produção') THEN
          -- Fecha a janela histórica save -> segunda RPC de promoção. O mesmo
          -- bloco valida/cria OP, snapshot e estágios; qualquer falha reverte
          -- também header, itens, teardown e campos complementares.
          v_promotion_result := public.promote_sale_order_atomic_internal(
            p_sale_order_id,
            v_so.status
          );
          IF jsonb_typeof(v_promotion_result) IS DISTINCT FROM 'object'
             OR jsonb_typeof(v_promotion_result -> 'itens_falha')
                IS DISTINCT FROM 'array'
             OR jsonb_array_length(v_promotion_result -> 'itens_falha') > 0 THEN
            RAISE EXCEPTION
              'Re-materialização do PV ativo retornou resultado inválido/incompleto'
              USING ERRCODE = 'PZ115';
          END IF;
          v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
            'promotion_result',
            v_promotion_result
          );
        END IF;

      WHEN 'confirm' THEN
        v_plan_revision_id := public.persist_sale_order_material_plan_revision(
          p_sale_order_id,
          'confirmation'
        );
        IF v_config.promotion_atomicity_mode = 'partial'
           AND v_config.partial_promotion_enabled THEN
          v_result := public.promote_sale_order_partial_internal(
            p_sale_order_id,
            'Aprovado'
          );
          PERFORM set_config('app.promote_sale_order_to_production', '1', true);
          UPDATE public.sale_orders
             SET status = 'Aprovado', updated_at = now()
           WHERE id = p_sale_order_id
             AND status IS DISTINCT FROM 'Aprovado';
          v_result := v_result || jsonb_build_object('atomicity_mode', 'partial');
        ELSE
          v_result := public.promote_sale_order_atomic_internal(
            p_sale_order_id,
            'Aprovado'
          );
        END IF;

      WHEN 'promote' THEN
        v_plan_revision_id := public.persist_sale_order_material_plan_revision(
          p_sale_order_id,
          'promotion'
        );
        IF v_config.promotion_atomicity_mode = 'partial'
           AND v_config.partial_promotion_enabled THEN
          v_result := public.promote_sale_order_partial_internal(
            p_sale_order_id,
            'Em Produção'
          );
          PERFORM set_config('app.promote_sale_order_to_production', '1', true);
          UPDATE public.sale_orders
             SET status = 'Em Produção', updated_at = now()
           WHERE id = p_sale_order_id
             AND status IS DISTINCT FROM 'Em Produção';
          v_result := v_result || jsonb_build_object('atomicity_mode', 'partial');
        ELSE
          v_result := public.promote_sale_order_atomic_internal(
            p_sale_order_id,
            'Em Produção'
          );
        END IF;

      WHEN 'resync' THEN
        IF NULLIF(btrim(COALESCE(p_payload ->> 'order_id', '')), '') IS NULL THEN
          RAISE EXCEPTION 'resync exige payload.order_id'
            USING ERRCODE = '22023';
        END IF;
        v_order_id := (p_payload ->> 'order_id')::uuid;
        IF NOT EXISTS (
          SELECT 1
            FROM public.orders o
           WHERE o.id = v_order_id
             AND o.sale_order_id = p_sale_order_id
             AND o.deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'OP % não pertence ao PV %', v_order_id, p_sale_order_id
            USING ERRCODE = '22023';
        END IF;
        v_result := public.resync_op_atomic(v_order_id);
        IF NOT COALESCE((v_result ->> 'ok')::boolean, false) THEN
          RAISE EXCEPTION USING
            ERRCODE = 'PZ113',
            MESSAGE = COALESCE(
              v_result #>> '{error,message}',
              'Ressincronização recusada pelo motor seguro'
            );
        END IF;

      WHEN 'cancel' THEN
        -- O helper revalida NF-e e recusa fatos físicos. OUT reversível recebe
        -- movimento IN causal; cancel nunca é somente UPDATE de status.
        v_result := public.cancel_sale_order_atomic_internal(
          p_sale_order_id,
          v_receipt_id
        );

      WHEN 'transition' THEN
        IF p_override_id IS NOT NULL THEN
          RAISE EXCEPTION 'transition não aceita readiness override'
            USING ERRCODE = 'PZ116';
        END IF;
        v_target_status := NULLIF(
          btrim(COALESCE(p_payload ->> 'target_status', '')),
          ''
        );

        -- O preflight já validou a aresta, a política de NF-e e a NF-e
        -- autorizada. Revalidamos fatos destrutivos no helper de cancelamento;
        -- todas as alterações abaixo continuam dentro da mesma subtransação.
        IF v_so.status = 'Aprovado' AND v_target_status = 'Rascunho' THEN
          v_result := public.cancel_sale_order_atomic_internal(
            p_sale_order_id,
            v_receipt_id
          );
          UPDATE public.sale_orders
             SET status = 'Rascunho',
                 shipped_at = NULL,
                 updated_at = now()
           WHERE id = p_sale_order_id;
          v_result := v_result || jsonb_build_object(
            'status', 'Rascunho',
            'transition_via', 'cancel_compensation'
          );
        ELSIF v_so.status = 'Faturado'
              AND v_target_status = 'Expedido' THEN
          -- A condição fiscal é novamente avaliada aqui para impedir TOCTOU
          -- caso o estado da NF-e mude depois do preflight.
          IF NOT EXISTS (
            SELECT 1
              FROM public.nfe_emitidas nfe
             WHERE nfe.sale_order_id = p_sale_order_id
               AND nfe.status = 'autorizada'
          ) THEN
            RAISE EXCEPTION 'Expedição exige NF-e autorizada'
              USING ERRCODE = 'PZ112';
          END IF;
          UPDATE public.sale_orders
             SET status = 'Expedido',
                 shipped_at = COALESCE(shipped_at, now()),
                 updated_at = now()
           WHERE id = p_sale_order_id;
          v_result := jsonb_build_object(
            'sale_order_id', p_sale_order_id,
            'status_before', v_so.status,
            'status', v_target_status,
            'shipped_at_recorded', true
          );
        ELSE
          -- Arestas simples e fatos canônicos de faturamento/finalização. O
          -- readiness bloqueia políticas incompatíveis antes de chegar aqui.
          UPDATE public.sale_orders
             SET status = v_target_status,
                 shipped_at = CASE
                   WHEN v_target_status = 'Rascunho' THEN NULL
                   ELSE shipped_at
                 END,
                 updated_at = now()
           WHERE id = p_sale_order_id;
          v_result := jsonb_build_object(
            'sale_order_id', p_sale_order_id,
            'status_before', v_so.status,
            'status', v_target_status,
            'transition_via', 'state_machine'
          );
        END IF;

      WHEN 'billing' THEN
        IF p_override_id IS NOT NULL THEN
          RAISE EXCEPTION 'billing não aceita readiness override'
            USING ERRCODE = 'PZ116';
        END IF;
        IF v_so.status NOT IN (
          'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'
        ) THEN
          RAISE EXCEPTION
            'billing recusado após faturamento/fechamento do PV'
            USING ERRCODE = 'PZ119';
        END IF;
        IF p_payload = '{}'::jsonb OR EXISTS (
          SELECT 1
            FROM jsonb_object_keys(p_payload) AS payload_key(key)
           WHERE payload_key.key NOT IN (
             'delivery_month', 'delivery_week', 'billing_week',
             'delivery_deadline', 'manual_billing_override',
             'original_min_billing_date', 'manual_override_reason'
           )
        ) THEN
          RAISE EXCEPTION 'billing contém campo ausente/não permitido'
            USING ERRCODE = '22023';
        END IF;
        IF p_payload ? 'manual_billing_override' THEN
          BEGIN
            v_manual_billing_override := (p_payload ->> 'manual_billing_override')::boolean;
          EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'manual_billing_override deve ser boolean'
              USING ERRCODE = '22023';
          END;
          IF v_manual_billing_override IS NULL THEN
            RAISE EXCEPTION 'manual_billing_override não pode ser NULL'
              USING ERRCODE = '22023';
          END IF;
          IF v_manual_billing_override
             AND length(btrim(COALESCE(p_payload ->> 'manual_override_reason', ''))) < 10 THEN
            RAISE EXCEPTION 'Override manual de faturamento exige motivo (10+ caracteres)'
              USING ERRCODE = '22023';
          END IF;
        END IF;

        UPDATE public.sale_orders so
           SET delivery_month = CASE WHEN p_payload ? 'delivery_month'
                 THEN NULLIF(btrim(p_payload ->> 'delivery_month'), '')
                 ELSE so.delivery_month END,
               delivery_week = CASE WHEN p_payload ? 'delivery_week'
                 THEN NULLIF(btrim(p_payload ->> 'delivery_week'), '')
                 ELSE so.delivery_week END,
               billing_week = CASE WHEN p_payload ? 'billing_week'
                 THEN NULLIF(btrim(p_payload ->> 'billing_week'), '')
                 ELSE so.billing_week END,
               delivery_deadline = CASE WHEN p_payload ? 'delivery_deadline'
                 THEN NULLIF(btrim(p_payload ->> 'delivery_deadline'), '')::date
                 ELSE so.delivery_deadline END,
               manual_billing_override = CASE
                 WHEN p_payload ? 'manual_billing_override'
                   THEN v_manual_billing_override
                 ELSE so.manual_billing_override END,
               original_min_billing_date = CASE
                 WHEN p_payload ? 'original_min_billing_date'
                   THEN NULLIF(
                     btrim(p_payload ->> 'original_min_billing_date'),
                     ''
                   )::date
                 ELSE so.original_min_billing_date END,
               manual_override_reason = CASE
                 WHEN p_payload ? 'manual_override_reason'
                   THEN NULLIF(btrim(p_payload ->> 'manual_override_reason'), '')
                 ELSE so.manual_override_reason END,
               updated_at = now()
         WHERE so.id = p_sale_order_id;
        v_result := jsonb_build_object(
          'sale_order_id', p_sale_order_id,
          'billing', p_payload
        );

      WHEN 'factoring' THEN
        IF p_override_id IS NOT NULL THEN
          RAISE EXCEPTION 'factoring não aceita readiness override'
            USING ERRCODE = 'PZ116';
        END IF;
        IF v_so.status NOT IN ('Rascunho', 'Pendente') THEN
          RAISE EXCEPTION
            'factoring recusado após aprovação/fato financeiro do PV'
            USING ERRCODE = 'PZ119';
        END IF;
        IF NOT (p_payload ? 'factoring_config_id')
           OR EXISTS (
             SELECT 1
               FROM jsonb_object_keys(p_payload) AS payload_key(key)
              WHERE payload_key.key <> 'factoring_config_id'
           ) THEN
          RAISE EXCEPTION 'factoring aceita somente factoring_config_id'
            USING ERRCODE = '22023';
        END IF;
        v_factoring_config_id := NULLIF(
          btrim(COALESCE(p_payload ->> 'factoring_config_id', '')),
          ''
        )::uuid;
        IF v_factoring_config_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
            FROM public.factoring_config fc
           WHERE fc.id = v_factoring_config_id
             AND fc.active
        ) THEN
          RAISE EXCEPTION 'Configuração de factoring inexistente/inativa'
            USING ERRCODE = 'PZ107';
        END IF;
        UPDATE public.sale_orders
           SET factoring_config_id = v_factoring_config_id,
               is_factoring = (v_factoring_config_id IS NOT NULL),
               updated_at = now()
         WHERE id = p_sale_order_id;
        v_result := jsonb_build_object(
          'sale_order_id', p_sale_order_id,
          'factoring_config_id', v_factoring_config_id,
          'is_factoring', v_factoring_config_id IS NOT NULL
        );
    END CASE;

    PERFORM set_config(
      'app.sale_order_command_internal',
      COALESCE(v_previous_internal, ''),
      true
    );
    PERFORM set_config(
      'app.sale_order_command_override_source_version',
      COALESCE(v_previous_override_source_version, ''),
      true
    );
    PERFORM set_config(
      'app.sale_order_command_parent_receipt_id',
      COALESCE(v_previous_parent_receipt_id, ''),
      true
    );

    SELECT so.order_version
      INTO v_version_after
      FROM public.sale_orders so
     WHERE so.id = p_sale_order_id;

    IF v_command IN ('update', 'confirm', 'promote') THEN
      SELECT mpr.id
        INTO v_current_plan_revision_id
        FROM public.sale_order_material_plan_revisions mpr
       WHERE mpr.sale_order_id = p_sale_order_id
         AND mpr.is_current
       ORDER BY mpr.revision_no DESC
       LIMIT 1;
      -- Embalagem/OUT hard pode comprometer uma nova revisão dentro do mesmo
      -- comando. Receipt e envelope devem apontar para essa revisão física
      -- vigente, não para a proposta superseded criada antes da materialização.
      v_plan_revision_id := COALESCE(
        v_current_plan_revision_id,
        v_plan_revision_id
      );
    END IF;

    v_response := jsonb_build_object(
      'ok', true,
      'command', v_command,
      'sale_order_id', p_sale_order_id,
      'receipt_id', v_receipt_id,
      'order_version_before', v_so.order_version,
      'order_version_after', v_version_after,
      'material_plan_revision_id', v_plan_revision_id,
      'preflight', v_preflight,
      'post_write_preflight', v_post_write_preflight,
      'result', COALESCE(v_result, '{}'::jsonb),
      'idempotent_replay', false
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT,
      v_error_detail = PG_EXCEPTION_DETAIL;

    SELECT so.order_version
      INTO v_version_after
      FROM public.sale_orders so
     WHERE so.id = p_sale_order_id;

    v_response := jsonb_build_object(
      'ok', false,
      'command', v_command,
      'sale_order_id', p_sale_order_id,
      'receipt_id', v_receipt_id,
      'order_version_before', v_so.order_version,
      'order_version_after', v_version_after,
      'preflight', v_preflight,
      'post_write_preflight', v_post_write_preflight,
      'error', jsonb_strip_nulls(jsonb_build_object(
        'code', v_error_state,
        'message', v_error_message,
        'detail', NULLIF(v_error_detail, '')
      )),
      'idempotent_replay', false
    );

    UPDATE public.sale_order_command_receipts
       SET status = 'failed',
           response = v_response,
           error_code = v_error_state,
           error_message = v_error_message,
           order_version_after = v_version_after,
           completed_at = now()
     WHERE id = v_receipt_id;

    BEGIN
      INSERT INTO public.sale_order_command_outbox(
        sale_order_id,
        aggregate_key,
        command_receipt_id,
        event_type,
        aggregate_version,
        idempotency_key,
        payload
      ) VALUES (
        p_sale_order_id,
        p_sale_order_id::text,
        v_receipt_id,
        'sale_order.command_failed',
        COALESCE(v_version_after, v_so.order_version),
        'command-failed:' || v_receipt_id::text,
        v_response
      )
      ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Falha ao gravar outbox do receipt %: %', v_receipt_id, SQLERRM;
    END;

    RETURN v_response;
  END;

  UPDATE public.sale_order_command_receipts
     SET status = 'succeeded',
         response = v_response,
         material_plan_revision_id = v_plan_revision_id,
         order_version_after = v_version_after,
         completed_at = now()
   WHERE id = v_receipt_id;

  v_event_type := CASE v_command
    WHEN 'update' THEN 'sale_order.updated'
    WHEN 'confirm' THEN 'sale_order.confirmed'
    WHEN 'promote' THEN 'sale_order.promoted'
    WHEN 'resync' THEN 'sale_order.resynced'
    WHEN 'cancel' THEN 'sale_order.cancelled'
    WHEN 'transition' THEN 'sale_order.transitioned'
    WHEN 'billing' THEN 'sale_order.billing_updated'
    WHEN 'factoring' THEN 'sale_order.factoring_updated'
  END;
  INSERT INTO public.sale_order_command_outbox(
    sale_order_id,
    aggregate_key,
    command_receipt_id,
    event_type,
    aggregate_version,
    idempotency_key,
    payload
  ) VALUES (
    p_sale_order_id,
    p_sale_order_id::text,
    v_receipt_id,
    v_event_type,
    v_version_after,
    'command-succeeded:' || v_receipt_id::text,
    v_response
  )
  ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;

  RETURN v_response;
END;
$$;

-- O guard de tiras é específico de itens de ficha técnica. O trigger legado
-- tentava carregar technical_sheets mesmo em item fiscal product-only e
-- tornava impossível criar NF avulsa. Mantém a validação integral para
-- reference_id e para qualquer transição entre os dois modelos.
DROP TRIGGER IF EXISTS trg_validate_sale_order_item_strap_color_alignment
  ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_validate_sale_order_item_strap_color_alignment_insert
  ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_validate_sale_order_item_strap_color_alignment_update
  ON public.sale_order_items;

CREATE TRIGGER trg_validate_sale_order_item_strap_color_alignment_insert
BEFORE INSERT ON public.sale_order_items
FOR EACH ROW
WHEN (NEW.reference_id IS NOT NULL)
EXECUTE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment();

CREATE TRIGGER trg_validate_sale_order_item_strap_color_alignment_update
BEFORE UPDATE OF
  sale_order_id, reference_id, material_variant_id, color, strap_colors,
  strap_sourcing
ON public.sale_order_items
FOR EACH ROW
WHEN (OLD.reference_id IS NOT NULL OR NEW.reference_id IS NOT NULL)
EXECUTE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment();

-- Writer privado da NF avulsa. Não emite NF, não reserva e não baixa estoque:
-- apenas cria um Rascunho fiscal idempotente. O fato de estoque pertence ao
-- comando de autorização/emissão e precisa de ledger compensatório próprio.
CREATE OR REPLACE FUNCTION public.create_standalone_sale_order_draft_internal(
  p_header jsonb,
  p_items jsonb,
  p_client_request_id uuid,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_order_id uuid;
  v_existing_hash text;
  v_existing_count integer;
  v_item jsonb;
  v_item_id uuid;
  v_item_ids uuid[] := '{}'::uuid[];
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_company_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_grade jsonb;
  v_grade_sum numeric;
  v_total numeric := 0;
  v_item_count integer := jsonb_array_length(p_items);
BEGIN
  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Função interna: use create_sale_order_command'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_header ->> 'client_id', '')), '') IS NULL THEN
    RAISE EXCEPTION 'NF avulsa exige header.client_id'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_client
    FROM public.clients c
   WHERE c.id = (p_header ->> 'client_id')::uuid
     AND c.active
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente inexistente/inativo para NF avulsa'
      USING ERRCODE = 'PZ107';
  END IF;

  IF NULLIF(btrim(COALESCE(p_header ->> 'company_id', '')), '') IS NOT NULL THEN
    v_company_id := (p_header ->> 'company_id')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.companies c
       WHERE c.id = v_company_id AND c.active
    ) THEN
      RAISE EXCEPTION 'Empresa inexistente/inativa para NF avulsa'
        USING ERRCODE = 'PZ107';
    END IF;
  END IF;

  -- Primeiro passe: valida tudo e calcula o total server-side antes de criar
  -- qualquer linha. Grade é informativa, mas se preenchida soma exatamente a
  -- quantidade; fichas será sempre 1 para não elevar a quantidade ao quadrado.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF NULLIF(btrim(COALESCE(v_item ->> 'reference_id', '')), '') IS NOT NULL THEN
      RAISE EXCEPTION 'NF avulsa aceita somente item product_id (sem ficha)'
        USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(COALESCE(v_item ->> 'product_id', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Item da NF avulsa exige product_id'
        USING ERRCODE = '22023';
    END IF;
    v_product_id := (v_item ->> 'product_id')::uuid;
    SELECT * INTO v_product
      FROM public.products p
     WHERE p.id = v_product_id
       AND p.active
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % inexistente/inativo para NF avulsa', v_product_id
        USING ERRCODE = 'PZ107';
    END IF;

    BEGIN
      v_quantity := (v_item ->> 'quantity')::numeric;
      v_unit_price := (v_item ->> 'unit_price')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Quantidade/preço inválido em item da NF avulsa'
        USING ERRCODE = '22023';
    END;
    IF v_quantity IS NULL
       OR v_quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_quantity <= 0
       OR trunc(v_quantity) <> v_quantity THEN
      RAISE EXCEPTION 'Quantidade da NF avulsa deve ser inteiro positivo'
        USING ERRCODE = '22023';
    END IF;
    IF v_unit_price IS NULL
       OR v_unit_price::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Preço da NF avulsa deve ser positivo'
        USING ERRCODE = '22023';
    END IF;

    v_grade := COALESCE(v_item -> 'grade', '{}'::jsonb);
    IF jsonb_typeof(v_grade) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Grade da NF avulsa deve ser objeto JSON'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM jsonb_each_text(v_grade) g
       WHERE g.value IN ('NaN', 'Infinity', '-Infinity')
    ) THEN
      RAISE EXCEPTION 'Grade da NF avulsa contém quantidade não finita'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM jsonb_each_text(v_grade) g
         WHERE (g.value)::numeric < 0
            OR trunc((g.value)::numeric) <> (g.value)::numeric
      ) THEN
        RAISE EXCEPTION 'Grade da NF avulsa aceita somente inteiros não negativos'
          USING ERRCODE = '22023';
      END IF;
      SELECT COALESCE(sum((g.value)::numeric), 0)
        INTO v_grade_sum
        FROM jsonb_each_text(v_grade) g;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Grade da NF avulsa contém quantidade inválida'
        USING ERRCODE = '22023';
    END;
    IF v_grade_sum > 0 AND v_grade_sum <> v_quantity THEN
      RAISE EXCEPTION
        'Soma da grade (%) difere da quantidade (%) na NF avulsa',
        v_grade_sum,
        v_quantity
        USING ERRCODE = '22023';
    END IF;
    v_total := v_total + (v_quantity * v_unit_price);
  END LOOP;

  INSERT INTO public.sale_orders(
    order_number,
    client_order_number,
    client_id,
    client_name,
    client_cnpj,
    client_contact,
    company_id,
    status,
    total,
    commission_value,
    notes,
    brand,
    order_type,
    is_standalone_nfe,
    nfe_required,
    client_request_id,
    client_request_payload_hash,
    client_request_item_count
  ) VALUES (
    '',
    COALESCE(
      NULLIF(btrim(p_header ->> 'client_order_number'), ''),
      'NF AVULSA ' || upper(left(p_client_request_id::text, 8))
    ),
    v_client.id,
    v_client.razao_social,
    COALESCE(v_client.cnpj, ''),
    COALESCE(v_client.contato, ''),
    v_company_id,
    'Rascunho',
    v_total,
    0,
    COALESCE(
      NULLIF(btrim(p_header ->> 'notes'), ''),
      'NF avulsa — rascunho aguardando validação antes da emissão.'
    ),
    COALESCE(NULLIF(btrim(p_header ->> 'brand'), ''), 'Squad Shoes'),
    'carteira',
    true,
    true,
    p_client_request_id,
    p_request_hash,
    v_item_count
  )
  ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT so.id, so.client_request_payload_hash, so.client_request_item_count
      INTO v_order_id, v_existing_hash, v_existing_count
      FROM public.sale_orders so
     WHERE so.client_request_id = p_client_request_id
     FOR UPDATE;
    IF v_existing_hash IS DISTINCT FROM p_request_hash
       OR v_existing_count IS DISTINCT FROM v_item_count THEN
      RAISE EXCEPTION
        'Replay divergente para client_request_id %', p_client_request_id
        USING ERRCODE = '22000';
    END IF;
    SELECT COALESCE(array_agg(soi.id ORDER BY soi.created_at, soi.id), '{}'::uuid[])
      INTO v_item_ids
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = v_order_id;
    RETURN jsonb_build_object(
      'order_id', v_order_id,
      'item_ids', to_jsonb(v_item_ids),
      'standalone_nfe', true,
      'idempotent_replay', true
    );
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unit_price')::numeric;
    v_grade := COALESCE(v_item -> 'grade', '{}'::jsonb);
    INSERT INTO public.sale_order_items(
      sale_order_id,
      reference_id,
      product_id,
      color,
      quantity,
      unit_price,
      grade,
      fichas,
      observation,
      strap_colors,
      strap_sourcing
    ) VALUES (
      v_order_id,
      NULL,
      (v_item ->> 'product_id')::uuid,
      NULLIF(btrim(COALESCE(v_item ->> 'color', '')), ''),
      v_quantity,
      v_unit_price,
      v_grade,
      1,
      NULLIF(btrim(COALESCE(v_item ->> 'observation', '')), ''),
      '[]'::jsonb,
      '{}'::jsonb
    )
    RETURNING id INTO v_item_id;
    v_item_ids := array_append(v_item_ids, v_item_id);
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'item_ids', to_jsonb(v_item_ids),
    'standalone_nfe', true,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_standalone_sale_order_draft_internal(
  jsonb, jsonb, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

-- A criação fiscal avulsa pertence ao módulo NF-e, não a /sales. Mantém a
-- mesma ativação fail-closed da allow-list granular: sem grants granulares vale
-- o RBAC legado; com allow-list ativa, exige can_create em nfe ou /nfe.
CREATE OR REPLACE FUNCTION public.can_execute_standalone_nfe_create()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_granular boolean := false;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.role::text = 'admin'
  ) THEN
    RETURN true;
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;
  IF NOT v_has_granular THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
       AND up.can_create
       AND up.module IN ('nfe', '/nfe')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_standalone_nfe_create()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_sale_order_command(
  p_header jsonb,
  p_items jsonb,
  p_idempotency_key text,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aggregate_key text;
  v_request_hash text;
  v_receipt public.sale_order_command_receipts%ROWTYPE;
  v_receipt_id uuid;
  v_result jsonb;
  v_response jsonb;
  v_header jsonb;
  v_sale_order_id uuid;
  v_version bigint;
  v_previous_internal text;
  v_is_standalone boolean := false;
  v_error_state text;
  v_error_message text;
  v_error_detail text;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id é obrigatório no comando create'
      USING ERRCODE = '22004';
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'idempotency_key é obrigatório (máximo 200 caracteres)'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_header) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create exige header objeto e items array não vazio'
      USING ERRCODE = '22023';
  END IF;
  v_is_standalone := COALESCE(
    NULLIF(p_header ->> 'is_standalone_nfe', '')::boolean,
    false
  );

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(
         CASE WHEN v_is_standalone
           THEN ARRAY['admin', 'gerente', 'comercial', 'nfe_operator']
           ELSE ARRAY['admin', 'gerente', 'comercial']
         END
       )
     ) THEN
    RAISE EXCEPTION 'Papel sem permissão para criar pedido de venda'
      USING ERRCODE = '42501';
  END IF;
  IF v_is_standalone THEN
    IF NOT public.can_execute_standalone_nfe_create() THEN
      RAISE EXCEPTION
        'Permission denied: usuário sem can_create em /nfe'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.can_execute_sale_order_command('create') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_create em /sales'
      USING ERRCODE = '42501';
  END IF;

  v_aggregate_key := 'create:' || p_client_request_id::text;
  v_request_hash := md5(jsonb_build_object(
    'header', p_header,
    'items', p_items,
    'client_request_id', p_client_request_id
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sale-order-command:' || v_aggregate_key,
    0
  ));

  SELECT * INTO v_receipt
    FROM public.sale_order_command_receipts r
   WHERE r.command_name = 'create'
     AND r.aggregate_key = v_aggregate_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION
        'Replay idempotente divergente para client_request_id %',
        p_client_request_id
        USING ERRCODE = '22000';
    END IF;
    IF v_receipt.status IN ('succeeded', 'failed') THEN
      RETURN COALESCE(v_receipt.response, '{}'::jsonb) || jsonb_build_object(
        'receipt_id', v_receipt.id,
        'idempotent_replay', true
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'command', 'create',
      'receipt_id', v_receipt.id,
      'client_request_id', p_client_request_id,
      'error', jsonb_build_object(
        'code', 'command_in_progress',
        'message', 'Comando idempotente ainda está em processamento.'
      )
    );
  END IF;

  INSERT INTO public.sale_order_command_receipts(
    client_request_id,
    aggregate_key,
    command_name,
    idempotency_key,
    request_hash,
    actor_id
  ) VALUES (
    p_client_request_id,
    v_aggregate_key,
    'create',
    btrim(p_idempotency_key),
    v_request_hash,
    auth.uid()
  )
  RETURNING id INTO v_receipt_id;

  BEGIN
    IF NULLIF(btrim(COALESCE(p_header ->> 'status', '')), '') IS NOT NULL
       AND p_header ->> 'status' NOT IN ('Rascunho', 'Pendente') THEN
      RAISE EXCEPTION
        'create command cria somente rascunho; confirme/promova em comando separado'
        USING ERRCODE = 'PZ114';
    END IF;

    -- Mobile e integrações nascem draft-only. O readiness comercial/técnico é
    -- executado depois por confirm/promote, nunca contornado no create.
    v_header := p_header || jsonb_build_object('status', 'Rascunho');
    v_previous_internal := current_setting('app.sale_order_command_internal', true);
    PERFORM set_config('app.sale_order_command_internal', '1', true);
    IF v_is_standalone THEN
      v_result := public.create_standalone_sale_order_draft_internal(
        v_header,
        p_items,
        p_client_request_id,
        public.strap_payload_hash(jsonb_build_object(
          'header', v_header,
          'items', p_items
        ))
      );
    ELSE
      v_result := public.create_sale_order_atomic(
        v_header,
        p_items,
        p_client_request_id
      );
    END IF;
    PERFORM set_config(
      'app.sale_order_command_internal',
      COALESCE(v_previous_internal, ''),
      true
    );

    v_sale_order_id := NULLIF(v_result ->> 'order_id', '')::uuid;
    IF v_sale_order_id IS NULL THEN
      RAISE EXCEPTION 'Writer de criação não retornou order_id';
    END IF;
    SELECT so.order_version
      INTO v_version
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV criado não foi encontrado ao fechar o receipt';
    END IF;

    v_response := jsonb_build_object(
      'ok', true,
      'command', 'create',
      'sale_order_id', v_sale_order_id,
      'client_request_id', p_client_request_id,
      'receipt_id', v_receipt_id,
      'order_version_after', v_version,
      'result', COALESCE(v_result, '{}'::jsonb),
      'idempotent_replay', false
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT,
      v_error_detail = PG_EXCEPTION_DETAIL;
    v_response := jsonb_build_object(
      'ok', false,
      'command', 'create',
      'client_request_id', p_client_request_id,
      'receipt_id', v_receipt_id,
      'error', jsonb_strip_nulls(jsonb_build_object(
        'code', v_error_state,
        'message', v_error_message,
        'detail', NULLIF(v_error_detail, '')
      )),
      'idempotent_replay', false
    );

    UPDATE public.sale_order_command_receipts
       SET status = 'failed',
           response = v_response,
           error_code = v_error_state,
           error_message = v_error_message,
           completed_at = now()
     WHERE id = v_receipt_id;

    INSERT INTO public.sale_order_command_outbox(
      client_request_id,
      aggregate_key,
      command_receipt_id,
      event_type,
      aggregate_version,
      idempotency_key,
      payload
    ) VALUES (
      p_client_request_id,
      v_aggregate_key,
      v_receipt_id,
      'sale_order.command_failed',
      0,
      'command-failed:' || v_receipt_id::text,
      v_response
    )
    ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;
    RETURN v_response;
  END;

  UPDATE public.sale_order_command_receipts
     SET sale_order_id = v_sale_order_id,
         status = 'succeeded',
         response = v_response,
         order_version_after = v_version,
         completed_at = now()
   WHERE id = v_receipt_id;

  INSERT INTO public.sale_order_command_outbox(
    sale_order_id,
    client_request_id,
    aggregate_key,
    command_receipt_id,
    event_type,
    aggregate_version,
    idempotency_key,
    payload
  ) VALUES (
    v_sale_order_id,
    p_client_request_id,
    v_aggregate_key,
    v_receipt_id,
    'sale_order.created',
    v_version,
    'command-succeeded:' || v_receipt_id::text,
    v_response
  )
  ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;

  RETURN v_response;
END;
$$;

-- ---------------------------------------------------------------------------
-- Wrappers legados: preservam shapes, mas não preservam motores concorrentes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.promote_sale_order_to_production(
  p_sale_order_id uuid,
  p_target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version bigint;
  v_command text;
  v_envelope jsonb;
BEGIN
  -- O writer atômico legado de edição chama este wrapper dentro do novo
  -- command boundary. O marcador evita recursão execute -> update -> promote.
  IF current_setting('app.sale_order_command_internal', true) = '1' THEN
    RETURN public.promote_sale_order_atomic_internal(
      p_sale_order_id,
      p_target_status
    );
  END IF;

  IF p_target_status NOT IN ('Aprovado', 'Em Produção') THEN
    RAISE EXCEPTION 'Status alvo inválido: %', p_target_status
      USING ERRCODE = '22023';
  END IF;
  SELECT order_version INTO v_version
    FROM public.sale_orders
   WHERE id = p_sale_order_id
     AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;
  v_command := CASE WHEN p_target_status = 'Aprovado'
    THEN 'confirm' ELSE 'promote' END;
  v_envelope := public.execute_sale_order_command(
    p_sale_order_id,
    v_command,
    v_version,
    concat('legacy:', v_command, ':', v_version),
    '{}'::jsonb,
    NULL
  );
  IF COALESCE((v_envelope ->> 'ok')::boolean, false) THEN
    RETURN v_envelope -> 'result';
  END IF;
  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'target_status', p_target_status,
    'ops_criadas', 0,
    'order_ids', '[]'::jsonb,
    'itens_falha', jsonb_build_array(jsonb_build_object(
      'sqlstate', v_envelope #>> '{error,code}',
      'message', COALESCE(
        v_envelope #>> '{error,message}',
        'Promoção recusada pelo command boundary'
      )
    )),
    'shortages', '[]'::jsonb,
    'sole_shortfall_order_ids', '[]'::jsonb,
    'receipt_id', v_envelope -> 'receipt_id'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_sale_order_to_production(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version bigint;
  v_envelope jsonb;
BEGIN
  IF current_setting('app.sale_order_command_internal', true) = '1' THEN
    RETURN public.promote_sale_order_atomic_internal(
      p_sale_order_id,
      'Em Produção'
    );
  END IF;
  SELECT order_version INTO v_version
    FROM public.sale_orders
   WHERE id = p_sale_order_id
     AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;
  v_envelope := public.execute_sale_order_command(
    p_sale_order_id,
    'promote',
    v_version,
    concat('legacy:promote:', v_version),
    '{}'::jsonb,
    NULL
  );
  IF COALESCE((v_envelope ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'status', 'Em Produção',
      'created_ops', COALESCE((v_envelope #>> '{result,created_ops}')::integer, 0),
      'reused_ops', COALESCE((v_envelope #>> '{result,reused_ops}')::integer, 0),
      'promoted_ops', COALESCE((v_envelope #>> '{result,promoted_ops}')::integer, 0),
      'already_promoted', COALESCE(
        (v_envelope #>> '{result,already_promoted}')::boolean,
        false
      ),
      'ops', COALESCE(v_envelope #> '{result,ops}', '[]'::jsonb),
      'receipt_id', v_envelope -> 'receipt_id'
    );
  END IF;
  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'status', NULL,
    'created_ops', 0,
    'reused_ops', 0,
    'promoted_ops', 0,
    'already_promoted', false,
    'ops', '[]'::jsonb,
    'error', v_envelope -> 'error',
    'receipt_id', v_envelope -> 'receipt_id'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_sale_order_item_promotion(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id uuid;
  v_status text;
  v_version bigint;
  v_command text;
  v_envelope jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Papel sem permissão para retentar promoção de PV'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /sales para retentar promoção'
      USING ERRCODE = '42501';
  END IF;

  SELECT soi.sale_order_id, so.status, so.order_version
    INTO v_sale_order_id, v_status, v_version
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
   WHERE soi.id = p_item_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % não encontrado', p_item_id;
  END IF;
  IF v_status IN ('Cancelado', 'cancelado') THEN
    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now()
     WHERE sale_order_item_id = p_item_id
       AND resolved_at IS NULL;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'PV cancelado — pendência encerrada',
      'whole_order', true
    );
  END IF;
  v_command := CASE WHEN v_status = 'Em Produção'
    THEN 'promote' ELSE 'confirm' END;
  v_envelope := public.execute_sale_order_command(
    v_sale_order_id,
    v_command,
    v_version,
    concat('retry-item:', p_item_id::text, ':', v_version),
    '{}'::jsonb,
    NULL
  );
  IF COALESCE((v_envelope ->> 'ok')::boolean, false) THEN
    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now()
     WHERE sale_order_item_id = p_item_id
       AND resolved_at IS NULL;
    RETURN jsonb_build_object(
      'ok', true,
      'sale_order_id', v_sale_order_id,
      'item_id', p_item_id,
      'whole_order', true,
      'receipt_id', v_envelope -> 'receipt_id',
      'result', v_envelope -> 'result'
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', false,
    'sale_order_id', v_sale_order_id,
    'item_id', p_item_id,
    'whole_order', true,
    'receipt_id', v_envelope -> 'receipt_id',
    'reason', COALESCE(
      v_envelope #>> '{error,message}',
      'Retentativa recusada pelo command boundary'
    ),
    'error', v_envelope -> 'error'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_sale_order_command(uuid, text, bigint, text, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_sale_order_command(uuid, text, bigint, text, jsonb, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_sale_order_command(jsonb, jsonb, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order_command(jsonb, jsonb, text, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.promote_sale_order_to_production(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_sale_order_to_production(uuid, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.promote_sale_order_to_production(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_sale_order_to_production(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.retry_sale_order_item_promotion(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_sale_order_item_promotion(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_sale_order_command(uuid, text, bigint, text, jsonb, uuid) IS
  'Entrypoint canônico update/confirm/promote/resync/cancel: RBAC, expected_version obrigatório, readiness, idempotência, receipt e outbox na mesma transação.';
COMMENT ON FUNCTION public.create_sale_order_command(jsonb, jsonb, text, uuid) IS
  'Cria somente PV Rascunho com client_request_id e idempotency_key obrigatórios; confirmação/promoção são comandos separados.';
COMMENT ON FUNCTION public.promote_sale_order_to_production(uuid, text) IS
  'Wrapper legado com shape preservado sobre execute_sale_order_command; não é um segundo motor.';
COMMENT ON FUNCTION public.promote_sale_order_to_production(uuid) IS
  'Wrapper legado de promoção direta com shape preservado sobre execute_sale_order_command.';

COMMIT;

NOTIFY pgrst, 'reload schema';
