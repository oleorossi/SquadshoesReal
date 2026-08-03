-- Fase 1a de specs/pv-producao-performance-e-pendencias.md
-- Requisitos 22, 23, 24, 25.
--
-- PROBLEMA (medido em 03/08/2026): `compute_min_billing_dates` leva 1.058 ms para
-- devolver 58 linhas (37.035 buffers) e roda a CADA mount de /sales só para marcar
-- em vermelho as linhas com delivery_deadline < min_billing_date.
-- Em pg_stat_statements era a consulta mais cara do banco inteiro: 1.225 s
-- acumulados. O commit 5c26627 matou o N+1 (1.516 chamadas), não o custo unitário.
--
-- SOLUÇÃO: cache persistido. A lista lê valor gravado (~0 ms); o recálculo acontece
-- em segundo plano, nunca no caminho crítico (requisito 25).
--
-- ⚠ TRÊS FONTES DE INVALIDAÇÃO, e a terceira é fácil de esquecer:
--   1. dirty  — mudou o que é específico do PV (itens, quantidade, referência)
--   2. generation — mudou algo global (ficha técnica, lead time padrão)
--   3. computed_on <> CURRENT_DATE — a função termina em
--      add_business_days(CURRENT_DATE, n), então o resultado MUDA sozinho todo dia.
--      Sem esta terceira, o cache serviria a data de ontem indefinidamente.

-- ---------------------------------------------------------------------------
-- 1) Geração global — invalida todo mundo de uma vez, sem escrever 59 linhas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.min_billing_cache_meta (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  generation bigint  NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.min_billing_cache_meta (id) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.min_billing_cache_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS min_billing_cache_meta_select ON public.min_billing_cache_meta;
CREATE POLICY min_billing_cache_meta_select ON public.min_billing_cache_meta
  FOR SELECT TO authenticated USING (public.is_approved_user());

-- ---------------------------------------------------------------------------
-- 2) O cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_order_min_billing_cache (
  sale_order_id    uuid PRIMARY KEY REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  min_billing_date date,
  computed_on      date,           -- CURRENT_DATE do cálculo (ver nota acima)
  generation       bigint NOT NULL DEFAULT 0,
  dirty            boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_min_billing_cache_dirty
  ON public.sale_order_min_billing_cache (dirty) WHERE dirty;

ALTER TABLE public.sale_order_min_billing_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS min_billing_cache_select ON public.sale_order_min_billing_cache;
CREATE POLICY min_billing_cache_select ON public.sale_order_min_billing_cache
  FOR SELECT TO authenticated USING (public.is_approved_user());

-- ---------------------------------------------------------------------------
-- 3) Leitura — o que a lista de PVs chama. Só lê, nunca calcula.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_min_billing_cached(p_sale_order_ids uuid[])
RETURNS TABLE(sale_order_id uuid, min_billing_date date, stale boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.sale_order_id,
         CASE WHEN c.computed_on = CURRENT_DATE THEN c.min_billing_date ELSE NULL END,
         (c.dirty
          OR c.computed_on IS DISTINCT FROM CURRENT_DATE
          OR c.generation < (SELECT m.generation FROM public.min_billing_cache_meta m))
    FROM public.sale_order_min_billing_cache c
   WHERE c.sale_order_id = ANY(p_sale_order_ids)
     AND public.is_approved_user();
$function$;

REVOKE ALL ON FUNCTION public.get_min_billing_cached(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_min_billing_cached(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Recálculo — roda em segundo plano, nunca no mount da lista
-- ---------------------------------------------------------------------------
-- p_ttl_minutes: além de `dirty`, recalcula linhas mais velhas que N minutos.
-- É isso que pega a variação vinda de ESTOQUE (falta de material muda o lead time
-- do fornecedor dentro de get_wave_material_needs_core). Deliberadamente NÃO há
-- gatilho em `products`: o débito atualiza centenas de linhas de produto por
-- promoção, e bumpar a geração ali criaria contenção numa linha única
-- exatamente no caminho que esta spec está tentando acelerar.
CREATE OR REPLACE FUNCTION public.refresh_min_billing_cache(
  p_sale_order_ids uuid[] DEFAULT NULL,
  p_ttl_minutes    int    DEFAULT 15,
  p_limit          int    DEFAULT 500
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gen   bigint;
  v_ids   uuid[];
  v_count int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT generation INTO v_gen FROM public.min_billing_cache_meta;

  -- Garante linha de cache para todo PV ativo (PV novo nasce sujo).
  INSERT INTO public.sale_order_min_billing_cache (sale_order_id)
  SELECT so.id
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status NOT IN ('Cancelado', 'cancelado', 'FINALIZADO')
     AND (p_sale_order_ids IS NULL OR so.id = ANY(p_sale_order_ids))
  ON CONFLICT (sale_order_id) DO NOTHING;

  SELECT COALESCE(array_agg(c.sale_order_id), '{}')
    INTO v_ids
    FROM (
      SELECT c.sale_order_id
        FROM public.sale_order_min_billing_cache c
        JOIN public.sale_orders so ON so.id = c.sale_order_id
       WHERE so.deleted_at IS NULL
         AND so.status NOT IN ('Cancelado', 'cancelado', 'FINALIZADO')
         AND (p_sale_order_ids IS NULL OR c.sale_order_id = ANY(p_sale_order_ids))
         AND (
           c.dirty
           OR c.computed_on IS DISTINCT FROM CURRENT_DATE
           OR c.generation < v_gen
           OR c.updated_at < now() - make_interval(mins => GREATEST(p_ttl_minutes, 1))
         )
       ORDER BY c.dirty DESC, c.updated_at
       LIMIT GREATEST(p_limit, 1)
    ) c;

  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Zera primeiro: PV sem itens não volta de compute_min_billing_dates (o JOIN
  -- em technical_sheets o elimina), e sem isto ele ficaria sujo para sempre,
  -- reprocessado a cada chamada.
  UPDATE public.sale_order_min_billing_cache
     SET min_billing_date = NULL,
         computed_on      = CURRENT_DATE,
         generation       = v_gen,
         dirty            = false,
         updated_at       = now()
   WHERE sale_order_id = ANY(v_ids);

  UPDATE public.sale_order_min_billing_cache c
     SET min_billing_date = m.min_billing_date
    FROM public.compute_min_billing_dates(v_ids) m
   WHERE c.sale_order_id = m.sale_order_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN cardinality(v_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_min_billing_cache(uuid[], int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_min_billing_cache(uuid[], int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Invalidação precisa — mudou o PV
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_min_billing_mark_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so_id uuid;
BEGIN
  v_so_id := CASE TG_TABLE_NAME
               WHEN 'sale_orders'      THEN COALESCE(NEW.id, OLD.id)
               ELSE COALESCE(NEW.sale_order_id, OLD.sale_order_id)
             END;

  IF v_so_id IS NOT NULL THEN
    INSERT INTO public.sale_order_min_billing_cache (sale_order_id, dirty)
    VALUES (v_so_id, true)
    ON CONFLICT (sale_order_id) DO UPDATE SET dirty = true, updated_at = now();
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_sale_orders_min_billing_dirty ON public.sale_orders;
CREATE TRIGGER tg_sale_orders_min_billing_dirty
  AFTER INSERT ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_min_billing_mark_dirty();

DROP TRIGGER IF EXISTS tg_sale_order_items_min_billing_dirty ON public.sale_order_items;
CREATE TRIGGER tg_sale_order_items_min_billing_dirty
  AFTER INSERT OR DELETE OR UPDATE OF quantity, reference_id, fichas
  ON public.sale_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_min_billing_mark_dirty();

-- ---------------------------------------------------------------------------
-- 6) Invalidação global — mudou ficha técnica ou lead time padrão
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_min_billing_bump_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.min_billing_cache_meta
     SET generation = generation + 1, updated_at = now();
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_technical_sheets_min_billing_gen ON public.technical_sheets;
CREATE TRIGGER tg_technical_sheets_min_billing_gen
  AFTER UPDATE OF production_sectors, shoe_category,
                  sewing_capacity_per_day, cutting_capacity_per_day,
                  costura_palmilha_capacity_per_day, costura_cabedal_capacity_per_day,
                  costura_capacity_per_day, mesa_daily_capacity, silk_capacity_per_day,
                  gluing_capacity_per_day, assembly_capacity_per_day,
                  soling_capacity_per_day, finishing_capacity_per_day,
                  lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias,
                  lead_time_acabamento_dias, lead_time_buffer_material_dias
  ON public.technical_sheets
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_min_billing_bump_generation();

DROP TRIGGER IF EXISTS tg_default_lead_times_min_billing_gen ON public.default_lead_times;
CREATE TRIGGER tg_default_lead_times_min_billing_gen
  AFTER INSERT OR UPDATE OR DELETE ON public.default_lead_times
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_min_billing_bump_generation();

COMMENT ON TABLE public.sale_order_min_billing_cache IS
  'Cache de min_billing_date por PV. Lido pela lista de /sales (get_min_billing_cached), '
  'recalculado em segundo plano (refresh_min_billing_cache). Invalida por: dirty (mudou o PV), '
  'generation (mudou ficha/lead time padrão), computed_on <> CURRENT_DATE (o cálculo depende do dia) '
  'e TTL (pega variação vinda de estoque sem gatilho em products). '
  'Fase 1a de specs/pv-producao-performance-e-pendencias.md';
