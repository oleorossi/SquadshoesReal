-- Saneia os alertas legados encontrados por purchase_order_integrity_report.
-- Nenhuma linha teve recebimento: remover requisição de compra artesanal não
-- altera estoque, financeiro ou custo. Não criar OS de volta aqui é intencional:
-- há múltiplas receitas/base possíveis por item e escolher uma sem vínculo de
-- ficha/onda fabricaria uma baixa incorreta. Novas demandas seguem o motor de OS.

DO $remediate$
DECLARE
  v_removed integer;
  v_cancelled integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
      JOIN public.products p ON p.id = poi.product_id
     WHERE p.is_artisanal IS TRUE
       AND po.status NOT IN ('received', 'receiving', 'cancelled')
       AND COALESCE(poi.received_quantity, 0) <> 0
  ) THEN
    RAISE EXCEPTION 'Há item artesanal com recebimento; saneamento automático abortado.';
  END IF;

  DELETE FROM public.purchase_order_items poi
   USING public.purchase_orders po, public.products p
   WHERE poi.purchase_order_id = po.id
     AND poi.product_id = p.id
     AND p.is_artisanal IS TRUE
     AND po.status NOT IN ('received', 'receiving', 'cancelled')
     AND COALESCE(poi.received_quantity, 0) = 0;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE public.purchase_orders po
     SET total_value = COALESCE((
           SELECT SUM(poi.quantity * poi.unit_price)
             FROM public.purchase_order_items poi
            WHERE poi.purchase_order_id = po.id
         ), 0),
         notes = concat_ws(E'\n', NULLIF(po.notes, ''),
           'Auditoria de motores 13/08/2026: linhas artesanais sem recebimento removidas; produzir via OS com receita/base confirmada.'),
         updated_at = now()
   WHERE po.id = ANY (ARRAY[
     '7e0718b3-4e79-4265-891e-bb055a5e09c1'::uuid,
     'b826e784-9d09-4632-8777-ab4fb062a7a7'::uuid,
     'd5ce1ff7-0d7f-4285-8ca7-fc2d0c5fa4bd'::uuid,
     'c7974cbd-2a48-4cac-94b2-6f94ff5ad557'::uuid,
     'b6856e8a-de08-443b-a508-b8350de0197a'::uuid,
     'c3c069fe-7d5d-403a-9f79-e38ee67e9e9f'::uuid,
     '8212e26a-09b2-4af8-98f8-5b1cbe5f45f8'::uuid
   ]);

  -- Cabeçalhos vazios não são compras pendentes. O status preserva histórico e
  -- não tenta apagar referência usada por relatórios/auditoria.
  UPDATE public.purchase_orders po
     SET status = 'cancelled',
         cancelled_at = COALESCE(cancelled_at, now()),
         notes = concat_ws(E'\n', NULLIF(notes, ''), 'Cancelada: não restaram itens compráveis após saneamento artesanal.'),
         updated_at = now()
   WHERE po.status NOT IN ('received', 'receiving', 'cancelled')
     AND NOT EXISTS (SELECT 1 FROM public.purchase_order_items poi WHERE poi.purchase_order_id = po.id);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- OC-00012: três linhas sem recebimento em par/chapa para um produto comprado
  -- em placa (taxa 150). Não existe conversão histórica confiável; cancelar é
  -- reversível e impede crédito 150×. Não alterar quantidades por adivinhação.
  UPDATE public.purchase_orders po
     SET status = 'cancelled',
         cancelled_at = COALESCE(cancelled_at, now()),
         notes = concat_ws(E'\n', NULLIF(notes, ''),
           'Cancelada pela auditoria de motores 13/08/2026: unidades legadas par/chapa incompatíveis com compra em placa; recriar com quantidade confirmada.'),
         updated_at = now()
   WHERE po.order_number = 'OC-00012'
     AND po.status = 'pending'
     AND NOT EXISTS (
       SELECT 1 FROM public.purchase_order_items poi
       WHERE poi.purchase_order_id = po.id AND COALESCE(poi.received_quantity, 0) <> 0
     );

  RAISE NOTICE 'Auditoria: % linhas artesanais removidas; % OCs vazias canceladas.', v_removed, v_cancelled;
END;
$remediate$;
