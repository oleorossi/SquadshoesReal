-- Roteamento da BASE da tira pela napa da FICHA TÉCNICA da referência
-- ============================================================================
-- Regra de negócio (usuário, 2026-07-22): a base de uma TIRA artesanal segue a
-- napa da ficha técnica da referência (upper_material / lining_material), não a
-- base fixa da receita. Ex.: ref cadastrada como NAPA MADRID → suas tiras saem
-- de NAPA MADRID. Não há mistura de material dentro de uma referência.
--
-- Antes: `compute_materials_per_pv` e `get_wave_material_needs_core` convertiam
-- a tira→napa "às cegas" pela `artisanal_recipes.base_product_name` (sempre
-- NAPA SOFT), mesmo em referência NAPA MADRID → comprava/planejava a napa
-- ERRADA (PV-00148: 111,36 m de tira CAPUCCINO de uma ref NAPA MADRID viravam
-- ~1,86 m de NAPA SOFT).
--
-- Agora: a napa da ficha (`technical_sheets` via `sale_order_items.reference_id`)
-- entra como `family` e escolhe a receita `(tira, base=family)`. Se não houver
-- receita pra essa base (ex.: NAPA MADRID ainda sem rendimento cadastrado) NÃO
-- converte às cegas — emite `conversion_warning` e mantém a tira (fica visível
-- pra cadastrar o rendimento). Referências NAPA SOFT: comportamento idêntico ao
-- anterior. Espelha o motor TS (orderConsumption.ts → materialFamily) e o modal
-- de Consumo. Ver specs/tira-base-napa-por-ficha-tecnica.md.
--
-- Nenhuma chamada de função nova (só JOIN em technical_sheets) → sem risco de
-- recursão (incidente 54001 da auditoria de alinhamento).
-- ============================================================================

-- 1) OC "Compras por Pedido" ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean, grade jsonb, color_mismatch boolean, conversion_warning text)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    SELECT soi.grade AS item_grade,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, ''),
          soi.material_variant_id
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
  ),
  exploded AS (
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')     AS product_name,
      CASE WHEN (line ->> 'matched_by') = 'group_generic' THEN ''
           ELSE COALESCE(line ->> 'color', '') END AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit,
      (line ->> 'component')        AS component,
      (line ->> 'matched_by')       AS matched_by,
      (line ->> 'conversion_warning') AS conversion_warning,
      NULL::text                    AS family,   -- napa direta: base é a própria groupName
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id, sn.product_name, COALESCE(sn.color, '') AS color,
           sn.required_m AS required, 'm'::text AS unit,
           NULL::text AS conversion_warning,
           -- napa da ficha da referência (cabedal primeiro, forro como fallback)
           COALESCE(NULLIF(trim(ts.upper_material), ''), NULLIF(trim(ts.lining_material), '')) AS family
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT product_id, product_name, color, required, unit, conversion_warning, family FROM exploded
    UNION ALL
    SELECT product_id, product_name, color, required, unit, conversion_warning, family FROM strap_exploded
  ),
  agg AS (
    SELECT e.product_id, e.color, e.family, MAX(e.product_name) AS product_name,
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL AND e.conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit
                               FROM public.get_material_conversion_info(e.product_id) conv
                              LIMIT 1), 1), 1)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL AND e.conversion_warning IS NULL), 0) AS needed_qty,
      MAX(e.conversion_warning) AS conversion_warning
    FROM all_exploded e
    GROUP BY e.product_id, e.color, e.family
  ),
  resolved AS (
    SELECT
      COALESCE(bp.id, a.product_id) AS product_id,
      a.color,
      -- Tira em napa da ficha SEM receita → needed 0 (não compra às cegas),
      -- só o warning fica pra cadastrar. Mesma convenção do dm²/largura-faltando.
      CASE WHEN a.family IS NOT NULL AND COALESCE(ap.is_artisanal, false) = true AND ar.id IS NULL
           THEN 0
           WHEN bp.id IS NOT NULL AND ar.yield_per_meter > 0
           THEN a.needed_qty / ar.yield_per_meter
           ELSE a.needed_qty END AS needed_qty,
      -- Tira com napa da ficha SEM receita pra essa base → não converte às cegas;
      -- flag pra cadastrar o rendimento (a linha fica como a tira, visível).
      CASE
        WHEN a.family IS NOT NULL AND COALESCE(ap.is_artisanal, false) = true AND ar.id IS NULL
        THEN COALESCE(apg.name, ap.name, 'Tira') || ' em ' || a.family
             || ': rendimento não cadastrado — cadastre a receita da tira nessa napa'
        ELSE a.conversion_warning
      END AS conversion_warning
    FROM agg a
    LEFT JOIN public.products ap ON ap.id = a.product_id
    LEFT JOIN public.product_groups apg ON apg.id = ap.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON COALESCE(ap.is_artisanal, false) = true AND ar.active = true
          AND apg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(apg.name)))
          -- base = napa da ficha da referência (quando conhecida)
          AND (a.family IS NULL
               OR lower(trim(unaccent(ar.base_product_name))) = lower(trim(unaccent(a.family))))
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
    SELECT product_id, color, SUM(needed_qty) AS needed_qty,
           MAX(conversion_warning) AS conversion_warning
    FROM resolved
    GROUP BY product_id, color
  ),
  own_res AS (
    SELECT mr.product_id,
           SUM(GREATEST(0, COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0))) AS own_reserved
    FROM public.material_reservations mr
    JOIN public.orders o ON o.id = mr.order_id
    WHERE o.sale_order_id = ANY(p_pv_ids)
      AND mr.status IN ('reserved', 'partially_consumed')
    GROUP BY mr.product_id
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
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0)) AS stock_qty,
    GREATEST(0, r.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal,
    sg.grade,
    COALESCE(m.color_mismatch, false) AS color_mismatch,
    r.conversion_warning
  FROM rolled r
  LEFT JOIN public.products p   ON p.id = r.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN own_res orr ON orr.product_id = r.product_id
  LEFT JOIN solado_grade sg ON sg.product_id = r.product_id AND sg.color = r.color
  LEFT JOIN mism m ON m.product_id = r.product_id AND m.color = r.color
  WHERE r.needed_qty > 0 OR r.conversion_warning IS NOT NULL
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, r.product_id::text);
$function$;

-- 2) Wave / MRP "get_wave_material_needs_core" --------------------------------
-- Mesma rota de família; aqui a tira PERMANECE como produto (needed_qty em
-- metros de tira) e a napa vai nas colunas base_*. Família sem receita → base_*
-- nulo + conversion_warning (não planeja a napa errada).
CREATE OR REPLACE FUNCTION public.get_wave_material_needs_core(p_sale_order_ids uuid[], p_corte_start date)
 RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date, conversion_warning text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  items_with_cons AS (
    SELECT COALESCE(public.filter_caixa_by_packaging_mode(
      public.calculate_order_consumption_by_grade(
        soi.reference_id,
        public.scale_grade_to_total(soi.grade, soi.quantity),
        COALESCE(soi.color, ''),
        soi.material_variant_id
      ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
  ),
  exploded AS (
    SELECT (line ->> 'product_id')::uuid AS product_id,
           COALESCE(line ->> 'color', '') AS effective_color,
           (line ->> 'required')::numeric AS required,
           (line ->> 'unit') AS unit,
           (line ->> 'conversion_warning') AS conversion_warning,
           NULL::text AS family
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id,
           COALESCE(sn.color, '') AS effective_color,
           sn.required_m AS required,
           'm'::text AS unit,
           NULL::text AS conversion_warning,
           COALESCE(NULLIF(trim(ts.upper_material), ''), NULLIF(trim(ts.lining_material), '')) AS family
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sn.product_id IS NOT NULL
  ),
  all_exploded AS (
    SELECT * FROM exploded
    UNION ALL
    SELECT * FROM strap_exploded
  ),
  needed AS (
    SELECT product_id, effective_color, family,
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL AND conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL AND conversion_warning IS NULL), 0) AS needed_qty,
      MAX(conversion_warning) AS conversion_warning
    FROM all_exploded
    GROUP BY product_id, effective_color, family
  ),
  own_res AS (
    SELECT mr.product_id,
           SUM(GREATEST(0, COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0))) AS own_reserved
    FROM public.material_reservations mr
    JOIN public.orders o ON o.id = mr.order_id
    WHERE o.sale_order_id = ANY(p_sale_order_ids)
      AND mr.status IN ('reserved', 'partially_consumed')
    GROUP BY mr.product_id
  ),
  enriched_base AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.family AS family, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0)) AS avail_total,
           SUM(n.needed_qty) OVER (PARTITION BY n.product_id) AS product_needed_total,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal,
           n.conversion_warning
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN own_res orr ON orr.product_id = n.product_id
     WHERE n.needed_qty > 0 OR n.conversion_warning IS NOT NULL
  ),
  enriched AS (
    SELECT eb.*,
           CASE WHEN eb.product_needed_total > 0
                THEN eb.avail_total * eb.needed_qty / eb.product_needed_total
                ELSE eb.avail_total END AS stock_qty,
           GREATEST(0, eb.needed_qty - CASE WHEN eb.product_needed_total > 0
                THEN eb.avail_total * eb.needed_qty / eb.product_needed_total
                ELSE eb.avail_total END) AS shortage
      FROM enriched_base eb
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty,
         e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days,
         e.is_artisanal,
         ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
         bp.id AS base_product_id, ar.base_product_name,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
              THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
         bp.quantity AS base_stock_qty,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
              THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
              ELSE NULL END AS base_shortage,
         CASE WHEN e.is_artisanal AND p_corte_start IS NOT NULL
              THEN (p_corte_start - 7)::date ELSE NULL END AS os_send_date,
         CASE
           WHEN e.family IS NOT NULL AND e.is_artisanal AND ar.id IS NULL
           THEN COALESCE(epg.name, e.product_name, 'Tira') || ' em ' || e.family
                || ': rendimento não cadastrado — cadastre a receita da tira nessa napa'
           ELSE e.conversion_warning
         END AS conversion_warning
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
          AND (e.family IS NULL
               OR lower(trim(unaccent(ar.base_product_name))) = lower(trim(unaccent(e.family))))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    LEFT JOIN LATERAL (
      SELECT bp2.id, bp2.quantity
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (e.color = ''
              OR lower(unaccent(COALESCE(bp2.color,''))) = lower(unaccent(e.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$function$;
