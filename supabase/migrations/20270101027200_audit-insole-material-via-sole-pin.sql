-- Auditoria industrial: não exigir Grupo da palmilha na ficha quando o
-- Consumo Padrão do solado já pinua a fibra (placa_palmilha.material_product_id).
--
-- Bug (PV-00197 / ref. DS53):
--   missing_insole_material = insole_material vazio AND NOT insole_ready_made.
--   A UI de "Fibra / placa" foi removida da ficha (material mora no solado), e
--   resolve_insole_material_for_variant já resolve via pin do solado mesmo com
--   grupo da ficha vazio — mas a auditoria ainda bloqueava o promote do PV.
--
-- Regra após este patch:
--   * pin placa_palmilha no sole_group → ficha NÃO precisa de insole_material;
--   * sem pin e sem grupo na ficha → continua missing_insole_material.

BEGIN;

DO $patch_insole_via_sole_pin$
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

  -- Já aplicado → só garante security_invoker e sai.
  IF v_definition ~ 'role = ''placa_palmilha'''
     AND position('missing_insole_material' IN v_definition) > 0
     AND position('sole_group_standard_items' IN v_definition) > 0
  THEN
    ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);
    RETURN;
  END IF;

  v_patched := v_definition;

  -- Forma viva do deparse (casts tipados).
  v_anchor :=
    $old$NOT COALESCE(ts.insole_ready_made, false) AND COALESCE(ts.insole_material, ''::text) = ''::text AS missing_insole_material$old$;
  v_replacement :=
    $new$NOT COALESCE(ts.insole_ready_made, false)
    AND COALESCE(ts.insole_material, ''::text) = ''::text
    AND NOT EXISTS (
      SELECT 1
        FROM public.sole_group_standard_items sgsi
       WHERE sgsi.sole_group_id = ts.sole_group_id
         AND sgsi.role = 'placa_palmilha'
         AND sgsi.material_product_id IS NOT NULL
    ) AS missing_insole_material$new$;

  IF position(v_anchor IN v_patched) = 0 THEN
    v_anchor :=
      $old$NOT COALESCE(ts.insole_ready_made, false) AND COALESCE(ts.insole_material, '') = '' AS missing_insole_material$old$;
    v_replacement :=
      $new$NOT COALESCE(ts.insole_ready_made, false)
      AND COALESCE(ts.insole_material, '') = ''
      AND NOT EXISTS (
        SELECT 1
          FROM public.sole_group_standard_items sgsi
         WHERE sgsi.sole_group_id = ts.sole_group_id
           AND sgsi.role = 'placa_palmilha'
           AND sgsi.material_product_id IS NOT NULL
      ) AS missing_insole_material$new$;
  END IF;

  IF position(v_anchor IN v_patched) = 0 THEN
    RAISE EXCEPTION
      'Patch insole via sole pin recusado: ancora de missing_insole_material nao encontrada';
  END IF;

  v_occurrences := (
    length(v_patched) - length(replace(v_patched, v_anchor, ''))
  ) / length(v_anchor);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Patch insole via sole pin recusado: esperava 1 missing_insole_material, encontrou %',
      v_occurrences;
  END IF;

  v_patched := replace(v_patched, v_anchor, v_replacement);

  EXECUTE 'CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS '
    || v_patched;

  ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

  v_next := pg_get_viewdef(v_view, true);
  IF position('placa_palmilha' IN v_next) = 0
     OR v_next !~ 'role = ''placa_palmilha'''
     OR position('material_product_id IS NOT NULL' IN v_next) = 0 THEN
    RAISE EXCEPTION
      'Regressao: missing_insole_material nao isenta via pin placa_palmilha do solado';
  END IF;
END
$patch_insole_via_sole_pin$;

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Prontidao industrial: com pin placa_palmilha no Consumo Padrao do solado, grupo da palmilha na ficha e opcional; consumo de forracao/fibra via solado quando sole_drives.';

-- Guard: DS53 (ou qualquer ficha publicada no SOLADO 01 sem insole_material)
-- com pin de fibra nao pode mais acusar missing_insole_material.
DO $assert_ds53$
DECLARE
  v_still boolean;
BEGIN
  SELECT COALESCE(bool_or(a.missing_insole_material), false)
    INTO v_still
    FROM public.technical_sheets ts
    JOIN public.v_technical_sheets_audit a ON a.id = ts.id
   WHERE ts.id = 'a238ef80-5370-4468-88d1-6b9e66933dd1'::uuid
      OR (
        COALESCE(btrim(ts.insole_material), '') = ''
        AND NOT COALESCE(ts.insole_ready_made, false)
        AND ts.sole_group_id = '69c86aa8-57af-45e8-813f-19a1b50340d8'::uuid
        AND COALESCE(ts.status_ficha, '') = 'publicada'
      );

  IF v_still THEN
    RAISE EXCEPTION
      'Pos-condicao: ainda ha missing_insole_material com pin placa_palmilha no SOLADO 01';
  END IF;
END
$assert_ds53$;

COMMIT;
