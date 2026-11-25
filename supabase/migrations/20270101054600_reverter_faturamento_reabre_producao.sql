-- Reverter Faturamento (revert_invoiced_sale_order_command → _internal_108)
--
-- Problemas da versão anterior:
--   1. Mudava o PV para Em Produção ANTES de reabrir as OPs. O gatilho
--      trg_block_em_producao_sem_op recusava com PZ108 ("ficou sem OP").
--   2. Só reabria a OP. Etapas fechadas pelo faturamento, preparos de cabedal
--      cancelados pelo sync do Ateliê e o material baixado (reservas
--      convertidas em saída) ficavam como no faturamento.
--   3. Recusava qualquer PV com NF autorizada e, sem NF, cancelava o título.
--   4. Ignorava a regra de que Em Produção exige o retorno do Ateliê
--      (tg_zz_block_em_producao_sem_retorno_atelie).
--
-- Nova ordem (a mesma da correção manual do PV-00255 em 25/11/2026):
--   a) recibo de comando 'transition' (âncora de causalidade do estorno);
--   b) OPs Finalizado → Em Produção;
--   c) etapas fechadas sem operador (completed_by nulo = fechamento automático
--      do faturamento) voltam para pendente; apontamento real é preservado;
--   d) preparos de cabedal cancelados sem OS voltam para awaiting_cut;
--   e) destino: Em Produção só se o Ateliê já devolveu tudo e todo item tem OP
--      viva; senão Aprovado;
--   f) PV muda de status e o lançamento do Ateliê é ressincronizado;
--   g) OP sem apontamento real: estorno do material baixado (caminho oficial
--      restore_order_stock_for_safe_resync), reservas pendentes/convertidas
--      canceladas, consumos aposentados e resync_op_atomic aninhado refaz
--      etapas e reservas. OP com apontamento real mantém o material;
--   h) financeiro: com NF autorizada vinculada, título a receber e lançamentos
--      ficam intactos; sem NF, comportamento anterior (cancela título sem
--      baixa e estorna lançamentos).

CREATE OR REPLACE FUNCTION public.revert_invoiced_sale_order_internal_108(p_sale_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so record;
  v_user uuid := auth.uid();
  v_receipt uuid;
  v_ops_updated int := 0;
  v_stages_reopened int := 0;
  v_jobs_reopened int := 0;
  v_ar_cancelled int := 0;
  v_fe_estornado int := 0;
  v_nfe_proc_killed int := 0;
  v_nfe_authorized int := 0;
  v_keep_fiscal boolean := false;
  v_target text;
  v_atelier_block text;
  v_item_sem_op uuid;
  v_reason_clean text;
  v_note_line text;
  v_op record;
  v_n int;
  v_restore jsonb;
  v_resync jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_prev_parent text;
  v_reopened_ops uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria (minimo 5 caracteres).' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sale_order:' || p_sale_order_id::text, 0));

  v_reason_clean := LEFT(regexp_replace(TRIM(p_reason), '[\r\n]+', ' ', 'g'), 500);
  v_note_line := format(E'\n[%s] Estorno por reversao de faturamento: %s', NOW()::date, v_reason_clean);

  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id FOR UPDATE;
  IF v_so.id IS NULL THEN
    RAISE EXCEPTION 'PV nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_so.status <> 'Faturado' THEN
    RAISE EXCEPTION 'PV nao esta em status Faturado (atual: %). Nada a reverter.', v_so.status
      USING ERRCODE = '22023';
  END IF;

  -- NF autorizada não bloqueia mais: ela mantém o título e os lançamentos.
  SELECT COUNT(*) INTO v_nfe_authorized
    FROM public.nfe_emitidas
   WHERE sale_order_id = p_sale_order_id
     AND LOWER(status) IN ('autorizada','aprovada');
  v_keep_fiscal := v_nfe_authorized > 0;

  -- a) recibo âncora (estorno de estoque e resync aninhado apontam para ele)
  INSERT INTO public.sale_order_command_receipts(
    sale_order_id, aggregate_key, command_name, idempotency_key, request_hash,
    expected_order_version, order_version_before, status, response, actor_id, started_at
  ) VALUES (
    p_sale_order_id, p_sale_order_id::text, 'transition',
    'revert-invoice:' || gen_random_uuid()::text,
    md5('revert-invoice:' || p_sale_order_id::text || ':' || v_reason_clean || ':' || clock_timestamp()::text),
    v_so.order_version, v_so.order_version, 'in_progress',
    jsonb_build_object('command', 'revert_invoiced_sale_order', 'reason', v_reason_clean),
    v_user, now()
  )
  RETURNING id INTO v_receipt;

  -- b) OPs primeiro (o PV só muda depois; evita PZ108)
  WITH reopened AS (
    UPDATE public.orders
       SET status = 'Em Produção', updated_at = NOW()
     WHERE sale_order_id = p_sale_order_id
       AND deleted_at IS NULL
       AND status = 'Finalizado'
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_reopened_ops FROM reopened;
  v_ops_updated := cardinality(v_reopened_ops);

  -- c) etapas fechadas automaticamente (sem operador)
  UPDATE public.order_stages st
     SET status = 'pendente', quantity_processed = 0,
         started_at = NULL, completed_at = NULL, completed_by = NULL,
         updated_at = NOW()
   WHERE st.order_id = ANY (v_reopened_ops)
     AND st.status = 'concluido'
     AND st.completed_by IS NULL;
  GET DIAGNOSTICS v_stages_reopened = ROW_COUNT;

  -- d) preparos de cabedal cancelados pelo faturamento (sem OS)
  UPDATE public.cabedal_prep_jobs j
     SET pipeline_status = 'awaiting_cut', updated_at = NOW()
   WHERE j.sale_order_id = p_sale_order_id
     AND j.pipeline_status = 'cancelled'
     AND NOT EXISTS (
       SELECT 1 FROM public.atelier_job_parts p
        WHERE p.job_id = j.id AND p.service_order_id IS NOT NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.cabedal_prep_jobs j2
        WHERE j2.sale_order_item_id = j.sale_order_item_id
          AND j2.sector = j.sector
          AND j2.id <> j.id
          AND j2.pipeline_status <> 'cancelled'
     );
  GET DIAGNOSTICS v_jobs_reopened = ROW_COUNT;

  -- e) destino respeitando Ateliê e OP viva por item
  v_atelier_block := public.sale_order_atelier_production_block_message(p_sale_order_id);
  SELECT soi.id INTO v_item_sem_op
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND soi.reference_id IS NOT NULL
     AND soi.production_excluded_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.sale_order_item_id = soi.id
          AND o.deleted_at IS NULL
          AND COALESCE(o.status, '') NOT IN (
            'Cancelada', 'Cancelado', 'cancelled',
            'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
            'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
            'Faturado', 'Rascunho')
     )
   LIMIT 1;
  v_target := CASE
    WHEN v_atelier_block IS NULL AND v_item_sem_op IS NULL THEN 'Em Produção'
    ELSE 'Aprovado'
  END;

  -- f) PV muda depois das OPs
  UPDATE public.sale_orders SET status = v_target, updated_at = NOW() WHERE id = p_sale_order_id;
  PERFORM public.sync_atelier_launch_for_order(p_sale_order_id);

  -- g) material: só OP sem apontamento real volta ao estado de produção
  v_prev_parent := current_setting('app.sale_order_command_parent_receipt_id', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config('app.sale_order_command_parent_receipt_id', v_receipt::text, true);
  FOR v_op IN
    SELECT o.id, o.order_number
      FROM public.orders o
     WHERE o.id = ANY (v_reopened_ops)
     ORDER BY o.order_number
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.order_stages st
       WHERE st.order_id = v_op.id
         AND (COALESCE(st.quantity_processed, 0) > 0
              OR st.started_at IS NOT NULL
              OR st.completed_at IS NOT NULL
              OR lower(COALESCE(st.status, '')) NOT IN ('', 'pendente', 'pending'))
    ) THEN
      v_materials := v_materials || jsonb_build_array(jsonb_build_object(
        'op', v_op.order_number, 'material', 'mantido',
        'motivo', 'OP com apontamento real de etapa'));
      CONTINUE;
    END IF;

    BEGIN
      v_restore := public.restore_order_stock_for_safe_resync(v_op.id, v_receipt);

      UPDATE public.material_reservations mr
         SET status = 'cancelled',
             quantity_consumed = 0,
             consumed_at = NULL,
             metadata = COALESCE(mr.metadata, '{}'::jsonb) || jsonb_build_object(
               'revert_invoice', jsonb_build_object(
                 'status_original', mr.status,
                 'quantity_consumed_original', mr.quantity_consumed,
                 'receipt_id', v_receipt, 'em', now())),
             notes = concat_ws(' | ', NULLIF(mr.notes, ''),
               'Cancelada na reversão do faturamento; recibo ' || v_receipt::text),
             updated_at = now()
       WHERE mr.order_id = v_op.id
         AND lower(COALESCE(mr.status, '')) IN ('pending_reconciliation', 'converted')
         AND mr.strap_variant_id IS NULL
         AND mr.sale_order_strap_demand_id IS NULL
         AND mr.strap_stock_floor_contribution_id IS NULL
         AND mr.strap_batch_item_id IS NULL
         AND mr.service_order_item_id IS NULL
         AND COALESCE(mr.metadata ->> 'kind', '') <> 'strap';

      UPDATE public.production_consumptions
         SET superseded_at = now(),
             superseded_reason = 'revert_invoice:' || v_receipt::text
       WHERE order_id = v_op.id
         AND superseded_at IS NULL;

      v_resync := public.resync_op_atomic(v_op.id);
      IF NOT COALESCE((v_resync ->> 'ok')::boolean, false)
         OR COALESCE((v_resync ->> 'skipped')::boolean, false) THEN
        RAISE EXCEPTION 'resync da OP % falhou: %', v_op.order_number, left(v_resync::text, 400);
      END IF;

      v_materials := v_materials || jsonb_build_array(jsonb_build_object(
        'op', v_op.order_number, 'material', 'estornado_e_reservado',
        'estorno', v_restore));
    EXCEPTION WHEN OTHERS THEN
      v_materials := v_materials || jsonb_build_array(jsonb_build_object(
        'op', v_op.order_number, 'material', 'mantido',
        'motivo', SQLERRM));
    END;
  END LOOP;
  PERFORM set_config('app.sale_order_command_parent_receipt_id', COALESCE(v_prev_parent, ''), true);

  -- h) financeiro
  IF NOT v_keep_fiscal THEN
    UPDATE public.accounts_receivable
       SET status='cancelled', notes=COALESCE(notes,'')||v_note_line, updated_at=NOW()
     WHERE sale_order_id = p_sale_order_id
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(status, '')))
             IN ('pending', 'pendente', 'partial', 'parcial')
       AND NOT private.ar_has_recorded_receipt(status, amount_received);
    GET DIAGNOSTICS v_ar_cancelled = ROW_COUNT;

    -- M15: inclui 'sale_order_factoring' — a despesa de juros depende 1:1 do
    -- faturamento ativo e tem que cair junto com a receita.
    UPDATE public.financial_entries
       SET status='estornado', notes=COALESCE(notes,'')||v_note_line, updated_at=NOW()
     WHERE reference_type IN ('sale_order','sale_order_cmv','sale_order_factoring')
       AND reference_id=p_sale_order_id::text
       AND LOWER(status) NOT IN ('cancelled','cancelado','estornado');
    GET DIAGNOSTICS v_fe_estornado = ROW_COUNT;
  END IF;

  -- NFs que nunca chegaram a autorizar deixam de apontar para o PV.
  UPDATE public.nfe_emitidas
     SET status='cancelada',
         motivo_rejeicao=COALESCE(motivo_rejeicao,'') || ' | Cancelada por reversao: ' || v_reason_clean,
         data_cancelamento = COALESCE(data_cancelamento, NOW()),
         updated_at=NOW()
   WHERE sale_order_id = p_sale_order_id
     AND LOWER(status) IN ('processando','pendente','erro','rejeitada');
  GET DIAGNOSTICS v_nfe_proc_killed = ROW_COUNT;

  UPDATE public.sale_order_command_receipts
     SET status = 'succeeded', completed_at = now(),
         order_version_after = (SELECT order_version FROM public.sale_orders WHERE id = p_sale_order_id),
         response = response || jsonb_build_object(
           'target_status', v_target, 'ops_updated', v_ops_updated,
           'stages_reopened', v_stages_reopened, 'jobs_reopened', v_jobs_reopened,
           'materials', v_materials, 'kept_receivable', v_keep_fiscal)
   WHERE id = v_receipt;

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, old_data, new_data, success)
  VALUES (v_user, 'revert_invoice', 'sale_order', p_sale_order_id,
    jsonb_build_object('status','Faturado','order_number',v_so.order_number),
    jsonb_build_object('status',v_target,'reason',v_reason_clean,
      'ops_updated',v_ops_updated,'stages_reopened',v_stages_reopened,
      'jobs_reopened',v_jobs_reopened,'materials',v_materials,
      'kept_receivable',v_keep_fiscal,'nfe_authorized',v_nfe_authorized,
      'atelier_block',v_atelier_block,
      'ar_cancelled',v_ar_cancelled,'fe_estornado',v_fe_estornado,
      'nfe_proc_killed',v_nfe_proc_killed,'receipt_id',v_receipt),
    true);

  RETURN jsonb_build_object('sale_order_id',p_sale_order_id,'order_number',v_so.order_number,
    'target_status',v_target,'atelier_block',v_atelier_block,
    'ops_updated',v_ops_updated,'stages_reopened',v_stages_reopened,
    'jobs_reopened',v_jobs_reopened,'materials',v_materials,
    'kept_receivable',v_keep_fiscal,'nfe_authorized',v_nfe_authorized,
    'ar_cancelled',v_ar_cancelled,'fe_estornado',v_fe_estornado,
    'nfe_proc_killed',v_nfe_proc_killed,'receipt_id',v_receipt);
END;
$function$;
