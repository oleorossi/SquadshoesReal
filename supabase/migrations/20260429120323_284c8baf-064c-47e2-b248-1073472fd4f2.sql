-- 20260429220000_consolidate-stage-order-and-business-days.sql

-- Define a ordem numérica das etapas
DROP FUNCTION IF EXISTS public.stage_order(p_stage text) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(p_stage text)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stage
    WHEN 'corte'     THEN 1
    WHEN 'mesa'      THEN 2
    WHEN 'palmilha'  THEN 3
    WHEN 'costura'   THEN 4
    WHEN 'montagem'  THEN 5
    WHEN 'solagem'   THEN 6
    WHEN 'acabamento' THEN 7
    ELSE 99
  END;
$$;

-- Função auxiliar para adicionar dias úteis (pula Sábado e Domingo)
DROP FUNCTION IF EXISTS public.add_business_days(p_start_date timestamptz, p_days integer) CASCADE;
CREATE OR REPLACE FUNCTION public.add_business_days(p_start_date timestamptz, p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_result timestamptz := p_start_date;
  v_count integer := 0;
BEGIN
  WHILE v_count < p_days LOOP
    v_result := v_result + interval '1 day';
    -- 0 = Domingo, 6 = Sábado
    IF extract(dow from v_result) NOT IN (0, 6) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- Atualiza a lógica de início de onda para usar as novas funções se necessário
-- (A lógica principal já foi aplicada, mas garantimos que as dependências existam)
