-- =============================================================================
-- Congela order_costs em PVs em status terminal + propaga price changes
-- =============================================================================
-- Bugs cobertos:
--
--   🟡 H3 — Auto-recalc de custos (round 10) recalcula PVs em QUALQUER status
--          (exceto Cancelado/Rascunho). Resultado: PV Faturado/Concluído pode
--          ter seu custo histórico SOBRESCRITO se algo dispara dirty depois
--          do fechamento (ex.: ficha técnica editada). Preço histórico
--          fica perdido — DRE retroativo distorcido.
--
--          Fix: process_dirty_order_costs SÓ recalcula em status ativo de
--          produção/aprovação. Em Faturado/Expedido/Concluído/Finalizado,
--          custo é CONGELADO (snapshot vira fonte de verdade pra DRE).
--
--   🟡 H4 — products.unit_price UPDATE não dispara recálculo dos PVs ativos
--          que usam esse material. Resultado: fornecedor reajusta preço,
--          PV ainda em produção continua exibindo custo antigo até o usuário
--          mexer manualmente em algo. Pricing decisão fica desinformada.
--
--          Fix: trigger em products UPDATE OF unit_price marca todos os PVs
--          ATIVOS (não terminais) que usam esse produto via sheet_materials
--          OU via specs de ficha (upper/lining/insole/sole) como dirty.
-- =============================================================================

-- ─── H3: process_dirty_order_costs pula PVs em status terminal ──────────────
CREATE OR REPLACE FUNCTION public.process_dirty_order_costs(p_max_orders int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so RECORD;
  v_processed int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_started_at timestamptz := now();
BEGIN
  -- Limpa dirty flag em PVs em status terminal SEM recalcular (preserva snapshot).
  -- "Terminal" = qualquer status onde o custo já deve estar congelado.
  WITH frozen AS (
    UPDATE public.sale_orders
       SET costs_dirty_at = NULL
     WHERE costs_dirty_at IS NOT NULL
       AND status IN ('Faturado', 'Expedido', 'Concluído', 'Concluido',
                      'Finalizado sem NF', 'Finalizado s/ NF')
    RETURNING 1
  )
  SELECT count(*) INTO v_skipped FROM frozen;

  FOR v_so IN
    SELECT id, costs_dirty_at
      FROM public.sale_orders
     WHERE costs_dirty_at IS NOT NULL
       AND status NOT IN ('Cancelado', 'Cancelada', 'Rascunho',
                          'Faturado', 'Expedido', 'Concluído', 'Concluido',
                          'Finalizado sem NF', 'Finalizado s/ NF')
     ORDER BY costs_dirty_at ASC
     LIMIT p_max_orders
  LOOP
    BEGIN
      PERFORM public.calculate_order_cost(v_so.id, NULL, true);
      UPDATE public.sale_orders
         SET costs_dirty_at = NULL
       WHERE id = v_so.id
         AND costs_dirty_at = v_so.costs_dirty_at;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'sale_order_id', v_so.id,
        'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'skipped_terminal', v_skipped,
    'failed', v_failed,
    'failures', v_failures,
    'duration_ms', extract(epoch from (now() - v_started_at)) * 1000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_dirty_order_costs(int) TO authenticated;

COMMENT ON FUNCTION public.process_dirty_order_costs(int) IS
  'Processa fila de PVs com costs_dirty_at != NULL. PVs em status terminal '
  '(Faturado/Expedido/Concluído/Finalizado) têm a flag LIMPA sem recálculo — '
  'preserva o snapshot histórico em order_costs.breakdown. Fix H3 (20260627130000).';


-- ─── H4: trigger em products.unit_price marca PVs ativos como dirty ────────
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_product_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Só dispara se unit_price mudou de fato (evita ruído de UPDATEs no-op).
  IF NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price THEN
    RETURN NEW;
  END IF;

  -- Marca dirty: PVs ATIVOS que usam este produto via sheet_materials.
  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
       JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
      WHERE sm.product_id = NEW.id
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho',
                           'Faturado', 'Expedido', 'Concluído', 'Concluido',
                           'Finalizado sem NF', 'Finalizado s/ NF');

  -- Também: PVs cujos itens referenciam ficha com este produto em specs
  -- (upper/lining/insole/sole_material) via product_groups.name match.
  -- Conservador: marca quem usa o produto direto via direct_components.
  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
       JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      WHERE ts.direct_components IS NOT NULL
        AND jsonb_typeof(ts.direct_components) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(ts.direct_components) AS dc
           WHERE (dc ->> 'id')::uuid = NEW.id
        )
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho',
                           'Faturado', 'Expedido', 'Concluído', 'Concluido',
                           'Finalizado sem NF', 'Finalizado s/ NF');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_product_price ON public.products;
CREATE TRIGGER trg_mark_so_costs_dirty_from_product_price
  AFTER UPDATE OF unit_price ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_product_price();

COMMENT ON FUNCTION public.tg_mark_so_costs_dirty_from_product_price() IS
  'Quando unit_price de um produto muda, marca dirty todos os PVs ativos que '
  'usam esse produto (BOM ou direct_components). Cron rodando em seguida '
  'recalcula via calculate_order_cost. PVs em status terminal NÃO são afetados '
  '(preserva snapshot histórico). Fix H4 (20260627130000).';
