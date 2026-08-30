-- 20270101014800 — SP124: identidade composta do Cabedal, variantes compatíveis e cor ausente explícita.
--
-- O Cabedal da SP124 é um SKU acabado NAPA SOFT + MASSABOX. A Forração usa
-- NAPA SOFT puro. As duas necessidades podem ter a mesma cor e largura, mas não
-- são o mesmo produto e nunca podem compartilhar reserva, custo ou débito.
--
-- Esta migration:
--   1. ratifica a composição cadastral do grupo acabado (metadado somente);
--   2. ratifica a ficha SP124 de forma idempotente e fail-closed;
--   3. impede cascata/override de variante que remova as camadas fixas;
--   4. transforma cor ausente de grupo composto em pendência explícita;
--   5. preserva snapshots e reservas já comprometidos (PV-00162 inclusive).
--
-- Não há explosão de composição: estoque continua debitando UM SKU acabado do
-- grupo NAPA SOFT + MASSABOX. product_group_layers não participa do consumo.

-- =============================================================================
-- 1. Ratificação cadastral e correção idempotente da ficha
-- =============================================================================

-- Marcador durável do contrato pós-deploy. O workflow só grava a chave depois
-- que o SQL read-only passa; se a migration aplicar e o teste falhar, uma nova
-- execução repete o teste em vez de liberar a release por engano. A tabela é
-- genérica para futuras migrations com verificação operacional one-shot.
CREATE TABLE IF NOT EXISTS public.deployment_postdeploy_checks (
  check_key text PRIMARY KEY,
  migration_version text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.deployment_postdeploy_checks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.deployment_postdeploy_checks
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.deployment_postdeploy_checks IS
  'Marcadores internos gravados pelo pipeline somente após contratos pós-deploy read-only aprovados.';

DO $ratify$
DECLARE
  v_sheet_id constant uuid := '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid;
  v_target_group_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158'::uuid;
  v_pure_napa_group_id constant uuid := 'a0c6dcee-c72f-4e66-8f69-47be847957d3'::uuid;
  v_off_white_product_id constant uuid := '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid;
  v_preto_product_id constant uuid := '32875560-24a4-4341-bb45-39a002a9b092'::uuid;
  v_pv_id uuid;
  v_sheet public.technical_sheets%ROWTYPE;
  v_layer_count integer;
  v_updated integer;
  v_layers_inserted boolean := false;
  v_now timestamptz := pg_catalog.statement_timestamp();
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sp124-composite-upper-ratification', 0)
  );

  SELECT ts.*
    INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = v_sheet_id
   FOR UPDATE;

  -- Bancos novos/limpos não possuem o catálogo operacional. A migration ainda
  -- instala as guardas gerais, mas não fabrica ficha, grupos ou produtos.
  IF NOT FOUND THEN
    RAISE NOTICE 'SP124 ausente; ratificação de dados ignorada e guardas gerais instaladas.';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('group-leaf-reference:' || v_pure_napa_group_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('group-leaf-reference:' || v_target_group_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
      FROM public.product_groups g
     WHERE g.id = v_target_group_id
       AND g.name = 'NAPA SOFT + MASSABOX'
       AND g.sector = 'Cabedal'
       AND coalesce(g.is_family, false) = false
       AND NOT EXISTS (
         SELECT 1 FROM public.product_groups child
          WHERE child.parent_group_id = g.id
       )
  ) THEN
    RAISE EXCEPTION
      'SP124: grupo acabado NAPA SOFT + MASSABOX ausente ou divergente.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.product_groups g
     WHERE g.id = v_pure_napa_group_id
       AND g.name = 'NAPA SOFT'
       AND coalesce(g.is_family, false) = false
       AND NOT EXISTS (
         SELECT 1 FROM public.product_groups child
          WHERE child.parent_group_id = g.id
       )
  ) THEN
    RAISE EXCEPTION 'SP124: grupo constituinte NAPA SOFT ausente ou divergente.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          (v_off_white_product_id, 'OFF WHITE'::text),
          (v_preto_product_id, 'PRETO'::text)
      ) expected(product_id, color)
      LEFT JOIN public.products p ON p.id = expected.product_id
     WHERE p.id IS NULL
        OR p.group_id IS DISTINCT FROM v_target_group_id
        OR p.active IS DISTINCT FROM true
        OR p.unit IS DISTINCT FROM 'm'
        OR pg_catalog.upper(pg_catalog.btrim(coalesce(p.color, '')))
             IS DISTINCT FROM expected.color
        OR NOT EXISTS (
          SELECT 1
            FROM public.component_sheets cs
           WHERE cs.product_id = expected.product_id
             AND cs.group_id = v_target_group_id
             AND cs.dimensions_width = 1370
             AND cs.dimensions_unit = 'mm'
        )
  ) THEN
    RAISE EXCEPTION
      'SP124: SKUs OFF WHITE/PRETO do Cabedal composto não estão ativos em m com largura 1370 mm.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
    INTO v_layer_count
    FROM public.product_group_layers l
   WHERE l.composite_group_id = v_target_group_id;

  -- Tanto a primeira ativação das camadas quanto uma eventual correção da
  -- ficha legada mudam a semântica do Cabedal. O PV de diagnóstico precisa
  -- continuar exatamente no estado conhecido e sem artefato operacional.
  -- No banco vivo a ficha já aponta o grupo correto, portanto este gate NÃO
  -- pode morar apenas no branch legado da ficha.
  IF v_layer_count = 0 OR (
    v_sheet.upper_material = 'NAPA SOFT'
    AND v_sheet.upper_material_group_id = v_pure_napa_group_id
    AND v_sheet.upper_material_product_id IS NULL
  ) THEN
    SELECT so.id
      INTO v_pv_id
      FROM public.sale_orders so
     WHERE so.order_number = 'PV-00168'
       AND so.status = 'Rascunho';

    IF v_pv_id IS NULL THEN
      RAISE EXCEPTION 'SP124: PV-00168 não está em Rascunho; transição automática recusada.'
        USING ERRCODE = '23514';
    END IF;

    IF (SELECT count(*) FROM public.sale_order_items soi
         WHERE soi.sale_order_id = v_pv_id
           AND soi.reference_id = v_sheet_id) <> 2
       OR (SELECT count(*) FROM public.sale_order_items soi
            WHERE soi.sale_order_id = v_pv_id
              AND soi.reference_id = v_sheet_id
              AND soi.material_variant_id IS NULL
              AND soi.color = 'OFF WHITE'
              AND soi.quantity = 420) <> 1
       OR (SELECT count(*) FROM public.sale_order_items soi
            WHERE soi.sale_order_id = v_pv_id
              AND soi.reference_id = v_sheet_id
              AND soi.material_variant_id IS NULL
              AND soi.color = 'PRETO'
              AND soi.quantity = 300) <> 1 THEN
      RAISE EXCEPTION 'SP124: itens esperados do PV-00168 divergiram; transição automática recusada.'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.orders o WHERE o.sale_order_id = v_pv_id
    ) OR EXISTS (
      SELECT 1
        FROM public.technical_sheet_snapshots s
       WHERE s.sale_order_id = v_pv_id
         AND s.sheet_id = v_sheet_id
    ) OR EXISTS (
      SELECT 1
        FROM public.material_reservations mr
        JOIN public.orders o ON o.id = mr.order_id
       WHERE o.sale_order_id = v_pv_id
    ) THEN
      RAISE EXCEPTION 'SP124: PV-00168 já possui OP, snapshot ou reserva; transição automática recusada.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_layer_count = 0 THEN
    -- Adicionar a primeira camada muda a semântica do resolver. No catálogo
    -- vivo, a única exceção já comprometida é o PV-00162; qualquer outro PV
    -- aberto exige revisão manual antes dessa transição.
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items soi
        JOIN public.sale_orders so ON so.id = soi.sale_order_id
       WHERE soi.reference_id = v_sheet_id
         AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
         AND so.order_number <> 'PV-00162'
    ) THEN
      RAISE EXCEPTION
        'SP124: há PV comprometido diferente do legado PV-00162; composição não será ativada automaticamente.'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.sale_orders so
       WHERE so.order_number = 'PV-00162'
         AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
    ) AND (
      (SELECT count(*)
         FROM public.sale_order_items soi
         JOIN public.sale_orders so ON so.id = soi.sale_order_id
        WHERE so.order_number = 'PV-00162'
          AND soi.reference_id = v_sheet_id) <> 2
      OR (SELECT count(*)
            FROM public.sale_order_items soi
            JOIN public.sale_orders so ON so.id = soi.sale_order_id
           WHERE so.order_number = 'PV-00162'
             AND soi.reference_id = v_sheet_id
             AND soi.material_variant_id IS NULL
             AND soi.color = 'OFF WHITE'
             AND soi.quantity = 108) <> 1
      OR (SELECT count(*)
            FROM public.sale_order_items soi
            JOIN public.sale_orders so ON so.id = soi.sale_order_id
           WHERE so.order_number = 'PV-00162'
             AND soi.reference_id = v_sheet_id
             AND soi.material_variant_id IS NULL
             AND soi.color = 'LIMONCELLO'
             AND soi.quantity = 72) <> 1
    ) THEN
      RAISE EXCEPTION
        'SP124: o legado operacional PV-00162 divergiu; composição não será ativada automaticamente.'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.product_group_layers (
      composite_group_id,
      component_group_id,
      component_label,
      role,
      display_order,
      is_color_source,
      notes
    ) VALUES
      (
        v_target_group_id,
        v_pure_napa_group_id,
        'NAPA SOFT',
        'Material externo',
        0,
        true,
        'Fonte da cor; o estoque continua no SKU acabado do grupo composto.'
      ),
      (
        v_target_group_id,
        NULL,
        'MASSABOX',
        'Base da dublagem',
        1,
        false,
        'Camada estrutural obrigatória; não é explodida no consumo do PV.'
      );
    v_layers_inserted := true;
  ELSIF v_layer_count = 2
    AND EXISTS (
      SELECT 1
        FROM public.product_group_layers l
       WHERE l.composite_group_id = v_target_group_id
         AND l.component_group_id = v_pure_napa_group_id
         AND l.component_label = 'NAPA SOFT'
         AND l.role = 'Material externo'
         AND l.display_order = 0
         AND l.is_color_source = true
    )
    AND EXISTS (
      SELECT 1
        FROM public.product_group_layers l
       WHERE l.composite_group_id = v_target_group_id
         AND l.component_group_id IS NULL
         AND pg_catalog.upper(pg_catalog.btrim(l.component_label)) = 'MASSABOX'
         AND l.role = 'Base da dublagem'
         AND l.display_order = 1
         AND l.is_color_source = false
    ) THEN
    RAISE NOTICE 'SP124: composição NAPA SOFT + MASSABOX já ratificada.';
  ELSE
    RAISE EXCEPTION
      'SP124: composição existente do grupo NAPA SOFT + MASSABOX diverge do contrato; revisão manual obrigatória.'
      USING ERRCODE = '23514';
  END IF;

  IF v_layers_inserted THEN
    -- Não reescreve snapshot nem reserva: só invalida metadados de leitura e
    -- marca as reservas como desatualizadas. Assim o PV-00162 permanece
    -- auditável, mas custo/readiness novos não confundem NAPA SOFT puro com o
    -- SKU acabado NAPA SOFT + MASSABOX.
    UPDATE public.sale_orders so
       SET costs_dirty_at = v_now,
           reservations_outdated_at = CASE
             WHEN so.status IN ('Pendente', 'Aprovado', 'Em Produção')
               THEN v_now
             ELSE so.reservations_outdated_at
           END
     WHERE so.id IN (
       SELECT DISTINCT soi.sale_order_id
         FROM public.sale_order_items soi
        WHERE soi.reference_id = v_sheet_id
     )
       AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho')
       AND so.order_number <> 'PV-00162';

    UPDATE public.technical_sheet_snapshots s
       SET outdated_at = v_now
     WHERE s.sheet_id = v_sheet_id
       AND s.outdated_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_orders so
          WHERE so.id = s.sale_order_id
            AND so.order_number = 'PV-00162'
       );
  END IF;

  IF v_sheet.upper_material = 'NAPA SOFT + MASSABOX'
     AND v_sheet.upper_material_group_id = v_target_group_id
     AND v_sheet.upper_material_product_id IS NULL
     AND v_sheet.cor_predominante_id = v_target_group_id
     AND coalesce(v_sheet.variant_drives_upper, false) = false THEN
    RAISE NOTICE 'SP124 já aponta para o Cabedal composto; ficha preservada sem nova versão.';
  ELSIF v_sheet.upper_material = 'NAPA SOFT'
     AND v_sheet.upper_material_group_id = v_pure_napa_group_id
     AND v_sheet.upper_material_product_id IS NULL
     AND (
       v_sheet.cor_predominante_id IS NULL
       OR v_sheet.cor_predominante_id = v_pure_napa_group_id
     )
     AND coalesce(v_sheet.variant_drives_upper, false) = false THEN
    -- Só o PV de diagnóstico pode existir aberto. Qualquer pedido já
    -- comprometido exige preservar o snapshot, não reescrever o mestre por
    -- baixo dele. Isso protege explicitamente o PV-00162.
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items soi
        JOIN public.sale_orders so ON so.id = soi.sale_order_id
       WHERE soi.reference_id = v_sheet_id
         AND so.id <> v_pv_id
         AND so.status IN ('Pendente', 'Aprovado', 'Em Produção')
    ) THEN
      RAISE EXCEPTION
        'SP124 legada: há outro PV comprometido (incluindo PV-00162); mestre não será alterado automaticamente.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.technical_sheets ts
       SET upper_material = 'NAPA SOFT + MASSABOX',
           upper_material_group_id = v_target_group_id,
           upper_material_product_id = NULL,
           cor_predominante_id = v_target_group_id,
           variant_drives_upper = false,
           version = ts.version + 1
     WHERE ts.id = v_sheet_id
       AND ts.upper_material = 'NAPA SOFT'
       AND ts.upper_material_group_id = v_pure_napa_group_id
       AND ts.upper_material_product_id IS NULL
       AND (
         ts.cor_predominante_id IS NULL
         OR ts.cor_predominante_id = v_pure_napa_group_id
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'SP124 mudou durante a ratificação; nenhuma correção foi aplicada.'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    RAISE EXCEPTION
      'SP124 está em estado não reconhecido (upper=%, group=%, pin=%, predominante=%, cascade=%).',
      v_sheet.upper_material,
      v_sheet.upper_material_group_id,
      v_sheet.upper_material_product_id,
      v_sheet.cor_predominante_id,
      v_sheet.variant_drives_upper
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
     WHERE ts.id = v_sheet_id
       AND ts.upper_material = 'NAPA SOFT + MASSABOX'
       AND ts.upper_material_group_id = v_target_group_id
       AND ts.upper_material_product_id IS NULL
       AND ts.cor_predominante_id = v_target_group_id
       AND coalesce(ts.variant_drives_upper, false) = false
  ) THEN
    RAISE EXCEPTION 'SP124: pós-condição da identidade composta falhou.'
      USING ERRCODE = '23514';
  END IF;
END
$ratify$;

-- =============================================================================
-- 2. Assinatura estrutural canônica de grupos compostos
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_composite_product_group(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_group_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.product_group_layers l
        WHERE l.composite_group_id = p_group_id
     );
$function$;

CREATE OR REPLACE FUNCTION public.product_group_upper_structure_is_compatible(
  p_base_group_id uuid,
  p_candidate_group_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_base_group_id IS NOT NULL
     AND p_candidate_group_id IS NOT NULL
     AND public.is_composite_product_group(p_base_group_id)
     AND public.is_composite_product_group(p_candidate_group_id)
     AND NOT EXISTS (
       WITH base_signature AS (
         SELECT
           CASE
             WHEN l.component_group_id IS NOT NULL
               THEN 'group:' || l.component_group_id::text
             ELSE 'fallback:'
               || pg_catalog.lower(extensions.unaccent(
                    pg_catalog.regexp_replace(pg_catalog.btrim(l.component_label), '[[:space:]]+', ' ', 'g')
                  ))
               || '|'
               || pg_catalog.lower(extensions.unaccent(
                    pg_catalog.regexp_replace(pg_catalog.btrim(l.role), '[[:space:]]+', ' ', 'g')
                  ))
           END AS identity,
           count(*) AS quantity
         FROM public.product_group_layers l
         WHERE l.composite_group_id = p_base_group_id
           AND l.is_color_source = false
         GROUP BY 1
       ), candidate_signature AS (
         SELECT
           CASE
             WHEN l.component_group_id IS NOT NULL
               THEN 'group:' || l.component_group_id::text
             ELSE 'fallback:'
               || pg_catalog.lower(extensions.unaccent(
                    pg_catalog.regexp_replace(pg_catalog.btrim(l.component_label), '[[:space:]]+', ' ', 'g')
                  ))
               || '|'
               || pg_catalog.lower(extensions.unaccent(
                    pg_catalog.regexp_replace(pg_catalog.btrim(l.role), '[[:space:]]+', ' ', 'g')
                  ))
           END AS identity,
           count(*) AS quantity
         FROM public.product_group_layers l
         WHERE l.composite_group_id = p_candidate_group_id
           AND l.is_color_source = false
         GROUP BY 1
       )
       SELECT 1
         FROM base_signature base
         FULL JOIN candidate_signature candidate USING (identity)
        WHERE base.quantity IS DISTINCT FROM candidate.quantity
     );
$function$;

REVOKE ALL ON FUNCTION public.is_composite_product_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_group_upper_structure_is_compatible(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_composite_product_group(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.product_group_upper_structure_is_compatible(uuid, uuid)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_composite_product_group(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_group_upper_structure_is_compatible(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.product_group_upper_structure_is_compatible(uuid, uuid) IS
  'Compara somente camadas não-color-source. UUID do constituinte é a identidade forte; label+role normalizados são fallback. Setor/nome do grupo composto não participam.';

-- =============================================================================
-- 3. Guardas de escrita: ficha, variante e edição posterior da composição
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_guard_technical_sheet_composite_upper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_base_group_id uuid;
  v_candidate_group_id uuid;
  v_variant record;
BEGIN
  -- Serializa ficha × variante × composição. São edições cadastrais raras; um
  -- lock global elimina a janela em que duas transações validariam estados
  -- anteriores uma da outra.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('composite-upper-structure-writes', 0)
  );

  SELECT p.group_id
    INTO v_base_group_id
    FROM public.products p
   WHERE p.id = NEW.upper_material_product_id
     AND p.active = true;
  v_base_group_id := coalesce(v_base_group_id, NEW.upper_material_group_id);

  IF NOT public.is_composite_product_group(v_base_group_id) THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.variant_drives_upper, false) THEN
    RAISE EXCEPTION
      'Cabedal composto não pode seguir o material principal da variante. Use override explícito com as mesmas camadas fixas.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_variant IN
    SELECT
      v.id,
      v.material_name,
      coalesce(pin.group_id, v.upper_material_group_id, v_base_group_id) AS candidate_group_id
    FROM public.reference_material_variants v
    LEFT JOIN public.products pin
      ON pin.id = v.upper_material_product_id
     AND pin.active = true
    WHERE v.reference_id = NEW.id
  LOOP
    v_candidate_group_id := v_variant.candidate_group_id;
    IF NOT public.product_group_upper_structure_is_compatible(
      v_base_group_id,
      v_candidate_group_id
    ) THEN
      RAISE EXCEPTION
        'Variante % (%) remove ou troca camada fixa do Cabedal composto.',
        v_variant.material_name,
        v_variant.id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_zz_guard_technical_sheet_composite_upper
  ON public.technical_sheets;
CREATE TRIGGER trg_zz_guard_technical_sheet_composite_upper
BEFORE INSERT OR UPDATE OF
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  variant_drives_upper
ON public.technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_technical_sheet_composite_upper();

CREATE OR REPLACE FUNCTION public.tg_guard_reference_variant_composite_upper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_base_group_id uuid;
  v_candidate_group_id uuid;
  v_drives_upper boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('composite-upper-structure-writes', 0)
  );

  SELECT
    coalesce(sheet_pin.group_id, ts.upper_material_group_id),
    coalesce(ts.variant_drives_upper, false)
    INTO v_base_group_id, v_drives_upper
    FROM public.technical_sheets ts
    LEFT JOIN public.products sheet_pin
      ON sheet_pin.id = ts.upper_material_product_id
     AND sheet_pin.active = true
   WHERE ts.id = NEW.reference_id;

  IF NOT FOUND OR NOT public.is_composite_product_group(v_base_group_id) THEN
    RETURN NEW;
  END IF;

  IF v_drives_upper THEN
    RAISE EXCEPTION
      'A ficha usa Cabedal composto e não pode delegá-lo ao material principal da variante.'
      USING ERRCODE = '23514';
  END IF;

  SELECT p.group_id
    INTO v_candidate_group_id
    FROM public.products p
   WHERE p.id = NEW.upper_material_product_id
     AND p.active = true;
  v_candidate_group_id := coalesce(
    v_candidate_group_id,
    NEW.upper_material_group_id,
    v_base_group_id
  );

  IF NOT public.product_group_upper_structure_is_compatible(
    v_base_group_id,
    v_candidate_group_id
  ) THEN
    RAISE EXCEPTION
      'Cabedal da variante % é incompatível: preserve as camadas fixas do grupo composto da ficha.',
      coalesce(NEW.material_name, NEW.id::text)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_zz_guard_reference_variant_composite_upper
  ON public.reference_material_variants;
CREATE TRIGGER trg_zz_guard_reference_variant_composite_upper
BEFORE INSERT OR UPDATE OF
  reference_id,
  main_material_group_id,
  upper_material_group_id,
  upper_material_product_id
ON public.reference_material_variants
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_reference_variant_composite_upper();

CREATE OR REPLACE FUNCTION public.assert_all_composite_upper_variants_compatible()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invalid record;
BEGIN
  SELECT ts.id, ts.name
    INTO v_invalid
    FROM public.technical_sheets ts
    LEFT JOIN public.products sheet_pin
      ON sheet_pin.id = ts.upper_material_product_id
     AND sheet_pin.active = true
   WHERE public.is_composite_product_group(
           coalesce(sheet_pin.group_id, ts.upper_material_group_id)
         )
     AND coalesce(ts.variant_drives_upper, false)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Ficha % (%) delega Cabedal composto ao material principal da variante.',
      v_invalid.name,
      v_invalid.id
      USING ERRCODE = '23514';
  END IF;

  WITH resolved AS (
    SELECT
      v.id,
      v.material_name,
      coalesce(sheet_pin.group_id, ts.upper_material_group_id) AS base_group_id,
      coalesce(
        variant_pin.group_id,
        v.upper_material_group_id,
        CASE WHEN coalesce(ts.variant_drives_upper, false)
          THEN v.main_material_group_id END,
        sheet_pin.group_id,
        ts.upper_material_group_id
      ) AS candidate_group_id
    FROM public.reference_material_variants v
    JOIN public.technical_sheets ts ON ts.id = v.reference_id
    LEFT JOIN public.products sheet_pin
      ON sheet_pin.id = ts.upper_material_product_id
     AND sheet_pin.active = true
    LEFT JOIN public.products variant_pin
      ON variant_pin.id = v.upper_material_product_id
     AND variant_pin.active = true
  )
  SELECT r.id, r.material_name
    INTO v_invalid
    FROM resolved r
   WHERE public.is_composite_product_group(r.base_group_id)
     AND NOT public.product_group_upper_structure_is_compatible(
       r.base_group_id,
       r.candidate_group_id
     )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Variante % (%) diverge das camadas fixas do Cabedal composto.',
      v_invalid.material_name,
      v_invalid.id
      USING ERRCODE = '23514';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_guard_composite_upper_layer_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Executa por evento. Não deduplicar só por txid: depois de
  -- `SET CONSTRAINTS ... IMMEDIATE`, outra alteração na mesma transação ainda
  -- precisa ser validada. A tabela cadastral limita cada composição a poucas
  -- dezenas de camadas, então a segurança vale o custo da varredura repetida.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('composite-upper-structure-writes', 0)
  );
  PERFORM public.assert_all_composite_upper_variants_compatible();
  RETURN coalesce(NEW, OLD);
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_composite_upper_layer_changes
  ON public.product_group_layers;
CREATE CONSTRAINT TRIGGER trg_guard_composite_upper_layer_changes
AFTER INSERT OR UPDATE OR DELETE ON public.product_group_layers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_composite_upper_layer_changes();

REVOKE ALL ON FUNCTION public.tg_guard_technical_sheet_composite_upper() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_guard_reference_variant_composite_upper() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_all_composite_upper_variants_compatible() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_guard_composite_upper_layer_changes() FROM PUBLIC;

-- Mudanças nessas flags alteram o material resolvido. Amplia o gatilho
-- canônico em vez de criar um segundo gatilho que repetiria invalidação,
-- incremento de versão e eventos de outbox para o mesmo UPDATE.
DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_upper_variant_drivers
  ON public.technical_sheets;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet
AFTER UPDATE OF
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_material_product_id,
  lining_consumption,
  insole_material,
  insole_consumption,
  sole_material,
  sole_consumption,
  components_accessories,
  lining_accessories,
  direct_components,
  custom_overhead,
  has_straps,
  strap_colors,
  assembly_time_minutes,
  sole_group_id,
  insole_ready_made,
  sole_drives_consumption,
  strap_base_group_id,
  variant_drives_lining,
  variant_drives_upper,
  variant_drives_fachete
ON public.technical_sheets
FOR EACH ROW
WHEN (
  OLD.upper_material IS DISTINCT FROM NEW.upper_material
  OR OLD.upper_material_group_id IS DISTINCT FROM NEW.upper_material_group_id
  OR OLD.upper_material_product_id IS DISTINCT FROM NEW.upper_material_product_id
  OR OLD.upper_consumption IS DISTINCT FROM NEW.upper_consumption
  OR OLD.upper_consumption_per_size IS DISTINCT FROM NEW.upper_consumption_per_size
  OR OLD.lining_material IS DISTINCT FROM NEW.lining_material
  OR OLD.lining_material_product_id IS DISTINCT FROM NEW.lining_material_product_id
  OR OLD.lining_consumption IS DISTINCT FROM NEW.lining_consumption
  OR OLD.insole_material IS DISTINCT FROM NEW.insole_material
  OR OLD.insole_consumption IS DISTINCT FROM NEW.insole_consumption
  OR OLD.sole_material IS DISTINCT FROM NEW.sole_material
  OR OLD.sole_consumption IS DISTINCT FROM NEW.sole_consumption
  OR OLD.components_accessories IS DISTINCT FROM NEW.components_accessories
  OR OLD.lining_accessories IS DISTINCT FROM NEW.lining_accessories
  OR OLD.direct_components IS DISTINCT FROM NEW.direct_components
  OR OLD.custom_overhead IS DISTINCT FROM NEW.custom_overhead
  OR OLD.has_straps IS DISTINCT FROM NEW.has_straps
  OR OLD.strap_colors IS DISTINCT FROM NEW.strap_colors
  OR OLD.assembly_time_minutes IS DISTINCT FROM NEW.assembly_time_minutes
  OR OLD.sole_group_id IS DISTINCT FROM NEW.sole_group_id
  OR OLD.insole_ready_made IS DISTINCT FROM NEW.insole_ready_made
  OR OLD.sole_drives_consumption IS DISTINCT FROM NEW.sole_drives_consumption
  OR OLD.strap_base_group_id IS DISTINCT FROM NEW.strap_base_group_id
  OR OLD.variant_drives_lining IS DISTINCT FROM NEW.variant_drives_lining
  OR OLD.variant_drives_upper IS DISTINCT FROM NEW.variant_drives_upper
  OR OLD.variant_drives_fachete IS DISTINCT FROM NEW.variant_drives_fachete
)
EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();

COMMENT ON TRIGGER trg_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets IS
  'Invalida custo/snapshot/reserva somente quando um campo consumido pelos motores realmente muda, incluindo as tres flags variant_drives_*.';

-- =============================================================================
-- 4. Resolver do Cabedal: composição preservada e cor ausente sempre visível
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_upper_material_for_variant(
  p_variant_id uuid,
  p_group_name text,
  p_color text,
  p_required numeric,
  p_sheet_pin_product_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  available_qty numeric,
  matched_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pid uuid;
  v_gid uuid;
  v_main uuid;
  v_drives boolean;
  v_gname text;
  v_base_gid uuid;
  v_candidate_gid uuid;
  v_candidate_is_composite boolean;
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated')
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado'
      USING ERRCODE = '42501';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT
      v.upper_material_product_id,
      v.upper_material_group_id,
      v.main_material_group_id,
      coalesce(ts.variant_drives_upper, false),
      coalesce(sheet_pin.group_id, ts.upper_material_group_id)
      INTO v_pid, v_gid, v_main, v_drives, v_base_gid
      FROM public.reference_material_variants v
      LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
      LEFT JOIN public.products sheet_pin
        ON sheet_pin.id = ts.upper_material_product_id
       AND sheet_pin.active = true
     WHERE v.id = p_variant_id;

    IF v_drives AND public.is_composite_product_group(v_base_gid) THEN
      -- Estado legado inválido: nunca escolher silenciosamente outro grupo.
      RETURN;
    END IF;

    IF v_pid IS NOT NULL THEN
      SELECT p.group_id
        INTO v_candidate_gid
        FROM public.products p
       WHERE p.id = v_pid
         AND p.active = true;
      IF FOUND THEN
        IF public.is_composite_product_group(v_base_gid)
           AND NOT public.product_group_upper_structure_is_compatible(
             v_base_gid,
             v_candidate_gid
           ) THEN
          RETURN;
        END IF;

        RETURN QUERY
        SELECT p.id, p.name, p.quantity, 'variant'::text
          FROM public.products p
         WHERE p.id = v_pid
           AND p.active = true;
        IF FOUND THEN RETURN; END IF;
      END IF;
    END IF;

    IF v_gid IS NOT NULL THEN
      v_candidate_gid := v_gid;
      IF public.is_composite_product_group(v_base_gid)
         AND NOT public.product_group_upper_structure_is_compatible(
           v_base_gid,
           v_candidate_gid
         ) THEN
        RETURN;
      END IF;

      SELECT g.name, public.is_composite_product_group(g.id)
        INTO v_gname, v_candidate_is_composite
        FROM public.product_groups g
       WHERE g.id = v_gid;
      IF nullif(v_gname, '') IS NOT NULL THEN
        RETURN QUERY
        SELECT
          r.product_id,
          r.product_name,
          r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch'
            THEN r.matched_by ELSE 'variant_group' END
          FROM public.resolve_material_product(
            v_gname,
            p_color,
            p_required,
            false
          ) r
         -- Em grupo composto, `color_mismatch` é deliberadamente preservado:
         -- os motores o exibem como pendência e recusam reserva/débito. Retornar
         -- zero linhas faria o Cabedal desaparecer silenciosamente do consumo.
         WHERE NOT v_candidate_is_composite
            OR r.matched_by IN ('exact_color', 'color_mismatch');
        RETURN;
      END IF;
    END IF;

    IF v_drives AND v_main IS NOT NULL THEN
      SELECT g.name, public.is_composite_product_group(g.id)
        INTO v_gname, v_candidate_is_composite
        FROM public.product_groups g
       WHERE g.id = v_main;
      IF nullif(v_gname, '') IS NOT NULL THEN
        RETURN QUERY
        SELECT
          r.product_id,
          r.product_name,
          r.available_qty,
          CASE WHEN r.matched_by = 'color_mismatch'
            THEN r.matched_by ELSE 'variant_main' END
          FROM public.resolve_material_product(
            v_gname,
            p_color,
            p_required,
            false
          ) r
         WHERE NOT v_candidate_is_composite
            OR r.matched_by IN ('exact_color', 'color_mismatch');
        RETURN;
      END IF;
    END IF;
  END IF;

  IF p_sheet_pin_product_id IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'sheet_pin'::text
      FROM public.products p
     WHERE p.id = p_sheet_pin_product_id
       AND p.active = true;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF v_base_gid IS NULL THEN
    SELECT g.id
      INTO v_base_gid
      FROM public.product_groups g
     WHERE pg_catalog.lower(pg_catalog.btrim(g.name))
       = pg_catalog.lower(pg_catalog.btrim(p_group_name))
     ORDER BY g.id
     LIMIT 1;
  END IF;
  v_candidate_is_composite := public.is_composite_product_group(v_base_gid);

  RETURN QUERY
  SELECT r.product_id, r.product_name, r.available_qty, r.matched_by
    FROM public.resolve_material_product(
      p_group_name,
      p_color,
      p_required,
      false
    ) r
   WHERE NOT v_candidate_is_composite
      OR r.matched_by IN ('exact_color', 'color_mismatch');
END
$function$;

COMMENT ON FUNCTION public.resolve_upper_material_for_variant(uuid, text, text, numeric, uuid) IS
  'Resolve Cabedal por pin/grupo/variante. Grupo composto preserva color_mismatch como pendência visível e exige que overrides mantenham as camadas não-color-source.';

-- CREATE OR REPLACE preserva ACL legado. O resolver lê produto e quantidade
-- como SECURITY DEFINER, portanto nunca pode continuar executável por anon.
REVOKE ALL ON FUNCTION public.resolve_upper_material_for_variant(uuid, text, text, numeric, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_upper_material_for_variant(uuid, text, text, numeric, uuid)
  TO authenticated, service_role;

-- Pins desativados não são identidade física. Todos os leitores comerciais e
-- de tira precisam continuar pela mesma precedência do resolver de consumo:
-- pin ATIVO > grupo explícito > material principal liberado > ficha.
CREATE OR REPLACE FUNCTION public.material_variant_color_group_id(p_variant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT coalesce(
    (SELECT p.group_id
       FROM public.products p
      WHERE p.id = v.upper_material_product_id
        AND p.active = true),
    v.upper_material_group_id,
    CASE WHEN coalesce(ts.variant_drives_upper, false)
      THEN v.main_material_group_id END,
    (SELECT p.group_id
       FROM public.products p
      WHERE p.id = v.lining_material_product_id
        AND p.active = true),
    v.lining_material_group_id,
    CASE WHEN coalesce(ts.variant_drives_lining, false)
      THEN v.main_material_group_id END
  )
  FROM public.reference_material_variants v
  LEFT JOIN public.technical_sheets ts ON ts.id = v.reference_id
  WHERE v.id = p_variant_id;
$function$;

REVOKE ALL ON FUNCTION public.material_variant_color_group_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.material_variant_color_group_id(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
  ), s AS (
    SELECT ts.has_straps,
           ts.upper_material,
           ts.upper_material_group_id,
           ts.strap_base_group_id,
           ts.upper_material_product_id,
           ts.lining_material,
           ts.lining_material_product_id,
           ts.variant_drives_lining,
           coalesce(ts.has_straps, false)
             AND nullif(pg_catalog.btrim(ts.upper_material), '') IS NULL
             AND ts.upper_material_group_id IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM public.products active_upper
                WHERE active_upper.id = ts.upper_material_product_id
                  AND active_upper.active = true
             ) AS straps_follow_lining
      FROM public.technical_sheets ts
     WHERE ts.id = p_reference_id
  )
  SELECT CASE
    WHEN s.straps_follow_lining THEN coalesce(
      variant_lining_product.group_id,
      v.lining_material_group_id,
      CASE WHEN coalesce(s.variant_drives_lining, false)
        THEN v.main_material_group_id END,
      sheet_lining_product.group_id,
      sheet_lining_text_group.id,
      s.strap_base_group_id
    )
    ELSE coalesce(
      variant_upper_product.group_id,
      v.upper_material_group_id,
      variant_lining_product.group_id,
      v.lining_material_group_id,
      v.main_material_group_id,
      sheet_upper_product.group_id,
      s.upper_material_group_id,
      sheet_lining_text_group.id,
      s.strap_base_group_id,
      sheet_lining_product.group_id
    )
  END
  FROM s
  LEFT JOIN v ON true
  LEFT JOIN public.products variant_upper_product
    ON variant_upper_product.id = v.upper_material_product_id
   AND variant_upper_product.active = true
  LEFT JOIN public.products variant_lining_product
    ON variant_lining_product.id = v.lining_material_product_id
   AND variant_lining_product.active = true
  LEFT JOIN public.products sheet_upper_product
    ON sheet_upper_product.id = s.upper_material_product_id
   AND sheet_upper_product.active = true
  LEFT JOIN public.products sheet_lining_product
    ON sheet_lining_product.id = s.lining_material_product_id
   AND sheet_lining_product.active = true
  LEFT JOIN public.product_groups sheet_lining_text_group
    ON pg_catalog.lower(pg_catalog.btrim(sheet_lining_text_group.name))
      = nullif(pg_catalog.lower(pg_catalog.btrim(s.lining_material)), '');
$function$;

REVOKE ALL ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_has_reference_base boolean := false;
  v_lining_group_id uuid;
BEGIN
  IF NOT coalesce(NEW.has_straps, false)
     OR nullif(pg_catalog.btrim(NEW.upper_material), '') IS NOT NULL
     OR NEW.upper_material_group_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.products active_upper
        WHERE active_upper.id = NEW.upper_material_product_id
          AND active_upper.active = true
     ) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(coalesce(NEW.strap_colors, '[]'::jsonb)) = 'array'
            THEN coalesce(NEW.strap_colors, '[]'::jsonb)
          ELSE '[]'::jsonb
        END
      ) AS line(value)
     WHERE coalesce(
       nullif(pg_catalog.btrim(line.value ->> 'identity_basis'), ''),
       'reference_base'
     ) = 'reference_base'
  ) INTO v_has_reference_base;

  IF NOT v_has_reference_base THEN
    NEW.strap_base_group_id := NULL;
    RETURN NEW;
  END IF;

  SELECT coalesce(
    (SELECT p.group_id
       FROM public.products p
      WHERE p.id = NEW.lining_material_product_id
        AND p.active = true),
    (SELECT g.id
       FROM public.product_groups g
      WHERE pg_catalog.lower(pg_catalog.btrim(g.name))
        = nullif(pg_catalog.lower(pg_catalog.btrim(NEW.lining_material)), ''))
  ) INTO v_lining_group_id;

  NEW.strap_base_group_id := v_lining_group_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_validate_technical_sheet_strap_base_from_lining()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_has_reference_base boolean := false;
  v_expected_group_id uuid;
BEGIN
  IF NOT coalesce(NEW.has_straps, false)
     OR nullif(pg_catalog.btrim(NEW.upper_material), '') IS NOT NULL
     OR NEW.upper_material_group_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.products active_upper
        WHERE active_upper.id = NEW.upper_material_product_id
          AND active_upper.active = true
     ) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(coalesce(NEW.strap_colors, '[]'::jsonb)) = 'array'
            THEN coalesce(NEW.strap_colors, '[]'::jsonb)
          ELSE '[]'::jsonb
        END
      ) AS line(value)
     WHERE coalesce(
       nullif(pg_catalog.btrim(line.value ->> 'identity_basis'), ''),
       'reference_base'
     ) = 'reference_base'
  ) INTO v_has_reference_base;

  IF v_has_reference_base THEN
    SELECT coalesce(
      (SELECT p.group_id
         FROM public.products p
        WHERE p.id = NEW.lining_material_product_id
          AND p.active = true),
      (SELECT g.id
         FROM public.product_groups g
        WHERE pg_catalog.lower(pg_catalog.btrim(g.name))
          = nullif(pg_catalog.lower(pg_catalog.btrim(NEW.lining_material)), ''))
    ) INTO v_expected_group_id;
  ELSE
    v_expected_group_id := NULL;
  END IF;

  IF NEW.strap_base_group_id IS DISTINCT FROM v_expected_group_id THEN
    RAISE EXCEPTION
      'A napa-base das tiras deve ser o mesmo grupo da Forracao nesta ficha sem cabedal';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_sync_technical_sheet_strap_base_from_lining()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_validate_technical_sheet_strap_base_from_lining()
  FROM PUBLIC, anon, authenticated, service_role;

-- Alterar a atividade/grupo de um produto pinado muda a resolução. Repassar a
-- ficha pelo writer derivado evita deixar `strap_base_group_id` materializado
-- no grupo antigo; o resolver também recalcula o fallback textual em leitura.
CREATE OR REPLACE FUNCTION public.tg_refresh_sheet_material_pins_after_product_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.active IS NOT DISTINCT FROM NEW.active
     AND OLD.group_id IS NOT DISTINCT FROM NEW.group_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.technical_sheets ts
     SET upper_material_product_id = ts.upper_material_product_id,
         lining_material_product_id = ts.lining_material_product_id
   WHERE ts.upper_material_product_id = NEW.id
      OR ts.lining_material_product_id = NEW.id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_sheet_material_pins_after_product_change
  ON public.products;
CREATE TRIGGER trg_refresh_sheet_material_pins_after_product_change
AFTER UPDATE OF active, group_id ON public.products
FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_sheet_material_pins_after_product_change();

REVOKE ALL ON FUNCTION public.tg_refresh_sheet_material_pins_after_product_change()
  FROM PUBLIC, anon, authenticated, service_role;

-- Consumidores derivados não podem tratar a sentinela `color_mismatch` como
-- demanda real do SKU fallback. Patch por âncora sobre a definição canônica
-- evita copiar milhares de linhas e falha se qualquer função mudar de forma
-- incompatível antes do deploy.
DO $patch_cost_color_mismatch$
DECLARE
  v_definition text;
  v_anchor text := 'SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = (v_line ->> ''product_id'')::uuid;';
  v_replacement text := E'IF coalesce(v_line ->> ''matched_by'', '''') = ''color_mismatch'' THEN\n      v_warnings := array_append(\n        v_warnings,\n        ''material_color_not_registered:'' || coalesce(v_line ->> ''component'', ''?'')\n          || '':'' || coalesce(v_color, ''?'')\n      );\n      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(\n        ''product_id'', v_line ->> ''product_id'',\n        ''product_name'', v_line ->> ''product_name'',\n        ''component'', v_line ->> ''component'',\n        ''required'', (v_line ->> ''required'')::numeric * v_qty_multiplier,\n        ''consumption_unit'', v_line ->> ''unit'',\n        ''subtotal'', 0,\n        ''resolution_warning'', ''color_mismatch'',\n        ''requested_color'', v_color\n      );\n      CONTINUE;\n    END IF;\n\n    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = (v_line ->> ''product_id'')::uuid;';
  v_occurrences integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'calculate_order_cost_item'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
       = 'p_sale_order_item_id uuid, p_persist boolean';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'calculate_order_cost_item(uuid,boolean) não encontrada.';
  END IF;
  IF pg_catalog.strpos(v_definition, '''resolution_warning'', ''color_mismatch''') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / nullif(pg_catalog.length(v_anchor), 0);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Âncora do guard color_mismatch no custeio mudou (ocorrências=%).',
      v_occurrences;
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);
END
$patch_cost_color_mismatch$;

DO $patch_mrp_color_mismatch$
DECLARE
  v_definition text;
  v_anchor text := '(line ->> ''required'')::numeric AS required,';
  v_replacement text := E'CASE WHEN coalesce(line ->> ''matched_by'', '''') = ''color_mismatch''\n             THEN 0::numeric\n             ELSE (line ->> ''required'')::numeric\n           END AS required,';
  v_warning_anchor text := '(line ->> ''conversion_warning'') AS conversion_warning,';
  v_warning_replacement text := E'CASE WHEN coalesce(line ->> ''matched_by'', '''') = ''color_mismatch''\n             THEN ''material_color_not_registered:''\n               || coalesce(line ->> ''component'', ''?'')\n               || '':'' || coalesce(line ->> ''color'', ''?'')\n             ELSE line ->> ''conversion_warning''\n           END AS conversion_warning,';
  v_occurrences integer;
  v_warning_occurrences integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_wave_material_needs_core'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
       = 'p_sale_order_ids uuid[], p_corte_start date, p_per_order boolean';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'get_wave_material_needs_core(uuid[],date,boolean) não encontrada.';
  END IF;
  IF pg_catalog.strpos(v_definition, '''material_color_not_registered:''') > 0 THEN
    RETURN;
  END IF;

  v_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / nullif(pg_catalog.length(v_anchor), 0);
  v_warning_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_warning_anchor, ''))
  ) / nullif(pg_catalog.length(v_warning_anchor), 0);
  IF v_occurrences <> 1 OR v_warning_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Âncora do guard color_mismatch no MRP mudou (required=%, warning=%).',
      v_occurrences,
      v_warning_occurrences;
  END IF;
  EXECUTE pg_catalog.replace(
    pg_catalog.replace(v_definition, v_anchor, v_replacement),
    v_warning_anchor,
    v_warning_replacement
  );
END
$patch_mrp_color_mismatch$;

-- O relatório/PDF canônico precisa manter a pendência visível, mas sem a
-- identidade nem a quantidade do SKU de outra cor. `product_id = NULL` mais
-- required=0 impede estoque/compra; conversion_warning mantém a linha na UI.
DO $patch_report_color_mismatch$
DECLARE
  v_definition text;
  v_anchor text := 'v_product_id := public.try_parse_uuid(v_line ->> ''product_id'');';
  v_replacement text := E'IF coalesce(v_line ->> ''matched_by'', '''') = ''color_mismatch'' THEN\n        v_line := v_line || pg_catalog.jsonb_build_object(\n          ''product_id'', NULL,\n          ''product_name'', coalesce(nullif(v_line ->> ''component'', ''''), ''Material'')\n            || '' sem SKU para '' || coalesce(nullif(v_scope.color, ''''), ''cor solicitada''),\n          ''color'', coalesce(nullif(v_scope.color, ''''), v_line ->> ''color''),\n          ''required'', 0,\n          ''available'', 0,\n          ''stock_ok'', false,\n          ''source'', ''unresolved'',\n          ''conversion_warning'', ''material_color_not_registered:''\n            || coalesce(v_line ->> ''component'', ''?'')\n            || '':'' || coalesce(nullif(v_scope.color, ''''), ''?''),\n          ''resolution_warning'', ''color_mismatch'',\n          ''requested_color'', v_scope.color\n        );\n      END IF;\n\n      v_product_id := public.try_parse_uuid(v_line ->> ''product_id'');';
  v_occurrences integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, '''resolution_warning'', ''color_mismatch''') > 0 THEN
    RETURN;
  END IF;
  v_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / nullif(pg_catalog.length(v_anchor), 0);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Âncora do guard color_mismatch no relatório canônico mudou (ocorrências=%).',
      v_occurrences;
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);
END
$patch_report_color_mismatch$;

-- O snapshot de materiais da terceirização também é só projeção: conserva a
-- linha/aviso para o operador, mas nunca envia o produto fallback nem demanda
-- positiva para a remessa.
DO $patch_outsource_color_mismatch$
DECLARE
  v_definition text;
  v_anchor text := 'v_required := COALESCE(NULLIF(v_line ->> ''required'', '''')::numeric, 0) * v_scale;';
  v_replacement text := E'IF coalesce(v_line ->> ''matched_by'', '''') = ''color_mismatch'' THEN\n      v_line := v_line || pg_catalog.jsonb_build_object(\n        ''product_id'', NULL,\n        ''product_name'', coalesce(nullif(v_component, ''''), ''Material'')\n          || '' sem SKU para '' || coalesce(nullif(v_order.color, ''''), ''cor solicitada''),\n        ''material'', coalesce(nullif(v_component, ''''), ''Material'')\n          || '' sem SKU para '' || coalesce(nullif(v_order.color, ''''), ''cor solicitada''),\n        ''color'', coalesce(nullif(v_order.color, ''''), v_line ->> ''color''),\n        ''required'', 0,\n        ''source'', ''unresolved'',\n        ''conversion_warning'', ''material_color_not_registered:''\n          || coalesce(nullif(v_component, ''''), ''?'')\n          || '':'' || coalesce(nullif(v_order.color, ''''), ''?''),\n        ''resolution_warning'', ''color_mismatch'',\n        ''requested_color'', v_order.color\n      );\n    END IF;\n\n    v_required := COALESCE(NULLIF(v_line ->> ''required'', '''')::numeric, 0) * v_scale;';
  v_output_anchor text := E'''source'', v_line ->> ''source'',\n        ''warnings'', v_item_warnings';
  v_output_replacement text := E'''source'', v_line ->> ''source'',\n        ''warnings'', v_item_warnings,\n        ''resolution_warning'', v_line ->> ''resolution_warning'',\n        ''requested_color'', v_line ->> ''requested_color''';
  v_occurrences integer;
  v_output_occurrences integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.calculate_outsource_material_requirements(uuid,numeric,text[])'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(
       v_definition,
       '''resolution_warning'', v_line ->> ''resolution_warning'''
     ) > 0 THEN
    RETURN;
  END IF;
  v_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
  ) / nullif(pg_catalog.length(v_anchor), 0);
  v_output_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_output_anchor, ''))
  ) / nullif(pg_catalog.length(v_output_anchor), 0);
  IF v_occurrences <> 1 OR v_output_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Âncoras do guard color_mismatch na terceirização mudaram (required=%, output=%).',
      v_occurrences,
      v_output_occurrences;
  END IF;
  EXECUTE pg_catalog.replace(
    pg_catalog.replace(v_definition, v_anchor, v_replacement),
    v_output_anchor,
    v_output_replacement
  );
END
$patch_outsource_color_mismatch$;

-- O badge legado não possui coluna de warning. A linha sentinela usa o mesmo
-- contrato já existente para tira sem consumo: product_id NULL, required=0 e
-- sufficient=false. Assim continua acionável e jamais gera OC automática.
DO $patch_availability_color_mismatch$
DECLARE
  v_definition text;
  v_array_anchor text := E'IF v_cons IS NOT NULL AND jsonb_typeof(v_cons) = ''array'' THEN\n        FOR v_spec IN';
  v_array_replacement text := E'IF v_cons IS NOT NULL AND jsonb_typeof(v_cons) = ''array'' THEN\n        FOR v_spec IN\n          SELECT\n                 coalesce(nullif(line.value ->> ''component'', ''''), ''Material'') AS component,\n                 coalesce(nullif(line.value ->> ''color'', ''''), nullif(p_color, ''''), ''?'') AS requested_color,\n                 pg_catalog.array_remove(\n                   pg_catalog.array_agg(DISTINCT public.try_parse_uuid(line.value ->> ''product_id'')),\n                   NULL\n                 ) AS fallback_pids\n            FROM jsonb_array_elements(v_cons) AS line(value)\n           WHERE coalesce(line.value ->> ''matched_by'', '''') = ''color_mismatch''\n             AND (line.value ->> ''component'') IN (\n               ''Cabedal'', ''Forração'', ''Palmilha'', ''Forração Palmilha'', ''Fachete''\n             )\n           GROUP BY\n                 coalesce(nullif(line.value ->> ''component'', ''''), ''Material''),\n                 coalesce(nullif(line.value ->> ''color'', ''''), nullif(p_color, ''''), ''?'')\n        LOOP\n          v_emitted := v_emitted || coalesce(v_spec.fallback_pids, ARRAY[]::uuid[]);\n          product_id := NULL;\n          product_name := v_spec.component || '' sem SKU para '' || v_spec.requested_color;\n          required := 0;\n          available := 0;\n          sufficient := false;\n          RETURN NEXT;\n        END LOOP;\n\n        FOR v_spec IN';
  v_filter_anchor text := 'AND (l ->> ''conversion_warning'') IS NULL';
  v_filter_replacement text := E'AND (l ->> ''conversion_warning'') IS NULL\n             AND coalesce(l ->> ''matched_by'', '''') <> ''color_mismatch''';
  v_upper_anchor text := E'SELECT * INTO v_resolved FROM public.resolve_upper_material_for_variant(\n          p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);\n        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN';
  v_upper_replacement text := E'SELECT * INTO v_resolved FROM public.resolve_upper_material_for_variant(\n          p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);\n        IF coalesce(v_resolved.matched_by, '''') = ''color_mismatch'' THEN\n          IF v_resolved.product_id IS NOT NULL\n             AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN\n            v_emitted := array_append(v_emitted, v_resolved.product_id);\n          END IF;\n          product_id := NULL;\n          product_name := ''Cabedal sem SKU para '' || coalesce(nullif(p_color, ''''), ''cor solicitada'');\n          required := 0;\n          available := 0;\n          sufficient := false;\n          RETURN NEXT;\n        ELSIF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN';
  v_lining_anchor text := E'SELECT * INTO v_resolved FROM public.resolve_lining_material_for_variant(\n          p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);\n        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN';
  v_lining_replacement text := E'SELECT * INTO v_resolved FROM public.resolve_lining_material_for_variant(\n          p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);\n        IF coalesce(v_resolved.matched_by, '''') = ''color_mismatch'' THEN\n          IF v_resolved.product_id IS NOT NULL\n             AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN\n            v_emitted := array_append(v_emitted, v_resolved.product_id);\n          END IF;\n          product_id := NULL;\n          product_name := ''Forração sem SKU para '' || coalesce(nullif(p_color, ''''), ''cor solicitada'');\n          required := 0;\n          available := 0;\n          sufficient := false;\n          RETURN NEXT;\n        ELSIF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN';
  v_insole_anchor text := E'SELECT * INTO v_resolved FROM public.resolve_insole_material_for_variant(\n          p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);\n        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN';
  v_insole_replacement text := E'SELECT * INTO v_resolved FROM public.resolve_insole_material_for_variant(\n          p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);\n        IF coalesce(v_resolved.matched_by, '''') = ''color_mismatch'' THEN\n          IF v_resolved.product_id IS NOT NULL\n             AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN\n            v_emitted := array_append(v_emitted, v_resolved.product_id);\n          END IF;\n          product_id := NULL;\n          product_name := ''Palmilha sem SKU para '' || coalesce(nullif(v_palmilha_color, ''''), ''cor solicitada'');\n          required := 0;\n          available := 0;\n          sufficient := false;\n          RETURN NEXT;\n        ELSIF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN';
  v_array_occurrences integer;
  v_filter_occurrences integer;
  v_upper_occurrences integer;
  v_lining_occurrences integer;
  v_insole_occurrences integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'Cabedal sem SKU para') > 0
     AND pg_catalog.strpos(v_definition, 'Forração sem SKU para') > 0
     AND pg_catalog.strpos(v_definition, 'Palmilha sem SKU para') > 0
     AND pg_catalog.strpos(v_definition, 'fallback_pid') > 0 THEN
    RETURN;
  END IF;
  v_array_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_array_anchor, ''))
  ) / nullif(pg_catalog.length(v_array_anchor), 0);
  v_filter_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_filter_anchor, ''))
  ) / nullif(pg_catalog.length(v_filter_anchor), 0);
  v_upper_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_upper_anchor, ''))
  ) / nullif(pg_catalog.length(v_upper_anchor), 0);
  v_lining_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_lining_anchor, ''))
  ) / nullif(pg_catalog.length(v_lining_anchor), 0);
  v_insole_occurrences := (
    pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_insole_anchor, ''))
  ) / nullif(pg_catalog.length(v_insole_anchor), 0);
  IF v_array_occurrences <> 1 OR v_filter_occurrences <> 1
     OR v_upper_occurrences <> 1 OR v_lining_occurrences <> 1
     OR v_insole_occurrences <> 1 THEN
    RAISE EXCEPTION
      'Âncoras do guard color_mismatch na disponibilidade mudaram (array=%, filtro=%, upper=%, lining=%, insole=%).',
      v_array_occurrences,
      v_filter_occurrences,
      v_upper_occurrences,
      v_lining_occurrences,
      v_insole_occurrences;
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_array_anchor, v_array_replacement);
  v_definition := pg_catalog.replace(v_definition, v_filter_anchor, v_filter_replacement);
  v_definition := pg_catalog.replace(v_definition, v_upper_anchor, v_upper_replacement);
  v_definition := pg_catalog.replace(v_definition, v_lining_anchor, v_lining_replacement);
  v_definition := pg_catalog.replace(v_definition, v_insole_anchor, v_insole_replacement);
  EXECUTE v_definition;
END
$patch_availability_color_mismatch$;

-- Uma cor ausente não é "estoque zero": não existe produto correto para
-- comprar/reservar. Todas as cinco entradas autenticadas de criação de onda
-- recusam essa pendência antes de qualquer INSERT, mesmo que o cliente ignore
-- o preview.
DO $patch_wave_color_mismatch$
DECLARE
  v_proc record;
  v_definition text;
  v_anchor text;
  v_ids_expression text;
  v_guard text;
  v_seen integer := 0;
BEGIN
  FOR v_proc IN
    SELECT p.oid,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (
         (p.proname = 'create_production_wave'
          AND pg_catalog.pg_get_function_identity_arguments(p.oid) IN (
            'p_sale_order_ids uuid[], p_week_start date, p_start_mode text',
            'p_week_start date, p_sale_order_ids uuid[]'
          ))
         OR (p.proname IN (
              'create_solo_wave',
              'create_wave_from_sale_order',
              'auto_create_wave_from_sale_order'
            )
          AND pg_catalog.pg_get_function_identity_arguments(p.oid)
            = 'p_sale_order_id uuid')
       )
  LOOP
    v_seen := v_seen + 1;
    v_definition := pg_catalog.pg_get_functiondef(v_proc.oid);
    IF pg_catalog.strpos(v_definition, 'material_color_not_registered:%') > 0 THEN
      CONTINUE;
    END IF;

    v_ids_expression := CASE
      WHEN v_proc.proname = 'create_production_wave' THEN 'p_sale_order_ids'
      ELSE 'ARRAY[p_sale_order_id]'
    END;
    v_guard := E'IF EXISTS (\n    SELECT 1\n      FROM public.get_wave_material_needs_core('
      || v_ids_expression
      || E', NULL::date) blocked_need\n     WHERE blocked_need.conversion_warning LIKE ''material_color_not_registered:%''\n  ) THEN\n    RAISE EXCEPTION ''Onda bloqueada: existe cor de material sem SKU cadastrado.''\n      USING ERRCODE = ''23514'';\n  END IF;\n\n  ';

    v_anchor := CASE
      WHEN v_proc.proname = 'create_production_wave'
       AND v_proc.args = 'p_sale_order_ids uuid[], p_week_start date, p_start_mode text'
        THEN 'v_week_start := COALESCE(p_week_start, date_trunc(''week'', CURRENT_DATE)::date);'
      WHEN v_proc.proname = 'create_production_wave'
       AND v_proc.args = 'p_week_start date, p_sale_order_ids uuid[]'
        THEN 'v_week_end := p_week_start + 6;'
      WHEN v_proc.proname = 'create_solo_wave'
        THEN 'v_week_start := date_trunc(''week'', current_date)::date;'
      WHEN v_proc.proname = 'create_wave_from_sale_order'
        THEN 'v_code       := ''PV-'' || COALESCE(v_order.order_number, p_sale_order_id::text);'
      WHEN v_proc.proname = 'auto_create_wave_from_sale_order'
        THEN 'v_iso_year := EXTRACT(ISOYEAR FROM COALESCE(v_so.earliest, CURRENT_DATE + 28));'
    END;
    IF v_anchor IS NULL
       OR (pg_catalog.length(v_definition)
          - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
            / pg_catalog.length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Âncora do guard de onda mudou em %(%).', v_proc.proname, v_proc.args;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_anchor, v_guard || v_anchor);
  END LOOP;

  IF v_seen <> 5 THEN
    RAISE EXCEPTION 'Esperadas 5 entradas de criação de onda; encontradas %.', v_seen;
  END IF;
END
$patch_wave_color_mismatch$;

-- O gate das OPs também preserva a pendência mesmo com needed_qty/shortage=0.
-- Ela não possui ETA: grava apenas o motivo bloqueante, sem inventar uma data.
CREATE OR REPLACE FUNCTION public.recompute_material_gate_for_sale_orders_impl_115(
  p_sale_order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_so uuid;
  v_max_lead integer;
  v_faltas integer;
  v_nomes text;
  v_pendencias integer;
  v_nomes_pendentes text;
  v_ready date;
  v_reason text;
  v_updated integer := 0;
  v_total integer := 0;
  v_travados integer := 0;
  v_detalhe jsonb := '[]'::jsonb;
BEGIN
  IF p_sale_order_ids IS NULL
     OR pg_catalog.array_length(p_sale_order_ids, 1) IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'sale_orders', 0,
      'orders_updated', 0,
      'travados', 0,
      'detalhe', '[]'::jsonb
    );
  END IF;

  FOREACH v_so IN ARRAY p_sale_order_ids
  LOOP
    SELECT
      coalesce(pg_catalog.max(n.supplier_lead_time_days)
        FILTER (WHERE n.shortage > 0), 0),
      pg_catalog.count(*) FILTER (WHERE n.shortage > 0),
      pg_catalog.string_agg(DISTINCT n.product_name, ', ')
        FILTER (WHERE n.shortage > 0),
      pg_catalog.count(*) FILTER (
        WHERE n.conversion_warning LIKE 'material_color_not_registered:%'
      ),
      pg_catalog.string_agg(
        DISTINCT n.product_name || coalesce(' (' || n.color || ')', ''),
        ', '
      ) FILTER (
        WHERE n.conversion_warning LIKE 'material_color_not_registered:%'
      )
      INTO v_max_lead, v_faltas, v_nomes, v_pendencias, v_nomes_pendentes
      FROM public.get_wave_material_needs_core(ARRAY[v_so], NULL::date) n
     WHERE n.shortage > 0
        OR n.conversion_warning LIKE 'material_color_not_registered:%';

    IF coalesce(v_pendencias, 0) > 0 THEN
      v_ready := NULL;
      v_reason := v_pendencias
        || ' material(is) com cor sem SKU cadastrado: '
        || pg_catalog.left(coalesce(v_nomes_pendentes, ''), 300);
      IF coalesce(v_faltas, 0) > 0 THEN
        v_reason := v_reason || '; ' || v_faltas || ' material(is) também em falta';
      END IF;
      v_travados := v_travados + 1;
    ELSIF coalesce(v_faltas, 0) > 0 AND v_max_lead > 0 THEN
      v_ready := public.add_business_days(CURRENT_DATE, v_max_lead)::date;
      v_reason := v_faltas || ' material(is) em falta (lead ' || v_max_lead || 'd): '
        || pg_catalog.left(coalesce(v_nomes, ''), 300);
      v_travados := v_travados + 1;
    ELSE
      v_ready := NULL;
      v_reason := NULL;
    END IF;

    UPDATE public.orders o
       SET material_ready_date = v_ready,
           material_gate_reason = v_reason,
           planned_start = greatest(
             coalesce(o.planned_start_capacity, o.planned_start),
             coalesce(
               v_ready,
               coalesce(o.planned_start_capacity, o.planned_start)
             )
           ),
           updated_at = pg_catalog.now()
     WHERE o.sale_order_id = v_so
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Finalizado', 'FINALIZADO', 'Faturado', 'Cancelada', 'Cancelado'
       )
       AND (
         o.material_ready_date IS DISTINCT FROM v_ready
         OR o.material_gate_reason IS DISTINCT FROM v_reason
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;

    v_detalhe := v_detalhe || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sale_order_id', v_so,
        'faltas', coalesce(v_faltas, 0),
        'pendencias_cadastrais', coalesce(v_pendencias, 0),
        'lead_days', coalesce(v_max_lead, 0),
        'ready_date', v_ready,
        'ops_updated', v_updated
      )
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'sale_orders', pg_catalog.array_length(p_sale_order_ids, 1),
    'orders_updated', v_total,
    'travados', v_travados,
    'detalhe', v_detalhe
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_material_gate_for_sale_orders_impl_115(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_order_material_gate(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_so uuid;
  v_faltas jsonb := '[]'::jsonb;
  v_max_lead integer := 0;
  v_n integer := 0;
  v_pendencias integer := 0;
  v_ready date;
  v_pior_eta date;
  v_sem_oc integer := 0;
BEGIN
  SELECT o.sale_order_id INTO v_so
    FROM public.orders o
   WHERE o.id = p_order_id;
  IF v_so IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'motivo', 'OP sem PV vinculado');
  END IF;

  SELECT
    coalesce(
      pg_catalog.jsonb_agg(x.linha ORDER BY x.bloqueio DESC, x.shortage DESC),
      '[]'::jsonb
    ),
    coalesce(pg_catalog.max(x.lead), 0),
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (WHERE x.bloqueio),
    pg_catalog.max(x.eta),
    pg_catalog.count(*) FILTER (WHERE NOT x.bloqueio AND x.eta IS NULL)
    INTO v_faltas, v_max_lead, v_n, v_pendencias, v_pior_eta, v_sem_oc
    FROM (
      SELECT
        n.shortage,
        n.conversion_warning LIKE 'material_color_not_registered:%' AS bloqueio,
        CASE WHEN n.shortage > 0 THEN n.supplier_lead_time_days ELSE 0 END AS lead,
        CASE WHEN n.shortage > 0
          AND coalesce(n.conversion_warning, '') NOT LIKE 'material_color_not_registered:%'
        THEN (
          SELECT pg_catalog.max(coalesce(po.promised_date, po.purchase_by_date))
            FROM public.purchase_orders po
            JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
           WHERE poi.product_id = n.product_id
             AND pg_catalog.lower(coalesce(po.status, '')) NOT IN (
               'cancelled', 'canceled', 'cancelado', 'cancelada',
               'received', 'recebido', 'completed', 'concluido', 'concluído'
             )
        ) END AS eta,
        pg_catalog.jsonb_build_object(
          'product_id', n.product_id,
          'product_name', n.product_name,
          'color', n.color,
          'unit', n.unit,
          'needed', pg_catalog.round(n.needed_qty, 3),
          'stock', pg_catalog.round(n.stock_qty, 3),
          'shortage', pg_catalog.round(n.shortage, 3),
          'lead_days', n.supplier_lead_time_days,
          'conversion_warning', n.conversion_warning
        ) AS linha
      FROM public.get_wave_material_needs_core(ARRAY[v_so], NULL::date) n
      WHERE n.shortage > 0
         OR n.conversion_warning LIKE 'material_color_not_registered:%'
    ) x;

  IF v_n = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'faltas', '[]'::jsonb,
      'ready_date', NULL
    );
  END IF;

  IF v_pendencias > 0 THEN
    v_ready := NULL;
  ELSE
    v_ready := public.add_business_days(
      CURRENT_DATE,
      greatest(v_max_lead, 0)
    )::date;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', false,
    'faltas', v_faltas,
    'faltas_count', v_n,
    'pendencias_cadastrais', v_pendencias,
    'sem_oc', v_sem_oc,
    'lead_days', v_max_lead,
    'ready_date', v_ready,
    'pior_eta_oc', v_pior_eta,
    'sale_order_id', v_so,
    'motivo', CASE WHEN v_pendencias > 0
      THEN 'Cor de material sem SKU cadastrado' ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.check_order_material_gate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_order_material_gate(uuid) TO authenticated;

-- O PV-00168 é o caso de diagnóstico autorizado para a transição. Ele já tinha
-- order_costs persistido com NAPA SOFT puro; por estar em Rascunho, o cron apenas
-- limpa dirty e não o recalcula. Regrava somente seus dois itens SP124, depois
-- que resolver e custeio já estão protegidos, sem tocar no legado PV-00162.
DO $refresh_pv00168_costs$
DECLARE
  v_sheet_id constant uuid := '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid;
  v_target_group_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158'::uuid;
  v_pure_napa_group_id constant uuid := 'a0c6dcee-c72f-4e66-8f69-47be847957d3'::uuid;
  v_composite_off_white_id constant uuid := '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid;
  v_composite_preto_id constant uuid := '32875560-24a4-4341-bb45-39a002a9b092'::uuid;
  v_pure_off_white_id constant uuid := 'f1b80c1e-4f99-466c-81a2-377548998b44'::uuid;
  v_pure_preto_id constant uuid := '3b063cbb-61f4-4702-8122-0d50a916f1a8'::uuid;
  v_pv_id uuid;
  v_status text;
  v_item record;
  v_result jsonb;
  v_cached_items integer;
  v_correct_items integer;
  v_legacy_items integer;
  v_recalculated integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_sheet_id
  ) THEN
    RETURN;
  END IF;

  SELECT so.id, so.status
    INTO v_pv_id, v_status
    FROM public.sale_orders so
   WHERE so.order_number = 'PV-00168'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'SP124: PV-00168 ausente; nenhum cache de custo para atualizar.';
    RETURN;
  END IF;
  IF v_status IS DISTINCT FROM 'Rascunho' THEN
    RAISE EXCEPTION 'SP124: PV-00168 saiu de Rascunho antes do recálculo de custos.'
      USING ERRCODE = '23514';
  END IF;

  IF (SELECT count(*) FROM public.sale_order_items soi
       WHERE soi.sale_order_id = v_pv_id
         AND soi.reference_id = v_sheet_id) <> 2
     OR (SELECT count(*) FROM public.sale_order_items soi
          WHERE soi.sale_order_id = v_pv_id
            AND soi.reference_id = v_sheet_id
            AND soi.material_variant_id IS NULL
            AND (
              (soi.color = 'OFF WHITE' AND soi.quantity = 420)
              OR (soi.color = 'PRETO' AND soi.quantity = 300)
            )) <> 2
     OR EXISTS (
       SELECT 1 FROM public.orders o WHERE o.sale_order_id = v_pv_id
     ) OR EXISTS (
       SELECT 1
         FROM public.technical_sheet_snapshots s
        WHERE s.sale_order_id = v_pv_id
          AND s.sheet_id = v_sheet_id
     ) THEN
    RAISE EXCEPTION 'SP124: PV-00168 deixou de ser um diagnóstico limpo; custo não recalculado.'
      USING ERRCODE = '23514';
  END IF;

  -- Idempotência fail-closed: só dois estados de cache são reconhecidos.
  -- Correto => no-op. Legado exato NAPA SOFT/cor => recálculo. Ausente,
  -- parcial ou misto exige revisão, em vez de sobrescrever evidência.
  WITH item_state AS (
    SELECT
      soi.id,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
      ) AS cabedal_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
          AND p.group_id = v_target_group_id
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN v_composite_off_white_id
            WHEN 'PRETO' THEN v_composite_preto_id
          END
          AND p.active = true
          AND pg_catalog.upper(pg_catalog.btrim(coalesce(p.color, '')))
            = pg_catalog.upper(pg_catalog.btrim(soi.color))
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS correct_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
          AND p.group_id = v_pure_napa_group_id
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN v_pure_off_white_id
            WHEN 'PRETO' THEN v_pure_preto_id
          END
          AND p.active = true
          AND pg_catalog.upper(pg_catalog.btrim(coalesce(p.color, '')))
            = pg_catalog.upper(pg_catalog.btrim(soi.color))
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS legacy_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
      ) AS forracao_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.group_id = v_pure_napa_group_id
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN v_pure_off_white_id
            WHEN 'PRETO' THEN v_pure_preto_id
          END
          AND p.active = true
          AND pg_catalog.upper(pg_catalog.btrim(coalesce(p.color, '')))
            = pg_catalog.upper(pg_catalog.btrim(soi.color))
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS pure_forracao_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.group_id = v_target_group_id
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN v_composite_off_white_id
            WHEN 'PRETO' THEN v_composite_preto_id
          END
      ) AS composite_forracao_lines
    FROM public.sale_order_items soi
    JOIN public.order_costs oc ON oc.sale_order_item_id = soi.id
    LEFT JOIN LATERAL pg_catalog.jsonb_array_elements(
      coalesce(oc.breakdown -> 'materials', '[]'::jsonb)
    ) line(value) ON true
    LEFT JOIN public.products p ON p.id = (line.value ->> 'product_id')::uuid
    WHERE soi.sale_order_id = v_pv_id
      AND soi.reference_id = v_sheet_id
    GROUP BY soi.id, soi.color
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE cabedal_lines = 1
        AND correct_lines = 1
        AND forracao_lines = 1
        AND pure_forracao_lines = 1
        AND composite_forracao_lines = 0
    )::integer,
    count(*) FILTER (
      WHERE cabedal_lines = 1
        AND legacy_lines = 1
        AND forracao_lines = 1
        AND pure_forracao_lines = 1
        AND composite_forracao_lines = 0
    )::integer
    INTO v_cached_items, v_correct_items, v_legacy_items
    FROM item_state;

  IF v_cached_items = 2 AND v_correct_items = 2 THEN
    RAISE NOTICE 'SP124: order_costs do PV-00168 já usa os dois SKUs compostos; no-op.';
    RETURN;
  END IF;
  IF v_cached_items <> 2 OR v_legacy_items <> 2 THEN
    RAISE EXCEPTION
      'SP124: cache do PV-00168 fora dos estados reconhecidos (itens=%, corretos=%, legados=%).',
      v_cached_items,
      v_correct_items,
      v_legacy_items
      USING ERRCODE = '23514';
  END IF;

  FOR v_item IN
    SELECT soi.id, soi.color, soi.quantity
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = v_pv_id
       AND soi.reference_id = v_sheet_id
       AND soi.material_variant_id IS NULL
       AND (
         (soi.color = 'OFF WHITE' AND soi.quantity = 420)
         OR (soi.color = 'PRETO' AND soi.quantity = 300)
       )
     ORDER BY soi.color
     FOR UPDATE
  LOOP
    v_result := public.calculate_order_cost_item(v_item.id, true);
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(
          coalesce(v_result -> 'warnings', '[]'::jsonb)
        ) warning(value)
       WHERE warning.value LIKE 'material_color_not_registered:%'
    ) THEN
      RAISE EXCEPTION 'SP124: custo do PV-00168/% permaneceu com cor sem SKU.', v_item.color
        USING ERRCODE = '23514';
    END IF;
    v_recalculated := v_recalculated + 1;
  END LOOP;

  IF v_recalculated <> 2 THEN
    RAISE EXCEPTION 'SP124: esperados 2 itens no recálculo do PV-00168; encontrados %.', v_recalculated
      USING ERRCODE = '23514';
  END IF;

  WITH item_state AS (
    SELECT
      soi.id,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
      ) AS cabedal_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
          AND p.group_id = v_target_group_id
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN v_composite_off_white_id
            WHEN 'PRETO' THEN v_composite_preto_id
          END
          AND p.active = true
          AND pg_catalog.upper(pg_catalog.btrim(coalesce(p.color, '')))
            = pg_catalog.upper(pg_catalog.btrim(soi.color))
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS correct_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
      ) AS forracao_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.group_id = v_pure_napa_group_id
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN v_pure_off_white_id
            WHEN 'PRETO' THEN v_pure_preto_id
          END
          AND p.active = true
          AND pg_catalog.upper(pg_catalog.btrim(coalesce(p.color, '')))
            = pg_catalog.upper(pg_catalog.btrim(soi.color))
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS pure_forracao_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.group_id = v_target_group_id
      ) AS composite_forracao_lines
    FROM public.sale_order_items soi
    JOIN public.order_costs oc ON oc.sale_order_item_id = soi.id
    LEFT JOIN LATERAL pg_catalog.jsonb_array_elements(
      coalesce(oc.breakdown -> 'materials', '[]'::jsonb)
    ) line(value) ON true
    LEFT JOIN public.products p ON p.id = (line.value ->> 'product_id')::uuid
    WHERE soi.sale_order_id = v_pv_id
      AND soi.reference_id = v_sheet_id
    GROUP BY soi.id, soi.color
  )
  SELECT count(*) FILTER (
    WHERE cabedal_lines = 1
      AND correct_lines = 1
      AND forracao_lines = 1
      AND pure_forracao_lines = 1
      AND composite_forracao_lines = 0
  )::integer
    INTO v_correct_items
    FROM item_state;
  IF v_correct_items <> 2 THEN
    RAISE EXCEPTION 'SP124: order_costs do PV-00168 não persistiu o Cabedal composto nos dois itens.'
      USING ERRCODE = '23514';
  END IF;
END
$refresh_pv00168_costs$;

-- =============================================================================
-- 5. Autoteste transacional da migration (sem alterar operação)
-- =============================================================================

DO $test$
DECLARE
  v_sheet_id constant uuid := '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid;
  v_target_group_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158'::uuid;
  v_pure_napa_group_id constant uuid := 'a0c6dcee-c72f-4e66-8f69-47be847957d3'::uuid;
  v_product_id uuid;
BEGIN
  PERFORM public.assert_all_composite_upper_variants_compatible();

  IF has_function_privilege(
       'anon',
       'public.resolve_upper_material_for_variant(uuid,text,text,numeric,uuid)',
       'EXECUTE'
     ) OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) acl
        WHERE n.nspname = 'public'
          AND p.proname = 'resolve_upper_material_for_variant'
          AND pg_catalog.pg_get_function_identity_arguments(p.oid)
            = 'p_variant_id uuid, p_group_name text, p_color text, p_required numeric, p_sheet_pin_product_id uuid'
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Autoteste: resolver de Cabedal ainda aberto para anon/PUBLIC.';
  END IF;

  IF position(
       '''resolution_warning'', ''color_mismatch'''
       IN pg_catalog.pg_get_functiondef(
         'public.calculate_order_cost_item(uuid,boolean)'::pg_catalog.regprocedure
       )
     ) = 0 THEN
    RAISE EXCEPTION 'Autoteste: custeio ainda aceita color_mismatch.';
  END IF;
  IF position(
       '''material_color_not_registered:'''
       IN pg_catalog.pg_get_functiondef(
         'public.get_wave_material_needs_core(uuid[],date,boolean)'::pg_catalog.regprocedure
       )
     ) = 0 THEN
    RAISE EXCEPTION 'Autoteste: MRP ainda aceita color_mismatch.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_sheet_id
  ) THEN
    RETURN;
  END IF;

  IF public.product_group_upper_structure_is_compatible(
    v_target_group_id,
    v_pure_napa_group_id
  ) THEN
    RAISE EXCEPTION 'Autoteste: NAPA SOFT puro foi aceito como Cabedal MASSABOX.';
  END IF;

  SELECT resolved.product_id
    INTO v_product_id
    FROM public.resolve_upper_material_for_variant(
      NULL,
      'NAPA SOFT + MASSABOX',
      'OFF WHITE',
      0,
      NULL
    ) resolved;
  IF v_product_id IS DISTINCT FROM '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid THEN
    RAISE EXCEPTION 'Autoteste: OFF WHITE composto resolveu produto incorreto (%).', v_product_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.resolve_upper_material_for_variant(
        NULL,
        'NAPA SOFT + MASSABOX',
        'LIMONCELLO',
        0,
        NULL
      ) resolved
     WHERE resolved.matched_by = 'color_mismatch'
  ) THEN
    RAISE EXCEPTION 'Autoteste: LIMONCELLO inexistente não virou pendência color_mismatch.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.resolve_upper_material_for_variant(
        NULL,
        'NAPA SOFT',
        'LIMONCELLO',
        0,
        NULL
      ) resolved
     WHERE resolved.matched_by = 'exact_color'
  ) THEN
    RAISE EXCEPTION 'Autoteste: proteção do composto alterou a resolução da NAPA SOFT pura.';
  END IF;
END
$test$;
