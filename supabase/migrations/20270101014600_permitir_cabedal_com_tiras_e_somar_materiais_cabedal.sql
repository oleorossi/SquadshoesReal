-- Cabedal e tiras passam a ser dimensoes independentes da ficha tecnica.
--
-- Corrige dois defeitos do motor canonico de consumo:
--   1. `components_accessories` obrigatorios usavam somente a media escalar,
--      ignorando `consumption_per_size`;
--   2. um adicional que resolvia para o mesmo product_id do cabedal principal
--      era descartado pelo dedupe de BOM, em vez de ser somado.
--
-- Tambem remove o MUTEX residual nos tres writers/guards server-side do PV:
-- cabedal preenchido nao apaga mais `strap_colors`. Locks, snapshots, receitas,
-- identidade de tira e validacoes de origem permanecem inalterados.
--
-- Nao existe perda de corte neste sistema. A conversao de dm2 para a unidade
-- fisica continua sendo feita uma vez por contribuicao, sem fator adicional.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Helpers internos, puros e testaveis.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_component_accessory_required_by_grade(
  p_item jsonb,
  p_grade jsonb
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    COALESCE(
      public.pick_consumption_for_size(
        p_item -> 'consumption_per_size',
        grade.key
      ),
      NULLIF(p_item ->> 'consumption', '')::numeric,
      0
    ) * grade.value::numeric
  ), 0)::numeric
  FROM jsonb_each_text(
    CASE WHEN jsonb_typeof(p_grade) = 'object'
      THEN p_grade ELSE '{}'::jsonb END
  ) AS grade(key, value)
  WHERE grade.key ~ '^[0-9]+(/[0-9]+)?$'
    AND grade.value::numeric > 0;
$$;

COMMENT ON FUNCTION
  public.calculate_component_accessory_required_by_grade(jsonb, jsonb)
IS
  'Calcula componente extra obrigatorio pela grade: consumption_per_size explicito (inclusive zero) vence o escalar; sem perda de corte.';

REVOKE ALL ON FUNCTION
  public.calculate_component_accessory_required_by_grade(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merge_consumption_required_by_product(
  p_lines jsonb,
  p_product_id uuid,
  p_additional_required numeric,
  p_total_qty numeric,
  p_available numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_index integer;
  v_required numeric;
BEGIN
  IF jsonb_typeof(p_lines) <> 'array'
     OR p_product_id IS NULL
     OR COALESCE(p_additional_required, 0) <= 0 THEN
    RETURN p_lines;
  END IF;

  SELECT (line.ordinality - 1)::integer
    INTO v_index
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY
      AS line(value, ordinality)
   WHERE line.value ->> 'product_id' = p_product_id::text
   ORDER BY line.ordinality
   LIMIT 1;

  IF v_index IS NULL THEN
    RETURN p_lines;
  END IF;

  v_required := COALESCE(
    (p_lines #>> ARRAY[v_index::text, 'required'])::numeric,
    0
  ) + p_additional_required;

  p_lines := jsonb_set(
    p_lines,
    ARRAY[v_index::text, 'required'],
    to_jsonb(v_required)
  );
  p_lines := jsonb_set(
    p_lines,
    ARRAY[v_index::text, 'consumption_per_unit'],
    to_jsonb(ROUND(v_required / NULLIF(p_total_qty, 0), 4))
  );
  p_lines := jsonb_set(
    p_lines,
    ARRAY[v_index::text, 'stock_ok'],
    to_jsonb(COALESCE(p_available, 0) >= v_required)
  );

  RETURN p_lines;
END;
$$;

COMMENT ON FUNCTION
  public.merge_consumption_required_by_product(jsonb, uuid, numeric, numeric, numeric)
IS
  'Soma uma contribuicao ja convertida a primeira linha do mesmo product_id, recalculando consumo unitario e disponibilidade.';

REVOKE ALL ON FUNCTION
  public.merge_consumption_required_by_product(jsonb, uuid, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. Motor canonico: adicional por grade e soma por product_id.
--
-- O patch parte de pg_get_functiondef para conservar todos os fixes posteriores
-- (variantes, cores, unidades, alertas, palmilha/forro e ausencia de perda).
-- O array `v_covered_product_ids` continua protegendo o BOM legado; apenas o
-- adicional obrigatorio deixa de ser confundido com uma copia do BOM.
-- --------------------------------------------------------------------------

DO $patch_by_grade$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_grade constant text :=
    $old$      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;$old$;
  v_new_grade constant text :=
    $new$      -- components_accessories_grade_additive_20270101014600
      v_required := public.calculate_component_accessory_required_by_grade(
        v_item, p_grade
      );
      IF v_required <= 0 THEN CONTINUE; END IF;$new$;
  v_old_gate constant text :=
    $old$      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN$old$;
  v_new_gate constant text :=
    $new$      IF v_pid IS NOT NULL THEN$new$;
  v_old_append constant text :=
    $old$          v_result := v_result || jsonb_build_object(
            'component', COALESCE(NULLIF(v_item ->> 'label', ''), 'Componente Extra (cabedal)'),
            'product_id', v_pid, 'product_name', v_row.name, 'color', p_color,
            'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required,
            'available', v_row.avail, 'stock_ok', v_row.avail >= v_required,
            'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,
            'conversion_warning', v_conv.conversion_warning);
          v_covered_product_ids := array_append(v_covered_product_ids, v_pid);$old$;
  v_new_append constant text :=
    $new$          IF EXISTS (
            SELECT 1
              FROM jsonb_array_elements(v_result) AS emitted(line)
             WHERE emitted.line ->> 'product_id' = v_pid::text
          ) THEN
            -- O principal e o adicional foram calculados e convertidos
            -- separadamente; aqui unificamos apenas a quantidade fisica.
            v_result := public.merge_consumption_required_by_product(
              v_result, v_pid, v_required, v_total_qty, v_row.avail
            );
          ELSE
            v_result := v_result || jsonb_build_object(
              'component', COALESCE(NULLIF(v_item ->> 'label', ''), 'Componente Extra (cabedal)'),
              'product_id', v_pid, 'product_name', v_row.name, 'color', p_color,
              'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required,
              'available', v_row.avail, 'stock_ok', v_row.avail >= v_required,
              'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,
              'conversion_warning', v_conv.conversion_warning);
            IF NOT (v_pid = ANY(v_covered_product_ids)) THEN
              v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
            END IF;
          END IF;$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION
      'Preflight: calculate_order_consumption_by_grade(uuid,jsonb,text,uuid) ausente';
  END IF;

  v_definition := pg_get_functiondef(v_function);

  IF position(
       'components_accessories_grade_additive_20270101014600'
       IN v_definition
     ) = 0 THEN
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_old_grade, ''))
    ) / length(v_old_grade);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch by_grade recusado: esperava 1 ancora do escalar do adicional, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(v_definition, v_old_grade, v_new_grade);

    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_old_gate, ''))
    ) / length(v_old_gate);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch by_grade recusado: esperava 1 gate de dedupe do adicional, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_gate, v_new_gate);

    v_occurrences := (
      length(v_patched) - length(replace(v_patched, v_old_append, ''))
    ) / length(v_old_append);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch by_grade recusado: esperava 1 emissao do adicional, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_append, v_new_append);

    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position(
       'components_accessories_grade_additive_20270101014600'
       IN v_definition
     ) = 0
     OR position(
       'calculate_component_accessory_required_by_grade'
       IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressao: by_grade nao calcula components_accessories pela grade';
  END IF;
  IF position('merge_consumption_required_by_product' IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Regressao: by_grade nao soma adicional ao product_id ja emitido';
  END IF;
END
$patch_by_grade$;

-- Fronteira viva original: funcao publica somente para usuarios autenticados
-- e service_role; nunca anon/PUBLIC. CREATE OR REPLACE preserva owner/ACL,
-- e as instrucoes abaixo tornam o contrato explicito.
REVOKE ALL ON FUNCTION
  public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid)
  TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. PV: remover o MUTEX cabedal x tiras nos tres pontos server-side.
-- --------------------------------------------------------------------------

DO $patch_strap_coexistence$
DECLARE
  v_target record;
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_sheet constant text :=
    $old$    WHEN nullif(btrim(coalesce(v_sheet.upper_material, '')), '') IS NOT NULL
      THEN '[]'::jsonb
    WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'$old$;
  v_new_sheet constant text :=
    $new$    -- upper_and_straps_coexist_20270101014600
    WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'$new$;
  v_old_enqueue constant text :=
    $old$                  WHEN nullif(btrim(coalesce(ts.upper_material, '')), '')
                         IS NOT NULL THEN '[]'::jsonb
                  WHEN jsonb_typeof(ts.strap_colors) = 'array'$old$;
  v_new_enqueue constant text :=
    $new$                  -- upper_and_straps_coexist_20270101014600
                  WHEN jsonb_typeof(ts.strap_colors) = 'array'$new$;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('public.prepare_sale_order_item_internal_straps(jsonb)'::text, v_old_sheet, v_new_sheet),
      ('public.tg_validate_sale_order_item_strap_color_alignment()'::text, v_old_sheet, v_new_sheet),
      ('public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::text, v_old_enqueue, v_new_enqueue)
    ) AS targets(signature, old_anchor, new_anchor)
  LOOP
    IF to_regprocedure(v_target.signature) IS NULL THEN
      RAISE EXCEPTION 'Preflight: funcao % ausente', v_target.signature;
    END IF;

    v_definition := pg_get_functiondef(to_regprocedure(v_target.signature));
    IF position('upper_and_straps_coexist_20270101014600' IN v_definition) = 0 THEN
      v_occurrences := (
        length(v_definition)
        - length(replace(v_definition, v_target.old_anchor, ''))
      ) / length(v_target.old_anchor);
      IF v_occurrences <> 1 THEN
        RAISE EXCEPTION
          'Patch de coexistencia recusado em %: esperava 1 MUTEX, encontrou %',
          v_target.signature, v_occurrences;
      END IF;
      v_patched := replace(
        v_definition, v_target.old_anchor, v_target.new_anchor
      );
      EXECUTE v_patched;
    END IF;

    v_definition := pg_get_functiondef(to_regprocedure(v_target.signature));
    IF position('upper_and_straps_coexist_20270101014600' IN v_definition) = 0
       OR position(v_target.old_anchor IN v_definition) > 0 THEN
      RAISE EXCEPTION
        'Regressao: % ainda exclui tiras quando ha cabedal',
        v_target.signature;
    END IF;
  END LOOP;
END
$patch_strap_coexistence$;

-- Estes tres pontos sao internos e continuam invocaveis apenas por postgres.
REVOKE ALL ON FUNCTION
  public.prepare_sale_order_item_internal_straps(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.tg_validate_sale_order_item_strap_color_alignment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.enqueue_sale_order_strap_demands(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 4. Roteiro: construction_type=tiras preserva o modo somente-tiras, mas nao
--    apaga Corte Cabedal quando a propria ficha possui consumo de cabedal.
--
-- Nao transformamos construction_type em `misto`: esse campo tambem carrega a
-- semantica de costura, que nao pode ser inventada a partir de consumo. A flag
-- de corte e derivada dos sinais reais e o usuario continua livre para escolher
-- `misto` quando o roteiro de costura tambem for combinado.
-- --------------------------------------------------------------------------

DO $patch_construction_routing$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.sync_construction_routing()'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old constant text :=
    $old$  ELSIF NEW.construction_type = 'tiras' THEN
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := false;
    NEW.requires_sewing := false;$old$;
  v_new constant text :=
    $new$  ELSIF NEW.construction_type = 'tiras' THEN
    NEW.requires_cutting := true;
    -- upper_and_straps_routing_20270101014600: somente-tiras continua false;
    -- qualquer identidade/consumo de cabedal ativa o seu proprio corte.
    NEW.requires_cutting_cabedal := (
      NULLIF(btrim(COALESCE(NEW.upper_material, '')), '') IS NOT NULL
      OR NEW.upper_material_group_id IS NOT NULL
      OR NEW.upper_material_product_id IS NOT NULL
      OR COALESCE(NEW.upper_consumption, 0) > 0
      OR EXISTS (
        SELECT 1
          FROM jsonb_each_text(
            CASE WHEN jsonb_typeof(NEW.upper_consumption_per_size) = 'object'
              THEN NEW.upper_consumption_per_size ELSE '{}'::jsonb END
          ) AS per_size(key, value)
         WHERE per_size.value ~ '^[0-9]+([.][0-9]+)?$'
           AND per_size.value::numeric > 0
      )
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(NEW.components_accessories) = 'array'
              THEN NEW.components_accessories ELSE '[]'::jsonb END
          ) AS accessory(value)
         WHERE lower(COALESCE(accessory.value ->> 'mandatory', 'false')) = 'true'
           AND (
             NULLIF(btrim(COALESCE(accessory.value ->> 'material', '')), '') IS NOT NULL
             OR NULLIF(accessory.value ->> 'product_id', '') IS NOT NULL
             OR COALESCE(NULLIF(accessory.value ->> 'consumption', '')::numeric, 0) > 0
             OR EXISTS (
               SELECT 1
                 FROM jsonb_each_text(
                   CASE WHEN jsonb_typeof(accessory.value -> 'consumption_per_size') = 'object'
                     THEN accessory.value -> 'consumption_per_size'
                     ELSE '{}'::jsonb END
                 ) AS accessory_size(key, value)
                WHERE accessory_size.value ~ '^[0-9]+([.][0-9]+)?$'
                  AND accessory_size.value::numeric > 0
             )
           )
      )
    );
    NEW.requires_sewing := false;$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: sync_construction_routing() ausente';
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('upper_and_straps_routing_20270101014600' IN v_definition) = 0 THEN
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_old, ''))
    ) / length(v_old);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch routing recusado: esperava 1 branch somente-tiras, encontrou %',
        v_occurrences;
    END IF;
    v_patched := replace(v_definition, v_old, v_new);
    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('upper_and_straps_routing_20270101014600' IN v_definition) = 0
     OR position('NEW.has_straps :=' IN v_definition) > 0 THEN
    RAISE EXCEPTION
      'Regressao: roteiro nao preserva cabedal+tiras ou voltou a controlar has_straps';
  END IF;
END
$patch_construction_routing$;

-- A derivacao precisa rodar quando o sinal de cabedal muda, nao apenas quando
-- construction_type muda. O mesmo nome conserva a ordem relativa do trigger.
DROP TRIGGER IF EXISTS trg_sync_construction_routing
  ON public.technical_sheets;
CREATE TRIGGER trg_sync_construction_routing
BEFORE INSERT OR UPDATE OF
  construction_type,
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  components_accessories
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.sync_construction_routing();

COMMENT ON FUNCTION public.sync_construction_routing() IS
  'Sincroniza roteiro sem tocar has_straps. Em construction_type=tiras, Corte Cabedal e derivado da identidade/consumo real; uma ficha somente de tiras continua sem esse corte.';

-- Preserva a ACL viva da funcao de trigger (postgres/authenticated/service_role)
-- e o search_path original. A execucao direta nao concede escrita: a funcao
-- retorna trigger e opera apenas como parte do trigger da tabela.
REVOKE ALL ON FUNCTION public.sync_construction_routing()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_construction_routing()
  TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5. Auditoria industrial: tiras nao dispensam um cabedal que possui intencao.
--
-- Uma ficha exclusivamente de tiras continua valida sem cabedal. Cabedal passa
-- a ser exigido quando existe identidade, consumo ou rota de corte de cabedal.
-- Os checks de tiras continuam independentes, governados por has_straps.
-- --------------------------------------------------------------------------

DO $patch_readiness$
DECLARE
  v_view regclass := to_regclass('public.v_technical_sheets_audit');
  v_definition text;
  v_patched text;
  v_anchor text;
  v_occurrences integer;
  v_old_material constant text :=
    $old$NOT COALESCE(ts.has_straps, false) AND COALESCE(ts.upper_material, ''::text) = ''::text$old$;
  v_new_material constant text :=
    $new$(
      COALESCE(ts.requires_cutting_cabedal, false)
      OR NULLIF(btrim(COALESCE(ts.upper_material, ''::text)), ''::text) IS NOT NULL
      OR ts.upper_material_group_id IS NOT NULL
      OR ts.upper_material_product_id IS NOT NULL
      OR COALESCE(ts.upper_consumption, 0::numeric) > 0::numeric
      OR (
        ts.upper_consumption_per_size IS NOT NULL
        AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'::text
        AND ts.upper_consumption_per_size <> '{}'::jsonb
      )
    ) AND NULLIF(btrim(COALESCE(ts.upper_material, ''::text)), ''::text) IS NULL
      AND ts.upper_material_group_id IS NULL
      AND ts.upper_material_product_id IS NULL$new$;
  v_old_consumption constant text :=
    $old$NOT COALESCE(ts.has_straps, false) AND COALESCE(ts.upper_consumption, 0::numeric) <= 0::numeric AND (ts.upper_consumption_per_size IS NULL OR ts.upper_consumption_per_size = '{}'::jsonb)$old$;
  v_new_consumption constant text :=
    $new$(
      COALESCE(ts.requires_cutting_cabedal, false)
      OR NULLIF(btrim(COALESCE(ts.upper_material, ''::text)), ''::text) IS NOT NULL
      OR ts.upper_material_group_id IS NOT NULL
      OR ts.upper_material_product_id IS NOT NULL
      OR COALESCE(ts.upper_consumption, 0::numeric) > 0::numeric
      OR (
        ts.upper_consumption_per_size IS NOT NULL
        AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'::text
        AND ts.upper_consumption_per_size <> '{}'::jsonb
      )
    ) AND COALESCE(ts.upper_consumption, 0::numeric) <= 0::numeric
      AND (
        ts.upper_consumption_per_size IS NULL
        OR ts.upper_consumption_per_size = '{}'::jsonb
      )$new$;
  v_old_partial constant text :=
    $old$NOT COALESCE(ts.has_straps, false) AND ts.upper_consumption_per_size IS NOT NULL$old$;
  v_new_partial constant text :=
    $new$ts.upper_consumption_per_size IS NOT NULL$new$;
BEGIN
  IF v_view IS NULL THEN
    RAISE EXCEPTION 'Preflight: view v_technical_sheets_audit ausente';
  END IF;

  v_definition := pg_get_viewdef(v_view, true);
  IF position(v_old_material IN v_definition) > 0 THEN
    v_patched := v_definition;
    FOREACH v_anchor IN ARRAY ARRAY[
      v_old_material, v_old_consumption, v_old_partial
    ] LOOP
      v_occurrences := (
        length(v_patched) - length(replace(v_patched, v_anchor, ''))
      ) / length(v_anchor);
      IF v_occurrences <> 1 THEN
        RAISE EXCEPTION
          'Patch de readiness recusado: esperava 1 ancora, encontrou %',
          v_occurrences;
      END IF;
    END LOOP;

    v_patched := replace(v_patched, v_old_material, v_new_material);
    v_patched := replace(v_patched, v_old_consumption, v_new_consumption);
    v_patched := replace(v_patched, v_old_partial, v_new_partial);
    EXECUTE 'CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS '
      || v_patched;
  END IF;

  ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

  v_definition := pg_get_viewdef(v_view, true);
  IF position('requires_cutting_cabedal' IN v_definition) = 0
     OR position(v_old_material IN v_definition) > 0
     OR position(v_old_consumption IN v_definition) > 0
     OR position(v_old_partial IN v_definition) > 0 THEN
    RAISE EXCEPTION
      'Regressao: readiness ainda usa has_straps para dispensar cabedal';
  END IF;
END
$patch_readiness$;

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Prontidao industrial: cabedal e tiras independentes; cabedal e validado quando ha identidade, consumo ou rota de corte, e tiras quando has_straps esta ativo.';

-- --------------------------------------------------------------------------
-- 6. Guardas permanentes na suite de paridade exibida em /diagnostics.
-- --------------------------------------------------------------------------

DO $patch_parity$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.run_consumption_parity_tests()'
  );
  v_definition text;
  v_patched text;
  v_anchor constant text :=
    $anchor$  case_name := 'bygrade_inclui_fachete';$anchor$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: run_consumption_parity_tests() ausente';
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('extra_cabedal_consumo_por_numeracao' IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Patch parity recusado: ancora bygrade_inclui_fachete ausente';
    END IF;

    v_patched := replace(
      v_definition,
      v_anchor,
      $cases$  case_name := 'extra_cabedal_consumo_por_numeracao';
  ok := public.calculate_component_accessory_required_by_grade(
          '{"consumption":9,"consumption_per_size":{"23":1.25,"24":2.75,"33":1,"33/34":4}}'::jsonb,
          '{"23":2,"24":3,"33/34":5}'::jsonb
        ) = 30.75
        AND public.calculate_component_accessory_required_by_grade(
          '{"consumption":9,"consumption_per_size":{"23":0}}'::jsonb,
          '{"23":2}'::jsonb
        ) = 0;
  message := 'extra obrigatorio deve honrar grade/conjugado e zero explicito antes do escalar'; RETURN NEXT;

  case_name := 'extra_cabedal_mesmo_produto_soma';
  ok := (
    public.merge_consumption_required_by_product(
      '[{"product_id":"11111111-1111-1111-1111-111111111111","required":2,"consumption_per_unit":1,"stock_ok":true}]'::jsonb,
      '11111111-1111-1111-1111-111111111111'::uuid,
      3, 2, 4
    ) #>> '{0,required}'
  )::numeric = 5
  AND (
    public.merge_consumption_required_by_product(
      '[{"product_id":"11111111-1111-1111-1111-111111111111","required":2,"consumption_per_unit":1,"stock_ok":true}]'::jsonb,
      '11111111-1111-1111-1111-111111111111'::uuid,
      3, 2, 4
    ) #>> '{0,consumption_per_unit}'
  )::numeric = 2.5
  AND (
    public.merge_consumption_required_by_product(
      '[{"product_id":"11111111-1111-1111-1111-111111111111","required":2,"consumption_per_unit":1,"stock_ok":true}]'::jsonb,
      '11111111-1111-1111-1111-111111111111'::uuid,
      3, 2, 4
    ) #>> '{0,stock_ok}'
  )::boolean = false;
  message := 'mesmo product_id deve receber soma fisica e recalcular unitario/estoque'; RETURN NEXT;

  case_name := 'bygrade_extra_cabedal_aditivo';
  ok := v_bygrade ILIKE '%calculate_component_accessory_required_by_grade%'
    AND v_bygrade ILIKE '%merge_consumption_required_by_product%'
    AND v_bygrade NOT ILIKE
      '%v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids))%';
  message := 'by_grade deve separar, converter e somar o adicional sem romper o dedupe de BOM'; RETURN NEXT;

  case_name := 'cabedal_e_tiras_coexistem_no_pv';
  ok := pg_get_functiondef(
          'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure
        ) ILIKE '%upper_and_straps_coexist_20270101014600%'
    AND pg_get_functiondef(
          'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure
        ) ILIKE '%upper_and_straps_coexist_20270101014600%'
    AND pg_get_functiondef(
          'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
        ) ILIKE '%upper_and_straps_coexist_20270101014600%';
  message := 'prepare, guard e enqueue devem processar strap_colors mesmo com cabedal'; RETURN NEXT;

  case_name := 'routing_tiras_preserva_cabedal_real';
  ok := pg_get_functiondef(
          'public.sync_construction_routing()'::regprocedure
        ) ILIKE '%upper_and_straps_routing_20270101014600%'
    AND pg_get_functiondef(
          'public.sync_construction_routing()'::regprocedure
        ) ILIKE '%upper_consumption_per_size%'
    AND pg_get_functiondef(
          'public.sync_construction_routing()'::regprocedure
        ) NOT ILIKE '%NEW.has_straps :=%';
  message := 'construction_type=tiras deve manter somente-tiras, mas ativar Corte Cabedal quando ha sinal real'; RETURN NEXT;

  case_name := 'readiness_cabedal_tiras_independentes';
  ok := pg_get_viewdef(
          'public.v_technical_sheets_audit'::regclass, true
        ) ILIKE '%requires_cutting_cabedal%'
    AND pg_get_viewdef(
          'public.v_technical_sheets_audit'::regclass, true
        ) NOT ILIKE
          '%NOT COALESCE(ts.has_straps, false) AND COALESCE(ts.upper_consumption%';
  message := 'readiness nao pode usar tiras para dispensar cabedal com intencao propria'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';$cases$
    );

    EXECUTE v_patched;
  END IF;
END
$patch_parity$;

-- --------------------------------------------------------------------------
-- 7. Regressao numerica viva e invariantes finais.
-- --------------------------------------------------------------------------

DO $numeric_regression_i701$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_item jsonb;
  v_lines jsonb;
  v_upper_line jsonb;
  v_product_id uuid;
  v_conv record;
  v_primary_raw numeric;
  v_extra_raw numeric;
  v_expected numeric;
  v_rows integer;
BEGIN
  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.name = 'I701'
   ORDER BY ts.id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'Fixture I701 ausente; regressao numerica viva ignorada no replay vazio';
    RETURN;
  END IF;

  SELECT accessory.value INTO v_item
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_sheet.components_accessories) = 'array'
        THEN v_sheet.components_accessories ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS accessory(value, ordinality)
   WHERE COALESCE((accessory.value ->> 'mandatory')::boolean, false)
   ORDER BY accessory.ordinality
   LIMIT 1;

  IF v_item IS NULL THEN
    RAISE NOTICE 'Fixture I701 sem componente adicional obrigatorio; regressao viva ignorada';
    RETURN;
  END IF;

  v_lines := public.calculate_order_consumption_by_grade(
    v_sheet.id, '{"23":1,"24":1}'::jsonb, 'PRETO', NULL
  );

  SELECT count(*)::integer, (jsonb_agg(line.value) -> 0)
    INTO v_rows, v_upper_line
    FROM jsonb_array_elements(v_lines) AS line(value)
   WHERE line.value ->> 'component' = 'Cabedal';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'Regressao I701: esperava 1 linha unificada de Cabedal, obteve %',
      v_rows;
  END IF;

  v_product_id := NULLIF(v_upper_line ->> 'product_id', '')::uuid;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Regressao I701: linha de Cabedal nao resolveu product_id';
  END IF;
  SELECT * INTO v_conv
    FROM public.get_material_conversion_info(v_product_id);

  v_primary_raw := COALESCE(public.pick_consumption_for_size(
      v_sheet.upper_consumption_per_size, '23'
    ), v_sheet.upper_consumption, 0)
    + COALESCE(public.pick_consumption_for_size(
      v_sheet.upper_consumption_per_size, '24'
    ), v_sheet.upper_consumption, 0);
  v_extra_raw := public.calculate_component_accessory_required_by_grade(
    v_item, '{"23":1,"24":1}'::jsonb
  );
  v_expected := (v_primary_raw + v_extra_raw)
    / NULLIF(v_conv.dm2_per_unit, 0);

  IF abs((v_upper_line ->> 'required')::numeric - v_expected) > 0.000000001 THEN
    RAISE EXCEPTION
      'Regressao I701: cabedal principal + adicional deveria ser %, obteve %',
      v_expected, v_upper_line ->> 'required';
  END IF;
END
$numeric_regression_i701$;

DO $final_assertions$
DECLARE
  v_failures text;
  v_definition text;
  v_acl text[];
  v_target text;
  v_owner text;
  v_trigger_columns text[];
BEGIN
  SELECT string_agg(case_name || ' -> ' || COALESCE(message, ''), ' | ')
    INTO v_failures
    FROM public.run_consumption_parity_tests()
   WHERE NOT ok
     AND case_name IN (
       'extra_cabedal_consumo_por_numeracao',
       'extra_cabedal_mesmo_produto_soma',
       'bygrade_extra_cabedal_aditivo',
       'cabedal_e_tiras_coexistem_no_pv',
       'routing_tiras_preserva_cabedal_real',
       'readiness_cabedal_tiras_independentes'
     );
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Guardas cabedal/tiras falharam: %', v_failures;
  END IF;

  SELECT pg_get_functiondef(
           'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
         ) INTO v_definition;
  IF v_definition NOT ILIKE '%SECURITY DEFINER%'
     OR v_definition NOT ILIKE '%SET search_path TO ''public''%' THEN
    RAISE EXCEPTION
      'Regressao de seguranca em calculate_order_consumption_by_grade';
  END IF;
  SELECT pg_get_userbyid(p.proowner)
    INTO v_owner
    FROM pg_proc p
   WHERE p.oid =
     'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Regressao de owner no by_grade: %', v_owner;
  END IF;

  SELECT array_agg(grantee ORDER BY grantee)
    INTO v_acl
    FROM information_schema.routine_privileges
   WHERE specific_schema = 'public'
     AND routine_name = 'calculate_order_consumption_by_grade'
     AND privilege_type = 'EXECUTE'
     AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF COALESCE(v_acl, ARRAY[]::text[])
     IS DISTINCT FROM ARRAY['authenticated', 'service_role']::text[] THEN
    RAISE EXCEPTION
      'Regressao de ACL no by_grade: grants efetivos inesperados %', v_acl;
  END IF;

  FOREACH v_target IN ARRAY ARRAY[
    'public.prepare_sale_order_item_internal_straps(jsonb)',
    'public.tg_validate_sale_order_item_strap_color_alignment()',
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_target)) INTO v_definition;
    IF v_definition NOT ILIKE '%SECURITY DEFINER%'
       OR v_definition NOT ILIKE '%SET search_path TO ''public''%' THEN
      RAISE EXCEPTION 'Regressao de seguranca em %', v_target;
    END IF;
    SELECT pg_get_userbyid(p.proowner)
      INTO v_owner
      FROM pg_proc p
     WHERE p.oid = to_regprocedure(v_target);
    IF v_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'Regressao de owner em %: %', v_target, v_owner;
    END IF;

    SELECT array_agg(grantee ORDER BY grantee)
      INTO v_acl
      FROM information_schema.routine_privileges
     WHERE specific_schema = 'public'
       AND routine_name = split_part(split_part(v_target, '.', 2), '(', 1)
       AND privilege_type = 'EXECUTE'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF COALESCE(v_acl, ARRAY[]::text[]) <> ARRAY[]::text[] THEN
      RAISE EXCEPTION
        'Regressao de ACL em %: grants de aplicacao inesperados %',
        v_target, v_acl;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef('public.sync_construction_routing()'::regprocedure),
         pg_get_userbyid(p.proowner)
    INTO v_definition, v_owner
    FROM pg_proc p
   WHERE p.oid = 'public.sync_construction_routing()'::regprocedure;
  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_definition ILIKE '%SECURITY DEFINER%'
     OR v_definition NOT ILIKE '%SET search_path TO ''public''%'
     OR v_definition NOT ILIKE '%upper_and_straps_routing_20270101014600%' THEN
    RAISE EXCEPTION
      'Regressao de owner/seguranca/semantica em sync_construction_routing';
  END IF;

  SELECT array_agg(grantee ORDER BY grantee)
    INTO v_acl
    FROM information_schema.routine_privileges
   WHERE specific_schema = 'public'
     AND routine_name = 'sync_construction_routing'
     AND privilege_type = 'EXECUTE'
     AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF COALESCE(v_acl, ARRAY[]::text[])
     IS DISTINCT FROM ARRAY['authenticated', 'service_role']::text[] THEN
    RAISE EXCEPTION
      'Regressao de ACL em sync_construction_routing: %', v_acl;
  END IF;

  SELECT array_agg(a.attname ORDER BY a.attname)
    INTO v_trigger_columns
    FROM pg_trigger t
    CROSS JOIN LATERAL unnest(t.tgattr::smallint[]) attr(attnum)
    JOIN pg_attribute a
      ON a.attrelid = t.tgrelid AND a.attnum = attr.attnum
   WHERE t.tgrelid = 'public.technical_sheets'::regclass
     AND t.tgname = 'trg_sync_construction_routing'
     AND NOT t.tgisinternal;
  IF v_trigger_columns IS DISTINCT FROM ARRAY[
       'components_accessories',
       'construction_type',
       'upper_consumption',
       'upper_consumption_per_size',
       'upper_material',
       'upper_material_group_id',
       'upper_material_product_id'
     ]::text[] THEN
    RAISE EXCEPTION
      'Regressao: trigger de roteiro nao observa todos os sinais de cabedal: %',
      v_trigger_columns;
  END IF;

  FOREACH v_target IN ARRAY ARRAY[
    'public.calculate_component_accessory_required_by_grade(jsonb,jsonb)',
    'public.merge_consumption_required_by_product(jsonb,uuid,numeric,numeric,numeric)'
  ] LOOP
    SELECT array_agg(grantee ORDER BY grantee)
      INTO v_acl
      FROM information_schema.routine_privileges
     WHERE specific_schema = 'public'
       AND routine_name = split_part(split_part(v_target, '.', 2), '(', 1)
       AND privilege_type = 'EXECUTE'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF COALESCE(v_acl, ARRAY[]::text[]) <> ARRAY[]::text[] THEN
      RAISE EXCEPTION
        'Helper interno % exposto a papel da aplicacao: %', v_target, v_acl;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
     WHERE c.oid = 'public.v_technical_sheets_audit'::regclass
       AND 'security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION
      'Regressao de seguranca: v_technical_sheets_audit perdeu security_invoker';
  END IF;
END
$final_assertions$;

COMMIT;
