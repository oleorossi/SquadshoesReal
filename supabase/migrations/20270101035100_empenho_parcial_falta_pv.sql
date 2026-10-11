-- Integração Estoque ↔ PV ↔ Compras — ETAPA 1
-- Spec: specs/integracao-estoque-pv-compras.md
--
-- Empenho PARCIAL na aprovação + FALTA registrada por PV (e por numeração no
-- solado) + quitação da falta na entrada de estoque (pela prioridade), com
-- registro de rateio. Corrige os defeitos 1 e 2 da spec.
--
-- Modelo:
--   necessidade = quantity_reserved + quantity_short
--   quantity_reserved (- consumed) = EMPENHADO → entra em reserved_stock
--   quantity_short                 = FALTA     → NÃO entra em reserved_stock
-- Solado (kind = 'sole_grade'): metadata.effective_grade continua sendo a
-- necessidade por balde; metadata.covered_grade / shortage_grade dividem o
-- balde (numeração ou conjugado "33/34", nunca dividido entre números).
--
-- Físico nunca fica negativo (trava existente intacta). Finalizados e
-- cancelados não são tocados: só linhas abertas (reserved/partially_consumed).

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.material_reservations
  ADD COLUMN IF NOT EXISTS quantity_short numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.material_reservations'::regclass
       AND conname = 'material_reservations_quantity_short_ck'
  ) THEN
    ALTER TABLE public.material_reservations
      ADD CONSTRAINT material_reservations_quantity_short_ck
      CHECK (quantity_short >= 0);
  END IF;
END;
$$;

COMMENT ON COLUMN public.material_reservations.quantity_short IS
  'Falta do PV: parte da necessidade sem estoque para empenhar. Não entra em '
  'reserved_stock. Necessidade = quantity_reserved + quantity_short. Quitada '
  'na entrada de estoque (reallocate_product_commitments). '
  'Spec: specs/integracao-estoque-pv-compras.md';

CREATE INDEX IF NOT EXISTS idx_material_reservations_short_open
  ON public.material_reservations (product_id)
  WHERE quantity_short > 0
    AND status IN ('reserved', 'partially_consumed');

-- Rateio da entrada: qual entrada quitou a falta de qual PV (base do rastreio).
CREATE TABLE IF NOT EXISTS public.stock_inbound_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size_key text,
  reservation_id uuid REFERENCES public.material_reservations(id) ON DELETE SET NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (reason IN ('entrada', 'realocacao')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_stock_inbound_allocations_product
  ON public.stock_inbound_allocations (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_inbound_allocations_sale_order
  ON public.stock_inbound_allocations (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_stock_inbound_allocations_movement
  ON public.stock_inbound_allocations (stock_movement_id);

ALTER TABLE public.stock_inbound_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_inbound_allocations_select ON public.stock_inbound_allocations;
CREATE POLICY stock_inbound_allocations_select
  ON public.stock_inbound_allocations
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

REVOKE ALL ON public.stock_inbound_allocations FROM anon;
GRANT SELECT ON public.stock_inbound_allocations TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quais reservas este motor gerencia (demanda de PV/OP; nunca tiras)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.material_reservation_is_pv_managed(
  mr public.material_reservations
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT mr.status IN ('reserved', 'partially_consumed')
     AND COALESCE(mr.reservation_type, 'soft') = 'soft'
     AND COALESCE(mr.metadata ->> 'kind', 'component')
           IN ('pv_commitment', 'component', 'atelier_prep', 'sole_grade')
     AND mr.strap_variant_id IS NULL
     AND mr.sale_order_strap_demand_id IS NULL
     AND mr.strap_stock_floor_contribution_id IS NULL
     AND mr.strap_batch_item_id IS NULL
     AND mr.service_order_item_id IS NULL
     AND mr.base_product_id IS NULL
     AND mr.finished_product_id IS NULL
     AND mr.dublagem_demand_id IS NULL
     AND COALESCE(mr.source, '') NOT IN (
           'strap_engine_finished', 'strap_engine_base', 'strap_demand'
         );
$$;

-- Prioridade da linha (menor = primeiro). Reusa commitment_cover_priority:
-- Ateliê → 1º dia da semana de faturamento → prazo → criação.
CREATE OR REPLACE FUNCTION public.material_reservation_cover_priority(
  p_sale_order_id uuid,
  p_order_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so uuid := p_sale_order_id;
BEGIN
  IF v_so IS NULL AND p_order_id IS NOT NULL THEN
    SELECT o.sale_order_id INTO v_so FROM public.orders o WHERE o.id = p_order_id;
  END IF;
  IF v_so IS NULL THEN
    RETURN 9000000000;
  END IF;
  RETURN public.commitment_cover_priority(v_so);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Empenho parcial de UMA linha (material comum, sem numeração)
--    livre = físico − empenhado das OUTRAS linhas abertas do produto.
--    Não rouba de ninguém: quem já empenhou continua empenhado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_reservation_partial(p_reservation_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_res public.material_reservations%ROWTYPE;
  v_phys numeric;
  v_others numeric;
  v_want numeric;
  v_give numeric;
BEGIN
  SELECT mr.product_id INTO v_product_id
    FROM public.material_reservations mr
   WHERE mr.id = p_reservation_id;
  IF v_product_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.product_requires_strap_engine_write(v_product_id) THEN
    RETURN NULL;
  END IF;

  -- Ordem de lock: produto → reserva (mesma ordem do hybrid/commit).
  SELECT COALESCE(p.quantity, 0) INTO v_phys
    FROM public.products p
   WHERE p.id = v_product_id
   FOR UPDATE;

  SELECT * INTO v_res
    FROM public.material_reservations mr
   WHERE mr.id = p_reservation_id
   FOR UPDATE;

  IF NOT public.material_reservation_is_pv_managed(v_res)
     OR COALESCE(v_res.metadata ->> 'kind', '') = 'sole_grade' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(GREATEST(
           COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0
         )), 0)
    INTO v_others
    FROM public.material_reservations mr
   WHERE mr.product_id = v_product_id
     AND mr.status IN ('reserved', 'partially_consumed')
     AND mr.id <> p_reservation_id;

  v_want := GREATEST(
              COALESCE(v_res.quantity_reserved, 0) - COALESCE(v_res.quantity_consumed, 0),
              0
            ) + COALESCE(v_res.quantity_short, 0);
  v_give := LEAST(v_want, GREATEST(v_phys - v_others, 0));

  UPDATE public.material_reservations
     SET quantity_reserved = COALESCE(quantity_consumed, 0) + v_give,
         quantity_short = v_want - v_give,
         sale_order_id = COALESCE(
           sale_order_id,
           (SELECT o.sale_order_id FROM public.orders o WHERE o.id = order_id)
         ),
         updated_at = now()
   WHERE id = p_reservation_id
     AND (
       quantity_reserved IS DISTINCT FROM COALESCE(quantity_consumed, 0) + v_give
       OR quantity_short IS DISTINCT FROM v_want - v_give
     );

  RETURN v_want - v_give;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Empenho parcial de UMA linha de SOLADO, balde a balde (número a número,
--    cor a cor — o produto já é a cor). Balde conjugado é um balde só.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_sole_grade_reservation(p_reservation_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_res public.material_reservations%ROWTYPE;
  v_stock_grade jsonb;
  v_need jsonb;
  v_key text;
  v_need_qty numeric;
  v_stock_qty numeric;
  v_others numeric;
  v_give numeric;
  v_covered jsonb := '{}'::jsonb;
  v_shortage jsonb := '{}'::jsonb;
  v_covered_total numeric := 0;
  v_short_total numeric := 0;
BEGIN
  SELECT mr.product_id INTO v_product_id
    FROM public.material_reservations mr
   WHERE mr.id = p_reservation_id;
  IF v_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(p.stock_grade, '{}'::jsonb) INTO v_stock_grade
    FROM public.products p
   WHERE p.id = v_product_id
   FOR UPDATE;

  SELECT * INTO v_res
    FROM public.material_reservations mr
   WHERE mr.id = p_reservation_id
   FOR UPDATE;

  IF NOT public.material_reservation_is_pv_managed(v_res)
     OR COALESCE(v_res.metadata ->> 'kind', '') <> 'sole_grade'
     OR COALESCE(v_res.quantity_consumed, 0) > 0 THEN
    RETURN NULL;
  END IF;

  v_need := v_res.metadata -> 'effective_grade';
  IF v_need IS NULL OR jsonb_typeof(v_need) <> 'object' THEN
    RETURN NULL;
  END IF;

  FOR v_key, v_need_qty IN
    SELECT g.key, g.value::numeric
      FROM jsonb_each_text(v_need) g
     WHERE left(g.key, 1) <> '_'
       AND g.value ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND g.value::numeric > 0
  LOOP
    v_stock_qty := GREATEST(COALESCE(NULLIF(v_stock_grade ->> v_key, '')::numeric, 0), 0);

    -- Empenhado por OUTRAS linhas de solado abertas neste balde. Linha legada
    -- (sem covered_grade) conta a necessidade inteira como empenhada.
    SELECT COALESCE(sum(COALESCE(
             NULLIF(COALESCE(mr.metadata -> 'covered_grade', mr.metadata -> 'effective_grade') ->> v_key, '')::numeric,
             0
           )), 0)
      INTO v_others
      FROM public.material_reservations mr
     WHERE mr.product_id = v_product_id
       AND mr.id <> p_reservation_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade';

    v_give := LEAST(v_need_qty, GREATEST(v_stock_qty - v_others, 0));
    IF v_give > 0 THEN
      v_covered := v_covered || jsonb_build_object(v_key, v_give);
    END IF;
    IF v_need_qty - v_give > 0 THEN
      v_shortage := v_shortage || jsonb_build_object(v_key, v_need_qty - v_give);
    END IF;
    v_covered_total := v_covered_total + v_give;
    v_short_total := v_short_total + (v_need_qty - v_give);
  END LOOP;

  UPDATE public.material_reservations
     SET quantity_reserved = v_covered_total,
         quantity_short = v_short_total,
         sale_order_id = COALESCE(
           sale_order_id,
           (SELECT o.sale_order_id FROM public.orders o WHERE o.id = order_id)
         ),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'covered_grade', v_covered,
           'shortage_grade', v_shortage
         ),
         updated_at = now()
   WHERE id = p_reservation_id;

  RETURN v_short_total;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Realocação do produto (entrada de estoque / backfill)
--    a) Encolhe: se o empenhado passa do físico, a linha de MENOR prioridade
--       devolve empenho e o que devolveu vira falta (nunca é cancelada).
--       Ateliê (atelier_prep) nunca é encolhido.
--    b) Quita: o físico livre vai para as faltas, pela prioridade, e cada
--       quitação fica registrada em stock_inbound_allocations.
--    Nunca toma empenho de uma linha para dar a outra (a entrada rateia o que
--    está livre, não reabre o que já foi empenhado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reallocate_product_commitments(
  p_product_id uuid,
  p_movement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phys numeric;
  v_stock_grade jsonb;
  v_fixed numeric;
  v_managed_open numeric;
  v_excess numeric;
  v_free numeric;
  v_cut numeric;
  v_give numeric;
  v_row record;
  v_key text;
  v_bucket_stock numeric;
  v_bucket_covered numeric;
  v_row_cov numeric;
  v_row_short numeric;
  v_reason text := CASE WHEN p_movement_id IS NULL THEN 'realocacao' ELSE 'entrada' END;
  v_shrunk int := 0;
  v_covered_rows int := 0;
  v_covered_qty numeric := 0;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_null');
  END IF;
  IF public.product_requires_strap_engine_write(p_product_id) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'strap_product');
  END IF;

  SELECT COALESCE(p.quantity, 0), COALESCE(p.stock_grade, '{}'::jsonb)
    INTO v_phys, v_stock_grade
    FROM public.products p
   WHERE p.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_not_found');
  END IF;

  -- ===================== Material comum (sem numeração) ====================
  SELECT
    COALESCE(sum(GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0))
      FILTER (WHERE NOT public.material_reservation_is_pv_managed(mr)
                 OR COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'), 0),
    COALESCE(sum(GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0))
      FILTER (WHERE public.material_reservation_is_pv_managed(mr)
                AND COALESCE(mr.metadata ->> 'kind', '') <> 'sole_grade'), 0)
    INTO v_fixed, v_managed_open
    FROM public.material_reservations mr
   WHERE mr.product_id = p_product_id
     AND mr.status IN ('reserved', 'partially_consumed');

  v_excess := v_fixed + v_managed_open - v_phys;

  IF v_excess > 0 THEN
    FOR v_row IN
      SELECT mr.id,
             GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0) AS open_qty
        FROM public.material_reservations mr
       WHERE mr.product_id = p_product_id
         AND public.material_reservation_is_pv_managed(mr)
         AND COALESCE(mr.metadata ->> 'kind', '') NOT IN ('sole_grade', 'atelier_prep')
         AND COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0) > 0
       ORDER BY public.material_reservation_cover_priority(mr.sale_order_id, mr.order_id) DESC,
                mr.created_at DESC, mr.id DESC
       FOR UPDATE OF mr
    LOOP
      EXIT WHEN v_excess <= 0;
      v_cut := LEAST(v_excess, v_row.open_qty);
      UPDATE public.material_reservations
         SET quantity_reserved = quantity_reserved - v_cut,
             quantity_short = quantity_short + v_cut,
             updated_at = now()
       WHERE id = v_row.id;
      v_excess := v_excess - v_cut;
      v_shrunk := v_shrunk + 1;
    END LOOP;
  END IF;

  -- Livre = físico − tudo o que continua empenhado (após encolher).
  SELECT v_phys - COALESCE(sum(GREATEST(
           COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0
         )), 0)
    INTO v_free
    FROM public.material_reservations mr
   WHERE mr.product_id = p_product_id
     AND mr.status IN ('reserved', 'partially_consumed');

  IF v_free > 0 THEN
    FOR v_row IN
      SELECT mr.id, mr.quantity_short, mr.sale_order_id, mr.order_id
        FROM public.material_reservations mr
       WHERE mr.product_id = p_product_id
         AND public.material_reservation_is_pv_managed(mr)
         AND COALESCE(mr.metadata ->> 'kind', '') <> 'sole_grade'
         AND mr.quantity_short > 0
       ORDER BY public.material_reservation_cover_priority(mr.sale_order_id, mr.order_id) ASC,
                mr.created_at ASC, mr.id ASC
       FOR UPDATE OF mr
    LOOP
      EXIT WHEN v_free <= 0;
      v_give := LEAST(v_free, v_row.quantity_short);
      UPDATE public.material_reservations
         SET quantity_reserved = quantity_reserved + v_give,
             quantity_short = quantity_short - v_give,
             updated_at = now()
       WHERE id = v_row.id;
      INSERT INTO public.stock_inbound_allocations (
        stock_movement_id, product_id, size_key, reservation_id,
        sale_order_id, order_id, quantity, reason
      ) VALUES (
        p_movement_id, p_product_id, NULL, v_row.id,
        COALESCE(v_row.sale_order_id,
          (SELECT o.sale_order_id FROM public.orders o WHERE o.id = v_row.order_id)),
        v_row.order_id, v_give, v_reason
      );
      v_free := v_free - v_give;
      v_covered_rows := v_covered_rows + 1;
      v_covered_qty := v_covered_qty + v_give;
    END LOOP;
  END IF;

  -- ===================== Solado (balde a balde) ============================
  IF EXISTS (
    SELECT 1 FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND public.material_reservation_is_pv_managed(mr)
       AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
  ) THEN
    -- Linhas legadas (sem covered_grade): todo o balde conta como empenhado;
    -- o passo "encolher" abaixo devolve o que não cabe no estoque.
    UPDATE public.material_reservations mr
       SET metadata = COALESCE(mr.metadata, '{}'::jsonb) || jsonb_build_object(
             'covered_grade', COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb),
             'shortage_grade', '{}'::jsonb
           ),
           updated_at = now()
     WHERE mr.product_id = p_product_id
       AND public.material_reservation_is_pv_managed(mr)
       AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND jsonb_typeof(mr.metadata -> 'effective_grade') = 'object'
       AND mr.metadata -> 'covered_grade' IS NULL;

    FOR v_key IN
      SELECT DISTINCT k.key
        FROM public.material_reservations mr,
             LATERAL jsonb_each_text(mr.metadata -> 'effective_grade') k
       WHERE mr.product_id = p_product_id
         AND public.material_reservation_is_pv_managed(mr)
         AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
         AND COALESCE(mr.quantity_consumed, 0) = 0
         AND jsonb_typeof(mr.metadata -> 'effective_grade') = 'object'
         AND left(k.key, 1) <> '_'
       ORDER BY k.key
    LOOP
      v_bucket_stock := GREATEST(COALESCE(NULLIF(v_stock_grade ->> v_key, '')::numeric, 0), 0);
      SELECT COALESCE(sum(COALESCE(NULLIF(mr.metadata -> 'covered_grade' ->> v_key, '')::numeric, 0)), 0)
        INTO v_bucket_covered
        FROM public.material_reservations mr
       WHERE mr.product_id = p_product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade';

      -- a) encolhe o balde (menor prioridade primeiro)
      v_excess := v_bucket_covered - v_bucket_stock;
      IF v_excess > 0 THEN
        FOR v_row IN
          SELECT mr.id,
                 COALESCE(NULLIF(mr.metadata -> 'covered_grade' ->> v_key, '')::numeric, 0) AS cov,
                 COALESCE(NULLIF(mr.metadata -> 'shortage_grade' ->> v_key, '')::numeric, 0) AS short
            FROM public.material_reservations mr
           WHERE mr.product_id = p_product_id
             AND public.material_reservation_is_pv_managed(mr)
             AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
             AND COALESCE(mr.quantity_consumed, 0) = 0
             AND COALESCE(NULLIF(mr.metadata -> 'covered_grade' ->> v_key, '')::numeric, 0) > 0
           ORDER BY public.material_reservation_cover_priority(mr.sale_order_id, mr.order_id) DESC,
                    mr.created_at DESC, mr.id DESC
           FOR UPDATE OF mr
        LOOP
          EXIT WHEN v_excess <= 0;
          v_cut := LEAST(v_excess, v_row.cov);
          v_row_cov := v_row.cov - v_cut;
          v_row_short := v_row.short + v_cut;
          UPDATE public.material_reservations
             SET metadata = jsonb_set(
                   jsonb_set(metadata, ARRAY['covered_grade', v_key], to_jsonb(v_row_cov)),
                   ARRAY['shortage_grade', v_key], to_jsonb(v_row_short)
                 ),
                 updated_at = now()
           WHERE id = v_row.id;
          v_excess := v_excess - v_cut;
          v_shrunk := v_shrunk + 1;
        END LOOP;
        v_bucket_covered := v_bucket_stock;
      END IF;

      -- b) quita a falta do balde com o livre (maior prioridade primeiro)
      v_free := v_bucket_stock - v_bucket_covered;
      IF v_free > 0 THEN
        FOR v_row IN
          SELECT mr.id, mr.sale_order_id, mr.order_id,
                 COALESCE(NULLIF(mr.metadata -> 'covered_grade' ->> v_key, '')::numeric, 0) AS cov,
                 COALESCE(NULLIF(mr.metadata -> 'shortage_grade' ->> v_key, '')::numeric, 0) AS short
            FROM public.material_reservations mr
           WHERE mr.product_id = p_product_id
             AND public.material_reservation_is_pv_managed(mr)
             AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
             AND COALESCE(mr.quantity_consumed, 0) = 0
             AND COALESCE(NULLIF(mr.metadata -> 'shortage_grade' ->> v_key, '')::numeric, 0) > 0
           ORDER BY public.material_reservation_cover_priority(mr.sale_order_id, mr.order_id) ASC,
                    mr.created_at ASC, mr.id ASC
           FOR UPDATE OF mr
        LOOP
          EXIT WHEN v_free <= 0;
          v_give := LEAST(v_free, v_row.short);
          UPDATE public.material_reservations
             SET metadata = jsonb_set(
                   jsonb_set(metadata, ARRAY['covered_grade', v_key], to_jsonb(v_row.cov + v_give)),
                   ARRAY['shortage_grade', v_key], to_jsonb(v_row.short - v_give)
                 ),
                 updated_at = now()
           WHERE id = v_row.id;
          INSERT INTO public.stock_inbound_allocations (
            stock_movement_id, product_id, size_key, reservation_id,
            sale_order_id, order_id, quantity, reason
          ) VALUES (
            p_movement_id, p_product_id, v_key, v_row.id,
            COALESCE(v_row.sale_order_id,
              (SELECT o.sale_order_id FROM public.orders o WHERE o.id = v_row.order_id)),
            v_row.order_id, v_give, v_reason
          );
          v_free := v_free - v_give;
          v_covered_rows := v_covered_rows + 1;
          v_covered_qty := v_covered_qty + v_give;
        END LOOP;
      END IF;
    END LOOP;

    -- Totais da linha = soma dos baldes (zeros removidos da falta)
    UPDATE public.material_reservations mr
       SET quantity_reserved = t.cov,
           quantity_short = t.short,
           sale_order_id = COALESCE(
             mr.sale_order_id,
             (SELECT o.sale_order_id FROM public.orders o WHERE o.id = mr.order_id)
           ),
           metadata = jsonb_set(
             mr.metadata, '{shortage_grade}',
             COALESCE((
               SELECT jsonb_object_agg(s.key, s.value::numeric)
                 FROM jsonb_each_text(mr.metadata -> 'shortage_grade') s
                WHERE s.value::numeric > 0
             ), '{}'::jsonb)
           ),
           updated_at = now()
      FROM (
        SELECT x.id,
               COALESCE((SELECT sum(c.value::numeric) FROM jsonb_each_text(x.metadata -> 'covered_grade') c), 0) AS cov,
               COALESCE((SELECT sum(s.value::numeric) FROM jsonb_each_text(x.metadata -> 'shortage_grade') s), 0) AS short
          FROM public.material_reservations x
         WHERE x.product_id = p_product_id
           AND public.material_reservation_is_pv_managed(x)
           AND COALESCE(x.metadata ->> 'kind', '') = 'sole_grade'
           AND COALESCE(x.quantity_consumed, 0) = 0
      ) t
     WHERE mr.id = t.id
       AND (
         mr.quantity_reserved IS DISTINCT FROM t.cov
         OR mr.quantity_short IS DISTINCT FROM t.short
         OR mr.sale_order_id IS NULL
       );
  END IF;

  PERFORM public.sync_product_reserved_stock(p_product_id);

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'movement_id', p_movement_id,
    'shrunk_rows', v_shrunk,
    'covered_rows', v_covered_rows,
    'covered_qty', v_covered_qty
  );
END;
$$;

-- A função antiga CANCELAVA a reserva de menor prioridade (a falta sumia).
-- Agora é um alias da realocação, que transforma o excesso em falta.
CREATE OR REPLACE FUNCTION public.rebalance_material_commitments_for_product(p_product_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.reallocate_product_commitments(p_product_id, NULL);
$$;

-- Entrada de estoque: quita falta pela prioridade e registra o rateio.
CREATE OR REPLACE FUNCTION public.tg_cover_commitments_on_stock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'in'
     AND NEW.product_id IS NOT NULL
     AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM public.cover_open_material_commitments(NEW.product_id, NEW.quantity, NEW.id);
    BEGIN
      PERFORM public.reallocate_product_commitments(NEW.product_id, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[tg_cover_commitments_on_stock_in] realocação falhou para %: %',
        NEW.product_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_reservation_partial(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_sole_grade_reservation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reallocate_product_commitments(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.material_reservation_cover_priority(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.allocate_reservation_partial(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_sole_grade_reservation(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reallocate_product_commitments(uuid, uuid) FROM anon;

-- ---------------------------------------------------------------------------
-- 6. Aprovação do PV: commitment empenha o que existe; o resto vira falta
--    (corpo da 20270101030800 + reset de quantity_short + allocate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_sale_order_material_demand(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_needed numeric;
  v_existing public.material_reservations%ROWTYPE;
  v_upserted int := 0;
  v_released int := 0;
  v_product_ids uuid[] := ARRAY[]::uuid[];
  v_short numeric;
  v_short_total numeric := 0;
BEGIN
  IF NOT public.is_approved_user()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', '')
     AND current_user NOT IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1'
     AND COALESCE(current_setting('app.internal_stock_sync', true), '') <> '1'
  THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pv_commit:' || p_sale_order_id::text));

  FOR r IN
    SELECT d.product_id,
           sum(d.required)::numeric AS required,
           min(d.component) AS component
      FROM public.sale_order_material_demand_lines(p_sale_order_id) d
     GROUP BY d.product_id
  LOOP
    v_product_ids := array_append(v_product_ids, r.product_id);
    v_needed := GREATEST(r.required, 0);

    SELECT * INTO v_existing
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = p_sale_order_id
       AND mr.product_id = r.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep', 'component')
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
     ORDER BY
       CASE COALESCE(mr.metadata ->> 'kind', '')
         WHEN 'pv_commitment' THEN 0
         WHEN 'atelier_prep' THEN 1
         ELSE 2
       END,
       mr.created_at
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.material_reservations
         SET quantity_reserved = GREATEST(v_needed, COALESCE(quantity_consumed, 0)),
             quantity_short = 0,
             sale_order_id = p_sale_order_id,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'kind', CASE
                         WHEN COALESCE(metadata ->> 'kind', '') = 'atelier_prep' THEN 'atelier_prep'
                         ELSE 'pv_commitment'
                       END,
               'component', r.component,
               'sale_order_id', p_sale_order_id
             ),
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      INSERT INTO public.material_reservations (
        order_id, sale_order_id, product_id,
        quantity_reserved, quantity_consumed,
        status, reservation_type, notes, metadata
      ) VALUES (
        NULL, p_sale_order_id, r.product_id,
        v_needed, 0,
        'reserved', 'soft',
        'Comprometimento PV',
        jsonb_build_object(
          'kind', 'pv_commitment',
          'component', r.component,
          'sale_order_id', p_sale_order_id
        )
      )
      RETURNING * INTO v_existing;
    END IF;

    -- Uma conta: cancela irmãs abertas do mesmo PV+produto (anti-2× com OP soft legado)
    UPDATE public.material_reservations mr
       SET status = 'cancelled',
           updated_at = now(),
           notes = COALESCE(notes, '') || ' · consolidado em pv_commitment'
     WHERE mr.sale_order_id = p_sale_order_id
       AND mr.product_id = r.product_id
       AND mr.id IS DISTINCT FROM v_existing.id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component')
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
       AND COALESCE(mr.quantity_consumed, 0) = 0;

    -- Empenho parcial: empenha o livre, o resto vira falta (quantity_short).
    v_short := public.allocate_reservation_partial(v_existing.id);
    v_short_total := v_short_total + COALESCE(v_short, 0);

    v_upserted := v_upserted + 1;
  END LOOP;

  -- Release open pv_commitment rows no longer needed (not atelier hard path)
  UPDATE public.material_reservations mr
     SET status = 'cancelled',
         quantity_short = 0,
         updated_at = now(),
         notes = COALESCE(notes, '') || ' · recompute sem demanda'
   WHERE mr.sale_order_id = p_sale_order_id
     AND mr.status IN ('reserved', 'partially_consumed')
     AND COALESCE(mr.metadata ->> 'kind', '') = 'pv_commitment'
     AND mr.quantity_consumed = 0
     AND (cardinality(v_product_ids) = 0 OR NOT (mr.product_id = ANY (v_product_ids)));
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'sale_order_id', p_sale_order_id,
    'upserted', v_upserted,
    'released', v_released,
    'short_total', v_short_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_sale_order_material_demand(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Injeções no corpo VIVO (funções grandes; marker ausente = migration falha)
-- ---------------------------------------------------------------------------
DO $inject$
DECLARE
  v_def text;
  v_new text;
  v_marker text;
BEGIN
  -- 7a. hybrid_debit: adotar o commitment NÃO infla o empenho; ao final, toda
  --     linha soft da OP passa pelo empenho parcial.
  v_def := pg_get_functiondef('public.hybrid_debit_stock_for_order'::regproc);
  IF position('allocate_reservation_partial' IN v_def) = 0 THEN
    v_marker := 'quantity_reserved = GREATEST(mr.quantity_reserved, v_required),';
    IF (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'hybrid_debit: marker de adoção não encontrado (ou ambíguo)';
    END IF;
    v_new := replace(v_def, v_marker, 'quantity_reserved = mr.quantity_reserved,');

    v_marker := E'  RETURN jsonb_build_object(\n    ''snapshot_id'', v_snap_id,';
    IF (length(v_new) - length(replace(v_new, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'hybrid_debit: marker de retorno não encontrado (ou ambíguo)';
    END IF;
    v_new := replace(
      v_new,
      v_marker,
      E'  -- Empenho parcial (spec integracao-estoque-pv-compras): nenhuma linha soft\n'
      || E'  -- da OP empenha além do físico livre; o resto vira falta.\n'
      || E'  PERFORM public.allocate_reservation_partial(mr.id)\n'
      || E'     FROM public.material_reservations mr\n'
      || E'    WHERE mr.order_id = p_order_id\n'
      || E'      AND mr.status = ''reserved''\n'
      || E'      AND COALESCE(mr.reservation_type, ''soft'') = ''soft''\n'
      || E'      AND COALESCE(mr.metadata ->> ''kind'', '''') IN (''pv_commitment'', ''component'');\n\n'
      || v_marker
    );
    EXECUTE v_new;
  END IF;

  -- 7b. Solado (reserva soft por grade): empenho balde a balde.
  v_def := pg_get_functiondef('public.debit_sole_stock_by_grade'::regproc);
  IF position('allocate_sole_grade_reservation' IN v_def) = 0 THEN
    v_marker := E'''is_palmilha_pronta'', v_is_palmilha_pronta, ''target_name'', target_name));\n    RETURN;';
    IF (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'debit_sole_stock_by_grade: marker do caminho soft não encontrado (ou ambíguo)';
    END IF;
    v_new := replace(
      v_def,
      v_marker,
      E'''is_palmilha_pronta'', v_is_palmilha_pronta, ''target_name'', target_name))\n'
      || E'    RETURNING id INTO v_res_id;\n'
      || E'    -- Empenho parcial por numeração (spec integracao-estoque-pv-compras)\n'
      || E'    PERFORM public.allocate_sole_grade_reservation(v_res_id);\n'
      || E'    RETURN;'
    );
    EXECUTE v_new;
  END IF;

  -- 7c. Finalização: a falta ainda aberta volta a ser cobrada — a baixa tenta
  --     a necessidade inteira e o que faltar vira pendência visível (nunca some).
  v_def := pg_get_functiondef('public.settle_open_reservations_for_order'::regproc);
  IF position('quantity_short' IN v_def) = 0 THEN
    v_marker := E'  FOR v_strap IN\n';
    IF (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'settle_open_reservations_for_order: marker não encontrado (ou ambíguo)';
    END IF;
    v_new := replace(
      v_def,
      v_marker,
      E'  -- Falta registrada (spec integracao-estoque-pv-compras): na finalização a\n'
      || E'  -- baixa tenta a necessidade inteira; o que não houver vira pendência.\n'
      || E'  UPDATE public.material_reservations mr\n'
      || E'     SET quantity_reserved = coalesce(mr.quantity_reserved, 0) + mr.quantity_short,\n'
      || E'         quantity_short = 0,\n'
      || E'         updated_at = pg_catalog.now()\n'
      || E'   WHERE mr.order_id = p_order_id\n'
      || E'     AND mr.status IN (''reserved'', ''partially_consumed'')\n'
      || E'     AND mr.quantity_short > 0;\n\n'
      || v_marker
    );
    EXECUTE v_new;
  END IF;

  -- 7d. DEFEITO 1 (gate de corte): o commitment do PRÓPRIO PV (order_id NULL)
  --     era contado como "outro PV" e bloqueava a própria promoção.
  v_def := pg_get_functiondef('public.sale_order_item_corte_material_gate_block_reason(uuid)'::regprocedure);
  IF position('COALESCE(mr.sale_order_id, o.sale_order_id)' IN v_def) = 0 THEN
    v_marker := 'AND o.sale_order_id IS DISTINCT FROM v_item.sale_order_id;';
    IF (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'gate de corte: marker não encontrado (ou ambíguo)';
    END IF;
    v_new := replace(
      v_def,
      v_marker,
      'AND COALESCE(mr.sale_order_id, o.sale_order_id) IS DISTINCT FROM v_item.sale_order_id;'
    );
    EXECUTE v_new;
  END IF;

  -- 7e. DEFEITO 2: a injeção da 20270101030700 procurava
  --     'SELECT status INTO v_status' (inexistente) e só emitia WARNING.
  --     Alinha empenho/falta do PV antes de calcular a compra — só para PV
  --     aprovado/em produção (nunca cria commitment de rascunho/cancelado).
  v_def := pg_get_functiondef('public.process_sale_order_purchase_shortages(uuid)'::regprocedure);
  IF position('recompute_sale_order_material_commitments' IN v_def) = 0 THEN
    v_marker := E'  v_compute_version := v_order_version;\n';
    IF (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'process_sale_order_purchase_shortages: marker não encontrado (ou ambíguo)';
    END IF;
    v_new := replace(
      v_def,
      v_marker,
      v_marker
      || E'\n  -- Alinha empenho/falta do PV antes de calcular a compra\n'
      || E'  -- (spec integracao-estoque-pv-compras, defeito 2).\n'
      || E'  IF v_status IN (''Aprovado'', ''Em Produção'') THEN\n'
      || E'    BEGIN\n'
      || E'      PERFORM public.recompute_sale_order_material_commitments(p_sale_order_id);\n'
      || E'    EXCEPTION WHEN OTHERS THEN\n'
      || E'      RAISE WARNING ''recompute commitments falhou para %: %'', p_sale_order_id, SQLERRM;\n'
      || E'    END;\n'
      || E'  END IF;\n'
    );
    EXECUTE v_new;
  END IF;
END;
$inject$;

-- ---------------------------------------------------------------------------
-- 8. DEFEITO 1 (compra): own_res só via orders.order_id ignorava o
--    commitment do próprio PV (order_id NULL) → falta e compra infladas.
--    Corpo vivo de compute_materials_per_pv; muda só o own_res.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean, grade jsonb, color_mismatch boolean, conversion_warning text)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    SELECT soi.grade AS item_grade,
      coalesce(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade,soi.quantity),
          coalesce(soi.color,''),
          soi.material_variant_id
        ),so.packaging_mode),'[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id=so.id
    WHERE soi.sale_order_id=ANY(p_pv_ids)
      AND soi.production_excluded_at IS NULL
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade)='object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
         WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND g.value::numeric>0
      )
      AND (
        so.status NOT IN ('Faturado','Cancelado','Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id=soi.id
             AND o.status NOT IN ('Finalizado','Cancelada')
        )
      )
  ),
  -- O consumo por grade nao emite a parcela especializada de tira. Esta
  -- fronteira estrutural preserva cabedal/forracao/palmilha/solado/BOM sem
  -- classificar tira por nome, cor, grupo ou products.is_artisanal.
  exploded AS (
    SELECT
      (line->>'product_id')::uuid AS product_id,
      line->>'product_name' AS product_name,
      CASE WHEN line->>'matched_by'='group_generic' THEN ''
           ELSE coalesce(line->>'color','') END AS color,
      (line->>'required')::numeric AS required,
      line->>'unit' AS unit,
      line->>'component' AS component,
      line->>'matched_by' AS matched_by,
      line->>'conversion_warning' AS conversion_warning,
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE line->>'product_id' IS NOT NULL
  ),
  agg AS (
    SELECT e.product_id,e.color,max(e.product_name) AS product_name,
      coalesce(sum(e.required) FILTER (
        WHERE e.unit IS NULL AND e.conversion_warning IS NULL),0)
        /greatest(coalesce((
          SELECT conv.dm2_per_unit
            FROM public.get_material_conversion_info(e.product_id) conv
           LIMIT 1
        ),1),1)
      +coalesce(sum(e.required) FILTER (
        WHERE e.unit IS NOT NULL AND e.conversion_warning IS NULL),0) AS needed_qty,
      max(e.conversion_warning) AS conversion_warning
    FROM exploded e
    GROUP BY e.product_id,e.color
  ),
  own_res AS (
    -- O commitment do PV nasce com order_id NULL (pv_commitment): a posse vem
    -- de material_reservations.sale_order_id, não só do JOIN com orders.
    SELECT mr.product_id,
      sum(greatest(0,coalesce(mr.quantity_reserved,0)
        -coalesce(mr.quantity_consumed,0))) AS own_reserved
    FROM public.material_reservations mr
    LEFT JOIN public.orders o ON o.id=mr.order_id
    WHERE coalesce(mr.sale_order_id,o.sale_order_id)=ANY(p_pv_ids)
      AND mr.status IN ('reserved','partially_consumed')
      -- Reserva de tira acabada/base pertence ao netting 032 e nao pode ser
      -- devolvida ao estoque disponivel deste canal generico.
      AND mr.sale_order_strap_demand_id IS NULL
      AND mr.strap_stock_floor_contribution_id IS NULL
    GROUP BY mr.product_id
  ),
  mism AS (
    SELECT product_id,color,bool_or(matched_by='color_mismatch') AS color_mismatch
      FROM exploded GROUP BY product_id,color
  ),
  solado_grade AS (
    SELECT product_id,color,jsonb_object_agg(k,v) AS grade FROM (
      SELECT e.product_id,e.color,kv.key AS k,
        round(sum(kv.value::numeric*e.required/nullif(gs.total,0))) AS v
      FROM exploded e
      CROSS JOIN LATERAL (
        SELECT sum(x.value::numeric) AS total
          FROM jsonb_each_text(e.item_grade) x WHERE x.key ~ '^[0-9/]+$'
      ) gs,
      jsonb_each_text(e.item_grade) kv
      WHERE e.component='Solado' AND e.item_grade IS NOT NULL
        AND kv.key ~ '^[0-9/]+$' AND coalesce(gs.total,0)>0
      GROUP BY e.product_id,e.color,kv.key
    ) g WHERE v>0 GROUP BY product_id,color
  )
  SELECT
    a.product_id AS material_id,
    coalesce(p.name,a.product_id::text) AS product_name,
    coalesce(p.unit,'un') AS unit,
    a.color,
    a.needed_qty,
    greatest(0,p.quantity-coalesce(p.reserved_stock,0)
      +coalesce(orr.own_reserved,0)) AS stock_qty,
    greatest(0,a.needed_qty-greatest(0,p.quantity
      -coalesce(p.reserved_stock,0)+coalesce(orr.own_reserved,0))) AS shortage,
    p.supplier_id,
    sup.name AS supplier_name,
    coalesce(p.unit_price,0) AS last_unit_price,
    coalesce(p.is_artisanal,false) AS is_artisanal,
    sg.grade,
    coalesce(m.color_mismatch,false) AS color_mismatch,
    a.conversion_warning
  FROM agg a
  LEFT JOIN public.products p ON p.id=a.product_id
  LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id
  LEFT JOIN own_res orr ON orr.product_id=a.product_id
  LEFT JOIN solado_grade sg ON sg.product_id=a.product_id AND sg.color=a.color
  LEFT JOIN mism m ON m.product_id=a.product_id AND m.color=a.color
  WHERE a.needed_qty>0 OR a.conversion_warning IS NOT NULL
  ORDER BY sup.name NULLS LAST,coalesce(p.name,a.product_id::text);
$function$;

-- ---------------------------------------------------------------------------
-- 9. Backfill (Q19): todos os PVs/OPs em aberto. Linhas abertas passam a
--    empenhar só o que cabe no físico, pela prioridade; o excesso vira falta.
--    Finalizados/cancelados não têm linha aberta e não são tocados.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  r record;
BEGIN
  PERFORM set_config('app.internal_stock_sync', '1', true);
  FOR r IN
    SELECT DISTINCT mr.product_id
      FROM public.material_reservations mr
     WHERE public.material_reservation_is_pv_managed(mr)
     ORDER BY mr.product_id
  LOOP
    PERFORM public.reallocate_product_commitments(r.product_id, NULL);
  END LOOP;
END;
$backfill$;
