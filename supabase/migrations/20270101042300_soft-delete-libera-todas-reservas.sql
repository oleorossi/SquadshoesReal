-- Soft-delete de PV libera TODAS as reservas e devolve material ao estoque.
--
-- Decisão do dono (2026-10-17): exclusão lógica NÃO pode deixar empenho preso.
-- Antes: soft_delete_sale_order_internal_108 só setava deleted_at (mig
-- 20260827120000 — "SEM efeito em estoque/reserva"). Medido no PV-00236:
--   sole_grade 1.178 + pv_commitment 747 + component (outros PVs) ainda reserved.
-- Em PVs soft-deleted: 60 sole_grade + 246 component + 18 pv_commitment abertas;
-- 0 OPs com débito físico líquido (só empenho soft).
--
-- Regra nova:
--   1) soft-delete → release de reserved/partially_consumed/pending_reconciliation
--      + estorno físico se houver out líquido (mesmo critério do cancel OP).
--   2) restore → reabre o PV/OPs e re-empenha (soft) se não houver reserva ativa.
--   3) Backfill: libera reservas abertas de TODO PV já soft-deleted.

-- ---------------------------------------------------------------------------
-- 1. Helper: libera reservas + estorna ledger físico (SEM mudar status da OP)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_and_restore_stock_for_soft_delete_order(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_has_physical_sole boolean := false;
  v_has_prior_inbound boolean := false;
  v_has_positive_net_debit boolean := false;
  v_released integer := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1'
     AND COALESCE(current_setting('app.production_order_command_internal', true), '') <> '1'
     AND NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Função interna: use soft_delete_sale_order_command'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.strap_engine_write', '1', true);

  -- Todas as reservas abertas (solado, componente, pv_commitment, tira, …).
  -- pending_reconciliation também: PV excluído não deve deixar furo vivo.
  UPDATE public.material_reservations
     SET status = 'cancelled',
         updated_at = now()
   WHERE order_id = p_order_id
     AND status IN ('reserved', 'partially_consumed', 'pending_reconciliation');
  GET DIAGNOSTICS v_released = ROW_COUNT;

  DELETE FROM public.reservation_batches WHERE order_id = p_order_id;

  SELECT EXISTS (
           SELECT 1
             FROM public.stock_movements sm
            WHERE sm.order_id = v_order.id
              AND sm.movement_type = 'out'
              AND (
                sm.description ILIKE 'Debito Solado por grade%'
                OR sm.description ILIKE 'Débito Solado por grade%'
                OR sm.description ILIKE 'Baixa na finalização — Solado por grade%'
                OR sm.description ILIKE 'Baixa Solagem — Solado por grade%'
              )
         ),
         EXISTS (
           SELECT 1
             FROM public.stock_movements sm
            WHERE sm.order_id = v_order.id
              AND sm.movement_type = 'in'
         ),
         EXISTS (
           SELECT 1
             FROM (
               SELECT sm.product_id,
                      sum(CASE
                        WHEN sm.movement_type = 'out' THEN sm.quantity
                        WHEN sm.movement_type = 'in' THEN -sm.quantity
                        ELSE 0
                      END) AS net_debit
                 FROM public.stock_movements sm
                WHERE sm.order_id = v_order.id
                GROUP BY sm.product_id
             ) ledger
            WHERE ledger.net_debit > 0
         )
    INTO v_has_physical_sole,
         v_has_prior_inbound,
         v_has_positive_net_debit;

  IF v_has_prior_inbound AND v_has_positive_net_debit THEN
    RAISE EXCEPTION
      'Ledger da OP % possui estorno parcial anterior; reconciliação manual obrigatória',
      v_order.id USING ERRCODE = 'PZ212';
  END IF;

  IF v_has_physical_sole AND NOT v_has_prior_inbound THEN
    PERFORM public.restore_sole_grade_for_order(v_order.id);
  END IF;
  IF v_has_positive_net_debit THEN
    PERFORM public.restore_product_stocks_for_order(v_order.id);
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'released_reservations', v_released,
    'restored_sole_grade', v_has_physical_sole AND NOT v_has_prior_inbound,
    'restored_product_stock', v_has_positive_net_debit
  );
END;
$function$;

COMMENT ON FUNCTION public.release_and_restore_stock_for_soft_delete_order(uuid) IS
  'Soft-delete: cancela todas as reservas da OP e estorna out físico líquido. Não muda status.';

REVOKE ALL ON FUNCTION public.release_and_restore_stock_for_soft_delete_order(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_and_restore_stock_for_soft_delete_order(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. soft_delete: esconde PV/OPs DEPOIS de liberar estoque
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_sale_order_internal_108(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_blocking_nfe int;
  v_ops_hidden int := 0;
  v_ops_released int := 0;
  v_op record;
  v_release jsonb;
  v_releases jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_id;
  END IF;
  IF v_so.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sale order % já está deletado em %', p_id, v_so.deleted_at;
  END IF;
  SELECT COUNT(*) INTO v_blocking_nfe
  FROM public.nfe_emitidas
  WHERE sale_order_id = p_id AND status IN ('autorizada','processando','cancelando');
  IF v_blocking_nfe > 0 THEN
    RAISE EXCEPTION 'PV tem NF-e ativa — cancele a NF-e antes de excluir';
  END IF;

  -- Libera empenho de TODAS as OPs ainda visíveis (qualquer kind de reserva).
  FOR v_op IN
    SELECT o.id, o.order_number
      FROM public.orders o
     WHERE o.sale_order_id = p_id
       AND o.deleted_at IS NULL
     ORDER BY o.order_number
  LOOP
    v_release := public.release_and_restore_stock_for_soft_delete_order(v_op.id);
    v_releases := v_releases || jsonb_build_array(v_release);
    v_ops_released := v_ops_released + 1;
  END LOOP;

  UPDATE public.sale_orders
     SET deleted_at = now(), updated_at = now()
   WHERE id = p_id;

  UPDATE public.orders
     SET deleted_at = now()
   WHERE sale_order_id = p_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_ops_hidden = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'order_number', v_so.order_number,
    'soft_deleted_at', now(),
    'ops_hidden', v_ops_hidden,
    'ops_released', v_ops_released,
    'releases', v_releases
  );
END;
$function$;

COMMENT ON FUNCTION public.soft_delete_sale_order_internal_108(uuid) IS
  'Soft-delete: libera todas as reservas/estoque das OPs e esconde PV+OPs (reversível).';

-- ---------------------------------------------------------------------------
-- 3. restore: reabre e re-empenha soft se não houver reserva ativa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_sale_order_command(
  p_sale_order_id uuid,
  p_expected_order_version bigint,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_request_hash text;
  v_aggregate_key text := 'sale-order:' || p_sale_order_id::text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_actor_id uuid := auth.uid();
  v_previous_sale_internal text;
  v_previous_order_internal text;
  v_ops_restored integer := 0;
  v_ops_re_reserved integer := 0;
  v_op record;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  IF p_sale_order_id IS NULL OR p_expected_order_version IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id, expected_order_version e client_request_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION 'Permission denied: restauração exige Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'expected_order_version', p_expected_order_version
  )::text);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'restore_sale_order'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id já usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'PV mudou simultaneamente (esperado v%, atual v%)',
      p_expected_order_version,
      v_so.order_version USING ERRCODE = '40001';
  END IF;

  IF v_so.deleted_at IS NULL THEN
    v_result := jsonb_build_object(
      'ok', true,
      'sale_order_id', v_so.id,
      'order_number', v_so.order_number,
      'already_restored', true,
      'ops_restored', 0,
      'ops_re_reserved', 0
    );
  ELSE
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items item
        LEFT JOIN public.technical_sheets sheet
          ON sheet.id = item.reference_id
       WHERE item.sale_order_id = v_so.id
         AND (
           item.production_excluded_at IS NOT NULL
           OR sheet.retired_at IS NOT NULL
         )
    ) THEN
      RAISE EXCEPTION 'PV possui item retirado da producao ou ficha tecnica aposentada; restauracao bloqueada para nao reativar producao'
        USING ERRCODE = 'PZ236';
    END IF;

    v_previous_sale_internal := pg_catalog.current_setting(
      'app.sale_order_command_internal', true
    );
    v_previous_order_internal := pg_catalog.current_setting(
      'app.production_order_command_internal', true
    );
    PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
    PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);

    UPDATE public.sale_orders
       SET deleted_at = NULL,
           updated_at = now()
     WHERE id = v_so.id;
    UPDATE public.orders
       SET deleted_at = NULL,
           updated_at = now()
     WHERE sale_order_id = v_so.id
       AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_ops_restored = ROW_COUNT;

    -- Soft-delete liberou reservas; re-empenha soft nas OPs não terminais.
    FOR v_op IN
      SELECT o.id, o.status
        FROM public.orders o
       WHERE o.sale_order_id = v_so.id
         AND o.deleted_at IS NULL
         AND o.status NOT IN (
           'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
           'Concluído', 'Concluido', 'Concluída'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM public.material_reservations mr
            WHERE mr.order_id = o.id
              AND mr.status IN ('reserved', 'partially_consumed')
         )
       ORDER BY o.order_number
    LOOP
      PERFORM public.initialize_order_material_reservations(v_op.id, true);
      v_ops_re_reserved := v_ops_re_reserved + 1;
    END LOOP;

    PERFORM pg_catalog.set_config(
      'app.sale_order_command_internal', COALESCE(v_previous_sale_internal, ''), true
    );
    PERFORM pg_catalog.set_config(
      'app.production_order_command_internal', COALESCE(v_previous_order_internal, ''), true
    );

    v_result := jsonb_build_object(
      'ok', true,
      'sale_order_id', v_so.id,
      'order_number', v_so.order_number,
      'already_restored', false,
      'ops_restored', v_ops_restored,
      'ops_re_reserved', v_ops_re_reserved
    );
    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, new_data, success, created_at
    ) VALUES (
      v_actor_id, 'sale_order_restored', 'sale_orders', v_so.id,
      v_result, true, now()
    );
  END IF;

  INSERT INTO public.operational_command_receipts (
    command_name, aggregate_key, client_request_id, request_hash,
    actor_id, response
  ) VALUES (
    'restore_sale_order', v_aggregate_key, p_client_request_id,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_sale_order_command(uuid, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_sale_order_command(uuid, bigint, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Backfill: PVs já soft-deleted com reserva aberta (inclui PV-00236)
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_op record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config('app.production_order_command_internal', '1', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  FOR v_op IN
    SELECT DISTINCT o.id, o.order_number, so.order_number AS pv
      FROM public.sale_orders so
      JOIN public.orders o ON o.sale_order_id = so.id
     WHERE so.deleted_at IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.material_reservations mr
          WHERE mr.order_id = o.id
            AND mr.status IN (
              'reserved', 'partially_consumed', 'pending_reconciliation'
            )
       )
     ORDER BY so.order_number, o.order_number
  LOOP
    PERFORM public.release_and_restore_stock_for_soft_delete_order(v_op.id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'soft-delete backfill: % OPs com reservas liberadas', v_count;
END;
$backfill$;
