-- P-NFE-AUDIT (2026-05-29): correções da auditoria do pipeline NF-e
-- (Opus 4.8). 4 CRITICAL + 4 MAJOR + 5 MINOR consolidados, ground-truth
-- verificados contra DB de produção.
--
-- Sintomas medidos:
--   - 5 de 7 NFs canceladas com data_cancelamento NULL (71%) — coluna
--     protocolo_cancelamento não existia → UPDATE falhava silenciosamente.
--   - PV e9985e90 queimou 10 números SEFAZ (8 reais perdidos: 222,223,
--     224,225,232,235,236,237) — guard de retentativa não cobria
--     erro/rejeitada nem tinha unique parcial.
--   - NF 237 cancelada continua apontada por sale_orders.nfe='237'
--     (so.status='Faturado') — trigger sync tem early-exit, cancel-nfe
--     cleanup só rodava se UPDATE prévio passasse (C1 bloqueava).
--   - nfe_cce 0 rows porque check constraint usa vocabulário antigo
--     (rascunho/enviada/aprovada) e frontend grava 'emitida' → 23514.

-- ============================================================
-- GRUPO A — Schema fixes (C1, C4)
-- ============================================================

-- A1. protocolo_cancelamento separado de protocolo (autorização).
-- Semanticamente diferente: protocolo SEFAZ de autorização (NFe-AUT) vs
-- protocolo SEFAZ de cancelamento (NFe-CAN). Não dá pra renomear.
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS protocolo_cancelamento text NULL;
COMMENT ON COLUMN public.nfe_emitidas.protocolo_cancelamento IS
  'Protocolo SEFAZ retornado no cancelamento (distinto do protocolo de autorização). Auditoria 2026-05-29.';

-- A2. financial_entries: colunas que cancel-nfe + emit-nfe-devolucao
-- referenciam mas nunca existiram — INSERTs descartados pelo PostgREST.
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS due_date date NULL,
  ADD COLUMN IF NOT EXISTS category text NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.financial_entries.due_date IS 'Data de vencimento (separada de entry_date). Auditoria 2026-05-29 — antes referenciada em estornos sem existir.';
COMMENT ON COLUMN public.financial_entries.category IS 'Categoria livre (venda, devolucao, etc). Auditoria 2026-05-29.';
COMMENT ON COLUMN public.financial_entries.created_by IS 'Quem criou o lançamento. Auditoria 2026-05-29.';

-- A3. CCe check constraint: vocabulário antigo {rascunho,enviada,aprovada,
-- rejeitada,cancelada} vs frontend que grava 'emitida'/'erro'.
ALTER TABLE public.nfe_cce DROP CONSTRAINT IF EXISTS nfe_cce_status_check;
ALTER TABLE public.nfe_cce ADD CONSTRAINT nfe_cce_status_check
  CHECK (status IN ('rascunho','emitida','rejeitada','erro','cancelada'));

-- ============================================================
-- GRUPO B — Trigger sync cancel (C2) + backfill NF 237
-- ============================================================

-- B1. Trigger AFTER UPDATE de status: quando autorizada→cancelada,
-- limpa sale_orders.nfe se não houver outra NF ativa no mesmo PV, e
-- reabre status pra 'Em Produção' se ainda estiver 'Faturado'.
-- Complementa sync_nfe_numero_to_sale_order que só atua em status=autorizada.
CREATE OR REPLACE FUNCTION public.tg_clear_so_nfe_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_other_active int;
BEGIN
  -- Só transição autorizada→cancelada (ignora processando→cancelada e UPDATEs sem status change).
  IF NOT (OLD.status = 'autorizada' AND NEW.status = 'cancelada') THEN
    RETURN NEW;
  END IF;

  IF NEW.sale_order_id IS NULL OR NEW.numero IS NULL OR TRIM(NEW.numero) = '' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_has_other_active
  FROM public.nfe_emitidas
  WHERE sale_order_id = NEW.sale_order_id
    AND id <> NEW.id
    AND status IN ('processando', 'autorizada');

  IF v_has_other_active = 0 THEN
    UPDATE public.sale_orders
       SET nfe = NULL,
           status = CASE WHEN status = 'Faturado' THEN 'Em Produção' ELSE status END,
           updated_at = NOW()
     WHERE id = NEW.sale_order_id
       AND nfe = NEW.numero;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_nfe_clear_so_on_cancel ON public.nfe_emitidas;
CREATE TRIGGER tg_nfe_clear_so_on_cancel
  AFTER UPDATE OF status ON public.nfe_emitidas
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_clear_so_nfe_on_cancel();

-- B2. Backfill: NF 237 cancelada mas so.nfe='237' + status='Faturado'.
-- Aplicar manualmente porque o trigger só atua em UPDATE futuro.
UPDATE public.sale_orders
   SET nfe = NULL,
       status = 'Em Produção',
       updated_at = NOW()
 WHERE id = 'e9985e90-b83a-4bff-b5fd-438ad5eae9bb'::uuid
   AND nfe = '237'
   AND status = 'Faturado'
   AND NOT EXISTS (
     SELECT 1 FROM public.nfe_emitidas
      WHERE sale_order_id = 'e9985e90-b83a-4bff-b5fd-438ad5eae9bb'::uuid
        AND status IN ('processando', 'autorizada')
   );

-- ============================================================
-- GRUPO C — Concorrência (C3, M1, M2)
-- ============================================================

-- C1. Unique parcial em nfe_emitidas: impede TOCTOU duplo-emit ativo no
-- mesmo PV. Estado atual já está limpo (zero duplicatas em status ativos).
CREATE UNIQUE INDEX IF NOT EXISTS uq_nfe_active_per_so
  ON public.nfe_emitidas (sale_order_id)
  WHERE status IN ('processando', 'autorizada', 'cancelando')
    AND sale_order_id IS NOT NULL;

-- C2. Unique parcial em companies: garante no máximo 1 primária ativa.
-- Hoje há 1 ativa → safe. Hook useSetPrimaryCompany clear-then-set vai
-- ser ajustado pra single statement atômico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_single_primary
  ON public.companies (is_primary)
  WHERE is_primary = true AND active = true;

-- C3. revert_invoiced_sale_order: advisory_lock por sale_order_id + bug
-- latente 'cancelled' (EN) → 'cancelada' (PT) normalizado.
CREATE OR REPLACE FUNCTION public.revert_invoiced_sale_order(p_sale_order_id uuid, p_reason text)
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

  -- Auditoria 2026-05-29: advisory lock por sale_order_id impede race com
  -- emit-nfe que pode autorizar NF entre o COUNT abaixo e o UPDATE do PV.
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

  UPDATE public.sale_orders
     SET status = 'Em Produção',
         updated_at = NOW()
   WHERE id = p_sale_order_id;

  UPDATE public.orders
     SET status = 'Em Produção',
         updated_at = NOW()
   WHERE sale_order_id = p_sale_order_id
     AND status = 'Finalizado';
  GET DIAGNOSTICS v_ops_updated = ROW_COUNT;

  UPDATE public.accounts_receivable
     SET status = 'cancelled',
         notes = COALESCE(notes,'') || v_note_line,
         updated_at = NOW()
   WHERE sale_order_id = p_sale_order_id
     AND status IN ('pending','partial');
  GET DIAGNOSTICS v_ar_cancelled = ROW_COUNT;

  UPDATE public.financial_entries
     SET status = 'estornado',
         notes = COALESCE(notes,'') || v_note_line,
         updated_at = NOW()
   WHERE reference_type = 'sale_order'
     AND reference_id = p_sale_order_id::text
     AND LOWER(status) NOT IN ('cancelled','cancelado','estornado');
  GET DIAGNOSTICS v_fe_estornado = ROW_COUNT;

  -- Auditoria 2026-05-29: normaliza 'cancelled' (EN) → 'cancelada' (PT)
  -- pra alinhar com CHECK constraint adicionado abaixo e com o vocabulário
  -- de produção (todas as 7 NFs cancelada existentes são PT).
  UPDATE public.nfe_emitidas
     SET status = 'cancelada',
         motivo_rejeicao = COALESCE(motivo_rejeicao,'') || ' | Cancelada por reversao: ' || v_reason_clean,
         updated_at = NOW()
   WHERE sale_order_id = p_sale_order_id
     AND LOWER(status) IN ('processando','pendente');
  GET DIAGNOSTICS v_nfe_proc_killed = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, old_data, new_data, success)
  VALUES (
    v_user,
    'revert_invoice',
    'sale_order',
    p_sale_order_id,
    jsonb_build_object('status', 'Faturado', 'order_number', v_so.order_number),
    jsonb_build_object(
      'status', 'Em Produção',
      'reason', v_reason_clean,
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
$function$;

-- ============================================================
-- GRUPO D — Hardening (M3 status guard temporal + CHECK)
-- ============================================================

-- D1. CHECK constraint em nfe_emitidas.status — congela vocabulário a
-- 6 valores (pt-only). Drift histórico não existe (verificado: só
-- autorizada/erro/cancelada/rejeitada hoje, plus processando/cancelando
-- como estados transitórios). Bloqueia bugs futuros tipo 'cancelled'.
ALTER TABLE public.nfe_emitidas
  DROP CONSTRAINT IF EXISTS chk_nfe_status;
ALTER TABLE public.nfe_emitidas
  ADD CONSTRAINT chk_nfe_status
  CHECK (status IN ('processando','autorizada','cancelada','cancelando','rejeitada','erro'));
