-- Ciclo de vínculo do funcionário.
--
-- A data de demissão é o último dia trabalhado e precisa ter duas propriedades:
--   1. o cadastro corrente fica inativo imediatamente;
--   2. registros de ponto e folhas históricas não são apagados — os motores usam
--      admission_date/termination_date para recortar o período.

CREATE OR REPLACE FUNCTION public.enforce_employee_termination_inactive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.termination_date IS NOT NULL THEN
    NEW.active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_termination_inactive ON public.employees;
CREATE TRIGGER trg_employee_termination_inactive
BEFORE INSERT OR UPDATE OF termination_date, active
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.enforce_employee_termination_inactive();

-- Corrige cadastros antigos que tinham data de saída, mas continuavam ativos.
UPDATE public.employees
SET active = false
WHERE termination_date IS NOT NULL
  AND active IS DISTINCT FROM false;

COMMENT ON FUNCTION public.enforce_employee_termination_inactive() IS
  'Inativa o vínculo quando termination_date é preenchida. Não remove histórico de ponto/folha.';
