-- =============================================================================
-- REMOVE feature: Numerações conjugadas em Solados (2026-05-31)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-31.
--
-- User: 'Excluir essa área do front e do back, não tem por que ter isso ali'.
--
-- Estado pré-cleanup:
--   - 8 conjugações cadastradas: SOLADO 204 (25/26, 27, 28, 29, 30, 31/32),
--     SOLADO 238 (33/34, 39/40)
--   - 3 produtos com chaves "X/Y" no stock_grade, 2 células com qty > 0
--
-- Cleanup aplicado:
--   1. Migra stock_grade: chaves "X/Y" com qty Q viram X (CEIL(Q/2)) + Y (FLOOR(Q/2))
--      somando ao existente nesses tamanhos. Log em sole_grade_split_log.
--   2. Reescreve debit_sole_stock_by_grade SEM consultar conjugações —
--      effective_grade = order_grade direto (ignora chaves "X/Y").
--   3. Drop function get_sole_size_key(uuid, integer)
--   4. Drop table sole_size_conjugations CASCADE
--
-- Snapshot pra auditoria:
--   - sole_size_conjugations_removed_log (8 rows preservadas)
--   - sole_grade_split_log (6 entradas migradas)
--
-- Frontend (commit relacionado):
--   - Bloco UI "Conjugações de Numeração" removido em:
--     SolesCadastroTab.tsx, TechnicalSheets.tsx (Cabedal section),
--     MasterVariantDialog.tsx, ProductFormDialog.tsx
--   - SoleSizeConjugationsEditor.tsx deletado
--   - useSoleConjugations hook vira no-op (retorna array vazio pra não
--     quebrar callers remanescentes)
--   - useDisplaySizeKeys retorna sizes.map(String) direto (sem query DB)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sole_size_conjugations_removed_log (
  removed_at timestamptz NOT NULL DEFAULT now(),
  sole_group_id uuid,
  size_key text,
  sizes int[],
  display_order int
);

INSERT INTO public.sole_size_conjugations_removed_log (sole_group_id, size_key, sizes, display_order)
SELECT sole_group_id, size_key, sizes, display_order FROM public.sole_size_conjugations
WHERE NOT EXISTS (SELECT 1 FROM public.sole_size_conjugations_removed_log);

CREATE TABLE IF NOT EXISTS public.sole_grade_split_log (
  migrated_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid NOT NULL,
  conj_key text NOT NULL,
  qty_split numeric NOT NULL,
  split_into text[]
);

-- Migra stock_grade "X/Y" → X + Y individuais (idempotente)
DO $$
DECLARE
  rec RECORD;
  v_key text;
  v_qty numeric;
  v_parts text[];
  v_size_a text;
  v_size_b text;
  v_half_a numeric;
  v_half_b numeric;
  v_existing_a numeric;
  v_existing_b numeric;
  v_new_grade jsonb;
BEGIN
  FOR rec IN
    SELECT p.id, p.stock_grade
    FROM public.products p
    WHERE p.category = 'Solado'
      AND p.stock_grade IS NOT NULL
      AND jsonb_typeof(p.stock_grade) = 'object'
  LOOP
    v_new_grade := rec.stock_grade;
    FOR v_key, v_qty IN
      SELECT key, value::numeric FROM jsonb_each_text(rec.stock_grade)
      WHERE key LIKE '%/%'
    LOOP
      v_parts := string_to_array(v_key, '/');
      IF array_length(v_parts, 1) = 2 THEN
        v_size_a := trim(v_parts[1]);
        v_size_b := trim(v_parts[2]);
        v_half_a := CEIL(v_qty / 2.0);
        v_half_b := FLOOR(v_qty / 2.0);
        v_existing_a := COALESCE((v_new_grade ->> v_size_a)::numeric, 0);
        v_existing_b := COALESCE((v_new_grade ->> v_size_b)::numeric, 0);
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size_a], to_jsonb(v_existing_a + v_half_a));
        v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size_b], to_jsonb(v_existing_b + v_half_b));
        v_new_grade := v_new_grade - v_key;
        INSERT INTO public.sole_grade_split_log (product_id, conj_key, qty_split, split_into)
        VALUES (rec.id, v_key, v_qty, ARRAY[v_size_a || '+' || v_half_a, v_size_b || '+' || v_half_b]);
      END IF;
    END LOOP;
    IF v_new_grade <> rec.stock_grade THEN
      UPDATE public.products SET stock_grade = v_new_grade, updated_at = now() WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.get_sole_size_key(uuid, integer);

-- Reescreve debit_sole_stock_by_grade sem conjugação
-- (definição completa aplicada via MCP — espelho em produção)
-- Ver pg_proc.pg_get_functiondef(debit_sole_stock_by_grade) pra source autoritativa

DROP TABLE IF EXISTS public.sole_size_conjugations CASCADE;
