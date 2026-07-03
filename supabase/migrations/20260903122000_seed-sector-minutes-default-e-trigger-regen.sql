-- P0.1 / M3 — seed da Fonte B (sector_minutes_default) + regeneração automática.
--
-- sector_minutes_default estava VAZIA desde a criação (20260628181500) → 376/429
-- operações nasceram 'tempo_pendente' (active=false) → labor R$0 em 298 OPs.
-- Decisão do usuário (03/07): popular com benchmark derivado e refinar depois
-- (cronoanálise/UPSERT manual têm precedência — o generator v2 só usa a Fonte B
-- quando a ficha não tem capacidade, e cronoanálise/manual nunca são sobrescritos).
--
-- Seed em 3 camadas (nenhum valor mágico além da camada 3, documentada):
--   1. Mediana POR CATEGORIA dos tempos derivados de capacidade real das fichas.
--   2. Mediana GLOBAL por setor para as (categoria, setor) sem dado próprio —
--      a fábrica é a mesma; tempo por par varia menos por categoria que por setor.
--   3. Benchmark literal APENAS para setores sem nenhum dado de capacidade na base
--      (hoje: Aviamento 2,0 min/par e Solagem 1,8 min/par — chute inicial na ordem
--      de 240–300 pares/dia; REFINAR via cronoanálise ou UPSERT).
--
-- ⚠ Lacuna conhecida fora do escopo desta migration: sector_labor_rates tem
--   montagem=0 e expedicao=0 → labor dessas etapas sai R$0 mesmo com tempo.
--   Corrigir a taxa e re-rodar generate_bom_operations().
--
-- Ajustes do usuário (têm precedência sobre o seed):
--   INSERT INTO sector_minutes_default (shoe_category, sector, minutes_per_pair)
--   VALUES ('Sandália', 'Montagem', 3.2)
--   ON CONFLICT (shoe_category, sector) DO UPDATE
--     SET minutes_per_pair = EXCLUDED.minutes_per_pair, updated_at = now();
-- (o trigger abaixo re-gera bom_operations e o custeio re-dispara sozinho)

-- Camada 1: mediana por (categoria, setor) a partir de tempos de capacidade real
INSERT INTO public.sector_minutes_default (shoe_category, sector, minutes_per_pair)
SELECT ts.shoe_category, b.stage,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.standard_time_minutes))::numeric, 4)
  FROM public.bom_operations b
  JOIN public.technical_sheets ts ON ts.id = b.sheet_id
 WHERE b.time_source = 'capacidade' AND b.standard_time_minutes > 0
   AND ts.shoe_category IS NOT NULL
 GROUP BY ts.shoe_category, b.stage
ON CONFLICT (shoe_category, sector) DO NOTHING;

-- Camada 2: mediana global por setor, para (categoria, setor) que a categoria usa
-- nas fichas mas ainda não tem entrada
WITH global_median AS (
  SELECT b.stage,
         round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.standard_time_minutes))::numeric, 4) AS med
    FROM public.bom_operations b
   WHERE b.time_source = 'capacidade' AND b.standard_time_minutes > 0
   GROUP BY b.stage
), combos AS (
  SELECT DISTINCT COALESCE(ts.shoe_category, '') AS shoe_category, trim(s) AS sector
    FROM public.technical_sheets ts
   CROSS JOIN LATERAL jsonb_array_elements_text(ts.production_sectors) s
   WHERE jsonb_typeof(ts.production_sectors) = 'array'
)
INSERT INTO public.sector_minutes_default (shoe_category, sector, minutes_per_pair)
SELECT c.shoe_category, c.sector, g.med
  FROM combos c
  JOIN global_median g ON g.stage = c.sector
ON CONFLICT (shoe_category, sector) DO NOTHING;

-- Camada 3: benchmark literal para setores sem NENHUM dado de capacidade
WITH bench(sector, minutes) AS (
  VALUES ('Aviamento', 2.0), ('Solagem', 1.8)
), combos AS (
  SELECT DISTINCT COALESCE(ts.shoe_category, '') AS shoe_category, trim(s) AS sector
    FROM public.technical_sheets ts
   CROSS JOIN LATERAL jsonb_array_elements_text(ts.production_sectors) s
   WHERE jsonb_typeof(ts.production_sectors) = 'array'
)
INSERT INTO public.sector_minutes_default (shoe_category, sector, minutes_per_pair)
SELECT c.shoe_category, c.sector, b.minutes
  FROM combos c
  JOIN bench b ON b.sector = c.sector
ON CONFLICT (shoe_category, sector) DO NOTHING;

-- Query de lacunas (rodar após o seed; esperado: 0 linhas — toda combinação usada
-- pelas fichas tem entrada ou capacidade própria):
--   SELECT DISTINCT COALESCE(ts.shoe_category,'') AS categoria, trim(s) AS setor
--     FROM technical_sheets ts
--    CROSS JOIN LATERAL jsonb_array_elements_text(ts.production_sectors) s
--    WHERE jsonb_typeof(ts.production_sectors)='array'
--      AND NOT EXISTS (SELECT 1 FROM sector_minutes_default d
--                       WHERE d.shoe_category = COALESCE(ts.shoe_category,'')
--                         AND d.sector = trim(s));

-- Trigger: editar a Fonte B re-gera bom_operations (v2 é idempotente e preserva
-- manual/cronoanálise; 46 fichas → custo baixo). A cascata completa fica:
-- default → regen → trg_mark_so_costs_dirty_from_bom_ops → cron de custeio.
-- Se o número de fichas crescer muito, trocar por fila (marcador + job).
CREATE OR REPLACE FUNCTION public.tg_regen_bom_on_minutes_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.generate_bom_operations();
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tg_regen_bom_on_minutes_default() FROM public, anon;

DROP TRIGGER IF EXISTS trg_regen_bom_on_minutes_default ON public.sector_minutes_default;
CREATE TRIGGER trg_regen_bom_on_minutes_default
  AFTER INSERT OR UPDATE OR DELETE ON public.sector_minutes_default
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_regen_bom_on_minutes_default();

-- Primeira regeneração preservante com a Fonte B populada
SELECT public.generate_bom_operations();
