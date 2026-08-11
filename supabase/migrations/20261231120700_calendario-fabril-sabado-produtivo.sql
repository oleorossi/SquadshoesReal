-- ════════════════════════════════════════════════════════════════════════════
-- Calendário fabril: nem todo sábado a fábrica para.
--
-- Até aqui o sistema assumia ZERO sábados produtivos — `is_business_day` tinha
-- `EXTRACT(ISODOW) IN (6,7) → false` fixo, e o espelho TS
-- (`sectorCapacity.isBusinessDay`) fazia o mesmo com `dow === 6`. Quando a
-- fábrica trabalha num sábado, todo lead time e todo plano de capacidade
-- empurram a produção um dia para frente sem motivo.
--
-- Decisão do dono (Q2 do grill-me de 10/08/2026): estender `holidays` em vez de
-- criar tabela nova de calendário.
--
-- ⚠ O RISCO DESSA ESCOLHA, e como ele é contido: `holidays` NÃO é só de
-- produção — é lida por RH/ponto (`useTimesheet` lista/edita, `KPIsRH` conta) com
-- semântica de FOLHA. Uma linha "sábado produtivo" solta ali viraria feriado no
-- espelho de ponto e geraria hora extra fantasma. Por isso a coluna nova é
-- explícita (`is_working_day`) e os leitores de RH passam a filtrá-la — a
-- mudança no TS acompanha esta migration no MESMO commit.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. A coluna ─────────────────────────────────────────────────────────────
ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS is_working_day boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.holidays.is_working_day IS
  'true = DIA ÚTIL EXCEPCIONAL da fábrica (ex.: sábado em que se trabalha). '
  'Inverte a regra do fim de semana em is_business_day(). NÃO é feriado: quem '
  'lê holidays com semântica de folha (RH/ponto) precisa filtrar is_working_day = false.';

-- Linha não pode ser as duas coisas: "feriado facultativo" e "dia útil extra"
-- são estados opostos, e a combinação tornaria is_business_day ambígua.
ALTER TABLE public.holidays
  DROP CONSTRAINT IF EXISTS holidays_working_day_nao_e_facultativo;
ALTER TABLE public.holidays
  ADD CONSTRAINT holidays_working_day_nao_e_facultativo
  CHECK (NOT (is_working_day AND COALESCE(optional, false)));

-- ── 2. is_business_day passa a honrar o dia útil excepcional ────────────────
-- Precedência: dia útil excepcional VENCE o fim de semana; feriado não
-- facultativo derruba o dia; senão vale a regra normal.
CREATE OR REPLACE FUNCTION public.is_business_day(p_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_forcado  boolean;
  v_feriado  boolean;
BEGIN
  IF p_date IS NULL THEN RETURN NULL; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.holidays
     WHERE holiday_date = p_date
       AND is_working_day = true
  ) INTO v_forcado;

  IF v_forcado THEN
    RETURN true;                      -- sábado produtivo vence o fim de semana
  END IF;

  IF EXTRACT(ISODOW FROM p_date) IN (6, 7) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.holidays
     WHERE holiday_date = p_date
       AND optional = false
       AND is_working_day = false
  ) INTO v_feriado;

  RETURN NOT v_feriado;
END;
$function$;

-- ── 3. biz_days_between deixa de duplicar a regra ───────────────────────────
-- Ela reimplementava dia útil por conta própria (`DOW NOT IN (0,6)`), sem
-- honrar `optional` e agora sem honrar o sábado produtivo. Passa a delegar,
-- para não existirem duas definições de "dia útil" no mesmo banco.
CREATE OR REPLACE FUNCTION public.biz_days_between(p_start date, p_end date)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(1, COUNT(*)::int)
    FROM generate_series(p_start, p_end, INTERVAL '1 day') d
   WHERE public.is_business_day(d::date)
$function$;

-- ── 4. Índice para a consulta que is_business_day faz por data ──────────────
CREATE INDEX IF NOT EXISTS idx_holidays_date_working
  ON public.holidays (holiday_date, is_working_day);
