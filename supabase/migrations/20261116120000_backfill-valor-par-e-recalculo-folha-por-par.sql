-- Backfill do R$/par gravado + recálculo das folhas de quem é regime por par.
-- Decisão: docs/adr/0001-backfill-do-r-par-em-lancamentos-ja-gravados.md
--
-- Contexto: 33 dos 50 lançamentos de ficha_montadores (7.116 de 10.140 pares)
-- foram gravados com valor_par_* zerado/nulo — são os anteriores ao modelo
-- 'chamada' com detalhe. Valorados assim, valem R$ 0,00 na folha.
--
-- Esta migration só é segura porque NENHUMA linha foi paga nem reivindicada por
-- folha (pago_em e payroll_run_id 100% nulos) e todas as folhas afetadas estão
-- em rascunho. As duas condições viram GUARDA explícita abaixo: se alguma linha
-- já tiver sido quitada, ela é pulada — reescrever pagamento fechado quebraria o
-- contrato do "R$/par gravado" e NÃO está autorizado pela ADR.

BEGIN;

-- ── 1. Cadastro faltante ─────────────────────────────────────────────────────
-- Edson Coelho é regime por par com 11 lançamentos e nenhum R$/par cadastrado.
-- Valor arbitrado pelo dono por analogia com os demais montadores (0,80 / 1,00).
UPDATE employees
   SET valor_par_medio   = COALESCE(valor_par_medio, 0.80),
       valor_par_dificil = COALESCE(valor_par_dificil, 1.00)
 WHERE payment_type = 'producao'
   AND COALESCE(valor_par_medio, 0) = 0;

-- ── 2. Backfill do snapshot nos lançamentos zerados ──────────────────────────
-- Fonte = cadastro do funcionário (a mesma que o apontamento usa hoje).
-- Só toca linha NÃO paga e NÃO reivindicada por folha.
UPDATE ficha_montadores f
   SET valor_par_medio   = e.valor_par_medio,
       valor_par_dificil = e.valor_par_dificil,
       valor_par         = COALESCE(NULLIF(f.valor_par, 0), e.valor_par_medio),
       atualizado_em     = now()
  FROM employees e
 WHERE e.id = f.montador_id
   AND e.payment_type = 'producao'
   AND COALESCE(e.valor_par_medio, 0) > 0
   AND COALESCE(f.valor_par_medio, f.valor_par, 0) = 0
   AND f.pago_em IS NULL
   AND f.payroll_run_id IS NULL;

-- ── 3. Trava no banco (a UI também bloqueia, mas ela não é a última linha) ───
-- Impede que um apontamento novo de quem é regime por par nasça sem R$/par
-- médio — foi exatamente assim que os 33 registros zerados apareceram.
-- Só o MÉDIO é obrigatório: nunca existiu par difícil no histórico e há gente
-- (Solagem) com apenas a taxa média cadastrada.
CREATE OR REPLACE FUNCTION public.tg_ficha_montadores_require_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_regime text;
BEGIN
  IF NEW.montador_id IS NULL OR COALESCE(NEW.origem, 'chamada') <> 'chamada' THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(payment_type, 'mensalista')) INTO v_regime
    FROM employees WHERE id = NEW.montador_id;

  IF v_regime IS DISTINCT FROM 'producao' THEN
    RETURN NEW;  -- mensalista lança produção como MEDIÇÃO; não precisa de taxa
  END IF;

  IF COALESCE(NEW.valor_par_medio, NEW.valor_par, 0) <= 0 THEN
    RAISE EXCEPTION 'R$/par não cadastrado para % — preencha em Funcionários → Remuneração antes de lançar a produção.',
      COALESCE(NEW.montador, 'este funcionário')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ficha_montadores_require_rate ON public.ficha_montadores;
CREATE TRIGGER trg_ficha_montadores_require_rate
  BEFORE INSERT OR UPDATE ON public.ficha_montadores
  FOR EACH ROW EXECUTE FUNCTION public.tg_ficha_montadores_require_rate();

-- ── 4. Recálculo das folhas em rascunho de quem é regime por par ─────────────
-- As 19 folhas gravadas dessas pessoas foram calculadas como MENSALISTA (todas
-- com base_salary 2.400 e total_proventos idêntico entre as três = salário
-- proporcional). Não é o motor de ponto que precisa rodar aqui: para o regime
-- por par a conta é fechada e não depende de escala, feriado nem batida —
--   bruto = Σ (pares_medio × R$/par_medio + pares_dificil × R$/par_dificil)
--   líquido = bruto − adiantamentos
-- que é EXATAMENTE o ramo 'producao' de computePeriodFolha (salaryPayroll.ts).
-- Reescrever aqui, portanto, não duplica o motor de ponto: reproduz um ramo que
-- deliberadamente o ignora.
WITH periodo AS (
  -- period é 'AAAA-MM' (mês cheio) ou 'AAAA-MM-DD_AAAA-MM-DD' (intervalo).
  SELECT pr.id,
         pr.employee_id,
         CASE WHEN pr.period ~ '^\d{4}-\d{2}$'
              THEN to_date(pr.period || '-01', 'YYYY-MM-DD')
              ELSE to_date(split_part(pr.period, '_', 1), 'YYYY-MM-DD') END AS d_from,
         CASE WHEN pr.period ~ '^\d{4}-\d{2}$'
              THEN (to_date(pr.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
              ELSE to_date(split_part(pr.period, '_', 2), 'YYYY-MM-DD') END AS d_to
    FROM payroll_runs pr
    JOIN employees e ON e.id = pr.employee_id
   WHERE e.payment_type = 'producao'
     AND pr.status = 'rascunho'
),
producao AS (
  SELECT p.id,
         COALESCE(SUM(
           CASE WHEN f.detalhe IS NULL OR jsonb_array_length(f.detalhe) = 0
                THEN COALESCE(f.total, 0)                       -- fallback: total = pares médios
                ELSE (SELECT COALESCE(SUM(COALESCE((d->>'medio')::numeric, (d->>'pares')::numeric, 0)), 0)
                        FROM jsonb_array_elements(f.detalhe) d) END), 0) AS pares_medio,
         COALESCE(SUM(
           CASE WHEN f.detalhe IS NULL OR jsonb_array_length(f.detalhe) = 0 THEN 0
                ELSE (SELECT COALESCE(SUM(COALESCE((d->>'dificil')::numeric, 0)), 0)
                        FROM jsonb_array_elements(f.detalhe) d) END), 0) AS pares_dificil,
         COALESCE(SUM(
           CASE WHEN f.detalhe IS NULL OR jsonb_array_length(f.detalhe) = 0
                THEN COALESCE(f.total, 0) * COALESCE(f.valor_par_medio, f.valor_par, 0)
                ELSE (SELECT COALESCE(SUM(
                         COALESCE((d->>'medio')::numeric, (d->>'pares')::numeric, 0) * COALESCE(f.valor_par_medio, f.valor_par, 0)
                       + COALESCE((d->>'dificil')::numeric, 0)                       * COALESCE(f.valor_par_dificil, 0)), 0)
                        FROM jsonb_array_elements(f.detalhe) d) END), 0) AS bruto,
         COUNT(DISTINCT f.dia) FILTER (WHERE COALESCE(f.total, 0) > 0) AS dias_produtivos
    FROM periodo p
    LEFT JOIN ficha_montadores f
           ON f.montador_id = p.employee_id
          AND COALESCE(f.origem, 'chamada') = 'chamada'
          AND f.dia BETWEEN p.d_from AND p.d_to
   GROUP BY p.id
),
vales AS (
  -- MESMO filtro que a folha aplica (Payroll.tsx): só vale pendente e ainda não
  -- amarrado a outra folha. Sem isso, o mesmo adiantamento seria descontado 2×.
  SELECT p.id, COALESCE(SUM(a.amount), 0) AS adiantamentos
    FROM periodo p
    LEFT JOIN employee_advances a
           ON a.employee_id = p.employee_id
          AND a.advance_date BETWEEN p.d_from AND p.d_to
          AND a.payroll_run_id IS NULL
          AND a.status = 'pending'
   GROUP BY p.id
)
UPDATE payroll_runs pr
   SET base_salary          = 0,
       hourly_rate          = 0,
       worked_minutes       = 0,
       normal_minutes       = 0,
       premium_minutes      = 0,
       normal_value         = 0,
       premium_value        = 0,
       expected_minutes     = 0,
       business_days        = 0,
       business_days_worked = pd.dias_produtivos,
       absent_days          = 0,
       absence_discount     = 0,
       overtime_50_minutes  = 0,
       overtime_amount      = 0,
       deductions_amount    = 0,
       advances_total       = v.adiantamentos,
       total_proventos      = round(pd.bruto, 2),
       total_descontos      = v.adiantamentos,
       total_liquido        = round(pd.bruto - v.adiantamentos, 2),
       net_salary           = round(pd.bruto - v.adiantamentos, 2),
       notes                = 'Por par: ' || (pd.pares_medio + pd.pares_dificil)::int || ' pares ('
                              || pd.pares_medio::int || ' méd + ' || pd.pares_dificil::int || ' dif) · '
                              || pd.dias_produtivos || ' dia(s) produtivo(s)'
  FROM producao pd
  JOIN vales v ON v.id = pd.id
 WHERE pr.id = pd.id;

COMMIT;
