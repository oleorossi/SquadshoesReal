-- Colmeia por Σgrade (pares/ficha): match exato no catálogo ativo.
-- Decisão do dono 24/09/2026: grade 15 → COLMEIA 11 (15) mesmo com pin do
-- solado em CAIXA COLMEIA 11 (12). Preferir pin se ele estiver entre os
-- matches; senão primeira ativa por nome. Sem match → pin do solado.
-- Espelho TS: src/lib/resolveColmeiaByGrade.ts

CREATE OR REPLACE FUNCTION public.resolve_colmeia_by_grade(
  p_grade_pairs integer,
  p_sole_box_id uuid,
  p_sole_ppb integer
)
RETURNS TABLE(box_type_id uuid, pairs_per_box integer, source text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_match record;
  v_pin_pairs integer;
BEGIN
  IF COALESCE(p_grade_pairs, 0) > 0 THEN
    -- Preferir o pin do solado quando ele também casa a capacidade.
    IF p_sole_box_id IS NOT NULL THEN
      SELECT bt.id, bt.nome, bt.pairs_per_box_default
        INTO v_match
        FROM public.box_types bt
       WHERE bt.id = p_sole_box_id
         AND bt.active = true
         AND bt.tipo::text = 'colmeia'
         AND NULLIF(bt.pairs_per_box_default, 0) = p_grade_pairs;
      IF FOUND THEN
        box_type_id := v_match.id;
        pairs_per_box := GREATEST(v_match.pairs_per_box_default, 1);
        source := 'grade_catalog';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;

    SELECT bt.id, bt.nome, bt.pairs_per_box_default
      INTO v_match
      FROM public.box_types bt
     WHERE bt.active = true
       AND bt.tipo::text = 'colmeia'
       AND NULLIF(bt.pairs_per_box_default, 0) = p_grade_pairs
     ORDER BY bt.nome ASC NULLS LAST
     LIMIT 1;
    IF FOUND THEN
      box_type_id := v_match.id;
      pairs_per_box := GREATEST(v_match.pairs_per_box_default, 1);
      source := 'grade_catalog';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  v_pin_pairs := COALESCE(NULLIF(p_sole_ppb, 0), 0);
  IF p_sole_box_id IS NOT NULL OR v_pin_pairs > 0 THEN
    IF v_pin_pairs <= 0 AND p_sole_box_id IS NOT NULL THEN
      SELECT NULLIF(bt.pairs_per_box_default, 0)
        INTO v_pin_pairs
        FROM public.box_types bt
       WHERE bt.id = p_sole_box_id AND bt.active = true;
    END IF;
    box_type_id := p_sole_box_id;
    pairs_per_box := GREATEST(COALESCE(NULLIF(v_pin_pairs, 0), 12), 1);
    source := 'sole_pin';
    RETURN NEXT;
    RETURN;
  END IF;

  box_type_id := NULL;
  pairs_per_box := 12;
  source := 'fallback';
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.resolve_colmeia_by_grade(integer, uuid, integer) IS
  'Escolhe colmeia por Σgrade (= pairs_per_box_default no catálogo). Prefer pin se match; senão 1ª por nome. Sem match → pin do solado.';

REVOKE ALL ON FUNCTION public.resolve_colmeia_by_grade(integer, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_colmeia_by_grade(integer, uuid, integer)
  TO authenticated, service_role;

-- ── NF / volumes ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_sale_order_box_breakdown(p_sale_order_id uuid)
RETURNS TABLE(
  box_type_id uuid, box_name text, tipo text, total_pairs integer,
  pairs_per_box integer, boxes integer, empty_weight_kg numeric,
  legacy_box_weight_kg numeric, unconfigured boolean, pairs_per_box_source text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text; v_target_type text; v_pair_as_volume boolean;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;
  v_pair_as_volume := COALESCE(v_mode, '') IN ('individual_fitilho', 'individual_amarrado');
  v_target_type := CASE WHEN v_mode = 'colmeia' THEN 'colmeia'
                        WHEN v_mode = 'individual_master' THEN 'master'
                        ELSE 'individual' END;
  RETURN QUERY
  WITH items AS (
    SELECT soi.id AS item_id, soi.reference_id, soi.quantity::integer AS qty,
           soi.grade, COALESCE(soi.fichas, 0) AS fichas, ts.box_weight_kg, ts.sole_group_id,
           CASE
             WHEN soi.grade IS NOT NULL AND jsonb_typeof(soi.grade) = 'object' THEN
               (SELECT COALESCE(sum((e.value)::numeric), 0)::integer
                  FROM jsonb_each_text(soi.grade) e
                 WHERE e.value ~ '^[0-9]+(\.[0-9]+)?$'
                   AND (e.value)::numeric > 0)
             ELSE 0
           END AS grade_sum
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = p_sale_order_id AND COALESCE(soi.quantity, 0) > 0
  ),
  resolved AS (
    SELECT i.item_id, i.reference_id, i.qty, i.grade, i.fichas, i.box_weight_kg, i.grade_sum,
           CASE
             WHEN v_target_type = 'colmeia' THEN col.box_type_id
             ELSE bt.id
           END AS box_id,
           CASE
             WHEN v_target_type = 'colmeia' THEN bt_eff.nome
             ELSE bt.nome
           END AS box_name,
           CASE
             WHEN v_target_type = 'colmeia' THEN bt_eff.tipo::text
             ELSE bt.tipo::text
           END AS bt_tipo,
           CASE
             WHEN v_target_type = 'colmeia' THEN NULLIF(bt_eff.pairs_per_box_default, 0)
             ELSE NULLIF(bt.pairs_per_box_default, 0)
           END AS ppb_cadastrado,
           NULLIF(CASE v_target_type
             WHEN 'individual' THEN pg.pairs_per_box_individual
             WHEN 'master'     THEN pg.pairs_per_box_master
             WHEN 'colmeia'    THEN pg.pairs_per_box_colmeia END, 0) AS ppb_solado,
           CASE
             WHEN v_target_type = 'colmeia' THEN bt_eff.empty_weight_kg
             ELSE bt.empty_weight_kg
           END AS empty_weight_kg,
           CASE
             WHEN v_target_type = 'colmeia' THEN col.pairs_per_box
             ELSE NULL
           END AS ppb_grade,
           CASE
             WHEN v_target_type = 'colmeia' THEN col.source
             ELSE NULL
           END AS grade_source
      FROM items i
      LEFT JOIN public.product_groups pg ON pg.id = i.sole_group_id
      LEFT JOIN LATERAL public.resolve_colmeia_by_grade(
        i.grade_sum, pg.box_type_colmeia_id, pg.pairs_per_box_colmeia
      ) col ON v_target_type = 'colmeia'
      LEFT JOIN public.box_types bt ON bt.id = CASE v_target_type
                  WHEN 'individual' THEN pg.box_type_id
                  WHEN 'master'     THEN pg.box_type_master_id
                  WHEN 'colmeia'    THEN pg.box_type_colmeia_id END
            AND bt.active = true
      LEFT JOIN public.box_types bt_eff ON bt_eff.id = CASE
                  WHEN v_target_type = 'colmeia' THEN col.box_type_id
                  ELSE NULL END
            AND bt_eff.active = true
  ),
  per_item AS (
    SELECT r.*,
           CASE WHEN v_pair_as_volume THEN 1
                WHEN v_target_type = 'colmeia' THEN COALESCE(r.ppb_grade, r.ppb_solado, r.ppb_cadastrado, 12)
                ELSE COALESCE(r.ppb_solado, r.ppb_cadastrado, 12)
           END AS ppb_efetivo
      FROM resolved r
  ),
  per_item_boxes AS (
    SELECT p.*,
           CASE
             WHEN v_pair_as_volume    THEN p.qty
             WHEN p.ppb_efetivo <= 1  THEN p.qty
             ELSE COALESCE(
               NULLIF((SELECT count(*) FROM public.packing_boxes_for_grade(
                         p.grade, p.fichas, p.ppb_efetivo)), 0)::numeric,
               CEIL(p.qty::numeric / GREATEST(p.ppb_efetivo, 1)))::integer
           END AS ref_boxes
      FROM per_item p
  )
  SELECT b.box_id, MAX(b.box_name), COALESCE(MAX(b.bt_tipo), v_target_type),
         SUM(b.qty)::integer, MAX(b.ppb_efetivo)::integer, SUM(b.ref_boxes)::integer,
         MAX(b.empty_weight_kg), COALESCE(SUM(b.qty * b.box_weight_kg), 0)::numeric,
         bool_or(b.box_id IS NULL AND NOT v_pair_as_volume),
         CASE WHEN v_pair_as_volume THEN 'pair_as_volume'
              WHEN MAX(b.grade_source) = 'grade_catalog' THEN 'grade_catalog'
              WHEN MAX(b.ppb_solado) IS NOT NULL THEN 'sole_group'
              WHEN MAX(b.ppb_cadastrado) IS NOT NULL THEN 'box_type'
              ELSE 'fallback_default' END
    FROM per_item_boxes b
   GROUP BY b.box_id;
END
$function$;

-- ── Packing físico (etiquetas/volumes) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_sale_order_packing(p_sale_order_id uuid)
RETURNS TABLE(
  volume_number integer, sale_order_item_id uuid, reference_id uuid,
  item_color text, box_type_id uuid, box_name text, kind text, single_size text,
  pairs integer, capacity integer, is_partial boolean, weight_kg numeric, contents jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text; v_target_type text; v_seq integer := 0; it record; bx record;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;
  v_target_type := CASE WHEN v_mode = 'colmeia' THEN 'colmeia'
                        WHEN v_mode = 'individual_master' THEN 'master'
                        ELSE 'individual' END;
  FOR it IN
    SELECT soi.id AS item_id, soi.reference_id AS ref_id, soi.color AS col,
           soi.grade AS grd, COALESCE(soi.fichas, 0) AS fic,
           COALESCE(ts.weight_per_pair_kg, 0.238) AS pair_kg,
           CASE
             WHEN soi.grade IS NOT NULL AND jsonb_typeof(soi.grade) = 'object' THEN
               (SELECT COALESCE(sum((e.value)::numeric), 0)::integer
                  FROM jsonb_each_text(soi.grade) e
                 WHERE e.value ~ '^[0-9]+(\.[0-9]+)?$'
                   AND (e.value)::numeric > 0)
             ELSE 0
           END AS grade_sum,
           pg.box_type_id AS pin_individual,
           pg.box_type_master_id AS pin_master,
           pg.box_type_colmeia_id AS pin_colmeia,
           pg.pairs_per_box_individual,
           pg.pairs_per_box_master,
           pg.pairs_per_box_colmeia
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      LEFT JOIN public.product_groups   pg ON pg.id = ts.sole_group_id
     WHERE soi.sale_order_id = p_sale_order_id AND COALESCE(soi.quantity, 0) > 0
     ORDER BY soi.created_at NULLS LAST, soi.id
  LOOP
    DECLARE
      v_box_id uuid;
      v_box_nm text;
      v_tare numeric;
      v_cap integer;
      v_col record;
    BEGIN
      IF v_target_type = 'colmeia' THEN
        SELECT * INTO v_col
          FROM public.resolve_colmeia_by_grade(
            it.grade_sum, it.pin_colmeia, it.pairs_per_box_colmeia
          );
        v_box_id := v_col.box_type_id;
        v_cap := v_col.pairs_per_box;
      ELSE
        v_box_id := CASE v_target_type
          WHEN 'master' THEN it.pin_master
          ELSE it.pin_individual END;
        v_cap := COALESCE(NULLIF(CASE v_target_type
          WHEN 'master' THEN it.pairs_per_box_master
          ELSE it.pairs_per_box_individual END, 0), 12);
      END IF;

      SELECT bt.nome, COALESCE(bt.empty_weight_kg, 0)
        INTO v_box_nm, v_tare
        FROM public.box_types bt
       WHERE bt.id = v_box_id AND bt.active = true;

      IF v_target_type <> 'colmeia' THEN
        SELECT COALESCE(NULLIF(bt.pairs_per_box_default, 0), v_cap)
          INTO v_cap
          FROM public.box_types bt
         WHERE bt.id = v_box_id AND bt.active = true;
        v_cap := COALESCE(
          NULLIF(CASE v_target_type
            WHEN 'master' THEN it.pairs_per_box_master
            ELSE it.pairs_per_box_individual END, 0),
          v_cap, 12);
      END IF;

      FOR bx IN SELECT * FROM public.packing_boxes_for_grade(it.grd, it.fic, v_cap) LOOP
        v_seq := v_seq + 1;
        volume_number := v_seq; sale_order_item_id := it.item_id; reference_id := it.ref_id;
        item_color := it.col; box_type_id := v_box_id; box_name := v_box_nm;
        kind := bx.kind; single_size := bx.single_size; pairs := bx.pairs; capacity := v_cap;
        is_partial := bx.pairs < v_cap;
        weight_kg := ROUND(bx.pairs * it.pair_kg + COALESCE(v_tare, 0), 3);
        contents := bx.contents;
        RETURN NEXT;
      END LOOP;
    END;
  END LOOP;
END
$function$;

-- ── Débito / consumo de embalagem ─────────────────────────────────────────
-- Só o ramo colmeia muda: troca UUID + capacidade via resolve_colmeia_by_grade.
CREATE OR REPLACE FUNCTION public.calculate_packaging_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_packaging_mode text,
  p_grade jsonb DEFAULT NULL::jsonb
)
RETURNS TABLE(
  box_type_id uuid, packaging_type text, box_name text, unit text,
  required numeric, available numeric, stock_ok boolean,
  unit_price numeric, supplier_id uuid, warning text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_types text[];
  v_type text;
  v_pg record;
  v_box_default integer;
  v_box_kind text;
  v_meters numeric;
  v_pairs integer;
  v_grade_total numeric;
  v_sheets integer;
  v_packed integer;
  v_col record;
BEGIN
  IF COALESCE(p_order_quantity, 0) <= 0 THEN
    RETURN;
  END IF;

  IF p_packaging_mode IS NULL OR p_packaging_mode NOT IN (
    'colmeia', 'individual', 'individual_master',
    'individual_fitilho', 'individual_amarrado'
  ) THEN
    packaging_type := 'unresolved';
    warning := 'Modo de embalagem ausente ou inválido; nenhuma caixa foi escolhida.';
    required := 0;
    available := 0;
    stock_ok := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_types := CASE
    WHEN p_packaging_mode = 'colmeia' THEN ARRAY['colmeia']::text[]
    WHEN p_packaging_mode = 'individual_master' THEN ARRAY['individual', 'master']::text[]
    WHEN p_packaging_mode IN ('individual_fitilho', 'individual_amarrado')
      THEN ARRAY['individual', 'fitilho']::text[]
    ELSE ARRAY['individual']::text[]
  END;

  SELECT ts.sole_group_id
    INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF v_sole_group_id IS NULL THEN
    packaging_type := 'unresolved';
    warning := 'Ficha sem grupo de solado; embalagem não configurada.';
    required := 0;
    available := 0;
    stock_ok := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_pg
    FROM public.product_groups pg
   WHERE pg.id = v_sole_group_id;

  IF NOT FOUND THEN
    packaging_type := 'unresolved';
    warning := 'Grupo de solado inexistente; embalagem não configurada.';
    required := 0;
    available := 0;
    stock_ok := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_grade IS NOT NULL AND jsonb_typeof(p_grade) = 'object' THEN
    SELECT COALESCE(sum((e.value)::numeric), 0)
      INTO v_grade_total
      FROM jsonb_each_text(p_grade) e
     WHERE e.value ~ '^[0-9]+(\.[0-9]+)?$'
       AND (e.value)::numeric > 0;
    IF COALESCE(v_grade_total, 0) > 0 THEN
      v_sheets := CEIL(p_order_quantity / v_grade_total)::integer;
    END IF;
  END IF;

  FOREACH v_type IN ARRAY v_types LOOP
    box_type_id := CASE v_type
      WHEN 'individual' THEN v_pg.box_type_id
      WHEN 'master' THEN v_pg.box_type_master_id
      WHEN 'colmeia' THEN v_pg.box_type_colmeia_id
      WHEN 'fitilho' THEN v_pg.box_type_fitilho_id
    END;
    packaging_type := v_type;
    box_name := NULL;
    unit := CASE WHEN v_type = 'fitilho' THEN 'm' ELSE 'un' END;
    unit_price := NULL;
    supplier_id := NULL;
    warning := NULL;
    v_box_default := NULL;
    v_box_kind := NULL;
    v_meters := NULL;

    IF v_type = 'colmeia' THEN
      SELECT * INTO v_col
        FROM public.resolve_colmeia_by_grade(
          COALESCE(v_grade_total, 0)::integer,
          v_pg.box_type_colmeia_id,
          v_pg.pairs_per_box_colmeia
        );
      box_type_id := v_col.box_type_id;
      v_pairs := v_col.pairs_per_box;
    END IF;

    IF box_type_id IS NULL THEN
      required := 0;
      available := 0;
      stock_ok := false;
      warning := 'Slot de embalagem ' || v_type || ' não configurado no grupo de solado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT bt.nome, bt.tipo::text, GREATEST(0, COALESCE(bt.quantity, 0)),
           COALESCE(bt.unit_price, 0), bt.supplier_id,
           NULLIF(bt.pairs_per_box_default, 0),
           COALESCE(bt.metros_per_amarrado_default, 1)
      INTO box_name, v_box_kind, available, unit_price, supplier_id,
           v_box_default, v_meters
      FROM public.box_types bt
     WHERE bt.id = box_type_id
       AND bt.active = true;

    IF NOT FOUND THEN
      required := 0;
      available := 0;
      stock_ok := false;
      warning := 'box_type do slot ' || v_type || ' está ausente ou inativo.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_box_kind IS DISTINCT FROM v_type THEN
      required := 0;
      stock_ok := false;
      warning := 'box_type do slot ' || v_type ||
        ' possui tipo incompatível (' || COALESCE(v_box_kind, 'nulo') || ').';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_type <> 'colmeia' THEN
      v_pairs := COALESCE(
        NULLIF(CASE v_type
          WHEN 'individual' THEN v_pg.pairs_per_box_individual
          WHEN 'master' THEN v_pg.pairs_per_box_master
          WHEN 'fitilho' THEN v_pg.pairs_per_box_fitilho
        END, 0),
        v_box_default,
        12
      );
    END IF;

    v_packed := NULL;
    IF v_type <> 'fitilho'
       AND v_pairs > 1
       AND COALESCE(v_sheets, 0) > 0 THEN
      SELECT count(*)::integer
        INTO v_packed
        FROM public.packing_boxes_for_grade(p_grade, v_sheets, v_pairs);
    END IF;

    required := COALESCE(
      NULLIF(v_packed, 0),
      CEIL(p_order_quantity / GREATEST(v_pairs, 1))
    );
    IF v_type = 'fitilho' THEN
      required := required * v_meters;
    END IF;
    stock_ok := available >= required;
    RETURN NEXT;
  END LOOP;
END;
$function$;
