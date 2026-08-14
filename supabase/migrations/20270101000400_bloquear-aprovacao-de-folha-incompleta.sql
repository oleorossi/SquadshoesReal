-- Fecha a última brecha do fluxo de folha: rascunho pode ser parcial para
-- conferência, mas nunca pode virar pagamento enquanto os dados financeiros não
-- estiverem completos. A regra é server-side para não depender da tela.
CREATE OR REPLACE FUNCTION public.tg_payroll_block_incomplete_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_range daterange;
  v_last_clock_day date;
  v_payment_type text;
  v_schedule_id uuid;
  v_external_id text;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'rascunho' OR NEW.status NOT IN ('aprovado', 'pago') THEN
    RETURN NEW;
  END IF;

  IF coalesce((NEW.calculation_snapshot->'result'->>'pending_days')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'Folha possui batidas pendentes. Resolva o ponto antes de aprovar.';
  END IF;
  IF coalesce((NEW.calculation_snapshot->'result'->>'he_rate_missing')::boolean, false) THEN
    RAISE EXCEPTION 'Folha possui hora extra sem taxa financeira cadastrada.';
  END IF;

  SELECT lower(coalesce(payment_type, 'mensalista')), work_schedule_id, nullif(trim(external_id), '')
    INTO v_payment_type, v_schedule_id, v_external_id
    FROM public.employees WHERE id = NEW.employee_id;

  -- Produção por par e remoto não dependem do relógio para formar a folha.
  IF v_payment_type IN ('mensalista', 'diarista') THEN
    IF v_schedule_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem jornada própria. Cadastre a jornada antes de aprovar a folha.';
    END IF;
    IF v_external_id IS NULL THEN
      RAISE EXCEPTION 'Funcionário sem matrícula do relógio. Cadastre a matrícula antes de aprovar a folha.';
    END IF;
    v_range := public.payroll_period_range(NEW.period);
    SELECT max(record_date) INTO v_last_clock_day
      FROM public.time_records
     WHERE record_date <@ v_range
       AND jsonb_array_length(coalesce(punches, '[]'::jsonb)) > 0;
    IF v_range IS NOT NULL AND (v_last_clock_day IS NULL OR v_last_clock_day < upper(v_range)::date - 1) THEN
      RAISE EXCEPTION 'Ponto incompleto até o fim do período. Importe as batidas restantes antes de aprovar.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aa_payroll_block_incomplete_approval ON public.payroll_runs;
CREATE TRIGGER trg_aa_payroll_block_incomplete_approval
  BEFORE UPDATE OF status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_block_incomplete_approval();
