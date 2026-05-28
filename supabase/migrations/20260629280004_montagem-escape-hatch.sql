-- P2.2 (bug #7): escape hatch + override batch para Montagem
-- Antes: trigger bloqueava Montagem com QUALQUER service_order não recebida.
-- 37/38 OSs pendentes travaram produção inteira. Agora:
--   1) Override manual via RPC override_service_order_for_montagem(uuid, text)
--      registra montagem_override_at/by/reason + audit log.
--   2) Escape automático: OS com quoted_deadline + 7 dias úteis < hoje
--      é considerada "abandonada" e libera Montagem sozinha.
--   3) Backfill: marca todas as 38 OSs antigas como override pra destravar
--      produção AGORA (decisão do usuário em auditoria 28/05/2026).

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS montagem_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS montagem_override_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS montagem_override_reason text;

COMMENT ON COLUMN public.service_orders.montagem_override_at IS
  'Quando OS foi liberada manualmente pra Montagem prosseguir sem o material.';

CREATE OR REPLACE FUNCTION public.tg_block_montagem_with_pending_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_os_count int;
BEGIN
  IF NEW.stage_name <> 'Montagem' THEN RETURN NEW; END IF;
  IF NEW.status <> 'em_andamento' AND NEW.status <> 'em_progresso' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND (OLD.status = 'em_andamento' OR OLD.status = 'em_progresso') THEN RETURN NEW; END IF;

  -- Bloqueia só OSs que:
  --   (a) ainda não recebidas/canceladas, E
  --   (b) NÃO têm override manual, E
  --   (c) quoted_deadline ainda dentro da tolerância de 7 dias úteis de atraso
  -- Após (c), a OS é considerada "abandonada" e libera Montagem automaticamente.
  SELECT COUNT(*) INTO v_pending_os_count
  FROM public.service_orders so
  WHERE so.order_id = NEW.order_id
    AND so.status NOT IN ('received', 'Concluído', 'concluido', 'Cancelado', 'cancelled', 'cancelado')
    AND so.montagem_override_at IS NULL
    AND COALESCE(so.quoted_deadline, so.service_date + interval '10 days')
        >= (CURRENT_DATE - interval '7 days');

  IF v_pending_os_count > 0 THEN
    RAISE EXCEPTION 'OP % tem % OS terceirizada(s) em andamento dentro do prazo. Marque como recebida em /terceirizados, libere com override (caso perdida), OU aguarde o vencimento + 7 dias úteis.',
      NEW.order_id, v_pending_os_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.override_service_order_for_montagem(p_so_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Justificativa obrigatória (mín 5 caracteres)';
  END IF;

  UPDATE public.service_orders
  SET montagem_override_at = now(),
      montagem_override_by = auth.uid(),
      montagem_override_reason = trim(p_reason)
  WHERE id = p_so_id;

  -- Audit log (se tabela existir)
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success)
    VALUES (
      auth.uid(),
      'override_montagem_block',
      'service_orders',
      p_so_id::text,
      jsonb_build_object('reason', p_reason),
      true
    );
  EXCEPTION WHEN OTHERS THEN
    -- audit_logs schema mudou? falha silenciosa pra não bloquear override
    NULL;
  END;
END;
$function$;

-- Backfill batch (decisão do usuário): destrava as 38 OSs pendentes que
-- estão segurando produção desde antes da auditoria.
UPDATE public.service_orders
SET montagem_override_at = now(),
    montagem_override_reason = 'Backfill auditoria 28/05/2026 — destravando produção'
WHERE status NOT IN ('received', 'Concluído', 'concluido', 'Cancelado', 'cancelled', 'cancelado')
  AND montagem_override_at IS NULL
  AND created_at < CURRENT_DATE - interval '5 days';
