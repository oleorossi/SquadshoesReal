-- =============================================================================
-- Cancelamento compensatório de PV com fato físico
-- =============================================================================
-- 1) Helper de blockers (preflight + audit) com nº da OP e fact_kinds.
-- 2) cancel_sale_order_atomic_internal: RAISE com order_number; modo
--    compensatory via GUC app.sale_order_command_compensatory_cancel reusa
--    cancel_production_order_internal. NF-e e OP Finalizado continuam barrados.
-- 3) preflight: anexa blockers em cancel e Aprovado→Rascunho (exceto quando
--    payload.compensatory=true — outro modo do comando, não override).
-- 4) execute: gate admin + reason≥15 + set_config antes do helper de cancel.
-- =============================================================================

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

    IF cardinality(v_kinds) = 0 THEN
      CONTINUE;
    END IF;

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
  END LOOP;

  RETURN v_blockers;
END;
$$;

REVOKE ALL ON FUNCTION public.sale_order_physical_fact_blockers(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_order_physical_fact_blockers(uuid)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.cancel_sale_order_atomic_internal(p_sale_order_id uuid, p_receipt_id uuid)
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

  v_compensatory := COALESCE(
    current_setting('app.sale_order_command_compensatory_cancel', true),
    ''
  ) = '1';

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
      -- causal. Apontamentos/etapas permanecem no histórico.
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

CREATE OR REPLACE FUNCTION public.preflight_sale_order_command(p_sale_order_id uuid, p_command text, p_expected_order_version bigint, p_override_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_config public.sale_order_command_config%ROWTYPE;
  v_plan jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_override public.sale_order_readiness_overrides%ROWTYPE;
  v_override_valid boolean := false;
  v_ready boolean;
  v_effective_count integer;
  v_client record;
  v_commercial record;
  v_available_credit numeric;
  v_calculated_total numeric := 0;
  v_price_issues jsonb := '[]'::jsonb;
  v_price_warnings jsonb := '[]'::jsonb;
  v_update_billing_patch jsonb := p_payload -> 'billing_patch';
  v_update_factoring_patch jsonb := p_payload -> 'factoring_patch';
  v_update_factoring_config_id uuid;
  v_update_items jsonb := p_payload -> 'items';
  v_update_item_ids uuid[] := '{}'::uuid[];
  v_update_item_id_count integer := 0;
  v_update_derived_teardown_op_ids uuid[] := '{}'::uuid[];
  v_update_advanced_op_ids uuid[] := '{}'::uuid[];
  v_update_non_reversible_removed_op_ids uuid[] := '{}'::uuid[];
  v_update_non_reversible_changed_op_ids uuid[] := '{}'::uuid[];
  v_update_removed_allocated_item_ids uuid[] := '{}'::uuid[];
  v_update_requested_cancel_op_ids uuid[] := '{}'::uuid[];
  v_update_requested_teardown_op_ids uuid[] := '{}'::uuid[];
  v_update_missing_cancel_op_ids uuid[] := '{}'::uuid[];
  v_update_invalid_cancel_op_ids uuid[] := '{}'::uuid[];
  v_update_invalid_teardown_op_ids uuid[] := '{}'::uuid[];
  v_update_payload_inspected boolean := false;
  v_billing_target_override boolean;
  v_billing_target_reason text;
  v_target_status text := NULLIF(btrim(COALESCE(p_payload ->> 'target_status', '')), '');
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF v_command NOT IN (
    'update', 'confirm', 'promote', 'resync', 'cancel', 'transition',
    'billing', 'factoring'
  ) THEN
    RAISE EXCEPTION 'Comando de PV não suportado no preflight: %', p_command
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       (v_command = 'resync'
        AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']))
       OR
       (v_command = 'factoring'
        AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']))
       OR
       (v_command NOT IN ('resync', 'factoring')
        AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']))
     ) THEN
    RAISE EXCEPTION 'Papel sem permissão para preflight do comando %', v_command
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

  SELECT * INTO v_so
    FROM public.sale_orders
   WHERE id = p_sale_order_id;
  IF NOT FOUND OR v_so.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  SELECT * INTO v_config
    FROM public.sale_order_command_config
   WHERE config_key = 'default';

  v_plan := public.build_sale_order_material_plan(p_sale_order_id);

  -- Gate comercial server-side. A tela/RouteGuard não é fronteira de
  -- autorização nem de integridade para uma função SECURITY DEFINER.
  IF v_command IN ('confirm', 'promote') THEN
    IF v_so.client_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'client_required',
        'scope', 'commercial',
        'message', 'Cliente válido é obrigatório para confirmar/promover.',
        'overridable', false
      ));
    ELSE
      SELECT c.id, c.active, c.economic_group_id, c.estado, c.sales_channel
        INTO v_client
        FROM public.clients c
       WHERE c.id = v_so.client_id;

      IF NOT FOUND THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'client_not_found',
          'scope', 'commercial',
          'message', 'Cliente do PV não existe.',
          'details', jsonb_build_object('client_id', v_so.client_id),
          'overridable', false
        ));
      ELSIF NOT COALESCE(v_client.active, false) THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'client_inactive',
          'scope', 'commercial',
          'message', 'Cliente inativo não pode receber novo pedido.',
          'details', jsonb_build_object('client_id', v_so.client_id),
          'overridable', false
        ));
      ELSE
        SELECT * INTO v_commercial
          FROM public.get_client_commercial_defaults(v_so.client_id);

        IF COALESCE(v_commercial.block_new_orders, false) THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'commercial_orders_blocked',
            'scope', 'commercial',
            'message', COALESCE(
              NULLIF(btrim(v_commercial.block_reason), ''),
              'Cliente/grupo econômico está bloqueado para novos pedidos.'
            ),
            'details', jsonb_build_object(
              'client_id', v_so.client_id,
              'economic_group_id', v_client.economic_group_id,
              'inherited_from', v_commercial.inherited_from
            ),
            'overridable', true
          ));
        END IF;

        IF NULLIF(btrim(COALESCE(v_so.payment_condition, '')), '') IS NULL THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'payment_condition_required',
            'scope', 'commercial',
            'message', 'Condição de pagamento é obrigatória.',
            'details', jsonb_build_object(
              'default_payment_condition', v_commercial.payment_condition
            ),
            'overridable', true
          ));
        END IF;

        IF v_commercial.price_list_id IS NULL THEN
          -- Lista explícita é preferível, mas não é a única fonte canônica:
          -- variante e ficha publicada continuam resolvendo preço-base. O
          -- blocker real é item_price_missing, avaliado item a item abaixo.
          v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
            'code', 'price_list_missing_using_fallback',
            'scope', 'commercial',
            'message', 'Cliente/grupo sem lista efetiva; será usada variante/ficha ou o valor positivo informado no item.',
            'overridable', false
          ));
        END IF;

        SELECT COALESCE(sum(
                 CASE
                   WHEN i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                     THEN 0
                   ELSE COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0)
                 END
               ), 0),
               COALESCE(jsonb_agg(jsonb_build_object(
                 'code', CASE
                   WHEN i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                     OR COALESCE(i.unit_price, 0) <= 0
                     
                   THEN 'item_price_missing'
                   ELSE 'item_price_below_floor'
                 END,
                 'scope', 'commercial',
                 'message', CASE
                   WHEN i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                     OR COALESCE(i.unit_price, 0) <= 0
                     
                   THEN 'Item sem preço de venda positivo.'
                   ELSE 'Preço manual ficou abaixo do piso comercial permitido.'
                 END,
                 'item_id', i.id,
                 'reference_id', i.reference_id,
                 'details', jsonb_build_object(
                   'unit_price', i.unit_price,
                   'effective_price', ep.expected_price,
                   'minimum_price', round(
                     ep.expected_price * (
                       1 - LEAST(
                         100::numeric,
                         GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                       ) / 100
                     ),
                     6
                   ),
                   'max_discount_pct', LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ),
                   'price_source', ep.price_source,
                   'price_rule_id', ep.price_rule_id
                 ),
                 'overridable', false
               )) FILTER (WHERE
                 i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                 OR COALESCE(i.unit_price, 0) <= 0
                 
                 OR i.unit_price < ep.expected_price * (
                   1 - LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ) / 100
                 ) - 0.01
               ), '[]'::jsonb),
               COALESCE(jsonb_agg(jsonb_build_object(
                 'code', CASE
                   WHEN COALESCE(ep.expected_price, 0) <= 0
                     THEN 'item_price_without_base'
                   ELSE 'item_manual_price'
                 END,
                 'scope', 'commercial',
                 'message', CASE
                   WHEN COALESCE(ep.expected_price, 0) <= 0
                     THEN 'Preço informado no item aceito sem preço-base cadastrado.'
                   ELSE 'Preço manual aceito dentro do piso comercial.'
                 END,
                 'item_id', i.id,
                 'reference_id', i.reference_id,
                 'details', jsonb_build_object(
                   'unit_price', i.unit_price,
                   'effective_price', ep.expected_price,
                   'minimum_price', round(
                     ep.expected_price * (
                       1 - LEAST(
                         100::numeric,
                         GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                       ) / 100
                     ),
                     6
                   ),
                   'max_discount_pct', LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ),
                   'price_source', ep.price_source,
                   'price_rule_id', ep.price_rule_id
                 ),
                 'overridable', false
               )) FILTER (WHERE
                 i.unit_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
                 AND COALESCE(i.unit_price, 0) > 0
                 AND (
                   COALESCE(ep.expected_price, 0) <= 0
                   OR (
                     COALESCE(ep.expected_price, 0) > 0
                     AND i.unit_price >= ep.expected_price * (
                       1 - LEAST(
                         100::numeric,
                         GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                       ) / 100
                     ) - 0.01
                     AND abs(i.unit_price - ep.expected_price) > 0.01
                   )
                 )
               ), '[]'::jsonb)
          INTO v_calculated_total, v_price_issues, v_price_warnings
          FROM public.sale_order_items i
          CROSS JOIN LATERAL public.resolve_sale_order_item_commercial_price(
            i.reference_id,
            i.color,
            i.quantity,
            i.material_variant_id,
            v_commercial.price_list_id,
            CURRENT_DATE
          ) ep
         WHERE i.sale_order_id = p_sale_order_id
           AND i.reference_id IS NOT NULL;
        v_blockers := v_blockers || v_price_issues;
        v_warnings := v_warnings || v_price_warnings;

        IF v_so.total::text IN ('NaN', 'Infinity', '-Infinity')
           OR abs(COALESCE(v_so.total, 0) - v_calculated_total) > 0.01 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'sale_order_total_mismatch',
            'scope', 'commercial',
            'message', 'Total do PV diverge da soma server-side dos itens.',
            'details', jsonb_build_object(
              'stored_total', COALESCE(v_so.total, 0),
              'calculated_total', v_calculated_total
            ),
            'overridable', false
          ));
        END IF;

        IF COALESCE(v_commercial.credit_limit, 0) > 0 THEN
          IF v_client.economic_group_id IS NOT NULL THEN
            SELECT egc.credit_available
              INTO v_available_credit
              FROM public.v_economic_group_credit egc
             WHERE egc.economic_group_id = v_client.economic_group_id;
          ELSE
            SELECT ce.available_credit
              INTO v_available_credit
              FROM public.v_client_credit_exposure ce
             WHERE ce.client_id = v_so.client_id;
          END IF;

          IF v_calculated_total > COALESCE(v_available_credit, 0) THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'credit_limit_exceeded',
              'scope', 'commercial',
              'message', 'Valor do PV excede o crédito disponível canônico.',
              'details', jsonb_build_object(
                'sale_order_total', v_calculated_total,
                'available_credit', COALESCE(v_available_credit, 0),
                'economic_group_id', v_client.economic_group_id
              ),
              'overridable', true
            ));
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_expected_order_version IS NOT NULL
     AND p_expected_order_version <> v_so.order_version THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'stale_order_version',
      'scope', 'sale_order',
      'message', format(
        'Versão esperada %s difere da versão atual %s.',
        p_expected_order_version,
        v_so.order_version
      ),
      'details', jsonb_build_object(
        'expected', p_expected_order_version,
        'actual', v_so.order_version
      ),
      'overridable', false
    ));
  END IF;

  IF v_command = 'confirm'
     AND v_so.status NOT IN ('Rascunho', 'Pendente', 'Aprovado') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_status_transition',
      'scope', 'sale_order',
      'message', 'Confirmação aceita somente Rascunho/Pendente ou replay em Aprovado.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'promote'
        AND v_so.status NOT IN ('Rascunho', 'Pendente', 'Aprovado', 'Em Produção') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_status_transition',
      'scope', 'sale_order',
      'message', 'Promoção aceita Rascunho/Pendente/Aprovado ou replay em Em Produção.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'resync' AND NOT EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND lower(COALESCE(o.status, '')) IN ('reservado', 'em produção', 'em producao')
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'no_active_order_for_resync',
      'scope', 'sale_order',
      'message', 'PV não possui OP ativa para ressincronizar.',
      'overridable', false
    ));
  ELSIF v_command = 'update'
        AND v_so.status IN (
          'Faturado', 'Expedido', 'Concluído', 'Concluido',
          'Finalizado s/ NF', 'FINALIZADO', 'Finalizado', 'Cancelado'
        ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'terminal_sale_order',
      'scope', 'sale_order',
      'message', 'PV fechado/terminal não aceita edição.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'cancel'
        AND v_so.status NOT IN (
          'Rascunho', 'Pendente', 'Aprovado', 'Em Produção',
          'Faturado', 'Cancelado'
        ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_cancel_transition',
      'scope', 'sale_order',
      'message', 'Status atual não permite transição para Cancelado.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'billing'
        AND v_so.status NOT IN (
          'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'
        ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'billing_after_commercial_fact',
      'scope', 'commercial',
      'message', 'Planejamento de faturamento só pode mudar antes do faturamento/fechamento.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'factoring'
        AND v_so.status NOT IN ('Rascunho', 'Pendente') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'factoring_after_financial_fact',
      'scope', 'financial',
      'message', 'Factoring só pode mudar antes da aprovação e de fatos financeiros.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'transition' THEN
    IF v_target_status IS NULL
       OR concat(v_so.status, '->', v_target_status) NOT IN (
         'Rascunho->Pendente',
         'Pendente->Rascunho',
         'Cancelado->Rascunho',
         'Aprovado->Rascunho',
         'Em Produção->Faturado',
         'Em Produção->Finalizado s/ NF',
         'Faturado->Expedido',
         'Expedido->Concluído'
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_status_transition',
        'scope', 'sale_order',
        'message', 'Transição de status não permitida pela máquina canônica.',
        'details', jsonb_build_object(
          'status', v_so.status,
          'target_status', v_target_status
        ),
        'overridable', false
      ));
    ELSIF v_so.status = 'Em Produção'
          AND v_target_status = 'Faturado'
          AND NOT COALESCE(v_so.nfe_required, true) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'nfe_policy_transition_mismatch',
        'scope', 'fiscal',
        'message', 'PV sem NF-e obrigatória deve usar Finalizado s/ NF.',
        'overridable', false
      ));
    ELSIF v_so.status = 'Em Produção'
          AND v_target_status = 'Finalizado s/ NF'
          AND COALESCE(v_so.nfe_required, true) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'nfe_policy_transition_mismatch',
        'scope', 'fiscal',
        'message', 'PV com NF-e obrigatória deve seguir para Faturado.',
        'overridable', false
      ));
    ELSIF v_so.status = 'Faturado'
          AND v_target_status = 'Expedido'
          AND NOT EXISTS (
            SELECT 1
              FROM public.nfe_emitidas nfe
             WHERE nfe.sale_order_id = p_sale_order_id
               AND nfe.status = 'autorizada'
          ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'authorized_nfe_required_for_shipping',
        'scope', 'fiscal',
        'message', 'Expedição exige NF-e autorizada.',
        'overridable', false
      ));
    END IF;
  END IF;

  -- O preflight devolve o impacto operacional calculado no servidor. É uma
  -- fotografia read-only para UX; execute_sale_order_command repete a mesma
  -- derivação depois de travar PV + OPs e continua sendo a autoridade TOCTOU.
  IF v_command = 'update' AND p_payload ? 'items' THEN
    v_update_payload_inspected := true;

    IF jsonb_typeof(v_update_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_update_items) = 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_items_payload',
        'scope', 'production',
        'message', 'items deve ser array não vazio no preflight de update.',
        'overridable', false
      ));
    ELSIF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(v_update_items) AS item(value)
       WHERE NULLIF(item.value ->> 'id', '') IS NOT NULL
         AND (item.value ->> 'id') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_item_id',
        'scope', 'production',
        'message', 'items contém UUID inválido.',
        'overridable', false
      ));
    ELSE
      SELECT count(*)::integer,
             COALESCE(array_agg(DISTINCT item_id ORDER BY item_id), '{}'::uuid[])
        INTO v_update_item_id_count, v_update_item_ids
        FROM (
          SELECT NULLIF(item.value ->> 'id', '')::uuid AS item_id
            FROM jsonb_array_elements(v_update_items) AS item(value)
        ) parsed
       WHERE item_id IS NOT NULL;

      IF v_update_item_id_count <> cardinality(v_update_item_ids) THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'duplicate_update_item_id',
          'scope', 'production',
          'message', 'items contém id duplicado.',
          'overridable', false
        ));
      ELSIF EXISTS (
        SELECT 1
          FROM unnest(v_update_item_ids) AS payload_item(id)
         WHERE NOT EXISTS (
           SELECT 1
             FROM public.sale_order_items soi
            WHERE soi.id = payload_item.id
              AND soi.sale_order_id = p_sale_order_id
         )
      ) THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'foreign_update_item_id',
          'scope', 'production',
          'message', 'items contém id que não pertence ao PV.',
          'details', jsonb_build_object(
            'item_ids', to_jsonb(v_update_item_ids)
          ),
          'overridable', false
        ));
      ELSE
        SELECT COALESCE(array_agg(soi.id ORDER BY soi.id), '{}'::uuid[])
          INTO v_update_removed_allocated_item_ids
          FROM public.sale_order_items soi
         WHERE soi.sale_order_id = p_sale_order_id
           AND NOT (soi.id = ANY(v_update_item_ids))
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_lot_allocations sola
              WHERE sola.sale_order_item_id = soi.id
           );

        IF cardinality(v_update_removed_allocated_item_ids) > 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'removed_items_have_lot_allocations',
            'scope', 'traceability',
            'message', 'Item removido possui alocação de lote/recall.',
            'details', jsonb_build_object(
              'item_ids', to_jsonb(v_update_removed_allocated_item_ids)
            ),
            'overridable', false
          ));
        END IF;

        SELECT COALESCE(array_agg(o.id ORDER BY o.id) FILTER (
                 WHERE (
                   o.sale_order_item_id IS NULL
                   OR NOT (o.sale_order_item_id = ANY(v_update_item_ids))
                 )
                   AND COALESCE(o.status, '') IN (
                     'Rascunho', 'Pendente', 'Reservado'
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.stock_movements sm
                      WHERE sm.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.production_consumptions pc
                      WHERE pc.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.material_reservations mr
                      WHERE mr.order_id = o.id
                        AND (
                          COALESCE(mr.quantity_consumed, 0) > 0
                          OR mr.consumed_at IS NOT NULL
                          OR mr.status NOT IN (
                            'reserved', 'cancelled', 'released'
                          )
                        )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.order_stages os
                      WHERE os.order_id = o.id
                        AND (
                          COALESCE(os.quantity_processed, 0) > 0
                          OR os.started_at IS NOT NULL
                          OR os.completed_at IS NOT NULL
                          OR lower(btrim(COALESCE(os.status, ''))) NOT IN (
                            'pendente', 'pending', 'aguardando',
                            'bloqueado', 'blocked', 'nao iniciado',
                            'não iniciado'
                          )
                        )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.order_lots ol
                      WHERE ol.order_id = o.id
                        AND (
                          ol.started_at IS NOT NULL
                          OR ol.completed_at IS NOT NULL
                          OR lower(COALESCE(ol.status, '')) NOT IN (
                            '', 'pendente', 'pending'
                          )
                        )
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.production_pointings pp
                      WHERE pp.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.production_stops ps
                      WHERE ps.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.quality_records qr
                      WHERE qr.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.goods_issues gi
                      WHERE gi.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.finished_goods_receipts fgr
                      WHERE fgr.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.wip_ledger wl
                      WHERE wl.order_id = o.id
                   )
               ), '{}'::uuid[]),
               COALESCE(array_agg(o.id ORDER BY o.id) FILTER (
                 WHERE o.status IN (
                   'Em Produção', 'Concluída', 'Finalizado'
                 )
               ), '{}'::uuid[]),
               COALESCE(array_agg(o.id ORDER BY o.id) FILTER (
                 WHERE (
                   o.sale_order_item_id IS NULL
                   OR NOT (o.sale_order_item_id = ANY(v_update_item_ids))
                 )
                   AND COALESCE(o.status, '') NOT IN (
                     'Em Produção', 'Concluída', 'Finalizado',
                     'Cancelada', 'Cancelado'
                   )
                   AND NOT (
                     COALESCE(o.status, '') IN (
                       'Rascunho', 'Pendente', 'Reservado'
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.stock_movements sm
                        WHERE sm.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.production_consumptions pc
                        WHERE pc.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.material_reservations mr
                        WHERE mr.order_id = o.id
                          AND (
                            COALESCE(mr.quantity_consumed, 0) > 0
                            OR mr.consumed_at IS NOT NULL
                            OR mr.status NOT IN (
                              'reserved', 'cancelled', 'released'
                            )
                          )
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.order_stages os
                        WHERE os.order_id = o.id
                          AND (
                            COALESCE(os.quantity_processed, 0) > 0
                            OR os.started_at IS NOT NULL
                            OR os.completed_at IS NOT NULL
                            OR lower(btrim(COALESCE(os.status, ''))) NOT IN (
                              'pendente', 'pending', 'aguardando',
                              'bloqueado', 'blocked', 'nao iniciado',
                              'não iniciado'
                            )
                          )
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.order_lots ol
                        WHERE ol.order_id = o.id
                          AND (
                            ol.started_at IS NOT NULL
                            OR ol.completed_at IS NOT NULL
                            OR lower(COALESCE(ol.status, '')) NOT IN (
                              '', 'pendente', 'pending'
                            )
                          )
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.production_pointings pp
                        WHERE pp.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.production_stops ps
                        WHERE ps.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.quality_records qr
                        WHERE qr.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.goods_issues gi
                        WHERE gi.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.finished_goods_receipts fgr
                        WHERE fgr.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.wip_ledger wl
                        WHERE wl.order_id = o.id
                     )
                   )
               ), '{}'::uuid[])
          INTO v_update_derived_teardown_op_ids,
               v_update_advanced_op_ids,
               v_update_non_reversible_removed_op_ids
          FROM public.orders o
         WHERE o.sale_order_id = p_sale_order_id
           AND o.deleted_at IS NULL;

        -- Uma OP pode continuar nominalmente em estado inicial e ainda assim já
        -- ter fatos físicos. Se o item correspondente permanece no payload mas
        -- muda qualquer fonte de demanda/roteiro, o writer legado sobrescreveria
        -- a OP por baixo do histórico. Header, observação e preço não entram: são
        -- edições comerciais que não alteram a materialização fabril.
        SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}'::uuid[])
          INTO v_update_non_reversible_changed_op_ids
          FROM public.orders o
          JOIN public.sale_order_items soi
            ON soi.id = o.sale_order_item_id
          JOIN LATERAL (
            SELECT item.value
              FROM jsonb_array_elements(v_update_items) AS item(value)
             WHERE item.value ->> 'id' = soi.id::text
             LIMIT 1
          ) proposed ON true
         WHERE o.sale_order_id = p_sale_order_id
           AND o.deleted_at IS NULL
           AND COALESCE(o.status, '') IN (
             'Rascunho', 'Pendente', 'Reservado'
           )
           AND public.order_has_non_reversible_production_facts(o.id)
           AND (
             NULLIF(proposed.value ->> 'reference_id', '')::uuid
               IS DISTINCT FROM soi.reference_id
             OR COALESCE(
                  NULLIF(proposed.value ->> 'quantity', '')::integer,
                  0
                ) IS DISTINCT FROM soi.quantity
             OR COALESCE(proposed.value ->> 'color', '')
                IS DISTINCT FROM COALESCE(soi.color, '')
             OR COALESCE(proposed.value -> 'grade', '{}'::jsonb)
                IS DISTINCT FROM COALESCE(soi.grade, '{}'::jsonb)
             OR COALESCE(
                  NULLIF(proposed.value ->> 'fichas', '')::integer,
                  1
                ) IS DISTINCT FROM COALESCE(soi.fichas, 1)
             OR NULLIF(proposed.value ->> 'material_variant_id', '')::uuid
                IS DISTINCT FROM soi.material_variant_id
             OR CASE
                  WHEN jsonb_typeof(proposed.value -> 'strap_colors') = 'array'
                    THEN proposed.value -> 'strap_colors'
                  ELSE '[]'::jsonb
                END IS DISTINCT FROM COALESCE(soi.strap_colors, '[]'::jsonb)
             OR (
               proposed.value ? 'strap_sourcing'
               AND CASE
                 WHEN jsonb_typeof(proposed.value -> 'strap_sourcing') = 'object'
                   THEN proposed.value -> 'strap_sourcing'
                 ELSE NULL
               END IS DISTINCT FROM soi.strap_sourcing
             )
             OR (
               proposed.value ? 'selected_terceirizacao_ids'
               AND CASE
                 WHEN jsonb_typeof(
                   proposed.value -> 'selected_terceirizacao_ids'
                 ) = 'array' THEN ARRAY(
                   SELECT NULLIF(selected_id, '')::uuid
                     FROM jsonb_array_elements_text(
                       proposed.value -> 'selected_terceirizacao_ids'
                     ) AS selected(selected_id)
                    WHERE NULLIF(selected_id, '') IS NOT NULL
                 )
                 ELSE '{}'::uuid[]
               END IS DISTINCT FROM COALESCE(
                 soi.selected_terceirizacao_ids,
                 '{}'::uuid[]
               )
             )
             OR (
               proposed.value ? 'terceirizacao_quantities'
               AND CASE
                 WHEN jsonb_typeof(
                   proposed.value -> 'terceirizacao_quantities'
                 ) = 'object' THEN proposed.value -> 'terceirizacao_quantities'
                 ELSE '{}'::jsonb
               END IS DISTINCT FROM COALESCE(
                 soi.terceirizacao_quantities,
                 '{}'::jsonb
               )
             )
             OR (
               proposed.value ? 'outsourced_sectors'
               AND CASE
                 WHEN jsonb_typeof(proposed.value -> 'outsourced_sectors') = 'object'
                   THEN proposed.value -> 'outsourced_sectors'
                 ELSE '{}'::jsonb
               END IS DISTINCT FROM COALESCE(
                 soi.outsourced_sectors,
                 '{}'::jsonb
               )
             )
           );

        IF cardinality(v_update_non_reversible_changed_op_ids) > 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'non_reversible_changed_orders',
            'scope', 'production',
            'message', 'OP mantida possui fato físico e sua demanda foi alterada.',
            'details', jsonb_build_object(
              'order_ids', to_jsonb(v_update_non_reversible_changed_op_ids)
            ),
            'overridable', false
          ));
        END IF;

        IF p_payload ? 'cancel_op_ids' THEN
          IF jsonb_typeof(p_payload -> 'cancel_op_ids') IS DISTINCT FROM 'array'
             OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements_text(
                   CASE
                     WHEN jsonb_typeof(p_payload -> 'cancel_op_ids') = 'array'
                     THEN p_payload -> 'cancel_op_ids'
                     ELSE '[]'::jsonb
                   END
                 ) AS requested(value)
                WHERE requested.value !~*
                  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             ) THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'invalid_cancel_op_ids',
              'scope', 'production',
              'message', 'cancel_op_ids deve ser array de UUIDs.',
              'overridable', false
            ));
          ELSE
            SELECT COALESCE(
                     array_agg(requested.value::uuid ORDER BY requested.ordinality),
                     '{}'::uuid[]
                   )
              INTO v_update_requested_cancel_op_ids
              FROM jsonb_array_elements_text(p_payload -> 'cancel_op_ids')
                WITH ORDINALITY AS requested(value, ordinality);

            IF (
              SELECT count(*) <> count(DISTINCT requested_id)
                FROM unnest(v_update_requested_cancel_op_ids) requested(requested_id)
            ) THEN
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'duplicate_cancel_op_id',
                'scope', 'production',
                'message', 'cancel_op_ids contém UUID repetido.',
                'overridable', false
              ));
            END IF;
          END IF;
        END IF;

        SELECT COALESCE(array_agg(advanced.id ORDER BY advanced.id), '{}'::uuid[])
          INTO v_update_missing_cancel_op_ids
          FROM unnest(v_update_advanced_op_ids) AS advanced(id)
         WHERE NOT (advanced.id = ANY(v_update_requested_cancel_op_ids));
        IF cardinality(v_update_missing_cancel_op_ids) > 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'advanced_orders_require_cancel_confirmation',
            'scope', 'production',
            'message', 'Existem OPs avançadas fora de cancel_op_ids.',
            'details', jsonb_build_object(
              'required_cancel_op_ids', to_jsonb(v_update_advanced_op_ids),
              'missing_cancel_op_ids', to_jsonb(v_update_missing_cancel_op_ids)
            ),
            'overridable', false
          ));
        END IF;

        SELECT COALESCE(array_agg(requested.id ORDER BY requested.id), '{}'::uuid[])
          INTO v_update_invalid_cancel_op_ids
          FROM unnest(v_update_requested_cancel_op_ids) AS requested(id)
         WHERE NOT (requested.id = ANY(v_update_advanced_op_ids));
        IF cardinality(v_update_invalid_cancel_op_ids) > 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'invalid_cancel_op_ids',
            'scope', 'production',
            'message', 'cancel_op_ids contém OP alheia ou sem estado avançado cancelável.',
            'details', jsonb_build_object(
              'invalid_cancel_op_ids', to_jsonb(v_update_invalid_cancel_op_ids)
            ),
            'overridable', false
          ));
        END IF;

        IF cardinality(v_update_non_reversible_removed_op_ids) > 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'non_reversible_removed_orders',
            'scope', 'production',
            'message', 'OP removida possui fato/estado não compensável pelo update.',
            'details', jsonb_build_object(
              'order_ids', to_jsonb(v_update_non_reversible_removed_op_ids)
            ),
            'overridable', false
          ));
        END IF;

        IF p_payload ? 'teardown_op_ids' THEN
          IF jsonb_typeof(p_payload -> 'teardown_op_ids') IS DISTINCT FROM 'array'
             OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements_text(
                   CASE
                     WHEN jsonb_typeof(p_payload -> 'teardown_op_ids') = 'array'
                     THEN p_payload -> 'teardown_op_ids'
                     ELSE '[]'::jsonb
                   END
                 ) AS requested(value)
                WHERE requested.value !~*
                  '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             ) THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'invalid_teardown_op_ids',
              'scope', 'production',
              'message', 'teardown_op_ids deve ser array de UUIDs.',
              'overridable', false
            ));
          ELSE
            SELECT COALESCE(
                     array_agg(requested.value::uuid ORDER BY requested.ordinality),
                     '{}'::uuid[]
                   )
              INTO v_update_requested_teardown_op_ids
              FROM jsonb_array_elements_text(p_payload -> 'teardown_op_ids')
                WITH ORDINALITY AS requested(value, ordinality);
            SELECT COALESCE(array_agg(requested.id ORDER BY requested.id), '{}'::uuid[])
              INTO v_update_invalid_teardown_op_ids
              FROM unnest(v_update_requested_teardown_op_ids) AS requested(id)
             WHERE NOT (requested.id = ANY(v_update_derived_teardown_op_ids));
            IF cardinality(v_update_invalid_teardown_op_ids) > 0 THEN
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'invalid_teardown_op_ids',
                'scope', 'production',
                'message', 'teardown_op_ids contém OP não derivada pelo servidor.',
                'details', jsonb_build_object(
                  'invalid_teardown_op_ids',
                  to_jsonb(v_update_invalid_teardown_op_ids)
                ),
                'overridable', false
              ));
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Subpatches opcionais pertencem ao mesmo intent/receipt do update, mas
  -- preservam allow-list, estados e fronteiras dos commands estreitos.
  IF v_command = 'update' AND p_payload ? 'billing_patch' THEN
    IF jsonb_typeof(v_update_billing_patch) IS DISTINCT FROM 'object'
       OR v_update_billing_patch = '{}'::jsonb
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(v_update_billing_patch) AS patch_key(key)
          WHERE patch_key.key NOT IN (
            'delivery_month', 'delivery_week', 'billing_week',
            'delivery_deadline', 'manual_billing_override',
            'original_min_billing_date', 'manual_override_reason'
          )
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_billing_patch',
        'scope', 'commercial',
        'message', 'billing_patch vazio, inválido ou com campo não permitido.',
        'overridable', false
      ));
    ELSIF v_so.status NOT IN (
      'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'
    ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'billing_after_commercial_fact',
        'scope', 'commercial',
        'message', 'billing_patch só pode mudar antes do faturamento/fechamento.',
        'details', jsonb_build_object('status', v_so.status),
        'overridable', false
      ));
    ELSIF v_update_billing_patch ? 'manual_billing_override'
          AND jsonb_typeof(
            v_update_billing_patch -> 'manual_billing_override'
          ) IS DISTINCT FROM 'boolean' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_billing_patch',
        'scope', 'commercial',
        'message', 'manual_billing_override deve ser boolean.',
        'overridable', false
      ));
    ELSE
      v_billing_target_override := CASE
        WHEN v_update_billing_patch ? 'manual_billing_override'
          THEN (v_update_billing_patch ->> 'manual_billing_override')::boolean
        ELSE COALESCE(v_so.manual_billing_override, false)
      END;
      v_billing_target_reason := CASE
        WHEN v_update_billing_patch ? 'manual_override_reason'
          THEN NULLIF(btrim(v_update_billing_patch ->> 'manual_override_reason'), '')
        ELSE v_so.manual_override_reason
      END;
      IF v_billing_target_override
         AND length(COALESCE(v_billing_target_reason, '')) < 10 THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'invalid_update_billing_patch',
          'scope', 'commercial',
          'message', 'Override manual de faturamento exige motivo (10+ caracteres).',
          'overridable', false
        ));
      END IF;
    END IF;
  END IF;

  IF v_command = 'billing' THEN
    IF p_payload = '{}'::jsonb OR EXISTS (
      SELECT 1
        FROM jsonb_object_keys(p_payload) AS patch_key(key)
       WHERE patch_key.key NOT IN (
         'delivery_month', 'delivery_week', 'billing_week',
         'delivery_deadline', 'manual_billing_override',
         'original_min_billing_date', 'manual_override_reason'
       )
    ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_billing_patch',
        'scope', 'commercial',
        'message', 'Payload de billing vazio ou com campo não permitido.',
        'overridable', false
      ));
    ELSIF p_payload ? 'manual_billing_override'
          AND jsonb_typeof(
            p_payload -> 'manual_billing_override'
          ) IS DISTINCT FROM 'boolean' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_billing_patch',
        'scope', 'commercial',
        'message', 'manual_billing_override deve ser boolean.',
        'overridable', false
      ));
    ELSE
      v_billing_target_override := CASE
        WHEN p_payload ? 'manual_billing_override'
          THEN (p_payload ->> 'manual_billing_override')::boolean
        ELSE COALESCE(v_so.manual_billing_override, false)
      END;
      v_billing_target_reason := CASE
        WHEN p_payload ? 'manual_override_reason'
          THEN NULLIF(btrim(p_payload ->> 'manual_override_reason'), '')
        ELSE v_so.manual_override_reason
      END;
      IF v_billing_target_override
         AND length(COALESCE(v_billing_target_reason, '')) < 10 THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'invalid_billing_patch',
          'scope', 'commercial',
          'message', 'Override manual de faturamento exige motivo (10+ caracteres).',
          'overridable', false
        ));
      END IF;
    END IF;
  END IF;

  IF v_command = 'update' AND p_payload ? 'factoring_patch' THEN
    IF jsonb_typeof(v_update_factoring_patch) IS DISTINCT FROM 'object'
       OR NOT (v_update_factoring_patch ? 'factoring_config_id')
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(v_update_factoring_patch) AS patch_key(key)
          WHERE patch_key.key <> 'factoring_config_id'
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_factoring_patch',
        'scope', 'financial',
        'message', 'factoring_patch aceita somente factoring_config_id.',
        'overridable', false
      ));
    ELSIF jsonb_typeof(v_update_factoring_patch -> 'factoring_config_id')
          NOT IN ('string', 'null')
          OR (
            NULLIF(btrim(COALESCE(
              v_update_factoring_patch ->> 'factoring_config_id',
              ''
            )), '') IS NOT NULL
            AND (v_update_factoring_patch ->> 'factoring_config_id') !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_factoring_patch',
        'scope', 'financial',
        'message', 'factoring_config_id deve ser UUID ou null.',
        'overridable', false
      ));
    ELSE
      v_update_factoring_config_id := NULLIF(btrim(COALESCE(
        v_update_factoring_patch ->> 'factoring_config_id',
        ''
      )), '')::uuid;

      -- O formulário pode sempre enviar o baseline. ACL financeira, estado e
      -- causalidade só entram quando o target realmente muda.
      IF v_update_factoring_config_id IS DISTINCT FROM v_so.factoring_config_id THEN
        IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
           AND (
             NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
             OR NOT public.can_execute_sale_order_finance_command()
           ) THEN
          RAISE EXCEPTION
            'factoring_patch exige Administração/Gerência e can_edit em /financeiro'
            USING ERRCODE = '42501';
        END IF;
        IF v_so.status NOT IN ('Rascunho', 'Pendente') THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'factoring_after_financial_fact',
            'scope', 'financial',
            'message', 'factoring_patch só pode mudar antes da aprovação.',
            'details', jsonb_build_object('status', v_so.status),
            'overridable', false
          ));
        ELSIF v_update_factoring_config_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                  FROM public.factoring_config fc
                 WHERE fc.id = v_update_factoring_config_id
                   AND fc.active
              ) THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'invalid_update_factoring_patch',
            'scope', 'financial',
            'message', 'Configuração de factoring inexistente/inativa.',
            'overridable', false
          ));
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_command IN ('update', 'cancel', 'billing', 'factoring') AND EXISTS (
    SELECT 1
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = p_sale_order_id
       AND nfe.status IN ('autorizada', 'processando', 'cancelando')
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'active_nfe_blocks_cancel',
      'scope', 'fiscal',
      'message', 'PV possui NF-e ativa; cancele a NF-e antes de alterar/cancelar o pedido.',
      'overridable', false
    ));
  END IF;

  -- Fato físico / OP finalizada: cancel e Aprovado→Rascunho. Compensatório
  -- (payload.compensatory=true) é outro modo do comando — não usa override de
  -- readiness; os mesmos sinais ficam só como warning pra UX.
  IF v_command = 'cancel'
     OR (
       v_command = 'transition'
       AND v_so.status = 'Aprovado'
       AND v_target_status = 'Rascunho'
     ) THEN
    IF v_command = 'transition'
       AND EXISTS (
         SELECT 1
           FROM public.nfe_emitidas nfe
          WHERE nfe.sale_order_id = p_sale_order_id
            AND nfe.status IN ('autorizada', 'processando', 'cancelando')
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'active_nfe_blocks_cancel',
        'scope', 'fiscal',
        'message', 'PV possui NF-e ativa; cancele a NF-e antes de reverter o pedido.',
        'overridable', false
      ));
    END IF;

    IF COALESCE(p_payload ->> 'compensatory', '') = 'true' THEN
      v_warnings := v_warnings || public.sale_order_physical_fact_blockers(p_sale_order_id);
    ELSE
      v_blockers := v_blockers || public.sale_order_physical_fact_blockers(p_sale_order_id);
    END IF;
  END IF;

  IF v_command IN ('confirm', 'promote', 'resync') THEN
    v_blockers := v_blockers || COALESCE(v_plan -> 'blockers', '[]'::jsonb);
  ELSE
    -- Update precisa conseguir corrigir um plano inválido; cancel não depende
    -- da prontidão técnica. Os sinais continuam visíveis como warnings.
    v_warnings := v_warnings || COALESCE(v_plan -> 'blockers', '[]'::jsonb);
  END IF;
  v_warnings := v_warnings || COALESCE(v_plan -> 'warnings', '[]'::jsonb);

  IF p_override_id IS NOT NULL THEN
    SELECT * INTO v_override
      FROM public.sale_order_readiness_overrides ro
     WHERE ro.id = p_override_id;

    v_override_valid := FOUND
      AND v_override.sale_order_id = p_sale_order_id
      AND v_override.command_name = v_command
      AND (
        v_override.order_version = v_so.order_version
        OR (
          COALESCE(
            current_setting('app.sale_order_command_internal', true),
            ''
          ) = '1'
          AND v_override.order_version::text = COALESCE(
            current_setting(
              'app.sale_order_command_override_source_version',
              true
            ),
            ''
          )
        )
      )
      AND v_override.revoked_at IS NULL
      AND v_override.material_source_hash = COALESCE(
        v_plan ->> 'source_hash',
        ''
      )
      AND v_override.readiness_blockers_hash =
        public.sale_order_readiness_blockers_hash(v_blockers);

    IF NOT v_override_valid THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_readiness_override',
        'scope', 'sale_order',
        'message', 'Override não pertence ao comando/versão atual ou foi revogado.',
        'details', jsonb_build_object('override_id', p_override_id),
        'overridable', false
      ));
    END IF;
  END IF;

  SELECT count(*)::integer
    INTO v_effective_count
    FROM jsonb_array_elements(v_blockers) issue
   WHERE NOT (
     COALESCE((issue ->> 'overridable')::boolean, false)
     AND (
       v_override_valid
       OR NOT COALESCE(v_config.readiness_gate_enabled, true)
     )
   );

  v_ready := v_effective_count = 0;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'gate_enabled', COALESCE(v_config.readiness_gate_enabled, true),
    'sale_order_id', p_sale_order_id,
    'command', v_command,
    'status', v_so.status,
    'target_status', v_target_status,
    'order_version', v_so.order_version,
    'expected_order_version', p_expected_order_version,
    'effective_blocking_count', v_effective_count,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'readiness_blockers_hash',
      public.sale_order_readiness_blockers_hash(v_blockers),
    'update_impact', CASE WHEN v_command = 'update' THEN jsonb_build_object(
      'payload_inspected', v_update_payload_inspected,
      'derived_teardown_op_ids', to_jsonb(v_update_derived_teardown_op_ids),
      'required_cancel_op_ids', to_jsonb(v_update_advanced_op_ids),
      'missing_cancel_op_ids', to_jsonb(v_update_missing_cancel_op_ids),
      'non_reversible_removed_op_ids',
        to_jsonb(v_update_non_reversible_removed_op_ids),
      'non_reversible_changed_op_ids',
        to_jsonb(v_update_non_reversible_changed_op_ids),
      'removed_allocated_item_ids',
        to_jsonb(v_update_removed_allocated_item_ids),
      'ignored_cancelled_history', true
    ) ELSE NULL END,
    'override', CASE WHEN v_override_valid THEN jsonb_build_object(
      'id', v_override.id,
      'order_version', v_override.order_version,
      'justification', v_override.justification,
      'created_by', v_override.created_by,
      'created_at', v_override.created_at
    ) ELSE NULL END,
    'material_plan', v_plan,
    'config', jsonb_build_object(
      'promotion_atomicity_mode', v_config.promotion_atomicity_mode,
      'partial_promotion_enabled', v_config.partial_promotion_enabled,
      'material_plan_commit_milestone', v_config.material_plan_commit_milestone,
      'material_fact_commit_strict', v_config.material_fact_commit_strict,
      'readiness_gate_enabled', v_config.readiness_gate_enabled
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_sale_order_command(p_sale_order_id uuid, p_command text, p_expected_order_version bigint, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb, p_override_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_payload_item_ids uuid[] := '{}'::uuid[];
  v_payload_item_id_count integer := 0;
  v_requested_teardown_op_ids uuid[] := '{}'::uuid[];
  v_derived_teardown_op_ids uuid[] := '{}'::uuid[];
  v_advanced_op_ids uuid[] := '{}'::uuid[];
  v_non_reversible_removed_op_ids uuid[] := '{}'::uuid[];
  v_non_reversible_changed_op_ids uuid[] := '{}'::uuid[];
  v_removed_allocated_item_ids uuid[] := '{}'::uuid[];
  v_teardown_op_ids uuid[] := '{}'::uuid[];
  v_cancel_op_ids uuid[] := '{}'::uuid[];
  v_order_id uuid;
  v_op_id uuid;
  v_outsource_contractor_id uuid;
  v_outsource_sector text;
  v_box_grouping text;
  v_external_nfe_number text;
  v_target_status text;
  v_factoring_config_id uuid;
  v_factoring_config_active boolean;
  v_manual_billing_override boolean;
  v_target_manual_override_reason text;
  v_version_after bigint;
  v_previous_internal text;
  v_previous_override_source_version text;
  v_previous_parent_receipt_id text;
  v_error_state text;
  v_error_message text;
  v_error_detail text;
  v_event_type text;
  v_compensatory_cancel boolean := false;
  v_compensatory_reason text;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
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

  -- Writers fiscais vivos já possuem a row de NF-e quando seus triggers
  -- atualizam o PV. Adotar a mesma ordem NF-e -> PV evita o ciclo
  -- command(PV->NF) × fiscal(NF->PV). Depois do lock do PV fazemos um segundo
  -- passe NOWAIT para capturar qualquer phantom inserido neste intervalo.
  IF v_command IN (
    'update', 'cancel', 'billing', 'factoring', 'transition'
  ) THEN
    PERFORM nfe.id
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = p_sale_order_id
     ORDER BY nfe.id
     FOR UPDATE;
  END IF;

  -- Writers canônicos/legados de tiras adotam coarse -> PV/item. Tomar o
  -- coarse antes do advisory do command e de qualquer row lock impede o ciclo
  -- command(PV/item->coarse) × correção de tira(coarse->item).
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));

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

    -- Revalidação TOCTOU dentro da subtransação. O lock do PV impede nova NF
    -- pela FK. O segundo passe captura phantoms que entraram antes desse lock;
    -- NOWAIT transforma um writer fiscal concorrente em falha observável do
    -- command, sem reintroduzir ordem PV -> NF capaz de deadlock.
    IF v_command IN (
      'update', 'cancel', 'billing', 'factoring', 'transition'
    ) THEN
      PERFORM nfe.id
        FROM public.nfe_emitidas nfe
       WHERE nfe.sale_order_id = p_sale_order_id
       ORDER BY nfe.id
       FOR UPDATE NOWAIT;
    END IF;

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

        -- A autoridade sobre teardown é server-side. IDs de itens do payload
        -- identificam o conjunto mantido; OPs órfãs ou de item removido são
        -- derivadas sob a mesma trava do agregado. O array legado do browser é
        -- aceito somente como subset de compatibilidade, nunca como baseline.
        SELECT count(*)::integer,
               COALESCE(array_agg(DISTINCT item_id ORDER BY item_id), '{}'::uuid[])
          INTO v_payload_item_id_count, v_payload_item_ids
          FROM (
            SELECT NULLIF(item.value ->> 'id', '')::uuid AS item_id
              FROM jsonb_array_elements(v_items) AS item(value)
          ) parsed
         WHERE item_id IS NOT NULL;
        IF v_payload_item_id_count <> cardinality(v_payload_item_ids) THEN
          RAISE EXCEPTION 'items contém id duplicado'
            USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1
            FROM unnest(v_payload_item_ids) AS payload_item(id)
           WHERE NOT EXISTS (
             SELECT 1
               FROM public.sale_order_items soi
              WHERE soi.id = payload_item.id
                AND soi.sale_order_id = p_sale_order_id
           )
        ) THEN
          RAISE EXCEPTION 'items contém id que não pertence ao PV'
            USING ERRCODE = '40001';
        END IF;

        -- Writers legados de item/OP/estágio podem ter adquirido a row filha
        -- antes de seus triggers tocarem o PV. Como o command já trava o PV,
        -- NOWAIT recusa a concorrência em vez de formar um ciclo de deadlock;
        -- a falha fica persistida no receipt externo à subtransação.
        PERFORM soi.id
          FROM public.sale_order_items soi
         WHERE soi.sale_order_id = p_sale_order_id
         ORDER BY soi.id
         FOR UPDATE NOWAIT;
        PERFORM sola.id
          FROM public.sale_order_lot_allocations sola
          JOIN public.sale_order_items soi
            ON soi.id = sola.sale_order_item_id
         WHERE soi.sale_order_id = p_sale_order_id
         ORDER BY sola.sale_order_item_id, sola.id
         FOR UPDATE OF sola NOWAIT;
        SELECT COALESCE(array_agg(soi.id ORDER BY soi.id), '{}'::uuid[])
          INTO v_removed_allocated_item_ids
          FROM public.sale_order_items soi
         WHERE soi.sale_order_id = p_sale_order_id
           AND NOT (soi.id = ANY(v_payload_item_ids))
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_lot_allocations sola
              WHERE sola.sale_order_item_id = soi.id
           );
        IF cardinality(v_removed_allocated_item_ids) > 0 THEN
          RAISE EXCEPTION
            'Item removido possui alocação de lote/recall: %',
            array_to_string(v_removed_allocated_item_ids, ', ')
            USING ERRCODE = 'PZ122';
        END IF;

        -- Mesma ordem global usada por cancel/resync e pelos motores de
        -- reserva/débito: agregado do PV -> namespaces físicos da OP -> rows
        -- da OP/filhos. Sem esta pré-aquisição, teardown poderia segurar uma
        -- reserva e esperar product enquanto outro writer segura o namespace
        -- físico e espera a OP, formando um ciclo.
        FOR v_op_id IN
          SELECT o.id
            FROM public.orders o
           WHERE o.sale_order_id = p_sale_order_id
             AND o.deleted_at IS NULL
             AND o.status NOT IN ('Cancelada', 'Cancelado')
           ORDER BY o.id
        LOOP
          PERFORM pg_advisory_xact_lock(
            hashtext('hybrid_debit:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('debit_sole:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('stock_debit:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('packaging_debit:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            ('x' || substr(
              md5('debit_strap:' || v_op_id::text),
              1,
              16
            ))::bit(64)::bigint
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('reserve:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('reserve_missing:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('try_reserve_materials:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('consume_reservations:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('convert_reservation:' || v_op_id::text)
          );
          PERFORM pg_advisory_xact_lock(
            hashtext('settle_reservations:' || v_op_id::text)
          );
        END LOOP;

        PERFORM o.id
          FROM public.orders o
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY o.id
         FOR UPDATE NOWAIT;

        -- FOR UPDATE na OP bloqueia INSERT filho via FK. Updates de filhos já
        -- existentes, porém, não precisam tocar o pai; travá-los em ordem
        -- determinística fecha a janela factless -> factual antes da derivação.
        PERFORM os.id
          FROM public.order_stages os
          JOIN public.orders o ON o.id = os.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY os.order_id, os.id
         FOR UPDATE OF os NOWAIT;
        PERFORM ol.id
          FROM public.order_lots ol
          JOIN public.orders o ON o.id = ol.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY ol.order_id, ol.id
         FOR UPDATE OF ol NOWAIT;
        PERFORM pp.id
          FROM public.production_pointings pp
          JOIN public.orders o ON o.id = pp.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY pp.order_id, pp.id
         FOR UPDATE OF pp NOWAIT;
        PERFORM ps.id
          FROM public.production_stops ps
          JOIN public.orders o ON o.id = ps.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY ps.order_id, ps.id
         FOR UPDATE OF ps NOWAIT;
        PERFORM qr.id
          FROM public.quality_records qr
          JOIN public.orders o ON o.id = qr.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY qr.order_id, qr.id
         FOR UPDATE OF qr NOWAIT;
        PERFORM gi.id
          FROM public.goods_issues gi
          JOIN public.orders o ON o.id = gi.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY gi.order_id, gi.id
         FOR UPDATE OF gi NOWAIT;
        PERFORM fgr.id
          FROM public.finished_goods_receipts fgr
          JOIN public.orders o ON o.id = fgr.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY fgr.order_id, fgr.id
         FOR UPDATE OF fgr NOWAIT;
        PERFORM wl.id
          FROM public.wip_ledger wl
          JOIN public.orders o ON o.id = wl.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY wl.order_id, wl.id
         FOR UPDATE OF wl NOWAIT;
        PERFORM mr.id
          FROM public.material_reservations mr
          JOIN public.orders o ON o.id = mr.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY mr.order_id, mr.id
         FOR UPDATE OF mr NOWAIT;
        PERFORM pc.id
          FROM public.production_consumptions pc
          JOIN public.orders o ON o.id = pc.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY pc.order_id, pc.id
         FOR UPDATE OF pc NOWAIT;
        PERFORM sm.id
          FROM public.stock_movements sm
          JOIN public.orders o ON o.id = sm.order_id
         WHERE o.sale_order_id = p_sale_order_id
         ORDER BY sm.order_id, sm.id
         FOR UPDATE OF sm NOWAIT;

        SELECT COALESCE(array_agg(o.id ORDER BY o.id) FILTER (
                 WHERE (
                   o.sale_order_item_id IS NULL
                   OR NOT (o.sale_order_item_id = ANY(v_payload_item_ids))
                 )
                   -- Espelha exatamente o preflight do writer de teardown.
                   -- OP com qualquer fato fica fora desta lista: o update não
                   -- pode transformar cancelamento em estorno físico implícito.
                   AND COALESCE(o.status, '') IN (
                     'Rascunho', 'Pendente', 'Reservado'
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.stock_movements sm
                      WHERE sm.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.production_consumptions pc
                      WHERE pc.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.material_reservations mr
                      WHERE mr.order_id = o.id
                        AND (
                          COALESCE(mr.quantity_consumed, 0) > 0
                          OR mr.consumed_at IS NOT NULL
                          OR mr.status NOT IN (
                            'reserved', 'cancelled', 'released'
                          )
                        )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.order_stages os
                      WHERE os.order_id = o.id
                        AND (
                          COALESCE(os.quantity_processed, 0) > 0
                          OR os.started_at IS NOT NULL
                          OR os.completed_at IS NOT NULL
                          OR lower(btrim(COALESCE(os.status, ''))) NOT IN (
                            'pendente', 'pending', 'aguardando',
                            'bloqueado', 'blocked', 'nao iniciado',
                            'não iniciado'
                          )
                        )
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM public.order_lots ol
                      WHERE ol.order_id = o.id
                        AND (
                          ol.started_at IS NOT NULL
                          OR ol.completed_at IS NOT NULL
                          OR lower(COALESCE(ol.status, '')) NOT IN (
                            '', 'pendente', 'pending'
                          )
                        )
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.production_pointings pp
                      WHERE pp.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.production_stops ps
                      WHERE ps.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.quality_records qr
                      WHERE qr.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.goods_issues gi
                      WHERE gi.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.finished_goods_receipts fgr
                      WHERE fgr.order_id = o.id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM public.wip_ledger wl
                      WHERE wl.order_id = o.id
                   )
               ), '{}'::uuid[]),
               COALESCE(array_agg(o.id ORDER BY o.id) FILTER (
                 -- "Avançada" preserva o contrato vivo do modal e do writer
                 -- atômico: todas precisam de consentimento explícito, mesmo
                 -- quando o item correspondente continua no payload.
                 WHERE o.status IN (
                   'Em Produção', 'Concluída', 'Finalizado'
                 )
               ), '{}'::uuid[]),
               COALESCE(array_agg(o.id ORDER BY o.id) FILTER (
                 -- OP removida que não é desmontável e também não pertence ao
                 -- fluxo administrativo de cancelamento avançado deve recusar
                 -- o update. Canceladas ficam preservadas como histórico e o
                 -- FK ON DELETE SET NULL as desacopla do item removido.
                 WHERE (
                   o.sale_order_item_id IS NULL
                   OR NOT (o.sale_order_item_id = ANY(v_payload_item_ids))
                 )
                   AND COALESCE(o.status, '') NOT IN (
                     'Em Produção', 'Concluída', 'Finalizado',
                     'Cancelada', 'Cancelado'
                   )
                   AND NOT (
                     COALESCE(o.status, '') IN (
                       'Rascunho', 'Pendente', 'Reservado'
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.stock_movements sm
                        WHERE sm.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.production_consumptions pc
                        WHERE pc.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.material_reservations mr
                        WHERE mr.order_id = o.id
                          AND (
                            COALESCE(mr.quantity_consumed, 0) > 0
                            OR mr.consumed_at IS NOT NULL
                            OR mr.status NOT IN (
                              'reserved', 'cancelled', 'released'
                            )
                          )
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.order_stages os
                        WHERE os.order_id = o.id
                          AND (
                            COALESCE(os.quantity_processed, 0) > 0
                            OR os.started_at IS NOT NULL
                            OR os.completed_at IS NOT NULL
                            OR lower(btrim(COALESCE(os.status, ''))) NOT IN (
                              'pendente', 'pending', 'aguardando',
                              'bloqueado', 'blocked', 'nao iniciado',
                              'não iniciado'
                            )
                          )
                     )
                     AND NOT EXISTS (
                       SELECT 1
                         FROM public.order_lots ol
                        WHERE ol.order_id = o.id
                          AND (
                            ol.started_at IS NOT NULL
                            OR ol.completed_at IS NOT NULL
                            OR lower(COALESCE(ol.status, '')) NOT IN (
                              '', 'pendente', 'pending'
                            )
                          )
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.production_pointings pp
                        WHERE pp.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.production_stops ps
                        WHERE ps.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.quality_records qr
                        WHERE qr.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.goods_issues gi
                        WHERE gi.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.finished_goods_receipts fgr
                        WHERE fgr.order_id = o.id
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM public.wip_ledger wl
                        WHERE wl.order_id = o.id
                     )
                   )
               ), '{}'::uuid[])
          INTO v_derived_teardown_op_ids,
               v_advanced_op_ids,
               v_non_reversible_removed_op_ids
          FROM public.orders o
         WHERE o.sale_order_id = p_sale_order_id
           AND o.deleted_at IS NULL;

        SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}'::uuid[])
          INTO v_non_reversible_changed_op_ids
          FROM public.orders o
          JOIN public.sale_order_items soi
            ON soi.id = o.sale_order_item_id
          JOIN LATERAL (
            SELECT item.value
              FROM jsonb_array_elements(v_items) AS item(value)
             WHERE item.value ->> 'id' = soi.id::text
             LIMIT 1
          ) proposed ON true
         WHERE o.sale_order_id = p_sale_order_id
           AND o.deleted_at IS NULL
           AND COALESCE(o.status, '') IN (
             'Rascunho', 'Pendente', 'Reservado'
           )
           AND public.order_has_non_reversible_production_facts(o.id)
           AND (
             NULLIF(proposed.value ->> 'reference_id', '')::uuid
               IS DISTINCT FROM soi.reference_id
             OR COALESCE(
                  NULLIF(proposed.value ->> 'quantity', '')::integer,
                  0
                ) IS DISTINCT FROM soi.quantity
             OR COALESCE(proposed.value ->> 'color', '')
                IS DISTINCT FROM COALESCE(soi.color, '')
             OR COALESCE(proposed.value -> 'grade', '{}'::jsonb)
                IS DISTINCT FROM COALESCE(soi.grade, '{}'::jsonb)
             OR COALESCE(
                  NULLIF(proposed.value ->> 'fichas', '')::integer,
                  1
                ) IS DISTINCT FROM COALESCE(soi.fichas, 1)
             OR NULLIF(proposed.value ->> 'material_variant_id', '')::uuid
                IS DISTINCT FROM soi.material_variant_id
             OR CASE
                  WHEN jsonb_typeof(proposed.value -> 'strap_colors') = 'array'
                    THEN proposed.value -> 'strap_colors'
                  ELSE '[]'::jsonb
                END IS DISTINCT FROM COALESCE(soi.strap_colors, '[]'::jsonb)
             OR (
               proposed.value ? 'strap_sourcing'
               AND CASE
                 WHEN jsonb_typeof(proposed.value -> 'strap_sourcing') = 'object'
                   THEN proposed.value -> 'strap_sourcing'
                 ELSE NULL
               END IS DISTINCT FROM soi.strap_sourcing
             )
             OR (
               proposed.value ? 'selected_terceirizacao_ids'
               AND CASE
                 WHEN jsonb_typeof(
                   proposed.value -> 'selected_terceirizacao_ids'
                 ) = 'array' THEN ARRAY(
                   SELECT NULLIF(selected_id, '')::uuid
                     FROM jsonb_array_elements_text(
                       proposed.value -> 'selected_terceirizacao_ids'
                     ) AS selected(selected_id)
                    WHERE NULLIF(selected_id, '') IS NOT NULL
                 )
                 ELSE '{}'::uuid[]
               END IS DISTINCT FROM COALESCE(
                 soi.selected_terceirizacao_ids,
                 '{}'::uuid[]
               )
             )
             OR (
               proposed.value ? 'terceirizacao_quantities'
               AND CASE
                 WHEN jsonb_typeof(
                   proposed.value -> 'terceirizacao_quantities'
                 ) = 'object' THEN proposed.value -> 'terceirizacao_quantities'
                 ELSE '{}'::jsonb
               END IS DISTINCT FROM COALESCE(
                 soi.terceirizacao_quantities,
                 '{}'::jsonb
               )
             )
             OR (
               proposed.value ? 'outsourced_sectors'
               AND CASE
                 WHEN jsonb_typeof(proposed.value -> 'outsourced_sectors') = 'object'
                   THEN proposed.value -> 'outsourced_sectors'
                 ELSE '{}'::jsonb
               END IS DISTINCT FROM COALESCE(
                 soi.outsourced_sectors,
                 '{}'::jsonb
               )
             )
           );

        IF cardinality(v_non_reversible_changed_op_ids) > 0 THEN
          RAISE EXCEPTION
            'OP mantida possui fato físico e sua demanda foi alterada: %',
            array_to_string(v_non_reversible_changed_op_ids, ', ')
            USING ERRCODE = 'PZ123';
        END IF;

        IF p_payload ? 'teardown_op_ids' THEN
          IF jsonb_typeof(p_payload -> 'teardown_op_ids') <> 'array' THEN
            RAISE EXCEPTION 'teardown_op_ids deve ser array de UUIDs'
              USING ERRCODE = '22023';
          END IF;
          SELECT COALESCE(array_agg(x.value::uuid ORDER BY x.ordinality), '{}'::uuid[])
            INTO v_requested_teardown_op_ids
            FROM jsonb_array_elements_text(p_payload -> 'teardown_op_ids')
              WITH ORDINALITY AS x(value, ordinality);
          IF EXISTS (
            SELECT 1
              FROM unnest(v_requested_teardown_op_ids) AS requested(id)
             WHERE NOT (requested.id = ANY(v_derived_teardown_op_ids))
          ) THEN
            RAISE EXCEPTION
              'teardown_op_ids contém OP que o payload de itens não remove'
              USING ERRCODE = '40001';
          END IF;
        END IF;
        v_teardown_op_ids := v_derived_teardown_op_ids;

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

        IF EXISTS (
          SELECT 1
            FROM unnest(v_advanced_op_ids) AS advanced(id)
           WHERE NOT (advanced.id = ANY(v_cancel_op_ids))
        ) THEN
          RAISE EXCEPTION
            'Existem OPs avançadas fora de cancel_op_ids; confirme o cancelamento antes de editar'
            USING ERRCODE = 'PZ120';
        END IF;
        IF cardinality(v_non_reversible_removed_op_ids) > 0 THEN
          RAISE EXCEPTION
            'OP removida possui fato/estado não compensável pelo update: %',
            array_to_string(v_non_reversible_removed_op_ids, ', ')
            USING ERRCODE = 'PZ121';
        END IF;
        IF EXISTS (
          SELECT 1
            FROM unnest(v_cancel_op_ids) AS requested(id)
            LEFT JOIN public.orders o
              ON o.id = requested.id
             AND o.sale_order_id = p_sale_order_id
           WHERE o.id IS NULL
              OR NOT (requested.id = ANY(v_advanced_op_ids))
              OR o.status NOT IN ('Em Produção', 'Concluída', 'Finalizado')
        ) THEN
          RAISE EXCEPTION
            'cancel_op_ids contém OP alheia, não avançada ou sem estado cancelável seguro'
            USING ERRCODE = '40001';
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
        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
          'derived_teardown_op_ids', to_jsonb(v_teardown_op_ids),
          'cancel_op_ids', to_jsonb(v_cancel_op_ids),
          'non_reversible_removed_op_ids',
          to_jsonb(v_non_reversible_removed_op_ids),
          'non_reversible_changed_op_ids',
          to_jsonb(v_non_reversible_changed_op_ids),
          'removed_allocated_item_ids', to_jsonb(v_removed_allocated_item_ids)
        );

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

          v_manual_billing_override := COALESCE(
            v_so.manual_billing_override,
            false
          );
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
          END IF;
          v_target_manual_override_reason := CASE
            WHEN v_billing_patch ? 'manual_override_reason'
              THEN NULLIF(
                btrim(v_billing_patch ->> 'manual_override_reason'),
                ''
              )
            ELSE v_so.manual_override_reason
          END;
          IF v_manual_billing_override
             AND length(COALESCE(v_target_manual_override_reason, '')) < 10 THEN
            RAISE EXCEPTION
              'Override manual de faturamento exige motivo (10+ caracteres)'
              USING ERRCODE = '22023';
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
            IF v_factoring_config_id IS NOT NULL THEN
              v_factoring_config_active := NULL;
              SELECT fc.active
                INTO v_factoring_config_active
                FROM public.factoring_config fc
               WHERE fc.id = v_factoring_config_id
               FOR SHARE;
              IF NOT FOUND OR NOT COALESCE(v_factoring_config_active, false) THEN
                RAISE EXCEPTION 'Configuração de factoring inexistente/inativa'
                  USING ERRCODE = 'PZ107';
              END IF;
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

        IF v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN
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
           AND v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN
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
        -- Compensatório (admin+motivo) seta GUC e reusa cancel_production_order_internal.

        v_compensatory_cancel := COALESCE(p_payload ->> 'compensatory', '') = 'true';
        IF v_compensatory_cancel THEN
          IF COALESCE(
               current_setting('request.jwt.claim.role', true),
               ''
             ) <> 'service_role'
             AND NOT public.user_has_any_role(ARRAY['admin']) THEN
            RAISE EXCEPTION
              'Cancelamento compensatório exige papel admin'
              USING ERRCODE = '42501';
          END IF;
          v_compensatory_reason := btrim(COALESCE(p_payload ->> 'reason', ''));
          IF length(v_compensatory_reason) < 15 THEN
            RAISE EXCEPTION
              'Cancelamento compensatório exige motivo com pelo menos 15 caracteres'
              USING ERRCODE = '22023';
          END IF;
          PERFORM set_config(
            'app.sale_order_command_compensatory_cancel',
            '1',
            true
          );
        END IF;

        v_result := public.cancel_sale_order_atomic_internal(
          p_sale_order_id,
          v_receipt_id
        );
        IF v_compensatory_cancel THEN
          v_result := v_result || jsonb_build_object(
            'compensatory', true,
            'reason', v_compensatory_reason,
            'actor_id', auth.uid()
          );
        END IF;

      WHEN 'transition' THEN
        IF p_override_id IS NOT NULL THEN
          RAISE EXCEPTION 'transition não aceita readiness override'
            USING ERRCODE = 'PZ116';
        END IF;
        v_target_status := NULLIF(
          btrim(COALESCE(p_payload ->> 'target_status', '')),
          ''
        );

        IF v_so.status = 'Cancelado' AND v_target_status = 'Rascunho' THEN
          -- Fecha ponteiros legados que possam ter sobrevivido a cancelamentos
          -- anteriores ao command boundary. A revisão comprometida permanece
          -- imutável e reconstruível; somente deixa de ser a revisão vigente.
          UPDATE public.sale_order_material_plan_revisions
             SET is_current = false
           WHERE sale_order_id = p_sale_order_id
             AND is_current;
        END IF;

        -- O preflight já validou a aresta, a política de NF-e e a NF-e
        -- autorizada. Revalidamos fatos destrutivos no helper de cancelamento;
        -- todas as alterações abaixo continuam dentro da mesma subtransação.
        IF v_so.status = 'Aprovado' AND v_target_status = 'Rascunho' THEN

        v_compensatory_cancel := COALESCE(p_payload ->> 'compensatory', '') = 'true';
        IF v_compensatory_cancel THEN
          IF COALESCE(
               current_setting('request.jwt.claim.role', true),
               ''
             ) <> 'service_role'
             AND NOT public.user_has_any_role(ARRAY['admin']) THEN
            RAISE EXCEPTION
              'Cancelamento compensatório exige papel admin'
              USING ERRCODE = '42501';
          END IF;
          v_compensatory_reason := btrim(COALESCE(p_payload ->> 'reason', ''));
          IF length(v_compensatory_reason) < 15 THEN
            RAISE EXCEPTION
              'Cancelamento compensatório exige motivo com pelo menos 15 caracteres'
              USING ERRCODE = '22023';
          END IF;
          PERFORM set_config(
            'app.sale_order_command_compensatory_cancel',
            '1',
            true
          );
        END IF;

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
            'transition_via', 'cancel_compensation',
            'compensatory', v_compensatory_cancel,
            'reason', CASE WHEN v_compensatory_cancel THEN v_compensatory_reason ELSE NULL END,
            'actor_id', CASE WHEN v_compensatory_cancel THEN auth.uid() ELSE NULL END
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
        v_manual_billing_override := COALESCE(
          v_so.manual_billing_override,
          false
        );
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
        END IF;
        v_target_manual_override_reason := CASE
          WHEN p_payload ? 'manual_override_reason'
            THEN NULLIF(btrim(p_payload ->> 'manual_override_reason'), '')
          ELSE v_so.manual_override_reason
        END;
        IF v_manual_billing_override
           AND length(COALESCE(v_target_manual_override_reason, '')) < 10 THEN
          RAISE EXCEPTION 'Override manual de faturamento exige motivo (10+ caracteres)'
            USING ERRCODE = '22023';
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
        IF v_factoring_config_id IS NOT NULL THEN
          v_factoring_config_active := NULL;
          SELECT fc.active
            INTO v_factoring_config_active
            FROM public.factoring_config fc
           WHERE fc.id = v_factoring_config_id
           FOR SHARE;
          IF NOT FOUND OR NOT COALESCE(v_factoring_config_active, false) THEN
            RAISE EXCEPTION 'Configuração de factoring inexistente/inativa'
              USING ERRCODE = 'PZ107';
          END IF;
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
