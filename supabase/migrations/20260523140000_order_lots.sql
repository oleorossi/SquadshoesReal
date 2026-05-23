-- =============================================================================
-- Lot Sizing — split de OPs grandes em lotes do tamanho do gargalo
-- =============================================================================
-- Objetivo: liberar caixa antes. OP de 600 pares com gargalo Costura cap=200/dia
-- vira 3 lotes de 200 — primeiro lote sai do setor em 1 dia em vez de 3,
-- permite faturar parcial (combina com PR de NF-e por OP).
--
-- Design opt-in: OP NÃO splitada = comportamento atual (sem lots). Quando user
-- chama split_order_into_lots(), nascem N lots. Sem backfill em massa.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.order_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  lot_number int NOT NULL CHECK (lot_number >= 1),
  quantity int NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','done','shipped','cancelled')),
  current_sector text,
  expected_complete_date date,
  started_at timestamptz,
  completed_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, lot_number)
);

CREATE INDEX IF NOT EXISTS idx_order_lots_order ON public.order_lots(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lots_active
  ON public.order_lots(status, order_id)
  WHERE status NOT IN ('done','shipped','cancelled');

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION public.tg_order_lots_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tg_order_lots_updated_at ON public.order_lots;
CREATE TRIGGER tg_order_lots_updated_at BEFORE UPDATE ON public.order_lots
  FOR EACH ROW EXECUTE FUNCTION public.tg_order_lots_updated_at();

-- RLS
ALTER TABLE public.order_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_lots_select" ON public.order_lots;
CREATE POLICY "order_lots_select" ON public.order_lots
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "order_lots_modify" ON public.order_lots;
CREATE POLICY "order_lots_modify" ON public.order_lots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.order_lots IS
  'Sub-lotes de uma OP. Tamanho default = capacidade diária do gargalo da ficha. ' ||
  'Permite saídas escalonadas (faturar lote 1 enquanto lote 3 ainda produz).';

-- =============================================================================
-- Função: capacidade do gargalo de uma ficha técnica
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_sheet_bottleneck_capacity(p_sheet_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ts record;
  v_sectors jsonb;
  v_min int := 1000000;
  v_cap int;
BEGIN
  SELECT * INTO v_ts FROM public.technical_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RETURN 100; END IF;

  v_sectors := COALESCE(v_ts.production_sectors, '[]'::jsonb);

  -- Para cada setor presente em production_sectors, MIN da capacity correspondente.
  -- COALESCE(NULLIF(.., 0), 100) garante que 0/NULL não é considerado.
  IF v_sectors @> '["Corte Palmilha"]'::jsonb OR v_sectors @> '["Corte"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.sewing_capacity_per_day, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Corte Forração"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.cutting_capacity_per_day, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Costura"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.costura_capacity_per_day, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Mesa"]'::jsonb OR v_sectors @> '["Aviamento"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.mesa_daily_capacity, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Silk"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.silk_capacity_per_day, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Colagem"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.gluing_capacity_per_day, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  -- Montagem e Acabamento são SEMPRE setores ativos (não condicionais ao JSONB)
  v_cap := COALESCE(NULLIF(v_ts.assembly_capacity_per_day, 0), 1000000);
  IF v_cap < v_min THEN v_min := v_cap; END IF;
  v_cap := COALESCE(NULLIF(v_ts.finishing_capacity_per_day, 0), 1000000);
  IF v_cap < v_min THEN v_min := v_cap; END IF;
  IF v_sectors @> '["Solagem"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.soling_capacity_per_day, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;

  -- Se nenhuma capacity foi definida em nenhum setor, fallback 100.
  IF v_min = 1000000 THEN RETURN 100; END IF;
  RETURN GREATEST(v_min, 1);
END;
$$;

COMMENT ON FUNCTION public.get_sheet_bottleneck_capacity IS
  'Retorna capacidade diária do setor gargalo da ficha (MIN entre capacities ' ||
  'dos setores ativos em production_sectors). Fallback 100 se nada configurado.';

-- =============================================================================
-- RPC: split de uma OP em lots de tamanho = capacity gargalo
-- =============================================================================
CREATE OR REPLACE FUNCTION public.split_order_into_lots(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_lot_size int;
  v_n_lots int;
  v_remaining int;
  v_i int;
  v_qty int;
  v_existing int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP nao encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_existing FROM public.order_lots WHERE order_id = p_order_id;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'OP ja tem % lots. Use reset_order_lots para refazer o split.', v_existing
      USING ERRCODE = '22023';
  END IF;

  v_lot_size := public.get_sheet_bottleneck_capacity(v_order.reference_id);
  v_n_lots := CEIL(v_order.quantity::numeric / v_lot_size);

  IF v_n_lots <= 1 THEN
    RAISE EXCEPTION 'OP de % pares cabe em 1 lote (gargalo cap=%). Nao vale split.',
      v_order.quantity, v_lot_size
      USING ERRCODE = '22023';
  END IF;

  v_remaining := v_order.quantity;
  v_i := 1;
  WHILE v_remaining > 0 LOOP
    v_qty := LEAST(v_lot_size, v_remaining);
    INSERT INTO public.order_lots (order_id, lot_number, quantity, status)
    VALUES (p_order_id, v_i, v_qty, 'pending');
    v_remaining := v_remaining - v_qty;
    v_i := v_i + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'lot_size', v_lot_size,
    'n_lots', v_n_lots,
    'total_quantity', v_order.quantity
  );
END;
$$;

-- =============================================================================
-- RPC: reset (apaga todos os lots de uma OP — desfaz o split)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reset_order_lots(p_order_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active int;
  v_deleted int;
BEGIN
  -- Bloqueia reset se algum lote já está in_progress ou done
  SELECT COUNT(*) INTO v_active
  FROM public.order_lots
  WHERE order_id = p_order_id AND status IN ('in_progress','done','shipped');
  IF v_active > 0 THEN
    RAISE EXCEPTION 'OP tem % lotes ja iniciados. Nao da pra resetar.', v_active
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.order_lots WHERE order_id = p_order_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- =============================================================================
-- View: sugestoes de split (OPs onde qty > capacity_gargalo × 2)
-- =============================================================================
CREATE OR REPLACE VIEW public.v_order_split_suggestions
WITH (security_invoker = true) AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.sale_order_id,
  so.order_number AS sale_order_number,
  o.quantity,
  o.color,
  o.status,
  o.production_step,
  o.planned_delivery,
  ts.id AS sheet_id,
  ts.name AS sheet_name,
  ts.code AS sheet_code,
  public.get_sheet_bottleneck_capacity(ts.id) AS bottleneck_capacity,
  CEIL(o.quantity::numeric / public.get_sheet_bottleneck_capacity(ts.id))::int AS suggested_lots
FROM public.orders o
JOIN public.technical_sheets ts ON ts.id = o.reference_id
LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
WHERE LOWER(o.status) NOT IN ('finalizado','concluído','concluido','cancelada','cancelado','rascunho')
  AND o.quantity > public.get_sheet_bottleneck_capacity(ts.id) * 2
  AND NOT EXISTS (SELECT 1 FROM public.order_lots ol WHERE ol.order_id = o.id)
ORDER BY (o.quantity::numeric / public.get_sheet_bottleneck_capacity(ts.id)) DESC;

COMMENT ON VIEW public.v_order_split_suggestions IS
  'OPs ativas onde quantity > capacity_gargalo × 2 dias. Sugere N lots = ceil(qty/cap). ' ||
  'Exclui OPs canceladas/finalizadas/ja splitadas.';

GRANT SELECT ON public.v_order_split_suggestions TO authenticated;
