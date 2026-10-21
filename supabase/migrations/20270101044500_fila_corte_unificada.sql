-- Fila de Corte unificada (specs/fila-corte-unificada.md)
-- Ledger anti-2×, trava pós-corte, peças cortadas + reuso, trim soft de adiantamento.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Coluna + tabelas
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS corte_ahead_unlocked_at timestamptz;

COMMENT ON COLUMN public.orders.corte_ahead_unlocked_at IS
  'Fila de Corte unificada: se is_ahead_of_schedule e NULL, etapas pós-corte ficam travadas até enter_corte_ahead_production.';

CREATE TABLE IF NOT EXISTS public.corte_ahead_stock_debits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  cut_kind text NOT NULL CHECK (cut_kind IN ('cabedal', 'fibra', 'forracao')),
  quantity_debited numeric NOT NULL DEFAULT 0 CHECK (quantity_debited >= 0),
  pending_qty numeric NOT NULL DEFAULT 0 CHECK (pending_qty >= 0),
  stock_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id, cut_kind)
);

CREATE INDEX IF NOT EXISTS idx_corte_ahead_debits_order
  ON public.corte_ahead_stock_debits(order_id);
CREATE INDEX IF NOT EXISTS idx_corte_ahead_debits_product
  ON public.corte_ahead_stock_debits(product_id);

COMMENT ON TABLE public.corte_ahead_stock_debits IS
  'Ledger hard do corte (Fila unificada). settle/hybrid pulam (order, product) já debitado.';

ALTER TABLE public.corte_ahead_stock_debits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corte_ahead_stock_debits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.corte_ahead_stock_debits TO authenticated;
GRANT ALL ON TABLE public.corte_ahead_stock_debits TO service_role;

DROP POLICY IF EXISTS corte_ahead_debits_select ON public.corte_ahead_stock_debits;
CREATE POLICY corte_ahead_debits_select ON public.corte_ahead_stock_debits
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

CREATE TABLE IF NOT EXISTS public.corte_cut_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cut_kind text NOT NULL CHECK (cut_kind IN ('cabedal', 'fibra', 'forracao')),
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id),
  color_norm text NOT NULL DEFAULT '',
  material_variant_id uuid,
  pairs_original numeric NOT NULL CHECK (pairs_original > 0),
  pairs_available numeric NOT NULL CHECK (pairs_available >= 0),
  original_grade jsonb,
  source_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  source_sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'exhausted', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pairs_available <= pairs_original)
);

CREATE INDEX IF NOT EXISTS idx_corte_cut_pieces_available
  ON public.corte_cut_pieces(status, reference_id, color_norm)
  WHERE status = 'available';

COMMENT ON TABLE public.corte_cut_pieces IS
  'Peça já cortada gerada no cancelamento pós-hard; reuso na Fila (?view=reuso).';

ALTER TABLE public.corte_cut_pieces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corte_cut_pieces FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.corte_cut_pieces TO authenticated;
GRANT ALL ON TABLE public.corte_cut_pieces TO service_role;

DROP POLICY IF EXISTS corte_cut_pieces_select ON public.corte_cut_pieces;
CREATE POLICY corte_cut_pieces_select ON public.corte_cut_pieces
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS corte_cut_pieces_update ON public.corte_cut_pieces;
CREATE POLICY corte_cut_pieces_update ON public.corte_cut_pieces
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

CREATE TABLE IF NOT EXISTS public.corte_cut_piece_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cut_piece_id uuid NOT NULL REFERENCES public.corte_cut_pieces(id) ON DELETE CASCADE,
  sale_order_item_id uuid NOT NULL REFERENCES public.sale_order_items(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  pairs numeric NOT NULL CHECK (pairs > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_corte_cut_alloc_item
  ON public.corte_cut_piece_allocations(sale_order_item_id);

ALTER TABLE public.corte_cut_piece_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corte_cut_piece_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.corte_cut_piece_allocations TO authenticated;
GRANT ALL ON TABLE public.corte_cut_piece_allocations TO service_role;

DROP POLICY IF EXISTS corte_cut_alloc_select ON public.corte_cut_piece_allocations;
CREATE POLICY corte_cut_alloc_select ON public.corte_cut_piece_allocations
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS corte_cut_alloc_insert ON public.corte_cut_piece_allocations;
CREATE POLICY corte_cut_alloc_insert ON public.corte_cut_piece_allocations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

-- Capacidade: garantir linhas canônicas das 3 bancadas (UI mapeia nomes)
INSERT INTO public.sector_settings (sector, daily_capacity_pairs, enabled, flow_order)
SELECT v.sector, v.cap, true, v.fo
FROM (VALUES
  ('Corte Cabedal', 600, 15),
  ('Corte Fibra', 600, 10),
  ('Corte Forração', 600, 12)
) AS v(sector, cap, fo)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sector_settings s WHERE s.sector = v.sector
);

-- Se existir capacidade só em Palmilha · Fibra / Forração, espelha em Corte *
UPDATE public.sector_settings dest
SET daily_capacity_pairs = src.daily_capacity_pairs
FROM public.sector_settings src
WHERE dest.sector = 'Corte Fibra'
  AND src.sector = 'Palmilha · Fibra'
  AND dest.daily_capacity_pairs IS DISTINCT FROM src.daily_capacity_pairs;

UPDATE public.sector_settings dest
SET daily_capacity_pairs = src.daily_capacity_pairs
FROM public.sector_settings src
WHERE dest.sector = 'Corte Forração'
  AND src.sector = 'Palmilha · Forração'
  AND dest.daily_capacity_pairs IS DISTINCT FROM src.daily_capacity_pairs;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Helpers de kind / etapas de corte
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.corte_cut_kind_from_stage(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE public.canonical_stage_name(trim(coalesce(p_stage, '')))
    WHEN 'Corte Cabedal' THEN 'cabedal'
    WHEN 'Palmilha · Fibra' THEN 'fibra'
    WHEN 'Corte Fibra' THEN 'fibra'
    WHEN 'Corte Palmilha' THEN 'fibra'
    WHEN 'Palmilha · Forração' THEN 'forracao'
    WHEN 'Corte Forração' THEN 'forracao'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.corte_stage_names_for_kind(p_kind text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'cabedal' THEN ARRAY['Corte Cabedal']
    WHEN 'fibra' THEN ARRAY['Palmilha · Fibra', 'Corte Fibra', 'Corte Palmilha']
    WHEN 'forracao' THEN ARRAY['Palmilha · Forração', 'Corte Forração']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.corte_is_cutting_stage(p_stage text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.corte_cut_kind_from_stage(p_stage) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.corte_ahead_product_already_debited(
  p_order_id uuid,
  p_product_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.corte_ahead_stock_debits d
     WHERE d.order_id = p_order_id
       AND d.product_id = p_product_id
       AND d.quantity_debited > 0
  );
$$;

REVOKE ALL ON FUNCTION public.corte_ahead_product_already_debited(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corte_ahead_product_already_debited(uuid, uuid)
  TO authenticated, service_role;

-- Componentes de reserva que são materiais de CORTE (trim soft)
CREATE OR REPLACE FUNCTION public.corte_reservation_is_cutting_component(p_component text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_component, ''))) IN (
    'cabedal', 'upper',
    'forração', 'forracao', 'lining', 'forração palmilha', 'forracao palmilha',
    'palmilha', 'insole', 'fibra', 'fiber'
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Trim soft pós-promote adiantado (só materiais de corte)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trim_corte_ahead_soft_reservations(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r record;
  v_cancelled int := 0;
BEGIN
  IF NOT public.is_approved_user()
     AND coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  FOR r IN
    SELECT mr.id, mr.product_id, mr.quantity_reserved, mr.quantity_consumed,
           mr.metadata->>'component' AS component
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND NOT public.corte_reservation_is_cutting_component(mr.metadata->>'component')
  LOOP
    UPDATE public.material_reservations
       SET status = 'cancelled',
           notes = coalesce(notes || ' | ', '') || 'trim adiantamento corte (não é material de corte)',
           updated_at = now()
     WHERE id = r.id;
    -- devolve reserved_stock do produto
    UPDATE public.products p
       SET reserved_stock = GREATEST(
             0,
             coalesce(p.reserved_stock, 0)
               - GREATEST(0, coalesce(r.quantity_reserved, 0) - coalesce(r.quantity_consumed, 0))
           )
     WHERE p.id = r.product_id;
    v_cancelled := v_cancelled + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cancelled', v_cancelled);
END;
$fn$;

REVOKE ALL ON FUNCTION public.trim_corte_ahead_soft_reservations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trim_corte_ahead_soft_reservations(uuid)
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Confirmar corte (hard + ledger)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.confirm_corte_ahead_stage(
  p_order_id uuid,
  p_cut_kind text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_aliases text[];
  r record;
  v_avail numeric;
  v_take numeric;
  v_pending numeric;
  v_mov uuid;
  v_debited int := 0;
  v_component_filter text[];
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  IF p_cut_kind NOT IN ('cabedal', 'fibra', 'forracao') THEN
    RAISE EXCEPTION 'cut_kind inválido: %', p_cut_kind;
  END IF;

  -- Evita reentrada do trigger trg_corte_ahead_on_stage_concluido
  IF current_setting('app.corte_confirm_in_progress', true) = '1' THEN
    RETURN jsonb_build_object('ok', true, 'reentry', true);
  END IF;
  PERFORM set_config('app.corte_confirm_in_progress', '1', true);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada';
  END IF;
  IF v_order.status IN ('Cancelada', 'Cancelado') THEN
    RAISE EXCEPTION 'OP cancelada';
  END IF;

  v_aliases := public.corte_stage_names_for_kind(p_cut_kind);

  -- Fecha etapas do kind ainda abertas
  UPDATE public.order_stages os
     SET status = 'concluido',
         quantity_processed = coalesce(nullif(os.quantity_processed, 0), v_order.quantity),
         updated_at = now()
   WHERE os.order_id = p_order_id
     AND public.corte_cut_kind_from_stage(os.stage_name) = p_cut_kind
     AND os.status IS DISTINCT FROM 'concluido';

  v_component_filter := CASE p_cut_kind
    WHEN 'cabedal' THEN ARRAY['cabedal', 'upper', 'Cabedal']
    WHEN 'fibra' THEN ARRAY['palmilha', 'fibra', 'fiber', 'insole', 'Palmilha']
    WHEN 'forracao' THEN ARRAY['forração', 'forracao', 'lining', 'Forração', 'Forração Palmilha', 'forração palmilha']
  END;

  FOR r IN
    SELECT mr.id AS reservation_id,
           mr.product_id,
           GREATEST(0, coalesce(mr.quantity_reserved, 0) - coalesce(mr.quantity_consumed, 0)) AS open_qty
      FROM public.material_reservations mr
     WHERE mr.order_id = p_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND (
         lower(coalesce(mr.metadata->>'component', '')) = ANY (
           SELECT lower(x) FROM unnest(v_component_filter) x
         )
         OR public.corte_reservation_is_cutting_component(mr.metadata->>'component')
            AND p_cut_kind = 'cabedal'
            AND lower(coalesce(mr.metadata->>'component', '')) IN ('cabedal', 'upper')
         OR public.corte_reservation_is_cutting_component(mr.metadata->>'component')
            AND p_cut_kind = 'fibra'
            AND lower(coalesce(mr.metadata->>'component', '')) IN ('palmilha', 'fibra', 'fiber', 'insole')
         OR public.corte_reservation_is_cutting_component(mr.metadata->>'component')
            AND p_cut_kind = 'forracao'
            AND lower(coalesce(mr.metadata->>'component', '')) LIKE '%forra%'
       )
       AND NOT public.corte_ahead_product_already_debited(p_order_id, mr.product_id)
  LOOP
    IF r.open_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT coalesce(quantity, 0) INTO v_avail
      FROM public.products WHERE id = r.product_id FOR UPDATE;

    v_take := LEAST(v_avail, r.open_qty);
    v_pending := GREATEST(0, r.open_qty - v_take);

    IF v_take > 0 THEN
      UPDATE public.products
         SET quantity = quantity - v_take,
             reserved_stock = GREATEST(0, coalesce(reserved_stock, 0) - v_take),
             updated_at = now()
       WHERE id = r.product_id;

      INSERT INTO public.stock_movements (
        product_id, quantity, movement_type, order_id, description, movement_reason
      ) VALUES (
        r.product_id, -v_take, 'saida', p_order_id,
        'Corte confirmado — Fila de Corte (' || p_cut_kind || ')',
        'corte_ahead'
      )
      RETURNING id INTO v_mov;
    ELSE
      v_mov := NULL;
    END IF;

    UPDATE public.material_reservations
       SET quantity_consumed = coalesce(quantity_consumed, 0) + v_take,
           status = CASE
             WHEN v_pending > 0 THEN 'pending_reconciliation'
             ELSE 'consumed'
           END,
           consumed_at = CASE WHEN v_pending = 0 THEN now() ELSE consumed_at END,
           updated_at = now()
     WHERE id = r.reservation_id;

    INSERT INTO public.corte_ahead_stock_debits (
      order_id, sale_order_item_id, product_id, cut_kind,
      quantity_debited, pending_qty, stock_movement_id
    ) VALUES (
      p_order_id, v_order.sale_order_item_id, r.product_id, p_cut_kind,
      v_take, v_pending, v_mov
    )
    ON CONFLICT (order_id, product_id, cut_kind) DO UPDATE
      SET quantity_debited = public.corte_ahead_stock_debits.quantity_debited + EXCLUDED.quantity_debited,
          pending_qty = public.corte_ahead_stock_debits.pending_qty + EXCLUDED.pending_qty,
          stock_movement_id = coalesce(EXCLUDED.stock_movement_id, public.corte_ahead_stock_debits.stock_movement_id);

    v_debited := v_debited + 1;
  END LOOP;

  PERFORM set_config('app.corte_confirm_in_progress', '', true);

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'cut_kind', p_cut_kind,
    'lines', v_debited,
    'stages', v_aliases
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.corte_confirm_in_progress', '', true);
  RAISE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirm_corte_ahead_stage(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_corte_ahead_stage(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.confirm_corte_ahead_stage(uuid, text) IS
  'Fila unificada: fecha etapas do cut_kind + hard LEAST + ledger anti-2×.';

-- Trigger: fechar etapa de corte no Kanban → mesmo hard
CREATE OR REPLACE FUNCTION public.tg_corte_ahead_on_stage_concluido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'concluido' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'concluido' THEN
    RETURN NEW;
  END IF;

  v_kind := public.corte_cut_kind_from_stage(NEW.stage_name);
  IF v_kind IS NULL THEN
    RETURN NEW;
  END IF;

  -- confirm_ seta app.corte_confirm_in_progress; se já estamos dentro, sai
  IF current_setting('app.corte_confirm_in_progress', true) = '1' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.confirm_corte_ahead_stage(NEW.order_id, v_kind);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[tg_corte_ahead_on_stage_concluido] OP % kind %: %',
      NEW.order_id, v_kind, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_corte_ahead_on_stage_concluido ON public.order_stages;
CREATE TRIGGER trg_corte_ahead_on_stage_concluido
  AFTER INSERT OR UPDATE OF status ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_corte_ahead_on_stage_concluido();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Trava pós-corte + Entrar em produção
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.corte_ahead_post_cut_blocked(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = p_order_id
       AND coalesce(o.is_ahead_of_schedule, false)
       AND o.corte_ahead_unlocked_at IS NULL
       AND o.status NOT IN ('Cancelada', 'Cancelado', 'Finalizado')
  );
$$;

CREATE OR REPLACE FUNCTION public.tg_block_post_cut_while_corte_ahead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.corte_ahead_post_cut_blocked(NEW.order_id) THEN
    RETURN NEW;
  END IF;
  IF public.corte_is_cutting_stage(NEW.stage_name) THEN
    RETURN NEW;
  END IF;
  -- Permitir só leitura de status já concluido legado
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
  THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('em_andamento', 'concluido')
     OR (TG_OP = 'INSERT' AND NEW.status IS DISTINCT FROM 'pendente')
  THEN
    RAISE EXCEPTION
      'OP adiantada: conclua o corte e use Entrar em produção antes de apontar %.',
      NEW.stage_name;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_block_post_cut_while_corte_ahead ON public.order_stages;
CREATE TRIGGER trg_block_post_cut_while_corte_ahead
  BEFORE INSERT OR UPDATE OF status ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_post_cut_while_corte_ahead();

CREATE OR REPLACE FUNCTION public.tg_block_pointing_post_cut_corte_ahead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.corte_ahead_post_cut_blocked(NEW.order_id) THEN
    RETURN NEW;
  END IF;
  IF public.corte_is_cutting_stage(NEW.stage_name) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'OP adiantada: corte ainda não liberou produção. Use Entrar em produção na Fila de Corte.';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_block_pointing_post_cut_corte_ahead ON public.production_pointings;
CREATE TRIGGER trg_block_pointing_post_cut_corte_ahead
  BEFORE INSERT ON public.production_pointings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_pointing_post_cut_corte_ahead();

CREATE OR REPLACE FUNCTION public.enter_corte_ahead_production(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_order public.orders%ROWTYPE;
  v_pending text;
  v_ok int := 0;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma OP';
  END IF;

  FOREACH v_id IN ARRAY p_order_ids LOOP
    SELECT * INTO v_order FROM public.orders WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('order_id', v_id, 'reason', 'não encontrada'));
      CONTINUE;
    END IF;
    IF NOT coalesce(v_order.is_ahead_of_schedule, false) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('order_id', v_id, 'reason', 'não é adiantada'));
      CONTINUE;
    END IF;
    IF v_order.corte_ahead_unlocked_at IS NOT NULL THEN
      v_ok := v_ok + 1;
      CONTINUE;
    END IF;

    SELECT string_agg(os.stage_name, ', ' ORDER BY os.stage_order)
      INTO v_pending
      FROM public.order_stages os
     WHERE os.order_id = v_id
       AND public.corte_is_cutting_stage(os.stage_name)
       AND os.status IS DISTINCT FROM 'concluido';

    IF v_pending IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'order_id', v_id,
        'reason', 'corte incompleto: ' || v_pending
      ));
      CONTINUE;
    END IF;

    UPDATE public.orders
       SET corte_ahead_unlocked_at = now(),
           updated_at = now()
     WHERE id = v_id;
    v_ok := v_ok + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'unlocked', v_ok, 'skipped', v_skipped);
END;
$fn$;

REVOKE ALL ON FUNCTION public.enter_corte_ahead_production(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enter_corte_ahead_production(uuid[])
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Cancel → peça cortada
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.materialize_corte_cut_pieces_on_cancel(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item public.sale_order_items%ROWTYPE;
  v_kind text;
  v_created int := 0;
  v_color text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;

  IF v_order.sale_order_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.sale_order_items WHERE id = v_order.sale_order_item_id;
  END IF;

  v_color := upper(trim(coalesce(v_item.color, v_order.color, '')));

  FOR v_kind IN
    SELECT DISTINCT d.cut_kind
      FROM public.corte_ahead_stock_debits d
     WHERE d.order_id = p_order_id
       AND d.quantity_debited > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.corte_cut_pieces p
       WHERE p.source_order_id = p_order_id
         AND p.cut_kind = v_kind
         AND p.status <> 'void'
    ) THEN
      CONTINUE;
    END IF;

    IF v_item.technical_sheet_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.corte_cut_pieces (
      cut_kind, reference_id, color_norm, material_variant_id,
      pairs_original, pairs_available, original_grade,
      source_order_id, source_sale_order_item_id, status
    ) VALUES (
      v_kind,
      v_item.technical_sheet_id,
      v_color,
      v_item.material_variant_id,
      GREATEST(1, coalesce(v_order.quantity, v_item.quantity, 1)),
      GREATEST(1, coalesce(v_order.quantity, v_item.quantity, 1)),
      v_item.grade,
      p_order_id,
      v_order.sale_order_item_id,
      'available'
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_created);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_corte_cut_pieces_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status IN ('Cancelada', 'Cancelado')
     AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    PERFORM public.materialize_corte_cut_pieces_on_cancel(NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_corte_cut_pieces_on_order_cancel ON public.orders;
CREATE TRIGGER trg_corte_cut_pieces_on_order_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_corte_cut_pieces_on_order_cancel();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Reuso
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.allocate_corte_cut_piece(
  p_piece_id uuid,
  p_sale_order_item_id uuid,
  p_pairs numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_piece public.corte_cut_pieces%ROWTYPE;
  v_item public.sale_order_items%ROWTYPE;
  v_order_id uuid;
  v_aliases text[];
  v_color text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  IF p_pairs IS NULL OR p_pairs <= 0 THEN
    RAISE EXCEPTION 'Informe pares > 0';
  END IF;

  SELECT * INTO v_piece FROM public.corte_cut_pieces WHERE id = p_piece_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saldo de peça cortada não encontrado';
  END IF;
  IF v_piece.status IS DISTINCT FROM 'available' OR v_piece.pairs_available < p_pairs THEN
    RAISE EXCEPTION 'Saldo insuficiente (disponível %)', coalesce(v_piece.pairs_available, 0);
  END IF;

  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_sale_order_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de PV não encontrado';
  END IF;

  IF v_item.technical_sheet_id IS DISTINCT FROM v_piece.reference_id THEN
    RAISE EXCEPTION 'Referência diferente da peça cortada';
  END IF;

  v_color := upper(trim(coalesce(v_item.color, '')));
  IF v_color IS DISTINCT FROM v_piece.color_norm THEN
    RAISE EXCEPTION 'Cor diferente da peça cortada';
  END IF;

  IF v_piece.material_variant_id IS NOT NULL
     AND v_item.material_variant_id IS DISTINCT FROM v_piece.material_variant_id
  THEN
    RAISE EXCEPTION 'Variante de material diferente da peça cortada';
  END IF;

  UPDATE public.corte_cut_pieces
     SET pairs_available = pairs_available - p_pairs,
         status = CASE WHEN pairs_available - p_pairs <= 0 THEN 'exhausted' ELSE status END,
         updated_at = now()
   WHERE id = p_piece_id;

  SELECT o.id INTO v_order_id
    FROM public.orders o
   WHERE o.sale_order_item_id = p_sale_order_item_id
     AND o.status NOT IN ('Cancelada', 'Cancelado', 'Rascunho')
   ORDER BY o.created_at DESC
   LIMIT 1;

  INSERT INTO public.corte_cut_piece_allocations (
    cut_piece_id, sale_order_item_id, order_id, pairs, created_by
  ) VALUES (
    p_piece_id, p_sale_order_item_id, v_order_id, p_pairs, auth.uid()
  );

  IF v_order_id IS NOT NULL THEN
    v_aliases := public.corte_stage_names_for_kind(v_piece.cut_kind);
    UPDATE public.order_stages os
       SET status = 'concluido',
           quantity_processed = coalesce(nullif(os.quantity_processed, 0), p_pairs),
           updated_at = now()
     WHERE os.order_id = v_order_id
       AND public.corte_cut_kind_from_stage(os.stage_name) = v_piece.cut_kind
       AND os.status IS DISTINCT FROM 'concluido';

    -- Marca ledger skip (0 debitado) pra não re-debitar napa deste kind
    INSERT INTO public.corte_ahead_stock_debits (
      order_id, sale_order_item_id, product_id, cut_kind,
      quantity_debited, pending_qty
    )
    SELECT v_order_id, p_sale_order_item_id, p.id, v_piece.cut_kind, 0, 0
      FROM public.products p
     WHERE false; -- placeholder: skip por kind via metadata na allocation
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'piece_id', p_piece_id,
    'pairs', p_pairs,
    'order_id', v_order_id,
    'cut_kind', v_piece.cut_kind
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.allocate_corte_cut_piece(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_corte_cut_piece(uuid, uuid, numeric)
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Listagens RPC (bloco 1 + reuso)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_corte_wip_for_sector(p_sector text)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  sale_order_id uuid,
  sale_order_number text,
  client_name text,
  reference_name text,
  color text,
  pairs numeric,
  stage_name text,
  stage_status text,
  is_ahead boolean,
  corte_unlocked boolean,
  all_cuts_done boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_kind text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  v_kind := public.corte_cut_kind_from_stage(p_sector);
  IF v_kind IS NULL THEN
    -- aceita nomes da UI
    v_kind := CASE trim(p_sector)
      WHEN 'Corte Cabedal' THEN 'cabedal'
      WHEN 'Corte Fibra' THEN 'fibra'
      WHEN 'Corte Palmilha' THEN 'fibra'
      WHEN 'Corte Forração' THEN 'forracao'
      ELSE NULL
    END;
  END IF;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Setor de corte inválido: %', p_sector;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number::text,
    o.sale_order_id,
    so.order_number::text,
    coalesce(c.nome_fantasia, c.razao_social, so.client_name, '')::text,
    coalesce(ts.name, ts.code, '')::text,
    coalesce(soi.color, o.color, '')::text,
    coalesce(o.quantity, 0)::numeric,
    os.stage_name::text,
    os.status::text,
    coalesce(o.is_ahead_of_schedule, false),
    o.corte_ahead_unlocked_at IS NOT NULL,
    NOT EXISTS (
      SELECT 1 FROM public.order_stages os2
       WHERE os2.order_id = o.id
         AND public.corte_is_cutting_stage(os2.stage_name)
         AND os2.status IS DISTINCT FROM 'concluido'
    )
  FROM public.orders o
  JOIN public.order_stages os ON os.order_id = o.id
  LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
  LEFT JOIN public.clients c ON c.id = so.client_id
  LEFT JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
  LEFT JOIN public.technical_sheets ts ON ts.id = soi.technical_sheet_id
  WHERE o.status NOT IN ('Cancelada', 'Cancelado', 'Finalizado', 'Rascunho')
    AND public.corte_cut_kind_from_stage(os.stage_name) = v_kind
    AND os.status IS DISTINCT FROM 'concluido'
  ORDER BY so.delivery_deadline NULLS LAST, o.order_number;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_corte_wip_for_sector(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_corte_wip_for_sector(text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_corte_cut_pieces_available()
RETURNS SETOF public.corte_cut_pieces
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.*
    FROM public.corte_cut_pieces p
   WHERE p.status = 'available'
     AND p.pairs_available > 0
   ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_corte_cut_pieces_available() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_corte_cut_pieces_available()
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Patch release_corte_lookahead: trim soft após promote
-- ═══════════════════════════════════════════════════════════════════════════

DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.release_corte_lookahead_items(uuid[])'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE NOTICE 'release_corte_lookahead_items ausente — skip patch trim';
    RETURN;
  END IF;
  IF v_def LIKE '%trim_corte_ahead_soft_reservations%' THEN
    RAISE NOTICE 'release já chama trim — skip';
    RETURN;
  END IF;

  -- Insere chamada após promote bem-sucedido: procura created_order_id pattern
  IF v_def NOT LIKE '%promote_sale_order_item%' THEN
    RAISE NOTICE 'âncora promote não encontrada — skip trim patch';
    RETURN;
  END IF;

  -- Abordagem segura: wrapper não; recriamos via append no loop.
  -- Se o corpo usa v_order_id / v_new_order_id, tentamos âncoras comuns.
  v_new := v_def;
  IF position('v_created_order_id' IN v_def) > 0 THEN
    v_new := replace(
      v_def,
      'v_created := v_created + 1;',
      $r$v_created := v_created + 1;
      IF v_created_order_id IS NOT NULL THEN
        PERFORM public.trim_corte_ahead_soft_reservations(v_created_order_id);
      END IF;$r$
    );
  ELSIF position('v_order_id' IN v_def) > 0 THEN
    -- fallback: após UPDATE sale_orders para Em Produção comum
    v_new := replace(
      v_def,
      'v_created := v_created + 1;',
      $r$v_created := v_created + 1;
      PERFORM public.trim_corte_ahead_soft_reservations(
        (SELECT id FROM public.orders
          WHERE sale_order_item_id = v_item.id
            AND coalesce(is_ahead_of_schedule, false)
          ORDER BY created_at DESC LIMIT 1)
      );$r$
    );
  END IF;

  IF v_new IS DISTINCT FROM v_def AND v_new LIKE '%trim_corte_ahead_soft_reservations%' THEN
    EXECUTE v_new;
  ELSE
    RAISE NOTICE 'Não foi possível patchar release automaticamente; trim fica disponível via RPC.';
  END IF;
END;
$patch$;

-- Anti-2×: estender gate de reserva OP (além do Ateliê)
CREATE OR REPLACE FUNCTION public.tg_block_op_reserve_if_corte_ahead_debited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.order_id IS NOT NULL
     AND NEW.product_id IS NOT NULL
     AND public.corte_ahead_product_already_debited(NEW.order_id, NEW.product_id)
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_block_op_reserve_if_corte_ahead_debited ON public.material_reservations;
CREATE TRIGGER trg_block_op_reserve_if_corte_ahead_debited
  BEFORE INSERT ON public.material_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_op_reserve_if_corte_ahead_debited();
