-- Corrige a contenção e o trabalho N x M do drawer "Corrigir contexto das tiras".
--
-- Antes:
--   * toda chamada esperava indefinidamente pelo advisory lock global;
--   * cada linha chamava resolve_technical_strap_line_migration separadamente;
--   * a ficha era atualizada uma vez por linha + uma vez para a napa-base;
--   * cada item de PV aberto era relido, atualizado e auditado uma vez por linha;
--   * conflitos otimistas usavam SQLSTATE 40001, classificado como retryable.
--
-- Agora:
--   * o lock global e o row lock da ficha são fail-fast;
--   * conflitos devolvem PGRST custom HTTP 409 (não 40001);
--   * todas as escolhas são validadas e a guarda de fatos comprometidos roda
--     antes de qualquer criação/alteração de mapa;
--   * a ficha recebe no máximo um UPDATE, e cada item aberto no máximo um
--     UPDATE + um evento de auditoria por chamada;
--   * uma repetição já integralmente aplicada não escreve nem avança updated_at.

BEGIN;

-- O helper continua disponível para o fluxo administrativo/dry-run. Seu único
-- erro 40001 também precisava sair: esse endpoint tem chamada direta e, em caso
-- de drift, podia alimentar a mesma política de retry do gateway.
CREATE OR REPLACE FUNCTION public.resolve_technical_strap_line_migration(
  p_map_id uuid,
  p_measure_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '1500ms'
AS $resolve_single_line$
DECLARE
  v_map public.technical_strap_line_identity_map%ROWTYPE;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_sheet public.technical_sheets%ROWTYPE;
  v_reason text := public.require_strap_change_reason(p_reason);
  v_correlation_id uuid := gen_random_uuid();
  v_lines jsonb;
  v_line jsonb;
  v_enriched jsonb;
  v_item record;
  v_item_line jsonb;
  v_item_lines jsonb;
  v_before jsonb;
  v_after jsonb;
  v_all_resolved boolean;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  -- Usa o mesmo lock coarse do writer em lote antes de qualquer row lock.
  -- Sem isso o helper podia segurar o mapa enquanto o batch segurava a ficha,
  -- formando a ordem inversa mapa -> ficha / ficha -> mapa e um deadlock.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('strap-pv-auto-intent', 0)
  ) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'strap_pipeline_busy',
        'message', 'Outra alteracao de tiras ou pedido esta em andamento',
        'details', format('scope=global; map_id=%s', p_map_id),
        'hint', 'Aguarde a operacao atual terminar e tente novamente uma vez.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  SELECT * INTO v_map
    FROM public.technical_strap_line_identity_map
   WHERE id = p_map_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha tecnica mapeada inexistente';
  END IF;

  SELECT * INTO v_measure
    FROM public.artisanal_strap_measures
   WHERE id = p_measure_id
     AND active;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_types t
     WHERE t.id = v_measure.strap_type_id
       AND t.active
  ) THEN
    RAISE EXCEPTION 'Medida/familia canonica inexistente ou inativa';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets
   WHERE id = v_map.technical_sheet_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha tecnica do mapa inexistente';
  END IF;

  v_lines := CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
    THEN v_sheet.strap_colors ELSE '[]'::jsonb END;
  v_line := v_lines -> v_map.legacy_ordinal;

  -- Mantém a guarda conservadora, mas a expõe como conflito HTTP explícito.
  -- O MESSAGE e o DETAIL seguem o formato PGRST documentado pelo PostgREST.
  IF v_line IS NULL OR (
    md5(v_line::text) IS DISTINCT FROM v_map.content_hash
    AND nullif(v_line ->> 'technical_strap_line_id', '')
      IS DISTINCT FROM v_map.technical_strap_line_id::text
  ) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'technical_line_content_mismatch',
        'message',
          'Conteudo/caminho da linha tecnica mudou desde o dry-run; vinculacao nao aplicada',
        'details', jsonb_build_object(
          'map_id', v_map.id,
          'technical_sheet_id', v_map.technical_sheet_id,
          'legacy_ordinal', v_map.legacy_ordinal,
          'expected_hash', v_map.content_hash,
          'current_hash', CASE WHEN v_line IS NULL THEN NULL ELSE md5(v_line::text) END,
          'technical_strap_line_id', v_map.technical_strap_line_id
        )::text,
        'hint',
          'Reverta/conclua o cutover ativo e execute novo dry-run; nenhum mapa foi alterado.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  v_enriched := v_line || jsonb_build_object(
    'technical_strap_line_id', v_map.technical_strap_line_id,
    'measure_id', p_measure_id,
    'strap_type_id', v_measure.strap_type_id
  );
  v_before := jsonb_build_object('map', to_jsonb(v_map), 'technical_line', v_line);
  v_lines := jsonb_set(
    v_lines,
    ARRAY[v_map.legacy_ordinal::text],
    v_enriched,
    false
  );

  PERFORM set_config('app.strap_change_reason', v_reason, true);

  UPDATE public.technical_sheets
     SET strap_colors = v_lines,
         updated_at = now()
   WHERE id = v_sheet.id;

  UPDATE public.technical_strap_line_identity_map
     SET measure_id = p_measure_id,
         status = 'resolved',
         resolution_reason = v_reason,
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE id = v_map.id;

  -- Fecha somente a pendência original desta identidade. Pendências de
  -- divergência de PV/ficha permanecem abertas em entity_type próprio.
  UPDATE public.artisanal_strap_migration_review_items
     SET status = 'resolved',
         resolution = jsonb_build_object(
           'map_id', v_map.id,
           'technical_strap_line_id', v_map.technical_strap_line_id,
           'measure_id', p_measure_id,
           'reason', v_reason
         ),
         resolved_by = auth.uid(),
         resolved_at = now(),
         updated_at = now()
   WHERE status = 'review_required'
     AND entity_type IN (
       'technical_line',
       'legacy_technical_line',
       'technical_strap_line'
     )
     AND legacy_id IN (v_map.id::text, v_map.technical_strap_line_id::text);

  -- Mantido sem mudança funcional para chamadas unitárias do helper.
  FOR v_item IN
    SELECT i.*, sale_order.status AS sale_order_status
      FROM public.sale_order_items i
      JOIN public.sale_orders sale_order ON sale_order.id = i.sale_order_id
     WHERE i.reference_id = v_map.technical_sheet_id
       AND public.is_open_legacy_strap_sale_order_status(sale_order.status)
     ORDER BY i.id
     FOR UPDATE OF i
  LOOP
    v_item_lines := CASE WHEN jsonb_typeof(v_item.strap_colors) = 'array'
      THEN v_item.strap_colors ELSE '[]'::jsonb END;
    v_item_line := v_item_lines -> v_map.legacy_ordinal;

    IF v_item_line IS NULL OR (
      md5(v_item_line::text) IS DISTINCT FROM v_map.content_hash
      AND nullif(v_item_line ->> 'technical_strap_line_id', '')
        IS DISTINCT FROM v_map.technical_strap_line_id::text
    ) THEN
      v_before := to_jsonb(v_item);
      UPDATE public.sale_order_items
         SET strap_migration_status = 'review_required',
             strap_migration_reason =
               'Linha de tira do PV divergiu da ficha/dry-run; escolha explicita obrigatoria'
       WHERE id = v_item.id;

      INSERT INTO public.artisanal_strap_migration_review_items (
        entity_type,
        legacy_id,
        status,
        reason,
        candidates
      ) VALUES (
        'open_sale_order_item_technical_line',
        v_item.id::text || ':' || v_map.technical_strap_line_id::text,
        'review_required',
        'Snapshot do PV nao casa exatamente com ficha/caminho/hash',
        jsonb_build_object(
          'sale_order_id', v_item.sale_order_id,
          'sale_order_item_id', v_item.id,
          'map_id', v_map.id,
          'technical_strap_line_id', v_map.technical_strap_line_id,
          'legacy_ordinal', v_map.legacy_ordinal
        )
      )
      ON CONFLICT (entity_type, legacy_id) WHERE status = 'review_required'
      DO UPDATE SET
        reason = EXCLUDED.reason,
        candidates = EXCLUDED.candidates,
        updated_at = now();

      PERFORM public.log_artisanal_strap_migration_event(
        'sale_order_item',
        v_item.id,
        'update',
        v_before,
        (SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id = v_item.id),
        v_reason,
        v_correlation_id
      );
      CONTINUE;
    END IF;

    v_before := to_jsonb(v_item);
    v_item_lines := jsonb_set(
      v_item_lines,
      ARRAY[v_map.legacy_ordinal::text],
      v_item_line || jsonb_build_object(
        'technical_strap_line_id', v_map.technical_strap_line_id,
        'measure_id', p_measure_id,
        'strap_type_id', v_measure.strap_type_id
      ),
      false
    );

    SELECT NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(v_item_lines) entry
       WHERE nullif(entry ->> 'technical_strap_line_id', '') IS NULL
          OR NOT EXISTS (
            SELECT 1
              FROM public.technical_strap_line_identity_map map
             WHERE map.technical_strap_line_id::text =
                   entry ->> 'technical_strap_line_id'
               AND map.status = 'resolved'
          )
    ) INTO v_all_resolved;

    UPDATE public.sale_order_items
       SET strap_colors = v_item_lines,
           strap_migration_status = CASE WHEN v_all_resolved THEN 'resolved'
             ELSE strap_migration_status END,
           strap_migration_reason = CASE WHEN v_all_resolved
             THEN 'Todas as linhas tecnicas possuem UUID canonico persistido'
             ELSE strap_migration_reason END
     WHERE id = v_item.id;

    PERFORM public.log_artisanal_strap_migration_event(
      'sale_order_item',
      v_item.id,
      'update',
      v_before,
      (SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id = v_item.id),
      v_reason,
      v_correlation_id
    );
  END LOOP;

  v_after := jsonb_build_object(
    'map', (
      SELECT to_jsonb(map)
        FROM public.technical_strap_line_identity_map map
       WHERE map.id = v_map.id
    ),
    'technical_line', v_enriched
  );
  PERFORM public.log_artisanal_strap_migration_event(
    'technical_strap_line',
    v_map.id,
    'update',
    jsonb_build_object(
      'map', to_jsonb(v_map),
      'technical_line', v_line
    ),
    v_after,
    v_reason,
    v_correlation_id
  );

  RETURN v_map.technical_strap_line_id;
END;
$resolve_single_line$;

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
SET lock_timeout = '1500ms'
AS $resolve_context_batch$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_map public.technical_strap_line_identity_map%ROWTYPE;
  v_lines jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_resolutions jsonb := '[]'::jsonb;
  v_choice jsonb;
  v_candidate jsonb;
  v_resolution jsonb;
  v_line jsonb;
  v_enriched jsonb;
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
  v_correlation_id uuid := gen_random_uuid();
  v_item record;
  v_item_before jsonb;
  v_item_lines jsonb;
  v_item_line jsonb;
  v_item_had_match boolean;
  v_item_has_divergence boolean;
  v_all_resolved boolean;
  v_after jsonb;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  -- Entrada inválida não deve disputar o lock global.
  IF coalesce(jsonb_typeof(p_lines), 'null') <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Informe a medida canonica de cada linha de tira';
  END IF;

  -- Pre-check sem lock: contém clientes que insistem num snapshot já obsoleto.
  -- A mesma condição volta a ser verificada sob lock abaixo.
  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets sheet
     WHERE sheet.id = p_reference_id
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.technical_sheets sheet
     WHERE sheet.id = p_reference_id
       AND p_expected_updated_at IS NOT NULL
       AND sheet.updated_at IS NOT DISTINCT FROM p_expected_updated_at
  ) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'technical_sheet_stale',
        'message',
          'A ficha mudou desde a abertura do Estoque; recarregue o pedido antes de confirmar',
        'details', format(
          'reference_id=%s; expected_updated_at=%s',
          p_reference_id,
          coalesce(p_expected_updated_at::text, 'null')
        ),
        'hint', 'Recarregue o pedido e confirme novamente uma única vez.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  -- O mesmo lock coarse continua protegendo a janela contra writers de PV,
  -- mas uma segunda chamada não entra em fila: ela recebe conflito imediato.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('strap-pv-auto-intent', 0)
  ) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'strap_pipeline_busy',
        'message', 'Outra alteracao de tiras ou pedido esta em andamento',
        'details', format('scope=global; reference_id=%s', p_reference_id),
        'hint', 'Aguarde a operacao atual terminar, recarregue o pedido e tente uma vez.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  -- NOWAIT cobre editores antigos que eventualmente travem a ficha sem usar o
  -- advisory lock global. Assim não sobra outro ponto de espera indefinida.
  BEGIN
    SELECT * INTO v_sheet
      FROM public.technical_sheets sheet
     WHERE sheet.id = p_reference_id
     FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE SQLSTATE 'PGRST' USING
        MESSAGE = jsonb_build_object(
          'code', 'strap_pipeline_busy',
          'message', 'A ficha tecnica esta sendo alterada por outra operacao',
          'details', format(
            'scope=technical_sheet; reference_id=%s',
            p_reference_id
          ),
          'hint', 'Recarregue o pedido depois que a alteracao atual terminar.'
        )::text,
        DETAIL = '{"status":409}';
  END;

  IF v_sheet.id IS NULL THEN
    RAISE EXCEPTION 'Ficha tecnica inexistente';
  END IF;

  -- Guarda definitiva: fecha a janela entre o pre-check e a aquisição do lock.
  IF p_expected_updated_at IS NULL
     OR v_sheet.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'technical_sheet_stale',
        'message',
          'A ficha mudou desde a abertura do Estoque; recarregue o pedido antes de confirmar',
        'details', format(
          'reference_id=%s; expected_updated_at=%s; current_updated_at=%s',
          p_reference_id,
          coalesce(p_expected_updated_at::text, 'null'),
          coalesce(v_sheet.updated_at::text, 'null')
        ),
        'hint', 'Recarregue o pedido e confirme novamente uma única vez.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  v_lines := CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
    THEN v_sheet.strap_colors ELSE '[]'::jsonb END;
  v_expected_count := jsonb_array_length(v_lines);

  -- Ausência legada de identity_basis continua conservadoramente equivalente
  -- a reference_base.
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
    IF p_base_group_id IS NULL
       OR NOT public.strap_base_group_is_eligible(p_base_group_id) THEN
      RAISE EXCEPTION
        'Napa-base sem largura util cadastrada ou sem SKU linear ativo no estoque';
    END IF;
    v_effective_base_group_id := p_base_group_id;
  ELSE
    -- Frontend antigo pode continuar enviando napa para ficha all-finished;
    -- ela é ignorada e removida como no writer anterior.
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

  -- Fase 1: valida tudo e monta candidatos somente em memória. Não cria mapa,
  -- não fecha review, não toca ficha e não propaga snapshot nesta fase.
  FOR v_choice IN
    SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_ordinal := (v_choice ->> 'ordinal')::integer;
      v_measure_id := (v_choice ->> 'measure_id')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Ordinal ou UUID de medida invalido';
    END;

    IF v_ordinal < 0 OR v_ordinal >= v_expected_count THEN
      RAISE EXCEPTION 'Ordinal de linha fora da ficha: %', v_ordinal;
    END IF;

    SELECT measure.strap_type_id INTO v_strap_type_id
      FROM public.artisanal_strap_measures measure
      JOIN public.artisanal_strap_types strap_type
        ON strap_type.id = measure.strap_type_id
     WHERE measure.id = v_measure_id
       AND measure.active
       AND strap_type.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Medida/familia canonica inexistente ou inativa';
    END IF;

    v_line := v_lines -> v_ordinal;
    IF v_line IS NULL THEN
      RAISE EXCEPTION 'Linha tecnica inexistente';
    END IF;

    v_line_id := NULL;
    v_existing_measure_id := NULL;
    v_existing_type_id := NULL;

    IF nullif(v_line ->> 'technical_strap_line_id', '') IS NOT NULL THEN
      BEGIN
        v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
        v_existing_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
        v_existing_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE EXCEPTION 'Linha tecnica possui UUID, medida ou familia invalida';
      END;

      IF v_existing_measure_id IS NOT NULL
         AND v_existing_measure_id <> v_measure_id THEN
        RAISE EXCEPTION
          'Linha canonica ja possui outra medida; crie uma nova linha para corrigir a identidade';
      END IF;

      -- Linha integralmente canônica não participa das escritas nem da guarda
      -- de propagação. Isso é a base do no-op idempotente abaixo.
      IF v_existing_measure_id = v_measure_id
         AND v_existing_type_id = v_strap_type_id THEN
        CONTINUE;
      END IF;
    END IF;

    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'ordinal', v_ordinal,
      'measure_id', v_measure_id,
      'strap_type_id', v_strap_type_id,
      'technical_strap_line_id', v_line_id,
      'content_hash', md5(v_line::text),
      'before_line', v_line
    ));
  END LOOP;

  -- Repetição com snapshot renovado: não gera trigger, auditoria ou novo
  -- updated_at. Se a resposta anterior se perdeu, o frontend primeiro atualiza
  -- a ficha ao receber technical_sheet_stale e então esta guarda conclui o retry.
  IF jsonb_array_length(v_candidates) = 0
     AND v_sheet.strap_base_group_id IS NOT DISTINCT FROM
         v_effective_base_group_id THEN
    RETURN jsonb_build_object(
      'reference_id', p_reference_id,
      'base_group_id', v_effective_base_group_id,
      'requested_base_ignored',
        (NOT v_requires_reference_base AND p_base_group_id IS NOT NULL),
      'requires_reference_base', v_requires_reference_base,
      'strap_colors', v_lines
    );
  END IF;

  -- Guarda set-based dos fatos comprometidos. É deliberadamente anterior a
  -- ensure/INSERT/UPDATE de mapa, e cobre todos os candidatos numa única busca.
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items item
      JOIN public.sale_orders sale_order ON sale_order.id = item.sale_order_id
      CROSS JOIN LATERAL jsonb_array_elements(v_candidates) candidate(value)
     WHERE item.reference_id = p_reference_id
       AND sale_order.status IN ('Aprovado', 'Em Produção')
       AND item.strap_colors -> ((candidate.value ->> 'ordinal')::integer)
           IS NOT NULL
       AND (
         md5((
           item.strap_colors -> ((candidate.value ->> 'ordinal')::integer)
         )::text) = candidate.value ->> 'content_hash'
         OR (
           nullif(candidate.value ->> 'technical_strap_line_id', '') IS NOT NULL
           AND nullif(
             item.strap_colors -> ((candidate.value ->> 'ordinal')::integer)
               ->> 'technical_strap_line_id',
             ''
           ) = candidate.value ->> 'technical_strap_line_id'
         )
       )
  ) THEN
    RAISE EXCEPTION
      'A linha possui snapshot em PV Aprovado/Em Producao; corrija pelo fluxo administrativo sem propagar a ficha';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);

  -- Fase 2: congela/valida os mapas. Todas as linhas e todos os fatos
  -- comprometidos já passaram pelas guardas; qualquer erro ainda é atômico.
  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(v_candidates)
  LOOP
    v_ordinal := (v_candidate ->> 'ordinal')::integer;
    v_measure_id := (v_candidate ->> 'measure_id')::uuid;
    v_strap_type_id := (v_candidate ->> 'strap_type_id')::uuid;
    v_line := v_candidate -> 'before_line';
    v_line_id := nullif(v_candidate ->> 'technical_strap_line_id', '')::uuid;

    IF v_line_id IS NOT NULL THEN
      SELECT * INTO v_map
        FROM public.technical_strap_line_identity_map map
       WHERE map.technical_strap_line_id = v_line_id
       FOR UPDATE;

      IF FOUND THEN
        IF v_map.technical_sheet_id <> p_reference_id
           OR v_map.legacy_path <> 'strap_colors'
           OR v_map.legacy_ordinal <> v_ordinal
           OR (
             v_map.measure_id IS NOT NULL
             AND v_map.measure_id <> v_measure_id
           ) THEN
          RAISE EXCEPTION 'UUID tecnico ja pertence a outro caminho ou medida';
        END IF;
      ELSE
        INSERT INTO public.technical_strap_line_identity_map (
          technical_sheet_id,
          legacy_path,
          legacy_ordinal,
          content_hash,
          technical_strap_line_id,
          status,
          resolution_reason
        ) VALUES (
          p_reference_id,
          'strap_colors',
          v_ordinal,
          v_candidate ->> 'content_hash',
          v_line_id,
          'review_required',
          v_reason
        )
        RETURNING * INTO v_map;
      END IF;
    ELSE
      v_line_id := public.ensure_technical_strap_line_identity(
        p_reference_id,
        'strap_colors',
        v_ordinal,
        v_line,
        v_reason
      );

      SELECT * INTO v_map
        FROM public.technical_strap_line_identity_map map
       WHERE map.technical_sheet_id = p_reference_id
         AND map.legacy_path = 'strap_colors'
         AND map.legacy_ordinal = v_ordinal
         AND map.technical_strap_line_id = v_line_id
       ORDER BY map.created_at DESC
       LIMIT 1
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Mapa tecnico da linha nao foi criado';
      END IF;
    END IF;

    v_map_id := v_map.id;
    v_enriched := v_line || jsonb_build_object(
      'technical_strap_line_id', v_line_id,
      'measure_id', v_measure_id,
      'strap_type_id', v_strap_type_id
    );
    v_lines := jsonb_set(
      v_lines,
      ARRAY[v_ordinal::text],
      v_enriched,
      false
    );

    v_resolutions := v_resolutions || jsonb_build_array(jsonb_build_object(
      'ordinal', v_ordinal,
      'map_id', v_map_id,
      'technical_strap_line_id', v_line_id,
      'measure_id', v_measure_id,
      'strap_type_id', v_strap_type_id,
      -- O helper unitário compara snapshots abertos com o hash congelado no
      -- mapa (ou com o UUID). Preserva essa semântica mesmo quando a linha da
      -- ficha já evoluiu, mas manteve a identidade estável.
      'content_hash', v_map.content_hash,
      'before_map', to_jsonb(v_map),
      'before_line', v_line,
      'after_line', v_enriched
    ));
  END LOOP;

  -- Resolve todos os mapas e suas reviews em duas escritas set-based.
  UPDATE public.technical_strap_line_identity_map map
     SET measure_id = (batch.value ->> 'measure_id')::uuid,
         status = 'resolved',
         resolution_reason = v_reason,
         resolved_by = auth.uid(),
         resolved_at = now()
    FROM jsonb_array_elements(v_resolutions) batch(value)
   WHERE map.id = (batch.value ->> 'map_id')::uuid;

  UPDATE public.artisanal_strap_migration_review_items review
     SET status = 'resolved',
         resolution = jsonb_build_object(
           'map_id', (batch.value ->> 'map_id')::uuid,
           'technical_strap_line_id',
             (batch.value ->> 'technical_strap_line_id')::uuid,
           'measure_id', (batch.value ->> 'measure_id')::uuid,
           'reason', v_reason
         ),
         resolved_by = auth.uid(),
         resolved_at = now(),
         updated_at = now()
    FROM jsonb_array_elements(v_resolutions) batch(value)
   WHERE review.status = 'review_required'
     AND review.entity_type IN (
       'technical_line',
       'legacy_technical_line',
       'technical_strap_line'
     )
     AND review.legacy_id IN (
       batch.value ->> 'map_id',
       batch.value ->> 'technical_strap_line_id'
     );

  -- Exatamente um UPDATE de technical_sheets por execução não-idempotente.
  -- No caminho somente-base, strap_colors fica fora do target list e não
  -- dispara seus triggers de validação/sincronização sem necessidade.
  IF jsonb_array_length(v_resolutions) > 0 THEN
    UPDATE public.technical_sheets
       SET strap_colors = v_lines,
           strap_base_group_id = v_effective_base_group_id,
           updated_at = now()
     WHERE id = p_reference_id
    RETURNING strap_colors INTO v_lines;
  ELSE
    UPDATE public.technical_sheets
       SET strap_base_group_id = v_effective_base_group_id,
           updated_at = now()
     WHERE id = p_reference_id
    RETURNING strap_colors INTO v_lines;
  END IF;

  -- Cada item aberto é bloqueado uma vez, avaliado contra todas as resoluções
  -- em memória e atualizado/auditado no máximo uma vez.
  IF jsonb_array_length(v_resolutions) > 0 THEN
    FOR v_item IN
      SELECT item.*, sale_order.status AS sale_order_status
        FROM public.sale_order_items item
        JOIN public.sale_orders sale_order ON sale_order.id = item.sale_order_id
       WHERE item.reference_id = p_reference_id
         AND public.is_open_legacy_strap_sale_order_status(sale_order.status)
       ORDER BY item.id
       FOR UPDATE OF item
    LOOP
      v_item_before := to_jsonb(v_item);
      v_item_lines := CASE WHEN jsonb_typeof(v_item.strap_colors) = 'array'
        THEN v_item.strap_colors ELSE '[]'::jsonb END;
      v_item_had_match := false;
      v_item_has_divergence := false;

      FOR v_resolution IN
        SELECT value FROM jsonb_array_elements(v_resolutions)
      LOOP
        v_ordinal := (v_resolution ->> 'ordinal')::integer;
        v_item_line := v_item_lines -> v_ordinal;

        IF v_item_line IS NULL OR (
          md5(v_item_line::text) IS DISTINCT FROM
            (v_resolution ->> 'content_hash')
          AND nullif(v_item_line ->> 'technical_strap_line_id', '')
            IS DISTINCT FROM
              (v_resolution ->> 'technical_strap_line_id')
        ) THEN
          v_item_has_divergence := true;

          INSERT INTO public.artisanal_strap_migration_review_items (
            entity_type,
            legacy_id,
            status,
            reason,
            candidates
          ) VALUES (
            'open_sale_order_item_technical_line',
            v_item.id::text || ':' ||
              (v_resolution ->> 'technical_strap_line_id'),
            'review_required',
            'Snapshot do PV nao casa exatamente com ficha/caminho/hash',
            jsonb_build_object(
              'sale_order_id', v_item.sale_order_id,
              'sale_order_item_id', v_item.id,
              'map_id', (v_resolution ->> 'map_id')::uuid,
              'technical_strap_line_id',
                (v_resolution ->> 'technical_strap_line_id')::uuid,
              'legacy_ordinal', v_ordinal
            )
          )
          ON CONFLICT (entity_type, legacy_id) WHERE status = 'review_required'
          DO UPDATE SET
            reason = EXCLUDED.reason,
            candidates = EXCLUDED.candidates,
            updated_at = now();
          CONTINUE;
        END IF;

        v_item_had_match := true;
        v_item_lines := jsonb_set(
          v_item_lines,
          ARRAY[v_ordinal::text],
          v_item_line || jsonb_build_object(
            'technical_strap_line_id',
              (v_resolution ->> 'technical_strap_line_id')::uuid,
            'measure_id', (v_resolution ->> 'measure_id')::uuid,
            'strap_type_id', (v_resolution ->> 'strap_type_id')::uuid
          ),
          false
        );
      END LOOP;

      SELECT NOT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_item_lines) entry
         WHERE nullif(entry ->> 'technical_strap_line_id', '') IS NULL
            OR NOT EXISTS (
              SELECT 1
                FROM public.technical_strap_line_identity_map map
               WHERE map.technical_strap_line_id::text =
                     entry ->> 'technical_strap_line_id'
                 AND map.status = 'resolved'
            )
      ) INTO v_all_resolved;

      IF v_item_had_match THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_item_lines,
               strap_migration_status = CASE
                 WHEN v_item_has_divergence THEN 'review_required'
                 WHEN v_all_resolved THEN 'resolved'
                 ELSE strap_migration_status
               END,
               strap_migration_reason = CASE
                 WHEN v_item_has_divergence THEN
                   'Linha de tira do PV divergiu da ficha/dry-run; escolha explicita obrigatoria'
                 WHEN v_all_resolved THEN
                   'Todas as linhas tecnicas possuem UUID canonico persistido'
                 ELSE strap_migration_reason
               END
         WHERE id = v_item.id;
      ELSE
        -- Só divergências: não inclui strap_colors no target list, preservando
        -- o snapshot e evitando triggers de coluna que o helper antigo não
        -- disparava neste caminho.
        UPDATE public.sale_order_items
           SET strap_migration_status = 'review_required',
               strap_migration_reason =
                 'Linha de tira do PV divergiu da ficha/dry-run; escolha explicita obrigatoria'
         WHERE id = v_item.id;
      END IF;

      PERFORM public.log_artisanal_strap_migration_event(
        'sale_order_item',
        v_item.id,
        'update',
        v_item_before,
        (
          SELECT to_jsonb(item)
            FROM public.sale_order_items item
           WHERE item.id = v_item.id
        ),
        v_reason,
        v_correlation_id
      );
    END LOOP;

    -- Auditoria técnica permanece uma por linha. A correlação agora é única
    -- para a chamada inteira; a auditoria de cada item é agregada no resultado
    -- final em vez de repetir N vezes o mesmo item.
    FOR v_resolution IN
      SELECT value FROM jsonb_array_elements(v_resolutions)
    LOOP
      v_after := jsonb_build_object(
        'map', (
          SELECT to_jsonb(map)
            FROM public.technical_strap_line_identity_map map
           WHERE map.id = (v_resolution ->> 'map_id')::uuid
        ),
        'technical_line', v_resolution -> 'after_line'
      );

      PERFORM public.log_artisanal_strap_migration_event(
        'technical_strap_line',
        (v_resolution ->> 'map_id')::uuid,
        'update',
        jsonb_build_object(
          'map', v_resolution -> 'before_map',
          'technical_line', v_resolution -> 'before_line'
        ),
        v_after,
        v_reason,
        v_correlation_id
      );
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource,
    resource_id,
    new_data,
    success,
    created_at
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
      'resolved_line_count', jsonb_array_length(v_resolutions),
      'batched', true,
      'correlation_id', v_correlation_id,
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
$resolve_context_batch$;

REVOKE ALL ON FUNCTION
  public.resolve_technical_strap_line_migration(uuid, uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.resolve_technical_strap_line_migration(uuid, uuid, text)
TO authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.resolve_technical_strap_context_from_sale_order(
    uuid, uuid, jsonb, text, timestamptz
  )
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.resolve_technical_strap_context_from_sale_order(
    uuid, uuid, jsonb, text, timestamptz
  )
TO authenticated;

COMMENT ON FUNCTION
  public.resolve_technical_strap_line_migration(uuid, uuid, text) IS
  'Resolve uma linha técnica individual e propaga somente snapshots abertos exatos. Drift de conteúdo retorna PGRST custom HTTP 409, nunca SQLSTATE 40001.';

COMMENT ON FUNCTION
  public.resolve_technical_strap_context_from_sale_order(
    uuid, uuid, jsonb, text, timestamptz
  ) IS
  'Writer em lote do drawer de correção de tiras: lock fail-fast, guarda fatos comprometidos antes de mapas, uma escrita de ficha, no máximo uma escrita/auditoria por item aberto e no-op idempotente. Conflitos de concorrência retornam PGRST custom HTTP 409.';

-- Assertions somente de definição: não chamam RPCs nem alteram dados de
-- domínio. Falham a migration se uma regressão textual retirar os invariantes.
DO $assertions$
DECLARE
  v_batch_def text;
  v_single_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_batch_def
    FROM pg_proc
   WHERE oid =
     'public.resolve_technical_strap_context_from_sale_order(uuid,uuid,jsonb,text,timestamptz)'::regprocedure;

  SELECT pg_get_functiondef(oid) INTO v_single_def
    FROM pg_proc
   WHERE oid =
     'public.resolve_technical_strap_line_migration(uuid,uuid,text)'::regprocedure;

  IF position('pg_try_advisory_xact_lock' IN v_batch_def) = 0
     OR position('FOR UPDATE NOWAIT' IN v_batch_def) = 0 THEN
    RAISE EXCEPTION 'Writer de contexto perdeu o lock fail-fast';
  END IF;

  IF position('pg_advisory_xact_lock(hashtextextended' IN v_batch_def) > 0 THEN
    RAISE EXCEPTION 'Writer de contexto voltou ao advisory lock bloqueante';
  END IF;

  IF position('technical_sheet_stale' IN v_batch_def) = 0
     OR position('strap_pipeline_busy' IN v_batch_def) = 0
     OR position('''PGRST''' IN v_batch_def) = 0
     OR position('''40001''' IN v_batch_def) > 0 THEN
    RAISE EXCEPTION 'Writer perdeu o contrato PGRST/409 sem 40001';
  END IF;

  IF position('resolve_technical_strap_line_migration(' IN v_batch_def) > 0 THEN
    RAISE EXCEPTION 'Writer em lote voltou a chamar o helper por linha';
  END IF;

  IF position('Repetição com snapshot renovado' IN v_batch_def) = 0
     OR position('v_sheet.strap_base_group_id IS NOT DISTINCT FROM' IN v_batch_def) = 0 THEN
    RAISE EXCEPTION 'Writer perdeu o no-op idempotente';
  END IF;

  IF position('technical_line_content_mismatch' IN v_single_def) = 0
     OR position('pg_try_advisory_xact_lock' IN v_single_def) = 0
     OR position('strap_pipeline_busy' IN v_single_def) = 0
     OR position('''PGRST''' IN v_single_def) = 0
     OR position('''40001''' IN v_single_def) > 0 THEN
    RAISE EXCEPTION 'Helper unitario perdeu o lock comum ou o conflito PGRST/409';
  END IF;

  IF position('lock_timeout' IN v_batch_def) = 0
     OR position('1500ms' IN v_batch_def) = 0
     OR position('lock_timeout' IN v_single_def) = 0
     OR position('1500ms' IN v_single_def) = 0 THEN
    RAISE EXCEPTION 'RPCs de correcao perderam o limite de espera por row lock';
  END IF;

END;
$assertions$;

COMMIT;
