-- AUDITORIA PV 2026-06-10 (O2 + O3):
-- O2: tg_sync_orders_from_sale_order_item criava OPs FANTASMAS (sem stages e
-- sem débito) durante o delete+reinsert de itens do update_sale_order_atomic,
-- ganhando do pipeline do front que recria OPs completas (21 em produção; 9
-- recentes com 0 stages/0 reservas). Fix: flag transacional de supressão no
-- RPC + dedupe e grade escalada no trigger.
-- O3: triggers gravavam grade POR FICHA; convenção do front é grade ESCALADA
-- (soma == quantity). Triggers agora escalam via scale_grade_to_total.

DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='update_sale_order_atomic' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'update_sale_order_atomic não encontrada'; RETURN; END IF;
  IF v_src LIKE '%suppress_item_op_sync%' THEN RETURN; END IF;
  IF position('SELECT id INTO v_existing FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;' IN v_src) = 0 THEN
    RAISE WARNING 'update_sale_order_atomic: âncora do lock não encontrada — patch O2a NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    'SELECT id INTO v_existing FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;',
    'SELECT id INTO v_existing FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;
  PERFORM set_config(''app.suppress_item_op_sync'', ''1'', true);');
  EXECUTE v_src;
END
$patch$;

CREATE OR REPLACE FUNCTION public.tg_sync_orders_from_sale_order_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so_status text;
  v_sale_order_id uuid;
  v_existing_op_id uuid;
BEGIN
  v_sale_order_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_sale_order_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF current_setting('app.suppress_item_op_sync', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_so_status FROM public.sale_orders WHERE id = v_sale_order_id;
  IF v_so_status <> 'Em Produção' THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_existing_op_id
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_existing_op_id IS NOT NULL THEN RETURN NEW; END IF;

    INSERT INTO public.orders (
      reference_id, quantity, color, grade,
      sale_order_id, sale_order_item_id, status, notes
    )
    VALUES (
      NEW.reference_id, NEW.quantity, COALESCE(NEW.color,''),
      public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
      v_sale_order_id, NEW.id, 'Reservado',
      'Auto-criada por alteração em PV (item adicionado)'
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT id INTO v_existing_op_id
      FROM public.orders
     WHERE sale_order_item_id = NEW.id
       AND status NOT IN ('Cancelada','Cancelado','Finalizado','Concluído')
     LIMIT 1;
    IF v_existing_op_id IS NOT NULL
       AND (NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.color IS DISTINCT FROM OLD.color
            OR NEW.grade IS DISTINCT FROM OLD.grade)
    THEN
      UPDATE public.orders
         SET quantity = NEW.quantity,
             color = COALESCE(NEW.color,''),
             grade = public.scale_grade_to_total(COALESCE(NEW.grade,'{}'::jsonb), NEW.quantity),
             updated_at = now(),
             notes = COALESCE(notes,'') || E'\n' || 'Atualizada por alteração em PV — qty=' || NEW.quantity::text
       WHERE id = v_existing_op_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='tg_sale_order_creates_ops_on_production' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'tg_sale_order_creates_ops_on_production não encontrada'; RETURN; END IF;
  IF v_src LIKE '%scale_grade_to_total(COALESCE(v_item.grade%' THEN RETURN; END IF;
  IF position($s$        COALESCE(v_item.grade, '{}'::jsonb),$s$ IN v_src) = 0 THEN
    RAISE WARNING 'trigger principal: âncora da grade não encontrada — patch O3 NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    $s$        COALESCE(v_item.grade, '{}'::jsonb),$s$,
    $s$        public.scale_grade_to_total(COALESCE(v_item.grade, '{}'::jsonb), v_item.quantity),$s$);
  EXECUTE v_src;
END
$patch$;
