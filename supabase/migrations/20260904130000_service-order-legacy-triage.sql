-- P0.3 — backfill de vínculo das OS legadas (triagem 2026-07).
--
-- Contexto medido em 03/07: 341 OS, todas com order_id NULL; 276 já Canceladas
-- (limpeza de junho — intocadas aqui); 64 Pendentes + 1 Concluída. 63 têm
-- vínculo de PV nas colunas LEGADAS (sale_order_id / linked_sale_order_ids).
--
-- Backfill: promove o vínculo legado para source_sale_order_id (rastreabilidade,
-- relatórios e cascata tg_cancel_service_orders_on_pv_cancel — desejado). NÃO
-- inventa source_item_key/source_terceirizacao_id: sem eles a OS não entra no
-- join tríplice do get_pv_terceirizacao_lines, e tudo bem — não fingimos que
-- veio do fluxo integrado. Seguro quanto ao índice único
-- uq_service_order_per_pv_item_terceirizacao (exige source_terceirizacao_id
-- NOT NULL, que continua nula).
--
-- linked_sale_order_ids com MAIS de 1 elemento fica de fora (ambíguo — triagem
-- manual pela UI decide).

UPDATE public.service_orders
   SET source_sale_order_id = sale_order_id
 WHERE source_sale_order_id IS NULL
   AND sale_order_id IS NOT NULL;

UPDATE public.service_orders
   SET source_sale_order_id = linked_sale_order_ids[1]
 WHERE source_sale_order_id IS NULL
   AND sale_order_id IS NULL
   AND cardinality(coalesce(linked_sale_order_ids, '{}')) = 1;
