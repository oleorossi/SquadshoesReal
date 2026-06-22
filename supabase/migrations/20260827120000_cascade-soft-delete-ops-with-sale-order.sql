-- Cascata: ao excluir (soft delete) um Pedido de Venda, as Ordens de Produção
-- (orders) ligadas a ele também somem — e voltam se o PV for restaurado.
--
-- User reportou (22/06/2026): "excluo o PV e as OPs continuam aparecendo; elas
-- deveriam sumir junto com o PV". O soft delete de PV (mig 20260519180000) só
-- escondia o PV — por design deixava OPs/AR/itens intactos. Agora as OPs seguem
-- o PV: mesmo modelo de soft delete (deleted_at), REVERSÍVEL e SEM efeito em
-- estoque/reserva (igual ao soft delete do PV, que também não mexe em estoque).
--
-- Estratégia de "esconder em todo lugar" sem tocar nos ~40 pontos que leem
-- orders no frontend: filtro na RLS (deleted_at IS NULL). As OPs escondidas
-- somem de TODAS as queries de cliente automaticamente. A cascata roda dentro
-- das funções SECURITY DEFINER (soft_delete/restore), que ignoram a RLS.

-- 1) Coluna de soft delete em orders -----------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Índice parcial: a RLS passa a aplicar "deleted_at IS NULL" em toda leitura.
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted
  ON public.orders (sale_order_id)
  WHERE deleted_at IS NULL;

-- 2) RLS: esconde OPs soft-deleted de qualquer SELECT/UPDATE/DELETE de cliente.
--    WITH CHECK mantém só is_approved_user (não trava gravação normal). As
--    funções SECURITY DEFINER abaixo continuam enxergando as linhas escondidas.
DROP POLICY IF EXISTS "rls_orders_all" ON public.orders;
CREATE POLICY "rls_orders_all" ON public.orders
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user()) AND deleted_at IS NULL)
  WITH CHECK ((SELECT public.is_approved_user()));

-- 3) soft_delete_sale_order: esconde o PV E as OPs dele (deleted_at = now()).
CREATE OR REPLACE FUNCTION public.soft_delete_sale_order(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_blocking_nfe int;
  v_ops_hidden int := 0;
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

  -- Cascata: esconde as OPs ainda ativas deste PV (reversível pelo restore).
  -- Não mexe em estoque/reserva — mesma semântica do soft delete do PV.
  UPDATE public.orders
     SET deleted_at = now()
   WHERE sale_order_id = p_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_ops_hidden = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'order_number', v_so.order_number,
    'soft_deleted_at', now(),
    'ops_hidden', v_ops_hidden
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_sale_order(uuid) TO authenticated;

-- 4) restore_sale_order: traz de volta o PV E as OPs escondidas pela cascata.
CREATE OR REPLACE FUNCTION public.restore_sale_order(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_so sale_orders%ROWTYPE;
  v_ops_restored int := 0;
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

  -- Cascata inversa: reexibe as OPs que foram escondidas junto com o PV.
  UPDATE public.orders
     SET deleted_at = NULL
   WHERE sale_order_id = p_id AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS v_ops_restored = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    auth.uid(),
    'sale_order_restored',
    'sale_orders',
    p_id,
    jsonb_build_object('order_number', v_so.order_number, 'restored_at', now(), 'ops_restored', v_ops_restored),
    true,
    now()
  );
  RETURN jsonb_build_object('ok', true, 'order_number', v_so.order_number, 'ops_restored', v_ops_restored);
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_sale_order(uuid) TO authenticated;
