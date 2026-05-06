-- =============================================================================
-- Audit-2 Batch I: update wave_stage_to_kanban_stages / kanban_stage_to_wave_stage
-- to recognise the post-rename sector vocabulary.
-- =============================================================================
--
-- Background: 20260506120000_sector-rename-wave-stages.sql added new enum
-- values to production_stage_enum ('corte_palmilha', 'corte_forracao', 'silk',
-- 'colagem', 'expedicao') and remapped all live production_wave_stages rows
-- to those new values. It DID NOT, however, update the two helper functions
-- defined in 20260430100000_sync-kanban-wave-bidirectional.sql:
--
--   * wave_stage_to_kanban_stages(production_stage_enum) → text[]
--   * kanban_stage_to_wave_stage(text)                   → production_stage_enum
--
-- After the rename, both functions silently fall through to
-- ELSE ARRAY[]::text[] / ELSE NULL for the new enum values, which breaks:
--   * sync_wave_from_kanban() — wave never advances from Kanban completion
--   * advance_wave_stage()    — manual wave advance never marks order_stages
--
-- This migration recreates both helpers with the canonical vocabulary plus
-- legacy fallbacks (so any stray rows still using old names are tolerated).
-- =============================================================================

-- ── 1. wave stage enum → list of Kanban stage names (lower-cased) ────────────
CREATE OR REPLACE FUNCTION public.wave_stage_to_kanban_stages(s production_stage_enum)
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte_palmilha' THEN ARRAY['corte palmilha', 'palmilha', 'corte']
    WHEN 'corte_forracao' THEN ARRAY['corte forração', 'corte forracao',
                                     'forração', 'forracao', 'forro', 'forra',
                                     'costura']
    WHEN 'mesa'           THEN ARRAY['mesa', 'aviamento']
    WHEN 'silk'           THEN ARRAY['silk', 'serigrafia', 'silkscreen']
    WHEN 'colagem'        THEN ARRAY['colagem']
    WHEN 'montagem'       THEN ARRAY['montagem', 'colagem']
    WHEN 'solagem'        THEN ARRAY['solagem']
    WHEN 'acabamento'     THEN ARRAY['acabamento']
    WHEN 'expedicao'      THEN ARRAY['expedição', 'expedicao']
    -- Legacy enum values still exist in the type definition (Postgres can't
    -- drop enum values). They should not appear in live rows after the
    -- rename migration but we map them defensively.
    WHEN 'corte'          THEN ARRAY['corte palmilha', 'palmilha', 'corte']
    WHEN 'palmilha'       THEN ARRAY['corte palmilha', 'palmilha']
    WHEN 'costura'        THEN ARRAY['corte forração', 'corte forracao',
                                     'forração', 'forracao', 'forro', 'forra',
                                     'costura', 'silk', 'serigrafia',
                                     'silkscreen', 'aviamento']
    ELSE                  ARRAY[]::text[]
  END;
$$;

GRANT EXECUTE ON FUNCTION public.wave_stage_to_kanban_stages(production_stage_enum) TO authenticated;

-- ── 2. Kanban stage name → wave enum stage ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_stage_to_wave_stage(p_stage_name text)
RETURNS production_stage_enum
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(trim(p_stage_name))
    -- Canonical post-rename Kanban names
    WHEN 'corte palmilha' THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte forração' THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte forracao' THEN 'corte_forracao'::production_stage_enum
    WHEN 'mesa'           THEN 'mesa'::production_stage_enum
    WHEN 'silk'           THEN 'silk'::production_stage_enum
    WHEN 'colagem'        THEN 'colagem'::production_stage_enum
    WHEN 'montagem'       THEN 'montagem'::production_stage_enum
    WHEN 'solagem'        THEN 'solagem'::production_stage_enum
    WHEN 'acabamento'     THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'      THEN 'expedicao'::production_stage_enum
    WHEN 'expedicao'      THEN 'expedicao'::production_stage_enum
    -- Legacy / accent variations remap to canonical post-rename enum values.
    WHEN 'corte'          THEN 'corte_palmilha'::production_stage_enum
    WHEN 'palmilha'       THEN 'corte_palmilha'::production_stage_enum
    WHEN 'costura'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forração'       THEN 'corte_forracao'::production_stage_enum
    WHEN 'forracao'       THEN 'corte_forracao'::production_stage_enum
    WHEN 'forro'          THEN 'corte_forracao'::production_stage_enum
    WHEN 'forra'          THEN 'corte_forracao'::production_stage_enum
    WHEN 'aviamento'      THEN 'mesa'::production_stage_enum
    WHEN 'serigrafia'     THEN 'silk'::production_stage_enum
    WHEN 'silkscreen'     THEN 'silk'::production_stage_enum
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.kanban_stage_to_wave_stage(text) TO authenticated;
