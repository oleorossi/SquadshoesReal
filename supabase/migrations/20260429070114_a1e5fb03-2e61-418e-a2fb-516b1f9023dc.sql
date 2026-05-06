
-- =============================================================================
-- Reordenação do fluxo de ondas + Modo de palmilha por solado
-- =============================================================================

-- 1) Reordenar stages: Mesa(1)‖Corte(1) → Palmilha(2)‖Costura(2) → Montagem(3) → Solagem(4) → Acabamento(5)
DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 1
    WHEN 'palmilha'   THEN 2
    WHEN 'costura'    THEN 2
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- 2) Modo de palmilha definido no SOLADO (não na ficha técnica)
--    'cortar'        = consome dm² de placas (default)
--    'pronta_na_cor' = consome por par/numeração (igual solado, segue grade)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'insole_mode_enum') THEN
    CREATE TYPE public.insole_mode_enum AS ENUM ('cortar', 'pronta_na_cor');
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS insole_mode public.insole_mode_enum NOT NULL DEFAULT 'cortar';

COMMENT ON COLUMN public.products.insole_mode IS
  'Aplica-se a SOLADOS: define como a palmilha vinculada será debitada. cortar=dm² de placa; pronta_na_cor=par/numeração seguindo grade.';

-- 3) Helper para resolver o modo de palmilha a partir do produto-solado
DROP FUNCTION IF EXISTS public.get_insole_mode(p_sole_product_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_insole_mode(p_sole_product_id uuid)
RETURNS public.insole_mode_enum
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(insole_mode, 'cortar'::public.insole_mode_enum)
    FROM public.products
   WHERE id = p_sole_product_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_insole_mode(uuid) TO authenticated;
