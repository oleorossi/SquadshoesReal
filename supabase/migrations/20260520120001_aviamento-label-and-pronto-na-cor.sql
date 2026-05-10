-- =============================================================================
-- PR 1 — Setores: Aviamento (label único) + auto-skip "Pronto na Cor"
-- =============================================================================
-- Decisões fechadas com o usuário:
--
--  • DB enum continua sendo `mesa` (não renomeamos pra evitar quebra de dados);
--    UI passa a exibir SEMPRE "Aviamento" (a página /aviamento já existia,
--    a página /mesa.tsx era órfã e será removida no PR de frontend).
--  • Quando `technical_sheets.insole_ready_made = true` (palmilha pronta na cor),
--    os setores "Corte Palmilha" e "Corte Forração" devem ser AUTOMATICAMENTE
--    removidos do array `production_sectors` — eles já não apareciam na ficha
--    do operador, mas estavam consumindo lead time na fórmula de onda.
--
-- Mudanças:
--  1. Backfill `technical_sheets.production_sectors` (JSONB):
--       • "Mesa"     → "Aviamento"        (label unificado)
--       • "Corte"    → "Corte Palmilha"   (legacy → novo)
--       • "Forração" → "Corte Forração"   (legacy → novo)
--       • "Costura"  → "Corte Forração"   (legacy → novo)
--  2. Trigger BEFORE INSERT/UPDATE em technical_sheets que remove
--     "Corte Palmilha" e "Corte Forração" quando insole_ready_made=true.
--  3. Backfill: aplica o trigger uma vez nas linhas existentes.
--  4. Atualiza DEFAULT de production_sectors para usar os labels novos.
-- =============================================================================

-- ─── 1. Backfill labels em production_sectors ───────────────────────────────
-- Função utilitária local (não exposta) que normaliza um único elemento.
-- Usada via subquery para reescrever cada chave do array.

UPDATE public.technical_sheets ts
SET production_sectors = (
  SELECT jsonb_agg(
    CASE LOWER(TRIM(elem.value::text, '"'))
      WHEN 'mesa'      THEN to_jsonb('Aviamento'::text)
      WHEN 'corte'     THEN to_jsonb('Corte Palmilha'::text)
      WHEN 'forração'  THEN to_jsonb('Corte Forração'::text)
      WHEN 'forracao'  THEN to_jsonb('Corte Forração'::text)
      WHEN 'costura'   THEN to_jsonb('Corte Forração'::text)
      ELSE elem.value
    END
    ORDER BY elem.idx
  )
  FROM jsonb_array_elements(ts.production_sectors) WITH ORDINALITY elem(value, idx)
)
WHERE ts.production_sectors IS NOT NULL
  AND jsonb_typeof(ts.production_sectors) = 'array'
  AND jsonb_array_length(ts.production_sectors) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(ts.production_sectors) x
    WHERE LOWER(x.value) IN ('mesa','corte','forração','forracao','costura')
  );

-- Dedup: se um array virou ["Corte Palmilha","Corte Palmilha", ...] (porque
-- já tinha "Corte" e "Corte Palmilha" originalmente), remove duplicatas
-- preservando a ordem de primeira aparição.
UPDATE public.technical_sheets ts
SET production_sectors = (
  SELECT jsonb_agg(value ORDER BY first_idx)
  FROM (
    SELECT value, MIN(idx) AS first_idx
    FROM jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY u(value, idx)
    GROUP BY value
  ) deduped
)
WHERE ts.production_sectors IS NOT NULL
  AND jsonb_typeof(ts.production_sectors) = 'array'
  AND jsonb_array_length(ts.production_sectors) > (
    SELECT COUNT(DISTINCT value) FROM jsonb_array_elements_text(ts.production_sectors) value
  );


-- ─── 2. Trigger: auto-skip Corte quando insole_ready_made = true ─────────────
-- Justificativa: solado com palmilha "pronta na cor" não passa por corte
-- (de palmilha nem de forração) — é entregue colorido pelo fornecedor.
-- O trigger apaga essas duas chaves do array antes de gravar a row.

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

  -- Remove "Corte Palmilha" e "Corte Forração" (e os legacy "Corte"/"Forração"/"Costura"
  -- caso ainda existam em alguma row velha não migrada).
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

COMMENT ON FUNCTION public.tg_strip_cut_sectors_when_ready_made() IS
  'Quando insole_ready_made=true, remove Corte Palmilha e Corte Forração do '
  'production_sectors JSONB. Solado pronto-na-cor não tem etapas de corte.';


-- ─── 3. Backfill ────────────────────────────────────────────────────────────
-- ATENÇÃO: o backfill foi MOVIDO para a migration 20260520130000_
-- fix-pronto-na-cor-backfill-fk-safe.sql porque o UPDATE no-op original
-- (`SET insole_ready_made = insole_ready_made`) re-validava o FK
-- shoe_category_id e abortava em rows com referência órfã (silk_shoe_category
-- deletada). Aplicar a 20260520130000 logo após esta migration.


-- ─── 4. Atualizar DEFAULT de production_sectors ────────────────────────────
-- O default original (definido em 20260316145244) usava "Corte","Forração",
-- "Aviamento". Atualizar pra ordem canônica nova com os labels corretos.
ALTER TABLE public.technical_sheets
  ALTER COLUMN production_sectors
  SET DEFAULT '["Corte Palmilha","Corte Forração","Aviamento","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb;

COMMENT ON COLUMN public.technical_sheets.production_sectors IS
  'Array JSONB com os setores que esta ficha técnica usa, em ordem de execução. '
  'Setores aceitos: Corte Palmilha, Corte Forração, Aviamento, Silk, Colagem, '
  'Montagem, Solagem, Acabamento, Expedição. Setores fora do array são ignorados '
  'pela fórmula de onda (compute_wave_timeline) e pela ficha de operador.';
