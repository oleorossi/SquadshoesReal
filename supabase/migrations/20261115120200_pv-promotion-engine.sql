-- Fase 3a + 3b de specs/pv-producao-performance-e-pendencias.md
-- Requisitos 1, 2, 3, 4, 5, 6, 8, 9, 10.
--
-- PROBLEMA: `useUpdateSaleOrderStatus` tem 1.168 linhas e 68 `await supabase`. Para
-- CADA item do PV faz ~7 idas e voltas em série (cria OP, débito híbrido, solado por
-- grade, tira, embalagem, estágios, MRP). PV de 12 itens = ~85 chamadas ⇒ 20-35s de
-- tela travada, com o banco em us-west-2.
--
-- SOLUÇÃO: uma função. O laço dos itens roda DENTRO do banco.
--
-- ⚠ TRÊS DECISÕES DE PROJETO QUE NÃO SÃO ÓBVIAS:
--
-- 1. LAÇO SERIAL, ORDENADO POR sale_order_items.id. Não é preguiça — é o que evita
--    deadlock. Dois PVs que compartilham a mesma napa travam as linhas de `products`
--    na MESMA ordem, então um espera o outro em vez de se enroscarem. Paralelizar
--    itens aqui troca lentidão por corrupção de estoque.
--
-- 2. SAVEPOINT POR ITEM (bloco BEGIN/EXCEPTION). Item que falha desfaz só a si mesmo
--    — OP, reservas, débitos, estágios — e os outros seguem. Isso substitui a dança
--    de release_order_reservations + restore_sole_grade_for_order +
--    restore_product_stocks_for_order que o cliente fazia à mão: o rollback ao
--    savepoint já desfaz tudo, sem depender de 3 chamadas darem certo.
--
-- 3. O LOG DA FALHA VAI DENTRO DO HANDLER. Em PL/pgSQL o handler roda DEPOIS do
--    rollback ao savepoint, então o INSERT feito nele SOBREVIVE (requisito 10). Se
--    fosse gravado antes do RAISE, sumiria junto com o item. Não precisa de
--    transação autônoma.
--
-- O QUE FICA NO CLIENTE, DE PROPÓSITO: a criação automática de OC por falta de
-- solado/material (autoCreateSolePO, autoCreateSolePOFromShortfall,
-- autoCreateMaterialPO) é lógica TS já testada. O motor DEVOLVE os casos de falta e
-- o cliente cria as OCs só quando há falta — caminho de exceção, zero chamada extra
-- no caminho feliz.

-- ---------------------------------------------------------------------------
-- 1) Eventos de falha (requisitos 8, 9, 21)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_order_promotion_failures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id      uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE CASCADE,
  order_id           uuid,
  kind               text NOT NULL CHECK (kind IN ('erro_debito', 'falha_op', 'falha_estagios')),
  sqlstate           text,
  message            text NOT NULL,
  context            jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by        uuid,
  retry_count        int NOT NULL DEFAULT 0
);

-- Requisito 21: retentar com o problema ainda presente ATUALIZA a linha (message e
-- retry_count), não cria uma segunda. Uma pendência aberta por item.
CREATE UNIQUE INDEX IF NOT EXISTS ux_promotion_failure_aberta
  ON public.sale_order_promotion_failures (sale_order_item_id)
  WHERE resolved_at IS NULL AND sale_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promotion_failures_pv
  ON public.sale_order_promotion_failures (sale_order_id) WHERE resolved_at IS NULL;

ALTER TABLE public.sale_order_promotion_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotion_failures_select ON public.sale_order_promotion_failures;
CREATE POLICY promotion_failures_select ON public.sale_order_promotion_failures
  FOR SELECT TO authenticated USING (public.is_approved_user());

COMMENT ON TABLE public.sale_order_promotion_failures IS
  'Falhas de promoção de PV para produção. EVENTOS (aconteceram num instante) — as '
  'pendências que são ESTADO ATUAL (baixa parcial, cadastro, data inviável) não moram '
  'aqui, são derivadas na leitura por v_sale_order_pendencias. Fase 3a de '
  'specs/pv-producao-performance-e-pendencias.md';

-- ---------------------------------------------------------------------------
-- 2) Promoção de UM item — a unidade de isolamento
-- ---------------------------------------------------------------------------
-- Usada pelo motor (laço) e pela retentativa (item avulso), pra que as duas nunca
-- divirjam. Requisito 19: quando `p_planned_delivery` / `p_is_ahead` vêm das OPs
-- irmãs, a OP retentada nasce igual a elas.
CREATE OR REPLACE FUNCTION public.promote_sale_order_item(
  p_item_id           uuid,
  p_op_status         text,
  p_notes             text,
  p_planned_delivery  date,
  p_is_ahead          boolean,
  p_packaging_mode    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item          public.sale_order_items%ROWTYPE;
  v_so_id         uuid;
  v_scaled_grade  jsonb;
  v_effective     jsonb;
  v_op_id         uuid;
  v_fichas        int;
  v_sectors       text[];
  v_pkg_msg       text;
  v_pkg_state     text;
  v_shortages     jsonb := '[]'::jsonb;
  v_sole_shortfall boolean := false;
BEGIN
  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % não encontrado', p_item_id;
  END IF;
  v_so_id := v_item.sale_order_id;

  IF v_item.reference_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'item sem referência');
  END IF;

  v_fichas := GREATEST(COALESCE(v_item.fichas, 1), 1);

  -- grade × fichas, descartando numeração zerada (mesma regra do cliente).
  SELECT COALESCE(jsonb_object_agg(g.key, (g.value::numeric * v_fichas)::int), '{}'::jsonb)
    INTO v_scaled_grade
    FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
   WHERE COALESCE(NULLIF(g.value, '')::numeric, 0) * v_fichas > 0;

  v_effective := CASE WHEN v_scaled_grade = '{}'::jsonb
                      THEN NULLIF(COALESCE(v_item.grade, '{}'::jsonb), '{}'::jsonb)
                      ELSE v_scaled_grade END;

  -- Falta de material vira sugestão de MRP (não impede a OP).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', s.product_id, 'product_name', s.product_name,
           'required', s.required, 'available', s.available)), '[]'::jsonb)
    INTO v_shortages
    FROM public.check_stock_availability(
           v_item.reference_id, COALESCE(v_item.quantity, 0), COALESCE(v_item.color, ''),
           v_effective, v_item.strap_colors, p_packaging_mode, v_item.material_variant_id) s
   WHERE NOT s.sufficient;

  INSERT INTO public.orders (
    reference_id, quantity, color, grade, sale_order_id, sale_order_item_id,
    notes, status, item_observation, planned_delivery, is_ahead_of_schedule
  ) VALUES (
    v_item.reference_id, COALESCE(v_item.quantity, 0), COALESCE(v_item.color, ''),
    CASE WHEN v_scaled_grade = '{}'::jsonb THEN COALESCE(v_item.grade, '{}'::jsonb) ELSE v_scaled_grade END,
    v_so_id, v_item.id, p_notes, p_op_status, NULLIF(v_item.observation, ''),
    p_planned_delivery, COALESCE(p_is_ahead, false)
  )
  RETURNING id INTO v_op_id;

  -- Débito principal. force_soft = true: falta de estoque NÃO é erro, baixa o que dá.
  PERFORM public.hybrid_debit_stock_for_order(
    v_item.reference_id, COALESCE(v_item.quantity, 0)::numeric, COALESCE(v_item.color, ''),
    v_op_id, v_effective, true);

  IF v_scaled_grade <> '{}'::jsonb THEN
    PERFORM public.debit_sole_stock_by_grade(
      v_item.reference_id, v_op_id, COALESCE(v_item.color, ''), v_scaled_grade, true);
    -- Débito soft NÃO erra por falta — o sinal é o déficit por numeração. Mesma
    -- comparação que autoCreateSolePOFromShortfall faz no cliente: a grade efetiva
    -- da reserva contra o stock_grade do produto, número a número. Só devolvemos
    -- as OPs com déficit REAL, pra que o caminho feliz não pague chamada nenhuma.
    v_sole_shortfall := EXISTS (
      SELECT 1
        FROM public.material_reservations r
        JOIN public.products p ON p.id = r.product_id
       CROSS JOIN LATERAL jsonb_each_text(COALESCE(r.metadata->'effective_grade', '{}'::jsonb)) g
       WHERE r.order_id = v_op_id
         AND r.status = 'reserved'
         AND r.metadata->>'kind' = 'sole_grade'
         AND COALESCE(NULLIF(g.value, '')::numeric, 0)
             > COALESCE(NULLIF(p.stock_grade->>g.key, '')::numeric, 0));
  END IF;

  IF jsonb_typeof(v_item.strap_colors) = 'array' AND jsonb_array_length(v_item.strap_colors) > 0 THEN
    PERFORM public.debit_strap_stock(
      v_item.strap_colors, COALESCE(v_item.quantity, 0), v_op_id, v_item.grade, true);
  END IF;

  -- Embalagem: force_soft = false, MAS falta de embalagem não cancela a OP — mesma
  -- regra do cliente (isPackagingStockShortage). Só erro de outra natureza sobe.
  BEGIN
    PERFORM public.debit_packaging_for_order(
      v_so_id, v_op_id, v_item.reference_id, COALESCE(v_item.quantity, 0), p_packaging_mode, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_pkg_msg = MESSAGE_TEXT, v_pkg_state = RETURNED_SQLSTATE;
    IF v_pkg_msg !~* 'estoque insuficiente para embalagem' THEN
      RAISE EXCEPTION 'embalagem: %', v_pkg_msg USING ERRCODE = v_pkg_state;
    END IF;
  END;

  -- Estágios de produção. Setores da ficha; sem eles, o padrão canônico.
  SELECT COALESCE(
           NULLIF(ARRAY(SELECT jsonb_array_elements_text(ts.production_sectors)), '{}'),
           ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal',
                 'Mesa','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
         )
    INTO v_sectors
    FROM public.technical_sheets ts
   WHERE ts.id = v_item.reference_id;

  IF v_sectors IS NULL THEN
    v_sectors := ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal',
                       'Mesa','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'];
  END IF;

  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT v_op_id, s.name,
         -- Espelha opStageOrder(name, idx) do TS: 99 (desconhecido) cai pro índice.
         CASE WHEN public.canonical_stage_order(s.name) = 99 THEN s.idx ELSE public.canonical_stage_order(s.name) END,
         'pendente', COALESCE(v_item.quantity, 0), 0
    FROM unnest(v_sectors) WITH ORDINALITY AS s(name, idx);

  RETURN jsonb_build_object(
    'order_id', v_op_id,
    'item_id', v_item.id,
    'shortages', v_shortages,
    'sole_shortfall', v_sole_shortfall,
    'skipped', false
  );
END;
$function$;

-- ⚠ AUXILIAR INTERNA — sem GRANT para `authenticated`. É SECURITY DEFINER e cria OP
-- + debita estoque; exposta diretamente, qualquer autenticado promoveria um item
-- pulando as validações de status do PV. Só os dois pontos de entrada guardados
-- (promote_sale_order_to_production e retry_sale_order_item_promotion) a chamam, e
-- por serem DEFINER rodam como dono, que tem permissão.
REVOKE ALL ON FUNCTION public.promote_sale_order_item(uuid, text, text, date, boolean, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) O motor — uma chamada para o PV inteiro (requisitos 1-6)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_sale_order_to_production(
  p_sale_order_id uuid,
  p_target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so            public.sale_orders%ROWTYPE;
  v_op_status     text;
  v_notes         text;
  v_pkg_mode      text;
  v_deadline      date;
  v_is_ahead      boolean := false;
  v_item_id       uuid;
  v_res           jsonb;
  v_ops           jsonb := '[]'::jsonb;
  v_falhas        jsonb := '[]'::jsonb;
  v_shortages     jsonb := '[]'::jsonb;
  v_sole_short    uuid[] := '{}';
  v_msg           text;
  v_state         text;
  v_criadas       int := 0;
BEGIN
  -- Requisito 4: sem este guard a função fica executável pela chave anon que vai no
  -- bundle do front. Mesmo furo P0 fechado em 01/08/2026.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_target_status NOT IN ('Aprovado', 'Em Produção') THEN
    RAISE EXCEPTION 'promote_sale_order_to_production só trata Aprovado e Em Produção (recebeu %)', p_target_status;
  END IF;

  -- Serializa promoções do MESMO PV (duplo-clique, duas abas).
  PERFORM pg_advisory_xact_lock(hashtext('promote_sale_order:' || p_sale_order_id::text));

  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  v_pkg_mode := COALESCE(v_so.packaging_mode, 'individual_amarrado');

  IF p_target_status = 'Em Produção' THEN
    v_op_status := 'Em Produção';
    v_notes     := 'Gerada automaticamente - Em Produção';
    v_deadline  := v_so.delivery_deadline;
    v_is_ahead  := v_deadline IS NOT NULL AND (v_deadline - CURRENT_DATE) > 14;

    -- OPs já Reservado avançam junto. Rascunho NÃO: nunca teve débito, e subir sem
    -- passar pelo pipeline geraria OP fantasma sem consumo no chão de fábrica.
    UPDATE public.orders
       SET status = 'Em Produção'
     WHERE sale_order_id = p_sale_order_id AND status = 'Reservado';
  ELSE
    v_op_status := 'Reservado';
    v_notes     := 'Gerada automaticamente - Aprovação PV';
    v_deadline  := NULL;   -- o caminho de Aprovado nunca gravou planned_delivery
    v_is_ahead  := false;
  END IF;

  -- Requisito 2: ORDEM DETERMINÍSTICA. É o que impede deadlock entre sessões.
  FOR v_item_id IN
    SELECT soi.id
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
       -- Item que já tem OP viva não gera outra (idempotência do duplo-clique).
       AND NOT EXISTS (
         SELECT 1 FROM public.orders o
          WHERE o.sale_order_item_id = soi.id
            AND o.status NOT IN ('Cancelada', 'Rascunho')
       )
     ORDER BY soi.id
  LOOP
    -- Requisito 3: savepoint por item.
    BEGIN
      v_res := public.promote_sale_order_item(
                 v_item_id, v_op_status, v_notes, v_deadline, v_is_ahead, v_pkg_mode);

      IF COALESCE((v_res->>'skipped')::boolean, false) THEN
        CONTINUE;
      END IF;

      v_criadas := v_criadas + 1;
      v_ops := v_ops || jsonb_build_array(v_res->'order_id');
      IF jsonb_array_length(COALESCE(v_res->'shortages', '[]'::jsonb)) > 0 THEN
        v_shortages := v_shortages || (v_res->'shortages');
      END IF;
      IF COALESCE((v_res->>'sole_shortfall')::boolean, false) THEN
        v_sole_short := v_sole_short || (v_res->>'order_id')::uuid;
      END IF;

      -- Deu certo: fecha pendência aberta deste item (requisito 20).
      UPDATE public.sale_order_promotion_failures
         SET resolved_at = now()
       WHERE sale_order_item_id = v_item_id AND resolved_at IS NULL;

    EXCEPTION WHEN OTHERS THEN
      -- Chegando aqui, o savepoint JÁ desfez OP, reservas, débitos e estágios deste
      -- item. O INSERT abaixo roda fora do trecho desfeito e sobrevive (requisito 10).
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;

      BEGIN
        INSERT INTO public.sale_order_promotion_failures
          (sale_order_id, sale_order_item_id, kind, sqlstate, message, context)
        VALUES (
          p_sale_order_id, v_item_id,
          CASE WHEN v_msg ~* 'order_stages|estágio|estagio' THEN 'falha_estagios'
               WHEN v_msg ~* 'debit|débito|debito|estoque'   THEN 'erro_debito'
               ELSE 'falha_op' END,
          v_state, v_msg,
          jsonb_build_object('target_status', p_target_status, 'op_status', v_op_status)
        )
        ON CONFLICT (sale_order_item_id) WHERE resolved_at IS NULL AND sale_order_item_id IS NOT NULL
        DO UPDATE SET message     = EXCLUDED.message,
                      sqlstate    = EXCLUDED.sqlstate,
                      context     = EXCLUDED.context,
                      occurred_at = now(),
                      retry_count = sale_order_promotion_failures.retry_count + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Log não pode derrubar a promoção dos outros itens.
        NULL;
      END;

      v_falhas := v_falhas || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id, 'sqlstate', v_state, 'message', v_msg));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_order_id',   p_sale_order_id,
    'target_status',   p_target_status,
    'ops_criadas',     v_criadas,
    'order_ids',       v_ops,
    'itens_falha',     v_falhas,
    'shortages',       v_shortages,
    'sole_shortfall_order_ids', to_jsonb(v_sole_short)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_sale_order_to_production(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_sale_order_to_production(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.promote_sale_order_to_production(uuid, text) IS
  'Motor de promoção do PV para Aprovado / Em Produção. UMA chamada substitui ~85 do '
  'navegador. Laço serial ordenado por item (anti-deadlock) + savepoint por item '
  '(falha isolada). Fase 3b de specs/pv-producao-performance-e-pendencias.md';

-- ---------------------------------------------------------------------------
-- 4) Retentativa de UM item — reingressa no lote original (requisitos 18, 19, 20, 21)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_sale_order_item_promotion(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so         public.sale_orders%ROWTYPE;
  v_item       public.sale_order_items%ROWTYPE;
  v_op_status  text;
  v_notes      text;
  v_deadline   date;
  v_is_ahead   boolean;
  v_res        jsonb;
  v_msg        text;
  v_state      text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % não encontrado', p_item_id;
  END IF;

  SELECT * INTO v_so FROM public.sale_orders WHERE id = v_item.sale_order_id;

  IF v_so.status IN ('Cancelado', 'cancelado') THEN
    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now()
     WHERE sale_order_item_id = p_item_id AND resolved_at IS NULL;
    RETURN jsonb_build_object('ok', false, 'reason', 'PV cancelado — pendência encerrada');
  END IF;

  IF v_so.status IN ('Faturado', 'FINALIZADO', 'Finalizado') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PV já faturado — não gera OP nova');
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders o
              WHERE o.sale_order_item_id = p_item_id AND o.status NOT IN ('Cancelada', 'Rascunho')) THEN
    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now()
     WHERE sale_order_item_id = p_item_id AND resolved_at IS NULL;
    RETURN jsonb_build_object('ok', true, 'reason', 'item já tem OP viva');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('promote_sale_order:' || v_item.sale_order_id::text));

  -- Requisito 19: nasce IGUAL às irmãs. Prazo, semana e adiantamento vêm das OPs que
  -- já estão no lote, não de hoje — senão o item volta como pedido avulso atrasado.
  SELECT o.status, o.planned_delivery, o.is_ahead_of_schedule
    INTO v_op_status, v_deadline, v_is_ahead
    FROM public.orders o
   WHERE o.sale_order_id = v_item.sale_order_id
     AND o.status NOT IN ('Cancelada', 'Rascunho')
   ORDER BY o.created_at
   LIMIT 1;

  IF v_op_status IS NULL THEN
    -- Nenhuma irmã: cai no comportamento do status do PV.
    v_op_status := CASE WHEN v_so.status = 'Em Produção' THEN 'Em Produção' ELSE 'Reservado' END;
    v_deadline  := CASE WHEN v_so.status = 'Em Produção' THEN v_so.delivery_deadline ELSE NULL END;
    v_is_ahead  := COALESCE(v_deadline IS NOT NULL AND (v_deadline - CURRENT_DATE) > 14, false);
  END IF;

  v_notes := 'Regerada pela aba de pendências';

  BEGIN
    v_res := public.promote_sale_order_item(
               p_item_id, v_op_status, v_notes, v_deadline, v_is_ahead,
               COALESCE(v_so.packaging_mode, 'individual_amarrado'));

    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now(), resolved_by = auth.uid()
     WHERE sale_order_item_id = p_item_id AND resolved_at IS NULL;

    RETURN jsonb_build_object('ok', true, 'order_id', v_res->'order_id',
                              'sole_shortfall', v_res->'sole_shortfall');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    -- Requisito 21: atualiza a linha existente, não duplica.
    UPDATE public.sale_order_promotion_failures
       SET message = v_msg, sqlstate = v_state, occurred_at = now(),
           retry_count = retry_count + 1
     WHERE sale_order_item_id = p_item_id AND resolved_at IS NULL;
    RETURN jsonb_build_object('ok', false, 'reason', v_msg, 'sqlstate', v_state);
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_sale_order_item_promotion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_sale_order_item_promotion(uuid) TO authenticated;
