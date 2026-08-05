-- =============================================================================
-- Total da Ordem de Compra: servidor passa a ser o dono do numero
-- =============================================================================
-- A migration 20260517150001_purchase-order-total-trigger.sql foi escrita em
-- 17/05/2026 e NUNCA aplicou -- conferido em pg_proc/pg_trigger (a funcao e o
-- trigger nao existem) e em supabase_migrations.schema_migrations (nao esta
-- registrada). Ate hoje `purchase_orders.total_value` e mantido SO pelo
-- frontend (usePurchaseOrders.ts:381/404 e PurchaseOrders.tsx:941-942).
--
-- Esta migration faz TRES coisas, porque so a primeira deixaria o trigger
-- decorativo.
--
-- ---------------------------------------------------------------------------
-- 1) O TRIGGER (conteudo identico ao da 20260517150001, que fica obsoleta)
-- ---------------------------------------------------------------------------
-- Formula: SUM(quantity * unit_price). Sem frete, sem desconto, sem imposto --
-- e isso NAO e esquecimento: purchase_orders nao tem essas colunas (28
-- conferidas). Frete e desconto vivem em `invoices` (nota fiscal de entrada),
-- outra tabela. O aviso do CLAUDE.md de que "o trigger pode brigar com o total
-- gravado pelo app (frete/desconto)" esta DESATUALIZADO: nao ha o que perder.
--
-- Impacto medido antes de aplicar, OC por OC, em producao: 53 das 54 OCs ja
-- tem total_value EXATAMENTE igual ao que o trigger calcularia. Diferenca R$ 0.
--
-- ---------------------------------------------------------------------------
-- 2) O BACKFILL
-- ---------------------------------------------------------------------------
-- A unica OC divergente e a OC-00169: total_value = R$ 700,00 com ZERO itens.
-- Sem backfill esse valor fantasma ficaria para sempre, porque OC sem item
-- nunca aciona o trigger. Origem provavel: o produto foi excluido do estoque e
-- levou a linha da OC junto (purchase_order_items_product_id_fkey e
-- ON DELETE CASCADE), deixando o cabecalho com o valor cheio. E 'suggested',
-- gerada pelo robo de reposicao em 01/07/2026, nunca aprovada, sem conta a
-- pagar associada.
--
-- ---------------------------------------------------------------------------
-- 3) O ROBO DAS 3H (generate_rop_purchase_suggestions)
-- ---------------------------------------------------------------------------
-- Sem isto o trigger vira enfeite NESTE caminho. O robo nao recalcula: ele
-- ACUMULA -- le o total_value atual para dentro de v_total, vai somando item a
-- item e grava a soma no final, DEPOIS do trigger. Duas consequencias:
--   (a) o trigger e sobrescrito (o robo escreve por ultimo);
--   (b) como o valor de partida entra na conta, qualquer erro anterior
--       sobrevive e ainda cresce a cada rodada.
-- Foi exatamente esse mecanismo que preservou o R$ 700 da OC-00169.
--
-- A mudanca e cirurgica: o UPDATE final passa a RECALCULAR a partir dos itens
-- em vez de gravar o acumulador. Todo o resto da funcao fica intacto.
-- =============================================================================

-- ─────────────────────────── 1) trigger ───────────────────────────

DROP FUNCTION IF EXISTS public.recalc_purchase_order_total() CASCADE;

CREATE OR REPLACE FUNCTION public.recalc_purchase_order_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.purchase_orders
     SET total_value = COALESCE((
           SELECT SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0))
             FROM public.purchase_order_items
            WHERE purchase_order_id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id)
         ), 0),
         updated_at = now()
   WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recalc_purchase_order_total() IS
  'Mantem purchase_orders.total_value = SUM(quantity * unit_price) dos itens. '
  'OC nao tem frete/desconto/imposto (vivem em invoices), entao a soma dos itens '
  'E o total. Ver 20261124120000.';

DROP TRIGGER IF EXISTS trg_sync_purchase_order_total ON public.purchase_order_items;

CREATE TRIGGER trg_sync_purchase_order_total
AFTER INSERT OR UPDATE OF quantity, unit_price OR DELETE
ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_purchase_order_total();

-- ─────────────────────────── 2) backfill ───────────────────────────

UPDATE public.purchase_orders po
   SET total_value = COALESCE((
         SELECT SUM(COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0))
           FROM public.purchase_order_items i
          WHERE i.purchase_order_id = po.id
       ), 0)
 WHERE total_value IS DISTINCT FROM COALESCE((
         SELECT SUM(COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0))
           FROM public.purchase_order_items i
          WHERE i.purchase_order_id = po.id
       ), 0);

-- ─────────────────── 3) robo ROP: recalcular, nao acumular ───────────────────

CREATE OR REPLACE FUNCTION public.generate_rop_purchase_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_supplier RECORD; v_prod RECORD; v_po_id uuid; v_total numeric; v_qty numeric;
  v_sup_id uuid; v_sup_name text;
  v_unit_po text; v_price_po numeric; v_rate numeric;
  v_created int := 0; v_appended int := 0; v_items_added int := 0;
  v_idem text; v_po_status text;
BEGIN
  FOR v_supplier IN
    SELECT suggested_supplier_id, COALESCE(suggested_supplier, 'A definir') AS supplier_name
      FROM public.v_products_below_rop
     WHERE NOT has_active_po
       AND NOT COALESCE(is_artisanal, false)   -- F3-2: artesanal = OS (trigger de min_stock), não OC
     GROUP BY suggested_supplier_id, suggested_supplier
  LOOP
    -- Guarda defensiva: fornecedor inexistente vira NULL (PO "A definir").
    v_sup_id := v_supplier.suggested_supplier_id;
    IF v_sup_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_sup_id) THEN
      v_sup_id := NULL;
    END IF;
    v_sup_name := v_supplier.supplier_name;
    v_idem := 'rop:' || COALESCE(v_sup_id::text, 'none') || ':' || to_char(now(), 'YYYY-MM-DD');

    -- Reuso: primeiro pela key do DIA (idempotência forte), depois pela janela
    -- de 7 dias (comportamento legado — consolida a sugestão da semana).
    -- Mesmo conjunto "em aberto" do índice de B2: OC do dia já recebida não
    -- pode bloquear a sugestão de hoje (e a key volta a ficar livre).
    SELECT id, status INTO v_po_id, v_po_status FROM public.purchase_orders
     WHERE idempotency_key = v_idem
       AND status NOT IN ('cancelled', 'received', 'receiving')
     LIMIT 1;

    -- Já existe OC do dia pra esse fornecedor E ela saiu de 'suggested'
    -- (comprador aprovou/pediu): NÃO despeja item novo dentro dela nem tenta
    -- criar outra — a key é única, o INSERT estouraria e derrubaria o cron
    -- inteiro. Passa pro próximo fornecedor; amanhã a key muda.
    IF v_po_id IS NOT NULL AND v_po_status IS DISTINCT FROM 'suggested' THEN
      CONTINUE;
    END IF;

    IF v_po_id IS NULL THEN
      SELECT id INTO v_po_id FROM public.purchase_orders
       WHERE COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_sup_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND status = 'suggested' AND auto_generated = true
         AND created_at > now() - interval '7 days'
       ORDER BY created_at DESC LIMIT 1;
    END IF;

    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (status, supplier_id, supplier_name, total_value,
                                          auto_generated, notes, source_type, idempotency_key)
      VALUES ('suggested', v_sup_id, v_sup_name, 0, true,
        'Sugestao automatica ROP em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'rop', v_idem)
      RETURNING id INTO v_po_id;
      v_created := v_created + 1;
    ELSE
      v_appended := v_appended + 1;
    END IF;
    v_total := COALESCE((SELECT total_value FROM public.purchase_orders WHERE id = v_po_id), 0);
    FOR v_prod IN
      SELECT * FROM public.v_products_below_rop
       WHERE NOT has_active_po
         AND NOT COALESCE(is_artisanal, false)   -- F3-2
         AND COALESCE(suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = v_po_id AND product_id = v_prod.product_id) THEN CONTINUE; END IF;
      -- F3-1: item de OC em unidade de COMPRA — mesma matemática do MRP.
      -- suggested_qty está em unidade de ESTOQUE; o recebimento credita
      -- quantity × fator(purchase_unit→unit), então quantity TEM que sair
      -- em unidade de compra (senão PLACA EVA credita 150× a mais).
      v_rate := COALESCE(NULLIF(v_prod.conversion_rate, 0), 1);
      v_qty := v_prod.suggested_qty / v_rate;
      v_price_po := COALESCE(v_prod.unit_price, 0) * v_rate;
      v_unit_po := COALESCE(v_prod.purchase_order_unit, v_prod.unit);
      v_qty := GREATEST(v_qty, COALESCE(v_prod.supplier_moq, 1));
      -- Lista canônica de unidade contável (antes era literal e incompleta).
      IF public.is_countable_purchase_unit(v_unit_po) THEN
        v_qty := CEIL(v_qty);
      END IF;
      IF COALESCE(v_prod.purchase_multiple, 0) > 1 THEN
        v_qty := CEIL(v_qty / v_prod.purchase_multiple) * v_prod.purchase_multiple;
      END IF;
      INSERT INTO public.purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
      VALUES (v_po_id, v_prod.product_id, v_prod.stock_qty, v_prod.min_stock, v_prod.max_stock, v_prod.suggested_qty, v_qty, v_price_po, v_unit_po);
      v_total := v_total + v_qty * v_price_po;
      v_items_added := v_items_added + 1;
    END LOOP;
    -- ⚠ MUDANCA 05/08/2026 (mig 20261124120000): RECALCULA a partir dos itens.
    -- Antes era `SET total_value = v_total`, um ACUMULADOR que partia do
    -- total_value ja gravado. Isso (a) sobrescrevia o trigger
    -- trg_sync_purchase_order_total, que escreve antes, e (b) carregava
    -- qualquer erro anterior para a frente, crescendo a cada rodada -- foi o
    -- que manteve os R$ 700 fantasma da OC-00169 (OC com valor e zero itens).
    -- v_total continua sendo somado acima porque alimenta a telemetria da
    -- rodada; ele so nao e mais a fonte do numero gravado.
    UPDATE public.purchase_orders
       SET total_value = COALESCE((
             SELECT SUM(COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0))
               FROM public.purchase_order_items i
              WHERE i.purchase_order_id = v_po_id
           ), 0)
     WHERE id = v_po_id;
  END LOOP;
  RETURN jsonb_build_object('pos_created', v_created, 'pos_appended', v_appended, 'items_added', v_items_added, 'run_at', now());
END;
$function$;

-- ─────────────────────────── trava de verificacao ───────────────────────────

DO $$
DECLARE divergentes int;
BEGIN
  SELECT count(*) INTO divergentes
    FROM public.purchase_orders po
   WHERE po.total_value IS DISTINCT FROM COALESCE((
           SELECT SUM(COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0))
             FROM public.purchase_order_items i
            WHERE i.purchase_order_id = po.id
         ), 0);
  IF divergentes > 0 THEN
    RAISE EXCEPTION 'backfill falhou: % OCs ainda divergem da soma dos itens', divergentes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_sync_purchase_order_total' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trigger trg_sync_purchase_order_total nao foi criado';
  END IF;
END $$;
