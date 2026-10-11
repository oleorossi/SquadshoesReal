-- tira_virada_funcoes_20270101037100
--
-- Funções auxiliares da VIRADA de specs/tira-material-de-estoque.md, aplicadas
-- ANTES dela (sem chamador até 20270101037200_tira-virada):
--   private.order_strap_consumption_items      tira do item/OP no formato do hybrid_debit
--   private.purchasable_strap_consumption_lines tira "Comprar pronto" na necessidade de compra (R15, R34)
--   private.sale_order_strap_product_origin     origem da tira de um SKU no PV
--   public.list_atelier_strap_shortages         (redefinida) origem lida do PV, não de marca na reserva
--   private.migrate_open_pv_straps_to_material  migração dos PVs abertos (R23/R24)
-- Antes da virada nenhum item tem o snapshot novo, então tudo isso devolve vazio.

-- ═══ 3. Tira no motor genérico de empenho/falta ════════════════════════════

-- Linhas de consumo de tira de um item (ou da parte de uma OP) no formato que o
-- hybrid_debit_stock_for_order consome.
CREATE OR REPLACE FUNCTION private.order_strap_consumption_items(
  p_item_id uuid,
  p_grade jsonb,
  p_quantity numeric
) RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id', n.product_id,
           'product_name', p.name,
           'required', n.required_m,
           'unit', 'm',
           'debit_mode', 'soft',
           'component', 'Tira',
           'source', 'strap',
           'matched_by', 'strap_sku'
         ) ORDER BY p.name), '[]'::jsonb)
    FROM (
      SELECT sn.product_id, sum(sn.required_m) AS required_m
        FROM public.sale_order_item_strap_needs(p_item_id, p_grade, p_quantity) sn
       GROUP BY sn.product_id
    ) n
    JOIN public.products p ON p.id = n.product_id
   WHERE p_item_id IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION private.order_strap_consumption_items(uuid, jsonb, numeric) FROM PUBLIC;

-- Só a tira "Comprar pronto" entra na necessidade de COMPRA (R15). Fábrica e
-- Prestador vão para o Ateliê. R34: metros marcados "comprado" na tela interina
-- (strap_buy_ready_purchases, se existir) descontam da compra.
CREATE OR REPLACE FUNCTION private.purchasable_strap_consumption_lines(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_out jsonb;
  -- Metros marcados "comprado" por linha técnica: {"<uuid>": metros}. Leitura
  -- dinâmica porque a tabela interina pode não existir (função STABLE: sem DDL).
  v_purchased jsonb := '{}'::jsonb;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF to_regclass('public.strap_buy_ready_purchases') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(jsonb_object_agg(x.line_id::text, x.purchased_m), ''{}''::jsonb)
               FROM (SELECT technical_strap_line_id AS line_id, sum(purchased_m) AS purchased_m
                       FROM public.strap_buy_ready_purchases
                      WHERE sale_order_item_id = $1
                      GROUP BY 1) x'
      INTO v_purchased
      USING p_item_id;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'product_id', x.product_id,
           'product_name', p.name,
           'color', coalesce(p.color, ''),
           'required', x.required_m,
           'unit', 'm',
           'component', 'Tira',
           'matched_by', 'strap_sku'
         )), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT sn.product_id,
             sum(greatest(
               sn.required_m
                 - coalesce((v_purchased ->> sn.technical_strap_line_id::text)::numeric, 0),
               0
             )) AS required_m
        FROM public.sale_order_item_strap_needs(p_item_id) sn
       WHERE sn.origin = 'comprar_pronto'
       GROUP BY sn.product_id
    ) x
    JOIN public.products p ON p.id = x.product_id
   WHERE x.required_m > 0;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION private.purchasable_strap_consumption_lines(uuid) FROM PUBLIC;

-- ═══ 5. Ateliê: origem da falta vem do PV (não de marca na reserva) ═══════
CREATE OR REPLACE FUNCTION private.sale_order_strap_product_origin(p_sale_order_id uuid, p_product_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Mesmo SKU em linhas de origens diferentes: Comprar pronto vence (a compra
  -- cobre), depois Fábrica, depois Prestador.
  SELECT min(src.value ->> 'origin')
    FROM public.sale_order_items i
    CROSS JOIN LATERAL jsonb_each(coalesce(i.strap_sourcing, '{}'::jsonb)) src
   WHERE i.sale_order_id = p_sale_order_id
     AND i.production_excluded_at IS NULL
     AND src.value ->> 'product_id' = p_product_id::text;
$function$;

REVOKE ALL ON FUNCTION private.sale_order_strap_product_origin(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.list_atelier_strap_shortages()
 RETURNS TABLE(
   sale_order_id uuid, order_number text, client_name text,
   product_id uuid, product_name text, group_id uuid, group_name text,
   origin text, color text, napa_group_id uuid, napa_group_name text,
   needed_m numeric, reserved_m numeric, shortage_m numeric, in_progress_m numeric, to_produce_m numeric,
   yield_m_per_m numeric, labor_cost_per_m numeric, default_contractor_id uuid, default_contractor_name text,
   napa_product_id uuid, napa_product_name text, napa_stock_m numeric, napa_unit_price numeric, napa_supplier_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- tira_material_virada_20270101037100
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
         np.id, np.name, np.quantity, coalesce(nullif(np.purchase_price, 0), np.unit_price), sup.name
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

-- ═══ 6. Migração dos PVs abertos (R23, conferida pelo dono — R24) ═════════
CREATE OR REPLACE FUNCTION private.migrate_open_pv_straps_to_material()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pv record;
  v_item public.sale_order_items%ROWTYPE;
  v_clean jsonb;
  v_prep jsonb;
  v_report jsonb := '[]'::jsonb;
  v_items_done integer;
  v_cancelled integer;
  v_commit jsonb;
  v_adopted integer;
  v_created jsonb;
BEGIN
  PERFORM set_config('app.strap_source_rpc', '1', true);
  PERFORM set_config('app.strap_force_revalidate', '1', true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
  -- tg_enforce_sale_order_command_boundary: escritor interno autorizado.
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  FOR v_pv IN
    SELECT so.id, so.order_number, so.status
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Rascunho', 'Pendente', 'Aprovado', 'Em Produção')
       AND EXISTS (
         SELECT 1 FROM public.sale_order_items i
          WHERE i.sale_order_id = so.id
            AND jsonb_typeof(i.strap_colors) = 'array'
            AND jsonb_array_length(i.strap_colors) > 0
       )
     ORDER BY so.order_number
  LOOP
    v_items_done := 0;
    v_created := '[]'::jsonb;
    FOR v_item IN
      SELECT * FROM public.sale_order_items i
       WHERE i.sale_order_id = v_pv.id
         AND jsonb_typeof(i.strap_colors) = 'array'
         AND jsonb_array_length(i.strap_colors) > 0
       ORDER BY i.created_at, i.id
    LOOP
      -- pv_origem gravado é o padrão automático do writer antigo (decisão do dono).
      SELECT coalesce(jsonb_agg(l.value - 'pv_origem' ORDER BY l.ord), '[]'::jsonb)
        INTO v_clean
        FROM jsonb_array_elements(v_item.strap_colors) WITH ORDINALITY l(value, ord);
      v_prep := private.prepare_sale_order_item_straps_v2(
        jsonb_build_object(
          'id', v_item.id,
          'reference_id', v_item.reference_id,
          'material_variant_id', v_item.material_variant_id,
          'color', v_item.color,
          'quantity', v_item.quantity,
          'grade', v_item.grade,
          'strap_colors', v_clean,
          'strap_sourcing', '{}'::jsonb
        ),
        false
      );
      UPDATE public.sale_order_items
         SET strap_colors = v_prep -> 'item' -> 'strap_colors',
             strap_sourcing = v_prep -> 'item' -> 'strap_sourcing'
       WHERE id = v_item.id;
      v_created := v_created || coalesce(v_prep -> 'created_skus', '[]'::jsonb);
      v_items_done := v_items_done + 1;
    END LOOP;

    -- Demandas do Hub deixam de valer.
    v_cancelled := 0;
    BEGIN
      UPDATE public.sale_order_strap_demands d
         SET status = 'cancelled', is_current = false
       WHERE d.sale_order_id = v_pv.id
         AND coalesce(d.status, '') NOT IN ('cancelled', 'superseded');
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_cancelled := -1;
    END;

    v_commit := NULL;
    v_adopted := 0;
    IF v_pv.status IN ('Aprovado', 'Em Produção') THEN
      -- Empenho + falta da tira (motor genérico).
      v_commit := public.commit_sale_order_material_demand(v_pv.id);
      -- OPs já criadas não passaram pela tira: a reserva do PV vai para a 1ª OP
      -- do item que usa o SKU (separação e finalização enxergam a OP).
      UPDATE public.material_reservations mr
         SET order_id = target.order_id,
             metadata = coalesce(mr.metadata, '{}'::jsonb) || jsonb_build_object(
               'adopted_order_id', target.order_id, 'component', 'Tira', 'source', 'strap'),
             updated_at = now()
        FROM (
          SELECT DISTINCT ON (sn.product_id) sn.product_id, o.id AS order_id
            FROM public.sale_order_items i
            CROSS JOIN LATERAL public.sale_order_item_strap_needs(i.id) sn
            JOIN public.orders o ON o.sale_order_item_id = i.id AND o.deleted_at IS NULL
           WHERE i.sale_order_id = v_pv.id
           ORDER BY sn.product_id, o.created_at, o.id
        ) target
       WHERE mr.sale_order_id = v_pv.id
         AND mr.order_id IS NULL
         AND mr.product_id = target.product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND coalesce(mr.metadata ->> 'kind', '') = 'pv_commitment';
      GET DIAGNOSTICS v_adopted = ROW_COUNT;
    END IF;

    v_report := v_report || jsonb_build_array(jsonb_build_object(
      'pv', v_pv.order_number,
      'status', v_pv.status,
      'items', v_items_done,
      'demands_cancelled', v_cancelled,
      'skus_created', v_created,
      'commit', v_commit,
      'adopted_reservations', v_adopted
    ));
  END LOOP;
  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION private.migrate_open_pv_straps_to_material() FROM PUBLIC;
