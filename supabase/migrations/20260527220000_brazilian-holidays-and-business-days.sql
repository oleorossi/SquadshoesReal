-- Suporte a feriados nacionais brasileiros em add_business_days().
--
-- A versão anterior (20260429220000) só pulava sábados e domingos. Lead-times
-- de produção ficavam off ~10 dias úteis/ano por incluir feriados como dias
-- normais (Carnaval = 2 dias, Páscoa, Tiradentes, Trabalho, Independência,
-- Aparecida, Finados, Proclamação, Consciência Negra, Natal = ~10 dias).
--
-- Esta migration:
--   1. Cria tabela `holidays` com feriados nacionais 2024-2030
--   2. Atualiza add_business_days() para também pular feriados
--   3. Adiciona índice em (holiday_date)
--   4. Permite operadores adicionarem feriados regionais/customizados via UI
--      (RLS: SELECT aberto, mutações restritas a is_approved_user)

CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL,
  name text NOT NULL,
  scope text NOT NULL DEFAULT 'national',  -- national, state, municipal, custom
  optional boolean NOT NULL DEFAULT false,  -- true = ponto facultativo
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_date_name
  ON public.holidays(holiday_date, name);

CREATE INDEX IF NOT EXISTS idx_holidays_date
  ON public.holidays(holiday_date);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "holidays_select" ON public.holidays;
CREATE POLICY "holidays_select" ON public.holidays
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "holidays_mutate" ON public.holidays;
CREATE POLICY "holidays_mutate" ON public.holidays
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ============================================================
-- Seed: feriados nacionais brasileiros 2024-2030 (datas fixas + móveis)
-- Fontes: Lei nº 662/49, Lei nº 6.802/80, Lei nº 14.759/2023
-- ============================================================

INSERT INTO public.holidays (holiday_date, name, scope) VALUES
  -- Fixos (Lei 662/1949 + adições)
  ('2024-01-01', 'Confraternização Universal', 'national'),
  ('2024-04-21', 'Tiradentes', 'national'),
  ('2024-05-01', 'Dia do Trabalho', 'national'),
  ('2024-09-07', 'Independência do Brasil', 'national'),
  ('2024-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2024-11-02', 'Finados', 'national'),
  ('2024-11-15', 'Proclamação da República', 'national'),
  ('2024-11-20', 'Consciência Negra', 'national'),       -- Lei 14.759/2023
  ('2024-12-25', 'Natal', 'national'),
  -- Móveis 2024 (Páscoa = 31/03)
  ('2024-02-12', 'Carnaval', 'national'),
  ('2024-02-13', 'Carnaval', 'national'),
  ('2024-03-29', 'Sexta-feira Santa', 'national'),
  ('2024-05-30', 'Corpus Christi', 'national'),

  -- 2025 (Páscoa = 20/04)
  ('2025-01-01', 'Confraternização Universal', 'national'),
  ('2025-03-03', 'Carnaval', 'national'),
  ('2025-03-04', 'Carnaval', 'national'),
  ('2025-04-18', 'Sexta-feira Santa', 'national'),
  ('2025-04-21', 'Tiradentes', 'national'),
  ('2025-05-01', 'Dia do Trabalho', 'national'),
  ('2025-06-19', 'Corpus Christi', 'national'),
  ('2025-09-07', 'Independência do Brasil', 'national'),
  ('2025-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2025-11-02', 'Finados', 'national'),
  ('2025-11-15', 'Proclamação da República', 'national'),
  ('2025-11-20', 'Consciência Negra', 'national'),
  ('2025-12-25', 'Natal', 'national'),

  -- 2026 (Páscoa = 05/04)
  ('2026-01-01', 'Confraternização Universal', 'national'),
  ('2026-02-16', 'Carnaval', 'national'),
  ('2026-02-17', 'Carnaval', 'national'),
  ('2026-04-03', 'Sexta-feira Santa', 'national'),
  ('2026-04-21', 'Tiradentes', 'national'),
  ('2026-05-01', 'Dia do Trabalho', 'national'),
  ('2026-06-04', 'Corpus Christi', 'national'),
  ('2026-09-07', 'Independência do Brasil', 'national'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2026-11-02', 'Finados', 'national'),
  ('2026-11-15', 'Proclamação da República', 'national'),
  ('2026-11-20', 'Consciência Negra', 'national'),
  ('2026-12-25', 'Natal', 'national'),

  -- 2027 (Páscoa = 28/03)
  ('2027-01-01', 'Confraternização Universal', 'national'),
  ('2027-02-08', 'Carnaval', 'national'),
  ('2027-02-09', 'Carnaval', 'national'),
  ('2027-03-26', 'Sexta-feira Santa', 'national'),
  ('2027-04-21', 'Tiradentes', 'national'),
  ('2027-05-01', 'Dia do Trabalho', 'national'),
  ('2027-05-27', 'Corpus Christi', 'national'),
  ('2027-09-07', 'Independência do Brasil', 'national'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2027-11-02', 'Finados', 'national'),
  ('2027-11-15', 'Proclamação da República', 'national'),
  ('2027-11-20', 'Consciência Negra', 'national'),
  ('2027-12-25', 'Natal', 'national'),

  -- 2028 (Páscoa = 16/04)
  ('2028-01-01', 'Confraternização Universal', 'national'),
  ('2028-02-28', 'Carnaval', 'national'),
  ('2028-02-29', 'Carnaval', 'national'),
  ('2028-04-14', 'Sexta-feira Santa', 'national'),
  ('2028-04-21', 'Tiradentes', 'national'),
  ('2028-05-01', 'Dia do Trabalho', 'national'),
  ('2028-06-15', 'Corpus Christi', 'national'),
  ('2028-09-07', 'Independência do Brasil', 'national'),
  ('2028-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2028-11-02', 'Finados', 'national'),
  ('2028-11-15', 'Proclamação da República', 'national'),
  ('2028-11-20', 'Consciência Negra', 'national'),
  ('2028-12-25', 'Natal', 'national'),

  -- 2029 (Páscoa = 01/04)
  ('2029-01-01', 'Confraternização Universal', 'national'),
  ('2029-02-12', 'Carnaval', 'national'),
  ('2029-02-13', 'Carnaval', 'national'),
  ('2029-03-30', 'Sexta-feira Santa', 'national'),
  ('2029-04-21', 'Tiradentes', 'national'),
  ('2029-05-01', 'Dia do Trabalho', 'national'),
  ('2029-05-31', 'Corpus Christi', 'national'),
  ('2029-09-07', 'Independência do Brasil', 'national'),
  ('2029-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2029-11-02', 'Finados', 'national'),
  ('2029-11-15', 'Proclamação da República', 'national'),
  ('2029-11-20', 'Consciência Negra', 'national'),
  ('2029-12-25', 'Natal', 'national'),

  -- 2030 (Páscoa = 21/04)
  ('2030-01-01', 'Confraternização Universal', 'national'),
  ('2030-03-04', 'Carnaval', 'national'),
  ('2030-03-05', 'Carnaval', 'national'),
  ('2030-04-19', 'Sexta-feira Santa', 'national'),
  ('2030-04-21', 'Tiradentes', 'national'),
  ('2030-05-01', 'Dia do Trabalho', 'national'),
  ('2030-06-20', 'Corpus Christi', 'national'),
  ('2030-09-07', 'Independência do Brasil', 'national'),
  ('2030-10-12', 'Nossa Senhora Aparecida', 'national'),
  ('2030-11-02', 'Finados', 'national'),
  ('2030-11-15', 'Proclamação da República', 'national'),
  ('2030-11-20', 'Consciência Negra', 'national'),
  ('2030-12-25', 'Natal', 'national')
ON CONFLICT (holiday_date, name) DO NOTHING;

-- ============================================================
-- Helper: is_business_day(date)
-- ============================================================
DROP FUNCTION IF EXISTS public.is_business_day(p_date date) CASCADE;
CREATE OR REPLACE FUNCTION public.is_business_day(p_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_is_weekend boolean;
  v_is_holiday boolean;
BEGIN
  IF p_date IS NULL THEN RETURN NULL; END IF;
  v_is_weekend := EXTRACT(ISODOW FROM p_date) IN (6, 7);  -- 6=Sat, 7=Sun
  IF v_is_weekend THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.holidays
     WHERE holiday_date = p_date
       AND optional = false
  ) INTO v_is_holiday;
  RETURN NOT v_is_holiday;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_business_day(date) TO authenticated;

-- ============================================================
-- add_business_days agora pula feriados também (mantém assinatura)
-- ============================================================
DROP FUNCTION IF EXISTS public.add_business_days(p_start date, p_days int) CASCADE;
CREATE OR REPLACE FUNCTION public.add_business_days(p_start date, p_days int)
RETURNS date
LANGUAGE plpgsql
STABLE  -- mudou de IMMUTABLE para STABLE: depende do conteúdo da tabela holidays
SET search_path = public
AS $$
DECLARE
  v_date date := p_start;
  v_step int  := CASE WHEN p_days >= 0 THEN 1 ELSE -1 END;
  v_left int  := abs(p_days);
BEGIN
  IF p_start IS NULL THEN RETURN NULL; END IF;
  WHILE v_left > 0 LOOP
    v_date := v_date + v_step;
    IF public.is_business_day(v_date) THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_business_days(date, int) TO authenticated;

COMMENT ON FUNCTION public.add_business_days(date, int) IS
  'Adiciona p_days dias úteis a p_start. Pula sábados, domingos e feriados nacionais (tabela holidays). STABLE pois depende do conteúdo de holidays.';
