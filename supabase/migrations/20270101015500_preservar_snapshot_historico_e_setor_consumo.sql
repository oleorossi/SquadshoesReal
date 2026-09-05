-- =============================================================================
-- Snapshot historico de tiras, setor de consumo congelado e manifesto offline
-- =============================================================================
--
-- Decisoes deliberadas desta migration:
--   * um PV comprometido nunca aceita quantidade, grade, ficha, cor ou snapshot
--     de tiras enviados pelo cliente; o preview os reidrata do banco;
--   * setor de consumo e informacao de apresentacao/rastreabilidade. A baixa
--     continua nos pontos canonicos atuais (picking/finalizacao);
--   * somente direct_components e sheet_materials possuem roteamento explicito.
--     Cabedal/forro/palmilha/solado preservam o contexto legado;
--   * nenhum cadastro historico, saldo ou snapshot antigo recebe backfill.

-- Primeiro uso do schema de implementacao interna neste banco. Somente os
-- wrappers SECURITY DEFINER podem invocar os helpers; nao e superficie RPC.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

-- A migration historica 20261231122000 chegou a definir baixa por entrada no
-- setor. Essa automacao nao foi aprovada para este fluxo. Os drops sao
-- defensivos: em bancos onde aquele arquivo foi executado, 15500 restaura o
-- comportamento canonico; em producao atual eles sao no-op.
DROP TRIGGER IF EXISTS trg_ab_debit_materials_when_sector_starts
  ON public.order_stages;
DROP TRIGGER IF EXISTS trg_aa0_preserve_unstarted_sector_reservations
  ON public.orders;
DROP TRIGGER IF EXISTS trg_assign_reservation_consumption_sector
  ON public.material_reservations;

DO $preflight$
BEGIN
  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'Preflight: schema private ausente';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.preview_sale_order_strap_demand_draft(jsonb)') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.calculate_consumption_report_batch(uuid[],uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Preflight: motores canonicos de preview/consumo ausentes';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sheet_materials'
       AND column_name = 'consumption_sector'
  ) THEN
    RAISE EXCEPTION 'Preflight: sheet_materials.consumption_sector ausente';
  END IF;
END;
$preflight$;

-- -----------------------------------------------------------------------------
-- 1. Classificacao de estado comprometido.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_committed_sale_order_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  -- Fail closed: somente estados explicitamente editaveis aceitam fatos do
  -- cliente. Um estado novo/legado (por exemplo Entregue) e comprometido por
  -- padrao e nao pode reabrir a ficha historica por falta numa whitelist.
  SELECT COALESCE(public.normalize_strap_catalog_text(p_status), '') NOT IN (
    'rascunho', 'pendente', 'draft', 'pending'
  );
$function$;

REVOKE ALL ON FUNCTION private.is_committed_sale_order_status(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Setor explicito: resolve somente as duas fontes configuraveis e o anexa
--    sem tocar em required/available/debit_mode.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.resolve_consumption_sector_context(
  p_reference_id uuid,
  p_material_variant_id uuid,
  p_product_id uuid,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sector text;
  v_candidate_count integer := 0;
  v_annotated_count integer := 0;
  v_sector_count integer := 0;
BEGIN
  IF p_reference_id IS NULL OR p_product_id IS NULL
     OR COALESCE(p_source, '') NOT IN (
       'direct_components', 'component_color',
       'component_color_default', 'sheet_materials'
     ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', NULL,
      'consumption_sector_source', 'legacy_fallback'
    );
  END IF;

  IF p_source = 'sheet_materials' THEN
    SELECT pg_catalog.count(*),
           pg_catalog.count(*) FILTER (
             WHERE NULLIF(pg_catalog.btrim(material.consumption_sector), '')
                     IS NOT NULL
           ),
           pg_catalog.count(DISTINCT NULLIF(
             pg_catalog.btrim(material.consumption_sector), ''
           )),
           pg_catalog.min(NULLIF(
             pg_catalog.btrim(material.consumption_sector), ''
           ))
      INTO v_candidate_count, v_annotated_count, v_sector_count, v_sector
      FROM public.get_effective_bom(
             p_reference_id, p_material_variant_id
           ) effective
      JOIN public.sheet_materials material ON material.id = effective.id
     WHERE effective.product_id = p_product_id;
  ELSE
    -- O gate de componentes por cor substitui a lista de produtos da ficha,
    -- mas a tabela satellite nao possui coluna de setor. Primeiro preserve um
    -- vinculo exato quando o SKU resolvido tambem estiver em direct_components.
    SELECT pg_catalog.count(*),
           pg_catalog.count(*) FILTER (
             WHERE NULLIF(pg_catalog.btrim(
               component.value ->> 'consumption_sector'), '') IS NOT NULL
           ),
           pg_catalog.count(DISTINCT NULLIF(pg_catalog.btrim(
             component.value ->> 'consumption_sector'), '')),
           pg_catalog.min(NULLIF(pg_catalog.btrim(
             component.value ->> 'consumption_sector'), ''))
      INTO v_candidate_count, v_annotated_count, v_sector_count, v_sector
      FROM public.technical_sheets sheet
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(sheet.direct_components) = 'array'
            THEN sheet.direct_components
          ELSE '[]'::jsonb
        END
      ) component(value)
     WHERE sheet.id = p_reference_id
       AND component.value ->> 'product_id' = p_product_id::text;

    -- Se o SKU colorido realmente substitui o SKU padrao, herdar e seguro
    -- somente quando toda a lista base tem um unico setor explicito. Havendo
    -- mais de um destino, nao invente qual componente a linha colorida
    -- substituiu: devolva ambiguous e obrigue o cadastro a ser desambiguado.
    IF p_source = 'component_color_default' AND v_candidate_count = 0 THEN
      -- A regra global troca o SKU, mas preserva o grupo do componente
      -- original. Esse grupo e a ligacao estrutural segura para transportar o
      -- setor; colapsos com mais de um setor continuam ambiguos.
      SELECT pg_catalog.count(*),
             pg_catalog.count(*) FILTER (
               WHERE NULLIF(pg_catalog.btrim(
                 component.value ->> 'consumption_sector'), '') IS NOT NULL
             ),
             pg_catalog.count(DISTINCT NULLIF(pg_catalog.btrim(
               component.value ->> 'consumption_sector'), '')),
             pg_catalog.min(NULLIF(pg_catalog.btrim(
               component.value ->> 'consumption_sector'), ''))
        INTO v_candidate_count, v_annotated_count,
             v_sector_count, v_sector
        FROM public.technical_sheets sheet
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(sheet.direct_components) = 'array'
              THEN sheet.direct_components
            ELSE '[]'::jsonb
          END
        ) component(value)
        JOIN public.products original_product
          ON original_product.id = public.try_parse_uuid(
            component.value ->> 'product_id'
          )
        JOIN public.products resolved_product
          ON resolved_product.id = p_product_id
         AND resolved_product.group_id IS NOT DISTINCT FROM
             original_product.group_id
       WHERE sheet.id = p_reference_id;
    ELSIF p_source = 'component_color' AND v_candidate_count = 0 THEN
      SELECT pg_catalog.count(*),
             pg_catalog.count(*) FILTER (
               WHERE NULLIF(pg_catalog.btrim(
                 component.value ->> 'consumption_sector'), '') IS NOT NULL
             ),
             pg_catalog.count(DISTINCT NULLIF(pg_catalog.btrim(
               component.value ->> 'consumption_sector'), '')),
             pg_catalog.min(NULLIF(pg_catalog.btrim(
               component.value ->> 'consumption_sector'), ''))
        INTO v_candidate_count, v_annotated_count,
             v_sector_count, v_sector
        FROM public.technical_sheets sheet
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(sheet.direct_components) = 'array'
              THEN sheet.direct_components
            ELSE '[]'::jsonb
          END
        ) component(value)
       WHERE sheet.id = p_reference_id;
    END IF;
  END IF;

  IF v_annotated_count > 0
     AND v_annotated_count IS DISTINCT FROM v_candidate_count THEN
    -- Uma agregacao parcialmente configurada nao pode fingir que todas as
    -- parcelas pertencem ao unico setor preenchido.
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', NULL,
      'consumption_sector_source', 'ambiguous'
    );
  ELSIF v_sector_count = 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', v_sector,
      'consumption_sector_source', 'explicit'
    );
  ELSIF v_sector_count > 1 THEN
    -- O motor legado agrega por produto. Com dois setores para o mesmo produto
    -- nao existe particionamento quantitativo seguro; torne a ambiguidade visivel.
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', NULL,
      'consumption_sector_source', 'ambiguous'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'consumption_sector', NULL,
    'consumption_sector_source', 'legacy_fallback'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.attach_consumption_sector_context(
  p_reference_id uuid,
  p_material_variant_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN p_lines
    ELSE COALESCE((
      SELECT pg_catalog.jsonb_agg(
               line.value
               || private.resolve_consumption_sector_context(
                    p_reference_id,
                    p_material_variant_id,
                    public.try_parse_uuid(line.value ->> 'product_id'),
                    line.value ->> 'source'
                  )
               ORDER BY line.ordinality
             )
        FROM pg_catalog.jsonb_array_elements(p_lines)
             WITH ORDINALITY line(value, ordinality)
    ), '[]'::jsonb)
  END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_consumption_sector_context(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.attach_consumption_sector_context(
  uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

DO $patch_consumption_engine$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old constant text := E'  RETURN v_result;\nEND;';
  v_new constant text := E'  -- consumption_sector_context_20270101015500\n'
    || E'  RETURN private.attach_consumption_sector_context(\n'
    || E'    p_reference_id, p_material_variant_id, v_result\n'
    || E'  );\nEND;';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF position(
       'consumption_sector_context_20270101015500' IN v_definition
     ) = 0 THEN
    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Patch do setor no motor encontrou % finais; esperado 1', v_occurrences;
    END IF;
    v_patched := pg_catalog.replace(v_definition, v_old, v_new);
    EXECUTE v_patched;
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF position(
       'consumption_sector_context_20270101015500' IN v_definition
     ) = 0
     OR position(
       'private.attach_consumption_sector_context' IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'Regressao: motor nao transporta setor de consumo';
  END IF;
END;
$patch_consumption_engine$;

-- -----------------------------------------------------------------------------
-- 3. Preview comprometido: a fronteira publica aceita o mesmo JSON, mas todo
--    fato persistido e reidratado antes de alcançar o motor de 15400.
-- -----------------------------------------------------------------------------

DO $move_previous_preview$
BEGIN
  IF pg_catalog.to_regprocedure(
       'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight: helper privado do preview 15500 ja existe';
  END IF;

  ALTER FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
    RENAME TO preview_sale_order_strap_demand_draft_pre_20270101015500;
  ALTER FUNCTION public.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)
    SET SCHEMA private;
END;
$move_previous_preview$;

REVOKE ALL ON FUNCTION
  private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)
FROM PUBLIC, anon, authenticated, service_role;

-- O command de confirmacao precisa resolver o catalogo vigente exatamente uma
-- vez para criar a primeira demanda. Esse preview operacional recebe somente
-- payload montado do banco e permanece privado; a RPC publica abaixo nunca usa
-- flags do cliente para escapar da reidratacao historica.
CREATE OR REPLACE FUNCTION private.preview_sale_order_strap_demand_operational(
  p_sale_order_id uuid
)
RETURNS TABLE(
  sale_order_item_id uuid,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT item.id,
         preview.technical_strap_line_id,
         preview.strap_variant_id,
         preview.source_mode,
         preview.gross_required_m,
         preview.recipe_id,
         preview.base_product_id,
         preview.finished_product_id,
         preview.blocking_reasons,
         preview.resolved
    FROM public.sale_order_items item
    CROSS JOIN LATERAL public.resolve_sale_order_main_production_start(
      p_sale_order_id, item.id
    ) schedule
    CROSS JOIN LATERAL
      private.preview_sale_order_strap_demand_draft_pre_20270101015500(
        pg_catalog.jsonb_build_object(
          'sale_order_id', p_sale_order_id,
          'sale_order_item_id', item.id,
          'reference_id', item.reference_id,
          'material_variant_id', item.material_variant_id,
          'color', item.color,
          'quantity', item.quantity,
          'grade', item.grade,
          'strap_colors', item.strap_colors,
          'strap_sourcing', item.strap_sourcing,
          'main_production_start', schedule.main_production_start,
          'schedule_revision', schedule.schedule_revision
        )
      ) preview
   WHERE item.sale_order_id = p_sale_order_id
   ORDER BY item.id, preview.line_ordinal;
$function$;

REVOKE ALL ON FUNCTION
  private.preview_sale_order_strap_demand_operational(uuid)
FROM PUBLIC, anon, authenticated, service_role;

DO $route_enqueue_through_private_preview$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'
  );
  v_definition text;
  v_patched text;
  v_old constant text :=
    'public.preview_sale_order_strap_demand(p_sale_order_id)';
  v_new constant text :=
    'private.preview_sale_order_strap_demand_operational(p_sale_order_id)';
  v_occurrences integer;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: enqueue de tiras ausente';
  END IF;
  v_definition := pg_catalog.pg_get_functiondef(v_function);
  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Patch do enqueue encontrou % chamadas do preview publico; esperado 1',
      v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_patched;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF position(v_new IN v_definition) = 0
     OR position(v_old IN v_definition) > 0 THEN
    RAISE EXCEPTION
      'Regressao: enqueue nao usa exclusivamente o preview operacional privado';
  END IF;
END;
$route_enqueue_through_private_preview$;

-- Demanda corrente e o snapshot fisico mais forte. Enquanto o worker ainda
-- nao a materializou (ou para um PV legado), somente os IDs e a estrutura
-- persistidos no item sao fatos historicos. Versao/rendimento atuais da
-- receita nao sao apresentados como congelados.
CREATE OR REPLACE FUNCTION private.resolve_committed_strap_identity(
  p_sale_order_item_id uuid,
  p_technical_strap_line_id uuid,
  p_strap_sourcing jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_demand_count integer := 0;
  v_selection jsonb;
  v_source_mode text;
  v_variant_id uuid;
  v_recipe_id uuid;
  v_base_product_id uuid;
  v_finished_product_id uuid;
  v_variant_measure_id uuid;
  v_variant_base_group_id uuid;
  v_variant_color_id uuid;
  v_variant_identity_basis text;
BEGIN
  IF p_sale_order_item_id IS NULL OR p_technical_strap_line_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'missing',
      'reason', 'Linha comprometida sem UUID tecnico'
    );
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_demand_count
    FROM public.sale_order_strap_demands demand
   WHERE demand.sale_order_item_id = p_sale_order_item_id
     AND demand.technical_strap_line_id = p_technical_strap_line_id
     AND demand.is_current;
  IF v_demand_count > 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'demand',
      'reason', 'Mais de uma demanda corrente para o mesmo UUID de tira'
    );
  ELSIF v_demand_count = 1 THEN
    SELECT demand.*
      INTO v_demand
      FROM public.sale_order_strap_demands demand
     WHERE demand.sale_order_item_id = p_sale_order_item_id
       AND demand.technical_strap_line_id = p_technical_strap_line_id
       AND demand.is_current;
    RETURN pg_catalog.jsonb_build_object(
      'valid', true,
      'snapshot_source', 'demand',
      'source_mode', v_demand.source_mode,
      'strap_variant_id', v_demand.strap_variant_id,
      'recipe_id', v_demand.recipe_id,
      'recipe_version', v_demand.recipe_version_snapshot,
      'base_product_id', v_demand.base_product_id,
      'finished_product_id', v_demand.finished_product_id,
      'confirmed_yield_m_per_m', v_demand.confirmed_yield_snapshot,
      'base_required_m', v_demand.base_required_m,
      'physical_snapshot_complete', true,
      'resolved_snapshot', COALESCE(
        v_demand.identity_snapshot -> 'resolved', '{}'::jsonb
      )
    );
  END IF;

  v_selection := COALESCE(
    p_strap_sourcing -> p_technical_strap_line_id::text,
    '{}'::jsonb
  );
  IF pg_catalog.jsonb_typeof(v_selection) IS DISTINCT FROM 'object' THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem congelada da linha nao e objeto JSON'
    );
  END IF;
  v_source_mode := NULLIF(pg_catalog.btrim(
    v_selection ->> 'source_mode'
  ), '');
  v_variant_id := public.try_parse_uuid(
    v_selection ->> 'strap_variant_id'
  );
  v_recipe_id := public.try_parse_uuid(v_selection ->> 'recipe_id');
  v_base_product_id := public.try_parse_uuid(
    v_selection ->> 'base_product_id'
  );

  IF COALESCE(v_source_mode, '') NOT IN ('internal', 'buy_ready')
     OR v_variant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Origem/variante congelada ausente ou invalida'
    );
  END IF;
  SELECT variant.finished_product_id,
         variant.measure_id,
         variant.base_group_id,
         variant.color_id,
         variant.identity_basis
    INTO v_finished_product_id,
         v_variant_measure_id,
         v_variant_base_group_id,
         v_variant_color_id,
         v_variant_identity_basis
    FROM public.artisanal_strap_variants variant
   WHERE variant.id = v_variant_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Variante congelada da tira nao existe mais'
    );
  END IF;

  IF v_source_mode = 'internal' THEN
    IF v_recipe_id IS NULL OR v_base_product_id IS NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'valid', false,
        'snapshot_source', 'sale_order_item_pre_demand',
        'reason', 'Receita/produto-base congelado ausente na tira interna'
      );
    END IF;
  ELSIF v_recipe_id IS NOT NULL OR v_base_product_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false,
      'snapshot_source', 'sale_order_item_pre_demand',
      'reason', 'Tira comprada pronta carrega receita/produto-base indevido'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'valid', true,
    'snapshot_source', 'sale_order_item_pre_demand',
    'source_mode', v_source_mode,
    'strap_variant_id', v_variant_id,
    'recipe_id', v_recipe_id,
    'recipe_version', NULL,
    'measure_id', v_variant_measure_id,
    'base_group_id', v_variant_base_group_id,
    'color_id', v_variant_color_id,
    'identity_basis', v_variant_identity_basis,
    'base_product_id', v_base_product_id,
    'finished_product_id', v_finished_product_id,
    'confirmed_yield_m_per_m', NULL,
    'base_required_m', NULL,
    'physical_snapshot_complete', false,
    'snapshot_warning',
      'A versao, o rendimento e a necessidade de base serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.',
    'resolved_snapshot', '{}'::jsonb
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_committed_strap_identity(
  uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft(
  p_item jsonb
)
RETURNS TABLE(
  line_ordinal integer,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- committed_strap_preview_rehydration_20270101015500
  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_item_payload jsonb := p_item;
  v_item_id uuid;
  v_supplied_sale_order_id uuid;
  v_scope_key uuid;
  v_scope_type text;
  v_item public.sale_order_items%ROWTYPE;
  v_sale_order public.sale_orders%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_effective_grade jsonb;
  v_main_production_start date;
  v_schedule_revision integer;
  v_preview record;
  v_identity jsonb;
  v_reasons jsonb;
  v_resolved jsonb;
  v_snapshot_resolved jsonb;
  v_stored_line jsonb;
  v_stored_line_count integer;
  v_catalog jsonb;
  v_snapshot_source text;
  v_snapshot_complete boolean;
  v_frozen_source text;
  v_frozen_variant_id uuid;
  v_frozen_recipe_id uuid;
  v_frozen_base_product_id uuid;
  v_frozen_finished_product_id uuid;
  v_frozen_yield numeric;
  v_key text;
  v_raw text;
BEGIN
  IF NOT v_is_service AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_item deve ser objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  -- Nao deixe um UUID malformado virar NULL e trocar silenciosamente o ramo
  -- historico pelo prospectivo.
  FOREACH v_key IN ARRAY ARRAY[
    'sale_order_item_id', 'sale_order_id', 'reference_id',
    'material_variant_id', 'scope_key'
  ]
  LOOP
    v_raw := NULLIF(pg_catalog.btrim(p_item ->> v_key), '');
    IF v_raw IS NOT NULL AND public.try_parse_uuid(v_raw) IS NULL THEN
      RAISE EXCEPTION '% deve ser UUID valido', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_item_id := public.try_parse_uuid(p_item ->> 'sale_order_item_id');
  IF v_item_id IS NULL THEN
    RETURN QUERY
      SELECT previous.*
        FROM private.preview_sale_order_strap_demand_draft_pre_20270101015500(
               p_item
             ) previous
       ORDER BY previous.line_ordinal;
    RETURN;
  END IF;

  SELECT item.*
    INTO v_item
    FROM public.sale_order_items item
   WHERE item.id = v_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de PV % inexistente', v_item_id
      USING ERRCODE = 'P0002';
  END IF;

  v_supplied_sale_order_id := public.try_parse_uuid(
    p_item ->> 'sale_order_id'
  );
  IF v_supplied_sale_order_id IS NOT NULL
     AND v_supplied_sale_order_id IS DISTINCT FROM v_item.sale_order_id THEN
    RAISE EXCEPTION 'Item % nao pertence ao PV informado', v_item_id
      USING ERRCODE = '23514';
  END IF;

  SELECT sale_order.*
    INTO v_sale_order
    FROM public.sale_orders sale_order
   WHERE sale_order.id = v_item.sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV do item % inexistente', v_item_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Rascunho/Pendente continua prospectivo: o usuario pode estar visualizando
  -- mudancas ainda nao salvas. A partir da aprovacao, apenas o banco decide.
  IF NOT private.is_committed_sale_order_status(v_sale_order.status) THEN
    RETURN QUERY
      SELECT previous.*
        FROM private.preview_sale_order_strap_demand_draft_pre_20270101015500(
               p_item
             ) previous
       ORDER BY previous.line_ordinal;
    RETURN;
  END IF;

  -- Agenda tambem e fato server-side. O helper legado aceita datas de draft
  -- no JSON; num PV comprometido elas jamais podem vencer o cronograma vivo ou
  -- o valor congelado dentro de strap_sourcing.
  SELECT schedule.main_production_start, schedule.schedule_revision
    INTO v_main_production_start, v_schedule_revision
    FROM public.resolve_sale_order_main_production_start(
      v_item.sale_order_id, v_item.id
    ) schedule
   LIMIT 1;

  v_scope_type := COALESCE(
    NULLIF(pg_catalog.btrim(p_item ->> 'scope_type'), ''),
    'sale_order_item'
  );
  IF v_scope_type NOT IN ('sale_order_item', 'production_order') THEN
    RAISE EXCEPTION 'scope_type invalido: %', v_scope_type
      USING ERRCODE = '22023';
  END IF;

  IF v_scope_type = 'production_order' THEN
    v_scope_key := public.try_parse_uuid(p_item ->> 'scope_key');
    IF v_scope_key IS NULL THEN
      RAISE EXCEPTION 'scope_key da OP e obrigatorio'
        USING ERRCODE = '22023';
    END IF;
    SELECT production_order.*
      INTO v_order
      FROM public.orders production_order
     WHERE production_order.id = v_scope_key
       AND production_order.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OP % inexistente ou excluida', v_scope_key
        USING ERRCODE = 'P0002';
    END IF;
    IF v_order.sale_order_item_id IS DISTINCT FROM v_item.id
       OR v_order.sale_order_id IS DISTINCT FROM v_item.sale_order_id
       OR v_order.reference_id IS DISTINCT FROM v_item.reference_id THEN
      RAISE EXCEPTION 'Vinculo OP/PV/item divergente no preview %', v_scope_key
        USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_order.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'OP % possui quantidade invalida', v_scope_key
        USING ERRCODE = '22023';
    END IF;
    v_effective_grade := public.resolve_effective_op_grade(
      v_order.grade, v_order.quantity
    );
    v_item_payload := p_item || pg_catalog.jsonb_build_object(
      'sale_order_id', v_item.sale_order_id,
      'sale_order_item_id', v_item.id,
      'reference_id', v_item.reference_id,
      'material_variant_id', v_item.material_variant_id,
      -- A cor fisica das tiras pertence ao snapshot do item; a OP nao pode
      -- transformar esse fato ao ser dividida em lote parcial.
      'color', v_item.color,
      'quantity', v_order.quantity,
      'grade', COALESCE(v_effective_grade, '{}'::jsonb),
      'strap_colors', COALESCE(v_item.strap_colors, '[]'::jsonb),
      'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb),
      'strap_sourcing_revision', v_item.strap_sourcing_revision,
      'main_production_start', v_main_production_start,
      'schedule_revision', COALESCE(v_schedule_revision, 0),
      'required_at', NULL,
      'billing_anchor', NULL,
      'billing_week', NULL,
      'scope_type', 'production_order',
      'scope_key', v_order.id
    );
  ELSE
    v_scope_key := public.try_parse_uuid(p_item ->> 'scope_key');
    IF v_scope_key IS NOT NULL AND v_scope_key IS DISTINCT FROM v_item.id THEN
      RAISE EXCEPTION 'scope_key nao corresponde ao item %', v_item.id
        USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_item.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % possui quantidade invalida', v_item.id
        USING ERRCODE = '22023';
    END IF;
    v_item_payload := p_item || pg_catalog.jsonb_build_object(
      'sale_order_id', v_item.sale_order_id,
      'sale_order_item_id', v_item.id,
      'reference_id', v_item.reference_id,
      'material_variant_id', v_item.material_variant_id,
      'color', v_item.color,
      'quantity', v_item.quantity,
      'grade', COALESCE(v_item.grade, '{}'::jsonb),
      'strap_colors', COALESCE(v_item.strap_colors, '[]'::jsonb),
      'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb),
      'strap_sourcing_revision', v_item.strap_sourcing_revision,
      'main_production_start', v_main_production_start,
      'schedule_revision', COALESCE(v_schedule_revision, 0),
      'required_at', NULL,
      'billing_anchor', NULL,
      'billing_week', NULL,
      'scope_type', 'sale_order_item',
      'scope_key', v_item.id
    );
  END IF;

  FOR v_preview IN
    SELECT previous.*
      FROM private.preview_sale_order_strap_demand_draft_pre_20270101015500(
             v_item_payload
           ) previous
     ORDER BY previous.line_ordinal
  LOOP
    SELECT pg_catalog.count(*)::integer,
           (pg_catalog.jsonb_agg(line.value ORDER BY line.ordinality) -> 0)
      INTO v_stored_line_count, v_stored_line
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(v_item.strap_colors) = 'array'
            THEN v_item.strap_colors
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY line(value, ordinality)
     WHERE public.try_parse_uuid(
             line.value ->> 'technical_strap_line_id'
           ) IS NOT DISTINCT FROM v_preview.technical_strap_line_id;

    v_identity := private.resolve_committed_strap_identity(
      v_item.id,
      v_preview.technical_strap_line_id,
      COALESCE(v_item.strap_sourcing, '{}'::jsonb)
    );

    IF COALESCE((v_identity ->> 'valid')::boolean, false) THEN
      v_frozen_source := v_identity ->> 'source_mode';
      v_frozen_variant_id := public.try_parse_uuid(
        v_identity ->> 'strap_variant_id'
      );
      v_frozen_recipe_id := public.try_parse_uuid(v_identity ->> 'recipe_id');
      v_frozen_base_product_id := public.try_parse_uuid(
        v_identity ->> 'base_product_id'
      );
      v_frozen_finished_product_id := public.try_parse_uuid(
        v_identity ->> 'finished_product_id'
      );
      v_snapshot_source := v_identity ->> 'snapshot_source';
      v_snapshot_complete := COALESCE(
        (v_identity ->> 'physical_snapshot_complete')::boolean, false
      );
      BEGIN
        v_frozen_yield := NULLIF(
          v_identity ->> 'confirmed_yield_m_per_m', ''
        )::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_frozen_yield := NULL;
      END;

      -- O helper anterior precisa executar para calcular o consumo congelado,
      -- mas bloqueios produzidos apenas pela ficha/catalogo vigentes nao podem
      -- reinterpretar uma identidade persistida valida.
      SELECT COALESCE(pg_catalog.jsonb_agg(
               reason.value ORDER BY reason.ordinality
             ), '[]'::jsonb)
        INTO v_reasons
        FROM pg_catalog.jsonb_array_elements(
          COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
        ) WITH ORDINALITY reason(value, ordinality)
       WHERE COALESCE(reason.value ->> 'code', '') NOT IN (
         'reference_unresolved',
         'technical_line_identity_invalid',
         'technical_identity_snapshot_stale',
         'identity_basis_invalid',
         'identity_group_missing',
         'measure_missing',
         'material_variant_mismatch',
         'base_group_unresolved',
         'color_id_missing',
         'source_mode_required',
         'internal_production_disabled',
         'source_mode_invalid',
         'catalog_resolution_blocked',
         'variant_identity_not_persisted',
         'variant_snapshot_stale',
         'reference_base_intent_mismatch',
         'pinned_base_product_mismatch',
         'finished_group_intent_mismatch',
         'frozen_source_snapshot_stale'
       );

      v_snapshot_resolved := CASE
        WHEN pg_catalog.jsonb_typeof(
          v_identity -> 'resolved_snapshot'
        ) = 'object' THEN v_identity -> 'resolved_snapshot'
        ELSE '{}'::jsonb
      END;
      v_catalog := CASE
        WHEN v_snapshot_complete
         AND pg_catalog.jsonb_typeof(
               v_snapshot_resolved -> 'catalog'
             ) = 'object'
          THEN v_snapshot_resolved -> 'catalog'
        ELSE '{}'::jsonb
      END || pg_catalog.jsonb_build_object(
        'variant_id', v_frozen_variant_id,
        'recipe_id', v_frozen_recipe_id,
        'recipe_version', CASE
          WHEN v_snapshot_complete THEN v_identity -> 'recipe_version'
          ELSE 'null'::jsonb
        END,
        'base_product_id', v_frozen_base_product_id,
        'finished_product_id', v_frozen_finished_product_id,
        'confirmed_yield_m_per_m', CASE
          WHEN v_snapshot_complete THEN pg_catalog.to_jsonb(v_frozen_yield)
          ELSE 'null'::jsonb
        END,
        'source_mode', v_frozen_source
      );

      IF v_snapshot_complete THEN
        -- Nunca complete um snapshot de demanda com metadado da ficha atual.
        v_resolved := v_snapshot_resolved;
      ELSE
        -- Antes da primeira demanda, reconstrua apenas da linha efetivamente
        -- salva no item + IDs de sourcing. O resolved do helper-base aponta
        -- para a ficha/catalogo atual e por isso e deliberadamente descartado.
        IF v_stored_line_count <> 1
           OR pg_catalog.jsonb_typeof(v_stored_line) IS DISTINCT FROM 'object' THEN
          v_reasons := v_reasons
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'code', 'committed_technical_snapshot_invalid',
              'field', 'strap_colors',
              'message', 'UUID da tira nao ocorre exatamente uma vez no item comprometido.'
            ));
          v_stored_line := '{}'::jsonb;
        END IF;
        v_resolved := pg_catalog.jsonb_build_object(
          'base_group_id', public.try_parse_uuid(
            COALESCE(
              v_identity ->> 'base_group_id',
              COALESCE(v_item.strap_sourcing, '{}'::jsonb)
                -> v_preview.technical_strap_line_id::text
                ->> 'base_group_id'
            )
          ),
          'identity_basis', COALESCE(NULLIF(
            v_stored_line ->> 'identity_basis', ''
          ), 'reference_base'),
          'identity_group_id', public.try_parse_uuid(
            v_stored_line ->> 'identity_group_id'
          ),
          'measure_id', public.try_parse_uuid(
            v_stored_line ->> 'measure_id'
          ),
          'strap_type_id', public.try_parse_uuid(
            v_stored_line ->> 'strap_type_id'
          ),
          'group_id', public.try_parse_uuid(v_stored_line ->> 'group_id'),
          'group_name', NULLIF(pg_catalog.btrim(
            v_stored_line ->> 'group_name'
          ), ''),
          'label', NULLIF(pg_catalog.btrim(v_stored_line ->> 'label'), ''),
          'color_id', public.try_parse_uuid(COALESCE(
            COALESCE(v_item.strap_sourcing, '{}'::jsonb)
              -> v_preview.technical_strap_line_id::text ->> 'color_id',
            v_stored_line ->> 'color_id'
          )),
          'color', NULLIF(pg_catalog.btrim(v_stored_line ->> 'color'), ''),
          'internal_production_enabled', CASE
            WHEN COALESCE(NULLIF(
                   v_stored_line ->> 'identity_basis', ''
                 ), 'reference_base') = 'finished_product_group' THEN false
            WHEN pg_catalog.jsonb_typeof(
                   v_stored_line -> 'internal_production_enabled'
                 ) = 'boolean' THEN
              (v_stored_line ->> 'internal_production_enabled')::boolean
            ELSE NULL
          END,
          'main_production_start', v_main_production_start,
          'schedule_revision', COALESCE(v_schedule_revision, 0)
        );
      END IF;

      v_resolved := COALESCE(v_resolved, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'catalog', v_catalog,
          'source_mode', v_frozen_source,
          'confirmed_yield_m_per_m', CASE
            WHEN v_snapshot_complete THEN pg_catalog.to_jsonb(v_frozen_yield)
            ELSE 'null'::jsonb
          END,
          'base_required_m', CASE
            WHEN v_snapshot_complete AND v_frozen_source = 'internal' THEN
              v_preview.gross_required_m / NULLIF(v_frozen_yield, 0)
            WHEN v_snapshot_complete THEN 0
            ELSE NULL
          END,
          'identity_snapshot_source', v_snapshot_source,
          'physical_snapshot_complete', v_snapshot_complete
        )
        || CASE
          WHEN v_snapshot_complete THEN '{}'::jsonb
          ELSE pg_catalog.jsonb_build_object(
            'snapshot_warning', v_identity ->> 'snapshot_warning'
          )
        END;

      RETURN QUERY SELECT
        v_preview.line_ordinal::integer,
        v_preview.technical_strap_line_id::uuid,
        v_frozen_variant_id,
        v_frozen_source,
        v_preview.gross_required_m::numeric,
        v_frozen_recipe_id,
        v_frozen_base_product_id,
        v_frozen_finished_product_id,
        v_reasons,
        v_resolved;
    ELSE
      v_reasons := COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'committed_identity_snapshot_missing',
          'field', 'strap_sourcing',
          'message', COALESCE(
            v_identity ->> 'reason',
            'Identidade comprometida da tira nao pode ser reidratada.'
          )
        ));
      RETURN QUERY SELECT
        v_preview.line_ordinal::integer,
        v_preview.technical_strap_line_id::uuid,
        v_preview.strap_variant_id::uuid,
        v_preview.source_mode::text,
        v_preview.gross_required_m::numeric,
        v_preview.recipe_id::uuid,
        v_preview.base_product_id::uuid,
        v_preview.finished_product_id::uuid,
        v_reasons,
        v_preview.resolved::jsonb;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb) IS
  'Preview canonico: rascunho prospectivo; PV comprometido reidratado do item/OP persistidos, com snapshot de tiras congelado por UUID.';

-- Recria o wrapper SQL para que sua dependencia aponte para a nova fronteira,
-- e nao para o OID privado que acabou de ser movido.
CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand(
  p_sale_order_id uuid
)
RETURNS TABLE(
  sale_order_item_id uuid,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT item.id,
         preview.technical_strap_line_id,
         preview.strap_variant_id,
         preview.source_mode,
         preview.gross_required_m,
         preview.recipe_id,
         preview.base_product_id,
         preview.finished_product_id,
         preview.blocking_reasons,
         preview.resolved
    FROM public.sale_order_items item
    CROSS JOIN LATERAL public.resolve_sale_order_main_production_start(
      p_sale_order_id, item.id
    ) schedule
    CROSS JOIN LATERAL public.preview_sale_order_strap_demand_draft(
      pg_catalog.jsonb_build_object(
        'sale_order_id', p_sale_order_id,
        'sale_order_item_id', item.id,
        'reference_id', item.reference_id,
        'material_variant_id', item.material_variant_id,
        'color', item.color,
        'quantity', item.quantity,
        'grade', item.grade,
        'strap_colors', item.strap_colors,
        'strap_sourcing', item.strap_sourcing,
        'main_production_start', schedule.main_production_start,
        'schedule_revision', schedule.schedule_revision,
        'scope_type', 'sale_order_item',
        'scope_key', item.id
      )
    ) preview
   WHERE item.sale_order_id = p_sale_order_id
   ORDER BY item.id, preview.line_ordinal;
$function$;

REVOKE ALL ON FUNCTION public.preview_sale_order_strap_demand(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_order_strap_demand(uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Snapshot/reserva: o setor e copiado no momento em que a obrigacao nasce.
--    Snapshot antigo sem o novo campo permanece explicitamente desconhecido;
--    nunca e reinterpretado pela ficha vigente.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.snapshot_sector_context_for_product(
  p_consumption_snapshot jsonb,
  p_product_id uuid,
  p_component text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_lines jsonb := '[]'::jsonb;
  v_matching integer := 0;
  v_annotated integer := 0;
  v_context_count integer := 0;
  v_sector text;
  v_source text;
  v_component text;
  v_line_source text;
BEGIN
  IF p_product_id IS NULL
     OR pg_catalog.jsonb_typeof(p_consumption_snapshot) IS DISTINCT FROM 'array' THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', NULL,
      'consumption_sector_source', 'snapshot_missing'
    );
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(line.value ORDER BY line.ordinality), '[]'::jsonb)
    INTO v_lines
    FROM pg_catalog.jsonb_array_elements(p_consumption_snapshot)
         WITH ORDINALITY line(value, ordinality)
   WHERE public.try_parse_uuid(line.value ->> 'product_id') = p_product_id
     AND (p_component IS NULL OR p_component = ''
       OR line.value ->> 'component' IS NOT DISTINCT FROM p_component)
     AND (p_source IS NULL OR p_source = ''
       OR line.value ->> 'source' IS NOT DISTINCT FROM p_source);

  IF pg_catalog.jsonb_array_length(v_lines) = 0 THEN
    -- Metadado legado de reserva muitas vezes nao tinha component/source.
    SELECT COALESCE(pg_catalog.jsonb_agg(line.value ORDER BY line.ordinality), '[]'::jsonb)
      INTO v_lines
      FROM pg_catalog.jsonb_array_elements(p_consumption_snapshot)
           WITH ORDINALITY line(value, ordinality)
     WHERE public.try_parse_uuid(line.value ->> 'product_id') = p_product_id;
  END IF;

  SELECT pg_catalog.count(*),
         pg_catalog.count(*) FILTER (
           WHERE line.value ? 'consumption_sector_source'
             AND line.value ? 'consumption_sector'
         ),
         pg_catalog.count(DISTINCT (
           COALESCE(line.value ->> 'consumption_sector', '<NULL>')
           || '|' || COALESCE(
             line.value ->> 'consumption_sector_source', '<MISSING>')
         )),
         pg_catalog.min(line.value ->> 'consumption_sector'),
         pg_catalog.min(line.value ->> 'consumption_sector_source'),
         pg_catalog.min(line.value ->> 'component'),
         pg_catalog.min(line.value ->> 'source')
    INTO v_matching, v_annotated, v_context_count,
         v_sector, v_source, v_component, v_line_source
    FROM pg_catalog.jsonb_array_elements(v_lines) line(value);

  IF v_matching = 0 OR v_annotated <> v_matching THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', NULL,
      'consumption_sector_source', 'snapshot_missing',
      'component', v_component,
      'source', v_line_source
    );
  ELSIF v_context_count > 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'consumption_sector', NULL,
      'consumption_sector_source', 'ambiguous',
      'component', v_component,
      'source', v_line_source
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'consumption_sector', v_sector,
    'consumption_sector_source', v_source,
    'component', v_component,
    'source', v_line_source
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.snapshot_sector_context_for_product(
  jsonb, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.freeze_material_reservation_sector_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- reservation_sector_snapshot_20270101015500
  v_order public.orders%ROWTYPE;
  v_snapshot jsonb;
  v_has_snapshot boolean := false;
  v_lines jsonb;
  v_context jsonb;
  v_effective_grade jsonb;
  v_variant_id uuid;
BEGIN
  IF NEW.order_id IS NULL OR NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Reservas do subsistema de tiras ja carregam identidade/demanda propria e
  -- nao pertencem ao roteamento de BOM/componentes diretos.
  IF NEW.strap_variant_id IS NOT NULL
     OR NEW.sale_order_strap_demand_id IS NOT NULL
     OR COALESCE(NEW.metadata, '{}'::jsonb) ? 'consumption_sector_source' THEN
    RETURN NEW;
  END IF;

  SELECT production_order.*
    INTO v_order
    FROM public.orders production_order
   WHERE production_order.id = NEW.order_id
     AND production_order.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT snapshot.consumption_snapshot, true
    INTO v_snapshot, v_has_snapshot
    FROM public.technical_sheet_snapshots snapshot
   WHERE snapshot.sale_order_item_id = v_order.sale_order_item_id
     AND snapshot.sale_order_id IS NOT DISTINCT FROM v_order.sale_order_id
   ORDER BY snapshot.frozen_at DESC, snapshot.id DESC
   LIMIT 1;

  IF v_has_snapshot THEN
    v_context := private.snapshot_sector_context_for_product(
      v_snapshot,
      NEW.product_id,
      COALESCE(NEW.metadata ->> 'component', ''),
      COALESCE(NEW.metadata ->> 'source', '')
    );
  ELSE
    IF v_order.sale_order_item_id IS NOT NULL THEN
      SELECT item.material_variant_id
        INTO v_variant_id
        FROM public.sale_order_items item
       WHERE item.id = v_order.sale_order_item_id;
    END IF;
    v_effective_grade := public.resolve_effective_op_grade(
      v_order.grade, v_order.quantity
    );
    IF v_effective_grade IS NOT NULL THEN
      v_lines := public.calculate_order_consumption_by_grade(
        v_order.reference_id,
        v_effective_grade,
        COALESCE(v_order.color, ''),
        v_variant_id
      );
    ELSE
      v_lines := public.calculate_order_consumption(
        v_order.reference_id,
        v_order.quantity,
        COALESCE(v_order.color, ''),
        NULL::integer,
        v_variant_id
      );
    END IF;
    v_context := private.snapshot_sector_context_for_product(
      v_lines,
      NEW.product_id,
      COALESCE(NEW.metadata ->> 'component', ''),
      COALESCE(NEW.metadata ->> 'source', '')
    );
    -- Neste ramo nao havia snapshot historico a preservar; os campos vieram
    -- do motor atual e podem conservar explicit/legacy_fallback.
    IF v_context ->> 'consumption_sector_source' = 'snapshot_missing' THEN
      v_context := pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'legacy_fallback'
      );
    END IF;
  END IF;

  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb)
    || (COALESCE(
      v_context,
      pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'snapshot_missing'
      )
    ) - 'component' - 'source')
    || CASE
      WHEN NULLIF(v_context ->> 'component', '') IS NOT NULL
        THEN pg_catalog.jsonb_build_object(
          'component', v_context ->> 'component'
        )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN NULLIF(v_context ->> 'source', '') IS NOT NULL
        THEN pg_catalog.jsonb_build_object('source', v_context ->> 'source')
      ELSE '{}'::jsonb
    END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.freeze_material_reservation_sector_context()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_freeze_reservation_consumption_sector
  ON public.material_reservations;
CREATE TRIGGER trg_freeze_reservation_consumption_sector
  BEFORE INSERT ON public.material_reservations
  FOR EACH ROW
  EXECUTE FUNCTION private.freeze_material_reservation_sector_context();

-- Resolve a apresentacao historica. Em PV comprometido, reserva (escopo OP)
-- vence snapshot; snapshot vence qualquer informacao calculada da ficha atual.
CREATE OR REPLACE FUNCTION private.resolve_report_consumption_sector_context(
  p_scope_type text,
  p_scope_key uuid,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_product_id uuid,
  p_component text,
  p_source text,
  p_current_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status text;
  v_context jsonb;
  v_snapshot jsonb;
  v_context_count integer := 0;
  v_annotated integer := 0;
  v_sector text;
  v_origin text;
  v_sale_order_found boolean := false;
BEGIN
  SELECT sale_order.status
    INTO v_status
   FROM public.sale_orders sale_order
   WHERE sale_order.id = p_sale_order_id;
  v_sale_order_found := FOUND;

  IF v_sale_order_found
     AND NOT private.is_committed_sale_order_status(v_status) THEN
    RETURN COALESCE(
      p_current_context,
      pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'legacy_fallback'
      )
    );
  END IF;

  IF p_scope_type = 'production_order'
     AND p_scope_key IS NOT NULL
     AND p_product_id IS NOT NULL THEN
    SELECT pg_catalog.count(DISTINCT (
             COALESCE(reservation.metadata ->> 'consumption_sector', '<NULL>')
             || '|' || COALESCE(
               reservation.metadata ->> 'consumption_sector_source', '<MISSING>')
           )),
           pg_catalog.count(*) FILTER (
             WHERE reservation.metadata ? 'consumption_sector_source'
               AND reservation.metadata ? 'consumption_sector'
           ),
           pg_catalog.min(reservation.metadata ->> 'consumption_sector'),
           pg_catalog.min(reservation.metadata ->> 'consumption_sector_source')
      INTO v_context_count, v_annotated, v_sector, v_origin
      FROM public.material_reservations reservation
     WHERE reservation.order_id = p_scope_key
       AND reservation.product_id = p_product_id
       AND (p_component IS NULL OR p_component = ''
         OR reservation.metadata ->> 'component' IS NULL
         OR reservation.metadata ->> 'component' = p_component)
       AND (p_source IS NULL OR p_source = ''
         OR reservation.metadata ->> 'source' IS NULL
         OR reservation.metadata ->> 'source' = p_source);

    IF v_annotated > 0
       AND v_context_count = 1
       AND v_origin = 'ambiguous' THEN
      -- reservation_ambiguous_passthrough_20270101015500
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'ambiguous',
        'consumption_sector_origin', 'ambiguous'
      );
    ELSIF v_annotated > 0 AND v_context_count = 1 THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', v_sector,
        'consumption_sector_source', 'reservation',
        'consumption_sector_origin', v_origin
      );
    ELSIF v_context_count > 1 THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'ambiguous'
      );
    END IF;
  END IF;

  -- OP avulsa nao tem snapshot de PV. A reserva congelada ainda vence; se nao
  -- houver, preserve o contexto calculado da propria OP em vez de rotula-lo
  -- como historico ausente.
  IF NOT v_sale_order_found THEN
    RETURN COALESCE(
      p_current_context,
      pg_catalog.jsonb_build_object(
        'consumption_sector', NULL,
        'consumption_sector_source', 'legacy_fallback'
      )
    );
  END IF;

  SELECT snapshot.consumption_snapshot
    INTO v_snapshot
    FROM public.technical_sheet_snapshots snapshot
   WHERE snapshot.sale_order_item_id = p_sale_order_item_id
     AND snapshot.sale_order_id IS NOT DISTINCT FROM p_sale_order_id
   ORDER BY snapshot.frozen_at DESC, snapshot.id DESC
   LIMIT 1;
  IF FOUND THEN
    v_context := private.snapshot_sector_context_for_product(
      v_snapshot, p_product_id, p_component, p_source
    );
    IF v_context ->> 'consumption_sector_source'
         NOT IN ('snapshot_missing', 'ambiguous') THEN
      RETURN pg_catalog.jsonb_build_object(
        'consumption_sector', v_context -> 'consumption_sector',
        'consumption_sector_source', 'snapshot',
        'consumption_sector_origin',
          v_context ->> 'consumption_sector_source'
      );
    END IF;
    RETURN v_context;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'consumption_sector', NULL,
    'consumption_sector_source', 'snapshot_missing'
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_report_consumption_sector_context(
  text, uuid, uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Relatorio canonico: conserva as quantidades do motor original, troca
--    somente o contexto de setor e recompõe previews com escopo explícito.
-- -----------------------------------------------------------------------------

DO $move_previous_report$
BEGIN
  IF pg_catalog.to_regprocedure(
       'private.calculate_consumption_report_batch_pre_20270101015500(uuid[],uuid[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight: helper privado do relatorio 15500 ja existe';
  END IF;

  ALTER FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[])
    RENAME TO calculate_consumption_report_batch_pre_20270101015500;
  ALTER FUNCTION public.calculate_consumption_report_batch_pre_20270101015500(
    uuid[], uuid[]
  ) SET SCHEMA private;
END;
$move_previous_report$;

REVOKE ALL ON FUNCTION
  private.calculate_consumption_report_batch_pre_20270101015500(uuid[], uuid[])
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.calculate_consumption_report_batch(
  p_sale_order_ids uuid[] DEFAULT NULL::uuid[],
  p_order_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- historical_preview_and_sector_report_20270101015500
  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_report jsonb;
  v_lines jsonb;
  v_previews jsonb := '[]'::jsonb;
  v_scope record;
  v_preview record;
  v_preview_payload jsonb;
  v_effective_grade jsonb;
  v_main_production_start date;
  v_schedule_revision integer;
BEGIN
  IF NOT v_is_service AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;

  -- O helper anterior continua sendo a autoridade de validacao, consumo,
  -- disponibilidade e embalagem. Ele tambem rejeita escopos mistos/ausentes.
  v_report := private.calculate_consumption_report_batch_pre_20270101015500(
    p_sale_order_ids, p_order_ids
  );
  IF pg_catalog.jsonb_typeof(v_report -> 'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Relatorio-base devolveu lines invalido'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    CASE
      WHEN line.value ->> 'line_kind' = 'material' THEN
        line.value || private.resolve_report_consumption_sector_context(
          line.value ->> 'scope_type',
          public.try_parse_uuid(line.value ->> 'scope_key'),
          public.try_parse_uuid(line.value ->> 'sale_order_id'),
          public.try_parse_uuid(line.value ->> 'sale_order_item_id'),
          public.try_parse_uuid(line.value ->> 'product_id'),
          line.value ->> 'component',
          line.value ->> 'source',
          pg_catalog.jsonb_build_object(
            'consumption_sector', line.value -> 'consumption_sector',
            'consumption_sector_source', COALESCE(
              line.value ->> 'consumption_sector_source',
              'legacy_fallback'
            )
          )
        )
      ELSE line.value
    END
    ORDER BY line.ordinality
  ), '[]'::jsonb)
    INTO v_lines
    FROM pg_catalog.jsonb_array_elements(v_report -> 'lines')
         WITH ORDINALITY line(value, ordinality);

  -- scope_type/scope_key sao parte da fronteira: sem eles um lote parcial
  -- seria indistinguivel do item integral do PV.
  FOR v_scope IN
    SELECT item.id AS scope_key,
           'sale_order_item'::text AS scope_type,
           item.sale_order_id,
           item.id AS sale_order_item_id,
           item.reference_id,
           item.material_variant_id,
           item.color,
           item.quantity::numeric AS quantity,
           item.grade,
           item.strap_colors,
           item.strap_sourcing
      FROM public.sale_order_items item
     WHERE item.sale_order_id = ANY(
       COALESCE(p_sale_order_ids, ARRAY[]::uuid[])
     )
       AND item.production_excluded_at IS NULL

    UNION ALL

    SELECT production_order.id AS scope_key,
           'production_order'::text AS scope_type,
           production_order.sale_order_id,
           production_order.sale_order_item_id,
           production_order.reference_id,
           item.material_variant_id,
           item.color,
           production_order.quantity::numeric AS quantity,
           production_order.grade,
           item.strap_colors,
           item.strap_sourcing
      FROM public.orders production_order
      JOIN public.sale_order_items item
        ON item.id = production_order.sale_order_item_id
       AND item.sale_order_id IS NOT DISTINCT FROM production_order.sale_order_id
       AND item.reference_id IS NOT DISTINCT FROM production_order.reference_id
     WHERE production_order.id = ANY(
       COALESCE(p_order_ids, ARRAY[]::uuid[])
     )
       AND production_order.deleted_at IS NULL
     ORDER BY scope_key
  LOOP
    SELECT schedule.main_production_start, schedule.schedule_revision
      INTO v_main_production_start, v_schedule_revision
      FROM public.resolve_sale_order_main_production_start(
        v_scope.sale_order_id, v_scope.sale_order_item_id
      ) schedule
     LIMIT 1;

    IF v_scope.scope_type = 'production_order' THEN
      v_effective_grade := public.resolve_effective_op_grade(
        v_scope.grade, v_scope.quantity
      );
    ELSE
      v_effective_grade := v_scope.grade;
    END IF;

    v_preview_payload := pg_catalog.jsonb_build_object(
      'sale_order_id', v_scope.sale_order_id,
      'sale_order_item_id', v_scope.sale_order_item_id,
      'reference_id', v_scope.reference_id,
      'material_variant_id', v_scope.material_variant_id,
      'color', v_scope.color,
      'quantity', v_scope.quantity,
      'grade', COALESCE(v_effective_grade, '{}'::jsonb),
      'strap_colors', v_scope.strap_colors,
      'strap_sourcing', v_scope.strap_sourcing,
      'main_production_start', v_main_production_start,
      'schedule_revision', v_schedule_revision,
      'scope_type', v_scope.scope_type,
      'scope_key', v_scope.scope_key
    );

    FOR v_preview IN
      SELECT preview.*
        FROM public.preview_sale_order_strap_demand_draft(
          v_preview_payload
        ) preview
       ORDER BY preview.line_ordinal
    LOOP
      v_previews := v_previews || pg_catalog.jsonb_build_array(
        pg_catalog.to_jsonb(v_preview) || pg_catalog.jsonb_build_object(
          'scope_key', v_scope.scope_key,
          'scope_type', v_scope.scope_type,
          'sale_order_id', v_scope.sale_order_id,
          'sale_order_item_id', v_scope.sale_order_item_id
        )
      );
    END LOOP;
  END LOOP;

  RETURN pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(v_report, '{lines}', v_lines, true),
    '{strap_previews}', v_previews, true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.calculate_consumption_report_batch(uuid[], uuid[]) IS
  'Relatorio canonico com preview de tiras por escopo persistido e setor explicito congelado em snapshot/reserva; nao altera required.';

-- -----------------------------------------------------------------------------
-- 6. Manifesto offline minimo e autoritativo. Inclui referencias publicadas
--    sem tiras (lines=[]): essa ausencia explicita permite remover cache velho.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.mobile_strap_allowed_colors(
  p_identity_basis text,
  p_base_group_id uuid,
  p_measure_id uuid,
  p_presentation_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_colors jsonb;
BEGIN
  IF p_base_group_id IS NULL OR p_measure_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_identity_basis = 'finished_product_group' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('id', color.id, 'name', color.name)
             ORDER BY color.name_norm, color.id
           ), '[]'::jsonb)
      INTO v_colors
      FROM public.canonical_colors color
     WHERE color.active
       AND EXISTS (
         SELECT 1
           FROM public.artisanal_strap_variants variant
           JOIN public.artisanal_strap_measures measure
             ON measure.id = variant.measure_id
            AND measure.active
           JOIN public.artisanal_strap_types strap_type
             ON strap_type.id = measure.strap_type_id
            AND strap_type.active
           JOIN public.products product
             ON product.id = variant.finished_product_id
          WHERE variant.measure_id = p_measure_id
            AND variant.base_group_id = p_base_group_id
            AND variant.color_id = color.id
            AND variant.identity_basis = 'finished_product_group'
            AND variant.status = 'active'
            AND variant.purchase_enabled
            AND NOT variant.internal_production_enabled
            AND variant.min_stock_m IS NOT NULL
            AND variant.min_stock_replenishment_mode IS NOT NULL
            AND product.active
            AND product.group_id = p_base_group_id
            AND product.unit = 'm'
            AND public.resolve_strap_canonical_color_id(product.color) = color.id
            AND COALESCE((
              public.resolve_artisanal_strap_source_availability(variant.id)
                ->> 'buy_ready_purchase_allowed'
            )::boolean, false)
       );
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('id', color.id, 'name', color.name)
             ORDER BY color.name_norm, color.id
           ), '[]'::jsonb)
      INTO v_colors
      FROM public.canonical_colors color
     WHERE color.active
       AND NOT public.is_buy_ready_strass_identity(
         NULL, p_presentation_group_id
       )
       AND EXISTS (
         SELECT 1
           FROM public.artisanal_strap_measures measure
           JOIN public.artisanal_strap_types strap_type
             ON strap_type.id = measure.strap_type_id
            AND strap_type.active
          WHERE measure.id = p_measure_id
            AND measure.active
       )
       AND EXISTS (
         WITH selected_base AS (
           SELECT official.official_product_id AS product_id
             FROM public.base_material_color_official_products official
            WHERE official.base_group_id = p_base_group_id
              AND official.color_id = color.id
              AND official.status = 'active'
           UNION ALL
           SELECT (pg_catalog.array_agg(product.id ORDER BY product.id))[1]
             FROM public.products product
            WHERE product.group_id = p_base_group_id
              AND product.active
              AND product.unit = 'm'
              AND public.resolve_strap_canonical_color_id(product.color)
                    = color.id
              AND NOT EXISTS (
                SELECT 1
                  FROM public.artisanal_strap_variants used_as_finished
                 WHERE used_as_finished.finished_product_id = product.id
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM public.base_material_color_official_products official
                 WHERE official.base_group_id = p_base_group_id
                   AND official.color_id = color.id
                   AND official.status = 'active'
              )
           HAVING pg_catalog.count(*) = 1
         )
         SELECT 1
           FROM selected_base selected
           JOIN public.products product
             ON product.id = selected.product_id
            AND product.active
            AND product.group_id = p_base_group_id
            AND product.unit = 'm'
            AND public.resolve_strap_canonical_color_id(product.color) = color.id
           JOIN public.artisanal_strap_recipes recipe
             ON recipe.measure_id = p_measure_id
            AND recipe.base_group_id = p_base_group_id
            AND recipe.status = 'approved'
            AND recipe.valid_from <= pg_catalog.now()
            AND (recipe.valid_to IS NULL OR recipe.valid_to > pg_catalog.now())
            AND public.strap_material_product_width_mm(product.id) IS NOT NULL
            AND pg_catalog.abs(
              public.strap_material_product_width_mm(product.id)
                - recipe.usable_base_width_mm_snapshot
            ) <= 0.000001
       )
       AND (
         NOT EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants occupied
            WHERE occupied.measure_id = p_measure_id
              AND occupied.base_group_id = p_base_group_id
              AND occupied.color_id = color.id
         )
         OR EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants variant
             JOIN public.products finished
               ON finished.id = variant.finished_product_id
            WHERE variant.measure_id = p_measure_id
              AND variant.base_group_id = p_base_group_id
              AND variant.color_id = color.id
              AND variant.identity_basis = 'reference_base'
              AND variant.status = 'active'
              AND variant.internal_production_enabled
              AND finished.active
              AND finished.unit = 'm'
              AND NOT public.is_buy_ready_strass_identity(
                finished.id, finished.group_id
              )
              AND public.resolve_strap_canonical_color_id(finished.color)
                    = color.id
         )
       );
  END IF;
  RETURN v_colors;
END;
$function$;

REVOKE ALL ON FUNCTION private.mobile_strap_allowed_colors(
  text, uuid, uuid, uuid
)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_mobile_strap_offline_manifest(
  p_reference_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- mobile_strap_offline_manifest_v1_20270101015500
  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_requested uuid[];
  v_missing text;
  v_context record;
  v_line record;
  v_references jsonb := '[]'::jsonb;
  v_lines jsonb;
  v_allowed_colors jsonb;
  v_identity_basis text;
  v_identity_group_id uuid;
  v_technical_line_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_group_id uuid;
  v_group_name text;
  v_base_group_id uuid;
  v_consumption numeric;
  v_consumption_per_size jsonb;
  v_internal_enabled boolean;
  v_generated_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF NOT v_is_service AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(DISTINCT requested.id ORDER BY requested.id),
           ARRAY[]::uuid[]
         )
    INTO v_requested
    FROM pg_catalog.unnest(COALESCE(
      p_reference_ids, ARRAY[]::uuid[]
    )) requested(id)
   WHERE requested.id IS NOT NULL;
  IF pg_catalog.cardinality(v_requested) > 200 THEN
    RAISE EXCEPTION 'Manifesto aceita no maximo 200 referencias'
      USING ERRCODE = '54000';
  END IF;

  IF pg_catalog.cardinality(v_requested) > 0 THEN
    SELECT pg_catalog.string_agg(requested.id::text, ', ' ORDER BY requested.id)
      INTO v_missing
      FROM pg_catalog.unnest(v_requested) requested(id)
      LEFT JOIN public.technical_sheets sheet
        ON sheet.id = requested.id
       AND public.normalize_strap_catalog_text(sheet.status_ficha)
             IN ('publicada', 'validada')
       AND sheet.retired_at IS NULL
     WHERE sheet.id IS NULL;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'Referencia(s) inexistente(s) ou nao publicada(s): %',
        v_missing USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_context IN
    WITH eligible_sheets AS (
      SELECT sheet.*
        FROM public.technical_sheets sheet
       WHERE public.normalize_strap_catalog_text(sheet.status_ficha)
               IN ('publicada', 'validada')
         AND sheet.retired_at IS NULL
         AND (
           pg_catalog.cardinality(v_requested) = 0
           OR sheet.id = ANY(v_requested)
         )
    ), contexts AS (
      SELECT sheet.id AS reference_id,
             NULL::uuid AS material_variant_id,
             -1::numeric AS display_order,
             sheet.strap_colors
        FROM eligible_sheets sheet
      UNION ALL
      SELECT sheet.id,
             variant.id,
             COALESCE(variant.display_order, 0),
             sheet.strap_colors
        FROM eligible_sheets sheet
        JOIN public.reference_material_variants variant
          ON variant.reference_id = sheet.id
         AND COALESCE(variant.active, true)
    )
    SELECT *
      FROM contexts
     ORDER BY reference_id, display_order, material_variant_id NULLS FIRST
  LOOP
    v_lines := '[]'::jsonb;
    FOR v_line IN
      SELECT entry.value, entry.ordinality
        FROM pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(v_context.strap_colors) = 'array'
              THEN v_context.strap_colors
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY entry(value, ordinality)
       ORDER BY entry.ordinality
    LOOP
      -- O manifesto nao pode "curar" uma linha que o writer vivo rejeitaria.
      -- Os tres UUIDs canonicos precisam existir na propria ficha; aliases e
      -- identity_map servem para diagnostico/migracao, nao para autorizar um PV
      -- offline que depois falharia ao sincronizar.
      v_technical_line_id := public.try_parse_uuid(
        v_line.value ->> 'technical_strap_line_id'
      );
      v_measure_id := public.try_parse_uuid(v_line.value ->> 'measure_id');
      v_strap_type_id := public.try_parse_uuid(
        v_line.value ->> 'strap_type_id'
      );

      v_identity_basis := CASE
        WHEN v_line.value ->> 'identity_basis' = 'finished_product_group'
          THEN 'finished_product_group'
        ELSE 'reference_base'
      END;
      v_identity_group_id := CASE
        WHEN v_identity_basis = 'finished_product_group' THEN
          public.try_parse_uuid(v_line.value ->> 'identity_group_id')
        ELSE NULL
      END;
      v_group_id := public.try_parse_uuid(v_line.value ->> 'group_id');
      SELECT product_group.name
        INTO v_group_name
        FROM public.product_groups product_group
       WHERE product_group.id = v_group_id;
      v_group_name := COALESCE(
        NULLIF(pg_catalog.btrim(v_line.value ->> 'group_name'), ''),
        v_group_name
      );
      v_base_group_id := CASE
        WHEN v_identity_basis = 'finished_product_group'
          THEN v_identity_group_id
        ELSE public.resolve_strap_base_group_id(
          v_context.reference_id, v_context.material_variant_id
        )
      END;

      v_consumption := NULL;
      BEGIN
        v_consumption := NULLIF(
          v_line.value ->> 'consumption', ''
        )::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_consumption := NULL;
      END;
      v_consumption_per_size := CASE
        WHEN pg_catalog.jsonb_typeof(
          v_line.value -> 'consumption_per_size'
        ) = 'object' THEN v_line.value -> 'consumption_per_size'
        ELSE NULL
      END;
      v_internal_enabled := CASE
        WHEN v_identity_basis = 'finished_product_group' THEN false
        WHEN pg_catalog.jsonb_typeof(
          v_line.value -> 'internal_production_enabled'
        ) = 'boolean' THEN (
          v_line.value ->> 'internal_production_enabled'
        )::boolean
        ELSE true
      END;
      v_allowed_colors := CASE
        WHEN v_technical_line_id IS NULL
          OR v_measure_id IS NULL
          OR v_strap_type_id IS NULL
          OR (
            v_identity_basis = 'finished_product_group'
            AND v_identity_group_id IS NULL
          ) THEN '[]'::jsonb
        ELSE private.mobile_strap_allowed_colors(
          v_identity_basis, v_base_group_id, v_measure_id, v_group_id
        )
      END;

      v_lines := v_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'technical_strap_line_id', v_technical_line_id,
          'position', v_line.ordinality,
          'label', NULLIF(pg_catalog.btrim(
            v_line.value ->> 'label'), ''),
          'identity_basis', v_identity_basis,
          'identity_group_id', v_identity_group_id,
          'strap_type_id', v_strap_type_id,
          'measure_id', v_measure_id,
          'color_mode', CASE
            WHEN v_identity_basis = 'finished_product_group'
              OR v_line.value ->> 'color_mode' = 'select_on_order'
              THEN 'select_on_order'
            ELSE 'follow_main'
          END,
          'internal_production_enabled', v_internal_enabled,
          'group_id', v_group_id,
          'group_name', v_group_name,
          'consumption', v_consumption,
          'consumption_per_size', v_consumption_per_size,
          'base_group_id', v_base_group_id,
          'allowed_colors', v_allowed_colors
        )
      );
    END LOOP;

    v_references := v_references || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference_id', v_context.reference_id,
        'material_variant_id', v_context.material_variant_id,
        'lines', v_lines
      )
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'version', 1,
    'generated_at', v_generated_at,
    'manifest_hash', public.strap_payload_hash(v_references),
    'references', v_references
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mobile_strap_offline_manifest(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_strap_offline_manifest(uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_mobile_strap_offline_manifest(uuid[]) IS
  'Manifesto offline v1 nao financeiro: definicao tecnica congelavel e cores permitidas por referencia/variante; inclui lines=[] para contexto publicado sem tiras.';

-- -----------------------------------------------------------------------------
-- 7. Contratos executaveis e pos-condicoes da migration.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_strap_snapshot_sector_contract_tests()
RETURNS TABLE(case_name text, passed boolean, details text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_preview text := pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  );
  v_identity text := pg_catalog.pg_get_functiondef(
    'private.resolve_committed_strap_identity(uuid,uuid,jsonb)'::regprocedure
  );
  v_enqueue text := pg_catalog.pg_get_functiondef(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
  );
  v_engine text := pg_catalog.pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  );
  v_report text := pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  );
  v_sector_report_resolver text := pg_catalog.pg_get_functiondef(
    'private.resolve_report_consumption_sector_context(text,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  );
  v_manifest text := pg_catalog.pg_get_functiondef(
    'public.get_mobile_strap_offline_manifest(uuid[])'::regprocedure
  );
  v_freeze text := pg_catalog.pg_get_functiondef(
    'public.freeze_technical_sheet(uuid,uuid,uuid,text,numeric,integer,jsonb)'::regprocedure
  );
BEGIN
  RETURN QUERY VALUES
    (
      'estado_comprometido_fail_closed'::text,
      NOT private.is_committed_sale_order_status('Rascunho')
      AND NOT private.is_committed_sale_order_status('Pendente')
      AND NOT private.is_committed_sale_order_status('draft')
      AND NOT private.is_committed_sale_order_status('pending')
      AND private.is_committed_sale_order_status('Aprovado')
      AND private.is_committed_sale_order_status('Entregue')
      AND private.is_committed_sale_order_status('estado futuro')
      AND private.is_committed_sale_order_status(NULL),
      'somente quatro aliases editaveis; desconhecido/NULL fecha como comprometido'::text
    ),
    (
      'preview_reidrata_comprometido'::text,
      position(
        'committed_strap_preview_rehydration_20270101015500' IN v_preview
      ) > 0
      AND position('v_item.strap_colors' IN v_preview) > 0
      AND position('v_order.quantity' IN v_preview) > 0
      AND position('resolve_effective_op_grade' IN v_preview) > 0,
      'item/OP persistidos vencem payload em estado comprometido'::text
    ),
    (
      'preview_acl_e_search_path'::text,
      NOT pg_catalog.has_function_privilege(
        'anon',
        'public.preview_sale_order_strap_demand_draft(jsonb)',
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated',
        'public.preview_sale_order_strap_demand_draft(jsonb)',
        'EXECUTE'
      )
      AND position('is_approved_user' IN v_preview) > 0
      AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc procedure
         WHERE procedure.oid =
           'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
           AND procedure.prosecdef
           AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      ),
      'sem anon; approved/service; SECURITY DEFINER com search_path vazio'::text
    ),
    (
      'helper_preview_anterior_privado'::text,
      pg_catalog.to_regprocedure(
        'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'
      ) IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)',
        'EXECUTE'
      ),
      'implementacao anterior nao e RPC publica'::text
    ),
    (
      'enqueue_usa_preview_operacional_privado'::text,
      position(
        'private.preview_sale_order_strap_demand_operational' IN v_enqueue
      ) > 0
      AND position(
        'public.preview_sale_order_strap_demand(p_sale_order_id)' IN v_enqueue
      ) = 0
      AND pg_catalog.to_regprocedure(
        'private.preview_sale_order_strap_demand_operational(uuid)'
      ) IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'private.preview_sale_order_strap_demand_operational(uuid)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'private.preview_sale_order_strap_demand_operational(uuid)',
        'EXECUTE'
      ),
      'primeira demanda usa payload do banco sem flag publica de bypass'::text
    ),
    (
      'preview_pre_demanda_nao_finge_yield_congelado'::text,
      position('sale_order_item_pre_demand' IN v_identity) > 0
      AND position('physical_snapshot_complete' IN v_preview) > 0
      AND position('snapshot_warning' IN v_preview) > 0
      AND position(
        'v_preview.resolved, ''{}''::jsonb) || v_snapshot_resolved'
          IN v_preview
      ) = 0,
      'sem demanda, resolved e reconstruido do item e yield/base ficam informativos'::text
    ),
    (
      'setor_source_null_nao_herda_por_sku'::text,
      private.resolve_consumption_sector_context(
        '00000000-0000-0000-0000-000000000001'::uuid,
        NULL,
        '00000000-0000-0000-0000-000000000002'::uuid,
        NULL
      ) ->> 'consumption_sector_source' = 'legacy_fallback',
      'source ausente nao entra no ramo de componentes diretos'::text
    ),
    (
      'motor_anexa_setor_sem_recalcular_required'::text,
      position(
        'consumption_sector_context_20270101015500' IN v_engine
      ) > 0
      AND position(
        'private.attach_consumption_sector_context' IN v_engine
      ) > 0,
      'anotacao ocorre somente no retorno v_result'::text
    ),
    (
      'snapshot_usa_motor_canonico'::text,
      position('calculate_order_consumption_by_grade' IN v_freeze) > 0
      AND position('consumption_snapshot' IN v_freeze) > 0,
      'freeze persiste o array ja anotado pelo motor'::text
    ),
    (
      'reserva_congela_metadata'::text,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_trigger trigger
         WHERE trigger.tgrelid = 'public.material_reservations'::regclass
           AND trigger.tgname = 'trg_freeze_reservation_consumption_sector'
           AND NOT trigger.tgisinternal
      )
      AND pg_catalog.to_regprocedure(
        'private.freeze_material_reservation_sector_context()'
      ) IS NOT NULL,
      'todas as insercoes canonicas passam pela mesma fronteira'::text
    ),
    (
      'relatorio_usa_snapshot_reserva_e_escopo'::text,
      position(
        'historical_preview_and_sector_report_20270101015500' IN v_report
      ) > 0
      AND position(
        'private.resolve_report_consumption_sector_context' IN v_report
      ) > 0
      AND position($needle$'scope_type', v_scope.scope_type$needle$
            IN v_report) > 0
      AND position($needle$'scope_key', v_scope.scope_key$needle$
            IN v_report) > 0,
      'report nao confunde item integral com OP parcial'::text
    ),
    (
      'relatorio_nao_mascara_reserva_ambigua'::text,
      position(
        'reservation_ambiguous_passthrough_20270101015500'
          IN v_sector_report_resolver
      ) > 0
      AND position($needle$v_origin = 'ambiguous'$needle$
            IN v_sector_report_resolver) > 0,
      'metadata ambigua permanece bloqueante em vez de virar reservation'::text
    ),
    (
      'manifesto_v1_minimo_autoritativo'::text,
      position(
        'mobile_strap_offline_manifest_v1_20270101015500' IN v_manifest
      ) > 0
      AND position($needle$'version', 1$needle$ IN v_manifest) > 0
      AND position($needle$'allowed_colors'$needle$ IN v_manifest) > 0
      AND position($needle$'consumption_per_size'$needle$ IN v_manifest) > 0
      AND position($needle$'manifest_hash'$needle$ IN v_manifest) > 0
      AND position('v_measure_id' IN v_manifest) > 0
      AND position('unit_price' IN v_manifest) = 0
      AND position('purchase_price' IN v_manifest) = 0
      AND position('finished_available_m' IN v_manifest) = 0,
      'shape tecnico sem preco/saldo/source financeiro'::text
    ),
    (
      'manifesto_acl_e_search_path'::text,
      NOT pg_catalog.has_function_privilege(
        'anon',
        'public.get_mobile_strap_offline_manifest(uuid[])',
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_mobile_strap_offline_manifest(uuid[])',
        'EXECUTE'
      )
      AND position('is_approved_user' IN v_manifest) > 0
      AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc procedure
         WHERE procedure.oid =
           'public.get_mobile_strap_offline_manifest(uuid[])'::regprocedure
           AND procedure.prosecdef
           AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      ),
      'manifesto nao contorna aprovacao/RLS'::text
    ),
    (
      'baixa_por_entrada_no_setor_desativada'::text,
      NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_trigger trigger
         WHERE trigger.tgname IN (
           'trg_ab_debit_materials_when_sector_starts',
           'trg_aa0_preserve_unstarted_sector_reservations',
           'trg_assign_reservation_consumption_sector'
         )
           AND NOT trigger.tgisinternal
      ),
      'picking/finalizacao continuam sendo os unicos pontos de baixa'::text
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_strap_snapshot_sector_contract_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_strap_snapshot_sector_contract_tests()
  TO service_role;

DO $assert_contracts$
DECLARE
  v_failed text;
BEGIN
  SELECT pg_catalog.string_agg(test.case_name, ', ' ORDER BY test.case_name)
    INTO v_failed
    FROM public.run_strap_snapshot_sector_contract_tests() test
   WHERE NOT test.passed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Pos-condicao 15500 falhou: %', v_failed;
  END IF;
END;
$assert_contracts$;

NOTIFY pgrst, 'reload schema';
