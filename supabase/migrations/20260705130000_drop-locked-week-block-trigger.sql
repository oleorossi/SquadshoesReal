-- Remove o trigger legado do BANCO DE HORAS que bloqueava INSERT/UPDATE/DELETE em
-- time_records quando a semana estava "congelada" (weekly_balance_snapshot.locked_at).
--
-- Contexto: o banco de horas foi APOSENTADO (modelo atual = folha por HORA trabalhada,
-- sem trava semanal). Mas o trigger `trg_block_edit_in_locked_week` continuou ligado e
-- passou a BLOQUEAR importações legítimas do relógio de ponto: ao importar as batidas
-- da semana de 25/05/2026 (os 15 funcionários tinham weekly_balance_snapshot com
-- locked_at preenchido de um fechamento antigo), o import abortava com
--   "Esta semana (25/05/2026) está fechada para o funcionário. Use unlock_week()..."
-- forçando o usuário a destravar semana-a-semana (whack-a-mole) pra conseguir importar.
--
-- Fix de raiz: remover SÓ o trigger de time_records. Preservamos a função
-- tg_block_edit_in_locked_week(), a função unlock_week() e a tabela
-- weekly_balance_snapshot (histórico do banco de horas) — se um dia o workflow de
-- fechamento semanal voltar, basta recriar o trigger.

DROP TRIGGER IF EXISTS trg_block_edit_in_locked_week ON public.time_records;
