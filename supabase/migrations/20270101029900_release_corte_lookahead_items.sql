-- Fila de Corte look-ahead: liberar itens selecionados como OP adiantada.
-- Spec: specs/fila-corte-lookahead.md
-- Reusa promote_sale_order_item(p_is_ahead := true) — coluna orders.is_ahead_of_schedule.
--
-- Carimbo: apply_migration (MCP) gravou 20260929025744 (data real, zona legada).
-- Remap live em 29/09/2026 → version=20270101029900 (restaura legacy_count=2295).
-- Não reaplicar o SQL se a função já existir.

CREATE OR REPLACE FUNCTION public.release_corte_lookahead_items(p_item_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_item public.sale_order_items%ROWTYPE;
  v_so public.sale_orders%ROWTYPE;
  v_res jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_criadas int := 0;
  v_pkg text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhum item selecionado' USING ERRCODE = '22023';
  END IF;

  -- Ordem determinística + lock por PV evita corrida entre abas.
  FOR v_item_id IN
    SELECT x
      FROM unnest(p_item_ids) AS t(x)
     ORDER BY x
  LOOP
    SELECT * INTO v_item FROM public.sale_order_items WHERE id = v_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % não encontrado', v_item_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('corte_lookahead:' || v_item.sale_order_id::text));

    SELECT * INTO v_so
      FROM public.sale_orders
     WHERE id = v_item.sale_order_id
       AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV do item % não encontrado', v_item_id;
    END IF;

    IF v_so.status NOT IN ('Aprovado', 'Em Produção') THEN
      RAISE EXCEPTION 'PV % não está Aprovado/Em Produção (status %)',
        COALESCE(v_so.order_number, v_so.id::text), v_so.status;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.sale_order_item_id = v_item.id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado', 'Rascunho')
    ) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id,
        'reason', 'já possui OP'
      ));
      CONTINUE;
    END IF;

    IF v_item.reference_id IS NULL THEN
      RAISE EXCEPTION 'Item % sem referência', v_item_id;
    END IF;

    -- Refs do Ateliê não disputam Corte interno.
    IF EXISTS (
      SELECT 1 FROM public.atelier_complex_references a
       WHERE a.reference_id = v_item.reference_id
         AND COALESCE(a.active, true)
    ) THEN
      RAISE EXCEPTION 'Referência do item % está no Ateliê — não libera na Fila de Corte',
        v_item_id;
    END IF;

    v_pkg := COALESCE(v_so.packaging_mode, 'individual_amarrado');

    v_res := public.promote_sale_order_item(
      v_item.id,
      'Em Produção',
      'Adiantada — Fila de Corte',
      v_so.delivery_deadline,
      true,
      v_pkg
    );

    IF COALESCE((v_res->>'skipped')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id,
        'reason', COALESCE(v_res->>'reason', 'skipped')
      ));
      CONTINUE;
    END IF;

    v_criadas := v_criadas + 1;
    v_ops := v_ops || jsonb_build_array(v_res);

    IF v_so.status = 'Aprovado' THEN
      UPDATE public.sale_orders
         SET status = 'Em Produção',
             updated_at = now()
       WHERE id = v_so.id
         AND status = 'Aprovado';
      v_so.status := 'Em Produção';
    END IF;
  END LOOP;

  IF v_criadas = 0 AND jsonb_array_length(v_skipped) = cardinality(p_item_ids) THEN
    RAISE EXCEPTION 'Nenhuma OP criada — itens já tinham OP ou foram pulados'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_criadas,
    'orders', v_ops,
    'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.release_corte_lookahead_items(uuid[]) IS
  'Fila de Corte look-ahead: promove itens de PV selecionados como OP Em Produção com is_ahead_of_schedule=true.';

REVOKE ALL ON FUNCTION public.release_corte_lookahead_items(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_corte_lookahead_items(uuid[]) TO authenticated, service_role;
