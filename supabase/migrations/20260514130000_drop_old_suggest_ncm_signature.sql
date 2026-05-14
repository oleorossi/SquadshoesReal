-- Limpeza: a função suggest_ncm_for_sheet ganhou um 4º parâmetro
-- (p_exclude_id) em 20260513200000_ncm_autofill_from_sole.sql, mas a
-- versão antiga de 3 args permaneceu no banco. CREATE OR REPLACE em
-- Postgres não substitui assinaturas diferentes, então as duas coexistiam.
-- Esta migration remove a versão antiga.
DROP FUNCTION IF EXISTS public.suggest_ncm_for_sheet(uuid, uuid, text);
