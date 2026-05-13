-- =============================================================================
-- Fix: backfill da migration 20260520120000 falhava em rows com FK quebrado
-- =============================================================================
-- A migration anterior usava `UPDATE ... SET insole_ready_made = insole_ready_made`
-- pra disparar o trigger e limpar production_sectors em rows existentes. O
-- problema é que ALGUMAS rows de technical_sheets têm `shoe_category_id` órfão
-- (apontando pra `silk_shoe_category` deletada). O Postgres re-valida FKs em
-- UPDATE e abortava com 23503.
--
-- Esta migration:
--   1. Re-cria o trigger (idempotente — caso a anterior tenha falhado
--      antes de chegar nessa parte).
--   2. Aplica a limpeza inline (UPDATE só mexe em production_sectors) com
--      DO/EXCEPTION pra pular silenciosamente rows com FK quebrado, sem
--      abortar o backfill todo.
-- =============================================================================

-- ─── 1. Trigger (idempotente) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_strip_cut_sectors_when_ready_made()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_input jsonb;
BEGIN
  IF COALESCE(NEW.insole_ready_made, false) = false THEN
    RETURN NEW;
  END IF;

  v_input := COALESCE(NEW.production_sectors, '[]'::jsonb);
  IF jsonb_typeof(v_input) <> 'array' THEN
    RETURN NEW;
  END IF;

  NEW.production_sectors := COALESCE((
    SELECT jsonb_agg(value ORDER BY idx)
    FROM jsonb_array_elements_text(v_input) WITH ORDINALITY u(value, idx)
    WHERE LOWER(TRIM(value)) NOT IN (
      'corte palmilha','corte forração','corte forracao',
      'corte','forração','forracao','costura'
    )
  ), '[]'::jsonb);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_strip_cut_sectors_when_ready_made ON public.technical_sheets;
CREATE TRIGGER trg_strip_cut_sectors_when_ready_made
  BEFORE INSERT OR UPDATE OF insole_ready_made, production_sectors
  ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_strip_cut_sectors_when_ready_made();


-- ─── 2. Backfill seguro (FK-safe) ───────────────────────────────────────────
-- Aplica a mesma lógica do trigger nas rows existentes com insole_ready_made=true,
-- mas pula rows cujo UPDATE viole FKs pré-existentes (data corruption antiga).
--
-- Em vez de "tocar" insole_ready_made (que re-valida FK do shoe_category_id),
-- fazemos o UPDATE direto em production_sectors com a versão já limpa.
DO $$
DECLARE
  v_row record;
  v_skipped int := 0;
  v_updated int := 0;
BEGIN
  FOR v_row IN
    SELECT id, production_sectors
      FROM public.technical_sheets
     WHERE COALESCE(insole_ready_made, false) = true
       AND production_sectors IS NOT NULL
       AND jsonb_typeof(production_sectors) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(production_sectors) x
         WHERE LOWER(TRIM(x.value)) IN (
           'corte palmilha','corte forração','corte forracao',
           'corte','forração','forracao','costura'
         )
       )
  LOOP
    BEGIN
      UPDATE public.technical_sheets
         SET production_sectors = COALESCE((
               SELECT jsonb_agg(value ORDER BY idx)
                 FROM jsonb_array_elements_text(v_row.production_sectors)
                      WITH ORDINALITY u(value, idx)
                WHERE LOWER(TRIM(value)) NOT IN (
                  'corte palmilha','corte forração','corte forracao',
                  'corte','forração','forracao','costura'
                )
             ), '[]'::jsonb)
       WHERE id = v_row.id;
      v_updated := v_updated + 1;
    EXCEPTION
      WHEN foreign_key_violation THEN
        -- Pula rows com FK quebrado (corruption pré-existente em
        -- shoe_category_id apontando pra silk_shoe_category órfã).
        -- Não bloqueia o resto do backfill.
        v_skipped := v_skipped + 1;
        RAISE NOTICE 'Pulando ficha % (shoe_category_id órfão — corrigir manualmente)', v_row.id;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill Pronto na Cor: % atualizadas, % puladas (FK quebrado).',
    v_updated, v_skipped;
END $$;
