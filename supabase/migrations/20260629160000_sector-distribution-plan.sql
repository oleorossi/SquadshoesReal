-- Capacidade dinâmica — Fase B: persistência da distribuição diária + greedy
--
-- Tabela sector_distribution_plan: 1 row por (week_start, sector, tech_sheet_id,
-- day_of_week) com pairs_planned. Gestor edita ou usa auto-fill greedy.
--
-- Function auto_fill_sector_distribution(week_start): para cada (sector, ref)
-- na demanda da semana, distribui qty greedy nos 5 dias úteis respeitando
-- daily_capacity da ref naquele setor. Sobrescreve qualquer plano anterior
-- não-locked daquela semana.

CREATE TABLE IF NOT EXISTS public.sector_distribution_plan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start      date NOT NULL,
  sector          text NOT NULL CHECK (sector IN (
    'Corte Palmilha', 'Corte Forração', 'Costura', 'Aviamento', 'Silk',
    'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'
  )),
  tech_sheet_id   uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  day_of_week     int  NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  pairs_planned   int  NOT NULL CHECK (pairs_planned >= 0),
  is_locked       boolean NOT NULL DEFAULT false,
  source          text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  UNIQUE(week_start, sector, tech_sheet_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_sdp_week ON public.sector_distribution_plan(week_start);
CREATE INDEX IF NOT EXISTS idx_sdp_sector_week ON public.sector_distribution_plan(sector, week_start);
CREATE INDEX IF NOT EXISTS idx_sdp_ref ON public.sector_distribution_plan(tech_sheet_id);

-- Trigger pra updated_at
CREATE OR REPLACE FUNCTION public.tg_sdp_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS sdp_updated_at ON public.sector_distribution_plan;
CREATE TRIGGER sdp_updated_at BEFORE UPDATE ON public.sector_distribution_plan
  FOR EACH ROW EXECUTE FUNCTION public.tg_sdp_set_updated_at();

ALTER TABLE public.sector_distribution_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sdp_select ON public.sector_distribution_plan;
CREATE POLICY sdp_select ON public.sector_distribution_plan
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sdp_insert ON public.sector_distribution_plan;
CREATE POLICY sdp_insert ON public.sector_distribution_plan
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS sdp_update ON public.sector_distribution_plan;
CREATE POLICY sdp_update ON public.sector_distribution_plan
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS sdp_delete ON public.sector_distribution_plan;
CREATE POLICY sdp_delete ON public.sector_distribution_plan
  FOR DELETE TO authenticated USING (true);

-- ── Greedy auto-fill: distribui demanda da semana nos 5 dias úteis ──────────
-- Algoritmo: para cada sector × ref ordenados por (refs_count DESC, qty DESC):
--   1. Calcula min(qty restante, capacidade_dia da ref naquele setor)
--   2. Coloca no primeiro dia que ainda tem espaço (budget restante > 0)
--   3. Avança próximo dia quando enche, sobra fica em dia 5+ (não há, então
--      pode sobrar — flag bottleneck no return)
-- Não toca rows is_locked=true (gestor já fixou).
CREATE OR REPLACE FUNCTION public.auto_fill_sector_distribution(p_week_start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_sector text;
  v_record record;
  v_day int;
  v_remaining int;
  v_cap_today int;
  v_alloc int;
  -- budget por (sector, day_of_week)
  v_day_budget jsonb;
  v_day_used int;
  v_bottlenecks jsonb := '[]'::jsonb;
  v_inserts int := 0;
  v_locked_kept int := 0;
BEGIN
  -- Limpa plano auto/non-locked da semana (preserva edições manuais e locks)
  DELETE FROM public.sector_distribution_plan
   WHERE week_start = p_week_start
     AND is_locked = false
     AND source = 'auto';

  -- Para cada sector que tem demanda na semana
  FOR v_sector IN
    SELECT DISTINCT sector_unnest
      FROM (
        SELECT unnest(ARRAY[
          'Corte Palmilha','Corte Forração','Costura','Aviamento','Silk',
          'Colagem','Montagem','Solagem','Acabamento','Expedição'
        ]) AS sector_unnest
      ) sectors
  LOOP
    -- Para cada referência demandada nesse setor, ordenada por qty DESC (maiores primeiro)
    FOR v_record IN
      SELECT
        slbr.tech_sheet_id,
        slbr.total_qty,
        CASE v_sector
          WHEN 'Corte Palmilha' THEN slbr.cap_corte_palmilha
          WHEN 'Corte Forração' THEN slbr.cap_corte_forracao
          WHEN 'Costura'        THEN slbr.cap_costura
          WHEN 'Aviamento'      THEN slbr.cap_aviamento
          WHEN 'Silk'           THEN slbr.cap_silk
          WHEN 'Colagem'        THEN slbr.cap_colagem
          WHEN 'Montagem'       THEN slbr.cap_montagem
          WHEN 'Solagem'        THEN slbr.cap_solagem
          WHEN 'Acabamento'     THEN slbr.cap_acabamento
          WHEN 'Expedição'      THEN slbr.cap_expedicao
        END AS daily_cap
      FROM public.v_sector_load_by_reference slbr
      WHERE slbr.week_start = p_week_start
      ORDER BY slbr.total_qty DESC
    LOOP
      -- Pula se ref não passa por esse setor (capacidade 0 = não faz)
      IF v_record.daily_cap IS NULL OR v_record.daily_cap = 0 THEN
        CONTINUE;
      END IF;

      v_remaining := v_record.total_qty;
      v_day := 1;

      -- Greedy: encher dia a dia até acabar a qty ou estourar a semana
      WHILE v_remaining > 0 AND v_day <= 5 LOOP
        -- Quanto cabe nesse dia: min(remaining, daily_cap, espaço sobrando no dia)
        SELECT COALESCE(SUM(pairs_planned), 0) INTO v_day_used
          FROM public.sector_distribution_plan
         WHERE week_start = p_week_start AND sector = v_sector AND day_of_week = v_day;

        -- Cada ref consome (qty/cap) do dia. O "dia" tem orçamento 1 (100%).
        -- Espaço sobrando do dia em termos de pares-equivalentes desta ref:
        --   v_cap_today = daily_cap * (1 - day_used/daily_cap_pondered)
        -- Simplificação: cap_today = max(0, daily_cap - day_used) — vale quando
        -- todas as refs do setor têm cap similar. Pra refs com caps muito
        -- diferentes, isso pode subestimar o orçamento; aceitável em v1.
        v_cap_today := GREATEST(0, v_record.daily_cap - v_day_used);
        v_alloc := LEAST(v_remaining, v_cap_today);

        IF v_alloc > 0 THEN
          INSERT INTO public.sector_distribution_plan
            (week_start, sector, tech_sheet_id, day_of_week, pairs_planned, source)
          VALUES
            (p_week_start, v_sector, v_record.tech_sheet_id, v_day, v_alloc, 'auto');
          v_inserts := v_inserts + 1;
          v_remaining := v_remaining - v_alloc;
        END IF;

        v_day := v_day + 1;
      END LOOP;

      -- Se sobrou qty depois dos 5 dias = bottleneck
      IF v_remaining > 0 THEN
        v_bottlenecks := v_bottlenecks || jsonb_build_object(
          'sector', v_sector,
          'tech_sheet_id', v_record.tech_sheet_id,
          'unallocated_pairs', v_remaining,
          'requested_pairs', v_record.total_qty,
          'daily_capacity', v_record.daily_cap
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Conta rows locked que preservamos
  SELECT COUNT(*)::int INTO v_locked_kept
    FROM public.sector_distribution_plan
   WHERE week_start = p_week_start AND is_locked = true;

  RETURN jsonb_build_object(
    'week_start', p_week_start,
    'inserts', v_inserts,
    'locked_preserved', v_locked_kept,
    'bottlenecks', v_bottlenecks,
    'algorithm', 'greedy_by_qty_desc_v1'
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.auto_fill_sector_distribution(date) TO authenticated;

COMMENT ON FUNCTION public.auto_fill_sector_distribution(date) IS
  'Distribui demanda da semana entre os 5 dias úteis usando greedy por qty desc. Respeita is_locked. Retorna bottlenecks.';
