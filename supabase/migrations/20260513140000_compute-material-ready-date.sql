-- =============================================================================
-- 20260513140000 — compute_material_ready_date
-- =============================================================================
-- Auditoria de cálculo de data mínima de faturamento detectou que o frontend
-- (computeMinBillingForNewOrder em src/lib/minBillingDate.ts) só checava
-- capacidade produtiva — NÃO consultava stock vs consumo nem somava o
-- supplier lead time quando faltava material.
--
-- A função SQL compute_min_billing_date (PV salvo) já tinha essa lógica via
-- sheet_materials, mas não funciona pra PV em criação (sem id). Esta função
-- aceita um JSONB com lista de itens (reference_id + grade + color) e
-- retorna o dia em que MATERIAL estaria disponível, considerando:
--
--   1) Stock atual: products.quantity - products.reserved_stock
--   2) Consumo por item: SUM(sheet_materials.quantity_per_unit * qty_total_pares)
--   3) Se shortage > 0 pra algum material: data = today + MAX(supplier_lead_time)
--   4) Se shortage = 0 pra todos os materiais: data = today (material já disponível)
--
-- Retorna também a lista de materiais com shortfall pro frontend exibir
-- detalhamento ("Falta material X, lead time Y dias").
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compute_material_ready_date(
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item               jsonb;
  v_reference_id       uuid;
  v_quantity           numeric;
  v_max_lead_time      int := 0;
  v_shortfall_materials jsonb := '[]'::jsonb;
  v_material_record    record;
  v_today              date := CURRENT_DATE;
  v_ready_date         date;
  v_total_needed_map   jsonb := '{}'::jsonb;
  v_existing_need      numeric;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object(
      'ready_date',        v_today,
      'has_shortfall',     false,
      'max_lead_time_days', 0,
      'shortfall_materials', '[]'::jsonb
    );
  END IF;

  -- Agrega consumo por product_id em todos os itens do PV (mesmo material em
  -- 2 itens diferentes some pra calcular shortage correto).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_reference_id := (v_item ->> 'reference_id')::uuid;
    v_quantity     := COALESCE((v_item ->> 'quantity')::numeric, 0);
    IF v_reference_id IS NULL OR v_quantity <= 0 THEN CONTINUE; END IF;

    -- Soma consumo de cada material da ficha técnica
    FOR v_material_record IN
      SELECT sm.product_id, SUM(sm.quantity_per_unit * v_quantity) AS needed
      FROM sheet_materials sm
      WHERE sm.sheet_id = v_reference_id
      GROUP BY sm.product_id
    LOOP
      v_existing_need := COALESCE((v_total_needed_map ->> v_material_record.product_id::text)::numeric, 0);
      v_total_needed_map := jsonb_set(
        v_total_needed_map,
        ARRAY[v_material_record.product_id::text],
        to_jsonb(v_existing_need + v_material_record.needed)
      );
    END LOOP;
  END LOOP;

  -- Itera o map agregado e calcula shortage por material
  FOR v_material_record IN
    SELECT
      p.id              AS product_id,
      p.name            AS product_name,
      p.color           AS product_color,
      p.quantity        AS stock_qty,
      COALESCE(p.reserved_stock, 0) AS reserved_qty,
      p.supplier_lead_time_days,
      (entries.value)::numeric AS needed
    FROM jsonb_each_text(v_total_needed_map) AS entries
    JOIN products p ON p.id = entries.key::uuid
    WHERE (entries.value)::numeric > 0
  LOOP
    DECLARE
      v_available numeric;
      v_shortage  numeric;
      v_lead_days int;
    BEGIN
      v_available := GREATEST(0, v_material_record.stock_qty - v_material_record.reserved_qty);
      v_shortage  := GREATEST(0, v_material_record.needed - v_available);

      IF v_shortage > 0 THEN
        v_lead_days := COALESCE(v_material_record.supplier_lead_time_days, 10);
        IF v_lead_days > v_max_lead_time THEN
          v_max_lead_time := v_lead_days;
        END IF;
        v_shortfall_materials := v_shortfall_materials || jsonb_build_array(
          jsonb_build_object(
            'product_id',    v_material_record.product_id,
            'product_name',  v_material_record.product_name,
            'color',         v_material_record.product_color,
            'needed',        v_material_record.needed,
            'available',     v_available,
            'shortage',      v_shortage,
            'lead_time_days', v_lead_days
          )
        );
      END IF;
    END;
  END LOOP;

  -- Calcula data: hoje se sem shortage, senão today + MAX(supplier_lead_time) dias úteis
  IF v_max_lead_time = 0 THEN
    v_ready_date := v_today;
  ELSE
    v_ready_date := public.add_business_days(v_today, v_max_lead_time)::date;
  END IF;

  RETURN jsonb_build_object(
    'ready_date',          v_ready_date,
    'has_shortfall',       v_max_lead_time > 0,
    'max_lead_time_days',  v_max_lead_time,
    'shortfall_materials', v_shortfall_materials
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_material_ready_date(jsonb) TO authenticated;

COMMENT ON FUNCTION public.compute_material_ready_date(jsonb) IS
  'Retorna a data em que o material do PV estaria disponível. Aceita lista de itens '
  '({reference_id, quantity}). Se há shortage, soma supplier_lead_time_days. Espelha a '
  'lógica condicional do compute_min_billing_date pra PVs ainda não persistidos.';
