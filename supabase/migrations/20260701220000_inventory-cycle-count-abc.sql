-- Inventário cíclico + curva ABC — paridade Tutor32, estoque #4.
--
-- Classificação ABC por valor de estoque (qtd × preço) e sessões de contagem cíclica
-- que reconciliam o saldo via adjust_stock. inventory_counts não existia de fato no
-- banco (só nos tipos) — criado do zero aqui.

-- Curva ABC: A = 80% do valor acumulado, B = próximos 15%, C = resto.
CREATE OR REPLACE VIEW public.v_product_abc AS
WITH base AS (
  SELECT id AS product_id, name, sku, quantity, COALESCE(unit_price, 0) AS unit_price,
         quantity * COALESCE(unit_price, 0) AS stock_value
  FROM public.products
  WHERE COALESCE(active, true) = true AND quantity * COALESCE(unit_price, 0) > 0
),
ranked AS (
  SELECT *,
    SUM(stock_value) OVER () AS total_value,
    SUM(stock_value) OVER (ORDER BY stock_value DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
  FROM base
)
SELECT product_id, name, sku, quantity, unit_price, stock_value,
  CASE
    WHEN total_value = 0 THEN 'C'
    WHEN running / total_value <= 0.80 THEN 'A'
    WHEN running / total_value <= 0.95 THEN 'B'
    ELSE 'C'
  END AS abc_class,
  ROUND(100 * stock_value / NULLIF(total_value, 0), 2) AS pct_of_total,
  ROUND(100 * running / NULLIF(total_value, 0), 2) AS cumulative_pct
FROM ranked;

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text NOT NULL,
  scope text NOT NULL DEFAULT 'all',           -- 'A' | 'B' | 'C' | 'all'
  status text NOT NULL DEFAULT 'aberta',        -- aberta | concluida | cancelada
  run_date date NOT NULL DEFAULT current_date,
  total_products integer NOT NULL DEFAULT 0,
  counted_products integer NOT NULL DEFAULT 0,
  divergences_count integer NOT NULL DEFAULT 0,
  total_divergence_value numeric NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  abc_class text,
  expected_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric,                          -- NULL até contar
  unit_price numeric NOT NULL DEFAULT 0,
  divergence numeric GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  adjusted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count ON public.inventory_count_items(count_id);

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all inv counts" ON public.inventory_counts;
CREATE POLICY "auth all inv counts" ON public.inventory_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth all inv items" ON public.inventory_count_items;
CREATE POLICY "auth all inv items" ON public.inventory_count_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_inventory_counts_updated_at ON public.inventory_counts;
CREATE TRIGGER trg_inventory_counts_updated_at
  BEFORE UPDATE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Abre uma sessão de contagem, fotografando os produtos do escopo (A/B/C/all)
CREATE OR REPLACE FUNCTION public.open_inventory_count(p_scope text DEFAULT 'all')
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_n integer;
BEGIN
  INSERT INTO public.inventory_counts (count_number, scope)
  VALUES ('INV-' || to_char(now(), 'YYYYMMDD-HH24MISS'), COALESCE(p_scope, 'all'))
  RETURNING id INTO v_id;

  IF p_scope IN ('A', 'B', 'C') THEN
    INSERT INTO public.inventory_count_items (count_id, product_id, abc_class, expected_qty, unit_price)
    SELECT v_id, a.product_id, a.abc_class, a.quantity, a.unit_price
    FROM public.v_product_abc a WHERE a.abc_class = p_scope;
  ELSE
    INSERT INTO public.inventory_count_items (count_id, product_id, abc_class, expected_qty, unit_price)
    SELECT v_id, p.id, a.abc_class, p.quantity, COALESCE(p.unit_price, 0)
    FROM public.products p
    LEFT JOIN public.v_product_abc a ON a.product_id = p.id
    WHERE COALESCE(p.active, true) = true;
  END IF;

  SELECT count(*) INTO v_n FROM public.inventory_count_items WHERE count_id = v_id;
  UPDATE public.inventory_counts SET total_products = v_n WHERE id = v_id;
  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.open_inventory_count(text) TO authenticated;

-- Aplica a contagem: reconcilia o estoque (adjust_stock) para o valor contado e fecha
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_cur numeric;
  v_adj integer := 0;
  v_div integer := 0;
  v_divval numeric := 0;
  v_counted integer := 0;
  v_cnum text;
BEGIN
  SELECT count_number INTO v_cnum FROM public.inventory_counts WHERE id = p_count_id;
  IF v_cnum IS NULL THEN RAISE EXCEPTION 'Contagem % não encontrada', p_count_id; END IF;

  FOR v_item IN
    SELECT * FROM public.inventory_count_items
    WHERE count_id = p_count_id AND counted_qty IS NOT NULL
  LOOP
    v_counted := v_counted + 1;
    IF COALESCE(v_item.divergence, 0) <> 0 THEN
      v_div := v_div + 1;
      v_divval := v_divval + abs(COALESCE(v_item.divergence, 0)) * COALESCE(v_item.unit_price, 0);
      IF NOT v_item.adjusted THEN
        SELECT quantity INTO v_cur FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        -- inventário é autoritativo: ajusta do saldo atual para o contado
        PERFORM public.adjust_stock(
          v_item.product_id, v_cur, v_item.counted_qty, v_item.counted_qty - v_cur,
          'Inventário ' || v_cnum, NULL, NULL);
        UPDATE public.inventory_count_items SET adjusted = true WHERE id = v_item.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.inventory_counts
     SET counted_products = v_counted,
         divergences_count = v_div,
         total_divergence_value = v_divval,
         status = 'concluida',
         completed_at = now()
   WHERE id = p_count_id;

  RETURN jsonb_build_object('counted', v_counted, 'divergences', v_div, 'divergence_value', v_divval);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_inventory_count(uuid) TO authenticated;
