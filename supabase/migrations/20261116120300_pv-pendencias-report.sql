-- Fase 2 de specs/pv-producao-performance-e-pendencias.md
-- Requisitos 11, 12, 14, 15, 17.
--
-- Junta as pendências do PV em uma leitura. Duas naturezas, e confundi-las é o
-- que faria a tela mentir (requisito 12):
--   EVENTO  — sale_order_promotion_failures. Aconteceu num instante, fica gravado,
--             só sai quando o "Tentar de novo" der certo.
--   ESTADO  — baixa parcial e data inviável. Derivados AGORA. Somem sozinhos
--             quando a condição acaba (deu entrada da napa → a linha some).
--
-- O segmento de CADASTRO não entra aqui: consumption_consistency_report() é global
-- (check_name, severity, item_count, sample), não por PV. A aba o consome direto e
-- o rotula como global — agrupar por PV seria inventar vínculo que a função não tem.

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
  -- 1) EVENTOS — crítico. Bloqueia produção: o item não virou OP.
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
         -- Não oferece retentar em PV terminal.
         (so.status NOT IN ('Faturado', 'FINALIZADO', 'Finalizado', 'Cancelado', 'cancelado'))
    FROM public.sale_order_promotion_failures f
    JOIN public.sale_orders so ON so.id = f.sale_order_id
   WHERE f.resolved_at IS NULL
     AND so.deleted_at IS NULL

  UNION ALL

  -- 2) BAIXA PARCIAL — atenção. A OP existe, mas faltou material. Estado derivado:
  -- reaparece e some sozinho conforme o estoque muda.
  SELECT o.sale_order_id,
         so.order_number,
         so.status,
         'atencao'::text,
         'baixa_parcial'::text,
         o.sale_order_item_id,
         r.order_number,
         (r.product_name || ' — faltou ' || round(r.delta, 3)::text || ' ' || COALESCE(r.unit, ''))::text,
         COALESCE(r.obs, r.component)::text,
         r.delta,
         NULL::timestamptz,
         0,
         false
    FROM public.debit_consistency_report((CURRENT_DATE - p_days)::date, CURRENT_DATE, true) r
    JOIN public.orders o       ON o.order_number = r.order_number
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE r.delta > 0
     AND so.deleted_at IS NULL

  UNION ALL

  -- 3) DATA INVIÁVEL — atenção. Lê o CACHE (fase 1a); nunca recalcula aqui.
  SELECT so.id,
         so.order_number,
         so.status,
         'atencao'::text,
         'data_inviavel'::text,
         NULL::uuid,
         NULL::text,
         ('Entrega em ' || to_char(so.delivery_deadline, 'DD/MM/YYYY') ||
          ' — mínima possível ' || to_char(c.min_billing_date, 'DD/MM/YYYY'))::text,
         ('Considera estoque, lead time de fornecedor e capacidade dos setores. '
          || 'Atraso mínimo de ' || (c.min_billing_date - so.delivery_deadline)::text || ' dia(s).')::text,
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

REVOKE ALL ON FUNCTION public.get_sale_order_pendencias(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_pendencias(int) TO authenticated;

COMMENT ON FUNCTION public.get_sale_order_pendencias(int) IS
  'Pendências do PV para a aba /sales?view=pendencias. EVENTO (falha gravada) x ESTADO (baixa parcial e data inviável, derivados na leitura e que somem sozinhos). Fase 2 de specs/pv-producao-performance-e-pendencias.md';
