-- Alinha Corte Cabedal no Kanban/agenda e o fallback de promote_sale_order_item.
--
-- 1) sector_settings nunca teve linha de Corte Cabedal → coluna só via R1.5,
--    sem parallel_group/capacidade/flow_order.
-- 2) promote_sale_order_item ainda caía no fallback pré-Corte Fibra
--    (Corte Palmilha + Mesa). O promote atômico remenda fichas vazias, mas
--    chamada direta / ficha sem rota gravava nomes mortos.
--
-- ⚠ Apply 20270101022600 falhou em 10/09/2026 com 42501. Causa mais
--   provável: REVOKE/COMMENT em promote_sale_order_item sem ownership
--   (função pode ter ficado com dono supabase_admin após apply MCP). O CLI
--   reporta o INSERT em schema_migrations como statement do erro. CREATE OR
--   REPLACE preserva ACL — não reaplicar REVOKE aqui.

INSERT INTO public.sector_settings
  (sector, flow_order, enabled, parallel_group, daily_capacity_pairs, ficha_capacity_column)
SELECT
  'Corte Cabedal',
  15,
  true,
  'corte',
  COALESCE(
    (SELECT daily_capacity_pairs FROM public.sector_settings WHERE sector = 'Corte Fibra'),
    (SELECT daily_capacity_pairs FROM public.sector_settings WHERE sector = 'Corte Forração'),
    600
  ),
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.sector_settings WHERE sector = 'Corte Cabedal'
);

UPDATE public.sector_settings
   SET flow_order = 15,
       parallel_group = 'corte',
       enabled = COALESCE(enabled, true)
 WHERE sector = 'Corte Cabedal';

-- Assumir ownership antes do CREATE OR REPLACE (no-op se já formos donos).
DO $own$
BEGIN
  ALTER FUNCTION public.promote_sale_order_item(uuid, text, text, date, boolean, text)
    OWNER TO postgres;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE
      'promote_sale_order_item: sem privilégio pra ALTER OWNER (seguindo com CREATE OR REPLACE)';
END
$own$;

CREATE OR REPLACE FUNCTION public.promote_sale_order_item(
  p_item_id           uuid,
  p_op_status         text,
  p_notes             text,
  p_planned_delivery  date,
  p_is_ahead          boolean,
  p_packaging_mode    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item          public.sale_order_items%ROWTYPE;
  v_so_id         uuid;
  v_so_number     text;
  v_sheet_name    text;
  v_sheet_code    text;
  v_scaled_grade  jsonb;
  v_effective     jsonb;
  v_op_id         uuid;
  v_fichas        int;
  v_sectors       text[];
  v_pkg_msg       text;
  v_pkg_state     text;
  v_shortages     jsonb := '[]'::jsonb;
  v_sole_shortfall boolean := false;
BEGIN
  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % não encontrado', p_item_id;
  END IF;
  v_so_id := v_item.sale_order_id;

  IF v_item.reference_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'item sem referência');
  END IF;

  SELECT so.order_number INTO v_so_number FROM public.sale_orders so WHERE so.id = v_so_id;
  SELECT ts.name, ts.code INTO v_sheet_name, v_sheet_code
    FROM public.technical_sheets ts WHERE ts.id = v_item.reference_id;

  v_fichas := GREATEST(COALESCE(v_item.fichas, 1), 1);

  SELECT COALESCE(jsonb_object_agg(g.key, (COALESCE(NULLIF(g.value,'')::numeric,0) * v_fichas)::int), '{}'::jsonb)
    INTO v_scaled_grade
    FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
   WHERE COALESCE(NULLIF(g.value, '')::numeric, 0) * v_fichas > 0;

  v_effective := CASE WHEN v_scaled_grade = '{}'::jsonb
                      THEN NULLIF(COALESCE(v_item.grade, '{}'::jsonb), '{}'::jsonb)
                      ELSE v_scaled_grade END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', s.product_id, 'product_name', s.product_name,
           'required', s.required, 'available', s.available,
           'shortage', GREATEST(0, s.required - s.available))), '[]'::jsonb)
    INTO v_shortages
    FROM public.check_stock_availability(
           v_item.reference_id, COALESCE(v_item.quantity, 0), COALESCE(v_item.color, ''),
           v_effective, v_item.strap_colors, p_packaging_mode, v_item.material_variant_id) s
   WHERE NOT s.sufficient;

  INSERT INTO public.orders (
    reference_id, quantity, color, grade, sale_order_id, sale_order_item_id,
    notes, status, item_observation, planned_delivery, is_ahead_of_schedule
  ) VALUES (
    v_item.reference_id, COALESCE(v_item.quantity, 0), COALESCE(v_item.color, ''),
    CASE WHEN v_scaled_grade = '{}'::jsonb THEN COALESCE(v_item.grade, '{}'::jsonb) ELSE v_scaled_grade END,
    v_so_id, v_item.id, p_notes, p_op_status, NULLIF(v_item.observation, ''),
    p_planned_delivery, COALESCE(p_is_ahead, false)
  )
  RETURNING id INTO v_op_id;

  PERFORM public.hybrid_debit_stock_for_order(
    v_item.reference_id, COALESCE(v_item.quantity, 0)::numeric, COALESCE(v_item.color, ''),
    v_op_id, v_effective, true);

  IF v_scaled_grade <> '{}'::jsonb THEN
    PERFORM public.debit_sole_stock_by_grade(
      v_item.reference_id, v_op_id, COALESCE(v_item.color, ''), v_scaled_grade, true);

    -- Déficit real por numeração: grade efetiva da reserva x stock_grade do produto.
    -- Mesma comparação de autoCreateSolePOFromShortfall no cliente.
    v_sole_shortfall := EXISTS (
      SELECT 1
        FROM public.material_reservations r
        JOIN public.products p ON p.id = r.product_id
       CROSS JOIN LATERAL jsonb_each_text(COALESCE(r.metadata->'effective_grade', '{}'::jsonb)) g
       WHERE r.order_id = v_op_id
         AND r.status = 'reserved'
         AND r.metadata->>'kind' = 'sole_grade'
         AND COALESCE(NULLIF(g.value, '')::numeric, 0)
             > COALESCE(NULLIF(p.stock_grade->>g.key, '')::numeric, 0));
  END IF;

  IF jsonb_typeof(v_item.strap_colors) = 'array' AND jsonb_array_length(v_item.strap_colors) > 0 THEN
    PERFORM public.debit_strap_stock(
      v_item.strap_colors, COALESCE(v_item.quantity, 0), v_op_id, v_item.grade, true);
  END IF;

  -- Falta de EMBALAGEM não cancela a OP (mesma regra de isPackagingStockShortage).
  BEGIN
    PERFORM public.debit_packaging_for_order(
      v_so_id, v_op_id, v_item.reference_id, COALESCE(v_item.quantity, 0), p_packaging_mode, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_pkg_msg = MESSAGE_TEXT, v_pkg_state = RETURNED_SQLSTATE;
    IF v_pkg_msg !~* 'estoque insuficiente para embalagem' THEN
      RAISE EXCEPTION 'embalagem: %', v_pkg_msg USING ERRCODE = v_pkg_state;
    END IF;
  END;

  SELECT COALESCE(
           NULLIF(ARRAY(SELECT jsonb_array_elements_text(ts.production_sectors)), '{}'),
           ARRAY['Corte Fibra','Corte Forração','Costura Palmilha','Costura Cabedal',
                 'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
         )
    INTO v_sectors
    FROM public.technical_sheets ts
   WHERE ts.id = v_item.reference_id;

  IF v_sectors IS NULL THEN
    v_sectors := ARRAY['Corte Fibra','Corte Forração','Costura Palmilha','Costura Cabedal',
                       'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'];
  END IF;

  -- Grafias legadas (Corte Palmilha/Mesa) → nomes vivos antes de gravar etapas.
  SELECT ARRAY_AGG(public.canonical_stage_name(s.name) ORDER BY s.idx)
    INTO v_sectors
    FROM unnest(v_sectors) WITH ORDINALITY AS s(name, idx);

  -- Espelha opStageOrder(name, idx) do TS: 99 (desconhecido) cai pro índice.
  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT v_op_id, s.name,
         CASE WHEN public.canonical_stage_order(s.name) = 99 THEN s.idx::int ELSE public.canonical_stage_order(s.name) END,
         'pendente', COALESCE(v_item.quantity, 0), 0
    FROM unnest(v_sectors) WITH ORDINALITY AS s(name, idx);

  INSERT INTO public.mrp_suggestions (
    suggestion_type, product_id, product_name, sale_order_id, order_id,
    required_quantity, available_quantity, shortage_quantity, priority, due_date, notes)
  SELECT 'purchase',
         NULLIF(s->>'product_id', '')::uuid,
         COALESCE(s->>'product_name', 'Material'),
         v_so_id, v_op_id,
         (s->>'required')::numeric, (s->>'available')::numeric, (s->>'shortage')::numeric,
         'rush', NULL,
         'Falta de material para ' || COALESCE(v_sheet_name, 'Ref') ||
         ' (' || COALESCE(v_sheet_code, '') || ') - PV ' || COALESCE(v_so_number, v_so_id::text)
    FROM jsonb_array_elements(v_shortages) s
   WHERE (s->>'shortage')::numeric > 0;

  RETURN jsonb_build_object(
    'order_id', v_op_id,
    'item_id', v_item.id,
    'shortages', v_shortages,
    'sole_shortfall', v_sole_shortfall,
    'skipped', false
  );
END;
$$;

-- Grants/REVOKE ficam como a 20270101010500 deixou (CREATE OR REPLACE preserva ACL).
-- Não reaplicar REVOKE/COMMENT aqui — exigem ownership e já derrubaram o apply.
