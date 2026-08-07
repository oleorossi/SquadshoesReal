-- =============================================================================
-- UMA FOLHA POR JANELA — proibida sobreposição de período por funcionário
--
-- O QUE ACONTECIA. `payroll_runs` é UNIQUE (employee_id, period), o que impede
-- repetir a MESMA string de período — e não impede nada além disso. '2026-06',
-- '2026-06-01_2026-06-15' e '2026-06-16_2026-07-13' são três strings diferentes
-- cobrindo os mesmos dias, e a base tinha 23 janelas assim convivendo.
--
-- POR QUE ISSO PAGA DUAS VEZES, NOS DOIS LADOS:
--
--  · Regime por par: a reivindicação (tg_ficha_claim_production) protege — cada
--    dia pertence a uma folha só, quem aprova primeiro leva. É rede de proteção,
--    não desenho. A segunda folha sai valendo menos do que a tela mostrou, e o
--    aviso fica escondido em `notes`.
--  · Mensalista/diarista/remoto: NÃO há nada equivalente. O valor é RECALCULADO
--    da janela toda vez. Duas folhas aprovadas que se cruzam pagam salário
--    integral duas vezes, sem aviso nenhum. Este é o lado realmente exposto —
--    são 18 pessoas e R$ 589 mil em rascunhos que testemunham o quão fácil era
--    criar a sobreposição.
--
-- A REGRA. Vale mid-mês é ADIANTAMENTO (employee_advances), não folha. Então uma
-- folha nunca precisa cruzar outra da mesma pessoa, e cruzar passa a ser erro.
--
-- ESCOPO: todos os regimes (decisão do dono, 07/08/2026). Cancelada não conta —
-- folha cancelada libera a janela, coerente com tg_ficha_claim_production, que
-- devolve os dias no cancelamento.
--
-- ⚠ ORDEM DOS GATILHOS. Alfabética: tg_ficha_claim_production < tg_payroll_block_
-- period_overlap < trg_payroll_link_advances_and_overtime. Ou seja, a
-- reivindicação roda ANTES desta checagem. Não é problema — a exceção aborta a
-- transação inteira e desfaz o que ela tiver carimbado. Se um dia isto virar
-- verificação sem exceção, a ordem passa a importar.
--
-- Pré-condição verificada: depois de apagar os 397 rascunhos (migration
-- 20261217120200) restam ZERO sobreposições na base.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_payroll_block_period_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_range    daterange;
  v_conflito record;
BEGIN
  -- Folha cancelada não ocupa janela.
  IF NEW.status = 'cancelado' THEN
    RETURN NEW;
  END IF;

  v_range := public.payroll_period_range(NEW.period);
  IF v_range IS NULL THEN
    RAISE EXCEPTION
      'payroll_runs.period em formato desconhecido: % (esperado YYYY-MM ou YYYY-MM-DD_YYYY-MM-DD)',
      NEW.period;
  END IF;

  SELECT r.period, r.status INTO v_conflito
    FROM public.payroll_runs r
   WHERE r.employee_id = NEW.employee_id
     AND r.id <> NEW.id
     AND r.status <> 'cancelado'
     AND public.payroll_period_range(r.period) && v_range
   ORDER BY r.period
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Já existe folha desta pessoa cobrindo dias deste período: % (%). Uma folha por janela — vale no meio do período é adiantamento, não folha.',
      v_conflito.period, v_conflito.status
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_payroll_block_period_overlap() IS
  'Impede duas folhas não canceladas da mesma pessoa com janelas que se cruzam. '
  'UNIQUE(employee_id, period) só barra a string idêntica; ''2026-06'' e '
  '''2026-06-01_2026-06-15'' passavam pelas duas e pagavam os mesmos dias.';

DROP TRIGGER IF EXISTS tg_payroll_block_period_overlap ON public.payroll_runs;
CREATE TRIGGER tg_payroll_block_period_overlap
  BEFORE INSERT OR UPDATE OF period, status, employee_id ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_block_period_overlap();
