-- Capacity-driven lead times across the planning engine.
--
-- Política única: o lead time de cada setor é DERIVADO da capacidade
-- diária (pares/dia) e da quantidade do pedido:
--
--     lead_time_dias = GREATEST(1, CEIL(quantidade / capacidade_diaria))
--
-- Hierarquia de capacidade (do mais específico para o mais geral):
--   1. technical_sheets.<setor>_capacity_per_day
--   2. default_lead_times.<setor>_capacity_per_day  (por categoria)
--
-- Fallback (compatibilidade com fichas antigas que não têm capacidade):
--   3. technical_sheets.lead_time_<setor>_dias
--   4. default_lead_times.lead_time_<setor>_dias
--   5. valor hard-coded por setor (corte=2, costura=3, montagem=2, acabamento=1)
--
-- Esta migration atualiza compute_wave_timeline() para usar a fórmula
-- baseada em capacidade. As views e a função compute_order_planned_dates já
-- usavam essa lógica desde 20260418182021 e 20260427240000 — esta é a
-- última peça que faltava.

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  -- Para cada item do batch, calcula o lead time POR PEDIDO usando capacidade.
  -- Quando a capacidade não está definida, faz fallback para o lead time fixo
  -- (compatibilidade com fichas antigas). MAX agrega o pior caso do batch.
  SELECT
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                        dlt.cutting_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
                      dlt.lead_time_corte_dias,
                      (SELECT sc.corte_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      2)
      END
    ), 2),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                        dlt.sewing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
                      dlt.lead_time_costura_dias,
                      (SELECT sc.costura_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      3)
      END
    ), 3),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                        dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
                      dlt.lead_time_montagem_dias,
                      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      2)
      END
    ), 2),
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                        dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
                      dlt.lead_time_acabamento_dias,
                      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      1)
      END
    ), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0),
                          dlt.lead_time_buffer_material_dias,
                          (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                          2)), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Mesa runs in parallel with Corte (level 1) — not in the critical path.
  -- Cascade: deadline → -acab → -montagem → -costura → -corte → -buffer → -supplier
  RETURN QUERY SELECT
    v_deadline                                                                          AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                                          AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                                                          AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem)::date                                 AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                    AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer)::date                          AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer
       - v_lead_supplier)::date                                                         AS purchase_deadline;
END;
$$;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Calcula o cronograma de uma onda usando lead times derivados de capacidade '
  '(ceil(qty/cap)). Faz fallback para lead_time_*_dias da ficha → categoria → constante. '
  'MAX agrega o pior caso entre os pedidos do batch.';
