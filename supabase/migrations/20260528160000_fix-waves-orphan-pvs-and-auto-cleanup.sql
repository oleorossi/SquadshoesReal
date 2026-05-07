-- =============================================================================
-- Fix Ondas de Produção: PVs órfãos + auto-cleanup
-- =============================================================================
-- Bug encontrado em auditoria: 7 ondas, 6 delas em planning com 27 PVs
-- inválidos (23 Faturados + 4 Rascunho). Causa raiz: o trigger
-- finalize_orders_on_sale_order_billed atualizava as orders pra "Finalizado"
-- quando o PV era faturado, mas NÃO removia o PV das production_wave_items/
-- sources. Resultado: ondas em planning com PVs já entregues há semanas.
--
-- Esta migration:
--   #1 Limpa dados existentes (sources de PVs Faturado/Cancelado/Rascunho).
--   #2 Auto-cancela ondas planning que ficam vazias após cleanup.
--   #3 Trigger AFTER UPDATE em sale_orders.status: quando PV vira
--      Faturado/Cancelado/Rascunho, remove auto das ondas em planning.
--      Ondas running são preservadas (produção em andamento).
--   #4 Trigger AFTER DELETE em production_wave_items: auto-cancela onda
--      em planning quando perde último item.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- #1 LIMPEZA RETROATIVA
-- ----------------------------------------------------------------------------
DELETE FROM public.production_wave_item_sources pwis
WHERE EXISTS (
  SELECT 1 FROM public.sale_orders so
  WHERE so.id = pwis.sale_order_id
    AND so.status IN ('Faturado', 'Cancelado', 'Rascunho')
);

DELETE FROM public.production_wave_items pwi
WHERE NOT EXISTS (
  SELECT 1 FROM public.production_wave_item_sources pwis
  WHERE pwis.wave_item_id = pwi.id
);

UPDATE public.production_waves pw SET
  total_items = (SELECT COUNT(*) FROM public.production_wave_items WHERE wave_id = pw.id),
  total_pairs = COALESCE((SELECT SUM(total_quantity) FROM public.production_wave_items WHERE wave_id = pw.id), 0),
  updated_at = now();

-- ----------------------------------------------------------------------------
-- #2 CANCELA ONDAS PLANNING VAZIAS
-- ----------------------------------------------------------------------------
UPDATE public.production_waves
SET
  status = 'cancelled',
  updated_at = now(),
  notes = COALESCE(notes || E'\n', '') ||
    '[auto-cancelada em ' || to_char(now(), 'DD/MM/YYYY') ||
    ': onda ficou vazia após limpeza de PVs Faturados/Cancelados/Rascunho]'
WHERE status = 'planning' AND total_items = 0;

-- ----------------------------------------------------------------------------
-- #3 TRIGGER: PV vira terminal/draft → remove de ondas planning
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tg_remove_pv_from_waves_on_status_change() CASCADE;
CREATE OR REPLACE FUNCTION public.tg_remove_pv_from_waves_on_status_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_running_count INT;
  v_removed_sources INT;
BEGIN
  IF NEW.status NOT IN ('Faturado', 'Cancelado', 'Rascunho') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_running_count
  FROM public.production_wave_item_sources pwis
  JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
  JOIN public.production_waves pw ON pw.id = pwi.wave_id
  WHERE pwis.sale_order_id = NEW.id AND pw.status = 'running';

  IF v_running_count > 0 THEN
    RAISE NOTICE 'PV % mudou pra "%" mas está em % onda(s) running — preservado.',
      NEW.order_number, NEW.status, v_running_count;
    RETURN NEW;
  END IF;

  WITH deleted AS (
    DELETE FROM public.production_wave_item_sources pwis
    USING public.production_wave_items pwi, public.production_waves pw
    WHERE pwis.sale_order_id = NEW.id
      AND pwi.id = pwis.wave_item_id
      AND pw.id = pwi.wave_id
      AND pw.status = 'planning'
    RETURNING pwis.id
  )
  SELECT COUNT(*) INTO v_removed_sources FROM deleted;

  WITH deleted_items AS (
    DELETE FROM public.production_wave_items pwi
    WHERE NOT EXISTS (
      SELECT 1 FROM public.production_wave_item_sources pwis
      WHERE pwis.wave_item_id = pwi.id
    )
    RETURNING pwi.wave_id
  ),
  affected_waves AS (SELECT DISTINCT wave_id FROM deleted_items)
  UPDATE public.production_waves pw SET
    total_items = (SELECT COUNT(*) FROM public.production_wave_items WHERE wave_id = pw.id),
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM public.production_wave_items WHERE wave_id = pw.id), 0),
    updated_at = now()
  WHERE pw.id IN (SELECT wave_id FROM affected_waves);

  IF v_removed_sources > 0 THEN
    RAISE NOTICE 'PV % (%) removido automaticamente de % ondas em planning.',
      NEW.order_number, NEW.status, v_removed_sources;
  END IF;

  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tg_remove_pv_from_waves_on_status_change() TO authenticated;

DROP TRIGGER IF EXISTS trg_remove_pv_from_waves_on_status_change ON public.sale_orders;
CREATE TRIGGER trg_remove_pv_from_waves_on_status_change
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_remove_pv_from_waves_on_status_change();

-- ----------------------------------------------------------------------------
-- #4 TRIGGER: onda planning fica vazia → auto-cancela
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tg_auto_cancel_empty_planning_wave() CASCADE;
CREATE OR REPLACE FUNCTION public.tg_auto_cancel_empty_planning_wave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id uuid;
  v_wave_status text;
  v_remaining int;
BEGIN
  IF TG_OP = 'DELETE' THEN v_wave_id := OLD.wave_id; ELSE RETURN NULL; END IF;

  SELECT status::text INTO v_wave_status
  FROM public.production_waves WHERE id = v_wave_id;

  IF v_wave_status IS DISTINCT FROM 'planning' THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO v_remaining
  FROM public.production_wave_items WHERE wave_id = v_wave_id;

  IF v_remaining = 0 THEN
    UPDATE public.production_waves
    SET status = 'cancelled', updated_at = now(),
      notes = COALESCE(notes || E'\n', '') ||
        '[auto-cancelada em ' || to_char(now(), 'DD/MM/YYYY HH24:MI') ||
        ': onda ficou vazia após remoção do último item]'
    WHERE id = v_wave_id;
    RAISE NOTICE 'Onda % auto-cancelada (ficou sem items).', v_wave_id;
  END IF;

  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tg_auto_cancel_empty_planning_wave() TO authenticated;

DROP TRIGGER IF EXISTS trg_auto_cancel_empty_planning_wave ON public.production_wave_items;
CREATE TRIGGER trg_auto_cancel_empty_planning_wave
  AFTER DELETE ON public.production_wave_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_auto_cancel_empty_planning_wave();

COMMENT ON FUNCTION public.tg_remove_pv_from_waves_on_status_change() IS
  'Quando PV vira Faturado/Cancelado/Rascunho, remove de ondas em planning. '
  'Ondas running ficam preservadas (produção em andamento).';

COMMENT ON FUNCTION public.tg_auto_cancel_empty_planning_wave() IS
  'Auto-cancela ondas em planning quando o último item é removido.';
