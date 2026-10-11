-- tira_virada_ajustes_20270101037150
--
-- Ajustes ADITIVOS antes da virada de specs/tira-material-de-estoque.md, saídos da
-- revisão (planejamento do front + crítico, 11/10/2026). Nada aqui é chamado pelo
-- fluxo atual até a virada (20270101037200), exceto o que já é do modelo novo.
--
--   1. Strass (grupo sem napa) é sempre "Comprar pronto": Fábrica e Prestador
--      consomem napa. Regra no writer v2 e CHECK no grupo.
--   2. list_strap_setup_pendencias ganha "grupo de tira sem origem" (fonte única).
--   3. ensure_strap_sku: cria/acha o SKU de tira pela chave à mão (janela do grupo),
--      ex.: para dar entrada de estoque antes de qualquer PV.
--   4. strap_needs_batch: metros de tira de vários itens/OPs numa chamada — o front
--      nunca recalcula a fórmula (fonte única).
--   5. Metros/pares por numeração e as linhas de tira do relatório de consumo
--      (usadas pela virada em calculate_consumption_report_batch).
--   6. Ateliê: "Gerar OC da napa" também para Fábrica (a spec não dizia como a
--      fábrica compra napa para produzir) + coluna "napa em compra" na lista.

-- ── 1. Strass só Comprar pronto ─────────────────────────────────────────────
UPDATE public.product_groups
   SET strap_origin = 'comprar_pronto'
 WHERE coalesce(is_artisanal_strap, false)
   AND NOT coalesce(strap_uses_napa, true)
   AND strap_origin IS DISTINCT FROM 'comprar_pronto';

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_groups_strap_no_napa_buy_ready_check') THEN
    ALTER TABLE public.product_groups
      ADD CONSTRAINT product_groups_strap_no_napa_buy_ready_check
      CHECK (coalesce(strap_uses_napa, true) OR strap_origin IS NULL OR strap_origin = 'comprar_pronto');
  END IF;
END
$chk$;

DO $patch_v2$
DECLARE
  v_def text := pg_get_functiondef('private.prepare_sale_order_item_straps_v2(jsonb,boolean)'::regprocedure);
  v_old text := $old$      v_origin := coalesce(v_explicit_origin, v_group.strap_origin, 'comprar_pronto');$old$;
  v_new text := $new$      -- tira_virada_ajustes_20270101037150: sem napa (strass) é sempre Comprar pronto.
      v_origin := CASE
        WHEN NOT coalesce(v_group.strap_uses_napa, true) THEN 'comprar_pronto'
        ELSE coalesce(v_explicit_origin, v_group.strap_origin, 'comprar_pronto')
      END;$new$;
  v_hits integer;
BEGIN
  IF position('tira_virada_ajustes_20270101037150' IN v_def) > 0 THEN RETURN; END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'prepare_sale_order_item_straps_v2: âncora de origem não encontrada (hits=%)', v_hits;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_v2$;

-- ── 2. Pendências de cadastro de tira (fonte única) ─────────────────────────
DROP FUNCTION IF EXISTS public.list_strap_setup_pendencias();
CREATE FUNCTION public.list_strap_setup_pendencias()
 RETURNS TABLE(kind text, sheet_id uuid, sheet_label text, line_label text, group_id uuid, message text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT x.kind, x.sheet_id, x.sheet_label, x.line_label, x.group_id, x.message
    FROM (
      SELECT 'ficha_sem_grupo'::text AS kind,
             ts.id AS sheet_id,
             coalesce(nullif(ts.code, ''), nullif(ts.name, ''), ts.id::text) AS sheet_label,
             coalesce(nullif(l.value ->> 'label', ''), 'TIRA ' || l.ord) AS line_label,
             NULL::uuid AS group_id,
             'A linha de tira não diz qual tira (grupo de estoque) usar — edite a ficha e escolha o grupo.'::text AS message
        FROM public.technical_sheets ts
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END
        ) WITH ORDINALITY l(value, ord)
       WHERE ts.retired_at IS NULL
         AND coalesce(l.value ->> 'group_id', '') !~* '^[0-9a-f-]{36}$'
         AND coalesce(l.value ->> 'identity_group_id', '') !~* '^[0-9a-f-]{36}$'
      UNION ALL
      SELECT 'grupo_sem_origem',
             NULL::uuid,
             g.name,
             ''::text,
             g.id,
             'Grupo de tira sem origem — defina Comprar pronto, Fábrica ou Prestador na janela do grupo (Estoque → Grupos). Até lá a falta vai para a compra.'
        FROM public.product_groups g
       WHERE coalesce(g.is_artisanal_strap, false)
         AND g.strap_origin IS NULL
    ) x
   WHERE public.is_approved_user()
   ORDER BY x.kind, x.sheet_label, x.line_label;
$function$;

REVOKE ALL ON FUNCTION public.list_strap_setup_pendencias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_strap_setup_pendencias() TO authenticated;

-- ── 3. SKU de tira à mão ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_strap_sku(
  p_group_id uuid,
  p_napa_group_id uuid,
  p_color_id uuid
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial', 'almoxarifado']) THEN
    RAISE EXCEPTION 'Somente Gerência/Comercial/Almoxarifado cadastra cor de tira'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = p_group_id AND coalesce(g.is_artisanal_strap, false)
  ) THEN
    RAISE EXCEPTION 'O grupo informado não é um grupo de tira';
  END IF;
  IF p_color_id IS NULL THEN
    RAISE EXCEPTION 'Escolha a cor da tira';
  END IF;
  IF p_napa_group_id IS NULL AND EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = p_group_id AND coalesce(g.strap_uses_napa, true)
  ) THEN
    RAISE EXCEPTION 'Escolha a napa da tira — este grupo é feito de napa';
  END IF;
  RETURN private.resolve_strap_sku(p_group_id, p_napa_group_id, p_color_id, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_strap_sku(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_strap_sku(uuid, uuid, uuid) TO authenticated;

-- ── 4. Necessidade de tira em lote ──────────────────────────────────────────
-- p_requests: [{"key": "<livre>", "sale_order_item_id": uuid, "grade"?: {...}, "quantity"?: n}]
-- grade/quantity nulos = o item inteiro; preenchidos = a parte de uma OP.
CREATE OR REPLACE FUNCTION public.strap_needs_batch(p_requests jsonb)
 RETURNS TABLE(
   request_key text,
   sale_order_item_id uuid,
   technical_strap_line_id uuid,
   label text,
   product_id uuid,
   product_name text,
   required_m numeric,
   origin text,
   group_id uuid,
   base_group_id uuid,
   color_id uuid
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT r.value ->> 'key',
         public.try_parse_uuid(r.value ->> 'sale_order_item_id'),
         n.technical_strap_line_id, n.label, n.product_id, n.product_name,
         n.required_m, n.origin, n.group_id, n.base_group_id, n.color_id
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_requests) = 'array' THEN p_requests ELSE '[]'::jsonb END
    ) r(value)
    CROSS JOIN LATERAL public.sale_order_item_strap_needs(
      public.try_parse_uuid(r.value ->> 'sale_order_item_id'),
      CASE WHEN jsonb_typeof(r.value -> 'grade') = 'object' THEN r.value -> 'grade' END,
      CASE WHEN coalesce(r.value ->> 'quantity', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
           THEN (r.value ->> 'quantity')::numeric END
    ) n
   WHERE public.is_approved_user();
$function$;

REVOKE ALL ON FUNCTION public.strap_needs_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strap_needs_batch(jsonb) TO authenticated;

-- ── 5. Metros/pares por numeração e linhas do relatório de consumo ─────────
-- Mesma regra de private.strap_line_required_m, mas por numeração:
-- {"pairs": {tam: pares do escopo}, "meters": {tam: metros}}. Sem consumo por
-- numeração ou sem grade → objetos vazios.
CREATE OR REPLACE FUNCTION private.strap_line_size_breakdown(
  p_line jsonb,
  p_grade jsonb,
  p_quantity numeric
) RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_per_size jsonb := p_line -> 'consumption_per_size';
  v_default numeric := 0;
  v_grade_total numeric := 0;
  v_pairs jsonb := '{}'::jsonb;
  v_meters jsonb := '{}'::jsonb;
  v_size text;
  v_qty numeric;
  v_factor numeric;
  v_cm numeric;
BEGIN
  IF coalesce(p_quantity, 0) <= 0
     OR jsonb_typeof(p_grade) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_per_size) IS DISTINCT FROM 'object'
     OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_per_size)) THEN
    RETURN jsonb_build_object('pairs', '{}'::jsonb, 'meters', '{}'::jsonb);
  END IF;
  IF coalesce(p_line ->> 'consumption', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN
    v_default := greatest((p_line ->> 'consumption')::numeric, 0);
  END IF;
  SELECT coalesce(sum(g.value::numeric), 0) INTO v_grade_total
    FROM jsonb_each_text(p_grade) g
   WHERE left(g.key, 1) <> '_'
     AND g.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
     AND g.value::numeric > 0;
  IF v_grade_total <= 0 THEN
    RETURN jsonb_build_object('pairs', '{}'::jsonb, 'meters', '{}'::jsonb);
  END IF;
  v_factor := p_quantity / v_grade_total;
  FOR v_size, v_qty IN
    SELECT g.key, g.value::numeric
      FROM jsonb_each_text(p_grade) g
     WHERE left(g.key, 1) <> '_'
       AND g.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
       AND g.value::numeric > 0
  LOOP
    v_cm := coalesce(public.pick_consumption_for_size(v_per_size, v_size), v_default);
    v_pairs := v_pairs || jsonb_build_object(v_size, round(v_qty * v_factor, 4));
    v_meters := v_meters || jsonb_build_object(v_size, round(v_qty * v_factor * v_cm / 100, 4));
  END LOOP;
  RETURN jsonb_build_object('pairs', v_pairs, 'meters', v_meters);
END;
$function$;

REVOKE ALL ON FUNCTION private.strap_line_size_breakdown(jsonb, jsonb, numeric) FROM PUBLIC;

-- Linhas de tira de um escopo do relatório de consumo (item do PV ou OP), no
-- formato das linhas de material: SKU, metros do escopo, físico, origem, napa.
-- Item antigo (sem SKU no snapshot) vira linha visível "sem SKU", nunca some.
CREATE OR REPLACE FUNCTION private.consumption_report_strap_lines(
  p_scope_key uuid,
  p_scope_type text,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_reference_id uuid,
  p_quantity numeric,
  p_grade jsonb
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_line jsonb;
  v_lid text;
  v_src jsonb;
  v_pid uuid;
  v_prod record;
  v_required numeric;
  v_breakdown jsonb;
  v_grade jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_item FROM public.sale_order_items i WHERE i.id = p_sale_order_item_id;
  IF NOT FOUND OR jsonb_typeof(v_item.strap_colors) IS DISTINCT FROM 'array' THEN
    RETURN '[]'::jsonb;
  END IF;
  v_grade := CASE WHEN jsonb_typeof(p_grade) = 'object' AND p_grade <> '{}'::jsonb
                  THEN p_grade ELSE v_item.grade END;
  FOR v_line IN SELECT l.value FROM jsonb_array_elements(v_item.strap_colors) l(value)
  LOOP
    v_lid := coalesce(nullif(v_line ->> 'technical_strap_line_id', ''), v_line ->> 'id');
    v_src := coalesce(v_item.strap_sourcing, '{}'::jsonb) -> v_lid;
    v_pid := public.try_parse_uuid(v_src ->> 'product_id');
    v_required := private.strap_line_required_m(v_line, v_grade, coalesce(p_quantity, v_item.quantity::numeric));
    IF coalesce(v_required, 0) <= 0 THEN
      CONTINUE;
    END IF;
    v_breakdown := private.strap_line_size_breakdown(v_line, v_grade, coalesce(p_quantity, v_item.quantity::numeric));
    v_prod := NULL;
    IF v_pid IS NOT NULL THEN
      SELECT p.id, p.name, p.unit, p.category, p.color, p.group_id, g.name AS group_name,
             coalesce(p.quantity, 0) AS quantity, coalesce(p.unit_price, 0) AS unit_price
        INTO v_prod
        FROM public.products p
        LEFT JOIN public.product_groups g ON g.id = p.group_id
       WHERE p.id = v_pid;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'scope_key', p_scope_key,
      'scope_type', p_scope_type,
      'sale_order_id', p_sale_order_id,
      'sale_order_item_id', p_sale_order_item_id,
      'reference_id', p_reference_id,
      'quantity', p_quantity,
      'effective_grade', v_grade,
      'line_kind', 'material',
      'component', 'Tiras',
      'product_id', v_prod.id,
      'product_name', coalesce(v_prod.name, v_src ->> 'product_name',
                               coalesce(nullif(v_line ->> 'group_name', ''), 'Tira') || ' — sem SKU (pedido anterior à virada)'),
      'product_unit', coalesce(v_prod.unit, 'm'),
      'product_category', v_prod.category,
      'product_color', v_prod.color,
      'product_group_id', coalesce(v_prod.group_id, public.try_parse_uuid(v_line ->> 'group_id')),
      'product_group_name', coalesce(v_prod.group_name, v_line ->> 'group_name'),
      'color', coalesce(nullif(v_line ->> 'color', ''), v_prod.color, '—'),
      'required', v_required,
      'consumption_per_unit', round(v_required / nullif(coalesce(p_quantity, v_item.quantity::numeric), 0), 6),
      'available', coalesce(v_prod.quantity, 0),
      'stock_ok', coalesce(v_prod.quantity, 0) >= v_required,
      'unit_price', coalesce(v_prod.unit_price, 0),
      'source', CASE WHEN v_prod.id IS NULL THEN 'unresolved' ELSE 'strap' END,
      'matched_by', 'strap_sku',
      'debit_mode', 'soft',
      'technical_strap_line_id', public.try_parse_uuid(v_lid),
      'strap_label', coalesce(nullif(v_line ->> 'label', ''), 'TIRA'),
      'strap_origin', coalesce(nullif(v_src ->> 'origin', ''), 'comprar_pronto'),
      'strap_napa_name', nullif(coalesce(v_src ->> 'base_group_name', v_line ->> 'base_group_name'), ''),
      'strap_sku_match', v_src ->> 'sku_match',
      'strap_pairs_by_size', v_breakdown -> 'pairs',
      'strap_meters_by_size', v_breakdown -> 'meters',
      'consumption_warning', CASE WHEN v_prod.id IS NULL
        THEN 'Tira sem SKU de estoque no snapshot (pedido anterior à virada) — salve o item pelo PV para resolver.'
      END
    ));
  END LOOP;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION private.consumption_report_strap_lines(uuid, text, uuid, uuid, uuid, numeric, jsonb) FROM PUBLIC;

-- ── 6. Ateliê: OC da napa para Fábrica + "napa em compra" ──────────────────
CREATE OR REPLACE FUNCTION public.generate_atelier_strap_napa_purchase(
  p_sale_order_id uuid,
  p_product_id uuid,
  p_strap_m numeric,
  p_napa_product_id uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_strap public.products%ROWTYPE;
  v_group public.product_groups%ROWTYPE;
  v_napa public.products%ROWTYPE;
  v_napa_group uuid;
  v_yield numeric;
  v_napa_m numeric;
  v_price numeric;
  v_supplier_id uuid;
  v_supplier_name text;
  v_order_number text;
  v_po jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Gerar OC exige Administração ou Gerência' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_strap_m, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe os metros de tira a produzir';
  END IF;
  SELECT * INTO v_strap FROM public.products WHERE id = p_product_id;
  SELECT * INTO v_group FROM public.product_groups WHERE id = v_strap.group_id;
  IF v_strap.id IS NULL OR NOT coalesce(v_group.is_artisanal_strap, false) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  SELECT so.order_number INTO v_order_number FROM public.sale_orders so WHERE so.id = p_sale_order_id;
  v_napa_group := private.strap_product_napa_group(p_product_id, p_sale_order_id);
  IF v_napa_group IS NULL THEN
    RAISE EXCEPTION 'Não sei de que napa é a tira % — confira a napa da tira no PV', v_strap.name;
  END IF;
  SELECT y.yield_m_per_m INTO v_yield
    FROM public.strap_group_napa_yields y
   WHERE y.strap_group_id = v_group.id AND y.napa_group_id = v_napa_group;
  IF v_yield IS NULL THEN
    RAISE EXCEPTION 'Informe o rendimento de % na napa antes de gerar a OC', v_group.name;
  END IF;
  SELECT * INTO v_napa FROM public.products
   WHERE id = coalesce(p_napa_product_id, private.strap_napa_product_for(p_product_id, v_napa_group));
  IF v_napa.id IS NULL THEN
    RAISE EXCEPTION 'Não há napa da cor % no estoque para a tira %', v_strap.color, v_strap.name;
  END IF;
  v_supplier_id := coalesce(v_napa.supplier_id, v_napa.preferred_supplier_id);
  SELECT s.name INTO v_supplier_name FROM public.suppliers s WHERE s.id = v_supplier_id;
  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'A napa % não tem fornecedor cadastrado', v_napa.name;
  END IF;
  v_price := coalesce(nullif(v_napa.purchase_price, 0), nullif(v_napa.unit_price, 0));
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'A napa % não tem preço de compra cadastrado', v_napa.name;
  END IF;
  v_napa_m := ceil(p_strap_m / v_yield * 100) / 100;
  v_po := public.execute_purchase_order_command(
    'create',
    jsonb_build_object(
      'header', jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', v_supplier_name,
        'status', 'pending',
        'source_type', 'manual',
        'linked_sale_order_ids', CASE WHEN p_sale_order_id IS NULL THEN '[]'::jsonb
                                      ELSE jsonb_build_array(p_sale_order_id) END,
        'source_pv_ids', CASE WHEN p_sale_order_id IS NULL THEN '[]'::jsonb
                              ELSE jsonb_build_array(p_sale_order_id) END,
        'notes', 'Napa para produzir ' || round(p_strap_m, 2) || ' m de ' || v_strap.name
                 || coalesce(' (' || v_order_number || ')', '') || ' na fábrica (Ateliê → Tiras).'
      ),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_napa.id,
        'quantity', v_napa_m,
        'unit', v_napa.unit,
        'unit_price', v_price,
        'color', v_napa.color
      ))
    ),
    gen_random_uuid()
  );
  RETURN jsonb_build_object(
    'ok', true,
    'purchase_order_id', v_po ->> 'purchase_order_id',
    'purchase_order_number', v_po -> 'purchase_order' ->> 'order_number',
    'napa', v_napa.name,
    'napa_m', v_napa_m
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_atelier_strap_napa_purchase(uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_atelier_strap_napa_purchase(uuid, uuid, numeric, uuid) TO authenticated;

-- Lista da aba Tiras + napa em compra (OCs abertas da napa, qualquer origem).
DROP FUNCTION IF EXISTS public.list_atelier_strap_shortages();
CREATE FUNCTION public.list_atelier_strap_shortages()
 RETURNS TABLE(
   sale_order_id uuid, order_number text, client_name text,
   product_id uuid, product_name text, group_id uuid, group_name text,
   origin text, color text, napa_group_id uuid, napa_group_name text,
   needed_m numeric, reserved_m numeric, shortage_m numeric, in_progress_m numeric, to_produce_m numeric,
   yield_m_per_m numeric, labor_cost_per_m numeric, default_contractor_id uuid, default_contractor_name text,
   napa_product_id uuid, napa_product_name text, napa_stock_m numeric, napa_unit_price numeric, napa_supplier_name text,
   napa_in_purchase_m numeric
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- tira_virada_ajustes_20270101037150
  WITH res AS (
    SELECT coalesce(mr.sale_order_id, o.sale_order_id) AS sale_order_id,
           mr.product_id,
           sum(greatest(coalesce(mr.quantity_reserved, 0) - coalesce(mr.quantity_consumed, 0), 0)) AS reserved_m,
           sum(coalesce(mr.quantity_short, 0)) AS shortage_m
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
      JOIN public.product_groups g ON g.id = p.group_id AND coalesce(g.is_artisanal_strap, false)
     WHERE mr.status IN ('reserved', 'partially_consumed')
       AND public.material_reservation_is_pv_managed(mr)
     GROUP BY 1, 2
  ), res_origin AS (
    SELECT r.*, private.sale_order_strap_product_origin(r.sale_order_id, r.product_id) AS origin
      FROM res r
  ), jobs AS (
    SELECT j.sale_order_id, j.product_id,
           sum(greatest(j.strap_m - j.received_m, 0)) AS in_progress_m
      FROM public.strap_atelier_jobs j
     WHERE j.status IN ('aberto', 'recebido_parcial')
     GROUP BY 1, 2
  ), base AS (
    SELECT r.*, coalesce(j.in_progress_m, 0) AS in_progress_m,
           private.strap_product_napa_group(r.product_id, r.sale_order_id) AS napa_group_id
      FROM res_origin r
      LEFT JOIN jobs j ON j.sale_order_id = r.sale_order_id AND j.product_id = r.product_id
     WHERE r.origin IN ('fabrica', 'prestador')
       AND (r.shortage_m > 0 OR coalesce(j.in_progress_m, 0) > 0)
  )
  SELECT b.sale_order_id, so.order_number, coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
         b.product_id, p.name, g.id, g.name, b.origin, p.color, b.napa_group_id, ng.name,
         round(b.reserved_m + b.shortage_m, 4), round(b.reserved_m, 4), round(b.shortage_m, 4),
         round(b.in_progress_m, 4), round(greatest(b.shortage_m - b.in_progress_m, 0), 4),
         y.yield_m_per_m, g.strap_labor_cost_per_m, g.strap_default_contractor_id, ct.name,
         np.id, np.name, np.quantity, coalesce(nullif(np.purchase_price, 0), np.unit_price), sup.name,
         coalesce((
           SELECT round(sum(greatest(poi.quantity - coalesce(poi.received_quantity, 0), 0)), 4)
             FROM public.purchase_order_items poi
             JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
            WHERE poi.product_id = np.id
              AND po.status NOT IN ('cancelled', 'received')
         ), 0)
    FROM base b
    JOIN public.sale_orders so ON so.id = b.sale_order_id
    LEFT JOIN public.clients c ON c.id = so.client_id
    JOIN public.products p ON p.id = b.product_id
    JOIN public.product_groups g ON g.id = p.group_id
    LEFT JOIN public.product_groups ng ON ng.id = b.napa_group_id
    LEFT JOIN public.strap_group_napa_yields y ON y.strap_group_id = g.id AND y.napa_group_id = b.napa_group_id
    LEFT JOIN public.contractors ct ON ct.id = g.strap_default_contractor_id
    LEFT JOIN public.products np ON np.id = private.strap_napa_product_for(b.product_id, b.napa_group_id)
    LEFT JOIN public.suppliers sup ON sup.id = coalesce(np.supplier_id, np.preferred_supplier_id)
   WHERE public.is_approved_user()
     AND so.deleted_at IS NULL
   ORDER BY so.order_number, g.name, p.name;
$function$;

REVOKE ALL ON FUNCTION public.list_atelier_strap_shortages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_strap_shortages() TO authenticated;
