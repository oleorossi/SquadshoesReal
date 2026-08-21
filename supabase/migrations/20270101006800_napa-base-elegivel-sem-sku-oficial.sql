-- A napa-base elegível deixa de exigir SKU oficial já designado.
--
-- SINTOMA (PV novo da SR01, 21/08/2026): o card de tiras avisava
-- "Cadastro da tira interna incompleto em NAPA SUDANI · ROSADO — Nao existe
-- NAPA SUDANI ROSADO ativo no estoque". A ficha da SR01 declara NAPA SOFT, que
-- TEM ROSADO ativo. O aviso nomeava a napa errada porque
-- `technical_sheets.strap_base_group_id` estava pinado em NAPA SUDANI.
--
-- CAUSA: o drawer "Corrigir no estoque" e o writer
-- `resolve_technical_strap_context_from_sale_order` só aceitavam napa-base que
-- já tivesse linha ATIVA em `base_material_color_official_products`. Esse
-- registro é POR COR e é materializado pelo próprio save do PV
-- (`ensure_sale_order_internal_strap_intents`, "SKU unico e inequivoco") — ou
-- seja, uma família que nunca vendeu tira interna nunca ganha designação e por
-- isso nunca fica elegível. A regra era circular. Medido em 21/08/2026:
-- `base_material_color_official_products` só tinha NAPA SUDANI (COGUMELO e OFF
-- WHITE), então o seletor oferecia UMA opção — NAPA SUDANI — para qualquer
-- ficha. SR01 e SR02, ambas de NAPA SOFT, foram pinadas ali por falta de
-- alternativa (audit_logs de 20/08/2026).
--
-- CORREÇÃO: a elegibilidade passa a espelhar o que o writer realmente exige de
-- uma napa-base — largura útil (perfil vigente ou derivável do cadastro) e pelo
-- menos um SKU linear ativo que não seja tira acabada. A designação por cor
-- continua sendo materializada no save, não é pré-requisito. Com a regra nova
-- são 15 famílias elegíveis (eram 1).
--
-- Esta migration NÃO inventa rendimento, largura nem SKU: só deixa de esconder
-- napa que o cadastro já sustenta, e realinha o pin das fichas cujo material
-- declarado contradiz a napa pinada.

BEGIN;

-- Fonte única da regra de elegibilidade: o guard do writer e a lista do drawer
-- passam a chamar esta função, para não voltarem a divergir.
CREATE OR REPLACE FUNCTION public.strap_base_group_is_eligible(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.product_groups g
     WHERE g.id = p_group_id
       -- Família de tira ACABADA nunca é a napa que a origina.
       AND NOT coalesce(g.is_artisanal_strap, false)
       -- Largura útil: perfil vigente OU derivável do cadastro. Desde a
       -- 20270101006300 o save do PV materializa o perfil sozinho quando a
       -- largura é única e inequívoca, então exigir perfil PRONTO aqui
       -- rejeitaria napa que o próprio writer aceitaria.
       AND (
         EXISTS (
           SELECT 1 FROM public.base_material_width_profiles w
            WHERE w.base_group_id = g.id
              AND w.status = 'approved'
              AND w.valid_to IS NULL
         )
         OR public.resolve_base_group_usable_width_mm(g.id) IS NOT NULL
       )
       -- É deste SKU linear que sai o produto oficial da cor, designado pelo
       -- writer no primeiro PV. Sem nenhum, não há napa para cortar tira.
       AND EXISTS (
         SELECT 1
           FROM public.products p
          WHERE p.group_id = g.id
            AND p.active
            AND p.unit = 'm'
            AND NOT EXISTS (
              SELECT 1 FROM public.artisanal_strap_variants v
               WHERE v.finished_product_id = p.id
            )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.strap_base_group_is_eligible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strap_base_group_is_eligible(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.strap_base_group_is_eligible(uuid) IS
  'Napa-base aceitável para linha reference_base: largura útil (perfil vigente ou derivável) + SKU linear ativo que não seja tira acabada. Designação oficial por cor NÃO é pré-requisito — o save do PV a materializa.';

-- O drawer do PV precisa oferecer exatamente o conjunto que o writer aceita.
-- Derivar isso no cliente é impossível: a largura derivável mora em
-- component_sheets, que o catálogo não carrega.
CREATE OR REPLACE FUNCTION public.list_strap_base_group_candidates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Somente usuario aprovado pode consultar as napas-base';
  END IF;

  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', candidate.id,
             'name', candidate.name,
             'usable_width_mm', candidate.usable_width_mm,
             'has_approved_width_profile', candidate.has_approved_width_profile,
             'linear_sku_count', candidate.linear_sku_count
           ) ORDER BY candidate.name, candidate.id
         ), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT g.id,
             g.name,
             public.resolve_base_group_usable_width_mm(g.id) AS usable_width_mm,
             EXISTS (
               SELECT 1 FROM public.base_material_width_profiles w
                WHERE w.base_group_id = g.id
                  AND w.status = 'approved'
                  AND w.valid_to IS NULL
             ) AS has_approved_width_profile,
             (
               SELECT count(*)
                 FROM public.products p
                WHERE p.group_id = g.id
                  AND p.active
                  AND p.unit = 'm'
                  AND NOT EXISTS (
                    SELECT 1 FROM public.artisanal_strap_variants v
                     WHERE v.finished_product_id = p.id
                  )
             ) AS linear_sku_count
        FROM public.product_groups g
       WHERE public.strap_base_group_is_eligible(g.id)
    ) candidate;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_strap_base_group_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_strap_base_group_candidates()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_strap_base_group_candidates() IS
  'Napas-base que o writer do PV aceita hoje, com a largura e a contagem de SKUs lineares que sustentam cada uma. Espelha strap_base_group_is_eligible.';


-- Writer do drawer: mesma assinatura, mesmo corpo da 20270101006200, com a
-- guarda de elegibilidade trocada pela regra canônica acima.
CREATE OR REPLACE FUNCTION public.resolve_technical_strap_context_from_sale_order(
  p_reference_id uuid,
  p_base_group_id uuid,
  p_lines jsonb,
  p_reason text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_lines jsonb;
  v_choice jsonb;
  v_line jsonb;
  v_map_id uuid;
  v_line_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_existing_measure_id uuid;
  v_existing_type_id uuid;
  v_ordinal integer;
  v_reason text := public.require_strap_change_reason(p_reason);
  v_expected_count integer;
  v_requires_reference_base boolean := false;
  v_effective_base_group_id uuid;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  -- Serializa a guarda dos snapshots com os writers de PV. Sem este lock, um
  -- item Aprovado/Em Produção poderia nascer ou mudar depois da checagem abaixo
  -- e antes do helper legado, que então propagaria UUID/medida ao fato já
  -- comprometido. A ordem coarse -> ficha também é compatível com os triggers
  -- de PV publicados em 05500.
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));

  IF coalesce(jsonb_typeof(p_lines), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Informe a medida canonica de cada linha de tira';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Informe a medida canonica de cada linha de tira';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica inexistente'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_sheet.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'A ficha mudou desde a abertura do Estoque; recarregue o pedido antes de confirmar'
      USING ERRCODE = '40001';
  END IF;

  v_lines := CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
    THEN v_sheet.strap_colors ELSE '[]'::jsonb END;
  v_expected_count := jsonb_array_length(v_lines);

  -- Ausência legada de identity_basis continua conservadoramente equivalente
  -- a reference_base. Só a identidade finished_product_group explicitamente
  -- persistida pode dispensar a napa-base.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_lines) entry
     WHERE coalesce(nullif(entry ->> 'identity_basis', ''), 'reference_base')
       NOT IN ('reference_base', 'finished_product_group')
  ) THEN
    RAISE EXCEPTION 'Linha tecnica possui identity_basis invalido';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_lines) entry
     WHERE coalesce(nullif(entry ->> 'identity_basis', ''), 'reference_base')
       = 'reference_base'
  ) INTO v_requires_reference_base;

  IF v_requires_reference_base THEN
    -- Antes exigia produto oficial ATIVO da família — registro por cor que o
    -- próprio save materializa. Com isso só NAPA SUDANI era selecionável e as
    -- fichas de NAPA SOFT (SR01/SR02) foram pinadas na napa errada.
    IF p_base_group_id IS NULL
       OR NOT public.strap_base_group_is_eligible(p_base_group_id) THEN
      RAISE EXCEPTION 'Napa-base sem largura util cadastrada ou sem SKU linear ativo no estoque';
    END IF;
    v_effective_base_group_id := p_base_group_id;
  ELSE
    -- Compatibilidade de rollout: um frontend antigo ainda pode enviar a napa
    -- selecionada. Para uma ficha all-finished ela é ignorada e removida, nunca
    -- validada nem persistida. O fato fica explícito no audit log abaixo.
    v_effective_base_group_id := NULL;
  END IF;

  IF jsonb_array_length(p_lines) <> v_expected_count THEN
    RAISE EXCEPTION 'Confirme todas as % linhas de tira da ficha', v_expected_count;
  END IF;
  IF (
    SELECT count(DISTINCT (entry ->> 'ordinal')::integer)
      FROM jsonb_array_elements(p_lines) entry
  ) <> v_expected_count THEN
    RAISE EXCEPTION 'Cada linha de tira deve aparecer exatamente uma vez';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);

  FOR v_choice IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_ordinal := (v_choice ->> 'ordinal')::integer;
      v_measure_id := (v_choice ->> 'measure_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Ordinal ou UUID de medida invalido';
    END;
    IF v_ordinal < 0 OR v_ordinal >= v_expected_count THEN
      RAISE EXCEPTION 'Ordinal de linha fora da ficha: %', v_ordinal;
    END IF;
    SELECT m.strap_type_id INTO v_strap_type_id
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE m.id = v_measure_id AND m.active AND t.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Medida/familia canonica inexistente ou inativa';
    END IF;

    SELECT ts.strap_colors -> v_ordinal INTO v_line
      FROM public.technical_sheets ts WHERE ts.id = p_reference_id;
    IF v_line IS NULL THEN RAISE EXCEPTION 'Linha tecnica inexistente'; END IF;
    v_line_id := NULL;

    -- UUID estável com medida ausente é uma migração parcial recuperável, não
    -- uma identidade completa. Reaproveita o UUID, cria/valida seu mapa e usa
    -- o writer canônico para persistir medida/tipo e propagar somente snapshots
    -- abertos que ainda correspondam exatamente ao conteúdo.
    IF nullif(v_line ->> 'technical_strap_line_id', '') IS NOT NULL THEN
      BEGIN
        v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
        v_existing_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
        v_existing_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Linha tecnica possui UUID, medida ou familia invalida';
      END;
      IF v_existing_measure_id IS NOT NULL AND v_existing_measure_id <> v_measure_id THEN
        RAISE EXCEPTION 'Linha canonica ja possui outra medida; crie uma nova linha para corrigir a identidade';
      END IF;
      IF v_existing_measure_id = v_measure_id
         AND v_existing_type_id = v_strap_type_id THEN
        CONTINUE;
      END IF;

      -- O helper legado propaga medida/UUID para snapshots abertos que casam
      -- por hash ou UUID. Em PV Aprovado/Em Producao isso reescreveria fato
      -- historico sem o fluxo administrativo de origem; bloqueia ANTES de criar
      -- ou alterar mapa. Linha ja canonica saiu pelo CONTINUE acima e pode
      -- apenas participar da limpeza de napa-base all-finished.
      IF EXISTS (
        SELECT 1
          FROM public.sale_order_items item
          JOIN public.sale_orders sale_order ON sale_order.id = item.sale_order_id
         WHERE item.reference_id = p_reference_id
           AND sale_order.status IN ('Aprovado', 'Em Produção')
           AND item.strap_colors -> v_ordinal IS NOT NULL
           AND (
             md5((item.strap_colors -> v_ordinal)::text) = md5(v_line::text)
             OR nullif(item.strap_colors -> v_ordinal ->> 'technical_strap_line_id', '')
                  = v_line_id::text
           )
      ) THEN
        RAISE EXCEPTION 'A linha possui snapshot em PV Aprovado/Em Producao; corrija pelo fluxo administrativo sem propagar a ficha';
      END IF;

      SELECT m.id INTO v_map_id
        FROM public.technical_strap_line_identity_map m
       WHERE m.technical_strap_line_id = v_line_id
       FOR UPDATE;
      IF FOUND THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.technical_strap_line_identity_map m
           WHERE m.id = v_map_id
             AND m.technical_sheet_id = p_reference_id
             AND m.legacy_path = 'strap_colors'
             AND m.legacy_ordinal = v_ordinal
             AND (m.measure_id IS NULL OR m.measure_id = v_measure_id)
        ) THEN
          RAISE EXCEPTION 'UUID tecnico ja pertence a outro caminho ou medida';
        END IF;
      ELSE
        INSERT INTO public.technical_strap_line_identity_map (
          technical_sheet_id, legacy_path, legacy_ordinal, content_hash,
          technical_strap_line_id, status, resolution_reason
        ) VALUES (
          p_reference_id, 'strap_colors', v_ordinal, md5(v_line::text),
          v_line_id, 'review_required', v_reason
        )
        RETURNING id INTO v_map_id;
      END IF;
      PERFORM public.resolve_technical_strap_line_migration(v_map_id, v_measure_id, v_reason);
      CONTINUE;
    END IF;

    -- Sem UUID na ficha, o helper propagaria qualquer snapshot com o mesmo
    -- conteudo/hash. A guarda vem antes de ensure_technical_strap_line_identity
    -- para a rejeicao manter mapa, ficha e PV integralmente intocados.
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items item
        JOIN public.sale_orders sale_order ON sale_order.id = item.sale_order_id
       WHERE item.reference_id = p_reference_id
         AND sale_order.status IN ('Aprovado', 'Em Produção')
         AND item.strap_colors -> v_ordinal IS NOT NULL
         AND md5((item.strap_colors -> v_ordinal)::text) = md5(v_line::text)
    ) THEN
      RAISE EXCEPTION 'A linha possui snapshot em PV Aprovado/Em Producao; corrija pelo fluxo administrativo sem propagar a ficha';
    END IF;

    v_line_id := public.ensure_technical_strap_line_identity(
      p_reference_id,
      'strap_colors',
      v_ordinal,
      v_line,
      v_reason
    );
    SELECT m.id INTO v_map_id
      FROM public.technical_strap_line_identity_map m
     WHERE m.technical_sheet_id = p_reference_id
       AND m.legacy_path = 'strap_colors'
       AND m.legacy_ordinal = v_ordinal
       AND m.technical_strap_line_id = v_line_id
     ORDER BY m.created_at DESC
     LIMIT 1;
    IF v_map_id IS NULL THEN RAISE EXCEPTION 'Mapa tecnico da linha nao foi criado'; END IF;
    PERFORM public.resolve_technical_strap_line_migration(v_map_id, v_measure_id, v_reason);
  END LOOP;

  UPDATE public.technical_sheets
     SET strap_base_group_id = v_effective_base_group_id,
         updated_at = now()
   WHERE id = p_reference_id
  RETURNING strap_colors INTO v_lines;

  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, new_data, success, created_at
  ) VALUES (
    auth.uid(),
    'resolve_technical_strap_context_from_sale_order',
    'technical_sheets',
    p_reference_id::text,
    jsonb_build_object(
      'base_group_id', v_effective_base_group_id,
      'requested_base_group_id', p_base_group_id,
      'requested_base_ignored',
        (NOT v_requires_reference_base AND p_base_group_id IS NOT NULL),
      'requires_reference_base', v_requires_reference_base,
      'lines', p_lines,
      'reason', v_reason
    ),
    true,
    now()
  );

  RETURN jsonb_build_object(
    'reference_id', p_reference_id,
    'base_group_id', v_effective_base_group_id,
    'requested_base_ignored',
      (NOT v_requires_reference_base AND p_base_group_id IS NOT NULL),
    'requires_reference_base', v_requires_reference_base,
    'strap_colors', v_lines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_technical_strap_context_from_sale_order(uuid, uuid, jsonb, text, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_technical_strap_context_from_sale_order(uuid, uuid, jsonb, text, timestamptz)
  TO authenticated;

COMMENT ON FUNCTION public.resolve_technical_strap_context_from_sale_order(uuid, uuid, jsonb, text, timestamptz) IS
  'Persiste medidas canônicas e a napa-base somente quando a ficha possui linha reference_base. A napa aceita é a que strap_base_group_is_eligible aprova (largura útil + SKU linear ativo); designação oficial por cor é materializada pelo save do PV, não exigida aqui. Fichas compostas apenas por finished_product_group ignoram/limpam base enviada por frontend antigo e auditam esse fato.';

-- Realinhamento do dado que a regra circular produziu: ficha cujo pin de
-- napa-base contradiz o material declarado nela própria. Só entra quem tem o
-- material declarado apenas como TEXTO (sem pin de produto por UUID, que teria
-- precedência no resolvedor), cujo nome resolve para UMA família elegível, e
-- que não tem PV comprometido — snapshot comprometido não se reescreve por
-- migration. Medido em 21/08/2026: SR01 e SR02 (declaram NAPA SOFT, pinadas em
-- NAPA SUDANI). S-039 e SP120 declaram NAPA SUDANI e ficam como estão.
DO $$
DECLARE
  v_row record;
  v_updated integer := 0;
  v_reason constant text :=
    'Migration 20270101006800: napa-base realinhada ao material declarado na ficha';
BEGIN
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  FOR v_row IN
    SELECT ts.id,
           ts.name,
           ts.strap_base_group_id AS old_group_id,
           pinned.name AS old_group_name,
           declared.id AS new_group_id,
           declared.name AS new_group_name
      FROM public.technical_sheets ts
      JOIN public.product_groups pinned ON pinned.id = ts.strap_base_group_id
      JOIN public.product_groups declared
        ON lower(btrim(declared.name)) = lower(btrim(coalesce(
             nullif(btrim(coalesce(ts.upper_material, '')), ''),
             ts.lining_material,
             '')))
     WHERE ts.upper_material_product_id IS NULL
       AND ts.lining_material_product_id IS NULL
       AND lower(btrim(declared.name)) <> ''
       AND declared.id <> ts.strap_base_group_id
       AND public.strap_base_group_is_eligible(declared.id)
       AND jsonb_typeof(ts.strap_colors) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(ts.strap_colors) entry
          WHERE coalesce(nullif(entry ->> 'identity_basis', ''), 'reference_base')
            = 'reference_base'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_items soi
           JOIN public.sale_orders so ON so.id = soi.sale_order_id
          WHERE soi.reference_id = ts.id
            AND so.status IN ('Aprovado', 'Em Produção')
       )
  LOOP
    UPDATE public.technical_sheets
       SET strap_base_group_id = v_row.new_group_id,
           updated_at = now()
     WHERE id = v_row.id;

    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, old_data, new_data, success, created_at
    ) VALUES (
      NULL,
      'realign_technical_sheet_strap_base_group',
      'technical_sheets',
      v_row.id::text,
      jsonb_build_object(
        'strap_base_group_id', v_row.old_group_id,
        'strap_base_group_name', v_row.old_group_name
      ),
      jsonb_build_object(
        'strap_base_group_id', v_row.new_group_id,
        'strap_base_group_name', v_row.new_group_name,
        'reference', v_row.name,
        'reason', v_reason
      ),
      true,
      now()
    );
    v_updated := v_updated + 1;
  END LOOP;

  RAISE NOTICE 'Fichas com napa-base realinhada: %', v_updated;
END;
$$;

COMMIT;
