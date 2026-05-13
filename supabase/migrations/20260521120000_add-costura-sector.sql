-- =============================================================================
-- PR 2 — Novo setor "Costura" + coluna de capacidade + cascata atualizada
-- =============================================================================
-- Decisões fechadas com o usuário:
--
--  • Setor Costura sempre existe, EXCETO quando solado tem `insole_ready_made=true`
--    (palmilha pronta na cor não precisa ser costurada com a forração).
--  • Costura inclui costura DE PALMILHA + costura DE CABEDAL.
--  • O CORTE do cabedal acontece em "Corte Palmilha" (mesmo setor), quando o
--    modelo não é "tiras". Esta migration NÃO mexe nessa lógica — só adiciona
--    Costura como setor de costura.
--  • Sequência canônica:
--      Corte Palmilha (1) → Corte Forração (2) → Costura (3) → Mesa/Aviamento (4)
--      → Silk (5) → Colagem (6) → Montagem (7) → Solagem (8) → Acabamento (9)
--      → Expedição (10)
--  • Aviamento, Corte Palmilha e Corte Forração rodam em PARALELO entre si
--    (refactor de paralelismo fica pra PR seguinte). Costura é sequencial.
--
-- Mudanças:
--   1. ALTER TABLE technical_sheets: nova coluna `costura_capacity_per_day`.
--   2. ALTER TABLE production_waves: nova coluna `costura_start_date`.
--   3. Reaproveita enum value 'costura' (legacy mapeada pra corte_forracao,
--      backfill da migration 20260506120000 já promoveu rows antigas).
--   4. Atualiza stage_order() empurrando mesa(3→4) e seguintes.
--   5. Atualiza sector_display_to_enum(): 'costura' → 'costura'::enum (era
--      'corte_forracao').
--   6. Atualiza tg_strip_cut_sectors_when_ready_made() para remover "Costura"
--      junto quando insole_ready_made=true.
--   7. Atualiza DEFAULT de production_sectors com Costura.
--   8. Backfill JSONB: insere "Costura" em fichas com insole_ready_made=false
--      (FK-safe via DO/EXCEPTION).
--   9. Atualiza compute_wave_timeline() incluindo v_lead_costura na cascata.
--  10. Atualiza update_wave_timeline() para persistir costura_start_date.
--  11. Recria v_wave_detail expondo costura_start_date.
-- =============================================================================


-- ─── 1. Nova coluna em technical_sheets ────────────────────────────────────
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS costura_capacity_per_day numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.technical_sheets.costura_capacity_per_day IS
  'Pares por dia que o setor de Costura consegue processar para esta ficha. '
  'Costura inclui: costura palmilha+forração + costura do cabedal. '
  'Setor é pulado quando insole_ready_made=true (palmilha pronta na cor).';


-- ─── 2. Nova coluna em production_waves ────────────────────────────────────
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS costura_start_date date;


-- ─── 3. stage_order() — reordenar inserindo costura em 3 ───────────────────
DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte_palmilha' THEN 1
    WHEN 'corte_forracao' THEN 2
    WHEN 'costura'        THEN 3   -- novo posicionamento
    WHEN 'mesa'           THEN 4   -- Aviamento (era 3)
    WHEN 'silk'           THEN 5   -- (era 4)
    WHEN 'colagem'        THEN 6   -- (era 5)
    WHEN 'montagem'       THEN 7   -- (era 6)
    WHEN 'solagem'        THEN 8   -- (era 7)
    WHEN 'acabamento'     THEN 9   -- (era 8)
    WHEN 'expedicao'      THEN 10  -- (era 9)
    -- Legacy backward-compat
    WHEN 'corte'          THEN 1
    WHEN 'palmilha'       THEN 1
    -- Anything unrecognised → sort last
    ELSE 99
  END;
$$;

COMMENT ON FUNCTION public.stage_order(production_stage_enum) IS
  'Returns the sequential execution order. Canonical: corte_palmilha(1) → '
  'corte_forracao(2) → costura(3) → mesa/Aviamento(4) → silk(5) → colagem(6) → '
  'montagem(7) → solagem(8) → acabamento(9) → expedicao(10).';


-- ─── 4. sector_display_to_enum() — Costura agora é própria ─────────────────
DROP FUNCTION IF EXISTS public.sector_display_to_enum(p_name text) CASCADE;
CREATE OR REPLACE FUNCTION public.sector_display_to_enum(p_name text)
RETURNS production_stage_enum
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(trim(p_name))
    WHEN 'corte palmilha'  THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte forração'  THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte forracao'  THEN 'corte_forracao'::production_stage_enum
    WHEN 'costura'         THEN 'costura'::production_stage_enum
    WHEN 'mesa'            THEN 'mesa'::production_stage_enum
    WHEN 'aviamento'       THEN 'mesa'::production_stage_enum
    WHEN 'silk'            THEN 'silk'::production_stage_enum
    WHEN 'colagem'         THEN 'colagem'::production_stage_enum
    WHEN 'montagem'        THEN 'montagem'::production_stage_enum
    WHEN 'solagem'         THEN 'solagem'::production_stage_enum
    WHEN 'acabamento'      THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'       THEN 'expedicao'::production_stage_enum
    WHEN 'expedicao'       THEN 'expedicao'::production_stage_enum
    -- Legacy
    WHEN 'corte'           THEN 'corte_palmilha'::production_stage_enum
    WHEN 'palmilha'        THEN 'corte_palmilha'::production_stage_enum
    WHEN 'forração'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forracao'        THEN 'corte_forracao'::production_stage_enum
    WHEN 'forro'           THEN 'corte_forracao'::production_stage_enum
    WHEN 'serigrafia'      THEN 'silk'::production_stage_enum
    WHEN 'silkscreen'      THEN 'silk'::production_stage_enum
    ELSE NULL
  END;
$$;
GRANT EXECUTE ON FUNCTION public.sector_display_to_enum(text) TO authenticated;


-- ─── 5. Atualiza trigger Pronto na Cor — remove também Costura ─────────────
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
      'corte palmilha','corte forração','corte forracao','costura',
      -- legacy
      'corte','forração','forracao'
    )
  ), '[]'::jsonb);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_strip_cut_sectors_when_ready_made() IS
  'Quando insole_ready_made=true, remove Corte Palmilha, Corte Forração e '
  'Costura do production_sectors JSONB. Solado pronto-na-cor não tem corte '
  'interno nem precisa costurar palmilha com forração.';


-- ─── 6. DEFAULT atualizado pra incluir Costura ─────────────────────────────
ALTER TABLE public.technical_sheets
  ALTER COLUMN production_sectors
  SET DEFAULT '["Corte Palmilha","Corte Forração","Costura","Aviamento","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb;

COMMENT ON COLUMN public.technical_sheets.production_sectors IS
  'Setores aplicáveis: Corte Palmilha, Corte Forração, Costura, Aviamento, '
  'Silk, Colagem, Montagem, Solagem, Acabamento, Expedição. Setores fora do '
  'array são ignorados pela fórmula de onda e pela ficha de operador.';


-- ─── 7. Backfill: adiciona "Costura" às fichas que devem ter ──────────────
DO $$
DECLARE
  v_row record;
  v_pos int;
  v_new_sectors jsonb;
  v_skipped int := 0;
  v_updated int := 0;
BEGIN
  FOR v_row IN
    SELECT id, production_sectors
      FROM public.technical_sheets ts
     WHERE COALESCE(insole_ready_made, false) = false
       AND production_sectors IS NOT NULL
       AND jsonb_typeof(production_sectors) = 'array'
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(production_sectors) x
         WHERE LOWER(TRIM(x.value)) = 'costura'
       )
  LOOP
    -- Posição depois de "Corte Forração"
    SELECT MIN(u.idx) + 1 INTO v_pos
      FROM jsonb_array_elements_text(v_row.production_sectors) WITH ORDINALITY u(value, idx)
     WHERE LOWER(TRIM(u.value)) IN ('corte forração','corte forracao','forração','forracao');
    v_pos := COALESCE(v_pos, 1);

    -- Insere "Costura" na posição calculada
    v_new_sectors := COALESCE((
      SELECT jsonb_agg(elem ORDER BY ord) FROM (
        SELECT u.value AS elem, u.idx::numeric AS ord
          FROM jsonb_array_elements_text(v_row.production_sectors) WITH ORDINALITY u(value, idx)
        UNION ALL
        SELECT 'Costura'::text, (v_pos - 0.5)::numeric
      ) all_elems
    ), v_row.production_sectors);

    BEGIN
      UPDATE public.technical_sheets
         SET production_sectors = v_new_sectors
       WHERE id = v_row.id;
      v_updated := v_updated + 1;
    EXCEPTION
      WHEN foreign_key_violation THEN
        v_skipped := v_skipped + 1;
        RAISE NOTICE 'Pulando ficha % (FK órfão)', v_row.id;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill Costura: % fichas atualizadas, % puladas.', v_updated, v_skipped;
END $$;


-- ─── 8. compute_wave_timeline() — adiciona Costura à cascata ──────────────
DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline             date,
  corte_palmilha_start_date     date,
  corte_forracao_start_date     date,
  costura_start_date            date,
  mesa_start_date               date,
  silk_start_date               date,
  colagem_start_date            date,
  montagem_start_date           date,
  solagem_start_date            date,
  acabamento_start_date         date,
  material_ready_date           date,
  purchase_deadline             date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_palmilha  int;
  v_lead_forracao  int;
  v_lead_costura   int;
  v_lead_mesa      int;
  v_lead_silk      int;
  v_lead_colagem   int;
  v_lead_montagem  int;
  v_lead_solagem   int;
  v_lead_acab      int;
  v_lead_buffer    int;
  v_lead_supplier  int;
  v_deadline       date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    -- Corte Palmilha
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'corte_palmilha'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1)
        END
      ELSE 0 END
    ), 1),

    -- Corte Forração
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'corte_forracao'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2)
        END
      ELSE 0 END
    ), 0),

    -- Costura (NOVO)
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'costura'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),

    -- Mesa/Aviamento
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'mesa'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),

    -- Silk
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'silk'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),

    -- Colagem
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'colagem'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),

    -- Montagem
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2)
      END
    ), 2),

    -- Solagem
    COALESCE(MAX(
      CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
        WHERE sector_display_to_enum(x.value) = 'solagem'
      ) THEN
        CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),

    -- Acabamento
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),

    -- Buffer
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias,0),
      dlt.lead_time_buffer_material_dias, 2
    )), 2)

  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
    v_lead_silk, v_lead_colagem,
    v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer

  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Supplier lead time
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed,0) > COALESCE(p.quantity,0)
         THEN COALESCE(p.supplier_lead_time_days,10) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Cascata sequencial:
  -- corte_palmilha → corte_forracao → costura → mesa → silk → colagem
  --   → montagem → solagem → acabamento
  -- (paralelismo Corte P‖Corte F‖Mesa fica em PR seguinte)
  RETURN QUERY SELECT
    v_deadline AS earliest_deadline,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem
        + v_lead_silk + v_lead_mesa + v_lead_costura + v_lead_forracao + v_lead_palmilha)
    )::date AS corte_palmilha_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem
        + v_lead_silk + v_lead_mesa + v_lead_costura + v_lead_forracao)
    )::date AS corte_forracao_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem
        + v_lead_silk + v_lead_mesa + v_lead_costura)
    )::date AS costura_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem
        + v_lead_silk + v_lead_mesa)
    )::date AS mesa_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk)
    )::date AS silk_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem)
    )::date AS colagem_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem)
    )::date AS montagem_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem)
    )::date AS solagem_start_date,

    add_business_days(v_deadline, -v_lead_acab)::date AS acabamento_start_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem
        + v_lead_silk + v_lead_mesa + v_lead_costura + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer)
    )::date AS material_ready_date,

    add_business_days(v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem
        + v_lead_silk + v_lead_mesa + v_lead_costura + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer + v_lead_supplier)
    )::date AS purchase_deadline;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_wave_timeline(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Cascata sequencial: corte_palmilha → corte_forracao → costura → mesa/Aviamento '
  '→ silk → colagem → montagem → solagem → acabamento. Costura é NOVO setor; '
  'paralelismo (Corte P ‖ Corte F ‖ Aviamento) será implementado em PR futuro.';


-- ─── 9. update_wave_timeline() — persiste costura_start_date ──────────────
DROP FUNCTION IF EXISTS public.update_wave_timeline(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_order_ids uuid[];
  v_tl             record;
BEGIN
  SELECT array_agg(DISTINCT sale_order_id)
    INTO v_sale_order_ids
    FROM public.orders
   WHERE wave_id = p_wave_id;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids,1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl FROM public.compute_wave_timeline(v_sale_order_ids) LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline          = v_tl.earliest_deadline,
         purchase_deadline          = v_tl.purchase_deadline,
         material_ready_date        = v_tl.material_ready_date,
         corte_palmilha_start_date  = v_tl.corte_palmilha_start_date,
         corte_forracao_start_date  = v_tl.corte_forracao_start_date,
         costura_start_date         = v_tl.costura_start_date,
         mesa_start_date            = v_tl.mesa_start_date,
         silk_start_date            = v_tl.silk_start_date,
         colagem_start_date         = v_tl.colagem_start_date,
         montagem_start_date        = v_tl.montagem_start_date,
         solagem_start_date         = v_tl.solagem_start_date,
         acabamento_start_date      = v_tl.acabamento_start_date,
         updated_at                 = now()
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_wave_timeline(uuid) TO authenticated;


-- ─── 10. v_wave_detail — expor costura_start_date ─────────────────────────
DROP VIEW IF EXISTS public.v_wave_detail CASCADE;
CREATE OR REPLACE VIEW public.v_wave_detail AS
SELECT
  w.id                         AS wave_id,
  w.code,
  w.week_start,
  w.week_end,
  w.status                     AS wave_status,
  w.current_stage,
  w.total_pairs,
  w.total_items,
  -- timeline dates
  w.earliest_deadline,
  w.purchase_deadline,
  w.material_ready_date,
  w.corte_palmilha_start_date,
  w.corte_forracao_start_date,
  w.costura_start_date,
  w.mesa_start_date,
  w.silk_start_date,
  w.colagem_start_date,
  w.montagem_start_date,
  w.solagem_start_date,
  w.acabamento_start_date,
  -- stages array
  (SELECT jsonb_agg(jsonb_build_object(
       'stage',        s.stage,
       'status',       s.status,
       'progress_pct', s.progress_pct,
       'started_at',   s.started_at,
       'finished_at',  s.finished_at
     ) ORDER BY stage_order(s.stage))
   FROM production_wave_stages s WHERE s.wave_id = w.id) AS stages,
  -- items array
  (SELECT jsonb_agg(jsonb_build_object(
       'item_id',         wi.id,
       'reference_id',    wi.reference_id,
       'reference_name',  ts.name,
       'sole_product_id', wi.sole_product_id,
       'sole_name',       p_sole.name,
       'color',           wi.color,
       'total_quantity',  wi.total_quantity,
       'grade',           wi.grade
     ) ORDER BY p_sole.name NULLS LAST, ts.name, wi.color)
   FROM production_wave_items wi
   LEFT JOIN technical_sheets ts      ON ts.id     = wi.reference_id
   LEFT JOIN products          p_sole ON p_sole.id = wi.sole_product_id
   WHERE wi.wave_id = w.id) AS items
FROM production_waves w;

GRANT SELECT ON public.v_wave_detail TO authenticated;
