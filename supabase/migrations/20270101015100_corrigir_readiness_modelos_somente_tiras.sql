-- Corrige a prontidao de referencias cujo cabedal e inteiramente formado por
-- tiras. A migration 14675 separou cabedal de tiras corretamente, mas usou
-- `requires_cutting_cabedal` como prova de cabedal. Essa coluna e um derivado
-- legado de `construction_type` e ficou true em fichas publicadas que hoje sao
-- roteadas sem Corte/Costura Cabedal (SP130, M100, S-039 e outras).
--
-- Fonte de verdade desta correcao:
--   * tiras configuradas NAO eliminam um cabedal real;
--   * cabedal real e indicado por identidade/consumo/adicional estrutural ou
--     por Corte Cabedal/Costura Cabedal no roteiro vivo;
--   * sem esses sinais, uma ficha com tiras e somente-tiras, mesmo que flags
--     legadas continuem true;
--   * cabedal e tiras continuam aditivos nos motores e no relatorio de compra.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Auditoria/readiness: troca flag armazenada por sinais e roteiro vivos.
-- --------------------------------------------------------------------------

DO $patch_upper_readiness$
DECLARE
  v_view regclass := to_regclass('public.v_technical_sheets_audit');
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_legacy_flag constant text :=
    $old$COALESCE(ts.requires_cutting_cabedal, false)$old$;
  v_live_base_intent constant text :=
    $new$(
      NOT (
        COALESCE(ts.has_straps, false)
        OR jsonb_array_length(
          CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'::text
            THEN ts.strap_colors ELSE '[]'::jsonb END
        ) > 0
      )
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(ts.production_sectors) = 'array'::text
              THEN ts.production_sectors ELSE '[]'::jsonb END
          ) AS upper_sector(value)
         WHERE lower(btrim(upper_sector.value)) IN (
           'corte cabedal', 'costura cabedal'
         )
      )
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ts.components_accessories) = 'array'::text
              THEN ts.components_accessories ELSE '[]'::jsonb END
          ) AS upper_accessory(value)
         WHERE NULLIF(btrim(COALESCE(upper_accessory.value ->> 'id', '')), '') IS NULL
           AND (
             NULLIF(btrim(COALESCE(upper_accessory.value ->> 'material', '')), '') IS NOT NULL
             OR NULLIF(btrim(COALESCE(upper_accessory.value ->> 'product_id', '')), '') IS NOT NULL
             OR (
               COALESCE(upper_accessory.value ->> 'consumption', '')
                 ~ '^[0-9]+([.,][0-9]+)?$'
               AND replace(
                 upper_accessory.value ->> 'consumption', ',', '.'
               )::numeric > 0
             )
             OR EXISTS (
               SELECT 1
                 FROM jsonb_each_text(
                   CASE WHEN jsonb_typeof(
                     upper_accessory.value -> 'consumption_per_size'
                   ) = 'object'::text
                     THEN upper_accessory.value -> 'consumption_per_size'
                     ELSE '{}'::jsonb END
                 ) AS accessory_size(key, value)
                WHERE accessory_size.value ~ '^[0-9]+([.,][0-9]+)?$'
                  AND replace(accessory_size.value, ',', '.')::numeric > 0
             )
           )
      )
    )$new$;
  v_nonempty_per_size constant text :=
    $old$ts.upper_consumption_per_size IS NOT NULL AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'::text AND ts.upper_consumption_per_size <> '{}'::jsonb$old$;
  v_positive_per_size constant text :=
    $new$EXISTS (
      SELECT 1
        FROM jsonb_each_text(
          CASE WHEN jsonb_typeof(ts.upper_consumption_per_size) = 'object'::text
            THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END
        ) AS upper_size(key, value)
       WHERE upper_size.value ~ '^[0-9]+([.,][0-9]+)?$'
         AND replace(upper_size.value, ',', '.')::numeric > 0
    )$new$;
  v_empty_per_size constant text :=
    $old$(ts.upper_consumption_per_size IS NULL OR ts.upper_consumption_per_size = '{}'::jsonb)$old$;
  v_no_positive_per_size constant text :=
    $new$NOT EXISTS (
      SELECT 1
        FROM jsonb_each_text(
          CASE WHEN jsonb_typeof(ts.upper_consumption_per_size) = 'object'::text
            THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END
        ) AS upper_size_missing(key, value)
       WHERE upper_size_missing.value ~ '^[0-9]+([.,][0-9]+)?$'
         AND replace(upper_size_missing.value, ',', '.')::numeric > 0
    )$new$;
BEGIN
  IF v_view IS NULL THEN
    RAISE EXCEPTION 'Preflight: view v_technical_sheets_audit ausente';
  END IF;

  v_definition := pg_get_viewdef(v_view, true);
  IF position('requires_cutting_cabedal' IN v_definition) > 0 THEN
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_legacy_flag, ''))
    ) / length(v_legacy_flag);
    IF v_occurrences <> 2 THEN
      RAISE EXCEPTION
        'Patch readiness recusado: esperava 2 flags legadas, encontrou %',
        v_occurrences;
    END IF;

    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_nonempty_per_size, ''))
    ) / length(v_nonempty_per_size);
    IF v_occurrences <> 3 THEN
      RAISE EXCEPTION
        'Patch readiness recusado: esperava 3 checks de mapa nao vazio, encontrou %',
        v_occurrences;
    END IF;

    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_empty_per_size, ''))
    ) / length(v_empty_per_size);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch readiness recusado: esperava 1 check de mapa vazio, encontrou %',
        v_occurrences;
    END IF;

    v_patched := replace(v_definition, v_legacy_flag, v_live_base_intent);
    v_patched := replace(v_patched, v_nonempty_per_size, v_positive_per_size);
    v_patched := replace(v_patched, v_empty_per_size, v_no_positive_per_size);

    EXECUTE 'CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS '
      || v_patched;
  END IF;

  ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

  v_definition := pg_get_viewdef(v_view, true);
  IF position('requires_cutting_cabedal' IN v_definition) > 0
     OR position('production_sectors' IN v_definition) = 0
     OR position('components_accessories' IN v_definition) = 0
     OR position('strap_colors' IN v_definition) = 0
     OR position('upper_size_missing' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Regressao: readiness nao ficou baseado em tiras, roteiro e sinais vivos';
  END IF;
END
$patch_upper_readiness$;

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Prontidao industrial: somente-tiras e inferido por tiras configuradas sem sinais/rota de cabedal; cabedal+tiras permanece aditivo. Flags legadas de construction_type nao decidem readiness.';

-- --------------------------------------------------------------------------
-- 2. Atualiza a guarda permanente da suite exibida em /diagnostics.
-- --------------------------------------------------------------------------

DO $patch_parity_guard$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.run_consumption_parity_tests()'
  );
  v_definition text;
  v_patched text;
  v_anchor constant text :=
    $old$) ILIKE '%requires_cutting_cabedal%'$old$;
  v_replacement constant text :=
    $new$) NOT ILIKE '%requires_cutting_cabedal%'
    AND pg_get_viewdef(
          'public.v_technical_sheets_audit'::regclass, true
        ) ILIKE '%production_sectors%'
    AND pg_get_viewdef(
          'public.v_technical_sheets_audit'::regclass, true
        ) ILIKE '%components_accessories%'
    AND pg_get_viewdef(
          'public.v_technical_sheets_audit'::regclass, true
        ) ILIKE '%strap_colors%'$new$;
  v_old_message constant text :=
    $old$message := 'readiness nao pode usar tiras para dispensar cabedal com intencao propria'; RETURN NEXT;$old$;
  v_new_message constant text :=
    $new$message := 'readiness usa tiras, roteiro vivo e sinais estruturais; flag legada nao decide cabedal'; RETURN NEXT;$new$;
  v_occurrences integer;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: run_consumption_parity_tests() ausente';
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position(v_anchor IN v_definition) > 0 THEN
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 OR position(v_old_message IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Patch da guarda readiness encontrou contrato inesperado';
    END IF;

    v_patched := replace(v_definition, v_anchor, v_replacement);
    v_patched := replace(v_patched, v_old_message, v_new_message);
    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position(v_new_message IN v_definition) = 0
     OR position(v_anchor IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Regressao: guarda permanente de readiness nao foi atualizada';
  END IF;
END
$patch_parity_guard$;

-- --------------------------------------------------------------------------
-- 3. Regressao viva: todas as fichas somente-tiras publicadas precisam ficar
--    livres dos dois falsos blockers, sem afrouxar fichas mistas.
-- --------------------------------------------------------------------------

DO $live_regression$
DECLARE
  v_false_blockers text;
  v_mixed_missing text;
  v_failures text;
BEGIN
  SELECT string_agg(ts.name, ', ' ORDER BY ts.name)
    INTO v_false_blockers
    FROM public.technical_sheets ts
    JOIN public.v_technical_sheets_audit audit ON audit.id = ts.id
   WHERE ts.status_ficha = 'publicada'
     AND (
       COALESCE(ts.has_straps, false)
       OR jsonb_array_length(
         CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
           THEN ts.strap_colors ELSE '[]'::jsonb END
       ) > 0
     )
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(ts.production_sectors) = 'array'
             THEN ts.production_sectors ELSE '[]'::jsonb END
         ) AS sector(value)
        WHERE lower(btrim(sector.value)) IN (
          'corte cabedal', 'costura cabedal'
        )
     )
     AND NULLIF(btrim(COALESCE(ts.upper_material, '')), '') IS NULL
     AND ts.upper_material_group_id IS NULL
     AND ts.upper_material_product_id IS NULL
     AND COALESCE(ts.upper_consumption, 0) <= 0
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each_text(
           CASE WHEN jsonb_typeof(ts.upper_consumption_per_size) = 'object'
             THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END
         ) AS size_value(key, value)
        WHERE size_value.value ~ '^[0-9]+([.,][0-9]+)?$'
          AND replace(size_value.value, ',', '.')::numeric > 0
     )
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(ts.components_accessories) = 'array'
             THEN ts.components_accessories ELSE '[]'::jsonb END
         ) AS accessory(value)
        WHERE NULLIF(btrim(COALESCE(accessory.value ->> 'id', '')), '') IS NULL
          AND (
            NULLIF(btrim(COALESCE(accessory.value ->> 'material', '')), '') IS NOT NULL
            OR NULLIF(btrim(COALESCE(accessory.value ->> 'product_id', '')), '') IS NOT NULL
            OR (
              COALESCE(accessory.value ->> 'consumption', '')
                ~ '^[0-9]+([.,][0-9]+)?$'
              AND replace(accessory.value ->> 'consumption', ',', '.')::numeric > 0
            )
            OR EXISTS (
              SELECT 1
                FROM jsonb_each_text(
                  CASE WHEN jsonb_typeof(
                    accessory.value -> 'consumption_per_size'
                  ) = 'object'
                    THEN accessory.value -> 'consumption_per_size'
                    ELSE '{}'::jsonb END
                ) AS accessory_size(key, value)
               WHERE accessory_size.value ~ '^[0-9]+([.,][0-9]+)?$'
                 AND replace(accessory_size.value, ',', '.')::numeric > 0
            )
          )
     )
     AND (audit.missing_upper_material OR audit.missing_upper_consumption);

  IF v_false_blockers IS NOT NULL THEN
    RAISE EXCEPTION
      'Regressao somente-tiras: blockers de cabedal persistem em %',
      v_false_blockers;
  END IF;

  -- Caso misto vivo, quando presente: identidade + consumo continuam exigidos
  -- e validos mesmo com tiras. Nao existe escolha exclusiva entre os fluxos.
  SELECT string_agg(ts.name, ', ' ORDER BY ts.name)
    INTO v_mixed_missing
    FROM public.technical_sheets ts
    JOIN public.v_technical_sheets_audit audit ON audit.id = ts.id
   WHERE ts.status_ficha = 'publicada'
     AND COALESCE(ts.has_straps, false)
     AND NULLIF(btrim(COALESCE(ts.upper_material, '')), '') IS NOT NULL
     AND COALESCE(ts.upper_consumption, 0) > 0
     AND (audit.missing_upper_material OR audit.missing_upper_consumption);

  IF v_mixed_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Regressao cabedal+tiras: cadastro completo ficou bloqueado em %',
      v_mixed_missing;
  END IF;

  SELECT string_agg(case_name || ' -> ' || COALESCE(message, ''), ' | ')
    INTO v_failures
    FROM public.run_consumption_parity_tests()
   WHERE NOT ok
     AND case_name IN (
       'cabedal_e_tiras_coexistem_no_pv',
       'routing_tiras_preserva_cabedal_real',
       'readiness_cabedal_tiras_independentes'
     );
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Guardas cabedal/tiras falharam: %', v_failures;
  END IF;
END
$live_regression$;

-- Preserva a fronteira de seguranca documentada para views publicas.
ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

COMMIT;
