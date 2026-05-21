-- =============================================================================
-- Punch Clock — parâmetros versionados (Planejamento Migração Ponto, 2026-05)
-- =============================================================================
-- Tabela de parâmetros chave→valor com VIGÊNCIA temporal. Mudanças retroativas
-- (ex: subir tolerância de 10 pra 15 min em 2027) NÃO afetam cálculos antigos —
-- a função get_punch_clock_param(key, ref_date) retorna o valor que estava
-- vigente NA data do cálculo.
--
-- Cenário motivador (docx seção 7.5):
--   "Tabela parametro: chave, valor, vigencia_inicio, vigencia_fim — para que
--    mudanças retroativas não afetem cálculos antigos."
--
-- Esta camada complementa as RPCs existentes (calculate_day_summary,
-- calculate_employee_bank_balance) — elas continuam recebendo parâmetros
-- explicitamente; cabe ao caller buscar com get_punch_clock_param.
-- =============================================================================

-- ── 1. Tabela punch_clock_params ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.punch_clock_params (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  param_key       text NOT NULL,
  /** Valor JSON. Para escalares simples use { "value": N }. */
  value           jsonb NOT NULL,
  valid_from      date NOT NULL,
  valid_to        date,                              -- NULL = vigente
  description     text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- A mesma chave não pode ter 2 ranges sobrepostos vigentes.
  -- Validação simples: índice único parcial pra (key, valid_from) e
  -- assume que o gestor fecha valid_to do range anterior antes de abrir
  -- novo (= snapshot estilo SCD2).
  CONSTRAINT punch_clock_params_value_obj CHECK (jsonb_typeof(value) IN ('object', 'number', 'string', 'boolean'))
);

CREATE INDEX IF NOT EXISTS idx_pc_params_key_validfrom
  ON public.punch_clock_params(param_key, valid_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_params_key_validfrom_uniq
  ON public.punch_clock_params(param_key, valid_from);

ALTER TABLE public.punch_clock_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view punch clock params" ON public.punch_clock_params;
CREATE POLICY "Auth users can view punch clock params"
  ON public.punch_clock_params FOR SELECT TO authenticated USING (true);

-- Inserts/updates restritos a admin/RH (perfil já existente nas company_settings).
-- Aqui simplificamos pra authenticated — a app valida role no client.
DROP POLICY IF EXISTS "Auth users can insert punch clock params" ON public.punch_clock_params;
CREATE POLICY "Auth users can insert punch clock params"
  ON public.punch_clock_params FOR INSERT TO authenticated WITH CHECK (true);


-- ── 2. RPC get_punch_clock_param: valor vigente em data ──────────────────────

DROP FUNCTION IF EXISTS public.get_punch_clock_param(text, date);
CREATE OR REPLACE FUNCTION public.get_punch_clock_param(
  p_key       text,
  p_ref_date  date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT value
    FROM public.punch_clock_params
   WHERE param_key  = p_key
     AND valid_from <= p_ref_date
     AND (valid_to IS NULL OR valid_to >= p_ref_date)
   ORDER BY valid_from DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_punch_clock_param(text, date) TO authenticated;


-- ── 3. Helper: get_punch_clock_param_int (extrai valor escalar) ──────────────

DROP FUNCTION IF EXISTS public.get_punch_clock_param_int(text, date, int);
CREATE OR REPLACE FUNCTION public.get_punch_clock_param_int(
  p_key       text,
  p_ref_date  date DEFAULT CURRENT_DATE,
  p_default   int  DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
  v_int int;
BEGIN
  v := public.get_punch_clock_param(p_key, p_ref_date);
  IF v IS NULL THEN RETURN p_default; END IF;
  -- Aceita { "value": N } OU número direto N
  IF jsonb_typeof(v) = 'object' AND v ? 'value' THEN
    v_int := (v->>'value')::int;
  ELSE
    v_int := (v#>>'{}')::int;
  END IF;
  RETURN v_int;
EXCEPTION WHEN OTHERS THEN
  RETURN p_default;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_punch_clock_param_int(text, date, int) TO authenticated;


-- ── 4. Seed: parâmetros iniciais do PLANO (vigentes desde 2025-01-01) ────────

INSERT INTO public.punch_clock_params (param_key, value, valid_from, description)
VALUES
  ('weekday_expected_minutes', '480'::jsonb, '2025-01-01',
   'Jornada esperada por dia útil (seg-sex). 8h padrão CLT.'),
  ('saturday_expected_minutes', '240'::jsonb, '2025-01-01',
   'Jornada esperada por sábado. 4h padrão (8h48 × 5d alternativo).'),
  ('tolerance_minutes', '10'::jsonb, '2025-01-01',
   'Tolerância CLT art. 58 §1º — faltante ≤ 10min zera.'),
  ('weekly_hours', '44'::jsonb, '2025-01-01',
   'Jornada semanal em horas (CLT art. 7º XIII).'),
  ('minimum_overtime_minutes', '10'::jsonb, '2025-01-01',
   'HE mínima a creditar — diff acima da tolerância e abaixo deste valor zera.')
ON CONFLICT (param_key, valid_from) DO NOTHING;


-- ── 5. View vw_punch_clock_params_current: parâmetros vigentes hoje ──────────

CREATE OR REPLACE VIEW public.vw_punch_clock_params_current AS
SELECT DISTINCT ON (param_key)
  param_key,
  value,
  valid_from,
  valid_to,
  description
FROM public.punch_clock_params
WHERE valid_from <= CURRENT_DATE
  AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
ORDER BY param_key, valid_from DESC;

GRANT SELECT ON public.vw_punch_clock_params_current TO authenticated;


COMMENT ON TABLE public.punch_clock_params IS
  'Parâmetros versionados do sistema de ponto. Usar get_punch_clock_param(key, ref_date) ou get_punch_clock_param_int para recuperar valor vigente na data de cálculo. Chaves padrão: weekday_expected_minutes, saturday_expected_minutes, tolerance_minutes, weekly_hours, minimum_overtime_minutes.';
