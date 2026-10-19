-- Ateliê kit = COMPONENTES por GRUPO; corte debita só Cabedal; liberação debita kit.
-- Decisões grill 18–19/10/2026: Q8-a, Q11-a, Q12-a, Q13-a, Q16–18-a, Q22-c, Q25-a.

-- ─── 1. Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE public.atelier_complex_references
  ADD COLUMN IF NOT EXISTS kit_group_ids uuid[];

COMMENT ON COLUMN public.atelier_complex_references.kit_group_ids IS
  'Grupos de COMPONENTES (direct_components) que vão no kit deste setor. Cor resolve no PV.';

ALTER TABLE public.atelier_lots
  ADD COLUMN IF NOT EXISTS kit_gate text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atelier_lots_kit_gate_check'
      AND conrelid = 'public.atelier_lots'::regclass
  ) THEN
    ALTER TABLE public.atelier_lots
      ADD CONSTRAINT atelier_lots_kit_gate_check
      CHECK (kit_gate IS NULL OR kit_gate IN ('awaiting_components', 'ready_to_send'));
  END IF;
END $$;

COMMENT ON COLUMN public.atelier_lots.kit_gate IS
  'Após corte: awaiting_components | ready_to_send. NULL = lote ainda open.';

ALTER TABLE public.technical_sheet_component_colors
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.product_groups(id);

-- ─── 2. Costura ativa ⇒ Corte ativo ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_atelier_costura_forces_corte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sector = 'costura_cabedal' AND NEW.active IS TRUE THEN
    INSERT INTO public.atelier_complex_references (reference_id, sector, active)
    VALUES (NEW.reference_id, 'corte_cabedal', true)
    ON CONFLICT (reference_id, sector) DO UPDATE
      SET active = true, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atelier_costura_forces_corte ON public.atelier_complex_references;
CREATE TRIGGER trg_atelier_costura_forces_corte
  AFTER INSERT OR UPDATE OF active, sector
  ON public.atelier_complex_references
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_atelier_costura_forces_corte();

-- ─── 3. Candidatos do kit = grupos em direct_components ──────────────────────
DROP FUNCTION IF EXISTS public.atelier_sheet_kit_candidates(uuid, text);

CREATE OR REPLACE FUNCTION public.atelier_sheet_kit_candidates(
  p_reference_id uuid,
  p_sector text
)
RETURNS TABLE (
  group_id uuid,
  group_name text,
  product_id uuid,
  product_name text,
  unit text,
  component text,
  quantity_per_unit numeric,
  sector text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Decisão: kit lista COMPONENTES da ficha (grupo). p_sector só valida setor de rua.
  WITH sheet AS (
    SELECT direct_components
      FROM public.technical_sheets
     WHERE id = p_reference_id
  ),
  elems AS (
    SELECT elem, ordinality
      FROM sheet,
           LATERAL jsonb_array_elements(COALESCE(direct_components, '[]'::jsonb))
             WITH ORDINALITY AS t(elem, ordinality)
     WHERE p_sector IN ('corte_cabedal', 'costura_cabedal', 'aviamento')
  ),
  resolved AS (
    SELECT
      COALESCE(
        NULLIF(elem->>'group_id', '')::uuid,
        p.group_id
      ) AS gid,
      COALESCE(
        NULLIF(btrim(elem->>'group_name'), ''),
        pg.name,
        NULLIF(btrim(elem->>'product_name'), ''),
        p.name
      ) AS gname,
      NULLIF(elem->>'product_id', '')::uuid AS pid,
      COALESCE(NULLIF(btrim(elem->>'product_name'), ''), p.name) AS pname,
      COALESCE(NULLIF(btrim(elem->>'unit'), ''), p.unit, 'un') AS unit,
      COALESCE(NULLIF(btrim(elem->>'consumption_sector'), ''), 'Aviamento') AS sector,
      NULLIF(elem->>'quantity', '')::numeric AS qpu,
      ordinality
    FROM elems
    LEFT JOIN public.products p ON p.id = NULLIF(elem->>'product_id', '')::uuid
    LEFT JOIN public.product_groups pg ON pg.id = COALESCE(
      NULLIF(elem->>'group_id', '')::uuid,
      p.group_id
    )
  )
  SELECT DISTINCT ON (r.gid)
         r.gid,
         r.gname,
         r.pid,
         r.pname,
         r.unit,
         'Componente Direto'::text AS component,
         r.qpu,
         r.sector
    FROM resolved r
   WHERE r.gid IS NOT NULL
   ORDER BY r.gid, r.ordinality;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sheet_kit_candidates(uuid, text) TO authenticated, service_role;

-- ─── 4. Filtro do kit: grupos marcados (liberação) / Cabedal (corte) ─────────
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_group_ids(p_reference_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT gid), ARRAY[]::uuid[])
    FROM public.atelier_complex_references a
    CROSS JOIN LATERAL unnest(COALESCE(a.kit_group_ids, ARRAY[]::uuid[])) gid
   WHERE a.reference_id = p_reference_id
     AND a.active
     AND a.sector = ANY (public.atelier_reference_street_sectors(p_reference_id));
$$;

GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_group_ids(uuid) TO authenticated, service_role;

-- Mantém assinatura antiga: product_id filter legado OU labels.
-- Corte usa só Cabedal (função dedicada abaixo).
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_filter_products(p_reference_id uuid)
RETURNS TABLE (product_id uuid, component text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Liberação: grupos marcados → qualquer product_id do grupo + Tiras se Aviamento.
  WITH groups AS (
    SELECT unnest(public.atelier_lot_kit_group_ids(p_reference_id)) AS group_id
  ),
  by_group AS (
    SELECT p.id AS product_id, 'Componente Direto'::text AS component
      FROM public.products p
      JOIN groups g ON g.group_id = p.group_id
  ),
  legacy AS (
    SELECT DISTINCT unnest(kit_product_ids) AS product_id, sector::text AS component
      FROM public.atelier_complex_references a
     WHERE a.reference_id = p_reference_id
       AND a.active
       AND a.sector = ANY (public.atelier_reference_street_sectors(p_reference_id))
       AND kit_product_ids IS NOT NULL AND cardinality(kit_product_ids) > 0
       AND (kit_group_ids IS NULL OR cardinality(kit_group_ids) = 0)
  ),
  has_any AS (
    SELECT EXISTS (SELECT 1 FROM by_group) OR EXISTS (SELECT 1 FROM legacy) AS yes
  ),
  labels AS (
    SELECT a.sector,
           COALESCE(a.material_components, public.atelier_default_kit_components(a.sector)) AS comps
      FROM public.atelier_complex_references a
     WHERE a.reference_id = p_reference_id
       AND a.active
       AND a.sector = ANY (public.atelier_reference_street_sectors(p_reference_id))
  )
  SELECT product_id, component FROM by_group
  UNION
  SELECT product_id, component FROM legacy
  UNION ALL
  SELECT NULL::uuid, c
    FROM labels r
    CROSS JOIN LATERAL unnest(r.comps) c
    CROSS JOIN has_any
   WHERE NOT has_any.yes;
$$;

-- ─── 6. Kit gate + liberação ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_lot_release_lines(p_lot_id uuid)
RETURNS TABLE (
  sale_order_id uuid,
  sale_order_item_id uuid,
  product_id uuid,
  product_name text,
  unit text,
  component text,
  required numeric,
  available numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lot AS (SELECT * FROM public.atelier_lots WHERE id = p_lot_id),
  gids AS (
    SELECT unnest(public.atelier_lot_kit_group_ids((SELECT reference_id FROM lot))) AS group_id
  ),
  has_aviamento AS (
    SELECT EXISTS (
      SELECT 1 FROM public.atelier_complex_references a
       WHERE a.reference_id = (SELECT reference_id FROM lot)
         AND a.active AND a.sector = 'aviamento'
    ) AS yes
  ),
  dems AS (
    SELECT DISTINCT d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id AND d.status <> 'cancelled'
  )
  SELECT dems.sale_order_id, dems.sale_order_item_id, l.product_id, p.name, p.unit,
         min(l.component)::text, sum(l.required)::numeric,
         GREATEST(COALESCE(p.quantity, 0), 0)
    FROM dems
    CROSS JOIN LATERAL public.sale_order_material_demand_lines(dems.sale_order_id) l
    JOIN public.products p ON p.id = l.product_id
    CROSS JOIN has_aviamento
   WHERE l.sale_order_item_id = dems.sale_order_item_id
     AND (
       (EXISTS (SELECT 1 FROM gids) AND p.group_id IN (SELECT group_id FROM gids)
         AND l.component IN ('Componente Direto', 'BOM'))
       OR (has_aviamento.yes AND l.component = 'Tiras')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.cabedal_prep_stock_debits s
        WHERE s.sale_order_item_id = dems.sale_order_item_id
          AND s.product_id = l.product_id
          AND s.lot_id = p_lot_id
          AND COALESCE(s.sector, '') = 'liberacao_atelier'
     )
   GROUP BY dems.sale_order_id, dems.sale_order_item_id, l.product_id, p.name, p.unit, p.quantity
   ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_lot_release_lines(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_refresh_lot_kit_gate(p_lot_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_short boolean;
  v_gate text;
BEGIN
  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_lot.status <> 'cut' THEN
    UPDATE public.atelier_lots SET kit_gate = NULL, updated_at = now() WHERE id = p_lot_id;
    RETURN NULL;
  END IF;

  -- Sem linhas de liberação pendentes ⇒ pronto.
  SELECT EXISTS (
    SELECT 1 FROM public.atelier_lot_release_lines(p_lot_id) r
     WHERE r.available < r.required - 1e-9
  ) INTO v_short;

  IF NOT EXISTS (SELECT 1 FROM public.atelier_lot_release_lines(p_lot_id)) THEN
    v_gate := 'ready_to_send';
  ELSIF v_short THEN
    v_gate := 'awaiting_components';
  ELSE
    v_gate := 'ready_to_send';
  END IF;

  UPDATE public.atelier_lots
     SET kit_gate = v_gate, updated_at = now()
   WHERE id = p_lot_id;

  RETURN v_gate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_refresh_lot_kit_gate(uuid) TO authenticated, service_role;

-- ─── 5. Corte: só Cabedal (napa) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_cut(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_dem record;
  v_line record;
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_items int := 0;
  v_lines int := 0;
  v_pending int := 0;
  v_gate text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status = 'cut' THEN
    PERFORM public.atelier_refresh_lot_kit_gate(p_lot_id);
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', 'cut',
      'kit_gate', (SELECT kit_gate FROM public.atelier_lots WHERE id = p_lot_id));
  END IF;
  IF v_lot.status <> 'open' THEN
    RAISE EXCEPTION 'Lote % está %', v_lot.lot_number, v_lot.status USING ERRCODE = '22023';
  END IF;

  FOR v_dem IN
    SELECT d.id, d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id
       AND d.status <> 'cancelled'
       AND EXISTS (
         SELECT 1 FROM public.cabedal_prep_jobs j
          WHERE j.demand_id = d.id AND j.pipeline_status = 'awaiting_cut'
       )
     ORDER BY d.created_at
  LOOP
    v_items := v_items + 1;

    -- Só Cabedal (napa). COMPONENTES / Tiras na liberação.
    FOR v_line IN
      SELECT l.product_id, min(l.component) AS component, sum(l.required)::numeric AS required
        FROM public.sale_order_material_demand_lines(v_dem.sale_order_id) l
       WHERE l.sale_order_item_id = v_dem.sale_order_item_id
         AND l.component = 'Cabedal'
       GROUP BY l.product_id
       ORDER BY l.product_id
    LOOP
      IF COALESCE(v_line.required, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.cabedal_prep_stock_debits s
         WHERE s.sale_order_item_id = v_dem.sale_order_item_id
           AND s.product_id = v_line.product_id
           AND s.lot_id IS NOT NULL
           AND COALESCE(s.sector, '') = 'corte_atelier'
      ) THEN
        CONTINUE;
      END IF;

      SELECT quantity INTO v_prev FROM public.products WHERE id = v_line.product_id FOR UPDATE;
      v_debit := LEAST(GREATEST(COALESCE(v_prev, 0), 0), v_line.required);
      v_mov := NULL;

      IF v_debit > 0 THEN
        UPDATE public.products
           SET quantity = quantity - v_debit, updated_at = now()
         WHERE id = v_line.product_id;

        INSERT INTO public.stock_movements (
          product_id, order_id, movement_type, quantity,
          previous_stock, new_stock, description, movement_reason
        ) VALUES (
          v_line.product_id, NULL, 'out', v_debit,
          v_prev, v_prev - v_debit,
          'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component,
          'consumo_op'
        )
        RETURNING id INTO v_mov;

        SELECT mr.id INTO v_res_id
          FROM public.material_reservations mr
         WHERE mr.sale_order_id = v_dem.sale_order_id
           AND mr.product_id = v_line.product_id
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
           AND mr.strap_variant_id IS NULL
           AND mr.sale_order_strap_demand_id IS NULL
         ORDER BY mr.created_at
         LIMIT 1
         FOR UPDATE;

        IF v_res_id IS NOT NULL THEN
          UPDATE public.material_reservations
             SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debit,
                 quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit),
                 status = CASE
                   WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit)
                        <= COALESCE(quantity_consumed, 0) + v_debit
                     THEN 'consumed'
                   ELSE 'partially_consumed'
                 END,
                 consumed_at = now(),
                 metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object('atelier_consumed', true),
                 updated_at = now()
           WHERE id = v_res_id;
        END IF;
      ELSE
        v_res_id := NULL;
      END IF;

      INSERT INTO public.cabedal_prep_stock_debits (
        sale_order_id, sale_order_item_id, product_id, quantity,
        required_qty, pending_qty, component,
        stock_movement_id, sector, lot_id, reservation_id
      ) VALUES (
        v_dem.sale_order_id, v_dem.sale_order_item_id, v_line.product_id, v_debit,
        v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
        v_mov, 'corte_atelier', p_lot_id, v_res_id
      );

      v_lines := v_lines + 1;
      IF v_line.required - v_debit > 0 THEN
        v_pending := v_pending + 1;
      END IF;
    END LOOP;

    UPDATE public.cabedal_prep_jobs
       SET pipeline_status = 'cut', cut_at = now(), updated_at = now()
     WHERE demand_id = v_dem.id AND pipeline_status = 'awaiting_cut';
  END LOOP;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Lote % não tem itens aguardando corte', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  UPDATE public.atelier_lots
     SET status = 'cut', cut_at = now(), cut_by = auth.uid(), updated_at = now()
   WHERE id = p_lot_id;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'items', v_items, 'lines', v_lines, 'pending_lines', v_pending,
    'kit_gate', v_gate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_cut(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_release(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_line record;
  v_prev numeric;
  v_debit numeric;
  v_mov uuid;
  v_res_id uuid;
  v_lines int := 0;
  v_pending int := 0;
  v_gate text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status <> 'cut' THEN
    RAISE EXCEPTION 'Lote % precisa estar cortado', v_lot.lot_number USING ERRCODE = '22023';
  END IF;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);
  IF v_gate = 'awaiting_components' THEN
    RAISE EXCEPTION 'Ainda falta estoque de componentes/tiras no lote %', v_lot.lot_number
      USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT * FROM public.atelier_lot_release_lines(p_lot_id)
  LOOP
    SELECT quantity INTO v_prev FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    v_debit := LEAST(GREATEST(COALESCE(v_prev, 0), 0), v_line.required);
    v_mov := NULL;

    IF v_debit > 0 THEN
      UPDATE public.products
         SET quantity = quantity - v_debit, updated_at = now()
       WHERE id = v_line.product_id;

      INSERT INTO public.stock_movements (
        product_id, order_id, movement_type, quantity,
        previous_stock, new_stock, description, movement_reason
      ) VALUES (
        v_line.product_id, NULL, 'out', v_debit,
        v_prev, v_prev - v_debit,
        'Ateliê · liberação ' || v_lot.lot_number || ' · ' || v_line.component,
        'consumo_op'
      )
      RETURNING id INTO v_mov;

      SELECT mr.id INTO v_res_id
        FROM public.material_reservations mr
       WHERE mr.sale_order_id = v_line.sale_order_id
         AND mr.product_id = v_line.product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
       ORDER BY mr.created_at
       LIMIT 1
       FOR UPDATE;

      IF v_res_id IS NOT NULL THEN
        UPDATE public.material_reservations
           SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_debit,
               quantity_reserved = GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit),
               status = CASE
                 WHEN GREATEST(quantity_reserved, COALESCE(quantity_consumed, 0) + v_debit)
                      <= COALESCE(quantity_consumed, 0) + v_debit
                   THEN 'consumed'
                 ELSE 'partially_consumed'
               END,
               consumed_at = now(),
               metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('atelier_consumed', true),
               updated_at = now()
         WHERE id = v_res_id;
      END IF;
    ELSE
      v_res_id := NULL;
    END IF;

    INSERT INTO public.cabedal_prep_stock_debits (
      sale_order_id, sale_order_item_id, product_id, quantity,
      required_qty, pending_qty, component,
      stock_movement_id, sector, lot_id, reservation_id
    ) VALUES (
      v_line.sale_order_id, v_line.sale_order_item_id, v_line.product_id, v_debit,
      v_line.required, GREATEST(v_line.required - v_debit, 0), v_line.component,
      v_mov, 'liberacao_atelier', p_lot_id, v_res_id
    );

    v_lines := v_lines + 1;
    IF v_line.required - v_debit > 0 THEN
      v_pending := v_pending + 1;
    END IF;
  END LOOP;

  v_gate := public.atelier_refresh_lot_kit_gate(p_lot_id);

  RETURN jsonb_build_object(
    'ok', true, 'lot_number', v_lot.lot_number,
    'lines', v_lines, 'pending_lines', v_pending, 'kit_gate', v_gate
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_confirm_lot_release(uuid) TO authenticated, service_role;

-- Prévia do corte = só Cabedal
CREATE OR REPLACE FUNCTION public.atelier_lot_kit_preview(p_lot_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  component text,
  required numeric,
  available numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lot AS (SELECT * FROM public.atelier_lots WHERE id = p_lot_id),
  dems AS (
    SELECT DISTINCT d.sale_order_id, d.sale_order_item_id
      FROM public.cabedal_prep_demands d
     WHERE d.lot_id = p_lot_id AND d.status <> 'cancelled'
  )
  SELECT l.product_id, p.name, p.unit, min(l.component), sum(l.required)::numeric,
         GREATEST(COALESCE(p.quantity, 0), 0)
    FROM dems
    CROSS JOIN LATERAL public.sale_order_material_demand_lines(dems.sale_order_id) l
    JOIN public.products p ON p.id = l.product_id
   WHERE l.sale_order_item_id = dems.sale_order_item_id
     AND l.component = 'Cabedal'
   GROUP BY l.product_id, p.name, p.unit, p.quantity
   ORDER BY p.name;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_preview(uuid) TO authenticated, service_role;

-- Envio: exige kit_gate ready; debita liberação se pendente
CREATE OR REPLACE FUNCTION public.atelier_mark_job_sent(
  p_job_id uuid,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_num text;
  v_kit jsonb := '[]'::jsonb;
  v_gate text;
  v_lot_number text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Este job é interno — use Em realização / Concluído' USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status NOT IN ('cut', 'sent_to_contractor') THEN
    RAISE EXCEPTION 'Corte o lote antes do envio (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_contractor_id, v_job.contractor_id) IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
  END IF;

  IF v_job.lot_id IS NOT NULL THEN
    SELECT lot_number INTO v_lot_number FROM public.atelier_lots WHERE id = v_job.lot_id;
    v_gate := public.atelier_refresh_lot_kit_gate(v_job.lot_id);
    IF v_gate = 'awaiting_components' THEN
      RAISE EXCEPTION 'Lote % aguarda componentes/tiras em estoque', COALESCE(v_lot_number, '')
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.atelier_lot_release_lines(v_job.lot_id)) THEN
      PERFORM public.atelier_confirm_lot_release(v_job.lot_id);
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'product_id', d.product_id,
             'product_name', p.name,
             'unit', p.unit,
             'component', d.component,
             'quantity', d.quantity,
             'required_qty', d.required_qty,
             'pending_qty', d.pending_qty
           )
           ORDER BY p.name
         ), '[]'::jsonb)
    INTO v_kit
    FROM public.cabedal_prep_stock_debits d
    JOIN public.products p ON p.id = d.product_id
   WHERE d.lot_id = v_job.lot_id
     AND COALESCE(d.quantity, 0) > 0;

  v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'sent_to_contractor',
         execution_mode = 'contractor',
         sent_at = COALESCE(sent_at, now()),
         contractor_id = COALESCE(p_contractor_id, contractor_id),
         atelier_service_number = v_num,
         sent_kit_lines = v_kit,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'atelier_service_number', v_num,
    'kit_lines', v_kit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_sent(uuid, uuid) TO authenticated, service_role;

-- list_atelier_lots: expor kit_gate (patch na função viva)
DO $fix$
DECLARE
  v_def text;
  v_old text := $o$'status', l.status, 'reference_id', l.reference_id,$o$;
  v_new text := $n$'status', l.status, 'kit_gate', l.kit_gate, 'reference_id', l.reference_id,$n$;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'kit_gate') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'list_atelier_lots: âncora de status não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix$;

-- Wrapper: refresh gates ao listar (SQL puro não chama PERFORM)
CREATE OR REPLACE FUNCTION public.list_atelier_lots_with_gate_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.atelier_lots WHERE status = 'cut' LOOP
    PERFORM public.atelier_refresh_lot_kit_gate(r.id);
  END LOOP;
  RETURN public.list_atelier_lots();
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_atelier_lots_with_gate_refresh() TO authenticated, service_role;

-- Backfill: lotes já cut → ready_to_send (histórico)
UPDATE public.atelier_lots
   SET kit_gate = 'ready_to_send', updated_at = now()
 WHERE status = 'cut' AND kit_gate IS NULL;
