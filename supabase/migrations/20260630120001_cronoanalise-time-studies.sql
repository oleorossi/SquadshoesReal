-- Cronoanálise (time study) — Tutor32 parity, módulo 1.
--
-- Contexto: o sistema JÁ tem tempo-padrão em bom_operations.standard_time_minutes
-- (consumido por calculate_order_cost para o MOD). O que faltava era a CAMADA DE
-- CRONOANÁLISE: capturar N ciclos cronometrados de uma operação, aplicar ritmo
-- (avaliação do operador) e tolerância PF&D (pessoais, fadiga, demoras) para DERIVAR
-- cientificamente o tempo-padrão — em vez de digitar um número solto. Esta migration
-- adiciona a tabela de estudos + RPC que joga o resultado de volta no bom_operations,
-- mantendo o custeio existente como fonte única (sem criar 4º motor de PCP).

CREATE TABLE IF NOT EXISTS public.time_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  -- vínculo opcional com a operação do BOM que este estudo alimenta. SET NULL pra
  -- não perder o histórico de cronoanálise se a operação for removida.
  bom_operation_id uuid REFERENCES public.bom_operations(id) ON DELETE SET NULL,
  operation_name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT '',                 -- setor (PRODUCTION_STAGES)
  -- ciclos observados, EM SEGUNDOS (operador cronometra em s; convertemos pra min).
  cycles_seconds numeric[] NOT NULL DEFAULT '{}',
  -- média dos ciclos, calculada no app e persistida (array agg não é imutável o
  -- suficiente pra coluna gerada de forma portável; manter como entrada simples).
  observed_avg_seconds numeric NOT NULL DEFAULT 0,
  rating_pct numeric NOT NULL DEFAULT 100,        -- ritmo/avaliação: 100 = normal
  allowance_pct numeric NOT NULL DEFAULT 15,      -- tolerância PF&D
  cost_per_hour numeric NOT NULL DEFAULT 0,       -- R$/h do recurso (operador+máquina)

  -- nº de amostras (cardinalidade do array)
  sample_size integer GENERATED ALWAYS AS (cardinality(cycles_seconds)) STORED,
  -- tempo normal (min) = média_obs(s) × ritmo/100 ÷ 60
  normal_time_minutes numeric GENERATED ALWAYS AS
    ((observed_avg_seconds * rating_pct / 100.0) / 60.0) STORED,
  -- tempo-padrão (min) = tempo normal × (1 + tolerância/100)
  standard_time_minutes numeric GENERATED ALWAYS AS
    ((observed_avg_seconds * rating_pct / 100.0) / 60.0 * (1 + allowance_pct / 100.0)) STORED,
  -- custo por minuto = R$/h ÷ 60
  cost_per_minute numeric GENERATED ALWAYS AS (cost_per_hour / 60.0) STORED,
  -- custo por par = tempo-padrão(min) × custo/min
  cost_per_pair numeric GENERATED ALWAYS AS
    ((observed_avg_seconds * rating_pct / 100.0) / 60.0 * (1 + allowance_pct / 100.0)
      * cost_per_hour / 60.0) STORED,

  observed_by text DEFAULT '',
  observed_at date NOT NULL DEFAULT current_date,
  notes text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_studies_sheet ON public.time_studies(sheet_id);
CREATE INDEX IF NOT EXISTS idx_time_studies_stage ON public.time_studies(stage);

ALTER TABLE public.time_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view time_studies" ON public.time_studies;
CREATE POLICY "Auth users can view time_studies" ON public.time_studies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert time_studies" ON public.time_studies;
CREATE POLICY "Auth users can insert time_studies" ON public.time_studies FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update time_studies" ON public.time_studies;
CREATE POLICY "Auth users can update time_studies" ON public.time_studies FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete time_studies" ON public.time_studies;
CREATE POLICY "Auth users can delete time_studies" ON public.time_studies FOR DELETE TO authenticated USING (true);

-- updated_at automático (reaproveita set_updated_at() se existir; senão cria inline)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION public.set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_time_studies_updated_at ON public.time_studies;
CREATE TRIGGER trg_time_studies_updated_at
  BEFORE UPDATE ON public.time_studies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RPC: aplica o tempo-padrão derivado de volta no bom_operations (fonte do custeio).
-- Atualiza a operação vinculada se houver; senão faz upsert por (sheet, nome, setor).
CREATE OR REPLACE FUNCTION public.apply_time_study_to_bom(p_study_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_study public.time_studies%ROWTYPE;
  v_op_id uuid;
BEGIN
  SELECT * INTO v_study FROM public.time_studies WHERE id = p_study_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cronoanálise % não encontrada', p_study_id;
  END IF;

  v_op_id := v_study.bom_operation_id;

  -- se não há vínculo, tenta casar por (sheet, operation_name, stage)
  IF v_op_id IS NULL THEN
    SELECT id INTO v_op_id
      FROM public.bom_operations
     WHERE sheet_id = v_study.sheet_id
       AND operation_name = v_study.operation_name
       AND stage = v_study.stage
     LIMIT 1;
  END IF;

  IF v_op_id IS NULL THEN
    INSERT INTO public.bom_operations
      (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour, notes)
    VALUES
      (v_study.sheet_id, v_study.operation_name, v_study.stage,
       v_study.standard_time_minutes, v_study.cost_per_hour,
       'Gerado por cronoanálise')
    RETURNING id INTO v_op_id;
  ELSE
    UPDATE public.bom_operations
       SET standard_time_minutes = v_study.standard_time_minutes,
           cost_per_hour = v_study.cost_per_hour,
           updated_at = now()
     WHERE id = v_op_id;
  END IF;

  -- amarra o estudo à operação resultante pra próxima aplicação ser idempotente
  UPDATE public.time_studies SET bom_operation_id = v_op_id WHERE id = p_study_id;

  RETURN v_op_id;
END;
$$;

-- View: custo por minuto agregado por setor (entrada do "custo/min" gerencial).
CREATE OR REPLACE VIEW public.v_sector_cost_per_minute AS
SELECT
  stage,
  count(*)                              AS study_count,
  round(avg(cost_per_minute), 4)        AS avg_cost_per_minute,
  round(avg(standard_time_minutes), 3)  AS avg_standard_time_minutes,
  round(avg(cost_per_pair), 4)          AS avg_cost_per_pair,
  round(avg(rating_pct), 1)             AS avg_rating_pct,
  round(avg(allowance_pct), 1)          AS avg_allowance_pct
FROM public.time_studies
WHERE active
GROUP BY stage;
