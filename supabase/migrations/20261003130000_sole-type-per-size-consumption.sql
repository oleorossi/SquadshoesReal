-- ============================================================================
-- Consumo canônico por numeração no TIPO de solado
--
-- Precedência por tamanho (nos motores SQL e TS):
--   ficha.*_consumption_per_size > solado.*_consumption_per_size
--   > solado.*_dm2 > escalar da ficha.
-- ============================================================================

ALTER TABLE public.sole_technical_specs
  ADD COLUMN IF NOT EXISTS insole_consumption_per_size jsonb,
  ADD COLUMN IF NOT EXISTS lining_consumption_per_size jsonb,
  ADD COLUMN IF NOT EXISTS insole_lining_consumption_per_size jsonb,
  ADD COLUMN IF NOT EXISTS fachete_lining_consumption_per_size jsonb;

COMMENT ON COLUMN public.sole_technical_specs.insole_consumption_per_size IS
  'Mapa canônico {numeração: dm²/par} de palmilha do tipo de solado.';
COMMENT ON COLUMN public.sole_technical_specs.lining_consumption_per_size IS
  'Mapa canônico {numeração: dm²/par} de forro do cabedal do tipo de solado.';
COMMENT ON COLUMN public.sole_technical_specs.insole_lining_consumption_per_size IS
  'Mapa canônico {numeração: dm²/par} de forração da palmilha do tipo de solado.';
COMMENT ON COLUMN public.sole_technical_specs.fachete_lining_consumption_per_size IS
  'Mapa canônico {numeração: dm²/par} de fachete do tipo de solado.';

-- As specs antigas são uma linha por tamanho. O mapa novo é replicado nelas
-- pelo editor; esta função consolida o mapa em uma fonte única e tolera dados
-- legados em que só uma das linhas já recebeu o JSONB.
CREATE OR REPLACE FUNCTION public.get_sole_consumption_per_size(
  p_sole_product_id uuid,
  p_field text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_map jsonb;
BEGIN
  IF p_field NOT IN (
    'insole_consumption_per_size',
    'lining_consumption_per_size',
    'insole_lining_consumption_per_size',
    'fachete_lining_consumption_per_size'
  ) THEN
    RAISE EXCEPTION 'Campo de consumo por numeração inválido: %', p_field;
  END IF;

  SELECT COALESCE(jsonb_object_agg(src.size_key, src.value), '{}'::jsonb)
    INTO v_map
  FROM (
    SELECT kv.key AS size_key,
           kv.value,
           row_number() OVER (
             PARTITION BY kv.key
             ORDER BY sts.updated_at DESC NULLS LAST, sts.size
           ) AS rn
    FROM public.sole_technical_specs sts
    CROSS JOIN LATERAL jsonb_each(
      CASE p_field
        WHEN 'insole_consumption_per_size' THEN COALESCE(sts.insole_consumption_per_size, '{}'::jsonb)
        WHEN 'lining_consumption_per_size' THEN COALESCE(sts.lining_consumption_per_size, '{}'::jsonb)
        WHEN 'insole_lining_consumption_per_size' THEN COALESCE(sts.insole_lining_consumption_per_size, '{}'::jsonb)
        WHEN 'fachete_lining_consumption_per_size' THEN COALESCE(sts.fachete_lining_consumption_per_size, '{}'::jsonb)
      END
    ) kv
    WHERE sts.sole_id = p_sole_product_id
  ) src
  WHERE src.rn = 1;

  RETURN COALESCE(v_map, '{}'::jsonb);
END;
$function$;

-- O motor escalar é wrapper do by_grade desde 20260911130000. Alteramos só o
-- motor canônico e preservamos fachete, variantes e a supressão anti-duplicidade.
-- A troca é deliberadamente ancorada no corpo vivo: se uma alteração externa
-- tiver mudado o trecho, a migration aborta em vez de aplicar uma regra parcial.
DO $do$
DECLARE
  v_definition text;
  v_before text;
  v_old_suppression constant text := $needle$
  IF COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    SELECT bool_or(COALESCE(insole_lining_consumption_dm2, 0) > 0),
           bool_or(COALESCE(lining_consumption_dm2, 0) > 0)
      INTO v_sole_has_palm_forro, v_sole_has_cabedal_forro
      FROM sole_technical_specs WHERE sole_id = v_sole_product_id;
    v_suppress_cabedal_lining := COALESCE(v_sole_has_palm_forro, false)
                                 AND NOT COALESCE(v_sole_has_cabedal_forro, false);
  END IF;
$needle$;
  v_new_suppression constant text := $replacement$
  IF COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    SELECT bool_or(COALESCE(insole_lining_consumption_dm2, 0) > 0),
           bool_or(COALESCE(lining_consumption_dm2, 0) > 0)
      INTO v_sole_has_palm_forro, v_sole_has_cabedal_forro
      FROM sole_technical_specs WHERE sole_id = v_sole_product_id;
    v_sole_has_palm_forro := COALESCE(v_sole_has_palm_forro, false)
      OR EXISTS (
        SELECT 1
        FROM jsonb_each_text(public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_lining_consumption_per_size'
        )) kv
        WHERE (kv.value)::numeric > 0
      );
    v_sole_has_cabedal_forro := COALESCE(v_sole_has_cabedal_forro, false)
      OR EXISTS (
        SELECT 1
        FROM jsonb_each_text(public.get_sole_consumption_per_size(
          v_sole_product_id, 'lining_consumption_per_size'
        )) kv
        WHERE (kv.value)::numeric > 0
      );
    v_suppress_cabedal_lining := v_sole_has_palm_forro
                                 AND NOT v_sole_has_cabedal_forro;
  END IF;
$replacement$;
  v_old_resolution constant text := $needle$
    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL OR v_insole_lining IS NULL OR v_is_fachetado)
       AND (COALESCE(v_sheet.sole_drives_consumption, false) OR v_is_fachetado)
       AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
        IF v_insole_lining IS NULL AND COALESCE(v_spec.insole_lining_consumption_dm2, 0) > 0 THEN v_insole_lining := v_spec.insole_lining_consumption_dm2; END IF;
        IF v_is_fachetado AND COALESCE(v_spec.fachete_lining_consumption_dm2, 0) > 0 THEN v_fachete := v_spec.fachete_lining_consumption_dm2; END IF;
      END IF;
    END IF;
$needle$;
  v_new_resolution constant text := $replacement$
    IF (v_lining IS NULL OR v_insole IS NULL OR v_insole_lining IS NULL OR v_is_fachetado)
       AND v_sole_product_id IS NOT NULL THEN
      -- A ficha já foi lida acima. Agora entra o mapa canônico do tipo de
      -- solado; só depois preservamos o fallback legado `*_dm2` por tamanho.
      IF v_lining IS NULL THEN
        v_lining := NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'lining_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0);
      END IF;
      IF v_insole IS NULL THEN
        v_insole := NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0);
      END IF;
      IF v_insole_lining IS NULL THEN
        v_insole_lining := NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'insole_lining_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0);
      END IF;
      IF v_is_fachetado THEN
        v_fachete := NULLIF(COALESCE((public.get_sole_consumption_per_size(
          v_sole_product_id, 'fachete_lining_consumption_per_size'
        ) ->> v_size::text)::numeric, 0), 0);
      END IF;

      SELECT * INTO v_spec FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
        IF v_insole_lining IS NULL AND COALESCE(v_spec.insole_lining_consumption_dm2, 0) > 0 THEN v_insole_lining := v_spec.insole_lining_consumption_dm2; END IF;
        IF v_is_fachetado AND v_fachete IS NULL AND COALESCE(v_spec.fachete_lining_consumption_dm2, 0) > 0 THEN v_fachete := v_spec.fachete_lining_consumption_dm2; END IF;
      END IF;
    END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF position('get_sole_consumption_per_size' IN v_definition) > 0 THEN
    RAISE NOTICE 'calculate_order_consumption_by_grade já usa o mapa canônico por numeração';
  ELSE
    v_before := v_definition;
    v_definition := replace(v_definition, v_old_suppression, v_new_suppression);
    IF v_definition = v_before THEN
      RAISE EXCEPTION 'Âncora de supressão anti-duplicidade não encontrada em calculate_order_consumption_by_grade';
    END IF;

    v_before := v_definition;
    v_definition := replace(v_definition, v_old_resolution, v_new_resolution);
    IF v_definition = v_before THEN
      RAISE EXCEPTION 'Âncora de resolução por tamanho não encontrada em calculate_order_consumption_by_grade';
    END IF;

    EXECUTE v_definition;
  END IF;
END;
$do$;

-- Reaplica a RPC viva com todos os consumos por tamanho. A versão original
-- copiava os quatro escalares menos insole_lining_consumption_dm2; sem esta
-- redefinição, a cópia de um solado descartaria tanto o legado quanto os mapas.
CREATE OR REPLACE FUNCTION public.copy_sole_specs_from(
  p_source_sole_id uuid,
  p_target_sole_id uuid,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source_count int;
  v_target_count int;
  v_copied_specs int := 0;
  v_copied_structs int := 0;
BEGIN
  IF p_source_sole_id IS NULL OR p_target_sole_id IS NULL THEN
    RAISE EXCEPTION 'IDs origem e destino são obrigatórios';
  END IF;
  IF p_source_sole_id = p_target_sole_id THEN
    RAISE EXCEPTION 'IDs origem e destino são iguais';
  END IF;

  SELECT COUNT(*) INTO v_source_count
    FROM sole_technical_specs WHERE sole_id = p_source_sole_id;
  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'Solado origem (%) não tem specs cadastradas', p_source_sole_id;
  END IF;

  SELECT COUNT(*) INTO v_target_count
    FROM sole_technical_specs WHERE sole_id = p_target_sole_id;
  IF v_target_count > 0 AND NOT p_overwrite THEN
    RAISE EXCEPTION 'Solado destino já tem % specs cadastradas. Use p_overwrite=true pra substituir.', v_target_count;
  END IF;

  IF p_overwrite THEN
    DELETE FROM sole_technical_specs WHERE sole_id = p_target_sole_id;
    DELETE FROM sole_structures WHERE sole_id = p_target_sole_id;
  END IF;

  INSERT INTO sole_technical_specs (
    sole_id, size,
    lining_consumption_dm2, insole_consumption_dm2,
    insole_lining_consumption_dm2, fachete_lining_consumption_dm2, consumption,
    lining_consumption_per_size, insole_consumption_per_size,
    insole_lining_consumption_per_size, fachete_lining_consumption_per_size,
    reference_sole_id, reference_date
  )
  SELECT
    p_target_sole_id, size,
    lining_consumption_dm2, insole_consumption_dm2,
    insole_lining_consumption_dm2, fachete_lining_consumption_dm2, consumption,
    lining_consumption_per_size, insole_consumption_per_size,
    insole_lining_consumption_per_size, fachete_lining_consumption_per_size,
    p_source_sole_id, now()
  FROM sole_technical_specs
  WHERE sole_id = p_source_sole_id;
  GET DIAGNOSTICS v_copied_specs = ROW_COUNT;

  INSERT INTO sole_structures (
    sole_id, component_type, default_group_id,
    lining_material_id, insole_material_id
  )
  SELECT
    p_target_sole_id, component_type, default_group_id,
    lining_material_id, insole_material_id
  FROM sole_structures
  WHERE sole_id = p_source_sole_id;
  GET DIAGNOSTICS v_copied_structs = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'copied_specs', v_copied_specs,
    'copied_structures', v_copied_structs,
    'source_sole_id', p_source_sole_id,
    'target_sole_id', p_target_sole_id,
    'overwrite', p_overwrite
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.copy_sole_specs_from(uuid, uuid, boolean) TO authenticated;

-- Mantém o teto dos quatro escalares e aplica o mesmo limite aos mapas JSONB
-- canônicos, com o número do calçado que contém o valor inválido no erro.
CREATE OR REPLACE FUNCTION public.tg_guard_implausible_sole_spec()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_max        constant numeric := 50;
  v_field      text := NULL;
  v_val        numeric := NULL;
  v_json_field text;
  v_json_map   jsonb;
  v_size_key   text;
  v_text_value text;
BEGIN
  IF    COALESCE(NEW.lining_consumption_dm2, 0)         > v_max THEN v_field := 'lining_consumption_dm2';         v_val := NEW.lining_consumption_dm2;
  ELSIF COALESCE(NEW.insole_consumption_dm2, 0)         > v_max THEN v_field := 'insole_consumption_dm2';         v_val := NEW.insole_consumption_dm2;
  ELSIF COALESCE(NEW.insole_lining_consumption_dm2, 0)  > v_max THEN v_field := 'insole_lining_consumption_dm2';  v_val := NEW.insole_lining_consumption_dm2;
  ELSIF COALESCE(NEW.fachete_lining_consumption_dm2, 0) > v_max THEN v_field := 'fachete_lining_consumption_dm2'; v_val := NEW.fachete_lining_consumption_dm2;
  END IF;

  IF v_field IS NOT NULL THEN
    RAISE EXCEPTION
      'Consumo implausível: sole_technical_specs.% = % dm2/par (size %) excede o teto de % dm2/par. Consumo real por numeração fica ~2 a 10 dm2/par - confira unidade e digitação.',
      v_field, v_val, NEW.size, v_max
      USING ERRCODE = 'check_violation',
            HINT = 'Se for realmente intencional, ajuste o teto em tg_guard_implausible_sole_spec.';
  END IF;

  FOREACH v_json_field IN ARRAY ARRAY[
    'lining_consumption_per_size',
    'insole_consumption_per_size',
    'insole_lining_consumption_per_size',
    'fachete_lining_consumption_per_size'
  ] LOOP
    v_json_map := CASE v_json_field
      WHEN 'lining_consumption_per_size' THEN NEW.lining_consumption_per_size
      WHEN 'insole_consumption_per_size' THEN NEW.insole_consumption_per_size
      WHEN 'insole_lining_consumption_per_size' THEN NEW.insole_lining_consumption_per_size
      WHEN 'fachete_lining_consumption_per_size' THEN NEW.fachete_lining_consumption_per_size
    END;

    FOR v_size_key, v_text_value IN
      SELECT key, value
      FROM jsonb_each_text(
        CASE WHEN jsonb_typeof(v_json_map) = 'object' THEN v_json_map ELSE '{}'::jsonb END
      )
    LOOP
      v_val := v_text_value::numeric;
      IF v_val > v_max THEN
        RAISE EXCEPTION
          'Consumo implausível: sole_technical_specs.% = % dm2/par (size %) excede o teto de % dm2/par. Consumo real por numeração fica ~2 a 10 dm2/par - confira unidade e digitação.',
          v_json_field, v_val, v_size_key, v_max
          USING ERRCODE = 'check_violation',
                HINT = 'Se for realmente intencional, ajuste o teto em tg_guard_implausible_sole_spec.';
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_guard_implausible_sole_spec ON public.sole_technical_specs;
CREATE TRIGGER tg_guard_implausible_sole_spec
  BEFORE INSERT OR UPDATE ON public.sole_technical_specs
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_implausible_sole_spec();

-- Diagnóstico da UI: o mapa canônico vence o escalar legado para cada tamanho.
DROP FUNCTION IF EXISTS public.list_missing_sole_consumption_sizes(uuid);
CREATE OR REPLACE FUNCTION public.list_missing_sole_consumption_sizes(p_sole_id uuid)
RETURNS TABLE (
  size integer,
  missing_lining boolean,
  missing_insole boolean,
  missing_fachete boolean,
  is_fachetado boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT
    sts.size,
    COALESCE(
      NULLIF((public.get_sole_consumption_per_size(p_sole_id, 'lining_consumption_per_size') ->> sts.size::text)::numeric, 0),
      NULLIF(sts.lining_consumption_dm2, 0),
      0
    ) <= 0 AS missing_lining,
    COALESCE(
      NULLIF((public.get_sole_consumption_per_size(p_sole_id, 'insole_consumption_per_size') ->> sts.size::text)::numeric, 0),
      NULLIF(sts.insole_consumption_dm2, 0),
      0
    ) <= 0 AS missing_insole,
    p.is_fachetado AND COALESCE(
      NULLIF((public.get_sole_consumption_per_size(p_sole_id, 'fachete_lining_consumption_per_size') ->> sts.size::text)::numeric, 0),
      NULLIF(sts.fachete_lining_consumption_dm2, 0),
      0
    ) <= 0 AS missing_fachete,
    COALESCE(p.is_fachetado, false) AS is_fachetado
  FROM products p
  JOIN sole_technical_specs sts ON sts.sole_id = p.id
  WHERE p.id = p_sole_id
  ORDER BY sts.size;
$function$;

GRANT EXECUTE ON FUNCTION public.list_missing_sole_consumption_sizes(uuid) TO authenticated;

-- Reaplica somente os dois checks de specs de solado do diagnóstico vivo. O
-- corpo é ancorado para preservar todos os outros checks acrescentados antes.
DO $do$
DECLARE
  v_definition text;
  v_before text;
  v_old_fachete constant text := $needle$
  RETURN QUERY SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p WHERE p.is_fachetado = true AND lower(COALESCE(p.category,'')) LIKE '%solado%'
      AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2,0) > 0);
$needle$;
  v_new_fachete constant text := $replacement$
  RETURN QUERY SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p WHERE p.is_fachetado = true AND lower(COALESCE(p.category,'')) LIKE '%solado%'
      AND NOT COALESCE(
        (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
           FROM jsonb_each_text(public.get_sole_consumption_per_size(
             p.id, 'fachete_lining_consumption_per_size'
           )) kv),
        EXISTS (
          SELECT 1 FROM public.sole_technical_specs sts
          WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
        )
      );
$replacement$;
  v_old_lining constant text := $needle$
  RETURN QUERY
  SELECT 'forro_cabedal_duplicado_com_palmilha'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE COALESCE(ts.sole_drives_consumption,false) = true
     AND COALESCE(ts.lining_consumption,0) > 0
     AND ts.primary_sole_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.insole_lining_consumption_dm2,0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.lining_consumption_dm2,0) > 0);
$needle$;
  v_new_lining constant text := $replacement$
  RETURN QUERY
  SELECT 'forro_cabedal_duplicado_com_palmilha'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE COALESCE(ts.sole_drives_consumption,false) = true
     AND COALESCE(ts.lining_consumption,0) > 0
     AND ts.primary_sole_id IS NOT NULL
     AND COALESCE(
       (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
          FROM jsonb_each_text(public.get_sole_consumption_per_size(
            ts.primary_sole_id, 'insole_lining_consumption_per_size'
          )) kv),
       EXISTS (
         SELECT 1 FROM public.sole_technical_specs sts
         WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.insole_lining_consumption_dm2, 0) > 0
       )
     )
     AND NOT COALESCE(
       (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
          FROM jsonb_each_text(public.get_sole_consumption_per_size(
            ts.primary_sole_id, 'lining_consumption_per_size'
          )) kv),
       EXISTS (
         SELECT 1 FROM public.sole_technical_specs sts
         WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.lining_consumption_dm2, 0) > 0
       )
     );
$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.consumption_consistency_report()'::regprocedure)
    INTO v_definition;

  v_before := v_definition;
  v_definition := replace(v_definition, v_old_fachete, v_new_fachete);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'Âncora de fachete não encontrada em consumption_consistency_report';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, v_old_lining, v_new_lining);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'Âncora de forro não encontrada em consumption_consistency_report';
  END IF;

  EXECUTE v_definition;
END;
$do$;

-- Backfill conservador: as cinco fichas conhecidas tinham o mapa de palmilha
-- preenchido antes de o tipo de solado ganhar esta fonte canônica. Para cada cor
-- já usada pela referência, resolve pelo mesmo resolve_sole_color do motor.
-- Não sobrescreve um mapa já cadastrado e não aborta a migration em lacunas.
DO $do$
DECLARE
  v_sheet record;
  v_color record;
  v_sole_product_id uuid;
  v_rows integer;
BEGIN
  FOR v_sheet IN
    SELECT id, name, insole_consumption_per_size
    FROM public.technical_sheets
    WHERE name IN ('NL01', 'NL02', 'NL03', 'NL04', 'ST15')
      AND COALESCE(insole_consumption_per_size, '{}'::jsonb) <> '{}'::jsonb
  LOOP
    FOR v_color IN
      SELECT DISTINCT COALESCE(soi.color, '') AS color
      FROM public.sale_order_items soi
      WHERE soi.reference_id = v_sheet.id
      UNION
      SELECT ''
      WHERE NOT EXISTS (
        SELECT 1 FROM public.sale_order_items soi WHERE soi.reference_id = v_sheet.id
      )
    LOOP
      SELECT rsc.sole_product_id
        INTO v_sole_product_id
      FROM public.resolve_sole_color(v_sheet.id, v_color.color) rsc;

      IF v_sole_product_id IS NULL THEN
        RAISE NOTICE 'Backfill de % ignorado: nenhum solado resolvido para a cor "%"', v_sheet.name, v_color.color;
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = v_sole_product_id
      ) THEN
        RAISE NOTICE 'Backfill de % ignorado: solado % não possui sole_technical_specs', v_sheet.name, v_sole_product_id;
        CONTINUE;
      END IF;

      UPDATE public.sole_technical_specs sts
         SET insole_consumption_per_size = v_sheet.insole_consumption_per_size
       WHERE sts.sole_id = v_sole_product_id
         AND (
           sts.insole_consumption_per_size IS NULL
           OR sts.insole_consumption_per_size = '{}'::jsonb
         );
      GET DIAGNOSTICS v_rows = ROW_COUNT;

      RAISE NOTICE 'Backfill de % para solado %: % specs atualizadas',
        v_sheet.name, v_sole_product_id, v_rows;
    END LOOP;
  END LOOP;
END;
$do$;
