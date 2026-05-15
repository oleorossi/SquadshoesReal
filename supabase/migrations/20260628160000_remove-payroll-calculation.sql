-- Remove o subsistema de Folha de Pagamento (decisão do usuário: o sistema
-- não calcula encargos trabalhistas — INSS, IRRF, DSR, benefícios, HE auto).
-- Mantemos:
--  • employee_advances (vales por funcionário com data — vínculo ao "período"
--    é o próprio advance_date; payroll_run_id deixa de existir)
--  • bank_hours_movements + RPC pay_bank_hours_balance (saída de banco de horas
--    com valor calculado pelo hourly_rate × multiplier — única "folha" que existe)
--  • overtime_resolutions (resolução manual de HE — sem vínculo a payroll_run)
--  • absences (continua existindo como registro de ausências do RH)
--
-- Removemos:
--  • payroll_runs (tabela de cabeçalho da folha mensal)
--  • benefits_config (tabela de configuração de benefícios/encargos)
--  • Trigger tg_payroll_link_advances_and_overtime e função associada
--  • FK columns: employee_advances.payroll_run_id, overtime_resolutions.payroll_run_id

DROP TRIGGER IF EXISTS trg_payroll_link_advances_and_overtime ON payroll_runs;
DROP FUNCTION IF EXISTS tg_payroll_link_advances_and_overtime() CASCADE;

ALTER TABLE IF EXISTS employee_advances     DROP COLUMN IF EXISTS payroll_run_id;
ALTER TABLE IF EXISTS overtime_resolutions  DROP COLUMN IF EXISTS payroll_run_id;

DROP TABLE IF EXISTS payroll_runs    CASCADE;
DROP TABLE IF EXISTS benefits_config CASCADE;
