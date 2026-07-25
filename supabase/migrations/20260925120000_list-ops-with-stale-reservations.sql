-- ============================================================================
-- Reserva defasada vs ficha atual — detecta a causa do furo de baixa
--
-- Investigação do PV-00145. A causa NÃO é bug do débito:
--
--   08/07 09:05  OPs 01142/01143 criadas e reservadas contra a ficha S-039 como
--                ela era então — UM único componente direto (Binóculo 10mm,
--                4.416 un). Confirmado em material_reservations.
--   depois       Binóculo 10mm Strass, Rebite e Fivela 12mm foram acrescentados
--                à ficha (os 3 produtos já existiam desde 07/06–04/07).
--   22/07 09:37  OPs finalizadas. A baixa converte RESERVA em stock_movements —
--                só o Binóculo tinha reserva, então só ele foi debitado.
--                record_order_consumption calculou o PADRÃO com a ficha ATUAL e
--                o REAL com os movimentos, marcando "sem débito registrado
--                (possível furo de baixa)". O sistema detectou; ninguém agiu.
--
-- O elo que falta: `resync_op_atomic` (disparado ao salvar a ficha, via
-- resyncOPsForSheet) NÃO re-reserva material — o corpo da função não menciona
-- direct_components nem chama try_reserve_materials/release_order_reservations.
-- Então OP já aberta mantém para sempre a lista de materiais do dia em que
-- nasceu.
--
-- ── Granularidade da cobertura (aprendida validando contra OP-2026-01195) ────
-- A comparação "a ficha pede X e a OP não reservou X" precisa casar no nível em
-- que a reserva resolve o material, senão gera ruído:
--
--   component = 'Componente Direto'  → a ficha FIXA o product_id (direct_components
--                                      E component_color). Cobertura só com o
--                                      MESMO produto; vizinho de grupo não vale.
--   qualquer outro componente        → material resolvido dentro do GRUPO
--                                      (palmilha, forro, embalagem, solado), então
--                                      outro produto do mesmo grupo conta.
--
-- Além disso aplica filter_caixa_by_packaging_mode, igual à reserva faz.
--
-- Histórico das iterações (todas verificadas contra dados reais):
--   v1  product_id sempre, sem filtro de embalagem → 86 linhas / 41 OPs. INFLADO:
--       contava a caixa alternativa (a reserva filtra pelo packaging_mode, a v1
--       não) e PLACA 1.0 EVA 3.0 × EVA 3MM (mesmo grupo PALMILHA, ids diferentes).
--   v2  grupo sempre → 58 / 28. Perdia o caso REAL: em OP-2026-01191 o ABS
--       TURQUEZA reservado "cobria" o REDONDO PEROLA que a ficha passou a pedir.
--   v3  fixava por source='direct_components' → ainda perdia componentes POR COR,
--       cuja origem vem como 'component_color'.
--   v4  fixa por component='Componente Direto' → cobre as duas origens. 59 / 29,
--       e pega corretamente os 3 casos acionáveis (OP-2026-01191 REDONDO PEROLA;
--       OP-2026-00968/00969 Ilhós 51 - Ouro).
--
-- Só reporta o lado "a ficha pede e não há reserva" — o inverso daria falso
-- positivo nas tiras, que reservam por caminho próprio (order_strap_needs), fora
-- do payload de consumo.
--
-- Superfície: /diagnostics → painel "Reserva defasada vs ficha atual".
-- ============================================================================
DROP FUNCTION IF EXISTS public.list_ops_with_stale_reservations();

CREATE FUNCTION public.list_ops_with_stale_reservations()
 RETURNS TABLE(order_id uuid, order_number text, sale_order_number text, reference_name text,
               op_status text, product_id uuid, product_name text, required_qty numeric,
               consumption_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH ativas AS (
    SELECT o.id, o.order_number, o.reference_id, o.color, o.status,
           public.resolve_effective_op_grade(o.grade, COALESCE(o.quantity, 0)::numeric) AS grade_ef,
           soi.material_variant_id,
           so.order_number AS pv_number,
           so.packaging_mode,
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
           COALESCE((line ->> 'source'), '?') AS src,
           COALESCE((line ->> 'component'), '') AS comp,
           COALESCE((line ->> 'required')::numeric, 0) AS required_qty
      FROM ativas a
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(
          CASE WHEN a.grade_ef IS NOT NULL
               THEN public.filter_caixa_by_packaging_mode(
                      public.calculate_order_consumption_by_grade(
                        a.reference_id, a.grade_ef, COALESCE(a.color, ''), a.material_variant_id),
                      a.packaging_mode)
          END, '[]'::jsonb)
      ) AS line
     WHERE (line ->> 'product_id') IS NOT NULL
       AND COALESCE((line ->> 'required')::numeric, 0) > 0
  )
  SELECT e.order_id, e.order_number, e.pv_number, e.ref_name, e.status,
         e.product_id, COALESCE(p.name, e.product_name), e.required_qty, e.src
    FROM esperado e
    LEFT JOIN public.products p ON p.id = e.product_id
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.material_reservations mr
       LEFT JOIN public.products rp ON rp.id = mr.product_id
      WHERE mr.order_id = e.order_id
        AND mr.status IN ('reserved', 'partially_consumed')
        AND (
          mr.product_id = e.product_id
          OR (e.comp <> 'Componente Direto'
              AND p.group_id IS NOT NULL
              AND rp.group_id = p.group_id)
        )
   )
   ORDER BY e.pv_number, e.order_number, COALESCE(p.name, e.product_name);
$function$;
