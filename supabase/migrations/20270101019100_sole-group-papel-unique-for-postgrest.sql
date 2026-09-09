-- =============================================================================
-- PAPEL em sole_group_standard_items: índice único SEM predicado
-- =============================================================================
-- Sintoma vivo (Solados → Consumo Padrão):
--   "Erro ao salvar: there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Causa: `useSetSoleGroupRole` faz upsert PostgREST com
--   onConflict: 'sole_group_id,role'
-- que vira `ON CONFLICT (sole_group_id, role)` SEM predicado. O índice criado
-- em 20261102120200 era PARCIAL (`WHERE role IS NOT NULL`), e o Postgres só
-- aceita esse índice como arbiter se o ON CONFLICT repetir o mesmo WHERE —
-- coisa que o PostgREST/supabase-js NÃO expõe no client.
--
-- O WHERE era desnecessário: em UNIQUE padrão, NULL é distinto de NULL, então
-- várias linhas ITEM (`role IS NULL`) no mesmo grupo já são permitidas sem o
-- predicado. Removê-lo preserva a unicidade do PAPEL e destrava o upsert.
-- =============================================================================

DROP INDEX IF EXISTS public.sole_group_standard_items_role_unique;

CREATE UNIQUE INDEX sole_group_standard_items_role_unique
  ON public.sole_group_standard_items (sole_group_id, role);

COMMENT ON INDEX public.sole_group_standard_items_role_unique IS
  'Um PAPEL por modelo de solado. Sem WHERE de propósito: o upsert PostgREST '
  '(onConflict sole_group_id,role) precisa de índice total. Linhas ITEM '
  '(role NULL) continuam podendo repetir no grupo — NULL é distinto em UNIQUE.';
