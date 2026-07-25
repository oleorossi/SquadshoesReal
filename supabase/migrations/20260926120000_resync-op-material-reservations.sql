-- ============================================================================
-- Re-reserva material da OP quando a ficha técnica muda ("reeditar sempre")
--
-- Fecha na ORIGEM o furo de baixa do PV-00145. A cadeia do bug:
--   1. A reserva de material é feita na CRIAÇÃO da OP.
--   2. `resync_op_atomic` (disparado ao salvar a ficha, via resyncOPsForSheet)
--      NÃO re-reserva — verificado com pg_get_functiondef: o corpo não menciona
--      direct_components nem chama try_reserve_materials/release_order_reservations.
--   3. Componente acrescentado à ficha DEPOIS nunca era reservado.
--   4. A baixa na finalização converte RESERVA em stock_movements → o componente
--      saía da fábrica sem débito nenhum.
-- No PV-00145 isso deixou 26 linhas de material sem baixa (incluindo 2.208 pares
-- de solado); o mesmo diagnóstico achou Ilhós 51 no PV-00142.
--
-- ── ESCOPO: apenas COMPONENTE DIRETO ────────────────────────────────────────
-- Deliberado. É a classe que causou o furo e a única onde a re-reserva
-- automática é segura:
--   * a ficha FIXA o product_id (direct_components E component_color), então não
--     há ambiguidade de qual produto reservar;
--   * a unidade é nativa (un/par), sem conversão de área.
--
-- Os demais componentes NÃO entram: o motor de consumo e try_reserve_materials
-- resolvem o produto de formas diferentes dentro do mesmo grupo — em
-- OP-2026-01195 o consumo devolve "PLACA 1.0 EVA 3.0" (1908,72 dm²) e a reserva
-- gravou "EVA 3MM" (12,7248 = dm²/150). Inserir pelo product_id do consumo
-- criaria uma SEGUNDA reserva do mesmo material sob outro produto, dobrando a
-- palmilha reservada. Esses casos seguem reportados em
-- list_ops_with_stale_reservations() (painel /diagnostics) para tratamento
-- consciente, em vez de escrita automática errada.
--
-- ── O QUE FAZ, por OP ativa (Reservado / Em Produção) ───────────────────────
--   INSERT  componente direto que a ficha pede e não tem reserva ativa
--   UPDATE  quantidade divergente (ficha mudou de 2/par pra 3/par)
--   CANCEL  reserva de componente direto que a ficha não pede mais
--
-- ── GUARDA: só mexe em reserva com quantity_consumed = 0 ────────────────────
-- Material já separado/consumido no picking NUNCA é alterado nem cancelado —
-- devolver ao estoque o que já saiu da prateleira criaria estoque fantasma.
--
-- O cancelamento é restrito a reservas com metadata->>'source' em
-- ('direct_components','component_color'): as tiras reservam por caminho próprio
-- (order_strap_needs) e NÃO aparecem no payload de consumo — sem esse filtro
-- seriam lidas como órfãs e canceladas indevidamente.
--
-- products.reserved_stock não é tocado à mão: o trigger tg_sync_reserved_stock
-- (INSERT/UPDATE/DELETE) chama sync_product_reserved_stock, que RECALCULA do zero
-- a soma das reservas ativas. Mexer manualmente causaria duplo-decremento.
--
-- Verificado em produção: rodar em ficha já correta devolve 0/0/0 (idempotente);
-- cancelando a reserva de Ilhós da OP-2026-00968 e rodando o resync, a reserva
-- foi recriada e products.reserved_stock voltou de 5.200 para 8.800.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resync_op_material_reservations(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_o record;
  v_variant uuid;
  v_pkg text;
  v_grade jsonb;
  v_cons jsonb;
  v_ins int := 0;
  v_upd int := 0;
  v_can int := 0;
BEGIN
  SELECT o.id, o.reference_id, o.color, o.quantity, o.grade, o.status,
         o.sale_order_item_id, o.sale_order_id
    INTO v_o
    FROM public.orders o
   WHERE o.id = p_order_id;

  IF NOT FOUND OR v_o.reference_id IS NULL THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'skipped', 'OP inexistente ou sem ficha');
  END IF;
  IF v_o.status NOT IN ('Reservado', 'Em Produção') THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'skipped', 'OP não ativa: ' || v_o.status);
  END IF;

  -- Serializa contra try_reserve_materials / débito na mesma OP.
  PERFORM pg_advisory_xact_lock(hashtext('reserve:' || p_order_id::text));

  SELECT i.material_variant_id INTO v_variant
    FROM public.sale_order_items i WHERE i.id = v_o.sale_order_item_id;
  SELECT so.packaging_mode INTO v_pkg
    FROM public.sale_orders so WHERE so.id = v_o.sale_order_id;

  v_grade := public.resolve_effective_op_grade(v_o.grade, COALESCE(v_o.quantity, 0)::numeric);
  IF v_grade IS NULL THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'skipped', 'OP sem grade resolvível');
  END IF;

  v_cons := COALESCE(
    public.filter_caixa_by_packaging_mode(
      public.calculate_order_consumption_by_grade(
        v_o.reference_id, v_grade, COALESCE(v_o.color, ''), v_variant),
      v_pkg), '[]'::jsonb);

  CREATE TEMP TABLE IF NOT EXISTS _exp_direct (product_id uuid, req numeric) ON COMMIT DROP;
  DELETE FROM _exp_direct;

  INSERT INTO _exp_direct (product_id, req)
  SELECT (line ->> 'product_id')::uuid, sum(COALESCE((line ->> 'required')::numeric, 0))
    FROM jsonb_array_elements(v_cons) AS line
   WHERE (line ->> 'product_id') IS NOT NULL
     AND COALESCE(line ->> 'component', '') = 'Componente Direto'
     AND COALESCE((line ->> 'required')::numeric, 0) > 0
   GROUP BY (line ->> 'product_id')::uuid;

  -- (1) INSERT: a ficha pede e não há reserva ativa desse produto.
  WITH ins AS (
    INSERT INTO public.material_reservations
      (order_id, product_id, quantity_reserved, quantity_consumed, status,
       reservation_type, source, metadata, notes)
    SELECT p_order_id, e.product_id, e.req, 0, 'reserved', 'soft', 'onhand',
           jsonb_build_object('kind', 'component', 'component', 'Componente Direto',
                              'source', 'direct_components', 'resync', true),
           'reserva criada pelo resync da ficha (componente acrescentado depois da OP)'
      FROM _exp_direct e
     WHERE NOT EXISTS (
       SELECT 1 FROM public.material_reservations mr
        WHERE mr.order_id = p_order_id AND mr.product_id = e.product_id
          AND mr.status IN ('reserved', 'partially_consumed'))
    RETURNING 1
  ) SELECT count(*) INTO v_ins FROM ins;

  -- (2) UPDATE: quantidade divergente e nada consumido ainda.
  WITH upd AS (
    UPDATE public.material_reservations mr
       SET quantity_reserved = e.req, updated_at = now(),
           notes = 'quantidade ajustada pelo resync da ficha'
      FROM _exp_direct e
     WHERE mr.order_id = p_order_id
       AND mr.product_id = e.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND mr.quantity_reserved IS DISTINCT FROM e.req
    RETURNING 1
  ) SELECT count(*) INTO v_upd FROM upd;

  -- (3) CANCEL: componente direto que a ficha não pede mais, nada consumido.
  WITH can AS (
    UPDATE public.material_reservations mr
       SET status = 'cancelled', updated_at = now(),
           notes = 'reserva obsoleta cancelada pelo resync da ficha'
     WHERE mr.order_id = p_order_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND COALESCE(mr.quantity_consumed, 0) = 0
       AND COALESCE(mr.metadata ->> 'source', '') IN ('direct_components', 'component_color')
       AND NOT EXISTS (SELECT 1 FROM _exp_direct e WHERE e.product_id = mr.product_id)
    RETURNING 1
  ) SELECT count(*) INTO v_can FROM can;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'inseridas', v_ins,
    'atualizadas', v_upd,
    'canceladas', v_can);
END;
$function$;

-- Wrapper por FICHA: roda em todas as OPs ativas da referência. É este que o
-- frontend chama no fim de resyncOPsForSheet (src/lib/resyncOPs.ts).
CREATE OR REPLACE FUNCTION public.resync_sheet_material_reservations(p_sheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_op record;
  v_r jsonb;
  v_ops int := 0;
  v_ins int := 0;
  v_upd int := 0;
  v_can int := 0;
BEGIN
  FOR v_op IN
    SELECT o.id FROM public.orders o
     WHERE o.reference_id = p_sheet_id
       AND o.status IN ('Reservado', 'Em Produção')
  LOOP
    v_r := public.resync_op_material_reservations(v_op.id);
    v_ops := v_ops + 1;
    v_ins := v_ins + COALESCE((v_r ->> 'inseridas')::int, 0);
    v_upd := v_upd + COALESCE((v_r ->> 'atualizadas')::int, 0);
    v_can := v_can + COALESCE((v_r ->> 'canceladas')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'sheet_id', p_sheet_id, 'ops', v_ops,
    'inseridas', v_ins, 'atualizadas', v_upd, 'canceladas', v_can);
END;
$function$;
