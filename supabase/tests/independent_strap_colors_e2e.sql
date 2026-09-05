-- =============================================================================
-- E2E transacional — cores independentes por linha de tira no PV
--
-- Pré-requisito: migration 20270101015400_cores_independentes_por_tira_no_pv.
-- O cenário usa somente catálogo vivo elegível, cria um PV pelo command
-- boundary canônico, processa a fila operacional e descarta todos os efeitos
-- no ROLLBACK final.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '15s';

-- Prova negativa da fronteira SECURITY DEFINER com o papel SQL real usado pelo
-- browser. Um JWT autenticado sem profile aprovado nao pode sequer iniciar o
-- preview, independentemente do payload.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $preview_unapproved$
DECLARE
  v_rejected boolean := false;
  v_manifest_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM 1
      FROM public.preview_sale_order_strap_demand_draft('{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'Preview SECURITY DEFINER aceitou authenticated sem profile aprovado';
  BEGIN
    PERFORM public.get_mobile_strap_offline_manifest(NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_manifest_rejected := true;
  END;
  ASSERT v_manifest_rejected,
    'Manifesto SECURITY DEFINER aceitou authenticated sem profile aprovado';
END
$preview_unapproved$;
RESET ROLE;

-- As funções de autorização são STABLE. Defina os claims antes do DO para que
-- auth.uid()/auth.role() sejam resolvidos corretamente desde a primeira chamada.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claim.sub',
  (
    SELECT ur.user_id::text
      FROM public.user_roles ur
      JOIN public.profiles p
        ON p.id = ur.user_id
       AND p.approved = true
     WHERE ur.role::text = 'admin'
     ORDER BY ur.user_id
     LIMIT 1
  ),
  true
);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'service_role',
    'sub', current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);

DO $test$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sheet_id uuid;
  v_sheet_lines jsonb;
  v_base_group_id uuid;
  v_measure_id uuid;
  v_recipe_id uuid;
  v_factory_calendar_id uuid;
  v_factory_capacity_id uuid;
  v_capacity_version integer;
  v_client_id uuid;
  v_client_name text;
  v_client_cnpj text;
  v_size text;
  v_color_ids uuid[];
  v_color_names text[];
  v_noncanonical_main_color text :=
    'E2E-COR-PRINCIPAL-NAO-CANONICA-' || gen_random_uuid()::text;
  v_persisted_main_color text;
  v_client_lines jsonb;
  v_missing_lines jsonb;
  v_item jsonb;
  v_missing_item jsonb;
  v_prepared jsonb;
  v_prepared_item jsonb;
  v_expected_m_by_line jsonb;
  v_preview_by_line jsonb;
  v_create_response jsonb;
  v_job_result jsonb;
  v_promotion_result jsonb;
  v_receipt_result jsonb;
  v_historical_preview jsonb;
  v_manifest jsonb;
  v_manifest_again jsonb;
  v_manifest_entry jsonb;
  v_empty_manifest jsonb;
  v_partial_item_preview jsonb;
  v_partial_order_preview jsonb;
  v_partial_report jsonb;
  v_sector_report jsonb;
  v_sector_current_lines jsonb;
  v_empty_sheet_id uuid;
  v_sector_product_id uuid;
  v_sector_reservation_id uuid;
  v_noncanonical_sale_order_id uuid;
  v_noncanonical_sale_order_item_id uuid;
  v_sale_order_id uuid;
  v_sale_order_item_id uuid;
  v_order_id uuid;
  v_job_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_noncanonical_request_id uuid := gen_random_uuid();
  v_client_request_id uuid := gen_random_uuid();
  v_worker_id text := 'e2e-independent-straps-' || gen_random_uuid()::text;
  v_missing_rejected boolean := false;
  v_historical_passed boolean := false;
  v_manifest_limit_rejected boolean := false;
  v_partial_scope_passed boolean := false;
  v_sector_runtime_passed boolean := false;
  v_missing_error text;
  v_sheet_context text;
  v_missing_label text;
  v_operational_audit_before bigint;
  v_operational_audit_after bigint;
  v_product_audit_before bigint;
  v_product_audit_after bigint;
  v_variant_count_before bigint;
  v_variant_count_after bigint;
  v_line_count integer;
  v_color_count integer;
  v_variant_count integer;
  v_base_product_count integer;
  v_technical_line_count integer;
  v_block_count integer;
  v_source_count integer;
  v_job_status text;
  v_product_id uuid;
  v_receipt_count integer;
  v_reservation_count integer;
  v_movement_count integer;
  v_batch_item record;
  v_reservation record;
BEGIN
  ASSERT v_actor_id IS NOT NULL,
    'Pré-condição: nenhum usuário Admin aprovado disponível';

  -- Mesma hierarquia dos command writers: coarse advisory antes de tocar a
  -- ficha. Isso evita ciclo teste(ficha→coarse) × writer(coarse→ficha).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('strap-pv-auto-intent', 0)
  );

  -- A ficha é descoberta pelo contrato, não pelo nome. Exigimos exatamente
  -- cinco linhas operacionais porque o writer congela o conjunto completo da
  -- ficha; todas devem compartilhar medida e napa-base, ter consumo positivo,
  -- receita aprovada e ao menos três cores oficiais utilizáveis.
  WITH line_stats AS (
    SELECT
      ts.id,
      ts.strap_colors,
      public.resolve_strap_base_group_id(ts.id, NULL) AS base_group_id,
      count(*)::integer AS total_count,
      count(*) FILTER (
        WHERE coalesce(
          nullif(line.value ->> 'identity_basis', ''),
          'reference_base'
        ) = 'reference_base'
      )::integer AS reference_count,
      count(DISTINCT nullif(line.value ->> 'measure_id', ''))::integer
        AS measure_count,
      min(line.value ->> 'measure_id') AS measure_text,
      bool_and(
        coalesce(
          nullif(line.value ->> 'identity_basis', ''),
          'reference_base'
        ) = 'reference_base'
      ) AS all_reference,
      bool_and(
        coalesce(line.value ->> 'technical_strap_line_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) AS line_ids_valid,
      bool_and(
        coalesce(line.value ->> 'measure_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) AS measure_ids_valid,
      bool_and(
        CASE
          WHEN coalesce(line.value ->> 'consumption', '')
                 ~ '^[0-9]+([.][0-9]+)?$'
            THEN (line.value ->> 'consumption')::numeric > 0
          ELSE false
        END
      ) AS consumption_valid
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY line(value, ordinality)
    WHERE nullif(btrim(coalesce(ts.upper_material, '')), '') IS NULL
      AND public.normalize_strap_catalog_text(ts.status_ficha)
            IN ('publicada', 'validada')
      AND ts.retired_at IS NULL
    GROUP BY ts.id, ts.strap_colors
  )
  SELECT
    candidate.id,
    candidate.strap_colors,
    candidate.base_group_id,
    candidate.measure_text::uuid
    INTO v_sheet_id, v_sheet_lines, v_base_group_id, v_measure_id
    FROM line_stats candidate
   WHERE candidate.total_count = 5
     AND candidate.reference_count = 5
     AND candidate.all_reference
     AND candidate.line_ids_valid
     AND candidate.measure_ids_valid
     AND candidate.measure_count = 1
     AND candidate.consumption_valid
     AND candidate.base_group_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.artisanal_strap_recipes recipe
        WHERE recipe.measure_id = candidate.measure_text::uuid
          AND recipe.base_group_id = candidate.base_group_id
          AND recipe.status = 'approved'
          AND recipe.valid_from <= now()
          AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
     )
     AND (
       SELECT count(*)
         FROM public.base_material_color_official_products official
         JOIN public.canonical_colors color
           ON color.id = official.color_id
          AND color.active
         JOIN public.products product
           ON product.id = official.official_product_id
          AND product.active
          AND product.unit = 'm'
        WHERE official.base_group_id = candidate.base_group_id
          AND official.status = 'active'
          AND public.resolve_strap_canonical_color_id(product.color)
                = official.color_id
     ) >= 3
   ORDER BY candidate.id
   LIMIT 1;

  ASSERT v_sheet_id IS NOT NULL,
    'Pré-condição: nenhuma ficha com 5 tiras canônicas, mesma medida/base e 3 cores oficiais';

  SELECT coalesce(nullif(sheet.code, ''), nullif(sheet.name, ''), sheet.id::text)
    INTO v_sheet_context
    FROM public.technical_sheets sheet
   WHERE sheet.id = v_sheet_id;

  SELECT
    (array_agg(official.color_id ORDER BY usage.current_demands, color.name, official.color_id))[1:3],
    (array_agg(color.name ORDER BY usage.current_demands, color.name, official.color_id))[1:3]
    INTO v_color_ids, v_color_names
    FROM public.base_material_color_official_products official
    JOIN public.canonical_colors color
      ON color.id = official.color_id
     AND color.active
    JOIN public.products product
      ON product.id = official.official_product_id
     AND product.active
     AND product.unit = 'm'
    LEFT JOIN LATERAL (
      SELECT count(demand.id)::integer AS current_demands
        FROM public.artisanal_strap_variants variant
        LEFT JOIN public.sale_order_strap_demands demand
          ON demand.strap_variant_id = variant.id
         AND demand.is_current
       WHERE variant.measure_id = v_measure_id
         AND variant.base_group_id = v_base_group_id
         AND variant.color_id = official.color_id
    ) usage ON true
   WHERE official.base_group_id = v_base_group_id
     AND official.status = 'active'
     AND public.resolve_strap_canonical_color_id(product.color)
           = official.color_id;

  ASSERT cardinality(v_color_ids) = 3
     AND cardinality(v_color_names) = 3,
    'Pré-condição: catálogo elegível deixou de possuir 3 cores oficiais';
  ASSERT public.resolve_strap_canonical_color_id(v_noncanonical_main_color) IS NULL,
    'Pré-condição: descrição escolhida para a cor principal tornou-se canônica';

  -- O catálogo vivo ainda não possui capacidade operacional cadastrada para a
  -- receita desta ficha. Para exercitar reserva, produção e baixa sem depender
  -- desse gap de cadastro, esta transação converte somente a receita escolhida
  -- em execução fabril e cria calendário/capacidade efêmeros. Tudo é revertido.
  SELECT recipe.id
    INTO v_recipe_id
    FROM public.artisanal_strap_recipes recipe
   WHERE recipe.measure_id = v_measure_id
     AND recipe.base_group_id = v_base_group_id
     AND recipe.status = 'approved'
     AND recipe.valid_from <= now()
     AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
   FOR UPDATE;
  ASSERT v_recipe_id IS NOT NULL,
    'Pré-condição: receita aprovada desapareceu após a seleção da ficha';

  UPDATE public.artisanal_strap_recipes recipe
     SET executor_type = 'factory',
         default_contractor_id = NULL,
         updated_at = now()
   WHERE recipe.id = v_recipe_id;

  SELECT calendar.id
    INTO v_factory_calendar_id
    FROM public.strap_operational_calendars calendar
   WHERE calendar.calendar_type = 'factory'
     AND calendar.contractor_id IS NULL
     AND calendar.status = 'active'
   ORDER BY calendar.id
   LIMIT 1
   FOR UPDATE;
  IF v_factory_calendar_id IS NULL THEN
    INSERT INTO public.strap_operational_calendars(
      name,
      calendar_type,
      contractor_id,
      uses_factory_calendar,
      open_iso_weekdays,
      timezone,
      status
    ) VALUES (
      'E2E fábrica — rollback automático',
      'factory',
      NULL,
      true,
      ARRAY[1,2,3,4,5]::smallint[],
      'America/Sao_Paulo',
      'active'
    ) RETURNING id INTO v_factory_calendar_id;
  END IF;
  UPDATE public.strap_operational_calendars calendar
     SET open_iso_weekdays = ARRAY[1,2,3,4,5,6,7]::smallint[],
         updated_at = now()
   WHERE calendar.id = v_factory_calendar_id;
  DELETE FROM public.strap_operational_calendar_exceptions calendar_exception
   WHERE calendar_exception.calendar_id = v_factory_calendar_id
     AND calendar_exception.work_date BETWEEN current_date AND current_date + 60;

  SELECT capacity.id
    INTO v_factory_capacity_id
    FROM public.strap_executor_capacities capacity
   WHERE capacity.executor_type = 'factory'
     AND capacity.contractor_id IS NULL
     AND capacity.status = 'active'
     AND capacity.valid_from <= current_date + 60
     AND (capacity.valid_to IS NULL OR capacity.valid_to >= current_date + 60)
   ORDER BY capacity.version DESC
   LIMIT 1
   FOR UPDATE;
  IF v_factory_capacity_id IS NULL THEN
    -- Reaproveita uma vigência aberta, quando houver, para não colidir com o
    -- índice parcial; no banco atual o ramo normal é o INSERT logo abaixo.
    SELECT capacity.id
      INTO v_factory_capacity_id
      FROM public.strap_executor_capacities capacity
     WHERE capacity.executor_type = 'factory'
       AND capacity.contractor_id IS NULL
       AND capacity.status = 'active'
       AND capacity.valid_to IS NULL
     ORDER BY capacity.version DESC
     LIMIT 1
     FOR UPDATE;
  END IF;
  IF v_factory_capacity_id IS NULL THEN
    SELECT coalesce(max(capacity.version), 0) + 1
      INTO v_capacity_version
      FROM public.strap_executor_capacities capacity
     WHERE capacity.executor_type = 'factory'
       AND capacity.contractor_id IS NULL;
    INSERT INTO public.strap_executor_capacities(
      executor_type,
      contractor_id,
      capacity_m_per_open_day,
      calendar_id,
      version,
      valid_from,
      valid_to,
      status,
      created_by
    ) VALUES (
      'factory',
      NULL,
      1000000,
      v_factory_calendar_id,
      v_capacity_version,
      current_date,
      NULL,
      'active',
      v_actor_id
    ) RETURNING id INTO v_factory_capacity_id;
  ELSE
    UPDATE public.strap_executor_capacities capacity
       SET calendar_id = v_factory_calendar_id,
           valid_from = least(capacity.valid_from, current_date),
           capacity_m_per_open_day = greatest(
             capacity.capacity_m_per_open_day,
             1000000
           ),
           updated_at = now()
     WHERE capacity.id = v_factory_capacity_id;
  END IF;

  SELECT client.id, client.razao_social, client.cnpj
    INTO v_client_id, v_client_name, v_client_cnpj
    FROM public.clients client
    CROSS JOIN LATERAL public.get_client_commercial_defaults(client.id) defaults
   WHERE client.active
     AND NOT coalesce(defaults.block_new_orders, false)
     AND coalesce(defaults.credit_limit, 0) <= 0
   ORDER BY client.id
   LIMIT 1;
  ASSERT v_client_id IS NOT NULL,
    'Pré-condição: nenhum cliente ativo e sem bloqueio/limite para promoção transacional';

  -- Ativa a peculiaridade na ficha somente dentro desta transação.
  UPDATE public.technical_sheets sheet
     SET sale_price = 1,
         strap_colors = (
       SELECT jsonb_agg(
         (line.value - 'color_mode')
           || jsonb_build_object('color_mode', 'select_on_order')
         ORDER BY line.ordinality
       )
         FROM jsonb_array_elements(v_sheet_lines)
           WITH ORDINALITY line(value, ordinality)
     )
   WHERE sheet.id = v_sheet_id
   RETURNING sheet.strap_colors INTO v_sheet_lines;

  ASSERT jsonb_array_length(v_sheet_lines) = 5
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_sheet_lines) line(value)
        WHERE line.value ->> 'color_mode' IS DISTINCT FROM 'select_on_order'
     ), 'Ficha de teste não persistiu select_on_order nas cinco linhas';

  -- O manifesto offline e autoritativo para estrutura/ordem e limita as cores
  -- ao mesmo catálogo físico que o writer aceitará no sync.
  v_manifest := public.get_mobile_strap_offline_manifest(
    ARRAY[v_sheet_id]::uuid[]
  );
  v_manifest_again := public.get_mobile_strap_offline_manifest(
    ARRAY[v_sheet_id]::uuid[]
  );
  ASSERT (v_manifest ->> 'version')::integer = 1
     AND v_manifest ->> 'manifest_hash'
           = v_manifest_again ->> 'manifest_hash'
     AND v_manifest -> 'references'
           = v_manifest_again -> 'references',
    'Manifesto não é determinístico ou mudou a versão do contrato';
  ASSERT NOT (
    v_manifest::text ~
      '"(unit_price|purchase_price|quantity|current_stock|reserved_stock|source_mode)"[[:space:]]*:'
  ), 'Manifesto offline vazou preço, saldo ou origem financeira';
  ASSERT (
    SELECT count(*)
      FROM jsonb_array_elements(v_manifest -> 'references') context(value)
  ) = 1 + (
    SELECT count(*)
      FROM public.reference_material_variants variant
     WHERE variant.reference_id = v_sheet_id
       AND coalesce(variant.active, true)
  ), 'Manifesto omitiu o contexto base ou uma variante ativa';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_manifest -> 'references') context(value)
     WHERE context.value ->> 'reference_id' IS DISTINCT FROM v_sheet_id::text
  ), 'Filtro do manifesto vazou outra referência';

  SELECT context.value
    INTO v_manifest_entry
    FROM jsonb_array_elements(v_manifest -> 'references') context(value)
   WHERE context.value ->> 'reference_id' = v_sheet_id::text
     AND context.value ->> 'material_variant_id' IS NULL;
  ASSERT v_manifest_entry IS NOT NULL
     AND jsonb_array_length(v_manifest_entry -> 'lines') = 5,
    'Manifesto não devolveu as cinco tiras do contexto base';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_manifest_entry -> 'lines')
             WITH ORDINALITY manifest_line(value, ordinality)
      JOIN LATERAL (
        SELECT v_sheet_lines -> (manifest_line.ordinality - 1)::integer AS value
      ) sheet_line ON true
     WHERE (manifest_line.value ->> 'position')::integer
             IS DISTINCT FROM manifest_line.ordinality::integer
        OR manifest_line.value ->> 'technical_strap_line_id'
             IS DISTINCT FROM sheet_line.value ->> 'technical_strap_line_id'
        OR manifest_line.value ->> 'measure_id'
             IS DISTINCT FROM sheet_line.value ->> 'measure_id'
        OR manifest_line.value ->> 'strap_type_id'
             IS DISTINCT FROM sheet_line.value ->> 'strap_type_id'
        OR manifest_line.value ->> 'color_mode'
             IS DISTINCT FROM 'select_on_order'
        OR manifest_line.value ->> 'consumption'
             IS DISTINCT FROM sheet_line.value ->> 'consumption'
        OR manifest_line.value -> 'consumption_per_size'
             IS DISTINCT FROM sheet_line.value -> 'consumption_per_size'
        OR manifest_line.value ->> 'base_group_id'
             IS DISTINCT FROM v_base_group_id::text
        OR (
          SELECT count(*)
            FROM jsonb_array_elements(
              manifest_line.value -> 'allowed_colors'
            ) allowed(value)
        ) IS DISTINCT FROM (
          SELECT count(DISTINCT allowed.value ->> 'id')
            FROM jsonb_array_elements(
              manifest_line.value -> 'allowed_colors'
            ) allowed(value)
        )
        OR EXISTS (
          SELECT 1
            FROM unnest(v_color_ids) expected_color(id)
           WHERE NOT EXISTS (
             SELECT 1
               FROM jsonb_array_elements(
                 manifest_line.value -> 'allowed_colors'
               ) allowed(value)
              WHERE allowed.value ->> 'id' = expected_color.id::text
           )
        )
        OR EXISTS (
          SELECT 1
            FROM jsonb_array_elements(
              manifest_line.value -> 'allowed_colors'
            ) allowed(value)
           WHERE NOT EXISTS (
             SELECT 1
               FROM public.canonical_colors color
              WHERE color.id = (allowed.value ->> 'id')::uuid
                AND color.active
                AND color.name = allowed.value ->> 'name'
           )
        )
  ), 'Manifesto alterou ordem/estrutura ou ofereceu cor não canônica';

  SELECT sheet.id
    INTO v_empty_sheet_id
    FROM public.technical_sheets sheet
   WHERE public.normalize_strap_catalog_text(sheet.status_ficha)
           IN ('publicada', 'validada')
     AND sheet.retired_at IS NULL
     AND jsonb_array_length(CASE
       WHEN jsonb_typeof(sheet.strap_colors) = 'array'
         THEN sheet.strap_colors
       ELSE '[]'::jsonb
     END) = 0
     AND EXISTS (
       SELECT 1
         FROM public.reference_material_variants variant
        WHERE variant.reference_id = sheet.id
          AND coalesce(variant.active, true)
     )
   ORDER BY sheet.id
   LIMIT 1;
  ASSERT v_empty_sheet_id IS NOT NULL,
    'Fixture sem referência publicada, vazia e com variante ativa';
  v_empty_manifest := public.get_mobile_strap_offline_manifest(
    ARRAY[v_empty_sheet_id]::uuid[]
  );
  ASSERT (
    SELECT count(*)
      FROM jsonb_array_elements(v_empty_manifest -> 'references') context(value)
  ) = 1 + (
    SELECT count(*)
      FROM public.reference_material_variants variant
     WHERE variant.reference_id = v_empty_sheet_id
       AND coalesce(variant.active, true)
  )
  AND NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_empty_manifest -> 'references') context(value)
     WHERE context.value ->> 'reference_id'
             IS DISTINCT FROM v_empty_sheet_id::text
        OR jsonb_array_length(context.value -> 'lines') <> 0
  ), 'Manifesto omitiu tombstone lines=[] do contexto base/variantes';

  BEGIN
    PERFORM public.get_mobile_strap_offline_manifest((
      SELECT array_agg(gen_random_uuid())
        FROM generate_series(1, 201)
    ));
  EXCEPTION WHEN SQLSTATE '54000' THEN
    v_manifest_limit_rejected := true;
  END;
  ASSERT v_manifest_limit_rejected,
    'Manifesto aceitou mais de 200 referências';

  SELECT size.key
    INTO v_size
    FROM jsonb_object_keys(
      coalesce(v_sheet_lines -> 0 -> 'consumption_per_size', '{}'::jsonb)
    ) size(key)
   WHERE NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(v_sheet_lines) line(value)
      WHERE coalesce(
        nullif(line.value -> 'consumption_per_size' ->> size.key, '')::numeric,
        0
      ) <= 0
   )
   ORDER BY CASE WHEN size.key ~ '^\d+$' THEN size.key::integer END NULLS LAST,
            size.key
   LIMIT 1;
  ASSERT v_size IS NOT NULL,
    'Pré-condição: as cinco tiras não compartilham numeração com consumo positivo';

  -- Oracle independente do motor: o cenário possui exatamente 1 par no tamanho
  -- escolhido, então o consumo técnico em centímetros vira metros uma única vez
  -- por `cm / 100`. Não reutilize preview, demanda ou helper do motor aqui.
  SELECT coalesce(
           jsonb_object_agg(
             line.value ->> 'technical_strap_line_id',
             to_jsonb(
               (line.value -> 'consumption_per_size' ->> v_size)::numeric / 100
             )
           ),
           '{}'::jsonb
         )
    INTO v_expected_m_by_line
    FROM jsonb_array_elements(v_sheet_lines) line(value);
  ASSERT (
       SELECT count(*) FROM jsonb_each(v_expected_m_by_line)
     ) = 5
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each(v_expected_m_by_line) expected(line_id, required_m)
        WHERE (expected.required_m #>> '{}')::numeric <= 0
     ), 'Oracle independente não calculou cinco consumos positivos em metros';

  -- Componente sintético de 4 unidades/par para provar o roteamento
  -- Aviamento (setor 4) -> Solagem (setor 8) sem misturar a alteração da
  -- ficha vigente com o snapshot do pedido. Escolha um SKU que o motor ainda
  -- não emite e sem regra global por cor, evitando substituição do fixture.
  SELECT product.id
    INTO v_sector_product_id
    FROM public.products product
   WHERE product.active
     AND pg_catalog.lower(COALESCE(product.category, '')) NOT IN (
       'acessório', 'embalagem', 'cola / químico', 'ferramentas',
       'solado', 'componente', 'componentes'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.artisanal_strap_variants variant
        WHERE variant.finished_product_id = product.id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.base_material_color_official_products official
        WHERE official.official_product_id = product.id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.component_color_defaults color_default
        WHERE color_default.active
          AND color_default.group_id = product.group_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(
                public.calculate_order_consumption_by_grade(
                  v_sheet_id,
                  pg_catalog.jsonb_build_object(v_size, 1),
                  v_color_names[1],
                  NULL
                )
              ) existing(value)
        WHERE existing.value ->> 'product_id' = product.id::text
     )
   ORDER BY product.id
   LIMIT 1;
  ASSERT v_sector_product_id IS NOT NULL,
    'Fixture sem SKU independente para o teste de setor configurado';

  UPDATE public.technical_sheets sheet
     SET component_colors_enabled = false,
         direct_components = pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'product_id', v_sector_product_id,
             'quantity', 4,
             'consumption_sector', 'Aviamento'
           )
         )
   WHERE sheet.id = v_sheet_id;
  ASSERT FOUND, 'Fixture não conseguiu configurar componente no setor 4';

  -- O cliente adultera color_mode para follow_main e envia as linhas na ordem
  -- 3/1/5/4/2. O writer deve reidratar política e ordem da ficha, mantendo a
  -- cor individual (1/2/3/1/2) vinculada ao UUID técnico.
  SELECT jsonb_agg(
    (line.value - 'color_mode' - 'color_id' - 'color')
      || jsonb_build_object(
        'color_mode', 'follow_main',
        'color_id', v_color_ids[((line.ordinality - 1) % 3 + 1)::integer],
        'color', v_color_names[((line.ordinality - 1) % 3 + 1)::integer]
      )
    ORDER BY CASE line.ordinality
      WHEN 3 THEN 1
      WHEN 1 THEN 2
      WHEN 5 THEN 3
      WHEN 4 THEN 4
      ELSE 5
    END
  )
    INTO v_client_lines
    FROM jsonb_array_elements(v_sheet_lines)
      WITH ORDINALITY line(value, ordinality);

  ASSERT v_client_lines -> 0 ->> 'technical_strap_line_id'
       IS DISTINCT FROM v_sheet_lines -> 0 ->> 'technical_strap_line_id',
    'Pré-condição: payload do cliente não ficou embaralhado';

  v_item := jsonb_build_object(
    'reference_id', v_sheet_id,
    -- As cinco linhas sao select_on_order: a cor principal nao participa da
    -- resolucao das tiras e, portanto, pode ser uma descricao nao canonica.
    'color', v_noncanonical_main_color,
    'quantity', 1,
    'unit_price', 1,
    'grade', jsonb_build_object(v_size, 1),
    'fichas', 1,
    'observation', 'E2E transacional: cores independentes por tira',
    'strap_colors', v_client_lines,
    'strap_sourcing', '{}'::jsonb,
    'main_production_start', (current_date + 60)::text,
    'schedule_revision', 0
  );

  -- A quarta linha sem cor força falha depois de três materializações. O bloco
  -- EXCEPTION é uma subtransação: se a atomicidade estiver correta, nem as
  -- variantes nem as auditorias das três primeiras chamadas sobrevivem.
  SELECT jsonb_agg(
    CASE
      WHEN line.value ->> 'technical_strap_line_id'
             = v_sheet_lines -> 3 ->> 'technical_strap_line_id'
        THEN line.value - 'color_id' - 'color'
      ELSE line.value
    END
    ORDER BY line.ordinality
  )
    INTO v_missing_lines
    FROM jsonb_array_elements(v_client_lines)
      WITH ORDINALITY line(value, ordinality);
  v_missing_item := jsonb_set(v_item, '{strap_colors}', v_missing_lines, false);
  v_missing_label := coalesce(
    nullif(v_sheet_lines -> 3 ->> 'label', ''),
    'TIRA'
  );

  SELECT count(*)
    INTO v_operational_audit_before
    FROM public.artisanal_strap_operational_audit_log audit
   WHERE audit.entity_type = 'technical_sheet'
     AND audit.entity_id = v_sheet_id;
  SELECT count(*)
    INTO v_product_audit_before
    FROM public.audit_logs audit
   WHERE audit.action = 'strap_pv_intent_product_insert'
     AND audit.new_data ->> 'reference_id' = v_sheet_id::text;
  SELECT count(*)
    INTO v_variant_count_before
    FROM public.artisanal_strap_variants variant
   WHERE variant.measure_id = v_measure_id
     AND variant.base_group_id = v_base_group_id
     AND variant.color_id = ANY(v_color_ids);

  BEGIN
    PERFORM public.prepare_sale_order_item_internal_straps(v_missing_item);
  EXCEPTION WHEN OTHERS THEN
    v_missing_error := SQLERRM;
    IF position('selecione a cor' IN lower(v_missing_error)) > 0
       AND position(lower(v_sheet_context) IN lower(v_missing_error)) > 0
       AND position(lower(v_missing_label) IN lower(v_missing_error)) > 0 THEN
      v_missing_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  ASSERT v_missing_rejected,
    'Writer aceitou linha select_on_order sem color_id';

  SELECT count(*)
    INTO v_operational_audit_after
    FROM public.artisanal_strap_operational_audit_log audit
   WHERE audit.entity_type = 'technical_sheet'
     AND audit.entity_id = v_sheet_id;
  SELECT count(*)
    INTO v_product_audit_after
    FROM public.audit_logs audit
   WHERE audit.action = 'strap_pv_intent_product_insert'
     AND audit.new_data ->> 'reference_id' = v_sheet_id::text;
  SELECT count(*)
    INTO v_variant_count_after
    FROM public.artisanal_strap_variants variant
   WHERE variant.measure_id = v_measure_id
     AND variant.base_group_id = v_base_group_id
     AND variant.color_id = ANY(v_color_ids);

  ASSERT v_operational_audit_after = v_operational_audit_before
     AND v_product_audit_after = v_product_audit_before
     AND v_variant_count_after = v_variant_count_before,
    'Rejeição por cor ausente deixou catálogo/auditoria parcial';

  v_prepared := public.prepare_sale_order_item_internal_straps(v_item);
  v_prepared_item := v_prepared -> 'item';

  ASSERT jsonb_array_length(v_prepared -> 'ensured') = 5,
    'Writer não materializou exatamente as cinco linhas';
  ASSERT jsonb_array_length(v_prepared_item -> 'strap_colors') = 5,
    'Writer alterou o conjunto lógico de linhas';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_prepared_item -> 'strap_colors')
        WITH ORDINALITY line(value, ordinality)
     WHERE line.value ->> 'color_mode' IS DISTINCT FROM 'select_on_order'
        OR line.value ->> 'technical_strap_line_id' IS DISTINCT FROM
             v_sheet_lines -> (line.ordinality - 1)::integer
               ->> 'technical_strap_line_id'
        OR (line.value ->> 'color_id')::uuid IS DISTINCT FROM
             v_color_ids[((line.ordinality - 1) % 3 + 1)::integer]
  ), 'Writer não reidratou política/ordem da ficha ou trocou cores por UUID';
  ASSERT (
    SELECT count(DISTINCT line.value ->> 'color_id')
      FROM jsonb_array_elements(v_prepared_item -> 'strap_colors') line(value)
  ) = 3, 'Writer não preservou três cores distintas';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_prepared_item -> 'strap_colors') line(value)
     WHERE v_prepared_item -> 'strap_sourcing'
             -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode'
             IS DISTINCT FROM 'internal'
        OR v_prepared_item -> 'strap_sourcing'
             -> (line.value ->> 'technical_strap_line_id') ->> 'color_id'
             IS DISTINCT FROM line.value ->> 'color_id'
  ), 'Snapshot de sourcing não acompanha a cor de cada UUID';

  SELECT
    count(*)::integer,
    count(DISTINCT preview.resolved ->> 'color_id')::integer,
    count(DISTINCT preview.strap_variant_id)::integer,
    count(DISTINCT preview.base_product_id)::integer,
    coalesce(sum(jsonb_array_length(
      coalesce(preview.blocking_reasons, '[]'::jsonb)
    )), 0)::integer,
    count(DISTINCT preview.source_mode)::integer
    INTO
      v_line_count,
      v_color_count,
      v_variant_count,
      v_base_product_count,
      v_block_count,
      v_source_count
    FROM public.preview_sale_order_strap_demand_draft(
      v_prepared_item || jsonb_build_object(
        'main_production_start', (current_date + 60)::text,
        'schedule_revision', 0
      )
    ) preview;

  ASSERT v_line_count = 5
     AND v_color_count = 3
     AND v_variant_count = 3
     AND v_base_product_count = 3
     AND v_block_count = 0
     AND v_source_count = 1,
    format(
      'Preview divergente: linhas=%s cores=%s variantes=%s bases=%s bloqueios=%s origens=%s',
      v_line_count,
      v_color_count,
      v_variant_count,
      v_base_product_count,
      v_block_count,
      v_source_count
    );

  SELECT coalesce(
           jsonb_object_agg(
             preview.technical_strap_line_id::text,
             jsonb_build_object(
               'color_id', preview.resolved ->> 'color_id',
               'gross_required_m', preview.gross_required_m
             )
           ),
           '{}'::jsonb
         )
    INTO v_preview_by_line
    FROM public.preview_sale_order_strap_demand_draft(
      v_prepared_item || jsonb_build_object(
        'main_production_start', (current_date + 60)::text,
        'schedule_revision', 0
      )
    ) preview;

  ASSERT NOT EXISTS (
    SELECT 1
      FROM jsonb_each(v_expected_m_by_line) expected(line_id, required_m)
     WHERE NOT (v_preview_by_line ? expected.line_id)
        OR abs(
             (v_preview_by_line -> expected.line_id ->> 'gross_required_m')::numeric
               - (expected.required_m #>> '{}')::numeric
           ) > 0.000001
  ), 'Preview não coincide com o oracle independente de cm→m por UUID';

  -- Variantes podem existir no catálogo, mas o lote físico desta prova precisa
  -- nascer sem contribuições anteriores; assim receipt/reservas/movimentos são
  -- integralmente atribuíveis aos cinco UUIDs criados nesta transação.
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.strap_production_batch_items batch_item
     WHERE batch_item.strap_variant_id IN (
       SELECT DISTINCT nullif(source.value ->> 'strap_variant_id', '')::uuid
         FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
     )
       AND batch_item.status IN (
         'planned', 'released', 'in_progress', 'partial', 'suspended'
       )
  ), 'Pré-condição: variante escolhida já possui lote físico aberto';

  -- Isola o caminho físico do estoque corrente: tira acabada começa em zero e
  -- cada produto-base oficial recebe saldo amplo. Antes de tocar produto, segue
  -- a hierarquia completa do motor físico: base → variante → estoque → row lock.
  FOR v_product_id IN
    SELECT DISTINCT nullif(source.value ->> 'base_product_id', '')::uuid
      FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
     WHERE nullif(source.value ->> 'base_product_id', '') IS NOT NULL
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('strap-base-netting:' || v_product_id::text, 0)
    );
  END LOOP;

  FOR v_product_id IN
    SELECT DISTINCT nullif(source.value ->> 'strap_variant_id', '')::uuid
      FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
     WHERE nullif(source.value ->> 'strap_variant_id', '') IS NOT NULL
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('strap-variant:' || v_product_id::text, 0)
    );
  END LOOP;

  FOR v_product_id IN
    SELECT DISTINCT product_id
      FROM (
        SELECT nullif(source.value ->> 'base_product_id', '')::uuid AS product_id
          FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
        UNION
        SELECT variant.finished_product_id AS product_id
          FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
          JOIN public.artisanal_strap_variants variant
            ON variant.id = nullif(source.value ->> 'strap_variant_id', '')::uuid
      ) products
     WHERE product_id IS NOT NULL
     ORDER BY product_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('strap-stock:' || v_product_id::text, 0)
    );
  END LOOP;

  PERFORM product.id
    FROM public.products product
   WHERE product.id IN (
     SELECT DISTINCT nullif(source.value ->> 'base_product_id', '')::uuid
       FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
     UNION
     SELECT DISTINCT variant.finished_product_id
       FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
       JOIN public.artisanal_strap_variants variant
         ON variant.id = nullif(source.value ->> 'strap_variant_id', '')::uuid
   )
   ORDER BY product.id
   FOR UPDATE;

  UPDATE public.products product
     SET quantity = 100000,
         current_stock = 100000,
         updated_at = now()
   WHERE product.id IN (
     SELECT DISTINCT nullif(source.value ->> 'base_product_id', '')::uuid
       FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
   );
  UPDATE public.products product
     SET quantity = 0,
         current_stock = 0,
         updated_at = now()
   WHERE product.id IN (
     SELECT DISTINCT variant.finished_product_id
       FROM jsonb_each(v_prepared_item -> 'strap_sourcing') source(key, value)
       JOIN public.artisanal_strap_variants variant
         ON variant.id = nullif(source.value ->> 'strap_variant_id', '')::uuid
   );

  -- Primeiro PV: prova isolada do P1. As cinco linhas são select_on_order, então
  -- uma cor principal não canônica precisa atravessar o create sem interferir
  -- no vínculo cor↔UUID. Este PV não é promovido: a prova física usa um segundo
  -- PV com cor principal comercial, sem depender do preflight de outros insumos.
  v_create_response := public.create_sale_order_command(
    jsonb_build_object(
      'client_id', v_client_id,
      'client_name', v_client_name,
      'client_cnpj', coalesce(v_client_cnpj, ''),
      'client_contact', '',
      'representative', '',
      'payment_condition', 'A VISTA',
      'delivery_deadline', (current_date + 60)::text,
      'billing_week', (current_date + 60)::text,
      'status', 'Rascunho',
      'total', 1,
      'notes', 'E2E-STRAP-COLORS-NONCANONICAL — rollback automático'
    ),
    jsonb_build_array(v_prepared_item),
    'e2e-independent-straps-noncanonical:' || v_noncanonical_request_id::text,
    v_noncanonical_request_id
  );

  ASSERT coalesce((v_create_response ->> 'ok')::boolean, false),
    'create_sale_order_command recusou o cenário: '
      || coalesce(v_create_response -> 'error', '{}'::jsonb)::text;
  v_noncanonical_sale_order_id := nullif(
    v_create_response ->> 'sale_order_id',
    ''
  )::uuid;
  v_noncanonical_sale_order_item_id := nullif(
    v_create_response #>> '{result,item_ids,0}',
    ''
  )::uuid;
  ASSERT v_noncanonical_sale_order_id IS NOT NULL
     AND v_noncanonical_sale_order_item_id IS NOT NULL,
    'Command create não devolveu PV/item';

  SELECT item.color
    INTO v_persisted_main_color
    FROM public.sale_order_items item
   WHERE item.id = v_noncanonical_sale_order_item_id;
  ASSERT public.normalize_strap_catalog_text(v_persisted_main_color)
           = public.normalize_strap_catalog_text(v_noncanonical_main_color)
     AND public.resolve_strap_canonical_color_id(v_persisted_main_color) IS NULL,
    format(
      'Command create rejeitou/trocou semanticamente a cor principal não canônica: esperado=%s atual=%s',
      v_noncanonical_main_color,
      coalesce(v_persisted_main_color, '<NULL>')
    );

  SELECT count(*)::integer
    INTO v_line_count
    FROM public.sale_order_items item
    CROSS JOIN LATERAL jsonb_array_elements(item.strap_colors) line(value)
   WHERE item.id = v_noncanonical_sale_order_item_id
     AND line.value ->> 'color_mode' = 'select_on_order';
  ASSERT v_line_count = 5,
    'Command create não persistiu color_mode autoritativo nas cinco linhas';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_items item
      CROSS JOIN LATERAL jsonb_array_elements(item.strap_colors)
        WITH ORDINALITY line(value, ordinality)
     WHERE item.id = v_noncanonical_sale_order_item_id
       AND line.value ->> 'technical_strap_line_id' IS DISTINCT FROM
             v_sheet_lines -> (line.ordinality - 1)::integer
               ->> 'technical_strap_line_id'
  ), 'Command create não persistiu as tiras na ordem técnica da ficha';

  -- Segundo PV: mesma seleção de cinco UUIDs/3 cores, agora com cor principal
  -- comercial válida para exercitar promoção, reserva, receipt e picking.
  v_create_response := public.create_sale_order_command(
    jsonb_build_object(
      'client_id', v_client_id,
      'client_name', v_client_name,
      'client_cnpj', coalesce(v_client_cnpj, ''),
      'client_contact', '',
      'representative', '',
      'payment_condition', 'A VISTA',
      'delivery_deadline', (current_date + 60)::text,
      'billing_week', (current_date + 60)::text,
      'status', 'Rascunho',
      'total', 1,
      'notes', 'E2E-STRAP-COLORS-PHYSICAL — rollback automático'
    ),
    jsonb_build_array(
      v_prepared_item || jsonb_build_object(
        'color', v_color_names[1],
        'observation', 'E2E físico: cinco tiras, três cores'
      )
    ),
    'e2e-independent-straps-physical:' || v_client_request_id::text,
    v_client_request_id
  );
  ASSERT coalesce((v_create_response ->> 'ok')::boolean, false),
    'create_sale_order_command recusou o cenário físico canônico: '
      || coalesce(v_create_response -> 'error', '{}'::jsonb)::text;
  v_sale_order_id := nullif(v_create_response ->> 'sale_order_id', '')::uuid;
  v_sale_order_item_id := nullif(
    v_create_response #>> '{result,item_ids,0}',
    ''
  )::uuid;
  ASSERT v_sale_order_id IS NOT NULL AND v_sale_order_item_id IS NOT NULL,
    'Command create físico não devolveu PV/item';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_items item
      CROSS JOIN LATERAL jsonb_array_elements(item.strap_colors)
        WITH ORDINALITY line(value, ordinality)
     WHERE item.id = v_sale_order_item_id
       AND (
         line.value ->> 'color_mode' IS DISTINCT FROM 'select_on_order'
         OR line.value ->> 'technical_strap_line_id' IS DISTINCT FROM
              v_sheet_lines -> (line.ordinality - 1)::integer
                ->> 'technical_strap_line_id'
         OR (line.value ->> 'color_id')::uuid IS DISTINCT FROM
              v_color_ids[((line.ordinality - 1) % 3 + 1)::integer]
       )
  ), 'Command create físico alterou política/ordem/cor vinculada aos UUIDs';

  -- Antes da primeira demanda, um PV terminal continua usando consumo/UUIDs
  -- do item salvo mesmo se a ficha vigente perder todas as linhas. Versao e
  -- rendimento da receita ainda nao sao fato historico: a RPC os deixa NULL,
  -- sinaliza a projecao e o enqueue operacional privado os resolvera depois.
  BEGIN
    ASSERT NOT EXISTS (
      SELECT 1
        FROM public.sale_order_strap_demands demand
       WHERE demand.sale_order_item_id = v_sale_order_item_id
         AND demand.is_current
    ), 'Pré-condição histórica exige item ainda sem demanda';

    UPDATE public.sale_orders
       SET status = 'Faturado'
     WHERE id = v_sale_order_id;
    UPDATE public.technical_sheets
       SET strap_colors = '[]'::jsonb
     WHERE id = v_sheet_id;
    ASSERT (
      SELECT jsonb_array_length(coalesce(sheet.strap_colors, '[]'::jsonb)) = 0
        FROM public.technical_sheets sheet
       WHERE sheet.id = v_sheet_id
    ), 'Fixture não conseguiu remover temporariamente as linhas da ficha';

    SELECT coalesce(jsonb_object_agg(
             preview.technical_strap_line_id::text,
             to_jsonb(preview)
           ), '{}'::jsonb)
      INTO v_historical_preview
      FROM public.preview_sale_order_strap_demand_draft(
        jsonb_build_object(
          'sale_order_id', v_sale_order_id,
          'sale_order_item_id', v_sale_order_item_id,
          'reference_id', gen_random_uuid(),
          'material_variant_id', gen_random_uuid(),
          'color', 'COR-FORJADA-PELO-CLIENTE',
          'quantity', 999999,
          'grade', jsonb_build_object('99', 999999),
          'strap_colors', jsonb_build_array(jsonb_build_object(
            'technical_strap_line_id', gen_random_uuid(),
            'consumption', 999999
          )),
          'strap_sourcing', '{}'::jsonb,
          'main_production_start', '1900-01-01',
          'required_at', '1900-01-01'
        )
      ) preview;

    ASSERT (SELECT count(*) FROM jsonb_each(v_historical_preview)) = 5,
      'Preview histórico perdeu linhas após a ficha vigente ser removida';
    ASSERT NOT EXISTS (
      SELECT 1
        FROM jsonb_each(v_expected_m_by_line) expected(line_id, required_m)
       WHERE NOT (v_historical_preview ? expected.line_id)
          OR abs(
               (v_historical_preview -> expected.line_id
                 ->> 'gross_required_m')::numeric
                 - (expected.required_m #>> '{}')::numeric
             ) > 0.000001
          OR (v_historical_preview -> expected.line_id
                ->> 'strap_variant_id') IS DISTINCT FROM
             (v_prepared_item -> 'strap_sourcing' -> expected.line_id
                ->> 'strap_variant_id')
          OR (v_historical_preview -> expected.line_id
                ->> 'recipe_id') IS DISTINCT FROM
             (v_prepared_item -> 'strap_sourcing' -> expected.line_id
                ->> 'recipe_id')
          OR (v_historical_preview -> expected.line_id
                ->> 'base_product_id') IS DISTINCT FROM
             (v_prepared_item -> 'strap_sourcing' -> expected.line_id
                ->> 'base_product_id')
          OR (v_historical_preview -> expected.line_id
                #>> '{resolved,identity_snapshot_source}')
               IS DISTINCT FROM 'sale_order_item_pre_demand'
          OR coalesce((v_historical_preview -> expected.line_id
                #>> '{resolved,physical_snapshot_complete}')::boolean, true)
          OR nullif(v_historical_preview -> expected.line_id
                #>> '{resolved,snapshot_warning}', '') IS NULL
          OR (v_historical_preview -> expected.line_id
                #>> '{resolved,confirmed_yield_m_per_m}') IS NOT NULL
          OR (v_historical_preview -> expected.line_id
                #>> '{resolved,base_required_m}') IS NOT NULL
          OR (v_historical_preview -> expected.line_id
                #>> '{resolved,catalog,recipe_version}') IS NOT NULL
          OR (v_historical_preview -> expected.line_id
                #>> '{resolved,measure_id}') IS DISTINCT FROM (
               SELECT line.value ->> 'measure_id'
                 FROM jsonb_array_elements(
                   v_prepared_item -> 'strap_colors'
                 ) line(value)
                WHERE line.value ->> 'technical_strap_line_id'
                      = expected.line_id
             )
          OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(coalesce(
                   v_historical_preview -> expected.line_id
                     -> 'blocking_reasons',
                   '[]'::jsonb
                 )) reason(value)
                WHERE reason.value ->> 'code' IN (
                  'committed_identity_snapshot_missing',
                  'committed_technical_snapshot_invalid'
                )
             )
    ), 'Preview pré-demanda adotou payload/ficha atual ou inventou yield histórico';

    v_historical_passed := true;
    RAISE EXCEPTION USING
      ERRCODE = 'PZ155',
      MESSAGE = 'rollback do cenário histórico pré-demanda';
  EXCEPTION WHEN SQLSTATE 'PZ155' THEN NULL;
  END;
  ASSERT v_historical_passed,
    'Cenário histórico pré-demanda não concluiu';

  v_job_id := public.enqueue_sale_order_strap_demands(
    v_sale_order_id,
    'confirmed',
    v_correlation_id
  );
  ASSERT v_job_id IS NOT NULL,
    'Enqueue não criou job para as cinco tiras';

  UPDATE public.strap_demand_jobs job
     SET status = 'processing',
         attempts = job.attempts + 1,
         locked_at = now(),
         locked_by = v_worker_id,
         last_error = NULL
   WHERE job.id = v_job_id
     AND job.status IN ('queued', 'retry');
  ASSERT FOUND, 'Job não estava disponível para processamento';

  v_job_result := public.process_strap_demand_job(v_job_id, v_worker_id);
  SELECT job.status
    INTO v_job_status
    FROM public.strap_demand_jobs job
   WHERE job.id = v_job_id;
  ASSERT v_job_status = 'completed'
     AND NOT coalesce(v_job_result ? 'error', false)
     AND coalesce((v_job_result ->> 'processed')::integer, 0) = 5
     AND coalesce((v_job_result ->> 'blocked')::integer, 0) = 0,
    'Worker não concluiu as cinco demandas: ' || coalesce(v_job_result, '{}'::jsonb)::text;

  SELECT
    count(*)::integer,
    count(DISTINCT demand.technical_strap_line_id)::integer,
    count(DISTINCT variant.color_id)::integer,
    count(DISTINCT demand.strap_variant_id)::integer,
    count(DISTINCT demand.base_product_id)::integer
    INTO
      v_line_count,
      v_technical_line_count,
      v_color_count,
      v_variant_count,
      v_base_product_count
    FROM public.sale_order_strap_demands demand
    JOIN public.artisanal_strap_variants variant
      ON variant.id = demand.strap_variant_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current;

  ASSERT v_line_count = 5
     AND v_technical_line_count = 5
     AND v_color_count = 3
     AND v_variant_count = 3
     AND v_base_product_count = 3,
    format(
      'Demandas divergentes: linhas=%s UUIDs=%s cores=%s variantes=%s bases=%s',
      v_line_count,
      v_technical_line_count,
      v_color_count,
      v_variant_count,
      v_base_product_count
    );

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
      JOIN public.artisanal_strap_variants variant
        ON variant.id = demand.strap_variant_id
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         variant.color_id IS DISTINCT FROM nullif(
           v_prepared_item -> 'strap_sourcing'
             -> demand.technical_strap_line_id::text ->> 'color_id',
           ''
         )::uuid
         OR variant.color_id IS DISTINCT FROM nullif(
           v_preview_by_line -> demand.technical_strap_line_id::text
             ->> 'color_id',
           ''
         )::uuid
         OR demand.base_product_id IS DISTINCT FROM nullif(
           v_prepared_item -> 'strap_sourcing'
             -> demand.technical_strap_line_id::text ->> 'base_product_id',
           ''
         )::uuid
         OR demand.gross_required_m IS DISTINCT FROM nullif(
           v_preview_by_line -> demand.technical_strap_line_id::text
             ->> 'gross_required_m',
           ''
         )::numeric
         OR NOT (v_expected_m_by_line ? demand.technical_strap_line_id::text)
         OR abs(
              demand.gross_required_m
                - (
                    v_expected_m_by_line
                      -> demand.technical_strap_line_id::text #>> '{}'
                  )::numeric
            ) > 0.000001
         OR coalesce(
           nullif(demand.calculation_explanation ->> 'loss_factor', '')::numeric,
           0
         ) <> 0
      )
  ), 'Worker permutou cor/base/consumo entre UUIDs ou aplicou perda';

  -- Com tira acabada zerada e base abundante, cada demanda deve promover uma
  -- contribuição fabril e uma reserva da napa oficial da sua própria cor.
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         demand.source_mode IS DISTINCT FROM 'internal'
         OR demand.status = 'suspended'
         OR demand.base_product_id IS NULL
         OR demand.base_required_m <= 0
         OR abs(
           demand.base_required_m
             - demand.gross_required_m / demand.confirmed_yield_snapshot
         ) > 0.000001
         OR demand.base_reserved_m + 0.000001 < demand.base_required_m
         OR coalesce(demand.base_shortage_m, 0) <> 0
       )
  ), 'Demanda interna não chegou à reserva integral da napa oficial sem perda';

  SELECT count(DISTINCT contribution.batch_item_id)::integer
    INTO v_reservation_count
    FROM public.strap_production_batch_contributions contribution
    JOIN public.sale_order_strap_demands demand
      ON demand.id = contribution.sale_order_strap_demand_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current
     AND contribution.status IN ('planned', 'in_progress', 'partial');
  ASSERT v_reservation_count = 3,
    format('Produção não consolidou as cinco linhas nos três SKUs-cor: itens=%s', v_reservation_count);
  SELECT count(*)::integer
    INTO v_line_count
    FROM public.strap_production_batch_contributions contribution
    JOIN public.sale_order_strap_demands demand
      ON demand.id = contribution.sale_order_strap_demand_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current
     AND contribution.status IN ('planned', 'in_progress', 'partial');
  ASSERT v_line_count = 5,
    format('Produção deveria criar cinco contribuições UUID-only, criou %s', v_line_count);
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
      LEFT JOIN public.strap_production_batch_contributions contribution
        ON contribution.sale_order_strap_demand_id = demand.id
       AND contribution.status IN ('planned', 'in_progress', 'partial')
      LEFT JOIN public.strap_production_batch_items batch_item
        ON batch_item.id = contribution.batch_item_id
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         contribution.id IS NULL
         OR contribution.planned_m IS DISTINCT FROM demand.gross_required_m
         OR batch_item.strap_variant_id IS DISTINCT FROM demand.strap_variant_id
         OR batch_item.base_product_id IS DISTINCT FROM demand.base_product_id
         OR batch_item.finished_product_id IS DISTINCT FROM demand.finished_product_id
       )
  ), 'Contribuição fabril perdeu o vínculo UUID→variante/base/acabado';

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
      JOIN public.strap_production_batch_contributions contribution
        ON contribution.sale_order_strap_demand_id = demand.id
      JOIN public.strap_production_batch_items batch_item
        ON batch_item.id = contribution.batch_item_id
      JOIN public.strap_production_batches batch
        ON batch.id = batch_item.batch_id
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         batch.executor_type IS DISTINCT FROM 'factory'
         OR batch.contractor_id IS NOT NULL
         OR batch.capacity_profile_id IS DISTINCT FROM v_factory_capacity_id
         OR abs(batch_item.scheduled_m - batch_item.planned_finished_m) > 0.000001
         OR coalesce(batch_item.unscheduled_m, 0) <> 0
       )
  ), 'Capacidade efêmera não programou integralmente os três itens-cor';

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
      LEFT JOIN public.material_reservations reservation
        ON reservation.sale_order_strap_demand_id = demand.id
       AND reservation.source = 'strap_engine_base'
       AND reservation.status IN ('reserved', 'partially_consumed')
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         reservation.id IS NULL
         OR reservation.product_id IS DISTINCT FROM demand.base_product_id
         OR reservation.base_product_id IS DISTINCT FROM demand.base_product_id
         OR reservation.strap_variant_id IS DISTINCT FROM demand.strap_variant_id
         OR reservation.strap_batch_item_id IS NULL
         OR abs(
           reservation.quantity_reserved
             - demand.gross_required_m / demand.confirmed_yield_snapshot
         ) > 0.000001
       )
  ), 'Reserva da napa não ficou vinculada à demanda/produto-cor exatos';
  SELECT count(*)::integer
    INTO v_reservation_count
    FROM public.material_reservations reservation
    JOIN public.sale_order_strap_demands demand
      ON demand.id = reservation.sale_order_strap_demand_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current
     AND reservation.source = 'strap_engine_base'
     AND reservation.status IN ('reserved', 'partially_consumed');
  ASSERT v_reservation_count = 5,
    format('Motor deveria criar cinco reservas-base UUID-only, criou %s', v_reservation_count);

  -- Recebe integralmente os três itens-cor, todos nascidos exclusivamente das
  -- cinco contribuições desta transação (pré-condição verificada acima).
  FOR v_batch_item IN
    SELECT DISTINCT
      batch_item.id,
      batch_item.planned_finished_m,
      batch_item.planned_base_m,
      batch_item.confirmed_yield_snapshot
      FROM public.strap_production_batch_items batch_item
     WHERE EXISTS (
       SELECT 1
         FROM public.strap_production_batch_contributions contribution
         JOIN public.sale_order_strap_demands demand
           ON demand.id = contribution.sale_order_strap_demand_id
        WHERE contribution.batch_item_id = batch_item.id
          AND demand.sale_order_id = v_sale_order_id
          AND demand.sale_order_item_id = v_sale_order_item_id
          AND demand.is_current
     )
     ORDER BY batch_item.id
  LOOP
    v_receipt_result := public.register_strap_production_receipt(
      v_batch_item.id,
      NULL,
      v_batch_item.planned_finished_m,
      v_batch_item.planned_finished_m,
      0,
      v_batch_item.planned_base_m,
      'e2e-independent-straps-receipt:' || v_batch_item.id::text
        || ':' || v_client_request_id::text,
      0,
      'E2E-' || left(v_client_request_id::text, 8),
      now(),
      'Rollback automático — produção por cor',
      v_correlation_id,
      NULL
    );
    ASSERT nullif(v_receipt_result ->> 'receipt_id', '')::uuid IS NOT NULL
       AND abs(
         coalesce((v_receipt_result ->> 'base_posted_m')::numeric, -1)
           - v_batch_item.planned_base_m
       ) <= 0.000001,
      'Recebimento fabril não debitou integralmente a napa do item-cor: '
        || coalesce(v_receipt_result, '{}'::jsonb)::text;

    -- Replay com a mesma chave deve reutilizar o fato físico, sem nova baixa.
    DECLARE
      v_replay jsonb;
    BEGIN
      v_replay := public.register_strap_production_receipt(
        v_batch_item.id, NULL,
        v_batch_item.planned_finished_m, v_batch_item.planned_finished_m, 0,
        v_batch_item.planned_base_m,
        'e2e-independent-straps-receipt:' || v_batch_item.id::text
          || ':' || v_client_request_id::text,
        0, 'E2E-' || left(v_client_request_id::text, 8), now(),
        'Rollback automático — produção por cor', v_correlation_id, NULL
      );
      ASSERT v_replay ->> 'receipt_id' = v_receipt_result ->> 'receipt_id',
        'Replay do recebimento criou outro fato físico';
    END;
  END LOOP;

  SELECT count(*)::integer
    INTO v_receipt_count
    FROM public.strap_production_receipts receipt
   WHERE receipt.correlation_id = v_correlation_id;
  ASSERT v_receipt_count = 3,
    format('Recebimento deveria gerar três fatos físicos por SKU-cor, gerou %s', v_receipt_count);
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.strap_production_receipts receipt
      JOIN public.strap_production_batch_items batch_item
        ON batch_item.id = receipt.batch_item_id
      JOIN public.artisanal_strap_variants variant
        ON variant.id = receipt.strap_variant_id
     WHERE receipt.correlation_id = v_correlation_id
       AND (
         receipt.base_product_id IS DISTINCT FROM batch_item.base_product_id
         OR receipt.finished_product_id IS DISTINCT FROM batch_item.finished_product_id
         OR receipt.strap_variant_id IS DISTINCT FROM batch_item.strap_variant_id
         OR receipt.base_lost_m <> 0
         OR receipt.rejected_m <> 0
         OR abs(
           receipt.base_consumed_m
             - receipt.approved_m / batch_item.confirmed_yield_snapshot
         ) > 0.000001
         OR NOT EXISTS (
           SELECT 1
             FROM public.base_material_color_official_products official
            WHERE official.base_group_id = v_base_group_id
              AND official.color_id = variant.color_id
              AND official.official_product_id = receipt.base_product_id
              AND official.status = 'active'
         )
       )
  ), 'Recebimento aplicou perda ou rompeu produto-base oficial↔cor↔variante';

  SELECT count(*)::integer
    INTO v_movement_count
    FROM public.stock_movements movement
    JOIN public.strap_production_receipts receipt
      ON receipt.id = movement.strap_production_receipt_id
   WHERE receipt.correlation_id = v_correlation_id;
  ASSERT v_movement_count = 6,
    format('Três receipts deveriam gerar exatamente seis movimentos físicos, geraram %s', v_movement_count);

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.strap_production_receipts receipt
     WHERE receipt.correlation_id = v_correlation_id
       AND (
         (SELECT count(*)
            FROM public.stock_movements movement
           WHERE movement.strap_production_receipt_id = receipt.id) <> 2
         OR (SELECT count(*)
               FROM public.stock_movements movement
              WHERE movement.strap_production_receipt_id = receipt.id
                AND movement.movement_type = 'out') <> 1
         OR (SELECT count(*)
               FROM public.stock_movements movement
              WHERE movement.strap_production_receipt_id = receipt.id
                AND movement.movement_type = 'in') <> 1
         OR
         NOT EXISTS (
           SELECT 1
             FROM public.stock_movements movement
            WHERE movement.strap_production_receipt_id = receipt.id
              AND movement.movement_type = 'out'
              AND movement.product_id = receipt.base_product_id
              AND movement.base_product_id = receipt.base_product_id
              AND movement.strap_variant_id = receipt.strap_variant_id
              AND movement.strap_batch_item_id = receipt.batch_item_id
              AND movement.strap_recipe_id = receipt.recipe_id
              AND movement.origin_type = 'internal_factory'
              AND movement.correlation_id = receipt.correlation_id
              AND abs(movement.quantity - receipt.base_consumed_m) <= 0.000001
         )
         OR NOT EXISTS (
           SELECT 1
             FROM public.stock_movements movement
            WHERE movement.strap_production_receipt_id = receipt.id
              AND movement.movement_type = 'in'
              AND movement.product_id = receipt.finished_product_id
              AND movement.finished_product_id = receipt.finished_product_id
              AND movement.strap_variant_id = receipt.strap_variant_id
              AND movement.strap_batch_item_id = receipt.batch_item_id
              AND movement.strap_recipe_id = receipt.recipe_id
              AND movement.origin_type = 'internal_factory'
              AND movement.correlation_id = receipt.correlation_id
              AND abs(movement.quantity - receipt.approved_m) <= 0.000001
         )
         OR EXISTS (
           SELECT 1
             FROM public.strap_pending_reconciliations pending
            WHERE pending.production_receipt_id = receipt.id
         )
       )
  ), 'Entrada/baixa física do recebimento não fechou exatamente por produto-cor';

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
      LEFT JOIN public.strap_production_batch_contributions contribution
        ON contribution.sale_order_strap_demand_id = demand.id
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         contribution.status IS DISTINCT FROM 'fulfilled'
         OR contribution.delivered_m IS DISTINCT FROM contribution.planned_m
       )
  ), 'Recebimento não realizou integralmente as cinco contribuições do PV';

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND NOT EXISTS (
         SELECT 1
           FROM public.material_reservations reservation
          WHERE reservation.sale_order_strap_demand_id = demand.id
            AND reservation.source = 'strap_engine_base'
            AND reservation.product_id = demand.base_product_id
            AND reservation.strap_variant_id = demand.strap_variant_id
            AND reservation.status = 'consumed'
            AND abs(
              reservation.quantity_consumed
                - demand.gross_required_m / demand.confirmed_yield_snapshot
            ) <= 0.000001
       )
  ), 'Baixa da napa não consumiu as cinco reservas no produto-cor correto';
  SELECT count(*)::integer
    INTO v_reservation_count
    FROM public.material_reservations reservation
    JOIN public.sale_order_strap_demands demand
      ON demand.id = reservation.sale_order_strap_demand_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current
     AND reservation.source = 'strap_engine_base'
     AND reservation.status = 'consumed'
     AND reservation.product_id = demand.base_product_id
     AND reservation.strap_variant_id = demand.strap_variant_id
     AND abs(
       reservation.quantity_consumed
         - demand.gross_required_m / demand.confirmed_yield_snapshot
     ) <= 0.000001;
  ASSERT v_reservation_count = 5,
    format('Receipt deveria consumir exatamente cinco reservas-base, consumiu %s', v_reservation_count);

  SELECT count(*)::integer
    INTO v_reservation_count
    FROM public.material_reservations reservation
    JOIN public.sale_order_strap_demands demand
      ON demand.id = reservation.sale_order_strap_demand_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current
     AND reservation.source = 'strap_engine_finished'
     AND reservation.status = 'reserved'
     AND reservation.product_id = demand.finished_product_id
     AND reservation.strap_variant_id = demand.strap_variant_id
     AND abs(reservation.quantity_reserved - demand.gross_required_m) <= 0.000001;
  ASSERT v_reservation_count = 5,
    format('Produção não converteu as cinco linhas em reservas acabadas exatas: %s', v_reservation_count);

  -- A promoção também usa o command boundary. Se materiais não-tira da ficha
  -- forem válidos para a cor principal, cria a OP e vincula as cinco reservas.
  v_promotion_result := public.promote_sale_order_to_production(
    v_sale_order_id,
    'Aprovado'
  );
  ASSERT jsonb_typeof(coalesce(v_promotion_result -> 'itens_falha', '[]'::jsonb)) = 'array'
     AND jsonb_array_length(coalesce(v_promotion_result -> 'itens_falha', '[]'::jsonb)) = 0,
    'Promoção recusou o PV de cores independentes: '
      || coalesce(v_promotion_result, '{}'::jsonb)::text;

  SELECT (array_agg(production_order.id ORDER BY production_order.id))[1],
         count(*)::integer
    INTO v_order_id, v_line_count
    FROM public.orders production_order
   WHERE production_order.sale_order_item_id = v_sale_order_item_id
     AND production_order.deleted_at IS NULL;
  ASSERT v_order_id IS NOT NULL AND v_line_count = 1,
    format('Promoção deveria criar uma única OP para o item, encontrou %s', v_line_count);
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.material_reservations reservation
      JOIN public.sale_order_strap_demands demand
        ON demand.id = reservation.sale_order_strap_demand_id
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND reservation.source = 'strap_engine_finished'
       AND reservation.status = 'reserved'
       AND reservation.order_id IS DISTINCT FROM v_order_id
  ), 'Promoção não vinculou as reservas acabadas à OP exata';

  -- O snapshot congelado no setor 4 deve vencer uma edição posterior da
  -- ficha para o setor 8. A reserva nova herda o snapshot e o relatório da OP
  -- preserva tanto o setor quanto `required=4`; dois contextos para o mesmo
  -- SKU ficam explicitamente ambíguos, sem atribuir toda a soma a um setor.
  BEGIN
    ASSERT EXISTS (
      SELECT 1
        FROM public.technical_sheet_snapshots snapshot
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
          snapshot.consumption_snapshot
        ) line(value)
       WHERE snapshot.sale_order_id = v_sale_order_id
         AND snapshot.sale_order_item_id = v_sale_order_item_id
         AND line.value ->> 'product_id' = v_sector_product_id::text
         AND (line.value ->> 'required')::numeric = 4
         AND line.value ->> 'source' = 'direct_components'
         AND line.value ->> 'consumption_sector' = 'Aviamento'
         AND line.value ->> 'consumption_sector_source' = 'explicit'
    ), 'Snapshot não congelou required=4 no setor Aviamento';

    UPDATE public.technical_sheets sheet
       SET direct_components = pg_catalog.jsonb_set(
             sheet.direct_components,
             '{0,consumption_sector}',
             pg_catalog.to_jsonb('Solagem'::text),
             false
           )
     WHERE sheet.id = v_sheet_id;
    ASSERT FOUND, 'Fixture não conseguiu mover a ficha do setor 4 para o 8';

    v_sector_current_lines := public.calculate_order_consumption_by_grade(
      v_sheet_id,
      pg_catalog.jsonb_build_object(v_size, 1),
      v_color_names[1],
      NULL
    );
    ASSERT (
      SELECT pg_catalog.count(*) = 1
         AND pg_catalog.min((line.value ->> 'required')::numeric) = 4
         AND pg_catalog.min(line.value ->> 'consumption_sector') = 'Solagem'
         AND pg_catalog.min(line.value ->> 'consumption_sector_source')
               = 'explicit'
        FROM pg_catalog.jsonb_array_elements(v_sector_current_lines) line(value)
       WHERE line.value ->> 'product_id' = v_sector_product_id::text
    ), 'Motor vigente não refletiu setor Solagem mantendo required=4';

    INSERT INTO public.material_reservations (
      order_id, product_id, quantity_reserved, quantity_consumed, status,
      reservation_type, source, metadata, notes
    ) VALUES (
      v_order_id, v_sector_product_id, 4, 0, 'reserved',
      'soft', 'onhand',
      pg_catalog.jsonb_build_object(
        'kind', 'component',
        'component', 'Componente Direto',
        'source', 'direct_components'
      ),
      'E2E setor congelado — rollback obrigatório'
    ) RETURNING id INTO v_sector_reservation_id;
    ASSERT (
      SELECT reservation.metadata ->> 'consumption_sector' = 'Aviamento'
         AND reservation.metadata ->> 'consumption_sector_source' = 'explicit'
        FROM public.material_reservations reservation
       WHERE reservation.id = v_sector_reservation_id
    ), 'Reserva adotou setor 8 atual em vez do snapshot do setor 4';

    v_sector_report := public.calculate_consumption_report_batch(
      ARRAY[]::uuid[], ARRAY[v_order_id]::uuid[]
    );
    ASSERT (
      SELECT pg_catalog.count(*) = 1
         AND pg_catalog.min((line.value ->> 'required')::numeric) = 4
         AND pg_catalog.min(line.value ->> 'consumption_sector') = 'Aviamento'
         AND pg_catalog.min(line.value ->> 'consumption_sector_source')
               = 'reservation'
         AND pg_catalog.min(line.value ->> 'consumption_sector_origin')
               = 'explicit'
        FROM pg_catalog.jsonb_array_elements(v_sector_report -> 'lines') line(value)
       WHERE line.value ->> 'line_kind' = 'material'
         AND line.value ->> 'product_id' = v_sector_product_id::text
    ), 'Relatório não preservou setor/required congelados pela reserva';

    INSERT INTO public.material_reservations (
      order_id, product_id, quantity_reserved, quantity_consumed, status,
      reservation_type, source, metadata, notes
    ) VALUES (
      v_order_id, v_sector_product_id, 1, 0, 'reserved',
      'soft', 'onhand',
      pg_catalog.jsonb_build_object(
        'kind', 'component',
        'component', 'Componente Direto',
        'source', 'direct_components',
        'consumption_sector', 'Solagem',
        'consumption_sector_source', 'explicit'
      ),
      'E2E conflito de setor — rollback obrigatório'
    );

    v_sector_report := public.calculate_consumption_report_batch(
      ARRAY[]::uuid[], ARRAY[v_order_id]::uuid[]
    );
    ASSERT (
      SELECT pg_catalog.count(*) = 1
         AND pg_catalog.min((line.value ->> 'required')::numeric) = 4
         AND pg_catalog.min(line.value ->> 'consumption_sector') IS NULL
         AND pg_catalog.min(line.value ->> 'consumption_sector_source')
               = 'ambiguous'
        FROM pg_catalog.jsonb_array_elements(v_sector_report -> 'lines') line(value)
       WHERE line.value ->> 'line_kind' = 'material'
         AND line.value ->> 'product_id' = v_sector_product_id::text
    ), 'Dois setores do mesmo SKU foram colapsados em um destino arbitrário';

    v_sector_runtime_passed := true;
    RAISE EXCEPTION USING
      ERRCODE = 'PZ155',
      MESSAGE = 'rollback do cenário runtime de setor';
  EXCEPTION WHEN SQLSTATE 'PZ155' THEN NULL;
  END;
  ASSERT v_sector_runtime_passed,
    'Cenário snapshot/reserva/relatório de setor não concluiu';

  -- Uma OP pode representar apenas parte do item do PV. O preview e o
  -- relatório precisam usar a quantidade/grade da OP, sem multiplicar pelo
  -- total do item. A alteração do item fica isolada e não sincroniza a OP:
  -- assim o fixture prova 2 pares no item contra 1 par na OP existente.
  BEGIN
    PERFORM pg_catalog.set_config('app.suppress_item_op_sync', '1', true);
    UPDATE public.sale_order_items item
       SET quantity = 2,
           grade = pg_catalog.jsonb_build_object(v_size, 2)
     WHERE item.id = v_sale_order_item_id;
    ASSERT FOUND, 'Fixture parcial não encontrou o item do PV';
    ASSERT (
      SELECT production_order.quantity = 1
         AND public.resolve_effective_op_grade(
               production_order.grade,
               production_order.quantity
             ) = pg_catalog.jsonb_build_object(v_size, 1)
        FROM public.orders production_order
       WHERE production_order.id = v_order_id
    ), 'Fixture parcial sincronizou indevidamente a OP com o item';

    SELECT COALESCE(pg_catalog.jsonb_object_agg(
             preview.technical_strap_line_id::text,
             pg_catalog.to_jsonb(preview)
           ), '{}'::jsonb)
      INTO v_partial_item_preview
      FROM public.preview_sale_order_strap_demand_draft(
        pg_catalog.jsonb_build_object(
          'sale_order_id', v_sale_order_id,
          'sale_order_item_id', v_sale_order_item_id,
          'scope_type', 'sale_order_item',
          'scope_key', v_sale_order_item_id
        )
      ) preview;

    SELECT COALESCE(pg_catalog.jsonb_object_agg(
             preview.technical_strap_line_id::text,
             pg_catalog.to_jsonb(preview)
           ), '{}'::jsonb)
      INTO v_partial_order_preview
      FROM public.preview_sale_order_strap_demand_draft(
        pg_catalog.jsonb_build_object(
          'sale_order_id', v_sale_order_id,
          'sale_order_item_id', v_sale_order_item_id,
          'scope_type', 'production_order',
          'scope_key', v_order_id
        )
      ) preview;

    ASSERT (SELECT pg_catalog.count(*)
              FROM pg_catalog.jsonb_each(v_partial_item_preview)) = 5
       AND (SELECT pg_catalog.count(*)
              FROM pg_catalog.jsonb_each(v_partial_order_preview)) = 5,
      'Preview parcial não preservou as cinco linhas por UUID';
    ASSERT NOT EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_each(v_expected_m_by_line)
               expected(line_id, required_m)
       WHERE abs(
               (v_partial_item_preview -> expected.line_id
                 ->> 'gross_required_m')::numeric
                 - 2 * (expected.required_m #>> '{}')::numeric
             ) > 0.000001
          OR abs(
               (v_partial_order_preview -> expected.line_id
                 ->> 'gross_required_m')::numeric
                 - (expected.required_m #>> '{}')::numeric
             ) > 0.000001
    ), 'Preview confundiu total do item com quantidade da OP parcial';

    v_partial_report := public.calculate_consumption_report_batch(
      ARRAY[]::uuid[],
      ARRAY[v_order_id]::uuid[]
    );
    ASSERT pg_catalog.jsonb_array_length(
             COALESCE(v_partial_report -> 'strap_previews', '[]'::jsonb)
           ) = 5,
      'Relatório da OP parcial não devolveu cinco previews de tira';
    ASSERT NOT EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_array_elements(
               v_partial_report -> 'strap_previews'
             ) report_line(value)
        LEFT JOIN LATERAL (
          SELECT expected.value AS required_m
            FROM pg_catalog.jsonb_each(v_expected_m_by_line) expected
           WHERE expected.key = report_line.value
                                  ->> 'technical_strap_line_id'
        ) expected ON true
       WHERE report_line.value ->> 'scope_type'
               IS DISTINCT FROM 'production_order'
          OR report_line.value ->> 'scope_key'
               IS DISTINCT FROM v_order_id::text
          OR expected.required_m IS NULL
          OR abs(
               (report_line.value ->> 'gross_required_m')::numeric
                 - (expected.required_m #>> '{}')::numeric
             ) > 0.000001
    ), 'Relatório misturou escopo/quantidade do item com a OP parcial';

    v_partial_scope_passed := true;
    RAISE EXCEPTION USING
      ERRCODE = 'PZ155',
      MESSAGE = 'rollback do cenário de OP parcial';
  EXCEPTION WHEN SQLSTATE 'PZ155' THEN NULL;
  END;
  ASSERT v_partial_scope_passed,
    'Cenário de preview/relatório por OP parcial não concluiu';

-- Finalização parcial e cancelamento da OP efêmera antes do picking.
-- NÃO executar isolado nem remover o ROLLBACK final do cenário principal.
-- Cada cenário usa subtransação revertida: o picking original continua intacto.

DECLARE
  v_order_id uuid;
  v_order_count integer;
  v_product_id uuid;
  v_product_before jsonb;
  v_reservation_id uuid;
  v_finished_before jsonb;
  v_finished_after jsonb;
  v_movements_before integer;
  v_finalized_passed boolean := false;
  v_cancelled_passed boolean := false;
BEGIN
  SELECT (array_agg(o.id ORDER BY o.id))[1], count(*)
    INTO v_order_id, v_order_count
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE so.notes = 'E2E-STRAP-COLORS-PHYSICAL — rollback automático'
     AND o.created_at >= transaction_timestamp()
     AND so.created_at >= transaction_timestamp()
     AND o.deleted_at IS NULL;
  ASSERT v_order_count = 1,
    'Executar somente dentro do fixture E2E de tiras, após promoção e antes do picking';
  ASSERT EXISTS (SELECT 1 FROM public.material_reservations
    WHERE order_id = v_order_id AND source = 'strap_engine_finished' AND status = 'reserved'),
    'O fixture precisa manter reservas de tira ainda abertas';

  -- Material de contagem fora das reservas do fixture. Seu saldo só existe
  -- dentro das subtransações abaixo e é restaurado integralmente depois delas.
  SELECT p.id, to_jsonb(p) INTO v_product_id, v_product_before
    FROM public.products p
   WHERE p.active AND p.unit = 'un'
     AND NOT EXISTS (SELECT 1 FROM public.artisanal_strap_variants sv
       WHERE sv.finished_product_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.material_reservations mr
       WHERE mr.order_id = v_order_id AND mr.product_id = p.id)
   ORDER BY p.id LIMIT 1 FOR UPDATE;
  ASSERT v_product_id IS NOT NULL, 'Fixture sem componente de contagem elegível';

  BEGIN
    UPDATE public.products SET quantity = 3, current_stock = 3 WHERE id = v_product_id;
    INSERT INTO public.material_reservations (
      order_id, product_id, quantity_reserved, quantity_consumed, status,
      reservation_type, source, metadata, notes
    ) VALUES (
      v_order_id, v_product_id, 10, 0, 'reserved', 'soft', 'onhand',
      jsonb_build_object('kind', 'component', 'component', 'Componente Direto',
        'source', 'direct_components', 'consumption_sector', 'Aviamento',
        'consumption_sector_source', 'snapshot'),
      'E2E parcial/finalização — rollback obrigatório'
    ) RETURNING id INTO v_reservation_id;

    -- Exercita o gatilho de status real, não apenas a função de liquidação.
    UPDATE public.orders SET status = 'Finalizado' WHERE id = v_order_id;
    ASSERT (SELECT status = 'Finalizado' FROM public.orders WHERE id = v_order_id),
      'Falta parcial impediu finalizar a OP';
    ASSERT (SELECT quantity = 0 FROM public.products WHERE id = v_product_id),
      'A baixa parcial não consumiu exatamente o saldo 3';
    ASSERT (SELECT status = 'consumed' AND quantity_reserved = 3 AND quantity_consumed = 3
      FROM public.material_reservations WHERE id = v_reservation_id),
      'A reserva consumida não representa exatamente as 3 unidades baixadas';
    ASSERT (SELECT count(*) = 1 AND sum(quantity) = 3 FROM public.stock_movements
      WHERE order_id = v_order_id AND material_reservation_id = v_reservation_id
        AND product_id = v_product_id AND movement_type = 'out'),
      'Finalização duplicou ou perdeu a baixa física parcial';
    ASSERT (SELECT count(*) = 1 AND sum(quantity_reserved - quantity_consumed) = 7
      FROM public.material_reservations WHERE order_id = v_order_id
        AND product_id = v_product_id AND status = 'pending_reconciliation'
        AND metadata ->> 'partial_of' = v_reservation_id::text
        AND metadata ->> 'consumption_sector' = 'Aviamento'
        AND metadata ->> 'requires_manual_reconciliation' = 'true'),
      'As 7 unidades faltantes desapareceram ou perderam o setor congelado';
    ASSERT NOT EXISTS (SELECT 1 FROM public.material_reservations
      WHERE order_id = v_order_id AND product_id = v_product_id AND status = 'cancelled'),
      'Finalização cancelou indevidamente a falta de material';

    PERFORM public.settle_open_reservations_for_order(v_order_id, 'e2e_replay');
    UPDATE public.orders SET status = 'Finalizado' WHERE id = v_order_id;
    ASSERT (SELECT count(*) = 1 AND sum(quantity) = 3 FROM public.stock_movements
      WHERE material_reservation_id = v_reservation_id AND movement_type = 'out'),
      'Repetição da finalização gerou segundo débito';
    ASSERT (SELECT count(*) = 1 AND sum(quantity_reserved - quantity_consumed) = 7
      FROM public.material_reservations WHERE order_id = v_order_id
        AND product_id = v_product_id AND status = 'pending_reconciliation'
        AND metadata ->> 'partial_of' = v_reservation_id::text),
      'Repetição apagou ou duplicou a pendência';
    v_finalized_passed := true;
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'rollback do cenário finalização';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
  END;
  ASSERT v_finalized_passed, 'Cenário finalização não concluiu';
  ASSERT (SELECT to_jsonb(p) = v_product_before FROM public.products p WHERE id = v_product_id),
    'O saldo do produto não foi restaurado pela subtransação';

  BEGIN
    UPDATE public.products SET quantity = 3, current_stock = 3 WHERE id = v_product_id;
    INSERT INTO public.material_reservations (
      order_id, product_id, quantity_reserved, quantity_consumed, status,
      reservation_type, source, metadata, notes
    ) VALUES (
      v_order_id, v_product_id, 10, 0, 'reserved', 'soft', 'onhand',
      jsonb_build_object('kind', 'component', 'component', 'Componente Direto',
        'source', 'direct_components', 'consumption_sector', 'Aviamento',
        'consumption_sector_source', 'snapshot'),
      'E2E cancelamento — rollback obrigatório'
    ) RETURNING id INTO v_reservation_id;
    SELECT count(*) INTO v_movements_before FROM public.stock_movements WHERE order_id = v_order_id;
    SELECT jsonb_object_agg(p.id, p.quantity) INTO v_finished_before
      FROM public.products p WHERE p.id IN (
        SELECT product_id FROM public.material_reservations
        WHERE order_id = v_order_id AND source = 'strap_engine_finished');

    UPDATE public.orders SET status = 'Cancelado' WHERE id = v_order_id;
    ASSERT (SELECT status = 'cancelled' AND quantity_consumed = 0
      FROM public.material_reservations WHERE id = v_reservation_id),
      'Cancelamento não liberou a reserva sem execução';
    ASSERT (SELECT quantity = 3 FROM public.products WHERE id = v_product_id),
      'Cancelamento debitou ou fabricou saldo do componente';
    ASSERT (SELECT count(*) = v_movements_before FROM public.stock_movements WHERE order_id = v_order_id),
      'Cancelamento de reserva sem execução gerou movimento físico';
    ASSERT NOT EXISTS (SELECT 1 FROM public.material_reservations
      WHERE order_id = v_order_id AND source = 'strap_engine_finished' AND status = 'reserved'),
      'Cancelamento deixou reservas acabadas abertas';
    SELECT jsonb_object_agg(p.id, p.quantity) INTO v_finished_after
      FROM public.products p WHERE p.id IN (
        SELECT product_id FROM public.material_reservations
        WHERE order_id = v_order_id AND source = 'strap_engine_finished');
    ASSERT v_finished_before = v_finished_after,
      'Liberar reserva de tira alterou indevidamente o saldo físico';
    v_cancelled_passed := true;
    RAISE EXCEPTION USING ERRCODE = 'PZ002', MESSAGE = 'rollback do cenário cancelamento';
  EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
  END;
  ASSERT v_cancelled_passed, 'Cenário cancelamento não concluiu';
  ASSERT (SELECT to_jsonb(p) = v_product_before FROM public.products p WHERE id = v_product_id),
    'Cancelamento de teste deixou alteração no produto';
END;

  -- Picking individual evita que componentes alheios à feature influenciem a
  -- prova. Cada baixa nasce da reserva UUID-only e o trigger enriquece o fato.
  FOR v_reservation IN
    SELECT reservation.id
      FROM public.material_reservations reservation
      JOIN public.sale_order_strap_demands demand
        ON demand.id = reservation.sale_order_strap_demand_id
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND reservation.source = 'strap_engine_finished'
       AND reservation.status = 'reserved'
     ORDER BY reservation.id
  LOOP
    PERFORM public.confirm_picking_reservation(
      v_reservation.id,
      'E2E cores independentes'
    );
    DECLARE
      v_replay_rejected boolean := false;
    BEGIN
      BEGIN
        PERFORM public.confirm_picking_reservation(
          v_reservation.id, 'E2E cores independentes'
        );
      EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM NOT LIKE 'Reserva já consumida ou cancelada%' THEN
          RAISE;
        END IF;
        v_replay_rejected := true;
      END;
      ASSERT v_replay_rejected, 'Picking aceitou novamente uma reserva já consumida';
    END;
  END LOOP;

  SELECT count(*)::integer
    INTO v_movement_count
    FROM public.stock_movements movement
    JOIN public.sale_order_strap_demands demand
      ON demand.id = movement.sale_order_strap_demand_id
   WHERE demand.sale_order_id = v_sale_order_id
     AND demand.sale_order_item_id = v_sale_order_item_id
     AND demand.is_current
     AND movement.movement_type = 'out'
     AND movement.order_id = v_order_id
     AND movement.material_reservation_id IS NOT NULL
     AND movement.product_id = demand.finished_product_id
     AND movement.finished_product_id = demand.finished_product_id
     AND movement.strap_variant_id = demand.strap_variant_id
     AND abs(movement.quantity - demand.gross_required_m) <= 0.000001;
  ASSERT v_movement_count = 5,
    format('Picking não gerou cinco baixas acabadas UUID-only, gerou %s', v_movement_count);

  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands demand
      LEFT JOIN public.material_reservations reservation
        ON reservation.sale_order_strap_demand_id = demand.id
       AND reservation.source = 'strap_engine_finished'
     WHERE demand.sale_order_id = v_sale_order_id
       AND demand.sale_order_item_id = v_sale_order_item_id
       AND demand.is_current
       AND (
         demand.status IS DISTINCT FROM 'fulfilled'
         OR demand.fulfilled_m IS DISTINCT FROM demand.gross_required_m
         OR reservation.status IS DISTINCT FROM 'consumed'
         OR reservation.quantity_consumed IS DISTINCT FROM demand.gross_required_m
       )
  ), 'Consumo final não fechou demanda/reserva por UUID e produto-cor';
END
$test$;

SELECT jsonb_build_object(
  'ok', true,
  'scenario', 'independent_strap_colors_e2e',
  'proof', 'auth+writer+oracle+preview+create+worker+receipt+receipt_replay+promotion+sector_snapshot_reservation_ambiguity+partial_scope_report+partial_finalization+cancel+picking+picking_replay',
  'rollback', true
) AS independent_strap_colors_e2e;

ROLLBACK;
