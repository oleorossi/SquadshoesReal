-- =============================================================================
-- AUDIT ROUND 13 — Propagar mudanças da ficha técnica
-- =============================================================================
-- User: "Todo ajuste que eu fizer em ficha técnica está sendo ajustado em
--        estoque, produção e todo o fluxo?"
--
-- Análise (round anterior): NEM TUDO propaga. 2 gaps reais:
--
-- A. Snapshots de OPs em produção ficam desatualizados quando ficha muda.
--    Custo lê snapshot prioritariamente — auto-cost-recalc (round 10) vira
--    no-op pra esses PVs.
--
-- B. Reservas de PVs pré-produção (Pendente/Aprovado) não recalculam quando
--    ficha muda. material_reservations continua com consumo antigo.
--
-- Fix:
--   1. snapshots.outdated_at — marcado quando ficha original muda. UI alerta.
--   2. sale_orders.reservations_outdated_at — marcado idem. Cron tenta
--      auto-refresh em PVs sem snapshot (seguro: só pré-produção).
--   3. Função refresh_order_reservations(p_order_id) com guards.
--   4. Cron 'auto-refresh-reservations' a cada 2 min processa fila.
-- =============================================================================

-- ─── 1. Colunas novas ─────────────────────────────────────────────────────

ALTER TABLE public.technical_sheet_snapshots
  ADD COLUMN IF NOT EXISTS outdated_at timestamptz;

COMMENT ON COLUMN public.technical_sheet_snapshots.outdated_at IS
  'Marca quando a ficha técnica original foi editada após o snapshot ser '
  'congelado. UI exibe badge no PV. Snapshot continua válido pra audit '
  'trail mas operador deve avaliar se precisa Resync OPs.';

CREATE INDEX IF NOT EXISTS idx_snapshots_outdated
  ON public.technical_sheet_snapshots (outdated_at)
  WHERE outdated_at IS NOT NULL;

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS reservations_outdated_at timestamptz;

COMMENT ON COLUMN public.sale_orders.reservations_outdated_at IS
  'Marca quando reservas precisam ser recalculadas (ficha mudou ou items '
  'editados). Cron auto-refresh-reservations processa só PVs sem snapshot.';

CREATE INDEX IF NOT EXISTS idx_sale_orders_reservations_outdated
  ON public.sale_orders (reservations_outdated_at)
  WHERE reservations_outdated_at IS NOT NULL;


-- ─── 2. Estender trigger tg_mark_so_costs_dirty_from_sheet ─────────────────
-- Round 10 só marcava costs_dirty_at. Agora marca também:
--   - snapshots.outdated_at (qq snapshot da ficha)
--   - sale_orders.reservations_outdated_at (PVs pré-produção)

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- A. Marca custo dirty (já fazia)
  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = NEW.id
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');

  -- B. Marca snapshots dessa ficha como outdated (round 13)
  UPDATE public.technical_sheet_snapshots
     SET outdated_at = now()
   WHERE sheet_id = NEW.id
     AND outdated_at IS NULL;

  -- C. Marca reservations outdated em PVs pré-produção (round 13)
  -- Não inclui Faturado/Expedido/Concluído — esses já consumiram estoque.
  UPDATE public.sale_orders so
     SET reservations_outdated_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = NEW.id
   )
     AND so.status IN ('Pendente', 'Aprovado', 'Em Produção');

  RETURN NEW;
END;
$$;


-- ─── 3. Trigger novo: items mudam → reservations outdated ─────────────────
-- Quando quantidade ou grade de um item do PV muda, as reservas precisam
-- recalcular também (não é só ficha que afeta).

CREATE OR REPLACE FUNCTION public.tg_mark_reservations_outdated_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so_id uuid;
BEGIN
  v_so_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_so_id IS NULL THEN RETURN NULL; END IF;

  -- Só reage a mudanças de qty/grade/cor/material (não a mudanças cosméticas).
  IF TG_OP = 'UPDATE'
     AND OLD.quantity IS NOT DISTINCT FROM NEW.quantity
     AND OLD.grade IS NOT DISTINCT FROM NEW.grade
     AND OLD.color IS NOT DISTINCT FROM NEW.color
     AND OLD.material_variant_id IS NOT DISTINCT FROM NEW.material_variant_id THEN
    RETURN NULL;
  END IF;

  UPDATE public.sale_orders
     SET reservations_outdated_at = now()
   WHERE id = v_so_id
     AND status IN ('Pendente', 'Aprovado', 'Em Produção');

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_reservations_outdated_from_item ON public.sale_order_items;
CREATE TRIGGER trg_mark_reservations_outdated_from_item
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mark_reservations_outdated_from_item();


-- ─── 4. Função refresh_order_reservations(p_order_id) com guards ──────────
-- Recria reservas de UMA OP. Guards rígidos pra segurança:
--   - OP precisa estar em status pré-produção
--   - OP NÃO pode ter snapshot (snapshot = estoque já debitado)
--   - Idempotente: chamar 2× não duplica

CREATE OR REPLACE FUNCTION public.refresh_order_reservations(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order RECORD;
  v_so_status text;
  v_has_snapshot boolean;
  v_result jsonb;
BEGIN
  SELECT o.id, o.sale_order_id, o.reference_id, o.color, o.quantity, o.status,
         so.status AS so_status
    INTO v_order
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'order_not_found');
  END IF;

  -- Guard A: OP precisa estar em status que não tocou estoque ainda
  IF v_order.status NOT IN ('Pendente', 'Reservado', 'Rascunho') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'op_in_production', 'op_status', v_order.status);
  END IF;

  -- Guard B: PV precisa estar pré-produção
  IF v_order.so_status NOT IN ('Pendente', 'Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'so_not_in_pre_production', 'so_status', v_order.so_status);
  END IF;

  -- Guard C: snapshot existe = estoque já foi debitado, não tocar
  SELECT EXISTS(
    SELECT 1 FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_order.sale_order_id
  ) INTO v_has_snapshot;
  IF v_has_snapshot THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'snapshot_exists');
  END IF;

  -- Libera reservas atuais (round 6: devolve products.reserved_stock)
  PERFORM public.release_order_reservations(p_order_id);

  -- Re-cria via try_reserve_materials. Usa permit_partial=true pra não
  -- bloquear se faltar material; gera POs como fluxo MRP normal.
  v_result := public.try_reserve_materials(
    p_order_id, v_order.reference_id, v_order.quantity,
    COALESCE(v_order.color, ''), NULL, true, true, 'normal', false, true);

  RETURN jsonb_build_object('refreshed', true, 'mrp_result', v_result);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_order_reservations(uuid) TO authenticated;


-- ─── 5. Processador em batch + cron ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_outdated_reservations(p_max_orders int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_op RECORD;
  v_processed int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_started_at timestamptz := now();
  v_result jsonb;
BEGIN
  FOR v_op IN
    SELECT o.id AS order_id, so.id AS sale_order_id, so.reservations_outdated_at
      FROM public.orders o
      JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE so.reservations_outdated_at IS NOT NULL
       AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
       AND o.status IN ('Pendente', 'Reservado')
       AND NOT EXISTS (
         SELECT 1 FROM public.technical_sheet_snapshots
          WHERE sale_order_id = so.id
       )
     ORDER BY so.reservations_outdated_at ASC
     LIMIT p_max_orders
  LOOP
    BEGIN
      v_result := public.refresh_order_reservations(v_op.order_id);
      IF (v_result ->> 'refreshed')::boolean THEN
        v_processed := v_processed + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'order_id', v_op.order_id, 'error', SQLERRM);
    END;
  END LOOP;

  -- Limpa flag de PVs cujas OPs foram TODAS processadas com sucesso.
  -- Se sobrou alguma OP em status que pula (já em produção), o PV pode
  -- ficar com flag indefinidamente — operador resolve via Resync OPs.
  UPDATE public.sale_orders so
     SET reservations_outdated_at = NULL
   WHERE so.reservations_outdated_at IS NOT NULL
     AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.sale_order_id = so.id
          AND o.status IN ('Pendente', 'Reservado')
     );

  RETURN jsonb_build_object(
    'processed', v_processed,
    'skipped', v_skipped,
    'failed', v_failed,
    'failures', v_failures,
    'duration_ms', extract(epoch from (now() - v_started_at)) * 1000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_outdated_reservations(int) TO authenticated;

-- pg_cron job
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'auto-refresh-reservations';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'auto-refresh-reservations',
  '*/2 * * * *',
  $cron$ SELECT public.process_outdated_reservations(30); $cron$
);


-- ─── 6. View pra UI consultar status ──────────────────────────────────────

CREATE OR REPLACE VIEW public.v_pv_outdated_status AS
SELECT
  so.id AS sale_order_id,
  so.order_number,
  so.status,
  so.client_name,
  so.reservations_outdated_at,
  EXISTS(
    SELECT 1 FROM public.technical_sheet_snapshots tss
     WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL
  ) AS has_outdated_snapshot,
  (SELECT MIN(tss.outdated_at) FROM public.technical_sheet_snapshots tss
    WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL) AS oldest_snapshot_outdated_at,
  CASE
    WHEN so.reservations_outdated_at IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.technical_sheet_snapshots tss
                 WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL)
      THEN 'reservations_and_snapshot_outdated'
    WHEN so.reservations_outdated_at IS NOT NULL
      THEN 'reservations_outdated'
    WHEN EXISTS(SELECT 1 FROM public.technical_sheet_snapshots tss
                 WHERE tss.sale_order_id = so.id AND tss.outdated_at IS NOT NULL)
      THEN 'snapshot_outdated'
    ELSE 'in_sync'
  END AS status_label
FROM public.sale_orders so
WHERE so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');

GRANT SELECT ON public.v_pv_outdated_status TO authenticated;

COMMENT ON VIEW public.v_pv_outdated_status IS
  'Lista PVs com snapshot ou reservations desatualizados. UI usa pra exibir '
  'badges/alertas e oferecer Resync OPs.';
