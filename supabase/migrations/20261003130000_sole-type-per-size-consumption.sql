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
