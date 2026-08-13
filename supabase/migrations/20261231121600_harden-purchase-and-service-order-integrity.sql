-- Auditoria integrada de motores (OC, débito e OS).
-- Fecha writers diretos de OC, impede compra de material artesanal e mantém
-- legado inseguro visível/bloqueado sem inventar conversão ou débito histórico.

CREATE OR REPLACE FUNCTION public.tg_validate_purchase_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stock_unit text;
  v_purchase_unit text;
  v_is_artisanal boolean;
BEGIN
  -- Itens de embalagem não representam um produto de estoque.
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(btrim(unit), ''), 'un'),
         COALESCE(NULLIF(btrim(purchase_unit), ''), NULLIF(btrim(purchase_order_unit), ''), NULLIF(btrim(unit), ''), 'un'),
         COALESCE(is_artisanal, false)
    INTO v_stock_unit, v_purchase_unit, v_is_artisanal
    FROM public.products
   WHERE id = NEW.product_id;

  IF v_stock_unit IS NULL THEN
    RAISE EXCEPTION 'Produto da linha de OC não encontrado: %', NEW.product_id;
  END IF;
  IF v_is_artisanal THEN
    RAISE EXCEPTION '"%" é material artesanal: produza por OS, não por OC.', NEW.product_id;
  END IF;
  IF public.po_norm_unit(COALESCE(NEW.unit, '')) NOT IN
     (public.po_norm_unit(v_stock_unit), public.po_norm_unit(v_purchase_unit)) THEN
    RAISE EXCEPTION
      'Unidade "%" inválida para a linha da OC. Use a unidade de compra "%" ou a de estoque "%".',
      NEW.unit, v_purchase_unit, v_stock_unit;
  END IF;
  IF COALESCE(NEW.quantity, 0) <= 0 OR COALESCE(NEW.unit_price, 0) < 0 THEN
    RAISE EXCEPTION 'Quantidade e preço da linha da OC devem ser válidos.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_purchase_order_item ON public.purchase_order_items;
CREATE TRIGGER trg_validate_purchase_order_item
  BEFORE INSERT OR UPDATE OF product_id, unit, quantity, unit_price
  ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_purchase_order_item();

-- Uma OC com item legado em unidade ambígua não pode ser recebida até o
-- comprador decidir a conversão. Isso evita crédito de estoque 150× errado.
CREATE OR REPLACE FUNCTION public.tg_block_invalid_purchase_order_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status IN ('receiving', 'received')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (
       SELECT 1
       FROM public.purchase_order_items poi
       JOIN public.products p ON p.id = poi.product_id
       WHERE poi.purchase_order_id = NEW.id
         AND (p.is_artisanal IS TRUE OR public.po_norm_unit(COALESCE(poi.unit, '')) NOT IN (
           public.po_norm_unit(COALESCE(p.unit, 'un')),
           public.po_norm_unit(COALESCE(NULLIF(btrim(p.purchase_unit), ''), NULLIF(btrim(p.purchase_order_unit), ''), NULLIF(btrim(p.unit), ''), 'un'))
         ))
     ) THEN
    RAISE EXCEPTION 'OC possui item artesanal ou unidade inválida; corrija as linhas antes de iniciar o recebimento.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_invalid_purchase_order_receipt ON public.purchase_orders;
CREATE TRIGGER trg_block_invalid_purchase_order_receipt
  BEFORE UPDATE OF status ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_invalid_purchase_order_receipt();

CREATE OR REPLACE FUNCTION public.create_purchase_order_normalized(
  p_supplier_name text,
  p_supplier_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_items jsonb
)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_po public.purchase_orders;
  v_item jsonb;
  v_qty numeric;
  v_unit text;
  v_price numeric;
  v_total numeric := 0;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF COALESCE(btrim(p_supplier_name), '') = '' THEN RAISE EXCEPTION 'Fornecedor é obrigatório'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos um item na OC';
  END IF;

  INSERT INTO public.purchase_orders (
    supplier_name, supplier_id, notes, total_value, auto_generated, source_type, idempotency_key
  ) VALUES (
    btrim(p_supplier_name), p_supplier_id, COALESCE(p_notes, ''), 0, false, 'manual', p_idempotency_key
  ) RETURNING * INTO v_po;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF NULLIF(v_item->>'product_id', '') IS NULL THEN RAISE EXCEPTION 'Item sem produto'; END IF;
    SELECT out_qty, out_unit, out_unit_price INTO v_qty, v_unit, v_price
      FROM public.po_normalize_line(
        (v_item->>'product_id')::uuid,
        COALESCE((v_item->>'quantity')::numeric, 0),
        v_item->>'unit',
        COALESCE((v_item->>'unit_price')::numeric, 0)
      );
    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, suggested_quantity, unit_price, unit,
      current_stock, min_stock, max_stock, grade, color
    ) VALUES (
      v_po.id, (v_item->>'product_id')::uuid, v_qty, v_qty, v_price, v_unit,
      COALESCE((v_item->>'current_stock')::numeric, 0), COALESCE((v_item->>'min_stock')::numeric, 0),
      COALESCE((v_item->>'max_stock')::numeric, 0), v_item->'grade', v_item->>'color'
    );
    v_total := v_total + v_qty * v_price;
  END LOOP;

  UPDATE public.purchase_orders SET total_value = v_total, updated_at = now()
   WHERE id = v_po.id RETURNING * INTO v_po;
  RETURN v_po;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_order_normalized(text, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order_normalized(text, uuid, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purchase_order_integrity_report()
RETURNS TABLE(issue text, severity text, purchase_order_id uuid, order_number text, product_id uuid, product_name text, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 'artisanal_in_purchase_order', 'high', po.id, po.order_number, p.id, p.name,
         'Material artesanal em OC aberta: direcionar para OS.'
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN products p ON p.id = poi.product_id
   WHERE p.is_artisanal IS TRUE AND po.status NOT IN ('received','receiving','cancelled')
  UNION ALL
  SELECT 'invalid_item_unit', 'high', po.id, po.order_number, p.id, p.name,
         format('Linha em %s; compra=%s; estoque=%s.', poi.unit, p.purchase_unit, p.unit)
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN products p ON p.id = poi.product_id
   WHERE po.status NOT IN ('received','receiving','cancelled')
     AND public.po_norm_unit(COALESCE(poi.unit, '')) NOT IN (
       public.po_norm_unit(COALESCE(p.unit, 'un')),
       public.po_norm_unit(COALESCE(NULLIF(btrim(p.purchase_unit), ''), NULLIF(btrim(p.purchase_order_unit), ''), NULLIF(btrim(p.unit), ''), 'un'))
     )
  UNION ALL
  SELECT 'duplicate_open_item', 'medium', po.id, po.order_number, poi.product_id, max(p.name),
         format('%s linhas abertas para o mesmo produto/cor.', count(*))
    FROM purchase_orders po JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN products p ON p.id = poi.product_id
   WHERE po.status NOT IN ('received','receiving','cancelled')
   GROUP BY po.id, po.order_number, poi.product_id, COALESCE(poi.color, '')
  HAVING count(*) > 1;
$function$;
REVOKE ALL ON FUNCTION public.purchase_order_integrity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_order_integrity_report() TO authenticated, service_role;

-- Dado seguro: OC-00032 tem taxa 1, nenhum recebimento e somente a grafia
-- legada `un`; a unidade-base de estoque é `par`, então não há mudança de valor.
UPDATE public.purchase_order_items poi
   SET unit = 'par'
  FROM public.purchase_orders po
 WHERE poi.purchase_order_id = po.id
   AND po.order_number = 'OC-00032'
   AND poi.product_id = 'ed44dd78-46b0-4a68-9d80-03d75f4b4ba7'::uuid
   AND COALESCE(poi.received_quantity, 0) = 0
   AND poi.unit = 'un';

-- Legado órfão sem despacho, retorno, financeiro ou movimento: cancelar sem
-- forjar vínculo de PV/OP e deixar a razão explícita no próprio histórico.
DO $cleanup$
DECLARE v_os uuid := 'af7d3a22-2056-4cb9-a31e-c6f9ba4e8e1a';
BEGIN
  IF EXISTS (SELECT 1 FROM public.service_order_dispatches WHERE service_order_id = v_os)
     OR EXISTS (SELECT 1 FROM public.service_order_returns WHERE service_order_id = v_os)
     OR EXISTS (SELECT 1 FROM public.accounts_payable WHERE reference_id = v_os) THEN
    RAISE EXCEPTION 'OS legado % ganhou dependência; cancelamento automático abortado.', v_os;
  END IF;
  UPDATE public.service_orders
     SET status = 'Cancelado',
         notes = concat_ws(E'\n', NULLIF(notes, ''), 'Cancelada pela auditoria de motores em 13/08/2026: OS órfã, sem envio, retorno, financeiro ou baixa de estoque.'),
         updated_at = now()
   WHERE id = v_os AND status = 'Pendente';
END;
$cleanup$;
