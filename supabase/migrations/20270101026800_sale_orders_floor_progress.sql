-- =============================================================================
-- Read model: progresso de chão (setor) por PV — lote
-- =============================================================================
-- Alimenta a coluna "Setor" em /sales sem N+1 de order_stages.
-- Fonte única = order_stages das OPs não canceladas do PV.
-- Sem coluna denormalizada em sale_orders (evita drift com apontamento).
-- Marcador: sale_orders_floor_progress_20270101026800
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_sale_orders_floor_progress(
  p_sale_order_ids uuid[]
)
RETURNS TABLE(
  sale_order_id uuid,
  completed integer,
  in_progress integer,
  total integer,
  current_sector text,
  ops_active integer,
  ops_done integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- sale_orders_floor_progress_20270101026800
  IF auth.role() <> 'service_role'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_sale_order_ids IS NULL OR cardinality(p_sale_order_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT id
    FROM unnest(p_sale_order_ids) AS id
    WHERE id IS NOT NULL
  ),
  active_ops AS (
    SELECT
      o.id AS order_id,
      o.sale_order_id,
      o.status AS op_status
    FROM public.orders o
    INNER JOIN requested r ON r.id = o.sale_order_id
    WHERE COALESCE(o.status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelada', 'cancelado', 'cancelled'
    )
  ),
  stage_rows AS (
    SELECT
      ao.sale_order_id,
      os.stage_name,
      os.stage_order,
      os.status AS stage_status
    FROM active_ops ao
    INNER JOIN public.order_stages os ON os.order_id = ao.order_id
  ),
  stage_agg AS (
    SELECT
      sr.sale_order_id,
      count(*) FILTER (WHERE sr.stage_status = 'concluido')::integer AS completed,
      count(*) FILTER (WHERE sr.stage_status = 'em_andamento')::integer AS in_progress,
      count(*)::integer AS total,
      (
        SELECT s2.stage_name
        FROM stage_rows s2
        WHERE s2.sale_order_id = sr.sale_order_id
          AND s2.stage_status IS DISTINCT FROM 'concluido'
        ORDER BY s2.stage_order ASC NULLS LAST, s2.stage_name ASC
        LIMIT 1
      ) AS current_sector
    FROM stage_rows sr
    GROUP BY sr.sale_order_id
  ),
  op_agg AS (
    SELECT
      ao.sale_order_id,
      count(*) FILTER (
        WHERE COALESCE(ao.op_status, '') IS DISTINCT FROM 'Finalizado'
      )::integer AS ops_active,
      count(*) FILTER (
        WHERE ao.op_status = 'Finalizado'
      )::integer AS ops_done
    FROM active_ops ao
    GROUP BY ao.sale_order_id
  )
  SELECT
    sa.sale_order_id,
    sa.completed,
    sa.in_progress,
    sa.total,
    sa.current_sector,
    COALESCE(oa.ops_active, 0),
    COALESCE(oa.ops_done, 0)
  FROM stage_agg sa
  LEFT JOIN op_agg oa ON oa.sale_order_id = sa.sale_order_id
  -- PV sem OP ativa / sem estágios → sem linha (progresso nulo na UI)
  WHERE sa.total > 0
  ORDER BY sa.sale_order_id;
END;
$function$;

COMMENT ON FUNCTION public.get_sale_orders_floor_progress(uuid[]) IS
  'Read model de progresso de chão por PV: agrega order_stages das OPs não '
  'canceladas; current_sector = primeira etapa não concluída (menor stage_order). '
  'PVs sem OP/estágio não retornam linha.';

REVOKE ALL ON FUNCTION public.get_sale_orders_floor_progress(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sale_orders_floor_progress(uuid[])
  TO authenticated, service_role;
