-- P0.5 (PRD Avaliação de Necessidade 2026-07-03): a tabela de backup criada em
-- 2026-06-30 ficou sem RLS — única tabela public exposta à anon key. Habilitar
-- RLS sem policy bloqueia todo acesso via API (leitura segue possível no SQL
-- Editor/service_role, que é o único uso legítimo de um backup).
ALTER TABLE public.sole_technical_specs_backup_20260630 ENABLE ROW LEVEL SECURITY;
