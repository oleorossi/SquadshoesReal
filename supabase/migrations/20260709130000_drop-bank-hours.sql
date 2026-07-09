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
-- overtime_resolutions / v_overtime_reconciliation ficam (log de resolução de HE,
-- fora do escopo desta remoção).

-- Views (dependem da tabela/função) primeiro.
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
