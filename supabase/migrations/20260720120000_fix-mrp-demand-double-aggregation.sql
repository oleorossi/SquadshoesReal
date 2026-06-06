-- ============================================================================
-- FIX CRÍTICO: motor de demanda do MRP estava produzindo ZERO.
--
-- fn_projected_demand() chamava calculate_order_consumption() — que RETORNA UM
-- ÚNICO jsonb (o array de materiais) — dentro de
--   (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]') FROM calculate_order_consumption(...) c)
-- tratando-a como se fosse uma TABELA de linhas. Resultado: o array já pronto
-- era EMBRULHADO num segundo array (`[[ {...}, {...} ]]`). Daí
-- jsonb_array_elements(cons) devolvia o array interno como UM elemento, e
-- `line ->> 'product_id'` num ARRAY = NULL → `WHERE product_id IS NOT NULL`
-- descartava 100% da demanda. v_mrp_needs só reagia a min_stock, nunca aos PVs.
--
-- FIX: usar o jsonb retornado DIRETO (sem jsonb_agg). Validado: demanda passa de
-- 0 para 210 linhas / 16 produtos / ~13,5k un nos PVs ativos atuais.
--
-- Bônus: 'Finalizado s/ NF' (pedido finalizado sem nota) é DONE igual a
-- 'Finalizado' — entra na exclusão de demanda. ('Rascunho' permanece incluído,
-- pois é decisão de negócio se rascunho deve puxar compra.)
--
-- FIX #2 (mesmo deploy): a demanda de material de ÁREA (napa/couro/forro) saía
-- em dm² cru. Como corrigir o #1 fez a demanda fluir, isso ficaria ~100×
-- inflado (ex.: GLOW METALIC PRATA pediria ~2.100 m em vez de ~21 m). Agora
-- converte dm²→unidade física do produto pela largura da ficha via
-- get_material_conversion_info(product_id).dm2_per_unit (par/un/kg → fator 1).
-- ============================================================================

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
      -- calculate_order_consumption RETORNA jsonb (o array). Usar direto — NÃO agregar.
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
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    -- dm²(área) → unidade física do produto pela largura da ficha. par/un/kg → /1.
    SUM(e.required) / GREATEST(COALESCE(
      (SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(e.product_id) conv LIMIT 1),
      1
    ), 1) AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$function$;
