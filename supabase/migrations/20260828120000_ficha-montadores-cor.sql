-- Ficha de Montadores: campo Cor (2026-06-22)
-- A ficha do montador passa a registrar a COR (cabedal/montagem). Texto livre —
-- o montador preenche. Idempotente. ⚠ Aplicar via MCP (estava fora) ou Action;
-- o front é resiliente (salva sem cor enquanto a coluna não existir).
alter table public.ficha_montadores add column if not exists cor text;
