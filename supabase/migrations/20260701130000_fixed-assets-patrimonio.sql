-- Patrimônio / Imobilizado — paridade Tutor32, módulo 3.
--
-- Módulo novo: cadastro de bens, depreciação linear (método único no MVP) e baixa.
-- A depreciação é calculada por VIEW (v_fixed_assets) em vez de razão mensal
-- materializado — simples, sempre consistente com a data atual, e suficiente pra
-- gestão. Vínculos opcionais com suppliers (origem da compra) e cost_centers
-- (alocação). Ganho/perda na baixa = valor de baixa − valor contábil residual.

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code text NOT NULL DEFAULT '',          -- nº de patrimônio / plaqueta
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',            -- Máquinas, Móveis, Veículos, Informática, Imóveis…
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  acquisition_date date NOT NULL DEFAULT current_date,
  acquisition_cost numeric NOT NULL DEFAULT 0,
  residual_value numeric NOT NULL DEFAULT 0,    -- valor residual estimado (não deprecia)
  useful_life_months integer NOT NULL DEFAULT 60, -- vida útil em meses (linear)
  status text NOT NULL DEFAULT 'ativo',         -- ativo | baixado
  disposal_date date,                            -- data da baixa
  disposal_value numeric NOT NULL DEFAULT 0,     -- valor obtido na baixa (venda/sucata)
  disposal_reason text DEFAULT '',
  notes text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON public.fixed_assets(status);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON public.fixed_assets(category);

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view fixed_assets" ON public.fixed_assets;
CREATE POLICY "Auth users can view fixed_assets" ON public.fixed_assets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert fixed_assets" ON public.fixed_assets;
CREATE POLICY "Auth users can insert fixed_assets" ON public.fixed_assets FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update fixed_assets" ON public.fixed_assets;
CREATE POLICY "Auth users can update fixed_assets" ON public.fixed_assets FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete fixed_assets" ON public.fixed_assets;
CREATE POLICY "Auth users can delete fixed_assets" ON public.fixed_assets FOR DELETE TO authenticated USING (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION public.set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_fixed_assets_updated_at ON public.fixed_assets;
CREATE TRIGGER trg_fixed_assets_updated_at
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- View com depreciação linear calculada até a data de referência
-- (data da baixa quando baixado; senão hoje).
CREATE OR REPLACE VIEW public.v_fixed_assets AS
WITH calc AS (
  SELECT
    fa.*,
    s.name AS supplier_name,
    cc.name AS cost_center_name,
    GREATEST(fa.acquisition_cost - fa.residual_value, 0) AS depreciable_base,
    COALESCE(fa.disposal_date, current_date) AS ref_date
  FROM public.fixed_assets fa
  LEFT JOIN public.suppliers s ON s.id = fa.supplier_id
  LEFT JOIN public.cost_centers cc ON cc.id = fa.cost_center_id
), m AS (
  SELECT
    calc.*,
    CASE WHEN ref_date <= acquisition_date THEN 0
         ELSE LEAST(
           (EXTRACT(YEAR FROM age(ref_date, acquisition_date)) * 12
            + EXTRACT(MONTH FROM age(ref_date, acquisition_date)))::int,
           useful_life_months)
    END AS months_elapsed,
    CASE WHEN useful_life_months > 0 THEN depreciable_base / useful_life_months ELSE 0 END AS monthly_depreciation
  FROM calc
)
SELECT
  m.*,
  LEAST(monthly_depreciation * months_elapsed, depreciable_base) AS accumulated_depreciation,
  acquisition_cost - LEAST(monthly_depreciation * months_elapsed, depreciable_base) AS book_value,
  (months_elapsed >= useful_life_months) AS fully_depreciated,
  CASE WHEN status = 'baixado'
    THEN disposal_value - (acquisition_cost - LEAST(monthly_depreciation * months_elapsed, depreciable_base))
    ELSE NULL END AS disposal_gain_loss
FROM m;
