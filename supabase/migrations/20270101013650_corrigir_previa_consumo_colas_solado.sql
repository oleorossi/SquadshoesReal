-- Corrige a previa de materiais do PV para itens-padrao do solado.
--
-- Incidente (PV-00167 / NL02-NL01): COLA PVC apareceu como 120.942,72 kg
-- para 5.184 pares. O consumo canonico e 23,33 g/par, portanto o correto e
-- 120,94272 kg. A RPC `check_stock_availability` ja delegava a explosao para
-- `calculate_order_consumption_by_grade`, que converte g -> kg, mas filtrava a
-- resposta para apenas cinco componentes. Como "Item padrao (solado)" ficava
-- de fora, a RPC recaia no BOM da ficha, onde uma copia aposentada guardava
-- 23,33 sem unidade; `products.unit = 'kg'` transformava o valor em 23,33
-- kg/par (inflacao exata de 1.000x).
--
-- O conserto tem quatro partes atomicas:
--   1. versiona COLA FORTE = 14 g/par na fonte canonica (o valor vivo foi
--      corrigido, mas a migration que o ratificou deixou somente comentario);
--   2. inclui "Item padrao (solado)" no agregado canonico da RPC. O proprio
--      loop acrescenta o product_id a `v_emitted`, portanto o BOM nao o repete;
--   3. remove as copias sistemicas identificadas pelo note exato
--      "Item padrao do solado". Sao linhas compartilhadas, sem variante,
--      criadas pelo antigo auto-fill; 46 possuem equivalente vivo em
--      `sole_group_standard_items` e 3 da SP201 ficaram orfas. Nao toca nas
--      quatro linhas "Item padrao global", que pertencem a outra decisao;
--   4. adiciona guardas permanentes em `run_consumption_parity_tests()`.
--
-- Nao ha perda de corte neste sistema e esta migration nao a reintroduz.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Dado canonico reproduzivel: COLA FORTE = 14 g/par no SOLADO 01.
--
-- Chaves naturais evitam acoplar a migration aos UUIDs gerados. A atualizacao
-- e estrita: mais ou menos de uma linha indica drift de cadastro e aborta antes
-- de publicar um calculo parcialmente coerente.
-- --------------------------------------------------------------------------
DO $version_cola_forte$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.sole_group_standard_items sgsi
     SET consumption_per_pair = 14,
         unit = 'g',
         updated_at = now()
    FROM public.products material,
         public.product_groups sole_group
   WHERE material.id = sgsi.material_product_id
     AND material.sku = '0000568.00000.00000'
     AND material.name = 'COLA FORTE'
     AND sole_group.id = sgsi.sole_group_id
     AND sole_group.name = 'SOLADO 01'
     AND sole_group.sector = 'Solado'
     AND sgsi.role IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'COLA FORTE canonica: esperava atualizar 1 linha do SOLADO 01, atualizou %',
      v_updated;
  END IF;
END
$version_cola_forte$;

-- --------------------------------------------------------------------------
-- 2. A previa consome tambem os itens-padrao ja convertidos pelo by_grade.
--
-- Patch ancorado no corpo vivo para preservar todas as correcoes posteriores
-- da RPC (~grade conjugada, variantes, tiras, caixa e ausencia de perda). Uma
-- reescrita integral a partir de migration antiga ressuscitaria bugs ja mortos.
-- --------------------------------------------------------------------------
DO $patch_check_stock$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old constant text :=
    $old$WHERE (l ->> 'component') IN ('Cabedal','Forração','Palmilha','Forração Palmilha','Fachete')$old$;
  v_new constant text :=
    $new$WHERE (l ->> 'component') IN ('Cabedal','Forração','Palmilha','Forração Palmilha','Fachete','Item padrão (solado)')$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION
      'Preflight: check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid) ausente';
  END IF;

  v_definition := pg_get_functiondef(v_function);

  -- Idempotencia defensiva para ambientes onde o hotfix tenha sido aplicado
  -- diretamente antes de a migration chegar ao ledger.
  IF position(v_new IN v_definition) = 0 THEN
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_old, ''))
    ) / length(v_old);

    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch recusado em check_stock_availability: esperava 1 ancora do agregado canonico, encontrou %',
        v_occurrences;
    END IF;

    v_patched := replace(v_definition, v_old, v_new);
    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Regressao: check_stock_availability nao inclui Item padrao (solado) do by_grade';
  END IF;

  IF position(
       'v_emitted := array_append(v_emitted, v_spec.pid)'
       IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION
      'Regressao: item canonico nao marca product_id em v_emitted; BOM poderia duplicar o consumo';
  END IF;
END
$patch_check_stock$;

-- A RPC continua SECURITY DEFINER/STABLE com o search_path que ja possuia.
-- CREATE OR REPLACE preserva ACL, mas reassertamos a fronteira viva: estoque
-- pode ser consultado por authenticated/service_role, nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION
  public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)
  TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. Regressao numerica antes da limpeza do BOM.
--
-- Rodar enquanto as copias ainda existem prova os dois contratos ao mesmo
-- tempo: (a) g -> kg vem do by_grade e (b) v_emitted impede a segunda emissao
-- pelo BOM contaminado. Em replay sem o fixture real, as guardas estruturais
-- acima e abaixo continuam obrigatorias e o caso vivo e apenas ignorado.
-- --------------------------------------------------------------------------
DO $numeric_regression$
DECLARE
  v_sheet_id uuid;
  v_pvc_id uuid;
  v_forte_id uuid;
  v_hotmelt_id uuid;
  v_pvc_required numeric;
  v_forte_required numeric;
  v_hotmelt_required numeric;
  v_pvc_rows integer;
  v_forte_rows integer;
  v_hotmelt_rows integer;
BEGIN
  SELECT ts.id
    INTO v_sheet_id
    FROM public.technical_sheets ts
   WHERE ts.code = 'NL02'
     AND ts.name = 'NL01'
   ORDER BY ts.id
   LIMIT 1;

  SELECT p.id INTO v_pvc_id
    FROM public.products p
   WHERE p.sku = '0000414.00000.00000'
     AND p.name = 'COLA PVC'
   LIMIT 1;

  SELECT p.id INTO v_forte_id
    FROM public.products p
   WHERE p.sku = '0000568.00000.00000'
     AND p.name = 'COLA FORTE'
   LIMIT 1;

  SELECT p.id INTO v_hotmelt_id
    FROM public.products p
   WHERE p.name = 'COLA  ADESIVO HOTMELT'
   ORDER BY p.id
   LIMIT 1;

  IF v_sheet_id IS NULL OR v_pvc_id IS NULL OR v_forte_id IS NULL
     OR v_hotmelt_id IS NULL THEN
    RAISE NOTICE
      'Fixture NL02-NL01/colas ausente; regressao numerica viva ignorada no replay vazio';
    RETURN;
  END IF;

  SELECT
    max(c.required) FILTER (WHERE c.product_id = v_pvc_id),
    count(*) FILTER (WHERE c.product_id = v_pvc_id),
    max(c.required) FILTER (WHERE c.product_id = v_forte_id),
    count(*) FILTER (WHERE c.product_id = v_forte_id),
    max(c.required) FILTER (WHERE c.product_id = v_hotmelt_id),
    count(*) FILTER (WHERE c.product_id = v_hotmelt_id)
    INTO
      v_pvc_required, v_pvc_rows,
      v_forte_required, v_forte_rows,
      v_hotmelt_required, v_hotmelt_rows
    FROM public.check_stock_availability(
      v_sheet_id,
      1728,
      'ROSADO',
      '{"34":1728}'::jsonb,
      NULL,
      NULL,
      NULL
    ) c;

  IF v_pvc_rows <> 1 OR v_pvc_required IS DISTINCT FROM 40.31424 THEN
    RAISE EXCEPTION
      'Regressao COLA PVC: esperava 1 linha/40.31424 kg para 1728 pares, obteve % linha(s)/% kg',
      v_pvc_rows, v_pvc_required;
  END IF;

  IF v_forte_rows <> 1 OR v_forte_required IS DISTINCT FROM 24.192 THEN
    RAISE EXCEPTION
      'Regressao COLA FORTE: esperava 1 linha/24.192 kg para 1728 pares, obteve % linha(s)/% kg',
      v_forte_rows, v_forte_required;
  END IF;

  IF v_hotmelt_rows <> 1 OR v_hotmelt_required IS DISTINCT FROM 17.28 THEN
    RAISE EXCEPTION
      'Regressao HOTMELT: esperava 1 linha/17.28 kg para 1728 pares, obteve % linha(s)/% kg',
      v_hotmelt_rows, v_hotmelt_required;
  END IF;
END
$numeric_regression$;

-- --------------------------------------------------------------------------
-- 4. Remove a fonte aposentada do BOM.
--
-- `notes = 'Item padrao do solado'` nao e texto livre neste fluxo: e a marca
-- exata emitida pelo antigo `autoFillStandardItemsFromSole`. Combinada a
-- `material_variant_id IS NULL`, identifica somente a copia compartilhada
-- sistemica. A quantidade nao e dividida nem recalculada: a linha inteira sai,
-- pois a fonte viva `sole_group_standard_items` e herdada por grupo/modelo.
-- --------------------------------------------------------------------------
DO $clean_legacy_bom$
DECLARE
  v_deleted integer;
  v_remaining integer;
BEGIN
  DELETE FROM public.sheet_materials sm
   WHERE sm.material_variant_id IS NULL
     AND btrim(coalesce(sm.notes, '')) = 'Item padrão do solado';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT count(*)::integer
    INTO v_remaining
    FROM public.sheet_materials sm
   WHERE sm.material_variant_id IS NULL
     AND btrim(coalesce(sm.notes, '')) = 'Item padrão do solado';

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION
      'Limpeza incompleta: ainda restam % copias de Item padrao do solado no BOM',
      v_remaining;
  END IF;

  RAISE NOTICE
    'Copias sistemicas de Item padrao do solado removidas do BOM: %',
    v_deleted;
END
$clean_legacy_bom$;

-- --------------------------------------------------------------------------
-- 5. Guardas permanentes na suite de paridade exibida em /diagnostics.
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

  IF position('check_stock_inclui_item_padrao_solado' IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Patch parity recusado: ancora bygrade_inclui_fachete nao encontrada';
    END IF;

    v_patched := replace(
      v_definition,
      v_anchor,
      $cases$  case_name := 'check_stock_inclui_item_padrao_solado';
  ok := pg_get_functiondef(
          'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure
        ) LIKE '%''Item padrão (solado)''%';
  message := 'previsao deve consumir o item-padrao ja convertido pelo by_grade'; RETURN NEXT;

  case_name := 'check_stock_item_padrao_bloqueia_bom_duplicado';
  ok := pg_get_functiondef(
          'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure
        ) LIKE '%v_emitted := array_append(v_emitted, v_spec.pid)%';
  message := 'product_id canonico precisa entrar em v_emitted antes do loop de BOM'; RETURN NEXT;

  case_name := 'cola_forte_14g_versionada';
  ok := EXISTS (
    SELECT 1
      FROM public.sole_group_standard_items sgsi
      JOIN public.products material ON material.id = sgsi.material_product_id
      JOIN public.product_groups sole_group ON sole_group.id = sgsi.sole_group_id
     WHERE material.sku = '0000568.00000.00000'
       AND material.name = 'COLA FORTE'
       AND sole_group.name = 'SOLADO 01'
       AND sole_group.sector = 'Solado'
       AND sgsi.role IS NULL
       AND sgsi.consumption_per_pair = 14
       AND sgsi.unit = 'g'
  );
  message := 'fonte canonica deve manter COLA FORTE em 14 g/par'; RETURN NEXT;

  case_name := 'bom_sem_copia_item_padrao_solado';
  ok := NOT EXISTS (
    SELECT 1
      FROM public.sheet_materials sm
     WHERE sm.material_variant_id IS NULL
       AND btrim(coalesce(sm.notes, '')) = 'Item padrão do solado'
  );
  message := 'item-padrao do solado e vinculo vivo, nunca copia no BOM'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';$cases$
    );

    EXECUTE v_patched;
  END IF;
END
$patch_parity$;

DO $final_assertions$
DECLARE
  v_failures text;
  v_acl text[];
  v_definition text;
BEGIN
  SELECT string_agg(case_name || ' -> ' || coalesce(message, ''), ' | ')
    INTO v_failures
    FROM public.run_consumption_parity_tests()
   WHERE NOT ok
     AND case_name IN (
       'check_stock_inclui_item_padrao_solado',
       'check_stock_item_padrao_bloqueia_bom_duplicado',
       'cola_forte_14g_versionada',
       'bom_sem_copia_item_padrao_solado'
     );

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Guardas da previa de colas falharam: %', v_failures;
  END IF;

  SELECT pg_get_functiondef(
           'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure
         )
    INTO v_definition;

  IF v_definition NOT ILIKE '%STABLE%SECURITY DEFINER%'
     OR v_definition NOT ILIKE '%SET search_path TO ''public'', ''extensions''%' THEN
    RAISE EXCEPTION
      'Regressao de seguranca: atributos da RPC check_stock_availability mudaram';
  END IF;

  SELECT array_agg(grantee ORDER BY grantee)
    INTO v_acl
    FROM information_schema.routine_privileges
   WHERE specific_schema = 'public'
     AND routine_name = 'check_stock_availability'
     AND privilege_type = 'EXECUTE'
     AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role');

  IF coalesce(v_acl, ARRAY[]::text[])
     IS DISTINCT FROM ARRAY['authenticated', 'service_role']::text[] THEN
    RAISE EXCEPTION
      'Regressao de ACL em check_stock_availability: grants efetivos inesperados %',
      v_acl;
  END IF;
END
$final_assertions$;

COMMIT;
