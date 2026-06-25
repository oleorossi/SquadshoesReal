-- ════════════════════════════════════════════════════════════════════════════
-- Compras por Pedido — rollup de tira artesanal → MATERIAL BASE + grade do solado
-- ════════════════════════════════════════════════════════════════════════════
-- Pedido do dono (2026-06-25), em cima do PV-00145 (S-039):
--   (1) Ao gerar OC, comprar o MATERIAL BASE somado, não a tira pronta. As tiras
--       artesanais (Tira Overlock 5mm, Tira chata 8mm) são cortadas de NAPA SOFT;
--       a OC deve listar a napa base na quantidade somada (m de tira ÷ yield),
--       não 599,84 m de "tira" (que não se compra).
--   (2) O solado deve aparecer com a GRADE por numeração (total de pares por
--       número), como no modal de Consumo de Materiais.
--
-- Implementação em compute_materials_per_pv:
--   • resolved/rolled: para produtos is_artisanal com receita ativa
--     (artisanal_recipes.artisanal_product_name = nome do grupo do produto),
--     troca o produto pela BASE (por grupo+cor) e divide needed por
--     yield_per_meter. Espelha a resolução de base de get_wave_material_needs.
--     Materiais não-artesanais (forração, cola, solado, caixa) passam intactos.
--   • solado_grade: para linhas de Solado, soma a grade dos itens ESCALADA ao
--     total de pares do item (grade por ficha × pares ÷ soma-da-grade) → total
--     por numeração. Exposto na nova coluna `grade jsonb` (null nos demais).
--
-- Também marca o grupo "Tira chata 8mm" como artesanal (faltava a flag, então a
-- tira chata caía como material direto em vez de resolver pra base — a receita
-- já existia). Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.products p
   SET is_artisanal = true
  FROM public.product_groups g
 WHERE p.group_id = g.id
   AND lower(trim(unaccent(g.name))) = lower(trim(unaccent('Tira chata 8mm')))
   AND COALESCE(p.is_artisanal, false) = false;

DROP FUNCTION IF EXISTS public.compute_materials_per_pv(uuid[]);
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean, grade jsonb)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    SELECT soi.grade AS item_grade,
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
      (line ->> 'unit')             AS unit,
      (line ->> 'component')        AS component,
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id, sn.product_name, COALESCE(sn.color, '') AS color,
           sn.required_m AS required, 'm'::text AS unit
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT product_id, product_name, color, required, unit FROM exploded
    UNION ALL
    SELECT product_id, product_name, color, required, unit FROM strap_exploded
  ),
  agg AS (
    SELECT e.product_id, e.color, MAX(e.product_name) AS product_name,
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit
                               FROM public.get_material_conversion_info(e.product_id) conv
                              LIMIT 1), 1), 1)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS needed_qty
    FROM all_exploded e
    GROUP BY e.product_id, e.color
  ),
  resolved AS (
    SELECT
      COALESCE(bp.id, a.product_id) AS product_id,
      a.color,
      CASE WHEN bp.id IS NOT NULL AND ar.yield_per_meter > 0
           THEN a.needed_qty / ar.yield_per_meter
           ELSE a.needed_qty END AS needed_qty
    FROM agg a
    LEFT JOIN public.products ap ON ap.id = a.product_id
    LEFT JOIN public.product_groups apg ON apg.id = ap.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON COALESCE(ap.is_artisanal, false) = true AND ar.active = true
          AND apg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(apg.name)))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    LEFT JOIN LATERAL (
      SELECT bp2.id
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (a.color = ''
              OR lower(unaccent(COALESCE(bp2.color, ''))) = lower(unaccent(a.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
  ),
  rolled AS (
    SELECT product_id, color, SUM(needed_qty) AS needed_qty
    FROM resolved
    GROUP BY product_id, color
  ),
  solado_grade AS (
    SELECT product_id, color, jsonb_object_agg(k, v) AS grade FROM (
      SELECT e.product_id, e.color, kv.key AS k,
             round(SUM((kv.value::numeric) * e.required / NULLIF(gs.total, 0))) AS v
      FROM exploded e
      CROSS JOIN LATERAL (
        SELECT SUM(x.value::numeric) AS total
        FROM jsonb_each_text(e.item_grade) x WHERE x.key ~ '^[0-9/]+$'
      ) gs
      , jsonb_each_text(e.item_grade) kv
      WHERE e.component = 'Solado' AND e.item_grade IS NOT NULL
        AND kv.key ~ '^[0-9/]+$' AND COALESCE(gs.total, 0) > 0
      GROUP BY e.product_id, e.color, kv.key
    ) g WHERE v > 0 GROUP BY product_id, color
  )
  SELECT
    r.product_id                  AS material_id,
    COALESCE(p.name, r.product_id::text) AS product_name,
    COALESCE(p.unit, 'un')        AS unit,
    r.color,
    r.needed_qty,
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
    GREATEST(0, r.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal,
    sg.grade
  FROM rolled r
  LEFT JOIN public.products p   ON p.id = r.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN solado_grade sg ON sg.product_id = r.product_id AND sg.color = r.color
  WHERE r.needed_qty > 0
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, r.product_id::text);
$function$;
