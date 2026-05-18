-- Trigger BEFORE DELETE em sale_orders → snapshot completo em audit_logs.
--
-- Contexto: PVs do LNG (PV-00102/103/105/106) sumiram sem rastro.
-- pv_number_seq=114 confirmou que foram criados; cascade DELETE limpou
-- orders+nfe sem deixar pista. audit_logs ficou vazio porque nenhum
-- trigger capturava o DELETE.
--
-- Fix: trigger BEFORE DELETE grava snapshot do PV + items + counts de
-- OPs/NFs vinculadas. Não impede DELETE — só garante rastreabilidade.
-- Permite recuperar manualmente via INSERT do snapshot se necessário.
--
-- Pra recuperar um PV deletado:
--   SELECT old_data FROM audit_logs
--    WHERE action = 'sale_order_deleted'
--      AND old_data->>'order_number' = 'PV-00102'
--    ORDER BY created_at DESC LIMIT 1;
--   -- Aí INSERT INTO sale_orders SELECT * FROM jsonb_populate_record(...)

CREATE OR REPLACE FUNCTION public.tg_log_sale_order_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_items jsonb;
  v_op_count int;
  v_nfe_count int;
  v_snapshot jsonb;
BEGIN
  -- auth.uid() pode ser NULL em deletes via service_role (edge functions);
  -- nesse caso grava NULL e a ação fica registrada como "system".
  BEGIN v_user := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user := NULL; END;

  -- Snapshot dos items do PV (independente da cascade que vai apagá-los)
  SELECT COALESCE(jsonb_agg(to_jsonb(soi)), '[]'::jsonb)
    INTO v_items
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = OLD.id;

  -- Counts de OPs e NFs vinculadas (pra alertar se PV tinha dependências)
  SELECT COUNT(*) INTO v_op_count FROM public.orders WHERE sale_order_id = OLD.id;
  SELECT COUNT(*) INTO v_nfe_count FROM public.nfe_emitidas WHERE sale_order_id = OLD.id;

  -- Snapshot completo: PV row + items + counts
  v_snapshot := to_jsonb(OLD) || jsonb_build_object(
    '_items', v_items,
    '_op_count', v_op_count,
    '_nfe_count', v_nfe_count,
    '_deleted_at', now(),
    '_deleted_by_uid', v_user
  );

  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, success, created_at
  ) VALUES (
    v_user,
    'sale_order_deleted',
    'sale_orders',
    OLD.id,
    v_snapshot,
    true,
    now()
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_sale_order_delete ON public.sale_orders;
CREATE TRIGGER trg_log_sale_order_delete
  BEFORE DELETE ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_log_sale_order_delete();

COMMENT ON FUNCTION public.tg_log_sale_order_delete() IS
  'Captura snapshot completo (PV + items + counts OPs/NFs) em audit_logs antes de DELETE. Não impede operação — só rastreia. Recuperação manual via SELECT old_data FROM audit_logs WHERE action=sale_order_deleted.';
