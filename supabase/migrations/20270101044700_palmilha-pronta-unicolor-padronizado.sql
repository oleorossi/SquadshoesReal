-- ─────────────────────────────────────────────────────────────────────────────
-- Palmilha Pronta Unicolor Padronizado
--
-- Decisão do dono (grill 2026-10): tipo NOVO de solado = kit comprado
-- (solado + palmilha + fibra), sempre CARAMELO, sem coligação cabedal→palmilha,
-- sem forração. O kit mora no cadastro do solado; a ficha só escolhe o solado
-- e preenche cabedal (tira ou área).
--
-- Efeitos:
--   1) enum sole_classification += palmilha_pronta_unicolor_padronizado
--   2) cascade insole_ready_made + strip etapas (como palmilha_pronta)
--   3) desativa linhas Precificação Placa fibra / Solado / Forração
--   4) resolve cor do solado → sempre CARAMELO
--   5) exige SKU CARAMELO ativo no grupo ao classificar
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS private;

-- 1) Enum
ALTER TYPE public.sole_classification_enum
  ADD VALUE IF NOT EXISTS 'palmilha_pronta_unicolor_padronizado';

-- 2) Helpers
CREATE OR REPLACE FUNCTION public.is_palmilha_pronta_class(p_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_class IN ('palmilha_pronta', 'palmilha_pronta_unicolor_padronizado');
$$;

COMMENT ON FUNCTION public.is_palmilha_pronta_class(text) IS
  'Verdadeiro para palmilha_pronta clássica e unicolor padronizado.';

CREATE OR REPLACE FUNCTION public.is_unicolor_padronizado_class(p_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_class = 'palmilha_pronta_unicolor_padronizado';
$$;

CREATE OR REPLACE FUNCTION private.normalize_color_key(p_color text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT lower(btrim(unaccent(COALESCE(p_color, ''))));
$$;

CREATE OR REPLACE FUNCTION private.is_caramelo_color(p_color text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'private'
AS $$
  SELECT private.normalize_color_key(p_color) = 'caramelo';
$$;

-- Descrições do kit de precificação cobertas pelo kit físico unicolor.
CREATE OR REPLACE FUNCTION private.kit_desc_covered_by_unicolor_sole(p_description text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'private'
AS $$
  SELECT CASE
    WHEN v_key = '' THEN false
    WHEN v_key = 'solado' OR v_key LIKE 'solado %' THEN true
    WHEN v_key IN ('placa fibra', 'fibra') OR v_key LIKE 'placa fibra%' THEN true
    WHEN v_key = 'forracao' OR v_key LIKE 'forracao%' THEN true
    ELSE false
  END
  FROM (
    SELECT private.normalize_color_key(p_description) AS v_key
  ) s;
$$;

-- Grupo do solado tem classificação unicolor em algum SKU ativo?
CREATE OR REPLACE FUNCTION private.sole_group_is_unicolor_padronizado(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.group_id = p_group_id
       AND p.active IS TRUE
       AND public.is_unicolor_padronizado_class(p.sole_classification::text)
  );
$$;

CREATE OR REPLACE FUNCTION private.sheet_sole_is_unicolor_padronizado(p_sheet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
      LEFT JOIN public.products primary_sole ON primary_sole.id = ts.primary_sole_id
     WHERE ts.id = p_sheet_id
       AND (
         public.is_unicolor_padronizado_class(primary_sole.sole_classification::text)
         OR (
           ts.sole_group_id IS NOT NULL
           AND private.sole_group_is_unicolor_padronizado(ts.sole_group_id)
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.group_has_active_caramelo_sole(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'private'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.group_id = p_group_id
       AND p.active IS TRUE
       AND (
         lower(btrim(COALESCE(p.category, ''))) = 'sola'
         OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
       )
       AND private.is_caramelo_color(p.color)
  );
$$;

REVOKE ALL ON FUNCTION public.group_has_active_caramelo_sole(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_has_active_caramelo_sole(uuid) TO authenticated, service_role;

-- 3) Sync kit Precificação ↔ solado unicolor
CREATE OR REPLACE FUNCTION public.sync_sheet_unicolor_sole_kit(
  p_sheet_id uuid,
  OUT deactivated_count int,
  OUT reactivated_count int,
  OUT deactivated_names text,
  OUT pending_draft_names text
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  v_unicolor boolean;
BEGIN
  deactivated_count := 0;
  reactivated_count := 0;
  deactivated_names := NULL;
  pending_draft_names := NULL;

  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id é obrigatório';
  END IF;

  IF NOT public.is_approved_user() AND NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar kit do solado unicolor';
  END IF;

  v_unicolor := private.sheet_sole_is_unicolor_padronizado(p_sheet_id);

  IF v_unicolor THEN
    WITH covered AS (
      SELECT sm.id,
             COALESCE(nullif(btrim(sm.draft_name), ''), nullif(btrim(sm.part_name), ''), 'sem nome') AS label
        FROM public.sheet_materials sm
        LEFT JOIN public.base_material_kit_items ki ON ki.id = sm.from_kit_item_id
       WHERE sm.sheet_id = p_sheet_id
         AND sm.line_kind = 'material'
         AND sm.is_active IS TRUE
         AND (
           private.kit_desc_covered_by_unicolor_sole(ki.description)
           OR private.kit_desc_covered_by_unicolor_sole(sm.part_name)
           OR private.kit_desc_covered_by_unicolor_sole(sm.draft_name)
         )
    ),
    upd AS (
      UPDATE public.sheet_materials sm
         SET is_active = false,
             updated_at = now()
        FROM covered c
       WHERE sm.id = c.id
      RETURNING c.label
    )
    SELECT count(*)::int, string_agg(label, ', ' ORDER BY label)
      INTO deactivated_count, deactivated_names
      FROM upd;

    UPDATE public.technical_sheets ts
       SET insole_ready_made = true,
           sole_consumption = COALESCE(NULLIF(ts.sole_consumption, 0), 1),
           production_sectors = private.strip_ready_made_production_sectors(
             COALESCE(ts.production_sectors, '[]'::jsonb)
           ),
           updated_at = now()
     WHERE ts.id = p_sheet_id;

  ELSE
    -- Reativa só linhas do kit cobertas que estavam desligadas (saída do tipo).
    WITH covered AS (
      SELECT sm.id,
             COALESCE(nullif(btrim(sm.draft_name), ''), nullif(btrim(sm.part_name), ''), 'sem nome') AS label
        FROM public.sheet_materials sm
        JOIN public.base_material_kit_items ki ON ki.id = sm.from_kit_item_id
       WHERE sm.sheet_id = p_sheet_id
         AND sm.line_kind = 'material'
         AND sm.is_active IS FALSE
         AND sm.from_kit_item_id IS NOT NULL
         AND private.kit_desc_covered_by_unicolor_sole(ki.description)
    ),
    upd AS (
      UPDATE public.sheet_materials sm
         SET is_active = true,
             updated_at = now()
        FROM covered c
       WHERE sm.id = c.id
      RETURNING c.label
    )
    SELECT count(*)::int, string_agg(label, ', ' ORDER BY label)
      INTO reactivated_count, deactivated_names
      FROM upd;
  END IF;

  SELECT string_agg(
           COALESCE(nullif(btrim(sm.draft_name), ''), nullif(btrim(sm.part_name), ''), 'sem nome'),
           ', ' ORDER BY sm.created_at
         )
    INTO pending_draft_names
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = p_sheet_id
     AND sm.is_active IS TRUE
     AND sm.line_kind = 'material'
     AND sm.product_id IS NULL;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_sheet_unicolor_sole_kit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_sheet_unicolor_sole_kit(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.sync_sheet_unicolor_sole_kit(uuid) IS
  'Com solado unicolor: desativa Placa fibra/Solado/Forração na Precificação, '
  'força insole_ready_made e consumo 1. Ao sair do tipo, reativa linhas do kit.';

-- Cascata em todas as fichas ligadas a um produto/grupo.
CREATE OR REPLACE FUNCTION private.cascade_unicolor_kit_to_linked_sheets(p_product_id uuid, p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  r record;
  v_prev_role text;
BEGIN
  v_prev_role := current_setting('session_replication_role', true);
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR r IN
    SELECT DISTINCT ts.id
      FROM public.technical_sheets ts
     WHERE (p_group_id IS NOT NULL AND ts.sole_group_id = p_group_id)
        OR ts.primary_sole_id = p_product_id
  LOOP
    PERFORM public.sync_sheet_unicolor_sole_kit(r.id);
  END LOOP;

  PERFORM set_config(
    'session_replication_role',
    COALESCE(NULLIF(v_prev_role, ''), 'origin'),
    true
  );
END;
$function$;

-- 4) Cascade classificação (pronta clássica + unicolor)
CREATE OR REPLACE FUNCTION public.tg_cascade_palmilha_pronta_to_sheets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_prev_role text;
  v_entering_ready boolean;
  v_leaving_unicolor boolean;
  v_entering_unicolor boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_entering_ready :=
    public.is_palmilha_pronta_class(NEW.sole_classification::text)
    AND NOT public.is_palmilha_pronta_class(COALESCE(OLD.sole_classification::text, ''));

  v_entering_unicolor :=
    public.is_unicolor_padronizado_class(NEW.sole_classification::text)
    AND NOT public.is_unicolor_padronizado_class(COALESCE(OLD.sole_classification::text, ''));

  v_leaving_unicolor :=
    public.is_unicolor_padronizado_class(COALESCE(OLD.sole_classification::text, ''))
    AND NOT public.is_unicolor_padronizado_class(NEW.sole_classification::text);

  IF v_entering_ready THEN
    v_prev_role := current_setting('session_replication_role', true);
    PERFORM set_config('session_replication_role', 'replica', true);

    UPDATE public.technical_sheets ts
       SET insole_ready_made = true,
           sole_consumption = COALESCE(NULLIF(ts.sole_consumption, 0), 1),
           production_sectors = private.strip_ready_made_production_sectors(
             COALESCE(ts.production_sectors, '[]'::jsonb)
           ),
           updated_at = now()
     WHERE (
             NEW.group_id IS NOT NULL
             AND ts.sole_group_id = NEW.group_id
           )
        OR ts.primary_sole_id = NEW.id;

    PERFORM set_config(
      'session_replication_role',
      COALESCE(NULLIF(v_prev_role, ''), 'origin'),
      true
    );
  END IF;

  IF v_entering_unicolor OR v_leaving_unicolor THEN
    PERFORM private.cascade_unicolor_kit_to_linked_sheets(NEW.id, NEW.group_id);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_cascade_palmilha_pronta_to_sheets() IS
  'Ao marcar solado como palmilha_pronta ou unicolor padronizado: insole_ready_made '
  '+ strip de etapas. Unicolor também sincroniza kit Precificação (Placa fibra/Solado/Forração).';

-- 5) Guarda: unicolor exige SKU CARAMELO no grupo
CREATE OR REPLACE FUNCTION public.tg_require_caramelo_for_unicolor_sole()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  v_group_id uuid;
BEGIN
  IF NOT public.is_unicolor_padronizado_class(NEW.sole_classification::text) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.sole_classification IS NOT DISTINCT FROM OLD.sole_classification THEN
    RETURN NEW;
  END IF;

  v_group_id := NEW.group_id;
  IF v_group_id IS NULL THEN
    -- SKU isolado: a própria cor tem que ser caramelo
    IF NOT private.is_caramelo_color(NEW.color) THEN
      RAISE EXCEPTION
        'Palmilha Pronta Unicolor Padronizado exige SKU na cor CARAMELO. Este produto está em "%".',
        COALESCE(NULLIF(btrim(NEW.color), ''), '(sem cor)')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.group_has_active_caramelo_sole(v_group_id)
     AND NOT (NEW.active IS TRUE AND private.is_caramelo_color(NEW.color)) THEN
    RAISE EXCEPTION
      'Palmilha Pronta Unicolor Padronizado exige um SKU CARAMELO ativo neste solado. Cadastre a cor CARAMELO em Solados.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_require_caramelo_for_unicolor_sole ON public.products;
CREATE TRIGGER trg_require_caramelo_for_unicolor_sole
  BEFORE INSERT OR UPDATE OF sole_classification, color, group_id, active
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_caramelo_for_unicolor_sole();

-- 6) Ao mudar solado da ficha, sincroniza kit
CREATE OR REPLACE FUNCTION public.tg_sheet_sync_unicolor_sole_kit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.sole_group_id IS NOT DISTINCT FROM OLD.sole_group_id
     AND NEW.primary_sole_id IS NOT DISTINCT FROM OLD.primary_sole_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.sync_sheet_unicolor_sole_kit(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sheet_sync_unicolor_sole_kit ON public.technical_sheets;
CREATE TRIGGER trg_sheet_sync_unicolor_sole_kit
  AFTER INSERT OR UPDATE OF sole_group_id, primary_sole_id
  ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sheet_sync_unicolor_sole_kit();

-- 7) apply_base_material_kit: não cria linhas cobertas se solado já é unicolor
CREATE OR REPLACE FUNCTION public.apply_base_material_kit_to_sheet(p_sheet_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_category text;
  v_kit_id uuid;
  v_inserted int := 0;
  v_unicolor boolean;
BEGIN
  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id é obrigatório';
  END IF;

  IF NOT public.is_approved_user() AND NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Sem permissão para aplicar kit de materiais base';
  END IF;

  SELECT shoe_category INTO v_category
    FROM public.technical_sheets
   WHERE id = p_sheet_id;

  IF v_category IS NULL OR nullif(btrim(v_category), '') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_kit_id
    FROM public.base_material_kits
   WHERE shoe_category = v_category
     AND active IS TRUE
   LIMIT 1;

  IF v_kit_id IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sheet_materials
     WHERE sheet_id = p_sheet_id AND from_kit_item_id IS NOT NULL
  ) THEN
    RETURN 0;
  END IF;

  v_unicolor := private.sheet_sole_is_unicolor_padronizado(p_sheet_id);

  INSERT INTO public.sheet_materials (
    sheet_id,
    product_id,
    group_id,
    quantity_per_unit,
    part_name,
    draft_name,
    line_kind,
    cost_mode,
    cost_per_pair,
    estimated_unit_price,
    is_active,
    include_in_consumption,
    from_kit_item_id,
    consumption_sector,
    color, width, weight, supplier, notes, sizes
  )
  SELECT
    p_sheet_id,
    ki.product_id,
    ki.group_id,
    COALESCE(ki.quantity_per_unit, 1),
    ki.description,
    CASE WHEN ki.product_id IS NULL THEN ki.description ELSE NULL END,
    ki.line_kind,
    ki.cost_mode,
    ki.cost_per_pair,
    CASE
      WHEN ki.product_id IS NULL AND ki.line_kind = 'material'
        THEN COALESCE(ki.estimated_unit_price, ki.cost_per_pair)
      ELSE ki.estimated_unit_price
    END,
    ki.is_active,
    false,
    ki.id,
    '',
    '', '', '', '', '', ''
  FROM public.base_material_kit_items ki
  WHERE ki.kit_id = v_kit_id
    AND NOT (
      v_unicolor
      AND ki.line_kind = 'material'
      AND private.kit_desc_covered_by_unicolor_sole(ki.description)
    )
  ORDER BY ki.sort_order, ki.created_at;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_base_material_kit_to_sheet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_base_material_kit_to_sheet(uuid) TO authenticated, service_role;

-- 8) Resolve cor: injeta early-return unicolor no corpo VIVO (não reescreve o resto)
DO $patch_resolve_group$
DECLARE
  v_definition text;
  v_needle text := 'BEGIN\n  v_input_key := lower(btrim(unaccent(COALESCE(p_product_color, ''''))));';
  v_inject text := $inj$BEGIN
  -- Unicolor padronizado: ignora cor do cabedal; sempre CARAMELO.
  IF p_sole_group_id IS NOT NULL
     AND private.sole_group_is_unicolor_padronizado(p_sole_group_id) THEN
    RETURN QUERY
      SELECT p.id, p.name, p.color, p.quantity,
             'unicolor_caramelo'::text, true
        FROM public.products p
       WHERE p.group_id = p_sole_group_id
         AND p.active IS TRUE
         AND (
           lower(btrim(COALESCE(p.category, ''))) = 'sola'
           OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
         )
         AND private.is_caramelo_color(p.color)
       ORDER BY p.quantity DESC NULLS LAST, p.id
       LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
    RETURN QUERY
      SELECT NULL::uuid, NULL::text, 'CARAMELO'::text, 0::numeric,
             'unicolor_caramelo_missing'::text, true;
    RETURN;
  END IF;

  v_input_key := lower(btrim(unaccent(COALESCE(p_product_color, ''))));$inj$;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_sole_in_group_by_color(uuid,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF position('unicolor_caramelo' IN v_definition) > 0 THEN
    RAISE NOTICE 'resolve_sole_in_group_by_color já tem ramo unicolor — skip';
    RETURN;
  END IF;

  IF position(v_needle IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato inesperado em resolve_sole_in_group_by_color: início não encontrado';
  END IF;

  -- search_path precisa enxergar private.is_caramelo_color
  v_definition := replace(
    v_definition,
    'SET search_path TO ''public'', ''extensions''',
    'SET search_path TO ''public'', ''extensions'', ''private'''
  );
  v_definition := replace(v_definition, v_needle, v_inject);
  EXECUTE v_definition;
END;
$patch_resolve_group$;

DO $patch_resolve_sheet$
DECLARE
  v_definition text;
  v_needle text := $n$BEGIN
  SELECT ts.sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;$n$;
  v_inject text := $inj$BEGIN
  -- Unicolor: resolve CARAMELO e encerra (não cai em mapa pintável / conjugações).
  IF private.sheet_sole_is_unicolor_padronizado(p_sheet_id) THEN
    SELECT ts.sole_group_id, ts.primary_sole_id
      INTO v_sole_group_id, v_primary_sole_id
      FROM public.technical_sheets ts
     WHERE ts.id = p_sheet_id;

    IF v_sole_group_id IS NOT NULL THEN
      RETURN QUERY
        SELECT r.product_id, r.sole_color
          FROM public.resolve_sole_in_group_by_color(
            v_sole_group_id, p_product_color, v_primary_sole_id
          ) r
         WHERE r.product_id IS NOT NULL
         LIMIT 1;
      RETURN;
    END IF;

    IF v_primary_sole_id IS NOT NULL THEN
      RETURN QUERY
        SELECT p.id, p.color
          FROM public.products p
         WHERE p.id = v_primary_sole_id
           AND p.active IS TRUE
           AND private.is_caramelo_color(p.color);
    END IF;
    RETURN;
  END IF;

  SELECT ts.sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;$inj$;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_sole_color(uuid,text)'::regprocedure
  ) INTO v_definition;

  IF position('sheet_sole_is_unicolor_padronizado' IN v_definition) > 0 THEN
    RAISE NOTICE 'resolve_sole_color já tem ramo unicolor — skip';
    RETURN;
  END IF;

  IF position(v_needle IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato inesperado em resolve_sole_color: início não encontrado';
  END IF;

  v_definition := replace(
    v_definition,
    'SET search_path TO ''public'', ''extensions''',
    'SET search_path TO ''public'', ''extensions'', ''private'''
  );
  v_definition := replace(v_definition, v_needle, v_inject);
  EXECUTE v_definition;
END;
$patch_resolve_sheet$;
