-- =============================================================================
-- LIMPEZA: 397 rascunhos de folha + baixa dos R$ 1.400 de maio
--
-- OS RASCUNHOS. 23 janelas de período que se cruzam (2026-05, 2026-05-01_2026-06-14,
-- 2026-06-01_2026-07-18, 2026-06-16_2026-06-30, …) foram geradas testando o
-- seletor da tela de folha, e cada uma criou um rascunho por funcionário:
--
--   · 71 rascunhos dos 5 do regime por par ...... R$  42.730,20
--   · 326 rascunhos dos 18 demais regimes ....... R$ 589.357,84
--   · total ..................................... R$ 632.088,04
--
-- Nada disso é dinheiro: são os MESMOS dias recontados por janelas sobrepostas.
-- A produção que existe de verdade soma R$ 7.071,60. Ninguém foi pago duas vezes
-- só porque nenhuma dessas folhas foi aprovada — a reivindicação
-- (tg_ficha_claim_production) só arma na aprovação, e payroll_payments está
-- vazia. Decisão do dono (07/08/2026): apagar tudo e recomeçar na cadência
-- semanal.
--
-- ⚠ SÓ RASCUNHO. A única folha aprovada da base (Erick Cesar, 2026-06, R$ 0,00)
-- fica. `tg_payroll_block_delete_finalized` já barraria o contrário, mas o filtro
-- é explícito aqui para a intenção não depender de outro gatilho.
--
-- As FKs que apontam para payroll_runs são todas ON DELETE SET NULL
-- (employee_advances, ficha_montadores, overtime_resolutions) ou CASCADE
-- (payroll_payments, vazia) — apagar rascunho não deixa órfão nem perde
-- lançamento de produção.
--
-- OS ADIANTAMENTOS. R$ 1.400 entregues em maio (Edson Coelho R$ 1.000 em 3
-- lançamentos de 09→15/05; Antonio Gordinho R$ 400 em 2 de 14/05) já foram
-- acertados por fora — decisão do dono. Vão para 'baixado_externo', o estado
-- criado na migration anterior, que o gatilho de folha agora pula.
-- =============================================================================

-- 1) Baixa dos adiantamentos ANTES de apagar as folhas ------------------------
-- Ordem importa: se um rascunho fosse aprovado no meio, ele vincularia estes
-- lançamentos. Baixando primeiro, não há janela para isso.
UPDATE public.employee_advances a
   SET status = 'baixado_externo', updated_at = now()
  FROM public.employees e
 WHERE e.id = a.employee_id
   AND e.payment_type = 'producao'
   AND a.payroll_run_id IS NULL
   AND a.advance_date < '2026-06-01'
   AND coalesce(a.status, 'pending') <> 'baixado_externo';

DO $$
DECLARE v_n integer; v_total numeric;
BEGIN
  SELECT count(*), coalesce(sum(amount),0) INTO v_n, v_total
    FROM public.employee_advances WHERE status = 'baixado_externo';
  RAISE NOTICE 'Adiantamentos baixados por fora: % lançamento(s), R$ %', v_n, v_total;
END $$;

-- 2) Apagar os rascunhos ------------------------------------------------------
DO $$
DECLARE v_n integer; v_total numeric;
BEGIN
  SELECT count(*), coalesce(sum(total_proventos),0) INTO v_n, v_total
    FROM public.payroll_runs WHERE status = 'rascunho';
  RAISE NOTICE 'Rascunhos de folha a apagar: % (R$ % em proventos fantasma)', v_n, v_total;
END $$;

DELETE FROM public.payroll_runs WHERE status = 'rascunho';

-- 3) Os lançamentos de produção continuam livres e pagáveis -------------------
DO $$
DECLARE v_abertos integer; v_valor numeric;
BEGIN
  SELECT count(*), coalesce(sum(public.ficha_valor(detalhe, total, valor_par, valor_par_medio, valor_par_dificil)),0)
    INTO v_abertos, v_valor
    FROM public.ficha_montadores
   WHERE payroll_run_id IS NULL
     AND public.ficha_is_chamada(origem, numeracoes);
  RAISE NOTICE 'Produção em aberto após a limpeza: % lançamento(s), R$ %', v_abertos, v_valor;
END $$;
