-- COMPONENTES: SKU (product_id) obrigatório — débito exato.
-- Reverte Q11-a (só grupo). Decisões grill 19/10/2026:
--   pin vence sempre; Ateliê não escolhe cor; componentes-por-cor morto no vivo;
--   save bloqueia sem SKU; trigger RAISE (não strip silencioso);
--   backfill 1 SKU ativo por grupo; kit Ateliê por product_id pinado.

-- ─── 1. Backfill: group-only com exatamente 1 SKU ativo ───────────────────────
DO $bf$
DECLARE
  r record;
  v_pid uuid;
  v_pname text;
  v_unit text;
  v_cnt int;
  v_new jsonb;
  v_elem jsonb;
  v_ord int;
  v_changed boolean;
BEGIN
  FOR r IN
    SELECT id, direct_components
      FROM public.technical_sheets
     WHERE jsonb_typeof(coalesce(direct_components, '[]'::jsonb)) = 'array'
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(direct_components) dc
          WHERE coalesce(dc->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            AND nullif(btrim(dc->>'group_id'), '') IS NOT NULL
       )
  LOOP
    v_new := '[]'::jsonb;
    v_changed := false;
    FOR v_elem, v_ord IN
      SELECT dc, ordinality
        FROM jsonb_array_elements(r.direct_components) WITH ORDINALITY AS t(dc, ordinality)
    LOOP
      IF coalesce(v_elem->>'product_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_new := v_new || jsonb_build_array(v_elem);
        CONTINUE;
      END IF;
      IF nullif(btrim(v_elem->>'group_id'), '') IS NULL THEN
        -- lixo sem group nem product: descarta
        v_changed := true;
        CONTINUE;
      END IF;
      SELECT count(*)::int, min(p.id), min(p.name), min(p.unit)
        INTO v_cnt, v_pid, v_pname, v_unit
        FROM public.products p
       WHERE p.group_id = (v_elem->>'group_id')::uuid
         AND p.active IS TRUE;
      IF v_cnt = 1 AND v_pid IS NOT NULL THEN
        v_elem := v_elem
          || jsonb_build_object(
               'product_id', v_pid,
               'product_name', coalesce(nullif(btrim(v_elem->>'product_name'), ''), v_pname),
               'unit', coalesce(nullif(btrim(v_elem->>'unit'), ''), v_unit, 'un')
             );
        v_changed := true;
        v_new := v_new || jsonb_build_array(v_elem);
      ELSE
        -- 0 ou 2+: mantém (save/trigger bloqueiam até escolha humana)
        v_new := v_new || jsonb_build_array(v_elem);
      END IF;
    END LOOP;
    IF v_changed THEN
      UPDATE public.technical_sheets
         SET direct_components = v_new, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
END;
$bf$;

-- ─── 2. Trigger: RAISE se linha com conteúdo sem product_id UUID ─────────────
CREATE OR REPLACE FUNCTION public.tg_strip_invalid_direct_components()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  dc jsonb;
  v_pid text;
  v_gid text;
  v_label text;
  v_kept jsonb := '[]'::jsonb;
  v_has_content boolean;
BEGIN
  IF NEW.direct_components IS NULL OR jsonb_typeof(NEW.direct_components) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR dc IN SELECT * FROM jsonb_array_elements(NEW.direct_components) LOOP
    v_pid := coalesce(dc->>'product_id', '');
    v_gid := nullif(btrim(coalesce(dc->>'group_id', '')), '');
    v_has_content :=
      v_gid IS NOT NULL
      OR nullif(btrim(coalesce(dc->>'group_name', '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(dc->>'product_name', '')), '') IS NOT NULL
      OR coalesce((dc->>'quantity')::numeric, 0) > 0;

    IF v_pid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      v_kept := v_kept || jsonb_build_array(dc);
      CONTINUE;
    END IF;

    IF NOT v_has_content THEN
      -- placeholder vazio: strip
      CONTINUE;
    END IF;

    v_label := coalesce(
      nullif(btrim(dc->>'group_name'), ''),
      nullif(btrim(dc->>'product_name'), ''),
      'Componente'
    );
    RAISE EXCEPTION
      'Componente "%" precisa do item (SKU) final para débito em estoque. Escolha o grupo e o item na ficha antes de salvar.',
      v_label
      USING ERRCODE = 'check_violation';
  END LOOP;

  NEW.direct_components := v_kept;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_strip_invalid_direct_components() IS
  'BEFORE INS/UPD technical_sheets: exige product_id UUID em toda linha de direct_components com conteúdo; stripa só placeholders vazios.';

-- ─── 3. by_grade: pin vence — ignora component_colors + color defaults ───────
DO $patch$
DECLARE
  v_def text;
  v_new text;
  v_before text;
  v_oid oid;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'calculate_order_consumption_by_grade'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_reference_id uuid, p_grade jsonb, p_color text, p_material_variant_id uuid';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade (4-arg) nao existe';
  END IF;

  IF position('direct-components-sku-obrigatorio' IN v_def) > 0 THEN
    RAISE NOTICE 'by_grade ja patchado pra SKU obrigatorio — skip';
    RETURN;
  END IF;

  v_new := v_def;

  -- Desliga branch technical_sheet_component_colors (flag morta no vivo).
  v_before := v_new;
  v_new := replace(v_new,
$a1$IF COALESCE(v_sheet.component_colors_enabled, false)
     AND p_color IS NOT NULL AND btrim(p_color) <> '' THEN$a1$,
$n1$-- direct-components-sku-obrigatorio: component_colors morto; pin em direct_components.
  IF false
     AND COALESCE(v_sheet.component_colors_enabled, false)
     AND p_color IS NOT NULL AND btrim(p_color) <> '' THEN$n1$);
  IF v_new = v_before THEN
    RAISE EXCEPTION 'patch by_grade 1/2 (desligar component_colors) nao casou';
  END IF;

  -- Pin vence: nao troca SKU via component_color_defaults.
  v_before := v_new;
  v_new := replace(v_new,
$a2$      v_rule_pid := NULL; v_dc_warn := NULL;
      IF btrim(COALESCE(p_color, '')) <> '' THEN
        SELECT d.product_id INTO v_rule_pid
          FROM component_color_defaults d
          JOIN products pr ON pr.id = d.product_id AND pr.active = true
          JOIN products po ON po.id = v_pid
         WHERE d.active = true
           AND po.group_id IS NOT NULL
           AND d.group_id = po.group_id
           AND (d.is_default
                OR lower(btrim(extensions.unaccent(d.cabedal_color))) = lower(btrim(extensions.unaccent(p_color))))
         ORDER BY d.is_default ASC, d.id
         LIMIT 1;
        IF v_rule_pid IS NULL AND EXISTS (
             SELECT 1
               FROM component_color_defaults d
               JOIN products po ON po.id = v_pid
              WHERE d.active = true
                AND po.group_id IS NOT NULL
                AND d.group_id = po.group_id
                AND (d.is_default
                     OR lower(btrim(extensions.unaccent(d.cabedal_color))) = lower(btrim(extensions.unaccent(p_color))))
           ) THEN
          v_dc_warn := 'Regra global de cor do grupo aponta produto inativo/apagado — usando o componente original da ficha. Corrija em Fichas Técnicas → Padrões por Cor.';
        END IF;
      END IF;$a2$,
$n2$      -- direct-components-sku-obrigatorio: pin vence; sem swap por cor.
      v_rule_pid := NULL; v_dc_warn := NULL;$n2$);
  IF v_new = v_before THEN
    RAISE EXCEPTION 'patch by_grade 2/2 (remover color defaults swap) nao casou';
  END IF;

  EXECUTE v_new;
END;
$patch$;

-- ─── 4. Kit Ateliê: candidatos = product_id pinado ───────────────────────────
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
  -- Kit lista COMPONENTES pinados (product_id). Sem pin = fora da lista.
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
    JOIN public.products p ON p.id = NULLIF(elem->>'product_id', '')::uuid
    LEFT JOIN public.product_groups pg ON pg.id = COALESCE(
      NULLIF(elem->>'group_id', '')::uuid,
      p.group_id
    )
  )
  SELECT DISTINCT ON (r.pid)
         r.gid,
         r.gname,
         r.pid,
         r.pname,
         r.unit,
         'Componente Direto'::text AS component,
         r.qpu,
         r.sector
    FROM resolved r
   WHERE r.pid IS NOT NULL
   ORDER BY r.pid, r.ordinality;
$$;

COMMENT ON FUNCTION public.atelier_sheet_kit_candidates(uuid, text) IS
  'COMPONENTES da ficha com product_id pinado elegíveis pro kit do setor.';

-- Backfill kit_product_ids a partir de kit_group_ids × pins da ficha
UPDATE public.atelier_complex_references a
SET kit_product_ids = sub.pids,
    updated_at = now()
FROM (
  SELECT a2.id AS ref_row_id,
         array_agg(DISTINCT c.product_id) FILTER (WHERE c.product_id IS NOT NULL) AS pids
    FROM public.atelier_complex_references a2
    CROSS JOIN LATERAL public.atelier_sheet_kit_candidates(a2.reference_id, a2.sector) c
   WHERE a2.active
     AND COALESCE(cardinality(a2.kit_group_ids), 0) > 0
     AND (a2.kit_product_ids IS NULL OR cardinality(a2.kit_product_ids) = 0)
     AND c.group_id = ANY (a2.kit_group_ids)
   GROUP BY a2.id
) sub
WHERE a.id = sub.ref_row_id
  AND sub.pids IS NOT NULL
  AND cardinality(sub.pids) > 0;

CREATE OR REPLACE FUNCTION public.atelier_lot_kit_product_ids(p_reference_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT pid), ARRAY[]::uuid[])
    FROM public.atelier_complex_references a
    CROSS JOIN LATERAL unnest(COALESCE(a.kit_product_ids, ARRAY[]::uuid[])) pid
   WHERE a.reference_id = p_reference_id
     AND a.active
     AND a.sector = ANY (public.atelier_reference_street_sectors(p_reference_id));
$$;

GRANT EXECUTE ON FUNCTION public.atelier_lot_kit_product_ids(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_lot_kit_filter_products(p_reference_id uuid)
RETURNS TABLE (product_id uuid, component text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pids AS (
    SELECT unnest(public.atelier_lot_kit_product_ids(p_reference_id)) AS product_id
  ),
  by_product AS (
    SELECT p.product_id, 'Componente Direto'::text AS component FROM pids p
  ),
  groups AS (
    SELECT unnest(public.atelier_lot_kit_group_ids(p_reference_id)) AS group_id
  ),
  by_group AS (
    SELECT p.id AS product_id, 'Componente Direto'::text AS component
      FROM public.products p
      JOIN groups g ON g.group_id = p.group_id
     WHERE NOT EXISTS (SELECT 1 FROM by_product)
  ),
  has_any AS (
    SELECT EXISTS (SELECT 1 FROM by_product) OR EXISTS (SELECT 1 FROM by_group) AS yes
  ),
  labels AS (
    SELECT a.sector,
           COALESCE(a.material_components, public.atelier_default_kit_components(a.sector)) AS comps
      FROM public.atelier_complex_references a
     WHERE a.reference_id = p_reference_id
       AND a.active
       AND a.sector = ANY (public.atelier_reference_street_sectors(p_reference_id))
  )
  SELECT product_id, component FROM by_product
  UNION
  SELECT product_id, component FROM by_group
  UNION ALL
  SELECT NULL::uuid, c
    FROM labels r
    CROSS JOIN LATERAL unnest(r.comps) c
    CROSS JOIN has_any
   WHERE NOT has_any.yes;
$$;

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
  pids AS (
    SELECT unnest(public.atelier_lot_kit_product_ids((SELECT reference_id FROM lot))) AS product_id
  ),
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
       (EXISTS (SELECT 1 FROM pids) AND l.product_id IN (SELECT product_id FROM pids)
         AND l.component IN ('Componente Direto', 'BOM'))
       OR (NOT EXISTS (SELECT 1 FROM pids) AND EXISTS (SELECT 1 FROM gids)
         AND p.group_id IN (SELECT group_id FROM gids)
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

COMMENT ON COLUMN public.atelier_complex_references.kit_group_ids IS
  'Legado: grupos de COMPONENTES no kit. Preferir kit_product_ids (SKU pinado).';

COMMENT ON COLUMN public.atelier_complex_references.kit_product_ids IS
  'SKUs de COMPONENTES (direct_components.product_id) no kit deste setor. Liberação debita estes pins.';
