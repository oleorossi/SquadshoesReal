-- =============================================================================
-- FICHA DE MONTADORES — o que já foi PAGO e o que ainda NÃO foi
--
-- OBJETIVO. Relatório por setor e por período que separe a produção já quitada
-- pela folha da produção ainda em aberto.
--
-- POR QUE VÍNCULO EXPLÍCITO E NÃO DERIVADO DO PERÍODO. `payroll_runs.period` é
-- texto em dois formatos ('YYYY-MM' e 'YYYY-MM-DD_YYYY-MM-DD') e as janelas se
-- SOBREPÕEM na prática — o banco tem rascunhos '2026-06-01_2026-07-13' e
-- '2026-07-01_2026-07-15' convivendo. Derivar "pago" cruzando dia × período
-- daria múltiplas respostas pro mesmo lançamento, e a resposta mudaria sozinha
-- quando alguém criasse mais um rascunho. Aqui o lançamento aponta pra folha
-- que o quitou: fato único, auditável, imune a rascunho novo.
--
-- QUANDO CARIMBA. Só quando o dinheiro sai — ou seja, quando entra um
-- `payroll_payments` (a folha em 'rascunho'/'aprovado' NÃO marca nada como
-- pago). Carimba apenas lançamentos ainda em aberto, então repagamento ou
-- pagamento parcial não rouba lançamento já atribuído a outra folha.
--
-- ESCOPO DO CARIMBO. Só linhas do modelo 'chamada' (produção diária). O legado
-- por grade fica de fora, espelhando `montadorProduction.ts`, que o exclui do
-- cálculo de pagamento pra não contar produção duas vezes.
-- =============================================================================

-- 1) Colunas de quitação ------------------------------------------------------
ALTER TABLE public.ficha_montadores
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pago_em date;

COMMENT ON COLUMN public.ficha_montadores.payroll_run_id IS
  'Folha que quitou este lançamento. NULL = produção ainda NÃO paga. Preenchido '
  'pelo trigger quando entra um payroll_payments da folha que cobre o dia.';
COMMENT ON COLUMN public.ficha_montadores.pago_em IS
  'Data do pagamento (payroll_payments.paid_on) que quitou este lançamento.';

CREATE INDEX IF NOT EXISTS idx_ficha_montadores_payroll_run
  ON public.ficha_montadores (payroll_run_id);
-- Sustenta o carimbo (montador + janela de dias) e o relatório por setor/período.
CREATE INDEX IF NOT EXISTS idx_ficha_montadores_montador_dia
  ON public.ficha_montadores (montador_id, dia);
CREATE INDEX IF NOT EXISTS idx_ficha_montadores_setor_dia
  ON public.ficha_montadores (setor, dia);

-- 2) Período da folha como intervalo de datas ---------------------------------
-- Aceita os dois formatos vivos; devolve NULL no que não reconhecer, pra um
-- período malformado não carimbar a tabela inteira por engano.
CREATE OR REPLACE FUNCTION public.payroll_period_range(p_period text)
RETURNS daterange
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_period ~ '^\d{4}-\d{2}$'
      THEN daterange((p_period || '-01')::date,
                     ((p_period || '-01')::date + interval '1 month')::date, '[)')
    WHEN p_period ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$'
      THEN daterange(split_part(p_period, '_', 1)::date,
                     split_part(p_period, '_', 2)::date + 1, '[)')
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION public.payroll_period_range(text) IS
  'payroll_runs.period (''YYYY-MM'' ou ''YYYY-MM-DD_YYYY-MM-DD'') como daterange '
  'semiaberto [de, ate+1). NULL quando o formato não é reconhecido.';

-- 3) Carimbo na entrada do pagamento ------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_ficha_stamp_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_emp   uuid;
  v_range daterange;
BEGIN
  SELECT coalesce(NEW.employee_id, r.employee_id), public.payroll_period_range(r.period)
    INTO v_emp, v_range
    FROM payroll_runs r
   WHERE r.id = NEW.payroll_run_id;

  IF v_emp IS NULL OR v_range IS NULL THEN
    RETURN NEW;  -- sem funcionário ou período ilegível: não carimba nada
  END IF;

  UPDATE ficha_montadores f
     SET payroll_run_id = NEW.payroll_run_id,
         pago_em        = NEW.paid_on
   WHERE f.montador_id = v_emp
     AND f.dia <@ v_range
     AND f.payroll_run_id IS NULL  -- nunca rouba lançamento de outra folha
     AND (f.origem = 'chamada'
          OR (f.origem IS NULL AND coalesce(jsonb_array_length(f.numeracoes), 0) = 0));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_ficha_stamp_payment ON public.payroll_payments;
CREATE TRIGGER tg_ficha_stamp_payment
  AFTER INSERT OR UPDATE OF paid_on, payroll_run_id, employee_id ON public.payroll_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_stamp_payment();

-- 4) Estorno: pagamento apagado devolve o lançamento pro "não pago" ------------
-- Só solta quando a folha fica SEM nenhum pagamento — folha paga em parcelas
-- continua quitada enquanto sobrar uma.
CREATE OR REPLACE FUNCTION public.tg_ficha_unstamp_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payroll_payments p
                  WHERE p.payroll_run_id = OLD.payroll_run_id) THEN
    UPDATE ficha_montadores
       SET payroll_run_id = NULL, pago_em = NULL
     WHERE payroll_run_id = OLD.payroll_run_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tg_ficha_unstamp_payment ON public.payroll_payments;
CREATE TRIGGER tg_ficha_unstamp_payment
  AFTER DELETE ON public.payroll_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_unstamp_payment();

-- 5) Backfill -----------------------------------------------------------------
-- Carimba o que já estiver pago hoje. (No banco atual: payroll_payments está
-- vazia e todas as payroll_runs estão em rascunho — nada a carimbar, mas a
-- migration precisa ser correta em qualquer base.)
UPDATE ficha_montadores f
   SET payroll_run_id = p.payroll_run_id,
       pago_em        = p.paid_on
  FROM (
    SELECT DISTINCT ON (pp.employee_id, r.id)
           pp.payroll_run_id, pp.employee_id, pp.paid_on,
           public.payroll_period_range(r.period) AS janela
      FROM payroll_payments pp
      JOIN payroll_runs r ON r.id = pp.payroll_run_id
     WHERE public.payroll_period_range(r.period) IS NOT NULL
     ORDER BY pp.employee_id, r.id, pp.paid_on
  ) p
 WHERE f.montador_id = p.employee_id
   AND f.dia <@ p.janela
   AND f.payroll_run_id IS NULL
   AND (f.origem = 'chamada'
        OR (f.origem IS NULL AND coalesce(jsonb_array_length(f.numeracoes), 0) = 0));
