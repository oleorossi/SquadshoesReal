-- =============================================================================
-- Tira da fila do motor as 20 OPs de pedido morto (decisão do dono, 06/08/2026).
--
-- Contexto: a auditoria (docs/AUDITORIA_MOTOR_KANBAN_2026-08-06.md) achou 240
-- pares de pedido já encerrado ocupando as posições 1–11 e 18–26 da fila. Como
-- a fila ordena por prazo mais antigo e esses pedidos venceram há 91–150 dias,
-- eles subiam ao TOPO e empurravam PV-00150, PV-00147 e PV-00151 pra depois.
--
-- A migration `20261210120000` fechou a origem do vazamento (cancelar PV passou
-- a cascatear pras OPs), mas de propósito não fez backfill: o que fazer com o
-- que já estava lá era decisão do dono. Ele decidiu: excluir.
--
-- ⚠ NÃO é DELETE. Cada PV recebe a semântica que o PRÓPRIO sistema já aplica
-- pro seu status — o efeito pedido (sair da fila, liberar capacidade) é o mesmo,
-- e o histórico continua auditável:
--
-- As 20 viram 'Cancelada': é o único status honesto pra OP que NUNCA RODOU.
-- Verificado antes de aplicar: as 20 têm `quantity_processed = 0` em TODAS as
-- etapas. Nenhuma produção real é apagada por isto.
--
-- ⚠ 'Finalizado' FOI TENTADO PRO PV FATURADO E É ARMADILHA — não "corrigir"
-- isto de volta. O gatilho `tg_close_stages_on_op_finalize` fecha toda etapa
-- pendente com `quantity_processed = COALESCE(quantity_total, ...)`. Nestas OPs,
-- que não produziram nada, isso FABRICARIA 132 pares de produção fantasma
-- espalhados por 11 setores — a mesma mentira que a auditoria acabou de tirar do
-- Kanban, agora injetada direto no banco e contaminando produtividade e custo de
-- mão de obra por setor. Quem barrou foi `fn_guard_manual_stage_transition`
-- ("Setor Costura Palmilha ainda não entregou nada — não dá pra iniciar
-- Colagem"), e a tentativa inteira reverteu.
--
-- ⚠ Por que um UPDATE seco, e não repetir a cascata de faturamento:
-- `finalize_orders_on_sale_order_billed` chama `convert_reservation_to_out`,
-- ou seja, dá SAÍDA no material. Sem produção nenhuma, isso inventaria consumo
-- que nunca existiu. Com o UPDATE quem dispara é
-- `auto_release_reservations_on_op_cancel`, que DEVOLVE as 15 linhas de reserva
-- ao estoque — o correto fisicamente.
--
-- O resto se limpa sozinho a partir do status (não repetir nada disto aqui):
--   • `tg_orders_sync_production_queue`        → tira da fila do motor
--   • `cancel_mrp_suggestions_on_order_cancel` → cancela sugestões de MRP
--   • `auto_release_reservations_on_op_cancel` → devolve reserva ao estoque
--
-- Casado por `sale_orders.order_number` (dado de negócio estável), nunca por
-- UUID gerado.
-- =============================================================================

-- PV cancelado → OPs canceladas (9 OPs, 108 pares)
UPDATE public.orders o
   SET status = 'Cancelada', updated_at = now()
  FROM public.sale_orders so
 WHERE so.id = o.sale_order_id
   AND so.order_number = 'PV-2026-00094'
   AND o.deleted_at IS NULL
   AND lower(btrim(COALESCE(o.status, ''))) NOT IN
       ('finalizado', 'cancelada', 'cancelado', 'cancelled', 'faturado');

-- PV faturado, mas com ZERO produção nas 11 OPs (132 pares)
--
-- ⚠ Este PV está marcado como Faturado com a NOTA FISCAL EM BRANCO — anomalia
-- registrada no laudo e ainda EM ABERTO. Cancelar as OPs tira os 132 pares da
-- fila (que é o que foi pedido) e NÃO resolve a nota: se a conclusão for que o
-- faturamento foi indevido, é o PV que precisa ser corrigido, não estas OPs.
-- Cancelar diz a verdade sobre a FÁBRICA (estas ordens não foram executadas)
-- sem afirmar nada sobre o faturamento.
UPDATE public.orders o
   SET status = 'Cancelada', updated_at = now()
  FROM public.sale_orders so
 WHERE so.id = o.sale_order_id
   AND so.order_number = 'PV-2026-00089'
   AND o.deleted_at IS NULL
   AND lower(btrim(COALESCE(o.status, ''))) NOT IN
       ('finalizado', 'cancelada', 'cancelado', 'cancelled', 'faturado');
