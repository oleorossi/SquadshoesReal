-- O Modo Gestão lia `v_production_queue_detail`, que chama
-- `latest_schedule_run_id()`. A implementação anterior percorria cada linha de
-- `production_engine_runs` e repetia um EXISTS em `production_schedule` sem
-- índice por recalc_run_id. Sob o papel authenticated + RLS, a consulta medida
-- em 15/08/2026 levou 19 s e estourou o statement_timeout de 8 s, deixando o
-- quadro apenas com esqueletos e contadores zerados.

-- Atende tanto a descoberta do run quanto o CTE `sched` das views do motor.
CREATE INDEX IF NOT EXISTS idx_prod_sched_run_date_order
  ON public.production_schedule (recalc_run_id, date, order_id);

-- Preserva exatamente a regra original:
--   1. prefere o run mais recente registrado no motor que possua agenda;
--   2. se nenhum run estiver registrado, usa a agenda criada mais recentemente.
-- A diferença é percorrer a agenda UMA vez, em vez de testar todo o histórico
-- de runs um por um. SECURITY DEFINER evita reavaliar a policy de usuário
-- aprovado durante essa leitura interna; a função só expõe o UUID do run.
CREATE OR REPLACE FUNCTION public.latest_schedule_run_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ps.recalc_run_id
    FROM public.production_schedule ps
    LEFT JOIN public.production_engine_runs r ON r.run_id = ps.recalc_run_id
   GROUP BY ps.recalc_run_id
   ORDER BY max(r.ran_at) DESC NULLS LAST,
            max(ps.created_at) DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.latest_schedule_run_id() IS
  'Run vigente do plano de produção, resolvido em uma passagem pela agenda. '
  'Toda leitura de production_schedule deve filtrar por esta função.';

REVOKE ALL ON FUNCTION public.latest_schedule_run_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.latest_schedule_run_id() TO authenticated, service_role;

ANALYZE public.production_schedule;
