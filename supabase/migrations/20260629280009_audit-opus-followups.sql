-- P-AUDIT-OPUS (2026-05-28): correções da auditoria opus 4.8 sobre a refatoração
-- do motor de OC. Cobre:
--   1) CRITICAL: NULL-safe escape hatch de Montagem (NULL deadline = sempre bloqueia)
--   2) CRITICAL: audit log retroativo das 38 OSs do backfill batch
--   3) MAJOR: FK montagem_override_by ON DELETE SET NULL
--   4) MAJOR: case-insensitive stage_name no bloqueio de Montagem
--   5) MAJOR: backfill histórico de is_late_origin via linked_sale_order_ids
--   6) MAJOR: tg_purchase_orders_set_promised_date sem UPDATE OF created_at
--   7) MAJOR: tg_po_items_set_parent_auto_eta sem filtro auto_generated

-- ============================================================
-- 1+3+4. NULL-safe + case-insensitive trigger de bloqueio Montagem
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_block_montagem_with_pending_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_os_count int;
BEGIN
  -- Case-insensitive: aceita 'montagem', 'Montagem', ' Montagem ', etc.
  IF lower(trim(COALESCE(NEW.stage_name, ''))) <> 'montagem' THEN RETURN NEW; END IF;
  IF NEW.status <> 'em_andamento' AND NEW.status <> 'em_progresso' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND (OLD.status = 'em_andamento' OR OLD.status = 'em_progresso') THEN RETURN NEW; END IF;

  -- Bloqueia OSs que:
  --   (a) ainda não recebidas/canceladas, E
  --   (b) NÃO têm override manual, E
  --   (c) deadline ainda dentro de 7 dias úteis de tolerância
  --       OU não há deadline algum (NULL = sempre bloqueia — não vamos liberar
  --       Montagem se nem sabemos quando a OS vence).
  SELECT COUNT(*) INTO v_pending_os_count
  FROM public.service_orders so
  WHERE so.order_id = NEW.order_id
    AND so.status NOT IN ('received', 'Concluído', 'concluido', 'Cancelado', 'cancelled', 'cancelado')
    AND so.montagem_override_at IS NULL
    AND (
      -- Sem deadline algum: bloqueia (NULL-safe — opus #1)
      (so.quoted_deadline IS NULL AND so.service_date IS NULL)
      OR
      -- Com deadline: só libera após 7 dias úteis de atraso
      COALESCE(so.quoted_deadline, so.service_date + interval '10 days')
        >= public.add_business_days(CURRENT_DATE, -7)
    );

  IF v_pending_os_count > 0 THEN
    RAISE EXCEPTION 'OP % tem % OS terceirizada(s) em andamento dentro do prazo. Marque como recebida em /terceirizados, libere com override (caso perdida), OU aguarde o vencimento + 7 dias úteis.',
      NEW.order_id, v_pending_os_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_block_montagem_with_pending_service_order() IS
  'Auditoria opus 28/05/2026: NULL-safe (deadline ausente = bloqueia), case-insensitive em stage_name, escape hatch usa dias úteis via add_business_days.';

-- ============================================================
-- 2. Audit log retroativo para o backfill batch
-- ============================================================
-- O backfill de 280004 marcou 38 OSs sem registro em audit_logs. Insere retro
-- agora pra fechar o ciclo de rastreabilidade. Idempotente: NOT EXISTS guarda
-- contra duplicação se a migration rodar de novo.
INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
SELECT
  NULL::uuid,                                 -- backfill foi pelo sistema, não por user
  'override_montagem_block_backfill',
  'service_orders',
  so.id::text,
  jsonb_build_object(
    'reason', so.montagem_override_reason,
    'override_at', so.montagem_override_at,
    'source', 'migration 20260629280004 batch backfill'
  ),
  true,
  so.montagem_override_at                     -- preserva timestamp original
FROM public.service_orders so
WHERE so.montagem_override_reason LIKE '%Backfill auditoria 28/05/2026%'
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.resource = 'service_orders'
      AND al.resource_id = so.id::text
      AND al.action = 'override_montagem_block_backfill'
  );

-- ============================================================
-- 3. FK montagem_override_by ON DELETE SET NULL
-- ============================================================
-- Default era NO ACTION → deletar profile travava com FK violation.
-- SET NULL preserva o registro do override mas remove a referência.
ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_montagem_override_by_fkey;

ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_montagem_override_by_fkey
  FOREIGN KEY (montagem_override_by)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

-- ============================================================
-- 5. Backfill histórico de is_late_origin
-- ============================================================
-- POs criadas DEPOIS do purchase_deadline de qualquer wave vinculada eram
-- "atrasadas na origem" — flagueia retroativamente pra dashboards mostrarem
-- corretamente. Limita a POs com linked_sale_order_ids (legacy sem vínculo
-- não tem como provar atraso histórico).
UPDATE public.purchase_orders po
SET is_late_origin = true
WHERE po.is_late_origin = false
  AND po.linked_sale_order_ids IS NOT NULL
  AND array_length(po.linked_sale_order_ids, 1) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(po.linked_sale_order_ids) AS so_id
    JOIN public.production_wave_item_sources pwis ON pwis.sale_order_id = so_id
    JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN public.production_waves pw ON pw.id = pwi.wave_id
    WHERE pw.purchase_deadline IS NOT NULL
      AND pw.purchase_deadline < po.created_at::date
  );

-- ============================================================
-- 6. tg_purchase_orders_set_promised_date sem UPDATE OF created_at
-- ============================================================
-- created_at nunca deveria ser updated; remover do trigger evita re-disparos
-- inesperados (e.g. data migration que toque updated_at).
DROP TRIGGER IF EXISTS trg_purchase_orders_set_promised_date ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_set_promised_date
  BEFORE INSERT OR UPDATE OF eta_days
  ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_purchase_orders_set_promised_date();

-- ============================================================
-- 7. tg_po_items_set_parent_auto_eta sem filtro auto_generated
-- ============================================================
-- Espelha o fix de 280007 em tg_purchase_orders_set_auto_eta: POs manuais
-- também precisam ganhar eta_days quando os items chegam DEPOIS do parent.
CREATE OR REPLACE FUNCTION public.tg_po_items_set_parent_auto_eta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_po RECORD;
  v_eta int;
BEGIN
  SELECT id, eta_days INTO v_po
    FROM purchase_orders WHERE id = NEW.purchase_order_id;

  -- Auditoria opus 28/05/2026: removido `IF NOT v_po.auto_generated` —
  -- POs manuais também ganham eta_days que cascateia em promised_date.
  IF v_po.eta_days IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_eta := public.get_effective_supplier_lead_days(NEW.product_id, NULL);
  IF v_eta IS NULL OR v_eta <= 0 THEN RETURN NEW; END IF;
  UPDATE public.purchase_orders SET eta_days = v_eta WHERE id = v_po.id;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_po_items_set_parent_auto_eta() IS
  'Auditoria opus 28/05/2026: removido filtro auto_generated — POs manuais também recebem eta_days quando items chegam após o parent.';
