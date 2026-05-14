-- Períodos de ponto cadastráveis (Bloco A da reformulação do controle de ponto).
-- O relógio grava no máximo de 30 em 30 dias. Em vez de digitar datas toda vez,
-- o usuário cadastra o período UMA vez e depois seleciona da lista.
CREATE TABLE IF NOT EXISTS public.timesheet_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','importado','fechado')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_periods_date_order CHECK (end_date >= start_date),
  CONSTRAINT timesheet_periods_max_30d CHECK (end_date - start_date <= 31)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_periods_range
  ON public.timesheet_periods(start_date, end_date);

ALTER TABLE public.timesheet_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_periods_select ON public.timesheet_periods;
CREATE POLICY timesheet_periods_select ON public.timesheet_periods
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS timesheet_periods_write ON public.timesheet_periods;
CREATE POLICY timesheet_periods_write ON public.timesheet_periods
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','rh']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','rh']));

ALTER TABLE public.time_import_logs
  ADD COLUMN IF NOT EXISTS period_id uuid REFERENCES public.timesheet_periods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_import_logs_period
  ON public.time_import_logs(period_id) WHERE period_id IS NOT NULL;

COMMENT ON TABLE public.timesheet_periods IS
  'Períodos de apuração de ponto cadastrados uma vez e reutilizados nas telas de importação e HE. Relógio grava no máx 30 dias por isso o CHECK de 31.';

CREATE OR REPLACE FUNCTION public.tg_timesheet_periods_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS tg_timesheet_periods_updated_at ON public.timesheet_periods;
CREATE TRIGGER tg_timesheet_periods_updated_at
  BEFORE UPDATE ON public.timesheet_periods
  FOR EACH ROW EXECUTE FUNCTION public.tg_timesheet_periods_updated_at();
