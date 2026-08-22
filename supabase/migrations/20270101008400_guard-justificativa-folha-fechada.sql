-- Impede que justificativas alterem retroativamente uma folha aprovada/paga.
-- A trava existe também na UI, mas precisa morar no banco para cobrir qualquer
-- outro cliente, aba antiga ou chamada direta à API.

CREATE OR REPLACE FUNCTION public.guard_employee_absence_closed_payroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict record;
BEGIN
  -- UPDATE/DELETE: remover ou deslocar uma justificativa que participou de uma
  -- folha fechada também é alteração retroativa, mesmo que o novo intervalo
  -- fique fora do período.
  IF TG_OP <> 'INSERT' THEN
    SELECT pr.period, pr.status
      INTO v_conflict
      FROM public.payroll_runs pr
     WHERE pr.employee_id = OLD.employee_id
       AND pr.status IN ('aprovado', 'pago')
       AND CASE
         WHEN pr.period ~ '^\d{4}-\d{2}$' THEN
           daterange(
             (pr.period || '-01')::date,
             ((pr.period || '-01')::date + interval '1 month')::date,
             '[)'
           )
         WHEN pr.period ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$' THEN
           daterange(
             split_part(pr.period, '_', 1)::date,
             split_part(pr.period, '_', 2)::date + 1,
             '[)'
           )
         ELSE 'empty'::daterange
       END && daterange(OLD.start_date::date, OLD.end_date::date + 1, '[)')
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Folha do período % já % — desfaça o fechamento antes de alterar a justificativa.',
        v_conflict.period,
        CASE WHEN v_conflict.status = 'pago' THEN 'paga' ELSE 'aprovada' END;
    END IF;
  END IF;

  -- INSERT/UPDATE: também impede criar ou mover uma justificativa para dentro
  -- de uma folha já fechada. O daterange usa fim exclusivo, por isso + 1 dia.
  IF TG_OP <> 'DELETE' THEN
    SELECT pr.period, pr.status
      INTO v_conflict
      FROM public.payroll_runs pr
     WHERE pr.employee_id = NEW.employee_id
       AND pr.status IN ('aprovado', 'pago')
       AND CASE
         WHEN pr.period ~ '^\d{4}-\d{2}$' THEN
           daterange(
             (pr.period || '-01')::date,
             ((pr.period || '-01')::date + interval '1 month')::date,
             '[)'
           )
         WHEN pr.period ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$' THEN
           daterange(
             split_part(pr.period, '_', 1)::date,
             split_part(pr.period, '_', 2)::date + 1,
             '[)'
           )
         ELSE 'empty'::daterange
       END && daterange(NEW.start_date::date, NEW.end_date::date + 1, '[)')
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Folha do período % já % — desfaça o fechamento antes de alterar a justificativa.',
        v_conflict.period,
        CASE WHEN v_conflict.status = 'pago' THEN 'paga' ELSE 'aprovada' END;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_absence_closed_payroll
  ON public.employee_absences;

CREATE TRIGGER trg_guard_employee_absence_closed_payroll
BEFORE INSERT OR UPDATE OR DELETE ON public.employee_absences
FOR EACH ROW
EXECUTE FUNCTION public.guard_employee_absence_closed_payroll();
