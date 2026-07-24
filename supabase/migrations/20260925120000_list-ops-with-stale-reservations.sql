-- ============================================================================
-- Reserva defasada vs ficha atual — detecta a causa do furo de baixa
--
-- Investigação do PV-00145 (fivela, rebite e binóculo strass consumidos e NUNCA
-- debitados). A causa NÃO é bug do débito:
--
--   08/07 09:05  OPs 01142/01143 criadas e reservadas contra a ficha S-039 como
--                ela era então — UM único componente direto (Binóculo 10mm,
--                4.416 un). Confirmado em material_reservations.
--   depois       Binóculo 10mm Strass, Rebite e Fivela 12mm foram acrescentados
--                à ficha (os 3 produtos já existiam desde 07/06–04/07).
--   22/07 09:37  OPs finalizadas. A baixa converte RESERVA em stock_movements —
--                só o Binóculo tinha reserva, então só ele foi debitado.
--                record_order_consumption calculou o PADRÃO com a ficha ATUAL
--                (fivela 2.208/OP) e o REAL com os movimentos (0), marcando
--                "sem débito registrado (possível furo de baixa)". O sistema
--                detectou e ninguém agiu.
--
-- O elo que falta: `resync_op_atomic` (disparado ao salvar a ficha, via
-- resyncOPsForSheet) NÃO re-reserva material — o corpo da função não menciona
-- direct_components nem chama try_reserve_materials/release_order_reservations.
-- Então OP já aberta mantém para sempre a lista de materiais do dia em que
-- nasceu.
--
-- Esta função lista o gap ANTES da finalização, por OP × produto. Compara só a
-- PRESENÇA do product_id (não a quantidade): evita ruído de conversão de unidade
-- e pega exatamente essa classe de erro. Reporta apenas o lado "a ficha pede e
-- não há reserva" — o inverso daria falso positivo nas tiras, que reservam por
-- caminho próprio (order_strap_needs), fora do payload de consumo.
--
-- Superfície: /diagnostics → painel "Reserva defasada vs ficha atual".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.list_ops_with_stale_reservations()
 RETURNS TABLE(order_id uuid, order_number text, sale_order_number text, reference_name text,
               op_status text, product_id uuid, product_name text, required_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH ativas AS (
    SELECT o.id, o.order_number, o.reference_id, o.color, o.status,
           public.resolve_effective_op_grade(o.grade, COALESCE(o.quantity, 0)::numeric) AS grade_ef,
           soi.material_variant_id,
           so.order_number AS pv_number,
           ts.name AS ref_name
      FROM public.orders o
      LEFT JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
      LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
      LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
     WHERE o.status IN ('Reservado', 'Em Produção')
       AND o.reference_id IS NOT NULL
  ),
  esperado AS (
    SELECT a.id AS order_id, a.order_number, a.pv_number, a.ref_name, a.status,
           (line ->> 'product_id')::uuid AS product_id,
           (line ->> 'product_name') AS product_name,
           COALESCE((line ->> 'required')::numeric, 0) AS required_qty
      FROM ativas a
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(
          CASE WHEN a.grade_ef IS NOT NULL
               THEN public.calculate_order_consumption_by_grade(
                      a.reference_id, a.grade_ef, COALESCE(a.color, ''), a.material_variant_id)
          END, '[]'::jsonb)
      ) AS line
     WHERE (line ->> 'product_id') IS NOT NULL
       AND COALESCE((line ->> 'required')::numeric, 0) > 0
  )
  SELECT e.order_id, e.order_number, e.pv_number, e.ref_name, e.status,
         e.product_id, COALESCE(p.name, e.product_name), e.required_qty
    FROM esperado e
    LEFT JOIN public.products p ON p.id = e.product_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.material_reservations mr
      WHERE mr.order_id = e.order_id
        AND mr.product_id = e.product_id
        AND mr.status IN ('reserved', 'partially_consumed')
   )
   ORDER BY e.pv_number, e.order_number, COALESCE(p.name, e.product_name);
$function$;
