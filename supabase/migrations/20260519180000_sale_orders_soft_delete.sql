-- Soft delete em sale_orders.
--
-- User reportou em mai/2026: "PVs sumindo sem rastro" e "sync ruim entre users".
-- Auditoria confirmou 7 PVs ausentes (LNG 102/103/105/106 + 112/113/114) +
-- PV-00121 deletado pelo próprio user em 19/05 18:47 (cliente ALCINEU DE MADUREIRA).
--
-- Causa raiz: UI fazia HARD delete via cascade, sem undo. Um clique acidental
-- (ou window.confirm clicado sem ler) apagava tudo. Trigger BEFORE DELETE
-- (mig 20260518160000) só capturou DELETEs depois de 18/05 — PVs anteriores
-- ficaram sem rastro.
--
-- Fix estrutural: soft delete. Excluir vira UPDATE deleted_at = now(). PV some
-- da lista (filtro WHERE deleted_at IS NULL) mas tudo continua no banco —
-- items, OPs, AR, NF-e, etc. Restauração em 1 clique (admin/gerente).
--
-- Aplicada via MCP em 19/05/2026. Conteúdo idempotente (IF NOT EXISTS).
-- PV-00121 já foi restaurado via INSERT do snapshot do audit_logs.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_sale_orders_active
  ON public.sale_orders (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.restore_sale_order(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_so sale_orders%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role NOT IN ('admin', 'gerente') THEN
    RAISE EXCEPTION 'Permission denied: apenas admin/gerente pode restaurar PVs';
  END IF;
  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_id;
  END IF;
  IF v_so.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Sale order % não está deletado', p_id;
  END IF;
  UPDATE public.sale_orders SET deleted_at = NULL, updated_at = now() WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    auth.uid(),
    'sale_order_restored',
    'sale_orders',
    p_id,
    jsonb_build_object('order_number', v_so.order_number, 'restored_at', now()),
    true,
    now()
  );
  RETURN jsonb_build_object('ok', true, 'order_number', v_so.order_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_sale_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_sale_order(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_blocking_nfe int;
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
  UPDATE public.sale_orders SET deleted_at = now(), updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'order_number', v_so.order_number, 'soft_deleted_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_sale_order(uuid) TO authenticated;
