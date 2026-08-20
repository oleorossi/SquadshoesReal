-- STRASS e qualquer outra linha `finished_product_group` representam um
-- componente acabado comprado pronto. A napa-base pertence exclusivamente às
-- linhas `reference_base`, que podem ser produzidas internamente.
--
-- Esta migration corrige o writer do drawer sem inferir identidade por nome e
-- limpa somente bases impossíveis em fichas não vazias compostas integralmente
-- por linhas compradas prontas. O backfill não toca snapshots de PV, OPs,
-- reservas, movimentos ou parâmetros comerciais (preço/múltiplo de compra).

BEGIN;

-- Writer pequeno e atômico para o drawer do PV. A assinatura permanece igual
-- para que frontend novo e antigo possam coexistir durante o rollout. A ficha é
-- bloqueada antes de derivar a necessidade de napa; o cliente nunca decide se
-- uma linha é artesanal ou comprada pronta.
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
    IF p_base_group_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM public.product_groups g
       WHERE g.id = p_base_group_id
         AND EXISTS (
           SELECT 1 FROM public.base_material_width_profiles w
            WHERE w.base_group_id = g.id
              AND w.status = 'approved'
              AND w.valid_to IS NULL
         )
         AND EXISTS (
           SELECT 1
             FROM public.base_material_color_official_products o
             JOIN public.products p ON p.id = o.official_product_id
            WHERE o.base_group_id = g.id
              AND o.status = 'active'
              AND p.active
              AND p.group_id = g.id
         )
    ) THEN
      RAISE EXCEPTION 'Napa-base sem perfil aprovado ou produto oficial ativo';
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
  'Persiste medidas canônicas e a napa-base somente quando a ficha possui linha reference_base. Fichas compostas apenas por finished_product_group ignoram/limpam base enviada por frontend antigo e auditam esse fato.';

-- O fluxo antigo do botão "Cancelar OPs e editar" executava três RPCs de
-- cancelamento por OP no browser e só depois tentava salvar o PV. Uma STRASS sem
-- variante comercial, uma NF-e bloqueadora ou a segunda OP falhando deixavam a
-- primeira OP/reserva já alterada. Este writer engloba cancelamento, liberação
-- de reservas pendentes e update no MESMO transaction boundary; qualquer erro
-- do writer canônico
-- reverte tudo.
CREATE OR REPLACE FUNCTION public.update_sale_order_with_atomic_op_cancel(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_cancel_op_ids uuid[],
  p_teardown_op_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_requested_count integer;
  v_locked_count integer;
  v_order_status text;
  v_writer_result jsonb;
  v_promotion_result jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode cancelar OPs e editar PV';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items deve ser array nao vazio';
  END IF;

  SELECT count(DISTINCT op_id)::integer
    INTO v_requested_count
    FROM unnest(coalesce(p_cancel_op_ids, ARRAY[]::uuid[])) op_id;
  IF v_requested_count = 0 THEN
    RAISE EXCEPTION 'Informe as OPs avancadas que devem ser canceladas';
  END IF;
  IF v_requested_count <> cardinality(coalesce(p_cancel_op_ids, ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'Lista de OPs para cancelamento possui UUID repetido';
  END IF;

  -- Ordem promoção -> coarse -> PV -> fonte -> writer -> todas as OPs. O motor
  -- de promoção começa no primeiro advisory e pode precisar de KEY SHARE no PV
  -- ao inserir OP; o writer 05500 começa em coarse -> PV e nunca espera o lock
  -- de promoção. Esta ordem evita os dois ciclos e continua segura se um trigger
  -- futuro da promoção também passar pelo coarse global. Advisory locks são
  -- reentrantes na mesma transação.
  PERFORM pg_advisory_xact_lock(hashtext(
    'promote_sale_order:' || p_order_id::text));
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
  SELECT so.status INTO v_order_status
    FROM public.sale_orders so
   WHERE so.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV nao encontrado'; END IF;
  IF v_order_status NOT IN ('Aprovado', 'Em Produção') THEN
    RAISE EXCEPTION 'O PV nao esta em Aprovado/Em Producao; recarregue e reconcilie as OPs antes de editar'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = p_order_id
       AND nfe.status IN ('autorizada', 'processando', 'cancelando')
  ) THEN
    RAISE EXCEPTION 'PV possui NF-e ativa; cancele a NF-e antes de editar';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-demand-source:sale_order:' || p_order_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'update_sale_order_with_teardown:' || p_order_id::text, 0));

  -- Trava TODAS as OPs do PV em ordem determinística. Trancar apenas os UUIDs
  -- confirmados deixaria uma irmã mudar para Em Produção entre a validação e o
  -- cancelamento. O row lock do PV acima também impede uma nova filha via FK.
  PERFORM o.id
    FROM public.orders o
   WHERE o.sale_order_id = p_order_id
   ORDER BY o.id
   FOR UPDATE;

  SELECT count(*)::integer INTO v_locked_count
    FROM public.orders o
   WHERE o.sale_order_id = p_order_id
     AND o.id = ANY(p_cancel_op_ids);
  IF v_locked_count <> v_requested_count THEN
    RAISE EXCEPTION 'Uma OP nao pertence mais ao PV; recarregue antes de editar'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.id = ANY(p_cancel_op_ids)
       AND o.status NOT IN ('Em Produção', 'Concluída', 'Finalizado')
  ) THEN
    RAISE EXCEPTION 'O status de uma OP mudou; recarregue antes de editar'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.sale_order_id = p_order_id
       AND o.status IN ('Em Produção', 'Concluída', 'Finalizado')
       AND NOT (o.id = ANY(p_cancel_op_ids))
  ) THEN
    RAISE EXCEPTION 'Existem outras OPs avancadas fora da confirmacao; recarregue o PV'
      USING ERRCODE = '40001';
  END IF;

  FOR v_op IN
    SELECT o.id, o.status
      FROM public.orders o
     WHERE o.id = ANY(p_cancel_op_ids)
     ORDER BY o.id
  LOOP
    UPDATE public.orders
       SET status = 'Cancelada'
     WHERE id = v_op.id
       AND status = v_op.status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Status da OP mudou durante o cancelamento'
        USING ERRCODE = '40001';
    END IF;

    -- OP avançada pode representar corte/consumo físico irreversível. O modal
    -- promete liberar somente a parcela ainda reservada: não credita grade nem
    -- produto de volta ao estoque. A nova OP consumirá seu próprio material.
    PERFORM public.release_order_reservations(v_op.id);
  END LOOP;

  v_writer_result := public.update_sale_order_with_teardown(
    p_order_id,
    p_header,
    p_items,
    coalesce(p_teardown_op_ids, ARRAY[]::uuid[])
  );

  -- A OP substituta nasce antes do COMMIT. Deixar esta chamada no browser
  -- reproduziria a janela "cancelou/salvou, rede caiu antes de recriar".
  v_promotion_result := public.promote_sale_order_to_production(
    p_order_id,
    v_order_status
  );
  IF v_promotion_result IS NULL
     OR jsonb_typeof(v_promotion_result) <> 'object'
     OR jsonb_typeof(v_promotion_result -> 'itens_falha') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'O motor de producao nao retornou um resultado valido; cancelamento e edicao foram revertidos';
  END IF;
  IF jsonb_array_length(v_promotion_result -> 'itens_falha') > 0 THEN
    RAISE EXCEPTION 'Nao foi possivel recriar todas as OPs: %; cancelamento e edicao foram revertidos',
      coalesce(v_promotion_result -> 'itens_falha' -> 0 ->> 'message', 'falha desconhecida');
  END IF;

  RETURN coalesce(v_writer_result, '{}'::jsonb) || jsonb_build_object(
    'promotion_result', v_promotion_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_sale_order_with_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_sale_order_with_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.update_sale_order_with_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[]) IS
  'Cancela OPs avançadas, libera somente reservas pendentes, edita o PV e cria OPs substitutas em uma transação única. Nunca credita consumo físico de volta ao estoque.';

-- Preflight de UX com paridade integral: executa o MESMO writer dentro de um
-- subtransaction e lança um SQLSTATE sentinela depois do sucesso. O handler
-- captura apenas a sentinela; ao entrar nele, o PostgreSQL já desfez todas as
-- mutações do bloco interno. Erros reais (catálogo, NF-e, compromisso de tira,
-- revisão concorrente etc.) propagam normalmente. A segurança não depende
-- deste preflight: a chamada efetiva continua atômica pela função acima.
CREATE OR REPLACE FUNCTION public.preflight_sale_order_atomic_op_cancel(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_cancel_op_ids uuid[],
  p_teardown_op_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := public.update_sale_order_with_atomic_op_cancel(
      p_order_id,
      p_header,
      p_items,
      p_cancel_op_ids,
      p_teardown_op_ids
    );
    RAISE EXCEPTION USING
      ERRCODE = 'PZ001',
      MESSAGE = 'sale_order_atomic_op_cancel_preflight_rollback';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'cancel_op_count', cardinality(coalesce(p_cancel_op_ids, ARRAY[]::uuid[])),
      'writer_result', v_result
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.preflight_sale_order_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preflight_sale_order_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.preflight_sale_order_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[]) IS
  'Simula o writer atômico completo em subtransaction e reverte pela sentinela PZ001; não persiste cancelamento, liberação de reserva nem edição.';

-- Reparo determinístico e idempotente. `identity_basis` ausente NÃO entra: o
-- legado continua reference_base. Não há inferência por nome, produto ou cor.
--
-- A invalidação de PV/reserva disparada pelo trigger normal é deliberadamente
-- suspensa só durante este reparo de dado incorreto: retirar uma napa que nunca
-- participou de uma linha all-finished não altera consumo, custo ou estoque do
-- componente acabado. A RPC continua disparando a malha normal em uso futuro.
SELECT set_config(
  'app.strap_change_reason',
  'Correção 20270101006000: tira comprada pronta não possui napa-base',
  true
);
SELECT set_config('app.artisanal_strap_catalog_write', '1', true);

ALTER TABLE public.technical_sheets
  DISABLE TRIGGER trg_mark_so_costs_dirty_from_sheet;
ALTER TABLE public.technical_sheets
  DISABLE TRIGGER tg_strip_invalid_direct_components;

WITH target_sheets AS MATERIALIZED (
  SELECT ts.id,
         ts.strap_base_group_id AS previous_base_group_id
    FROM public.technical_sheets ts
   WHERE ts.strap_base_group_id IS NOT NULL
     AND jsonb_typeof(ts.strap_colors) = 'array'
     AND jsonb_array_length(ts.strap_colors) > 0
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
             THEN ts.strap_colors ELSE '[]'::jsonb END
         ) entry
        WHERE nullif(entry ->> 'identity_basis', '')
          IS DISTINCT FROM 'finished_product_group'
     )
), repaired_sheets AS (
  UPDATE public.technical_sheets ts
     SET strap_base_group_id = NULL,
         updated_at = now()
    FROM target_sheets target
   WHERE ts.id = target.id
     AND ts.strap_base_group_id = target.previous_base_group_id
  RETURNING ts.id, target.previous_base_group_id
)
INSERT INTO public.audit_logs (
  user_id, action, resource, resource_id, old_data, new_data, success, created_at
)
SELECT NULL,
       'repair_finished_product_group_strap_base',
       'technical_sheets',
       repaired.id::text,
       jsonb_build_object('strap_base_group_id', repaired.previous_base_group_id),
       jsonb_build_object(
         'strap_base_group_id', NULL,
         'requires_reference_base', false,
         'migration', '20270101006000'
       ),
       true,
       now()
  FROM repaired_sheets repaired;

ALTER TABLE public.technical_sheets
  ENABLE TRIGGER tg_strip_invalid_direct_components;
ALTER TABLE public.technical_sheets
  ENABLE TRIGGER trg_mark_so_costs_dirty_from_sheet;

-- As duas identidades STRASS já decididas permanecem estritamente ligadas aos
-- UUIDs de grupo. As medidas abaixo são verificadas, mas não são gravadas nas
-- fichas por esta migration: criar technical_strap_line_id/mapa sem passar pelo
-- fluxo auditado reescreveria snapshots abertos, o que este reparo proíbe.
DO $assertions$
DECLARE
  v_function_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_measures measure
     WHERE measure.id = '00f07325-347b-4e65-90e6-fed33f70eacc'::uuid
       AND measure.strap_type_id = '381eb21d-2170-45f7-ab7c-3601a8857ea9'::uuid
       AND measure.finished_width_mm = 6
       AND measure.active
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_measures measure
     WHERE measure.id = 'a487b85e-8e3d-4091-9932-41205836b5c0'::uuid
       AND measure.strap_type_id = '381eb21d-2170-45f7-ab7c-3601a8857ea9'::uuid
       AND measure.finished_width_mm = 15
       AND measure.active
  ) THEN
    RAISE EXCEPTION 'Medidas UUID explícitas de STRASS 6/15 mm divergiram do catálogo canônico';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
     WHERE ts.strap_base_group_id IS NOT NULL
       AND jsonb_typeof(ts.strap_colors) = 'array'
       AND jsonb_array_length(ts.strap_colors) > 0
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
               THEN ts.strap_colors ELSE '[]'::jsonb END
           ) entry
          WHERE nullif(entry ->> 'identity_basis', '')
            IS DISTINCT FROM 'finished_product_group'
       )
  ) THEN
    RAISE EXCEPTION 'Ficha all-finished ainda possui napa-base após reparo';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets ts,
           LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
               THEN ts.strap_colors ELSE '[]'::jsonb END
           ) entry
     WHERE jsonb_typeof(ts.strap_colors) = 'array'
       AND lower(entry ->> 'group_id') IN (
         'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
         '6e43bbda-0f1f-412c-8d4a-ec009114530d'
       )
       AND (
         entry ->> 'identity_basis' IS DISTINCT FROM 'finished_product_group'
         OR nullif(entry ->> 'identity_group_id', '')::uuid
              IS DISTINCT FROM nullif(entry ->> 'group_id', '')::uuid
       )
  ) THEN
    RAISE EXCEPTION 'Linha STRASS UUID explícita perdeu identidade finished_product_group';
  END IF;

  SELECT pg_get_functiondef(proc.oid)
    INTO v_function_def
    FROM pg_proc proc
    JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
   WHERE namespace.nspname = 'public'
     AND proc.proname = 'resolve_technical_strap_context_from_sale_order'
     AND pg_get_function_identity_arguments(proc.oid)
       = 'p_reference_id uuid, p_base_group_id uuid, p_lines jsonb, p_reason text, p_expected_updated_at timestamp with time zone';

  IF v_function_def IS NULL
     OR v_function_def NOT LIKE '%SECURITY DEFINER%'
     OR v_function_def NOT LIKE '%v_requires_reference_base%'
     OR v_function_def NOT LIKE '%requested_base_ignored%' THEN
    RAISE EXCEPTION 'Writer de contexto de tiras não preservou segurança/derivação/auditoria esperadas';
  END IF;
END;
$assertions$;

COMMIT;
