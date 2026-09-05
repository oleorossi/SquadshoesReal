-- =============================================================================
-- Hotfix: manifesto offline fiel ao writer e guards publicos sem bypass local
-- =============================================================================
-- 15500 ja esta aplicada. Este arquivo e deliberadamente incremental: nao
-- reescreve a migration anterior nem qualquer cadastro/snapshot historico.

-- session_user continua sendo o login original mesmo depois de SET LOCAL ROLE
-- authenticated (e pode ser postgres no executor administrativo). Portanto ele
-- nao pode autorizar uma RPC. is_approved_user() ja reconhece service_role pelo
-- JWT e e a unica fronteira necessaria nos tres endpoints.
DO $patch_public_guards$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old constant text :=
    'IF NOT v_is_service AND NOT public.is_approved_user() THEN';
  v_new constant text :=
    'IF NOT public.is_approved_user() THEN';
  v_old_declaration constant text := $old$  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
$old$;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure,
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure,
    'public.get_mobile_strap_offline_manifest(uuid[])'::regprocedure
  ]
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Hotfix do guard encontrou % ocorrencias em %; esperado 1',
        v_occurrences, v_function;
    END IF;
    v_patched := pg_catalog.replace(v_definition, v_old, v_new);
    v_occurrences := (
      pg_catalog.length(v_patched)
      - pg_catalog.length(pg_catalog.replace(
          v_patched, v_old_declaration, ''
        ))
    ) / pg_catalog.length(v_old_declaration);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Hotfix encontrou % declaracoes v_is_service em %; esperado 1',
        v_occurrences, v_function;
    END IF;
    v_patched := pg_catalog.replace(v_patched, v_old_declaration, '');
    EXECUTE v_patched;

    v_definition := pg_catalog.pg_get_functiondef(v_function);
    IF position(v_new IN v_definition) = 0
       OR position(v_old IN v_definition) > 0
       OR position('v_is_service' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Guard efetivo nao foi instalado em %', v_function;
    END IF;
  END LOOP;
END;
$patch_public_guards$;

-- O manifesto deve listar somente uma cor que o writer conseguiria persistir
-- naquele instante. Completa tres pre-condicoes do catalog resolver que nao
-- faziam parte do booleano de disponibilidade usado em 15500.
DO $patch_manifest_color_guards$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'private.mobile_strap_allowed_colors(text,uuid,uuid,uuid)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_base_gate constant text := $old$
       AND NOT public.is_buy_ready_strass_identity(
         NULL, p_presentation_group_id
       )
       AND EXISTS ($old$;
  v_new_base_gate constant text := $new$
       AND NOT public.is_buy_ready_strass_identity(
         NULL, p_presentation_group_id
       )
       AND NOT public.is_buy_ready_strass_identity(
         NULL, p_base_group_id
       )
       AND EXISTS ($new$;
  v_old_basis_dispatch constant text := $old$  IF p_identity_basis = 'finished_product_group' THEN$old$;
  v_new_basis_dispatch constant text := $new$  IF COALESCE(p_identity_basis, '') NOT IN (
    'reference_base', 'finished_product_group'
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_identity_basis = 'finished_product_group' THEN$new$;
  v_old_existing_variant constant text := $old$
              AND variant.internal_production_enabled
              AND finished.active$old$;
  v_new_existing_variant constant text := $new$
              AND variant.internal_production_enabled
              AND variant.min_stock_m IS NOT NULL
              AND variant.min_stock_replenishment_mode IS NOT NULL
              AND finished.active$new$;
  v_old_creation_start constant text := $old$
       AND (
         NOT EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants occupied$old$;
  v_new_creation_start constant text := $new$
       AND (
         (
           (
             p_presentation_group_id IS NULL
             OR EXISTS (
               SELECT 1
                 FROM public.product_groups presentation_group
                WHERE presentation_group.id = p_presentation_group_id
             )
           )
           AND NOT EXISTS (
             SELECT 1
               FROM public.artisanal_strap_variants occupied$new$;
  v_old_creation_end constant text := $old$
              AND occupied.color_id = color.id
         )
         OR EXISTS ($old$;
  v_new_creation_end constant text := $new$
                AND occupied.color_id = color.id
           )
         )
         OR EXISTS ($new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: helper de cores do manifesto ausente';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_function);
  v_patched := v_definition;

  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(
        v_patched, v_old_basis_dispatch, ''
      ))
  ) / pg_catalog.length(v_old_basis_dispatch);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch fail-closed da base encontrou % anchors',
      v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(
    v_patched, v_old_basis_dispatch, v_new_basis_dispatch
  );

  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(
        v_patched, v_old_base_gate, ''
      ))
  ) / pg_catalog.length(v_old_base_gate);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch base STRASS encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(
    v_patched, v_old_base_gate, v_new_base_gate
  );

  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(
        v_patched, v_old_existing_variant, ''
      ))
  ) / pg_catalog.length(v_old_existing_variant);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch min-stock reference encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(
    v_patched, v_old_existing_variant, v_new_existing_variant
  );

  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(
        v_patched, v_old_creation_start, ''
      ))
  ) / pg_catalog.length(v_old_creation_start);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch grupo de apresentacao encontrou % inicios',
      v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(
    v_patched, v_old_creation_start, v_new_creation_start
  );

  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(
        v_patched, v_old_creation_end, ''
      ))
  ) / pg_catalog.length(v_old_creation_end);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch grupo de apresentacao encontrou % finais',
      v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(
    v_patched, v_old_creation_end, v_new_creation_end
  );
  EXECUTE v_patched;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF position(v_new_base_gate IN v_definition) = 0
     OR position(v_new_basis_dispatch IN v_definition) = 0
     OR position('variant.min_stock_m IS NOT NULL' IN v_definition) = 0
     OR position(
       'variant.min_stock_replenishment_mode IS NOT NULL' IN v_definition
     ) = 0
     OR position(
       'presentation_group.id = p_presentation_group_id' IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'Pos-condicao do helper de cores do manifesto falhou';
  END IF;
END;
$patch_manifest_color_guards$;

-- ACL/search_path nao podem ser afrouxados por CREATE OR REPLACE dinamico.
DO $assert_hotfix$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_failed text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure,
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure,
    'public.get_mobile_strap_offline_manifest(uuid[])'::regprocedure
  ]
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    IF position('IF NOT public.is_approved_user() THEN' IN v_definition) = 0
       OR position(
         'IF NOT v_is_service AND NOT public.is_approved_user() THEN'
           IN v_definition
       ) > 0
       OR position('v_is_service' IN v_definition) > 0
       OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc procedure
          WHERE procedure.oid = v_function
            AND procedure.prosecdef
            AND procedure.proconfig @> ARRAY['search_path=""']::text[]
       ) THEN
      RAISE EXCEPTION 'ACL/guard/search_path invalido em %', v_function;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       'private.mobile_strap_allowed_colors(text,uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'private.mobile_strap_allowed_colors(text,uuid,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Helper privado do manifesto ganhou EXECUTE indevido';
  END IF;

  SELECT pg_catalog.string_agg(test.case_name, ', ' ORDER BY test.case_name)
    INTO v_failed
    FROM public.run_strap_snapshot_sector_contract_tests() test
   WHERE NOT test.passed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Contratos 15500 regrediram apos hotfix: %', v_failed;
  END IF;
END;
$assert_hotfix$;

NOTIFY pgrst, 'reload schema';
