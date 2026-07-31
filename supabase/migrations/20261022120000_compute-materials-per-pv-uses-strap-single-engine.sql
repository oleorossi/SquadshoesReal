-- ============================================================================
-- compute_materials_per_pv passa a usar o MOTOR ÚNICO de tira artesanal
-- ============================================================================
--
-- POR QUE
-- -------
-- A auditoria de 31/07/2026 mediu, no PV-00148, que 8 de 24 materiais divergiam
-- entre o que a OC comprava e o que a produção reservava. `is_artisanal` vivia
-- em 9 funções de compras/MRP/ondas e em NENHUMA de reserva/débito: compras
-- convertia a tira em napa e não comprava a tira; produção reservava A TIRA
-- (estoque 0) → falta permanente que a compra nunca resolvia.
--
-- A mig 20261021120000 criou o motor único (`resolve_strap_stock_lines`, sobre
-- `order_strap_needs` + `resolve_strap_sourcing` + `resolve_strap_base_napa`) e
-- a 20261021130000 religou o débito (`debit_strap_stock`) nele. Faltava o lado
-- de COMPRAS — é o que esta migration fecha.
--
-- O QUE MUDA
-- ----------
-- Sai a explosão PRÓPRIA de tira que vivia na CTE `resolved` (joins manuais
-- artisanal_recipes → product_groups → products, casados por NOME, mais o CASE
-- que zerava needed_qty). Entra uma chamada a `resolve_strap_stock_lines`, uma
-- vez por item do PV. Compras e reserva passam a ler a MESMA decisão.
--
--   in_house  → a OC compra a NAPA  (stock_required = m de tira ÷ rendimento)
--   purchased → a OC compra a TIRA  (stock_required = m de tira)
--   bloqueada → a OC não compra nada e o `block_reason` do motor sobe em
--               `conversion_warning` (o GeneratePurchaseOrdersDialog já exibe).
--
-- O bloqueio é a correção de comportamento: quando a receita existia mas NÃO
-- havia napa naquela família+cor, o código antigo caía no ELSE e comprava a
-- TIRA em silêncio — origem da divergência descrita na spec §2.4. Agora a linha
-- aparece com mensagem acionável ("cadastre a napa ou marque a tira como
-- comprada pronta") em vez de gerar compra errada.
--
-- O QUE NÃO MUDA (verificado linha a linha antes de aplicar)
-- ---------------------------------------------------------
-- * `exploded` (cabedal/forração/palmilha/solado/BOM via
--   calculate_order_consumption_by_grade) — intocado;
-- * a conversão dm²→unidade física via `get_material_conversion_info` em `agg`;
-- * `own_res` (reserva própria do PV somada de volta ao estoque disponível),
--   `mism` (color_mismatch) e `solado_grade`;
-- * a assinatura de retorno, da qual dependem `usePerPvPurchasing.ts` e
--   `GeneratePurchaseOrdersDialog.tsx`.
--
-- PARIDADE MEDIDA (31/07/2026)
-- ----------------------------
-- PV-00148 (528 pares, 12 itens): 18 linhas, delta 0,000000 em TODAS, e nenhuma
-- diferença em unit/stock_qty/shortage/supplier/price/is_artisanal/grade/
-- color_mismatch/conversion_warning. Paridade exata.
--
-- Nos 11 PVs abertos, divergem 9 linhas, todas explicadas:
--   1 linha  — ruído de ponto flutuante (1e-6): o motor arredonda
--              round(m ÷ rendimento, 6) POR ITEM, o código antigo somava os
--              itens e só então dividia;
--   5 linhas — mesma qtd (0), só o texto do aviso mudou para a mensagem do
--              motor único ("Nao existe receita de X em Y ...");
--   3 linhas — o bloqueio novo descrito acima, TODAS no PV-2026-00097, que a
--              spec §2.7 já reserva para acerto manual do dono.
--
-- Ref: specs/tira-artesanal-fonte-unica-e-os-cabedal.md §1, §2.2, §2.4
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
 RETURNS TABLE(material_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, last_unit_price numeric, is_artisanal boolean, grade jsonb, color_mismatch boolean, conversion_warning text)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    SELECT soi.grade AS item_grade,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, ''),
          soi.material_variant_id
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
      )
  ),
  -- Consumo NÃO-tira: cabedal, forração, palmilha, solado e BOM. Intocado — a
  -- conversão dm²→unidade física acontece em `agg`, via get_material_conversion_info.
  exploded AS (
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')     AS product_name,
      CASE WHEN (line ->> 'matched_by') = 'group_generic' THEN ''
           ELSE COALESCE(line ->> 'color', '') END AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit,
      (line ->> 'component')        AS component,
      (line ->> 'matched_by')       AS matched_by,
      (line ->> 'conversion_warning') AS conversion_warning,
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  -- TIRA: motor ÚNICO. `resolve_strap_stock_lines` já resolve, por linha de tira
  -- do item do PV: a demanda (order_strap_needs), o sourcing (override em
  -- sale_order_items.strap_sourcing > products.is_artisanal) e a napa-base por
  -- família+cor. Quando a tira é in_house e a napa não resolve, ela devolve
  -- stock_product_id NULL + block_reason — não compramos nada e o aviso sobe.
  strap_lines AS (
    SELECT
      COALESCE(sl.stock_product_id, sl.strap_product_id) AS product_id,
      COALESCE(sl.strap_color, '')                       AS color,
      CASE WHEN sl.stock_product_id IS NULL THEN 0
           ELSE COALESCE(sl.stock_required, 0) END       AS required,
      sl.block_reason
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    CROSS JOIN LATERAL public.resolve_strap_stock_lines(
      soi.id, soi.reference_id, soi.strap_colors, soi.quantity::numeric, soi.grade
    ) sl
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND COALESCE(sl.stock_product_id, sl.strap_product_id) IS NOT NULL
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
      )
  ),
  agg AS (
    SELECT e.product_id, e.color, MAX(e.product_name) AS product_name,
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL AND e.conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit
                               FROM public.get_material_conversion_info(e.product_id) conv
                              LIMIT 1), 1), 1)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL AND e.conversion_warning IS NULL), 0) AS needed_qty,
      MAX(e.conversion_warning) AS conversion_warning
    FROM exploded e
    GROUP BY e.product_id, e.color
  ),
  strap_agg AS (
    SELECT s.product_id, s.color, SUM(s.required) AS needed_qty,
           MAX(s.block_reason) AS conversion_warning
    FROM strap_lines s
    GROUP BY s.product_id, s.color
  ),
  -- Napa de cabedal e napa vinda de tira caem no MESMO (product_id, color) e
  -- somam numa linha só — comportamento preservado do código anterior.
  rolled AS (
    SELECT u.product_id, u.color, SUM(u.needed_qty) AS needed_qty,
           MAX(u.conversion_warning) AS conversion_warning
    FROM (
      SELECT product_id, color, needed_qty, conversion_warning FROM agg
      UNION ALL
      SELECT product_id, color, needed_qty, conversion_warning FROM strap_agg
    ) u
    GROUP BY u.product_id, u.color
  ),
  own_res AS (
    SELECT mr.product_id,
           SUM(GREATEST(0, COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0))) AS own_reserved
    FROM public.material_reservations mr
    JOIN public.orders o ON o.id = mr.order_id
    WHERE o.sale_order_id = ANY(p_pv_ids)
      AND mr.status IN ('reserved', 'partially_consumed')
    GROUP BY mr.product_id
  ),
  mism AS (
    SELECT product_id, color, bool_or(matched_by = 'color_mismatch') AS color_mismatch
    FROM exploded GROUP BY product_id, color
  ),
  solado_grade AS (
    SELECT product_id, color, jsonb_object_agg(k, v) AS grade FROM (
      SELECT e.product_id, e.color, kv.key AS k,
             round(SUM((kv.value::numeric) * e.required / NULLIF(gs.total, 0))) AS v
      FROM exploded e
      CROSS JOIN LATERAL (
        SELECT SUM(x.value::numeric) AS total
        FROM jsonb_each_text(e.item_grade) x WHERE x.key ~ '^[0-9/]+$'
      ) gs
      , jsonb_each_text(e.item_grade) kv
      WHERE e.component = 'Solado' AND e.item_grade IS NOT NULL
        AND kv.key ~ '^[0-9/]+$' AND COALESCE(gs.total, 0) > 0
      GROUP BY e.product_id, e.color, kv.key
    ) g WHERE v > 0 GROUP BY product_id, color
  )
  SELECT
    r.product_id                  AS material_id,
    COALESCE(p.name, r.product_id::text) AS product_name,
    COALESCE(p.unit, 'un')        AS unit,
    r.color,
    r.needed_qty,
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0)) AS stock_qty,
    GREATEST(0, r.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal,
    sg.grade,
    COALESCE(m.color_mismatch, false) AS color_mismatch,
    r.conversion_warning
  FROM rolled r
  LEFT JOIN public.products p   ON p.id = r.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN own_res orr ON orr.product_id = r.product_id
  LEFT JOIN solado_grade sg ON sg.product_id = r.product_id AND sg.color = r.color
  LEFT JOIN mism m ON m.product_id = r.product_id AND m.color = r.color
  WHERE r.needed_qty > 0 OR r.conversion_warning IS NOT NULL
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, r.product_id::text);
$function$;

COMMENT ON FUNCTION public.compute_materials_per_pv(uuid[]) IS
  'Materiais a comprar por PV (botão "Gerar OCs"). Tira artesanal NÃO tem lógica '
  'própria aqui: delega a public.resolve_strap_stock_lines, o mesmo motor que '
  'debit_strap_stock usa, para compras e reserva não divergirem. '
  'Ver specs/tira-artesanal-fonte-unica-e-os-cabedal.md.';
