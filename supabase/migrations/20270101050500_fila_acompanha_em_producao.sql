-- fila_acompanha_em_producao_20270101050500
SET LOCAL statement_timeout = '600s';
--
-- A production_queue só era escrita por tg_orders_sync_production_queue, no
-- INSERT/UPDATE da OP. Mudar sale_orders.status para 'Em Produção' (promoção
-- atômica quando a OP já está nesse status, ou auto_promote pela etapa) não
-- grava a fila. Se a linha nunca entrou, ou o recompute a tirou e a OP não
-- voltou a ser atualizada, o PV fica Em Produção com zero linhas.
-- Medido: PV-00255 (5c14d390-7965-493c-8bdf-c1fdbe7420f7) e a fila inteira
-- com 10 linhas.
--
-- Esta migration não altera sale_orders, orders nem itens. Só insere na fila
-- as OPs abertas que o gatilho já deveria ter colocado. PV-00249 fica de fora
-- do backfill.

CREATE OR REPLACE FUNCTION public.production_order_is_queue_open(p_order public.orders)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (p_order).id IS NOT NULL
    AND (p_order).deleted_at IS NULL
    AND COALESCE((p_order).status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelled',
      'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
      'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
      'Faturado', 'Rascunho'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.sale_order_items queue_item
       WHERE queue_item.id = (p_order).sale_order_item_id
         AND queue_item.production_excluded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.technical_sheets queue_sheet
       WHERE queue_sheet.id = (p_order).reference_id
         AND queue_sheet.retired_at IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.production_order_is_queue_open(public.orders)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_sync_production_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF public.production_order_is_queue_open(NEW) THEN
    INSERT INTO public.production_queue (order_id, due_date, status)
    VALUES (
      NEW.id,
      public.resolve_op_due_date(NEW.id),
      CASE
        WHEN NEW.status = 'Em Produção' THEN 'em_producao'
        ELSE 'na_fila'
      END
    )
    ON CONFLICT (order_id) DO UPDATE
      SET due_date = EXCLUDED.due_date,
          status = EXCLUDED.status,
          updated_at = pg_catalog.now();
  ELSE
    DELETE FROM public.production_queue queue_row
     WHERE queue_row.order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_sync_production_queue()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_production_queue_for_sale_order(p_sale_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.production_queue (order_id, due_date, status)
  SELECT production_order.id,
         public.resolve_op_due_date(production_order.id),
         CASE
           WHEN production_order.status = 'Em Produção' THEN 'em_producao'
           ELSE 'na_fila'
         END
    FROM public.orders production_order
   WHERE production_order.sale_order_id = p_sale_order_id
     AND public.production_order_is_queue_open(production_order)
  ON CONFLICT (order_id) DO UPDATE
    SET due_date = EXCLUDED.due_date,
        status = EXCLUDED.status,
        updated_at = pg_catalog.now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_production_queue_for_sale_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_ensure_production_queue_on_sale_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN NEW;
  END IF;

  PERFORM public.ensure_production_queue_for_sale_order(NEW.id);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_ensure_production_queue_on_sale_status()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_ensure_production_queue_on_sale_status ON public.sale_orders;
CREATE TRIGGER trg_ensure_production_queue_on_sale_status
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_ensure_production_queue_on_sale_status();

COMMENT ON FUNCTION public.ensure_production_queue_for_sale_order(uuid) IS
  'Garante a production_queue das OPs abertas quando o PV entra em Aprovado ou Em Produção. Não grava sale_orders nem orders.';

-- Diagnóstico antes do backfill: PVs Em Produção sem nenhuma OP aberta na fila.
DO $lista_em_producao_sem_fila$
DECLARE
  v_com_op text;
  v_sem_op text;
  v_com_op_total integer;
  v_sem_op_total integer;
BEGIN
  SELECT count(*)::integer,
         COALESCE(string_agg(so.order_number, ', ' ORDER BY so.order_number), '')
    INTO v_com_op_total, v_com_op
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status = 'Em Produção'
     AND so.order_number IS DISTINCT FROM 'PV-00249'
     AND EXISTS (
       SELECT 1
         FROM public.orders production_order
        WHERE production_order.sale_order_id = so.id
          AND public.production_order_is_queue_open(production_order)
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders production_order
         JOIN public.production_queue queue_row
           ON queue_row.order_id = production_order.id
        WHERE production_order.sale_order_id = so.id
          AND public.production_order_is_queue_open(production_order)
     );

  SELECT count(*)::integer,
         COALESCE(string_agg(so.order_number, ', ' ORDER BY so.order_number), '')
    INTO v_sem_op_total, v_sem_op
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status = 'Em Produção'
     AND so.order_number IS DISTINCT FROM 'PV-00249'
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders production_order
        WHERE production_order.sale_order_id = so.id
          AND public.production_order_is_queue_open(production_order)
     );

  RAISE NOTICE 'em_producao_com_op_sem_fila_total %', v_com_op_total;
  RAISE NOTICE 'em_producao_com_op_sem_fila_numeros %', v_com_op;
  RAISE NOTICE 'em_producao_sem_op_aberta_total %', v_sem_op_total;
  RAISE NOTICE 'em_producao_sem_op_aberta_numeros %', v_sem_op;
END;
$lista_em_producao_sem_fila$;

-- Backfill: só INSERT na fila. O recálculo da agenda fica para o próximo
-- evento, para esta transação não estourar no recompute da fábrica inteira.
DO $backfill_fila$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgname = 'tg_queue_recompute'
       AND tgrelid = 'public.production_queue'::regclass
       AND NOT tgisinternal
  ) THEN
    ALTER TABLE public.production_queue DISABLE TRIGGER tg_queue_recompute;
  END IF;
END;
$backfill_fila$;

INSERT INTO public.production_queue (order_id, due_date, status)
SELECT production_order.id,
       public.resolve_op_due_date(production_order.id),
       CASE
         WHEN production_order.status = 'Em Produção' THEN 'em_producao'
         ELSE 'na_fila'
       END
  FROM public.orders production_order
  LEFT JOIN public.sale_orders so ON so.id = production_order.sale_order_id
 WHERE public.production_order_is_queue_open(production_order)
   AND COALESCE(so.order_number, '') IS DISTINCT FROM 'PV-00249'
   AND NOT EXISTS (
     SELECT 1
       FROM public.production_queue queue_row
      WHERE queue_row.order_id = production_order.id
   );

DO $religa_recompute$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgname = 'tg_queue_recompute'
       AND tgrelid = 'public.production_queue'::regclass
       AND NOT tgisinternal
  ) THEN
    ALTER TABLE public.production_queue ENABLE TRIGGER tg_queue_recompute;
  END IF;
END;
$religa_recompute$;
