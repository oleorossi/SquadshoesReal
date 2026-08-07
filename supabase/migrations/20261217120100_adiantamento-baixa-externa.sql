-- =============================================================================
-- ADIANTAMENTO ACERTADO POR FORA — status 'baixado_externo'
--
-- O BURACO. `tg_payroll_link_advances_and_overtime` vincula adiantamento à folha
-- por DATA e por payroll_run_id NULL — e IGNORA o campo `status` por completo.
-- Consequência: não existe hoje nenhuma forma de dizer "este adiantamento já foi
-- acertado fora do sistema". Marcar como 'paid', 'pending' ou qualquer outra
-- coisa não muda nada; a próxima folha cuja janela cobrir a data desconta do
-- mesmo jeito. A única saída era apagar o registro — perdendo o rastro de que o
-- dinheiro saiu do caixa.
--
-- O CASO CONCRETO (decisão do dono, 07/08/2026): R$ 1.400 adiantados em maio a
-- dois montadores — Edson Coelho R$ 1.000 (3 lançamentos, 09→15/05) e Antonio
-- Gordinho R$ 400 (2 lançamentos, 14/05) — já foram acertados por fora e NÃO
-- devem ser descontados. A produção deles começa só em 15/06, então a folha
-- semanal nunca cobriria maio; mas qualquer folha de maio criada depois iria
-- descontá-los retroativamente.
--
-- ESCOPO. A baixa é geral, não um remendo para estes dois: 'baixado_externo'
-- passa a ser o estado terminal de qualquer adiantamento resolvido fora da
-- folha. Ele nunca é vinculado e nunca é descontado.
--
-- ⚠ O ramo de ESTORNO não pode ressuscitar a baixa. Quando uma folha volta para
-- rascunho, o gatilho devolve os adiantamentos dela para 'pending'. Isso só
-- alcança linhas com payroll_run_id = NEW.id, e uma linha baixada nunca chega a
-- ter vínculo — então ela não é atingida. Está explícito aqui porque a próxima
-- pessoa a mexer neste gatilho precisa saber que essa é a razão, e não sorte.
-- =============================================================================

COMMENT ON COLUMN public.employee_advances.status IS
  'pending = aguardando desconto em folha · deducted = já descontado por uma '
  'folha (payroll_run_id preenchido) · paid = dinheiro entregue ao funcionário · '
  'baixado_externo = acertado FORA da folha; nunca é vinculado nem descontado.';

CREATE OR REPLACE FUNCTION public.tg_payroll_link_advances_and_overtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period_start date;
  v_period_end   date;
  v_advances_total numeric;
  v_old_descontos_non_advance numeric;
BEGIN
  -- period: 'YYYY-MM' (mês cheio) OU 'YYYY-MM-DD_YYYY-MM-DD' (semanal/quinzenal/intervalo)
  IF NEW.period ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$' THEN
    v_period_start := split_part(NEW.period, '_', 1)::date;
    v_period_end   := split_part(NEW.period, '_', 2)::date;
  ELSIF NEW.period ~ '^\d{4}-\d{2}$' THEN
    v_period_start := (NEW.period || '-01')::date;
    v_period_end   := (v_period_start + interval '1 month - 1 day')::date;
  ELSE
    RAISE EXCEPTION 'payroll_runs.period em formato desconhecido: % (esperado YYYY-MM ou YYYY-MM-DD_YYYY-MM-DD)', NEW.period;
  END IF;

  IF NEW.status IN ('aprovado','pago') AND (OLD.status IS NULL OR OLD.status='rascunho') THEN
    UPDATE public.employee_advances
       SET payroll_run_id = NEW.id, status = 'deducted', updated_at = now()
     WHERE employee_id = NEW.employee_id
       AND advance_date >= v_period_start AND advance_date <= v_period_end
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id)
       -- ── ÚNICA MUDANÇA: acertado por fora não entra em folha nenhuma ──
       AND coalesce(status, 'pending') <> 'baixado_externo';

    SELECT COALESCE(SUM(amount), 0) INTO v_advances_total
    FROM public.employee_advances
    WHERE payroll_run_id = NEW.id;

    v_old_descontos_non_advance := COALESCE(NEW.total_descontos, 0) - COALESCE(NEW.advances_total, 0);
    NEW.advances_total := v_advances_total;
    NEW.total_descontos := v_old_descontos_non_advance + v_advances_total;
    NEW.total_liquido := COALESCE(NEW.total_proventos, 0) - NEW.total_descontos;

    UPDATE public.overtime_resolutions
       SET payroll_run_id = NEW.id
     WHERE employee_id = NEW.employee_id
       AND month >= v_period_start AND month <= v_period_end
       AND (payroll_run_id IS NULL OR payroll_run_id = NEW.id);

    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;

  ELSIF NEW.status='rascunho' AND OLD.status IN ('aprovado','pago') THEN
    -- Só alcança quem esta folha vinculou; baixa externa nunca tem vínculo.
    UPDATE public.employee_advances
       SET payroll_run_id = NULL, status = 'pending', updated_at = now()
     WHERE payroll_run_id = NEW.id;
    UPDATE public.overtime_resolutions SET payroll_run_id = NULL WHERE payroll_run_id = NEW.id;

    NEW.advances_total := 0;
    v_old_descontos_non_advance := COALESCE(NEW.total_descontos, 0) - COALESCE(OLD.advances_total, 0);
    NEW.total_descontos := v_old_descontos_non_advance;
    NEW.total_liquido := COALESCE(NEW.total_proventos, 0) - NEW.total_descontos;

    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
