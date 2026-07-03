-- P0.2 / C2 — record_order_consumption: materializa o ledger de consumo por OP.
--
-- production_consumptions existia desde 2026-03 com ZERO escritores — o consumo
-- real vivia só implícito em stock_movements. Esta função preenche o ledger:
--   standard = motores canônicos (calculate_order_consumption[_by_grade] +
--              order_strap_needs) convertidos pra unidade do produto com o MESMO
--              pipeline do custeio (convert_to_product_unit + fallback dm²);
--   actual   = SUM(stock_movements 'out' da OP) em unidade do produto.
--
-- REGRAS ANTI-DUPLO-REGISTRO (não relaxar):
--   • A função NUNCA debita estoque — débito é dos caminhos existentes
--     (hybrid_debit/debit_sole_stock_by_grade/debit_strap_stock/packaging/convert).
--   • actual NÃO neteia movimentos 'in': resync_op_atomic detacha os 'out'
--     antigos mas MANTÉM os 'in' de estorno anexados — netear duplo-subtrairia.
--   • actual NÃO soma material_reservations.quantity_consumed: o 'out'
--     correspondente já existe (fix 20260627121000).
--   • Linha só-standard com actual=0 = furo de baixa (sinal, não erro).
--   • Re-entrante: versões anteriores viram histórico via superseded_at
--     (padrão do resync, 20260504180000).

CREATE OR REPLACE FUNCTION public.record_order_consumption(
  p_order_id uuid,
  p_reason text DEFAULT 'finalizacao')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_o record;
  v_variant uuid;
  v_strap_colors jsonb;
  v_cons jsonb;
  v_rows integer := 0;
  v_std_total numeric := 0;
  v_act_total numeric := 0;
  v_reservas_pendentes integer := 0;
  v_avisos text[] := ARRAY[]::text[];
BEGIN
  SELECT id, reference_id, quantity, color, grade, status, sale_order_item_id
    INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('record_consumption:' || p_order_id::text));

  UPDATE public.production_consumptions
     SET superseded_at = now(), superseded_reason = p_reason
   WHERE order_id = p_order_id AND superseded_at IS NULL;

  SELECT i.material_variant_id, i.strap_colors INTO v_variant, v_strap_colors
    FROM public.sale_order_items i WHERE i.id = v_o.sale_order_item_id;

  IF v_o.reference_id IS NOT NULL THEN
    IF v_o.grade IS NOT NULL AND jsonb_typeof(v_o.grade) = 'object' AND v_o.grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_o.reference_id, v_o.grade, COALESCE(v_o.color, ''), v_variant);
    ELSE
      v_cons := public.calculate_order_consumption(
        v_o.reference_id, COALESCE(v_o.quantity, 0), COALESCE(v_o.color, ''), NULL::integer, v_variant);
    END IF;
  END IF;
  v_cons := COALESCE(v_cons, '[]'::jsonb);

  WITH std_raw AS (
    SELECT (e->>'product_id')::uuid AS product_id,
           COALESCE(e->>'component', '?') AS component,
           e->>'product_name' AS product_name,
           (e->>'required')::numeric AS required,
           e->>'unit' AS unit
      FROM jsonb_array_elements(v_cons) e
     WHERE (e->>'product_id') IS NOT NULL
       AND COALESCE((e->>'required')::numeric, 0) > 0
  ),
  std_conv AS (
    SELECT s.product_id, s.component, s.product_name,
           COALESCE(
             public.convert_to_product_unit(s.required, s.unit, COALESCE(p.unit, '')),
             CASE WHEN conv.dm2_per_unit IS NOT NULL AND conv.dm2_per_unit > 0
                   AND public.convert_to_product_unit(s.required, s.unit, 'dm²') IS NOT NULL
                  THEN public.convert_to_product_unit(s.required, s.unit, 'dm²') / conv.dm2_per_unit
             END,
             s.required) AS required_prod_unit,
           p.unit_price
      FROM std_raw s
      LEFT JOIN public.products p ON p.id = s.product_id
      LEFT JOIN LATERAL public.get_material_conversion_info(s.product_id) conv ON true
  ),
  std AS (
    SELECT product_id,
           string_agg(DISTINCT component, ' + ') AS component_name,
           max(product_name) AS product_name,
           sum(required_prod_unit) AS std_qty,
           max(unit_price) AS unit_price
      FROM std_conv
     GROUP BY product_id
  ),
  straps AS (
    SELECT sn.product_id, 'Tira'::text AS component_name, sn.product_name,
           sn.required_m AS std_qty, p.unit_price
      FROM public.order_strap_needs(v_strap_colors, COALESCE(v_o.quantity, 0), v_o.grade) sn
      LEFT JOIN public.products p ON p.id = sn.product_id
     WHERE sn.product_id IS NOT NULL AND sn.required_m > 0
       AND NOT EXISTS (SELECT 1 FROM std WHERE std.product_id = sn.product_id)
  ),
  std_all AS (
    SELECT * FROM std UNION ALL SELECT * FROM straps
  ),
  act AS (
    SELECT sm.product_id,
           sum(sm.quantity) AS act_qty,
           sum(sm.quantity * COALESCE(sm.unit_price_at_movement, p.unit_price, 0)) AS act_cost
      FROM public.stock_movements sm
      LEFT JOIN public.products p ON p.id = sm.product_id
     WHERE sm.order_id = p_order_id AND sm.movement_type = 'out'
     GROUP BY sm.product_id
  ),
  merged AS (
    SELECT COALESCE(s.product_id, a.product_id) AS product_id,
           s.component_name,
           COALESCE(s.product_name, pr.name) AS product_name,
           COALESCE(s.std_qty, 0) AS std_qty,
           COALESCE(a.act_qty, 0) AS act_qty,
           COALESCE(s.std_qty, 0) * COALESCE(s.unit_price, pr.unit_price, 0) AS std_cost,
           COALESCE(a.act_cost, 0) AS act_cost
      FROM std_all s
      FULL OUTER JOIN act a ON a.product_id = s.product_id
      LEFT JOIN public.products pr ON pr.id = COALESCE(s.product_id, a.product_id)
  ),
  ins AS (
    INSERT INTO public.production_consumptions
      (order_id, product_id, component_type, component_name,
       standard_quantity, actual_quantity, standard_cost, actual_cost, notes)
    SELECT p_order_id, m.product_id,
           CASE
             WHEN m.component_name = 'Tira' THEN 'strap'
             WHEN m.component_name ~* '(cabedal|forr|palmilha|fachete|solado)' THEN 'spec'
             ELSE 'bom'
           END,
           COALESCE(NULLIF(m.component_name, '?'), m.product_name, 'Movimento sem par no motor'),
           round(m.std_qty, 4), round(m.act_qty, 4),
           round(m.std_cost, 4), round(m.act_cost, 4),
           CASE
             WHEN m.std_qty = 0 THEN 'só movimento (débito sem par no motor de consumo) — ' || p_reason
             WHEN m.act_qty = 0 THEN 'sem débito registrado (possível furo de baixa) — ' || p_reason
             ELSE p_reason
           END
      FROM merged m
     WHERE m.std_qty > 0 OR m.act_qty > 0
    RETURNING standard_cost, actual_cost
  )
  SELECT count(*), COALESCE(sum(standard_cost), 0), COALESCE(sum(actual_cost), 0)
    INTO v_rows, v_std_total, v_act_total FROM ins;

  SELECT count(*) INTO v_reservas_pendentes
    FROM public.material_reservations
   WHERE order_id = p_order_id AND status = 'reserved';
  IF v_reservas_pendentes > 0 THEN
    v_avisos := array_append(v_avisos,
      v_reservas_pendentes || ' reserva(s) ainda em aberto — consumo real pode estar incompleto');
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'linhas', v_rows,
    'standard_total', v_std_total,
    'actual_total', v_act_total,
    'reservas_pendentes', v_reservas_pendentes,
    'avisos', to_jsonb(v_avisos));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_order_consumption(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_order_consumption(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.record_order_consumption(uuid, text) IS
  'P0.2: materializa production_consumptions (standard × actual) de uma OP. NÃO debita estoque. Re-entrante (supersede). Chamada pelo trigger de finalização e re-executável manualmente para diagnóstico.';
