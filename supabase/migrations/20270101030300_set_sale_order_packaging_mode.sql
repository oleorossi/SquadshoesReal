-- Troca leve de embalagem do PV (sem rematerializar itens/OPs).
--
-- Motivo (29/09/2026): o bulk "Embalagem" usava o command `update` completo,
-- que exige header sem billing/factoring e ainda rematerializa Em Produção
-- (cancel_op_ids). Para só corrigir Colméia → Individual+Fitilho e liberar
-- etiqueta individual, basta gravar packaging_mode; o gatilho
-- trg_reconcile_packaging_on_sale_order_mode já reconcilia o débito de caixa.

CREATE OR REPLACE FUNCTION public.set_sale_order_packaging_mode(
  p_sale_order_id uuid,
  p_packaging_mode text,
  p_expected_order_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_mode text := lower(btrim(COALESCE(p_packaging_mode, '')));
  v_new_version bigint;
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Autenticação obrigatória'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado'
      USING ERRCODE = '42501';
  END IF;

  IF v_mode NOT IN (
    'individual_master',
    'colmeia',
    'individual_fitilho',
    'individual_amarrado'
  ) THEN
    RAISE EXCEPTION 'Modo de embalagem inválido: %', p_packaging_mode
      USING ERRCODE = '22023';
  END IF;

  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id obrigatório'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_order_version IS NULL OR p_expected_order_version < 1 THEN
    RAISE EXCEPTION 'expected_order_version obrigatório'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_so.order_version IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION
      'Versão do PV desatualizada (esperada %, atual %). Recarregue e tente novamente.',
      p_expected_order_version, v_so.order_version
      USING ERRCODE = 'PZ115';
  END IF;

  IF v_so.status IN (
    'Faturado',
    'Finalizado s/ NF',
    'Expedido',
    'Cancelado',
    'Concluído'
  ) THEN
    RAISE EXCEPTION 'Status % não permite alterar embalagem', v_so.status
      USING ERRCODE = 'PZ119';
  END IF;

  IF v_so.packaging_mode IS NOT DISTINCT FROM v_mode THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'sale_order_id', p_sale_order_id,
      'packaging_mode', v_mode,
      'order_version', v_so.order_version
    );
  END IF;

  UPDATE public.sale_orders so
     SET packaging_mode = v_mode,
         updated_at = now()
   WHERE so.id = p_sale_order_id
   RETURNING so.order_version INTO v_new_version;

  RETURN jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'sale_order_id', p_sale_order_id,
    'packaging_mode', v_mode,
    'previous_packaging_mode', v_so.packaging_mode,
    'order_version', v_new_version
  );
END;
$function$;

COMMENT ON FUNCTION public.set_sale_order_packaging_mode(uuid, text, bigint) IS
  'Atualiza só packaging_mode do PV (CAS em order_version). Não rematerializa OPs; o gatilho de embalagem reconcilia o débito de caixa.';

REVOKE ALL ON FUNCTION public.set_sale_order_packaging_mode(uuid, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_sale_order_packaging_mode(uuid, text, bigint)
  TO authenticated, service_role;
