-- ============================================================================
-- compute_materials_per_pv: colapsar material de base INCOLOR numa linha só
-- ============================================================================
-- Achado (auditoria do PDF "Materiais necessários para PV", 2026-06-29):
-- a PLACA EVA (base da palmilha, produto cor "BRANCA", incolor) aparecia em
-- DUAS linhas — OFF WHITE e BEGE — quando o PV tem itens nessas duas cores.
--
-- Causa: o motor (calculate_order_consumption) carimba a COR DO SAPATO na linha
-- da palmilha mesmo quando o match é genérico (matched_by='group_generic' =
-- caiu na base genérica do grupo, não num produto colorido). Como o rollup
-- agrupa por (product_id, COR DA LINHA), as duas cores não fundiam → viravam 2
-- linhas / 2 compras pra um material que é UM só (a base EVA é a mesma pros dois
-- sapatos). O total (10.333 dm²) estava certo, mas dividido em 2.
--
-- Distinção importante: 'group_generic' (base incolor, ex.: EVA) é diferente de
-- 'color_mismatch' (cor pedida SEM produto cadastrado — guard âmbar/vermelho que
-- bloqueia a OC). Só zeramos a cor do PRIMEIRO caso; o mismatch continua
-- marcando a cor errada pro guard funcionar.
--
-- Correção: na CTE `exploded`, zerar a cor das linhas matched_by='group_generic'
-- ANTES do agrupamento — assim as duas linhas de EVA viram (placa_id, '') e
-- fundem numa só. Demais linhas (exact_color, color_mismatch, sem matched_by)
-- mantêm a cor. Único ponto alterado; resto da função é idêntico ao vivo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
RETURNS TABLE(material_id uuid, product_name text, unit text, color text,
  needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid,
  supplier_name text, last_unit_price numeric, is_artisanal boolean,
  grade jsonb, color_mismatch boolean)
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
      -- Base INCOLOR (group_generic) não herda a cor do sapato — senão a mesma
      -- placa EVA vira 2 linhas (OFF WHITE/BEGE) pra os 2 itens do PV.
      CASE WHEN (line ->> 'matched_by') = 'group_generic' THEN ''
           ELSE COALESCE(line ->> 'color', '') END AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit,
      (line ->> 'component')        AS component,
      (line ->> 'matched_by')       AS matched_by,
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
  mism AS (
    SELECT product_id, color, bool_or(matched_by = 'color_mismatch') AS color_mismatch
    FROM exploded GROUP BY product_id, color
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
    sg.grade,
    COALESCE(m.color_mismatch, false) AS color_mismatch
  FROM rolled r
  LEFT JOIN public.products p   ON p.id = r.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN solado_grade sg ON sg.product_id = r.product_id AND sg.color = r.color
  LEFT JOIN mism m ON m.product_id = r.product_id AND m.color = r.color
  WHERE r.needed_qty > 0
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, r.product_id::text);
$function$;
