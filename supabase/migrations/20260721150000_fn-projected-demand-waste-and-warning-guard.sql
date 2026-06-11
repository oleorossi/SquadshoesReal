-- ════════════════════════════════════════════════════════════════════════════
-- Fix MÉDIO (auditoria 2026-06-11) — fn_projected_demand alinha à timeline/custeio
-- ════════════════════════════════════════════════════════════════════════════
-- A versão anterior dividia SUM(required) por GREATEST(dm2_per_unit, 1), o que
-- JÁ converte corretamente material de área quando a ficha tem largura
-- (get_material_conversion_info retorna dm2_per_unit = largura/10 e
-- conversion_warning = NULL). Mas divergia da view purchase_projection_timeline
-- (e do custeio) em dois pontos:
--   1. NÃO aplicava (1 + waste%) → a demanda do MRP ficava ~perda% abaixo da
--      necessidade real usada no cronograma.
--   2. Convertia sempre que dm2_per_unit > 1 sem checar conversion_warning. Hoje
--      o helper só devolve dm2_per_unit > 1 quando NÃO há warning, então é
--      numericamente equivalente; o guard explícito blinda contra mudanças
--      futuras do helper e deixa a regra idêntica à timeline.
-- Só converte para produto LINEAR (m/cm) com largura. PLACA, contagem, massa e
-- dm² nativo permanecem crus (igual ao comportamento anterior).

CREATE OR REPLACE FUNCTION public.fn_projected_demand()
 RETURNS TABLE(product_id uuid, product_name text, total_required numeric, earliest_deadline date, orders_count integer, order_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT
      so.id AS sale_order_id,
      so.delivery_deadline,
      soi.id AS sale_order_item_id,
      COALESCE(
        public.calculate_order_consumption(
          soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
          (SELECT key::integer FROM jsonb_each_text(soi.grade)
             WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
        ),
        '[]'::jsonb
      ) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF', 'Faturado')
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      sale_order_id,
      delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')      AS product_name,
      (line ->> 'required')::numeric AS required
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  ),
  grouped AS (
    SELECT
      e.product_id,
      MAX(e.product_name) AS product_name,
      SUM(e.required) AS required_raw,
      MIN(e.delivery_deadline) AS earliest_deadline,
      COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
      array_agg(DISTINCT e.sale_order_id) AS order_ids
    FROM exploded e
    WHERE e.product_id IS NOT NULL
    GROUP BY e.product_id
  )
  SELECT
    g.product_id,
    g.product_name,
    -- dm²(área)→linear pela largura da ficha + perda%, igual à timeline/custeio.
    CASE
      WHEN conv.conversion_warning IS NULL
           AND COALESCE(conv.dm2_per_unit, 0) > 0
           AND conv.target_unit IN ('m','meters','metros','mt','cm')
        THEN g.required_raw / conv.dm2_per_unit * (1 + COALESCE(conv.waste_pct, 0) / 100)
      ELSE g.required_raw
    END AS total_required,
    g.earliest_deadline,
    g.orders_count,
    g.order_ids
  FROM grouped g
  LEFT JOIN LATERAL public.get_material_conversion_info(g.product_id) conv ON true;
END;
$function$;

COMMENT ON FUNCTION public.fn_projected_demand() IS
  'Demanda projetada por produto a partir de PVs ativos. Converte dm²→linear pela '
  'largura da ficha + perda% (mesma regra de purchase_projection_timeline/custeio); '
  'guarda conversion_warning. PLACA/contagem/massa/dm² nativo ficam crus.';
