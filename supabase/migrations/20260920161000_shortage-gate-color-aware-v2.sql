-- ════════════════════════════════════════════════════════════════════════════
-- Shortage gate color-aware — v2 (SEM recursão)
--
-- INCIDENTE (v1 = 20260920160000, REVERTIDA em produção):
--   get_wave_material_needs(uuid[]) chama compute_wave_timeline(p_sale_order_ids)
--   na PRIMEIRA instrução (pega corte_palmilha_start_date pro os_send_date dos
--   itens artesanais). A v1 fez o gate de lead de fornecedor de
--   compute_wave_timeline e compute_min_billing_date chamar get_wave_material_needs
--   → recursão mútua infinita (SQLSTATE 54001, stack depth exceeded) em toda
--   consulta de timeline/prazo. Produção foi restaurada reaplicando as definições
--   da 20260920121000 (ver no-op 20260920160001).
--
-- OBJETIVO (mantido da v1): o gate de fornecedor deve derivar do motor CANÔNICO
--   de necessidades — que resolve cor/variante/grade/tiras, converte dm²→unidade
--   física e devolve as reservas dos próprios PVs (F3-3/F3-10) — em vez da soma
--   crua de sheet_materials, que gerava falso-positivo POR COR (estoque na cor
--   errada contava como cobertura e omitia o lead do fornecedor).
--
-- DESENHO v2 (quebra o ciclo por construção):
--   1. get_wave_material_needs_core(p_sale_order_ids, p_corte_start)
--      = corpo vivo de get_wave_material_needs SEM a chamada a
--      compute_wave_timeline; o corte start vem por PARÂMETRO. Com
--      p_corte_start NULL, os_send_date sai NULL — exatamente a semântica que a
--      função viva já tinha quando a timeline não retornava linha.
--      A _core NÃO referencia compute_wave_timeline, compute_min_billing_date
--      nem get_wave_material_needs — é folha no grafo de chamadas.
--   2. get_wave_material_needs vira wrapper fino: computa o corte start via
--      compute_wave_timeline (como hoje) e delega à _core. Contrato público
--      (colunas/tipos) INALTERADO.
--   3. compute_wave_timeline / compute_min_billing_date: corpo EXATO da
--      definição viva (pg_get_functiondef de 2026-07-22, estado pós-rollback =
--      20260920121000), trocando SOMENTE o bloco INTO v_lead_supplier pra
--      chamar a _CORE (com corte NULL) — nunca o wrapper.
--
--   Grafo resultante (acíclico):
--     get_wave_material_needs ──► compute_wave_timeline ──► _core
--                              └─► _core                    (folha)
--     compute_min_billing_date ──► _core
--
-- Idempotente (só CREATE OR REPLACE + grants).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1) CORE: motor de necessidades SEM dependência de timeline.
--    Corpo = get_wave_material_needs viva, com a chamada a compute_wave_timeline
--    removida e v_corte_start substituído pelo parâmetro p_corte_start.
--    Atributos espelhados da original: LANGUAGE plpgsql, STABLE, SECURITY
--    INVOKER (default), SET search_path TO 'public','extensions' (unaccent),
--    #variable_conflict use_column (colunas do RETURNS TABLE colidem com
--    colunas das CTEs).
-- ────────────────────────────────────────────────────────────────────────────
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
        soi.material_variant_id              -- achado (i): variante do PV
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
           (line ->> 'conversion_warning') AS conversion_warning
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id,
           COALESCE(sn.color, '') AS effective_color,
           sn.required_m AS required,
           'm'::text AS unit,
           NULL::text AS conversion_warning
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
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
    SELECT product_id, effective_color,
      -- Achado (f): linhas com conversion_warning NÃO entram na qty comprável
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL AND conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL AND conversion_warning IS NULL), 0) AS needed_qty,
      MAX(conversion_warning) AS conversion_warning
    FROM all_exploded
    GROUP BY product_id, effective_color
  ),
  -- F3-3 (achado (g) do compute_materials_per_pv): reservas ATIVAS dos PRÓPRIOS
  -- PVs consultados voltam pro estoque disponível — a demanda aqui é BRUTA
  -- (consumo total dos PVs), então netar contra estoque já descontado das
  -- reservas DESSES MESMOS PVs inflava o shortage (mandava recomprar o que o
  -- próprio pedido já reservou).
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
           n.effective_color AS color, n.needed_qty,
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
     -- Achado (f): linha 100% warned (needed 0) continua visível pra propagar o aviso
     WHERE n.needed_qty > 0 OR n.conversion_warning IS NOT NULL
  ),
  -- F3-10: o MESMO estoque não pode ser netado 2× por linhas irmãs (mesmo
  -- product_id em cores/aplicações diferentes) — rateia o disponível
  -- proporcional à necessidade de cada linha (Σ shortage das irmãs ==
  -- shortage real do produto). Linha única fica idêntica ao comportamento antigo.
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
         e.conversion_warning
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2) WRAPPER público: contrato (nome/colunas/tipos) INALTERADO.
--    Único ponto que junta timeline + core (chama cada um exatamente 1 vez).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
 RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date, conversion_warning text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  SELECT * FROM public.get_wave_material_needs_core(p_sale_order_ids, v_corte_start);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) compute_wave_timeline: corpo EXATO da definição VIVA (pós-rollback =
--    20260920121000); diff = SOMENTE o bloco INTO v_lead_supplier, que agora
--    deriva da _CORE em vez da soma crua de sheet_materials.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
 RETURNS TABLE(earliest_deadline date, corte_palmilha_start_date date, corte_forracao_start_date date, costura_start_date date, mesa_start_date date, silk_start_date date, colagem_start_date date, montagem_start_date date, solagem_start_date date, acabamento_start_date date, acabamento_end_date date, pickup_tuesday_date date, pickup_friday_date date, material_ready_date date, purchase_deadline date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int; v_lead_forracao int; v_lead_costura int; v_lead_mesa int;
  v_lead_silk int; v_lead_colagem int; v_lead_montagem int; v_lead_solagem int;
  v_lead_acab int; v_lead_buffer int; v_lead_supplier int;
  v_deadline date; v_lead_prep_max int; v_post_prep int;
  v_seq_start date; v_earliest_prep date; v_acab_start date; v_acab_end date;
  v_pickup_tue date; v_pickup_fri date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 1),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  -- F3-5 v2: gate de fornecedor derivado do motor CANÔNICO de necessidades
  -- (get_wave_material_needs_core), que resolve cor/variante/grade/tiras,
  -- converte dm²→unidade física e devolve reservas dos próprios PVs — fecha o
  -- falso-positivo POR COR da soma crua de sheet_materials (estoque do produto
  -- na cor ERRADA contava como cobertura e omitia o lead do fornecedor).
  -- ⚠ Chamar a _CORE (p_corte_start NULL — os_send_date é irrelevante pro
  -- gate), NUNCA get_wave_material_needs: a v1 (mig 20260920160000, revertida)
  -- chamava o wrapper, que chama compute_wave_timeline na 1ª instrução →
  -- recursão mútua infinita (54001) em produção.
  -- conversion_warning (largura faltando) não aciona o lead (valor cru em dm²
  -- é ~100× o físico → shortage falso). Item ARTESANAL aciona pelo shortage do
  -- produto BASE (napa) — a tira final é produzida internamente.
  SELECT COALESCE(MAX(CASE
           WHEN n.conversion_warning IS NOT NULL THEN 0
           WHEN COALESCE(n.is_artisanal, false) THEN
             CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                  THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
           WHEN COALESCE(n.shortage, 0) > 0
             THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
           ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM public.get_wave_material_needs_core(p_sale_order_ids, NULL) n;
  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura);
  v_seq_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_earliest_prep := add_business_days(v_seq_start, -v_lead_prep_max)::date;
  v_acab_start := add_business_days(v_deadline, -v_lead_acab)::date;
  v_acab_end := v_deadline;
  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2);
  IF v_pickup_tue >= v_pickup_fri THEN v_pickup_tue := v_pickup_fri - 3; END IF;
  RETURN QUERY SELECT v_deadline,
    add_business_days(v_seq_start, -v_lead_palmilha)::date,
    add_business_days(v_seq_start, -v_lead_forracao)::date,
    add_business_days(v_seq_start, -v_lead_costura)::date,
    add_business_days(v_seq_start, -v_lead_mesa)::date,
    v_seq_start,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem))::date,
    v_acab_start, v_acab_end, v_pickup_tue, v_pickup_fri,
    add_business_days(v_earliest_prep, -v_lead_buffer)::date,
    add_business_days(v_earliest_prep, -(v_lead_buffer + v_lead_supplier))::date;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) compute_min_billing_date: corpo EXATO da definição VIVA (pós-rollback =
--    20260920121000); diff = SOMENTE o bloco INTO v_lead_supplier (mesmo gate
--    canônico, com ARRAY[p_sale_order_id]).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int := 0; v_lead_forracao int := 0; v_lead_costura int := 0; v_lead_mesa int := 0;
  v_lead_silk int := 0; v_lead_colagem int := 0; v_lead_montagem int := 0; v_lead_solagem int := 0;
  v_lead_acab int := 0; v_lead_buffer int := 0; v_lead_supplier int := 0;
  v_total_business_days int := 0; v_raw_date date; v_next_tue date; v_next_fri date;
BEGIN
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = p_sale_order_id;
  IF v_lead_palmilha IS NULL THEN RETURN NULL; END IF;
  -- F3-5 v2: mesmo gate canônico do compute_wave_timeline — derivado da
  -- get_wave_material_needs_core (cor/variante/grade/dm²→física/reservas
  -- próprias), fechando o falso-positivo POR COR da soma crua de
  -- sheet_materials. ⚠ Chamar a _CORE, NUNCA get_wave_material_needs (o
  -- wrapper chama compute_wave_timeline → recursão mútua 54001 — incidente da
  -- v1/20260920160000, revertida). conversion_warning não aciona o lead;
  -- artesanal aciona pelo produto BASE.
  SELECT COALESCE(MAX(CASE
           WHEN n.conversion_warning IS NOT NULL THEN 0
           WHEN COALESCE(n.is_artisanal, false) THEN
             CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                  THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
           WHEN COALESCE(n.shortage, 0) > 0
             THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
           ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM public.get_wave_material_needs_core(ARRAY[p_sale_order_id], NULL) n;
  v_total_business_days := COALESCE(v_lead_supplier, 0) + COALESCE(v_lead_buffer, 2)
    + GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura)
    + COALESCE(v_lead_silk, 0) + COALESCE(v_lead_colagem, 0)
    + COALESCE(v_lead_montagem, 2) + COALESCE(v_lead_solagem, 0) + COALESCE(v_lead_acab, 1);
  v_raw_date := public.add_business_days(CURRENT_DATE, v_total_business_days)::date;
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) GRANTs da _core: espelha o ACL vivo de get_wave_material_needs
--    ({postgres, authenticated, service_role} — SEM anon, lockdown P0).
--    O REVOKE de PUBLIC/anon é necessário porque os default privileges do
--    Supabase concedem EXECUTE a anon em função nova.
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_wave_material_needs_core(uuid[], date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wave_material_needs_core(uuid[], date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wave_material_needs_core(uuid[], date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wave_material_needs_core(uuid[], date) TO service_role;
