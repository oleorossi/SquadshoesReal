-- =============================================================================
-- M15 (auditoria 2026-07-28) — Reversão de faturamento estorna juros factoring
-- =============================================================================
-- revert_invoiced_sale_order estornava apenas as financial_entries de
-- reference_type 'sale_order' (receita) e 'sale_order_cmv' (CMV). A despesa de
-- juros de factoring (reference_type='sale_order_factoring', criada 'confirmed'
-- no faturamento pelo financialSync) ficava viva: após reverter um PV faturado
-- com factoring, a DRE (useFinanceIntelligence soma a entry enquanto o status
-- for ativo) continuava mostrando a despesa financeira de um faturamento que
-- não existe mais — até o PV ser re-faturado ou cancelado.
--
-- Fix: estende o UPDATE de estorno para incluir 'sale_order_factoring'. O
-- índice único parcial (20260616120000) exclui 'estornado', então o
-- re-faturamento pode inserir uma entry de juros nova (o financialSync passou
-- a filtrar status inativos ao buscar a entry existente — mesma mudança).
--
-- Baseada na definição VIVA em produção (advisory lock + sale_order_cmv +
-- normalização de NFs erro/rejeitada; a migration 20260526120000 do repo está
-- desatualizada) — única mudança: 'sale_order_factoring' no estorno. Backfill
-- idempotente ao final (drift = 0 no banco em 2026-07-28).

CREATE OR REPLACE FUNCTION public.revert_invoiced_sale_order(
  p_sale_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so record;
  v_user uuid := auth.uid();
  v_ops_updated int := 0;
  v_ar_cancelled int := 0;
  v_fe_estornado int := 0;
  v_nfe_proc_killed int := 0;
  v_nfe_blocking int := 0;
  v_reason_clean text;
  v_note_line text;
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

  SELECT COUNT(*) INTO v_nfe_blocking
  FROM public.nfe_emitidas
  WHERE sale_order_id = p_sale_order_id
    AND LOWER(status) IN ('autorizada','aprovada');
  IF v_nfe_blocking > 0 THEN
    RAISE EXCEPTION 'PV tem % NF autorizada(s). Cancele a NF na SEFAZ antes de reverter o faturamento.', v_nfe_blocking
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.sale_orders SET status='Em Produção', updated_at=NOW() WHERE id = p_sale_order_id;
  UPDATE public.orders SET status='Em Produção', updated_at=NOW()
   WHERE sale_order_id = p_sale_order_id AND status = 'Finalizado';
  GET DIAGNOSTICS v_ops_updated = ROW_COUNT;

  UPDATE public.accounts_receivable
     SET status='cancelled', notes=COALESCE(notes,'')||v_note_line, updated_at=NOW()
   WHERE sale_order_id = p_sale_order_id AND status IN ('pending','partial');
  GET DIAGNOSTICS v_ar_cancelled = ROW_COUNT;

  -- M15: inclui 'sale_order_factoring' — a despesa de juros depende 1:1 do
  -- faturamento ativo e tem que cair junto com a receita.
  UPDATE public.financial_entries
     SET status='estornado', notes=COALESCE(notes,'')||v_note_line, updated_at=NOW()
   WHERE reference_type IN ('sale_order','sale_order_cmv','sale_order_factoring')
     AND reference_id=p_sale_order_id::text
     AND LOWER(status) NOT IN ('cancelled','cancelado','estornado');
  GET DIAGNOSTICS v_fe_estornado = ROW_COUNT;

  -- Audit Round 2 (2026-05-29): também normaliza 'erro' e 'rejeitada' pra
  -- 'cancelada'. Antes só atuava em processando/pendente — NFs em estado
  -- de falha continuavam apontando pra SO após revert.
  UPDATE public.nfe_emitidas
     SET status='cancelada',
         motivo_rejeicao=COALESCE(motivo_rejeicao,'') || ' | Cancelada por reversao: ' || v_reason_clean,
         data_cancelamento = COALESCE(data_cancelamento, NOW()),
         updated_at=NOW()
   WHERE sale_order_id = p_sale_order_id
     AND LOWER(status) IN ('processando','pendente','erro','rejeitada');
  GET DIAGNOSTICS v_nfe_proc_killed = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, old_data, new_data, success)
  VALUES (v_user, 'revert_invoice', 'sale_order', p_sale_order_id,
    jsonb_build_object('status','Faturado','order_number',v_so.order_number),
    jsonb_build_object('status','Em Produção','reason',v_reason_clean,
      'ops_updated',v_ops_updated,'ar_cancelled',v_ar_cancelled,
      'fe_estornado',v_fe_estornado,'nfe_proc_killed',v_nfe_proc_killed),
    true);

  RETURN jsonb_build_object('sale_order_id',p_sale_order_id,'order_number',v_so.order_number,
    'ops_updated',v_ops_updated,'ar_cancelled',v_ar_cancelled,
    'fe_estornado',v_fe_estornado,'nfe_proc_killed',v_nfe_proc_killed);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.revert_invoiced_sale_order(uuid, text) TO authenticated;

-- ── Backfill: estorna juros factoring órfãos de PVs cuja receita já foi ──────
-- estornada/cancelada e que não têm receita ativa (mesmo guard do trigger
-- tg_cancel_cmv_on_revenue_reversal, 20260830140000). Idempotente.
UPDATE public.financial_entries fe
   SET status = 'estornado',
       notes = COALESCE(fe.notes,'') || E'\n[' || NOW()::date || '] Estorno retroativo (M15): receita do PV estornada sem estornar juros factoring',
       updated_at = NOW()
 WHERE fe.reference_type = 'sale_order_factoring'
   AND fe.status NOT IN ('cancelado','cancelled','estornado')
   AND EXISTS (
     SELECT 1 FROM public.financial_entries rev
      WHERE rev.reference_type = 'sale_order'
        AND rev.reference_id = fe.reference_id
        AND rev.status IN ('estornado','cancelado','cancelada','cancelled')
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.financial_entries rev2
      WHERE rev2.reference_type = 'sale_order'
        AND rev2.reference_id = fe.reference_id
        AND rev2.status NOT IN ('estornado','cancelado','cancelada','cancelled')
   );
