-- =============================================================================
-- FOLHA DO REGIME POR PAR SÓ EXISTE POR SEMANA (segunda → domingo)
--
-- O BURACO. A cadência de montador e solador é semanal (decisão do dono,
-- 07/08/2026), e o botão Pagar da Ficha de Montadores já exige janela de semana
-- fechada (`eSemanaFechada`). Mas a tela FOLHA nasceu antes dessa decisão e não
-- conhece a regra: ela gera uma folha por funcionário para QUALQUER intervalo
-- selecionado — inclusive mês cheio.
--
-- COMO ISSO MORDE. Aprovar uma folha por-par de '2026-07' faz
-- tg_ficha_claim_production reivindicar TODA a produção de julho de uma vez.
-- Depois disso, tg_payroll_block_period_overlap passa a recusar — corretamente —
-- as folhas semanais de 20/07 e 27/07: os dias já têm dono. O resultado é ficar
-- preso a uma folha mensal sem ninguém ter decidido isso, e o caminho de volta
-- é cancelar a folha para liberar os dias.
--
-- Não é hipótese: em 07/08/2026 às 12:31 a tela FOLHA gerou 22 rascunhos de
-- '2026-07', um por funcionário ativo — 5 deles do regime por par. Este arquivo
-- apaga esses 5 e fecha a porta por onde entraram.
--
-- POR QUE NO BANCO E NÃO SÓ NA TELA. Mesma lição do trigger de auto-aprovação em
-- profiles: guarda que vive só na UI morre na próxima reescrita da UI, e some
-- sem deixar rastro. A tela ganha a mensagem amigável; o banco garante a regra.
--
-- ⚠ ESCOPO: só payment_type='producao'. Mensalista, diarista e remoto continuam
-- com folha mensal ou quinzenal, sem restrição de formato.
-- =============================================================================

-- 1) Os 5 rascunhos por-par de julho, criados pela tela sem a guarda -----------
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM payroll_runs r JOIN employees e ON e.id = r.employee_id
   WHERE r.status = 'rascunho' AND e.payment_type = 'producao';
  RAISE NOTICE 'Rascunhos por-par a apagar (janela não-semanal): %', v_n;
END $$;

DELETE FROM payroll_runs r
 USING employees e
 WHERE e.id = r.employee_id
   AND r.status = 'rascunho'
   AND e.payment_type = 'producao';

-- 2) A guarda -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_payroll_producao_semana_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_regime text;
  v_de     date;
  v_ate    date;
BEGIN
  -- Folha cancelada não precisa respeitar formato: ela não paga nada.
  IF NEW.status = 'cancelado' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(payment_type, 'mensalista') INTO v_regime
    FROM employees WHERE id = NEW.employee_id;

  IF v_regime <> 'producao' THEN
    RETURN NEW;
  END IF;

  -- Mês cheio ('YYYY-MM') nunca é uma semana.
  IF NEW.period !~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION
      'Folha do regime por par é semanal: o período % não é uma semana. Pague pela Ficha de Montadores, navegando até a semana.',
      NEW.period
      USING ERRCODE = 'check_violation';
  END IF;

  v_de  := split_part(NEW.period, '_', 1)::date;
  v_ate := split_part(NEW.period, '_', 2)::date;

  -- Segunda a domingo: início na segunda (isodow=1) e fim exatamente 6 dias
  -- depois. O domingo entra de propósito — há produção lançada em fim de semana,
  -- e uma semana que terminasse no sábado deixaria esses pares órfãos.
  IF EXTRACT(isodow FROM v_de) <> 1 OR v_ate <> v_de + 6 THEN
    RAISE EXCEPTION
      'Folha do regime por par vai de segunda a domingo. O período % começa em % e termina em %.',
      NEW.period, to_char(v_de, 'DD/MM (Dy)'), to_char(v_ate, 'DD/MM (Dy)')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_payroll_producao_semana_fechada() IS
  'Folha de quem é payment_type=''producao'' só pode cobrir uma semana fechada '
  '(segunda→domingo). Impede que uma folha mensal reivindique o mês inteiro e '
  'bloqueie, pela trava de sobreposição, todas as semanais daquele intervalo.';

DROP TRIGGER IF EXISTS tg_payroll_producao_semana_fechada ON public.payroll_runs;
CREATE TRIGGER tg_payroll_producao_semana_fechada
  BEFORE INSERT OR UPDATE OF period, employee_id, status ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_payroll_producao_semana_fechada();
