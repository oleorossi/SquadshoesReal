-- =============================================================================
-- ENGINE DE CAPACIDADE & PRODUTIVIDADE POR MODELO (specs/produtividade-por-modelo.md)
-- PARTE 1/3: parâmetros globais + headcount por setor.
--
--   • capacity_parameters — singleton com jornada/eficiência/dias úteis usados
--     pela conversão min/par → pares/dia. Jornada semeada da MESMA expressão do
--     generate_bom_operations (work_schedules.is_default), pra min↔pares baterem.
--   • sector_settings.headcount — pessoas por setor CONSUMIDAS pelo cálculo
--     (numeric: aceita 0,5 pra pessoa dividida entre setores — gate G4).
--     [Δ spec] Mora em sector_settings (dono único da config por setor) em vez
--     de tabela própria, pra não driftar de team_size/daily_capacity_pairs.
-- =============================================================================

-- 1) capacity_parameters (singleton) ------------------------------------------
CREATE TABLE IF NOT EXISTS public.capacity_parameters (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  journey_minutes        numeric NOT NULL DEFAULT 540
                         CHECK (journey_minutes >= 60 AND journey_minutes <= 720),
  efficiency_pct         numeric NOT NULL DEFAULT 85
                         CHECK (efficiency_pct > 0 AND efficiency_pct <= 100),
  working_days_per_month numeric NOT NULL DEFAULT 22
                         CHECK (working_days_per_month >= 1 AND working_days_per_month <= 31),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NULL DEFAULT auth.uid()
);

-- Seed: jornada real da escala default (mesma expressão do generate_bom_operations),
-- com clamp por range: escala fora de [60,720] (turno noturno cruzando meia-noite,
-- jornada absurda) cai pro 540 em vez de violar o CHECK e abortar o db push.
INSERT INTO public.capacity_parameters (id, journey_minutes)
SELECT true, CASE WHEN j.v >= 60 AND j.v <= 720 THEN j.v ELSE 540 END
  FROM (
    SELECT COALESCE((
      SELECT round(extract(epoch from (exit_time - entry_time
               - coalesce(lunch_end - lunch_start, interval '0'))) / 60)
        FROM work_schedules WHERE is_default ORDER BY created_at LIMIT 1
    ), 540) AS v
  ) j
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.capacity_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_capacity_parameters ON public.capacity_parameters;
CREATE POLICY approved_select_capacity_parameters
  ON public.capacity_parameters FOR SELECT USING (public.is_approved_user());
DROP POLICY IF EXISTS approved_update_capacity_parameters ON public.capacity_parameters;
CREATE POLICY approved_update_capacity_parameters
  ON public.capacity_parameters FOR UPDATE
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
-- Singleton: sem policy de INSERT/DELETE (a linha é fixa, criada pelo seed).

-- 2) sector_settings.headcount ------------------------------------------------
ALTER TABLE public.sector_settings
  ADD COLUMN IF NOT EXISTS headcount numeric NULL
  CHECK (headcount IS NULL OR headcount >= 0);

-- Backfill: parte do team_size informativo já preenchido (onde houver).
UPDATE public.sector_settings
   SET headcount = team_size
 WHERE headcount IS NULL AND team_size IS NOT NULL;
