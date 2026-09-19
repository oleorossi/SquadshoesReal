-- =============================================================================
-- Cancel compensatório: tolera crédito líquido órfão de resync no ledger
-- =============================================================================
-- Caso vivo (PV-2026-00097 / OP-2026-00781..783):
--   resync_op_atomic antigo gravou IN "Estorno automático - resync_op_atomic"
--   de COLA FORTE sem OUT correspondente na mesma OP → net_debit < 0.
--   cancel_production_order_internal (PZ212) abortava o cancel compensatório
--   do PV inteiro, mesmo com admin + motivo + confirmação de chão.
--
-- Decisão:
--   * Quantidade nula/≤0 continua barrando sempre (ledger corrompido).
--   * Crédito líquido (net < 0) no cancel AUTOMÁTICO continua PZ212, agora
--     nomeando produto e OP pelo número — não UUID.
--   * No cancel COMPENSATÓRIO (GUC app.sale_order_command_compensatory_cancel),
--     o crédito órfão NÃO aborta: restore_* só mexem em net > 0, então o
--     crédito permanece como fato histórico e o PV consegue fechar.
--   * Preflight passa a listar o crédito órfão (code invalid_ledger,
--     overridable=true) pra o modal compensatório mostrar antes do confirm.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_production_order_internal(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_parent_status text;
  v_has_physical_sole boolean := false;
  v_has_positive_net_debit boolean := false;
  v_has_bad_qty boolean := false;
  v_has_over_restore boolean := false;
  v_missing_destination uuid;
  v_status_before text;
  v_compensatory boolean := false;
  v_over_summary text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: use execute_production_order_command'
      USING ERRCODE = '42501';
  END IF;

  v_compensatory := COALESCE(
    pg_catalog.current_setting('app.sale_order_command_compensatory_cancel', true),
    ''
  ) = '1';

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  SELECT * INTO v_order
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % nao encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  v_status_before := v_order.status;

  IF v_order.status IN ('Cancelada', 'Cancelado') THEN
    RETURN pg_catalog.jsonb_build_object(
      'order_id', v_order.id,
      'status_before', v_status_before,
      'status', 'Cancelada',
      'already_cancelled', true
    );
  END IF;

  SELECT sale.status
    INTO v_parent_status
    FROM public.sale_orders sale
   WHERE sale.id = v_order.sale_order_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV vinculado a OP % nao encontrado', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_parent_status IN (
    'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
  ) THEN
    RAISE EXCEPTION
      'OP vinculada a PV faturado/finalizado; reverta NF/PV antes de cancelar a OP'
      USING ERRCODE = 'PZ211';
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public.stock_movements movement
            WHERE movement.order_id = v_order.id
              AND movement.movement_type = 'out'
              AND (
                movement.description ILIKE 'Debito Solado por grade%'
                OR movement.description ILIKE 'Débito Solado por grade%'
                OR movement.description ILIKE 'Baixa na finalização — Solado por grade%'
                OR movement.description ILIKE 'Picking Solado por grade%'
              )
         ),
         EXISTS (
           SELECT 1
             FROM (
               SELECT movement.product_id,
                      pg_catalog.sum(CASE
                        WHEN movement.movement_type = 'out' THEN movement.quantity
                        WHEN movement.movement_type = 'in' THEN -movement.quantity
                        ELSE 0
                      END) AS net_debit
                 FROM public.stock_movements movement
                WHERE movement.order_id = v_order.id
                GROUP BY movement.product_id
             ) ledger
            WHERE ledger.net_debit > 0.0001
         ),
         EXISTS (
           SELECT 1
             FROM public.stock_movements movement
            WHERE movement.order_id = v_order.id
              AND movement.movement_type IN ('in', 'out')
              AND (movement.quantity IS NULL OR movement.quantity <= 0)
         ),
         EXISTS (
           SELECT 1
             FROM (
               SELECT movement.product_id,
                      pg_catalog.sum(CASE
                        WHEN movement.movement_type = 'out' THEN movement.quantity
                        WHEN movement.movement_type = 'in' THEN -movement.quantity
                        ELSE 0
                      END) AS net_debit
                 FROM public.stock_movements movement
                WHERE movement.order_id = v_order.id
                GROUP BY movement.product_id
             ) ledger
            WHERE ledger.net_debit < -0.0001
         )
    INTO v_has_physical_sole,
         v_has_positive_net_debit,
         v_has_bad_qty,
         v_has_over_restore;

  IF v_has_bad_qty THEN
    RAISE EXCEPTION
      'Ledger da OP % tem movimento com quantidade nula/nao positiva; reconciliacao manual obrigatoria',
      COALESCE(NULLIF(btrim(v_order.order_number), ''), v_order.id::text)
      USING ERRCODE = 'PZ212';
  END IF;

  IF v_has_over_restore AND NOT v_compensatory THEN
    SELECT pg_catalog.string_agg(
             format(
               '%s (%s)',
               COALESCE(NULLIF(btrim(product.name), ''), ledger.product_id::text),
               trim(to_char(-ledger.net_debit, 'FM999999990.999999'))
             ),
             ', '
             ORDER BY COALESCE(product.name, ledger.product_id::text)
           )
      INTO v_over_summary
      FROM (
        SELECT movement.product_id,
               pg_catalog.sum(CASE
                 WHEN movement.movement_type = 'out' THEN movement.quantity
                 WHEN movement.movement_type = 'in' THEN -movement.quantity
                 ELSE 0
               END) AS net_debit
          FROM public.stock_movements movement
         WHERE movement.order_id = v_order.id
         GROUP BY movement.product_id
      ) ledger
      LEFT JOIN public.products product ON product.id = ledger.product_id
     WHERE ledger.net_debit < -0.0001;

    RAISE EXCEPTION
      'Ledger da OP % e invalido (credito liquido sem debito: %); reconciliacao manual obrigatoria',
      COALESCE(NULLIF(btrim(v_order.order_number), ''), v_order.id::text),
      COALESCE(v_over_summary, 'produto desconhecido')
      USING ERRCODE = 'PZ212';
  END IF;

  SELECT ledger.product_id
    INTO v_missing_destination
    FROM (
      SELECT movement.product_id,
             pg_catalog.sum(CASE
               WHEN movement.movement_type = 'out' THEN movement.quantity
               WHEN movement.movement_type = 'in' THEN -movement.quantity
               ELSE 0
             END) AS net_debit
        FROM public.stock_movements movement
       WHERE movement.order_id = v_order.id
       GROUP BY movement.product_id
    ) ledger
    LEFT JOIN public.products product ON product.id = ledger.product_id
    LEFT JOIN public.box_types box_type ON box_type.id = ledger.product_id
   WHERE ledger.net_debit > 0.0001
     AND product.id IS NULL
     AND box_type.id IS NULL
   ORDER BY ledger.product_id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Destino % do ledger da OP % nao existe em products/box_types',
      v_missing_destination,
      COALESCE(NULLIF(btrim(v_order.order_number), ''), v_order.id::text)
      USING ERRCODE = 'PZ212';
  END IF;

  PERFORM public.release_order_reservations(v_order.id);

  -- Os restores calculam SUM(out)-SUM(in), travam os destinos e sao
  -- idempotentes. Credito liquido (net < 0) nao e tocado — fica no historico.
  IF v_has_physical_sole THEN
    PERFORM public.restore_sole_grade_for_order(v_order.id);
  END IF;
  IF v_has_positive_net_debit THEN
    PERFORM public.restore_product_stocks_for_order(v_order.id);
  END IF;

  -- Nenhum warning de destino ausente pode permitir cancelar com ledger aberto.
  IF EXISTS (
    SELECT 1
      FROM public.stock_movements movement
     WHERE movement.order_id = v_order.id
     GROUP BY movement.product_id
    HAVING pg_catalog.sum(CASE
      WHEN movement.movement_type = 'out' THEN movement.quantity
      WHEN movement.movement_type = 'in' THEN -movement.quantity
      ELSE 0
    END) > 0.0001
  ) THEN
    RAISE EXCEPTION
      'Estorno liquido da OP % permaneceu incompleto',
      COALESCE(NULLIF(btrim(v_order.order_number), ''), v_order.id::text)
      USING ERRCODE = 'PZ212';
  END IF;

  UPDATE public.orders
     SET status = 'Cancelada',
         updated_at = pg_catalog.now()
   WHERE id = v_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order.id,
    'status_before', v_status_before,
    'status', 'Cancelada',
    'already_cancelled', false,
    'restored_sole_grade', v_has_physical_sole,
    'restored_product_stock', v_has_positive_net_debit,
    'restore_basis', 'net_ledger',
    'over_restored_left_in_place', v_has_over_restore,
    'compensatory', v_compensatory
  );
END;
$function$;

COMMENT ON FUNCTION public.cancel_production_order_internal(uuid) IS
  'Cancela OP com estorno liquido. Credito orfao (net<0) bloqueia no caminho '
  'automatico (PZ212); no compensatorio (GUC sale_order_command_compensatory_cancel) '
  'permanece no historico sem abortar — restore_* so toca net>0.';

-- ---------------------------------------------------------------------------
-- Preflight: lista credito orfao pra o modal compensatorio avisar antes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_order_physical_fact_blockers(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_blockers jsonb := '[]'::jsonb;
  v_op record;
  v_kinds text[];
  v_has_stage boolean;
  v_has_lot boolean;
  v_has_reservation boolean;
  v_has_consumption boolean;
  v_over_summary text;
  v_product_ids uuid[];
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- NF-e continua no preflight/cancel (PZ112) — este helper cobre só fatos de OP.

  FOR v_op IN
    SELECT o.id, o.order_number, o.status
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND o.status IN (
         'Finalizado', 'FINALIZADO', 'Concluído', 'Concluido', 'Concluída'
       )
     ORDER BY o.order_number NULLS LAST, o.id
  LOOP
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'physical_finalized_op',
      'scope', 'production',
      'message', format(
        'OP %s está finalizada/concluída; cancelamento automático recusado',
        COALESCE(NULLIF(btrim(v_op.order_number), ''), v_op.id::text)
      ),
      'details', jsonb_build_object(
        'op_id', v_op.id,
        'op_number', v_op.order_number,
        'op_status', v_op.status,
        'fact_kinds', jsonb_build_array('finalized')
      ),
      'overridable', false
    ));
  END LOOP;

  FOR v_op IN
    SELECT o.id, o.order_number, o.status
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Cancelada', 'Cancelado',
         'Finalizado', 'FINALIZADO',
         'Concluído', 'Concluido', 'Concluída'
       )
     ORDER BY o.order_number NULLS LAST, o.id
  LOOP
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

    v_kinds := ARRAY[]::text[];
    IF v_has_stage THEN v_kinds := v_kinds || ARRAY['stage']; END IF;
    IF v_has_lot THEN v_kinds := v_kinds || ARRAY['lot']; END IF;
    IF v_has_reservation THEN v_kinds := v_kinds || ARRAY['reservation']; END IF;
    IF v_has_consumption THEN v_kinds := v_kinds || ARRAY['consumption']; END IF;

    IF cardinality(v_kinds) > 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'physical_fact',
        'scope', 'production',
        'message', format(
          'OP %s possui fato físico (%s); cancelamento automático recusado',
          COALESCE(NULLIF(btrim(v_op.order_number), ''), v_op.id::text),
          array_to_string(v_kinds, ', ')
        ),
        'details', jsonb_build_object(
          'op_id', v_op.id,
          'op_number', v_op.order_number,
          'op_status', v_op.status,
          'fact_kinds', to_jsonb(v_kinds)
        ),
        'overridable', false
      ));
    END IF;
  END LOOP;

  -- Credito liquido orfao (tipicamente IN de resync sem OUT). Compensatorio
  -- consegue seguir; automatico continua barrado em cancel_production_order_internal.
  FOR v_op IN
    SELECT o.id, o.order_number, o.status
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN ('Cancelada', 'Cancelado')
     ORDER BY o.order_number NULLS LAST, o.id
  LOOP
    SELECT
      string_agg(
        format(
          '%s (%s)',
          COALESCE(NULLIF(btrim(p.name), ''), ledger.product_id::text),
          trim(to_char(-ledger.net_debit, 'FM999999990.999999'))
        ),
        ', '
        ORDER BY COALESCE(p.name, ledger.product_id::text)
      ),
      array_agg(ledger.product_id ORDER BY COALESCE(p.name, ledger.product_id::text))
      INTO v_over_summary, v_product_ids
      FROM (
        SELECT sm.product_id,
               sum(CASE
                 WHEN sm.movement_type = 'out' THEN sm.quantity
                 WHEN sm.movement_type = 'in' THEN -sm.quantity
                 ELSE 0
               END) AS net_debit
          FROM public.stock_movements sm
         WHERE sm.order_id = v_op.id
         GROUP BY sm.product_id
      ) ledger
      LEFT JOIN public.products p ON p.id = ledger.product_id
     WHERE ledger.net_debit < -0.0001;

    IF v_over_summary IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_ledger',
        'scope', 'production',
        'message', format(
          'OP %s tem crédito líquido órfão no ledger (%s); cancelamento automático recusado — compensatório deixa o crédito no histórico',
          COALESCE(NULLIF(btrim(v_op.order_number), ''), v_op.id::text),
          v_over_summary
        ),
        'details', jsonb_build_object(
          'op_id', v_op.id,
          'op_number', v_op.order_number,
          'op_status', v_op.status,
          'fact_kinds', jsonb_build_array('over_restored'),
          'products', to_jsonb(v_product_ids),
          'summary', v_over_summary
        ),
        'overridable', true
      ));
    END IF;
  END LOOP;

  RETURN v_blockers;
END;
$$;

COMMENT ON FUNCTION public.sale_order_physical_fact_blockers(uuid) IS
  'Blockers de fato fisico / OP finalizada / credito orfao de ledger para '
  'preflight de cancel e Aprovado→Rascunho. invalid_ledger e overridable '
  '(compensatorio tolera; automatico ainda RAISE PZ212).';
