-- =============================================================================
-- revert_invoiced_sale_order — reverte PV faturado erroneamente
-- =============================================================================
-- Cenário: PCP clicou em "Faturado" por engano. Como NF NÃO foi efetivamente
-- emitida na SEFAZ (botão só muda status local), é seguro voltar.
--
-- Bloqueios fiscais:
--   - Se houver nfe_emitidas com status 'autorizada'/'aprovada' → erro.
--     Cancele a NF (cancel-nfe edge function) ANTES de chamar este revert.
--
-- Mudanças aplicadas atomicamente:
--   1. sale_orders.status: 'Faturado' → 'Em Produção'
--   2. orders.status (filhas): 'Finalizado' → 'Em Produção'
--      (production_step inalterado — operador ajusta no kanban se precisar)
--   3. accounts_receivable.status → 'cancelled' (entradas pending/partial)
--   4. financial_entries.status → 'estornado' (linhas não-finais)
--   5. nfe_emitidas com status 'processando' → mark 'cancelled'
--   6. audit_log: action='revert_invoice', resource='sale_order'
-- =============================================================================

CREATE OR REPLACE FUNCTION public.revert_invoiced_sale_order(
  p_sale_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so record;
  v_user uuid := auth.uid();
  v_ops_updated int := 0;
  v_ar_cancelled int := 0;
  v_fe_estornado int := 0;
  v_nfe_proc_killed int := 0;
  v_nfe_blocking int := 0;
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatoria (minimo 5 caracteres).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id FOR UPDATE;
  IF v_so.id IS NULL THEN
    RAISE EXCEPTION 'PV nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_so.status <> 'Faturado' THEN
    RAISE EXCEPTION 'PV nao esta em status Faturado (atual: %). Nada a reverter.', v_so.status
      USING ERRCODE = '22023';
  END IF;

  -- Bloqueio fiscal: NF autorizada/aprovada nao pode ser revertida sem cancelar primeiro
  SELECT COUNT(*) INTO v_nfe_blocking
  FROM public.nfe_emitidas
  WHERE sale_order_id = p_sale_order_id
    AND LOWER(status) IN ('autorizada','aprovada');
  IF v_nfe_blocking > 0 THEN
    RAISE EXCEPTION 'PV tem % NF autorizada(s). Cancele a NF na SEFAZ antes de reverter o faturamento.', v_nfe_blocking
      USING ERRCODE = '22023';
  END IF;

  -- 1. PV volta pra producao
  UPDATE public.sale_orders
     SET status = 'Em Produção',
         updated_at = NOW()
   WHERE id = p_sale_order_id;

  -- 2. OPs filhas voltam pra producao (eram 'Finalizado' ao concluir)
  UPDATE public.orders
     SET status = 'Em Produção',
         updated_at = NOW()
   WHERE sale_order_id = p_sale_order_id
     AND status = 'Finalizado';
  GET DIAGNOSTICS v_ops_updated = ROW_COUNT;

  -- 3. AR ativos cancelam (preserva audit; pagos NUNCA viram cancelled aqui)
  UPDATE public.accounts_receivable
     SET status = 'cancelled',
         notes = COALESCE(notes,'') || E'\n[' || NOW()::date || '] Estorno por reversao de faturamento: ' || p_reason,
         updated_at = NOW()
   WHERE sale_order_id = p_sale_order_id
     AND status IN ('pending','partial');
  GET DIAGNOSTICS v_ar_cancelled = ROW_COUNT;

  -- 4. financial_entries: estornar entries ativos (poupa cancelled/estornado pre-existentes)
  UPDATE public.financial_entries
     SET status = 'estornado',
         notes = COALESCE(notes,'') || E'\n[' || NOW()::date || '] Estorno por reversao de faturamento: ' || p_reason,
         updated_at = NOW()
   WHERE reference_type = 'sale_order'
     AND reference_id = p_sale_order_id
     AND LOWER(status) NOT IN ('cancelled','cancelado','estornado');
  GET DIAGNOSTICS v_fe_estornado = ROW_COUNT;

  -- 5. NFs em processamento (status 'processando' / 'pendente') -> cancelled
  UPDATE public.nfe_emitidas
     SET status = 'cancelled',
         motivo_rejeicao = COALESCE(motivo_rejeicao,'') || ' | Cancelada por reversao de faturamento: ' || p_reason,
         updated_at = NOW()
   WHERE sale_order_id = p_sale_order_id
     AND LOWER(status) IN ('processando','pendente','rejeitada');
  GET DIAGNOSTICS v_nfe_proc_killed = ROW_COUNT;

  -- 6. Audit log
  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, old_data, new_data, success)
  VALUES (
    v_user,
    'revert_invoice',
    'sale_order',
    p_sale_order_id,
    jsonb_build_object('status', 'Faturado', 'order_number', v_so.order_number),
    jsonb_build_object(
      'status', 'Em Produção',
      'reason', p_reason,
      'ops_updated', v_ops_updated,
      'ar_cancelled', v_ar_cancelled,
      'fe_estornado', v_fe_estornado,
      'nfe_proc_killed', v_nfe_proc_killed
    ),
    true
  );

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'order_number', v_so.order_number,
    'ops_updated', v_ops_updated,
    'ar_cancelled', v_ar_cancelled,
    'fe_estornado', v_fe_estornado,
    'nfe_proc_killed', v_nfe_proc_killed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_invoiced_sale_order(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.revert_invoiced_sale_order IS
  'Reverte PV erroneamente faturado quando nao houve NF emitida na SEFAZ. ' ||
  'Volta sale_orders + orders pra Em Produção, cancela AR ativas, estorna ' ||
  'financial_entries e mata NFs em processamento. NF autorizada bloqueia.';
