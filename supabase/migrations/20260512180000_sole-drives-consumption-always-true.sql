-- =============================================================================
-- 20260512180000 — sole_drives_consumption sempre true (todo consumo é por grade)
-- =============================================================================
-- O checkbox "Consumo por Grade" no editor de ficha técnica vinha desmarcado
-- por default, o que deixava 16/25 fichas com sole_drives_consumption=false.
-- Isso causa fallback errado no calculo de consumo (deveria sempre olhar pra
-- grade do solado pra consumo de palmilha/forração). Decisão de negócio:
-- todo consumo é por grade — não tem porque existir o toggle.
--
-- Mudanças:
-- 1) Schema default da coluna passa pra true.
-- 2) Backfill: todas as rows existentes com false viram true.
-- 3) UI: checkbox removido em src/pages/TechnicalSheets.tsx.
-- =============================================================================

ALTER TABLE public.technical_sheets
  ALTER COLUMN sole_drives_consumption SET DEFAULT true;

UPDATE public.technical_sheets
   SET sole_drives_consumption = true, updated_at = now()
 WHERE sole_drives_consumption = false OR sole_drives_consumption IS NULL;
