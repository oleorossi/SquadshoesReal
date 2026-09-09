-- Prontidão industrial: com sole_drives_consumption, consumo de forração
-- (cabedal ou palmilha) e fibra/placa de palmilha vem do solado
-- (sole_technical_specs), não dos escalares da ficha.
--
-- Bug (PV-00169 / ref. 190):
--   missing_lining_consumption e sole_driven_but_specs_missing só isentavam /
--   validavam lining_consumption_dm2 (forro do CABEDAL). Ignoravam
--   insole_lining_consumption_dm2 (forração da palmilha), então a auditoria
--   pedia "Consumo da forração" na ficha mesmo com specs no solado — divergindo
--   do motor (suppressCabedalForracao) e da UI ("Consumo por número no solado").
--
-- Regra após este patch:
--   * sole_drives → NÃO exigir lining_consumption / insole_consumption na ficha;
--   * gap real de forração no solado = lining_dm2 OU insole_lining_dm2;
--   * grupo da forração (lining_material) continua obrigatório quando o solado
--     tem forro de cabedal OU forração de palmilha (identidade do material).

BEGIN;

DO $patch_lining_via_sole$
DECLARE
  v_view regclass := to_regclass('public.v_technical_sheets_audit');
  v_definition text;
  v_patched text;
  v_next text;
  v_anchor text;
  v_replacement text;
  v_occurrences integer;
BEGIN
  IF v_view IS NULL THEN
    RAISE EXCEPTION 'Preflight: view v_technical_sheets_audit ausente';
  END IF;

  v_definition := pg_get_viewdef(v_view, true);

  -- Já aplicado por completo → só garante security_invoker e sai.
  IF position('sole_has_insole_lining_specs' IN v_definition) > 0
     AND position(
       'NOT COALESCE(sp.sole_has_insole_lining_specs, false)'
       IN v_definition
     ) > 0
     AND v_definition !~ 'OR NOT COALESCE\(sp\.sole_has_lining_specs'
     AND v_definition !~ 'OR NOT COALESCE\(sp\.sole_has_insole_specs'
  THEN
    ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);
    RETURN;
  END IF;

  v_patched := v_definition;

  -- 1) sole_profile: expor sole_has_insole_lining_specs
  IF position('sole_has_insole_lining_specs' IN v_patched) = 0 THEN
    v_anchor := 'AS sole_has_insole_specs';
    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: esperava 1 sole_has_insole_specs, encontrou %',
        v_occurrences;
    END IF;

    v_replacement :=
      $new$AS sole_has_insole_specs,
    bool_or(EXISTS (
      SELECT 1 FROM public.sole_technical_specs sts
       WHERE sts.sole_id = ss.sole_product_id
         AND COALESCE(sts.insole_lining_consumption_dm2, 0) > 0
    )) AS sole_has_insole_lining_specs$new$;
    v_patched := replace(v_patched, v_anchor, v_replacement);
  END IF;

  -- 2) missing_lining_material: grupo também quando solado tem forração de palmilha.
  -- pg_get_viewdef costuma omitir os parênteses do AND (AND > OR); aceitar as duas formas.
  IF position(
       'OR COALESCE(sp.sole_has_insole_lining_specs, false)'
       IN v_patched
     ) = 0 THEN
    v_anchor :=
      $old$COALESCE(ts.sole_drives_consumption, false) AND COALESCE(sp.sole_has_lining_specs, false)$old$;
    v_replacement :=
      $new$COALESCE(ts.sole_drives_consumption, false) AND (
        COALESCE(sp.sole_has_lining_specs, false)
        OR COALESCE(sp.sole_has_insole_lining_specs, false)
      )$new$;
    IF position(v_anchor IN v_patched) = 0 THEN
      v_anchor :=
        $old$(COALESCE(ts.sole_drives_consumption, false) AND COALESCE(sp.sole_has_lining_specs, false))$old$;
      v_replacement :=
        $new$(COALESCE(ts.sole_drives_consumption, false) AND (
          COALESCE(sp.sole_has_lining_specs, false)
          OR COALESCE(sp.sole_has_insole_lining_specs, false)
        ))$new$;
    END IF;
    IF position(v_anchor IN v_patched) = 0 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: missing_lining_material sem ancora nem insole_lining';
    END IF;
    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: esperava 1 missing_lining_material sole_has_lining, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_anchor, v_replacement);
  END IF;

  -- 3) missing_lining_consumption: com sole_drives, consumo NÃO mora na ficha
  v_anchor :=
    $old$(NOT COALESCE(ts.sole_drives_consumption, false) OR NOT COALESCE(sp.sole_has_lining_specs, false))$old$;
  IF position(v_anchor IN v_patched) > 0 THEN
    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: esperava 1 isencao lining_consumption, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(
      v_patched,
      v_anchor,
      'NOT COALESCE(ts.sole_drives_consumption, false)'
    );
  END IF;

  -- 4) missing_insole_consumption: mesma regra para fibra/placa
  v_anchor :=
    $old$(NOT COALESCE(ts.sole_drives_consumption, false) OR NOT COALESCE(sp.sole_has_insole_specs, false))$old$;
  IF position(v_anchor IN v_patched) > 0 THEN
    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: esperava 1 isencao insole_consumption, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(
      v_patched,
      v_anchor,
      'NOT COALESCE(ts.sole_drives_consumption, false)'
    );
  END IF;

  -- 5) sole_driven_but_specs_missing — ramo forração: lining OU insole_lining.
  -- Forma viva observada: uma linha só, com casts ''::text / 0::numeric.
  IF position(
       'NOT COALESCE(sp.sole_has_insole_lining_specs, false)'
       IN v_patched
     ) = 0 THEN
    v_anchor :=
      $old$COALESCE(ts.lining_material, ''::text) <> ''::text AND NOT COALESCE(sp.sole_has_lining_specs, false) AND COALESCE(ts.lining_consumption, 0::numeric) <= 0::numeric$old$;
    v_replacement :=
      $new$COALESCE(ts.lining_material, ''::text) <> ''::text AND NOT COALESCE(sp.sole_has_lining_specs, false) AND NOT COALESCE(sp.sole_has_insole_lining_specs, false) AND COALESCE(ts.lining_consumption, 0::numeric) <= 0::numeric$new$;

    IF position(v_anchor IN v_patched) = 0 THEN
      v_anchor :=
        $old$COALESCE(ts.lining_material, '') <> '' AND NOT COALESCE(sp.sole_has_lining_specs, false) AND COALESCE(ts.lining_consumption, 0) <= 0$old$;
      v_replacement :=
        $new$COALESCE(ts.lining_material, '') <> '' AND NOT COALESCE(sp.sole_has_lining_specs, false) AND NOT COALESCE(sp.sole_has_insole_lining_specs, false) AND COALESCE(ts.lining_consumption, 0) <= 0$new$;
    END IF;

    IF position(v_anchor IN v_patched) = 0 THEN
      v_anchor :=
        $old$COALESCE(ts.lining_material, ''::text) <> ''::text
        AND NOT COALESCE(sp.sole_has_lining_specs, false)
        AND COALESCE(ts.lining_consumption, 0::numeric) <= 0::numeric$old$;
      v_replacement :=
        $new$COALESCE(ts.lining_material, ''::text) <> ''::text
        AND NOT COALESCE(sp.sole_has_lining_specs, false)
        AND NOT COALESCE(sp.sole_has_insole_lining_specs, false)
        AND COALESCE(ts.lining_consumption, 0::numeric) <= 0::numeric$new$;
    END IF;

    IF position(v_anchor IN v_patched) = 0 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: ancora do ramo lining de sole_driven_but_specs_missing nao encontrada';
    END IF;

    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch forracao/solado recusado: esperava 1 ramo lining sole_driven, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_anchor, v_replacement);
  END IF;

  IF v_patched IS DISTINCT FROM v_definition THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS '
      || v_patched;
  END IF;

  ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

  v_next := pg_get_viewdef(v_view, true);
  IF position('sole_has_insole_lining_specs' IN v_next) = 0 THEN
    RAISE EXCEPTION
      'Regressao: sole_has_insole_lining_specs nao entrou em v_technical_sheets_audit';
  END IF;
  IF v_next ~ 'OR NOT COALESCE\(sp\.sole_has_lining_specs' THEN
    RAISE EXCEPTION
      'Regressao: missing_lining_consumption ainda exige specs de cabedal na ficha';
  END IF;
  IF v_next ~ 'OR NOT COALESCE\(sp\.sole_has_insole_specs' THEN
    RAISE EXCEPTION
      'Regressao: missing_insole_consumption ainda exige specs de fibra na ficha';
  END IF;
  IF position(
       'NOT COALESCE(sp.sole_has_insole_lining_specs, false)'
       IN v_next
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressao: sole_driven_but_specs_missing nao considera forracao de palmilha';
  END IF;
  IF position('requires_cutting_cabedal' IN v_next) > 0 THEN
    RAISE EXCEPTION
      'Regressao de seguranca: patch reintroduziu requires_cutting_cabedal';
  END IF;
END
$patch_lining_via_sole$;

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Prontidao industrial: com sole_drives_consumption, consumo de forracao/fibra vem do solado (lining_dm2 / insole_lining_dm2 / insole_dm2); a ficha so escolhe grupo/cor. Cabedal+tiras seguem sinais vivos (15100).';

COMMIT;
