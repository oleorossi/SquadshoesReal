-- Corrige o sinal da pendência de baixa parcial.
--
-- Contrato vivo de debit_consistency_report:
--   delta = debitado - esperado
-- Portanto falta de material é delta < 0 e a quantidade faltante exibida é
-- esperado - debitado = abs(delta). A versão anterior filtrava delta > 0,
-- mostrando excesso de baixa como falta.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sale_order_pendencias(p_days int DEFAULT 90)
RETURNS TABLE(
  sale_order_id   uuid,
  order_number    text,
  pv_status       text,
  severidade      text,
  segmento        text,
  item_id         uuid,
  op_numero       text,
  titulo          text,
  detalhe         text,
  valor           numeric,
  ocorrido_em     timestamptz,
  retry_count     int,
  pode_retentar   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  RETURN QUERY
  -- EVENTO: falha persistida da promoção.
  SELECT f.sale_order_id,
         so.order_number,
         so.status,
         'critico'::text,
         CASE f.kind WHEN 'falha_estagios' THEN 'falha_op' ELSE f.kind END::text,
         f.sale_order_item_id,
         NULL::text,
         CASE f.kind
           WHEN 'erro_debito'    THEN 'Débito de estoque falhou'
           WHEN 'falha_estagios' THEN 'OP criada sem etapas de produção'
           ELSE 'OP não foi criada'
         END::text,
         f.message,
         NULL::numeric,
         f.occurred_at,
         f.retry_count,
         (so.status NOT IN ('Faturado', 'FINALIZADO', 'Finalizado', 'Cancelado', 'cancelado'))
    FROM public.sale_order_promotion_failures f
    JOIN public.sale_orders so ON so.id = f.sale_order_id
   WHERE f.resolved_at IS NULL
     AND so.deleted_at IS NULL

  UNION ALL

  -- ESTADO: falta = esperado - debitado. O valor publicado é sempre positivo.
  SELECT o.sale_order_id,
         so.order_number,
         so.status,
         'atencao'::text,
         'baixa_parcial'::text,
         o.sale_order_item_id,
         r.order_number,
         (r.product_name || ' — faltou '
           || round(r.esperado - r.debitado, 3)::text || ' '
           || COALESCE(r.unit, ''))::text,
         COALESCE(r.obs, r.component)::text,
         round(r.esperado - r.debitado, 4),
         NULL::timestamptz,
         0,
         false
    FROM public.debit_consistency_report(
           (CURRENT_DATE - GREATEST(COALESCE(p_days, 90), 0))::date,
           CURRENT_DATE,
           true
         ) r
    JOIN public.orders o       ON o.order_number = r.order_number
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE r.delta < 0
     AND (r.esperado - r.debitado) > 0.01
     AND so.deleted_at IS NULL

  UNION ALL

  -- ESTADO: data comercial anterior à data mínima calculada no cache.
  SELECT so.id,
         so.order_number,
         so.status,
         'atencao'::text,
         'data_inviavel'::text,
         NULL::uuid,
         NULL::text,
         ('Entrega em ' || to_char(so.delivery_deadline, 'DD/MM/YYYY')
          || ' — mínima possível ' || to_char(c.min_billing_date, 'DD/MM/YYYY'))::text,
         ('Considera estoque, lead time de fornecedor e capacidade dos setores. '
          || 'Atraso mínimo de ' || (c.min_billing_date - so.delivery_deadline)::text
          || ' dia(s).')::text,
         (c.min_billing_date - so.delivery_deadline)::numeric,
         NULL::timestamptz,
         0,
         false
    FROM public.sale_orders so
    JOIN public.sale_order_min_billing_cache c ON c.sale_order_id = so.id
   WHERE so.deleted_at IS NULL
     AND so.delivery_deadline IS NOT NULL
     AND c.min_billing_date IS NOT NULL
     AND c.computed_on = CURRENT_DATE
     AND so.delivery_deadline < c.min_billing_date
     AND so.status NOT IN ('Cancelado', 'cancelado', 'Faturado', 'FINALIZADO', 'Finalizado');
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sale_order_pendencias(int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_pendencias(int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sale_order_pendencias(int) IS
  'Pendências de PV. Em baixa_parcial, debit_consistency_report.delta = debitado - esperado; somente delta < 0 é falta e valor = esperado - debitado.';

DO $contract$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
           'public.get_sale_order_pendencias(integer)'::regprocedure
         )
    INTO v_definition;

  IF v_definition NOT ILIKE '%WHERE r.delta < 0%'
     OR v_definition ILIKE '%WHERE r.delta > 0%'
     OR v_definition NOT ILIKE '%r.esperado - r.debitado%' THEN
    RAISE EXCEPTION
      'Contrato de pendências inválido: falta deve usar delta < 0 e esperado - debitado';
  END IF;
END;
$contract$;

COMMIT;
