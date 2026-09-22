-- =============================================================================
-- Cancel compensatório: também cancela OP Finalizado/Concluído
-- =============================================================================
-- Bug: cancel_sale_order_atomic_internal dava RAISE incondicional em OP
-- finalizada ANTES de ler app.sale_order_command_compensatory_cancel. O
-- preflight com payload.compensatory=true já demovia physical_finalized_op
-- para warning (UI liberava), mas o execute sempre falhava.
--
-- Fix: ler GUC primeiro; RAISE de finalizada só no cancel automático; no
-- compensatório incluir Finalizado no loop e reusar cancel_production_order_internal.
-- NF-e ativa (PZ112) continua barrada sempre.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_sale_order_atomic_internal(
  p_sale_order_id uuid,
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_op record;
  v_restore jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_previous_status text;
  v_previous_restore_legacy_strap text;
  v_compensatory boolean := false;
  v_fact_kinds text[];
  v_has_stage boolean;
  v_has_lot boolean;
  v_has_reservation boolean;
  v_has_consumption boolean;
  v_op_cancel jsonb;
  v_is_finalized boolean;
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

  -- Compensatório precisa ser lido ANTES do gate de OP finalizada.
  v_compensatory := COALESCE(
    current_setting('app.sale_order_command_compensatory_cancel', true),
    ''
  ) = '1';

  -- Cancel automático continua recusando OP finalizada. Compensatório (admin
  -- + motivo) cancela via cancel_production_order_internal — mesmo estorno
  -- de ledger do cancel de OP avulso.
  IF NOT v_compensatory AND EXISTS (
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
       AND o.status NOT IN ('Cancelada', 'Cancelado')
       -- Automático: finalizadas já foram barradas acima. Compensatório:
       -- inclui Finalizado/Concluído para cancel_production_order_internal.
       AND (
         v_compensatory
         OR o.status NOT IN (
           'Finalizado', 'FINALIZADO', 'Concluído', 'Concluido', 'Concluída'
         )
       )
     ORDER BY o.id
     FOR UPDATE
  LOOP
    v_is_finalized := v_op.status IN (
      'Finalizado', 'FINALIZADO', 'Concluído', 'Concluido', 'Concluída'
    );

    SELECT
      EXISTS (
        SELECT 1
          FROM public.order_stages os
         WHERE os.order_id = v_op.id
           AND (
             COALESCE(os.quantity_processed, 0) > 0
             OR os.started_at IS NOT NULL
             OR os.completed_at IS NOT NULL
             OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')
           )
      ),
      EXISTS (
        SELECT 1
          FROM public.order_lots ol
         WHERE ol.order_id = v_op.id
           AND (
             ol.started_at IS NOT NULL
             OR ol.completed_at IS NOT NULL
             OR lower(COALESCE(ol.status, '')) NOT IN ('', 'pendente', 'pending')
           )
      ),
      EXISTS (
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
      ),
      EXISTS (
        SELECT 1
          FROM public.production_consumptions pc
         WHERE pc.order_id = v_op.id
           AND pc.superseded_at IS NULL
           AND COALESCE(pc.actual_quantity, 0) > 0
      )
      INTO v_has_stage, v_has_lot, v_has_reservation, v_has_consumption;

    v_fact_kinds := ARRAY[]::text[];
    IF v_is_finalized THEN v_fact_kinds := v_fact_kinds || ARRAY['finalized']; END IF;
    IF v_has_stage THEN v_fact_kinds := v_fact_kinds || ARRAY['stage']; END IF;
    IF v_has_lot THEN v_fact_kinds := v_fact_kinds || ARRAY['lot']; END IF;
    IF v_has_reservation THEN v_fact_kinds := v_fact_kinds || ARRAY['reservation']; END IF;
    IF v_has_consumption THEN v_fact_kinds := v_fact_kinds || ARRAY['consumption']; END IF;

    IF cardinality(v_fact_kinds) > 0 AND NOT v_compensatory THEN
      RAISE EXCEPTION
        'OP % possui fato físico (%); cancelamento automático recusado',
        COALESCE(NULLIF(btrim(v_op.order_number), ''), v_op.id::text),
        array_to_string(v_fact_kinds, ', ')
        USING ERRCODE = 'PZ105';
    END IF;

    IF v_compensatory THEN
      -- Mesmo estorno de ledger do cancel de OP: libera reservas + restore
      -- causal. Apontamentos/etapas permanecem no histórico. Vale também
      -- para OP Finalizado/Concluído no caminho admin compensatório.
      v_op_cancel := public.cancel_production_order_internal(v_op.id);
      v_ops := v_ops || jsonb_build_array(jsonb_build_object(
        'order_id', v_op.id,
        'order_number', v_op.order_number,
        'status_before', v_op.status,
        'compensatory', true,
        'fact_kinds', to_jsonb(v_fact_kinds),
        'production_cancel', v_op_cancel
      ));
    ELSE
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
    END IF;
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
    'cancelled_ops', v_ops,
    'compensatory', v_compensatory
  );
END;
$$;
