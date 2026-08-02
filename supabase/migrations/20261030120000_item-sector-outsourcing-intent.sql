-- Terceirização por SETOR × ITEM do pedido, com a OS nascendo na ENTRADA EM
-- PRODUÇÃO (decisões do dono, 01/08/2026).
--
-- Fluxo:
--   1. No pedido, cada item marca quais SETORES saem pra fora e pra qual
--      prestador  →  grava só a INTENÇÃO em sale_order_items.outsourced_sectors
--   2. O pedido entra em produção e as OPs nascem  →  o trigger abaixo cria UMA
--      OS por (OP × setor marcado), já com prestador, pares e prazo
--   3. Depois disso, mandar um setor que não tinha sido marcado é chamada
--      explícita de send_item_sector_os()
--
-- Por que NÃO gerar a OS no save do pedido: já foi assim. Há 276 OS canceladas
-- de 279 criadas automaticamente por transbordo — cada edição de pedido virava
-- OS pra cancelar. Quando a OP existe, o pedido já parou de mudar.
--
-- Idempotência: reusa o índice único parcial `uq_os_per_op_sector`
-- (order_id, target_sector) WHERE status não-cancelado, criado em 20260703120000.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) A intenção: { "costura": "<contractor_uuid>", "solagem": "<uuid>" }
--    Mapa vazio = item 100% interno. NULL nunca acontece (default + NOT NULL),
--    então o trigger não precisa tratar os dois casos.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS outsourced_sectors jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sale_order_items.outsourced_sectors IS
  'Intenção de terceirização por setor deste item: {setor: contractor_id}. '
  'Mapa vazio = tudo interno. A OS só nasce na entrada em produção '
  '(tg_orders_generate_outsourcing_os). Ver migration 20261030120000.';

-- Guard de forma em DUAS camadas.
--
-- O CHECK só garante que é objeto: Postgres NÃO aceita subquery em CHECK
-- (`0A000: cannot use subquery in check constraint`), e validar chave/uuid
-- exige varrer o jsonb.
ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_outsourced_sectors_shape;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_outsourced_sectors_shape
  CHECK (jsonb_typeof(outsourced_sectors) = 'object');

-- A validação de chave de setor e de uuid vai num trigger. Sem ela, um setor
-- com typo ('custura') grava calado, o gatilho de produção não encontra nada
-- pra gerar e o pedido sai inteiro pra fábrica sem ninguém perceber — falha
-- silenciosa é pior que erro no save.
CREATE OR REPLACE FUNCTION public.tg_validate_item_outsourced_sectors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_bad text;
BEGIN
  IF NEW.outsourced_sectors IS NULL OR NEW.outsourced_sectors = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(e.k, ', ') INTO v_bad
    FROM jsonb_each_text(NEW.outsourced_sectors) AS e(k, v)
   WHERE e.k NOT IN ('costura','mesa','corte_palmilha','corte_forracao',
                     'corte_cabedal','silk','colagem','montagem','solagem','acabamento');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'setor de terceirizacao desconhecido em outsourced_sectors: %', v_bad;
  END IF;

  SELECT string_agg(e.k, ', ') INTO v_bad
    FROM jsonb_each_text(NEW.outsourced_sectors) AS e(k, v)
   WHERE e.v !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'prestador invalido (nao e uuid) nos setores: %', v_bad;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_sale_order_items_validate_outsourcing ON public.sale_order_items;
CREATE TRIGGER tg_sale_order_items_validate_outsourcing
  BEFORE INSERT OR UPDATE OF outsourced_sectors ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_validate_item_outsourced_sectors();

-- Só itens com intenção interessam ao trigger.
CREATE INDEX IF NOT EXISTS idx_sale_order_items_outsourced_sectors
  ON public.sale_order_items USING gin (outsourced_sectors)
  WHERE outsourced_sectors <> '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Criação de UMA OS pra (OP × setor). Reusada pelo trigger e pelo botão
--    "Enviar pra prestador" da edição do pedido.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_item_sector_os(
  p_order_id      uuid,
  p_sector        text,
  p_contractor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order    record;
  v_so       record;
  v_existing record;
  v_price    numeric;
  v_qty      numeric;
  v_desc     text;
  v_notes    text;
  v_deadline date;
  v_os_id    uuid;
  v_active constant text[] := ARRAY['Cancelado', 'cancelled', 'cancelada'];
BEGIN
  -- Guard de autorização: esta função é SECURITY DEFINER, então sem isto ela
  -- roda com a anon key do bundle. Ver memória
  -- "RPC anon: SECURITY DEFINER sem guard".
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_contractor_id IS NULL THEN
    RETURN jsonb_build_object('action', 'skipped', 'reason', 'no_contractor');
  END IF;

  SELECT o.id, o.order_number, o.quantity, o.color, o.sale_order_id,
         o.reference_id, ts.code AS ref_code, ts.name AS ref_name
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
   WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'skipped', 'reason', 'order_not_found');
  END IF;

  -- OS ativa já existente vence; cancelada é reativada (mesma semântica do
  -- generate_op_service_orders).
  SELECT * INTO v_existing FROM public.service_orders so
   WHERE so.order_id = p_order_id AND so.target_sector = p_sector
   ORDER BY (CASE WHEN so.status = ANY (v_active) THEN 1 ELSE 0 END), so.created_at DESC
   LIMIT 1;
  IF FOUND AND v_existing.status <> ALL (v_active) THEN
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id);
  END IF;

  SELECT id, order_number, client_order_number, delivery_deadline
    INTO v_so FROM public.sale_orders WHERE id = v_order.sale_order_id;

  v_qty   := COALESCE(v_order.quantity, 0);
  v_price := COALESCE(public.get_contractor_rate(p_contractor_id, p_sector, CURRENT_DATE), 0);
  v_deadline := COALESCE(v_so.delivery_deadline, CURRENT_DATE + 14);

  v_desc := COALESCE(v_order.ref_code, v_order.ref_name, 'Referência')
            || COALESCE(' · ' || NULLIF(btrim(v_order.color), ''), '')
            || ' · OP ' || COALESCE(v_order.order_number, v_order.id::text);

  IF v_so.client_order_number IS NOT NULL AND btrim(v_so.client_order_number) <> '' THEN
    v_notes := 'PV cliente: ' || btrim(v_so.client_order_number)
            || ' | PV: ' || COALESCE(v_so.order_number, v_order.sale_order_id::text);
  ELSE
    v_notes := 'PV: ' || COALESCE(v_so.order_number, v_order.sale_order_id::text);
  END IF;

  IF FOUND AND v_existing.status = ANY (v_active) THEN
    UPDATE public.service_orders so SET
      contractor_id = p_contractor_id, description = v_desc, service_date = CURRENT_DATE,
      quantity = v_qty, unit_price = v_price, total_value = v_qty * v_price,
      quoted_deadline = v_deadline, status = 'Pendente', dispatch_tracked = false,
      sector = p_sector, notes = v_notes, updated_at = now()
    WHERE so.id = v_existing.id;
    RETURN jsonb_build_object('action', 'reactivated', 'os_id', v_existing.id);
  END IF;

  BEGIN
    INSERT INTO public.service_orders (
      contractor_id, description, service_date, quantity, unit_price, total_value,
      status, notes, quoted_deadline, is_avulsa, sale_order_id, source_sale_order_id,
      source_item_key, order_id, target_sector, sector, dispatch_tracked
    ) VALUES (
      p_contractor_id, v_desc, CURRENT_DATE, v_qty, v_price, v_qty * v_price,
      'Pendente', v_notes, v_deadline, false, v_order.sale_order_id, v_order.sale_order_id,
      p_order_id::text || '::' || p_sector, p_order_id, p_sector, p_sector, false
    ) RETURNING id INTO v_os_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_os_id FROM public.service_orders
     WHERE order_id = p_order_id AND target_sector = p_sector
       AND status <> ALL (v_active) LIMIT 1;
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_os_id);
  END;

  -- Marca a OP como terceirizada pra ela aparecer no quadro "Na Rua"
  -- (v_outsourced_in_field lê outsourced_to_contractor_id). As colunas são
  -- SINGULARES: com mais de um setor no mesmo item, só o primeiro fica gravado
  -- aqui — a verdade completa são as linhas de service_orders.
  UPDATE public.orders
     SET outsourced_to_contractor_id = p_contractor_id,
         outsourced_sector = p_sector,
         outsourced_at = now()
   WHERE id = p_order_id
     AND outsourced_to_contractor_id IS NULL;

  RETURN jsonb_build_object('action', 'created', 'os_id', v_os_id);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) O gatilho: OP nasceu → gera a OS de cada setor marcado no item de origem.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_generate_outsourcing_os_for_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_map jsonb;
  v_sector text;
  v_contractor uuid;
BEGIN
  IF NEW.sale_order_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT outsourced_sectors INTO v_map
    FROM public.sale_order_items WHERE id = NEW.sale_order_item_id;

  IF v_map IS NULL OR v_map = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  FOR v_sector, v_contractor IN
    SELECT e.key, e.value::uuid FROM jsonb_each_text(v_map) AS e(key, value)
  LOOP
    BEGIN
      -- SECURITY DEFINER + guard: o trigger roda no contexto de quem liberou o
      -- pedido pra produção, que já passou pelo is_approved_user().
      PERFORM public.send_item_sector_os(NEW.id, v_sector, v_contractor);
    EXCEPTION WHEN OTHERS THEN
      -- Falhar a criação da OS NUNCA pode travar a OP. A fábrica produz; a OS
      -- que não saiu vira o botão "Enviar pra prestador" na edição do pedido.
      RAISE WARNING 'OS de terceirização não criada (OP % / setor %): %',
        NEW.id, v_sector, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Nome com prefixo `tg_` e ordenação alfabética consciente: dispara antes de
-- `tg_orders_sync_production_queue`, mas os dois são independentes.
-- Ver memória "Ordem alfabética dos triggers".
DROP TRIGGER IF EXISTS tg_orders_generate_outsourcing_os ON public.orders;
CREATE TRIGGER tg_orders_generate_outsourcing_os
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_generate_outsourcing_os_for_op();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Leitura pro botão "Enviar pra prestador": OPs vivas do pedido × setor,
--    com a OS que já existe (se existir).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pv_op_sector_os_status(p_sale_order_id uuid)
RETURNS TABLE (
  order_id uuid, op_number text, ref_code text, color text, quantity numeric,
  sector text, os_id uuid, os_number text, os_status text, contractor_id uuid,
  contractor_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT o.id, o.order_number, ts.code, o.color, o.quantity,
         s.sector, so.id, so.order_number, so.status, so.contractor_id, ct.name
    FROM public.orders o
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    CROSS JOIN LATERAL (
      SELECT unnest(ARRAY[
        'corte_cabedal','corte_forracao','corte_palmilha','silk','costura',
        'mesa','colagem','montagem','solagem','acabamento']) AS sector
    ) s
    LEFT JOIN public.service_orders so
           ON so.order_id = o.id AND so.target_sector = s.sector
          AND so.status <> ALL (ARRAY['Cancelado','cancelled','cancelada'])
    LEFT JOIN public.contractors ct ON ct.id = so.contractor_id
   WHERE o.sale_order_id = p_sale_order_id
     AND o.deleted_at IS NULL
     AND COALESCE(o.status,'') NOT IN ('Cancelada','cancelada','Cancelado','cancelled')
     AND public.is_approved_user()
   ORDER BY o.order_number, s.sector;
$function$;

-- GRANT só pra authenticated/service_role. NÃO conceder a `anon`: a anon key
-- vive no bundle do front, e SECURITY DEFINER sem isso é RPC pública.
REVOKE ALL ON FUNCTION public.send_item_sector_os(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pv_op_sector_os_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_item_sector_os(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pv_op_sector_os_status(uuid) TO authenticated, service_role;
