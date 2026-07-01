-- Motor Único de Consumo (by_grade)
-- =================================
-- Elimina o erro de consumo por grade unificando o cálculo em UM motor:
-- public.calculate_order_consumption_by_grade.
--
-- Problema: as rotinas de compra/corte chamavam a função ANTIGA
-- (calculate_order_consumption) passando o TAMANHO PREDOMINANTE da grade
-- (ORDER BY value DESC LIMIT 1) × total de pares — não é a grade real nem a
-- média, distorcendo a necessidade de material que varia por numeração
-- (forração da palmilha, palmilha, cabedal, forração).
--
-- Estratégia em camadas:
--   FASE 1 — corrigir os chamadores que JÁ têm a grade real
--            (compute_materials_per_pv, get_wave_material_needs,
--             fn_projected_demand) → passam a grade real do item (escalada p/ a
--             quantidade real, ver ESCALA DA GRADE abaixo) p/ by_grade.
--   FASE 2 — converter calculate_order_consumption em ADAPTADOR FINO sobre
--            by_grade (monta grade de tamanho único {size: qty} e delega).
--            Zero quebra: by_grade com {size: qty} produz EXATAMENTE
--            consumo[size] × qty — o mesmo número da função antiga, então
--            run_consumption_parity_tests continua verde.
--
-- by_grade usa o regex ^[0-9]+(/[0-9]+)?$ (suporta conjugados 33/34) tanto
-- na soma quanto no loop; a guarda de grade aplicada aos chamadores usa o
-- mesmo regex pra não derrubar a função (by_grade RAISE em grade vazia).
--
-- ⚠ ESCALA DA GRADE (crítico): em ~23% dos itens a grade gravada é uma grade
-- BASE/ratio (ex.: soma=12) enquanto soi.quantity é a quantidade REAL
-- (ex.: 1104 = 92× a base). by_grade trata os valores da grade como pares
-- ABSOLUTOS — passar soi.grade cru sub-contaria o material pelo multiplicador
-- (catástrofe de compra). Por isso os chamadores escalam a grade p/ a
-- quantidade real via public.scale_grade_to_total(soi.grade, soi.quantity)
-- (mesma convenção já usada no débito — migration
-- 20260703140000_audit-c1-scale-grade-to-quantity). O helper é IDEMPOTENTE:
-- quando soma(grade) >= quantity (os outros ~77% dos itens, grade já absoluta)
-- devolve a grade intacta. Distribuição largest-remainder preserva o total.

-- ============================================================================
-- FASE 1.1 — compute_materials_per_pv (necessidade de material do PV / compra)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean, grade jsonb, color_mismatch boolean)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    -- item_grade fica cru (soi.grade): a distribuição de solado (solado_grade
    -- CTE) usa razões kv.value/total, invariantes à escala. Já a chamada de
    -- consumo escala p/ a quantidade real (ver cabeçalho).
    SELECT soi.grade AS item_grade,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, '')
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

-- ============================================================================
-- FASE 1.2 — get_wave_material_needs (necessidade da onda / compra+corte)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
 RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  items_with_cons AS (
    SELECT COALESCE(public.filter_caixa_by_packaging_mode(
      public.calculate_order_consumption_by_grade(
        soi.reference_id,
        public.scale_grade_to_total(soi.grade, soi.quantity),
        COALESCE(soi.color, '')
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
           (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    -- Tiras: invisíveis ao calculate_order_consumption (moram em strap_colors).
    -- unit='m' garante que entram no ramo NÃO-dm² do needed (sem dividir por dm2_per_unit).
    SELECT sn.product_id,
           COALESCE(sn.color, '') AS effective_color,
           sn.required_m AS required,
           'm'::text AS unit
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
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL), 0) AS needed_qty
    FROM all_exploded
    GROUP BY product_id, effective_color
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
     WHERE n.needed_qty > 0
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
         CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL
              THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date
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

-- ============================================================================
-- FASE 1.3 — fn_projected_demand (demanda projetada)
-- Tem acesso à grade real (itera sale_order_items) → migra p/ by_grade com a
-- grade real, mesma guarda de grade dos demais chamadores.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
 RETURNS TABLE(product_id uuid, product_name text, total_required numeric, earliest_deadline date, orders_count integer, order_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- MOTOR ÚNICO: usa a grade real do item (soi.grade) via
  -- calculate_order_consumption_by_grade, somando o consumo de cada numeração
  -- × pares daquela numeração (não mais o tamanho predominante × total).
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline, soi.id AS sale_order_item_id,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, '')
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
  ),
  exploded AS (
    SELECT sale_order_id, delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name') AS product_name,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0)
      / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(e.product_id) conv LIMIT 1), 1), 1)
    + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$function$;

-- ============================================================================
-- FASE 2 — calculate_order_consumption vira ADAPTADOR FINO sobre by_grade.
-- Assinatura idêntica (mesma ordem/tipos/defaults) → não cria sobrecarga nem
-- quebra os chamadores legados (calculate_order_cost_item, freeze_technical_sheet,
-- hybrid_debit_stock_for_order). by_grade com {size: qty} produz exatamente
-- consumo[size] × qty — o mesmo número da lógica antiga.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calculate_order_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_size integer DEFAULT NULL::integer,
  p_material_variant_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_size  integer;
  v_grade jsonb;
BEGIN
  -- MOTOR ÚNICO: esta função é apenas um adaptador sobre
  -- calculate_order_consumption_by_grade. Constrói uma grade de tamanho
  -- único {tamanho: quantidade} e delega. Onde existe grade real
  -- (compra/corte), chame by_grade diretamente — ver compute_materials_per_pv
  -- e get_wave_material_needs.
  IF p_order_quantity IS NULL OR p_order_quantity <= 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_size := COALESCE(
    p_size,
    (SELECT reference_size FROM technical_sheets WHERE id = p_reference_id),
    37
  );

  v_grade := jsonb_build_object(v_size::text, p_order_quantity);

  RETURN public.calculate_order_consumption_by_grade(
    p_reference_id, v_grade, p_color, p_material_variant_id
  );
END;
$function$;

-- ============================================================================
-- Atualiza run_consumption_parity_tests para o contrato MOTOR ÚNICO.
--
-- As duas asserções "escalar_*" antigas verificavam, por inspeção de TEXTO, que
-- a função escalar (calculate_order_consumption) tinha a SUA PRÓPRIA cópia da
-- lógica de palmilha pronta unificada e da conversão dm²→unidade. Esse
-- contrato fazia sentido enquanto havia DOIS motores duplicados. Agora a
-- escalar é um ADAPTADOR FINO que delega 100% ao by_grade — a lógica mora num
-- só lugar. O contrato correto, e mais forte, passa a ser: "a escalar delega
-- ao by_grade" (logo herda palmilha pronta + conversão + fachete por
-- construção). Os testes de integração (CASO 6, caminho da escalar) provam a
-- equivalência numérica. As asserções do by_grade continuam idênticas.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.run_consumption_parity_tests()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scalar   text;
  v_bygrade  text;
BEGIN
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_scalar
    FROM pg_proc WHERE proname = 'calculate_order_consumption' AND pronamespace = 'public'::regnamespace;
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_bygrade
    FROM pg_proc WHERE proname = 'calculate_order_consumption_by_grade' AND pronamespace = 'public'::regnamespace;

  case_name := 'escalar_existe';  ok := v_scalar IS NOT NULL;  message := COALESCE(left(v_scalar,0),'ausente'); RETURN NEXT;
  case_name := 'bygrade_existe';  ok := v_bygrade IS NOT NULL; message := COALESCE(left(v_bygrade,0),'ausente'); RETURN NEXT;

  -- MOTOR ÚNICO: a escalar é um adaptador fino que DELEGA ao by_grade, herdando
  -- por construção a unificação de palmilha pronta, a conversão dm²→unidade e o
  -- fachete. Verificar a delegação, não uma cópia inline da lógica.
  case_name := 'escalar_delega_ao_bygrade';
  ok := v_scalar ILIKE '%calculate_order_consumption_by_grade%';
  message := 'escalar deve delegar ao motor único calculate_order_consumption_by_grade'; RETURN NEXT;

  case_name := 'escalar_sem_insole_mode_legado';
  ok := v_scalar NOT ILIKE '%insole_mode%';
  message := 'escalar não deve usar o campo legado insole_mode'; RETURN NEXT;

  -- MOTOR ÚNICO: guarda contra regressão — a escalar NÃO pode reintroduzir a sua
  -- própria cópia da conversão dm²→unidade; ela deve herdar do by_grade via
  -- delegação. Lógica de conversão duplicada na escalar = volta da duplicação.
  case_name := 'escalar_nao_duplica_conversao';
  ok := v_scalar NOT ILIKE '%get_material_conversion_info%';
  message := 'escalar não deve duplicar a conversão (deve herdar do by_grade)'; RETURN NEXT;

  case_name := 'bygrade_palmilha_pronta_unificada';
  ok := v_bygrade ILIKE '%insole_ready_made%' AND v_bygrade ILIKE '%palmilha_pronta%';
  message := 'by_grade deve checar insole_ready_made + sole_classification'; RETURN NEXT;

  case_name := 'bygrade_sem_insole_mode_legado';
  ok := v_bygrade NOT ILIKE '%insole_mode%';
  message := 'by_grade não deve usar o campo legado insole_mode'; RETURN NEXT;

  case_name := 'bygrade_aplica_conversao';
  ok := v_bygrade ILIKE '%get_material_conversion_info%';
  message := 'by_grade deve converter dm²→unidade via get_material_conversion_info'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';
  ok := v_bygrade ILIKE '%fachete%';
  message := 'by_grade deve incluir o componente Fachete'; RETURN NEXT;
END;
$function$;
