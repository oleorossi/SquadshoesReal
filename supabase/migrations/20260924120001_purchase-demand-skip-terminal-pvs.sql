-- ============================================================================
-- Demanda de compra ignora PV encerrado + diagnósticos de componente por cor
--
-- Origem: investigação do PV-00147 ("fivela aparecendo como 4416").
--
-- (1) `compute_materials_per_pv` e `get_wave_material_needs_core` NÃO tinham
--     nenhum filtro de status: um PV 'Faturado', com todas as OPs 'Finalizado',
--     continuava devolvendo a demanda BRUTA integral como se fosse comprar tudo
--     de novo. Pior, `own_res` só devolve reservas 'reserved'/'partially_consumed'
--     — as do PV entregue já viraram 'converted', então own_reserved = 0 e o
--     estoque líquido do material aparecia como 0. Resultado no PV-00145
--     (Faturado, 2208 pares de S-039): a tela "Gerar OCs" mandava comprar
--     4.416 fivelas para um pedido já entregue — que é EXATAMENTE o número que
--     o usuário viu e leu como sendo do PV-00147 (que precisa de 1.728).
--
--     Regra nova: item de PV com status terminal sai da demanda de COMPRA,
--     a menos que ainda exista OP viva pra aquele item (PV faturado
--     parcialmente com produção em aberto continua comprando).
--     Statuses reais no banco: sale_orders → 'Faturado' | 'Cancelado' |
--     'Finalizado s/ NF' são terminais; orders → 'Finalizado' | 'Cancelada'.
--
-- (2) `consumption_consistency_report()` ganha 3 checks que pegam a classe de
--     erro de cadastro que INFLA consumo silenciosamente (achados da mesma
--     investigação, ver comentários em cada bloco).
--
-- Nada aqui altera a MATEMÁTICA do consumo — só quem entra na conta de compra
-- e o que o /diagnostics denuncia.
-- ============================================================================

-- ── (1a) compute_materials_per_pv ───────────────────────────────────────────
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
      -- PV encerrado não gera demanda de compra (ver cabeçalho).
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
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
      NULL::text                    AS family,
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id, sn.product_name, COALESCE(sn.color, '') AS color,
           sn.required_m AS required, 'm'::text AS unit,
           NULL::text AS conversion_warning,
           COALESCE(NULLIF(trim(ts.upper_material), ''), NULLIF(trim(ts.lining_material), '')) AS family
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND sn.product_id IS NOT NULL
      -- Mesmo gate do item_cons: tira de PV encerrado também não se compra.
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
      )
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
      CASE WHEN a.family IS NOT NULL AND COALESCE(ap.is_artisanal, false) = true AND ar.id IS NULL
           THEN 0
           WHEN bp.id IS NOT NULL AND ar.yield_per_meter > 0
           THEN a.needed_qty / ar.yield_per_meter
           ELSE a.needed_qty END AS needed_qty,
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

-- ── (1b) get_wave_material_needs_core ───────────────────────────────────────
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
      -- PV encerrado não gera necessidade de material na onda (ver cabeçalho).
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
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
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
      )
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

-- ── (2) Novos checks em consumption_consistency_report ──────────────────────
-- Reaplica a função inteira acrescentando 3 checks no fim. Os checks anteriores
-- ficam idênticos (não mexer neles é intencional — são contrato de /diagnostics).
CREATE OR REPLACE FUNCTION public.consumption_consistency_report()
 RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT 'material_linear_sem_largura'::text, 'alto'::text, COALESCE(count(*),0)::int,
    COALESCE(string_agg(product_name || ' ('||product_unit||')', ' · ' ORDER BY product_name), '—')
    FROM (SELECT * FROM public.list_materials_missing_width() LIMIT 200) m;

  RETURN QUERY SELECT 'palmilha_pronta_com_consumo_area'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts WHERE ts.insole_ready_made = true AND COALESCE(ts.insole_consumption,0) > 1;

  RETURN QUERY SELECT 'solado_dirige_consumo_sem_specs'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts WHERE ts.sole_drives_consumption = true AND ts.primary_sole_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = ts.primary_sole_id);

  RETURN QUERY SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p WHERE p.is_fachetado = true AND lower(COALESCE(p.category,'')) LIKE '%solado%'
      AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2,0) > 0);

  RETURN QUERY
  WITH persize AS (
    SELECT ts.name, 'cabedal' AS comp, ts.upper_consumption AS escalar,
           (SELECT avg(NULLIF(v,'')::numeric) FROM jsonb_each_text(ts.upper_consumption_per_size) e(k,v) WHERE NULLIF(v,'')::numeric > 0) AS media
      FROM public.technical_sheets ts WHERE jsonb_typeof(ts.upper_consumption_per_size)='object'
    UNION ALL
    SELECT ts.name, 'forro', ts.lining_consumption,
           (SELECT avg(NULLIF(v,'')::numeric) FROM jsonb_each_text(ts.lining_consumption_per_size) e(k,v) WHERE NULLIF(v,'')::numeric > 0)
      FROM public.technical_sheets ts WHERE jsonb_typeof(ts.lining_consumption_per_size)='object'
    UNION ALL
    SELECT ts.name, 'palmilha', ts.insole_consumption,
           (SELECT avg(NULLIF(v,'')::numeric) FROM jsonb_each_text(ts.insole_consumption_per_size) e(k,v) WHERE NULLIF(v,'')::numeric > 0)
      FROM public.technical_sheets ts WHERE jsonb_typeof(ts.insole_consumption_per_size)='object'
  )
  SELECT 'persize_diverge_do_escalar'::text, 'alto'::text, count(*)::int,
         COALESCE(string_agg(name||' ('||comp||' '||round(media,2)||'<>'||round(escalar,2)||')', ' · ' ORDER BY name), '—')
    FROM persize
   WHERE media IS NOT NULL AND escalar IS NOT NULL AND escalar > 0
     AND (media > escalar * 3 OR media < escalar / 3.0);

  RETURN QUERY
  SELECT 'consumo_implausivel_alto'::text, 'alto'::text, count(*)::int,
         COALESCE(string_agg(name||' ('||comp||' '||round(val,0)||')', ' · ' ORDER BY name), '—')
    FROM (
      SELECT ts.name, 'cabedal' AS comp, GREATEST(COALESCE(ts.upper_consumption,0),
        COALESCE((SELECT max(NULLIF(v,'')::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(ts.upper_consumption_per_size)='object' THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END) e(k,v)),0)) AS val
        FROM public.technical_sheets ts
      UNION ALL
      SELECT ts.name, 'forro', GREATEST(COALESCE(ts.lining_consumption,0),
        COALESCE((SELECT max(NULLIF(v,'')::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(ts.lining_consumption_per_size)='object' THEN ts.lining_consumption_per_size ELSE '{}'::jsonb END) e(k,v)),0))
        FROM public.technical_sheets ts
      UNION ALL
      SELECT ts.name, 'palmilha', GREATEST(COALESCE(ts.insole_consumption,0),
        COALESCE((SELECT max(NULLIF(v,'')::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(ts.insole_consumption_per_size)='object' THEN ts.insole_consumption_per_size ELSE '{}'::jsonb END) e(k,v)),0))
        FROM public.technical_sheets ts
    ) x
   WHERE val > 100;

  RETURN QUERY
  SELECT 'forro_cabedal_duplicado_com_palmilha'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE COALESCE(ts.sole_drives_consumption,false) = true
     AND COALESCE(ts.lining_consumption,0) > 0
     AND ts.primary_sole_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.insole_lining_consumption_dm2,0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.lining_consumption_dm2,0) > 0);

  RETURN QUERY
  SELECT 'produto_artesanal_flag_inconsistente'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
    JOIN public.product_groups g ON g.id = p.group_id
    JOIN public.artisanal_recipes ar ON ar.active = true
      AND lower(trim(extensions.unaccent(ar.artisanal_product_name))) = lower(trim(extensions.unaccent(g.name)))
   WHERE p.active = true AND COALESCE(p.is_artisanal, false) = false;

  RETURN QUERY
  SELECT 'material_base_artesanal_sem_cor'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name || ' → ' || ar.base_product_name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
    JOIN public.product_groups g ON g.id = p.group_id
    JOIN public.artisanal_recipes ar ON ar.active = true
      AND lower(trim(extensions.unaccent(ar.artisanal_product_name))) = lower(trim(extensions.unaccent(g.name)))
   WHERE p.active = true AND COALESCE(p.is_artisanal, false) = true
     AND COALESCE(p.color, '') <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.products bp
       LEFT JOIN public.product_groups bg ON bg.id = bp.group_id
       WHERE bp.active = true
         AND (lower(trim(extensions.unaccent(COALESCE(bg.name,'')))) = lower(trim(extensions.unaccent(ar.base_product_name)))
              OR lower(trim(extensions.unaccent(bp.name))) = lower(trim(extensions.unaccent(ar.base_product_name))))
         AND lower(trim(extensions.unaccent(COALESCE(bp.color,'')))) = lower(trim(extensions.unaccent(p.color))));

  -- ── NOVO: cor de item ATIVO sem mapeamento em "componentes por cor" ───────
  -- Ficha com component_colors_enabled = true mas SEM linha pra a cor do item:
  -- o motor cai no fallback de `direct_components`, que costuma listar TODAS as
  -- variantes de cor do mesmo ornamento — e o par consome uma de CADA.
  -- Caso real: DS22 no PV-00147 só tinha OFF WHITE mapeado; o item CAPUCCINO
  -- puxou ABS MARROM (8/par) + ABS TURQUEZA AZUL (8/par) = 16 ornamentos/par,
  -- inflando o ABS MARROM pra 4.608 (2.304 legítimos + 2.304 indevidos).
  RETURN QUERY
  SELECT 'cor_sem_mapeamento_componentes_por_cor'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(DISTINCT ts.name || ' / ' || soi.color, ' · '), '—')
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE COALESCE(ts.component_colors_enabled, false) = true
     AND COALESCE(soi.color, '') <> ''
     AND jsonb_typeof(ts.direct_components) = 'array'
     AND jsonb_array_length(ts.direct_components) > 0
     AND so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF', 'Rascunho')
     AND NOT EXISTS (
       SELECT 1 FROM public.technical_sheet_component_colors c
        WHERE c.sheet_id = ts.id
          AND lower(trim(extensions.unaccent(c.cabedal_color))) = lower(trim(extensions.unaccent(soi.color))));

  -- ── NOVO: direct_components apontando produto inexistente/inativo ─────────
  -- A linha é DESCARTADA em silêncio pelo motor (o produto não é encontrado),
  -- então o componente some do consumo, da compra e do débito sem avisar
  -- ninguém. Caso real: "Fivela Dourada 10.7mm" (product_id 645bf78e) em 5
  -- fichas ST — o produto foi deletado do cadastro e ninguém percebeu.
  RETURN QUERY
  SELECT 'direct_components_produto_inexistente'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(DISTINCT ts.name || ' / ' || COALESCE(dc->>'product_name','?'), ' · '), '—')
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
   WHERE jsonb_typeof(ts.direct_components) = 'array'
     AND (dc->>'product_id') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.id = (dc->>'product_id')::uuid AND p.active = true);

  -- ── NOVO: rótulo do JSON divergindo do cadastro atual ─────────────────────
  -- `direct_components` congela uma cópia do nome do produto. Quando o produto é
  -- renomeado, a ficha continua com o nome antigo e telas que agregam POR NOME
  -- passam a ver dois materiais onde há um. Caso real: product_id 672fcd3d está
  -- como "Binóculo SANSIN" no S-039 e "Binóculo 10mm" nas demais — no Saldo
  -- Final virava duas linhas (3.456 + 2.304).
  RETURN QUERY
  SELECT 'direct_components_nome_desatualizado'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(DISTINCT ts.name || ': "' || (dc->>'product_name') || '" ≠ "' || p.name || '"', ' · '), '—')
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
    JOIN public.products p ON p.id = (dc->>'product_id')::uuid
   WHERE jsonb_typeof(ts.direct_components) = 'array'
     AND NULLIF(trim(dc->>'product_name'), '') IS NOT NULL
     AND lower(trim(extensions.unaccent(dc->>'product_name'))) <> lower(trim(extensions.unaccent(p.name)));
END;
$function$;
