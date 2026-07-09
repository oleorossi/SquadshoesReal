-- RH — Reforma da Gestão de Pessoas (spec: specs/gestao-de-pessoas.md)
-- Fase 3c (R14): EXCLUSÃO do Banco de Horas no banco de dados.
--
-- Decisão do dono (2026-07-09): o modelo paga hora extra na FOLHA (R$/h por
-- funcionário) e NÃO acumula banco de horas. A feature foi removida da UI
-- (tela BankHours, sub-abas, espelho reworkado) e agora o DB é limpo.
--
-- ⚠ DESTRUTIVO — remove tabelas/views/funções. Vai junto com o merge do
-- frontend novo (que não referencia mais esses objetos). Aplicar em produção
-- SÓ com o frontend correspondente no ar, senão o app antigo quebra.
--
-- MANTIDO de propósito: get_bank_hours_cutoff() — apesar do nome, é só uma data
-- de corte usada por telas de Pendências/Fechamento que não são banco de horas.
-- A TABELA overtime_resolutions (log de resolução de HE) fica; mas a VIEW
-- v_overtime_reconciliation depende de bank_hours_balance, então cai junto (nenhum
-- frontend a lê — verificado). Datada DEPOIS da última migration existente (20260909…)
-- pra que os CREATE OR REPLACE de 20260831/20260908 (que recriam v_overtime_
-- reconciliation e calculate_employee_bank_balance) rodem ANTES deste drop num apply
-- ordenado (fresh DB / CI) — senão referenciariam objeto já dropado e o push abortaria.

-- Cron órfão que chamaria snapshot_employee_week (dropada abaixo) — desagenda antes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot_weekly_close') THEN
    PERFORM cron.unschedule('snapshot_weekly_close');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;  -- pg_cron ausente/sem permissão: ignora
END $$;

-- View de reconciliação de HE (depende de bank_hours_balance) — removida explícita.
DROP VIEW IF EXISTS public.v_overtime_reconciliation CASCADE;

-- Views de banco de horas (dependem da tabela/função) primeiro.
DROP VIEW IF EXISTS public.v_bank_hours_summary CASCADE;
DROP VIEW IF EXISTS public.v_bank_hours_per_sector CASCADE;
DROP VIEW IF EXISTS public.bank_hours_balance CASCADE;

-- Tabelas de banco de horas (trigger de auditoria cai junto via CASCADE).
DROP TABLE IF EXISTS public.bank_hours_movements CASCADE;
DROP TABLE IF EXISTS public.employee_bank_hours CASCADE;

-- Funções de banco de horas (todas as sobrecargas), incluindo as que gravavam
-- movimentos (resolução mensal/semanal de HE, snapshot semanal, pagamento de banco)
-- e o saldo. get_bank_hours_cutoff é preservada (não está na lista).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'calculate_employee_bank_balance',
        'pay_bank_hours',
        'pay_bank_hours_balance',
        'resolve_monthly_overtime',
        'resolve_weekly_overtime',
        'snapshot_employee_week',
        'tg_audit_bank_hours_movements'
      )
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;
