-- ============================================================================
-- compute_materials_per_pv: usar o motor CANÔNICO de consumo
-- ============================================================================
-- Achado (feedback do dono, 2026-06-19): no relatório "Materiais necessários
-- para PV" faltavam as NAPAS (cabedal/forro/palmilha) e as COLAS apareciam com
-- cor (sendo que cola não tem variação de cor).
--
-- Causa: a versão anterior era um wrapper de get_wave_material_needs, que só lê
-- sheet_materials (BOM) + solado. Logo:
--   1) Napa/forro/palmilha NÃO apareciam — vêm de technical_sheets.upper/lining/
--      insole_material (texto), resolvidos só por calculate_order_consumption.
--   2) Cola ganhava cor — get_wave_material_needs faz
--      COALESCE(NULLIF(sm.color,''), soi.color, ''), herdando a cor do PV em
--      materiais sem cor própria.
--
-- Correção: alinhar este canal ao MESMO motor do modal "Consumo de Materiais" e
-- do MRP. Espelha fn_projected_demand (filter_caixa_by_packaging_mode +
-- calculate_order_consumption + explode + conversão dm²→física idêntica), porém:
--   - escopado aos PVs passados (não todos os ativos);
--   - agrega por (product_id, COR DA LINHA de consumo) — a cor vem da própria
--     linha (cola='', napa=cor real do produto), então cola deixa de fragmentar
--     por cor e napa/solado mantêm a cor correta;
--   - anexa supplier/estoque/preço/shortage que o canal precisa.
--
-- `required` já vem na unidade de estoque do produto (napa já convertida a m via
-- largura da ficha; placa em dm²; cola em kg), então a fórmula de conversão é a
-- mesma de fn_projected_demand (divide só linhas unit IS NULL por dm2_per_unit).
--
-- calculate_order_consumption é SECURITY DEFINER (eleva sozinha); este wrapper
-- continua INVOKER (lê sale_orders/items/products/suppliers, todos visíveis ao
-- perfil de compras). NÃO dá baixa em nada — é só leitura pra montar as OCs.
-- ============================================================================

DROP FUNCTION IF EXISTS public.compute_materials_per_pv(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
RETURNS TABLE(
  material_id      uuid,
  product_name     text,
  unit             text,
  color            text,
  needed_qty       numeric,
  stock_qty        numeric,
  shortage         numeric,
  supplier_id      uuid,
  supplier_name    text,
  last_unit_price  numeric,
  is_artisanal     boolean
)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  WITH items_with_cons AS (
    SELECT
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption(
          soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
          (SELECT key::integer FROM jsonb_each_text(soi.grade)
            WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')     AS product_name,
      COALESCE(line ->> 'color', '') AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  agg AS (
    SELECT
      e.product_id,
      e.color,
      MAX(e.product_name) AS product_name,
      -- Mesma conversão de fn_projected_demand: linhas de área (unit IS NULL)
      -- em dm² cru → divide por dm2_per_unit; linhas já na unidade do produto
      -- (unit IS NOT NULL) somam direto.
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit
                               FROM public.get_material_conversion_info(e.product_id) conv
                              LIMIT 1), 1), 1)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS needed_qty
    FROM exploded e
    GROUP BY e.product_id, e.color
  )
  SELECT
    a.product_id                  AS material_id,
    COALESCE(p.name, a.product_name) AS product_name,
    COALESCE(p.unit, 'un')        AS unit,
    a.color,
    a.needed_qty,
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
    GREATEST(0, a.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal
  FROM agg a
  LEFT JOIN public.products p   ON p.id = a.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  WHERE a.needed_qty > 0
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, a.product_name);
$function$;

GRANT EXECUTE ON FUNCTION public.compute_materials_per_pv(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.compute_materials_per_pv(uuid[]) IS
  'Materiais necessários para um conjunto de PVs (canal "Compras por Pedido"). '
  'Espelha fn_projected_demand (calculate_order_consumption + filtro de caixa + '
  'conversão dm²→física) por PV, agregando por produto+cor da linha e anexando '
  'fornecedor/estoque/preço. Inclui cabedal/forro/palmilha; cola sem cor.';
