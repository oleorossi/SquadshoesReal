-- A fila do Kanban tem de responder dentro de transação somente leitura.
-- É assim que o PostgREST chama função STABLE. SELECT FOR UPDATE aqui
-- é o erro que derrubou a Gestão. Não grava pedido.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $fila_corte_ro$
BEGIN
  PERFORM public.list_atelier_cut_queue();
END
$fila_corte_ro$;
ROLLBACK;
