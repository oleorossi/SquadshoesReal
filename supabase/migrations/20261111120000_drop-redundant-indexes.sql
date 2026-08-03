-- =============================================================================
-- Limpeza de índices REDUNDANTES (auditoria de 03/08/2026)
-- =============================================================================
-- Contexto: o banco tem 862 índices, dos quais 333 nunca foram usados em 93 dias
-- (janela de pg_stat_statements desde 2026-05-01). A maior tabela do banco tem
-- 4.076 linhas / 2,7 MB, então "índice nunca usado" quase sempre significa
-- "o planner prefere seq scan nessa cardinalidade" — e NÃO que o índice esteja
-- errado. Um seq scan na maior tabela pesquisável (audit_logs, 1.414 linhas)
-- mede 1,8 ms com 100% de cache hit.
--
-- ⚠ POR ISSO ESTA MIGRATION NÃO DROPA OS 333 "não usados".
-- Muitos deles são o índice CERTO para quando a tabela crescer. Exemplo vivo:
-- accounts_receivable recebe 10.276 chamadas de
--   WHERE due_date < $1 AND NOT status = $2
-- e mesmo assim idx_ar_due_date_status tem 0 scans — só porque são 72 linhas.
-- Dropar hoje e recriar a 100k linhas é churn puro.
--
-- O que ESTA migration remove é a categoria que é peso morto em QUALQUER
-- cardinalidade: índices cuja lista de colunas já é PREFIXO de outro índice
-- existente na mesma tabela. Para esses, o Postgres nunca escolhe o menor —
-- o mais largo serve as mesmas buscas — então o único efeito é custo de
-- escrita, bloat e tempo de planejamento.
--
-- Cada DROP abaixo está pareado com o índice que o cobre + os scans medidos.
-- Nada aqui apaga UNIQUE, PK ou índice que sustente constraint.
-- =============================================================================

-- time_records (4.076 linhas) — tinha QUATRO índices sobrepostos em employee/date.
-- Duplicata EXATA de time_records_employee_date_unique (employee_name, record_date),
-- que tem 4.116 scans. Este: 0 scans, 216 kB — o maior desperdício isolado do banco.
DROP INDEX IF EXISTS public.idx_time_records_employee_date;

-- (employee_id) é prefixo de idx_time_records_emp_date (employee_id, record_date).
DROP INDEX IF EXISTS public.idx_time_records_emp;

-- sale_orders — (client_id) é prefixo de idx_sale_orders_client_created
-- (client_id, created_at DESC), que tem 2.040 scans contra 15 deste.
DROP INDEX IF EXISTS public.idx_sale_orders_client_id;

-- production_wave_stages — (wave_id) é prefixo do UNIQUE
-- production_wave_stages_wave_id_stage_key (wave_id, stage), com 1.933 scans.
DROP INDEX IF EXISTS public.idx_wave_stages_wave;

-- technical_sheet_component_colors — (sheet_id) é prefixo de uq_component_color
-- (sheet_id, lower(btrim(cabedal_color)), product_id), com 1.451 scans.
DROP INDEX IF EXISTS public.idx_component_color_sheet;

-- sole_group_standard_items — (sole_group_id) é prefixo de DOIS uniques:
-- sole_group_standard_items_unique e sole_group_standard_items_role_unique.
DROP INDEX IF EXISTS public.idx_sgsi_group;

-- sole_silk_registrations — duplicata EXATA de
-- sole_silk_registrations_sole_product_id_unique (sole_product_id), 9 scans.
DROP INDEX IF EXISTS public.idx_sole_silk_registrations_product_id;

-- =============================================================================
-- NÃO dropados de propósito (verificados um a um):
--
-- • idx_fk_sole_silk_registrations_client_id — client_id é a SEGUNDA coluna de
--   sole_silk_registrations_sole_type_client_id_economic_group__key, não a
--   principal. Um índice composto não serve busca pela 2ª coluna isolada.
--   Não é redundante.
-- • idx_sale_orders_active / idx_sale_orders_created_at_desc — parcial vs total
--   sobre created_at DESC; ambos em uso (1.294 e 15.887 scans). Coexistem.
-- • idx_employee_advances_* — par mutuamente sobreposto sem vencedor claro nos
--   dados; 15 linhas, ganho nulo. Deixado como está para não errar.
-- • ~85 índices em tabelas com 0 linhas (features ainda não ativas): custo de
--   runtime zero. Dropar seria churn e eles voltariam quando a feature subir.
-- =============================================================================
